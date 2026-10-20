import {
  composeRetro,
  retroGrid,
  retroSceneKey,
  RetroScene,
  retroTeamName,
} from '../../shared/retroMatrix';
import { goalNote } from '../../shared/scorerRows';
import { lineupNow, substitutionText } from '../../shared/substitutions';
import {
  ANNOUNCEMENTS_TITLE,
  clockView,
  competitionLabel,
  formatClock,
  formatEventMinute,
  goalScorer,
  LINEUP_PAGE_MS,
  MatchState,
  playerLabel,
  shootoutScore,
  splitAttendanceMessage,
  SPONSORS_TITLE,
  TeamId,
} from '../../shared/types';
import { goalTitle, phaseLabelText, step, ui } from './common';

// --------------------------------------------------------------------
// Retro-Design: Punktmatrix
// --------------------------------------------------------------------

/*
 * Das Retro-Design zeichnet nicht in die vorhandenen Flächen, sondern in
 * eine eigene Punktmatrix (Canvas). WAS dort steht, entscheiden aber
 * dieselben Abläufe wie in den anderen Designs: Torjubel-Stufen,
 * Einblendungen, Diashow und Aufstellungsseiten setzen weiter ihre
 * Body-Klassen, und `currentRetroScene()` liest daraus die aktuelle Szene.
 * So stehen Einblendungen in allen Designs gleich lange, und ein Ablauf
 * muss nicht zweimal gepflegt werden.
 *
 * Die Szene wird in `shared/retroMatrix.ts` zu Punkten -- dort ohne DOM,
 * also testbar. Hier passiert nur noch das Zeichnen und der Aufbau.
 */

/** Retro: Kopfzeile der Begegnung wechselt zwischen Countdown und Wettbewerb. */
const RETRO_LINE_SWITCH_MS = 4000;

/** Sichtbarer Stand der Matrix und der, auf den sie gerade zuläuft. */
let retroShown: Uint8Array | null = null;
let retroTarget: Uint8Array | null = null;
let retroKey = '';
let retroRevealTimer: ReturnType<typeof setTimeout> | null = null;
let retroRevealChunk = 1;
let retroPaintQueued = false;

/**
 * Aufbau "Punkt für Punkt" (Nutzerwunsch 16.10.2026): Wechselt der Inhalt,
 * leuchten die neuen Punkte in zufälliger Folge auf und die alten
 * verlöschen, verteilt auf diese Schritte. Gut eine halbe Sekunde -- lang
 * genug, um als Effekt wahrgenommen zu werden, kurz genug, dass eine
 * Spielstandsänderung nicht auf sich warten lässt.
 */
const RETRO_REVEAL_STEPS = 12;
const RETRO_REVEAL_STEP_MS = 45;

const CARD_TITLE: Record<string, string> = {
  yellow: 'GELBE KARTE',
  'yellow-red': 'GELB-ROT',
  red: 'ROTE KARTE',
};

function retroFooter(state: MatchState): Extract<RetroScene, { kind: 'match' }>['footer'] {
  const overlay = document.body.classList.contains('showing-info') ? ui.activeInfoOverlay : null;

  if (overlay?.kind === 'card') {
    const event = state.events.find((e) => e.id === overlay.eventId);
    if (event && event.type === 'card') {
      const player = event.playerId
        ? state.squads[event.team].find((p) => p.id === event.playerId)
        : undefined;
      return {
        kind: 'info',
        title: CARD_TITLE[event.card] ?? 'KARTE',
        value: formatEventMinute(event),
        name: player ? playerLabel(player) : retroTeamName(state[event.team]),
      };
    }
  }
  if (overlay?.kind === 'sub') {
    const event = state.events.find((e) => e.id === overlay.eventId);
    if (event && event.type === 'sub') {
      return {
        kind: 'info',
        title: 'WECHSEL',
        value: formatEventMinute(event),
        name: substitutionText(event, state.squads[event.team], retroTeamName(state[event.team])),
      };
    }
  }
  if (overlay?.kind === 'corners') {
    return {
      kind: 'info',
      title: 'ECKEN',
      value: `${state.corners.home}:${state.corners.away}`,
      name: '',
    };
  }

  if (state.phase === 'half-time' || state.phase === 'full-time') {
    return { kind: 'phase', text: phaseLabelText(state) };
  }

  const view = clockView(ui.lastClock.elapsedMs, state.half, state.halfDurationMin, state.stoppageMinutes);
  return {
    kind: 'clock',
    clock: formatClock(view.displayMs),
    half: `${state.half}. HZ`,
    stoppage: view.stoppage === null ? '' : `+${view.stoppage}`,
  };
}

