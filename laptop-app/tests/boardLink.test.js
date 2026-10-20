/**
 * Verbindung zum TB50 (main/taurus.ts, main/boardLink.ts).
 *
 * Ein Gerät gibt es noch nicht. Geprüft wird deshalb in drei Schichten:
 * - das Protokoll gegen Bytefolgen, die `@novastar/taurus` an einem echten
 *   Taurus mitgeschnitten hat -- weicht unser Nachbau ab, fällt es hier auf
 *   und nicht erst am Platz;
 * - der Client über echtes TCP/UDP gegen eine Attrappe des Geräts auf dem
 *   eigenen Rechner, inklusive zerstückelter Pakete;
 * - der Zustandsautomat mit von Hand vorgespulten Zeitschaltern.
 */
const dgram = require('dgram');
const net = require('net');
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const taurus = load('main/taurus');
const { BoardLink, BOARD_TIMING } = load('main/boardLink');
const { parseBoardLinkConfig, DEFAULT_BOARD_LINK_CONFIG } = load('main/boardLinkControl');
const { sanitizeBoardHost, sanitizeBoardCredential, sanitizeBoardBrightness } = load('main/validate');
const { REMOTE_DENIED } = load('main/remoteServer');
const { IPC } = load('shared/types');

const json = (value) => JSON.parse(JSON.stringify(value));

// --------------------------------------------------------------------
// Protokoll
// --------------------------------------------------------------------

test('Suchanfrage stimmt Byte für Byte mit dem Mitschnitt überein', () => {
  assert.equal(
    taurus.encodeTaurusDiscoveryRequest().toString('hex'),
    '41564f4effffffff55888100010000000000000000008f00'
  );
});

test('Anfrage an den Lichtsensor stimmt Byte für Byte mit dem Mitschnitt überein', () => {
  assert.equal(
    taurus.encodeTaurusRequest(1, { what: 0x1a, type: 0, action: 5 }).toString('hex'),
    '41564f4e0100000051521a0005000000000000000000f701'
  );
});

test('Antwort wird gelesen, Status und Befehl stehen an der richtigen Stelle', () => {
  // Aufbau wie im Test von @novastar/taurus, von Hand statt mit unserem Kodierer.
  const body = Buffer.from('{"value":180}');
  const packet = Buffer.alloc(24 + body.length);
  packet.writeUInt32LE(0x4e4f5641, 0);
  packet.writeUInt32LE(7, 4);
  packet.writeUInt16LE(0x5250, 8);
  packet.writeUInt16LE(0x1a, 10);
  packet.writeUInt32LE(5 << 16, 12);
  packet.writeUInt32LE(body.length, 16);
  packet.writeUInt16LE(taurus.taurusChecksum(packet), 22);
  body.copy(packet, 24);

  const decoded = taurus.decodeTaurusPacket(packet);
  assert.equal(decoded.sequence, 7);
  assert.equal(decoded.what, 0x1a);
  assert.equal(decoded.status, 0);
  assert.equal(decoded.action, 5);
  assert.equal(decoded.body.toString(), '{"value":180}');
});

test('falsche Prüfsumme wird abgewiesen', () => {
  const packet = taurus.encodeTaurusRequest(1, { what: 0x1a, type: 0, action: 5 });
  packet[22] ^= 0xff;
  assert.throws(() => taurus.decodeTaurusPacket(packet), /Prüfsumme/);
});

