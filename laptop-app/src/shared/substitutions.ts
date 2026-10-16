/**
 * Ein- und Auswechslungen.
 *
 * Der Kader selbst wird durch einen Wechsel NICHT verändert. Er liegt pro
 * Verein in `squads.json` und gilt für das nächste Spiel wieder so, wie er
 * eingetragen wurde -- ein Wechsel im Spiel darf die Startelf des
 * nächsten Spieltags nicht umschreiben. Wer gerade auf dem Platz steht,
 * ergibt sich deshalb aus Kader UND Chronik, hier an einer Stelle.
 */
import { MatchEvent, Player, sortPlayersByNumber, SubstitutionEvent, TeamId } from './types';

export interface LineupNow {
  /** wer gerade spielt -- Startelf mit den Wechseln verrechnet */
  onPitch: Player[];
  /** wer noch hereinkommen kann */
  bench: Player[];
  /** wer ausgewechselt wurde */
  substitutedOut: Player[];
}

/**
 * Verrechnet die Wechsel einer Mannschaft mit ihrem Kader.
 *
 * `exceptEventId` lässt einen Wechsel außen vor. Das braucht die Auswahl
 * in der Chronik: Für einen Wechsel stehen die Spieler zur Wahl, die VOR
 * ihm auf dem Platz bzw. auf der Bank waren -- sonst fiele der gerade
 * gewählte Spieler aus seiner eigenen Liste.
 *
 * Unvollständige Wechsel zählen mit dem, was bekannt ist: Ist nur der
 * hereinkommende Spieler eingetragen, spielt er bereits.
 */
export function lineupNow(
  team: TeamId,
  squad: Player[],
  events: MatchEvent[],
  exceptEventId?: number
): LineupNow {
  const onPitch = squad.filter((p) => p.role === 'start');
  const bench = squad.filter((p) => p.role === 'bench');
  const substitutedOut: Player[] = [];

  for (const event of events) {
    if (event.type !== 'sub' || event.team !== team || event.id === exceptEventId) continue;

    if (event.outId) {
      const index = onPitch.findIndex((p) => p.id === event.outId);
      if (index >= 0) substitutedOut.push(...onPitch.splice(index, 1));
    }
    if (event.inId) {
      const index = bench.findIndex((p) => p.id === event.inId);
      if (index >= 0) onPitch.push(...bench.splice(index, 1));
    }
  }

  return {
    onPitch: sortPlayersByNumber(onPitch),
    bench: sortPlayersByNumber(bench),
    substitutedOut: sortPlayersByNumber(substitutedOut),
  };
}

function shortName(player: Player | undefined): string {
  return player ? player.lastName || player.firstName : '';
}

/**
 * Text eines Wechsels für die Tafel. Mit beiden Namen "Lange für Demir"
 * -- so steht es auch in Spielberichten. Fehlt einer, sagt der Text, was
 * bekannt ist; fehlen beide, steht die Mannschaft da (Nutzerwunsch
 * 16.10.2026: "Wechsel der Mannschaft auch ohne Spielernamen").
 */
export function substitutionText(event: SubstitutionEvent, squad: Player[], teamName: string): string {
  const playerIn = shortName(squad.find((p) => p.id === event.inId));
  const playerOut = shortName(squad.find((p) => p.id === event.outId));
  if (playerIn && playerOut) return `${playerIn} für ${playerOut}`;
  if (playerIn) return `${playerIn} kommt`;
  if (playerOut) return `${playerOut} geht`;
  return `Wechsel ${teamName}`;
}

/** Sind beide Spieler eingetragen? Erst dann erscheint der Wechsel von selbst. */
export function isCompleteSubstitution(event: SubstitutionEvent): boolean {
  return Boolean(event.inId && event.outId);
}
