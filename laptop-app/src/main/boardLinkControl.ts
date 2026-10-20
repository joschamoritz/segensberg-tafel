import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { BoardLinkStatus } from '../shared/types';
import { logFatal } from './appInfo';
import { BoardLink, BoardLinkConfig } from './boardLink';
import { readJsonFile } from './configFile';
import { TaurusClient, discoverTaurusPlayers } from './taurus';
import { sanitizeBoardCredential, sanitizeBoardHost } from './validate';

// --------------------------------------------------------------------
// Verbindung zum TB50: Einstellung auf der Platte und Anschluss an die App
// --------------------------------------------------------------------

/**
 * Werkseinstellung laut goracon-Anleitung „Grundeinstellungen Software
 * Anzeigetafel" (Zugangsdaten für ViPlex Express). Nur Vorgabe, in der
 * Einrichtung änderbar -- und sollte geändert werden, sobald der Verein
 * am Gerät eigene Zugangsdaten setzt.
 */
export const DEFAULT_BOARD_LINK_CONFIG: BoardLinkConfig = {
  enabled: true,
  username: 'Admin',
  password: '1234',
  host: '',
};

let link: BoardLink | null = null;
let notifyStatus: () => void = () => {};

/** Wie bei der Fernsteuerung: Den `AppStatus` stellt `displayWindow.ts` zusammen. */
export function setBoardLinkStatusListener(listener: () => void): void {
  notifyStatus = listener;
}

/**
 * Gehört zum Laptop und zur Tafel, nicht zum Verein -- deshalb eine eigene
 * Datei wie `remote.json`, nicht `teams.json`.
 */
function configPath(): string {
  return path.join(app.getPath('userData'), 'board-link.json');
}

export function parseBoardLinkConfig(raw: unknown): BoardLinkConfig {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_BOARD_LINK_CONFIG.enabled,
    username:
      typeof value.username === 'string' && sanitizeBoardCredential(value.username) !== ''
        ? sanitizeBoardCredential(value.username)
        : DEFAULT_BOARD_LINK_CONFIG.username,
    password: typeof value.password === 'string' ? sanitizeBoardCredential(value.password) : DEFAULT_BOARD_LINK_CONFIG.password,
    host: sanitizeBoardHost(value.host) ?? DEFAULT_BOARD_LINK_CONFIG.host,
  };
}

function saveConfig(config: BoardLinkConfig): void {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch (error) {
    logFatal('board-link.json', error);
  }
}

export function initBoardLink(): void {
  const config = parseBoardLinkConfig(readJsonFile(configPath()));
  link = new BoardLink(
    config,
    {
      discover: (host) => discoverTaurusPlayers(host || undefined),
      connect: (player) => TaurusClient.connect({ host: player.address, port: player.tcpPort, privacy: player.privacy }),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
    () => notifyStatus()
  );
  link.start();
}

const OFF_STATUS: BoardLinkStatus = {
  enabled: false,
  state: 'off',
  device: null,
  brightness: null,
  ambientLight: null,
  source: null,
  hdmiSignal: null,
  ledSize: null,
  username: DEFAULT_BOARD_LINK_CONFIG.username,
  host: '',
  message: '',
};

export function boardLinkStatus(): BoardLinkStatus {
  return link ? link.status() : OFF_STATUS;
}

export function setBoardLinkEnabled(enabled: boolean): void {
  if (!link) return;
  link.setEnabled(enabled);
  saveConfig(link.getConfig());
}

export function setBoardLinkConfig(update: { username: string; password: string; host: string }): void {
  if (!link) return;
  link.setConfig(update);
  saveConfig(link.getConfig());
}

export function setBoardBrightness(percent: number): void {
  link?.setBrightness(percent);
}

export function selectBoardHdmi(): void {
  void link?.selectHdmi();
}

export function shutdownBoardLink(): void {
  link?.stop();
}