test('Suchantwort eines echten Players wird gelesen, Fremdes ignoriert', () => {
  // Antwort eines Taurus T60, wie sie in den Tests von @novastar/taurus steht.
  const info = {
    aliasName: 'T60_00005306',
    encodeType: 0,
    height: 768,
    modelId: 38429,
    platform: 'rk356x',
    privacy: true,
    productName: 'T60',
    rotation: 0,
    sn: '26721A000005306',
    tcpPort: 16606,
    width: 756,
  };
  const player = taurus.parseTaurusDiscoveryResponse(taurus.encodeTaurusDiscoveryResponse(info), '192.168.41.1');
  assert.deepEqual(json(player), {
    address: '192.168.41.1',
    sn: '26721A000005306',
    tcpPort: 16606,
    privacy: true,
    aliasName: 'T60_00005306',
    productName: 'T60',
    width: 756,
    height: 768,
  });
  assert.equal(taurus.parseTaurusDiscoveryResponse(Buffer.from('rpProMI:'), '1.2.3.4'), undefined);
  assert.equal(
    taurus.parseTaurusDiscoveryResponse(taurus.encodeTaurusDiscoveryResponse({ tcpPort: 16606 }), '1.2.3.4'),
    undefined,
    'ohne Seriennummer keine Anmeldung möglich'
  );
});

// --------------------------------------------------------------------
// Attrappe des Geräts über echtes TCP und UDP
// --------------------------------------------------------------------

/**
 * Spielt einen Taurus nach: beantwortet die Suche per UDP und die
 * Verwaltungsbefehle per TCP (ohne TLS). Antworten gehen absichtlich
 * byteweise raus -- TCP darf so zerstückeln, und genau das muss der
 * Client vertragen.
 */
async function fakeTaurus(t, { password = '1234', usernames = ['admin'] } = {}) {
  const device = {
    brightness: 60,
    videoConfig: {
      enable: true,
      isScale: true,
      offsetX: 0,
      offsetY: 0,
      videoMode: 1,
      videoSource: 0,
      conditions: [{ id: 'zeitplan-aus-viplex' }],
      orderId: 3,
    },
    received: [],
  };
  const handlers = {
    '0:0:0': (body) => ({ logined: usernames.includes(body.username) && body.password === password }),
    '24:1:5': () => ({ brightness: 153, ratio: device.brightness, solidity: false, orderId: -1 }),
    '24:1:4': (body) => {
      device.brightness = body.ratio;
      return {};
    },
    '26:0:5': () => ({ value: 180 }),
    '27:1:5': () => ({
      screenAttributes: [
        {
          scanInfos: [
            { x: 0, y: 0, width: 192, height: 192 },
            { x: 192, y: 0, width: 192, height: 192 },
          ],
        },
      ],
    }),
    '39:1:5': () => device.videoConfig,
    '39:1:4': (body) => {
      device.videoConfig = body;
      return {};
    },
    '39:8:5': () => ({
      currentSource: device.videoConfig.videoSource,
      videoSourceList: [
        { sourceNum: 0, isInternalSource: true, linkStatus: true },
        { sourceNum: 1, isInternalSource: false, linkStatus: true },
      ],
    }),
  };

  const tcp = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const size = taurus.taurusPacketSize(buffer);
        if (size === undefined || buffer.length < size) return;
        const packet = taurus.decodeTaurusPacket(buffer.subarray(0, size));
        buffer = buffer.subarray(size);
        const key = `${packet.what}:${packet.type}:${packet.action}`;
        const body = packet.body.length ? JSON.parse(packet.body.toString()) : undefined;
        device.received.push({ key, body });
        const handler = handlers[key];
        const reply = handler
          ? taurus.encodeTaurusResponse(packet.sequence, packet, 0, JSON.stringify(handler(body)))
          : taurus.encodeTaurusResponse(packet.sequence, packet, 0x404, 'unbekannt');
        for (const byte of reply) socket.write(Buffer.from([byte]));
      }
    });
  });
  await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  const tcpPort = tcp.address().port;

  const udp = dgram.createSocket('udp4');
  udp.on('message', (message, remote) => {
    if (message.toString('hex') !== taurus.encodeTaurusDiscoveryRequest().toString('hex')) return;
    const answer = taurus.encodeTaurusDiscoveryResponse({
      sn: 'TB50-TEST-0001',
      tcpPort,
      privacy: false,
      aliasName: 'Taurus-SVH',
      productName: 'TB50',
    });
    udp.send(answer, remote.port, remote.address);
  });
  await new Promise((resolve) => udp.bind(0, '127.0.0.1', resolve));
  const udpPort = udp.address().port;

  t.after(() => {
    tcp.close();
    udp.close();
  });
  return { device, tcpPort, udpPort };
}

