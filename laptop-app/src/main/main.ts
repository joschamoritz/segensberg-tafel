import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen } from 'electron';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
  AppInfo,
  AppStatus,
  DEFAULT_HALF_DURATION_MIN,
  IPC,
  MAX_ATTENDANCE_MESSAGE_LENGTH,
  MAX_RETRO_NAME_LENGTH,
  MediaFolderId,
  MEDIA_FOLDER_IDS,
  Player,
  TeamId,
} from '../shared/types';
import { loadContentConfig, saveContentConfig } from './content';
import { MediaLibrary } from './media';
import { detectLogoVariant, readImageAsDataUrl } from './images';
import {
  clearLiveMatch,
  isResumable,
  isWorthSaving,
  loadLiveMatch,
  saveLiveMatch,
} from './liveMatch';
import { loadTeamsConfig, resolveDefaultLibraryPath, saveTeamsConfig } from './persistence';
import {
  isCardColor,
  isEventId,
  isInfoOverlay,
  isTeamId,
  sanitizeAnnouncements,
  sanitizeAttendance,
  sanitizeAppearance,
  sanitizeBoardSize,
  sanitizeImportedPlayers,
  sanitizeKickoffTime,
  sanitizeOptionalId,
  sanitizePlayer,
  sanitizeText,
} from './validate';
import { SquadStore } from './squads';
import { MatchStateStore } from './state';
import { TeamLibrary } from './teamLibrary';
import {
  createControlWindow,
  createDisplayWindow,
  findDisplayById,
  listDisplays,
  pickDefaultTargetDisplay,
} from './windows';
import type { Display } from 'electron';

let store: MatchStateStore;
let library: TeamLibrary;
let squads: SquadStore;
let media: MediaLibrary;

let controlWindow: BrowserWindow | null = null;
let displayWindow: BrowserWindow | null = null;
let selectedDisplayId: number | null = null;

/**
 * Abstand zwischen zwei Sicherungen des laufenden Spiels. Die Uhr ändert
 * den Zustand fünfmal pro Sekunde -- ungedrosselt zu schreiben hieße, die
 * Platte während des ganzen Spiels dauerhaft zu beschäftigen. Bei einem
 * Absturz gehen höchstens diese fünf Sekunden verloren.
 */
const LIVE_SAVE_INTERVAL_MS = 5000;
let liveSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Gesetzt, sobald das Beenden trotz laufendem Spiel bestätigt wurde. */
let allowControlClose = false;

/**
 * Eigenes Protokoll für die Diashow-Bilder.
 *
 * Die Anzeige lädt Werbemotive als `svh-media://werbung/01_sponsor.jpg`
 * direkt von der Platte. Der Umweg über data:-URLs im Zustand schied aus:
 * Zwanzig Motive wären mehrere Megabyte, die bei jeder Zustandsänderung
 * durch die IPC-Brücke an beide Fenster gingen. So lädt Chromium jedes
 * Bild selbst und erst, wenn es gebraucht wird.
 *
 * Die Registrierung muss VOR `app.whenReady()` laufen, deshalb steht sie
 * hier im Modulrumpf und nicht in der Startroutine.
 */
const MEDIA_SCHEME = 'svh-media';

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    // `stream` für Medien-Elemente. Die Tormusik läuft trotzdem NICHT
    // über dieses Schema, sondern über IPC (siehe `IPC.soundRead`):
    // `net.fetch` auf eine `file:`-URL beantwortet keine
    // Teilbereichs-Anfragen, und ein `fetch()` aus dem Fenster scheitert
    // an der Herkunftsprüfung -- das Fenster läuft unter `file://`, das
    // Schema ist eine eigene Herkunft ohne CORS-Kopfzeile.
    privileges: { standard: true, secure: true, stream: true },
  },
]);

/**
 * Beantwortet Anfragen an `svh-media:`. Alles, was nicht eindeutig eine
 * Bilddatei aus einem der beiden Medienordner ist, wird abgewiesen --
 * die Prüfung steckt in `MediaLibrary.resolveFile()`.
 */
