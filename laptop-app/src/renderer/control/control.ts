import { FORMATION_IDS, isFormation } from '../../shared/formations';
import { controlPhaseLabel, revertTargetLabel } from '../../shared/phaseLabels';
import {
  CardColor,
  ClockState,
  clockView,
  DEFAULT_HALF_DURATION_MIN,
  DisplayTheme,
  FlutlichtEffects,
  formatClock,
  formatEventMinute,
  goalScorer,
  GoalEvent,
  MatchState,
  parseClockInput,
  playerLabel,
  RetroColor,
  TeamId,
} from '../../shared/types';
import { LINEUP_STYLES } from '../../shared/types';
import { showError, ui, updateInputIfNotFocused } from './common';
import { renderGoalLog } from './chronicle';
import { renderInfoControls, renderLineupControls, renderSlideshowControls, wireInfoControls } from './infoControls';
import {
  renderAppearanceControls,
  renderAppVersion,
  renderCompetitionSelect,
  renderSponsorSlotSelects,
  renderDurationInputs,
  wireDurationInputs,
  wireSponsorSlots,
  renderLibrary,
  renderStatus,
  renderTeamSettings,
  wireBoardLink,
  wireSetupPanels,
  wireTeamSettings,
} from './setup';
import { renderShootoutControls } from './shootout';
import { playGoalSound, renderSoundControls, stopGoalSound } from './sound';
import { renderSquad, wireLineupPaste } from './squadEditor';

// Aufbau der Steuerung (siehe laptop-app/README.md):
//   control.ts       Spielstand, Uhr, Phasen, renderState() und main()
//   common.ts        Fehlerbanner, Fokus-Merker, Render-Signaturen, `ui`
//   chronicle.ts     Chronik (Tore, Karten, Wechsel)
//   squadEditor.ts   Kader-Editor und Einfügefeld
//   setup.ts         Einrichtungsflächen, Status, Fernsteuerung
//   infoControls.ts  Aufstellung, Ecken, Zuschauer, Diashow
//   sound.ts         Tormusik
//   shootout.ts      Elfmeterschießen
//
// Die Verdrahtung läuft genau einmal in main(): Rund zwei Dutzend
// Element-Verweise leben danach in Closures, ausgetauschte Knoten wären
// lautlos tot.

/**
 * Schaltet die Phasen-Buttons: `enabled` spiegelt exakt, was der Store
 * erlaubt, `next` hebt zusätzlich den im normalen Spielverlauf fälligen
 * Schritt hervor. Abpfiff ist bewusst auch in der 1. Halbzeit möglich
 * (Spielabbruch wegen Wetter/Verletzung), nur eben nicht hervorgehoben.
 */
function renderPhaseControls(state: MatchState): void {
  document.getElementById('phase-current-label')!.textContent = controlPhaseLabel(state.phase, state.half);

  const isLive = state.phase === 'live';
  const buttons: Record<string, { enabled: boolean; next: boolean }> = {
    'phase-kickoff': {
      enabled: state.phase === 'pre-match',
      next: state.phase === 'pre-match',
    },
    'phase-halftime': {
      enabled: isLive && state.half === 1,
      next: isLive && state.half === 1,
    },
    'phase-second-half': {
      enabled: state.phase === 'half-time',
      next: state.phase === 'half-time',
    },
    'phase-fulltime': {
      enabled: isLive,
      next: isLive && state.half === 2,
    },
  };

  for (const [id, { enabled, next }] of Object.entries(buttons)) {
    const btn = document.getElementById(id) as HTMLButtonElement;
    btn.disabled = !enabled;
    btn.classList.toggle('btn-next', next);
  }

  // "Neues Spiel" ist der einzige Schritt ohne Rückweg: Spielstand,
  // Chronik und Absturzsicherung sind danach weg. Im laufenden Spiel und in
  // der Pause stand er als roter Knopf direkt neben "Abpfiff"
  // (Nutzerentscheidung 20.10.2026, Review W8). Für einen Abbruch zuerst
  // abpfeifen.
  const reset = document.getElementById('match-reset') as HTMLButtonElement;
  const matchRunning = isLive || state.phase === 'half-time';
  reset.disabled = matchRunning;
  reset.title = matchRunning ? 'Erst nach dem Abpfiff -- für einen Abbruch zuerst „Abpfiff“.' : '';

  // Rückfallebene für versehentliche Phasenwechsel
  const revert = document.getElementById('phase-revert') as HTMLButtonElement;
  const target = revertTargetLabel(state.phase, state.half);
  revert.disabled = target === null;
  revert.title = target === null ? '' : `Zurück zu: ${target}`;
}