test('Suche findet die Tafel unter einer festen Adresse', async (t) => {
  const { udpPort, tcpPort } = await fakeTaurus(t);
  const players = await taurus.discoverTaurusPlayers('127.0.0.1', 300, udpPort);
  assert.equal(players.length, 1);
  assert.equal(players[0].sn, 'TB50-TEST-0001');
  assert.equal(players[0].tcpPort, tcpPort);
  assert.equal(players[0].privacy, false);
});

test('Client: Anmeldung, Helligkeit, Größe und Bildquelle über TCP', async (t) => {
  const fake = await fakeTaurus(t);
  const client = await taurus.TaurusClient.connect({ host: '127.0.0.1', port: fake.tcpPort, privacy: false });
  t.after(() => client.close());

  assert.equal(await client.login('TB50-TEST-0001', 'admin', 'falsch'), false);
  assert.equal(await client.login('TB50-TEST-0001', 'admin', '1234'), true);
  assert.equal(await client.getBrightness(), 60, 'Prozentwert, nicht der Rohwert 153');
  await client.setBrightness(35);
  assert.equal(fake.device.brightness, 35);
  const gesetzt = fake.device.received.find((r) => r.key === '24:1:4');
  assert.deepEqual(gesetzt.body, { ratio: 35, solidity: false, orderId: -1 }, 'nie dauerhaft');
  assert.equal(await client.getAmbientLight(), 180);
  assert.deepEqual(json(await client.getLedScreenSize()), { width: 384, height: 192 });
  assert.deepEqual(json(await client.getVideoState()), { source: 'internal', hdmiSignal: true });

  await assert.rejects(() => client.setBrightness(101), /zwischen 0 und 100/);
});

test('Client: HDMI-Umschaltung ändert nur Modus und Quelle', async (t) => {
  const fake = await fakeTaurus(t);
  const client = await taurus.TaurusClient.connect({ host: '127.0.0.1', port: fake.tcpPort, privacy: false });
  t.after(() => client.close());
  await client.login('TB50-TEST-0001', 'admin', '1234');

  await client.selectHdmi();
  assert.deepEqual(fake.device.videoConfig, {
    enable: true,
    isScale: true,
    offsetX: 0,
    offsetY: 0,
    videoMode: 0,
    videoSource: 1,
    conditions: [{ id: 'zeitplan-aus-viplex' }],
    orderId: 3,
  });
  assert.equal((await client.getVideoState()).source, 'hdmi');
});

test('Client: eine Fehlermeldung der Tafel kommt als Fehler an', async (t) => {
  const fake = await fakeTaurus(t);
  const client = await taurus.TaurusClient.connect({ host: '127.0.0.1', port: fake.tcpPort, privacy: false });
  t.after(() => client.close());
  await assert.rejects(() => client.connection.request({ what: 0x55, type: 0, action: 5 }), /0x404/);
});

test('Verbindung: zwei Antworten in einem Stück werden beide zugeordnet', async () => {
  const { PassThrough } = require('stream');
  const stream = new PassThrough();
  const sent = [];
  stream.write = (chunk, callback) => {
    sent.push(chunk);
    if (callback) callback();
    return true;
  };
  const connection = new taurus.TaurusConnection(stream, 1000);
  const first = connection.request({ what: 0x18, type: 1, action: 5 });
  const second = connection.request({ what: 0x1a, type: 0, action: 5 });
  const a = taurus.encodeTaurusResponse(1, { what: 0x18, type: 1, action: 5 }, 0, '{"ratio":40}');
  const b = taurus.encodeTaurusResponse(2, { what: 0x1a, type: 0, action: 5 }, 0, '{"value":7}');
  stream.emit('data', Buffer.concat([b, a]));
  assert.deepEqual(json(await first), { ratio: 40 });
  assert.deepEqual(json(await second), { value: 7 });
  connection.close();
});

