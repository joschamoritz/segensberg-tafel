import { formationSpots } from '../../shared/formations';
import { lineupSteps, LineupStep } from '../../shared/lineupSteps';
import { lineupNow } from '../../shared/substitutions';
import { LINEUP_PAGE_MS, LineupStyle, MatchState, sortPlayersByNumber, TeamId } from '../../shared/types';
import { fitLines, nameVariants, ui } from './common';
import { requestRetroPaint } from './retro';

// Aufstellungsseiten vor dem Anpfiff und ihre Einblendung per Knopf.

let lineupSignature = '';
/** zuletzt ausgeführte Einblendung, damit sie nicht dauernd neu startet */
let lastLineupRequestId = 0;
let lineupTimers: ReturnType<typeof setTimeout>[] = [];
/** Anstoß für die Retro-Matrix zur halben Standzeit, siehe showPage(). */
let retroPageTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Baut eine Aufstellungsseite: Kopfzeile mit Logo und Vereinsname, darunter
 * die Spieler als "Nummer Nachname". Bewusst nur der Nachname -- Namen wie
 * "Muhammed Yusuf Gökceoglu" würden sonst über die Spalte hinauslaufen.
 */
function renderLineupPage(
  prefix: string,
  state: MatchState,
  team: TeamId,
  role: 'start' | 'bench',
  withCoach: boolean
): boolean {
  const teamState = state[team];
  // Nach Wechseln: wer jetzt spielt bzw. noch auf der Bank sitzt. Der
  // Kader selbst bleibt unverändert, siehe shared/substitutions.ts.
  const now = lineupNow(team, state.squads[team], state.events);
  const players = role === 'start' ? now.onPitch : now.bench;

  const logo = document.getElementById(`${prefix}-logo`) as HTMLImageElement;
  if (teamState.logoDataUrl) {
    logo.src = teamState.logoDataUrl;
    logo.hidden = false;
  } else {
    logo.hidden = true;
  }

  document.getElementById(`${prefix}-title`)!.textContent =
    role === 'start' ? teamState.name : `${teamState.shortName} – Bank`;

  const grid = document.getElementById(`${prefix}-grid`)!;
  grid.innerHTML = '';

  const addEntry = (
    number: string,
    name: string,
    badges: string[] = [],
    isCoach = false
  ): void => {
    const entry = document.createElement('div');
    entry.className = isCoach ? 'lineup-entry is-coach' : 'lineup-entry';

    const numberElement = document.createElement('span');
    numberElement.className = 'lineup-number';
    numberElement.textContent = number;

    const nameElement = document.createElement('span');
    nameElement.className = 'lineup-name';
    nameElement.textContent = name;

    entry.append(numberElement, nameElement);

    for (const badge of badges) {
      const badgeElement = document.createElement('span');
      badgeElement.className = 'lineup-badge';
      badgeElement.textContent = badge;
      entry.appendChild(badgeElement);
    }

    grid.appendChild(entry);
  };

  for (const player of sortPlayersByNumber(players)) {
    const badges: string[] = [];
    if (player.isGoalkeeper) badges.push('TW');
    if (player.isCaptain) badges.push('C');

    addEntry(
      player.number === null ? '–' : String(player.number),
      player.lastName || player.firstName || '—',
      badges
    );
  }

  if (withCoach && teamState.coach) {
    addEntry('TR', teamState.coach, [], true);
  }

  // Seiten ohne Inhalt werden in der Rotation übersprungen
  return grid.childElementCount > 0;
}

/** Umriss des leeren Trikots -- derselbe wie beim neutralen Trikot der
    Einzel-Aufstellung. */
const SHIRT_PATH = 'M31 6 L41 3 Q50 11 59 3 L69 6 L95 23 L85 42 L74 35 L74 97 L26 97 L26 35 L15 42 L5 23 Z';
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Spielfeld mit der Grundordnung des Heimteams: leere Trikots an den
 * Plätzen aus `formationSpots()`, ohne Namen und Nummern.
 */
function renderPitchPage(state: MatchState): void {
  const teamState = state.home;
  const logo = document.getElementById('pitch-logo') as HTMLImageElement;
  if (teamState.logoDataUrl) logo.src = teamState.logoDataUrl;
  logo.hidden = !teamState.logoDataUrl;
  document.getElementById('pitch-title')!.textContent = `${teamState.name} · ${state.formation}`;

  const shirts = document.getElementById('pitch-shirts')!;
  shirts.textContent = '';
  for (const spot of formationSpots(state.formation)) {
    // Das Heimtrikot mit Wappen und Trikotsponsor (Nutzerwunsch
    // 21.10.2026, gebaut von scripts/trikot-vorne.py). Fehlt die Datei,
    // steht der weiße Umriss da -- wie beim Rückentrikot der
    // Einzel-Aufstellung.
    const kit = document.createElement('img');
    kit.className = 'pitch-shirt';
    kit.alt = '';
    kit.src = HOME_KIT_FRONT;
    placeShirt(kit, spot);
    kit.addEventListener('error', () => kit.replaceWith(blankShirt(spot)), { once: true });
    shirts.appendChild(kit);
  }
}

