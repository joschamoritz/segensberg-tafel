/**
 * Fassung und Baudatum in der Kopfzeile des Steuerungsfensters.
 *
 * Warum das einen eigenen Test bekommt: Diese Zeile ist der einzige Ort,
 * an dem am Spieltag ablesbar ist, welcher Stand auf dem Vereinsrechner
 * läuft. Bliebe sie unbemerkt leer, fiele das erst auf, wenn jemand die
 * Fassung wissen will -- und dann ist es zu spät.
 *
 * Geprüft werden beide Ausgänge: die gefüllte Zeile und der Fall, dass
 * es keine Angabe gibt. Der zweite ist kein Randfall, sondern der
 * Normalfall in allen übrigen Tests (die Preload-Attrappe liefert dort
 * `null`) und tritt auch im gepackten Stand auf, falls
 * `dist/build-info.json` fehlt.
 */
const test = require('node:test');
const assert = require('node:assert');
const { openRenderer } = require('./dom');

/**
 * Die Zeile wird aus einem Promise gefüllt. `DOMContentLoaded` löst
 * openRenderer synchron aus, die Auflösung kommt einen Mikrotask später
 * -- ohne dieses Warten prüfte die Zusicherung den Zustand davor.
 */
function nachMikrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('control: die Kopfzeile nennt Fassung und Baudatum', async (t) => {
  const r = openRenderer('control', t, {
    appInfo: () => Promise.resolve({ version: '1.2.3', builtAt: '2026-08-19T20:59:46.010Z' }),
  });

  await nachMikrotasks();

  assert.equal(r.text('app-version'), 'Fassung 1.2.3 · 19.8.2026');
  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('control: ohne Baudatum steht dort nur die Fassung', async (t) => {
  // So sieht es aus, wenn jemand `tsc` von Hand aufgerufen hat und
  // `build-info.json` fehlt -- die Version kennt Electron trotzdem.
  const r = openRenderer('control', t, {
    appInfo: () => Promise.resolve({ version: '1.2.3', builtAt: '' }),
  });

  await nachMikrotasks();

  assert.equal(r.text('app-version'), 'Fassung 1.2.3');
  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('control: ein unbrauchbares Baudatum wird weggelassen, nicht angezeigt', async (t) => {
  // "Invalid Date" in der Kopfzeile wäre schlimmer als gar kein Datum.
  const r = openRenderer('control', t, {
    appInfo: () => Promise.resolve({ version: '1.2.3', builtAt: 'gestern' }),
  });

  await nachMikrotasks();

  assert.equal(r.text('app-version'), 'Fassung 1.2.3');
  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('control: ohne Angabe bleibt die Zeile leer und das Fenster steht', async (t) => {
  const r = openRenderer('control', t, { appInfo: () => Promise.resolve(null) });

  await nachMikrotasks();

  assert.equal(r.text('app-version'), '');
  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('control: eine gescheiterte Abfrage reißt das Fenster nicht mit', async (t) => {
  const r = openRenderer('control', t, {
    appInfo: () => Promise.reject(new Error('IPC-Kanal fehlt')),
  });

  await nachMikrotasks();

  assert.equal(r.text('app-version'), '');
  assert.deepEqual(r.drainErrors(), []);
  r.close();
});

test('der Entwickler steht in der Kopfzeile, auch ohne Fassungsangabe', (t) => {
  const r = openRenderer('control', t);
  assert.equal(r.text('app-credit'), 'Programmiert von Joscha Fresmann');
  assert.equal(r.text('app-version'), '', 'Vorbedingung: ohne Fassungsangabe');
});
