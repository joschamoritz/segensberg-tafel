import { createApi, Transport } from '../../shared/bridge';

/**
 * Brücke der Fernsteuerung: läuft im Browser des iPads, VOR dem
 * Steuerungsskript, und stellt dieselbe `window.api` bereit wie die
 * Electron-Brücke -- nur über das WLAN. Das Steuerungsskript merkt keinen
 * Unterschied, bis auf die Klasse `is-remote` am body: Daran blendet das
 * Stylesheet aus, was am iPad keinen Sinn hat (Dateidialoge), und
 * vergrößert die Zielflächen für den Finger.
 *
 * Gegenstück: `main/remoteServer.ts`.
 */

const PIN_KEY = 'anzeigetafel-pin';
const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

function storedPin(): string {
  try {
    return localStorage.getItem(PIN_KEY) ?? '';
  } catch {
    return '';
  }
}

let pin = storedPin();

/**
 * Fragt die PIN ab, bis der Laptop sie annimmt. Gespeichert wird sie im
 * Browser des Geräts: Beim nächsten Spiel genügt das Antippen des
 * Homescreen-Symbols.
 */
async function ensurePin(): Promise<boolean> {
  for (;;) {
    if (pin) {
      const answer = await fetch('/api/check', { headers: { 'x-pin': pin } }).catch(() => null);
      if (answer && answer.status === 204) return true;
      if (answer && answer.status === 429) {
        alert('Zu viele falsche Versuche. Bitte ein paar Minuten warten.');
        return false;
      }
    }
    const input = prompt('PIN der Anzeigetafel (steht am Laptop unter „Anzeige → Fernsteuerung“):');
    // Abgebrochen: nicht sofort wieder fragen, sonst kommt man aus der
    // Abfrage nicht heraus. Neu laden fragt erneut.
    if (input === null) return false;
    pin = input.trim();
    try {
      localStorage.setItem(PIN_KEY, pin);
    } catch {
      // Privater Modus: dann eben bei jedem Öffnen neu.
    }
  }
}

let source: EventSource | null = null;

async function post(path: string, channel: string, args: unknown[]): Promise<Response | null> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-pin': pin },
    body: JSON.stringify({ channel, args }),
  }).catch(() => null);

  if (!response) {
    setOffline(true);
  } else if (response.status === 401) {
    // Bisher blieb eine Ablehnung stumm -- man tippte auf Knöpfe, die
    // nichts taten, und suchte den Fehler an der Tafel. Meist wurde am
    // Laptop eine neue PIN vergeben.
    void reauthenticate();
  } else if (response.status === 429) {
    setOffline(true, 'Zu viele falsche PIN-Versuche – bitte ein paar Minuten warten.');
  } else if (source?.readyState === EventSource.OPEN) {
    // Der Hinweis wurde bisher nur beim Wiederaufbau der Ereignis-
    // verbindung entfernt. Blieb die bestehen, stand er nach einem einzigen
    // verlorenen Befehl dauerhaft da (Review 2026-10, N6).
    setOffline(false);
  }
  return response;
}

/**
 * Befehle, die gerade unterwegs sind. Ein zweiter, gleicher Befehl in
 * dieser Zeit wird verworfen: Bei schwachem WLAN tippte man sonst ein
 * zweites Mal, weil die Zahl noch nicht umgesprungen war -- und zählte
 * zwei Tore (Review 2026-10, W9). Gehalten wird mindestens
 * `DOUBLE_TAP_MS`, auch wenn die Antwort schneller da ist: Ein Doppeltipp
 * mit dem Finger liegt in dieser Größenordnung.
 */
const inFlight = new Set<string>();
const DOUBLE_TAP_MS = 400;