/**
 * Uhr und Nachspielzeit. Wird sowohl aus dem vollständigen Zustand als auch
 * aus dem schlanken Uhr-Tick aufgerufen; Halbzeit und Halbzeitdauer kommen
 * dabei aus dem zuletzt empfangenen Zustand.
 */
function renderClock(clock: ClockState): void {
  const view = clockView(
    clock.elapsedMs,
    ui.lastRenderedState?.half ?? 1,
    ui.lastRenderedState?.halfDurationMin ?? DEFAULT_HALF_DURATION_MIN,
    ui.lastRenderedState?.stoppageMinutes ?? 0
  );
  document.getElementById('clock-display')!.textContent = formatClock(view.displayMs);

  const stoppage = document.getElementById('stoppage-display')!;
  stoppage.textContent = view.stoppage === null ? '' : `+${view.stoppage}`;
  stoppage.hidden = view.stoppage === null;
}

/**
 * Hebt den gesetzten Wert hervor und hält das Eingabefeld für größere
 * Werte auf Stand.
 */
function renderStoppageControls(state: MatchState): void {
  const current = state.stoppageMinutes;

  for (const btn of document.querySelectorAll<HTMLButtonElement>('#stoppage-buttons button')) {
    btn.classList.toggle('is-active', Number(btn.dataset.stoppage) === current);
  }

  const input = document.getElementById('stoppage-input') as HTMLInputElement;
  updateInputIfNotFocused(input, current === 0 ? '' : String(current));
}

function renderState(state: MatchState): void {
  ui.lastRenderedState = state;
  document.getElementById('home-score')!.textContent = String(state.home.score);
  document.getElementById('away-score')!.textContent = String(state.away.score);
  renderClock(state.clock);

  document.getElementById('half-display')!.textContent = `${state.half}. Halbzeit`;

  document.getElementById('home-team-label')!.textContent = state.home.name;
  document.getElementById('away-team-label')!.textContent = state.away.name;

  const kickoffInput = document.getElementById('kickoff-input') as HTMLInputElement;
  updateInputIfNotFocused(kickoffInput, state.kickoffTime);

  const halfDurationInput = document.getElementById('half-duration-input') as HTMLInputElement;
  updateInputIfNotFocused(halfDurationInput, String(state.halfDurationMin));

  renderCompetitionSelect(state);
  renderSponsorSlotSelects(state);
  renderDurationInputs(state);

  const boardWidthInput = document.getElementById('board-width-input') as HTMLInputElement;
  const boardHeightInput = document.getElementById('board-height-input') as HTMLInputElement;
  updateInputIfNotFocused(boardWidthInput, String(state.board.width));
  updateInputIfNotFocused(boardHeightInput, String(state.board.height));

  renderAppearanceControls(state);
  renderStoppageControls(state);
  renderPhaseControls(state);
  renderLineupControls(state);
  renderInfoControls(state);
  renderSlideshowControls(state);
  renderShootoutControls(state);
  renderSoundControls(state);
  renderGoalLog(state);
  renderSquad('home', state);
  renderSquad('away', state);
  renderTeamSettings('home', state);
  renderTeamSettings('away', state);
}

