/**
 * Elfmeterschießen nach dem Abpfiff (Review 2026-10, W11).
 *
 * Für Pokalspiele, die unentschieden enden. Die Schüsse sind keine
 * Ereignisse der Chronik und zählen nicht zum Spielstand -- im
 * Spielbericht steht „2:2, 4:3 i. E.“.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const live = load('main/liveMatch');
const { shootoutScore } = load('shared/types');

/** Spiel 1:1 abgepfiffen, Uhr steht. */
function abgepfiffen() {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.incrementScore('home', 1);
  store.incrementScore('away', 1);
  store.goToFullTime();
  return store;
}

function mitSchüssen(store) {
  store.startShootout();
  for (const [team, kick] of [
    ['home', 'goal'],
    ['away', 'goal'],
    ['home', 'miss'],
    ['away', 'goal'],
    ['home', 'goal'],
  ]) {
    store.addShootoutKick(team, kick);
  }
  return store;
}

test('Elfmeterschießen gibt es nur nach dem Abpfiff', () => {
  const store = new MatchStateStore();
  store.startShootout();
  assert.equal(store.getState().shootout, null, 'vor dem Anpfiff');
  store.kickoff();
  store.stopClock();
  store.startShootout();
  assert.equal(store.getState().shootout, null, 'im Spiel');
  store.goToFullTime();
  store.startShootout();
  assert.deepEqual(store.getState().shootout, { home: [], away: [], finished: false });
});

test('Schüsse zählen nicht zum Spielstand und nicht in die Chronik', () => {
  const store = mitSchüssen(abgepfiffen());
  const s = store.getState();
  assert.deepEqual(shootoutScore(s.shootout), { home: 2, away: 2 });
  assert.equal(s.home.score, 1);
  assert.equal(s.events.length, 2);
});

test('Rücknahme je Mannschaft, Beenden friert ein, Verwerfen löscht', () => {
  const store = mitSchüssen(abgepfiffen());
  store.undoShootoutKick('home');
  assert.deepEqual(store.getState().shootout.home, ['goal', 'miss']);

  store.finishShootout();
  store.addShootoutKick('home', 'goal');
  store.undoShootoutKick('away');
  assert.deepEqual(store.getState().shootout.home, ['goal', 'miss'], 'nach dem Beenden keine Änderung');
  assert.equal(store.getState().shootout.away.length, 2);

  store.cancelShootout();
  assert.equal(store.getState().shootout, null);
});

test('Abpfiff zurücknehmen und „Neues Spiel“ verwerfen das Elfmeterschießen', () => {
  const store = mitSchüssen(abgepfiffen());
  store.revertPhase();
  assert.equal(store.getState().phase, 'live');
  assert.equal(store.getState().shootout, null);

  const zweites = mitSchüssen(abgepfiffen());
  zweites.resetMatch();
  assert.equal(zweites.getState().shootout, null);
});

test('eine laufende Diashow endet beim Start, und neu starten lässt sie sich nicht', () => {
  const store = abgepfiffen();
  store.setMedia({
    werbung: { rootPath: 'W', files: ['a.jpg'] },
    highlights: { rootPath: 'H', files: [] },
    sounds: { rootPath: 'S', files: [] },
    wettbewerbe: { rootPath: 'C', files: [] },
  });
  store.startSlideshow();
  assert.notEqual(store.getState().slideshowRequest, null);
  store.startShootout();
  assert.equal(store.getState().slideshowRequest, null);
  store.startSlideshow();
  assert.equal(store.getState().slideshowRequest, null);

  store.finishShootout();
  store.startSlideshow();
  assert.notEqual(store.getState().slideshowRequest, null, 'nach dem Beenden wieder erlaubt');
});

test('Absturzsicherung nimmt das Elfmeterschießen mit und prüft es', () => {
  const store = mitSchüssen(abgepfiffen());
  live.saveLiveMatch(store.getState());
  const snapshot = live.loadLiveMatch();
  assert.deepEqual(snapshot.shootout, { home: ['goal', 'miss', 'goal'], away: ['goal', 'goal'], finished: false });

  const wieder = new MatchStateStore();
  wieder.restoreLiveMatch(snapshot);
  assert.deepEqual(wieder.getState().shootout, store.getState().shootout);

  // Von Hand verdorbene Datei: nur gültige Schüsse bleiben übrig.
  const fs = require('fs');
  const path = require('path');
  const datei = path.join(require('electron').app.getPath('userData'), 'live-match.json');
  const roh = JSON.parse(fs.readFileSync(datei, 'utf-8'));
  roh.shootout = { home: ['goal', 'tor', 7], away: 'kaputt', finished: 'ja' };
  fs.writeFileSync(datei, JSON.stringify(roh));
  assert.deepEqual(live.loadLiveMatch().shootout, { home: ['goal'], away: [], finished: false });
});

test('Tafel: Vollbild mit Feldern, danach „i. E.“ im Endstand', (t) => {
  const store = mitSchüssen(abgepfiffen());
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());

  const body = r.document.body;
  assert.ok(body.classList.contains('showing-shootout'));
  const felder = (team) => [...r.document.querySelectorAll(`#shootout-${team}-kicks i`)].map((i) => i.className);
  assert.deepEqual(felder('home'), ['is-goal', 'is-miss', 'is-goal', '', '']);
  assert.deepEqual(felder('away'), ['is-goal', 'is-goal', '', '', '']);
  assert.equal(r.document.getElementById('shootout-home-score').textContent, '2');

  store.finishShootout();
  r.emit('onStateUpdated', store.getState());
  assert.ok(!body.classList.contains('showing-shootout'));
  assert.match(r.document.getElementById('phase-label').textContent, /2:2 i\. E\./);
  assert.deepEqual(r.drainErrors(), []);
});

test('Steuerung: Knöpfe melden Mannschaft und Schuss und zählen kein Tor', (t) => {
  const store = abgepfiffen();
  const r = openRenderer('control', t);
  r.window.confirm = () => true;
  r.emit('onStateUpdated', store.getState());

  const treffer = r.document.querySelector('[data-shootout-team="home"][data-shootout-kick="goal"]');
  assert.equal(treffer.disabled, true, 'vor dem Start gesperrt');
  assert.deepEqual(r.click('shootout-start').map((c) => c.name), ['shootoutStart']);

  store.startShootout();
  r.emit('onStateUpdated', store.getState());
  r.calls.length = 0;
  treffer.click();
  r.document.querySelector('[data-shootout-team="away"][data-shootout-kick="miss"]').click();
  r.document.querySelector('[data-shootout-undo="away"]').click();
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [
    { name: 'shootoutKick', args: ['home', 'goal'] },
    { name: 'shootoutKick', args: ['away', 'miss'] },
    { name: 'shootoutUndo', args: ['away'] },
  ]);
  assert.equal(r.document.getElementById('slideshow-start').disabled, true, 'keine Diashow darüber');
  assert.deepEqual(r.drainErrors(), []);
});
