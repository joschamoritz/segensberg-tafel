import { MatchState, shootoutScore, ShootoutKick, TeamId } from '../../shared/types';

/**
 * Elfmeterschießen (Review 2026-10, W11). Starten nur nach dem Abpfiff;
 * solange es läuft, steht der Klapper offen -- dort sitzen die Knöpfe,
 * und es geht schnell.
 */
let shootoutWasRunning = false;

export function renderShootoutControls(state: MatchState): void {
  const shootout = state.shootout;
  const running = shootout !== null && !shootout.finished;

  (document.getElementById('shootout-start') as HTMLButtonElement).disabled =
    state.phase !== 'full-time' || shootout !== null;
  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    '#shootout-controls [data-shootout-team], #shootout-controls [data-shootout-undo]'
  )) {
    btn.disabled = !running;
  }
  (document.getElementById('shootout-finish') as HTMLButtonElement).disabled = !running;
  (document.getElementById('shootout-cancel') as HTMLButtonElement).disabled = shootout === null;

  document.getElementById('shootout-home-name')!.textContent = state.home.shortName;
  document.getElementById('shootout-away-name')!.textContent = state.away.shortName;

  const hint = document.getElementById('shootout-hint')!;
  if (shootout === null) {
    hint.textContent = state.phase === 'full-time' ? '' : 'Erst nach dem Abpfiff.';
  } else {
    const score = shootoutScore(shootout);
    hint.textContent =
      `${score.home}:${score.away} (${shootout.home.length}:${shootout.away.length} Schüsse)` +
      (shootout.finished ? ' – steht als „i. E.“ im Endstand.' : '');
  }

  if (running && !shootoutWasRunning) {
    const klapper = document.getElementById('shootout-controls')!.closest('details');
    if (klapper) klapper.open = true;
  }
  shootoutWasRunning = running;
}

/** Knöpfe des Elfmeterschießens. */
export function wireShootout(): void {
  document.getElementById('shootout-start')!.addEventListener('click', () => {
    if (confirm('Elfmeterschießen starten? Die Tafel zeigt dann die Schüsse.')) window.api.shootoutStart();
  });
  document.querySelectorAll<HTMLButtonElement>('button[data-shootout-team]').forEach((btn) => {
    btn.addEventListener('click', () =>
      window.api.shootoutKick(btn.dataset.shootoutTeam as TeamId, btn.dataset.shootoutKick as ShootoutKick)
    );
  });
  document.querySelectorAll<HTMLButtonElement>('button[data-shootout-undo]').forEach((btn) => {
    btn.addEventListener('click', () => window.api.shootoutUndo(btn.dataset.shootoutUndo as TeamId));
  });
  document.getElementById('shootout-finish')!.addEventListener('click', () => {
    if (confirm('Elfmeterschießen beenden? Das Ergebnis steht dann im Endstand.')) window.api.shootoutFinish();
  });
  document.getElementById('shootout-cancel')!.addEventListener('click', () => {
    if (confirm('Elfmeterschießen verwerfen? Alle Schüsse gehen verloren.')) window.api.shootoutCancel();
  });
}