function main(): void {
  renderAppVersion();
  window.api.onStateUpdated(renderState);
  window.api.onClockTick(renderClock);
  window.api.onStatusUpdated(renderStatus);

  // Tormusik, ausgelöst an einem Gerät im WLAN -- gespielt wird hier.
  window.api.onSoundCommand((command) => {
    if (command === 'play') playGoalSound();
    else stopGoalSound();
  });

  const remoteToggle = document.getElementById('remote-enabled') as HTMLInputElement;
  remoteToggle.addEventListener('change', () => window.api.remoteSetEnabled(remoteToggle.checked));
  document.getElementById('remote-new-pin')!.addEventListener('click', () => {
    if (confirm('Neue PIN vergeben? Verbundene Geräte müssen sie danach neu eingeben.')) {
      window.api.remoteNewPin();
    }
  });
  window.api.onLibraryUpdated(renderLibrary);
  window.api.requestState();
  window.api.requestStatus();
  window.api.requestLibrary();

  const kickoffInput = document.getElementById('kickoff-input') as HTMLInputElement;
  kickoffInput.addEventListener('change', () => window.api.setKickoffTime(kickoffInput.value));

  const halfDurationInput = document.getElementById('half-duration-input') as HTMLInputElement;
  halfDurationInput.addEventListener('change', () =>
    window.api.setHalfDuration(Number(halfDurationInput.value))
  );

  wireSponsorSlots();
  wireDurationInputs();

  const competitionSelect = document.getElementById('competition-select') as HTMLSelectElement;
  competitionSelect.addEventListener('change', () =>
    window.api.setCompetition(competitionSelect.value === '' ? null : competitionSelect.value)
  );

  // Beide Maße gehen immer gemeinsam raus: Die Prüfschicht behandelt einen
  // unbrauchbaren Einzelwert für sich, aber der Zustand kennt nur ein
  // vollständiges Paar. `change` statt `input` -- beim Tippen von "384"
  // wäre "3" ein Zwischenstand, der die Bühne kurz auf das Mindestmaß
  // zöge.
  const boardWidthInput = document.getElementById('board-width-input') as HTMLInputElement;
  const boardHeightInput = document.getElementById('board-height-input') as HTMLInputElement;
  const sendBoardSize = () =>
    window.api.setBoardSize({
      width: Number(boardWidthInput.value),
      height: Number(boardHeightInput.value),
    });
  boardWidthInput.addEventListener('change', sendBoardSize);
  boardHeightInput.addEventListener('change', sendBoardSize);

  // Design und Effekte gehen immer gemeinsam raus, aus dem Stand der
  // Bedienelemente -- so kann ein Schalter nie einen veralteten Wert der
  // übrigen mitschicken.
  const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
  const fxBoxes = Array.from(
    document.querySelectorAll<HTMLInputElement>('#fx-switches input[data-fx]')
  );
  const retroColorSelect = document.getElementById('retro-color-select') as HTMLSelectElement;
  const sendAppearance = () => {
    const effects = {} as FlutlichtEffects;
    for (const box of fxBoxes) effects[box.dataset.fx as keyof FlutlichtEffects] = box.checked;
    window.api.setAppearance({
      theme: themeSelect.value as DisplayTheme,
      effects,
      retroColor: retroColorSelect.value as RetroColor,
    });
  };
  themeSelect.addEventListener('change', sendAppearance);
  retroColorSelect.addEventListener('change', sendAppearance);
  for (const box of fxBoxes) box.addEventListener('change', sendAppearance);

  document
    .getElementById('library-folder')!
    .addEventListener('click', () => window.api.libraryChooseFolder());
  document
    .getElementById('library-reload')!
    .addEventListener('click', () => window.api.requestLibrary());

  document.querySelectorAll<HTMLButtonElement>('button[data-team]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const team = btn.dataset.team as TeamId;
      const delta = Number(btn.dataset.delta);
      if (delta < 0 && !confirmGoalRemoval(team)) return;
      window.api.incrementScore(team, delta);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('button[data-card-team]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.api.cardAdd(btn.dataset.cardTeam as TeamId, btn.dataset.card as CardColor);
    });
  });

  wireSetupPanels();
  wireBoardLink();
  wireInfoControls();

  wireClockSet();
  wireStoppage();

  document.getElementById('clock-start')!.addEventListener('click', () => window.api.clockStart());
  document.getElementById('clock-stop')!.addEventListener('click', () => window.api.clockStop());
  document.getElementById('clock-reset')!.addEventListener('click', () => {
    if (confirm('Uhr wirklich zurücksetzen?')) window.api.clockReset();
  });

  // Jeder Phasenwechsel wird bestätigt -- ein versehentlicher Abpfiff
  // mitten im Spiel ist am Spielfeldrand sonst schnell passiert.
  const confirmPhase = (question: string, action: () => void) => () => {
    if (confirm(question)) action();
  };

  document
    .getElementById('phase-kickoff')!
    .addEventListener('click', () => {
      const frage = ui.lastRenderedState ? kickoffQuestion(ui.lastRenderedState) : 'Anpfiff?';
      if (confirm(frage)) window.api.phaseKickoff();
    });
  document
    .getElementById('phase-halftime')!
    .addEventListener('click', confirmPhase('Halbzeitpfiff? Die Uhr wird angehalten.', () => window.api.phaseHalfTime()));
  document
    .getElementById('phase-second-half')!
    .addEventListener('click', confirmPhase('2. Halbzeit anpfeifen? Die Uhr läuft weiter.', () => window.api.phaseSecondHalf()));
  document
    .getElementById('phase-fulltime')!
    .addEventListener('click', confirmPhase('Abpfiff? Das Spiel wird beendet.', () => window.api.phaseFullTime()));

  document.getElementById('phase-revert')!.addEventListener('click', () => {
    const target = ui.lastRenderedState
      ? revertTargetLabel(ui.lastRenderedState.phase, ui.lastRenderedState.half)
      : null;
    if (target && confirm(`Phasenwechsel zurücknehmen und zurück zu "${target}"?`)) {
      window.api.phaseRevert();
    }
  });
  document
    .getElementById('lineup-show-home')!
    .addEventListener('click', () => window.api.showLineup('home'));
  document
    .getElementById('lineup-show-away')!
    .addEventListener('click', () => window.api.showLineup('away'));
  document.getElementById('lineup-hide')!.addEventListener('click', () => window.api.hideLineup());
  const lineupStyle = document.getElementById('lineup-style') as HTMLSelectElement;
  lineupStyle.addEventListener('change', () => {
    const value = LINEUP_STYLES.find((style) => style === lineupStyle.value) ?? 'overview';
    window.api.setLineupStyle(value);
  });
  const formation = document.getElementById('lineup-formation') as HTMLSelectElement;
  for (const id of FORMATION_IDS) formation.appendChild(new Option(id, id));
  formation.addEventListener('change', () => {
    if (isFormation(formation.value)) window.api.setFormation(formation.value);
  });

  document.getElementById('match-reset')!.addEventListener('click', () => {
    if (confirm('Neues Spiel starten? Spielstand und Uhr werden zurückgesetzt.')) {
      window.api.matchReset();
    }
  });

  document
    .getElementById('display-reopen')!
    .addEventListener('click', () => window.api.reopenDisplay());

  document.getElementById('display-select')!.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    window.api.selectDisplay(value === '' ? null : Number(value));
  });

  wireTeamSettings('home');
  wireTeamSettings('away');

  for (const team of ['home', 'away'] as TeamId[]) {
    document
      .getElementById(`${team}-squad-add`)!
      .addEventListener('click', () => window.api.squadAddPlayer(team));

    const coachInput = document.getElementById(`${team}-coach-input`) as HTMLInputElement;
    coachInput.addEventListener('change', () => window.api.teamSetCoach(team, coachInput.value));

    const squadSelect = document.getElementById(`${team}-squad-select`) as HTMLSelectElement;
    squadSelect.addEventListener('change', () => {
      const name = squadSelect.value;
      if (!name) return;
      squadSelect.value = '';
      // Rückfrage erst nach dem Auswahl-Ereignis stellen: Ein synchrones
      // confirm() mitten im change-Handler blockiert Chromiums
      // Auswahlmenü-Logik, danach reagieren für einige Sekunden ALLE
      // Auswahlfelder im Fenster nicht mehr.
      setTimeout(() => {
        if (confirm(`Kader "${name}" laden? Der aktuelle Kader wird ersetzt.`)) {
          window.api.squadLoadByName(team, name);
        }
      }, 0);
    });

    wireLineupPaste(team);
  }
}

