import { lineupNow } from './substitutions';
import { DEFAULT_DURATIONS, LineupStyle, MatchState, Player, sortPlayersByNumber, TeamId } from './types';

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
  | { kind: 'pitch'; ms: number }
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
  // Standzeiten aus dem Zustand -- Anzeige und Store lesen beide hier.
  const durations = state.durations ?? DEFAULT_DURATIONS;
  const pageMs = durations.lineupPage * 1000;
  const playerMs = durations.lineupPlayer * 1000;

  // Spielfeld: nur die Grundordnung, ohne Spieler -- deshalb auch ohne
  // erfassten Kader möglich. Nur für das Heimteam; beim Gast gilt die
  // Übersicht (Nutzerentscheidung 21.10.2026).
  if (style === 'pitch' && team === 'home') {
    return [{ kind: 'pitch', ms: pageMs }];
  }

  if (style === 'single') {
    for (const player of startingOrder(now.onPitch)) {
      steps.push({ kind: 'player', playerId: player.id, ms: playerMs });
    }
    if (coach) steps.push({ kind: 'coach', ms: playerMs });
  } else if (now.onPitch.length > 0 || coach) {
    steps.push({ kind: 'page', page: 'start', ms: pageMs });
  }
  if (now.bench.length > 0) steps.push({ kind: 'page', page: 'bench', ms: pageMs });
  return steps;
}

export function lineupDurationMs(steps: LineupStep[]): number {
  return steps.reduce((sum, step) => sum + step.ms, 0);
}
