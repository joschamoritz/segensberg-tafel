/**
 * Einzel-Aufstellung (Nutzerwunsch 20.10.2026): jeder Spieler der
 * Startelf einzeln mit Portrait, 4 Sekunden, danach der Trainer, danach
 * die Bank als eine Seite. Ohne Portrait das Trikot mit Rückennummer --
 * das Vereinstrikot nur bei der Heimmannschaft.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const { lineupSteps, lineupDurationMs, startingOrder, LINEUP_PLAYER_MS } = load('shared/lineupSteps');
const { LINEUP_PAGE_MS } = load('shared/types');
const { sanitizeLineupStyle } = load('main/validate');

const json = (value) => JSON.parse(JSON.stringify(value));

/** Drei Startspieler (Torwart mit hoher Nummer), ein Bankspieler, Trainer. */
function kaderStore() {
  const store = new MatchStateStore();
  store.setTeamName('home', 'SV Hochlar 28');
  store.setSquad('home', [
    player({ id: 's9', number: 9, firstName: 'Lukas', lastName: 'Brinkmann' }),
    player({ id: 'tw', number: 22, firstName: 'Jan', lastName: 'Kowalski', isGoalkeeper: true }),
    player({ id: 's4', number: 4, firstName: 'David', lastName: 'Meyer', isCaptain: true, photoDataUrl: 'data:image/png;base64,AAAA' }),
    player({ id: 'b1', number: 14, firstName: 'Tim', lastName: 'Lange', role: 'bench' }),
  ]);
  store.setCoach('home', 'Peter Hermann');
  return store;
}

test('Ablauf: Torwart zuerst, dann nach Nummer, Trainer, Bank als eine Seite', () => {
  const state = kaderStore().getState();
  const steps = lineupSteps(state, 'home', 'single');
  assert.deepEqual(
    json(steps.map((s) => (s.kind === 'player' ? s.playerId : s.kind === 'page' ? `seite:${s.page}` : s.kind))),
    ['tw', 's4', 's9', 'coach', 'seite:bench']
  );
  assert.equal(lineupDurationMs(steps), 4 * LINEUP_PLAYER_MS + LINEUP_PAGE_MS);
  assert.equal(LINEUP_PLAYER_MS, 4000, 'Nutzerwahl');
});

test('Ablauf: Übersicht wie bisher, leerer Kader ergibt nichts', () => {
  const state = kaderStore().getState();
  assert.deepEqual(json(lineupSteps(state, 'home', 'overview').map((s) => s.page)), ['start', 'bench']);
  assert.deepEqual(json(lineupSteps(state, 'away', 'single')), []);
  assert.deepEqual(json(startingOrder([player({ id: 'a', number: null }), player({ id: 'b', number: 3 })]).map((p) => p.id)), ['b', 'a']);
});

test('Ablauf: ein eingewechselter Spieler steht in der Einzelfolge', () => {
  const store = kaderStore();
  store.kickoff();
  store.stopClock();
  store.addSubstitution('home');
  const sub = store.getState().events.at(-1);
  store.setSubstitutionPlayers(sub.id, 's9', 'b1');
  const ids = lineupSteps(store.getState(), 'home', 'single').filter((s) => s.kind === 'player').map((s) => s.playerId);
  assert.deepEqual(json(ids), ['tw', 's4', 'b1']);
});

test('Store: die Anfrage nimmt den Ablauf mit und wird nach dessen Dauer abgeräumt', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = kaderStore();
  store.setLineupStyle('single');
  store.showLineup('home');
  assert.equal(store.getState().lineupRequest.style, 'single');

  store.setLineupStyle('overview');
  assert.equal(store.getState().lineupRequest.style, 'single', 'Umschalten ändert die laufende Einblendung nicht');

  t.mock.timers.tick(4 * LINEUP_PLAYER_MS + LINEUP_PAGE_MS - 1);
  assert.notEqual(store.getState().lineupRequest, null);
  t.mock.timers.tick(1);
  assert.equal(store.getState().lineupRequest, null);
});

