import * as dgram from 'dgram';
import * as net from 'net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'os';
import { randomUUID } from 'crypto';
import * as tls from 'tls';
import type { Duplex } from 'stream';

// --------------------------------------------------------------------
// Verwaltungsprotokoll des NovaStar-Taurus-Players (TB50)
// --------------------------------------------------------------------
//
// Nachgebaut nach `@novastar/taurus` aus https://github.com/sarakusha/novastar
// (Copyright (c) Andrei Sarakeev, MIT-Lizenz, Wortlaut in
// `THIRD-PARTY-NOTICES.md`). Übernommen ist nur ein Ausschnitt:
// Suche, Anmeldung, Helligkeit, Bildquelle und Größe der Wand.
//
// Bewusst NICHT übernommen sind Bildschirm-Topologie, Firmware und
// Kalibrierung der Empfangskarten. Die können die Konfiguration der
// LED-Wand ersetzen -- was hier nicht steht, kann auch kein Fehlklick und
// kein Programmfehler auslösen.
//
// Aufbau eines Pakets (24 Byte Kopf, Little Endian, danach JSON):
//    0  u32  Kennung 0x4e4f5641 ("AVON")
//    4  u32  laufende Nummer (Antwort trägt dieselbe)
//    8  u16  Pakettyp: Anfrage, Antwort oder Suche
//   10  u16  Befehlsgruppe ("what")
//   12       Anfrage: u8 action, u8 type, u16 frei
//            Antwort: u16 status, u8 action, u8 type
//   16  u32  Länge des Inhalts
//   20  u8   Kodierung, 21 frei
//   22  u16  Prüfsumme: Summe der vorangehenden Bytes als VORZEICHENBEHAFTETE
//            8-Bit-Werte

export const TAURUS_DISCOVERY_PORT = 16601;
export const TAURUS_MANAGEMENT_PORT = 16606;

const PACKET_FLAG = 0x4e4f5641;
const TYPE_REQUEST = 0x5251;
const TYPE_RESPONSE = 0x5250;
const TYPE_DISCOVERY = 0x8855;
export const TAURUS_HEADER_SIZE = 24;
const CHECKSUM_OFFSET = 22;

/** Größter angenommener Inhalt. Die Antworten sind kleine JSON-Texte. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface TaurusCommand {
  what: number;
  type: number;
  action: number;
}

export interface TaurusPacket {
  sequence: number;
  packetType: number;
  what: number;
  /** nur in Antworten aussagekräftig; 0 heißt Erfolg */
  status: number;
  action: number;
  type: number;
  body: Buffer;
}

export function taurusChecksum(header: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < CHECKSUM_OFFSET; i++) {
    const byte = header[i];
    sum += byte > 0x7f ? byte - 0x100 : byte;
  }
  return sum & 0xffff;
}

function encodePacket(
  sequence: number,
  packetType: number,
  { what, type, action }: TaurusCommand,
  body: Buffer
): Buffer {
  const packet = Buffer.alloc(TAURUS_HEADER_SIZE + body.length);
  packet.writeUInt32LE(PACKET_FLAG, 0);
  packet.writeUInt32LE(sequence >>> 0, 4);
  packet.writeUInt16LE(packetType, 8);
  packet.writeUInt16LE(what, 10);
  packet.writeUInt8(action, 12);
  packet.writeUInt8(type, 13);
  packet.writeUInt32LE(body.length, 16);
  packet.writeUInt16LE(taurusChecksum(packet), CHECKSUM_OFFSET);
  body.copy(packet, TAURUS_HEADER_SIZE);
  return packet;
}

export function encodeTaurusRequest(sequence: number, command: TaurusCommand, body = ''): Buffer {
  return encodePacket(sequence, TYPE_REQUEST, command, Buffer.from(body, 'utf8'));
}

/** Suchanfrage an UDP 16601. `action: 1` meldet, dass wir TLS können. */
export function encodeTaurusDiscoveryRequest(): Buffer {
  return encodePacket(0xffffffff, TYPE_DISCOVERY, { what: 0x81, type: 0, action: 1 }, Buffer.alloc(0));
}

