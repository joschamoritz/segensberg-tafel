/**
 * Phasen-Beschriftungen und ihre Kopplung an den Store.
 *
 * Die drei Beschriftungssätze in `shared/phaseLabels.ts` sind bewusst
 * verschieden: Das Steuerungsfenster meldet der bedienenden Person einen
 * Betriebszustand, die Anzeigetafel zeigt dem Publikum eine Überschrift.
 * Sie stehen nur deshalb in einer Datei, damit eine neue Phase nicht in
 * einer der beiden Dateien unbemerkt durchfällt.
 *
 * Der wichtigste Test steht unten: `revertTargetLabel()` kündigt an, wohin
 * `MatchStateStore.revertPhase()` zurückführt. Beides lag früher getrennt
 * (eine ungenutzte Kopie im Store, die benutzte im Renderer) und war nur
 * durch einen Kommentar verbunden. Eine Rückfrage, die etwas anderes
 * ankündigt als dann geschieht, ist im Spielbetrieb schlimmer als gar
 * keine -- deshalb wird hier jeder Weg tatsächlich durchgespielt.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');

stubElectron();
const { MatchStateStore } = load('main/state');
const { controlPhaseLabel, displayPhaseLabel, revertTargetLabel } = load('shared/phaseLabels');

/** Alle Phasen, wie sie `MatchPhase` in `shared/types.ts` kennt. */
const PHASEN = ['pre-match', 'live', 'half-time', 'full-time'];

// --------------------------------------------------------------------
// Die Beschriftungen selbst
// --------------------------------------------------------------------

test('das Steuerungsfenster benennt jede Phase', () => {
  assert.equal(controlPhaseLabel('pre-match', 1), 'Vor Anpfiff');
  assert.equal(controlPhaseLabel('live', 1), '1. Halbzeit läuft');
  assert.equal(controlPhaseLabel('live', 2), '2. Halbzeit läuft');
  assert.equal(controlPhaseLabel('half-time', 1), 'Halbzeitpause');
  assert.equal(controlPhaseLabel('full-time', 2), 'Spiel beendet');
});

test('die Bedienung bekommt in jeder Phase einen Text, nie eine Leerstelle', () => {
  // Eine leere Statuszeile sähe aus wie ein Fehler.
  for (const phase of PHASEN) {
    for (const half of [1, 2]) {
      const label = controlPhaseLabel(phase, half);
      assert.equal(typeof label, 'string', `${phase}/${half} liefert keinen Text`);
      assert.ok(label.length > 0, `${phase}/${half} liefert eine leere Beschriftung`);
    }
  }
});

test('die Anzeigetafel zeigt nur in Pause und nach Abpfiff eine Überschrift', () => {
  // Vor Anpfiff und im laufenden Spiel gehört die Fläche dem Spielstand.
  assert.equal(displayPhaseLabel('pre-match'), '');
  assert.equal(displayPhaseLabel('live'), '');
  assert.equal(displayPhaseLabel('half-time'), 'HALBZEIT');
  assert.equal(displayPhaseLabel('full-time'), 'ENDSTAND');
});

test('beide Sätze bleiben verschieden -- sie sprechen verschiedene Leser an', () => {
  // Würden sie irgendwann doch zusammengelegt, stünde entweder eine
  // Statusmeldung auf der Tafel oder die Bedienung verlöre ihre Zeile.
  for (const phase of PHASEN) {
    assert.notEqual(
      controlPhaseLabel(phase, 1),
      displayPhaseLabel(phase),
      `${phase}: die Sätze sind zusammengefallen`
    );
  }
});

// --------------------------------------------------------------------
// revertTargetLabel gegen revertPhase()
// --------------------------------------------------------------------

/**
 * Übersetzt eine angekündigte Beschriftung zurück in den Zustand, den sie
 * verspricht. `null` in `half` heißt: die Halbzeit ist von der Ansage
 * nicht betroffen und wird nicht geprüft.
 */
function versprochenerZustand(label) {
  switch (label) {
    case 'Vor Anpfiff':
      return { phase: 'pre-match', half: null };
    case '1. Halbzeit':
      return { phase: 'live', half: 1 };
    case '2. Halbzeit':
      return { phase: 'live', half: 2 };
    case 'Halbzeitpause':
      return { phase: 'half-time', half: null };
    default:
      throw new Error(`unbekannte Beschriftung: ${JSON.stringify(label)}`);
  }
}

