/**
 * Einblendungen im laufenden Spiel: Karte, Eckenstand, Zuschauerzahl.
 *
 * Alle drei laufen über denselben Mechanismus (`infoRequest`). Wichtig
 * ist vor allem die Selbstabräumung: Bliebe eine Anfrage dauerhaft im
 * Zustand stehen, spielte ein neu geöffnetes Anzeigefenster die letzte
 * Einblendung erneut ab -- der Renderer kennt deren Id noch nicht.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');

stubElectron();
const { MatchStateStore } = load('main/state');
const {
  DEFAULT_ATTENDANCE_MESSAGE,
  INFO_OVERLAY_MS,
  infoOverlayDurationMs,
  MAX_ATTENDANCE,
  MAX_ATTENDANCE_MESSAGE_LENGTH,
  MAX_CORNERS,
  splitAttendanceMessage,
  THANKS_DISPLAY_MS,
} = load('shared/types');

/** Wartet, bis der Store seine Einblendung selbst abgeräumt hat. */
function nachAblauf(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('eine Karte im laufenden Spiel erscheint sofort auf der Tafel', () => {
  const store = new MatchStateStore();
  store.kickoff();
  store.addCard('home', 'yellow');

  const { infoRequest, events } = store.getState();
  assert.ok(infoRequest, 'Karte hätte eine Einblendung auslösen müssen');
  assert.equal(infoRequest.overlay.kind, 'card');
  assert.equal(infoRequest.overlay.eventId, events.at(-1).id);

  store.stopClock();
});

test('eine Karte außerhalb des laufenden Spiels blendet nichts ein', () => {
  // Vor dem Anpfiff und in der Pause zeigt die Tafel etwas anderes --
  // eine nachgetragene Karte soll dort nicht dazwischenfunken.
  const store = new MatchStateStore();
  store.addCard('home', 'yellow');
  assert.equal(store.getState().infoRequest, null);
  // Der Eintrag in der Chronik entsteht trotzdem.
  assert.equal(store.getState().events.length, 1);
});

test('jede Einblendung bekommt eine neue Id', () => {
  // Sonst erkennt der Renderer eine erneute Anforderung nicht als neu und
  // die Leiste bliebe beim zweiten Druck aus.
  const store = new MatchStateStore();
  store.showInfo({ kind: 'corners' });
  const erste = store.getState().infoRequest.id;
  store.showInfo({ kind: 'corners' });
  assert.ok(store.getState().infoRequest.id > erste);
});

test('die Einblendung räumt sich nach Ablauf selbst ab', async () => {
  const store = new MatchStateStore();
  store.showInfo({ kind: 'corners' });
  assert.ok(store.getState().infoRequest);

  await nachAblauf(INFO_OVERLAY_MS + 100);
  assert.equal(
    store.getState().infoRequest,
    null,
    'Anfrage blieb stehen -- ein neues Anzeigefenster spielte sie erneut ab'
  );
});

test('Ecken zählen hoch und runter, aber nicht unter null', () => {
  const store = new MatchStateStore();
  store.adjustCorners('home', 1);
  store.adjustCorners('home', 1);
  store.adjustCorners('away', 1);
  assert.deepEqual(store.getState().corners, { home: 2, away: 1 });

  store.adjustCorners('home', -1);
  assert.equal(store.getState().corners.home, 1);

  // Ein Fehlklick am Spielfeldrand darf keinen negativen Stand erzeugen.
  store.adjustCorners('away', -5);
  assert.equal(store.getState().corners.away, 0);
});

test('Ecken sind nach oben gedeckelt und ignorieren Unsinn', () => {
  const store = new MatchStateStore();
  store.adjustCorners('home', 500);
  assert.equal(store.getState().corners.home, MAX_CORNERS);

  store.adjustCorners('home', NaN);
  assert.equal(store.getState().corners.home, MAX_CORNERS);
});

test('Ecken landen nicht in der Chronik', () => {
  // Sie fallen zu häufig -- die Liste mit Toren und Karten wäre sonst
  // nicht mehr lesbar.
  const store = new MatchStateStore();
  store.kickoff();
  store.adjustCorners('home', 1);
  assert.equal(store.getState().events.length, 0);
  store.stopClock();
});

test('Zuschauerzahl wird gesetzt, gedeckelt und wieder löschbar', () => {
  const store = new MatchStateStore();
  assert.equal(store.getState().attendance, null);

  store.setAttendance(312);
  assert.equal(store.getState().attendance, 312);

  store.setAttendance(MAX_ATTENDANCE + 1000);
  assert.equal(store.getState().attendance, MAX_ATTENDANCE);

  store.setAttendance(null);
  assert.equal(store.getState().attendance, null);
});

test('"Neues Spiel" setzt Ecken und Zuschauerzahl zurück', () => {
  // Beide gehören zur Begegnung, nicht zum Verein -- anders als Kader
  // und Halbzeitdauer.
  const store = new MatchStateStore();
  store.kickoff();
  store.adjustCorners('home', 3);
  store.setAttendance(250);
  store.stopClock();

  store.resetMatch();
  assert.deepEqual(store.getState().corners, { home: 0, away: 0 });
  assert.equal(store.getState().attendance, null);
});

test('"Neues Spiel" behält den Dankestext', () => {
  // Er gehört zum Verein, nicht zur Begegnung -- ihn vor jedem Spiel neu
  // einzutippen wäre unzumutbar.
  const store = new MatchStateStore();
  store.setAttendanceMessage('Merci für {n} Leute!');
  store.resetMatch();
  assert.equal(store.getState().attendanceMessage, 'Merci für {n} Leute!');
});

test('leerer Dankestext fällt auf die Vorgabe zurück', () => {
  // Sonst stünde bei der Einblendung nur die nackte Zahl auf der Tafel.
  const store = new MatchStateStore();
  store.setAttendanceMessage('   ');
  assert.equal(store.getState().attendanceMessage, DEFAULT_ATTENDANCE_MESSAGE);
});

test('der Dankestext wird gekappt', () => {
  const store = new MatchStateStore();
  store.setAttendanceMessage('x'.repeat(500));
  assert.equal(
    store.getState().attendanceMessage.length,
    MAX_ATTENDANCE_MESSAGE_LENGTH
  );
});

test('der Dankestext wird am Platzhalter zerlegt', () => {
  assert.deepEqual(splitAttendanceMessage('Danke für {n} Zuschauer heute!'), {
    before: 'Danke für',
    after: 'Zuschauer heute!',
  });
  assert.deepEqual(splitAttendanceMessage(DEFAULT_ATTENDANCE_MESSAGE).before, 'Danke für');
});

test('fehlender Platzhalter verschluckt die Zahl nicht', () => {
  // Wer beim Umformulieren das {n} löscht, soll die Zahl trotzdem sehen.
  assert.deepEqual(splitAttendanceMessage('Danke ans Publikum'), {
    before: '',
    after: 'Danke ans Publikum',
  });
});

test('die Danksagung steht länger als die Leiste', () => {
  // Sie füllt das Bild und will in Ruhe gelesen werden.
  assert.equal(infoOverlayDurationMs({ kind: 'attendance' }), THANKS_DISPLAY_MS);
  assert.equal(infoOverlayDurationMs({ kind: 'corners' }), INFO_OVERLAY_MS);
  assert.equal(infoOverlayDurationMs({ kind: 'card', eventId: 1 }), INFO_OVERLAY_MS);
});

test('Torschützen- und Aufstellungs-Einblendung räumen sich ebenfalls ab', async () => {
  // Bis hierher blieben beide Anfragen dauerhaft im Zustand stehen:
  // `hideScorer()` rief niemand auf, und ein neu geöffnetes
  // Anzeigefenster holte die Einblendung dann nach.
  const store = new MatchStateStore();
  store.setSquad('home', [player()]);
  store.kickoff();
  store.incrementScore('home', 1);
  const torId = store.getState().events.at(-1).id;
  store.setGoalScorer(torId, 'p1');
  store.stopClock();

  store.showScorer(torId);
  assert.ok(store.getState().scorerRequest);
  store.hideScorer();
  assert.equal(store.getState().scorerRequest, null);

  store.showLineup('home');
  assert.ok(store.getState().lineupRequest);
  store.hideLineup();
  assert.equal(store.getState().lineupRequest, null);
});

test('der Anpfiff beendet eine laufende Aufstellungs-Einblendung', () => {
  const store = new MatchStateStore();
  store.showLineup('home');
  store.kickoff();
  assert.equal(store.getState().lineupRequest, null);
  store.stopClock();
});
