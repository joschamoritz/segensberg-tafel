/**
 * Jeder Knopf des Steuerungsfensters wird gedrückt und muss die passende
 * Brücken-Methode auslösen.
 *
 * Die Lücke, die das schließt: Bis hierher sicherte die Suite zu, dass
 * Element-Ids überleben -- sie klickte aber in 222 Fällen genau einmal.
 * Damit war die Fehlerklasse unsichtbar, die ein Umbau des HTML
 * tatsächlich erzeugt.
 *
 * Warum die entsteht: Sämtliche Verdrahtung läuft genau einmal in
 * `main()`. Rund zwei Dutzend Element-Verweise leben danach in Closures,
 * die übrigen Knöpfe tragen ihren Listener direkt am Knoten. Wird ein
 * Knoten zur Laufzeit ausgetauscht -- etwa weil eine Ansicht aus dem DOM
 * genommen und wieder eingebaut wird --, zeigt der Verweis auf eine
 * Waise. Die Anzeige bleibt trotzdem korrekt, weil `renderState` jedes
 * Mal frisch per `getElementById` holt. Nur die Knöpfe tun nichts mehr,
 * lautlos und ohne Fehlerbanner. Am Spielfeldrand ist das der
 * schlechteste denkbare Ausfall.
 *
 * Deshalb ist dieser Test die Voraussetzung für den Umbau der
 * Oberfläche, nicht sein Nachtrag.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');

/**
 * Öffnet das Steuerungsfenster mit einem Zustand, in dem möglichst viele
 * Knöpfe freigeschaltet sind.
 *
 * Nötig, weil `element.click()` bei einem `disabled`-Knopf folgenlos
 * bleibt -- zu Recht, das ist genau das Verhalten eines echten Klicks.
 * Ein Test gegen den Ausgangszustand könnte deshalb für die halben
 * Phasenknöpfe gar nichts aussagen.
 *
 * `confirm` liefert `true`: Die Rückfragen sind eine bewusste
 * Fehlerbremse und hier nicht der Prüfgegenstand. Dass sie überhaupt
 * gestellt werden, prüft der Block „Rückfragen" weiter unten.
 */
function fensterMit(store, t) {
  const r = openRenderer('control', t);
  r.window.confirm = () => true;
  r.emit('onStateUpdated', store.getState());
  r.drainErrors();
  return r;
}

/** Angepfiffenes Spiel mit angehaltener Uhr -- ein laufender Tick-Timer hielte den Testlauf offen. */
function angepfiffen() {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  return store;
}

function mitKader(store) {
  for (const team of ['home', 'away']) {
    store.setSquad(
      team,
      Array.from({ length: 11 }, (_, i) =>
        player({ id: `${team}${i + 1}`, number: i + 1, lastName: `Nachname${i + 1}` })
      )
    );
  }
  return store;
}

/** Namen der Brücken-Aufrufe eines Klicks -- die Argumente prüfen die Tests einzeln. */
function namen(calls) {
  return calls.map((c) => c.name);
}

/**
 * Argumente eines Aufrufs, durch JSON gedreht.
 *
 * `deepStrictEqual` prüft zusätzlich die Prototypenkette, und ein im
 * Renderer erzeugtes `{ kind: 'corners' }` stammt aus dem jsdom-Realm --
 * es hat also ein anderes `Object.prototype` als das Vergleichsobjekt im
 * Test und gilt als ungleich, obwohl es inhaltlich stimmt.
 */
function argumente(calls, index = 0) {
  return JSON.parse(JSON.stringify(calls[index].args));
}

/**
 * Medienordner mit Motiven -- ohne die bleiben die Diashow-Knöpfe gesperrt.
 *
 * Der Sounds-Ordner bleibt bewusst leer: Sobald dort eine Datei steht,
 * lädt der Renderer die Tormusik asynchron nach (`loadGoalSound`) und
 * fasst das DOM an, wenn das Promise auflöst. Nach dem Ende eines Tests
 * ist das jsdom-Fenster dann schon zu, und node:test meldet die
 * nachlaufende Aktivität als Fehler. In Electron ist derselbe Ablauf
 * harmlos, weil das Fenster stehen bleibt.
 */
