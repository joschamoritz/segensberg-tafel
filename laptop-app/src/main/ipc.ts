import { ipcMain } from 'electron';
import type { InvokeHandler, SendHandler } from './remoteServer';

/**
 * Alle Handler, die das Steuerungsfenster erreichen kann -- einmal für
 * ipcMain, einmal für die Fernsteuerung. `onIpc()`/`handleIpc()` tragen in
 * beide ein, sodass ein neuer Knopf automatisch auch auf dem iPad
 * funktioniert.
 *
 * Dies ist die einzige Datei, die `ipcMain.on`/`ipcMain.handle` aufruft --
 * `tests/remote.test.js` prüft das.
 */
export const sendHandlers = new Map<string, SendHandler>();
export const invokeHandlers = new Map<string, InvokeHandler>();

export function onIpc(channel: string, handler: SendHandler): void {
  sendHandlers.set(channel, handler);
  ipcMain.on(channel, handler);
}

export function handleIpc(channel: string, handler: InvokeHandler): void {
  invokeHandlers.set(channel, handler);
  ipcMain.handle(channel, handler);
}