/**
 * "−" am Spielstand nimmt das jüngste Tor dieser Mannschaft zurück -- samt
 * Minute und Torschütze. Ist ein Schütze schon eingetragen, wäre ein
 * Fehlklick nicht mehr mit "+" zu beheben: Das neue Tor stünde zur
 * aktuellen Minute und ohne Namen da. Dann wird nachgefragt
 * (Nutzerentscheidung 20.10.2026, Review W7); ohne Schützen bleibt "−" der
 * schnelle Gegenknopf zu "+".
 */
function confirmGoalRemoval(team: TeamId): boolean {
  const state = ui.lastRenderedState;
  if (!state) return true;
  const goal = [...state.events]
    .reverse()
    .find((e): e is GoalEvent => e.type === 'goal' && e.team === team);
  if (!goal || !goal.scorerId) return true;
  const scorer = goalScorer(goal, state.squads);
  const name = scorer ? playerLabel(scorer) : 'eingetragenem Torschützen';
  return confirm(
    `Tor von ${name} (${formatEventMinute(goal)}) zurücknehmen? Torschütze und Minute gehen dabei verloren.`
  );
}

/**
 * Rückfrage zum Anpfiff. Stehen schon Tore, Einträge oder Ecken da -- meist
 * vom Ausprobieren beim Aufbau --, nennt sie sie ausdrücklich: `kickoff()`
 * setzt nur die Uhr zurück, die Reste gingen sonst ins Spiel mit
 * (Review W6).
 */
