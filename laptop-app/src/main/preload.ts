import { contextBridge, ipcRenderer } from 'electron';
import { createApi, LibraryPayload, PreloadApi } from '../shared/bridge';

/**
 * Gemeinsames Preload-Script für Control- und Display-Fenster. Nur die hier
 * explizit freigegebenen Funktionen sind aus dem Renderer erreichbar
 * (contextIsolation aktiv, kein nodeIntegration) -- Sicherheitsstandard für
 * Electron-Apps, die HTML/CSS/JS-Inhalte rendern.
 *
 * Die Liste der Funktionen steht in `shared/bridge.ts`: Dieselbe Liste
 * bedient auch die Fernsteuerung im WLAN, nur über einen anderen Weg.
 * Hier steht nur der Electron-Weg.
 */
const api = createApi({
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    ipcRenderer.on(channel, (_event, ...args) => listener(...args));
  },
});

contextBridge.exposeInMainWorld('api', api);

/**
 * Typ der freigegebenen Schnittstelle -- abgeleitet statt von Hand
 * gepflegt.
 *
 * Vorher stand in `renderer/window.d.ts` eine handgeschriebene Zweitschrift
 * dieser Liste. Eine geänderte Signatur fiel damit erst zur Laufzeit auf:
 * Der Renderer kompilierte gegen die Zweitschrift, aufgerufen wurde aber
 * das hier. Jetzt ist `shared/bridge.ts` die einzige Quelle.
 */
export type { LibraryPayload, PreloadApi };
