import { app, BrowserWindow, dialog, powerMonitor } from 'electron';
import { DEFAULT_HALF_DURATION_MIN, IPC, TeamId } from '../shared/types';
import { logFatal } from './appInfo';
import { loadContentConfig } from './content';
import { initBoardLink, setBoardLinkStatusListener, shutdownBoardLink } from './boardLinkControl';
import { broadcastState, ctx, sendTo, toControl } from './context';
import { broadcastStatus, openDisplayWindow, watchScreens } from './displayWindow';
import { registerIpcHandlers } from './ipcHandlers';
import { flushLiveMatchSave, maybeResumeLiveMatch, scheduleLiveMatchSave } from './liveSave';
import { MediaLibrary } from './media';
// Registriert das Schema `svh-media:` schon beim Laden -- das muss vor
// `app.whenReady()` geschehen, siehe dort.
import { registerMediaProtocol } from './mediaProtocol';
import { loadTeamsConfig, resolveDefaultLibraryPath } from './persistence';
import { initRemoteControl, setRemoteStatusListener, shutdownRemote } from './remoteControl';
import {
  sanitizeAnnouncements,
  sanitizeAppearance,
  sanitizeBoardSize,
  sanitizeLineupStyle,
  sanitizeFormation,
  sanitizeCompetition,
  sanitizeSlideBlocks,
  sanitizeSponsorSlots,
} from './validate';
import { SquadStore } from './squads';
import { MatchStateStore } from './state';
import { TeamLibrary } from './teamLibrary';
import { createControlWindow, pickDefaultTargetDisplay } from './windows';

// Aufbau des Hauptprozesses (siehe laptop-app/README.md):
//   context.ts        gemeinsamer Zustand (Stores, Fenster) und Versand an die Fenster
//   ipc.ts            onIpc()/handleIpc() -- der einzige Weg zu ipcMain
//   ipcHandlers.ts    alle Handler des Steuerungsfensters und der Fernsteuerung
//   displayWindow.ts  Anzeigefenster, Zielbildschirm, Status, Wachhalten
//   remoteControl.ts  Fernsteuerung im WLAN (PIN, Start/Stopp)
//   boardLinkControl.ts / boardLink.ts / taurus.ts
//                     Verbindung zum TB50 (Anzeige, Helligkeit)
//   liveSave.ts       Sicherung des laufenden Spiels und Fortsetzen
//   persist.ts        Speichern von Teams, Texten und Kadern
//   dialogs.ts        Dateifenster am Laptop
//   mediaProtocol.ts  Protokoll `svh-media:` für Bilder der Diashow
//   appInfo.ts        Fassung, Baudatum und fehler.log

/** Gesetzt, sobald das Beenden trotz laufendem Spiel bestätigt wurde. */
let allowControlClose = false;
/** Die Rückfrage beim Schließen steht gerade -- kein zweites Mal öffnen. */
let closePromptOpen = false;

setRemoteStatusListener(broadcastStatus);
setBoardLinkStatusListener(broadcastStatus);

/**
 * Ein zweiter Start (Autostart plus Doppelklick) würde zwei Instanzen
 * erzeugen, die sich um denselben Bildschirm streiten und beide in
 * dieselben Dateien schreiben.
 */
const isFirstInstance = app.requestSingleInstanceLock();

if (!isFirstInstance) {
  // Niemals wortlos beenden: Das Anzeigefenster steht randlos und ohne
  // Taskleisteneintrag auf dem zweiten Bildschirm, eine noch laufende
  // Instanz übersieht man leicht. Ohne Hinweis wirkt der zweite Start
  // schlicht wie "die App startet nicht".
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Anzeigetafel läuft bereits',
      message: 'Die Anzeigetafel ist bereits geöffnet.',
      detail:
        'Es kann immer nur ein Fenster gleichzeitig laufen, damit sich nicht zwei ' +
        'Instanzen um den Anzeigebildschirm streiten.\n\n' +
        'Falls kein Fenster zu sehen ist: Die laufende Instanz im Task-Manager ' +
        'unter "Anzeigetafel" beenden und danach erneut starten.',
      buttons: ['OK'],
    });
    app.quit();
  });
}

app.on('second-instance', () => {
  if (ctx.controlWindow && !ctx.controlWindow.isDestroyed()) {
    if (ctx.controlWindow.isMinimized()) ctx.controlWindow.restore();
    ctx.controlWindow.show();
    ctx.controlWindow.focus();
  }
});

process.on('uncaughtException', (error) => logFatal('uncaughtException', error));
process.on('unhandledRejection', (reason) => logFatal('unhandledRejection', reason));

