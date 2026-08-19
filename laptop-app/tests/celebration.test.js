/**
 * Torjubel.
 *
 * Zwei Akte: erst eine Vollbildfläche, dann zurück auf die normale
 * Spielansicht, in der die neue Ziffer von oben einläuft. Zwischenseiten
 * mit Mannschaftsnamen oder Torschützen gibt es bewusst nicht mehr
 * (Nutzerentscheidung 19.08.2026).
 *
 * Die Choreografie selbst steckt in `display.css` und lässt sich hier
 * nicht beurteilen -- geprüft wird, dass der Renderer die richtige Stufe
 * setzt, die richtigen Ziffern markiert und beim Gegentor nichts vom
 * Heimjubel übrig lässt.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const {
  AWAY_GOAL_STAGES,
  goalCelebrationMs,
  goalStagesFor,
  HOME_GOAL_STAGES,
  isLeadChange,
  showsLeadChangeFrame,
} = load('shared/types');

// --------------------------------------------------------------------
// Führungswechsel
// --------------------------------------------------------------------

/** Kurzform für ein Tor mit gegebenem Zwischenstand danach. */
function tor(team, scoreHome, scoreAway) {
  return { id: 1, type: 'goal', team, minute: 1, scoreHome, scoreAway, celebrate: true };
}

test('ein Führungswechsel ist, wenn die treffende Mannschaft jetzt führt', () => {
  assert.equal(isLeadChange(tor('home', 1, 0)), true, '0:0 -> 1:0 dreht die Führung');
  assert.equal(isLeadChange(tor('home', 2, 1)), true, '1:1 -> 2:1 dreht die Führung');
  assert.equal(isLeadChange(tor('away', 0, 1)), true, '0:0 -> 0:1 dreht die Führung');
  assert.equal(isLeadChange(tor('away', 1, 2)), true, '1:0 -> 1:2 dreht die Führung');
});

test('ein Ausgleich ist kein Führungswechsel', () => {
  // Dabei wechselt keine Führung -- sie ist danach weg.
  assert.equal(isLeadChange(tor('home', 1, 1)), false, '0:1 -> 1:1 gleicht nur aus');
  assert.equal(isLeadChange(tor('away', 2, 2)), false, '2:1 -> 2:2 gleicht nur aus');
});

test('das Nachlegen des bereits Führenden ist kein Führungswechsel', () => {
  assert.equal(isLeadChange(tor('home', 3, 0)), false, '2:0 -> 3:0 führte schon');
  assert.equal(isLeadChange(tor('away', 0, 2)), false, '0:1 -> 0:2 führte schon');
});

test('der Rahmenpuls kommt nur beim EIGENEN Führungswechsel', () => {
  // Der Rahmen ist eine Feier. Die Führungsübernahme des Gegners ist
  // keine -- sie sachlich zu melden reicht (Nutzerentscheidung
  // 19.08.2026).
  assert.equal(showsLeadChangeFrame(tor('home', 1, 0)), true);
  assert.equal(
    showsLeadChangeFrame(tor('away', 0, 1)),
    false,
    'beim Gegentor bleibt der Rahmen aus, auch wenn die Führung wechselt'
  );
  assert.equal(showsLeadChangeFrame(tor('away', 1, 2)), false);
  assert.equal(showsLeadChangeFrame(tor('home', 3, 0)), false, 'kein Führungswechsel');
});

// --------------------------------------------------------------------
// Ablauf
// --------------------------------------------------------------------

test('beide Abläufe enden auf der normalen Spielansicht', () => {
  // Der Zwischenstand wechselt dort, wo die Zuschauer ihn ohnehin
  // suchen -- nicht auf einer weiteren Vollbildseite.
  assert.deepEqual(HOME_GOAL_STAGES.map((e) => e.stage), ['word', 'boost']);
  assert.deepEqual(AWAY_GOAL_STAGES.map((e) => e.stage), ['plain', 'boost']);
  assert.deepEqual(goalStagesFor('home'), HOME_GOAL_STAGES);
  assert.deepEqual(goalStagesFor('away'), AWAY_GOAL_STAGES);
});

