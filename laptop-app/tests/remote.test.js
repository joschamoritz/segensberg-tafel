/**
 * Fernsteuerung im WLAN (iPad, Variante A).
 *
 * Der Server läuft hier echt -- auf einem freien Port, mit echten
 * HTTP-Anfragen. Geprüft wird, was am Spielfeldrand schiefgehen könnte:
 * ein Zuschauer im Vereins-WLAN ohne PIN, ein Dateidialog, der am Laptop
 * aufginge, ein Knopf, der auf dem iPad stumm nichts tut.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { RemoteServer, REMOTE_DENIED, generatePin } = load('main/remoteServer');
const { IPC } = load('shared/types');
const { MatchStateStore } = load('main/state');

const RENDERER = path.join(__dirname, '..', 'dist', 'renderer');
const PIN = '123456';

/** Startet einen Server mit mitschreibenden Handlern; räumt nach dem Test ab. */
async function server(t, extra = {}) {
  const calls = [];
  const sendHandlers = new Map([
    [IPC.scoreIncrement, (_e, ...args) => calls.push(['score', ...args])],
    [IPC.teamPickLogo, () => calls.push(['dialog'])],
    [IPC.requestState, (e) => e.sender.send(IPC.stateUpdated, { antwort: true })],
  ]);
  const invokeHandlers = new Map([[IPC.appInfo, () => ({ version: '9.9.9' })]]);
  let wechsel = 0;
  const s = new RemoteServer({
    rendererRoot: RENDERER,
    sendHandlers,
    invokeHandlers,
    denied: REMOTE_DENIED,
    pin: PIN,
    onClientsChanged: () => wechsel++,
    ...extra,
  });
  const port = await s.start(0, '127.0.0.1');
  t.after(() => s.stop());
  return { s, port, calls, wechsel: () => wechsel };
}

function request(port, method, route, { pin, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: route,
        headers: {
          ...(pin ? { 'x-pin': pin } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Öffnet die Live-Verbindung und sammelt, was ankommt. */
function events(port, pin) {
  return new Promise((resolve, reject) => {
    const received = [];
    const req = http.get(
      { host: '127.0.0.1', port, path: `/api/events?pin=${pin}` },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) received.push(JSON.parse(line.slice(6)));
          }
        });
        resolve({ status: res.statusCode, received, close: () => req.destroy() });
      }
    );
    req.on('error', reject);
  });
}

const warten = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------
// Ausliefern der Seite
// --------------------------------------------------------------------

test('die Startadresse führt zur Steuerung', async (t) => {
  const { port } = await server(t);
  const res = await request(port, 'GET', '/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/control/');
});

test('die Steuerung kommt mit WLAN-Brücke und Tablet-Angaben', async (t) => {
  const { port } = await server(t);
  const res = await request(port, 'GET', '/control/');
  assert.equal(res.status, 200);
  // Die Brücke muss VOR dem Steuerungsskript stehen -- sonst fände es
  // keine window.api vor.
  assert.ok(res.body.indexOf('/remote.js') < res.body.indexOf('control.js'), 'Reihenfolge der Skripte');
  assert.ok(res.body.includes('name="viewport"'));
  assert.equal((await request(port, 'GET', '/remote.js')).status, 200);
  assert.equal((await request(port, 'GET', '/control/control.css')).status, 200);
  assert.equal((await request(port, 'GET', '/fonts/fonts.css')).status, 200);
});

test('aus dem Renderer-Ordner führt kein Weg heraus', async (t) => {
  const { port } = await server(t);
  for (const route of [
    '/control/%2e%2e/%2e%2e/main/main.js',
    '/fonts/..%2f..%2fmain%2fmain.js',
    '/control/../../package.json',
  ]) {
    const res = await request(port, 'GET', route);
    assert.notEqual(res.status, 200, route);
  }
});

// --------------------------------------------------------------------
// PIN
// --------------------------------------------------------------------

