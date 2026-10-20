import { randomUUID } from 'crypto';
import * as fs from 'fs';
import {
  IPC,
  MAX_ATTENDANCE_MESSAGE_LENGTH,
  MAX_RETRO_NAME_LENGTH,
  Player,
} from '../shared/types';
import { readAppInfo } from './appInfo';
import { ctx, sendTo } from './context';
import { pickLogo, pickPlayerPhoto, pickSquadFile, chooseLibraryFolder } from './dialogs';
import { currentStatus, openDisplayWindow } from './displayWindow';
import { handleIpc, onIpc } from './ipc';
import { discardLiveMatch, flushLiveMatchSave } from './liveSave';
import { broadcastLibrary, persistContent, persistSquad, persistTeams, updateSquad } from './persist';
import { selectBoardHdmi, setBoardBrightness, setBoardLinkConfig, setBoardLinkEnabled } from './boardLinkControl';
import { renewRemotePin, setRemoteEnabled } from './remoteControl';
import {
  isCardColor,
  isEventId,
  isInfoOverlay,
  isTeamId,
  sanitizeAnnouncements,
  sanitizeAttendance,
  sanitizeAppearance,
  sanitizeCompetition,
  sanitizeSlideBlocks,
  sanitizeSponsorRef,
  sanitizeSponsorSlotId,
  sanitizeBoardBrightness,
  sanitizeBoardCredential,
  sanitizeBoardHost,
  sanitizeBoardSize,
  sanitizeImportedPlayers,
  sanitizeKickoffTime,
  sanitizeLineupStyle,
  sanitizeOptionalId,
  sanitizePlayer,
  sanitizeText,
} from './validate';

/**
 * Trägt alle Handler ein, die Steuerungsfenster und Fernsteuerung
 * erreichen können.
 *
 * Jeder Handler geht über `onIpc()`/`handleIpc()` -- nur so ist er auch
 * auf dem iPad erreichbar -- und nimmt seine Argumente als `unknown`
 * entgegen, damit der Compiler die Prüfung erzwingt. Beides lesen
 * `tests/remote.test.js` und `tests/ipcArguments.test.js` aus dieser
 * Datei heraus.
 *
 * Läuft einmal beim Start, nachdem `main.ts` die Stores in `ctx` gelegt hat.
 */
