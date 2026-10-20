import { formatEventMinute, MatchEvent, Player, TeamId } from './types';

/**
 * Eine Zeile der Torschützenliste unter dem Wappen.
 *
 * Die Liste zeigt Tore und Platzverweise. Gelbe Karten bleiben bewusst
 * draußen -- sonst wäre sie im Nu voll und der Blick auf die Tore ginge
 * verloren.
 */
export interface ScorerRow {
  /** fertig formatierte Minuten ("23'", "45+2'") */
  minutes: string[];
  name: string;
  card?: 'red' | 'yellow-red';
}

/**
 * Baut die Zeilen einer Mannschaft in zeitlicher Reihenfolge.
 *
 * Bewusst hier statt im Renderer: Die Zusammenfassung von
 * Mehrfachtorschützen hat eine Falle, die sich ohne Test nur schwer
 * absichern lässt (siehe unten), und der Renderer kann sie mangels DOM
 * nicht mitprüfen.
 */
export function buildScorerRows(
  team: TeamId,
  events: MatchEvent[],
  squad: Player[],
  /** Kader des Gegners -- daraus stammt der Schütze eines Eigentors. */
  opponentSquad: Player[] = []
): ScorerRow[] {
  const rows: ScorerRow[] = [];
  /** Mehrfachtorschützen zusammenfassen: "Müller 23', 67'" statt zwei Zeilen. */
  const byScorer = new Map<string, ScorerRow>();

  for (const event of events) {
    if (event.team !== team) continue;

    const isSendOff =
      event.type === 'card' && (event.card === 'red' || event.card === 'yellow-red');
    if (event.type !== 'goal' && !isSendOff) continue;

    const ownGoal = event.type === 'goal' && event.ownGoal === true;
    const playerId = event.type === 'goal' ? event.scorerId : event.playerId;
    const player = playerId ? (ownGoal ? opponentSquad : squad).find((p) => p.id === playerId) : undefined;
    const plainName = player ? player.lastName || player.firstName : '';
    // Wie im Spielbericht: "Kowalski (ET)". Ohne Namen bleibt das Wort
    // stehen -- sonst sähe ein Eigentor aus wie ein eigenes Tor ohne Schützen.
    const name = ownGoal ? (plainName ? `${plainName} (ET)` : 'Eigentor') : plainName;

    if (event.type === 'goal' && playerId) {
      // Eigentore eines Spielers nicht mit Toren zusammenfassen -- die Ids
      // stammen aus zwei Kadern.
      const key = ownGoal ? `et:${playerId}` : playerId;
      const existing = byScorer.get(key);
      if (existing) {
        existing.minutes.push(formatEventMinute(event));
        // Die Zeile ist jetzt so jung wie ihr letztes Tor und muss ans
        // Ende wandern. Sonst fiele ein Spieler, der in der 5. und in der
        // 80. Minute trifft, beim Abschneiden oben heraus -- obwohl sein
        // letztes Tor das jüngste Ereignis der Liste ist.
        rows.splice(rows.indexOf(existing), 1);
        rows.push(existing);
        continue;
      }
      const row: ScorerRow = { minutes: [formatEventMinute(event)], name };
      byScorer.set(key, row);
      rows.push(row);
      continue;
    }

    if (event.type === 'card') {
      rows.push({
        minutes: [formatEventMinute(event)],
        name,
        card: event.card as 'red' | 'yellow-red',
      });
      continue;
    }

    // Tor ohne zugeordneten Schützen -- bekommt eine eigene Zeile, weil
    // es sich mangels Id mit keiner anderen zusammenfassen lässt.
    rows.push({ minutes: [formatEventMinute(event)], name });
  }

  return rows;
}

/**
 * Schneidet die Liste auf die Zeilen zu, die auf die Tafel passen.
 *
 * Es bleiben die JÜNGSTEN Einträge stehen, die ältesten fallen heraus --
 * am Spielfeldrand interessiert, was gerade passiert ist. Einen Hinweis
 * "+N weitere" gibt es bewusst nicht: Er kostete eine Zeile, die besser
 * ein echtes Tor trägt.
 */
export function visibleScorerRows(rows: ScorerRow[], maxRows: number): ScorerRow[] {
  return maxRows <= 0 ? [] : rows.slice(-maxRows);
}
