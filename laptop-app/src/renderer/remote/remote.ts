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

async function post(path: string, channel: string, args: unknown[]): Promise<Response | null> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-pin': pin },
    body: JSON.stringify({ channel, args }),
  }).catch(() => null);
  if (!response) setOffline(true);
  return response;
}

const transport: Transport = {
  send: (channel, ...args) => {
    void post('/api/send', channel, args);
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
function setOffline(offline: boolean): void {
  let banner = document.getElementById('remote-offline');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'remote-offline';
    banner.className = 'remote-offline';
    banner.textContent = 'Keine Verbindung zum Laptop – wird wieder aufgebaut …';
    document.body.appendChild(banner);
  }
  banner.hidden = !offline;
}

function connect(): void {
  const source = new EventSource(`/api/events?pin=${encodeURIComponent(pin)}`);
  let wasOffline = false;

  source.onopen = () => {
    setOffline(false);
    // Nach einem Abriss den aktuellen Stand holen -- in der Zwischenzeit
    // kann am Laptop oder an einem anderen Gerät etwas passiert sein.
    if (wasOffline) {
      window.api.requestState();
      window.api.requestStatus();
    }
    wasOffline = false;
  };
  source.onerror = () => {
    wasOffline = true;
    setOffline(true);
  };
  source.onmessage = (message) => {
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
    setOffline(true);
    document.getElementById('remote-offline')!.textContent =
      'Ohne PIN keine Verbindung – Seite neu laden, um sie einzugeben.';
    return;
  }
  connect();
  window.api.requestState();
  window.api.requestStatus();
  window.api.requestLibrary();
});
