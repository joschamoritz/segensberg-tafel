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

// --------------------------------------------------------------------
// Strafstoß, Halbzeitstand, Abbruch, Spieler entfernen (Review N11-N14)
// --------------------------------------------------------------------

const { halfTimeScore } = load('shared/scorerRows');

test('Strafstoß: "(FE)" hinter dem Schützen, schließt Eigentor aus', () => {
  const store = new MatchStateStore();
  store.setSquad('home', [LANGE]);
  store.setSquad('away', [KOWALSKI]);
  store.incrementScore('home', 1);
  const tor = store.getState().events.at(-1).id;

  store.setGoalOwnGoal(tor, true);
  store.setGoalScorer(tor, 'g4');
  store.setGoalPenalty(tor, true);
  let goal = store.getState().events.at(-1);
  assert.equal(goal.penalty, true);
  assert.equal(goal.ownGoal, false);
  assert.equal(goal.scorerId, undefined, 'Kowalski gehört zum anderen Kader');

  store.setGoalScorer(tor, 'h9');
  const s = store.getState();
  assert.deepEqual(buildScorerRows('home', s.events, s.squads.home, s.squads.away).map((r) => r.name), ['Lange (FE)']);

  store.setGoalOwnGoal(tor, true);
  goal = store.getState().events.at(-1);
  assert.equal(goal.penalty, false, 'ein Eigentor ist nie ein Strafstoß');
});

test('Halbzeitstand zählt Nachspielzeit-Tore der 1. Halbzeit mit', () => {
  const tore = [
    { type: 'goal', team: 'home', minute: 12 },
    { type: 'goal', team: 'away', minute: 45, stoppage: 2 },
    { type: 'card', team: 'away', minute: 40 },
    { type: 'goal', team: 'home', minute: 46 },
  ];
  assert.deepEqual(halfTimeScore(tore, 45), { home: 1, away: 1 });
  assert.deepEqual(halfTimeScore(tore, 35), { home: 1, away: 0 }, 'Jugend: kürzere Halbzeit');
});

test('Tafel: Endstand mit Halbzeitstand, Abbruch in der 1. Halbzeit als Spielabbruch', (t) => {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.incrementScore('home', 1);
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();
  store.incrementScore('away', 1);
  store.incrementScore('away', 1);
  store.goToFullTime();

  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.document.getElementById('phase-label').textContent, 'ENDSTAND · HZ 1:0');

  const abbruch = new MatchStateStore();
  abbruch.kickoff();
  abbruch.stopClock();
  abbruch.goToFullTime();
  r.emit('onStateUpdated', abbruch.getState());
  assert.equal(r.document.getElementById('phase-label').textContent, 'SPIELABBRUCH');
  assert.deepEqual(r.drainErrors(), []);
});

test('Spieler entfernen fragt nach, ein Nein hält es auf', (t) => {
  const store = new MatchStateStore();
  store.setSquad('home', [LANGE]);
  const r = openRenderer('control', t);
  const fragen = [];
  r.window.confirm = (frage) => {
    fragen.push(frage);
    return false;
  };
  r.emit('onStateUpdated', store.getState());
  r.calls.length = 0;
  r.document.querySelector('#home-squad-list .squad-remove').click();
  assert.deepEqual(r.calls.map((c) => c.name), []);
  assert.match(fragen[0], /Lange/);
});

// --------------------------------------------------------------------
// Spielverlauf: Heim links, Gast rechts, eine Zeile je Ereignis (N15)
// --------------------------------------------------------------------

test('Spielverlauf: jedes Ereignis in eigener Zeile auf der Seite seiner Mannschaft', (t) => {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.incrementScore('home', 1);
  store.addCard('away', 'yellow');
  store.incrementScore('away', 1);
  store.addSubstitution('home');
  store.hideInfo();

  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());
  const zeilen = [...r.document.querySelectorAll('#goal-log li')].map((li) => [
    li.classList.contains('side-home') ? 'heim' : li.classList.contains('side-away') ? 'gast' : '?',
    li.style.gridRow,
  ]);
  // Ohne ausdrückliche Zeile legte das Raster ein Gasttor neben das
  // vorangehende Heimtor -- die Zeit liefe wieder im Zickzack.
  assert.deepEqual(zeilen, [
    ['heim', '1'],
    ['gast', '2'],
    ['gast', '3'],
    ['heim', '4'],
  ]);
  assert.match(r.document.getElementById("goal-log-home").textContent, /Spielverlauf · Heim/);
  assert.deepEqual(r.drainErrors(), []);
});