function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      const folder = url.hostname as MediaFolderId;
      if (!MEDIA_FOLDER_IDS.includes(folder)) {
        return new Response('Unbekannter Ordner', { status: 404 });
      }

      const fileName = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const filePath = media.resolveFile(folder, fileName);
      if (filePath === null) return new Response('Nicht gefunden', { status: 404 });

      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      // Ein kaputter Verweis darf die Anzeige nicht mitreißen -- dann
      // bleibt die Folie eben leer.
      console.error('svh-media: Anfrage fehlgeschlagen', error);
      return new Response('Fehler', { status: 500 });
    }
  });
}

function currentStatus(): AppStatus {
  const target = selectedDisplayId !== null ? findDisplayById(selectedDisplayId) : null;
  return {
    displays: listDisplays(),
    selectedDisplayId: target ? selectedDisplayId : null,
    previewMode: target === null,
    displayOpen: displayWindow !== null && !displayWindow.isDestroyed(),
  };
}

/** Sendet nur an Fenster, die es noch gibt -- sonst wirft `send()`. */
function sendTo(win: BrowserWindow | null, channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function broadcastState(): void {
  const state = store.getState();
  sendTo(controlWindow, IPC.stateUpdated, state);
  sendTo(displayWindow, IPC.stateUpdated, state);
}

function broadcastStatus(): void {
  sendTo(controlWindow, IPC.statusUpdated, currentStatus());
}

/**
 * Merkt vor, dass der Spielstand gesichert werden soll. Mehrere Änderungen
 * innerhalb des Drosselfensters führen zu einem einzigen Schreibvorgang.
 */
function scheduleLiveMatchSave(): void {
  if (liveSaveTimer) return;
  liveSaveTimer = setTimeout(flushLiveMatchSave, LIVE_SAVE_INTERVAL_MS);
}

/**
 * Schreibt sofort. Wird an den Stellen aufgerufen, an denen ein Verlust
 * besonders weh täte: bei jedem Phasenwechsel und beim Beenden.
 */
function flushLiveMatchSave(): void {
  if (liveSaveTimer) {
    clearTimeout(liveSaveTimer);
    liveSaveTimer = null;
  }
  if (!store) return;
  const state = store.getState();
  if (!isWorthSaving(state)) return;
  saveLiveMatch(state);
}

/** Verwirft die Sicherung samt vorgemerktem Schreibvorgang. */
function discardLiveMatch(): void {
  if (liveSaveTimer) {
    clearTimeout(liveSaveTimer);
    liveSaveTimer = null;
  }
  clearLiveMatch();
}

/** Persistiert nur die Team-Stammdaten (nicht Spielstand/Uhr), siehe persistence.ts */
function persistTeams(): void {
  const state = store.getState();
  saveTeamsConfig({
    home: {
      name: state.home.name,
      shortName: state.home.shortName,
      logoDataUrl: state.home.logoDataUrl,
      logoVariant: state.home.logoVariant,
      retroName: state.home.retroName,
    },
    away: {
      name: state.away.name,
      shortName: state.away.shortName,
      logoDataUrl: state.away.logoDataUrl,
      logoVariant: state.away.logoVariant,
      retroName: state.away.retroName,
    },
    logoLibraryPath: library.getRootPath(),
    halfDurationMin: store.getState().halfDurationMin,
    board: store.getState().board,
    appearance: store.getState().appearance,
  });
}

/** Persistiert die redaktionellen Texte, siehe content.ts */
function persistContent(): void {
  const state = store.getState();
  saveContentConfig({
    attendanceMessage: state.attendanceMessage,
    announcements: state.announcements,
    sound: state.sound,
  });
}

/** Speichert Kader und Trainer unter dem aktuellen Vereinsnamen. */
function persistSquad(team: TeamId): void {
  const state = store.getState();
  squads.set(state[team].name, { players: state.squads[team], coach: state[team].coach });
}

function updateSquad(team: TeamId, players: Player[]): void {
  store.setSquad(team, players);
  persistSquad(team);
}

function broadcastLibrary(): void {
  sendTo(controlWindow, IPC.libraryUpdated, {
    teams: library.list(),
    rootPath: library.getRootPath(),
    squadNames: squads.listNames(),
  });
}

async function chooseLibraryFolder(): Promise<void> {
  if (!controlWindow) return;
  const result = await dialog.showOpenDialog(controlWindow, {
    title: 'Ordner mit den Vereinslogos wählen',
    defaultPath: library.getRootPath(),
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  library.setRootPath(result.filePaths[0]);
  persistTeams();
  broadcastLibrary();
}

/**
 * Öffnet eine Aufstellungs-Textdatei und schickt den Inhalt ins
 * Steuerungsfenster. Dort landet er im Einfügefeld -- so durchläuft auch
 * eine geladene Datei die Vorschau, bevor der Kader überschrieben wird.
 */
async function pickSquadFile(team: TeamId): Promise<void> {
  if (!controlWindow) return;

  // Standardordner neben der Logo-Bibliothek ("…/Vereinsdaten/Kader")
  const defaultPath = path.join(path.dirname(library.getRootPath()), 'Kader');

  const result = await dialog.showOpenDialog(controlWindow, {
    title: 'Aufstellung aus Datei laden',
    defaultPath: fs.existsSync(defaultPath) ? defaultPath : undefined,
    filters: [{ name: 'Textdateien', extensions: ['txt', 'csv'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;

  try {
    const text = fs.readFileSync(result.filePaths[0], 'utf-8');
    controlWindow.webContents.send(IPC.squadFileLoaded, team, text);
  } catch {
    dialog.showErrorBox('Datei nicht lesbar', 'Die gewählte Datei konnte nicht gelesen werden.');
  }
}

async function pickPlayerPhoto(team: TeamId, playerId: string): Promise<void> {
  if (!controlWindow) return;
  const result = await dialog.showOpenDialog(controlWindow, {
    title: 'Spielerportrait auswählen',
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;

  const dataUrl = readImageAsDataUrl(result.filePaths[0], 'portrait');
  if (!dataUrl) return;
  store.setPlayerPhoto(team, playerId, dataUrl);
  persistSquad(team);
}

async function pickLogo(team: TeamId): Promise<void> {
  if (!controlWindow) return;
  const result = await dialog.showOpenDialog(controlWindow, {
    title: 'Logo auswählen',
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;

  const file = result.filePaths[0];
  const dataUrl = readImageAsDataUrl(file, 'logo');
  if (!dataUrl) return;
  // Von Hand gewählte Dateien liegen nicht in der Ordnerstruktur der
  // Bibliothek -- hier muss die Variante aus Dateiname und Bildinhalt
  // hergeleitet werden, siehe `detectLogoVariant`.
  store.setTeamLogo(team, dataUrl, detectLogoVariant(file));
  persistTeams();
}

/**
 * Maße des zuletzt bespielten Bildschirms. Nur wenn sich genau die ändern,
 * muss das Anzeigefenster neu aufgebaut werden -- Windows meldet
 * `display-metrics-changed` auch für andere Bildschirme, und ein
 * Neuaufbau mitten im Spiel bedeutet einen kurzen Blackout auf der Tafel.
 */
let lastTargetBounds = '';

function boundsKey(display: Display | null): string {
  if (!display) return '';
  const { x, y, width, height } = display.bounds;
  return `${x}:${y}:${width}:${height}`;
}

function openDisplayWindow(displayId: number | null): void {
  displayWindow?.close();
  selectedDisplayId = displayId;
  const target = displayId !== null ? findDisplayById(displayId) : null;
  lastTargetBounds = boundsKey(target);

  // Referenz auf das konkrete Fenster festhalten: `close()` wirkt
  // asynchron, der `closed`-Handler des ALTEN Fensters feuerte sonst erst
  // nach dieser Zuweisung und setzte die Referenz auf das gerade erzeugte
  // neue Fenster auf null -- die Anzeige bekam danach keine Updates mehr.
  const win = createDisplayWindow(target, store.getState().board);
  displayWindow = win;

  win.on('closed', () => {
    if (displayWindow === win) {
      displayWindow = null;
      broadcastStatus();
    }
  });

  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.stateUpdated, store.getState());
  });

  // Stirbt der Renderer des Anzeigefensters (Grafiktreiber, Speicher),
  // bliebe sonst eine schwarze Tafel stehen, ohne dass es jemand merkt.
  win.webContents.on('render-process-gone', () => {
    if (displayWindow === win) openDisplayWindow(selectedDisplayId);
  });

  broadcastStatus();
}

/**
 * Windows meldet eine Auflösungsänderung oft mehrfach hintereinander.
 * Ohne kurze Sammelfrist würde das Anzeigefenster zwei- bis dreimal neu
 * aufgebaut.
 */
let refitTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDisplayRefit(): void {
  if (refitTimer) clearTimeout(refitTimer);
  refitTimer = setTimeout(() => {
    refitTimer = null;
    openDisplayWindow(selectedDisplayId);
  }, 300);
}

/**
 * Bietet nach einem Absturz oder versehentlichen Beenden an, das
 * abgebrochene Spiel fortzusetzen. Die Rückfrage kommt bewusst VOR dem
 * Öffnen der Fenster -- sonst blitzte auf der Anzeigetafel für einen
 * Moment ein 0:0 auf, bevor der echte Spielstand steht.
 */
function maybeResumeLiveMatch(): void {
  const snapshot = loadLiveMatch();
  if (!snapshot) return;

  if (!isResumable(snapshot)) {
    // Zu alt oder gar nicht erst angepfiffen: wortlos verwerfen.
    clearLiveMatch();
    return;
  }

  const savedAt = new Date(snapshot.savedAt);
  const time = `${String(savedAt.getHours()).padStart(2, '0')}:${String(
    savedAt.getMinutes()
  ).padStart(2, '0')}`;
  const minutes = Math.floor(snapshot.elapsedMs / 60000);
  const phaseText =
    snapshot.phase === 'half-time'
      ? 'Halbzeitpause'
      : snapshot.phase === 'full-time'
        ? 'nach Abpfiff'
        : `${snapshot.half}. Halbzeit, ${minutes}. Minute`;

  const choice = dialog.showMessageBoxSync({
    type: 'question',
    title: 'Letztes Spiel fortsetzen?',
    message: `${snapshot.home.name} ${snapshot.home.score}:${snapshot.away.score} ${snapshot.away.name}`,
    detail:
      `Zuletzt gesichert um ${time} Uhr (${phaseText}).\n\n` +
      'Beim Fortsetzen werden Spielstand, Chronik und Uhrstand übernommen. ' +
      'Die Uhr bleibt zunächst angehalten und wird per "Start" fortgesetzt.',
    buttons: ['Spiel fortsetzen', 'Neues Spiel beginnen'],
    defaultId: 0,
    cancelId: 0,
  });

  if (choice === 0) {
    store.restoreLiveMatch(snapshot);
  } else {
    clearLiveMatch();
  }
}

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
  if (controlWindow && !controlWindow.isDestroyed()) {
    if (controlWindow.isMinimized()) controlWindow.restore();
    controlWindow.show();
    controlWindow.focus();
  }
});

/**
 * Fassung und Baudatum, geschrieben von `scripts/build-info.js`.
 *
 * Nur einmal gelesen und dann gemerkt: Der Wert ändert sich zur Laufzeit
 * nicht. Fehlt die Datei -- etwa weil jemand `tsc` von Hand aufgerufen
 * hat --, bleibt die Version aus Electron übrig; das Baudatum entfällt
 * dann, statt eine erfundene Zahl zu zeigen.
 */
let appInfoCache: AppInfo | null = null;

function readAppInfo(): AppInfo {
  if (appInfoCache) return appInfoCache;
  let builtAt = '';
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'build-info.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppInfo>;
    if (typeof parsed.builtAt === 'string') builtAt = parsed.builtAt;
  } catch {
    // Ohne die Datei bleibt es bei der Version aus package.json.
  }
  appInfoCache = { version: app.getVersion(), builtAt };
  return appInfoCache;
}

/**
 * Letzte Rettungsleine: Ein unbehandelter Fehler soll die App am Spieltag
 * nicht wortlos beenden. Protokoll landet neben den Konfigurationsdateien.
 *
 * Die Fassung steht in jeder Zeile: Ein Protokoll vom Vereinsrechner
 * ohne Angabe, welcher Stand ihn erzeugt hat, ist nur halb verwertbar.
 */
function logFatal(kind: string, error: unknown): void {
  try {
    const line = `[${new Date().toISOString()}] [v${app.getVersion()}] ${kind}: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'fehler.log'), line, 'utf-8');
  } catch {
    // Wenn nicht einmal das Protokoll schreibbar ist, bleibt nur die Konsole.
  }
  console.error(kind, error);
}

process.on('uncaughtException', (error) => logFatal('uncaughtException', error));
process.on('unhandledRejection', (reason) => logFatal('unhandledRejection', reason));

app.whenReady().then(() => {
  // Zweitinstanz zeigt nur den Hinweis oben und beendet sich -- hier ist
  // dann nichts mehr zu tun.
  if (!isFirstInstance) return;

  const teamsConfig = loadTeamsConfig();
  store = new MatchStateStore(teamsConfig);
  library = new TeamLibrary(teamsConfig.logoLibraryPath ?? resolveDefaultLibraryPath());
  squads = new SquadStore();

  store.setHalfDuration(teamsConfig.halfDurationMin ?? DEFAULT_HALF_DURATION_MIN);
  // Auch die gespeicherte Fassung läuft durch die Prüfschicht: teams.json
  // ist eine Datei auf der Platte und kann von Hand bearbeitet worden sein.
  store.setBoardSize(sanitizeBoardSize(teamsConfig.board));
  store.setAppearance(sanitizeAppearance(teamsConfig.appearance));

  const content = loadContentConfig();
  store.setAttendanceMessage(content.attendanceMessage);
  store.setAnnouncements(sanitizeAnnouncements(content.announcements));
  store.setSound(content.sound);

  media = new MediaLibrary();
  store.setMedia(media.getLists());
  registerMediaProtocol();

  // Vor allem anderen: abgebrochenes Spiel anbieten. Setzt gegebenenfalls
  // Namen, Spielstand, Chronik und Halbzeitdauer -- die Kader darunter
  // richten sich nach den dann gültigen Vereinsnamen.
  maybeResumeLiveMatch();

  // Kader und Trainer der eingestellten Vereine laden. Nach einer
  // Wiederaufnahme stehen hier die Namen aus der Sicherung.
  for (const team of ['home', 'away'] as TeamId[]) {
    const stored = squads.get(store.getState()[team].name);
    store.setSquad(team, stored.players);
    store.setCoach(team, stored.coach);
  }

  controlWindow = createControlWindow();

  // Ein Fehlklick aufs Fensterkreuz beendete bisher mitten im Spiel alles.
  controlWindow.on('close', (event) => {
    if (allowControlClose) return;
    const state = store.getState();
    if (state.phase !== 'live') return;

    event.preventDefault();
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Es läuft noch ein Spiel',
      message: `${state.home.name} ${state.home.score}:${state.away.score} ${state.away.name}`,
      detail:
        'Das Spiel läuft noch. Der Spielstand wird gesichert und lässt sich ' +
        'beim nächsten Start fortsetzen. Trotzdem jetzt beenden?',
      buttons: ['Weiterspielen', 'Beenden'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice !== 1) return;

    allowControlClose = true;
    flushLiveMatchSave();
    controlWindow?.close();
  });

  controlWindow.on('closed', () => {
    controlWindow = null;
    // Ohne Steuerungsfenster ergibt der Rest der App keinen Sinn mehr.
    app.quit();
  });

  const defaultTarget = pickDefaultTargetDisplay();
  openDisplayWindow(defaultTarget?.id ?? null);

  store.onChange(broadcastState);
  store.onChange(scheduleLiveMatchSave);

  // Uhr läuft über einen eigenen, schlanken Kanal -- siehe IPC.stateUpdated.
  store.onClockTick((clock) => {
    sendTo(controlWindow, IPC.clockTick, clock);
    sendTo(displayWindow, IPC.clockTick, clock);
    // Auch ohne Tor oder Karte muss der Uhrstand in die Sicherung wandern,
    // sonst fehlten nach einem Absturz alle Minuten seit dem letzten
    // Ereignis. Der Aufruf ist gedrosselt, kostet also nichts.
    scheduleLiveMatchSave();
  });

  ipcMain.on(IPC.requestState, (event) => {
    event.sender.send(IPC.stateUpdated, store.getState());
  });
  ipcMain.on(IPC.requestStatus, (event) => {
    event.sender.send(IPC.statusUpdated, currentStatus());
  });
  ipcMain.on(IPC.scoreIncrement, (_event, team: unknown, delta: unknown) => {
    if (!isTeamId(team) || typeof delta !== 'number' || !Number.isFinite(delta)) return;
    store.incrementScore(team, delta);
  });
  ipcMain.on(IPC.clockStart, () => store.startClock());
  ipcMain.on(IPC.clockStop, () => store.stopClock());
  ipcMain.on(IPC.clockReset, () => store.resetClock());
  ipcMain.on(IPC.setStoppage, (_event, minutes: unknown) => {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return;
    store.setStoppage(minutes);
    flushLiveMatchSave();
  });
  ipcMain.on(IPC.clockSet, (_event, elapsedMs: unknown) => {
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) return;
    store.setClock(elapsedMs);
    flushLiveMatchSave();
  });
  ipcMain.on(IPC.selectDisplay, (_event, id: number | null) => openDisplayWindow(id));

  ipcMain.on(IPC.requestLibrary, () => {
    // Bei jeder Anfrage neu einlesen -- so tauchen zwischenzeitlich
    // hinzugefügte Vereinslogos ohne Neustart auf.
    library.reload();
    broadcastLibrary();
  });
  ipcMain.on(IPC.libraryChooseFolder, () => {
    void chooseLibraryFolder();
  });
  ipcMain.on(IPC.libraryPick, (_event, team: TeamId, id: string) => {
    const name = library.getName(id);
    if (!name) return;
    const stored = squads.get(name);
    const logo = library.getLogo(id);
    store.applyLibraryTeam(
      team,
      name,
      logo?.dataUrl,
      stored.players,
      stored.coach,
      logo?.variant
    );
    persistTeams();
  });

  ipcMain.on(IPC.squadPickFile, (_event, team: TeamId) => {
    void pickSquadFile(team);
  });
  ipcMain.on(IPC.squadLoadByName, (_event, team: TeamId, name: string) => {
    const stored = squads.get(name);
    // Name der Mannschaft mitziehen -- sonst stünde auf der Tafel die
    // 1. Mannschaft, während der Kader der U19 geladen ist.
    store.applyLibraryTeam(team, name, store.getState()[team].logoDataUrl, stored.players, stored.coach);
    persistTeams();
  });
  ipcMain.on(IPC.showLineup, (_event, team: TeamId) => store.showLineup(team));
  ipcMain.on(IPC.hideLineup, () => store.hideLineup());
  ipcMain.on(IPC.showScorer, (_event, eventId: unknown) => {
    if (!isEventId(eventId)) return;
    store.showScorer(eventId);
  });
  ipcMain.on(IPC.hideScorer, () => store.hideScorer());

  ipcMain.on(IPC.showInfo, (_event, overlay: unknown) => {
    if (!isInfoOverlay(overlay)) return;
    store.showInfo(overlay);
  });
  ipcMain.on(IPC.hideInfo, () => store.hideInfo());

  ipcMain.on(IPC.cornerAdjust, (_event, team: unknown, delta: unknown) => {
    if (!isTeamId(team) || typeof delta !== 'number' || !Number.isFinite(delta)) return;
    store.adjustCorners(team, delta);
  });

  ipcMain.on(IPC.setAttendance, (_event, value: unknown) => {
    store.setAttendance(sanitizeAttendance(value));
  });

  ipcMain.on(IPC.setAnnouncements, (_event, value: unknown) => {
    store.setAnnouncements(sanitizeAnnouncements(value));
    persistContent();
  });

  ipcMain.on(IPC.slideshowStart, () => store.startSlideshow());
  ipcMain.on(IPC.slideshowStop, () => store.stopSlideshow());

  ipcMain.on(IPC.mediaReload, () => {
    media.scan();
    store.setMedia(media.getLists());
  });

  /**
   * Liefert die Tormusik als Bytes.
   *
   * Bewusst über IPC statt über das `svh-media:`-Protokoll: Ein
   * `fetch()` aus dem Steuerungsfenster ist herkunftsübergreifend und
   * scheitert, und direktes Streamen setzte nach zwei Sekunden aus.
   * Einmal geladen liegt die Datei als Blob im Fenster -- der Aufruf
   * passiert nur, wenn sich der Dateiname ändert, nicht bei jedem Tor.
   */
  ipcMain.handle(IPC.soundRead, (_event, fileName: unknown) => {
    if (typeof fileName !== 'string') return null;
    // Dieselbe Pfadprüfung wie beim Protokoll -- eine zweite Stelle mit
    // eigener Logik wäre eine zweite Stelle zum Übersehen.
    const filePath = media.resolveFile('sounds', fileName);
    if (filePath === null) return null;
    try {
      return fs.readFileSync(filePath);
    } catch (error) {
      console.error('Tormusik konnte nicht gelesen werden:', error);
      return null;
    }
  });

  // Fassung und Baudatum für die Kopfzeile des Steuerungsfensters.
  ipcMain.handle(IPC.appInfo, () => readAppInfo());

  ipcMain.on(IPC.setSound, (_event, volume: unknown, muted: unknown) => {
    if (typeof volume !== 'number' || !Number.isFinite(volume)) return;
    store.setSound({ volume, muted: muted === true });
    persistContent();
  });

  ipcMain.on(IPC.setAttendanceMessage, (_event, value: unknown) => {
    // sanitizeText() nimmt auch Zeilenumbrüche aus eingefügtem Text heraus
    // -- die zerrissen sonst das Layout der Tafel.
    store.setAttendanceMessage(sanitizeText(value, MAX_ATTENDANCE_MESSAGE_LENGTH));
    persistContent();
  });

  ipcMain.on(IPC.playerPickPhoto, (_event, team: TeamId, playerId: string) => {
    void pickPlayerPhoto(team, playerId);
  });
  ipcMain.on(IPC.playerClearPhoto, (_event, team: TeamId, playerId: string) => {
    store.setPlayerPhoto(team, playerId, undefined);
    persistSquad(team);
  });

  ipcMain.on(IPC.teamSetCoach, (_event, team: unknown, coach: unknown) => {
    if (!isTeamId(team)) return;
    store.setCoach(team, sanitizeText(coach));
    persistSquad(team);
  });

  ipcMain.on(IPC.squadAddPlayer, (_event, team: TeamId) => {
    const player: Player = {
      id: randomUUID(),
      number: null,
      firstName: '',
      lastName: '',
      position: '',
      // Neu angelegte Spieler gehören erst einmal nur zum Kader und stehen
      // nicht automatisch im Spielbericht.
      role: 'out',
      isGoalkeeper: false,
      isCaptain: false,
    };
    updateSquad(team, [...store.getState().squads[team], player]);
  });
  ipcMain.on(IPC.squadUpdatePlayer, (_event, team: unknown, raw: unknown) => {
    if (!isTeamId(team)) return;
    const player = sanitizePlayer(raw);
    if (!player) return;
    updateSquad(
      team,
      store.getState().squads[team].map((p) => (p.id === player.id ? player : p))
    );
  });
  ipcMain.on(
    IPC.squadImport,
    (_event, team: unknown, entries: unknown, replace: unknown, coach: unknown) => {
      if (!isTeamId(team)) return;
      const imported: Player[] = sanitizeImportedPlayers(entries).map((entry) => ({
        ...entry,
        id: randomUUID(),
      }));
      if (imported.length === 0) return;
      const existing = replace === true ? [] : store.getState().squads[team];
      // Trainer nur übernehmen, wenn im eingefügten Text einer stand
      const trainer = sanitizeText(coach);
      if (trainer) store.setCoach(team, trainer);
      updateSquad(team, [...existing, ...imported]);
    }
  );
  ipcMain.on(IPC.squadRemovePlayer, (_event, team: TeamId, playerId: string) => {
    updateSquad(
      team,
      store.getState().squads[team].filter((p) => p.id !== playerId)
    );
  });
  ipcMain.on(IPC.goalSetScorer, (_event, eventId: unknown, scorerId: unknown) => {
    if (!isEventId(eventId)) return;
    store.setGoalScorer(eventId, sanitizeOptionalId(scorerId));
  });
  ipcMain.on(IPC.cardAdd, (_event, team: unknown, card: unknown) => {
    if (!isTeamId(team) || !isCardColor(card)) return;
    store.addCard(team, card);
  });
  ipcMain.on(IPC.cardSetPlayer, (_event, eventId: unknown, playerId: unknown) => {
    if (!isEventId(eventId)) return;
    store.setCardPlayer(eventId, sanitizeOptionalId(playerId));
  });
  ipcMain.on(IPC.subAdd, (_event, team: unknown) => {
    if (!isTeamId(team)) return;
    store.addSubstitution(team);
  });
  ipcMain.on(IPC.subSetPlayers, (_event, eventId: unknown, outId: unknown, inId: unknown) => {
    if (!isEventId(eventId)) return;
    store.setSubstitutionPlayers(eventId, sanitizeOptionalId(outId), sanitizeOptionalId(inId));
  });
  ipcMain.on(IPC.eventRemove, (_event, eventId: unknown) => {
    if (!isEventId(eventId)) return;
    store.removeEvent(eventId);
  });
  ipcMain.on(IPC.setKickoffTime, (_event, value: unknown) => {
    store.setKickoffTime(sanitizeKickoffTime(value));
  });
  ipcMain.on(IPC.setHalfDuration, (_event, minutes: unknown) => {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return;
    store.setHalfDuration(minutes);
    persistTeams();
  });
  ipcMain.on(IPC.setBoardSize, (_event, board: unknown) => {
    store.setBoardSize(sanitizeBoardSize(board));
    persistTeams();
  });
  ipcMain.on(IPC.setAppearance, (_event, appearance: unknown) => {
    store.setAppearance(sanitizeAppearance(appearance));
    persistTeams();
  });

  // Phasenwechsel sind die Momente, an denen ein Verlust am meisten weh
  // täte -- hier wird nicht auf das Drosselfenster gewartet.
  ipcMain.on(IPC.phaseKickoff, () => {
    store.kickoff();
    flushLiveMatchSave();
  });
  ipcMain.on(IPC.phaseHalfTime, () => {
    store.goToHalfTime();
    flushLiveMatchSave();
  });
  ipcMain.on(IPC.phaseSecondHalf, () => {
    store.startSecondHalf();
    flushLiveMatchSave();
  });
  ipcMain.on(IPC.phaseFullTime, () => {
    store.goToFullTime();
    flushLiveMatchSave();
  });
  ipcMain.on(IPC.matchReset, () => {
    store.resetMatch();
    // Sicherung mitentfernen: Sonst böte der nächste Start an, das gerade
    // bewusst verworfene Spiel fortzusetzen.
    discardLiveMatch();
  });
  ipcMain.on(IPC.phaseRevert, () => {
    store.revertPhase();
    flushLiveMatchSave();
  });

  ipcMain.on(IPC.teamSetName, (_event, team: unknown, name: unknown) => {
    if (!isTeamId(team)) return;
    store.setTeamName(team, sanitizeText(name));
    persistTeams();
  });
  ipcMain.on(IPC.teamSetShortName, (_event, team: unknown, shortName: unknown) => {
    if (!isTeamId(team)) return;
    store.setTeamShortName(team, sanitizeText(shortName, 6));
    persistTeams();
  });
  ipcMain.on(IPC.teamSetRetroName, (_event, team: unknown, retroName: unknown) => {
    if (!isTeamId(team)) return;
    store.setTeamRetroName(team, sanitizeText(retroName, MAX_RETRO_NAME_LENGTH));
    persistTeams();
  });
  ipcMain.on(IPC.teamPickLogo, (_event, team: TeamId) => {
    void pickLogo(team);
  });
  ipcMain.on(IPC.teamClearLogo, (_event, team: TeamId) => {
    store.setTeamLogo(team, undefined);
    persistTeams();
  });

  ipcMain.on(IPC.reopenDisplay, () => openDisplayWindow(selectedDisplayId));

  // Falls sich die Monitor-Konfiguration während der Laufzeit ändert
  // (Kabel gezogen/gesteckt), Status neu melden und das Anzeigefenster
  // nachziehen.
  screen.on('display-added', broadcastStatus);
  screen.on('display-removed', (_event, display) => {
    // Ist ausgerechnet der bespielte Bildschirm weg, liefe das Fenster ins
    // Leere. Dann zurück in die Vorschau, statt eine unsichtbare Anzeige
    // zu behalten.
    if (selectedDisplayId !== null && display.id === selectedDisplayId) {
      openDisplayWindow(null);
      return;
    }
    broadcastStatus();
  });
  screen.on('display-metrics-changed', (_event, display) => {
    if (selectedDisplayId === null || display.id !== selectedDisplayId) {
      broadcastStatus();
      return;
    }
    // Nur bei tatsächlich geänderten Maßen neu aufbauen -- Windows meldet
    // dieses Ereignis auch, wenn sich nur die Skalierung eines anderen
    // Bildschirms ändert.
    if (boundsKey(display) === lastTargetBounds) {
      broadcastStatus();
      return;
    }
    scheduleDisplayRefit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      controlWindow = createControlWindow();
    }
  });
});

// Letzte Sicherung, egal auf welchem Weg die App endet.
app.on('before-quit', () => flushLiveMatchSave());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