test('ohne richtige PIN gibt es weder Befehle noch Zustand', async (t) => {
  const { port, calls } = await server(t);
  assert.equal((await request(port, 'GET', '/api/check')).status, 401);
  assert.equal((await request(port, 'GET', '/api/check', { pin: '000000' })).status, 401);
  assert.equal((await request(port, 'GET', '/api/check', { pin: PIN })).status, 204);

  const ohne = await request(port, 'POST', '/api/send', {
    body: { channel: IPC.scoreIncrement, args: ['home', 1] },
  });
  assert.equal(ohne.status, 401);
  assert.deepEqual(calls, [], 'ohne PIN darf kein Tor zählen');

  const strom = await events(port, '000000');
  assert.equal(strom.status, 401);
  strom.close();
});

test('nach zehn Fehlversuchen ist die Adresse gesperrt -- auch mit richtiger PIN', async (t) => {
  const { port } = await server(t);
  for (let i = 0; i < 10; i++) await request(port, 'GET', '/api/check', { pin: String(i).padStart(6, '0') });
  assert.equal((await request(port, 'GET', '/api/check', { pin: PIN })).status, 429);
});

test('die PIN hat sechs Ziffern', () => {
  assert.match(generatePin(), /^\d{6}$/);
  assert.equal(generatePin(() => 0), '000000');
  assert.equal(generatePin(() => 0.999999), '999999');
});

// --------------------------------------------------------------------
// Befehle
// --------------------------------------------------------------------

test('ein Befehl erreicht denselben Handler wie am Laptop', async (t) => {
  const { port, calls } = await server(t);
  const res = await request(port, 'POST', '/api/send', {
    pin: PIN,
    body: { channel: IPC.scoreIncrement, args: ['home', 1] },
  });
  assert.equal(res.status, 204);
  assert.deepEqual(calls, [['score', 'home', 1]]);
});

test('Dateidialoge und das Abschalten gehen nur am Laptop', async (t) => {
  const { port, calls } = await server(t);
  const res = await request(port, 'POST', '/api/send', {
    pin: PIN,
    body: { channel: IPC.teamPickLogo, args: ['home'] },
  });
  assert.equal(res.status, 403);
  assert.deepEqual(calls, [], 'der Dialog ginge am Laptop auf, ohne dass es jemand sieht');

  for (const channel of [
    IPC.teamPickLogo,
    IPC.playerPickPhoto,
    IPC.libraryChooseFolder,
    IPC.squadPickFile,
    IPC.remoteSetEnabled,
    IPC.soundRead,
  ]) {
    assert.ok(REMOTE_DENIED.has(channel), `${channel} fehlt in der Sperrliste`);
  }
  assert.ok(!REMOTE_DENIED.has(IPC.scoreIncrement), 'Spielbetrieb muss erlaubt sein');
});

test('unbekannte Kanäle und kaputte Anfragen werden abgewiesen', async (t) => {
  const { port } = await server(t);
  const unbekannt = await request(port, 'POST', '/api/send', {
    pin: PIN,
    body: { channel: 'gibt:es-nicht', args: [] },
  });
  assert.equal(unbekannt.status, 404);
});

