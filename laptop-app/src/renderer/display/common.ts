import { displayPhaseLabel } from '../../shared/phaseLabels';
import { halfTimeScore } from '../../shared/scorerRows';
import {
  BoardSize,
  ClockState,
  DEFAULT_BOARD_SIZE,
  GoalEvent,
  InfoOverlay,
  LogoVariant,
  MatchState,
  shootoutScore,
  SlidePlanItem,
  SponsorLogo,
} from '../../shared/types';

// Was mehrere Teile der Anzeige gemeinsam brauchen. Die Module der Anzeige
// (siehe display.ts) lesen und schreiben den Zustand hier, statt einander
// zu importieren -- so bleibt der Aufbau frei von Zyklen.

/**
 * Eine Station der Diashow. `base` ist die normale Ansicht (Begegnung
 * bzw. Zwischenstand) -- sie rotiert bewusst mit, damit der Spielstand
 * nie länger als einen Schritt weg ist.
 */
export type Slide = { kind: 'base' } | SlidePlanItem;

export const ui: {
  currentState: MatchState | null;
  boardSize: BoardSize;
  lastClock: ClockState;
  activeInfoOverlay: InfoOverlay | null;
  activeScorerEventId: number | null;
  activeSlide: Slide | null;
  activePageSince: number;
  /** Was die Einzel-Aufstellung gerade zeigt; gelesen vom Retro-Design. */
  activeCard: { title: string; name: string; detail: string } | null;
} = {
  /** Zuletzt empfangener Zustand; `null` bis zum ersten. */
  currentState: null,
  /**
   * Maße der Bühne, also der Fläche, in der das Layout gerechnet wird.
   *
   * Kommen aus den Einstellungen (`MatchState.board`). Bis der erste Zustand
   * eintrifft, gilt die Herstellerangabe -- so steht auch in der ersten
   * Sekunde nach dem Öffnen etwas im richtigen Format da.
   */
  boardSize: { ...DEFAULT_BOARD_SIZE },
  lastClock: { elapsedMs: 0, running: false },
  /** Was die Einblendungen gerade zeigen; gesetzt in ihren Handlern, gelesen vom Retro-Design. */
  activeInfoOverlay: null,
  activeScorerEventId: null,
  activeSlide: null,
  /** Seit wann die aktuelle Seite vor dem Anpfiff steht, siehe `showPage()`. */
  activePageSince: 0,
  activeCard: null,
};

/**
 * Führt einen Renderschritt aus und fängt Fehler ab.
 *
 * Hintergrund: Ein einziger fehlgeschlagener Zugriff (etwa auf ein aus dem
 * HTML entferntes Element) hat schon einmal die gesamte Funktion abgebrochen
 * -- und damit auch Torjubel, Aufstellungen und Torschützen-Einblendung
 * lahmgelegt, weil die danach kamen. Jeder Abschnitt läuft deshalb
 * unabhängig.
 */
export function step(name: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(`Anzeige: Schritt "${name}" fehlgeschlagen`, error);
  }
}

/**
 * Passt einen Namen in sein Element ein. `variants` sind mögliche
 * Zeilenaufteilungen, etwa `[["24 David Meyer"], ["24 David", "Meyer"]]`.
 * Jede wird so lange verkleinert, bis jede Zeile in die Breite passt (bis
 * zur Hälfte der Größe aus dem Stylesheet); es gewinnt die mit der
 * größten Schrift, bei Gleichstand die mit weniger Zeilen.
 *
 * Feste Umbruchstellen statt freiem Umbruch: Frei umbrochen landete
 * „Schöneberg-" am Zeilenende und „Krüger" darunter, und ein dreiteiliger
 * Name schrumpfte auf eine kleine Zeile. Bis 1.8.0 stand der Name in der
 * Torschützen-Einblendung einzeilig mit fester Größe und wurde neben dem
 * Portrait einfach abgeschnitten.
 *
 * Misst am Layout, also nur bei sichtbarem Element -- in jsdom und bei
 * ausgeblendeter Fläche ist `clientWidth` 0, dann bleibt die erste
 * Aufteilung in der Größe aus dem Stylesheet stehen. Gesetzt wird
 * `element.style`; das fällt nicht unter die CSP (`style-src 'self'`
 * betrifft nur Attribute und Style-Blöcke).
 */
const LINE_BREAK = '\n';

