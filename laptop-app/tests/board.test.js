/**
 * Die Bühne: Auflösung der Anzeigefläche.
 *
 * Die Anzeige rechnet ihr Layout nicht in der Fenstergröße, sondern in
 * genau dieser Größe (siehe `BoardSize` in `shared/types.ts`). Damit hängt
 * an dem Wert, wie viele Zeilen die Torschützenliste trägt und wo Namen
 * gekürzt werden -- ein durchgerutschtes `NaN` oder eine verlorene
 * Einstellung fiele erst am Spieltag auf.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const { sanitizeBoardSize } = load('main/validate');
const { DEFAULT_BOARD_SIZE, MAX_BOARD_EDGE, MIN_BOARD_EDGE } = load('shared/types');

// --------------------------------------------------------------------
// Prüfschicht
// --------------------------------------------------------------------

test('brauchbare Maße gehen unverändert durch', () => {
  assert.deepEqual(sanitizeBoardSize({ width: 384, height: 224 }), {
    width: 384,
    height: 224,
  });
});

test('unbrauchbare Maße fallen auf die Herstellerangabe zurück', () => {
  // Ein halb geleertes Zahlenfeld liefert `NaN`, ein leeres einen leeren
  // String -- beides landete ohne Prüfung als Bühnengröße im Stylesheet.
  for (const kaputt of [{}, null, undefined, { width: NaN, height: NaN }, { width: '', height: '' }]) {
    assert.deepEqual(sanitizeBoardSize(kaputt), DEFAULT_BOARD_SIZE, JSON.stringify(kaputt));
  }
});

test('nur der unbrauchbare Wert fällt zurück, nicht das ganze Paar', () => {
  // Wer die Höhe ändert und dabei die Breite kurz leert, soll die Breite
  // nicht mitkorrigieren müssen.
  assert.deepEqual(sanitizeBoardSize({ width: 512, height: NaN }), {
    width: 512,
    height: DEFAULT_BOARD_SIZE.height,
  });
});

test('Maße außerhalb der Grenzen werden nicht übernommen', () => {
  assert.deepEqual(sanitizeBoardSize({ width: 0, height: 0 }), DEFAULT_BOARD_SIZE);
  assert.deepEqual(sanitizeBoardSize({ width: -384, height: -192 }), DEFAULT_BOARD_SIZE);
  assert.deepEqual(
    sanitizeBoardSize({ width: MAX_BOARD_EDGE + 1, height: MIN_BOARD_EDGE - 1 }),
    DEFAULT_BOARD_SIZE
  );
  // Die Grenzen selbst sind zugelassen.
  assert.deepEqual(sanitizeBoardSize({ width: MIN_BOARD_EDGE, height: MAX_BOARD_EDGE }), {
    width: MIN_BOARD_EDGE,
    height: MAX_BOARD_EDGE,
  });
});

test('Kommazahlen werden gerundet -- halbe Pixel gibt es nicht', () => {
  assert.deepEqual(sanitizeBoardSize({ width: 383.6, height: 192.4 }), {
    width: 384,
    height: 192,
  });
});

// --------------------------------------------------------------------
// Store
// --------------------------------------------------------------------

test('die Tafelmaße überstehen "Neues Spiel"', () => {
  // Sie gehören zum Gerät, nicht zur Begegnung. Ginge der Wert beim
  // Zurücksetzen verloren, stünde die Tafel nach dem ersten Spiel eines
  // Turniertages plötzlich im falschen Format da.
  const store = new MatchStateStore();
  store.setBoardSize({ width: 384, height: 224 });
  store.incrementScore('home', 1);

  store.resetMatch();

  assert.deepEqual(store.getState().board, { width: 384, height: 224 });
  assert.equal(store.getState().home.score, 0, 'der Spielstand gehört dagegen zurückgesetzt');
});

test('ein unverändertes Maß löst kein Zustands-Update aus', () => {
  // Der vollständige Zustand trägt alle Logos und Portraits als Base64
  // durch die IPC-Brücke. Ein Feld, das bei jedem Verlassen unverändert
  // meldet, wäre teuer -- und ließe die Renderer neu zeichnen.
  const store = new MatchStateStore();
  let updates = 0;
  store.onChange(() => updates++);

  store.setBoardSize({ ...DEFAULT_BOARD_SIZE });
  assert.equal(updates, 0, 'gleicher Wert hätte nichts auslösen dürfen');

  store.setBoardSize({ width: 384, height: 224 });
  assert.equal(updates, 1);
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

test('display: die Bühne übernimmt die Maße aus dem Zustand', (t) => {
  // Ohne diese Kopplung stünde im Stylesheet dauerhaft der Rückfallwert,
  // und das Vorschaufenster zeigte ein anderes Layout als die Tafel.
  const r = openRenderer('display', t);
  const store = new MatchStateStore();

  r.emit('onStateUpdated', store.getState());
  const stage = r.document.getElementById('stage');
  assert.equal(stage.style.getPropertyValue('--board-w'), '384px');
  assert.equal(stage.style.getPropertyValue('--board-h'), '192px');

  store.setBoardSize({ width: 384, height: 224 });
  r.emit('onStateUpdated', store.getState());
  assert.equal(stage.style.getPropertyValue('--board-h'), '224px');

  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('display: die Bühne wird formatfüllend skaliert', (t) => {
  // Der Faktor lässt sich nicht in CSS ausrechnen (Länge durch Länge),
  // deshalb rechnet ihn der Renderer. Maßgeblich ist die knappere der
  // beiden Richtungen, sonst liefe die Bühne aus dem Fenster.
  const r = openRenderer('display', t);
  r.emit('onStateUpdated', new MatchStateStore().getState());

  const stage = r.document.getElementById('stage');
  const erwartet = Math.min(r.window.innerWidth / 384, r.window.innerHeight / 192);
  assert.equal(Number(stage.style.getPropertyValue('--board-scale')), erwartet);

  assert.deepEqual(r.drainErrors(), []);
  r.close();
});
