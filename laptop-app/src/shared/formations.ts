// --------------------------------------------------------------------
// Formationen für die Aufstellung auf dem Spielfeld
// --------------------------------------------------------------------
//
// Nur das Heimteam, nur die Grundordnung mit leeren Trikots -- ohne
// Spieler, Nummern oder Namen (Nutzerentscheidung 21.10.2026). Die
// Positionen rechnet `formationSpots()` an EINER Stelle: Die Anzeige
// setzt danach die Trikots, das Retro-Design die Punkte, und die Tests
// prüfen dieselbe Rechnung.

/**
 * Reihen von hinten nach vorn, ohne Torwart. "4-2-3-1" ist also vier
 * Verteidiger, zwei defensive Mittelfeldspieler, drei offensive, eine
 * Spitze. Die Raute braucht eine eigene Reihenfolge (4-1-2-1-2), weil
 * ihr Mittelfeld in drei Linien steht.
 */
export const FORMATIONS = {
  '4-4-2': [4, 4, 2],
  '4-4-2 Raute': [4, 1, 2, 1, 2],
  '4-3-3': [4, 3, 3],
  '4-2-3-1': [4, 2, 3, 1],
  '4-1-4-1': [4, 1, 4, 1],
  '4-5-1': [4, 5, 1],
  '3-5-2': [3, 5, 2],
  '3-4-3': [3, 4, 3],
  '5-3-2': [5, 3, 2],
  '5-4-1': [5, 4, 1],
} as const satisfies Record<string, readonly number[]>;

export type Formation = keyof typeof FORMATIONS;

export const FORMATION_IDS = Object.keys(FORMATIONS) as Formation[];

export const DEFAULT_FORMATION: Formation = '4-4-2';

export function isFormation(value: unknown): value is Formation {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FORMATIONS, value);
}

/**
 * Ein Platz auf dem Feld, als Anteil: `x` von der eigenen Torlinie (0)
 * bis zur gegnerischen (1), `y` vom oberen Rand (0) bis zum unteren (1).
 * Die Mannschaft spielt von links nach rechts.
 */
export interface PitchSpot {
  x: number;
  y: number;
}

/** Torwart vor der eigenen Torlinie. */
const KEEPER_X = 0.06;
/** Erste und letzte Feldspielerreihe -- die Spitze bleibt vor dem Strafraum. */
const FIRST_ROW_X = 0.22;
const LAST_ROW_X = 0.84;

/**
 * Elf Plätze: Torwart zuerst, dann die Reihen von hinten nach vorn, in
 * jeder Reihe von oben nach unten. Die Reihen liegen gleichmäßig zwischen
 * Abwehr und Spitze; in einer Reihe verteilen sich die Spieler gleichmäßig
 * über die Breite, ohne an den Rand zu stoßen.
 */
export function formationSpots(formation: Formation): PitchSpot[] {
  const rows: readonly number[] = FORMATIONS[formation];
  const spots: PitchSpot[] = [{ x: KEEPER_X, y: 0.5 }];
  rows.forEach((count, row) => {
    const x =
      rows.length === 1 ? (FIRST_ROW_X + LAST_ROW_X) / 2 : FIRST_ROW_X + (row * (LAST_ROW_X - FIRST_ROW_X)) / (rows.length - 1);
    for (let i = 0; i < count; i++) spots.push({ x, y: (i + 1) / (count + 1) });
  });
  return spots;
}