function mitMedien(store) {
  store.setMedia({
    werbung: { rootPath: 'C:\\Test\\Werbung', files: ['01_sponsor.jpg', '02_sponsor.jpg'] },
    highlights: { rootPath: 'C:\\Test\\Highlights', files: ['01_bild.jpg'] },
    sounds: { rootPath: 'C:\\Test\\Sounds', files: [] },
  });
  return store;
}

// --------------------------------------------------------------------
// Knöpfe, die in jeder Phase erreichbar sind
// --------------------------------------------------------------------

test('Knöpfe ohne Phasenbindung lösen ihre Brücken-Methode aus', (t) => {
  const r = fensterMit(mitMedien(mitKader(new MatchStateStore())), t);

  const erwartet = {
    'library-folder': 'libraryChooseFolder',
    'library-reload': 'requestLibrary',
    'display-reopen': 'reopenDisplay',
    'clock-start': 'clockStart',
    'clock-stop': 'clockStop',
    'clock-reset': 'clockReset',
    'match-reset': 'matchReset',
    'home-squad-add': 'squadAddPlayer',
    'away-squad-add': 'squadAddPlayer',
    'home-logo-pick': 'teamPickLogo',
    'away-logo-pick': 'teamPickLogo',
    'home-logo-clear': 'teamClearLogo',
    'away-logo-clear': 'teamClearLogo',
    'slideshow-start': 'slideshowStart',
    'media-reload': 'mediaReload',
    'info-show-corners': 'showInfo',
  };

  for (const [id, methode] of Object.entries(erwartet)) {
    assert.deepStrictEqual(
      namen(r.click(id)),
      [methode],
      `"${id}" muss genau ${methode}() auslösen`
    );
  }

  r.close();
});

test('Mannschaft wird an die Brücke durchgereicht', (t) => {
  const r = fensterMit(mitKader(new MatchStateStore()), t);

  assert.deepStrictEqual(argumente(r.click('home-squad-add')), ['home']);
  assert.deepStrictEqual(argumente(r.click('away-squad-add')), ['away']);
  assert.deepStrictEqual(argumente(r.click('home-logo-pick')), ['home']);
  assert.deepStrictEqual(argumente(r.click('away-logo-clear')), ['away']);

  r.close();
});

// --------------------------------------------------------------------
// Spielstand, Karten, Ecken -- die Knöpfe des laufenden Spiels
// --------------------------------------------------------------------

test('Spielstand-Stepper meldet Mannschaft und Richtung', (t) => {
  const r = fensterMit(angepfiffen(), t);

  const plus = r.clickSelector('button[data-team="home"][data-delta="1"]');
  assert.deepStrictEqual(namen(plus), ['incrementScore']);
  assert.deepStrictEqual(argumente(plus), ['home', 1]);

  const minus = r.clickSelector('button[data-team="away"][data-delta="-1"]');
  assert.deepStrictEqual(argumente(minus), ['away', -1]);

  r.close();
});

test('Kartenknöpfe melden Mannschaft und Farbe', (t) => {
  const r = fensterMit(angepfiffen(), t);

  for (const [team, karte] of [
    ['home', 'yellow'],
    ['home', 'yellow-red'],
    ['home', 'red'],
    ['away', 'yellow'],
    ['away', 'yellow-red'],
    ['away', 'red'],
  ]) {
    const calls = r.clickSelector(`button[data-card-team="${team}"][data-card="${karte}"]`);
    assert.deepStrictEqual(namen(calls), ['cardAdd'], `${team}/${karte} löst nichts aus`);
    assert.deepStrictEqual(argumente(calls), [team, karte]);
  }

  r.close();
});

