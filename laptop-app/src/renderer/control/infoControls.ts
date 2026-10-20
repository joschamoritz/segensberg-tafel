import {
  MatchState,
  SLIDE_BLOCK_IDS,
  SlideBlockId,
  SlideBlocks,
  slideCount,
  slideshowAvailable,
  TeamId,
} from '../../shared/types';
import { updateInputIfNotFocused } from './common';
import { wireShootout } from './shootout';
import { wireSound } from './sound';

// Einblendungen und Spieltagsfunktionen: Aufstellung, Ecken, Zuschauer,
// Diashow und Ankündigungen.

/**
 * Aufstellungs-Knöpfe. Die Einblendung wirkt nur in der Vor-Anpfiff-Ansicht,
 * deshalb sind die Knöpfe danach deaktiviert statt wirkungslos.
 */
export function renderLineupControls(state: MatchState): void {
  const style = document.getElementById('lineup-style') as HTMLSelectElement;
  if (document.activeElement !== style) style.value = state.lineupStyle;
  const formation = document.getElementById('lineup-formation') as HTMLSelectElement;
  if (document.activeElement !== formation) formation.value = state.formation;
  // Die Formation gilt nur für die Spielfeld-Ansicht.
  formation.hidden = state.lineupStyle !== 'pitch';

  const enabled = state.phase === 'pre-match';
  for (const id of ['lineup-show-home', 'lineup-show-away', 'lineup-hide']) {
    (document.getElementById(id) as HTMLButtonElement).disabled = !enabled;
  }

  const hint = document.getElementById('lineup-controls-hint')!;
  if (!enabled) {
    hint.textContent = 'Nur vor dem Anpfiff verfügbar.';
    return;
  }

  // Beim Spielfeld braucht das Heimteam keinen Kader -- es zeigt nur die
  // Formation. Der Gast-Knopf zeigt dann die Übersicht.
  const pitch = state.lineupStyle === 'pitch';
  const missing = (['home', 'away'] as TeamId[]).filter(
    (team) =>
      !(pitch && team === 'home') && state.squads[team].filter((p) => p.role !== 'out').length === 0
  );
  const notes = [
    pitch ? 'Spielfeld nur für Heim – „Gast“ zeigt die Übersicht.' : '',
    missing.length === 0 ? '' : `Kein Kader erfasst für: ${missing.map((team) => state[team].name).join(', ')}`,
  ];
  hint.textContent = notes.filter(Boolean).join(' ');
}

/**
 * Eckenzähler und Zuschauerzahl.
 *
 * Beide erscheinen auf der Tafel nur auf Knopfdruck, nicht dauerhaft: Im
 * laufenden Spiel ist bei 384x192 kein Platz für eine weitere feste
 * Zeile, ohne dem Uhr-Panel etwas wegzunehmen.
 */
export function renderInfoControls(state: MatchState): void {
  for (const team of ['home', 'away'] as TeamId[]) {
    document.getElementById(`${team}-corner-count`)!.textContent = String(
      state.corners[team]
    );
  }

  const input = document.getElementById('attendance-input') as HTMLInputElement;
  updateInputIfNotFocused(input, state.attendance === null ? '' : String(state.attendance));

  const message = document.getElementById('attendance-message-input') as HTMLInputElement;
  updateInputIfNotFocused(message, state.attendanceMessage);

  // Ohne eingetragene Zahl bliebe die Danksagung ohne Inhalt -- dann
  // lieber den Knopf sperren, als dass ein Druck folgenlos bleibt.
  const showAttendance = document.getElementById('info-show-attendance') as HTMLButtonElement;
  showAttendance.disabled = state.attendance === null;

  document.getElementById('info-controls-hint')!.textContent =
    state.attendance === null
      ? 'Zuschauerzahl eintragen, dann einblenden.'
      : 'Ecken als Leiste unten, Zuschauer als Danksagung über das ganze Bild.';
}

/**
 * Diashow-Knöpfe und Ankündigungen.
 *
 * Die Schau läuft in jeder Phase außer dem laufenden Spiel -- dort
 * gehört der Spielstand auf die Tafel. Nach dem Abpfiff läuft sie mit
 * (Nutzerwunsch 20.08.2026): Sie startet ohnehin nur auf Knopfdruck und
 * verdrängt den Endstand also nur, wenn jemand das will. Findet sich
 * kein Motiv, sagt der Hinweis deutlich WO
 * gesucht wurde: Bei der Logo-Bibliothek war ein wortlos leeres Ergebnis
 * der schlechteste Fall.
 */
