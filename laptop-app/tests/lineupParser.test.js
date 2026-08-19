/**
 * Aufstellungs-Parser: der Einfüge-Weg von fussball.de in den Kader.
 *
 * Der Parser ist bewusst tolerant gebaut -- wie der kopierte Text
 * aussieht, hängt von Browser, Seitenbereich und Ansicht ab. Genau
 * deshalb braucht er Tests: Toleranz ohne Absicherung heißt, dass eine
 * Änderung an einer Regel unbemerkt eine andere Textform kaputtmacht.
 *
 * Die beiden teuersten Fehler am Spieltag wären: ein Betreuer landet als
 * Spieler im Kader, oder eine Trikotnummer fällt weg. Beides ist unten
 * ausdrücklich abgedeckt.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');

stubElectron();
const { parseLineup, splitName } = load('shared/lineupParser');

// --------------------------------------------------------------------
// splitName
// --------------------------------------------------------------------

test('splitName: "Nachname, Vorname" wird an dem Komma getrennt', () => {
  assert.deepEqual(splitName('Müller, Max'), { firstName: 'Max', lastName: 'Müller' });
});

test('splitName: "Vorname Nachname" trennt am letzten Wort', () => {
  assert.deepEqual(splitName('Max Müller'), { firstName: 'Max', lastName: 'Müller' });
});

test('splitName: mehrteilige Vornamen bleiben beim Vornamen', () => {
  assert.deepEqual(splitName('Max Peter Müller'), {
    firstName: 'Max Peter',
    lastName: 'Müller',
  });
});

test('splitName: ein einzelnes Wort ist der Nachname', () => {
  // Auf der Tafel steht der Nachname -- ein einzelnes Wort dort
  // einzusortieren ist die nützlichere Annahme.
  assert.deepEqual(splitName('Ronaldinho'), { firstName: '', lastName: 'Ronaldinho' });
});

test('splitName: leerer Text ergibt zwei leere Felder', () => {
  assert.deepEqual(splitName(''), { firstName: '', lastName: '' });
  assert.deepEqual(splitName('   '), { firstName: '', lastName: '' });
});

test('splitName: Namenszusätze gehören zum Nachnamen', () => {
  // "van der Berg" ist der Nachname, nicht "Berg" -- auf der Tafel
  // stünde sonst der falsche Name.
  assert.deepEqual(splitName('Max van der Berg'), {
    firstName: 'Max',
    lastName: 'van der Berg',
  });
  assert.deepEqual(splitName('Luis de la Fuente'), {
    firstName: 'Luis',
    lastName: 'de la Fuente',
  });
});

test('splitName: der Zusatz zählt nur ab der zweiten Stelle', () => {
  // Ein Name, der MIT einem Zusatzwort beginnt, hat keinen Vornamen --
  // sonst bliebe der Vorname leer und der ganze Name rutschte nach hinten.
  assert.deepEqual(splitName('van Dijk'), { firstName: 'van', lastName: 'Dijk' });
});

test('splitName: überzählige Leerzeichen stören nicht', () => {
  assert.deepEqual(splitName('  Max   Müller  '), { firstName: 'Max', lastName: 'Müller' });
});

// --------------------------------------------------------------------
// parseLineup -- Nummern
// --------------------------------------------------------------------

/** Kurzschreibweise: nur die interessanten Felder eines Spielers. */
function kurz(player) {
  return { number: player.number, firstName: player.firstName, lastName: player.lastName };
}

test('Nummer am Zeilenanfang, in allen gängigen Schreibweisen', () => {
  const { players } = parseLineup('7 Max Müller\n8. Tim Schmidt\n#9 Jan Klein\n10) Ali Yilmaz');
  assert.deepEqual(players.map(kurz), [
    { number: 7, firstName: 'Max', lastName: 'Müller' },
    { number: 8, firstName: 'Tim', lastName: 'Schmidt' },
    { number: 9, firstName: 'Jan', lastName: 'Klein' },
    { number: 10, firstName: 'Ali', lastName: 'Yilmaz' },
  ]);
});

