import { powerSaveBlocker, screen } from 'electron';
import type { Display } from 'electron';
import { AppStatus, IPC } from '../shared/types';
import { configWarnings } from './configFile';
import { ctx, toControl } from './context';
import { remoteStatus } from './remoteControl';
import {
  createDisplayWindow,
  findDisplayById,
  listDisplays,
  pickDefaultTargetDisplay,
} from './windows';

/**
 * Hält Bildschirme und Rechner wach, solange die Tafel bespielt wird.
 *
 * Ohne das schaltet Windows auf Akku nach wenigen Minuten ohne Eingabe die
 * Bildschirme ab -- der HDMI-Ausgang zur Tafel geht mit, und in einer
 * Halbzeit ohne Tor fasst niemand den Laptop an (Review 2026-10, K2).
 * Nur mit echtem Zielbildschirm: In der Vorschau am Schreibtisch soll
 * der Laptop schlafen dürfen wie sonst.
 */
let powerBlockId: number | null = null;

function keepAwake(active: boolean): void {
  if (active && powerBlockId === null) {
    powerBlockId = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!active && powerBlockId !== null) {
    powerSaveBlocker.stop(powerBlockId);
    powerBlockId = null;
  }
}

/** Hinweise aus dem Betrieb, die wie die Konfigurationshinweise ins Banner gehen. */
const runtimeWarnings: string[] = [];

export function currentStatus(): AppStatus {
  const selectedDisplayId = ctx.selectedDisplayId;
  const target = selectedDisplayId !== null ? findDisplayById(selectedDisplayId) : null;
  return {
    displays: listDisplays(),
    selectedDisplayId: target ? selectedDisplayId : null,
    previewMode: target === null,
    displayOpen: ctx.displayWindow !== null && !ctx.displayWindow.isDestroyed(),
    remote: remoteStatus(),
    warnings: [...configWarnings(), ...runtimeWarnings],
  };
}

export function broadcastStatus(): void {
  toControl(IPC.statusUpdated, currentStatus());
}

/**
 * Maße des zuletzt bespielten Bildschirms. Nur wenn sich genau die ändern,
 * muss das Anzeigefenster neu aufgebaut werden -- Windows meldet
 * `display-metrics-changed` auch für andere Bildschirme, und ein
 * Neuaufbau mitten im Spiel bedeutet einen kurzen Blackout auf der Tafel.
 */
let lastTargetBounds = '';

/** Zeitpunkte der letzten automatischen Neustarts des Anzeigefensters. */
let displayRestarts: number[] = [];
const DISPLAY_RESTART_LIMIT = 3;

function boundsKey(display: Display | null): string {
  if (!display) return '';
  const { x, y, width, height } = display.bounds;
  return `${x}:${y}:${width}:${height}`;
}

export function openDisplayWindow(displayId: number | null): void {
  ctx.displayWindow?.close();
  ctx.selectedDisplayId = displayId;
  const target = displayId !== null ? findDisplayById(displayId) : null;
  lastTargetBounds = boundsKey(target);

  // Referenz auf das konkrete Fenster festhalten: `close()` wirkt
  // asynchron, der `closed`-Handler des ALTEN Fensters feuerte sonst erst
  // nach dieser Zuweisung und setzte die Referenz auf das gerade erzeugte
  // neue Fenster auf null -- die Anzeige bekam danach keine Updates mehr.
  const win = createDisplayWindow(target, ctx.store.getState().board);
  ctx.displayWindow = win;
  keepAwake(target !== null);

  win.on('closed', () => {
    if (ctx.displayWindow === win) {
      ctx.displayWindow = null;
      keepAwake(false);
      broadcastStatus();
    }
  });

  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.stateUpdated, ctx.store.getState());
  });

  // Stirbt der Renderer des Anzeigefensters (Grafiktreiber, Speicher),
  // bliebe sonst eine schwarze Tafel stehen, ohne dass es jemand merkt.
  // Höchstens DISPLAY_RESTART_LIMIT Mal pro Minute: Stürzt er immer wieder
  // ab, liefe das Neuöffnen sonst ohne Pause im Kreis (Review N3).
  win.webContents.on('render-process-gone', () => {
    if (ctx.displayWindow !== win) return;
    const now = Date.now();
    displayRestarts = displayRestarts.filter((t) => now - t < 60_000);
    if (displayRestarts.length >= DISPLAY_RESTART_LIMIT) {
      runtimeWarnings.push(
        'Das Anzeigefenster ist mehrfach hintereinander abgestürzt und wurde nicht erneut geöffnet. ' +
          'Über „Anzeigefenster neu öffnen“ versuchen, sonst die App neu starten.'
      );
      ctx.displayWindow = null;
      keepAwake(false);
      broadcastStatus();
      return;
    }
    displayRestarts.push(now);
    openDisplayWindow(ctx.selectedDisplayId);
  });

  broadcastStatus();
}

/**
 * Windows meldet eine Auflösungsänderung oft mehrfach hintereinander.
 * Ohne kurze Sammelfrist würde das Anzeigefenster zwei- bis dreimal neu
 * aufgebaut.
 */
let refitTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDisplayRefit(): void {
  if (refitTimer) clearTimeout(refitTimer);
  refitTimer = setTimeout(() => {
    refitTimer = null;
    openDisplayWindow(ctx.selectedDisplayId);
  }, 300);
}

/**
 * Falls sich die Monitor-Konfiguration während der Laufzeit ändert
 * (Kabel gezogen/gesteckt), Status neu melden und das Anzeigefenster
 * nachziehen.
 */
export function watchScreens(): void {
  // Ein später eingestecktes HDMI-Kabel holt die Anzeige auf die Tafel,
  // sofern sie gerade in der Vorschau läuft -- dieselbe Regel wie beim
  // Start. Beim Aufbau am Platz kommt das Kabel oft erst nach dem
  // Programmstart dran, und die Tafel zeigte dann den leeren Desktop
  // (Review 2026-10, W4). Ist schon ein Bildschirm bespielt, bleibt es
  // dabei: Dort hat ihn jemand bewusst gewählt.
  screen.on('display-added', () => {
    const selectedDisplayId = ctx.selectedDisplayId;
    if (selectedDisplayId === null || findDisplayById(selectedDisplayId) === null) {
      const target = pickDefaultTargetDisplay();
      if (target) {
        openDisplayWindow(target.id);
        return;
      }
    }
    broadcastStatus();
  });

  screen.on('display-removed', (_event, display) => {
    // Ist ausgerechnet der bespielte Bildschirm weg, liefe das Fenster ins
    // Leere. Dann zurück in die Vorschau, statt eine unsichtbare Anzeige
    // zu behalten.
    if (ctx.selectedDisplayId !== null && display.id === ctx.selectedDisplayId) {
      openDisplayWindow(null);
      return;
    }
    broadcastStatus();
  });
  screen.on('display-metrics-changed', (_event, display) => {
    if (ctx.selectedDisplayId === null || display.id !== ctx.selectedDisplayId) {
      broadcastStatus();
      return;
    }
    // Nur bei tatsächlich geänderten Maßen neu aufbauen -- Windows meldet
    // dieses Ereignis auch, wenn sich nur die Skalierung eines anderen
    // Bildschirms ändert.
    if (boundsKey(display) === lastTargetBounds) {
      broadcastStatus();
      return;
    }
    scheduleDisplayRefit();
  });
}
