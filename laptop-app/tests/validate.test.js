/**
 * Prüfschicht zwischen IPC und Zustand. Die Werte stammen aus
 * Eingabefeldern: ein leeres Zahlenfeld liefert `NaN`, eingefügter Text
 * kann beliebig lang sein.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');

stubElectron();
const v = load('main/validate');

test('Trikotnummern werden auf sinnvolle Werte begrenzt', () => {
  assert.equal(v.sanitizeNumber(7), 7);
  assert.equal(v.sanitizeNumber(0), 0);
  assert.equal(v.sanitizeNumber(99), 99);
  assert.equal(v.sanitizeNumber('11'), 11);
  assert.equal(v.sanitizeNumber(7.6), 8);
});

test('unbrauchbare Trikotnummern werden zu "keine Nummer"', () => {
  // Landeten diese Werte im Zustand, stünden sie auf der Anzeigetafel.
  for (const eingabe of [-5, 100, NaN, '', 'abc', null, undefined, Infinity]) {
    assert.equal(v.sanitizeNumber(eingabe), null, `${eingabe} hätte null ergeben müssen`);
  }
});

test('Texte werden getrimmt, entzeilt und gekappt', () => {
  assert.equal(v.sanitizeText('  Müller  '), 'Müller');
  // Zeilenumbrüche aus eingefügtem Text zerrissen sonst das Tafel-Layout
  assert.equal(v.sanitizeText('Max\nMuster'), 'Max Muster');
  assert.equal(v.sanitizeText('x'.repeat(80)).length, 40);
  assert.equal(v.sanitizeText('LANGERNAME', 6), 'LANGER');
  assert.equal(v.sanitizeText(undefined), '');
  assert.equal(v.sanitizeText(42), '');
});

test('Zuschauerzahl: leeres Feld heißt "keine Angabe"', () => {
  // Ein NaN aus einem halb geleerten Zahlenfeld darf nicht als
  // Zuschauerzahl auf der Tafel landen.
  for (const eingabe of ['', null, undefined, NaN, 'abc', Infinity]) {
    assert.equal(v.sanitizeAttendance(eingabe), null, `${eingabe} hätte null ergeben müssen`);
  }
});

test('Zuschauerzahl wird gerundet und begrenzt', () => {
  assert.equal(v.sanitizeAttendance(312), 312);
  assert.equal(v.sanitizeAttendance('250'), 250);
  assert.equal(v.sanitizeAttendance(312.6), 313);
  assert.equal(v.sanitizeAttendance(-50), 0);
  assert.equal(v.sanitizeAttendance(10 ** 9), 99999);
});

test('nur bekannte Einblendungen werden durchgelassen', () => {
  assert.equal(v.isInfoOverlay({ kind: 'corners' }), true);
  assert.equal(v.isInfoOverlay({ kind: 'attendance' }), true);
  assert.equal(v.isInfoOverlay({ kind: 'card', eventId: 3 }), true);

  // Ohne brauchbare Ereignis-Id fände die Anzeige keine Karte und die
  // Leiste bliebe leer.
  assert.equal(v.isInfoOverlay({ kind: 'card' }), false);
  assert.equal(v.isInfoOverlay({ kind: 'card', eventId: 0 }), false);
  assert.equal(v.isInfoOverlay({ kind: 'card', eventId: 'drei' }), false);
  assert.equal(v.isInfoOverlay({ kind: 'werbung' }), false);
  assert.equal(v.isInfoOverlay(null), false);
  assert.equal(v.isInfoOverlay('corners'), false);
});

test('Anstoßzeit wird auf HH:MM normiert', () => {
  assert.equal(v.sanitizeKickoffTime('15:30'), '15:30');
  assert.equal(v.sanitizeKickoffTime('9:05'), '09:05');
  for (const eingabe of ['25:00', '12:70', 'bald', '', '1530', undefined]) {
    assert.equal(v.sanitizeKickoffTime(eingabe), '', `"${eingabe}" hätte leer sein müssen`);
  }
});

test('Spieler ohne brauchbare Id werden abgelehnt', () => {
  assert.equal(v.sanitizePlayer({ firstName: 'Max' }), null);
  assert.equal(v.sanitizePlayer(null), null);
  assert.equal(v.sanitizePlayer('Max'), null);
  assert.equal(v.sanitizePlayer({ id: '   ' }), null);
});

test('Spielerfelder werden einzeln geprüft', () => {
  const spieler = v.sanitizePlayer({
    id: 'abc',
    number: '-3',
    firstName: '  Max  ',
    lastName: 'Muster',
    role: 'unsinn',
    isGoalkeeper: 'ja',
    isCaptain: true,
  });

  assert.equal(spieler.number, null);
  assert.equal(spieler.firstName, 'Max');
  // Unbekannte Rolle heißt "heute nicht dabei" -- niemand rutscht dadurch
  // versehentlich in die Startelf.
  assert.equal(spieler.role, 'out');
  assert.equal(spieler.isGoalkeeper, false);
  assert.equal(spieler.isCaptain, true);
});

test('Portraits werden unverändert durchgereicht', () => {
  // Bilddaten stammen aus images.ts, nicht aus der Eingabemaske.
  const url = 'data:image/jpeg;base64,AAAA';
  assert.equal(v.sanitizePlayer({ id: 'a', photoDataUrl: url }).photoDataUrl, url);
  assert.equal(v.sanitizePlayer({ id: 'a', photoDataUrl: 42 }).photoDataUrl, undefined);
});

test('eingefügte Kader werden begrenzt', () => {
  assert.deepEqual(v.sanitizeImportedPlayers('viele Spieler'), []);
  assert.deepEqual(v.sanitizeImportedPlayers(null), []);

  const riesig = Array.from({ length: 200 }, () => ({ lastName: 'X' }));
  assert.equal(v.sanitizeImportedPlayers(riesig).length, 60);

  // Unbrauchbare Einträge fallen raus, gute bleiben
  const gemischt = v.sanitizeImportedPlayers([null, 'text', { lastName: 'Muster' }]);
  assert.equal(gemischt.length, 1);
  assert.equal(gemischt[0].lastName, 'Muster');
});

test('Mannschaft, Kartenfarbe und Ereignis-Id gegen Whitelist', () => {
  assert.equal(v.isTeamId('home'), true);
  assert.equal(v.isTeamId('away'), true);
  assert.equal(v.isTeamId('gast'), false);
  assert.equal(v.isTeamId(undefined), false);

  assert.equal(v.isCardColor('yellow'), true);
  assert.equal(v.isCardColor('yellow-red'), true);
  assert.equal(v.isCardColor('red'), true);
  assert.equal(v.isCardColor('blau'), false);

  assert.equal(v.isEventId(3), true);
  assert.equal(v.isEventId(0), false);
  assert.equal(v.isEventId(1.5), false);
  assert.equal(v.isEventId('3'), false);
});

test('optionale Spieler-Id: leer bedeutet "keine Zuordnung"', () => {
  assert.equal(v.sanitizeOptionalId('abc'), 'abc');
  assert.equal(v.sanitizeOptionalId('  '), undefined);
  assert.equal(v.sanitizeOptionalId(''), undefined);
  assert.equal(v.sanitizeOptionalId(undefined), undefined);
});
