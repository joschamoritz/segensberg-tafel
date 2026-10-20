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
  applyLogoPlate(img, teamState.logoVariant);
}

/**
 * Weiße Kontrastfläche hinter einem farbigen Vereinslogo.
 *
 * Farbige Varianten sind für helle Untergründe gezeichnet und
 * verschwinden mit ihren dunklen Linien auf dem blauen Grund der Anzeige.
 * Die Fläche gilt ausdrücklich NUR für Logos: Das Kürzel als
 * Rückfallebene steht in Weiß, es verschwände auf einer weißen Fläche
 * ganz. Und bei unbekannter Variante bleibt es beim Stand von vorher --
 * ohne Fläche.
 */
export function applyLogoPlate(img: HTMLImageElement, variant?: LogoVariant): void {
  img.classList.toggle('has-plate', variant === 'color');
}

/**
 * Beschriftung am Fuß in Halbzeit und Endstand. Nach einem beendeten
 * Elfmeterschießen steht dessen Ergebnis dabei, wie im Spielbericht:
 * „Endstand · 4:3 i. E.“
 */
export function phaseLabelText(state: MatchState): string {
  let label = displayPhaseLabel(state.phase, state.half);
  if (state.phase !== 'full-time') return label;
  // Halbzeitstand wie im Spielbericht: "Endstand (1:1)" (Review N12).
  // Nicht beim Abbruch in der 1. Halbzeit -- da gab es keine Pause.
  if (state.half === 2) {
    const hz = halfTimeScore(state.events, state.halfDurationMin);
    label += ` (${hz.home}:${hz.away})`;
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