test('Nummer am Zeilenende', () => {
  const { players } = parseLineup('Max Müller 7');
  assert.deepEqual(kurz(players[0]), { number: 7, firstName: 'Max', lastName: 'Müller' });
});

test('ohne Nummer bleibt das Feld leer statt zu raten', () => {
  // Ein `null` ist im Kader-Editor sichtbar leer; eine geratene 0 sähe
  // aus wie eine echte Trikotnummer.
  const { players } = parseLineup('Max Müller');
  assert.equal(players[0].number, null);
});

test('Tabulatoren aus kopierten Tabellen trennen wie Leerzeichen', () => {
  const { players } = parseLineup('12\tMax Müller');
  assert.deepEqual(kurz(players[0]), { number: 12, firstName: 'Max', lastName: 'Müller' });
});

test('ein Spieler ohne Namen wird über die Nummer trotzdem übernommen', () => {
  // "k.A." steht auf fussball.de, wenn kein Name hinterlegt ist. Die
  // Trikotnummer ist das, was auf der Tafel zählt.
  const { players } = parseLineup('7 k.A.');
  assert.equal(players.length, 1);
  assert.deepEqual(kurz(players[0]), { number: 7, firstName: '', lastName: '' });
});

test('weder Name noch Nummer ergibt keinen Spieler', () => {
  assert.deepEqual(parseLineup('---\n***').players, []);
});

// --------------------------------------------------------------------
// parseLineup -- Abschnitte, Rollen, Positionen
// --------------------------------------------------------------------

test('Abschnittsüberschriften setzen die Position der folgenden Zeilen', () => {
  const { players } = parseLineup(
    ['Tor', '1 Tom Keeper', 'Abwehr', '4 Max Müller', 'Mittelfeld', '8 Tim Schmidt', 'Sturm', '9 Jan Klein'].join(
      '\n'
    )
  );
  assert.deepEqual(
    players.map((p) => p.position),
    ['TW', 'ABW', 'MF', 'ST']
  );
});

test('der Torwart-Abschnitt setzt die Torwart-Kennzeichnung', () => {
  const { players } = parseLineup('Tor\n1 Tom Keeper\nAbwehr\n4 Max Müller');
  assert.equal(players[0].isGoalkeeper, true);
  assert.equal(players[1].isGoalkeeper, false);
});

test('ab dem Bank-Abschnitt gilt die Rolle "bench"', () => {
  const { players } = parseLineup('Abwehr\n4 Max Müller\nAuswechselspieler\n15 Tim Schmidt');
  assert.deepEqual(
    players.map((p) => p.role),
    ['start', 'bench']
  );
});

test('die Bank setzt keine Position', () => {
  // Wer auf der Bank sitzt, hat noch keine Position im Spiel.
  const { players } = parseLineup('Abwehr\n4 Max Müller\nBank\n15 Tim Schmidt');
  assert.equal(players[1].position, '');
});

test('ein Positionskürzel am Zeilenanfang gilt nur für diese Zeile', () => {
  const { players } = parseLineup('Abwehr\nIV 4 Max Müller\n5 Tim Schmidt');
  assert.deepEqual(
    players.map((p) => p.position),
    ['IV', 'ABW']
  );
});

test('ein Positionskürzel am Zeilenende landet nicht im Nachnamen', () => {
  // Typisch beim Kopieren aus Tabellen: "7  Max Müller  MF".
  const { players } = parseLineup('7 Max Müller MF');
  assert.equal(players[0].position, 'MF');
  assert.equal(players[0].lastName, 'Müller');
});

// --------------------------------------------------------------------
// parseLineup -- Kapitän, Trainer, Rauschen
// --------------------------------------------------------------------

test('die Kapitänskennzeichnung wird erkannt und aus dem Namen entfernt', () => {
  const { players } = parseLineup('4 Max Müller (C)\n5 Tim Schmidt');
  assert.equal(players[0].isCaptain, true);
  assert.equal(players[0].lastName, 'Müller');
  assert.equal(players[1].isCaptain, false);
});