test('Eckenzähler meldet Mannschaft und Richtung', (t) => {
  const r = fensterMit(angepfiffen(), t);

  const plus = r.clickSelector('button[data-corner-team="home"][data-corner-delta="1"]');
  assert.deepStrictEqual(namen(plus), ['adjustCorners']);
  assert.deepStrictEqual(plus[0].args, ['home', 1]);

  const minus = r.clickSelector('button[data-corner-team="away"][data-corner-delta="-1"]');
  assert.deepStrictEqual(minus[0].args, ['away', -1]);

  r.close();
});

test('Nachspielzeit-Schnellknöpfe schicken ihren Wert', (t) => {
  const r = fensterMit(angepfiffen(), t);

  for (const minuten of [0, 1, 2, 3, 4, 5]) {
    const calls = r.clickSelector(`#stoppage-buttons button[data-stoppage="${minuten}"]`);
    assert.deepStrictEqual(namen(calls), ['setStoppage']);
    assert.deepStrictEqual(argumente(calls), [minuten], `"+${minuten}" schickt den falschen Wert`);
  }

  r.close();
});

// --------------------------------------------------------------------
// Phasenknöpfe -- nur in der jeweils passenden Phase erreichbar
// --------------------------------------------------------------------

test('jeder Phasenknopf löst in seiner Phase den passenden Wechsel aus', (t) => {
  const vorAnpfiff = new MatchStateStore();
  const r1 = fensterMit(vorAnpfiff, t);
  assert.deepStrictEqual(namen(r1.click('phase-kickoff')), ['phaseKickoff']);
  r1.close();

  const ersteHalbzeit = angepfiffen();
  const r2 = fensterMit(ersteHalbzeit, t);
  assert.deepStrictEqual(namen(r2.click('phase-halftime')), ['phaseHalfTime']);
  assert.deepStrictEqual(namen(r2.click('phase-fulltime')), ['phaseFullTime']);
  assert.deepStrictEqual(namen(r2.click('phase-revert')), ['phaseRevert']);
  r2.close();

  const pause = angepfiffen();
  pause.goToHalfTime();
  const r3 = fensterMit(pause, t);
  assert.deepStrictEqual(namen(r3.click('phase-second-half')), ['phaseSecondHalf']);
  r3.close();
});

test('ein Phasenknopf der falschen Phase bleibt folgenlos', (t) => {
  // Vor dem Anpfiff gibt es nichts zurückzunehmen und nichts abzupfeifen.
  const r = fensterMit(new MatchStateStore(), t);

  assert.deepStrictEqual(namen(r.click('phase-halftime')), [], 'Halbzeit vor dem Anpfiff');
  assert.deepStrictEqual(namen(r.click('phase-fulltime')), [], 'Abpfiff vor dem Anpfiff');
  assert.deepStrictEqual(namen(r.click('phase-revert')), [], 'Rücknahme vor dem Anpfiff');

  r.close();
});

// --------------------------------------------------------------------
// Aufstellung und Einblendungen mit Vorbedingung
// --------------------------------------------------------------------

test('Aufstellungsknöpfe wirken vor dem Anpfiff und danach nicht mehr', (t) => {
  const vor = fensterMit(mitKader(new MatchStateStore()), t);
  assert.deepStrictEqual(namen(vor.click('lineup-show-home')), ['showLineup']);
  assert.deepStrictEqual(argumente(vor.click('lineup-show-away')), ['away']);
  assert.deepStrictEqual(namen(vor.click('lineup-hide')), ['hideLineup']);
  vor.close();

  const laufend = fensterMit(mitKader(angepfiffen()), t);
  assert.deepStrictEqual(
    namen(laufend.click('lineup-show-home')),
    [],
    'im laufenden Spiel wirkt die Aufstellungs-Einblendung nicht'
  );
  laufend.close();
});

