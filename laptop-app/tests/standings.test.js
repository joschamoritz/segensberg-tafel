/**
 * Zwischenstände der Chronik.
 *
 * Jedes Tor merkt sich den Spielstand, wie er nach diesem Tor war -- das
 * ist es, was in der Chronik und in der Torschützen-Einblendung steht
 * ("2:1"). Wird ein Tor nachträglich zurückgenommen, sind alle danach
 * gefallenen Tore falsch gespeichert, und die Einblendung zeigte am
 * Spielfeldrand einen Stand, den es nie gab. `recomputeStandings()`
 * rechnet die Kette deshalb komplett neu durch.
 *
 * Geprüft wird beides: die reine Regel und der Weg über den Store, weil
 * nur dort auffällt, wenn eine Rücknahme die Funktion gar nicht erst
 * aufruft.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');

stubElectron();
const { MatchStateStore, recomputeStandings } = load('main/state');

// --------------------------------------------------------------------
// Die reine Regel
// --------------------------------------------------------------------

let naechsteId = 1;

function tor(team, minute) {
  return {
    id: naechsteId++,
    type: 'goal',
    team,
    minute,
    scoreHome: 0,
    scoreAway: 0,
    celebrate: false,
  };
}

function karte(team, minute, card) {
  return { id: naechsteId++, type: 'card', team, card, minute };
}

/** Kurzschreibweise für den gespeicherten Zwischenstand einer Chronik. */
function staende(events) {
  return events.filter((e) => e.type === 'goal').map((e) => `${e.scoreHome}:${e.scoreAway}`);
}

test('die Zwischenstände zählen in der Reihenfolge der Chronik hoch', () => {
  const events = recomputeStandings([
    tor('home', 5),
    tor('away', 20),
    tor('home', 40),
    tor('home', 70),
  ]);
  assert.deepEqual(staende(events), ['1:0', '1:1', '2:1', '3:1']);
});

test('Karten verändern den Stand nicht und bleiben unangetastet', () => {
  const gelb = karte('home', 30, 'yellow');
  const events = recomputeStandings([tor('home', 5), gelb, tor('away', 60)]);

  assert.deepEqual(staende(events), ['1:0', '1:1']);
  assert.equal(
    events[1],
    gelb,
    'die Karte hätte unverändert durchgereicht werden müssen'
  );
});

test('eine leere Chronik bleibt leer', () => {
  assert.deepEqual(recomputeStandings([]), []);
});

test('die übergebene Liste wird nicht verändert', () => {
  // Der Store setzt den Zustand unveränderlich neu zusammen. Würde hier
  // in die alte Liste geschrieben, liefe die Spielsicherung auf Daten,
  // die niemand mehr erwartet.
  const original = [tor('home', 5)];
  const vorher = original[0].scoreHome;
  recomputeStandings(original);
  assert.equal(original[0].scoreHome, vorher);
});

// --------------------------------------------------------------------
// Über den Store -- der eigentliche Vertrag
// --------------------------------------------------------------------

/** Liest die Zwischenstände aus der Chronik des Stores. */
function chronik(store) {
  return staende(store.getState().events);
}

/**
 * Angepfiffenes Spiel mit angehaltener Uhr.
 *
 * Das `stopClock()` ist Pflicht: `kickoff()` startet einen `setInterval`,
 * der den Node-Prozess offen hält -- ohne das läuft der Testlauf bis zum
 * Zeitlimit weiter, statt durchzulaufen. Für die Chronik ist die Uhr
 * ohnehin gleichgültig, die Ereignisminute rechnet aus dem Uhrstand.
 */
function angepfiffen() {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  return store;
}

/** Spielt 1:0, 1:1, 2:1 -- mit einer gelben Karte dazwischen. */
function spielMitDreiToren() {
  const store = angepfiffen();
  store.incrementScore('home', 1); // 1:0
  store.incrementScore('away', 1); // 1:1
  store.addCard('home', 'yellow');
  store.incrementScore('home', 1); // 2:1
  return store;
}

test('im normalen Verlauf steht bei jedem Tor der Stand danach', () => {
  assert.deepEqual(chronik(spielMitDreiToren()), ['1:0', '1:1', '2:1']);
});

