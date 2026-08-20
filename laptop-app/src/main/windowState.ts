import { app, BrowserWindow, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Größe, Position und Maximierung des Steuerungsfensters über Programmläufe
 * hinweg merken.
 *
 * Warum überhaupt: Das Fenster öffnete bisher starr bei 1000x700 und merkte
 * sich nichts. Bei 700px Fensterhöhe bleiben rund 660px nutzbar -- und in
 * die passt die Bedienoberfläche nicht annähernd hinein (gemessen 1650px).
 * Wer am Spieltag maximiert arbeitet, musste das nach jedem Start von Hand
 * wiederherstellen.
 *
 * Bewusst NICHT in `teams.json`: Dort stehen Vereinsdaten, die auf einen
 * anderen Rechner mitwandern dürfen. Fenstermaße gehören zum Gerät und zum
 * dort angeschlossenen Bildschirm -- auf einem anderen Laptop wären sie
 * bestenfalls nutzlos.
 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds?: WindowBounds;
  maximized: boolean;
}

/** Rechteck eines angeschlossenen Bildschirms, wie `screen` es liefert. */
export interface ScreenArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_CONTROL_WIDTH = 720;
export const MIN_CONTROL_HEIGHT = 560;

/**
 * Erster Start: maximiert.
 *
 * Der Höhenetat ist das eigentliche Problem der Oberfläche, und maximiert
 * ist die einzige Einstellung, bei der er sicher reicht. Wer es kleiner
 * will, zieht das Fenster einmal zurecht -- ab dann wird genau das gemerkt.
 */
export function defaultWindowState(): WindowState {
  return { maximized: true };
}

/**
 * Prüft gespeicherte Maße gegen die JETZT angeschlossenen Bildschirme.
 *
 * Der Fall, um den es geht: Diese App wird an wechselnden Aufbauten
 * betrieben -- am Spieltag hängt die Anzeigetafel als zweiter Bildschirm
 * dran, zu Hause nicht. Ein Fenster, das zuletzt auf dem zweiten Bildschirm
 * stand, hat gespeicherte Koordinaten weit außerhalb des Laptop-Bildschirms.
 * Ungeprüft übernommen ginge es unsichtbar auf: Die App läuft, die
 * Taskleiste zeigt sie, aber auf dem Bildschirm ist nichts -- und ohne
 * Fenster gibt es auch keinen Weg, es zurückzuholen.
 *
 * Verlangt wird deshalb eine *nennenswerte* Überlappung mit einem
 * Bildschirm, nicht bloß ein gemeinsamer Punkt: Ein Fenster, das mit zwei
 * Pixeln in die Ecke ragt, ist praktisch genauso verloren.
 *
 * @returns die geprüften Maße, oder `undefined` -- dann soll Electron das
 *   Fenster selbst platzieren, statt es an einen erfundenen Ort zu setzen.
 */
export function sanitizeBounds(
  bounds: WindowBounds | undefined,
  areas: ScreenArea[]
): WindowBounds | undefined {
  if (!bounds) return undefined;

  const zahlen = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (zahlen.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return undefined;

  // Eine zerschriebene oder von Hand verstellte Datei darf kein Fenster
  // erzeugen, das kleiner ist als die Mindestgröße -- Electron würde es
  // zwar hochziehen, aber dann stimmt die gespeicherte Position nicht mehr.
  const width = Math.max(bounds.width, MIN_CONTROL_WIDTH);
  const height = Math.max(bounds.height, MIN_CONTROL_HEIGHT);

  const MINDEST_SICHTBAR = 120;
  const sichtbar = areas.some((area) => {
    const breite = Math.min(bounds.x + width, area.x + area.width) - Math.max(bounds.x, area.x);
    const hoehe = Math.min(bounds.y + height, area.y + area.height) - Math.max(bounds.y, area.y);
    return breite >= MINDEST_SICHTBAR && hoehe >= MINDEST_SICHTBAR;
  });

  if (!sichtbar) return undefined;
  return { x: bounds.x, y: bounds.y, width, height };
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

export function loadWindowState(): WindowState {
  try {
    const raw = fs.readFileSync(statePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    return {
      bounds: parsed.bounds,
      maximized: parsed.maximized ?? defaultWindowState().maximized,
    };
  } catch {
    return defaultWindowState();
  }
}

/**
 * Schreibt über eine temporäre Datei und benennt um -- gleiche Begründung
 * wie bei `saveTeamsConfig`. Ein Fehler darf den Spielbetrieb nicht
 * unterbrechen; im schlimmsten Fall öffnet das Fenster beim nächsten Mal
 * eben an der alten Stelle.
 */
export function saveWindowState(state: WindowState): void {
  try {
    const target = statePath();
    const temp = `${target}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(temp, target);
  } catch (error) {
    console.error('window-state.json konnte nicht gespeichert werden:', error);
  }
}

/**
 * Hängt die Sicherung an ein Fenster.
 *
 * Gedrosselt, weil `resize` und `move` beim Ziehen im Sekundentakt
 * dutzendfach feuern -- ungedrosselt schriebe die App während des Ziehens
 * hunderte Dateien. Dieselbe Überlegung wie bei der Spielsicherung in
 * `liveMatch.ts`.
 *
 * Gemerkt werden die Maße im NICHT-maximierten Zustand: `getBounds()`
 * liefert bei einem maximierten Fenster die Bildschirmgröße, und die als
 * "so groß war das Fenster zuletzt" zu speichern hieße, dass ein einmal
 * maximiertes Fenster nie wieder eine sinnvolle wiederhergestellte Größe
 * bekommt.
 */
export function trackWindowState(win: BrowserWindow): void {
  const SPEICHER_VERZOEGERUNG_MS = 500;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const merken = (): void => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    saveWindowState({
      bounds: maximized ? loadWindowState().bounds : win.getBounds(),
      maximized,
    });
  };

  const gedrosselt = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(merken, SPEICHER_VERZOEGERUNG_MS);
  };

  win.on('resize', gedrosselt);
  win.on('move', gedrosselt);
  win.on('maximize', gedrosselt);
  win.on('unmaximize', gedrosselt);

  // Beim Schließen sofort und ungedrosselt: Ein ausstehender Zeitschalter
  // käme nach dem Beenden nicht mehr zum Zug.
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    merken();
  });
}

/** Die Arbeitsflächen aller angeschlossenen Bildschirme (ohne Taskleiste). */
export function currentScreenAreas(): ScreenArea[] {
  return screen.getAllDisplays().map((d) => ({ ...d.workArea }));
}
