/**
 * Torjubel und Torschützen-Einblendung überlagern sich nicht mehr.
 *
 * Befund des Nutzers zu 1.8.0: Wer nach dem Tor schnell den Schützen
 * wählte und einblendete -- oder wer während einer Einblendung ein
 * neues Tor eintrug --, bekam beide Flächen übereinander („TOR!" quer
 * durch den Namen). Ursache war die Reihenfolge im Stylesheet: Die
 * Einschalt-Regeln standen hinter der Regel, mit der der Jubel sie
 * ausblenden sollte.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const { goalCelebrationMs, SCORER_DISPLAY_MS } = load('shared/types');

const CSS = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'display', 'display.css'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('Stylesheet: Torschütze, Danksagung und Diashow weichen dem Torjubel', () => {
  for (const [state, board] of [
    ['showing-scorer', 'board-scorer'],
    ['showing-thanks', 'board-thanks'],
    ['showing-slide', 'board-slides'],
  ]) {
    const shows = [...CSS.matchAll(new RegExp(`body\\.${state}([^{,]*)\\.${board}\\s*\\{[^}]*display:\\s*flex`, 'g'))];
    assert.ok(shows.length > 0, `Einschalt-Regel für .${board} gefunden`);
    for (const match of shows) {
      assert.match(match[1], /:not\(\.celebrating\)/, `.${board} wird nur ohne Jubel eingeschaltet`);
    }
  }
});

/** Uhr steht, Phase läuft, mit einem Heimspieler zum Zuordnen. */
function liveStore(now = () => 0) {
  const store = new MatchStateStore(undefined, now);
  store.setSquad('home', [player({ id: 'h1', number: 24, firstName: 'David', lastName: 'Meyer' })]);
  store.kickoff();
  store.stopClock();
  return store;
}

/** Zeitschalter des Anzeigefensters zum Vorspulen -- wie in celebration.test.js. */
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
        const naechster = [...geplant].filter(([, e]) => e.faellig <= jetzt).sort((a, b) => a[1].faellig - b[1].faellig)[0];
        if (!naechster) return;
        geplant.delete(naechster[0]);
        naechster[1].rueckruf();
      }
    },
  };
}

function letztesTor(store) {
  return store.getState().events.filter((e) => e.type === 'goal').at(-1);
}

test('Anzeige: Torschütze während des Jubels erscheint erst danach, mit voller Standzeit', (t) => {
  const store = liveStore();
  const r = openRenderer('display', t);
  const uhr = zeitRaffen(r);
  const body = r.document.body;

  r.emit('onStateUpdated', store.getState());
  store.incrementScore('home', 1);
  r.emit('onStateUpdated', store.getState());
  assert.ok(body.classList.contains('celebrating'));

  store.setGoalScorer(letztesTor(store).id, 'h1');
  store.showScorer(letztesTor(store).id);
  r.emit('onStateUpdated', store.getState());
  assert.ok(!body.classList.contains('showing-scorer'), 'nicht über dem Jubel');

  uhr.vorspulen(goalCelebrationMs('home'));
  assert.ok(!body.classList.contains('celebrating'));
  assert.ok(body.classList.contains('showing-scorer'), 'direkt nach dem Jubel');
  assert.equal(r.text('spotlight-name'), '24 David Meyer');

  uhr.vorspulen(SCORER_DISPLAY_MS - 100);
  assert.ok(body.classList.contains('showing-scorer'), 'Standzeit zählt ab dem Erscheinen');
  uhr.vorspulen(200);
  assert.ok(!body.classList.contains('showing-scorer'));
  store.hideScorer();
  assert.deepEqual(r.drainErrors(), []);
});

test('Anzeige: ohne Jubel erscheint der Torschütze sofort', (t) => {
  const store = liveStore();
  store.incrementScore('home', 1);
  store.setGoalScorer(letztesTor(store).id, 'h1');
  const r = openRenderer('display', t);
  zeitRaffen(r);
  // Das Tor ist beim ersten Zustand schon da -- ein neu geöffnetes Fenster
  // holt keinen Jubel nach.
  r.emit('onStateUpdated', store.getState());
  store.showScorer(letztesTor(store).id);
  r.emit('onStateUpdated', store.getState());
  assert.ok(r.document.body.classList.contains('showing-scorer'));
  store.hideScorer();
});

test('Store: ein neues Tor beendet die Einblendung des vorigen Torschützen', () => {
  const store = liveStore();
  store.incrementScore('home', 1);
  store.showScorer(letztesTor(store).id);
  assert.notEqual(store.getState().scorerRequest, null);

  store.incrementScore('away', 1);
  assert.equal(store.getState().scorerRequest, null);
});

test('Store: das Abräumen wartet das Ende des Jubels ab', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let jetzt = 0;
  const store = liveStore(() => jetzt);
  store.incrementScore('home', 1);
  jetzt += 1000; // eine Sekunde nach dem Tor eingeblendet
  store.showScorer(letztesTor(store).id);

  const rest = goalCelebrationMs('home') - 1000;
  t.mock.timers.tick(SCORER_DISPLAY_MS);
  assert.notEqual(store.getState().scorerRequest, null, 'nach 8 s steht er noch -- er kam ja erst nach dem Jubel');
  t.mock.timers.tick(rest);
  assert.equal(store.getState().scorerRequest, null);
});