export function registerIpcHandlers(): void {
  const { store, library, squads, media } = ctx;

  // Fernsteuerung ein/aus -- nur am Laptop (siehe REMOTE_DENIED).
  onIpc(IPC.remoteSetEnabled, (_event, enabled: unknown) => {
    void setRemoteEnabled(enabled === true);
  });
  // Neue PIN, siehe renewRemotePin().
  onIpc(IPC.remoteNewPin, () => renewRemotePin());
  // Tormusik von der Fernsteuerung: läuft am Laptop, also nur an dessen
  // Steuerungsfenster -- nicht zurück an die Geräte.
  onIpc(IPC.soundCommand, (_event, command: unknown) => {
    if (command === 'play' || command === 'stop') sendTo(ctx.controlWindow, IPC.soundCommand, command);
  });

  // Verbindung zum TB50 (main/boardLink.ts). An- und Abschalten sowie die
  // Zugangsdaten nur am Laptop (REMOTE_DENIED).
  onIpc(IPC.boardLinkSetEnabled, (_event, enabled: unknown) => {
    setBoardLinkEnabled(enabled === true);
  });
  onIpc(IPC.boardLinkSetConfig, (_event, username: unknown, password: unknown, host: unknown) => {
    const cleanHost = sanitizeBoardHost(host);
    const cleanUser = sanitizeBoardCredential(username);
    // Eine unbrauchbare Adresse verwirft die ganze Eingabe, statt still
    // auf den Rundruf zurückzufallen -- das Feld zeigt danach wieder den
    // gültigen Stand.
    if (cleanHost === null || cleanUser === '') return;
    setBoardLinkConfig({ username: cleanUser, password: sanitizeBoardCredential(password), host: cleanHost });
  });
  onIpc(IPC.boardSetBrightness, (_event, percent: unknown) => {
    const value = sanitizeBoardBrightness(percent);
    if (value !== null) setBoardBrightness(value);
  });
  onIpc(IPC.boardSelectHdmi, () => selectBoardHdmi());

  onIpc(IPC.requestState, (event) => {
    event.sender.send(IPC.stateUpdated, store.getState());
  });
  onIpc(IPC.requestStatus, (event) => {
    event.sender.send(IPC.statusUpdated, currentStatus());
  });
  onIpc(IPC.scoreIncrement, (_event, team: unknown, delta: unknown) => {
    if (!isTeamId(team) || typeof delta !== 'number' || !Number.isFinite(delta)) return;
    store.incrementScore(team, delta);
  });
  onIpc(IPC.clockStart, () => store.startClock());
  onIpc(IPC.clockStop, () => store.stopClock());
  onIpc(IPC.clockReset, () => store.resetClock());
  onIpc(IPC.setStoppage, (_event, minutes: unknown) => {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return;
    store.setStoppage(minutes);
    flushLiveMatchSave();
  });
  onIpc(IPC.clockSet, (_event, elapsedMs: unknown) => {
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) return;
    store.setClock(elapsedMs);
    flushLiveMatchSave();
  });
  onIpc(IPC.selectDisplay, (_event, id: unknown) => {
    // null heißt "Vorschau"; eine unbekannte Id landet über
    // findDisplayById() ebenfalls dort.
    if (id !== null && (typeof id !== 'number' || !Number.isFinite(id))) return;
    openDisplayWindow(id);
  });

  onIpc(IPC.requestLibrary, () => {
    // Bei jeder Anfrage neu einlesen -- so tauchen zwischenzeitlich
    // hinzugefügte Vereinslogos ohne Neustart auf.
    library.reload();
    broadcastLibrary();
  });
  onIpc(IPC.libraryChooseFolder, () => {
    void chooseLibraryFolder();
  });
  onIpc(IPC.libraryPick, (_event, team: unknown, id: unknown, variant: unknown) => {
    if (!isTeamId(team) || typeof id !== 'string') return;
    const name = library.getName(id);
    if (!name) return;
    const logo = library.getLogo(id, variant === 'color' ? 'color' : variant === 'white' ? 'white' : undefined);
    // Derselbe Verein noch einmal, nur mit der anderen Logofassung: nur das
    // Logo tauschen. Sonst lüde die Wahl den Kader neu und leerte einen von
    // Hand gesetzten Retro-Kurznamen -- mitten im Spiel schon gar nicht gewollt.
    if (store.getState()[team].name === name) {
      store.setTeamLogo(team, logo?.dataUrl, logo?.variant);
      persistTeams();
      return;
    }
    const stored = squads.get(name);
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

  onIpc(IPC.squadPickFile, (_event, team: unknown) => {
    if (!isTeamId(team)) return;
    void pickSquadFile(team);
  });
  onIpc(IPC.squadLoadByName, (_event, team: unknown, rawName: unknown) => {
    // Nur gespeicherte Kader -- die Auswahl bietet auch nichts anderes an.
    if (!isTeamId(team) || typeof rawName !== 'string' || !squads.listNames().includes(rawName)) return;
    const name = rawName;
    const stored = squads.get(name);
    // Name der Mannschaft mitziehen -- sonst stünde auf der Tafel die
    // 1. Mannschaft, während der Kader der U19 geladen ist.
    store.applyLibraryTeam(team, name, store.getState()[team].logoDataUrl, stored.players, stored.coach);
    persistTeams();
  });
  onIpc(IPC.showLineup, (_event, team: unknown) => {
    if (isTeamId(team)) store.showLineup(team);
  });
  onIpc(IPC.hideLineup, () => store.hideLineup());
  onIpc(IPC.showScorer, (_event, eventId: unknown) => {
    if (!isEventId(eventId)) return;
    store.showScorer(eventId);
  });
  onIpc(IPC.hideScorer, () => store.hideScorer());

  onIpc(IPC.showInfo, (_event, overlay: unknown) => {
    if (!isInfoOverlay(overlay)) return;
    store.showInfo(overlay);
  });
  onIpc(IPC.hideInfo, () => store.hideInfo());

  onIpc(IPC.cornerAdjust, (_event, team: unknown, delta: unknown) => {
    if (!isTeamId(team) || typeof delta !== 'number' || !Number.isFinite(delta)) return;
    store.adjustCorners(team, delta);
  });

  onIpc(IPC.setAttendance, (_event, value: unknown) => {
    store.setAttendance(sanitizeAttendance(value));
  });

  onIpc(IPC.setAnnouncements, (_event, value: unknown) => {
    store.setAnnouncements(sanitizeAnnouncements(value));
    persistContent();
  });

  onIpc(IPC.setLineupStyle, (_event, value: unknown) => {
    store.setLineupStyle(sanitizeLineupStyle(value));
    persistContent();
  });
  onIpc(IPC.setSlideBlocks, (_event, value: unknown) => {
    store.setSlideBlocks(sanitizeSlideBlocks(value));
    persistContent();
  });

  onIpc(IPC.shootoutStart, () => {
    store.startShootout();
    flushLiveMatchSave();
  });
  onIpc(IPC.shootoutKick, (_event, team: unknown, kick: unknown) => {
    if (!isTeamId(team) || (kick !== 'goal' && kick !== 'miss')) return;
    store.addShootoutKick(team, kick);
    flushLiveMatchSave();
  });
  onIpc(IPC.shootoutUndo, (_event, team: unknown) => {
    if (!isTeamId(team)) return;
    store.undoShootoutKick(team);
  });
  onIpc(IPC.shootoutFinish, () => {
    store.finishShootout();
    flushLiveMatchSave();
  });
  onIpc(IPC.shootoutCancel, () => store.cancelShootout());

  onIpc(IPC.slideshowStart, () => store.startSlideshow());
  onIpc(IPC.slideshowStop, () => store.stopSlideshow());

  onIpc(IPC.mediaReload, () => {
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
  handleIpc(IPC.soundRead, (_event, fileName: unknown) => {
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
  handleIpc(IPC.appInfo, () => readAppInfo());

  onIpc(IPC.setSound, (_event, volume: unknown, muted: unknown) => {
    if (typeof volume !== 'number' || !Number.isFinite(volume)) return;
    store.setSound({ volume, muted: muted === true });
    persistContent();
  });

  onIpc(IPC.setAttendanceMessage, (_event, value: unknown) => {
    // sanitizeText() nimmt auch Zeilenumbrüche aus eingefügtem Text heraus
    // -- die zerrissen sonst das Layout der Tafel.
    store.setAttendanceMessage(sanitizeText(value, MAX_ATTENDANCE_MESSAGE_LENGTH));
    persistContent();
  });

  onIpc(IPC.playerPickPhoto, (_event, team: unknown, rawId: unknown) => {
    const playerId = sanitizeOptionalId(rawId);
    if (!isTeamId(team) || !playerId) return;
    void pickPlayerPhoto(team, playerId);
  });
  onIpc(IPC.playerClearPhoto, (_event, team: unknown, rawId: unknown) => {
    const playerId = sanitizeOptionalId(rawId);
    if (!isTeamId(team) || !playerId) return;
    store.setPlayerPhoto(team, playerId, undefined);
    persistSquad(team);
  });

  onIpc(IPC.teamSetCoach, (_event, team: unknown, coach: unknown) => {
    if (!isTeamId(team)) return;
    store.setCoach(team, sanitizeText(coach));
    persistSquad(team);
  });

  onIpc(IPC.squadAddPlayer, (_event, team: unknown) => {
    if (!isTeamId(team)) return;
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
  onIpc(IPC.squadUpdatePlayer, (_event, team: unknown, raw: unknown) => {
    if (!isTeamId(team)) return;
    const player = sanitizePlayer(raw);
    if (!player) return;
    // Das Portrait bleibt, wie es im Store steht -- siehe sanitizePlayer().
    updateSquad(
      team,
      store
        .getState()
        .squads[team].map((p) => (p.id === player.id ? { ...player, photoDataUrl: p.photoDataUrl } : p))
    );
  });
  onIpc(
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
  onIpc(IPC.squadRemovePlayer, (_event, team: unknown, rawId: unknown) => {
    const playerId = sanitizeOptionalId(rawId);
    if (!isTeamId(team) || !playerId) return;
    updateSquad(
      team,
      store.getState().squads[team].filter((p) => p.id !== playerId)
    );
  });
  onIpc(IPC.goalSetScorer, (_event, eventId: unknown, scorerId: unknown) => {
    if (!isEventId(eventId)) return;
    store.setGoalScorer(eventId, sanitizeOptionalId(scorerId));
  });
  onIpc(IPC.goalSetPenalty, (_event, eventId: unknown, penalty: unknown) => {
    if (!isEventId(eventId) || typeof penalty !== 'boolean') return;
    store.setGoalPenalty(eventId, penalty);
  });
  onIpc(IPC.goalSetOwnGoal, (_event, eventId: unknown, ownGoal: unknown) => {
    if (!isEventId(eventId) || typeof ownGoal !== 'boolean') return;
    store.setGoalOwnGoal(eventId, ownGoal);
  });
  onIpc(IPC.cardAdd, (_event, team: unknown, card: unknown) => {
    if (!isTeamId(team) || !isCardColor(card)) return;
    store.addCard(team, card);
  });
  onIpc(IPC.cardSetPlayer, (_event, eventId: unknown, playerId: unknown) => {
    if (!isEventId(eventId)) return;
    store.setCardPlayer(eventId, sanitizeOptionalId(playerId));
  });
  onIpc(IPC.subAdd, (_event, team: unknown) => {
    if (!isTeamId(team)) return;
    store.addSubstitution(team);
  });
  onIpc(IPC.subSetPlayers, (_event, eventId: unknown, outId: unknown, inId: unknown) => {
    if (!isEventId(eventId)) return;
    store.setSubstitutionPlayers(eventId, sanitizeOptionalId(outId), sanitizeOptionalId(inId));
  });
  onIpc(IPC.eventRemove, (_event, eventId: unknown) => {
    if (!isEventId(eventId)) return;
    store.removeEvent(eventId);
  });
  onIpc(IPC.setKickoffTime, (_event, value: unknown) => {
    store.setKickoffTime(sanitizeKickoffTime(value));
  });
  onIpc(IPC.setHalfDuration, (_event, minutes: unknown) => {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return;
    store.setHalfDuration(minutes);
    persistTeams();
  });
  onIpc(IPC.setBoardSize, (_event, board: unknown) => {
    store.setBoardSize(sanitizeBoardSize(board));
    persistTeams();
  });
  onIpc(IPC.setAppearance, (_event, appearance: unknown) => {
    store.setAppearance(sanitizeAppearance(appearance));
    persistTeams();
  });
  onIpc(IPC.setCompetition, (_event, fileName: unknown) => {
    store.setCompetition(sanitizeCompetition(fileName));
    persistTeams();
  });
  onIpc(IPC.setSponsorSlot, (_event, slot: unknown, ref: unknown) => {
    const id = sanitizeSponsorSlotId(slot);
    if (id === null) return;
    store.setSponsorSlot(id, sanitizeSponsorRef(ref));
    persistTeams();
  });

  // Phasenwechsel sind die Momente, an denen ein Verlust am meisten weh
  // täte -- hier wird nicht auf das Drosselfenster gewartet.
  onIpc(IPC.phaseKickoff, () => {
    store.kickoff();
    flushLiveMatchSave();
  });
  onIpc(IPC.phaseHalfTime, () => {
    store.goToHalfTime();
    flushLiveMatchSave();
  });
  onIpc(IPC.phaseSecondHalf, () => {
    store.startSecondHalf();
    flushLiveMatchSave();
  });
  onIpc(IPC.phaseFullTime, () => {
    store.goToFullTime();
    flushLiveMatchSave();
  });
  onIpc(IPC.matchReset, () => {
    // Im Steuerungsfenster ist der Knopf in diesen Phasen gesperrt; hier
    // noch einmal, weil ein Gerät im WLAN mit älterem Stand der Seite ihn
    // sonst trotzdem schicken könnte (Review W8).
    const phase = store.getState().phase;
    if (phase === 'live' || phase === 'half-time') return;
    store.resetMatch();
    // Sicherung mitentfernen: Sonst böte der nächste Start an, das gerade
    // bewusst verworfene Spiel fortzusetzen.
    discardLiveMatch();
  });
  onIpc(IPC.phaseRevert, () => {
    store.revertPhase();
    flushLiveMatchSave();
  });

  onIpc(IPC.teamSetName, (_event, team: unknown, name: unknown) => {
    if (!isTeamId(team)) return;
    store.setTeamName(team, sanitizeText(name));
    persistTeams();
  });
  onIpc(IPC.teamSetShortName, (_event, team: unknown, shortName: unknown) => {
    if (!isTeamId(team)) return;
    store.setTeamShortName(team, sanitizeText(shortName, 6));
    persistTeams();
  });
  onIpc(IPC.teamSetRetroName, (_event, team: unknown, retroName: unknown) => {
    if (!isTeamId(team)) return;
    store.setTeamRetroName(team, sanitizeText(retroName, MAX_RETRO_NAME_LENGTH));
    persistTeams();
  });
  onIpc(IPC.teamPickLogo, (_event, team: unknown) => {
    if (!isTeamId(team)) return;
    void pickLogo(team);
  });
  onIpc(IPC.teamClearLogo, (_event, team: unknown) => {
    if (!isTeamId(team)) return;
    store.setTeamLogo(team, undefined);
    persistTeams();
  });

  onIpc(IPC.reopenDisplay, () => openDisplayWindow(ctx.selectedDisplayId));
}
