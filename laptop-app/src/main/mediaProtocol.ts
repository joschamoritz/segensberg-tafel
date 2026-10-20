import { net, protocol } from 'electron';
import { pathToFileURL } from 'url';
import { MediaFolderId, MEDIA_FOLDER_IDS } from '../shared/types';
import { ctx } from './context';

/**
 * Eigenes Protokoll für die Diashow-Bilder.
 *
 * Die Anzeige lädt Werbemotive als `svh-media://werbung/01_sponsor.jpg`
 * direkt von der Platte. Der Umweg über data:-URLs im Zustand schied aus:
 * Zwanzig Motive wären mehrere Megabyte, die bei jeder Zustandsänderung
 * durch die IPC-Brücke an beide Fenster gingen. So lädt Chromium jedes
 * Bild selbst und erst, wenn es gebraucht wird.
 *
 * Die Registrierung muss VOR `app.whenReady()` laufen, deshalb steht sie
 * hier im Modulrumpf und nicht in der Startroutine -- `main.ts` importiert
 * dieses Modul, bevor Electron bereit ist.
 */
const MEDIA_SCHEME = 'svh-media';

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    // `stream` für Medien-Elemente. Die Tormusik läuft trotzdem NICHT
    // über dieses Schema, sondern über IPC (siehe `IPC.soundRead`):
    // `net.fetch` auf eine `file:`-URL beantwortet keine
    // Teilbereichs-Anfragen, und ein `fetch()` aus dem Fenster scheitert
    // an der Herkunftsprüfung -- das Fenster läuft unter `file://`, das
    // Schema ist eine eigene Herkunft ohne CORS-Kopfzeile.
    privileges: { standard: true, secure: true, stream: true },
  },
]);

/**
 * Beantwortet Anfragen an `svh-media:`. Alles, was nicht eindeutig eine
 * Bilddatei aus einem der beiden Medienordner ist, wird abgewiesen --
 * die Prüfung steckt in `MediaLibrary.resolveFile()`.
 */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      const folder = url.hostname as MediaFolderId;
      if (!MEDIA_FOLDER_IDS.includes(folder)) {
        return new Response('Unbekannter Ordner', { status: 404 });
      }

      const fileName = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const filePath = ctx.media.resolveFile(folder, fileName);
      if (filePath === null) return new Response('Nicht gefunden', { status: 404 });

      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      // Ein kaputter Verweis darf die Anzeige nicht mitreißen -- dann
      // bleibt die Folie eben leer.
      console.error('svh-media: Anfrage fehlgeschlagen', error);
      return new Response('Fehler', { status: 500 });
    }
  });
}
