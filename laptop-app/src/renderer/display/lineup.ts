import { lineupNow } from '../../shared/substitutions';
import { LINEUP_PAGE_MS, MatchState, sortPlayersByNumber, TeamId } from '../../shared/types';
import { applyLogoPlate, ui } from './common';
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
  applyLogoPlate(logo, teamState.logoVariant);

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

/** Erzeugt alle Aufstellungsseiten neu. */
export function renderLineupPages(state: MatchState): void {
  // Kader (Spieler) und Teams (Name, Logo, Trainer) -- beides steht auf den
  // Aufstellungsseiten.
  // Die Chronik gehört mit dazu: Ein Wechsel ändert, wer auf der Seite steht.
  const signature = `${state.revisions.squads}-${state.revisions.teams}-${state.revisions.events}`;
  if (lineupSignature === signature) return;
  lineupSignature = signature;

  renderLineupPage('lineup-home', state, 'home', 'start', true);
  renderLineupPage('bench-home', state, 'home', 'bench', false);
  renderLineupPage('lineup-away', state, 'away', 'start', true);
  renderLineupPage('bench-away', state, 'away', 'bench', false);
}

/** Zeigt die Seite mit dem angegebenen Namen, blendet alle anderen aus. */
export function showPage(pageName: string): void {
  for (const page of document.querySelectorAll<HTMLElement>('.pre-page')) {
    page.classList.toggle('is-active', page.dataset.page === pageName);
  }
  // Für die Retro-Matrix, die eine volle Aufstellung zur Hälfte der
  // Standzeit weiterblättert -- dafür braucht sie einen eigenen Anstoß,
  // an dieser Stelle ändert sich sonst nichts.
  ui.activePageSince = Date.now();
  if (retroPageTimer) clearTimeout(retroPageTimer);
  retroPageTimer = setTimeout(requestRetroPaint, LINEUP_PAGE_MS / 2 + 10);
}

function hasContent(pageName: string): boolean {
  const grid = document.getElementById(`${pageName}-grid`);
  return (grid?.childElementCount ?? 0) > 0;
}

function clearLineupTimers(): void {
  for (const timer of lineupTimers) clearTimeout(timer);
  lineupTimers = [];
}

/**
 * Spielt die Aufstellung einer Mannschaft ab: Startelf, dann Bank (falls
 * vorhanden), dann zurück zur Begegnung. Ausgelöst wird das ausschließlich
 * per Knopf im Steuerungsfenster -- die Anzeige rotiert nicht von selbst.
 */
function playLineupSequence(team: TeamId): void {
  clearLineupTimers();

  const startPage = `lineup-${team}`;
  const benchPage = `bench-${team}`;

  if (!hasContent(startPage) && !hasContent(benchPage)) {
    showPage('matchup');
    return;
  }

  const sequence = [startPage, benchPage].filter(hasContent);
  showPage(sequence[0]);

  sequence.slice(1).forEach((page, index) => {
    lineupTimers.push(setTimeout(() => showPage(page), LINEUP_PAGE_MS * (index + 1)));
  });
  lineupTimers.push(
    setTimeout(() => showPage('matchup'), LINEUP_PAGE_MS * sequence.length)
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
      showPage('matchup');
    }
    return;
  }

  if (request.id === lastLineupRequestId) return;
  lastLineupRequestId = request.id;
  playLineupSequence(request.team);
}