/** Vorderseite des Heimtrikots, liegt neben index.html. */
const HOME_KIT_FRONT = 'trikot-heim-vorne.png';

function placeShirt(element: HTMLElement | SVGElement, spot: { x: number; y: number }): void {
  // element.style statt style-Attribut -- die CSP setzt style-src 'self'.
  element.style.left = `${(spot.x * 100).toFixed(2)}%`;
  element.style.top = `${(spot.y * 100).toFixed(2)}%`;
}

/** Weißer Umriss als Rückfall, wenn das Trikotbild fehlt. */
function blankShirt(spot: { x: number; y: number }): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'pitch-shirt');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  placeShirt(svg, spot);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SHIRT_PATH);
  svg.appendChild(path);
  return svg;
}

/** Erzeugt alle Aufstellungsseiten neu. */
export function renderLineupPages(state: MatchState): void {
  // Kader (Spieler) und Teams (Name, Logo, Trainer) -- beides steht auf den
  // Aufstellungsseiten.
  // Die Chronik gehört mit dazu: Ein Wechsel ändert, wer auf der Seite steht.
  // Die Formation gehört dazu: Sie zählt keinen Revisionszähler hoch.
  const signature = `${state.revisions.squads}-${state.revisions.teams}-${state.revisions.events}-${state.formation}`;
  if (lineupSignature === signature) return;
  lineupSignature = signature;

  renderLineupPage('lineup-home', state, 'home', 'start', true);
  renderLineupPage('bench-home', state, 'home', 'bench', false);
  renderLineupPage('lineup-away', state, 'away', 'start', true);
  renderLineupPage('bench-away', state, 'away', 'bench', false);
  renderPitchPage(state);
}

/** Zeigt die Seite mit dem angegebenen Namen, blendet alle anderen aus. */
export function showPage(pageName: string): void {
  for (const page of document.querySelectorAll<HTMLElement>('.pre-page')) {
    page.classList.toggle('is-active', page.dataset.page === pageName);
    // Erst sichtbar hat der Titel ein Layout zum Messen. Ein langer
    // Vereinsname wird kleiner statt abgeschnitten.
    const title = page.dataset.page === pageName ? page.querySelector<HTMLElement>('.lineup-title') : null;
    if (title) fitTitle(title, page);
  }
  // Für die Retro-Matrix, die eine volle Aufstellung zur Hälfte der
  // Standzeit weiterblättert -- dafür braucht sie einen eigenen Anstoß,
  // an dieser Stelle ändert sich sonst nichts.
  ui.activePageSince = Date.now();
  if (retroPageTimer) clearTimeout(retroPageTimer);
  retroPageTimer = setTimeout(requestRetroPaint, LINEUP_PAGE_MS / 2 + 10);
}

/**
 * Passt einen Vereinsnamen in seine Zeile ein -- sofort und noch einmal,
 * sobald Schrift und Bilder der Seite geladen sind. Beim ersten Messen
 * fehlte sonst das Wappen daneben noch (data:-Bilder dekodieren
 * asynchron) oder die Schrift war noch die Ersatzschrift: Der Name passte
 * scheinbar und wurde danach doch abgeschnitten (Probelauf 20.10.2026).
 */
function fitTitle(element: HTMLElement, page: HTMLElement): void {
  const fit = (): void => fitLines(element, [[element.textContent ?? '']]);
  fit();
  for (const img of page.querySelectorAll('img')) {
    if (!img.complete) img.addEventListener('load', fit, { once: true });
  }
  void document.fonts?.ready.then(fit);
}

function clearLineupTimers(): void {
  for (const timer of lineupTimers) clearTimeout(timer);
  lineupTimers = [];
}

/**
 * Füllt die Seite der Einzel-Aufstellung für einen Spieler oder den
 * Trainer. Was gerade dort steht, merkt sich `ui.activeCard` für das
 * Retro-Design, das keine Bilder zeigen kann.
 */
