import * as fs from 'fs';
import * as path from 'path';

/**
 * Liest eine Konfigurationsdatei aus dem userData-Ordner.
 *
 * Fehlt die Datei, ist das der Normalfall beim ersten Start: `undefined`.
 * Ist sie dagegen da und unlesbar, wird sie **beiseitegelegt**
 * (`squads.defekt-20261020-1530.json`) statt still verworfen. Bis Fassung
 * 1.6.0 startete der jeweilige Speicher dann leer, und der nächste
 * Schreibvorgang überschrieb die Datei -- bei `squads.json` waren damit
 * alle Kader aller Vereine samt Portraits endgültig weg (Review 2026-10,
 * W3). Das atomare Schreiben schützt nur vor einem Absturz mittendrin,
 * nicht vor einer anders beschädigten Datei.
 *
 * Was beiseitegelegt wurde, sammelt `configWarnings()` für das
 * Steuerungsfenster ein -- ein stilles Umbenennen würde sonst erst beim
 * nächsten Spiel auffallen, wenn die Kader fehlen.
 */
const warnings: string[] = [];

export function readJsonFile(file: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    quarantine(file);
    return undefined;
  }
}

function stamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-` +
    `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  );
}

function quarantine(file: string): void {
  const ext = path.extname(file);
  const target = path.join(path.dirname(file), `${path.basename(file, ext)}.defekt-${stamp(new Date())}${ext}`);
  try {
    fs.renameSync(file, target);
    warnings.push(
      `${path.basename(file)} war beschädigt und wurde als ${path.basename(target)} ` +
        `beiseitegelegt. Die App arbeitet mit leeren Vorgaben weiter.`
    );
  } catch (error) {
    warnings.push(`${path.basename(file)} ist beschädigt und ließ sich nicht sichern: ${String(error)}`);
  }
}

/** Bisher gesammelte Hinweise; der Aufrufer zeigt sie einmal an. */
export function configWarnings(): string[] {
  return [...warnings];
}
