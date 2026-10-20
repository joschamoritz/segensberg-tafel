/**
 * Retro-Design: Punktmatrix, Kurznamen und ihre Bedienung.
 *
 * Gezeichnet wird auf ein Canvas, das jsdom nicht kennt. Deshalb steckt
 * alles, was sich falsch machen lässt -- Schrift, Kürzung, Aufteilung,
 * Kurzname --, in `shared/retroMatrix.ts` und wird hier direkt geprüft.
 * Die Anzeige selbst prüft der Smoke-Test, der jedes Design durch alle
 * Spielzustände fährt.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const {
  composeRetro,
  deriveRetroName,
  fitText,
  normalizeRetroText,
  retroCharset,
  retroGlyph,
  retroSceneKey,
  retroTeamName,
  textWidth,
} = load('shared/retroMatrix');

const COLS = 96;
const ROWS = 48;

/** Leuchtende Punkte in einem Rechteck (Grenzen einschließlich). */
function punkte(m, x1, y1, x2, y2) {
  let n = 0;
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) if (m.get(x, y)) n++;
  return n;
}

function spiel(overrides = {}) {
  return {
    kind: 'match',
    home: 'Hochlar',
    away: 'Erkenschwick',
    homeScore: 2,
    awayScore: 1,
    scorers: [],
    footer: { kind: 'clock', clock: '41:23', half: '1. HZ', stoppage: '' },
    ...overrides,
  };
}

// --------------------------------------------------------------------
// Kurzname
// --------------------------------------------------------------------

test('der Kurzname lässt Vereinsform und Gründungsjahr weg', () => {
  const faelle = {
    'Spvgg. Erkenschwick': 'Erkenschwick',
    'SV Hochlar 28': 'Hochlar',
    'Erler SV': 'Erler',
    '1. FC Köln': 'Köln',
    'FC Schalke 04': 'Schalke',
    'TuS 05 Sinsen': 'Sinsen',
    'DJK Spvgg. Herten': 'Herten',
    'SG Suderwich': 'Suderwich',
    'Firtinaspor Marl': 'Firtinaspor Marl',
  };
  for (const [name, erwartet] of Object.entries(faelle)) {
    assert.equal(deriveRetroName(name), erwartet, name);
  }
});

test('eine einzelne Ziffer bleibt -- sie meint die zweite Mannschaft', () => {
  assert.equal(deriveRetroName('Firtinaspor Marl 2'), 'Firtinaspor Marl 2');
});

test('besteht der Name nur aus Vereinsform, bleibt er ganz', () => {
  assert.equal(deriveRetroName('SV'), 'SV');
  assert.equal(deriveRetroName('  '), '');
});

test('ein von Hand gesetzter Kurzname geht vor, ein leerer nicht', () => {
  assert.equal(retroTeamName({ name: 'Spvgg. Erkenschwick', retroName: 'Schwicker' }), 'Schwicker');
  assert.equal(retroTeamName({ name: 'Spvgg. Erkenschwick', retroName: '  ' }), 'Erkenschwick');
  assert.equal(retroTeamName({ name: 'Spvgg. Erkenschwick' }), 'Erkenschwick');
});

// --------------------------------------------------------------------
// Schrift
// --------------------------------------------------------------------

test('Umlaute werden ausgeschrieben wie auf den alten Tafeln', () => {
  assert.equal(normalizeRetroText('Köln'), 'KOELN');
  assert.equal(normalizeRetroText('Müller-Lüdenscheidt'), 'MUELLER-LUEDENSCHEIDT');
  assert.equal(normalizeRetroText('Äbtissin'), 'AEBTISSIN');
  assert.equal(normalizeRetroText('Straße'), 'STRASSE');
  assert.equal(normalizeRetroText('Pérez'), 'PEREZ');
});

test('unbekannte Zeichen werden zur Lücke statt zum Fehler', () => {
  assert.equal(normalizeRetroText('5€'), '5 ');
  assert.equal(normalizeRetroText('45+2’'), "45+2'");
  assert.equal(normalizeRetroText('Tor · 13'), 'TOR - 13');
});

test('beide Schriften kennen dieselben Zeichen', () => {
  // Sonst stünde ein Zeichen in der großen Schrift und verschwände in der
  // kleinen still -- etwa ein Bindestrich in einem Spielernamen.
  assert.deepEqual(retroCharset('klein').sort(), retroCharset('gross').sort());
});