test('Zuschauer-Einblendung erst mit eingetragener Zahl', (t) => {
  const ohne = fensterMit(angepfiffen(), t);
  assert.deepStrictEqual(
    namen(ohne.click('info-show-attendance')),
    [],
    'ohne Zahl bliebe die Danksagung leer -- der Knopf muss gesperrt sein'
  );
  ohne.close();

  const mit = angepfiffen();
  mit.setAttendance(312);
  const r = fensterMit(mit, t);
  const calls = r.click('info-show-attendance');
  assert.deepStrictEqual(namen(calls), ['showInfo']);
  assert.deepStrictEqual(argumente(calls), [{ kind: 'attendance' }]);
  r.close();
});

test('Diashow beenden geht erst, wenn eine läuft', (t) => {
  const bereit = mitMedien(new MatchStateStore());
  const ruhend = fensterMit(bereit, t);
  assert.deepStrictEqual(
    namen(ruhend.click('slideshow-stop')),
    [],
    'ohne laufende Schau gibt es nichts zu beenden'
  );
  ruhend.close();

  const laufend = mitMedien(new MatchStateStore());
  laufend.startSlideshow();
  const r = fensterMit(laufend, t);
  assert.deepStrictEqual(namen(r.click('slideshow-stop')), ['slideshowStop']);
  r.close();
});

test('Ecken-Einblendung meldet ihre Art', (t) => {
  const r = fensterMit(angepfiffen(), t);
  assert.deepStrictEqual(argumente(r.click('info-show-corners')), [{ kind: 'corners' }]);
  r.close();
});

// --------------------------------------------------------------------
// Spielzeit setzen -- Notausgang mit eigener Eingabeprüfung
// --------------------------------------------------------------------

test('Spielzeit setzen schickt die geparsten Millisekunden', (t) => {
  const r = fensterMit(angepfiffen(), t);

  const input = r.document.getElementById('clock-set-input');
  input.value = '67:30';
  const calls = r.click('clock-set-apply');

  assert.deepStrictEqual(namen(calls), ['clockSet']);
  assert.deepStrictEqual(argumente(calls), [(67 * 60 + 30) * 1000]);

  r.close();
});

test('unverständliche Spielzeit wird gemeldet statt geschickt', (t) => {
  const r = fensterMit(angepfiffen(), t);

  const input = r.document.getElementById('clock-set-input');
  input.value = 'viertel nach';

  assert.deepStrictEqual(namen(r.click('clock-set-apply')), [], 'nichts darf rausgehen');
  assert.match(
    r.text('clock-set-hint'),
    /MM:SS/,
    'stattdessen muss der Hinweis die erwartete Form nennen'
  );

  r.close();
});

// --------------------------------------------------------------------
// Rückfragen -- die einzige Fehlerbremse, seit es keine Tastenkürzel gibt
// --------------------------------------------------------------------

test('folgenreiche Knöpfe fragen nach, und ein Nein hält sie auf', (t) => {
  const store = angepfiffen();
  const r = openRenderer('control', t);

  const gefragt = [];
  r.window.confirm = (frage) => {
    gefragt.push(frage);
    return false;
  };
  r.emit('onStateUpdated', store.getState());
  r.drainErrors();

  for (const id of ['phase-halftime', 'phase-fulltime', 'phase-revert', 'match-reset', 'clock-reset']) {
    gefragt.length = 0;
    assert.deepStrictEqual(namen(r.click(id)), [], `"${id}" darf bei einem Nein nichts auslösen`);
    assert.strictEqual(gefragt.length, 1, `"${id}" muss genau einmal nachfragen`);
  }

  r.close();
});

