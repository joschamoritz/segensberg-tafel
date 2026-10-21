/**
 * Shortcuts für Aufstellung (neben dem Vereinsnamen) und Diashow (in der
 * Phasenzeile), Nutzerwunsch 21.10.2026.
 *
 * Zusagen:
 * - Aufstellung nur vor dem Anpfiff, Diashow in jeder Phase außer dem
 *   laufenden Spiel. Außerhalb davon AUSGEBLENDET, nicht nur ausgegraut.
 * - Derselbe Knopf startet und beendet.
 * - Der Aufstellungsknopf zählt kein Tor (kein data-team).
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');

const json = (x) => JSON.parse(JSON.stringify(x));

function mitWerbung() {
  const store = new MatchStateStore();
  store.setMedia(
    Object.fromEntries(
      ['werbung', 'hauptsponsor', 'partner', 'highlights', 'historie', 'sounds', 'wettbewerbe'].map((id) => [
        id,
        { rootPath: id, files: id === 'werbung' ? ['a.png'] : [] },
      ])
    )
  );
  store.setSquad('home', [player({ id: 'h1' })]);
  return store;
}

test('control: Aufstellung neben dem Vereinsnamen startet und beendet', (t) => {
  const store = mitWerbung();
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());

  const heim = r.document.getElementById('lineup-quick-home');
  assert.equal(heim.hidden, false);
  assert.ok(heim.closest('.team-home'), 'steht in der Heimspalte');
  assert.equal(heim.hasAttribute('data-team'), false);
  assert.deepEqual(json(r.click('lineup-quick-home')), [{ name: 'showLineup', args: ['home'] }]);

  store.showLineup('home');
  r.emit('onStateUpdated', store.getState());
  assert.equal(heim.textContent, '■ Beenden');
  assert.equal(r.document.getElementById('lineup-quick-away').textContent, 'Aufstellung ▶', 'nur die laufende Mannschaft');
  assert.deepEqual(json(r.click('lineup-quick-home')), [{ name: 'hideLineup', args: [] }]);
  store.hideLineup();
  assert.deepEqual(r.drainErrors(), []);
});

test('control: Aufstellungs-Shortcut ab dem Anpfiff ausgeblendet', (t) => {
  const store = mitWerbung();
  const r = openRenderer('control', t);
  for (const schritt of [() => store.kickoff(), () => store.goToHalfTime()]) {
    schritt();
    store.stopClock();
    r.emit('onStateUpdated', store.getState());
    assert.equal(r.document.getElementById('lineup-quick-home').hidden, true, store.getState().phase);
    assert.equal(r.document.getElementById('lineup-quick-away').hidden, true);
  }
  assert.deepEqual(r.drainErrors(), []);
});

test('control: Diashow-Shortcut in der Phasenzeile, im Spiel ausgeblendet', (t) => {
  const store = mitWerbung();
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());

  const quick = r.document.getElementById('slideshow-quick');
  assert.ok(quick.closest('.phase-buttons'));
  assert.equal(quick.hidden, false, 'vor dem Anpfiff');
  assert.deepEqual(json(r.click('slideshow-quick')), [{ name: 'slideshowStart', args: [] }]);

  store.startSlideshow();
  r.emit('onStateUpdated', store.getState());
  assert.equal(quick.textContent, '■ Diashow');
  assert.deepEqual(json(r.click('slideshow-quick')), [{ name: 'slideshowStop', args: [] }]);

  store.kickoff();
  store.stopClock();
  r.emit('onStateUpdated', store.getState());
  assert.equal(quick.hidden, true, 'im Spiel');

  store.goToHalfTime();
  r.emit('onStateUpdated', store.getState());
  assert.equal(quick.hidden, false, 'in der Pause wieder da');
  assert.equal(quick.textContent, '▶ Diashow');
  assert.deepEqual(r.drainErrors(), []);
});

test('control: ohne Motive ist der Diashow-Shortcut gesperrt', (t) => {
  const store = new MatchStateStore();
  store.setSlideBlocks({ partner: true, highlights: true, historie: true, termine: true });
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.document.getElementById('slideshow-quick').disabled, true);
  assert.deepEqual(json(r.click('slideshow-quick')), [], 'ein Druck bleibt folgenlos');
  assert.deepEqual(r.drainErrors(), []);
});
