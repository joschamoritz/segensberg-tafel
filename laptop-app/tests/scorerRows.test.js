/**
 * Torschützenliste unter dem Wappen.
 *
 * Die Falle steckt in der Zusammenfassung von Mehrfachtorschützen: Ihre
 * Zeile steht an der Position ihres ERSTEN Tores. Wird die Liste hinten
 * abgeschnitten, fiele ein Spieler mit Toren in der 5. und in der 80.
 * Minute heraus -- obwohl sein letztes Tor das jüngste Ereignis ist.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');

stubElectron();
const { buildScorerRows, visibleScorerRows } = load('shared/scorerRows');

let naechsteId = 1;

function tor(team, minute, scorerId, stoppage) {
  return {
    id: naechsteId++,
    type: 'goal',
    team,
    minute,
    stoppage,
    scoreHome: 0,
    scoreAway: 0,
    celebrate: false,
    scorerId,
  };
}

function karte(team, minute, card, playerId) {
  return { id: naechsteId++, type: 'card', team, card, minute, playerId };
}

const kader = [
  player({ id: 'p1', lastName: 'Müller' }),
  player({ id: 'p2', lastName: 'Schmidt' }),
  player({ id: 'p3', firstName: 'Ali', lastName: '' }),
];

test('Tore stehen mit Minute und Nachname in der Liste', () => {
  const rows = buildScorerRows('home', [tor('home', 23, 'p1')], kader);
  assert.deepEqual(rows, [{ minutes: ["23'"], name: 'Müller' }]);
});

test('nur Ereignisse der eigenen Mannschaft', () => {
  const rows = buildScorerRows('home', [tor('home', 5, 'p1'), tor('away', 9, 'p2')], kader);
  assert.equal(rows.length, 1);
});

test('Tore in der Nachspielzeit stehen als "45+2"', () => {
  const rows = buildScorerRows('home', [tor('home', 45, 'p1', 2)], kader);
  assert.deepEqual(rows[0].minutes, ["45+2'"]);
});

test('ohne zugeordneten Schützen bleibt der Name leer', () => {
  // Der Schütze wird meist erst nach dem Tor nachgetragen -- die Minute
  // gehört trotzdem sofort auf die Tafel.
  const rows = buildScorerRows('home', [tor('home', 12, undefined)], kader);
  assert.deepEqual(rows, [{ minutes: ["12'"], name: '' }]);
});

test('fehlt der Nachname, steht der Vorname', () => {
  const rows = buildScorerRows('home', [tor('home', 12, 'p3')], kader);
  assert.equal(rows[0].name, 'Ali');
});

test('Platzverweise stehen mit in der Liste, Gelb nicht', () => {
  // Ein Platzverweis ist für die Zuschauer genauso wichtig wie ein Tor.
  // Gelbe Karten würden die Liste dagegen im Nu füllen.
  const rows = buildScorerRows(
    'home',
    [
      karte('home', 30, 'yellow', 'p1'),
      karte('home', 55, 'red', 'p2'),
      karte('home', 70, 'yellow-red', 'p1'),
    ],
    kader
  );

  assert.equal(rows.length, 2, 'Gelb hätte draußen bleiben müssen');
  assert.deepEqual(rows[0], { minutes: ["55'"], name: 'Schmidt', card: 'red' });
  assert.equal(rows[1].card, 'yellow-red');
});

test('Mehrfachtorschützen werden in einer Zeile zusammengefasst', () => {
  const rows = buildScorerRows(
    'home',
    [tor('home', 23, 'p1'), tor('home', 67, 'p1')],
    kader
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].minutes, ["23'", "67'"]);
});

test('die Zeile eines Mehrfachtorschützen wandert ans Ende', () => {
  // DIE Falle: Stünde sie weiter an der Position des ersten Tores, fiele
  // Müller beim Abschneiden heraus -- obwohl sein 80.-Minute-Tor das
  // jüngste Ereignis der Liste ist.
  const rows = buildScorerRows(
    'home',
    [
      tor('home', 5, 'p1'),
      tor('home', 20, 'p2'),
      tor('home', 30, 'p3'),
      tor('home', 80, 'p1'),
    ],
    kader
  );

  assert.deepEqual(
    rows.map((r) => r.name),
    ['Schmidt', 'Ali', 'Müller']
  );

  const sichtbar = visibleScorerRows(rows, 2);
  assert.deepEqual(
    sichtbar.map((r) => r.name),
    ['Ali', 'Müller'],
    'Müller muss sichtbar bleiben, sein letztes Tor ist das jüngste'
  );
});

test('es bleiben die jüngsten Zeilen stehen', () => {
  const rows = buildScorerRows(
    'home',
    [tor('home', 5, 'p1'), tor('home', 20, 'p2'), tor('home', 30, 'p3')],
    kader
  );

  assert.deepEqual(
    visibleScorerRows(rows, 2).map((r) => r.minutes[0]),
    ["20'", "30'"],
    'die ältesten Einträge fallen heraus, nicht die jüngsten'
  );
});

test('passt alles, wird nichts abgeschnitten', () => {
  const rows = buildScorerRows('home', [tor('home', 5, 'p1')], kader);
  assert.deepEqual(visibleScorerRows(rows, 6), rows);
  assert.deepEqual(visibleScorerRows([], 6), []);
});

test('eine Obergrenze von 0 ergibt eine leere Liste', () => {
  // slice(-0) lieferte sonst die GESAMTE Liste -- ein Klassiker.
  const rows = buildScorerRows('home', [tor('home', 5, 'p1')], kader);
  assert.deepEqual(visibleScorerRows(rows, 0), []);
});