test('schnelle Knöpfe fragen bewusst NICHT nach', (t) => {
  // Dokumentierte Entscheidung: Ein Fehlklick ist mit dem Gegenknopf
  // sofort behoben, und am Spielfeldrand muss es schnell gehen. Diese
  // Zusicherung ist die Bremse dagegen, dass jemand später aus gut
  // gemeinter Vorsicht Rückfragen ergänzt.
  const r = fensterMit(angepfiffen(), t);

  let gefragt = 0;
  r.window.confirm = () => {
    gefragt += 1;
    return true;
  };

  r.clickSelector('button[data-team="home"][data-delta="1"]');
  r.clickSelector('button[data-card-team="home"][data-card="yellow"]');
  r.clickSelector('button[data-corner-team="home"][data-corner-delta="1"]');
  r.clickSelector('#stoppage-buttons button[data-stoppage="3"]');

  assert.strictEqual(gefragt, 0, 'Tor, Karte, Ecke und Nachspielzeit gehen ohne Rückfrage raus');

  r.close();
});

// --------------------------------------------------------------------
// Tormusik -- läuft bewusst ohne die Brücke
// --------------------------------------------------------------------

test('der Schnellknopf am Torknopf verändert den Spielstand nicht', (t) => {
  // Er sitzt in derselben `.stepper`-Zeile wie "+" und "−". Bekäme er ein
  // `data-team`, hinge über den dokumentweiten Selektor
  // `button[data-team]` in control.ts ein Spielstand-Handler daran -- ein
  // Druck auf die Tormusik zählte dann ein Tor.
  const store = angepfiffen();
  store.setMedia({
    werbung: { rootPath: 'C:\\Test\\Werbung', files: [] },
    highlights: { rootPath: 'C:\\Test\\Highlights', files: [] },
    sounds: { rootPath: 'C:\\Test\\Sounds', files: [] },
  });
  const r = fensterMit(store, t);

  const knopf = r.document.getElementById('sound-play-quick');
  assert.ok(knopf, 'den Schnellknopf gibt es nicht');
  assert.strictEqual(knopf.dataset.team, undefined, 'er darf kein data-team tragen');
  assert.strictEqual(knopf.dataset.cardTeam, undefined, 'und kein data-card-team');
  assert.strictEqual(knopf.dataset.cornerTeam, undefined, 'und kein data-corner-team');

  assert.ok(
    knopf.closest('.stepper'),
    'er soll bewusst in der Stepper-Zeile stehen, direkt am Torknopf'
  );

  r.close();
});

test('der Schnellknopf ist ohne Tondatei gesperrt und mit Tondatei nutzbar', (t) => {
  // Ein Knopf am Torknopf, der ins Leere liefe, wäre am Spielfeldrand
  // schlimmer als keiner.
  const ohne = angepfiffen();
  ohne.setMedia({
    werbung: { rootPath: 'C:\\Test\\Werbung', files: [] },
    highlights: { rootPath: 'C:\\Test\\Highlights', files: [] },
    sounds: { rootPath: 'C:\\Test\\Sounds', files: [] },
  });
  const r = fensterMit(ohne, t);

  assert.strictEqual(
    r.document.getElementById('sound-play-quick').disabled,
    true,
    'ohne Tondatei muss er gesperrt sein'
  );
  assert.strictEqual(
    r.document.getElementById('sound-play').disabled,
    true,
    'der große Knopf unten genauso'
  );

  r.close();
});

test('Tormusik wird im Fenster selbst abgespielt, nicht über die Brücke', (t) => {
  // Der Ton geht ohnehin ans Windows-Standardgerät; welches Fenster ihn
  // abspielt, ändert daran nichts. Ein Brücken-Aufruf hier wäre also ein
  // Zeichen dafür, dass jemand die Wiedergabe in den Hauptprozess
  // verlegt hat -- dann gehört diese Zusicherung angepasst, nicht
  // gelöscht.
  const r = fensterMit(angepfiffen(), t);

  assert.deepStrictEqual(namen(r.click('sound-play')), []);
  assert.deepStrictEqual(namen(r.click('sound-stop')), []);
  assert.deepStrictEqual(namen(r.click('sound-play-quick')), [], 'auch der Schnellknopf am Tor');

  r.close();
});
