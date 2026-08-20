/**
 * Gespeicherte Fenstermaße gegen die angeschlossenen Bildschirme prüfen.
 *
 * Der Fall, um den es geht: Am Spieltag hängt die Anzeigetafel als zweiter
 * Bildschirm dran, zu Hause nicht. Ein Steuerungsfenster, das zuletzt auf
 * dem zweiten Bildschirm stand, hat gespeicherte Koordinaten weit außerhalb
 * des Laptop-Bildschirms. Ungeprüft übernommen ginge es unsichtbar auf --
 * und ohne sichtbares Fenster gibt es keinen Weg, es zurückzuholen.
 */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers.js');

const { sanitizeBounds, defaultWindowState, MIN_CONTROL_WIDTH, MIN_CONTROL_HEIGHT } =
  load('main/windowState');

/** Ein einzelner Laptop-Bildschirm, Taskleiste abgezogen. */
const LAPTOP = [{ x: 0, y: 0, width: 1920, height: 1040 }];

/** Laptop plus Anzeigetafel rechts daneben. */
const MIT_TAFEL = [...LAPTOP, { x: 1920, y: 0, width: 384, height: 192 }];

test('behält Maße, die auf dem vorhandenen Bildschirm liegen', () => {
  const gespeichert = { x: 100, y: 80, width: 1400, height: 900 };
  assert.deepStrictEqual(sanitizeBounds(gespeichert, LAPTOP), gespeichert);
});

test('verwirft Maße eines abgezogenen zweiten Bildschirms', () => {
  // Das Fenster stand auf der Anzeigetafel bzw. einem zweiten Monitor.
  const aufZweitem = { x: 1920, y: 0, width: 1000, height: 700 };

  assert.deepStrictEqual(
    sanitizeBounds(aufZweitem, MIT_TAFEL),
    aufZweitem,
    'solange der zweite Bildschirm da ist, bleiben die Maße gültig'
  );
  assert.strictEqual(
    sanitizeBounds(aufZweitem, LAPTOP),
    undefined,
    'ohne den zweiten Bildschirm muss Electron selbst platzieren'
  );
});

test('verwirft Maße, die nur mit einem Zipfel hereinragen', () => {
  // Zwei Pixel Überlappung sind praktisch genauso verloren wie gar keine.
  const fastDraussen = { x: 1918, y: 500, width: 1000, height: 700 };
  assert.strictEqual(sanitizeBounds(fastDraussen, LAPTOP), undefined);
});

test('zieht eine zu klein gespeicherte Größe auf die Mindestgröße hoch', () => {
  const zuKlein = { x: 10, y: 10, width: 200, height: 100 };
  const geprueft = sanitizeBounds(zuKlein, LAPTOP);
  assert.strictEqual(geprueft.width, MIN_CONTROL_WIDTH);
  assert.strictEqual(geprueft.height, MIN_CONTROL_HEIGHT);
  assert.strictEqual(geprueft.x, 10, 'die Position bleibt unangetastet');
});

test('verkraftet fehlende und zerschriebene Angaben', () => {
  assert.strictEqual(sanitizeBounds(undefined, LAPTOP), undefined);
  assert.strictEqual(sanitizeBounds({ x: 0, y: 0, width: NaN, height: 700 }, LAPTOP), undefined);
  assert.strictEqual(
    sanitizeBounds({ x: '10', y: 0, width: 1000, height: 700 }, LAPTOP),
    undefined,
    'eine von Hand verstellte Datei darf kein Fenster erzeugen'
  );
});

test('ohne Bildschirme gibt es nichts zu bestätigen', () => {
  assert.strictEqual(sanitizeBounds({ x: 0, y: 0, width: 1000, height: 700 }, []), undefined);
});

test('der erste Start ist maximiert', () => {
  // Der Höhenetat ist das eigentliche Problem der Oberfläche -- maximiert
  // ist die einzige Einstellung, bei der er sicher reicht.
  assert.strictEqual(defaultWindowState().maximized, true);
  assert.strictEqual(defaultWindowState().bounds, undefined);
});
