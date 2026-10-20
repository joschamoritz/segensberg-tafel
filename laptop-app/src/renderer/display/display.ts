import { buildScorerRows, visibleScorerRows } from '../../shared/scorerRows';
import {
  ClockState,
  clockView,
  DEFAULT_HALF_DURATION_MIN,
  DisplayAppearance,
  FLUTLICHT_EFFECT_KEYS,
  formatClock,
  MatchPhase,
  MatchState,
  mediaUrl,
  otherTeam,
  SHOOTOUT_ROUNDS,
  shootoutScore,
  TeamId,
} from '../../shared/types';
import { handleEvents } from './celebration';
import { phaseLabelText, renderCrest, renderDigits, step, ui } from './common';
import { handleLineupRequest, renderLineupPages, showPage } from './lineup';
import { handleInfoRequest, handleScorerRequest } from './overlays';
import { requestRetroPaint } from './retro';
import { handleSlideshowRequest } from './slideshow';

// Aufbau der Anzeige (siehe laptop-app/README.md):
//   display.ts      Bühne, Spielansicht, Uhr, renderState() und main()
//   common.ts       gemeinsamer Zustand (`ui`), step(), Wappen und Ziffern
//   celebration.ts  Torjubel
//   lineup.ts       Aufstellungsseiten
//   overlays.ts     Info-Leiste, Danksagung, Torschützen-Einblendung
//   slideshow.ts    Diashow
//   retro.ts        Retro-Design (Punktmatrix)
//
// Die Verdrahtung läuft genau einmal in main(); kein Modul tauscht Knoten aus.

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
  stage.style.setProperty('--board-w', `${ui.boardSize.width}px`);
  stage.style.setProperty('--board-h', `${ui.boardSize.height}px`);

  const scale = Math.min(
    window.innerWidth / ui.boardSize.width,
    window.innerHeight / ui.boardSize.height
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

/**
 * Ereignisse einer Mannschaft unter deren Wappen: Tore und Platzverweise.
 * Gelbe Karten bleiben bewusst draußen -- sonst wäre die Liste im Nu voll
 * und der Blick auf die Tore ginge verloren.
 */
function renderScorerList(team: TeamId, state: MatchState): void {
  const list = document.getElementById(`${team}-scorers`)!;
  list.innerHTML = '';

  const rows = buildScorerRows(team, state.events, state.squads[team], state.squads[otherTeam(team)]);
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
 * Wettbewerbslogo über der Begegnung. Nur wenn die Datei auch im Ordner
 * liegt -- ein zerbrochenes Bild wäre schlimmer als keines. `src` wird
 * nur bei einem Wechsel neu gesetzt, sonst lüde das Bild bei jedem
 * Zustands-Update neu.
 */
function renderCompetition(state: MatchState): void {
  const img = document.getElementById('pre-competition') as HTMLImageElement;
  const file = state.competition;
  const available = file !== null && state.media.wettbewerbe.files.includes(file);
  img.hidden = !available;
  document.body.classList.toggle('has-competition', available);
  if (!available) {
    img.removeAttribute('src');
    delete img.dataset.file;
    return;
  }
  if (img.dataset.file !== file) {
    img.dataset.file = file;
    img.src = mediaUrl('wettbewerbe', file);
  }
}

/**
 * Countdown bis zum geplanten Anstoß. Rein informativ -- der Anpfiff wird
 * weiterhin manuell ausgelöst, die Uhr startet nicht von selbst.
 */
function renderKickoffCountdown(): void {
  const element = document.getElementById('pre-kickoff')!;

  if (!ui.currentState || ui.currentState.phase !== 'pre-match') {
    element.textContent = '';
    return;
  }

  const kickoff = parseKickoffTime(ui.currentState.kickoffTime);
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

  element.textContent = `ANSTOSS ${ui.currentState.kickoffTime} UHR · NOCH ${countdown}`;
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
 * Elfmeterschießen: Vollbild, solange es läuft (siehe `Shootout`).
 * Gezeichnet wird bei jedem Zustand neu -- es sind höchstens ein paar
 * Dutzend Felder, und eine Signatur wäre hier mehr Code als Ersparnis.
 */
function renderShootout(state: MatchState): void {
  const shootout = state.shootout;
  const showing = state.phase === 'full-time' && shootout !== null && !shootout.finished;
  document.body.classList.toggle('showing-shootout', showing);
  if (!shootout) return;

  const score = shootoutScore(shootout);
  for (const team of ['home', 'away'] as TeamId[]) {
    renderCrest(`shootout-${team}-logo`, `shootout-${team}-fallback`, state[team]);
    renderDigits(document.getElementById(`shootout-${team}-score`)!, String(score[team]));

    const kicks = document.getElementById(`shootout-${team}-kicks`)!;
    kicks.textContent = '';
    const fields = Math.max(SHOOTOUT_ROUNDS, shootout[team].length);
    for (let i = 0; i < fields; i++) {
      const field = document.createElement('i');
      const kick = shootout[team][i];
      if (kick) field.className = kick === 'goal' ? 'is-goal' : 'is-miss';
      kicks.appendChild(field);
    }
  }
}

/**
 * Uhr und Nachspielzeit. Wird sowohl aus dem vollständigen Zustand als auch
 * aus dem schlanken Uhr-Tick aufgerufen; Halbzeit und Halbzeitdauer kommen
 * dabei aus dem zuletzt empfangenen Zustand.
 */
function renderClock(clock: ClockState): void {
  ui.lastClock = clock;
  requestRetroPaint();
  const view = clockView(
    clock.elapsedMs,
    ui.currentState?.half ?? 1,
    ui.currentState?.halfDurationMin ?? DEFAULT_HALF_DURATION_MIN,
    ui.currentState?.stoppageMinutes ?? 0
  );
  renderDigits(document.getElementById('clock-display')!, formatClock(view.displayMs));

  const stoppage = document.getElementById('stoppage-display')!;
  stoppage.textContent = view.stoppage === null ? '' : `+${view.stoppage}`;
  stoppage.hidden = view.stoppage === null;
}

function renderState(state: MatchState): void {
  const isFirstRender = ui.currentState === null;
  ui.currentState = state;
  document.body.dataset.phase = state.phase;

  step('Bühne', () => {
    if (
      state.board.width === ui.boardSize.width &&
      state.board.height === ui.boardSize.height &&
      !isFirstRender
    ) {
      return;
    }
    ui.boardSize = { ...state.board };
    applyBoardSize();
  });

  step('Darstellung', () => applyAppearance(state.appearance));

  step('Mannschaften', () => {
    renderTeam('home', state);
    renderTeam('away', state);
  });

  step('Wettbewerb', () => renderCompetition(state));

  step('Uhr', () => renderClock(state.clock));

  step('Phase', () => {
    document.getElementById('phase-label')!.textContent = phaseLabelText(state);
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

  step('Elfmeterschießen', () => renderShootout(state));
  step('Anstoß-Countdown', renderKickoffCountdown);
  step('Torjubel', () => handleEvents(state, isFirstRender));
  step('Aufstellungs-Einblendung', () => handleLineupRequest(state));
  step('Torschützen-Einblendung', () => handleScorerRequest(state));
  step('Info-Leiste', () => handleInfoRequest(state));
  step('Diashow', () => handleSlideshowRequest(state));
  requestRetroPaint();
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
