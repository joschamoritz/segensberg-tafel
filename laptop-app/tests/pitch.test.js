/**
 * Aufstellung auf dem Spielfeld (Nutzerwunsch 21.10.2026): die
 * Grundordnung des Heimteams mit leeren Trikots, ohne Namen und Nummern.
 * Dritte Art im Wahlschalter neben Übersicht und Einzeln; der Gast-Knopf
 * zeigt bei dieser Wahl die Übersicht. Im Retro-Design als Punkte.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const { FORMATIONS, FORMATION_IDS, formationSpots } = load('shared/formations');
const { lineupSteps, lineupDurationMs } = load('shared/lineupSteps');
const { sanitizeFormation, sanitizeLineupStyle } = load('main/validate');
const { composeRetro } = load('shared/retroMatrix');
const { LINEUP_PAGE_MS } = load('shared/types');

test('jede Formation ergibt elf Plätze: Torwart vorn, alle auf dem Feld', () => {
  for (const id of FORMATION_IDS) {
    assert.equal(FORMATIONS[id].reduce((a, b) => a + b, 0), 10, `${id}: zehn Feldspieler`);
    const spots = formationSpots(id);
    assert.equal(spots.length, 11, id);
    assert.deepEqual(spots[0], { x: 0.06, y: 0.5 }, `${id}: Torwart zuerst, mittig vor dem Tor`);
    for (const { x, y } of spots) {
      assert.ok(x > 0 && x < 1 && y > 0 && y < 1, `${id}: (${x}, ${y}) liegt auf dem Feld`);
    }
  }
});

test('die Reihen liegen von hinten nach vorn, die Spitze am weitesten vorn', () => {
  const spots = formationSpots('4-2-3-1');
  const reihen = [...new Set(spots.slice(1).map((s) => s.x))];
  assert.deepEqual(reihen, [...reihen].sort((a, b) => a - b));
  assert.equal(spots.filter((s) => s.x === Math.max(...reihen)).length, 1, 'eine Spitze');
  assert.equal(spots.filter((s) => s.x === Math.min(...reihen)).length, 4, 'Viererkette');
});

test('Ablauf: Spielfeld nur für Heim, ohne Kader möglich; Gast bekommt die Übersicht', () => {
  const store = new MatchStateStore();
  store.setSquad('away', [player({ id: 'a1' })]);
  const state = store.getState();

  assert.deepEqual(JSON.parse(JSON.stringify(lineupSteps(state, 'home', 'pitch'))), [
    { kind: 'pitch', ms: LINEUP_PAGE_MS },
  ]);
  assert.deepEqual(
    lineupSteps(state, 'away', 'pitch').map((s) => s.kind),
    lineupSteps(state, 'away', 'overview').map((s) => s.kind)
  );
  assert.equal(lineupDurationMs(lineupSteps(state, 'home', 'pitch')), LINEUP_PAGE_MS);
});

test('Formation: Prüfschicht, gemerkt über „Neues Spiel“', () => {
  assert.equal(sanitizeFormation('4-2-3-1'), '4-2-3-1');
  assert.equal(sanitizeFormation('9-9-9'), '4-4-2');
  assert.equal(sanitizeFormation(undefined), '4-4-2');
  assert.equal(sanitizeLineupStyle('pitch'), 'pitch');

  const store = new MatchStateStore();
  store.setFormation('3-5-2');
  store.setLineupStyle('pitch');
  store.resetMatch();
  assert.equal(store.getState().formation, '3-5-2');
  assert.equal(store.getState().lineupStyle, 'pitch');
});

test('Tafel: elf leere Trikots an den Plätzen der Formation', (t) => {
  const store = new MatchStateStore();
  store.setLineupStyle('pitch');
  store.setFormation('4-2-3-1');
  store.showLineup('home');

  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());
  const aktiv = r.document.querySelector('.pre-page.is-active');
  assert.equal(aktiv.dataset.page, 'pitch');

  const trikots = [...r.document.querySelectorAll('#pitch-shirts .pitch-shirt')];
  assert.equal(trikots.length, 11);
  const erwartet = formationSpots('4-2-3-1').map((s) => [+(s.x * 100).toFixed(2), +(s.y * 100).toFixed(2)]);
  assert.deepEqual(trikots.map((svg) => [parseFloat(svg.style.left), parseFloat(svg.style.top)]), erwartet);
  assert.match(r.document.getElementById('pitch-title').textContent, /4-2-3-1/);
  // Leere Trikots: weder Nummer noch Name
  assert.equal(r.document.getElementById('pitch-shirts').textContent, '');

  // Eine andere Formation zeichnet die Seite neu, obwohl sich kein
  // Revisionszähler ändert.
  store.setFormation('5-4-1');
  r.emit('onStateUpdated', store.getState());
  const neu = [...r.document.querySelectorAll('#pitch-shirts .pitch-shirt')].map((svg) => svg.style.left);
  assert.equal(new Set(neu).size, 4, '5-4-1: Torwart plus drei Reihen');
  assert.deepEqual(r.drainErrors(), []);
});

test('Retro: Spieler als 3×3-Blöcke an ihren Plätzen', () => {
  const spots = formationSpots('4-4-2');
  const m = composeRetro({ kind: 'pitch', title: 'HOCHLAR 4-4-2', spots }, 96, 48);
  const left = 1;
  const width = 96 - 2 - left;
  const top = 8;
  const height = 48 - 1 - top;
  for (const spot of spots) {
    const cx = left + Math.round(spot.x * width);
    const cy = top + Math.round(spot.y * height);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      assert.ok(m.get(cx + dx, cy + dy), `Punkt (${cx + dx}, ${cy + dy}) leuchtet`);
    }
  }
});

test('Steuerung: dritte Art im Wahlschalter, Formation nur dort, Wahl wird geschickt', (t) => {
  const store = new MatchStateStore();
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());

  const art = r.document.getElementById('lineup-style');
  const formation = r.document.getElementById('lineup-formation');
  assert.ok([...art.options].some((o) => o.value === 'pitch'));
  assert.equal(formation.hidden, true, 'bei der Übersicht keine Formation');

  r.calls.length = 0;
  art.value = 'pitch';
  art.dispatchEvent(new r.window.Event('change'));
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [{ name: 'setLineupStyle', args: ['pitch'] }]);

  store.setLineupStyle('pitch');
  r.emit('onStateUpdated', store.getState());
  assert.equal(formation.hidden, false);
  assert.deepEqual([...formation.options].map((o) => o.value), FORMATION_IDS);

  r.calls.length = 0;
  formation.value = '4-3-3';
  formation.dispatchEvent(new r.window.Event('change'));
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [{ name: 'setFormation', args: ['4-3-3'] }]);
  assert.deepEqual(r.drainErrors(), []);
});
