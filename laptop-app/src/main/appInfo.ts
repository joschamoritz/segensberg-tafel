import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppInfo } from '../shared/types';

/**
 * Fassung und Baudatum, geschrieben von `scripts/build-info.js`.
 *
 * Nur einmal gelesen und dann gemerkt: Der Wert ändert sich zur Laufzeit
 * nicht. Fehlt die Datei -- etwa weil jemand `tsc` von Hand aufgerufen
 * hat --, bleibt die Version aus Electron übrig; das Baudatum entfällt
 * dann, statt eine erfundene Zahl zu zeigen.
 */
let appInfoCache: AppInfo | null = null;

export function readAppInfo(): AppInfo {
  if (appInfoCache) return appInfoCache;
  let builtAt = '';
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'build-info.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppInfo>;
    if (typeof parsed.builtAt === 'string') builtAt = parsed.builtAt;
  } catch {
    // Ohne die Datei bleibt es bei der Version aus package.json.
  }
  appInfoCache = { version: app.getVersion(), builtAt };
  return appInfoCache;
}

/**
 * Letzte Rettungsleine: Ein unbehandelter Fehler soll die App am Spieltag
 * nicht wortlos beenden. Protokoll landet neben den Konfigurationsdateien.
 *
 * Die Fassung steht in jeder Zeile: Ein Protokoll vom Vereinsrechner
 * ohne Angabe, welcher Stand ihn erzeugt hat, ist nur halb verwertbar.
 */
export function logFatal(kind: string, error: unknown): void {
  try {
    const line = `[${new Date().toISOString()}] [v${app.getVersion()}] ${kind}: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'fehler.log'), line, 'utf-8');
  } catch {
    // Wenn nicht einmal das Protokoll schreibbar ist, bleibt nur die Konsole.
  }
  console.error(kind, error);
}
