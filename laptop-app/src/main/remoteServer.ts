import { createHash, randomInt } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { IPC } from '../shared/types';

/**
 * Fernsteuerung im WLAN.
 *
 * Der Laptop hängt per HDMI an der Tafel und stellt die Steuerung
 * zusätzlich im WLAN bereit: Ein iPad öffnet sie im Browser und bedient
 * die Tafel von dort (Variante A, Nutzerentscheidung 16.10.2026). Dafür
 * braucht es weder Internet noch eine App aus dem App Store.
 *
 * Bewusst ohne zusätzliche Bibliothek, nur mit Node-Bordmitteln:
 * - Befehle kommen als `POST /api/send` bzw. `/api/invoke` mit Kanal und
 *   Argumenten -- dieselben Kanäle wie über die Electron-Brücke. Der Server
 *   ruft dieselben Handler auf; es gibt keine zweite Logik für das iPad.
 * - Zustand und Uhr gehen per Server-Sent Events (`GET /api/events`) an
 *   die Geräte. Das ist eine einfache HTTP-Verbindung, die offen bleibt;
 *   Browser bauen sie nach einem Abriss selbst wieder auf.
 *
 * Das Format ist bewusst schlicht, damit auch ein Elgato Stream Deck es
 * später über ein Plugin für Web-Anfragen ansprechen kann.
 *
 * **Zugang nur mit PIN.** Im Vereins-WLAN sind auch Zuschauer. Ohne PIN
 * nimmt der Server keine Befehle an und liefert keinen Zustand aus; nach
 * zu vielen Fehlversuchen sperrt er die Adresse für eine Weile.
 */

/** Was ein Handler als `event` bekommt -- wie bei Electron, nur nachgebaut. */
export interface IpcLikeEvent {
  sender: { send(channel: string, ...args: unknown[]): void };
}

// Die Handler sind dieselben wie für ipcMain; dort sind die Argumente als
// `unknown` deklariert und werden in der Prüfschicht geprüft.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SendHandler = (event: IpcLikeEvent, ...args: any[]) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InvokeHandler = (event: IpcLikeEvent, ...args: any[]) => unknown;

export interface RemoteServerOptions {
  /** gebaute Renderer (`dist/renderer`) -- daraus kommt die Steuerung */
  rendererRoot: string;
  sendHandlers: ReadonlyMap<string, SendHandler>;
  invokeHandlers: ReadonlyMap<string, InvokeHandler>;
  /**
   * Kanäle, die nur am Laptop selbst erlaubt sind: alles, was dort ein
   * Dateifenster öffnet (das sähe auf dem iPad niemand), und das Ein- und
   * Ausschalten der Fernsteuerung selbst.
   */
  denied: ReadonlySet<string>;
  pin: string;
  /** wird gerufen, wenn ein Gerät dazukommt oder geht */
  onClientsChanged?: () => void;
}

/**
 * Nur am Laptop erlaubt. Die Dateidialoge gingen am Laptop auf, während
 * jemand am iPad auf eine Antwort wartet. Die Tormusik wird nicht als
 * Datei übertragen -- sie läuft am Laptop (`IPC.soundCommand`). Und die
 * Fernsteuerung soll sich nicht selbst abschalten oder eine neue PIN
 * vergeben können.
 */
export const REMOTE_DENIED: ReadonlySet<string> = new Set([
  IPC.teamPickLogo,
  IPC.playerPickPhoto,
  IPC.libraryChooseFolder,
  IPC.squadPickFile,
  IPC.soundRead,
  IPC.remoteSetEnabled,
  IPC.remoteNewPin,
]);

/** Größte angenommene Anfrage -- ein ganzer Kader passt locker hinein. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Fehlversuche je Adresse, bevor sie gesperrt wird, und wie lange. */
const MAX_FAILURES = 10;
const LOCKOUT_MS = 5 * 60 * 1000;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

/**
 * Wird vor dem Steuerungsskript eingesetzt: die WLAN-Brücke statt der
 * Electron-Brücke, dazu die Angaben, die ein Tablet für eine bedienbare
 * Seite braucht (Zoomstufe, Vollbild vom Homescreen).
 */
const HEAD_ADDITIONS = [
  '<meta name="viewport" content="width=device-width, initial-scale=1" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="Anzeigetafel" />',
].join('\n  ');

/**
 * Höchstzahl gemerkter Bilder. Kader beider Mannschaften samt Logos liegen
 * weit darunter; die Grenze fängt nur ab, dass über einen langen Spieltag
 * mit vielen Vereinswechseln der Speicher unbegrenzt wächst.
 */
const MAX_IMAGES = 300;

