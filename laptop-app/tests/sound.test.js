/**
 * Tormusik: Dateiwahl, erlaubte Formate, Lautstärke.
 *
 * Ausgelöst wird sie nur von Hand -- es gibt hier also bewusst keinen
 * Test, der ein Tor mit einem Ton verknüpft.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stubElectron, load } = require('./helpers');

const userData = stubElectron();
const { MatchStateStore } = load('main/state');
const { MediaLibrary } = load('main/media');
const { audioMimeType, pickGoalSound, DEFAULT_SOUND_SETTINGS } = load('shared/types');

let ordnerZaehler = 0;

/** Wegwerf-Sounds-Ordner; niemals die echten Vereinsdaten anfassen. */
function soundOrdnerMit(dateien) {
  const root = path.join(userData, `sounds-${ordnerZaehler++}`);
  fs.mkdirSync(root, { recursive: true });
  for (const name of dateien) fs.writeFileSync(path.join(root, name), 'x', 'utf-8');
  return { library: new MediaLibrary({ sounds: root }), root };
}

test('"tor.*" wird bevorzugt, egal an welcher Stelle es steht', () => {
  assert.equal(pickGoalSound(['applaus.mp3', 'tor.mp3', 'zzz.wav']), 'tor.mp3');
  assert.equal(pickGoalSound(['TOR.WAV']), 'TOR.WAV');
});

test('ohne "tor.*" wird die erste Audiodatei genommen', () => {
  // Ein anderer Dateiname soll nicht stumm ins Leere laufen.
  assert.equal(pickGoalSound(['01_hupe.mp3', 'applaus.mp3']), '01_hupe.mp3');
});

test('ohne Datei gibt es keine Tormusik', () => {
  assert.equal(pickGoalSound([]), null);
});

test('der Sounds-Ordner nimmt nur Audiodateien auf', () => {
  // Über das svh-media:-Protokoll darf aus dem Ordner keine beliebige
  // Datei herausgereicht werden, nur weil sie dort liegt.
  const { library } = soundOrdnerMit(['tor.mp3', 'jingle.wav', 'cover.png', 'notizen.txt']);
  assert.deepEqual(library.getLists().sounds.files, ['jingle.wav', 'tor.mp3']);
});

test('resolveFile weist im Sounds-Ordner Nicht-Audio ab', () => {
  const { library } = soundOrdnerMit(['tor.mp3', 'cover.png']);
  assert.ok(library.resolveFile('sounds', 'tor.mp3'));
  assert.equal(library.resolveFile('sounds', 'cover.png'), null);
  assert.equal(library.resolveFile('sounds', '../geheim.mp3'), null);
});

test('Bilder und Töne teilen sich die Pfadprüfung, nicht die Endungen', () => {
  // Ein MP3 im Werbeordner ist genauso wenig erlaubt wie ein PNG im
  // Sounds-Ordner.
  const root = path.join(userData, `mix-${ordnerZaehler++}`);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'ton.mp3'), 'x', 'utf-8');
  const library = new MediaLibrary({ werbung: root, sounds: root });

  assert.equal(library.resolveFile('werbung', 'ton.mp3'), null);
  assert.ok(library.resolveFile('sounds', 'ton.mp3'));
});

test('Lautstärke wird auf 0-100 begrenzt', () => {
  const store = new MatchStateStore();
  assert.deepEqual(store.getState().sound, DEFAULT_SOUND_SETTINGS);

  store.setSound({ volume: 55, muted: false });
  assert.equal(store.getState().sound.volume, 55);

  store.setSound({ volume: 500, muted: false });
  assert.equal(store.getState().sound.volume, 100);

  store.setSound({ volume: -20, muted: false });
  assert.equal(store.getState().sound.volume, 0);
});

test('eine unbrauchbare Lautstärke lässt den alten Wert stehen', () => {
  // Sonst stünde der Regler nach einem NaN auf einem sinnlosen Wert.
  const store = new MatchStateStore();
  store.setSound({ volume: 60, muted: false });
  store.setSound({ volume: NaN, muted: false });
  assert.equal(store.getState().sound.volume, 60);
});

test('Stummschaltung ist ein echter Schalter', () => {
  const store = new MatchStateStore();
  store.setSound({ volume: 80, muted: true });
  assert.equal(store.getState().sound.muted, true);
  store.setSound({ volume: 80, muted: undefined });
  assert.equal(store.getState().sound.muted, false);
});

test('"Neues Spiel" behält Lautstärke und Stummschaltung', () => {
  // Sie gehören zum Gerät und zur Situation am Platz, nicht zum Spiel.
  const store = new MatchStateStore();
  store.setSound({ volume: 35, muted: true });
  store.resetMatch();
  assert.deepEqual(store.getState().sound, { volume: 35, muted: true });
});

test('nur Tore im laufenden Spiel tragen das Jubel-Kennzeichen', () => {
  // Daran hängt der Torjubel auf der Anzeige (nicht die Tormusik, die
  // läuft nur auf Knopfdruck): Eine nachträgliche Korrektur vor dem
  // Anpfiff darf keinen Jubel auslösen.
  const store = new MatchStateStore();
  store.incrementScore('home', 1);
  assert.equal(store.getState().events.at(-1).celebrate, false);

  store.kickoff();
  store.incrementScore('home', 1);
  assert.equal(store.getState().events.at(-1).celebrate, true);
  store.stopClock();
});

test('der MIME-Typ folgt der Dateiendung', () => {
  // Ohne Typ rät Chromium beim Blob -- bei einem Fehlgriff bleibt es stumm.
  assert.equal(audioMimeType('tor.mp3'), 'audio/mpeg');
  assert.equal(audioMimeType('TOR.WAV'), 'audio/wav');
  assert.equal(audioMimeType('jingle.ogg'), 'audio/ogg');
  assert.equal(audioMimeType('hupe.m4a'), 'audio/mp4');
  assert.equal(audioMimeType('lied.flac'), 'audio/flac');
  // Unbekannt: MP3 ist die mit Abstand häufigste Ablage.
  assert.equal(audioMimeType('ohne-endung'), 'audio/mpeg');
});
