/**
 * Wettbewerbslogo auf der Begegnung vor dem Anpfiff (Nutzerwunsch
 * 16.10.2026). Die Logos liegen im Ordner `Vereinsdaten/Wettbewerbe/`,
 * gewählt wird im Steuerungsfenster neben dem Anstoß.
 *
 * Zusagen, die hier abgesichert sind:
 * - Der Name kommt aus dem Dateinamen, ohne Ordnungsnummer und Endung.
 * - Ein Pfad im Namen kommt gar nicht erst in den Zustand.
 * - Die Wahl überdauert "Neues Spiel" (Liga folgt auf Liga).
 * - Fehlt die Datei im Ordner, zeigt die Tafel nichts statt eines
 *   zerbrochenen Bildes -- und das Steuerungsfenster sagt es.
 * - Im Retro-Design steht der Name in der Kopfzeile im Wechsel mit dem
 *   Countdown.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

const userData = stubElectron();
const { MatchStateStore } = load('main/state');
const { MediaLibrary } = load('main/media');
const { sanitizeCompetition } = load('main/validate');
const { loadTeamsConfig, saveTeamsConfig } = load('main/persistence');
const { competitionLabel } = load('shared/types');

function medien(wettbewerbe) {
  return {
    werbung: { rootPath: 'W', files: [] },
    highlights: { rootPath: 'H', files: [] },
    sounds: { rootPath: 'S', files: [] },
    wettbewerbe: { rootPath: 'C:\\Vereinsdaten\\Wettbewerbe', files: wettbewerbe },
  };
}

function storeMit(dateien, wahl) {
  const store = new MatchStateStore();
  store.setMedia(medien(dateien));
  store.setCompetition(wahl);
  return store;
}

// --------------------------------------------------------------------
// Name, Prüfung, Zustand
// --------------------------------------------------------------------

test('der Name kommt aus dem Dateinamen', () => {
  assert.equal(competitionLabel('Kreisliga.png'), 'Kreisliga');
  assert.equal(competitionLabel('02_Krombacher_Westfalenpokal.png'), 'Krombacher Westfalenpokal');
  assert.equal(competitionLabel('01 Bezirksliga.svg'), 'Bezirksliga');
  assert.equal(competitionLabel('Kreispokal 2026.webp'), 'Kreispokal 2026', 'Zahlen im Namen bleiben');
});

test('die Prüfschicht lässt nur reine Dateinamen durch', () => {
  assert.equal(sanitizeCompetition('Kreisliga.png'), 'Kreisliga.png');
  assert.equal(sanitizeCompetition('  Kreisliga.png '), 'Kreisliga.png');
  assert.equal(sanitizeCompetition('../teams.json'), null);
  assert.equal(sanitizeCompetition('..\\..\\geheim.png'), null);
  assert.equal(sanitizeCompetition('..'), null);
  assert.equal(sanitizeCompetition(''), null);
  assert.equal(sanitizeCompetition(null), null);
  assert.equal(sanitizeCompetition(42), null);
  assert.equal(sanitizeCompetition('x'.repeat(201)), null);
});

test('die Wahl überdauert "Neues Spiel"', () => {
  const store = storeMit(['Kreisliga.png'], 'Kreisliga.png');
  store.resetMatch();
  assert.equal(store.getState().competition, 'Kreisliga.png');
  store.setCompetition(null);
  assert.equal(store.getState().competition, null);
});

test('die Wahl wird in teams.json gespeichert und wieder gelesen', () => {
  const vorher = loadTeamsConfig();
  saveTeamsConfig({ ...vorher, competition: 'Bezirksliga.svg' });
  assert.equal(loadTeamsConfig().competition, 'Bezirksliga.svg');
  saveTeamsConfig({ ...vorher, competition: null });
  assert.equal(loadTeamsConfig().competition, null);
});

test('der Ordner nimmt auch SVG an, die Werbung nicht', () => {
  const root = path.join(userData, 'wettbewerbe-test');
  fs.mkdirSync(path.join(root, 'Wettbewerbe'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Werbung'), { recursive: true });
  for (const ordner of ['Wettbewerbe', 'Werbung']) {
    for (const name of ['Bezirksliga.svg', 'Kreisliga.png', 'Pokal.ai']) {
      fs.writeFileSync(path.join(root, ordner, name), 'x', 'utf-8');
    }
  }
  const library = new MediaLibrary({
    werbung: path.join(root, 'Werbung'),
    highlights: path.join(root, 'leer'),
    sounds: path.join(root, 'leer'),
    wettbewerbe: path.join(root, 'Wettbewerbe'),
  });

  assert.deepEqual(library.getLists().wettbewerbe.files, ['Bezirksliga.svg', 'Kreisliga.png']);
  assert.deepEqual(library.getLists().werbung.files, ['Kreisliga.png']);
  assert.ok(library.resolveFile('wettbewerbe', 'Bezirksliga.svg'));
  assert.equal(library.resolveFile('wettbewerbe', 'Pokal.ai'), null, 'Illustrator kann der Browser nicht');
  assert.equal(
    path.dirname(library.resolveFile('wettbewerbe', '../Werbung/Kreisliga.png')),
    path.join(root, 'Wettbewerbe'),
    'ein Pfadanteil führt nicht aus dem Ordner heraus'
  );
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

test('display: das gewählte Logo steht über der Begegnung', (t) => {
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', storeMit(['Kreisliga.png', 'Westfalenpokal.png'], 'Westfalenpokal.png').getState());

  const img = r.document.getElementById('pre-competition');
  assert.equal(img.hidden, false);
  assert.equal(img.getAttribute('src'), 'svh-media://wettbewerbe/Westfalenpokal.png');
  assert.ok(r.document.body.classList.contains('has-competition'));
  assert.deepEqual(r.drainErrors(), []);
});

test('display: ohne Wahl oder ohne Datei bleibt der Platz leer', (t) => {
  const r = openRenderer('display', t);
  const img = r.document.getElementById('pre-competition');

  r.emit('onStateUpdated', storeMit(['Kreisliga.png'], 'Kreisliga.png').getState());
  assert.equal(img.hidden, false);

  r.emit('onStateUpdated', storeMit(['Kreisliga.png'], null).getState());
  assert.equal(img.hidden, true);
  assert.equal(img.hasAttribute('src'), false);
  assert.equal(r.document.body.classList.contains('has-competition'), false);

  r.emit('onStateUpdated', storeMit([], 'Kreisliga.png').getState());
  assert.equal(img.hidden, true, 'Datei fehlt im Ordner: kein zerbrochenes Bild');
  assert.deepEqual(r.drainErrors(), []);
});

test('display: Retro zeigt den Wettbewerb im Wechsel mit dem Countdown', async (t) => {
  const store = storeMit(['02_Kreisliga.png'], '02_Kreisliga.png');
  store.setKickoffTime('15:00');
  store.setAppearance({
    theme: 'retro',
    effects: { verlauf: true, strahlen: true, leuchten: true, schatten: true },
    retroColor: 'bernstein',
  });

  const echtesNow = Date.now;
  t.after(() => {
    Date.now = echtesNow;
  });
  const r = openRenderer('display', t);
  const zeilen = new Set();
  for (const zeit of [0, 4000, 8000, 12000]) {
    const jetzt = () => new Date(2026, 9, 16, 14, 0, 0).getTime() + zeit;
    Date.now = jetzt;
    r.window.Date.now = jetzt;
    r.emit('onStateUpdated', store.getState());
    await Promise.resolve();
    await Promise.resolve();
    const szene = JSON.parse(r.document.getElementById('retro-matrix').dataset.scene);
    assert.equal(szene.kind, 'matchup');
    zeilen.add(szene.line);
  }

  // Großgeschrieben wird erst beim Zeichnen (composeRetro).
  assert.ok(zeilen.has('Kreisliga'),`Wettbewerb fehlt: ${[...zeilen].join(' | ')}`);
  assert.ok([...zeilen].some((z) => z.startsWith('ANSTOSS 15:00')), 'Countdown fehlt');
  assert.deepEqual(r.drainErrors(), []);
});

// --------------------------------------------------------------------
// Steuerung
// --------------------------------------------------------------------

test('control: die Auswahl listet den Ordner und schickt die Wahl', (t) => {
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', storeMit(['01_Kreisliga.png', '02_Westfalenpokal.png'], null).getState());

  const select = r.document.getElementById('competition-select');
  assert.deepEqual(
    [...select.options].map((o) => o.textContent),
    ['– keiner –', 'Kreisliga', 'Westfalenpokal']
  );
  assert.equal(select.value, '');

  r.calls.length = 0;
  select.value = '02_Westfalenpokal.png';
  select.dispatchEvent(new r.window.Event('change'));
  select.value = '';
  select.dispatchEvent(new r.window.Event('change'));

  const aufrufe = r.calls.filter((c) => c.name === 'setCompetition').map((c) => c.args[0]);
  assert.deepEqual(aufrufe, ['02_Westfalenpokal.png', null], '"keiner" schickt null, nicht ""');
  assert.deepEqual(r.drainErrors(), []);
});

test('control: eine fehlende Datei bleibt sichtbar gewählt', (t) => {
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', storeMit(['Kreisliga.png'], 'Westfalenpokal.png').getState());

  const select = r.document.getElementById('competition-select');
  assert.equal(select.value, 'Westfalenpokal.png');
  assert.equal(select.selectedOptions[0].textContent, 'Westfalenpokal (Datei fehlt)');
  assert.deepEqual(r.drainErrors(), []);
});