test('jedes Zeichen hat die Höhe seiner Schrift und gleich lange Zeilen', () => {
  for (const [font, hoehe] of [
    ['gross', 7],
    ['klein', 5],
  ]) {
    for (const char of retroCharset(font)) {
      const zeilen = retroGlyph(font, char);
      assert.equal(zeilen.length, hoehe, `${font} "${char}": Höhe`);
      assert.ok(
        zeilen.every((z) => z.length === zeilen[0].length && /^[01]+$/.test(z)),
        `${font} "${char}": ungleiche oder ungültige Zeilen`
      );
    }
  }
});

test('M, N und W sind in der kleinen Schrift unterscheidbar', () => {
  // Mit drei Punkten Breite waren sie es nicht ("WIENAND" las sich als
  // "NIENAND"). Prüfung: kein Paar hat dasselbe Muster.
  const muster = ['M', 'N', 'W', 'H'].map((c) => retroGlyph('klein', c).join('/'));
  assert.equal(new Set(muster).size, muster.length);
  assert.notEqual(retroGlyph('klein', 'Z').join('/'), retroGlyph('klein', '2').join('/'));
});

test('Kürzen schneidet ab, bis der Text passt', () => {
  const lang = 'BERGMANN-THIELE';
  const gekuerzt = fitText(lang, 'klein', 1, 30);
  assert.ok(textWidth(gekuerzt, 'klein') <= 30);
  assert.ok(lang.startsWith(gekuerzt));
  assert.equal(fitText('HESSE', 'klein', 1, 96), 'HESSE', 'was passt, bleibt');
});

// --------------------------------------------------------------------
// Aufteilung
// --------------------------------------------------------------------

test('Spielansicht: lange Namen bleiben in ihrer Hälfte', () => {
  const m = composeRetro(
    spiel({ home: 'Spielvereinigung Langername', away: 'Sportfreunde Nochlaenger' }),
    COLS,
    ROWS
  );
  // Zwischen den Namen bleibt die Mitte frei -- sonst liefen sie ineinander.
  assert.equal(punkte(m, 46, 0, 49, 8), 0, 'die Namen berühren sich');
  assert.ok(punkte(m, 0, 0, 45, 8) > 0, 'Heimname fehlt');
  assert.ok(punkte(m, 50, 0, 95, 8) > 0, 'Gastname fehlt');
});

test('Spielansicht: Heimtore links, Gasttore rechts, auch zweistellig', () => {
  const m = composeRetro(spiel({ homeScore: 12, awayScore: 10 }), COLS, ROWS);
  assert.ok(punkte(m, 0, 10, 44, 30) > 0);
  assert.ok(punkte(m, 51, 10, 95, 30) > 0);
  assert.equal(punkte(m, 45, 10, 46, 30), 0, 'Heimtore laufen in die Mitte');
  assert.equal(punkte(m, 49, 10, 50, 30), 0, 'Gasttore laufen in die Mitte');
});

test('Spielansicht: in Halbzeit und Endstand steht die Phase statt der Uhr', () => {
  const uhr = composeRetro(spiel(), COLS, ROWS);
  const pause = composeRetro(spiel({ footer: { kind: 'phase', text: 'HALBZEIT' } }), COLS, ROWS);
  assert.notDeepStrictEqual(
    Array.from(uhr.dots.slice(34 * COLS)),
    Array.from(pause.dots.slice(34 * COLS))
  );
  assert.ok(punkte(pause, 0, 34, 95, 47) > 0);
});

test('jede Szene bleibt in der Fläche, auch mit überlangen Texten', () => {
  const lang = 'X'.repeat(80);
  const szenen = [
    { kind: 'blank' },
    { kind: 'matchup', home: lang, away: lang, line: lang },
    spiel({ home: lang, away: lang }),
    spiel({ footer: { kind: 'info', title: lang, value: "90+4'", name: lang } }),
    { kind: 'goal', word: 'TOR!', team: lang },
    { kind: 'scorer', title: lang, name: lang, detail: lang },
    { kind: 'thanks', before: lang, number: '12.345', after: `${lang} ${lang} ${lang}` },
    {
      kind: 'lineup',
      title: lang,
      entries: Array.from({ length: 14 }, (_, i) => ({ number: String(i), name: lang })),
    },
    { kind: 'text', title: lang, lines: [lang, lang, lang, lang, lang, lang, lang] },
  ];
  for (const szene of szenen) {
    const m = composeRetro(szene, COLS, ROWS);
    assert.equal(m.dots.length, COLS * ROWS, szene.kind);
    assert.ok(m.dots.every((d) => d === 0 || d === 1), szene.kind);
  }
});

