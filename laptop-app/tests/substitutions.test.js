/**
 * Ein- und Auswechslungen.
 *
 * Die Zusagen (Nutzer, 16.10.2026):
 * - Ein Wechsel wird per Knopf eingetragen, die Spieler danach gewählt.
 * - Auf die Tafel kommt er von selbst erst, wenn BEIDE Spieler feststehen.
 *   Ohne Namen lässt er sich von Hand mit der Mannschaft einblenden.
 * - Für beide Mannschaften.
 * - Danach führen Aufstellung und Torschützenauswahl den Eingewechselten.
 *
 * Der Kader selbst darf dabei NICHT verändert werden: Er gilt pro Verein
 * auch für das nächste Spiel.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player, MIN } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const { isInfoOverlay } = load('main/validate');
const { lineupNow, substitutionText } = load('shared/substitutions');
const { buildScorerRows } = load('shared/scorerRows');

const KADER = [
  player({ id: 'tw', number: 1, lastName: 'Kowalski', role: 'start' }),
  player({ id: 'st', number: 9, lastName: 'Demir', role: 'start' }),
  player({ id: 'bk', number: 14, lastName: 'Lange', role: 'bench' }),
  player({ id: 'b2', number: 16, lastName: 'Gerdes', role: 'bench' }),
  player({ id: 'xx', number: 30, lastName: 'Verletzt', role: 'out' }),
];

const sub = (overrides) => ({ id: 1, type: 'sub', team: 'home', minute: 60, ...overrides });
const ids = (players) => players.map((p) => p.id);

/** 2. Halbzeit bei 60:00, Uhr angehalten, Heimkader eingetragen. */
function spiel() {
  const store = new MatchStateStore();
  store.setSquad('home', KADER);
  store.kickoff();
  store.stopClock();
  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();
  store.setClock(60 * MIN);
  return store;
}

function letzterWechsel(store) {
  return store.getState().events.filter((e) => e.type === 'sub').at(-1);
}

// --------------------------------------------------------------------
// Wer spielt gerade?
// --------------------------------------------------------------------

test('ohne Wechsel spielt die Startelf, die Bank wartet', () => {
  const now = lineupNow('home', KADER, []);
  assert.deepEqual(ids(now.onPitch), ['tw', 'st']);
  assert.deepEqual(ids(now.bench), ['bk', 'b2']);
  assert.deepEqual(now.substitutedOut, []);
});

test('ein Wechsel tauscht Platz und Bank', () => {
  const now = lineupNow('home', KADER, [sub({ outId: 'st', inId: 'bk' })]);
  assert.deepEqual(ids(now.onPitch), ['tw', 'bk']);
  assert.deepEqual(ids(now.bench), ['b2']);
  assert.deepEqual(ids(now.substitutedOut), ['st']);
});

test('ein halber Wechsel zählt mit dem, was bekannt ist', () => {
  assert.deepEqual(ids(lineupNow('home', KADER, [sub({ inId: 'bk' })]).onPitch), ['tw', 'st', 'bk']);
  assert.deepEqual(ids(lineupNow('home', KADER, [sub({ outId: 'st' })]).onPitch), ['tw']);
});

test('Wechsel der anderen Mannschaft und ausgenommene Wechsel zählen nicht', () => {
  const events = [sub({ id: 1, outId: 'st', inId: 'bk' }), sub({ id: 2, team: 'away', outId: 'tw' })];
  assert.deepEqual(ids(lineupNow('home', KADER, events).onPitch), ['tw', 'bk']);
  assert.deepEqual(ids(lineupNow('home', KADER, events, 1).onPitch), ['tw', 'st'], 'Wechsel 1 ausgenommen');
});

test('der Kader selbst bleibt unverändert', () => {
  const kopie = JSON.parse(JSON.stringify(KADER));
  lineupNow('home', KADER, [sub({ outId: 'st', inId: 'bk' })]);
  assert.deepEqual(JSON.parse(JSON.stringify(KADER)), kopie);
});

test('der Text nennt, was bekannt ist', () => {
  assert.equal(substitutionText(sub({ outId: 'st', inId: 'bk' }), KADER, 'SV Hochlar'), 'Lange für Demir');
  assert.equal(substitutionText(sub({ inId: 'bk' }), KADER, 'SV Hochlar'), 'Lange kommt');
  assert.equal(substitutionText(sub({ outId: 'st' }), KADER, 'SV Hochlar'), 'Demir geht');
  assert.equal(substitutionText(sub({}), KADER, 'SV Hochlar'), 'Wechsel SV Hochlar');
});

