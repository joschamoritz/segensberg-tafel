/**
 * Smoke-Test beider Fenster.
 *
 * Prüft NICHT, ob das Layout gut aussieht -- Schriftgrößen, Umbrüche und
 * Zeilenzahlen bleiben Sache eines Testlaufs am Gerät. Geprüft wird, dass
 * beide Renderer jeden Spielzustand ohne Fehler durchlaufen. Genau das
 * ließ sich bisher nicht automatisch feststellen: TypeScript übersetzt
 * ein `getElementById('x')!` auf ein entferntes Element klaglos, und in
 * der Anzeige verschluckt `step()` den Absturz sogar zur Laufzeit in die
 * Konsole.
 *
 * Die Zustände kommen aus dem echten `MatchStateStore`, nicht aus
 * handgeschriebenen Objekten. Das ist Absicht: So bricht dieser Test auch
 * dann, wenn Store und Renderer auseinanderlaufen -- etwa weil ein neues
 * Feld im Zustand auftaucht, das die Anzeige noch nicht kennt.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const { DEFAULT_APPEARANCE, DISPLAY_THEMES } = load('shared/types');

// --------------------------------------------------------------------
// Zustände zum Durchschieben
// --------------------------------------------------------------------

/** Angepfiffenes Spiel mit angehaltener Uhr (der Tick-Timer hielte den Lauf offen). */
function angepfiffen() {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  return store;
}

/** Elf Spieler plus Bank -- genug, dass die Aufstellungsseiten umbrechen. */
function kader(prefix) {
  return Array.from({ length: 16 }, (_, i) =>
    player({
      id: `${prefix}${i + 1}`,
      number: i + 1,
      firstName: `Vorname${i + 1}`,
      lastName: `Nachname${i + 1}`,
      position: i === 0 ? 'TW' : 'MF',
      role: i < 11 ? 'start' : 'bench',
      isGoalkeeper: i === 0,
      isCaptain: i === 3,
    })
  );
}

/**
 * Spiel mit gefüllten Kadern, Toren, Karten und einer Torschützenliste,
 * die länger ist als der Platz auf der Tafel.
 */
function volleslSpiel() {
  const store = angepfiffen();
  store.setTeamName('home', 'SV Hochlar 28');
  store.setTeamName('away', 'SV Horst Emscher');
  store.setSquad('home', kader('h'));
  store.setSquad('away', kader('a'));
  store.setCoach('home', 'Hans Meier');

  // Mehr Tore als Zeilen -- damit greift das Abschneiden der Liste.
  for (let i = 0; i < 8; i++) {
    store.incrementScore('home', 1);
    const tore = store.getState().events.filter((e) => e.type === 'goal');
    store.setGoalScorer(tore.at(-1).id, `h${(i % 6) + 1}`);
  }
  store.incrementScore('away', 1);

  store.addCard('home', 'yellow');
  store.addCard('away', 'red');
  store.addCard('home', 'yellow-red');

  store.adjustCorners('home', 5);
  store.setAttendance(312);
  return store;
}

/**
 * Alle Zustände, die auf der Tafel vorkommen können -- je mit einem
 * sprechenden Namen, damit ein Fehlschlag sofort zuzuordnen ist.
 */
function alleZustaende() {
  const faelle = [];

  faelle.push(['frisches Spiel, leerer Kader', new MatchStateStore().getState()]);

  const leer = angepfiffen();
  faelle.push(['angepfiffen, nichts passiert', leer.getState()]);

  const voll = volleslSpiel();
  faelle.push(['1. Halbzeit mit Toren und Karten', voll.getState()]);

  voll.setStoppage(3);
  faelle.push(['Nachspielzeit angezeigt', voll.getState()]);

  voll.goToHalfTime();
  faelle.push(['Halbzeitpause', voll.getState()]);

  voll.startSecondHalf();
  voll.stopClock();
  faelle.push(['2. Halbzeit', voll.getState()]);

  voll.goToFullTime();
  faelle.push(['Endstand', voll.getState()]);

  // Einblendungen -- jede einzeln, sie lösen einander im Store ab.
  const einblendung = volleslSpiel();
  einblendung.showLineup('home');
  faelle.push(['Aufstellung Heim eingeblendet', einblendung.getState()]);

  einblendung.showLineup('away');
  faelle.push(['Aufstellung Gast eingeblendet', einblendung.getState()]);

  const torschuetze = volleslSpiel();
  const tor = torschuetze.getState().events.find((e) => e.type === 'goal');
  torschuetze.showScorer(tor.id);
  faelle.push(['Torschützen-Einblendung', torschuetze.getState()]);

  const info = volleslSpiel();
  info.showInfo({ kind: 'corners' });
  faelle.push(['Einblendung Ecken', info.getState()]);

  info.showInfo({ kind: 'attendance' });
  faelle.push(['Einblendung Zuschauerzahl', info.getState()]);

  const karte = volleslSpiel();
  const gelbrot = karte.getState().events.find((e) => e.type === 'card' && e.card === 'yellow-red');
  karte.showInfo({ kind: 'card', eventId: gelbrot.id });
  faelle.push(['Einblendung Karte', karte.getState()]);

  return faelle;
}