// --------------------------------------------------------------------
// Zustandsautomat
// --------------------------------------------------------------------

/** Zeitschalter zum Vorspulen und ein Client zum Mitschreiben. */
function harness({ players = [], loginFor = () => true, failBrightness = false } = {}) {
  const timers = [];
  const calls = [];
  let closeListener = null;
  let releaseBrightness = null;
  const env = {
    players,
    brightnessGate: false,
    client: {
      login: async (sn, user, pass) => {
        calls.push(['login', user, pass]);
        return loginFor(user, pass);
      },
      getBrightness: async () => {
        if (failBrightness) throw new Error('weg');
        return 55;
      },
      setBrightness: (value) => {
        calls.push(['setBrightness', value]);
        if (!env.brightnessGate) return Promise.resolve();
        return new Promise((resolve) => (releaseBrightness = resolve));
      },
      getAmbientLight: async () => {
        throw new Error('kein Sensor');
      },
      getLedScreenSize: async () => ({ width: 384, height: 224 }),
      getVideoState: async () => ({ source: 'hdmi', hdmiSignal: true }),
      selectHdmi: async () => calls.push(['selectHdmi']),
      onClose: (listener) => (closeListener = listener),
      close: () => calls.push(['close']),
    },
  };
  const deps = {
    discover: async (host) => {
      calls.push(['discover', host]);
      return env.players;
    },
    connect: async () => env.client,
    setTimeout: (callback, ms) => {
      const timer = { callback, ms, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      if (timer) timer.active = false;
    },
  };
  return {
    env,
    calls,
    deps,
    /** führt den nächsten fälligen Zeitschalter aus */
    tick() {
      const next = timers.find((timer) => timer.active);
      if (!next) throw new Error('kein Zeitschalter wartet');
      next.active = false;
      next.callback();
      return next.ms;
    },
    pending: () => timers.filter((timer) => timer.active).map((timer) => timer.ms),
    dropConnection: () => closeListener(new Error('Kabel gezogen')),
    releaseBrightness: () => releaseBrightness(),
  };
}

const PLAYER = { address: '192.168.41.1', sn: 'TB50-1', tcpPort: 16606, privacy: true, aliasName: 'Taurus-SVH', productName: 'TB50' };
const CONFIG = { enabled: true, username: 'Admin', password: '1234', host: '' };
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

test('Automat: ohne Tafel „nicht gefunden" und Wiederholung im Takt', async () => {
  const h = harness();
  const link = new BoardLink(CONFIG, h.deps);
  link.start();
  await settle();
  assert.equal(link.status().state, 'not-found');
  assert.deepEqual(h.pending(), [BOARD_TIMING.searchRetryMs]);

  h.env.players = [PLAYER];
  h.tick();
  await settle();
  assert.equal(link.status().state, 'connected');
  link.stop();
});

test('Automat: gefunden, angemeldet, Werte gelesen', async () => {
  const h = harness({ players: [PLAYER] });
  const link = new BoardLink(CONFIG, h.deps);
  link.start();
  await settle();
  const status = json(link.status());
  assert.equal(status.state, 'connected');
  assert.deepEqual(status.device, { name: 'Taurus-SVH', product: 'TB50', sn: 'TB50-1', address: '192.168.41.1' });
  assert.equal(status.brightness, 55);
  assert.equal(status.ambientLight, null, 'fehlender Sensor ist kein Fehler');
  assert.equal(status.source, 'hdmi');
  assert.deepEqual(status.ledSize, { width: 384, height: 224 });
  assert.ok(!JSON.stringify(status).includes('1234'), 'das Passwort steht nie im Status');
  assert.deepEqual(h.pending(), [BOARD_TIMING.pollMs], 'liest im Takt weiter');
  link.stop();
});

test('Automat: „Admin" laut Anleitung, „admin" als zweiter Versuch', async () => {
  const h = harness({ players: [PLAYER], loginFor: (user) => user === 'admin' });
  const link = new BoardLink(CONFIG, h.deps);
  link.start();
  await settle();
  assert.deepEqual(h.calls.filter((c) => c[0] === 'login'), [
    ['login', 'Admin', '1234'],
    ['login', 'admin', '1234'],
  ]);
  assert.equal(link.status().state, 'connected');
  link.stop();
});

test('Automat: falsches Passwort -- kein Dauerfeuer, neue Daten verbinden sofort', async () => {
  const h = harness({ players: [PLAYER], loginFor: (_u, pass) => pass === 'geheim' });
  const link = new BoardLink(CONFIG, h.deps);
  link.start();
  await settle();
  assert.equal(link.status().state, 'login-failed');
  assert.deepEqual(h.pending(), [BOARD_TIMING.loginRetryMs]);

  link.setConfig({ username: 'Admin', password: 'geheim', host: '' });
  await settle();
  assert.equal(link.status().state, 'connected');

  // Leeres Passwort heißt „unverändert".
  link.setConfig({ username: 'Admin', password: '', host: '192.168.41.1' });
  await settle();
  assert.equal(link.status().state, 'connected');
  assert.equal(link.getConfig().password, 'geheim');
  assert.deepEqual(h.calls.filter((c) => c[0] === 'discover').at(-1), ['discover', '192.168.41.1']);
  link.stop();
});

test('Automat: Abbruch der Verbindung führt zurück in die Suche', async () => {
  const h = harness({ players: [PLAYER] });
  const link = new BoardLink(CONFIG, h.deps);
  link.start();
  await settle();
  h.dropConnection();
  assert.equal(link.status().state, 'error');
  assert.match(link.status().message, /getrennt/);
  h.tick();
  await settle();
  assert.equal(link.status().state, 'connected');
  link.stop();
});

test('Automat: Abschalten verwirft eine laufende Suche', async () => {
  const h = harness({ players: [PLAYER] });
  let finishDiscover;
  h.deps.discover = () => new Promise((resolve) => (finishDiscover = resolve));
  const link = new BoardLink(CONFIG, h.deps);
  link.start();
  assert.equal(link.status().state, 'searching');
  link.setEnabled(false);
  finishDiscover([PLAYER]);
  await settle();
  assert.equal(link.status().state, 'off');
  assert.ok(!h.calls.some((c) => c[0] === 'login'), 'nach dem Abschalten keine Anmeldung mehr');
  assert.deepEqual(h.pending(), []);
});

test('Automat: beim Ziehen am Regler geht nur der jüngste Wert hinterher', async () => {
  const h = harness({ players: [PLAYER] });
  const link = new BoardLink(CONFIG, h.deps);
  link.start();
  await settle();
  h.env.brightnessGate = true;

  link.setBrightness(10);
  link.setBrightness(20);
  link.setBrightness(30);
  link.setBrightness(140);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'setBrightness'), [['setBrightness', 10]]);
  h.releaseBrightness();
  await settle();
  assert.deepEqual(
    h.calls.filter((c) => c[0] === 'setBrightness'),
    [['setBrightness', 10], ['setBrightness', 100]],
    'Zwischenwerte fallen weg, über 100 wird gekappt'
  );
  h.releaseBrightness();
  await settle();
  assert.equal(link.status().brightness, 100);
  link.stop();
});