function fillCard(state: MatchState, team: TeamId, step: LineupStep): void {
  const teamState = state[team];
  const photo = document.getElementById('card-photo') as HTMLImageElement;
  const jersey = document.getElementById('card-jersey')!;
  const crest = document.getElementById('card-crest') as HTMLImageElement;
  const name = document.getElementById('card-name')!;
  const label = document.getElementById('card-label')!;

  const teamLogo = document.getElementById('card-team-logo') as HTMLImageElement;
  if (teamState.logoDataUrl) teamLogo.src = teamState.logoDataUrl;
  teamLogo.hidden = !teamState.logoDataUrl;
  document.getElementById('card-team-name')!.textContent = teamState.name;

  photo.hidden = true;
  jersey.hidden = true;
  crest.hidden = true;

  let variants: string[][];
  if (step.kind === 'coach') {
    // Der Trainer hat kein Portrait im Kader -- an der Stelle steht das
    // Wappen seiner Mannschaft.
    if (teamState.logoDataUrl) {
      crest.src = teamState.logoDataUrl;
      crest.hidden = false;
      // Sonst stünde das Wappen zweimal da, groß und klein.
      teamLogo.hidden = true;
    }
    label.textContent = 'TRAINER';
    const parts = teamState.coach.trim().split(/\s+/);
    const last = parts.pop() ?? '';
    variants = nameVariants('', parts.join(' '), last);
    ui.activeCard = { title: 'TRAINER', name: teamState.coach.trim(), detail: teamState.name };
  } else if (step.kind === 'player') {
    const player = state.squads[team].find((p) => p.id === step.playerId);
    if (!player) return;
    const number = player.number === null ? '' : String(player.number);
    if (player.photoDataUrl) {
      photo.src = player.photoDataUrl;
      photo.hidden = false;
      photo.onload = () => fitLines(name, variants);
      // Mit Portrait steht die Nummer vor dem Namen ...
      variants = nameVariants(number, player.firstName, player.lastName);
    } else {
      // ... ohne steht sie auf dem Trikot (Nutzerwunsch 20.10.2026). Das
      // Vereinstrikot nur für die eigene Mannschaft -- ein Gastspieler im
      // SVH-Trikot wäre schlicht falsch.
      photo.onload = null;
      const homeKit = document.getElementById('card-jersey-home') as HTMLImageElement;
      const kitReady = homeKit.complete && homeKit.naturalWidth > 0;
      jersey.classList.toggle('is-home-kit', team === 'home' && kitReady);
      document.getElementById('card-jersey-number')!.textContent = number;
      jersey.hidden = false;
      variants = nameVariants('', player.firstName, player.lastName);
    }
    const roles = [player.isGoalkeeper ? 'TORWART' : 'STARTELF', player.isCaptain ? 'KAPITÄN' : ''];
    label.textContent = roles.filter(Boolean).join(' · ');
    ui.activeCard = {
      title: roles.filter(Boolean).join(' '),
      name: [number, player.firstName, player.lastName].filter(Boolean).join(' '),
      detail: teamState.name,
    };
  } else {
    return;
  }
  // Erst nach `showPage()` hat die Seite ein Layout zum Messen -- deshalb
  // ruft der Ablauf `fitLines` danach noch einmal auf.
  name.textContent = variants[0]?.join(' ') ?? '';
  cardVariants = variants;
}

/** Aufteilungen des Namens auf der aktuellen Karte, für das Einpassen. */
let cardVariants: string[][] = [];

/** Zeigt einen Schritt des Ablaufs. */
function showStep(state: MatchState, team: TeamId, step: LineupStep): void {
  if (step.kind === 'page') {
    ui.activeCard = null;
    showPage(`${step.page === 'start' ? 'lineup' : 'bench'}-${team}`);
    return;
  }
  if (step.kind === 'pitch') {
    ui.activeCard = null;
    showPage('pitch');
    return;
  }
  fillCard(state, team, step);
  showPage('player-card');
  const teamName = document.getElementById('card-team-name')!;
  fitTitle(teamName, document.querySelector<HTMLElement>('.card-page')!);
  fitLines(document.getElementById('card-name')!, cardVariants);
}

/**
 * Spielt die Aufstellung einer Mannschaft ab und kehrt danach zur
 * Begegnung zurück. Der Ablauf kommt aus `lineupSteps()` -- denselben
 * rechnet der Store für das Abräumen. Ausgelöst wird das ausschließlich
 * per Knopf im Steuerungsfenster; die Anzeige rotiert nicht von selbst.
 */
function playLineupSequence(state: MatchState, team: TeamId, style: LineupStyle): void {
  clearLineupTimers();
  const steps = lineupSteps(state, team, style);
  if (steps.length === 0) {
    showPage('matchup');
    return;
  }

  let offset = 0;
  steps.forEach((step, index) => {
    if (index === 0) showStep(state, team, step);
    // Spätere Schritte mit dem dann gültigen Zustand: Ein Portrait, das
    // während des Ablaufs nachgetragen wird, soll schon erscheinen.
    else lineupTimers.push(setTimeout(() => showStep(ui.currentState ?? state, team, step), offset));
    offset += step.ms;
  });
  lineupTimers.push(
    setTimeout(() => {
      ui.activeCard = null;
      showPage('matchup');
    }, offset)
  );
}

/**
 * Reagiert auf die Aufstellungs-Knöpfe. Eine neue Anforderung startet die
 * Einblendung; ein zurückgesetzter Wunsch beendet sie sofort.
 */
export function handleLineupRequest(state: MatchState): void {
  const request = state.lineupRequest;

  if (request === null) {
    if (lastLineupRequestId !== 0) {
      lastLineupRequestId = 0;
      clearLineupTimers();
      ui.activeCard = null;
      showPage('matchup');
    }
    return;
  }

  if (request.id === lastLineupRequestId) return;
  lastLineupRequestId = request.id;
  // Ältere Sicherungen kennen den Ablauf nicht -- dann wie bisher.
  playLineupSequence(state, request.team, request.style ?? 'overview');
}