/**
 * Dieselben Zustände in einem anderen Design. Das HTML ist für alle
 * Designs dasselbe -- aber der Renderer liest den Zustand jedes Mal neu,
 * und ein Fehler, der nur bei einem bestimmten Design auftritt, fiele im
 * klassischen Durchlauf nicht auf.
 */
function imDesign(theme, alleEffekte) {
  const effects = { verlauf: alleEffekte, strahlen: alleEffekte, leuchten: alleEffekte, schatten: alleEffekte };
  return alleZustaende().map(([name, state]) => [
    name,
    { ...state, appearance: { ...DEFAULT_APPEARANCE, theme, effects } },
  ]);
}

// --------------------------------------------------------------------
// Der eigentliche Durchlauf
// --------------------------------------------------------------------

for (const theme of DISPLAY_THEMES.filter((t) => t !== DEFAULT_APPEARANCE.theme)) {
  for (const alleEffekte of [true, false]) {
    const variante = `${theme}, Effekte ${alleEffekte ? 'an' : 'aus'}`;

    test(`display: verträgt jeden Spielzustand im Design ${variante}`, (t) => {
      const r = openRenderer('display', t);
      r.drainErrors();
      for (const [name, state] of imDesign(theme, alleEffekte)) {
        r.emit('onStateUpdated', state);
        assert.deepEqual(r.drainErrors(), [], `Zustand "${name}" hat einen Fehler ausgelöst`);
        assert.equal(r.document.body.dataset.theme, theme, `Zustand "${name}"`);
      }
    });

    test(`control: verträgt jeden Spielzustand im Design ${variante}`, (t) => {
      const r = openRenderer('control', t);
      r.drainErrors();
      for (const [name, state] of imDesign(theme, alleEffekte)) {
        r.emit('onStateUpdated', state);
        assert.deepEqual(r.drainErrors(), [], `Zustand "${name}" hat einen Fehler ausgelöst`);
      }
      assert.equal(r.document.getElementById('theme-select').value, theme);
    });
  }
}

for (const fenster of ['control', 'display']) {
  test(`${fenster}: baut ohne Fehler auf`, (t) => {
    const r = openRenderer(fenster, t);
    assert.deepEqual(r.drainErrors(), [], 'schon beim Aufbau ist etwas schiefgegangen');
    r.close();
  });

  test(`${fenster}: verträgt jeden Spielzustand`, (t) => {
    const r = openRenderer(fenster, t);
    r.drainErrors();

    for (const [name, state] of alleZustaende()) {
      r.emit('onStateUpdated', state);
      assert.deepEqual(r.drainErrors(), [], `Zustand "${name}" hat einen Fehler ausgelöst`);
    }

    r.close();
  });

  test(`${fenster}: verträgt Uhr-Ticks auf dem schlanken Kanal`, (t) => {
    // Der Uhr-Tick geht bewusst NICHT über den vollständigen Zustand.
    // Die Renderer müssen deshalb auch ohne vorherigen Zustand damit
    // umgehen -- genau die Reihenfolge nach einem Fensterneustart.
    const r = openRenderer(fenster, t);
    r.drainErrors();

    r.emit('onClockTick', { elapsedMs: 0, running: false });
    assert.deepEqual(r.drainErrors(), [], 'Uhr-Tick ohne vorherigen Zustand');

    r.emit('onStateUpdated', volleslSpiel().getState());
    r.drainErrors();

    for (const minuten of [1, 44, 45, 47, 90, 93]) {
      r.emit('onClockTick', { elapsedMs: minuten * 60_000, running: true });
      assert.deepEqual(r.drainErrors(), [], `Uhr-Tick bei ${minuten} Minuten`);
    }

    r.close();
  });
}