/**
 * Tore und Platzverweise für die Matrix, in zeitlicher Reihenfolge -- eine
 * Zeile je Ereignis, wie auf den alten Tafeln. Anders als im klassischen
 * Design stehen Mehrfachtorschützen deshalb mehrmals da: Die Zeilen der
 * beiden Mannschaften wechseln sich ab, und eine zusammengefasste Zeile
 * hätte keinen Platz in der Abfolge.
 *
 * Eine Karte steht als Wort, weil die Tafel einfarbig ist. Gelbe Karten
 * fehlen wie in der Torschützenliste der anderen Designs.
 */
function retroScorerLines(state: MatchState): { side: TeamId; text: string }[] {
  const lines: { side: TeamId; text: string }[] = [];
  for (const event of state.events) {
    // Wechsel gehören nicht in die Torschützenliste -- sie stehen bei
    // Retro wie überall als eigene Einblendung auf der Tafel.
    if (event.type === 'sub') continue;
    const isGoal = event.type === 'goal';
    if (!isGoal && event.card === 'yellow') continue;

    const player = isGoal
      ? goalScorer(event, state.squads)
      : event.playerId
        ? state.squads[event.team].find((p) => p.id === event.playerId)
        : undefined;
    const plain = player ? player.lastName || player.firstName : '';
    // Eigentor und Strafstoß wie im Spielbericht mit "(ET)" bzw. "(FE)" --
    // sonst stünde etwa der Name eines Gegenspielers kommentarlos auf der
    // eigenen Seite.
    const name =
      isGoal && event.ownGoal && !plain ? 'EIGENTOR' : [plain, isGoal ? goalNote(event) : ''].filter(Boolean).join(' ');

    const what = isGoal ? (name ? '' : 'TOR') : event.card === 'red' ? 'ROT' : 'GELB-ROT';
    const text = [formatEventMinute(event), what, name].filter(Boolean).join(' ');
    lines.push({ side: event.team, text });
  }
  return lines;
}

function retroLineup(state: MatchState, pageName: string): RetroScene {
  const team: TeamId = pageName.endsWith('home') ? 'home' : 'away';
  const isBench = pageName.startsWith('bench');
  const now = lineupNow(team, state.squads[team], state.events);
  const players = isBench ? now.bench : now.onPitch;
  const entries = players.map((p) => ({
    number: p.number === null ? '-' : String(p.number),
    name: p.lastName || p.firstName,
  }));
  // Beim Trainer nur der Nachname, wie bei den Spielern -- der volle Name
  // passt in eine halbe Zeile nicht hinein.
  const coach = state[team].coach.trim().split(/\s+/).pop();
  if (!isBench && coach) entries.push({ number: 'TR', name: coach });
  // Mehr als sechs Einträge: in zwei Hälften, je die halbe Standzeit der
  // Seite. Zweispaltig würden lange Namen auf der Matrix abgeschnitten.
  const secondHalf = Date.now() - ui.activePageSince >= LINEUP_PAGE_MS / 2;
  const shown =
    entries.length > 6 ? (secondHalf ? entries.slice(6) : entries.slice(0, 6)) : entries;

  const name = retroTeamName(state[team]);
  return { kind: 'lineup', title: isBench ? `${name} - BANK` : name, entries: shown };
}