test('ein zurückgenommenes Tor rechnet die späteren Stände neu', () => {
  // Das Gegentor wird gestrichen: Aus 1:1 und 2:1 muss 2:0 werden.
  const store = spielMitDreiToren();
  const gegentor = store.getState().events.find((e) => e.type === 'goal' && e.team === 'away');

  store.removeEvent(gegentor.id);

  assert.deepEqual(chronik(store), ['1:0', '2:0']);
  assert.equal(store.getState().away.score, 0);
  assert.equal(store.getState().home.score, 2);
});

test('das Streichen eines Tores lässt die Karten in der Chronik stehen', () => {
  const store = spielMitDreiToren();
  const gegentor = store.getState().events.find((e) => e.type === 'goal' && e.team === 'away');

  store.removeEvent(gegentor.id);

  const karten = store.getState().events.filter((e) => e.type === 'card');
  assert.equal(karten.length, 1, 'die gelbe Karte hätte bleiben müssen');
});

test('eine gestrichene Karte lässt die Spielstände unberührt', () => {
  const store = spielMitDreiToren();
  const gelb = store.getState().events.find((e) => e.type === 'card');

  store.removeEvent(gelb.id);

  assert.deepEqual(chronik(store), ['1:0', '1:1', '2:1']);
  assert.equal(store.getState().home.score, 2);
});

test('Korrektur per Minus-Knopf nimmt das jüngste Tor DIESER Mannschaft', () => {
  // Am Spielfeldrand ist der Minus-Knopf der schnelle Weg nach einem
  // versehentlichen Klick. Er darf nicht das Tor der anderen Mannschaft
  // erwischen, auch wenn das später fiel.
  const store = spielMitDreiToren();

  store.incrementScore('home', -1); // nimmt das 2:1 zurück

  assert.deepEqual(chronik(store), ['1:0', '1:1']);
  assert.equal(store.getState().home.score, 1);
  assert.equal(store.getState().away.score, 1);
});

test('der Minus-Knopf überspringt Karten auf der Suche nach dem Tor', () => {
  // Zwischen dem letzten Heimtor und dem Ende der Chronik liegt eine
  // Karte. Würde nur der letzte Eintrag geprüft, geschähe gar nichts.
  const store = angepfiffen();
  store.incrementScore('home', 1);
  store.addCard('home', 'yellow');
  store.addCard('away', 'red');

  store.incrementScore('home', -1);

  assert.deepEqual(chronik(store), []);
  assert.equal(store.getState().home.score, 0);
  assert.equal(
    store.getState().events.filter((e) => e.type === 'card').length,
    2,
    'beide Karten hätten bleiben müssen'
  );
});

test('der Minus-Knopf bei 0:0 tut nichts', () => {
  const store = angepfiffen();
  store.addCard('home', 'yellow');

  store.incrementScore('home', -1);

  assert.equal(store.getState().home.score, 0);
  assert.equal(store.getState().events.length, 1, 'die Karte hätte bleiben müssen');
});

test('nach einer Rücknahme bekommt das nächste Tor den richtigen Stand', () => {
  // Der Fall am Spielfeldrand: falsch geklickt, korrigiert, dann fällt
  // das echte Tor.
  const store = spielMitDreiToren();
  store.incrementScore('home', -1); // zurück auf 1:1

  store.incrementScore('away', 1);

  assert.deepEqual(chronik(store), ['1:0', '1:1', '1:2']);
  assert.equal(store.getState().away.score, 2);
});

test('die Ereignis-Ids bleiben nach einer Rücknahme eindeutig', () => {
  // Bekäme ein neues Tor eine bereits vergebene Id, erkennte die Anzeige
  // es nicht als neu -- der Torjubel bliebe aus.
  const store = spielMitDreiToren();
  const vorher = store.getState().events.map((e) => e.id);

  store.incrementScore('home', -1);
  store.incrementScore('home', 1);

  const neu = store.getState().events.at(-1).id;
  assert.ok(!vorher.includes(neu), `Id ${neu} war schon vergeben`);
});
