/**
 * Sicherung des laufenden Spiels: Was geschrieben wird, was beim Start
 * wieder angeboten wird und wie kaputte Dateien behandelt werden.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stubElectron, load, MIN } = require('./helpers');

const userData = stubElectron();
const { MatchStateStore } = load('main/state');
const live = load('main/liveMatch');

const dateiPfad = path.join(userData, 'live-match.json');

/** Ein Spiel, das bereits läuft und ein paar Ereignisse hat. */
function laufendesSpiel() {
  const store = new MatchStateStore();
  store.kickoff();
  store.incrementScore('home', 1);
  store.incrementScore('away', 1);
  store.addCard('away', 'yellow');
  store.stopClock();
  return store;
}

test('vor dem Anpfiff gibt es nichts zu sichern', () => {
  const store = new MatchStateStore();
  assert.equal(live.isWorthSaving(store.getState()), false);
});

test('ein laufendes Spiel wird gesichert', () => {
  assert.equal(live.isWorthSaving(laufendesSpiel().getState()), true);
});

test('die Sicherung enthält keine Kader- oder Bilddaten', () => {
  const store = laufendesSpiel();
  store.setSquad('home', [
    { id: 'p1', number: 7, firstName: 'Max', lastName: 'Muster', position: '',
      role: 'start', isGoalkeeper: false, isCaptain: false,
      photoDataUrl: `data:image/jpeg;base64,${'A'.repeat(50000)}` },
  ]);

  const snapshot = live.toSnapshot(store.getState());

  assert.ok(!('squads' in snapshot), 'Kader gehören nicht in die Sicherung');
  // Kader, Logos und Portraits stehen in squads.json/teams.json. Landeten
  // sie hier mit, würde alle 5 Sekunden ein Megabyte geschrieben.
  assert.ok(
    JSON.stringify(snapshot).length < 2000,
    'Sicherung ist unerwartet groß -- stecken Bilddaten drin?'
  );
});

test('Spielstand, Chronik und Uhrstand überstehen den Roundtrip', () => {
  const store = laufendesSpiel();
  store.setClock(23 * MIN);
  store.setStoppage(3);
  live.saveLiveMatch(store.getState());

  const geladen = live.loadLiveMatch();
  assert.ok(geladen);
  assert.equal(geladen.home.score, 1);
  assert.equal(geladen.away.score, 1);
  assert.equal(geladen.events.length, 3);
  assert.equal(geladen.elapsedMs, 23 * MIN);
  assert.equal(geladen.stoppageMinutes, 3);

  live.clearLiveMatch();
});

test('Wiederherstellung übernimmt den Stand und hält die Uhr an', () => {
  const store = laufendesSpiel();
  const snapshot = live.toSnapshot(store.getState());

  const neu = new MatchStateStore();
  neu.restoreLiveMatch(snapshot);
  const state = neu.getState();

  assert.equal(state.home.score, 1);
  assert.equal(state.events.length, 3);
  assert.equal(state.phase, 'live');
  // Nach einem Absturz ist unbekannt, wie viel Zeit vergangen ist --
  // weiterlaufen zu lassen wäre geraten.
  assert.equal(state.clock.running, false);
});

test('nach der Wiederherstellung bekommt ein neues Tor eine frische Id', () => {
  // Sonst hielte die Anzeige es für ein bereits gesehenes Ereignis und der
  // Torjubel bliebe aus.
  const snapshot = live.toSnapshot(laufendesSpiel().getState());
  const hoechsteAlteId = Math.max(...snapshot.events.map((e) => e.id));

  const neu = new MatchStateStore();
  neu.restoreLiveMatch(snapshot);
  neu.incrementScore('home', 1);

  const letztes = neu.getState().events.at(-1);
  assert.ok(letztes.id > hoechsteAlteId, `Id ${letztes.id} kollidiert mit dem Bestand`);
});

test('frische Sicherung eines laufenden Spiels ist fortsetzbar', () => {
  const snapshot = live.toSnapshot(laufendesSpiel().getState());
  assert.equal(live.isResumable(snapshot), true);
});