export function renderSlideshowControls(state: MatchState): void {
  const available = slideshowAvailable(state.phase);
  const running = state.slideshowRequest !== null;

  // Dieselbe Zählung wie in der Anzeige: Sponsoren stehen dort zu viert
  // auf einer Folie, eine eigene Rechnung hier kündigte sonst mehr an.
  const folien = slideCount(state.phase, state.media, state.announcements, state.sponsorSlots, state.slideBlocks);

  const start = document.getElementById('slideshow-start') as HTMLButtonElement;
  const stop = document.getElementById('slideshow-stop') as HTMLButtonElement;

  // Ein laufendes Elfmeterschießen soll nicht hinter Folien verschwinden.
  const shootoutRunning = state.shootout !== null && !state.shootout.finished;
  start.disabled = !available || folien === 0 || shootoutRunning;
  stop.disabled = !running;
  start.classList.toggle('btn-next', available && !running && folien > 0);

  const hint = document.getElementById('slideshow-hint')!;
  const leer = available && folien === 0;
  const anzahl = folien === 1 ? '1 Folie' : folien + ' Folien';

  if (!available) {
    hint.textContent = 'Im laufenden Spiel gehört der Spielstand auf die Tafel.';
  } else if (leer) {
    hint.textContent =
      'Keine Motive gefunden unter "' + vereinsdatenOrdner(state.media.werbung.rootPath) + '".';
  } else if (running) {
    // Die Folge steht ab dem Start fest -- ein geänderter Haken gilt erst
    // beim nächsten Start. Das muss hier stehen, sonst wirkt er kaputt.
    hint.textContent = anzahl + (folien === 1 ? ' läuft' : ' laufen') + ' im Wechsel mit dem Spielstand. Geänderte Haken gelten beim nächsten Start.';
  } else {
    hint.textContent = anzahl + ' bereit.';
  }
  hint.classList.toggle('is-empty', leer);

  for (const id of SLIDE_BLOCK_IDS) {
    const box = document.getElementById(`slide-block-${id}`) as HTMLInputElement;
    box.checked = state.slideBlocks[id];
  }

  const announcements = document.getElementById('announcements-input') as HTMLTextAreaElement;
  updateInputIfNotFocused(announcements, state.announcements.join('\n'));
}

/**
 * Ecken, Zuschauerzahl und deren Einblendungen. Alles ohne Rückfrage --
 * ein Fehlklick ist mit dem Gegenknopf sofort behoben, und am
 * Spielfeldrand muss es schnell gehen.
 */
export function wireInfoControls(): void {
  // Ein Wechsel erscheint sofort im Spielverlauf, die Spieler werden dort
  // gewählt. Auf die Tafel kommt er erst, wenn beide feststehen.
  document.querySelectorAll<HTMLButtonElement>('button[data-sub-team]').forEach((btn) => {
    btn.addEventListener('click', () => window.api.subAdd(btn.dataset.subTeam as TeamId));
  });

  document.querySelectorAll<HTMLButtonElement>('button[data-corner-team]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.api.adjustCorners(btn.dataset.cornerTeam as TeamId, Number(btn.dataset.cornerDelta));
    });
  });

  const input = document.getElementById('attendance-input') as HTMLInputElement;
  input.addEventListener('change', () => {
    // Leeres Feld bedeutet "keine Angabe" -- die Prüfschicht im
    // Hauptprozess macht daraus null, statt NaN durchzureichen.
    window.api.setAttendance(input.value === '' ? null : Number(input.value));
  });

  const message = document.getElementById('attendance-message-input') as HTMLInputElement;
  message.addEventListener('change', () => {
    window.api.setAttendanceMessage(message.value);
    // Fokus abgeben, damit der zurückgemeldete Wert (ggf. der
    // Standardtext nach leerer Eingabe) das Feld wieder pflegen darf.
    message.blur();
  });

  const announcements = document.getElementById('announcements-input') as HTMLTextAreaElement;
  announcements.addEventListener('change', () => {
    // Eine Zeile je Ankündigung. Leere Zeilen filtert die Prüfschicht im
    // Hauptprozess heraus, damit ein Absatz keine leere Folienzeile ergibt.
    window.api.setAnnouncements(announcements.value.split('\n'));
    announcements.blur();
  });

  wireSound();

  wireShootout();

  // Alle Haken gehen zusammen raus -- der Zustand kennt nur die ganze Auswahl.
  const blockBoxes = document.querySelectorAll<HTMLInputElement>('input[data-slide-block]');
  blockBoxes.forEach((box) => {
    box.addEventListener('change', () => {
      const blocks = {} as SlideBlocks;
      blockBoxes.forEach((b) => (blocks[b.dataset.slideBlock as SlideBlockId] = b.checked));
      window.api.setSlideBlocks(blocks);
    });
  });

  document
    .getElementById('slideshow-start')!
    .addEventListener('click', () => window.api.slideshowStart());
  document
    .getElementById('slideshow-stop')!
    .addEventListener('click', () => window.api.slideshowStop());
  document
    .getElementById('media-reload')!
    .addEventListener('click', () => window.api.mediaReload());

  document
    .getElementById('info-show-corners')!
    .addEventListener('click', () => window.api.showInfo({ kind: 'corners' }));
  document
    .getElementById('info-show-attendance')!
    .addEventListener('click', () => window.api.showInfo({ kind: 'attendance' }));
}

/**
 * Der gemeinsame Ordner aller Diashow-Motive (`Vereinsdaten`). Seit es
 * Hauptsponsor, Partner und Historie gibt, wäre der Pfad nur des
 * Werbeordners ein falscher Hinweis darauf, wo gesucht wurde.
 */
function vereinsdatenOrdner(werbungPath: string): string {
  return werbungPath.replace(/[\\/][^\\/]+[\\/]?$/, '') || werbungPath;
}
