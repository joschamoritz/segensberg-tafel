import { MatchState } from '../../shared/types';

// Was mehrere Teile der Steuerung gemeinsam brauchen (siehe control.ts).

/**
 * Listen mit Eingabefeldern oder Auswahlmenüs dürfen nicht bei jedem
 * Zustands-Update neu aufgebaut werden -- sonst verliert man beim Tippen
 * den Fokus und ein geöffnetes Dropdown klappt sofort wieder zu. Deshalb
 * wird nur neu gezeichnet, wenn sich die zugrunde liegenden Daten wirklich
 * geändert haben.
 *
 * Verglichen werden die Revisionszähler aus dem Store. Früher stand hier
 * ein `JSON.stringify` über die Kader -- das lief samt aller Base64-Bilder
 * bei jedem Uhr-Tick, also fünfmal pro Sekunde.
 */
const renderSignatures = new Map<string, string>();

export const ui: {
  /** Letzter empfangener Zustand -- für Rückfragen, die den Kontext brauchen. */
  lastRenderedState: MatchState | null;
} = { lastRenderedState: null };

export function hasChanged(key: string, signature: string): boolean {
  if (renderSignatures.get(key) === signature) return false;
  renderSignatures.set(key, signature);
  return true;
}

/**
 * Zeigt JS-Fehler direkt sichtbar auf der Seite an (zusätzlich zur Konsole),
 * damit ein kaputter main()-Lauf (z.B. durch ein falsches Element-ID) nicht
 * stillschweigend alle Button-Klicks lahmlegt, ohne dass man es merkt.
 */
export function showError(text: string): void {
  const banner = document.getElementById('js-error-banner');
  if (!banner) return;
  banner.hidden = false;
  banner.textContent = banner.textContent ? `${banner.textContent}\n---\n${text}` : text;
}

window.addEventListener('error', (event) => {
  showError(`Fehler: ${event.message}\n  bei ${event.filename}:${event.lineno}:${event.colno}`);
});
window.addEventListener('unhandledrejection', (event) => {
  showError(`Unbehandelte Promise-Ablehnung: ${String(event.reason)}`);
});

/**
 * Merkt sich, welches Feld gerade bearbeitet wird.
 *
 * `document.activeElement` allein reicht nicht: Bei `<input type="time">`
 * und `type="number"` öffnet Chromium eigene Auswahl-Elemente, wodurch das
 * Feld zwischenzeitlich nicht mehr als aktiv gilt. Ein Zustands-Update
 * hätte die halbfertige Eingabe dann überschrieben -- genau das führte
 * dazu, dass sich die Anstoßzeit nicht eintragen ließ.
 *
 * `WeakSet`, damit entfernte Eingabefelder nicht dauerhaft im Speicher
 * gehalten werden -- der Kader-Editor tauscht Zeilen aus.
 */
const editingInputs = new WeakSet<HTMLElement>();

document.addEventListener('focusin', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    editingInputs.add(target);
  }
});

document.addEventListener('focusout', (event) => {
  const target = event.target;
  if (target instanceof HTMLElement) editingInputs.delete(target);
});

/**
 * Aktualisiert ein Eingabefeld aus dem Zustand, solange es nicht gerade
 * bearbeitet wird -- sonst würde jeder Uhr-Tick (alle 200ms) die Eingabe
 * überschreiben.
 */
export function updateInputIfNotFocused(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  if (editingInputs.has(input) || document.activeElement === input) return;
  if (input.value === value) return;
  input.value = value;
}

/** Läuft diese Steuerung auf einem Gerät im WLAN statt am Laptop? */
export function isRemote(): boolean {
  return document.body.classList.contains('is-remote');
}
