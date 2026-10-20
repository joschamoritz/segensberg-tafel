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
  ShootoutKick,
  SlideBlocks,
  SoundCommand,
  SponsorRef,
  SponsorSlotId,
  TeamId,
} from './types';

export interface LibraryPayload {
  teams: LibraryTeam[];
  rootPath: string;
  squadNames: string[];
}

/**
 * Wie eine Nachricht zum Hauptprozess kommt.
 *
 * Im Electron-Fenster ist das die IPC-Brücke (`main/preload.ts`), auf dem
 * iPad im Browser eine Verbindung über das WLAN (`renderer/remote`). Die
 * Liste der Funktionen darüber gibt es nur EINMAL, hier -- eine zweite für
 * das iPad liefe beim nächsten neuen Knopf auseinander, und der Knopf täte
 * auf dem iPad stumm nichts.
 */
export interface Transport {
  send(channel: string, ...args: unknown[]): void;
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
  /** Abonniert einen Kanal; der Rückruf bekommt nur die Nutzdaten. */
  on(channel: string, listener: (...args: any[]) => void): void;
}

/**
 * Die Schnittstelle der Renderer zum Hauptprozess, gebaut auf einem
 * beliebigen Transport.
 */
export function createApi(t: Transport) {
  return {
    onStateUpdated: (callback: (state: MatchState) => void) => {
      t.on(IPC.stateUpdated, (state: MatchState) => callback(state));
    },
    onStatusUpdated: (callback: (status: AppStatus) => void) => {
      t.on(IPC.statusUpdated, (status: AppStatus) => callback(status));
    },
    onClockTick: (callback: (clock: ClockState) => void) => {
      t.on(IPC.clockTick, (clock: ClockState) => callback(clock));
    },
    requestState: () => t.send(IPC.requestState),
    requestStatus: () => t.send(IPC.requestStatus),
    incrementScore: (team: TeamId, delta: number) => t.send(IPC.scoreIncrement, team, delta),
    clockStart: () => t.send(IPC.clockStart),
    clockStop: () => t.send(IPC.clockStop),
    clockReset: () => t.send(IPC.clockReset),
    clockSet: (elapsedMs: number) => t.send(IPC.clockSet, elapsedMs),
    setStoppage: (minutes: number) => t.send(IPC.setStoppage, minutes),
    selectDisplay: (id: number | null) => t.send(IPC.selectDisplay, id),
    reopenDisplay: () => t.send(IPC.reopenDisplay),
    onLibraryUpdated: (callback: (payload: LibraryPayload) => void) => {
      t.on(IPC.libraryUpdated, (payload: LibraryPayload) => callback(payload));
    },
    requestLibrary: () => t.send(IPC.requestLibrary),
    libraryChooseFolder: () => t.send(IPC.libraryChooseFolder),
    libraryPick: (team: TeamId, id: string) => t.send(IPC.libraryPick, team, id),
    squadAddPlayer: (team: TeamId) => t.send(IPC.squadAddPlayer, team),
    squadUpdatePlayer: (team: TeamId, player: Player) =>
      t.send(IPC.squadUpdatePlayer, team, player),
    squadRemovePlayer: (team: TeamId, playerId: string) =>
      t.send(IPC.squadRemovePlayer, team, playerId),
    squadImport: (team: TeamId, entries: Omit<Player, 'id'>[], replace: boolean, coach: string) =>
      t.send(IPC.squadImport, team, entries, replace, coach),
    teamSetCoach: (team: TeamId, coach: string) => t.send(IPC.teamSetCoach, team, coach),
    squadPickFile: (team: TeamId) => t.send(IPC.squadPickFile, team),
    squadLoadByName: (team: TeamId, name: string) =>
      t.send(IPC.squadLoadByName, team, name),
    onSquadFileLoaded: (callback: (team: TeamId, text: string) => void) => {
      t.on(IPC.squadFileLoaded, (team: TeamId, text: string) =>
        callback(team, text)
      );
    },
    showLineup: (team: TeamId) => t.send(IPC.showLineup, team),
    hideLineup: () => t.send(IPC.hideLineup),
    showScorer: (eventId: number) => t.send(IPC.showScorer, eventId),
    hideScorer: () => t.send(IPC.hideScorer),
    playerPickPhoto: (team: TeamId, playerId: string) =>
      t.send(IPC.playerPickPhoto, team, playerId),
    playerClearPhoto: (team: TeamId, playerId: string) =>
      t.send(IPC.playerClearPhoto, team, playerId),
    goalSetScorer: (eventId: number, scorerId: string | undefined) =>
      t.send(IPC.goalSetScorer, eventId, scorerId),
    goalSetOwnGoal: (eventId: number, ownGoal: boolean) =>
      t.send(IPC.goalSetOwnGoal, eventId, ownGoal),
    goalSetPenalty: (eventId: number, penalty: boolean) =>
      t.send(IPC.goalSetPenalty, eventId, penalty),
    cardAdd: (team: TeamId, card: CardColor) => t.send(IPC.cardAdd, team, card),
    cardSetPlayer: (eventId: number, playerId: string | undefined) =>
      t.send(IPC.cardSetPlayer, eventId, playerId),
    subAdd: (team: TeamId) => t.send(IPC.subAdd, team),
    subSetPlayers: (eventId: number, outId: string | undefined, inId: string | undefined) =>
      t.send(IPC.subSetPlayers, eventId, outId, inId),
    eventRemove: (eventId: number) => t.send(IPC.eventRemove, eventId),
    setKickoffTime: (value: string) => t.send(IPC.setKickoffTime, value),
    setHalfDuration: (minutes: number) => t.send(IPC.setHalfDuration, minutes),
    setBoardSize: (board: BoardSize) => t.send(IPC.setBoardSize, board),
    setAppearance: (appearance: DisplayAppearance) =>
      t.send(IPC.setAppearance, appearance),
    setCompetition: (fileName: string | null) => t.send(IPC.setCompetition, fileName),
    setSponsorSlot: (slot: SponsorSlotId, ref: SponsorRef | null) => t.send(IPC.setSponsorSlot, slot, ref),
    phaseKickoff: () => t.send(IPC.phaseKickoff),
    phaseHalfTime: () => t.send(IPC.phaseHalfTime),
    phaseSecondHalf: () => t.send(IPC.phaseSecondHalf),
    phaseFullTime: () => t.send(IPC.phaseFullTime),
    matchReset: () => t.send(IPC.matchReset),
    phaseRevert: () => t.send(IPC.phaseRevert),
    teamSetName: (team: TeamId, name: string) => t.send(IPC.teamSetName, team, name),
    teamSetShortName: (team: TeamId, shortName: string) =>
      t.send(IPC.teamSetShortName, team, shortName),
    teamSetRetroName: (team: TeamId, retroName: string) =>
      t.send(IPC.teamSetRetroName, team, retroName),
    teamPickLogo: (team: TeamId) => t.send(IPC.teamPickLogo, team),
    teamClearLogo: (team: TeamId) => t.send(IPC.teamClearLogo, team),
    showInfo: (overlay: InfoOverlay) => t.send(IPC.showInfo, overlay),
    hideInfo: () => t.send(IPC.hideInfo),
    adjustCorners: (team: TeamId, delta: number) =>
      t.send(IPC.cornerAdjust, team, delta),
    setAttendance: (value: number | null) => t.send(IPC.setAttendance, value),
    setAttendanceMessage: (message: string) =>
      t.send(IPC.setAttendanceMessage, message),
    setAnnouncements: (announcements: string[]) =>
      t.send(IPC.setAnnouncements, announcements),
    setSlideBlocks: (blocks: SlideBlocks) => t.send(IPC.setSlideBlocks, blocks),
    slideshowStart: () => t.send(IPC.slideshowStart),
    shootoutStart: () => t.send(IPC.shootoutStart),
    shootoutKick: (team: TeamId, kick: ShootoutKick) => t.send(IPC.shootoutKick, team, kick),
    shootoutUndo: (team: TeamId) => t.send(IPC.shootoutUndo, team),
    shootoutFinish: () => t.send(IPC.shootoutFinish),
    shootoutCancel: () => t.send(IPC.shootoutCancel),
    slideshowStop: () => t.send(IPC.slideshowStop),
    mediaReload: () => t.send(IPC.mediaReload),
    setSound: (volume: number, muted: boolean) => t.send(IPC.setSound, volume, muted),
    readGoalSound: (fileName: string): Promise<Uint8Array | null> =>
      t.invoke(IPC.soundRead, fileName),
    /** Fassung und Baudatum -- einmal beim Start, siehe `AppInfo` */
    appInfo: (): Promise<AppInfo | null> => t.invoke(IPC.appInfo),
    /**
     * Tormusik am Laptop starten bzw. stoppen. Gebraucht von der
     * Fernsteuerung: Sie läuft auf dem iPad, die Musik soll aber aus den
     * Lautsprechern am Laptop kommen.
     */
    soundCommand: (command: SoundCommand) => t.send(IPC.soundCommand, command),
    onSoundCommand: (callback: (command: SoundCommand) => void) => {
      t.on(IPC.soundCommand, (command: SoundCommand) => callback(command));
    },
    /** Fernsteuerung im WLAN ein- oder ausschalten, siehe `RemoteStatus`. */
    remoteSetEnabled: (enabled: boolean) => t.send(IPC.remoteSetEnabled, enabled),
    /** Neue PIN; verbundene Geräte müssen sie danach neu eingeben. */
    remoteNewPin: () => t.send(IPC.remoteNewPin),
    } as const;
}

export type PreloadApi = ReturnType<typeof createApi>;