test('das Raster hat bei jeder Tafelauflösung rund 96 Punkte Breite', () => {
  // Vorher war die Punktgröße fest. Bei einer Tafelauflösung in
  // Bildschirmgröße entstand ein riesiges Raster mit winzigem Inhalt.
  const { retroGrid } = load('shared/retroMatrix');
  assert.deepEqual(retroGrid(384, 192), { cell: 4, dot: 3, cols: 96, rows: 48 });
  for (const [w, h] of [
    [1920, 1080],
    [1874, 1036],
    [768, 384],
    [384, 224],
  ]) {
    const g = retroGrid(w, h);
    assert.ok(g.cols >= 96 && g.cols < 110, `${w}x${h}: ${g.cols} Spalten`);
    assert.ok(g.rows >= 48, `${w}x${h}: ${g.rows} Zeilen`);
    assert.ok(g.dot < g.cell, `${w}x${h}: zwischen den Punkten muss eine Lücke bleiben`);
  }
});

test('Spielansicht: die Torschützen stehen unter dem Spielstand', () => {
  const ohne = composeRetro(spiel(), COLS, ROWS);
  const mit = composeRetro(
    spiel({
      scorers: [
        { side: 'home', text: "13' BRINKMANN" },
        { side: 'away', text: "32' SCHULTE-WIEGAND" },
      ],
    }),
    COLS,
    ROWS
  );
  assert.equal(punkte(ohne, 0, 23, 95, 39), 0, 'ohne Tore bleibt der Bereich leer');
  assert.ok(punkte(mit, 0, 23, 20, 27) > 0, 'Heimtor fehlt in der ersten Zeile, links');
  assert.equal(punkte(mit, 75, 23, 95, 27), 0, 'Heimtor gehört nach links');
  assert.ok(punkte(mit, 75, 29, 95, 33) > 0, 'Gasttor fehlt in der zweiten Zeile, rechts');
  // Volle Breite: der lange Gastname reicht über die Mitte nach links.
  assert.ok(punkte(mit, 10, 29, 45, 33) > 0, 'Gastname wurde auf eine halbe Zeile gekürzt');
  assert.equal(punkte(mit, 0, 40, 95, 40), 0, 'die Liste läuft in die Uhrzeile');
});

test('Spielansicht: bei mehr als drei Toren stehen die jüngsten', () => {
  const e = (text) => ({ side: 'home', text });
  const vier = composeRetro(spiel({ scorers: [e('1 A'), e('2 B'), e('3 C'), e('4 D')] }), COLS, ROWS);
  const letzteDrei = composeRetro(spiel({ scorers: [e('2 B'), e('3 C'), e('4 D')] }), COLS, ROWS);
  assert.deepStrictEqual(Array.from(vier.dots), Array.from(letzteDrei.dots));
});

test('Sponsoren: der Titel steht als Punktschrift ganz oben', () => {
  const m = composeRetro({ kind: 'sponsors', title: 'UNSERE PARTNER', page: 0, pages: 2 }, COLS, ROWS);
  assert.ok(punkte(m, 0, 0, 80, 6) > 0, 'Titel fehlt');
  assert.ok(punkte(m, 81, 0, 95, 6) > 0, 'Seitenmarken fehlen');
  assert.equal(punkte(m, 0, 8, 95, 47), 0, 'unter dem Titel liegen die Logos -- dort keine Punkte');
});

test('Umlaute werden vor dem Messen aufbereitet', () => {
  // "Köln" ist auf der Matrix "KOELN" -- gemessen am Rohtext wäre die
  // Zentrierung um ein Zeichen daneben.
  const roh = composeRetro({ kind: 'goal', word: 'TOR', team: 'Köln' }, COLS, ROWS);
  const fertig = composeRetro({ kind: 'goal', word: 'TOR', team: 'KOELN' }, COLS, ROWS);
  assert.deepStrictEqual(Array.from(roh.dots), Array.from(fertig.dots));
});

test('eine höhere Tafel bekommt den Inhalt mittig, nicht oben angeklebt', () => {
  // 384x224 statt 384x192 -- die offene Frage zur echten Auflösung.
  const hoch = composeRetro({ kind: 'goal', word: 'TOR!', team: 'HOCHLAR' }, 96, 56);
  assert.equal(punkte(hoch, 0, 0, 95, 3), 0, 'oben muss Rand bleiben');
  assert.equal(punkte(hoch, 0, 52, 95, 55), 0, 'unten muss Rand bleiben');
});

