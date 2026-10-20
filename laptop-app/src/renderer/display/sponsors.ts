import { MatchState, sponsorSlotLogo } from '../../shared/types';
import { fillSponsorChip } from './common';

// „Präsentiert von"-Plätze auf Begegnung, Aufstellung und Torjubel. Die
// Halbzeit-Folie läuft über die Diashow (`buildSlidePlan`), der
// Ecken-Sponsor über die Info-Leiste (overlays.ts) -- beide nur, wenn sie
// gerade an der Reihe sind.
//
// Die Plätze werden bei jedem Zustand gefüllt, nicht erst, wenn ihre
// Ansicht erscheint: Die Behälter sind ohnehin nur in ihrer Ansicht zu
// sehen (display.css), und so steht beim Torjubel das Logo schon da,
// statt in der ersten Sekunde nachzuladen.

export function renderSponsorSlots(state: MatchState): void {
  const logo = (slot: Parameters<typeof sponsorSlotLogo>[2]) =>
    sponsorSlotLogo(state.sponsorSlots, state.media, slot);

  fillSponsorChip(document.getElementById('pre-sponsor')!, logo('matchday'));
  fillSponsorChip(document.getElementById('goal-sponsor')!, logo('goal'));

  const lineup = logo('lineup');
  document.querySelectorAll<HTMLElement>('.lineup-sponsor').forEach((chip) => fillSponsorChip(chip, lineup));
}