test('alte Sicherung wird nicht mehr angeboten', () => {
  const snapshot = live.toSnapshot(laufendesSpiel().getState());
  const alt = { ...snapshot, savedAt: Date.now() - live.RESUME_MAX_AGE_MS - 1000 };
  assert.equal(live.isResumable(alt), false);
});

test('Sicherung vor dem Anpfiff wird nicht angeboten', () => {
  const snapshot = live.toSnapshot(laufendesSpiel().getState());
  assert.equal(live.isResumable({ ...snapshot, phase: 'pre-match' }), false);
});

test('Löschen entfernt die Datei', () => {
  live.saveLiveMatch(laufendesSpiel().getState());
  live.clearLiveMatch();
  assert.equal(live.loadLiveMatch(), null);
});

test('kaputte oder fremde Dateien liefern null statt zu werfen', () => {
  for (const inhalt of ['{ das ist kein JSON', '{"version":99}', '{}', 'null', '[]']) {
    fs.writeFileSync(dateiPfad, inhalt, 'utf-8');
    assert.equal(live.loadLiveMatch(), null, `"${inhalt}" hätte null ergeben müssen`);
  }
  live.clearLiveMatch();
});

test('ältere Sicherung ohne Nachspielzeit wird mit 0 gelesen', () => {
  // Das Feld kam später dazu -- eine alte Datei darf deswegen nicht
  // verworfen werden.
  const snapshot = live.toSnapshot(laufendesSpiel().getState());
  delete snapshot.stoppageMinutes;
  fs.writeFileSync(dateiPfad, JSON.stringify(snapshot), 'utf-8');

  const geladen = live.loadLiveMatch();
  assert.ok(geladen);
  assert.equal(geladen.stoppageMinutes, 0);
  live.clearLiveMatch();
});

test('Ecken und Zuschauerzahl überstehen den Roundtrip', () => {
  const store = laufendesSpiel();
  store.adjustCorners('home', 4);
  store.adjustCorners('away', 2);
  store.setAttendance(312);
  live.saveLiveMatch(store.getState());

  const geladen = live.loadLiveMatch();
  assert.ok(geladen);
  assert.deepEqual(geladen.corners, { home: 4, away: 2 });
  assert.equal(geladen.attendance, 312);

  const neu = new MatchStateStore();
  neu.restoreLiveMatch(geladen);
  assert.deepEqual(neu.getState().corners, { home: 4, away: 2 });
  assert.equal(neu.getState().attendance, 312);

  live.clearLiveMatch();
});

test('ältere Sicherung ohne Ecken und Zuschauerzahl bleibt lesbar', () => {
  // Beide Felder kamen später dazu -- genau wie die Nachspielzeit darf
  // eine alte Datei deswegen nicht verworfen werden.
  const snapshot = live.toSnapshot(laufendesSpiel().getState());
  delete snapshot.corners;
  delete snapshot.attendance;
  fs.writeFileSync(dateiPfad, JSON.stringify(snapshot), 'utf-8');

  const geladen = live.loadLiveMatch();
  assert.ok(geladen, 'alte Sicherung wurde verworfen');
  assert.deepEqual(geladen.corners, { home: 0, away: 0 });
  assert.equal(geladen.attendance, null);
  live.clearLiveMatch();
});

test('unbrauchbare Zählerstände in der Datei werden zu 0', () => {
  // Eine halb geschriebene oder von Hand bearbeitete Datei darf keinen
  // Unsinn auf die Tafel bringen.
  const snapshot = live.toSnapshot(laufendesSpiel().getState());
  snapshot.corners = { home: 'viele', away: -3 };
  snapshot.attendance = 'ausverkauft';
  fs.writeFileSync(dateiPfad, JSON.stringify(snapshot), 'utf-8');

  const geladen = live.loadLiveMatch();
  assert.ok(geladen);
  assert.deepEqual(geladen.corners, { home: 0, away: 0 });
  assert.equal(geladen.attendance, null);
  live.clearLiveMatch();
});

test('die Sicherung bleibt auch mit den neuen Feldern klein', () => {
  const store = laufendesSpiel();
  store.adjustCorners('home', 4);
  store.setAttendance(312);
  assert.ok(JSON.stringify(live.toSnapshot(store.getState())).length < 2000);
});