test('Aufstellung: bis sechs einspaltig über die volle Breite', () => {
  const eintraege = [{ number: '10', name: 'BERGMANN-THIELE' }];
  const m = composeRetro({ kind: 'lineup', title: 'HOCHLAR', entries: eintraege }, COLS, ROWS);
  // Der lange Name reicht über die Mitte -- zweispaltig wäre er gekürzt.
  assert.ok(punkte(m, 50, 11, 95, 15) > 0, 'Name wurde gekürzt');
});

test('der Aufbau-Schlüssel übergeht nur Uhr und Countdown', () => {
  // Ändert sich der Schlüssel, baut sich die Tafel Punkt für Punkt neu
  // auf. Bei jeder Sekunde der Uhr wäre das Unruhe -- bei einem Tor aber
  // gerade der Effekt.
  const a = spiel();
  const b = spiel({ footer: { ...a.footer, clock: '41:24' } });
  const c = spiel({ homeScore: 3 });
  assert.equal(retroSceneKey(a), retroSceneKey(b), 'Uhr allein darf keinen Aufbau auslösen');
  assert.notEqual(retroSceneKey(a), retroSceneKey(c), 'ein Tor muss ihn auslösen');

  const vorher = { kind: 'matchup', home: 'A', away: 'B', line: 'NOCH 12:34' };
  assert.equal(retroSceneKey(vorher), retroSceneKey({ ...vorher, line: 'NOCH 12:33' }));
});

// --------------------------------------------------------------------
// Store
// --------------------------------------------------------------------

test('der Kurzname wird gespeichert, ein leerer heißt "automatisch"', () => {
  const store = new MatchStateStore();
  const vorher = store.getState().revisions.teams;

  store.setTeamRetroName('away', '  Schwicker  ');
  assert.equal(store.getState().away.retroName, 'Schwicker');
  assert.ok(store.getState().revisions.teams > vorher, 'ohne bump() zeichnete die Anzeige nicht neu');

  store.setTeamRetroName('away', '');
  assert.equal(store.getState().away.retroName, '');
});

test('ein neuer Verein aus der Bibliothek verwirft den alten Kurznamen', () => {
  const store = new MatchStateStore();
  store.setTeamRetroName('away', 'Schwicker');
  store.applyLibraryTeam('away', 'Erler SV', undefined);
  assert.equal(retroTeamName(store.getState().away), 'Erler');
});

// --------------------------------------------------------------------
// Anzeige und Steuerung
// --------------------------------------------------------------------

function retroStore() {
  const store = new MatchStateStore();
  store.setAppearance({
    theme: 'retro',
    effects: { verlauf: true, strahlen: true, leuchten: true, schatten: true },
    retroColor: 'weiss',
  });
  return store;
}

test('display: Leuchtfarbe und Design landen am body', (t) => {
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', retroStore().getState());
  assert.equal(r.document.body.dataset.theme, 'retro');
  assert.equal(r.document.body.dataset.retroColor, 'weiss');
  assert.deepEqual(r.drainErrors(), []);
});

test('display: Bilder der Diashow liegen im Retro-Design über dem Raster', async (t) => {
  // Logos lassen sich nicht in Punkte übersetzen. Fehlte die Markierung,
  // bliebe die Tafel während der Sponsoren schwarz.
  const r = openRenderer('display', t);
  const store = retroStore();
  store.setMedia({
    werbung: { rootPath: 'W', files: ['01_a.png'] },
    highlights: { rootPath: 'H', files: [] },
    wettbewerbe: { rootPath: 'W', files: [] },
    hauptsponsor: { rootPath: 'HS', files: [] },
    partner: { rootPath: 'P', files: [] },
    historie: { rootPath: 'HI', files: [] },
    sounds: { rootPath: 'S', files: [] },
  });
  r.emit('onStateUpdated', store.getState());
  await Promise.resolve();
  assert.equal(r.document.body.dataset.retroOverlay, undefined, 'ohne Diashow kein Bild darüber');

  store.startSlideshow();
  r.emit('onStateUpdated', store.getState());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(r.document.body.dataset.retroOverlay, 'slide');
  assert.deepEqual(r.drainErrors(), []);
});

/** Die Szene, die die Anzeige zuletzt gezeichnet hätte. */
async function szene(r) {
  await Promise.resolve();
  await Promise.resolve();
  return JSON.parse(r.document.getElementById('retro-matrix').dataset.scene);
}