test('der Heimjubel dauert länger als der Gegentor-Hinweis', () => {
  // Das ist der Kern des Nutzerwunsches: beim eigenen Verein mehr
  // Aktion, beim Gegner sachlich. Rutschten die Werte einmal
  // aneinander, wäre die Unterscheidung stillschweigend weg.
  assert.equal(
    goalCelebrationMs('home'),
    HOME_GOAL_STAGES.reduce((s, e) => s + e.ms, 0)
  );
  assert.ok(
    goalCelebrationMs('home') > goalCelebrationMs('away'),
    `Heim ${goalCelebrationMs('home')}ms gegen Gast ${goalCelebrationMs('away')}ms`
  );
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

/** Angepfiffenes Spiel mit Kader. */
function spiel() {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.setTeamName('home', 'SV Hochlar 28');
  store.setTeamName('away', 'SV Horst Emscher');
  store.setSquad('home', [player({ id: 'h1', number: 9, lastName: 'Schmalenbach' })]);
  return store;
}

/**
 * Ersetzt die Zeitschalter des Fensters, damit sich der Ablauf ohne
 * echtes Warten weiterschalten lässt.
 *
 * Muss NACH `openRenderer` und VOR dem Tor gerufen werden: Der gebündelte
 * Renderer schlägt `setTimeout` bei jedem Aufruf am Fenster nach, ein
 * späterer Tausch wirkt also rückwirkend nicht auf schon gestellte
 * Schalter. Alle Schalter des Jubels werden im selben Augenblick
 * gestellt, ihr `ms` ist deshalb zugleich der Zeitpunkt ab Torbeginn.
 */
function zeitRaffen(r) {
  const geplant = new Map();
  let naechsteId = 1;

  r.window.setTimeout = (rueckruf, ms) => {
    const id = naechsteId++;
    geplant.set(id, { rueckruf, ms });
    return id;
  };
  r.window.clearTimeout = (id) => geplant.delete(id);

  return {
    /** Führt alle Rückrufe aus, die bis `ms` nach Torbeginn fällig wären. */
    vorspulen(ms) {
      for (const [id, eintrag] of [...geplant]) {
        if (eintrag.ms <= ms) {
          geplant.delete(id);
          eintrag.rueckruf();
        }
      }
    },
    /** Wie viele Schalter noch stehen. */
    offen: () => geplant.size,
  };
}

/**
 * Schiebt erst den Ausgangszustand und dann das Tor hinein.
 *
 * Zwei Schritte, weil die Anzeige beim allerersten Zustand bewusst
 * keinen Jubel nachholt -- ein neu geöffnetes Fenster soll nicht mit
 * einem alten Tor anfangen.
 */
function torSchiessen(r, store, team) {
  r.emit('onStateUpdated', store.getState());
  store.incrementScore(team, 1);
  r.emit('onStateUpdated', store.getState());
}

/** Welche Ziffern des Spielstands gerade einlaufen. */
function rollend(r, team) {
  return [...r.document.getElementById(`${team}-score`).children].map((z) =>
    z.classList.contains('is-rolling')
  );
}

test('display: ein Heimtor beginnt mit dem Vollbild-Schriftzug', (t) => {
  const r = openRenderer('display', t);
  const store = spiel();
  torSchiessen(r, store, 'home');

  assert.ok(r.document.body.classList.contains('celebrating'), 'die Vollbildfläche fehlt');
  assert.equal(r.document.body.dataset.goalStage, 'word');
  assert.equal(r.text('goal-word'), 'TOR!');
  assert.ok(r.document.body.classList.contains('goal-home'), 'Konfetti hängt an dieser Marke');

  assert.deepEqual(r.drainErrors(), []);
});

test('display: ein Gegentor bleibt sachlich', (t) => {
  const r = openRenderer('display', t);
  const store = spiel();
  torSchiessen(r, store, 'away');

  assert.equal(r.document.body.dataset.goalStage, 'plain');
  assert.equal(r.text('goal-word'), 'TOR', 'gejubelt wird beim Gegentor nicht');
  assert.equal(
    r.document.body.classList.contains('goal-home'),
    false,
    'ohne diese Marke fällt kein Konfetti'
  );

  assert.deepEqual(r.drainErrors(), []);
});

test('display: im Jubel steht das Wappen der treffenden Mannschaft', (t) => {
  // Beim Gast genauso wie beim eigenen Verein: Logos sind für alle
  // Vereine hinterlegt, und der normale Spielbildschirm zeigt sie
  // ohnehin nebeneinander. Ein ausgeschriebener Name fiele hier aus dem
  // Bild.
  const r = openRenderer('display', t);
  const store = spiel();
  store.setTeamLogo('home', 'data:image/png;base64,HEIM');
  store.setTeamLogo('away', 'data:image/png;base64,GAST');
  const crest = r.document.getElementById('goal-crest');
  const name = r.document.getElementById('goal-team');

  torSchiessen(r, store, 'away');
  assert.equal(crest.hidden, false, 'auch das Gegentor bekommt sein Wappen');
  assert.ok(crest.getAttribute('src').endsWith('GAST'), 'und zwar das der Gastmannschaft');
  assert.equal(name.hidden, true, 'neben dem Wappen steht kein Name');

  store.incrementScore('home', 1);
  r.emit('onStateUpdated', store.getState());
  assert.equal(crest.hidden, false);
  assert.ok(crest.getAttribute('src').endsWith('HEIM'));

  assert.deepEqual(r.drainErrors(), []);
});

test('display: ohne hinterlegtes Logo springt der Vereinsname ein', (t) => {
  // Dieselbe Regel wie beim Wappen auf dem Spielbildschirm -- lieber ein
  // Name als eine leere Fläche.
  const r = openRenderer('display', t);
  const store = spiel();
  torSchiessen(r, store, 'away');

  assert.equal(r.document.getElementById('goal-crest').hidden, true);
  assert.equal(r.document.getElementById('goal-team').hidden, false);
  assert.equal(r.text('goal-team'), 'SV Horst Emscher');

  assert.deepEqual(r.drainErrors(), []);
});

test('display: die neue Ziffer läuft im Spielstand der normalen Ansicht ein', (t) => {
  // Der Kern der Umstellung: kein eigener Bildschirm mehr für den
  // Zwischenstand. In der zweiten Stufe ist die Vollbildfläche weg und
  // der Spielstand wieder da.
  const r = openRenderer('display', t);
  const store = spiel();
  r.emit('onStateUpdated', store.getState());

  const uhr = zeitRaffen(r);
  store.incrementScore('home', 1);
  r.emit('onStateUpdated', store.getState());

  assert.deepEqual(rollend(r, 'home'), [false], 'im Vollbild läuft noch nichts');

  uhr.vorspulen(HOME_GOAL_STAGES[0].ms);

  assert.equal(r.document.body.dataset.goalStage, 'boost');
  assert.equal(
    r.document.body.classList.contains('celebrating'),
    false,
    'die Vollbildfläche muss weg sein, sonst sieht niemand die Ziffer'
  );
  assert.deepEqual(rollend(r, 'home'), [true], 'die Ziffer der treffenden Mannschaft läuft ein');
  assert.deepEqual(rollend(r, 'away'), [false], 'die andere bleibt stehen');

  assert.deepEqual(r.drainErrors(), []);
});

test('display: beim Gegentor läuft die Ziffer der Gastmannschaft ein', (t) => {
  const r = openRenderer('display', t);
  const store = spiel();
  r.emit('onStateUpdated', store.getState());

  const uhr = zeitRaffen(r);
  store.incrementScore('away', 1);
  r.emit('onStateUpdated', store.getState());
  uhr.vorspulen(AWAY_GOAL_STAGES[0].ms);

  assert.equal(r.document.body.dataset.goalStage, 'boost');
  assert.deepEqual(rollend(r, 'away'), [true]);
  assert.deepEqual(rollend(r, 'home'), [false]);

  assert.deepEqual(r.drainErrors(), []);
});

test('display: nach dem letzten Akt ist von allem nichts mehr übrig', (t) => {
  const r = openRenderer('display', t);
  const store = spiel();
  r.emit('onStateUpdated', store.getState());

  const uhr = zeitRaffen(r);
  store.incrementScore('home', 1);
  r.emit('onStateUpdated', store.getState());
  uhr.vorspulen(goalCelebrationMs('home'));

  assert.equal(r.document.body.dataset.goalStage, undefined);
  assert.equal(r.document.body.classList.contains('celebrating'), false);
  assert.equal(r.document.body.classList.contains('goal-home'), false);
  assert.equal(r.document.body.classList.contains('goal-lead-change'), false);
  assert.deepEqual(rollend(r, 'home'), [false], 'die Laufmarke gehört wieder weg');
  assert.equal(uhr.offen(), 0, 'es steht kein Zeitschalter mehr offen');

  assert.deepEqual(r.drainErrors(), []);
});

test('display: der Rahmenpuls hängt am eigenen Führungswechsel', (t) => {
  const r = openRenderer('display', t);
  const store = spiel();

  torSchiessen(r, store, 'home');
  assert.ok(
    r.document.body.classList.contains('goal-lead-change'),
    '0:0 -> 1:0 ist ein eigener Führungswechsel'
  );

  store.incrementScore('home', 1);
  r.emit('onStateUpdated', store.getState());
  assert.equal(
    r.document.body.classList.contains('goal-lead-change'),
    false,
    '2:0 ist keiner'
  );

  // Der Gegner dreht die Führung -- gefeiert wird das nicht.
  store.incrementScore('away', 1);
  store.incrementScore('away', 1);
  r.emit('onStateUpdated', store.getState());
  store.incrementScore('away', 1);
  r.emit('onStateUpdated', store.getState());
  assert.equal(
    r.document.body.classList.contains('goal-lead-change'),
    false,
    'beim Gegentor bleibt der Rahmen aus'
  );

  assert.deepEqual(r.drainErrors(), []);
});

test('display: ein zweites Tor räumt die Zeitschalter des ersten ab', (t) => {
  // Zwei Tore kurz hintereinander gibt es. Bliebe der alte Ablauf
  // stehen, schaltete sein Zeitschalter den neuen Jubel mitten hinein
  // auf die nächste Stufe weiter.
  const r = openRenderer('display', t);
  const store = spiel();
  r.emit('onStateUpdated', store.getState());

  const uhr = zeitRaffen(r);

  store.incrementScore('home', 1);
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.document.body.dataset.goalStage, 'word');
  assert.equal(uhr.offen(), HOME_GOAL_STAGES.length, 'ein Stufenwechsel und das Ende');

  store.incrementScore('away', 1);
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.document.body.dataset.goalStage, 'plain', 'der neue Jubel gilt');
  assert.equal(uhr.offen(), AWAY_GOAL_STAGES.length, 'vom Heimjubel darf nichts übrig sein');

  // Der Punkt der Sache: Zum Zeitpunkt des Stufenwechsels des Heimtors
  // darf nichts mehr umspringen.
  uhr.vorspulen(HOME_GOAL_STAGES[0].ms - 1);
  assert.equal(r.document.body.dataset.goalStage, 'plain', 'die Stufe ist umgesprungen');

  assert.deepEqual(r.drainErrors(), []);
});