// --------------------------------------------------------------------
// Store
// --------------------------------------------------------------------

test('ein neuer Wechsel steht in der Chronik, aber noch nicht auf der Tafel', () => {
  const store = spiel();
  store.addSubstitution('home');
  const wechsel = letzterWechsel(store);
  assert.equal(wechsel.team, 'home');
  assert.equal(wechsel.minute, 61);
  assert.equal(store.getState().infoRequest, null, 'ohne Namen nicht von selbst');
});

test('sind beide Spieler gewählt, erscheint der Wechsel von selbst', () => {
  const store = spiel();
  store.addSubstitution('home');
  const id = letzterWechsel(store).id;

  store.setSubstitutionPlayers(id, 'st', undefined);
  assert.equal(store.getState().infoRequest, null, 'mit nur einem Namen noch nicht');

  store.setSubstitutionPlayers(id, 'st', 'bk');
  assert.deepEqual(store.getState().infoRequest.overlay, { kind: 'sub', eventId: id });
  store.hideInfo();
});

test('eine Korrektur am fertigen Wechsel blendet ihn nicht erneut ein', () => {
  const store = spiel();
  store.addSubstitution('home');
  const id = letzterWechsel(store).id;
  store.setSubstitutionPlayers(id, 'st', 'bk');
  store.hideInfo();

  store.setSubstitutionPlayers(id, 'st', 'b2');
  assert.equal(store.getState().infoRequest, null);
  assert.equal(letzterWechsel(store).inId, 'b2');
});

test('auch in der Halbzeitpause, nicht aber vor dem Anpfiff', () => {
  const pause = new MatchStateStore();
  pause.kickoff();
  pause.stopClock();
  pause.goToHalfTime();
  pause.addSubstitution('away');
  pause.setSubstitutionPlayers(letzterWechsel(pause).id, 'a', 'b');
  assert.equal(pause.getState().infoRequest.overlay.kind, 'sub');
  pause.hideInfo();

  const vorher = new MatchStateStore();
  vorher.addSubstitution('home');
  vorher.setSubstitutionPlayers(letzterWechsel(vorher).id, 'a', 'b');
  assert.equal(vorher.getState().infoRequest, null);
});

test('ein Wechsel ändert weder Spielstand noch Torschützenliste', () => {
  const store = spiel();
  store.incrementScore('home', 1);
  store.stopClock();
  store.addSubstitution('home');
  store.setSubstitutionPlayers(letzterWechsel(store).id, 'st', 'bk');
  store.hideInfo();

  assert.equal(store.getState().home.score, 1);
  const rows = buildScorerRows('home', store.getState().events, KADER);
  assert.equal(rows.length, 1, 'der Wechsel darf keine Zeile ergeben');
});

test('ein Wechsel lässt sich löschen', () => {
  const store = spiel();
  store.addSubstitution('home');
  store.removeEvent(letzterWechsel(store).id);
  assert.equal(letzterWechsel(store), undefined);
});

test('die Prüfschicht kennt die Wechsel-Einblendung', () => {
  assert.equal(isInfoOverlay({ kind: 'sub', eventId: 3 }), true);
  assert.equal(isInfoOverlay({ kind: 'sub' }), false);
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

function mitWechsel() {
  const store = spiel();
  store.addSubstitution('home');
  store.setSubstitutionPlayers(letzterWechsel(store).id, 'st', 'bk');
  return store;
}

test('display: der Wechsel steht mit beiden Namen in der Leiste', (t) => {
  const store = mitWechsel();
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());

  assert.ok(r.document.body.classList.contains('showing-info'));
  assert.equal(r.text('info-label'), 'Lange für Demir');
  assert.equal(r.text('info-value'), "61'");
  const mark = r.document.getElementById('info-mark');
  assert.equal(mark.hidden, false);
  assert.ok(mark.classList.contains('is-sub'));
  assert.deepEqual(r.drainErrors(), []);
});

test('display: von Hand eingeblendet ohne Namen steht die Mannschaft da', (t) => {
  const store = spiel();
  store.addSubstitution('home');
  store.showInfo({ kind: 'sub', eventId: letzterWechsel(store).id });
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.text('info-label'), `Wechsel ${store.getState().home.name}`);
  assert.deepEqual(r.drainErrors(), []);
});