test('display: Tore und Platzverweise stehen in zeitlicher Reihenfolge', async (t) => {
  const store = retroStore();
  store.setSquad('home', [
    { id: 'h1', number: 9, firstName: 'Lukas', lastName: 'Brinkmann', position: '', role: 'start', isGoalkeeper: false, isCaptain: false },
  ]);
  store.kickoff();
  store.stopClock();
  store.setClock(12 * 60_000);
  store.incrementScore('home', 1);
  store.setGoalScorer(store.getState().events.at(-1).id, 'h1');
  store.setClock(30 * 60_000);
  store.incrementScore('away', 1);
  store.addCard('away', 'yellow');
  store.addCard('away', 'red');
  store.stopClock();

  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());
  const s = await szene(r);

  assert.equal(s.kind, 'match');
  assert.deepEqual(s.scorers, [
    { side: 'home', text: "13' Brinkmann" },
    { side: 'away', text: "31' TOR" },
    { side: 'away', text: "31' ROT" },
  ], 'Gelb fehlt bewusst, ein Tor ohne Schützen heißt TOR');
  assert.deepEqual(r.drainErrors(), []);
});

test('display: die Sponsoren-Folie zeigt den Titel als Punktschrift', async (t) => {
  const store = retroStore();
  store.setMedia({
    werbung: { rootPath: 'W', files: ['1.png', '2.png', '3.png', '4.png', '5.png'] },
    highlights: { rootPath: 'H', files: [] },
    wettbewerbe: { rootPath: 'W', files: [] },
    hauptsponsor: { rootPath: 'HS', files: [] },
    partner: { rootPath: 'P', files: [] },
    historie: { rootPath: 'HI', files: [] },
    sounds: { rootPath: 'S', files: [] },
  });
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());
  store.startSlideshow();
  r.emit('onStateUpdated', store.getState());

  assert.deepEqual(await szene(r), { kind: 'sponsors', title: 'UNSERE PARTNER', page: 0, pages: 2 });
  assert.deepEqual(r.drainErrors(), []);
});

test('control: die Leuchtfarbe ist nur im Retro-Design wählbar und geht mit', (t) => {
  const store = new MatchStateStore();
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());
  const farbe = r.document.getElementById('retro-color-select');
  assert.equal(farbe.disabled, true, 'im klassischen Design wirkt sie nicht');

  r.emit('onStateUpdated', retroStore().getState());
  assert.equal(farbe.disabled, false);
  assert.equal(farbe.value, 'weiss');

  r.calls.length = 0;
  farbe.value = 'bernstein';
  farbe.dispatchEvent(new r.window.Event('change'));
  const gesendet = r.calls.filter((c) => c.name === 'setAppearance');
  assert.equal(gesendet.length, 1);
  assert.equal(JSON.parse(JSON.stringify(gesendet[0].args[0])).retroColor, 'bernstein');
  assert.deepEqual(r.drainErrors(), []);
});

test('control: das Kurzname-Feld zeigt den Vorschlag und schickt die Eingabe', (t) => {
  const store = new MatchStateStore();
  store.applyLibraryTeam('away', 'Spvgg. Erkenschwick', undefined);
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());

  const feld = r.document.getElementById('away-retroname-input');
  assert.equal(feld.value, '', 'leer heißt automatisch');
  assert.equal(feld.placeholder, 'Erkenschwick');

  r.calls.length = 0;
  feld.value = 'Schwicker';
  feld.dispatchEvent(new r.window.Event('change'));
  const gesendet = r.calls.filter((c) => c.name === 'teamSetRetroName');
  assert.equal(gesendet.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(gesendet[0].args)), ['away', 'Schwicker']);
  assert.deepEqual(r.drainErrors(), []);
});

test('display: der Hauptsponsor trägt im Retro-Design seinen eigenen Titel', async (t) => {
  const store = retroStore();
  store.setMedia({
    werbung: { rootPath: 'W', files: [] },
    hauptsponsor: { rootPath: 'HS', files: ['haupt.png'] },
    partner: { rootPath: 'P', files: [] },
    highlights: { rootPath: 'H', files: [] },
    historie: { rootPath: 'HI', files: [] },
    wettbewerbe: { rootPath: 'W', files: [] },
    sounds: { rootPath: 'S', files: [] },
  });
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', store.getState());
  store.startSlideshow();
  r.emit('onStateUpdated', store.getState());

  assert.deepEqual(await szene(r), { kind: 'sponsors', title: 'UNSER HAUPTSPONSOR', page: 0, pages: 1 });
  assert.deepEqual(r.drainErrors(), []);
});
