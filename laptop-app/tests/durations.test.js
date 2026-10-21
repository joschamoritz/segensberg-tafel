/**
 * Einstellbare Standzeiten (Nutzerwunsch 21.10.2026).
 *
 * Die Zusage, die ohne Test still brechen könnte: Store und Anzeige
 * rechnen mit DERSELBEN eingestellten Zeit. Der Store räumt eine
 * Einblendung ab, die Anzeige blendet sie aus -- läse einer von beiden
 * weiter die feste Vorgabe, verschwände eine verlängerte Einblendung
 * mitten drin aus dem Zustand (und ein neu geöffnetes Anzeigefenster
 * sähe sie nicht mehr), oder eine verkürzte bliebe im Zustand hängen.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const v = load('main/validate');
const {
  DEFAULT_DURATIONS,
  DURATION_KEYS,
  goalStagesFor,
  goalCelebrationMs,
  infoOverlayDurationMs,
  MAX_DURATION_S,
} = load('shared/types');
const { lineupSteps, lineupDurationMs } = load('shared/lineupSteps');

const mit = (aenderung) => ({ ...DEFAULT_DURATIONS, ...aenderung });

// --------------------------------------------------------------------
// Prüfschicht und gemeinsame Rechnung
// --------------------------------------------------------------------

test('sanitizeDurations: Grenzen, halbe Sekunden, Vorgabe bei Unsinn', () => {
  assert.deepEqual(v.sanitizeDurations(undefined), DEFAULT_DURATIONS, 'ältere content.json');
  const geprüft = v.sanitizeDurations({ goalHome: 0, goalAway: 999, scorer: 7.3, info: NaN, sub: '5', slide: 15 });
  assert.equal(geprüft.goalHome, 1, 'unter einer Sekunde liest niemand etwas');
  assert.equal(geprüft.goalAway, MAX_DURATION_S);
  assert.equal(geprüft.scorer, 7.5, 'auf halbe Sekunden');
  assert.equal(geprüft.info, DEFAULT_DURATIONS.info, 'leeres Feld -> Vorgabe');
  assert.equal(geprüft.sub, DEFAULT_DURATIONS.sub, 'Text -> Vorgabe');
  assert.equal(geprüft.slide, 15);
});

test('die Vorgaben entsprechen den bisherigen festen Zeiten', () => {
  // Ein Update soll am Platz nichts verändern, solange niemand etwas einstellt.
  assert.deepEqual(DEFAULT_DURATIONS, {
    goalHome: 4, goalAway: 3, scorer: 8, info: 4, sub: 6, thanks: 8,
    lineupPage: 9, lineupPlayer: 4, slide: 12, slideBase: 20,
  });
});

test('Torjubel: nur das Vollbild ändert sich, das Einlaufen der Ziffer bleibt', () => {
  const d = mit({ goalHome: 7, goalAway: 2 });
  assert.deepEqual(goalStagesFor('home', d).map((s) => s.ms), [7000, 1800]);
  assert.deepEqual(goalStagesFor('away', d).map((s) => s.ms), [2000, 1200]);
  assert.equal(goalCelebrationMs('home', d), 8800);
});

test('Einblendungen und Aufstellung rechnen mit der eingestellten Zeit', () => {
  const d = mit({ info: 2, sub: 9, thanks: 15 });
  assert.equal(infoOverlayDurationMs({ kind: 'corners' }, d), 2000);
  assert.equal(infoOverlayDurationMs({ kind: 'sub', eventId: 1 }, d), 9000);
  assert.equal(infoOverlayDurationMs({ kind: 'attendance' }, d), 15000);

  const store = new MatchStateStore();
  store.setSquad('home', [player({ id: 'a', number: 1 }), player({ id: 'b', number: 2 })]);
  store.setDurations(mit({ lineupPage: 5, lineupPlayer: 2 }));
  const zustand = store.getState();
  assert.equal(lineupDurationMs(lineupSteps(zustand, 'home', 'overview')), 5000);
  assert.equal(lineupDurationMs(lineupSteps(zustand, 'home', 'single')), 4000);
});

// --------------------------------------------------------------------
// Store
// --------------------------------------------------------------------

test('der Store räumt nach der eingestellten Zeit ab, nicht nach der Vorgabe', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.setDurations(mit({ info: 10 }));
  store.showInfo({ kind: 'corners' });

  t.mock.timers.tick(DEFAULT_DURATIONS.info * 1000);
  assert.ok(store.getState().infoRequest, 'nach der alten Vorgabe noch da');
  t.mock.timers.tick(10000 - DEFAULT_DURATIONS.info * 1000);
  assert.equal(store.getState().infoRequest, null);
});

test('„Neues Spiel“ lässt die Standzeiten stehen', () => {
  const store = new MatchStateStore();
  store.setDurations(mit({ scorer: 12 }));
  store.resetMatch();
  assert.equal(store.getState().durations.scorer, 12);
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

/** Merkt sich die Dauer jedes Zeitschalters des Fensters. */
function zeitschalter(r) {
  const dauern = [];
  r.window.setTimeout = (_fn, ms) => {
    dauern.push(ms);
    return dauern.length;
  };
  r.window.clearTimeout = () => {};
  return dauern;
}

test('display: Jubel und Diashow nehmen die eingestellte Zeit', (t) => {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.setDurations(mit({ goalHome: 7, slide: 15 }));
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());

  const dauern = zeitschalter(r);
  store.incrementScore('home', 1);
  r.emit('onStateUpdated', store.getState());
  assert.ok(dauern.includes(7000), `Vollbild 7 s erwartet, geplant: ${dauern}`);
  assert.ok(!dauern.includes(4000), 'nicht die alte Vorgabe');
  assert.deepEqual(r.drainErrors(), []);
});

test('display: die Diashow wechselt nach der eingestellten Folienzeit', (t) => {
  const store = new MatchStateStore();
  store.setMedia(
    Object.fromEntries(
      ['werbung', 'hauptsponsor', 'partner', 'highlights', 'historie', 'sounds', 'wettbewerbe'].map((id) => [
        id,
        { rootPath: id, files: id === 'werbung' ? ['a.png'] : [] },
      ])
    )
  );
  store.setDurations(mit({ slide: 15 }));
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());
  const dauern = zeitschalter(r);
  store.startSlideshow();
  r.emit('onStateUpdated', store.getState());
  assert.ok(dauern.includes(15000), `Folie 15 s erwartet, geplant: ${dauern}`);
  assert.deepEqual(r.drainErrors(), []);
});

// --------------------------------------------------------------------
// Steuerungsfenster
// --------------------------------------------------------------------

test('control: ein Feld je Standzeit, Änderung und Vorgaben gehen raus', (t) => {
  const store = new MatchStateStore();
  store.setDurations(mit({ scorer: 10 }));
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());

  const felder = [...r.document.querySelectorAll('#duration-grid input')];
  assert.deepEqual(felder.map((f) => f.id), DURATION_KEYS.map((k) => `duration-${k}`));
  assert.equal(r.document.getElementById('duration-scorer').value, '10');

  r.calls.length = 0;
  const feld = r.document.getElementById('duration-goalHome');
  feld.value = '6';
  feld.dispatchEvent(new r.window.Event('change'));
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [
    { name: 'setDurations', args: [mit({ scorer: 10, goalHome: 6 })] },
  ]);

  const vorgaben = r.click('duration-reset');
  assert.deepEqual(JSON.parse(JSON.stringify(vorgaben)), [{ name: 'setDurations', args: [DEFAULT_DURATIONS] }]);
  assert.deepEqual(r.drainErrors(), []);
});
