import { displayPhaseLabel } from '../../shared/phaseLabels';
import {
  composeRetro,
  retroGrid,
  retroSceneKey,
  RetroScene,
  retroTeamName,
} from '../../shared/retroMatrix';
import { buildScorerRows, visibleScorerRows } from '../../shared/scorerRows';
import { lineupNow, substitutionText } from '../../shared/substitutions';
import {
  ANNOUNCEMENTS_PER_SLIDE,
  announcementsVisible,
  ANNOUNCEMENTS_TITLE,
  BoardSize,
  ClockState,
  clockView,
  DEFAULT_BOARD_SIZE,
  DEFAULT_HALF_DURATION_MIN,
  DisplayAppearance,
  FLUTLICHT_EFFECT_KEYS,
  formatClock,
  formatEventMinute,
  goalStagesFor,
  GoalEvent,
  GoalStage,
  infoOverlayDurationMs,
  InfoOverlay,
  LINEUP_PAGE_MS,
  LogoVariant,
  MatchPhase,
  MatchState,
  mediaUrl,
  playerLabel,
  SCORER_DISPLAY_MS,
  SLIDE_DURATION_MS,
  showsLeadChangeFrame,
  slideFoldersForPhase,
  sortPlayersByNumber,
  splitAttendanceMessage,
  SPONSORS_PER_PAGE,
  SPONSORS_TITLE,
  TeamId,
} from '../../shared/types';

let currentState: MatchState | null = null;

/**
 * Maße der Bühne, also der Fläche, in der das Layout gerechnet wird.
 *
 * Kommen aus den Einstellungen (`MatchState.board`). Bis der erste Zustand
 * eintrifft, gilt die Herstellerangabe -- so steht auch in der ersten
 * Sekunde nach dem Öffnen etwas im richtigen Format da.
 */
let boardSize: BoardSize = { ...DEFAULT_BOARD_SIZE };

/**
 * Setzt Größe und Skalierung der Bühne.
 *
 * Der Skalierungsfaktor lässt sich nicht in reinem CSS ausdrücken -- eine
 * Länge durch eine Länge zu teilen geht dort nicht --, deshalb rechnet
 * ihn der Renderer aus und legt ihn als Variable ab.
 *
 * Bewusst am `resize`-Ereignis und NICHT an einem `ResizeObserver`: Den
 * kennt jsdom nicht, und der Smoke-Test (`tests/renderer.test.js`) fährt
 * beide Fenster durch jeden Spielzustand. Das Fenster ist ohnehin das
 * einzige, was sich hier ändern kann.
 */
function applyBoardSize(): void {
  const stage = document.getElementById('stage')!;
  stage.style.setProperty('--board-w', `${boardSize.width}px`);
  stage.style.setProperty('--board-h', `${boardSize.height}px`);

  const scale = Math.min(
    window.innerWidth / boardSize.width,
    window.innerHeight / boardSize.height
  );
  // Ein Fenster mit Höhe oder Breite 0 gibt es beim Minimieren tatsächlich
  // -- ohne diesen Deckel stünde dort eine 0 oder ein NaN im Stylesheet.
  stage.style.setProperty('--board-scale', String(Number.isFinite(scale) && scale > 0 ? scale : 1));
}

/**
 * Schaltet das Design um. Alles Weitere entscheidet das Stylesheet über
 * `body[data-theme]` und `body[data-fx]` -- der Renderer baut dafür keine
 * Knoten um, weil sämtliche Verdrahtung einmal in `main()` läuft.
 *
 * `data-fx` ist eine Liste der EINGESCHALTETEN Effekte, damit das
 * Stylesheet sie mit `[data-fx~='verlauf']` einzeln abfragen kann.
 */
function applyAppearance(appearance: DisplayAppearance): void {
  document.body.dataset.theme = appearance.theme;
  document.body.dataset.fx = FLUTLICHT_EFFECT_KEYS.filter((key) => appearance.effects[key]).join(' ');
  document.body.dataset.retroColor = appearance.retroColor;
}

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