test('Store: „Neues Spiel" behält den gewählten Ablauf', () => {
  const store = kaderStore();
  store.setLineupStyle('single');
  store.resetMatch();
  assert.equal(store.getState().lineupStyle, 'single');
});

test('Prüfschicht: unbekannter Ablauf wird zur Übersicht', () => {
  assert.equal(sanitizeLineupStyle('single'), 'single');
  assert.equal(sanitizeLineupStyle('einzeln'), 'overview');
  assert.equal(sanitizeLineupStyle(undefined), 'overview');
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

function zeitRaffen(r) {
  const geplant = new Map();
  let id = 1;
  let jetzt = 0;
  r.window.setTimeout = (rueckruf, ms) => {
    geplant.set(id, { rueckruf, faellig: jetzt + ms });
    return id++;
  };
  r.window.clearTimeout = (key) => geplant.delete(key);
  return {
    vorspulen(ms) {
      jetzt += ms;
      for (;;) {
        const n = [...geplant].filter(([, e]) => e.faellig <= jetzt).sort((a, b) => a[1].faellig - b[1].faellig)[0];
        if (!n) return;
        geplant.delete(n[0]);
        n[1].rueckruf();
      }
    },
  };
}

const aktiveSeite = (r) => r.document.querySelector('.pre-page.is-active')?.dataset.page;

test('display: Spieler für Spieler, dann Trainer, Bank und zurück zur Begegnung', (t) => {
  const store = kaderStore();
  store.setLineupStyle('single');
  const r = openRenderer('display', t);
  const uhr = zeitRaffen(r);
  r.emit('onStateUpdated', store.getState());
  store.showLineup('home');
  r.emit('onStateUpdated', store.getState());

  // Torwart ohne Portrait: Trikot mit Nummer, Name ohne Nummer.
  assert.equal(aktiveSeite(r), 'player-card');
  assert.equal(r.text('card-label'), 'TORWART');
  assert.equal(r.text('card-name'), 'Jan Kowalski');
  assert.equal(r.document.getElementById('card-jersey').hidden, false);
  assert.equal(r.text('card-jersey-number'), '22');
  assert.equal(r.document.getElementById('card-photo').hidden, true);
  assert.equal(r.text('card-team-name'), 'SV Hochlar 28');

  // Mit Portrait: Bild, Nummer vor dem Namen, Kapitän im Titel.
  uhr.vorspulen(LINEUP_PLAYER_MS);
  assert.equal(r.text('card-label'), 'STARTELF · KAPITÄN');
  assert.equal(r.text('card-name'), '4 David Meyer');
  assert.equal(r.document.getElementById('card-photo').hidden, false);
  assert.equal(r.document.getElementById('card-jersey').hidden, true);

  uhr.vorspulen(LINEUP_PLAYER_MS);
  assert.equal(r.text('card-name'), 'Lukas Brinkmann');

  uhr.vorspulen(LINEUP_PLAYER_MS);
  assert.equal(r.text('card-label'), 'TRAINER');
  assert.equal(r.text('card-name'), 'Peter Hermann');

  uhr.vorspulen(LINEUP_PLAYER_MS);
  assert.equal(aktiveSeite(r), 'bench-home');

  uhr.vorspulen(LINEUP_PAGE_MS);
  assert.equal(aktiveSeite(r), 'matchup');
  assert.deepEqual(r.drainErrors(), []);
});

/** Tut so, als sei trikot-heim.png geladen -- jsdom lädt keine Bilder. */
function trikotGeladen(r) {
  const kit = r.document.getElementById('card-jersey-home');
  Object.defineProperty(kit, 'complete', { value: true });
  Object.defineProperty(kit, 'naturalWidth', { value: 300 });
}

test('display: Vereinstrikot nur für die eigene Mannschaft', (t) => {
  const store = kaderStore();
  store.setSquad('away', [player({ id: 'g1', number: 7, firstName: 'Ole', lastName: 'Gast' })]);
  store.setLineupStyle('single');
  const r = openRenderer('display', t);
  zeitRaffen(r);
  trikotGeladen(r);
  r.emit('onStateUpdated', store.getState());

  store.showLineup('home');
  r.emit('onStateUpdated', store.getState());
  assert.ok(r.document.getElementById('card-jersey').classList.contains('is-home-kit'));

  store.showLineup('away');
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.text('card-name'), 'Ole Gast');
  assert.ok(!r.document.getElementById('card-jersey').classList.contains('is-home-kit'), 'Gäste im neutralen Trikot');
});

test('display: ohne geladenes Vereinstrikot das neutrale', (t) => {
  const store = kaderStore();
  store.setLineupStyle('single');
  const r = openRenderer('display', t);
  zeitRaffen(r);
  r.emit('onStateUpdated', store.getState());
  store.showLineup('home');
  r.emit('onStateUpdated', store.getState());
  assert.ok(!r.document.getElementById('card-jersey').classList.contains('is-home-kit'));
});

test('display: Übersicht läuft unverändert', (t) => {
  const store = kaderStore();
  const r = openRenderer('display', t);
  const uhr = zeitRaffen(r);
  r.emit('onStateUpdated', store.getState());
  store.showLineup('home');
  r.emit('onStateUpdated', store.getState());
  assert.equal(aktiveSeite(r), 'lineup-home');
  uhr.vorspulen(LINEUP_PAGE_MS);
  assert.equal(aktiveSeite(r), 'bench-home');
  uhr.vorspulen(LINEUP_PAGE_MS);
  assert.equal(aktiveSeite(r), 'matchup');
});

test('display: Retro zeigt Rolle, Name und Verein als Punktschrift', async (t) => {
  const store = kaderStore();
  store.setAppearance({ theme: 'retro', effects: { verlauf: true, strahlen: true, leuchten: true, schatten: true }, retroColor: 'bernstein' });
  store.setLineupStyle('single');
  const r = openRenderer('display', t);
  zeitRaffen(r);
  r.emit('onStateUpdated', store.getState());
  store.showLineup('home');
  r.emit('onStateUpdated', store.getState());
  await Promise.resolve();
  await Promise.resolve();
  const scene = JSON.parse(r.document.getElementById('retro-matrix').dataset.scene);
  assert.deepEqual(scene, { kind: 'scorer', title: 'TORWART', name: '22 Jan Kowalski', detail: 'SV Hochlar 28' });
});

// --------------------------------------------------------------------
// Steuerungsfenster
// --------------------------------------------------------------------

test('control: Auswahl des Ablaufs geht an die Brücke und folgt dem Zustand', (t) => {
  const store = kaderStore();
  store.setLineupStyle('single');
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());
  const select = r.document.getElementById('lineup-style');
  assert.equal(select.value, 'single');

  r.calls.length = 0;
  select.value = 'overview';
  select.dispatchEvent(new r.window.Event('change'));
  assert.deepEqual(json(r.calls.filter((c) => c.name === 'setLineupStyle').map((c) => c.args)), [['overview']]);
  assert.deepEqual(r.drainErrors(), []);
});

test('display: es gilt der Ablauf der Anfrage, nicht der inzwischen gewählte', (t) => {
  const store = kaderStore();
  store.setLineupStyle('single');
  const r = openRenderer('display', t);
  zeitRaffen(r);
  r.emit('onStateUpdated', store.getState());
  store.showLineup('home');
  // Umgeschaltet, bevor die Anzeige die Anfrage gesehen hat -- der Store
  // räumt nach der Dauer der Einzelfolge ab, also muss sie auch laufen.
  store.setLineupStyle('overview');
  r.emit('onStateUpdated', store.getState());
  assert.equal(aktiveSeite(r), 'player-card');
});