test('display: die Aufstellung führt den Eingewechselten', (t) => {
  const store = mitWechsel();
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());

  const startelf = r.document.getElementById('lineup-home-grid').textContent;
  const bank = r.document.getElementById('bench-home-grid').textContent;
  assert.ok(startelf.includes('Lange'), 'der Eingewechselte fehlt in der Aufstellung');
  assert.ok(!startelf.includes('Demir'), 'der Ausgewechselte steht noch in der Aufstellung');
  assert.ok(!bank.includes('Lange'), 'der Eingewechselte sitzt noch auf der Bank');
  assert.deepEqual(r.drainErrors(), []);
});

test('display: Retro zeigt den Wechsel unten statt der Uhr', async (t) => {
  const store = mitWechsel();
  store.setAppearance({
    theme: 'retro',
    effects: { verlauf: true, strahlen: true, leuchten: true, schatten: true },
    retroColor: 'bernstein',
  });
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());
  await Promise.resolve();
  await Promise.resolve();
  const szene = JSON.parse(r.document.getElementById('retro-matrix').dataset.scene);
  assert.deepEqual(szene.footer, { kind: 'info', title: 'WECHSEL', value: "61'", name: 'Lange für Demir' });
  assert.deepEqual(szene.scorers, [], 'ein Wechsel ist kein Eintrag der Torschützenliste');
  assert.deepEqual(r.drainErrors(), []);
});

// --------------------------------------------------------------------
// Steuerungsfenster
// --------------------------------------------------------------------

function steuerung(store, t) {
  const r = openRenderer('control', t);
  r.window.confirm = () => true;
  r.emit('onStateUpdated', store.getState());
  r.drainErrors();
  return r;
}

const argumente = (calls, name) =>
  JSON.parse(JSON.stringify(calls.filter((c) => c.name === name).map((c) => c.args)));

test('control: der Wechsel-Knopf trägt für die richtige Mannschaft ein', (t) => {
  const r = steuerung(spiel(), t);
  assert.deepEqual(argumente(r.click('home-sub-add'), 'subAdd'), [['home']]);
  assert.deepEqual(argumente(r.click('away-sub-add'), 'subAdd'), [['away']]);
  assert.deepEqual(argumente(r.click('home-sub-add'), 'incrementScore'), [], 'zählt kein Tor');
});

test('control: raus bietet die Spieler auf dem Platz, rein die Bank', (t) => {
  const store = spiel();
  store.addSubstitution('home');
  const r = steuerung(store, t);

  const werte = (sel) => [...r.document.querySelector(sel).options].map((o) => o.value).filter(Boolean);
  assert.deepEqual(werte('.goal-log li.is-sub select.sub-out'), ['tw', 'st']);
  assert.deepEqual(werte('.goal-log li.is-sub select.sub-in'), ['bk', 'b2']);
});

test('control: die Auswahl schickt beide Spieler, Einblenden die Anfrage', (t) => {
  const store = spiel();
  store.addSubstitution('home');
  const id = letzterWechsel(store).id;
  const r = steuerung(store, t);

  const raus = r.document.querySelector('.goal-log li.is-sub select.sub-out');
  const rein = r.document.querySelector('.goal-log li.is-sub select.sub-in');
  raus.value = 'st';
  raus.dispatchEvent(new r.window.Event('change'));
  rein.value = 'bk';
  r.calls.length = 0;
  rein.dispatchEvent(new r.window.Event('change'));
  assert.deepEqual(argumente(r.calls, 'subSetPlayers'), [[id, 'st', 'bk']]);

  const zeigen = [...r.document.querySelectorAll('.goal-log li.is-sub .btn')].find(
    (b) => b.textContent === 'Einblenden'
  );
  r.calls.length = 0;
  zeigen.click();
  assert.deepEqual(argumente(r.calls, 'showInfo'), [[{ kind: 'sub', eventId: id }]]);
  assert.deepEqual(r.drainErrors(), []);
});

test('control: die Torschützenauswahl nennt den Eingewechselten unter "Auf dem Platz"', (t) => {
  const store = mitWechsel();
  store.hideInfo();
  store.incrementScore('home', 1);
  store.stopClock();
  const r = steuerung(store, t);

  const auswahl = r.document.querySelector('.goal-log li.is-goal select');
  const gruppe = [...auswahl.querySelectorAll('optgroup')].find((g) => g.label === 'Auf dem Platz');
  assert.ok(gruppe, 'Gruppe "Auf dem Platz" fehlt');
  const drin = [...gruppe.querySelectorAll('option')].map((o) => o.value);
  assert.deepEqual(drin, ['tw', 'bk']);
  assert.ok(
    [...auswahl.options].some((o) => o.value === 'st'),
    'der Ausgewechselte muss wählbar bleiben -- das Tor kann vorher gefallen sein'
  );
  assert.deepEqual(r.drainErrors(), []);
});