test('Automat: ohne Verbindung wird keine Helligkeit gesendet', async () => {
  const h = harness();
  const link = new BoardLink(CONFIG, h.deps);
  link.start();
  await settle();
  link.setBrightness(50);
  await link.selectHdmi();
  assert.ok(!h.calls.some((c) => c[0] === 'setBrightness' || c[0] === 'selectHdmi'));
  link.stop();
});

test('Automat: ausgeschaltet sucht er gar nicht erst', async () => {
  const h = harness({ players: [PLAYER] });
  const link = new BoardLink({ ...CONFIG, enabled: false }, h.deps);
  link.start();
  await settle();
  assert.equal(link.status().state, 'off');
  assert.ok(!h.calls.some((c) => c[0] === 'discover'));
});

// --------------------------------------------------------------------
// Einstellung und Prüfschicht
// --------------------------------------------------------------------

test('Einstellung: Vorgabe laut goracon-Anleitung, Unbrauchbares fällt darauf zurück', () => {
  assert.deepEqual(json(DEFAULT_BOARD_LINK_CONFIG), { enabled: true, username: 'Admin', password: '1234', host: '' });
  assert.deepEqual(json(parseBoardLinkConfig(undefined)), json(DEFAULT_BOARD_LINK_CONFIG));
  assert.deepEqual(json(parseBoardLinkConfig({ enabled: false, username: '', password: 'x', host: 'kaputt' })), {
    enabled: false,
    username: 'Admin',
    password: 'x',
    host: '',
  });
});

