import type { BrowserWindow } from 'electron';
import { IPC } from '../shared/types';
import type { MediaLibrary } from './media';
import { remoteServer } from './remoteControl';
import type { SquadStore } from './squads';
import type { MatchStateStore } from './state';
import type { TeamLibrary } from './teamLibrary';

/**
 * Was die Module des Hauptprozesses gemeinsam brauchen.
 *
 * Die Stores entstehen erst in `app.whenReady()` (`app.getPath()` darf
 * vorher nicht laufen), deshalb steht hier kein Konstruktor, sondern ein
 * Objekt, das `main.ts` beim Start befüllt. Vorher ist `store` leer --
 * `flushLiveMatchSave()` prüft das.
 */
export interface MainContext {
  store: MatchStateStore;
  library: TeamLibrary;
  squads: SquadStore;
  media: MediaLibrary;
  controlWindow: BrowserWindow | null;
  displayWindow: BrowserWindow | null;
  selectedDisplayId: number | null;
}

export const ctx = {
  controlWindow: null,
  displayWindow: null,
  selectedDisplayId: null,
} as MainContext;

/** Sendet nur an Fenster, die es noch gibt -- sonst wirft `send()`. */
export function sendTo(win: BrowserWindow | null, channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

/**
 * Schickt an das Steuerungsfenster UND an alle per WLAN verbundenen Geräte
 * -- die Fernsteuerung ist eine zweite Steuerung und braucht dieselben
 * Nachrichten. Nicht für das Anzeigefenster.
 */
export function toControl(channel: string, ...args: unknown[]): void {
  sendTo(ctx.controlWindow, channel, ...args);
  remoteServer()?.broadcast(channel, ...args);
}

export function broadcastState(): void {
  const state = ctx.store.getState();
  toControl(IPC.stateUpdated, state);
  sendTo(ctx.displayWindow, IPC.stateUpdated, state);
}