const transport: Transport = {
  send: (channel, ...args) => {
    const key = channel + JSON.stringify(args);
    if (inFlight.has(key)) return;
    inFlight.add(key);
    document.body.classList.add('is-sending');
    const held = new Promise((resolve) => setTimeout(resolve, DOUBLE_TAP_MS));
    void Promise.all([post('/api/send', channel, args), held]).then(() => {
      inFlight.delete(key);
      if (inFlight.size === 0) document.body.classList.remove('is-sending');
    });
  },
  invoke: async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const response = await post('/api/invoke', channel, args);
    if (!response || !response.ok) return null as T;
    const body = (await response.json()) as { result: T };
    return body.result;
  },
  on: (channel, listener) => {
    const list = listeners.get(channel) ?? [];
    list.push(listener as (...args: unknown[]) => void);
    listeners.set(channel, list);
  },
};

window.api = createApi(transport);

// --------------------------------------------------------------------
// Verbindung halten
// --------------------------------------------------------------------

/**
 * Hinweis, wenn die Verbindung zum Laptop weg ist -- sonst drückt man am
 * Spielfeldrand Knöpfe, die nichts tun, und merkt es erst an der Tafel.
 */
function setOffline(
  offline: boolean,
  text = 'Keine Verbindung zum Laptop – wird wieder aufgebaut …'
): void {
  let banner = document.getElementById('remote-offline');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'remote-offline';
    banner.className = 'remote-offline';
    document.body.appendChild(banner);
  }
  if (offline) banner.textContent = text;
  banner.hidden = !offline;
}

/**
 * Die PIN gilt nicht mehr (am Laptop wurde eine neue vergeben): Verbindung
 * schließen und neu fragen. Ohne das versuchte der Browser die
 * Ereignisverbindung alle paar Sekunden mit der alten PIN neu -- und lief
 * nach zehn Versuchen in die Sperre, bevor jemand die neue eingeben konnte.
 */
let reauthenticating = false;

async function reauthenticate(): Promise<void> {
  if (reauthenticating) return;
  reauthenticating = true;
  source?.close();
  source = null;
  setOffline(true, 'Die PIN hat sich geändert – bitte die neue eingeben.');
  pin = '';
  const ok = await ensurePin();
  reauthenticating = false;
  if (!ok) {
    setOffline(true, 'Ohne PIN keine Verbindung – Seite neu laden, um sie einzugeben.');
    return;
  }
  connect();
  window.api.requestState();
  window.api.requestStatus();
}

function connect(): void {
  const events = new EventSource(`/api/events?pin=${encodeURIComponent(pin)}`);
  source = events;
  let wasOffline = false;

  events.onopen = () => {
    setOffline(false);
    // Nach einem Abriss den aktuellen Stand holen -- in der Zwischenzeit
    // kann am Laptop oder an einem anderen Gerät etwas passiert sein.
    if (wasOffline) {
      window.api.requestState();
      window.api.requestStatus();
    }
    wasOffline = false;
  };
  events.onerror = () => {
    wasOffline = true;
    setOffline(true);
    // Abgelehnte PIN oder nur ein Funkloch? Ein EventSource verrät den
    // Statuscode nicht, die Prüfadresse schon.
    void fetch('/api/check', { headers: { 'x-pin': pin } })
      .then((answer) => {
        if (answer.status === 401 && source === events) void reauthenticate();
      })
      .catch(() => undefined);
  };
  events.onmessage = (message) => {
    const { channel, args } = JSON.parse(message.data) as { channel: string; args: unknown[] };
    for (const listener of listeners.get(channel) ?? []) listener(...args);
  };
}

document.body.classList.add('is-remote');

// Das Steuerungsskript startet bei DOMContentLoaded und fragt dann den
// Zustand ab. Bis die PIN geprüft und die Verbindung offen ist, gehen
// diese ersten Anfragen ins Leere -- deshalb danach noch einmal.
void ensurePin().then((ok) => {
  if (!ok) {
    setOffline(true, 'Ohne PIN keine Verbindung – Seite neu laden, um sie einzugeben.');
    return;
  }
  connect();
  window.api.requestState();
  window.api.requestStatus();
  window.api.requestLibrary();
});