/** Gesamtlänge des Pakets, sobald der Kopf vollständig da ist. */
export function taurusPacketSize(buffer: Buffer): number | undefined {
  if (buffer.length < TAURUS_HEADER_SIZE) return undefined;
  if (buffer.readUInt32LE(0) !== PACKET_FLAG) throw new Error('Ungültige Taurus-Kennung');
  const length = buffer.readUInt32LE(16);
  if (length > MAX_BODY_BYTES) throw new Error('Taurus-Paket zu groß');
  return TAURUS_HEADER_SIZE + length;
}

export function decodeTaurusPacket(buffer: Buffer): TaurusPacket {
  const size = taurusPacketSize(buffer);
  if (size === undefined || buffer.length < size) throw new Error('Unvollständiges Taurus-Paket');
  if (buffer.readUInt16LE(CHECKSUM_OFFSET) !== taurusChecksum(buffer)) {
    throw new Error('Taurus-Prüfsumme stimmt nicht');
  }
  const packetType = buffer.readUInt16LE(8);
  const response = packetType === TYPE_RESPONSE;
  return {
    sequence: buffer.readUInt32LE(4),
    packetType,
    what: buffer.readUInt16LE(10),
    status: response ? buffer.readUInt16LE(12) : 0,
    action: buffer.readUInt8(response ? 14 : 12),
    type: buffer.readUInt8(response ? 15 : 13),
    body: Buffer.from(buffer.subarray(TAURUS_HEADER_SIZE, size)),
  };
}

/** Nur für die Tests und die Attrappe des Geräts: baut eine Antwort. */
export function encodeTaurusResponse(sequence: number, command: TaurusCommand, status: number, body: string): Buffer {
  const packet = encodePacket(sequence, TYPE_RESPONSE, { what: command.what, type: 0, action: 0 }, Buffer.from(body, 'utf8'));
  packet.writeUInt16LE(status, 12);
  packet.writeUInt8(command.action, 14);
  packet.writeUInt8(command.type, 15);
  packet.writeUInt16LE(taurusChecksum(packet), CHECKSUM_OFFSET);
  return packet;
}

/** Nur für die Tests und die Attrappe des Geräts: baut eine Suchantwort. */
export function encodeTaurusDiscoveryResponse(info: object): Buffer {
  return encodePacket(0xffffffff, TYPE_DISCOVERY, { what: 1, type: 0, action: 0 }, Buffer.from(JSON.stringify(info), 'utf8'));
}

// --------------------------------------------------------------------
// Suche im Netz
// --------------------------------------------------------------------

/** Was ein Player auf die Suche antwortet (Auszug). */
export interface TaurusPlayerInfo {
  address: string;
  sn: string;
  tcpPort: number;
  /** true: Verwaltungsverbindung über TLS */
  privacy: boolean;
  aliasName: string;
  productName: string;
  width?: number;
  height?: number;
}

export function parseTaurusDiscoveryResponse(message: Buffer, address: string): TaurusPlayerInfo | undefined {
  try {
    const packet = decodeTaurusPacket(message);
    if (packet.packetType !== TYPE_DISCOVERY || packet.what !== 1) return undefined;
    const value = JSON.parse(packet.body.toString('utf8')) as Record<string, unknown>;
    if (typeof value.sn !== 'string' || !value.sn || typeof value.tcpPort !== 'number') return undefined;
    return {
      address,
      sn: value.sn,
      tcpPort: value.tcpPort,
      privacy: value.privacy !== false,
      aliasName: typeof value.aliasName === 'string' ? value.aliasName : '',
      productName: typeof value.productName === 'string' ? value.productName : '',
      width: typeof value.width === 'number' ? value.width : undefined,
      height: typeof value.height === 'number' ? value.height : undefined,
    };
  } catch {
    // Fremde Datagramme -- etwa die alte NovaStar-Suche "rpProMI:" -- sind
    // kein Fehler, nur nicht für uns.
    return undefined;
  }
}

function ipv4ToUint32(address: string): number {
  return address.split('.').reduce((result, octet) => (result << 8) | Number(octet), 0) >>> 0;
}

function broadcastAddress(address: string, netmask: string): string {
  const value = (ipv4ToUint32(address) | ~ipv4ToUint32(netmask)) >>> 0;
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.');
}

