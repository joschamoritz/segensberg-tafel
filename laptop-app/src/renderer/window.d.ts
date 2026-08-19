import type { LibraryPayload, PreloadApi } from '../main/preload';

/**
 * Schnittstelle zum Hauptprozess, wie sie im Renderer sichtbar ist.
 *
 * Hier stand früher eine von Hand gepflegte Zweitschrift aller
 * Preload-Funktionen. Sie lief mit jeder Signaturänderung auseinander --
 * der Renderer kompilierte gegen die Zweitschrift, aufgerufen wurde aber
 * das Original, und der Fehler fiel erst im Betrieb auf. Jetzt wird der
 * Typ aus `main/preload.ts` abgeleitet.
 *
 * Der Import ist bewusst `import type`: Er verschwindet beim Kompilieren
 * restlos, sodass der Renderer nicht versehentlich das `electron`-Modul
 * lädt, das `preload.ts` benutzt.
 */
export type { LibraryPayload, PreloadApi };

declare global {
  interface Window {
    api: PreloadApi;
  }
}
