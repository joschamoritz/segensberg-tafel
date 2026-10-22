import { app, BrowserWindow, Display, screen } from 'electron';
import * as path from 'path';
import { BoardSize, DEFAULT_BOARD_SIZE, DisplayInfo } from '../shared/types';
import {
  currentScreenAreas,
  loadWindowState,
  MIN_CONTROL_HEIGHT,
  MIN_CONTROL_WIDTH,
  sanitizeBounds,
  trackWindowState,
} from './windowState';

/**
 * "Präsentationsmodus"-Ansatz statt Fenstern auf Pixelkoordinaten: Wir fragen das
 * Betriebssystem nach den tatsächlich angeschlossenen Bildschirmen und
 * öffnen dort ein echtes Vollbild-Fenster, statt ein Fenster manuell auf
 * Pixelkoordinaten zu positionieren. Siehe CLAUDE.md.
 */
export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: `${d.bounds.width}x${d.bounds.height} @ (${d.bounds.x},${d.bounds.y})`,
    width: d.bounds.width,
    height: d.bounds.height,
    isPrimary: d.id === primaryId,
  }));
}

/** Wählt automatisch den ersten Nicht-Primär-Bildschirm, falls vorhanden. */
export function pickDefaultTargetDisplay(): Display | null {
  const primaryId = screen.getPrimaryDisplay().id;
  const displays = screen.getAllDisplays();
  return displays.find((d) => d.id !== primaryId) ?? null;
}

export function findDisplayById(id: number): Display | null {
  return screen.getAllDisplays().find((d) => d.id === id) ?? null;
}

/**
 * Hält ein Fenster auf seiner eigenen Seite.
 *
 * Electron navigiert beim Ablegen einer Datei standardmäßig zu ihr. Wer
 * Logos oder Portraits vorbereitet, zieht leicht ein Bild aus dem Explorer
 * aufs Fenster -- danach stand dort nur noch das Bild, ohne einen Knopf
 * und ohne Weg zurück (Review 2026-10, W5). Neue Fenster gibt es aus
 * demselben Grund nicht.
 */
export function lockNavigation(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/**
 * Das Steuerungsfenster merkt sich Größe, Position und Maximierung.
 *
 * Ohne das öffnete es starr bei 1000x700 -- rund 660px nutzbare Höhe für
 * eine Oberfläche, die 1650px hoch ist. Wer maximiert arbeitet, stellte das
 * nach jedem Start von Hand wieder her. Beim allerersten Start wird
 * maximiert geöffnet, weil der Platz sonst nicht reicht.
 */
export function createControlWindow(): BrowserWindow {
  const gemerkt = loadWindowState();
  const bounds = sanitizeBounds(gemerkt.bounds, currentScreenAreas());

  const win = new BrowserWindow({
    // Ohne geprüfte Maße platziert Electron das Fenster selbst -- besser
    // als ein erfundener Ort. Siehe sanitizeBounds().
    ...(bounds ?? { width: 1000, height: 700 }),
    minWidth: MIN_CONTROL_WIDTH,
    minHeight: MIN_CONTROL_HEIGHT,
    // Erst zeigen, wenn maximiert UND der Inhalt da ist -- sonst blitzt
    // beim Start erst das kleine, dann ein leeres weißes Fenster auf.
    show: false,
    title: 'Segensberg-Tafel – Steuerung',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  lockNavigation(win);
  if (gemerkt.maximized) win.maximize();
  trackWindowState(win);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'control', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Während der Entwicklung DevTools automatisch öffnen, damit JS-Fehler im
  // Renderer sofort sichtbar sind. app.isPackaged ist bei einer fertigen
  // .exe true, dann bleibt das aus.
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

/**
 * Erstellt das Display-Fenster. Wenn `targetDisplay` gesetzt ist, wird es
 * randlos und in echtem Vollbild exakt auf diesem Bildschirm platziert.
 * Ohne zweiten Bildschirm (targetDisplay === null) läuft es stattdessen als
 * normales Vorschau-Fenster, damit man ohne zusätzliche Hardware entwickeln
 * und testen kann.
 *
 * Das Vorschau-Fenster bekommt das Seitenverhältnis der eingestellten
 * Tafelauflösung: Die Anzeige rechnet ihr Layout ohnehin in dieser Größe
 * und legt sonst schwarze Balken daneben (siehe `.stage` in
 * `display.css`). Bei einem passenden Fenster füllt die Bühne es genau
 * aus -- die Vorschau zeigt dann nichts als die Tafel.
 */
const PREVIEW_ZOOM = 3;

export function createDisplayWindow(
  targetDisplay: Display | null,
  board: BoardSize = DEFAULT_BOARD_SIZE
): BrowserWindow {
  const previewMode = targetDisplay === null;

  const win = new BrowserWindow({
    x: targetDisplay?.bounds.x,
    y: targetDisplay?.bounds.y,
    width: targetDisplay?.bounds.width ?? board.width * PREVIEW_ZOOM,
    height: targetDisplay?.bounds.height ?? board.height * PREVIEW_ZOOM,
    // Die Fenstermaße meinen den Inhaltsbereich, nicht den Rahmen --
    // sonst zöge die Titelleiste die Bühne aus dem Verhältnis.
    useContentSize: previewMode,
    frame: previewMode,
    autoHideMenuBar: true,
    resizable: previewMode,
    // Vollbild direkt beim Erzeugen setzen statt nachträglich: sonst bleibt
    // unter Windows die Taskleiste über dem Fenster sichtbar.
    fullscreen: !previewMode,
    // Das Anzeigefenster gehört nicht in die Taskleiste -- bedient wird
    // ausschließlich das Steuerungsfenster.
    skipTaskbar: !previewMode,
    title: previewMode ? 'Segensberg-Tafel – Vorschau (kein zweiter Bildschirm erkannt)' : 'Segensberg-Tafel – Anzeige',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!previewMode) {
    // Zusätzlich über alles legen: eine automatisch eingeblendete
    // Taskleiste würde sich sonst weiterhin über die Anzeige schieben.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMenuBarVisibility(false);

    // Notausgang: Landet das randlose Fenster durch einen HDMI-Verlust auf
    // dem Laptop-Bildschirm, läge es ohne Rahmen und ohne
    // Taskleisteneintrag über allem. Escape gibt den Bildschirm frei.
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return;
      win.setAlwaysOnTop(false);
      win.setFullScreen(false);
    });
  }

  lockNavigation(win);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'display', 'index.html'));
  return win;
}