test('eine Abfrage liefert das Ergebnis des Handlers', async (t) => {
  const { port } = await server(t);
  const res = await request(port, 'POST', '/api/invoke', {
    pin: PIN,
    body: { channel: IPC.appInfo, args: [] },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { result: { version: '9.9.9' } });
});

// --------------------------------------------------------------------
// Live-Verbindung
// --------------------------------------------------------------------

test('der Zustand kommt über die Live-Verbindung an', async (t) => {
  const { s, port, wechsel } = await server(t);
  const strom = await events(port, PIN);
  t.after(() => strom.close());
  assert.equal(strom.status, 200);
  await warten(20);
  assert.equal(s.clientCount, 1);
  assert.ok(wechsel() >= 1, 'das Steuerungsfenster soll die Zahl der Geräte erfahren');

  s.broadcast(IPC.clockTick, { elapsedMs: 1000, running: true });
  // Eine Antwort auf "schick mir den Zustand" geht ebenfalls über die Verbindung.
  await request(port, 'POST', '/api/send', { pin: PIN, body: { channel: IPC.requestState, args: [] } });
  await warten(50);

  assert.deepEqual(strom.received, [
    { channel: IPC.clockTick, args: [{ elapsedMs: 1000, running: true }] },
    { channel: IPC.stateUpdated, args: [{ antwort: true }] },
  ]);
});

// --------------------------------------------------------------------
// Jeder Knopf auch auf dem iPad
// --------------------------------------------------------------------

test('für jeden Kanal der Brücke gibt es einen Handler im Hauptprozess', () => {
  // Fehlt einer, tut der Knopf auf dem iPad stumm nichts -- und am Laptop
  // ebenso. Beide gehen über onIpc()/handleIpc().
  const src = (datei) => fs.readFileSync(path.join(__dirname, '..', 'src', datei), 'utf8');
  const bridge = src('shared/bridge.ts');
  const main = src('main/main.ts');

  // \s* -- längere Aufrufe stehen über mehrere Zeilen.
  const gesendet = [...bridge.matchAll(/t\.(?:send|invoke)\(\s*IPC\.(\w+)/g)].map((m) => m[1]);
  const registriert = new Set([...main.matchAll(/(?:onIpc|handleIpc)\(\s*IPC\.(\w+)/g)].map((m) => m[1]));
  assert.ok(gesendet.length > 50, 'die Brücke wurde nicht gelesen');
  assert.ok(!/ipcMain\.(on|handle)\(/.test(main.replace(/function (onIpc|handleIpc)[\s\S]*?\n}\n/g, '')),
    'ein Handler an onIpc()/handleIpc() vorbei wäre auf dem iPad nicht erreichbar');
  for (const kanal of gesendet) {
    assert.ok(registriert.has(kanal), `IPC.${kanal} hat keinen Handler`);
  }
});

// --------------------------------------------------------------------
// Steuerung im iPad-Modus
// --------------------------------------------------------------------

function mitTormusik() {
  const store = new MatchStateStore();
  store.setMedia({
    werbung: { rootPath: 'W', files: [] },
    highlights: { rootPath: 'H', files: [] },
    wettbewerbe: { rootPath: 'W', files: [] },
    sounds: { rootPath: 'S', files: ['tor.mp3'] },
  });
  return store;
}

test('control: auf dem iPad startet die Tormusik am Laptop', (t) => {
  const r = openRenderer('control', t);
  r.document.body.classList.add('is-remote');
  r.emit('onStateUpdated', mitTormusik().getState());

  const namen = (calls) => calls.map((c) => c.name);
  const gesendet = r.click('sound-play-quick');
  assert.deepEqual(JSON.parse(JSON.stringify(gesendet.filter((c) => c.name === 'soundCommand').map((c) => c.args))), [['play']]);
  assert.deepEqual(namen(r.click('sound-stop')).filter((n) => n === 'soundCommand'), ['soundCommand']);
  assert.ok(!r.calls.some((c) => c.name === 'readGoalSound'), 'die Datei gehört nicht aufs iPad');
  assert.deepEqual(r.drainErrors(), []);
});

test('control: Adresse, PIN und Geräte stehen in der Einrichtung', (t) => {
  const r = openRenderer('control', t);
  r.emit('onStatusUpdated', {
    displays: [],
    selectedDisplayId: null,
    previewMode: true,
    displayOpen: true,
    remote: { enabled: true, urls: ['http://192.168.178.23:8028'], pin: '482913', clients: 2, error: '' },
  });
  assert.equal(r.document.getElementById('remote-enabled').checked, true);
  assert.equal(r.document.getElementById('remote-details').hidden, false);
  assert.equal(r.text('remote-urls'), 'http://192.168.178.23:8028');
  assert.equal(r.text('remote-pin'), '482913');
  assert.equal(r.text('remote-clients'), '2 Geräte verbunden');

  const aus = r.click('remote-enabled');
  assert.deepEqual(JSON.parse(JSON.stringify(aus.filter((c) => c.name === 'remoteSetEnabled').map((c) => c.args))), [[false]]);
  assert.deepEqual(r.drainErrors(), []);
});
