import { dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC, TeamId } from '../shared/types';
import { ctx } from './context';
import { detectLogoVariant, readImageAsDataUrl } from './images';
import { broadcastLibrary, persistSquad, persistTeams } from './persist';

// Dateifenster am Laptop. Über die Fernsteuerung gesperrt (REMOTE_DENIED):
// Sie öffneten sich am Laptop, nicht auf dem Gerät, das sie auslöst.

export async function chooseLibraryFolder(): Promise<void> {
  if (!ctx.controlWindow) return;
  const result = await dialog.showOpenDialog(ctx.controlWindow, {
    title: 'Ordner mit den Vereinslogos wählen',
    defaultPath: ctx.library.getRootPath(),
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  ctx.library.setRootPath(result.filePaths[0]);
  persistTeams();
  broadcastLibrary();
}

/**
 * Öffnet eine Aufstellungs-Textdatei und schickt den Inhalt ins
 * Steuerungsfenster. Dort landet er im Einfügefeld -- so durchläuft auch
 * eine geladene Datei die Vorschau, bevor der Kader überschrieben wird.
 */
export async function pickSquadFile(team: TeamId): Promise<void> {
  const controlWindow = ctx.controlWindow;
  if (!controlWindow) return;

  // Standardordner neben der Logo-Bibliothek ("…/Vereinsdaten/Kader")
  const defaultPath = path.join(path.dirname(ctx.library.getRootPath()), 'Kader');

  const result = await dialog.showOpenDialog(controlWindow, {
    title: 'Aufstellung aus Datei laden',
    defaultPath: fs.existsSync(defaultPath) ? defaultPath : undefined,
    filters: [{ name: 'Textdateien', extensions: ['txt', 'csv'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;

  try {
    const text = fs.readFileSync(result.filePaths[0], 'utf-8');
    controlWindow.webContents.send(IPC.squadFileLoaded, team, text);
  } catch {
    dialog.showErrorBox('Datei nicht lesbar', 'Die gewählte Datei konnte nicht gelesen werden.');
  }
}

export async function pickPlayerPhoto(team: TeamId, playerId: string): Promise<void> {
  if (!ctx.controlWindow) return;
  const result = await dialog.showOpenDialog(ctx.controlWindow, {
    title: 'Spielerportrait auswählen',
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;

  const dataUrl = readImageAsDataUrl(result.filePaths[0], 'portrait');
  if (!dataUrl) return;
  ctx.store.setPlayerPhoto(team, playerId, dataUrl);
  persistSquad(team);
}

export async function pickLogo(team: TeamId): Promise<void> {
  if (!ctx.controlWindow) return;
  const result = await dialog.showOpenDialog(ctx.controlWindow, {
    title: 'Logo auswählen',
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return;

  const file = result.filePaths[0];
  const dataUrl = readImageAsDataUrl(file, 'logo');
  if (!dataUrl) return;
  // Von Hand gewählte Dateien liegen nicht in der Ordnerstruktur der
  // Bibliothek -- hier muss die Variante aus Dateiname und Bildinhalt
  // hergeleitet werden, siehe `detectLogoVariant`.
  ctx.store.setTeamLogo(team, dataUrl, detectLogoVariant(file));
  persistTeams();
}
