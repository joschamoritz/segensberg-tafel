/**
 * Block L, Etappe 2: „Präsentiert von"-Plätze.
 *
 * Zusagen, die ohne Test beim nächsten Umbau still brechen könnten:
 * - Die Prüfschicht lässt keinen Pfad und keinen fremden Ordner durch --
 *   der Name landet in einer `svh-media:`-URL und in `teams.json`.
 * - „Neues Spiel" leert NUR den Spieltagssponsor (Nutzerentscheidung).
 * - Der Halbzeit-Sponsor ist die erste Folie in der Pause, nicht nach dem
 *   Abpfiff (Nutzerentscheidung: eigene Folie).
 * - Der Ecken-Sponsor steht nur in der Ecken-Leiste, nicht bei Karte oder
 *   Wechsel.
 * - Fehlt die Datei, bleibt der Platz leer statt ein kaputtes Bild zu
 *   zeigen.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const v = load('main/validate');
const { buildSlidePlan, HALFTIME_SPONSOR_TITLE, emptySponsorSlots } = load('shared/types');

function medien(dateien = {}) {
  const ids = ['werbung', 'hauptsponsor', 'partner', 'highlights', 'historie', 'sounds', 'wettbewerbe'];
  return Object.fromEntries(ids.map((id) => [id, { rootPath: id, files: dateien[id] ?? [] }]));
}

const LOGOS = medien({ hauptsponsor: ['haupt.png'], partner: ['bank.png'], werbung: ['baecker.png'] });
const haupt = { folder: 'hauptsponsor', file: 'haupt.png' };
const bank = { folder: 'partner', file: 'bank.png' };

// --------------------------------------------------------------------
// Prüfschicht
// --------------------------------------------------------------------

test('sanitizeSponsorRef: nur Sponsorenordner und reine Dateinamen', () => {
  assert.deepEqual(v.sanitizeSponsorRef(bank), bank);
  assert.equal(v.sanitizeSponsorRef({ folder: 'sounds', file: 'tor.mp3' }), null, 'kein fremder Ordner');
  assert.equal(v.sanitizeSponsorRef({ folder: 'partner', file: '../teams.json' }), null, 'kein Pfad');
  assert.equal(v.sanitizeSponsorRef({ folder: 'partner', file: '' }), null);
  assert.equal(v.sanitizeSponsorRef('partner/bank.png'), null);
  assert.equal(v.sanitizeSponsorRef(null), null);
});

test('sanitizeSponsorSlots: fehlende und kaputte Einträge werden leer', () => {
  assert.deepEqual(v.sanitizeSponsorSlots(undefined), emptySponsorSlots());
  assert.deepEqual(v.sanitizeSponsorSlots({ goal: bank, corners: { folder: 'x', file: 'y.png' }, fremd: bank }), {
    ...emptySponsorSlots(),
    goal: bank,
  });
});

test('sanitizeSponsorSlotId: nur bekannte Plätze', () => {
  assert.equal(v.sanitizeSponsorSlotId('goal'), 'goal');
  assert.equal(v.sanitizeSponsorSlotId('__proto__'), null);
  assert.equal(v.sanitizeSponsorSlotId(3), null);
});

// --------------------------------------------------------------------
// Store
// --------------------------------------------------------------------

test('„Neues Spiel" leert nur den Spieltagssponsor', () => {
  const store = new MatchStateStore();
  for (const slot of ['lineup', 'halfTime', 'goal', 'corners', 'matchday']) store.setSponsorSlot(slot, bank);
  store.resetMatch();
  assert.deepEqual(store.getState().sponsorSlots, {
    lineup: bank,
    halfTime: bank,
    goal: bank,
    corners: bank,
    matchday: null,
  });
});

test('die Plätze wandern nach teams.json und zurück', () => {
  const { teamsConfigFromState } = load('main/persistence');
  const store = new MatchStateStore();
  store.setSponsorSlot('corners', haupt);
  const config = teamsConfigFromState(store.getState(), '');
  assert.deepEqual(v.sanitizeSponsorSlots(config.sponsorSlots).corners, haupt);
});

// --------------------------------------------------------------------
// Halbzeit-Folie
// --------------------------------------------------------------------

test('der Halbzeit-Sponsor ist die erste Folie der Pause, nicht nach dem Abpfiff', () => {
  const slots = { ...emptySponsorSlots(), halfTime: bank };
  const pause = buildSlidePlan('half-time', LOGOS, [], slots);
  assert.equal(pause[0].title, HALFTIME_SPONSOR_TITLE);
  assert.deepEqual(pause[0].logos, [{ url: 'svh-media://partner/bank.png', white: false }]);
  assert.equal(pause[0].main, true, 'groß wie ein Hauptsponsor');

  const ende = buildSlidePlan('full-time', LOGOS, [], slots);
  assert.ok(ende.every((s) => s.title !== HALFTIME_SPONSOR_TITLE));
});

test('eine fehlende Datei ergibt keine Halbzeit-Folie', () => {
  const slots = { ...emptySponsorSlots(), halfTime: { folder: 'partner', file: 'weg.png' } };
  const pause = buildSlidePlan('half-time', LOGOS, [], slots);
  assert.ok(pause.every((s) => s.title !== HALFTIME_SPONSOR_TITLE));
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

function mitPlaetzen(slots) {
  const store = new MatchStateStore();
  store.setMedia(LOGOS);
  for (const [slot, ref] of Object.entries(slots)) store.setSponsorSlot(slot, ref);
  return store;
}

test('display: Spieltags-, Aufstellungs- und Tor-Sponsor stehen an ihren Plätzen', (t) => {
  const store = mitPlaetzen({ matchday: haupt, lineup: bank, goal: bank });
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());

  assert.equal(r.document.getElementById('pre-sponsor').hidden, false);
  assert.equal(r.document.getElementById('pre-sponsor-logo').getAttribute('src'), 'svh-media://hauptsponsor/haupt.png');
  assert.equal(r.document.getElementById('goal-sponsor-logo').getAttribute('src'), 'svh-media://partner/bank.png');
  const lineup = [...r.document.querySelectorAll('.lineup-sponsor')];
  assert.equal(lineup.length, 5, 'alle vier Aufstellungsseiten und die Einzel-Aufstellung');
  for (const chip of lineup) {
    assert.equal(chip.hidden, false);
    assert.equal(chip.querySelector('img').getAttribute('src'), 'svh-media://partner/bank.png');
  }
  assert.deepEqual(r.drainErrors(), []);
});

test('display: ohne Wahl oder ohne Datei bleiben die Plätze leer', (t) => {
  const store = mitPlaetzen({ goal: { folder: 'partner', file: 'weg.png' } });
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());

  assert.equal(r.document.getElementById('pre-sponsor').hidden, true);
  assert.equal(r.document.getElementById('goal-sponsor').hidden, true, 'kein zerbrochenes Bild');
  assert.equal(r.document.getElementById('goal-sponsor-logo').hasAttribute('src'), false);
  assert.ok([...r.document.querySelectorAll('.lineup-sponsor')].every((c) => c.hidden));
  assert.deepEqual(r.drainErrors(), []);
});

test('display: der Ecken-Sponsor steht nur in der Ecken-Leiste', (t) => {
  const store = mitPlaetzen({ corners: bank });
  store.kickoff();
  store.stopClock();
  const r = openRenderer('display', t);

  store.showInfo({ kind: 'corners' });
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.document.getElementById('info-sponsor').hidden, false);
  assert.equal(r.document.getElementById('info-sponsor-logo').getAttribute('src'), 'svh-media://partner/bank.png');

  store.addCard('home', 'yellow');
  const karte = store.getState().events.at(-1);
  store.showInfo({ kind: 'card', eventId: karte.id });
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.document.getElementById('info-sponsor').hidden, true, 'eine Karte präsentiert niemand');
  assert.deepEqual(r.drainErrors(), []);
});

// --------------------------------------------------------------------
// Steuerungsfenster
// --------------------------------------------------------------------

test('control: die Auswahl listet Hauptsponsor und Partner und schickt die Wahl', (t) => {
  const store = mitPlaetzen({ corners: haupt });
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());

  const select = r.document.getElementById('sponsor-slot-goal');
  const gruppen = [...select.querySelectorAll('optgroup')].map((g) => [
    g.label,
    [...g.querySelectorAll('option')].map((o) => o.value),
  ]);
  assert.deepEqual(gruppen, [
    ['Hauptsponsor', ['hauptsponsor/haupt.png']],
    ['Partner', ['partner/bank.png', 'werbung/baecker.png']],
  ]);
  assert.equal(r.document.getElementById('sponsor-slot-corners').value, 'hauptsponsor/haupt.png');

  r.calls.length = 0;
  select.value = 'werbung/baecker.png';
  select.dispatchEvent(new r.window.Event('change'));
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [
    { name: 'setSponsorSlot', args: ['goal', { folder: 'werbung', file: 'baecker.png' }] },
  ]);

  r.calls.length = 0;
  select.value = '';
  select.dispatchEvent(new r.window.Event('change'));
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [{ name: 'setSponsorSlot', args: ['goal', null] }]);
  assert.deepEqual(r.drainErrors(), []);
});

test('control: eine fehlende Datei bleibt sichtbar gewählt', (t) => {
  const store = mitPlaetzen({ lineup: { folder: 'partner', file: 'weg.png' } });
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());
  const select = r.document.getElementById('sponsor-slot-lineup');
  assert.equal(select.value, 'partner/weg.png');
  assert.match(select.selectedOptions[0].textContent, /Datei fehlt/);
  assert.deepEqual(r.drainErrors(), []);
});