/** Was die Einblendungen gerade zeigen; gesetzt in ihren Handlern. */
let activeInfoOverlay: InfoOverlay | null = null;
let activeScorerEventId: number | null = null;
let activeSlide: Slide | null = null;
let lastClock: ClockState = { elapsedMs: 0, running: false };
/** Seit wann die aktuelle Seite vor dem Anpfiff steht, siehe `showPage()`. */
let activePageSince = 0;
let retroPageTimer: ReturnType<typeof setTimeout> | null = null;

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
  const overlay = document.body.classList.contains('showing-info') ? activeInfoOverlay : null;

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
    return { kind: 'phase', text: displayPhaseLabel(state.phase) };
  }

  const view = clockView(lastClock.elapsedMs, state.half, state.halfDurationMin, state.stoppageMinutes);
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

    const playerId = isGoal ? event.scorerId : event.playerId;
    const player = playerId ? state.squads[event.team].find((p) => p.id === playerId) : undefined;
    const name = player ? player.lastName || player.firstName : '';

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
  const secondHalf = Date.now() - activePageSince >= LINEUP_PAGE_MS / 2;
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

  if (body.classList.contains('showing-scorer') && activeScorerEventId !== null) {
    const goal = state.events.find((e) => e.id === activeScorerEventId);
    if (goal && goal.type === 'goal') {
      const player = goal.scorerId
        ? state.squads[goal.team].find((p) => p.id === goal.scorerId)
        : undefined;
      return {
        kind: 'scorer',
        title: `TOR ${formatEventMinute(goal)}`,
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

  if (body.classList.contains('showing-slide') && activeSlide) {
    if (activeSlide.kind === 'text') {
      return { kind: 'text', title: ANNOUNCEMENTS_TITLE, lines: activeSlide.lines };
    }
    if (activeSlide.kind === 'sponsors') {
      return { kind: 'sponsors', title: SPONSORS_TITLE, page: activeSlide.page, pages: activeSlide.pages };
    }
    if (activeSlide.kind !== 'base') return { kind: 'blank' };
  }

  if (state.phase === 'pre-match') {
    const page = document.querySelector<HTMLElement>('.pre-page.is-active')?.dataset.page ?? 'matchup';
    if (page !== 'matchup') return retroLineup(state, page);
    return {
      kind: 'matchup',
      home,
      away,
      // Derselbe Countdown wie in den anderen Designs, nur ohne "UHR ·":
      // So passt "ANSTOSS 15:00 NOCH 12:34" genau in eine Zeile.
      line: (document.getElementById('pre-kickoff')!.textContent ?? '').replace(' UHR · ', ' '),
    };
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

  const { cell, dot } = retroGrid(boardSize.width, boardSize.height);
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
  if (body.dataset.theme !== 'retro' || !currentState) {
    stopRetroReveal();
    retroShown = null;
    retroTarget = null;
    retroKey = '';
    if (body.dataset.retroOverlay) delete body.dataset.retroOverlay;
    return;
  }

  const { cols, rows } = retroGrid(boardSize.width, boardSize.height);
  const scene = currentRetroScene(currentState);

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
function requestRetroPaint(): void {
  if (retroPaintQueued) return;
  retroPaintQueued = true;
  void Promise.resolve().then(() => {
    retroPaintQueued = false;
    step('Retro', paintRetro);
  });
}

/** Zuletzt verarbeitetes Ereignis. Verhindert, dass der Jubel bei jedem
    Zustands-Update erneut startet. */
let lastSeenEventId = 0;

/** Laufende Zeitschalter des Torjubels: die Stufenwechsel und das Ende.
    Sammelt sie, weil ein zweites Tor kurz nach dem ersten den ganzen
    Ablauf zurücksetzen muss und nicht nur den letzten Schritt. */
const goalTimers: ReturnType<typeof setTimeout>[] = [];
let scorerListSignature = '';

/**
 * Zeilen der Torschützenliste je Phase.
 *
 * Im laufenden Spiel ist unter dem Wappen wenig Platz: Der Fuß trägt das
 * Uhr-Panel, und das Wappen muss auf einer Höhe mit dem Spielstand
 * bleiben. In Halbzeit und Endstand fällt die Uhr weg und das Wappen
 * rückt nach oben -- dort passt die Hälfte mehr.
 *
 * Nachgerechnet für 384x192 (1vh = 1,92px): Eine Zeile braucht
 * 4,4vh Schrift x 1,3 Zeilenhöhe + 0,2vh Abstand = 5,9vh, das Zeichen
 * für abgeschnittene Einträge weitere 2,8vh.
 *
 * **Der Platz endet NICHT an der `.team-column`.** Die Liste ist absolut
 * positioniert und hat automatische Höhe -- sie darf über den Fußbereich
 * hinauslaufen. Dort unten ist sie ungestört: Das Uhr-Panel ist nur 42vw
 * breit und sitzt mittig, die beiden Mannschaftsspalten liegen links und
 * rechts daneben. Nutzbar ist deshalb alles vom Listenbeginn bis etwa
 * 97vh (3vh Rand).
 *
 * Im laufenden Spiel beginnt die Liste bei rund 58vh: sechs Zeilen plus
 * Zeichen enden bei ~96vh. In Halbzeit und Endstand beginnt sie bei
 * ~39vh, dort passen neun Zeilen bis ~95vh.
 *
 * (Eine frühere Rechnung kam auf nur 22vh, weil sie die Liste
 * fälschlich in der Spalte eingesperrt sah. Daraus entstand der
 * Fehlschluss, das Wappen müsse für eine weitere Zeile nach oben
 * rücken -- muss es nicht.)
 */
const MAX_SCORER_ROWS: Record<MatchPhase, number> = {
  'pre-match': 6,
  live: 6,
  'half-time': 9,
  'full-time': 9,
};

/* Anzeigedauern stehen in shared/types.ts: Der Store braucht sie
   ebenfalls, um die Anfrage im Zustand wieder abzuräumen. */
let lastScorerRequestId = 0;
let scorerTimer: ReturnType<typeof setTimeout> | null = null;

let lastInfoRequestId = 0;
let infoTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Eine Station der Diashow. `base` ist die normale Ansicht (Begegnung
 * bzw. Zwischenstand) -- sie rotiert bewusst mit, damit der Spielstand
 * nie länger als einen Schritt weg ist.
 */
type Slide =
  | { kind: 'base' }
  | { kind: 'image'; url: string }
  | { kind: 'sponsors'; urls: string[]; page: number; pages: number }
  | { kind: 'text'; lines: string[] };

let lastSlideshowId = 0;
let slideDeck: Slide[] = [];
let slideIndex = 0;
let slideTimer: ReturnType<typeof setTimeout> | null = null;

let lineupSignature = '';
/** zuletzt ausgeführte Einblendung, damit sie nicht dauernd neu startet */
let lastLineupRequestId = 0;
let lineupTimers: ReturnType<typeof setTimeout>[] = [];

/**
 * Schreibt Text so, dass jede Ziffer eine eigene Zelle fester Breite
 * bekommt. Oswald hat keine dicktengleichen Ziffern -- ohne das würden
 * Uhr-Panel, Wappen und Spielstand bei jedem Ziffernwechsel springen.
 */
function renderDigits(element: HTMLElement, text: string): void {
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
function renderCrest(
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
function applyLogoPlate(img: HTMLImageElement, variant?: LogoVariant): void {
  img.classList.toggle('has-plate', variant === 'color');
}

/**
 * Ereignisse einer Mannschaft unter deren Wappen: Tore und Platzverweise.
 * Gelbe Karten bleiben bewusst draußen -- sonst wäre die Liste im Nu voll
 * und der Blick auf die Tore ginge verloren.
 */
function renderScorerList(team: TeamId, state: MatchState): void {
  const list = document.getElementById(`${team}-scorers`)!;
  list.innerHTML = '';

  const rows = buildScorerRows(team, state.events, state.squads[team]);
  // Harte Obergrenze: bei 192px Höhe ist der Platz unter dem Wappen
  // begrenzt, eine wachsende Liste würde sonst ins Uhr-Panel laufen.
  const visible = visibleScorerRows(rows, MAX_SCORER_ROWS[state.phase]);

  // Sind ältere Einträge herausgefallen, steht darüber ein dezentes
  // Zeichen -- sonst sähe die Liste aus, als wäre das schon alles
  // gewesen. Drei Quadrate statt eines Auslassungszeichens, siehe die
  // Begründung an .scorer-more in display.css.
  if (visible.length < rows.length) {
    const more = document.createElement('li');
    more.className = 'scorer-more';
    more.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) more.appendChild(document.createElement('i'));
    list.appendChild(more);
  }

  for (const row of visible) {
    const item = document.createElement('li');

    const minute = document.createElement('span');
    minute.className = 'scorer-minute';
    minute.textContent = row.minutes.join(' ');
    item.appendChild(minute);

    if (row.card) {
      const card = document.createElement('span');
      card.className = `scorer-card is-${row.card}`;
      item.appendChild(card);
    }

    const name = document.createElement('span');
    name.className = 'scorer-name';
    name.textContent = row.name;
    item.appendChild(name);

    list.appendChild(item);
  }
}

function renderTeam(team: TeamId, state: MatchState): void {
  const teamState = state[team];

  renderDigits(document.getElementById(`${team}-score`)!, String(teamState.score));
  renderCrest(`${team}-logo`, `${team}-fallback`, teamState);

  // Ansicht vor dem Anpfiff: größere Wappen plus ausgeschriebene Namen
  renderCrest(`pre-${team}-logo`, `pre-${team}-fallback`, teamState);
  document.getElementById(`pre-${team}-name`)!.textContent = teamState.name;
}

/**
 * Countdown bis zum geplanten Anstoß. Rein informativ -- der Anpfiff wird
 * weiterhin manuell ausgelöst, die Uhr startet nicht von selbst.
 */
function renderKickoffCountdown(): void {
  const element = document.getElementById('pre-kickoff')!;

  if (!currentState || currentState.phase !== 'pre-match') {
    element.textContent = '';
    return;
  }

  const kickoff = parseKickoffTime(currentState.kickoffTime);
  if (!kickoff) {
    element.textContent = 'GLEICH GEHT ES LOS';
    return;
  }

  const remainingMs = kickoff.getTime() - Date.now();
  if (remainingMs <= 0) {
    element.textContent = 'ANSTOSS STEHT BEVOR';
    return;
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const countdown =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  element.textContent = `ANSTOSS ${currentState.kickoffTime} UHR · NOCH ${countdown}`;
}

/** "HH:MM" auf den heutigen Tag bezogen. Ungültige Eingaben -> null. */
function parseKickoffTime(value: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  return target;
}

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
function renderLineupPages(state: MatchState): void {
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
function showPage(pageName: string): void {
  for (const page of document.querySelectorAll<HTMLElement>('.pre-page')) {
    page.classList.toggle('is-active', page.dataset.page === pageName);
  }
  // Für die Retro-Matrix, die eine volle Aufstellung zur Hälfte der
  // Standzeit weiterblättert -- dafür braucht sie einen eigenen Anstoß,
  // an dieser Stelle ändert sich sonst nichts.
  activePageSince = Date.now();
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
 * Lässt die Ziffern einer Mannschaft im Spielstand der normalen Ansicht
 * von oben einlaufen.
 *
 * Bewusst dort und nicht auf einer eigenen Seite (Nutzerentscheidung
 * 19.08.2026): Der Zwischenstand soll da wechseln, wo die Zuschauer ihn
 * ohnehin suchen. Markiert werden alle Ziffern der treffenden
 * Mannschaft -- bei 9 -> 10 ist die Zehnerstelle ja tatsächlich neu.
 */
function rollScore(team: TeamId): void {
  const element = document.getElementById(`${team}-score`);
  if (!element) return;
  for (const zelle of element.children) zelle.classList.add('is-rolling');
}

/** Nimmt die Marken wieder weg, damit ein späterer Aufbau sauber steht. */
function clearScoreRoll(): void {
  for (const team of ['home', 'away'] as TeamId[]) {
    const element = document.getElementById(`${team}-score`);
    if (!element) continue;
    for (const zelle of element.children) zelle.classList.remove('is-rolling');
  }
}

/** Räumt den Jubel ab -- am Ende des Ablaufs und vor jedem Neustart. */
function endCelebration(): void {
  for (const timer of goalTimers) clearTimeout(timer);
  goalTimers.length = 0;
  document.body.classList.remove('celebrating', 'goal-lead-change', 'goal-home');
  delete document.body.dataset.goalStage;
  clearScoreRoll();
}

/**
 * Schaltet auf eine Stufe.
 *
 * `celebrating` gilt nur für die Vollbildstufen. In `boost` ist die
 * Vollbildfläche weg und die normale Spielansicht wieder da -- genau
 * dort läuft dann die Ziffer ein.
 */
function applyGoalStage(stage: GoalStage, team: TeamId): void {
  document.body.dataset.goalStage = stage;
  document.body.classList.toggle('celebrating', stage !== 'boost');
  if (stage === 'boost') rollScore(team);
}

/**
 * Startet den Torjubel für ein neues Ereignis. Wird nur aufgerufen, wenn
 * die Ereignis-Id noch nicht gesehen wurde -- sonst würde der Jubel bei
 * jedem Zustands-Update neu anlaufen.
 *
 * Der Ablauf unterscheidet Heim- und Gegentor (Nutzerwunsch): beim
 * eigenen Verein Wappen und "TOR!" auf pulsender Fläche, beim Gegner der
 * Mannschaftsname auf ruhigem Grund. Danach beide Male zurück auf die
 * Spielansicht, in der sich die neue Ziffer an ihren Platz schiebt.
 *
 * Ein Torschütze steht hier bewusst nicht: Er ist im Moment des Tores
 * praktisch nie eingetragen. Dafür gibt es den Knopf "Torschütze
 * einblenden" mit Portrait.
 */
function startCelebration(state: MatchState, goal: GoalEvent): void {
  // Ein zweites Tor kurz nach dem ersten setzt den Ablauf zurück, statt
  // sich mit ihm zu überlagern.
  endCelebration();

  const istHeimtor = goal.team === 'home';
  const teamState = state[goal.team];

  // Kein Ausrufezeichen beim Gegentor -- gejubelt wird hier nicht.
  document.getElementById('goal-word')!.textContent = istHeimtor ? 'TOR!' : 'TOR';

  // Das Wappen der treffenden Mannschaft -- bei BEIDEN. Für die
  // Gastvereine sind Logos genauso hinterlegt wie für den eigenen, und
  // der normale Spielbildschirm zeigt sie ohnehin nebeneinander. Ein
  // ausgeschriebener Name an dieser Stelle fiele aus dem Bild.
  //
  // Der Name bleibt die Rückfallebene, wenn für den Verein kein Logo
  // hinterlegt ist -- dieselbe Regel wie beim Wappen auf dem
  // Spielbildschirm, nur dass dort das Kürzel einspringt.
  const crest = document.getElementById('goal-crest') as HTMLImageElement;
  const team = document.getElementById('goal-team')!;
  const logo = teamState.logoDataUrl;
  if (logo) crest.src = logo;
  crest.hidden = logo === undefined;
  applyLogoPlate(crest, teamState.logoVariant);
  team.textContent = teamState.name;
  team.hidden = logo !== undefined;

  document.body.classList.toggle('goal-home', istHeimtor);
  document.body.classList.toggle('goal-lead-change', showsLeadChangeFrame(goal));

  const stufen = goalStagesFor(goal.team);

  // Die erste Stufe steht sofort: Über einen Timer mit 0 ms stünde für
  // einen Frame eine leere Fläche da.
  applyGoalStage(stufen[0].stage, goal.team);

  let versatz = 0;
  stufen.forEach(({ stage, ms }, i) => {
    if (i > 0) {
      const beginn = versatz;
      goalTimers.push(setTimeout(() => applyGoalStage(stage, goal.team), beginn));
    }
    versatz += ms;
  });
  goalTimers.push(setTimeout(endCelebration, versatz));
}

/**
 * Prüft, ob seit dem letzten Update ein neues Tor dazugekommen ist.
 * Beim allerersten Aufruf werden bestehende Ereignisse nur als gesehen
 * vermerkt -- ein neu geöffnetes Anzeigefenster soll keinen alten
 * Torjubel nachholen.
 */
function handleEvents(state: MatchState, isFirstRender: boolean): void {
  const latest = state.events[state.events.length - 1];
  const latestId = latest?.id ?? 0;

  if (isFirstRender) {
    lastSeenEventId = latestId;
    return;
  }

  if (latestId <= lastSeenEventId) {
    // Keine neuen Ereignisse. Bei einer Korrektur (Tor zurückgenommen)
    // sinkt die Id -- dann mitziehen, damit ein erneutes Tor wieder zündet.
    lastSeenEventId = latestId;
    return;
  }

  lastSeenEventId = latestId;
  if (latest && latest.type === 'goal' && latest.celebrate) {
    startCelebration(state, latest);
  }
}

/**
 * Führt einen Renderschritt aus und fängt Fehler ab.
 *
 * Hintergrund: Ein einziger fehlgeschlagener Zugriff (etwa auf ein aus dem
 * HTML entferntes Element) hat schon einmal die gesamte Funktion abgebrochen
 * -- und damit auch Torjubel, Aufstellungen und Torschützen-Einblendung
 * lahmgelegt, weil die danach kamen. Jeder Abschnitt läuft deshalb
 * unabhängig.
 */
function step(name: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(`Anzeige: Schritt "${name}" fehlgeschlagen`, error);
  }
}

/**
 * Uhr und Nachspielzeit. Wird sowohl aus dem vollständigen Zustand als auch
 * aus dem schlanken Uhr-Tick aufgerufen; Halbzeit und Halbzeitdauer kommen
 * dabei aus dem zuletzt empfangenen Zustand.
 */
function renderClock(clock: ClockState): void {
  lastClock = clock;
  requestRetroPaint();
  const view = clockView(
    clock.elapsedMs,
    currentState?.half ?? 1,
    currentState?.halfDurationMin ?? DEFAULT_HALF_DURATION_MIN,
    currentState?.stoppageMinutes ?? 0
  );
  renderDigits(document.getElementById('clock-display')!, formatClock(view.displayMs));

  const stoppage = document.getElementById('stoppage-display')!;
  stoppage.textContent = view.stoppage === null ? '' : `+${view.stoppage}`;
  stoppage.hidden = view.stoppage === null;
}

function renderState(state: MatchState): void {
  const isFirstRender = currentState === null;
  currentState = state;
  document.body.dataset.phase = state.phase;

  step('Bühne', () => {
    if (
      state.board.width === boardSize.width &&
      state.board.height === boardSize.height &&
      !isFirstRender
    ) {
      return;
    }
    boardSize = { ...state.board };
    applyBoardSize();
  });

  step('Darstellung', () => applyAppearance(state.appearance));

  step('Mannschaften', () => {
    renderTeam('home', state);
    renderTeam('away', state);
  });

  step('Uhr', () => renderClock(state.clock));

  step('Phase', () => {
    document.getElementById('phase-label')!.textContent = displayPhaseLabel(state.phase);
    document.getElementById('clock-half')!.textContent = `${state.half}. HZ`;
  });

  step('Aufstellungen', () => renderLineupPages(state));

  step('Torschützenlisten', () => {
    // Nur bei tatsächlichen Änderungen neu aufbauen. Verglichen werden die
    // Revisionszähler des Stores -- früher lief hier ein JSON.stringify
    // über die kompletten Kader samt Portraits, bei jedem Uhr-Tick.
    //
    // Die Phase gehört mit in die Signatur, seit die Zeilenzahl von ihr
    // abhängt: Ein Phasenwechsel zählt bewusst keinen Revisionszähler
    // hoch, die Liste bliebe sonst beim Halbzeitpfiff auf vier Zeilen
    // stehen.
    const scorerSignature =
      `${state.revisions.events}-${state.revisions.squads}-${state.phase}`;
    if (scorerSignature === scorerListSignature) return;
    scorerListSignature = scorerSignature;
    renderScorerList('home', state);
    renderScorerList('away', state);
  });

  step('Anstoß-Countdown', renderKickoffCountdown);
  step('Torjubel', () => handleEvents(state, isFirstRender));
  step('Aufstellungs-Einblendung', () => handleLineupRequest(state));
  step('Torschützen-Einblendung', () => handleScorerRequest(state));
  step('Info-Leiste', () => handleInfoRequest(state));
  step('Diashow', () => handleSlideshowRequest(state));
  requestRetroPaint();
}

/**
 * Stellt die Folienfolge für die aktuelle Phase zusammen: erst die
 * normale Ansicht, dann die Bilder der zuständigen Ordner, in der
 * Halbzeitpause zuletzt die Ankündigungen.
 */
function buildSlideDeck(state: MatchState): Slide[] {
  const slides: Slide[] = [{ kind: 'base' }];

  for (const folder of slideFoldersForPhase(state.phase)) {
    const urls = state.media[folder].files.map((fileName) => mediaUrl(folder, fileName));

    // Sponsoren zu viert im Fenster, alles andere einzeln im Vollbild.
    // Die Zählung muss zu slideCount() passen -- danach richtet sich der
    // Hinweis im Steuerungsfenster.
    if (folder === 'werbung') {
      const pages = Math.ceil(urls.length / SPONSORS_PER_PAGE);
      for (let page = 0; page < pages; page++) {
        slides.push({
          kind: 'sponsors',
          urls: urls.slice(page * SPONSORS_PER_PAGE, (page + 1) * SPONSORS_PER_PAGE),
          page,
          pages,
        });
      }
      continue;
    }

    for (const url of urls) slides.push({ kind: 'image', url });
  }

  // Welche Phasen Ankündigungen zeigen, entscheidet announcementsVisible()
  // -- dieselbe Regel nutzt die Folienzählung im Steuerungsfenster.
  if (announcementsVisible(state.phase)) {
    for (let i = 0; i < state.announcements.length; i += ANNOUNCEMENTS_PER_SLIDE) {
      slides.push({
        kind: 'text',
        lines: state.announcements.slice(i, i + ANNOUNCEMENTS_PER_SLIDE),
      });
    }
  }

  return slides;
}

/**
 * Füllt das Sponsoren-Fenster. Nicht belegte Kacheln bleiben leer statt zu
 * verschwinden: Sonst würden die übrigen größer, und gerade das soll das
 * Fenster verhindern -- alle Partner gleich groß.
 *
 * Die Seitenanzeige (kleine Quadrate) erscheint erst ab zwei Seiten; bei
 * einer einzigen wäre sie ein Zeichen ohne Aussage.
 */
function renderSponsorWindow(urls: string[], page: number, pages: number): void {
  document.getElementById('sponsor-title')!.textContent = SPONSORS_TITLE;

  for (let i = 0; i < SPONSORS_PER_PAGE; i++) {
    const logo = document.getElementById(`sponsor-logo-${i}`) as HTMLImageElement;
    const url = urls[i];
    logo.hidden = url === undefined;
    if (url === undefined) {
      logo.removeAttribute('src');
    } else if (logo.getAttribute('src') !== url) {
      logo.src = url;
    }
  }

  const marks = document.getElementById('sponsor-pages')!;
  marks.textContent = '';
  if (pages < 2) return;
  for (let i = 0; i < pages; i++) {
    const mark = document.createElement('i');
    if (i === page) mark.className = 'is-current';
    marks.appendChild(mark);
  }
}

/** Zeigt eine Station. `base` blendet die Folienfläche einfach aus. */
function showSlide(slide: Slide): void {
  activeSlide = slide;
  if (slide.kind === 'base') {
    document.body.classList.remove('showing-slide');
    return;
  }

  const image = document.getElementById('slide-image') as HTMLImageElement;
  const text = document.getElementById('slide-text')!;
  const sponsors = document.getElementById('sponsor-window')!;

  image.hidden = slide.kind !== 'image';
  text.hidden = slide.kind !== 'text';
  sponsors.hidden = slide.kind !== 'sponsors';

  if (slide.kind === 'image') {
    image.src = slide.url;
  } else if (slide.kind === 'sponsors') {
    renderSponsorWindow(slide.urls, slide.page, slide.pages);
  } else {
    document.getElementById('slide-title')!.textContent = ANNOUNCEMENTS_TITLE;

    const list = document.getElementById('slide-lines')!;
    list.innerHTML = '';
    for (const line of slide.lines) {
      const item = document.createElement('li');
      item.textContent = line;
      list.appendChild(item);
    }
  }

  document.body.classList.add('showing-slide');
}

function stopSlideshow(): void {
  if (slideTimer) clearTimeout(slideTimer);
  slideTimer = null;
  slideDeck = [];
  slideIndex = 0;
  activeSlide = null;
  document.body.classList.remove('showing-slide');
}

function advanceSlide(): void {
  slideIndex = (slideIndex + 1) % slideDeck.length;
  showSlide(slideDeck[slideIndex]);
  slideTimer = setTimeout(advanceSlide, SLIDE_DURATION_MS);
}

/**
 * Startet oder beendet die Diashow. Sie läuft ausschließlich auf
 * Knopfdruck (Nutzerwunsch) -- die Anzeige rotiert nie von selbst los.
 *
 * Die Folge wird nur beim Start zusammengestellt, nicht bei jedem
 * Zustands-Update: Sonst spränge die Rotation bei jedem Tastendruck im
 * Steuerungsfenster zurück auf die erste Folie.
 */
function handleSlideshowRequest(state: MatchState): void {
  const request = state.slideshowRequest;

  if (request === null) {
    if (lastSlideshowId !== 0) {
      lastSlideshowId = 0;
      stopSlideshow();
    }
    return;
  }

  if (request.id === lastSlideshowId) return;
  lastSlideshowId = request.id;

  stopSlideshow();
  slideDeck = buildSlideDeck(state);

  // Nur die normale Ansicht ist keine Diashow -- dann bleibt die Anzeige
  // wie sie ist, statt still auf einer leeren Fläche zu stehen. Das
  // Steuerungsfenster weist auf den leeren Medienordner hin.
  if (slideDeck.length < 2) {
    slideDeck = [];
    return;
  }

  // Mit der ersten echten Folie beginnen: Die normale Ansicht steht
  // ohnehin schon auf der Tafel, sie gleich wieder zu "zeigen" sähe aus,
  // als hätte der Knopf nichts bewirkt.
  slideIndex = 1;
  showSlide(slideDeck[slideIndex]);
  slideTimer = setTimeout(advanceSlide, SLIDE_DURATION_MS);
}

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
  return 'showing-info';
}

/**
 * Zeigt die Info-Leiste für eine neue Anfrage. Aufbau wie bei der
 * Torschützen-Einblendung: Die fortlaufende Id verhindert, dass dieselbe
 * Einblendung bei jedem Zustands-Update neu anläuft.
 */
function handleInfoRequest(state: MatchState): void {
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
  activeInfoOverlay = request.overlay;

  if (infoTimer) clearTimeout(infoTimer);
  infoTimer = setTimeout(() => {
    clearInfoOverlay();
    infoTimer = null;
  }, infoOverlayDurationMs(request.overlay));
}

/**
 * Blendet einen Torschützen mit Portrait ein. Anders als der Torjubel
 * wird das bewusst manuell ausgelöst -- meist erst, wenn der Name
 * nachgetragen wurde.
 */
function handleScorerRequest(state: MatchState): void {
  const request = state.scorerRequest;

  if (request === null) {
    if (lastScorerRequestId !== 0) {
      lastScorerRequestId = 0;
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

  const player = goal.scorerId
    ? state.squads[goal.team].find((p) => p.id === goal.scorerId)
    : undefined;

  const photo = document.getElementById('spotlight-photo') as HTMLImageElement;
  if (player?.photoDataUrl) {
    photo.src = player.photoDataUrl;
    photo.hidden = false;
  } else {
    photo.hidden = true;
  }

  document.getElementById('spotlight-label')!.textContent = `TOR · ${formatEventMinute(goal)}`;
  document.getElementById('spotlight-name')!.textContent = player
    ? playerLabel(player)
    : state[goal.team].name;
  document.getElementById('spotlight-meta')!.textContent =
    `${state[goal.team].name} · ${goal.scoreHome}:${goal.scoreAway}`;

  activeScorerEventId = request.eventId;
  document.body.classList.add('showing-scorer');
  if (scorerTimer) clearTimeout(scorerTimer);
  scorerTimer = setTimeout(() => {
    document.body.classList.remove('showing-scorer');
    scorerTimer = null;
  }, SCORER_DISPLAY_MS);
}

/**
 * Reagiert auf die Aufstellungs-Knöpfe. Eine neue Anforderung startet die
 * Einblendung; ein zurückgesetzter Wunsch beendet sie sofort.
 */
function handleLineupRequest(state: MatchState): void {
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

function main(): void {
  applyBoardSize();
  window.addEventListener('resize', () => step('Bühne', applyBoardSize));

  window.api.onStateUpdated(renderState);
  window.api.onClockTick((clock) => step('Uhr-Tick', () => renderClock(clock)));
  window.api.requestState();

  // Eigener Takt für den Countdown: der läuft unabhängig von der Spieluhr,
  // die vor dem Anpfiff ja noch steht.
  setInterval(() => {
    renderKickoffCountdown();
    requestRetroPaint();
  }, 1000);

  // Standardansicht vor dem Anpfiff ist die Begegnung
  showPage('matchup');

  // Die Retro-Matrix folgt den Body-Klassen: Torjubel-Stufen, Einblendungen,
  // Diashow und Aufstellungsseiten wechseln über Zeitschalter, nicht über
  // einen neuen Zustand. Ein Beobachter erspart es, an jeder dieser
  // Stellen einzeln ans Neuzeichnen zu denken.
  new MutationObserver(requestRetroPaint).observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ['class', 'data-goal-stage', 'data-phase', 'data-theme', 'data-retro-color'],
  });
}

document.addEventListener('DOMContentLoaded', main);