/**
 * Nimmt die Phase zurück und prüft, dass das Ergebnis der Ansage
 * entspricht, die vorher am Knopf stand.
 */
function pruefeRuecknahme(store) {
  const vorher = store.getState();
  const label = revertTargetLabel(vorher.phase, vorher.half);
  assert.notEqual(label, null, `aus "${vorher.phase}" sollte es zurückgehen`);

  store.revertPhase();
  store.stopClock();

  const nachher = store.getState();
  const versprochen = versprochenerZustand(label);

  assert.equal(
    nachher.phase,
    versprochen.phase,
    `angekündigt war "${label}", gelandet ist die App in "${nachher.phase}"`
  );
  if (versprochen.half !== null) {
    assert.equal(
      nachher.half,
      versprochen.half,
      `angekündigt war "${label}", gelandet ist die App in Halbzeit ${nachher.half}`
    );
  }
  return nachher;
}

/** Angepfiffenes Spiel mit angehaltener Uhr (sonst hält der Tick-Timer den Lauf offen). */
function angepfiffen() {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  return store;
}

test('vor dem Anpfiff geht es nicht weiter zurück', () => {
  const store = new MatchStateStore();
  assert.equal(revertTargetLabel('pre-match', 1), null);

  store.revertPhase();

  assert.equal(store.getState().phase, 'pre-match', 'der Zustand hätte stehen bleiben müssen');
});

test('aus der 1. Halbzeit führt die Rücknahme dorthin, wo sie es ankündigt', () => {
  pruefeRuecknahme(angepfiffen());
});

test('aus der Halbzeitpause führt die Rücknahme dorthin, wo sie es ankündigt', () => {
  const store = angepfiffen();
  store.goToHalfTime();
  pruefeRuecknahme(store);
});

test('aus der 2. Halbzeit führt die Rücknahme dorthin, wo sie es ankündigt', () => {
  const store = angepfiffen();
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();
  pruefeRuecknahme(store);
});

test('nach dem Abpfiff führt die Rücknahme dorthin, wo sie es ankündigt', () => {
  const store = angepfiffen();
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();
  store.goToFullTime();
  pruefeRuecknahme(store);
});

test('nach einem Spielabbruch in der 1. Halbzeit stimmt die Ansage ebenfalls', () => {
  // Abpfiff ist bewusst auch in der 1. Halbzeit möglich (Wetter,
  // Verletzung). Die Ansage muss dann "1. Halbzeit" lauten, nicht "2.".
  const store = angepfiffen();
  store.goToFullTime();

  assert.equal(revertTargetLabel(store.getState().phase, store.getState().half), '1. Halbzeit');
  pruefeRuecknahme(store);
});

test('der ganze Weg zurück bis vor den Anpfiff stimmt Schritt für Schritt', () => {
  // Der realistische Fall: mehrfach versehentlich weitergeschaltet und
  // alles wieder zurückgenommen.
  const store = angepfiffen();
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();
  store.goToFullTime();

  pruefeRuecknahme(store); // Endstand  -> 2. Halbzeit
  pruefeRuecknahme(store); // 2. Halbzeit -> Halbzeitpause
  pruefeRuecknahme(store); // Halbzeitpause -> 1. Halbzeit
  pruefeRuecknahme(store); // 1. Halbzeit -> Vor Anpfiff

  assert.equal(revertTargetLabel(store.getState().phase, store.getState().half), null);
});

test('die Rücknahme lässt Spielstand und Chronik unangetastet', () => {
  // Sie korrigiert einen Bedienfehler an der Phase -- die Tore, die
  // gefallen sind, sind trotzdem gefallen.
  const store = angepfiffen();
  store.incrementScore('home', 1);
  store.incrementScore('away', 1);
  store.goToHalfTime();

  pruefeRuecknahme(store);

  assert.equal(store.getState().home.score, 1);
  assert.equal(store.getState().away.score, 1);
  assert.equal(store.getState().events.length, 2);
});
