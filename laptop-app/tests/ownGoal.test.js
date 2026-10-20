/**
 * Eigentor (Review 2026-10, W10).
 *
 * Bis 1.6.0 bot die Auswahl nur den Kader der treffenden Mannschaft an.
 * Bei einem Eigentor ist der Schütze aber ein Gegenspieler -- es blieb nur
 * "kein Torschütze" oder ein falscher Name aus der eigenen Mannschaft.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const { buildScorerRows } = load('shared/scorerRows');

const KOWALSKI = player({ id: 'g4', number: 4, firstName: 'Jan', lastName: 'Kowalski' });
const LANGE = player({ id: 'h9', number: 9, firstName: 'Tim', lastName: 'Lange' });

/** Heimtor 1:0, danach als Eigentor des Gästespielers Kowalski markiert. */
function mitEigentor() {
  const store = new MatchStateStore();
  store.setSquad('home', [LANGE]);
  store.setSquad('away', [KOWALSKI]);
  store.kickoff();
  store.stopClock();
  store.incrementScore('home', 1);
  const tor = store.getState().events.at(-1).id;
  store.setGoalOwnGoal(tor, true);
  store.setGoalScorer(tor, 'g4');
  return { store, tor };
}

test('Markieren als Eigentor leert einen schon gewählten Schützen', () => {
  const store = new MatchStateStore();
  store.setSquad('home', [LANGE]);
  store.incrementScore('home', 1);
  const tor = store.getState().events.at(-1).id;
  store.setGoalScorer(tor, 'h9');

  const vorher = store.getState().revisions.events;
  store.setGoalOwnGoal(tor, true);
  const goal = store.getState().events.at(-1);
  assert.equal(goal.ownGoal, true);
  assert.equal(goal.scorerId, undefined, 'Lange gehört zum falschen Kader');
  assert.ok(store.getState().revisions.events > vorher, 'die Chronik muss neu zeichnen');

  // Gleicher Wert noch einmal: nichts zu tun
  const danach = store.getState().revisions.events;
  store.setGoalOwnGoal(tor, true);
  assert.equal(store.getState().revisions.events, danach);
});

test('Torschützenliste: Eigentor steht bei der begünstigten Mannschaft mit "(ET)"', () => {
  const { store } = mitEigentor();
  const s = store.getState();
  const rows = buildScorerRows('home', s.events, s.squads.home, s.squads.away);
  assert.deepEqual(rows.map((r) => r.name), ['Kowalski (ET)']);
  assert.deepEqual(buildScorerRows('away', s.events, s.squads.away, s.squads.home), []);
});

test('Torschützenliste: Eigentor ohne Namen bleibt als Eigentor erkennbar', () => {
  const store = new MatchStateStore();
  store.incrementScore('away', 1);
  store.setGoalOwnGoal(store.getState().events.at(-1).id, true);
  const s = store.getState();
  assert.deepEqual(buildScorerRows('away', s.events, [], []).map((r) => r.name), ['Eigentor']);
});

test('Chronik: der ET-Schalter meldet sich, und die Auswahl bietet dann den Gegnerkader an', (t) => {
  const { store, tor } = mitEigentor();
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());

  const zeile = r.document.querySelector('#goal-log li.is-goal');
  const knopf = zeile.querySelector('.own-goal-toggle');
  assert.equal(knopf.getAttribute('aria-pressed'), 'true');
  const angeboten = [...zeile.querySelectorAll('select option')].map((o) => o.value).filter(Boolean);
  assert.deepEqual(angeboten, ['g4']);
  assert.equal(zeile.querySelector('select').value, 'g4');

  r.calls.length = 0;
  knopf.click();
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [{ name: 'goalSetOwnGoal', args: [tor, false] }]);
  assert.deepEqual(r.drainErrors(), []);
});

test('Tafel: Liste und Torschützen-Einblendung nennen das Eigentor', (t) => {
  const { store, tor } = mitEigentor();
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());
  assert.match(r.document.getElementById('home-scorers').textContent, /Kowalski \(ET\)/);

  store.showScorer(tor);
  r.emit('onStateUpdated', store.getState());
  assert.match(r.document.getElementById('spotlight-label').textContent, /^EIGENTOR/);
  assert.match(r.document.getElementById('spotlight-name').textContent, /Kowalski/);
  assert.deepEqual(r.drainErrors(), []);
});
