import { substitutionText } from '../../shared/substitutions';
import {
  formatEventMinute,
  goalScorer,
  infoOverlayDurationMs,
  InfoOverlay,
  MatchState,
  playerLabel,
  splitAttendanceMessage,
  sponsorSlotLogo,
} from '../../shared/types';
import { afterCelebration, cancelAfterCelebration } from './celebration';
import { fillSponsorChip, fitLines, goalTitle, nameVariants, ui } from './common';

// Einblendungen im laufenden Spiel: Info-Leiste (Karte, Wechsel, Ecken),
// Danksagung für die Zuschauerzahl und Torschütze mit Portrait.

/* Anzeigedauern stehen in shared/types.ts: Der Store braucht sie
   ebenfalls, um die Anfrage im Zustand wieder abzuräumen. */
let lastScorerRequestId = 0;
let scorerTimer: ReturnType<typeof setTimeout> | null = null;

let lastInfoRequestId = 0;
let infoTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Body-Klassen der Einblendungen. Karte und Ecken erscheinen als schmale
 * Leiste, die Zuschauerzahl als Vollbild-Danksagung -- gesteuert wird das
 * über den gemeinsamen `infoRequest`, dargestellt aber unterschiedlich.
 */
const INFO_BODY_CLASSES = ['showing-info', 'showing-thanks'];

function clearInfoOverlay(): void {
  for (const cssClass of INFO_BODY_CLASSES) document.body.classList.remove(cssClass);
}

/**
 * Füllt die passende Einblendung und meldet, welche Body-Klasse sie
 * sichtbar macht. `null` bedeutet "nichts zu zeigen" -- dann bleibt die
 * Anzeige unverändert, statt leer aufzublitzen (etwa wenn die Karte
 * inzwischen aus der Chronik gelöscht wurde).
 */
function renderInfoOverlay(state: MatchState, overlay: InfoOverlay): string | null {
  if (overlay.kind === 'attendance') {
    if (state.attendance === null) return null;
    const { before, after } = splitAttendanceMessage(state.attendanceMessage);
    document.getElementById('thanks-before')!.textContent = before;
    document.getElementById('thanks-number')!.textContent =
      state.attendance.toLocaleString('de-DE');
    document.getElementById('thanks-after')!.textContent = after;
    return 'showing-thanks';
  }

  const mark = document.getElementById('info-mark') as HTMLElement;
  const label = document.getElementById('info-label')!;
  const value = document.getElementById('info-value')!;

  // Klassenliste zurücksetzen, sonst bliebe die Farbe der vorigen Karte
  // an einer Gelben Karte hängen.
  mark.className = 'info-mark';
  mark.hidden = true;
  // Der Ecken-Sponsor gehört nur zur Ecken-Leiste, nicht zu Karte oder Wechsel.
  document.getElementById('info-sponsor')!.hidden = true;

  if (overlay.kind === 'card') {
    const event = state.events.find((e) => e.id === overlay.eventId);
    if (!event || event.type !== 'card') return null;

    mark.classList.add(`is-${event.card}`);
    mark.hidden = false;

    // Der Spieler wird meist erst nach der Karte zugeordnet. Solange er
    // fehlt, steht die Mannschaft dort -- besser als eine leere Zeile.
    const player = event.playerId
      ? state.squads[event.team].find((p) => p.id === event.playerId)
      : undefined;
    label.textContent = player ? playerLabel(player) : state[event.team].name;
    value.textContent = formatEventMinute(event);
    return 'showing-info';
  }

  if (overlay.kind === 'sub') {
    const event = state.events.find((e) => e.id === overlay.eventId);
    if (!event || event.type !== 'sub') return null;

    mark.classList.add('is-sub');
    mark.hidden = false;
    label.textContent = substitutionText(event, state.squads[event.team], state[event.team].name);
    value.textContent = formatEventMinute(event);
    return 'showing-info';
  }

  label.textContent = 'ECKEN';
  value.textContent = `${state.corners.home} : ${state.corners.away}`;
  fillSponsorChip(document.getElementById('info-sponsor')!, sponsorSlotLogo(state.sponsorSlots, state.media, 'corners'));
  return 'showing-info';
}