app.whenReady().then(() => {
  // Zweitinstanz zeigt nur den Hinweis oben und beendet sich -- hier ist
  // dann nichts mehr zu tun.
  if (!isFirstInstance) return;

  initRemoteControl();
  initBoardLink();

  const teamsConfig = loadTeamsConfig();
  const store = new MatchStateStore(teamsConfig);
  ctx.store = store;
  ctx.library = new TeamLibrary(teamsConfig.logoLibraryPath ?? resolveDefaultLibraryPath());
  ctx.squads = new SquadStore();

  store.setHalfDuration(teamsConfig.halfDurationMin ?? DEFAULT_HALF_DURATION_MIN);
  // Auch die gespeicherte Fassung läuft durch die Prüfschicht: teams.json
  // ist eine Datei auf der Platte und kann von Hand bearbeitet worden sein.
  store.setBoardSize(sanitizeBoardSize(teamsConfig.board));
  store.setAppearance(sanitizeAppearance(teamsConfig.appearance));
  store.setCompetition(sanitizeCompetition(teamsConfig.competition));
  store.setSponsorSlots(sanitizeSponsorSlots(teamsConfig.sponsorSlots));

  const content = loadContentConfig();
  store.setAttendanceMessage(content.attendanceMessage);
  store.setAnnouncements(sanitizeAnnouncements(content.announcements));
  store.setSound(content.sound);
  store.setSlideBlocks(sanitizeSlideBlocks(content.slideBlocks));
  store.setLineupStyle(sanitizeLineupStyle(content.lineupStyle));
  store.setFormation(sanitizeFormation(content.formation));

  ctx.media = new MediaLibrary();
  store.setMedia(ctx.media.getLists());
  registerMediaProtocol();

  // Vor allem anderen: abgebrochenes Spiel anbieten. Setzt gegebenenfalls
  // Namen, Spielstand, Chronik und Halbzeitdauer -- die Kader darunter
  // richten sich nach den dann gültigen Vereinsnamen.
  maybeResumeLiveMatch();

  // Kader und Trainer der eingestellten Vereine laden. Nach einer
  // Wiederaufnahme stehen hier die Namen aus der Sicherung.
  for (const team of ['home', 'away'] as TeamId[]) {
    const stored = ctx.squads.get(store.getState()[team].name);
    store.setSquad(team, stored.players);
    store.setCoach(team, stored.coach);
  }

  const controlWindow = createControlWindow();
  ctx.controlWindow = controlWindow;

  // Ein Fehlklick aufs Fensterkreuz beendete bisher mitten im Spiel alles.
  // Auch in der Halbzeitpause: Dann wird am Laptop am meisten geklickt.
  //
  // Bewusst die asynchrone Rückfrage: `showMessageBoxSync` blockierte den
  // Hauptprozess, und solange sie offen stand, lief die Uhr nicht -- weder
  // im Zustand noch auf der Tafel (Review 2026-10, W2).
  controlWindow.on('close', (event) => {
    if (allowControlClose) return;
    const state = store.getState();
    if (state.phase !== 'live' && state.phase !== 'half-time') return;

    event.preventDefault();
    if (closePromptOpen || !ctx.controlWindow) return;
    closePromptOpen = true;
    void dialog
      .showMessageBox(controlWindow, {
        type: 'warning',
        title: 'Es läuft noch ein Spiel',
        message: `${state.home.name} ${state.home.score}:${state.away.score} ${state.away.name}`,
        detail:
          'Das Spiel läuft noch. Der Spielstand wird gesichert und lässt sich ' +
          'beim nächsten Start fortsetzen. Trotzdem jetzt beenden?',
        buttons: ['Weiterspielen', 'Beenden'],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        closePromptOpen = false;
        if (response !== 1) return;
        allowControlClose = true;
        flushLiveMatchSave();
        ctx.controlWindow?.close();
      });
  });

  controlWindow.on('closed', () => {
    ctx.controlWindow = null;
    // Ohne Steuerungsfenster ergibt der Rest der App keinen Sinn mehr.
    app.quit();
  });

  const defaultTarget = pickDefaultTargetDisplay();
  openDisplayWindow(defaultTarget?.id ?? null);

  store.onChange(broadcastState);
  store.onChange(scheduleLiveMatchSave);

  // Uhr läuft über einen eigenen, schlanken Kanal -- siehe IPC.stateUpdated.
  store.onClockTick((clock) => {
    toControl(IPC.clockTick, clock);
    sendTo(ctx.displayWindow, IPC.clockTick, clock);
    // Auch ohne Tor oder Karte muss der Uhrstand in die Sicherung wandern,
    // sonst fehlten nach einem Absturz alle Minuten seit dem letzten
    // Ereignis. Der Aufruf ist gedrosselt, kostet also nichts.
    scheduleLiveMatchSave();
  });

  registerIpcHandlers();
  watchScreens();

  // Standby: Die Uhr soll die Zeit, in der der Rechner schlief, nicht
  // mitzählen. Zuverlässiger als eine Schwelle im Tick -- die konnte
  // Standby und eine blockierte Ereignisschleife nicht unterscheiden.
  powerMonitor.on('suspend', () => store.suspendClock());
  powerMonitor.on('resume', () => store.resumeClock());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      ctx.controlWindow = createControlWindow();
    }
  });
});

// Letzte Sicherung, egal auf welchem Weg die App endet.
app.on('before-quit', () => {
  flushLiveMatchSave();
  shutdownRemote();
  shutdownBoardLink();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