function searchFrom(
  info: NetworkInterfaceInfo,
  timeoutMs: number,
  destination: string | undefined,
  port: number
): Promise<TaurusPlayerInfo[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const found = new Map<string, TaurusPlayerInfo>();
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch {
        // schon zu
      }
      resolve([...found.values()]);
    };
    socket.once('error', finish);
    socket.on('message', (message, remote) => {
      const player = parseTaurusDiscoveryResponse(message, remote.address);
      if (player) found.set(player.sn, player);
    });
    socket.bind(0, info.address, () => {
      socket.setBroadcast(true);
      const target = destination ?? broadcastAddress(info.address, info.netmask);
      socket.send(encodeTaurusDiscoveryRequest(), port, target, (error) => {
        if (error) finish();
      });
      setTimeout(finish, timeoutMs).unref();
    });
  });
}

/**
 * Sucht Taurus-Player über alle Netzwerkkarten. Ohne `destination` per
 * Rundruf ins jeweilige Netz, mit einer festen Adresse nur dorthin -- für
 * den Fall, dass ein Router den Rundruf nicht durchlässt.
 */
export async function discoverTaurusPlayers(
  destination?: string,
  timeoutMs = 1000,
  port = TAURUS_DISCOVERY_PORT
): Promise<TaurusPlayerInfo[]> {
  // Rundruf: einmal je Netzwerkkarte, jeweils an deren Broadcast-Adresse.
  // Feste Adresse: ein einziger Versuch, den Weg wählt das Betriebssystem.
  const sources: NetworkInterfaceInfo[] = destination
    ? [{ address: '0.0.0.0', netmask: '0.0.0.0', family: 'IPv4', mac: '', internal: false, cidr: null }]
    : Object.values(networkInterfaces())
        .flat()
        .filter((info): info is NetworkInterfaceInfo => Boolean(info && !info.internal && info.family === 'IPv4'));
  const results = await Promise.all(sources.map((info) => searchFrom(info, timeoutMs, destination, port)));
  const bySn = new Map<string, TaurusPlayerInfo>();
  for (const player of results.flat()) bySn.set(player.sn, player);
  return [...bySn.values()];
}

// --------------------------------------------------------------------
// Verbindung
// --------------------------------------------------------------------

export class TaurusResponseError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`Tafel meldet Fehler 0x${status.toString(16)}${body ? `: ${body}` : ''}`);
    this.name = 'TaurusResponseError';
  }
}

interface Pending {
  resolve: (packet: TaurusPacket) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Anfragen und Antworten über einen Datenstrom. Antworten werden über die
 * laufende Nummer zugeordnet; TCP darf ein Paket beliebig zerstückeln
 * oder mehrere in einem Stück liefern.
 */
export class TaurusConnection {
  private readonly pending = new Map<number, Pending>();
  private buffer: Buffer = Buffer.alloc(0);
  private sequence = 0;
  private closedFlag = false;
  private readonly closeListeners: Array<(error: Error) => void> = [];

