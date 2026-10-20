import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { REMOTE_PORT, RemoteStatus } from '../shared/types';
import { logFatal } from './appInfo';
import { invokeHandlers, sendHandlers } from './ipc';
import { generatePin, localUrls, REMOTE_DENIED, RemoteServer } from './remoteServer';

// --------------------------------------------------------------------
// Fernsteuerung im WLAN
// --------------------------------------------------------------------

interface RemoteConfig {
  enabled: boolean;
  pin: string;
}

let remote: RemoteServer | null = null;
let remoteConfig: RemoteConfig = { enabled: false, pin: generatePin() };
let remoteError = '';

/**
 * Meldet eine Änderung am Status der Fernsteuerung weiter. Eingetragen von
 * `main.ts` -- der Status gehört in `AppStatus`, den dieses Modul nicht
 * zusammenstellt.
 */
let notifyStatus: () => void = () => {};

export function setRemoteStatusListener(listener: () => void): void {
  notifyStatus = listener;
}

/** Der laufende Server, falls die Fernsteuerung an ist. */
export function remoteServer(): RemoteServer | null {
  return remote;
}

function remoteConfigPath(): string {
  return path.join(app.getPath('userData'), 'remote.json');
}

/**
 * Gerät und Laptop gehören zusammen: Die PIN liegt deshalb in einer
 * eigenen Datei im userData-Ordner, nicht in `teams.json`, die auf einen
 * anderen Rechner mitwandern darf.
 */
function loadRemoteConfig(): RemoteConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(remoteConfigPath(), 'utf-8')) as Partial<RemoteConfig>;
    return {
      enabled: parsed.enabled === true,
      pin: typeof parsed.pin === 'string' && /^\d{6}$/.test(parsed.pin) ? parsed.pin : generatePin(),
    };
  } catch {
    return { enabled: false, pin: generatePin() };
  }
}

function saveRemoteConfig(): void {
  try {
    fs.writeFileSync(remoteConfigPath(), JSON.stringify(remoteConfig, null, 2));
  } catch (error) {
    logFatal('remote.json', error);
  }
}

/**
 * Lädt die Einstellung und startet die Fernsteuerung, wenn sie beim
 * letzten Mal an war. Ihre Handler trägt `registerIpcHandlers()` ein --
 * der Server schlägt sie erst bei einer Anfrage nach, die Reihenfolge ist
 * also egal.
 */
export function initRemoteControl(): void {
  remoteConfig = loadRemoteConfig();
  saveRemoteConfig();
  if (remoteConfig.enabled) void startRemote();
}

export function remoteStatus(): RemoteStatus {
  return {
    enabled: remote !== null,
    urls: remote ? localUrls(remote.port ?? REMOTE_PORT) : [],
    pin: remoteConfig.pin,
    clients: remote?.clientCount ?? 0,
    error: remoteError,
  };
}

async function startRemote(): Promise<void> {
  if (remote) return;
  const server = new RemoteServer({
    rendererRoot: path.join(__dirname, '..', 'renderer'),
    sendHandlers,
    invokeHandlers,
    denied: REMOTE_DENIED,
    pin: remoteConfig.pin,
    onClientsChanged: () => notifyStatus(),
  });
  try {
    await server.start(REMOTE_PORT);
    remote = server;
    remoteError = '';
  } catch (error) {
    // Meist ist der Port belegt, etwa weil die App ein zweites Mal läuft.
    remoteError = `Fernsteuerung ließ sich nicht starten: ${String(error)}`;
  }
  notifyStatus();
}

async function stopRemote(): Promise<void> {
  const server = remote;
  remote = null;
  if (server) await server.stop();
  notifyStatus();
}

export async function setRemoteEnabled(enabled: boolean): Promise<void> {
  remoteConfig = { ...remoteConfig, enabled };
  saveRemoteConfig();
  remoteError = '';
  if (enabled) await startRemote();
  else await stopRemote();
}

/**
 * Neue PIN -- etwa wenn sie in falsche Hände geraten ist. Der Server
 * startet dafür neu; verbundene Geräte fragen beim nächsten Befehl
 * wieder nach der PIN (Review N6).
 */
export function renewRemotePin(): void {
  remoteConfig = { ...remoteConfig, pin: generatePin() };
  saveRemoteConfig();
  if (remote) {
    void stopRemote().then(startRemote);
  } else {
    notifyStatus();
  }
}

/** Beim Beenden: Port freigeben. */
export function shutdownRemote(): void {
  void remote?.stop();
}
