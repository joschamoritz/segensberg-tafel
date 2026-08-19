/**
 * Beschriftungen der Spielphasen -- für das Steuerungsfenster, für die
 * Anzeigetafel und für die Rückfallebene.
 *
 * Die drei Sätze stehen bewusst nebeneinander in einer Datei, sind aber
 * bewusst NICHT zu einem zusammengefasst: Sie sprechen verschiedene
 * Leser an. Das Steuerungsfenster meldet der bedienenden Person einen
 * Betriebszustand ("1. Halbzeit läuft"), die Anzeigetafel zeigt dem
 * Publikum eine Überschrift -- und im laufenden Spiel gar keine, weil
 * dort Spielstand und Uhr stehen. Beides zu vereinheitlichen hieße,
 * entweder dem Publikum eine Statusmeldung hinzustellen oder der
 * Bedienung ihre Statuszeile zu nehmen.
 *
 * Der Gewinn des gemeinsamen Ortes liegt darin, dass eine neue Phase
 * hier alle drei Stellen sichtbar offen lässt, statt in zwei Dateien
 * unbemerkt auf einen Vorgabewert zu fallen.
 */

import { MatchPhase } from './types';

/**
 * Betriebszustand für das Steuerungsfenster.
 *
 * Nennt die Halbzeit mit, weil "läuft" allein nicht sagt, welche.
 */
export function controlPhaseLabel(phase: MatchPhase, half: 1 | 2): string {
  switch (phase) {
    case 'pre-match':
      return 'Vor Anpfiff';
    case 'live':
      return `${half}. Halbzeit läuft`;
    case 'half-time':
      return 'Halbzeitpause';
    case 'full-time':
      return 'Spiel beendet';
  }
}

/**
 * Großer Text, der auf der Anzeigetafel in der Pause bzw. nach Abpfiff
 * das Uhr-Panel ersetzt. Vor Anpfiff und im laufenden Spiel bleibt er
 * leer -- dort gehört die Fläche dem Spielstand.
 */
export function displayPhaseLabel(phase: MatchPhase): string {
  switch (phase) {
    case 'pre-match':
    case 'live':
      return '';
    case 'half-time':
      return 'HALBZEIT';
    case 'full-time':
      return 'ENDSTAND';
  }
}

/**
 * Beschreibt, wohin `MatchStateStore.revertPhase()` zurückführen würde;
 * `null`, wenn es von hier aus nicht weiter zurückgeht.
 *
 * Diese Beschriftung MUSS zu dem passen, was `revertPhase()` im Store
 * tatsächlich tut -- eine Rückfrage, die etwas anderes ankündigt als
 * dann geschieht, ist im Spielbetrieb schlimmer als gar keine.
 * Abgesichert in `tests/phaseLabels.test.js`, das beide Seiten
 * gegeneinander durchspielt.
 */
export function revertTargetLabel(phase: MatchPhase, half: 1 | 2): string | null {
  switch (phase) {
    case 'full-time':
      return `${half}. Halbzeit`;
    case 'half-time':
      return '1. Halbzeit';
    case 'live':
      return half === 2 ? 'Halbzeitpause' : 'Vor Anpfiff';
    case 'pre-match':
      return null;
  }
}
