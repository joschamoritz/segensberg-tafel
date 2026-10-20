import { IPC, Player, TeamId } from '../shared/types';
import { saveContentConfig } from './content';
import { ctx, toControl } from './context';
import { saveTeamsConfig, teamsConfigFromState } from './persistence';

/** Persistiert nur die Team-Stammdaten (nicht Spielstand/Uhr), siehe persistence.ts */
export function persistTeams(): void {
  saveTeamsConfig(teamsConfigFromState(ctx.store.getState(), ctx.library.getRootPath()));
}

/** Persistiert die redaktionellen Texte, siehe content.ts */
export function persistContent(): void {
  const state = ctx.store.getState();
  saveContentConfig({
    attendanceMessage: state.attendanceMessage,
    announcements: state.announcements,
    sound: state.sound,
    slideBlocks: state.slideBlocks,
    lineupStyle: state.lineupStyle,
  });
}

/** Speichert Kader und Trainer unter dem aktuellen Vereinsnamen. */
export function persistSquad(team: TeamId): void {
  const state = ctx.store.getState();
  ctx.squads.set(state[team].name, { players: state.squads[team], coach: state[team].coach });
}

export function updateSquad(team: TeamId, players: Player[]): void {
  ctx.store.setSquad(team, players);
  persistSquad(team);
}

export function broadcastLibrary(): void {
  toControl(IPC.libraryUpdated, {
    teams: ctx.library.list(),
    rootPath: ctx.library.getRootPath(),
    squadNames: ctx.squads.listNames(),
  });
}
