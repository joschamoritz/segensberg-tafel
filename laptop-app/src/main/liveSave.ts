import { dialog } from 'electron';
import { ctx } from './context';
import { clearLiveMatch, isResumable, loadLiveMatch, syncLiveMatch } from './liveMatch';

/**
 * Abstand zwischen zwei Sicherungen des laufenden Spiels. Die Uhr ändert
 * den Zustand fünfmal pro Sekunde -- ungedrosselt zu schreiben hieße, die
 * Platte während des ganzen Spiels dauerhaft zu beschäftigen. Bei einem
 * Absturz gehen höchstens diese fünf Sekunden verloren.
 */
const LIVE_SAVE_INTERVAL_MS = 5000;
let liveSaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Merkt vor, dass der Spielstand gesichert werden soll. Mehrere Änderungen
 * innerhalb des Drosselfensters führen zu einem einzigen Schreibvorgang.
 */
export function scheduleLiveMatchSave(): void {
  if (liveSaveTimer) return;
  liveSaveTimer = setTimeout(flushLiveMatchSave, LIVE_SAVE_INTERVAL_MS);
}

/**
 * Schreibt sofort. Wird an den Stellen aufgerufen, an denen ein Verlust
 * besonders weh täte: bei jedem Phasenwechsel und beim Beenden.
 */
export function flushLiveMatchSave(): void {
  if (liveSaveTimer) {
    clearTimeout(liveSaveTimer);
    liveSaveTimer = null;
  }
  if (!ctx.store) return;
  syncLiveMatch(ctx.store.getState());
}

/** Verwirft die Sicherung samt vorgemerktem Schreibvorgang. */
export function discardLiveMatch(): void {
  if (liveSaveTimer) {
    clearTimeout(liveSaveTimer);
    liveSaveTimer = null;
  }
  clearLiveMatch();
}

/**
 * Bietet nach einem Absturz oder versehentlichen Beenden an, das
 * abgebrochene Spiel fortzusetzen. Die Rückfrage kommt bewusst VOR dem
 * Öffnen der Fenster -- sonst blitzte auf der Anzeigetafel für einen
 * Moment ein 0:0 auf, bevor der echte Spielstand steht.
 */
export function maybeResumeLiveMatch(): void {
  const snapshot = loadLiveMatch();
  if (!snapshot) return;

  if (!isResumable(snapshot)) {
    // Zu alt oder gar nicht erst angepfiffen: wortlos verwerfen.
    clearLiveMatch();
    return;
  }

  const savedAt = new Date(snapshot.savedAt);
  const time = `${String(savedAt.getHours()).padStart(2, '0')}:${String(
    savedAt.getMinutes()
  ).padStart(2, '0')}`;
  const minutes = Math.floor(snapshot.elapsedMs / 60000);
  const phaseText =
    snapshot.phase === 'half-time'
      ? 'Halbzeitpause'
      : snapshot.phase === 'full-time'
        ? 'nach Abpfiff'
        : `${snapshot.half}. Halbzeit, ${minutes}. Minute`;

  const choice = dialog.showMessageBoxSync({
    type: 'question',
    title: 'Letztes Spiel fortsetzen?',
    message: `${snapshot.home.name} ${snapshot.home.score}:${snapshot.away.score} ${snapshot.away.name}`,
    detail:
      `Zuletzt gesichert um ${time} Uhr (${phaseText}).\n\n` +
      'Beim Fortsetzen werden Spielstand, Chronik und Uhrstand übernommen. ' +
      'Die Uhr bleibt zunächst angehalten und wird per "Start" fortgesetzt.',
    buttons: ['Spiel fortsetzen', 'Neues Spiel beginnen'],
    defaultId: 0,
    cancelId: 0,
  });

  if (choice === 0) {
    ctx.store.restoreLiveMatch(snapshot);
  } else {
    clearLiveMatch();
  }
}