test('sonstige Klammerzusätze verschwinden aus dem Namen', () => {
  const { players } = parseLineup('4 Max Müller (eingewechselt 60.)');
  assert.deepEqual(kurz(players[0]), { number: 4, firstName: 'Max', lastName: 'Müller' });
  assert.equal(players[0].isCaptain, false);
});

test('der Trainer wird gelesen und nicht als Spieler übernommen', () => {
  const { players, coach } = parseLineup('4 Max Müller\nTrainer:\nHans Meier');
  assert.equal(coach, 'Hans Meier');
  assert.deepEqual(
    players.map((p) => p.lastName),
    ['Müller']
  );
});

test('ohne Trainer-Abschnitt bleibt der Trainername leer', () => {
  assert.equal(parseLineup('4 Max Müller').coach, '');
});

test('der Betreuerstab landet nicht im Kader', () => {
  // DER teure Fehler: Ein Schiedsrichter oder Co-Trainer im Kader fällt
  // erst auf, wenn er auf der Aufstellungsseite an der Tafel steht.
  const { players } = parseLineup(
    [
      'Aufstellung',
      '4 Max Müller',
      'Co-Trainer:',
      'Peter Klein',
      'Betreuer:',
      'Uwe Lang',
      'Schiedsrichter:',
      'Frank Streng',
      'Zuschauer: 312',
    ].join('\n')
  );
  assert.deepEqual(
    players.map((p) => p.lastName),
    ['Müller']
  );
});

test('nach einem Stop-Abschnitt fängt eine neue Überschrift wieder an', () => {
  // Sonst verschluckte ein "Tore:"-Block mitten im Text die komplette
  // Ersatzbank, die darunter steht.
  const { players } = parseLineup('4 Max Müller\nTore:\n1:0 Müller\nAuswechselspieler\n15 Tim Schmidt');
  assert.deepEqual(
    players.map((p) => p.lastName),
    ['Müller', 'Schmidt']
  );
  assert.equal(players[1].role, 'bench');
});

test('Überschriften und Leerzeilen werden übersprungen', () => {
  const { players } = parseLineup('Aufstellung\n\nStartelf\n\n4 Max Müller\n\n');
  assert.equal(players.length, 1);
});

test('eine alleinstehende Zahl ist kein Spieler', () => {
  // Spaltenköpfe aus kopierten Tabellen.
  assert.deepEqual(parseLineup('7').players, []);
});

// --------------------------------------------------------------------
// parseLineup -- ein vollständiger Einfüge-Vorgang
// --------------------------------------------------------------------

test('eine komplette kopierte Aufstellung ergibt den erwarteten Kader', () => {
  const { players, coach } = parseLineup(
    [
      'Aufstellung',
      'Tor',
      '1\tTom Keeper',
      'Abwehr',
      '2\tJan Klein',
      '4\tMax van der Berg (C)',
      'Mittelfeld',
      '8\tTim Schmidt',
      'Sturm',
      '9\tAli Yilmaz',
      'Auswechselspieler',
      '12\tk.A.',
      '15\tLars Kurz',
      'Trainer:',
      'Hans Meier',
      'Co-Trainer:',
      'Peter Klein',
    ].join('\n')
  );

  assert.equal(coach, 'Hans Meier');
  assert.deepEqual(
    players.map((p) => [p.number, p.lastName, p.position, p.role]),
    [
      [1, 'Keeper', 'TW', 'start'],
      [2, 'Klein', 'ABW', 'start'],
      [4, 'van der Berg', 'ABW', 'start'],
      [8, 'Schmidt', 'MF', 'start'],
      [9, 'Yilmaz', 'ST', 'start'],
      [12, '', '', 'bench'],
      [15, 'Kurz', '', 'bench'],
    ]
  );
  assert.equal(players[0].isGoalkeeper, true);
  assert.equal(players[2].isCaptain, true);
});

test('leerer Text ergibt einen leeren Kader statt eines Fehlers', () => {
  assert.deepEqual(parseLineup(''), { players: [], coach: '' });
});