test('Prüfschicht: Adresse, Zugangsdaten und Helligkeit', () => {
  assert.equal(sanitizeBoardHost(''), '');
  assert.equal(sanitizeBoardHost(' 192.168.041.1 '), '192.168.41.1');
  assert.equal(sanitizeBoardHost('192.168.41.256'), null);
  assert.equal(sanitizeBoardHost('tafel.local'), null);
  assert.equal(sanitizeBoardHost(42), null);
  assert.equal(sanitizeBoardCredential('Ad min\n'), 'Ad min');
  assert.equal(sanitizeBoardCredential('x'.repeat(100)).length, 64);
  assert.equal(sanitizeBoardBrightness(NaN), null);
  assert.equal(sanitizeBoardBrightness('50'), null);
  assert.equal(sanitizeBoardBrightness(-5), 0);
  assert.equal(sanitizeBoardBrightness(33.6), 34);
});

test('Fernsteuerung: Zugang und Abschalten nur am Laptop, Helligkeit auch vom iPad', () => {
  assert.ok(REMOTE_DENIED.has(IPC.boardLinkSetConfig));
  assert.ok(REMOTE_DENIED.has(IPC.boardLinkSetEnabled));
  assert.ok(!REMOTE_DENIED.has(IPC.boardSetBrightness));
  assert.ok(!REMOTE_DENIED.has(IPC.boardSelectHdmi));
});

// --------------------------------------------------------------------
// Steuerungsfenster
// --------------------------------------------------------------------

function appStatus(boardLink) {
  return {
    displays: [],
    selectedDisplayId: null,
    previewMode: true,
    displayOpen: true,
    remote: { enabled: false, urls: [], pin: '000000', clients: 0, error: '' },
    boardLink: {
      enabled: true,
      state: 'connected',
      device: { name: 'Taurus-SVH', product: 'TB50', sn: 'TB50-1', address: '192.168.41.1' },
      brightness: 70,
      ambientLight: 180,
      source: 'hdmi',
      hdmiSignal: true,
      ledSize: { width: 384, height: 192 },
      username: 'Admin',
      host: '',
      message: '',
      ...boardLink,
    },
    warnings: [],
  };
}

