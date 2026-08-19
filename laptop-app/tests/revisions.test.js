/**
 * Revisionszähler.
 *
 * Die Renderer zeichnen eine Liste nur neu, wenn sich der zugehörige
 * Zähler geändert hat. Wird in einer Store-Methode das `bump()` vergessen,
 * aktualisiert die betroffene Liste stumm nicht mehr -- ein Fehler, der
 * ohne diese Tests erst im Spielbetrieb auffiele.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');

stubElectron();
const { MatchStateStore } = load('main/state');
const live = load('main/liveMatch');

/** Führt eine Aktion aus und meldet, welche Zähler dabei gestiegen sind. */
function bumped(store, aktion) {
  const vorher = { ...store.getState().revisions };
  aktion();
  const nachher = store.getState().revisions;
  return Object.keys(nachher)
    .filter((bereich) => nachher[bereich] > vorher[bereich])
    .sort();
}

test('Stammdaten zählen den Bereich "teams" hoch', () => {
  const store = new MatchStateStore();
  assert.deepEqual(bumped(store, () => store.setTeamName('home', 'SV Test')), ['teams']);
  assert.deepEqual(bumped(store, () => store.setTeamShortName('home', 'SVT')), ['teams']);
  assert.deepEqual(bumped(store, () => store.setTeamLogo('home', 'data:image/png;base64,AA')), ['teams']);
  // Der Trainer steht als letzter Eintrag auf der Aufstellungsseite
  assert.deepEqual(bumped(store, () => store.setCoach('home', 'Trainer')), ['teams']);
});

test('Kaderänderungen zählen den Bereich "squads" hoch', () => {
  const store = new MatchStateStore();
  assert.deepEqual(bumped(store, () => store.setSquad('home', [player()])), ['squads']);
  assert.deepEqual(
    bumped(store, () => store.setPlayerPhoto('home', 'p1', 'data:image/jpeg;base64,AA')),
    ['squads']
  );
});

test('Vereinswechsel betrifft Stammdaten und Kader', () => {
  const store = new MatchStateStore();
  assert.deepEqual(
    bumped(store, () => store.applyLibraryTeam('away', 'FC Gast', undefined, [player()], 'Coach')),
    ['squads', 'teams']
  );
});

test('Chronik-Änderungen zählen den Bereich "events" hoch', () => {
  const store = new MatchStateStore();
  store.setSquad('home', [player()]);
  store.kickoff();

  assert.deepEqual(bumped(store, () => store.incrementScore('home', 1)), ['events']);
  assert.deepEqual(bumped(store, () => store.addCard('away', 'yellow')), ['events']);

  const torId = store.getState().events.find((e) => e.type === 'goal').id;
  const karteId = store.getState().events.find((e) => e.type === 'card').id;

  assert.deepEqual(bumped(store, () => store.setGoalScorer(torId, 'p1')), ['events']);
  assert.deepEqual(bumped(store, () => store.setCardPlayer(karteId, 'p1')), ['events']);
  assert.deepEqual(bumped(store, () => store.removeEvent(karteId)), ['events']);
  assert.deepEqual(bumped(store, () => store.incrementScore('home', -1)), ['events']);

  store.stopClock();
});

test('"Neues Spiel" zählt weiter, statt auf 0 zurückzufallen', () => {
  // initialState() setzt die Zähler zurück -- die Renderer vergleichen
  // aber gegen ihren zuletzt gesehenen Wert und hielten die Listen sonst
  // für unverändert. Die alte Chronik bliebe auf der Tafel stehen.
  const store = new MatchStateStore();
  store.kickoff();
  store.incrementScore('home', 1);
  store.stopClock();

  const vorher = { ...store.getState().revisions };
  store.resetMatch();
  const nachher = store.getState().revisions;

  for (const bereich of ['teams', 'squads', 'events']) {
    assert.ok(
      nachher[bereich] > vorher[bereich],
      `Zähler "${bereich}" ist nicht gestiegen (${vorher[bereich]} -> ${nachher[bereich]})`
    );
  }
});

test('Wiederherstellung zählt Stammdaten und Chronik hoch', () => {
  const quelle = new MatchStateStore();
  quelle.kickoff();
  quelle.incrementScore('home', 1);
  quelle.stopClock();
  const snapshot = live.toSnapshot(quelle.getState());

  const store = new MatchStateStore();
  assert.deepEqual(bumped(store, () => store.restoreLiveMatch(snapshot)), ['events', 'teams']);
});

test('reine Uhr- und Phasenwechsel zählen nichts hoch', () => {
  // Sie betreffen keine der gepufferten Listen -- würden sie hochzählen,
  // baute die Anzeige bei jedem Phasenwechsel unnötig alles neu auf.
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();

  assert.deepEqual(bumped(store, () => store.setClock(30 * 60 * 1000)), []);
  assert.deepEqual(bumped(store, () => store.setStoppage(3)), []);
  assert.deepEqual(bumped(store, () => store.goToHalfTime()), []);
});

test('Ecken, Zuschauerzahl und Einblendungen zählen nichts hoch', () => {
  // An ihnen hängt keine gepufferte Liste -- beide Fenster lesen die
  // Werte direkt. Ein bump() würde hier nur die Kader- und
  // Chronik-Listen unnötig neu aufbauen lassen.
  const store = new MatchStateStore();

  assert.deepEqual(bumped(store, () => store.adjustCorners('home', 1)), []);
  assert.deepEqual(bumped(store, () => store.setAttendance(312)), []);
  assert.deepEqual(bumped(store, () => store.showInfo({ kind: 'corners' })), []);
  assert.deepEqual(bumped(store, () => store.hideInfo()), []);
});

test('eine Karte zählt die Chronik hoch, auch wenn sie eingeblendet wird', () => {
  // addCard() gibt im laufenden Spiel an showInfo() ab und sendet dort --
  // das bump('events') davor darf dabei nicht verlorengehen.
  const store = new MatchStateStore();
  store.kickoff();
  assert.deepEqual(bumped(store, () => store.addCard('home', 'red')), ['events']);
  store.stopClock();
});