/** Liest aus den Body-Klassen, was gerade auf der Tafel stehen soll. */
function currentRetroScene(state: MatchState): RetroScene {
  const body = document.body;
  const home = retroTeamName(state.home);
  const away = retroTeamName(state.away);

  if (body.classList.contains('celebrating')) {
    const homeGoal = body.classList.contains('goal-home');
    return {
      kind: 'goal',
      word: body.dataset.goalStage === 'word' ? 'TOR!' : 'TOR',
      team: homeGoal ? home : away,
    };
  }

  if (body.classList.contains('showing-scorer') && ui.activeScorerEventId !== null) {
    const goal = state.events.find((e) => e.id === ui.activeScorerEventId);
    if (goal && goal.type === 'goal') {
      const player = goalScorer(goal, state.squads);
      return {
        kind: 'scorer',
        title: `${goalTitle(goal)} ${formatEventMinute(goal)}`,
        name: player ? `${player.firstName} ${player.lastName}`.trim() : retroTeamName(state[goal.team]),
        detail: `${retroTeamName(state[goal.team])} ${goal.scoreHome}:${goal.scoreAway}`,
      };
    }
  }

  if (body.classList.contains('showing-thanks') && state.attendance !== null) {
    const { before, after } = splitAttendanceMessage(state.attendanceMessage);
    return {
      kind: 'thanks',
      before,
      number: state.attendance.toLocaleString('de-DE'),
      after,
    };
  }

  if (body.classList.contains('showing-slide') && ui.activeSlide) {
    if (ui.activeSlide.kind === 'text') {
      return { kind: 'text', title: ANNOUNCEMENTS_TITLE, lines: ui.activeSlide.lines };
    }
    if (ui.activeSlide.kind === 'sponsors') {
      return { kind: 'sponsors', title: SPONSORS_TITLE, page: ui.activeSlide.page, pages: ui.activeSlide.pages };
    }
    if (ui.activeSlide.kind !== 'base') return { kind: 'blank' };
  }

  // Elfmeterschießen: Felder gibt es in der Punktmatrix nicht, deshalb je
  // Mannschaft eine Zeile mit Namen und Stand und eine mit den Schüssen
  // ("T" Treffer, "-" verschossen).
  if (body.classList.contains('showing-shootout') && state.shootout) {
    const score = shootoutScore(state.shootout);
    const kicks = (team: TeamId) => state.shootout![team].map((k) => (k === 'goal' ? 'T' : '-')).join(' ');
    return {
      kind: 'text',
      // "ELFMETERSCHIESSEN" passt in der großen Punktschrift nicht in die Breite.
      title: 'ELFMETER',
      lines: [`${home} ${score.home}`, kicks('home'), `${away} ${score.away}`, kicks('away')],
    };
  }

  if (state.phase === 'pre-match') {
    const page = document.querySelector<HTMLElement>('.pre-page.is-active')?.dataset.page ?? 'matchup';
    if (page !== 'matchup') return retroLineup(state, page);
    // Derselbe Countdown wie in den anderen Designs, nur ohne "UHR ·":
    // So passt "ANSTOSS 15:00 NOCH 12:34" genau in eine Zeile.
    const countdown = (document.getElementById('pre-kickoff')!.textContent ?? '').replace(' UHR · ', ' ');
    // Ein Logo gibt es in der Punktmatrix nicht. Der Wettbewerb steht
    // deshalb als Name in der Kopfzeile, im Wechsel mit dem Countdown --
    // für eine eigene Zeile reicht die Höhe nicht.
    const competition = document.body.classList.contains('has-competition') && state.competition
      ? competitionLabel(state.competition)
      : '';
    const showCompetition = competition !== '' && Math.floor(Date.now() / RETRO_LINE_SWITCH_MS) % 2 === 1;
    return { kind: 'matchup', home, away, line: showCompetition ? competition : countdown };
  }

  return {
    kind: 'match',
    home,
    away,
    homeScore: state.home.score,
    scorers: retroScorerLines(state),
    awayScore: state.away.score,
    footer: retroFooter(state),
  };
}

/**
 * Zeichnet den sichtbaren Stand. Punktgröße und Lücke kommen aus
 * `retroGrid()` -- bei 384×192 belegt ein Punkt 4 Tafelpixel, drei davon
 * leuchten.
 *
 * Gezeichnet wird nur, wenn die Fläche wirklich Platz einnimmt. Außerhalb
 * des Retro-Designs ist sie ausgeblendet -- und in jsdom, wo die Tests
 * laufen, gibt es keine Zeichenfläche und kein Layout.
 */
function drawRetro(cols: number, rows: number): void {
  const canvas = document.getElementById('retro-matrix') as HTMLCanvasElement;
  if (!retroShown || canvas.clientWidth === 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { cell, dot } = retroGrid(ui.boardSize.width, ui.boardSize.height);
  if (canvas.width !== cols * cell || canvas.height !== rows * cell) {
    canvas.width = cols * cell;
    canvas.height = rows * cell;
  }

  // Farben aus dem Stylesheet -- Hex-Werte stehen nur dort im :root.
  const style = getComputedStyle(document.body);
  const background = style.getPropertyValue('--retro-bg').trim();
  const on = style.getPropertyValue('--retro-on').trim();
  const off = style.getPropertyValue('--retro-off').trim();

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [color, lit] of [
    [off, 0],
    [on, 1],
  ] as const) {
    ctx.fillStyle = color;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (retroShown[y * cols + x] === lit) ctx.fillRect(x * cell, y * cell, dot, dot);
      }
    }
  }
}