function kickoffQuestion(state: MatchState): string {
  const reste: string[] = [];
  if (state.home.score > 0 || state.away.score > 0) {
    reste.push(`Spielstand ${state.home.score}:${state.away.score}`);
  }
  if (state.events.length > 0) {
    reste.push(state.events.length === 1 ? '1 Eintrag im Spielverlauf' : `${state.events.length} Einträge im Spielverlauf`);
  }
  if (state.corners.home > 0 || state.corners.away > 0) {
    reste.push(`Ecken ${state.corners.home}:${state.corners.away}`);
  }
  if (reste.length === 0) return 'Anpfiff? Die Uhr startet bei 00:00.';
  return (
    `Achtung, es steht schon etwas da: ${reste.join(', ')}.\n\n` +
    'Das geht so ins Spiel mit. Zum Leeren abbrechen und „Neues Spiel“ wählen.\n\n' +
    'Trotzdem anpfeifen?'
  );
}

/**
 * Nachspielzeit setzen. Bewusst ohne Rückfrage -- anders als beim Setzen
 * der Spielzeit ist hier nichts kaputtzumachen, und am Spielfeldrand muss
 * es schnell gehen.
 */
function wireStoppage(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#stoppage-buttons button')) {
    btn.addEventListener('click', () => {
      window.api.setStoppage(Number(btn.dataset.stoppage));
    });
  }

  const input = document.getElementById('stoppage-input') as HTMLInputElement;
  input.addEventListener('change', () => {
    const value = input.value === '' ? 0 : Number(input.value);
    if (!Number.isFinite(value)) return;
    window.api.setStoppage(value);
  });
}

/**
 * Notfall-Eingabe für die Spielzeit. Bewusst mit Rückfrage: Ein
 * versehentliches Verstellen mitten im Spiel wäre schlimmer als der
 * zusätzliche Klick.
 */
function wireClockSet(): void {
  const input = document.getElementById('clock-set-input') as HTMLInputElement;
  const hint = document.getElementById('clock-set-hint')!;
  const standardHinweis = hint.innerHTML;

  const apply = (): void => {
    const elapsedMs = parseClockInput(input.value);

    if (elapsedMs === null) {
      hint.textContent = 'Bitte als MM:SS oder in Minuten angeben, z. B. 67:30 oder 67.';
      hint.classList.add('is-error');
      input.focus();
      input.select();
      return;
    }

    hint.innerHTML = standardHinweis;
    hint.classList.remove('is-error');

    if (!confirm(`Spielzeit auf ${formatClock(elapsedMs)} setzen?`)) return;
    window.api.clockSet(elapsedMs);
    input.value = '';
    // Fokus abgeben, damit der nächste Zustand das Feld wieder pflegen darf.
    input.blur();
  };

  document.getElementById('clock-set-apply')!.addEventListener('click', apply);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') apply();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    main();
  } catch (error) {
    showError(`main() abgebrochen: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
});
