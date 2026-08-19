/**
 * Spielminute von Toren und Karten.
 *
 * Fußball-Konvention: Innerhalb der regulären Zeit zählt die angebrochene
 * Minute, ab dem Halbzeitende wird "45+2" ausgewiesen statt weiterzuzählen.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, MIN } = require('./helpers');

stubElectron();
const { MatchStateStore } = load('main/state');
const { toMatchMinute, formatEventMinute } = load('shared/types');

/** Kurzform für die Prüfungen: liefert die fertige Beschriftung. */
function label(elapsedMs, half = 1, halfDurationMin = 45) {
  return formatEventMinute(toMatchMinute(elapsedMs, half, halfDurationMin));
}

test('reguläre Spielzeit zählt die angebrochene Minute', () => {
  assert.equal(label(0), "1'");
  assert.equal(label(30 * 1000), "1'");
  assert.equal(label(MIN), "2'");
  assert.equal(label(22 * MIN + 30 * 1000), "23'");
  assert.equal(label(44 * MIN + 59 * 1000), "45'");
});

test('Nachspielzeit der 1. Halbzeit wird als 45+N ausgewiesen', () => {
  assert.equal(label(45 * MIN), "45+1'");
  assert.equal(label(45 * MIN + 30 * 1000), "45+1'");
  assert.equal(label(46 * MIN), "45+2'");
  assert.equal(label(47 * MIN + 30 * 1000), "45+3'");
});

test('2. Halbzeit zählt normal weiter', () => {
  // Die 2. Halbzeit beginnt bei einem Uhrstand von 45:00.
  assert.equal(label(45 * MIN + 30 * 1000, 2), "46'");
  assert.equal(label(60 * MIN, 2), "61'");
  assert.equal(label(89 * MIN + 59 * 1000, 2), "90'");
});

test('Nachspielzeit der 2. Halbzeit wird als 90+N ausgewiesen', () => {
  assert.equal(label(90 * MIN, 2), "90+1'");
  assert.equal(label(91 * MIN, 2), "90+2'");
  assert.equal(label(94 * MIN + 20 * 1000, 2), "90+5'");
});

test('gleicher Uhrstand in beiden Halbzeiten ergibt verschiedene Minuten', () => {
  // Der Grund für die ganze Unterscheidung: Ein Tor in der Nachspielzeit
  // der 1. Halbzeit und eines kurz nach dem Wiederanpfiff standen vorher
  // beide als "47." in der Chronik.
  const inNachspielzeit = label(46 * MIN + 30 * 1000, 1);
  const nachWiederanpfiff = label(46 * MIN + 30 * 1000, 2);

  assert.equal(inNachspielzeit, "45+2'");
  assert.equal(nachWiederanpfiff, "47'");
  assert.notEqual(inNachspielzeit, nachWiederanpfiff);
});

test('kürzere Halbzeiten im Jugendbereich', () => {
  // 2x35 Minuten: Basis ist dort 35 bzw. 70.
  assert.equal(label(34 * MIN, 1, 35), "35'");
  assert.equal(label(35 * MIN, 1, 35), "35+1'");
  assert.equal(label(36 * MIN + 10 * 1000, 1, 35), "35+2'");
  assert.equal(label(69 * MIN, 2, 35), "70'");
  assert.equal(label(70 * MIN, 2, 35), "70+1'");
});

test('Tore und Karten bekommen die Minute beim Eintragen mit', () => {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();

  store.setClock(22 * MIN + 30 * 1000);
  store.incrementScore('home', 1);

  // Nachspielzeit der 1. Halbzeit
  store.setClock(46 * MIN);
  store.addCard('away', 'yellow');

  const [tor, karte] = store.getState().events;
  assert.equal(formatEventMinute(tor), "23'");
  assert.equal(formatEventMinute(karte), "45+2'");
  assert.equal(tor.stoppage, undefined);
  assert.equal(karte.stoppage, 2);
});

test('Ereignisse der 2. Halbzeit zählen ab dem Wiederanpfiff korrekt', () => {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();

  store.setClock(46 * MIN + 30 * 1000);
  store.incrementScore('away', 1);

  const tor = store.getState().events.at(-1);
  assert.equal(formatEventMinute(tor), "47'");
});

test('ältere Ereignisse ohne Nachspiel-Feld werden normal angezeigt', () => {
  // Aus einer Sicherung, die vor dieser Änderung geschrieben wurde.
  assert.equal(formatEventMinute({ minute: 47 }), "47'");
});