function stopRetroReveal(): void {
  if (retroRevealTimer) clearTimeout(retroRevealTimer);
  retroRevealTimer = null;
}

/** Ein Schritt des Aufbaus: ein Teil der noch falschen Punkte springt um. */
function retroRevealStep(cols: number, rows: number): void {
  retroRevealTimer = null;
  if (!retroShown || !retroTarget) return;

  const pending: number[] = [];
  for (let i = 0; i < retroShown.length; i++) {
    if (retroShown[i] !== retroTarget[i]) pending.push(i);
  }
  if (pending.length === 0) return;

  for (let n = 0; n < retroRevealChunk && pending.length > 0; n++) {
    const pick = Math.floor(Math.random() * pending.length);
    const index = pending[pick];
    pending[pick] = pending[pending.length - 1];
    pending.pop();
    retroShown[index] = retroTarget[index];
  }
  drawRetro(cols, rows);
  if (pending.length > 0) {
    retroRevealTimer = setTimeout(() => retroRevealStep(cols, rows), RETRO_REVEAL_STEP_MS);
  }
}

function paintRetro(): void {
  const body = document.body;
  if (body.dataset.theme !== 'retro' || !ui.currentState) {
    stopRetroReveal();
    retroShown = null;
    retroTarget = null;
    retroKey = '';
    if (body.dataset.retroOverlay) delete body.dataset.retroOverlay;
    return;
  }

  const { cols, rows } = retroGrid(ui.boardSize.width, ui.boardSize.height);
  const scene = currentRetroScene(ui.currentState);

  // Bilder der Diashow (Sponsoren-Fenster, Highlights) bleiben Bilder --
  // sie liegen über dem erloschenen Raster, das dann als Hintergrund dient.
  const overlay = scene.kind === 'blank' || scene.kind === 'sponsors' ? 'slide' : '';
  if ((body.dataset.retroOverlay ?? '') !== overlay) {
    if (overlay) body.dataset.retroOverlay = overlay;
    else delete body.dataset.retroOverlay;
  }

  const target = composeRetro(scene, cols, rows).dots;
  const key = `${cols}x${rows}|${body.dataset.retroColor}|${retroSceneKey(scene)}`;

  // Die Szene steht zusätzlich am Element: Das Canvas selbst kann in den
  // Tests (jsdom) nicht gelesen werden, die Szene schon. So lässt sich
  // prüfen, was die Anzeige aus dem Spielzustand macht.
  (document.getElementById('retro-matrix') as HTMLCanvasElement).dataset.scene = JSON.stringify(scene);
  retroTarget = target;

  // Erster Stand, andere Tafelgröße oder nur die Uhr hat sich bewegt:
  // sofort umspringen. Läuft gerade ein Aufbau, übernimmt der das neue
  // Ziel einfach mit.
  if (!retroShown || retroShown.length !== target.length || (key === retroKey && !retroRevealTimer)) {
    stopRetroReveal();
    retroShown = target.slice();
    retroKey = key;
    drawRetro(cols, rows);
    return;
  }

  if (key === retroKey) return;
  retroKey = key;

  let differing = 0;
  for (let i = 0; i < target.length; i++) if (retroShown[i] !== target[i]) differing++;
  retroRevealChunk = Math.max(1, Math.ceil(differing / RETRO_REVEAL_STEPS));
  if (!retroRevealTimer) retroRevealStep(cols, rows);
}

/**
 * Zeichnet beim nächsten Mikrotask neu. Mehrere Auslöser im selben
 * Durchlauf (Zustand, Body-Klassen, Uhr) ergeben so nur eine Zeichnung.
 */
export function requestRetroPaint(): void {
  if (retroPaintQueued) return;
  retroPaintQueued = true;
  void Promise.resolve().then(() => {
    retroPaintQueued = false;
    step('Retro', paintRetro);
  });
}