/**
 * Zeigt die Info-Leiste für eine neue Anfrage. Aufbau wie bei der
 * Torschützen-Einblendung: Die fortlaufende Id verhindert, dass dieselbe
 * Einblendung bei jedem Zustands-Update neu anläuft.
 */
export function handleInfoRequest(state: MatchState): void {
  const request = state.infoRequest;

  if (request === null) {
    if (lastInfoRequestId !== 0) {
      lastInfoRequestId = 0;
      if (infoTimer) clearTimeout(infoTimer);
      infoTimer = null;
      clearInfoOverlay();
    }
    return;
  }

  if (request.id === lastInfoRequestId) return;
  lastInfoRequestId = request.id;

  const bodyClass = renderInfoOverlay(state, request.overlay);
  if (bodyClass === null) return;

  // Erst die vorige Einblendung abräumen: Sonst blieben Leiste und
  // Danksagung gleichzeitig stehen, wenn kurz hintereinander beide
  // angefordert werden.
  clearInfoOverlay();
  document.body.classList.add(bodyClass);
  ui.activeInfoOverlay = request.overlay;

  if (infoTimer) clearTimeout(infoTimer);
  infoTimer = setTimeout(() => {
    clearInfoOverlay();
    infoTimer = null;
  }, infoOverlayDurationMs(request.overlay, state.durations));
}

/**
 * Blendet einen Torschützen mit Portrait ein. Anders als der Torjubel
 * wird das bewusst manuell ausgelöst -- meist erst, wenn der Name
 * nachgetragen wurde.
 */
export function handleScorerRequest(state: MatchState): void {
  const request = state.scorerRequest;

  if (request === null) {
    if (lastScorerRequestId !== 0) {
      lastScorerRequestId = 0;
      cancelAfterCelebration();
      if (scorerTimer) clearTimeout(scorerTimer);
      scorerTimer = null;
      document.body.classList.remove('showing-scorer');
    }
    return;
  }

  if (request.id === lastScorerRequestId) return;
  lastScorerRequestId = request.id;

  const goal = state.events.find((e) => e.id === request.eventId);
  if (!goal || goal.type !== 'goal') return;

  const player = goalScorer(goal, state.squads);
  // Ohne Spieler (nur Mannschaft bekannt) oder ohne Namen gibt es nichts
  // aufzuteilen.
  const variants =
    player && (player.firstName || player.lastName)
      ? nameVariants(player.number === null ? '' : String(player.number), player.firstName, player.lastName)
      : [[player ? playerLabel(player) : state[goal.team].name]];

  const photo = document.getElementById('spotlight-photo') as HTMLImageElement;
  const name = document.getElementById('spotlight-name')!;
  if (player?.photoDataUrl) {
    // Das Portrait bestimmt, wie viel Breite dem Namen bleibt -- und es
    // ist erst nach dem Laden so breit, wie es wird.
    photo.onload = () => fitLines(name, variants);
    photo.src = player.photoDataUrl;
    photo.hidden = false;
  } else {
    photo.onload = null;
    photo.hidden = true;
  }

  document.getElementById('spotlight-label')!.textContent = `${goalTitle(goal)} · ${formatEventMinute(goal)}`;
  fitLines(name, variants);

  document.getElementById('spotlight-meta')!.textContent =
    `${state[goal.team].name} · ${goal.scoreHome}:${goal.scoreAway}`;

  ui.activeScorerEventId = request.eventId;
  if (scorerTimer) clearTimeout(scorerTimer);
  scorerTimer = null;
  // Nie über einem laufenden Torjubel: erst danach, dann aber volle Zeit.
  afterCelebration(() => {
    document.body.classList.add('showing-scorer');
    // Erst jetzt hat die Fläche ein Layout, an dem sich messen lässt.
    fitLines(name, variants);
    scorerTimer = setTimeout(() => {
      document.body.classList.remove('showing-scorer');
      scorerTimer = null;
    }, state.durations.scorer * 1000);
  });
}