  constructor(private readonly stream: Duplex, private readonly timeoutMs = 5000) {
    stream.on('data', (chunk: Buffer | string) => this.onData(Buffer.from(chunk)));
    stream.once('close', () => this.shutdown(new Error('Verbindung zur Tafel getrennt')));
    stream.once('error', (error: Error) => this.shutdown(error));
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  onClose(listener: (error: Error) => void): void {
    this.closeListeners.push(listener);
  }

  request(command: TaurusCommand, body?: unknown): Promise<unknown> {
    if (this.closedFlag) return Promise.reject(new Error('Verbindung zur Tafel ist geschlossen'));
    this.sequence = (this.sequence + 1) >>> 0;
    const sequence = this.sequence;
    const packet = encodeTaurusRequest(sequence, command, body === undefined ? '' : JSON.stringify(body));
    return new Promise<TaurusPacket>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sequence);
        reject(new Error('Tafel antwortet nicht'));
      }, this.timeoutMs);
      this.pending.set(sequence, { resolve, reject, timer });
      this.stream.write(packet, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(sequence);
        reject(error);
      });
    }).then((response) => {
      const text = response.body.toString('utf8');
      if (response.status !== 0) throw new TaurusResponseError(response.status, text);
      return text ? (JSON.parse(text) as unknown) : undefined;
    });
  }

  close(): void {
    if (!this.stream.destroyed) this.stream.destroy();
    this.shutdown(new Error('Verbindung zur Tafel geschlossen'));
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= TAURUS_HEADER_SIZE) {
      let size: number | undefined;
      try {
        size = taurusPacketSize(this.buffer);
      } catch (error) {
        // Aus dem Takt geraten -- ohne Kennung lässt sich der Anfang des
        // nächsten Pakets nicht wiederfinden.
        this.stream.destroy();
        this.shutdown(error as Error);
        return;
      }
      if (size === undefined || this.buffer.length < size) return;
      const raw = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      let packet: TaurusPacket;
      try {
        packet = decodeTaurusPacket(raw);
      } catch {
        continue;
      }
      if (packet.packetType !== TYPE_RESPONSE) continue;
      const waiting = this.pending.get(packet.sequence);
      if (!waiting) continue;
      clearTimeout(waiting.timer);
      this.pending.delete(packet.sequence);
      waiting.resolve(packet);
    }
  }

  private shutdown(error: Error): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
    for (const listener of this.closeListeners) listener(error);
  }
}

// --------------------------------------------------------------------
// Befehle
// --------------------------------------------------------------------

const CMD = {
  login: { what: 0x00, type: 0, action: 0 },
  getBrightness: { what: 0x18, type: 1, action: 5 },
  setBrightness: { what: 0x18, type: 1, action: 4 },
  getAmbient: { what: 0x1a, type: 0, action: 5 },
  getLedScreen: { what: 0x1b, type: 1, action: 5 },
  getVideoConfiguration: { what: 0x27, type: 1, action: 5 },
  setVideoConfiguration: { what: 0x27, type: 1, action: 4 },
  getVideoSources: { what: 0x27, type: 8, action: 5 },
} as const;

/** Bildquelle der Tafel: interner Player (ViPlex-Inhalte) oder HDMI. */
export type TaurusSource = 'internal' | 'hdmi';

export interface TaurusVideoState {
  /** was die Tafel gerade zeigt */
  source: TaurusSource | null;
  /** ob am HDMI-Eingang ein Signal anliegt; null, wenn unbekannt */
  hdmiSignal: boolean | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sourceOf(value: unknown): TaurusSource | null {
  if (value === 0) return 'internal';
  if (value === 1) return 'hdmi';
  return null;
}

export interface TaurusConnectOptions {
  host: string;
  port?: number;
  privacy?: boolean;
  timeoutMs?: number;
}

/**
 * Der Ausschnitt des Taurus-Clients, den die App braucht. Jede Methode
 * entspricht einem Aufruf von `@novastar/taurus`, gleiche Befehlscodes und
 * gleicher Inhalt.
 */
export class TaurusClient {
  private constructor(readonly connection: TaurusConnection) {}

  static async connect({ host, port = TAURUS_MANAGEMENT_PORT, privacy = true, timeoutMs = 5000 }: TaurusConnectOptions): Promise<TaurusClient> {
    const socket = privacy
      ? // Die Geräte haben selbst ausgestellte Zertifikate -- eine Prüfung
        // schlüge immer fehl. Die Verbindung bleibt im WLAN der Tafel.
        tls.connect({ host, port, rejectUnauthorized: false })
      : net.connect({ host, port });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Tafel nimmt keine Verbindung an'));
      }, timeoutMs);
      socket.once(privacy ? 'secureConnect' : 'connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return new TaurusClient(new TaurusConnection(socket, timeoutMs));
  }

  onClose(listener: (error: Error) => void): void {
    this.connection.onClose(listener);
  }

  /** true bei Erfolg. Das Passwort steht nirgends sonst als hier. */
  async login(sn: string, username: string, password: string): Promise<boolean> {
    const result = asRecord(
      await this.connection.request(CMD.login, {
        sn,
        username,
        password,
        loginType: 0,
        source: { type: 1, platform: 2, platformVersion: '3.6.0' },
        clientId: randomUUID(),
        clientName: 'Anzeigetafel',
      })
    );
    return result.logined === true;
  }

