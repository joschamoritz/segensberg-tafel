/**
 * Diashow-Haken und weiße Sponsorenlogos (Nutzerwünsche 20.10.2026).
 *
 * - Blöcke lassen sich abhaken; die Auswahl gilt für alle Phasen,
 *   steht in `content.json` und überdauert „Neues Spiel".
 * - `Ott.png` und `Ott_weiß.png` sind EIN Sponsor; die weiße Fassung
 *   wird bevorzugt und steht ohne weiße Kachel auf dem Grund.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const v = load('main/validate');
const { buildSlidePlan, sponsorLogoFiles, preferredSponsorFile, isWhiteLogoFile, allSlideBlocks } =
  load('shared/types');

function medien(dateien = {}) {
  const ids = ['werbung', 'hauptsponsor', 'partner', 'highlights', 'historie', 'sounds', 'wettbewerbe'];
  return Object.fromEntries(ids.map((id) => [id, { rootPath: id, files: dateien[id] ?? [] }]));
}

// --------------------------------------------------------------------
// Haken
// --------------------------------------------------------------------

test('sanitizeSlideBlocks: nur ein ausdrückliches false hakt ab', () => {
  assert.deepEqual(v.sanitizeSlideBlocks(undefined), allSlideBlocks(), 'ältere content.json');
  assert.deepEqual(v.sanitizeSlideBlocks({ termine: false, partner: 0, highlights: 'nein' }), {
    ...allSlideBlocks(),
    termine: false,
  });
});

test('„Neues Spiel" lässt die Haken stehen', () => {
  const store = new MatchStateStore();
  store.setSlideBlocks({ partner: true, highlights: false, historie: true, termine: false });
  store.resetMatch();
  assert.deepEqual(store.getState().slideBlocks, { partner: true, highlights: false, historie: true, termine: false });
});

test('abgehakte Partner nehmen auch die großen mit, der Halbzeit-Sponsor bleibt', () => {
  const plan = buildSlidePlan(
    'half-time',
    medien({ hauptsponsor: ['haupt.png'], werbung: ['a.png'], historie: ['1998_Foto.jpg'] }),
    [],
    { lineup: null, halfTime: { folder: 'werbung', file: 'a.png' }, goal: null, corners: null, matchday: null },
    { ...allSlideBlocks(), partner: false }
  );
  assert.deepEqual(plan.map((s) => s.title ?? s.kind), ['HALBZEIT PRÄSENTIERT VON', 'history']);
});

test('control: die Haken spiegeln den Zustand und gehen gemeinsam raus', (t) => {
  const store = new MatchStateStore();
  store.setSlideBlocks({ ...allSlideBlocks(), highlights: false });
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());

  assert.equal(r.document.getElementById('slide-block-highlights').checked, false);
  assert.equal(r.document.getElementById('slide-block-historie').checked, true);

  const calls = r.click('slide-block-termine');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { name: 'setSlideBlocks', args: [{ partner: true, highlights: false, historie: true, termine: false }] },
  ]);
  assert.deepEqual(r.drainErrors(), []);
});

// --------------------------------------------------------------------
// Weiße Logos
// --------------------------------------------------------------------

test('weiße Fassung: erkannt am Dateinamen, ein Eintrag je Sponsor', () => {
  assert.equal(isWhiteLogoFile('Ott_weiß.png'), true);
  assert.equal(isWhiteLogoFile('Ott Weiss.PNG'), true);
  assert.equal(isWhiteLogoFile('Ott-white.svg'), true);
  assert.equal(isWhiteLogoFile('Weißbier Brauerei.png'), false, 'nur am Ende');
  assert.deepEqual(sponsorLogoFiles(['Bank.png', 'Ott.png', 'Ott_weiß.png', 'Zoo_weiß.png']), [
    'Bank.png',
    'Ott_weiß.png',
    'Zoo_weiß.png',
  ]);
});

test('gewählt ist der Sponsor, nicht die Fassung', () => {
  const files = ['Ott.png', 'Ott_weiß.png'];
  assert.equal(preferredSponsorFile(files, 'Ott.png'), 'Ott_weiß.png', 'die weiße kommt dazu');
  assert.equal(preferredSponsorFile(['Ott_weiß.png'], 'Ott.png'), 'Ott_weiß.png', 'die farbige ist weg');
  assert.equal(preferredSponsorFile(['Ott.png'], 'Ott_weiß.png'), 'Ott.png', 'die weiße ist weg');
  assert.equal(preferredSponsorFile(['Bank.png'], 'Ott.png'), null);
});

test('display: weiße Logos stehen ohne Kachel, farbige in der Kachel', (t) => {
  const store = new MatchStateStore();
  store.setMedia(medien({ werbung: ['Bank.png', 'Ott.png', 'Ott_weiß.png'] }));
  store.setSponsorSlot('matchday', { folder: 'werbung', file: 'Ott.png' });
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());

  const chip = r.document.querySelector('#pre-sponsor .sponsor-chip');
  assert.equal(r.document.getElementById('pre-sponsor-logo').getAttribute('src'), 'svh-media://werbung/Ott_wei%C3%9F.png');
  assert.ok(chip.classList.contains('is-white'));

  store.startSlideshow();
  r.emit('onStateUpdated', store.getState());
  const kacheln = [0, 1, 2].map((i) => r.document.getElementById(`sponsor-logo-${i}`));
  assert.deepEqual(
    kacheln.map((img) => [img.hidden ? null : img.getAttribute('src'), img.parentElement.classList.contains('is-white')]),
    [
      ['svh-media://werbung/Bank.png', false],
      ['svh-media://werbung/Ott_wei%C3%9F.png', true],
      [null, false],
    ],
    'zwei Sponsoren, nicht drei -- und die leere Kachel bleibt weiß'
  );
  assert.deepEqual(r.drainErrors(), []);
});

test('control: die Auswahl zeigt jeden Sponsor einmal, ohne Weiß-Kennung', (t) => {
  const store = new MatchStateStore();
  store.setMedia(medien({ werbung: ['Ott.png', 'Ott_weiß.png'] }));
  store.setSponsorSlot('goal', { folder: 'werbung', file: 'Ott.png' });
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());

  const select = r.document.getElementById('sponsor-slot-goal');
  const optionen = [...select.querySelectorAll('optgroup option')].map((o) => [o.value, o.textContent]);
  assert.deepEqual(optionen, [['werbung/Ott_weiß.png', 'Ott']]);
  assert.equal(select.value, 'werbung/Ott_weiß.png', 'die gespeicherte farbige Wahl zeigt auf denselben Sponsor');
  assert.deepEqual(r.drainErrors(), []);
});