test('control: Kopfzeile zeigt die Tafel, Hinweis beim eigenen Programm', (t) => {
  const r = openRenderer('control', t);
  const pill = r.document.getElementById('board-link-pill');

  r.emit('onStatusUpdated', appStatus({ state: 'off', enabled: false }));
  assert.equal(pill.hidden, true, 'abgeschaltet: keine Anzeige');

  r.emit('onStatusUpdated', appStatus({}));
  assert.equal(pill.hidden, false);
  assert.equal(r.text('board-link-pill-text'), 'Tafel verbunden · 70 %');
  assert.equal(pill.dataset.tone, 'ok');

  r.emit('onStatusUpdated', appStatus({ source: 'internal' }));
  assert.equal(r.text('board-link-pill-text'), 'Tafel zeigt eigenes Programm');
  assert.equal(pill.dataset.tone, 'warn');
  assert.match(r.text('board-link-state'), /eigenes Programm statt des Laptop-Bilds/, 'Grund steht auch in der Einrichtung');
  assert.equal(r.document.getElementById('board-select-hdmi').disabled, false);

  r.emit('onStatusUpdated', appStatus({ hdmiSignal: false }));
  assert.equal(r.text('board-link-pill-text'), 'Tafel: kein HDMI-Signal');

  r.emit('onStatusUpdated', appStatus({ state: 'not-found', device: null }));
  assert.equal(r.text('board-link-pill-text'), 'Tafel: nicht gefunden');
  assert.equal(r.document.getElementById('board-brightness').disabled, true, 'ohne Verbindung kein Regler');
  assert.equal(r.document.getElementById('board-select-hdmi').disabled, true);
  assert.deepEqual(r.drainErrors(), []);
});

test('control: Druck auf die Tafel-Anzeige öffnet die Einrichtung', (t) => {
  const r = openRenderer('control', t);
  r.emit('onStatusUpdated', appStatus({}));
  r.click('board-link-pill');
  assert.equal(r.document.body.dataset.setup, 'anzeige');
  r.click('board-link-pill');
  assert.equal(r.document.body.dataset.setup, 'anzeige', 'öffnet nur, schließt nicht');
});

test('control: Regler, HDMI-Knopf, Größe und Zugang gehen an die Brücke', (t) => {
  const r = openRenderer('control', t);
  r.emit('onStatusUpdated', appStatus({ source: 'internal', ledSize: { width: 384, height: 224 } }));

  assert.equal(r.text('board-link-source'), 'interner Player (ViPlex-Programm)');
  assert.equal(r.text('board-link-led'), '384 × 224 px');
  assert.equal(r.document.getElementById('board-brightness').value, '70');

  const slider = r.document.getElementById('board-brightness');
  r.calls.length = 0;
  slider.value = '42';
  slider.dispatchEvent(new r.window.Event('input'));
  assert.deepEqual(json(r.calls.filter((c) => c.name === 'boardSetBrightness').map((c) => c.args)), [[42]]);
  assert.equal(r.text('board-brightness-value'), '42 %');

  assert.deepEqual(json(r.click('board-select-hdmi').map((c) => c.name)), ['boardSelectHdmi']);

  const size = r.document.getElementById('board-size-apply');
  assert.equal(size.hidden, false, 'Tafel meldet eine andere Größe als eingestellt');
  assert.deepEqual(
    json(r.click('board-size-apply').filter((c) => c.name === 'setBoardSize').map((c) => c.args)),
    [[{ width: 384, height: 224 }]]
  );

  r.document.getElementById('board-username').value = 'admin';
  r.document.getElementById('board-password').value = 'neu';
  r.document.getElementById('board-host').value = '192.168.41.1';
  assert.deepEqual(
    json(r.click('board-link-save').filter((c) => c.name === 'boardLinkSetConfig').map((c) => c.args)),
    [['admin', 'neu', '192.168.41.1']]
  );
  assert.equal(r.document.getElementById('board-password').value, '', 'Passwort bleibt nicht im Feld stehen');

  assert.deepEqual(
    json(r.click('board-link-enabled').filter((c) => c.name === 'boardLinkSetEnabled').map((c) => c.args)),
    [[false]]
  );
  assert.deepEqual(r.drainErrors(), []);
});

test('control: gleiche Größe wie eingestellt -- kein Übernehmen-Knopf', (t) => {
  const r = openRenderer('control', t);
  r.document.getElementById('board-width-input').value = '384';
  r.document.getElementById('board-height-input').value = '192';
  r.emit('onStatusUpdated', appStatus({}));
  assert.equal(r.document.getElementById('board-size-apply').hidden, true);
});
