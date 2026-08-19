/**
 * Spieluhr: Laufverhalten, Halbzeitwechsel und die Anzeige von Spielzeit
 * und Nachspielzeit.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, MIN } = require('./helpers');

stubElectron();
const { MatchStateStore } = load('main/state');
const { clockView, formatClock, parseClockInput } = load('shared/types');

test('Uhr läuft in Echtzeit und nicht doppelt', async () => {
  const store = new MatchStateStore();
  store.startClock();
  // Zweiter Aufruf darf kein zweites Intervall setzen -- sonst tickte die
  // Uhr doppelt so schnell.
  store.startClock();

  await new Promise((resolve) => setTimeout(resolve, 600));
  store.stopClock();

  const elapsed = store.getState().clock.elapsedMs;
  assert.ok(elapsed > 450 && elapsed < 800, `Uhrstand unplausibel: ${elapsed}ms`);
});

test('Stoppen räumt den Timer auch bei bereits stehendem Flag ab', () => {
  const store = new MatchStateStore();
  store.startClock();
  store.stopClock();
  // Zweites Stoppen darf nicht werfen und nichts verändern.
  const vorher = store.getState().clock.elapsedMs;
  store.stopClock();
  assert.equal(store.getState().clock.elapsedMs, vorher);
  assert.equal(store.getState().clock.running, false);
});

test('Spielzeit lässt sich von Hand setzen', () => {
  const store = new MatchStateStore();
  store.setClock(67 * MIN);
  assert.equal(store.getState().clock.elapsedMs, 67 * MIN);

  // Unsinnige Werte lassen die Uhr unangetastet
  store.setClock(NaN);
  assert.equal(store.getState().clock.elapsedMs, 67 * MIN);

  // Negative Werte landen bei 0 statt im Minus
  store.setClock(-5000);
  assert.equal(store.getState().clock.elapsedMs, 0);
});

test('2. Halbzeit beginnt bei der Halbzeitdauer, auch nach Nachspielzeit', () => {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  // 1. Halbzeit lief mit Nachspielzeit bis 48:00
  store.setClock(48 * MIN);
  store.goToHalfTime();

  store.startSecondHalf();
  store.stopClock();

  assert.equal(store.getState().clock.elapsedMs, 45 * MIN);
  assert.equal(store.getState().half, 2);
});

test('zurückgenommene 2. Halbzeit setzt den Uhrstand fort', () => {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();

  // Mitten in der 2. Halbzeit versehentlich zurückgenommen
  store.setClock(58 * MIN);
  store.revertPhase();
  assert.equal(store.getState().phase, 'half-time');

  store.startSecondHalf();
  store.stopClock();
  assert.equal(store.getState().clock.elapsedMs, 58 * MIN);
});

test('nach Rücknahme in die 1. Halbzeit gilt wieder der Normalfall', () => {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();
  store.setClock(58 * MIN);

  // Zurück in die Halbzeitpause, von dort weiter zurück in die 1. Halbzeit
  store.revertPhase();
  store.revertPhase();
  assert.equal(store.getState().half, 1);

  // Der gemerkte Fortsetzungswert darf jetzt nicht mehr greifen
  store.stopClock();
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();
  assert.equal(store.getState().clock.elapsedMs, 45 * MIN);
});

test('Anzeige: Uhr läuft über die reguläre Zeit hinaus weiter', () => {
  // Anders als früher bleibt die Uhr NICHT bei 45:00 stehen.
  const view = clockView(47 * MIN + 30 * 1000, 1, 45, 0);
  assert.equal(formatClock(view.displayMs), '47:30');
  assert.equal(view.stoppage, null);
});

test('Anzeige: vorgegebene Nachspielzeit erscheint erst nach der regulären Zeit', () => {
  // Schiedsrichter zeigt +3 an, es sind aber erst 43 Minuten gespielt
  assert.equal(clockView(43 * MIN, 1, 45, 3).stoppage, null);

  // Ab der Überschreitung steht die Vorgabe auf der Tafel -- und zwar
  // unverändert, egal wie viel davon schon gespielt ist.
  assert.equal(clockView(45 * MIN + 1, 1, 45, 3).stoppage, 3);
  assert.equal(clockView(47 * MIN, 1, 45, 3).stoppage, 3);
  assert.equal(clockView(48 * MIN, 1, 45, 3).stoppage, 3);
});

test('Anzeige: ohne Vorgabe bleibt die Nachspielzeit leer', () => {
  assert.equal(clockView(48 * MIN, 1, 45, 0).stoppage, null);
});

test('Anzeige: 2. Halbzeit rechnet gegen die doppelte Halbzeitdauer', () => {
  assert.equal(clockView(89 * MIN, 2, 45, 2).stoppage, null);
  assert.equal(clockView(91 * MIN, 2, 45, 2).stoppage, 2);
  // Kürzere Halbzeiten im Jugendbereich
  assert.equal(clockView(71 * MIN, 2, 35, 1).stoppage, 1);
});

test('Nachspielzeit wird bei jedem Anpfiff zurückgesetzt', () => {
  const store = new MatchStateStore();
  store.kickoff();
  store.setStoppage(3);
  assert.equal(store.getState().stoppageMinutes, 3);

  store.stopClock();
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();
  assert.equal(store.getState().stoppageMinutes, 0);
});

test('Nachspielzeit wird auf sinnvolle Werte begrenzt', () => {
  const store = new MatchStateStore();
  assert.equal(store.getState().stoppageMinutes, 0);

  store.setStoppage(-2);
  assert.equal(store.getState().stoppageMinutes, 0);

  store.setStoppage(99);
  assert.equal(store.getState().stoppageMinutes, 20);

  store.setStoppage(NaN);
  assert.equal(store.getState().stoppageMinutes, 20);

  store.setStoppage(0);
  assert.equal(store.getState().stoppageMinutes, 0);
});

test('Spielzeit-Eingabe liest MM:SS und reine Minuten', () => {
  assert.equal(parseClockInput('67:30'), (67 * 60 + 30) * 1000);
  assert.equal(parseClockInput('67'), 67 * MIN);
  assert.equal(parseClockInput('0'), 0);
  assert.equal(parseClockInput('5:07'), (5 * 60 + 7) * 1000);
  assert.equal(parseClockInput('  45:00  '), 45 * MIN);
});

test('Spielzeit-Eingabe weist Unsinn ab', () => {
  for (const eingabe of ['', 'abc', '45:75', '999', '45,30', '-5', '4:5:6']) {
    assert.equal(parseClockInput(eingabe), null, `"${eingabe}" hätte null ergeben müssen`);
  }
});