  /** Helligkeit in Prozent; `null`, wenn die Tafel keinen Wert nennt. */
  async getBrightness(): Promise<number | null> {
    const result = asRecord(await this.connection.request(CMD.getBrightness));
    return finiteNumber(result.ratio) ?? null;
  }

  /**
   * Setzt die Helligkeit in Prozent. `persist: false` hält den Wert nur
   * bis zum nächsten Neustart der Tafel -- dann gilt wieder, was dort
   * gespeichert ist. Die App setzt nie dauerhaft.
   */
  async setBrightness(percent: number, persist = false): Promise<void> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new RangeError('Helligkeit muss zwischen 0 und 100 liegen');
    }
    await this.connection.request(CMD.setBrightness, { ratio: percent, solidity: persist, orderId: -1 });
  }

  /** Wert des Lichtsensors; `null` ohne Sensor (-1000 laut Gerät). */
  async getAmbientLight(): Promise<number | null> {
    const value = finiteNumber(asRecord(await this.connection.request(CMD.getAmbient)).value);
    return value === undefined || value === -1000 ? null : value;
  }

  /** Größe der LED-Wand laut Empfangskarten, also die echte Pixelzahl. */
  async getLedScreenSize(): Promise<{ width: number; height: number } | null> {
    const screens = asRecord(await this.connection.request(CMD.getLedScreen)).screenAttributes;
    const first = Array.isArray(screens) ? asRecord(screens[0]) : {};
    const regions = Array.isArray(first.scanInfos) ? first.scanInfos.map(asRecord) : [];
    const boxes = regions
      .map((r) => ({ x: finiteNumber(r.x), y: finiteNumber(r.y), w: finiteNumber(r.width), h: finiteNumber(r.height) }))
      .filter((b): b is { x: number; y: number; w: number; h: number } =>
        b.x !== undefined && b.y !== undefined && b.w !== undefined && b.h !== undefined
      );
    if (boxes.length === 0) return null;
    const left = Math.min(...boxes.map((b) => b.x));
    const top = Math.min(...boxes.map((b) => b.y));
    return {
      width: Math.max(...boxes.map((b) => b.x + b.w)) - left,
      height: Math.max(...boxes.map((b) => b.y + b.h)) - top,
    };
  }

  /** Aktuelle Bildquelle und ob am HDMI-Eingang ein Signal anliegt. */
  async getVideoState(): Promise<TaurusVideoState> {
    const result = asRecord(await this.connection.request(CMD.getVideoSources));
    const list = Array.isArray(result.videoSourceList) ? result.videoSourceList.map(asRecord) : [];
    const hdmi = list.find((s) => s.isInternalSource === false);
    return {
      source: sourceOf(result.currentSource),
      hdmiSignal: hdmi ? hdmi.linkStatus === true : null,
    };
  }

  /**
   * Schaltet auf den HDMI-Eingang, also auf das Bild des Laptops.
   *
   * Mit Rückfall: Fehlt das HDMI-Signal, zeigt die Tafel ihren internen
   * Player, statt schwarz zu bleiben, und kehrt mit dem Signal zurück
   * (`videoMode: 0` in `@novastar/taurus`, „HdmiPreferred"). Alle übrigen
   * Einstellungen -- Skalierung, Versatz, Zeitpläne -- werden gelesen und
   * unverändert zurückgeschrieben.
   */
  async selectHdmi(): Promise<void> {
    const current = asRecord(await this.connection.request(CMD.getVideoConfiguration));
    const offsetX = finiteNumber(current.offsetX);
    const offsetY = finiteNumber(current.offsetY);
    if (offsetX === undefined || offsetY === undefined) throw new Error('Tafel liefert keine Videoeinstellungen');
    await this.connection.request(CMD.setVideoConfiguration, {
      enable: current.enable === true,
      isScale: current.isScale === true,
      offsetX,
      offsetY,
      videoMode: 0,
      videoSource: 1,
      conditions: Array.isArray(current.conditions) ? current.conditions : undefined,
      orderId: finiteNumber(current.orderId) ?? -1,
    });
  }

  close(): void {
    this.connection.close();
  }
}