// --------------------------------------------------------------------
// Zusicherungen, die über "es kracht nicht" hinausgehen
// --------------------------------------------------------------------

test('display: die Phasen-Überschrift steht auf der Tafel', (t) => {
  // Sichert zugleich ab, dass die nach `shared/phaseLabels.ts` gezogene
  // Beschriftung im gebündelten Renderer tatsächlich ankommt.
  const r = openRenderer('display', t);
  const store = volleslSpiel();

  r.emit('onStateUpdated', store.getState());
  assert.equal(r.text('phase-label'), '', 'im laufenden Spiel gehört die Fläche dem Spielstand');

  store.goToHalfTime();
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.text('phase-label'), 'HALBZEIT');

  store.startSecondHalf();
  store.stopClock();
  store.goToFullTime();
  r.emit('onStateUpdated', store.getState());
  // Mit Halbzeitstand wie im Spielbericht (Review N12)
  assert.match(r.text('phase-label'), /^ENDSTAND · HZ \d+:\d+$/);

  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('display: der Spielstand landet auf der Tafel', (t) => {
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', volleslSpiel().getState());

  assert.equal(r.text('home-score'), '8');
  assert.equal(r.text('away-score'), '1');
  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('control: die Statuszeile nennt die laufende Phase', (t) => {
  const r = openRenderer('control', t);
  const store = volleslSpiel();

  r.emit('onStateUpdated', store.getState());
  assert.equal(r.text('phase-current-label'), '1. Halbzeit läuft');

  store.goToHalfTime();
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.text('phase-current-label'), 'Halbzeitpause');

  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('control: der Knopf zum Zurücknehmen kündigt sein Ziel an', (t) => {
  // Die Ansage am Knopf ist das, was `tests/phaseLabels.test.js` gegen
  // den Store prüft -- hier geht es darum, dass sie den Knopf erreicht.
  const r = openRenderer('control', t);
  const store = volleslSpiel();

  r.emit('onStateUpdated', store.getState());
  const knopf = r.document.getElementById('phase-revert');
  assert.equal(knopf.disabled, false);
  assert.equal(knopf.title, 'Zurück zu: Vor Anpfiff');

  store.goToHalfTime();
  r.emit('onStateUpdated', store.getState());
  assert.equal(knopf.title, 'Zurück zu: 1. Halbzeit');

  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('control: vor dem Anpfiff ist das Zurücknehmen gesperrt', (t) => {
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', new MatchStateStore().getState());

  const knopf = r.document.getElementById('phase-revert');
  assert.equal(knopf.disabled, true);
  assert.equal(knopf.title, '');

  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('display: die Torschützenliste hält die Obergrenze ein', (t) => {
  // Acht Tore und ein Platzverweis ergeben mehr Zeilen, als im laufenden
  // Spiel unter das Wappen passen (6). Die Liste muss also etwas
  // anzeigen, dabei die Grenze einhalten und das Abschneiden kenntlich
  // machen -- sonst sähe sie aus, als wäre das schon alles gewesen.
  const r = openRenderer('display', t);
  const store = volleslSpiel();
  r.emit('onStateUpdated', store.getState());

  const zeilen = () => [...r.document.querySelectorAll('#home-scorers li:not(.scorer-more)')];
  const abschneideZeichen = () => r.document.querySelectorAll('#home-scorers .scorer-more').length;

  assert.ok(zeilen().length > 0, 'die Liste ist leer geblieben');
  assert.equal(zeilen().length, 6, 'im laufenden Spiel sind 6 Zeilen die Obergrenze');
  assert.equal(abschneideZeichen(), 1, 'das Abschneiden hätte gekennzeichnet werden müssen');

  // Im Endstand ist mehr Platz -- die Grenze steigt auf 9.
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();
  store.goToFullTime();
  r.emit('onStateUpdated', store.getState());

  assert.equal(zeilen().length, 7, 'im Endstand passen alle Zeilen');
  assert.equal(abschneideZeichen(), 0, 'hier wurde nichts abgeschnitten');

  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

// Der Harness löst DOMContentLoaded selbst aus; jsdom tut es danach noch
// einmal. Lief `main()` doppelt, stand jeder Rückruf zweimal da, und die
// Anzeige warf eine eben gestartete Aufstellung auf die Begegnung zurück.
for (const name of ['display', 'control']) {
  test(`${name}: main() läuft im Test genau einmal`, async (t) => {
    const r = openRenderer(name, t);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(r.calls.filter((c) => c.name === 'requestState').length, 1);
  });
}
