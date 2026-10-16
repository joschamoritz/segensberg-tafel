import { contextBridge, ipcRenderer } from 'electron';
import {
  AppInfo,
  AppStatus,
  BoardSize,
  DisplayAppearance,
  CardColor,
  ClockState,
  InfoOverlay,
  IPC,
  LibraryTeam,
  MatchState,
  Player,
  TeamId,
} from '../shared/types';

export interface LibraryPayload {
  teams: LibraryTeam[];
  rootPath: string;
  squadNames: string[];
}

/**
 * Gemeinsames Preload-Script für Control- und Display-Fenster. Nur die hier
 * explizit freigegebenen Funktionen sind aus dem Renderer erreichbar
 * (contextIsolation aktiv, kein nodeIntegration) -- Sicherheitsstandard für
 * Electron-Apps, die HTML/CSS/JS-Inhalte rendern.
 */
const api = {
  onStateUpdated: (callback: (state: MatchState) => void) => {
    ipcRenderer.on(IPC.stateUpdated, (_event, state: MatchState) => callback(state));
  },
  onStatusUpdated: (callback: (status: AppStatus) => void) => {
    ipcRenderer.on(IPC.statusUpdated, (_event, status: AppStatus) => callback(status));
  },
  onClockTick: (callback: (clock: ClockState) => void) => {
    ipcRenderer.on(IPC.clockTick, (_event, clock: ClockState) => callback(clock));
  },
  requestState: () => ipcRenderer.send(IPC.requestState),
  requestStatus: () => ipcRenderer.send(IPC.requestStatus),
  incrementScore: (team: TeamId, delta: number) => ipcRenderer.send(IPC.scoreIncrement, team, delta),
  clockStart: () => ipcRenderer.send(IPC.clockStart),
  clockStop: () => ipcRenderer.send(IPC.clockStop),
  clockReset: () => ipcRenderer.send(IPC.clockReset),
  clockSet: (elapsedMs: number) => ipcRenderer.send(IPC.clockSet, elapsedMs),
  setStoppage: (minutes: number) => ipcRenderer.send(IPC.setStoppage, minutes),
  selectDisplay: (id: number | null) => ipcRenderer.send(IPC.selectDisplay, id),
  reopenDisplay: () => ipcRenderer.send(IPC.reopenDisplay),
  onLibraryUpdated: (callback: (payload: LibraryPayload) => void) => {
    ipcRenderer.on(IPC.libraryUpdated, (_event, payload: LibraryPayload) => callback(payload));
  },
  requestLibrary: () => ipcRenderer.send(IPC.requestLibrary),
  libraryChooseFolder: () => ipcRenderer.send(IPC.libraryChooseFolder),
  libraryPick: (team: TeamId, id: string) => ipcRenderer.send(IPC.libraryPick, team, id),
  squadAddPlayer: (team: TeamId) => ipcRenderer.send(IPC.squadAddPlayer, team),
  squadUpdatePlayer: (team: TeamId, player: Player) =>
    ipcRenderer.send(IPC.squadUpdatePlayer, team, player),
  squadRemovePlayer: (team: TeamId, playerId: string) =>
    ipcRenderer.send(IPC.squadRemovePlayer, team, playerId),
  squadImport: (team: TeamId, entries: Omit<Player, 'id'>[], replace: boolean, coach: string) =>
    ipcRenderer.send(IPC.squadImport, team, entries, replace, coach),
  teamSetCoach: (team: TeamId, coach: string) => ipcRenderer.send(IPC.teamSetCoach, team, coach),
  squadPickFile: (team: TeamId) => ipcRenderer.send(IPC.squadPickFile, team),
  squadLoadByName: (team: TeamId, name: string) =>
    ipcRenderer.send(IPC.squadLoadByName, team, name),
  onSquadFileLoaded: (callback: (team: TeamId, text: string) => void) => {
    ipcRenderer.on(IPC.squadFileLoaded, (_event, team: TeamId, text: string) =>
      callback(team, text)
    );
  },
  showLineup: (team: TeamId) => ipcRenderer.send(IPC.showLineup, team),
  hideLineup: () => ipcRenderer.send(IPC.hideLineup),
  showScorer: (eventId: number) => ipcRenderer.send(IPC.showScorer, eventId),
  hideScorer: () => ipcRenderer.send(IPC.hideScorer),
  playerPickPhoto: (team: TeamId, playerId: string) =>
    ipcRenderer.send(IPC.playerPickPhoto, team, playerId),
  playerClearPhoto: (team: TeamId, playerId: string) =>
    ipcRenderer.send(IPC.playerClearPhoto, team, playerId),
  goalSetScorer: (eventId: number, scorerId: string | undefined) =>
    ipcRenderer.send(IPC.goalSetScorer, eventId, scorerId),
  cardAdd: (team: TeamId, card: CardColor) => ipcRenderer.send(IPC.cardAdd, team, card),
  cardSetPlayer: (eventId: number, playerId: string | undefined) =>
    ipcRenderer.send(IPC.cardSetPlayer, eventId, playerId),
  eventRemove: (eventId: number) => ipcRenderer.send(IPC.eventRemove, eventId),
  setKickoffTime: (value: string) => ipcRenderer.send(IPC.setKickoffTime, value),
  setHalfDuration: (minutes: number) => ipcRenderer.send(IPC.setHalfDuration, minutes),
  setBoardSize: (board: BoardSize) => ipcRenderer.send(IPC.setBoardSize, board),
  setAppearance: (appearance: DisplayAppearance) =>
    ipcRenderer.send(IPC.setAppearance, appearance),
  phaseKickoff: () => ipcRenderer.send(IPC.phaseKickoff),
  phaseHalfTime: () => ipcRenderer.send(IPC.phaseHalfTime),
  phaseSecondHalf: () => ipcRenderer.send(IPC.phaseSecondHalf),
  phaseFullTime: () => ipcRenderer.send(IPC.phaseFullTime),
  matchReset: () => ipcRenderer.send(IPC.matchReset),
  phaseRevert: () => ipcRenderer.send(IPC.phaseRevert),
  teamSetName: (team: TeamId, name: string) => ipcRenderer.send(IPC.teamSetName, team, name),
  teamSetShortName: (team: TeamId, shortName: string) =>
    ipcRenderer.send(IPC.teamSetShortName, team, shortName),
  teamSetRetroName: (team: TeamId, retroName: string) =>
    ipcRenderer.send(IPC.teamSetRetroName, team, retroName),
  teamPickLogo: (team: TeamId) => ipcRenderer.send(IPC.teamPickLogo, team),
  teamClearLogo: (team: TeamId) => ipcRenderer.send(IPC.teamClearLogo, team),
  showInfo: (overlay: InfoOverlay) => ipcRenderer.send(IPC.showInfo, overlay),
  hideInfo: () => ipcRenderer.send(IPC.hideInfo),
  adjustCorners: (team: TeamId, delta: number) =>
    ipcRenderer.send(IPC.cornerAdjust, team, delta),
  setAttendance: (value: number | null) => ipcRenderer.send(IPC.setAttendance, value),
  setAttendanceMessage: (message: string) =>
    ipcRenderer.send(IPC.setAttendanceMessage, message),
  setAnnouncements: (announcements: string[]) =>
    ipcRenderer.send(IPC.setAnnouncements, announcements),
  slideshowStart: () => ipcRenderer.send(IPC.slideshowStart),
  slideshowStop: () => ipcRenderer.send(IPC.slideshowStop),
  mediaReload: () => ipcRenderer.send(IPC.mediaReload),
  setSound: (volume: number, muted: boolean) => ipcRenderer.send(IPC.setSound, volume, muted),
  readGoalSound: (fileName: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke(IPC.soundRead, fileName),
  /** Fassung und Baudatum -- einmal beim Start, siehe `AppInfo` */
  appInfo: (): Promise<AppInfo | null> => ipcRenderer.invoke(IPC.appInfo),
} as const;

contextBridge.exposeInMainWorld('api', api);

/**
 * Typ der freigegebenen Schnittstelle -- abgeleitet statt von Hand
 * gepflegt.
 *
 * Vorher stand in `renderer/window.d.ts` eine handgeschriebene Zweitschrift
 * dieser Liste. Eine geänderte Signatur fiel damit erst zur Laufzeit auf:
 * Der Renderer kompilierte gegen die Zweitschrift, aufgerufen wurde aber
 * das hier. Jetzt ist diese Datei die einzige Quelle.
 */
export type PreloadApi = typeof api;