export class RemoteServer {
  private server: http.Server | null = null;
  /**
   * Bilder, die statt als Base64 im Zustand über eine eigene Adresse gehen.
   *
   * Der Zustand trägt alle Logos und Portraits als data:-URL. Gemessen
   * waren das schon ohne Portraits rund 330 KB, mit einem Kader voller
   * Portraits weit über 1 MB -- bei JEDER Änderung, an jedes Gerät. Bei
   * schwachem WLAN stand die neue Zahl am iPad erst spürbar später da, und
   * wer dann ein zweites Mal tippte, zählte zwei Tore (Review 2026-10, W9).
   * Jetzt steht im Zustand nur `/api/image/<hash>`, und das Gerät lädt
   * jedes Bild einmal.
   */
  private readonly images = new Map<string, { type: string; data: Buffer }>();
  private readonly imageIds = new Map<string, string>();
  private readonly clients = new Set<http.ServerResponse>();
  private readonly failures = new Map<string, { count: number; until: number }>();
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: RemoteServerOptions) {}

  get clientCount(): number {
    return this.clients.size;
  }

  get port(): number | null {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  /** Startet den Server; liefert den tatsächlichen Port (0 = beliebig, für Tests). */
  start(port: number, host = '0.0.0.0'): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
      });
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        this.server = server;
        // Kommentarzeilen halten die Verbindung offen -- manche Router
        // schließen eine stille Verbindung nach einer Minute.
        this.keepAlive = setInterval(() => {
          for (const client of this.clients) client.write(': ping\n\n');
        }, 20_000);
        resolve(this.port ?? port);
      });
    });
  }

  stop(): Promise<void> {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    for (const client of this.clients) client.end();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  /** Schickt eine Nachricht an alle verbundenen Geräte. */
  broadcast(channel: string, ...args: unknown[]): void {
    if (this.clients.size === 0) return;
    const data = `data: ${JSON.stringify({ channel, args: this.withImageUrls(args) })}\n\n`;
    for (const client of this.clients) client.write(data);
  }

  /**
   * Ersetzt jede data:-URL eines Bildes durch eine Adresse auf diesem
   * Server. Die PIN steht in der Adresse, weil ein `<img>` keine
   * Kopfzeile mitschicken kann -- die Nachricht geht ohnehin nur an Geräte,
   * die sich mit genau dieser PIN angemeldet haben.
   */
  withImageUrls(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.startsWith('data:image/') ? this.imageUrl(value) : value;
    }
    if (Array.isArray(value)) return value.map((entry) => this.withImageUrls(entry));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) out[key] = this.withImageUrls(entry);
      return out;
    }
    return value;
  }

  private imageUrl(dataUrl: string): string {
    let id = this.imageIds.get(dataUrl);
    if (!id) {
      const match = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(dataUrl);
      if (!match) return '';
      id = createHash('sha1').update(dataUrl).digest('hex');
      if (this.images.size >= MAX_IMAGES) {
        this.images.clear();
        this.imageIds.clear();
      }
      this.images.set(id, { type: match[1], data: Buffer.from(match[2], 'base64') });
      this.imageIds.set(dataUrl, id);
    }
    return `/api/image/${id}?pin=${encodeURIComponent(this.options.pin)}`;
  }

  // ------------------------------------------------------------------

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname;

    if (req.method === 'GET' && route === '/') {
      res.writeHead(302, { Location: '/control/' });
      res.end();
      return;
    }
    if (req.method === 'GET' && (route === '/control/' || route === '/control/index.html')) {
      this.serveControlPage(res);
      return;
    }
    if (req.method === 'GET' && route === '/remote.js') {
      this.serveFile(res, path.join(this.options.rendererRoot, 'remote', 'remote.js'));
      return;
    }
    if (req.method === 'GET' && (route.startsWith('/control/') || route.startsWith('/fonts/'))) {
      this.serveStatic(res, route);
      return;
    }

    // Ab hier nur mit PIN.
    const address = req.socket.remoteAddress ?? '';
    if (this.isLockedOut(address)) {
      res.writeHead(429);
      res.end();
      return;
    }
    const pin = req.headers['x-pin'] ?? url.searchParams.get('pin');
    if (pin !== this.options.pin) {
      this.recordFailure(address);
      res.writeHead(401);
      res.end();
      return;
    }
    this.failures.delete(address);

    if (req.method === 'GET' && route === '/api/check') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && route.startsWith('/api/image/')) {
      const image = this.images.get(route.slice('/api/image/'.length));
      if (!image) {
        res.writeHead(404);
        res.end();
        return;
      }
      // Die Adresse enthält den Hash des Inhalts und ändert sich mit dem
      // Bild -- das Gerät darf es also behalten.
      res.writeHead(200, {
        'Content-Type': image.type,
        'Cache-Control': 'private, max-age=86400, immutable',
      });
      res.end(image.data);
      return;
    }
    if (req.method === 'GET' && route === '/api/events') {
      this.openEventStream(req, res);
      return;
    }
    if (req.method === 'POST' && (route === '/api/send' || route === '/api/invoke')) {
      await this.handleCall(req, res, route === '/api/invoke');
      return;
    }

    res.writeHead(404);
    res.end();
  }

  private async handleCall(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    isInvoke: boolean
  ): Promise<void> {
    let body: { channel?: unknown; args?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    const channel = typeof body.channel === 'string' ? body.channel : '';
    const args = Array.isArray(body.args) ? body.args : [];
    if (this.options.denied.has(channel)) {
      res.writeHead(403);
      res.end();
      return;
    }

    const event = this.fakeEvent();
    if (isInvoke) {
      const handler = this.options.invokeHandlers.get(channel);
      if (!handler) {
        res.writeHead(404);
        res.end();
        return;
      }
      const result = await handler(event, ...args);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: result ?? null }));
      return;
    }

    const handler = this.options.sendHandlers.get(channel);
    if (!handler) {
      res.writeHead(404);
      res.end();
      return;
    }
    handler(event, ...args);
    res.writeHead(204);
    res.end();
  }

  /**
   * `event.sender.send()` beantwortet bei Electron eine Anfrage nur an das
   * anfragende Fenster ("schick mir den Zustand"). Hier geht die Antwort
   * an alle Geräte -- harmlos, es ist ohnehin derselbe Zustand, und der
   * Server muss sich so nicht merken, welche Anfrage zu welcher offenen
   * Verbindung gehört.
   */
  private fakeEvent(): IpcLikeEvent {
    return { sender: { send: (channel, ...args) => this.broadcast(channel, ...args) } };
  }

  private openEventStream(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': verbunden\n\n');
    this.clients.add(res);
    this.options.onClientsChanged?.();
    req.on('close', () => {
      this.clients.delete(res);
      this.options.onClientsChanged?.();
    });
  }

  private serveControlPage(res: http.ServerResponse): void {
    const file = path.join(this.options.rendererRoot, 'control', 'index.html');
    let html: string;
    try {
      html = fs.readFileSync(file, 'utf-8');
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    html = html
      .replace('</head>', `  ${HEAD_ADDITIONS}\n</head>`)
      .replace('<script src="control.js"></script>', '<script src="/remote.js"></script>\n  <script src="control.js"></script>');
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(html);
  }

  /**
   * Liefert eine Datei unter `/control/` oder `/fonts/`. Die Pfadprüfung
   * ist dieselbe Überlegung wie bei `svh-media:`: Kein Weg aus dem Ordner
   * der gebauten Renderer heraus.
   */
  private serveStatic(res: http.ServerResponse, route: string): void {
    const root = path.resolve(this.options.rendererRoot);
    const target = path.resolve(root, '.' + decodeURIComponent(route));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403);
      res.end();
      return;
    }
    this.serveFile(res, target);
  }

  private serveFile(res: http.ServerResponse, file: string): void {
    const type = CONTENT_TYPES[path.extname(file).toLowerCase()];
    if (!type) {
      res.writeHead(404);
      res.end();
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }

  private isLockedOut(address: string): boolean {
    const entry = this.failures.get(address);
    return Boolean(entry && entry.count >= MAX_FAILURES && entry.until > Date.now());
  }

  private recordFailure(address: string): void {
    const entry = this.failures.get(address) ?? { count: 0, until: 0 };
    if (entry.until <= Date.now() && entry.count >= MAX_FAILURES) entry.count = 0;
    entry.count++;
    entry.until = Date.now() + LOCKOUT_MS;
    this.failures.set(address, entry);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('zu groß'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const VIRTUAL_ADAPTER = /vEthernet|Hyper-V|WSL|VirtualBox|VMware|vbox|Loopback|TAP-|WireGuard|OpenVPN|Tailscale|ZeroTier/i;

/** Adressen des Laptops im lokalen Netz, z. B. `http://192.168.178.23:8028`. */
export function localUrls(port: number): string[] {
  const urls: string[] = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    // Virtuelle Adapter (Hyper-V, WSL, VirtualBox, VMware, VPN) erreicht
    // das iPad nicht. Am Laptop standen sonst mehrere Adressen, von denen
    // nur eine funktionierte (Review N6).
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) urls.push(`http://${entry.address}:${port}`);
    }
  }
  return urls;
}

/** Sechsstellige PIN. Nicht kryptografisch wertvoll, aber im WLAN nicht zu raten. */
export function generatePin(random: () => number = () => randomInt(1_000_000) / 1_000_000): string {
  return String(Math.floor(random() * 1_000_000)).padStart(6, '0');
}