export function fitLines(element: HTMLElement, variants: string[][]): void {
  const usable = variants.filter((lines) => lines.length > 0);
  if (usable.length === 0) return;
  element.style.fontSize = '';
  element.textContent = usable[0].join(LINE_BREAK);
  if (element.clientWidth === 0) return;
  const base = parseFloat(getComputedStyle(element).fontSize);
  if (!base) return;

  let best = { size: 0, text: element.textContent };
  for (const lines of usable) {
    element.textContent = lines.join(LINE_BREAK);
    let size = base;
    element.style.fontSize = '';
    while (element.scrollWidth > element.clientWidth + 1 && size > base * 0.5) {
      size *= 0.94;
      element.style.fontSize = `${size}px`;
    }
    if (size > best.size + 0.5) best = { size, text: element.textContent };
  }
  element.textContent = best.text;
  element.style.fontSize = best.size < base ? `${best.size}px` : '';
}

/** Übliche Aufteilungen eines Spielernamens: eine Zeile, oder Nummer und
    Vorname über dem Nachnamen. */
export function nameVariants(number: string, firstName: string, lastName: string): string[][] {
  const head = [number, firstName].filter(Boolean).join(' ');
  const one = [head, lastName].filter(Boolean).join(' ');
  return head && lastName ? [[one], [head, lastName]] : [[one]];
}

/**
 * Schreibt Text so, dass jede Ziffer eine eigene Zelle fester Breite
 * bekommt. Oswald hat keine dicktengleichen Ziffern -- ohne das würden
 * Uhr-Panel, Wappen und Spielstand bei jedem Ziffernwechsel springen.
 */
export function renderDigits(element: HTMLElement, text: string): void {
  element.textContent = '';
  for (const char of text) {
    const cell = document.createElement('span');
    cell.className = /\d/.test(char) ? 'digit' : 'digit-sep';
    cell.textContent = char;
    element.appendChild(cell);
  }
}

/**
 * Zeigt das Vereinswappen. Nur wenn kein Logo hinterlegt ist, wird das
 * Kürzel als Rückfallebene eingeblendet -- so bleibt die Tafel auch bei
 * einem Gegner ohne Logodatei benutzbar.
 */
export function renderCrest(
  logoId: string,
  fallbackId: string,
  teamState: { shortName: string; logoDataUrl?: string; logoVariant?: LogoVariant }
): void {
  const img = document.getElementById(logoId) as HTMLImageElement;
  const fallback = document.getElementById(fallbackId)!;

  fallback.textContent = teamState.shortName;

  if (teamState.logoDataUrl) {
    img.src = teamState.logoDataUrl;
    img.hidden = false;
    fallback.hidden = true;
  } else {
    img.hidden = true;
    fallback.hidden = false;
  }
}


/**
 * Beschriftung am Fuß in Halbzeit und Endstand. Nach einem beendeten
 * Elfmeterschießen steht dessen Ergebnis dabei, wie im Spielbericht:
 * „Endstand · 4:3 i. E.“
 */
export function phaseLabelText(state: MatchState): string {
  let label = displayPhaseLabel(state.phase, state.half);
  if (state.phase !== 'full-time') return label;
  // Halbzeitstand (Review N12), ausdrücklich als "HZ" bezeichnet. Die
  // Klammer des Spielberichts "(1:1)" wurde im Probelauf als Endstand
  // gelesen -- auf der Tafel fehlt der Zusammenhang, den der Bericht hat.
  // Nicht beim Abbruch in der 1. Halbzeit -- da gab es keine Pause.
  if (state.half === 2) {
    const hz = halfTimeScore(state.events, state.halfDurationMin);
    label += ` · HZ ${hz.home}:${hz.away}`;
  }
  if (state.shootout?.finished) {
    const score = shootoutScore(state.shootout);
    label += ` · ${score.home}:${score.away} i. E.`;
  }
  return label;
}

/** Überschrift der Torschützen-Einblendung: Tor, Eigentor oder Strafstoß. */
export function goalTitle(goal: GoalEvent): string {
  if (goal.ownGoal) return 'EIGENTOR';
  if (goal.penalty) return 'TOR (FE)';
  return 'TOR';
}

/**
 * Füllt einen „präsentiert von"-Platz. Ohne Logo wird der ganze Behälter
 * ausgeblendet -- samt Schriftzug, ein „präsentiert von" ins Leere wäre
 * schlimmer als nichts. Das `src` wird nur bei einem Wechsel gesetzt,
 * sonst lüde das Bild bei jedem Zustands-Update neu.
 *
 * Eine weiße Fassung steht ohne Kachel direkt auf dem Grund (`is-white`).
 */
export function fillSponsorChip(container: HTMLElement, logo: SponsorLogo | null): void {
  container.hidden = logo === null;
  const chip = container.classList.contains('sponsor-chip')
    ? container
    : container.querySelector<HTMLElement>('.sponsor-chip')!;
  chip.classList.toggle('is-white', logo?.white === true);
  const img = container.querySelector('img')!;
  if (logo === null) img.removeAttribute('src');
  else if (img.getAttribute('src') !== logo.url) img.src = logo.url;
}
