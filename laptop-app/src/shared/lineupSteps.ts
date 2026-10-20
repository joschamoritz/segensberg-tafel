import { lineupNow } from './substitutions';
import { LINEUP_PAGE_MS, LineupStyle, MatchState, Player, sortPlayersByNumber, TeamId } from './types';

// --------------------------------------------------------------------
// Ablauf einer Aufstellungs-Einblendung
// --------------------------------------------------------------------
//
// An EINER Stelle, weil zwei Seiten ihn brauchen: Die Anzeige spielt ihn
// ab, der Store räumt die Anfrage nach seiner Gesamtdauer wieder ab.
// Rechneten beide getrennt, liefe die Einblendung in der Einzel-Fassung
// irgendwann über ihr Abräumen hinaus oder bräche vorher ab -- dieselbe
// Überlegung wie bei `buildSlidePlan()`.

/** Standzeit eines einzelnen Spielers bzw. des Trainers (Nutzerwahl: 4 s). */
export const LINEUP_PLAYER_MS = 4000;

export type LineupStep =
  | { kind: 'page'; page: 'start' | 'bench'; ms: number }
  | { kind: 'player'; playerId: string; ms: number }
  | { kind: 'coach'; ms: number };

/**
 * Reihenfolge der Startelf wie bei der Stadiondurchsage: erst der
 * Torwart, dann nach Rückennummer. Spieler ohne Nummer zuletzt.
 */
export function startingOrder(players: Player[]): Player[] {
  const sorted = sortPlayersByNumber(players);
  return [...sorted.filter((p) => p.isGoalkeeper), ...sorted.filter((p) => !p.isGoalkeeper)];
}

export function lineupSteps(state: MatchState, team: TeamId, style: LineupStyle): LineupStep[] {
  // Nach Wechseln: wer jetzt spielt bzw. noch auf der Bank sitzt.
  const now = lineupNow(team, state.squads[team], state.events);
  const coach = state[team].coach.trim() !== '';
  const steps: LineupStep[] = [];

  if (style === 'single') {
    for (const player of startingOrder(now.onPitch)) {
      steps.push({ kind: 'player', playerId: player.id, ms: LINEUP_PLAYER_MS });
    }
    if (coach) steps.push({ kind: 'coach', ms: LINEUP_PLAYER_MS });
  } else if (now.onPitch.length > 0 || coach) {
    steps.push({ kind: 'page', page: 'start', ms: LINEUP_PAGE_MS });
  }
  if (now.bench.length > 0) steps.push({ kind: 'page', page: 'bench', ms: LINEUP_PAGE_MS });
  return steps;
}

export function lineupDurationMs(steps: LineupStep[]): number {
  return steps.reduce((sum, step) => sum + step.ms, 0);
}
