import * as fs from 'fs';
import * as path from 'path';
import { MediaFolderId, MEDIA_FOLDER_IDS, MediaLists } from '../shared/types';
import type { MediaFolderInfo } from '../shared/types';
import { resolveDataFolder } from './persistence';

/**
 * Bilder für die Diashow: Werbung/Sponsoren und Vereinshighlights.
 *
 * Bewusst ordnerbasiert und ohne Verwaltung im Steuerungsfenster
 * (Nutzerentscheidung): Neue Motive legt man in den Ordner, die
 * Reihenfolge steuert der Dateiname (`01_`, `02_` …). Das ist dieselbe
 * Denkweise wie bei der Logo-Bibliothek und spart eine komplette
 * Verwaltungsoberfläche.
 *
 * Die Bilddaten selbst werden hier NICHT gelesen. Sie gehen über das
 * `svh-media:`-Protokoll direkt von der Platte ins Anzeigefenster --
 * zwanzig Sponsorenmotive als Base64 im Zustand wären mehrere Megabyte
 * bei jeder Zustandsänderung.
 */

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
/** Chromium spielt diese Formate ohne zusätzliche Codecs ab. */
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];

/**
 * Ordnername unter `Vereinsdaten/` und erlaubte Endungen je Kennung.
 *
 * Die Endungen gehören hierher, weil `resolveFile()` sie prüft: Über das
 * `svh-media:`-Protokoll darf aus dem Sounds-Ordner keine beliebige
 * Datei herausgereicht werden, nur weil sie dort liegt.
 */
const FOLDERS: Record<MediaFolderId, { dir: string; extensions: string[] }> = {
  werbung: { dir: 'Werbung', extensions: IMAGE_EXTENSIONS },
  highlights: { dir: 'Highlights', extensions: IMAGE_EXTENSIONS },
  sounds: { dir: 'Sounds', extensions: AUDIO_EXTENSIONS },
  // Wettbewerbslogos gibt es oft nur als Vektordatei -- deshalb auch SVG.
  wettbewerbe: { dir: 'Wettbewerbe', extensions: [...IMAGE_EXTENSIONS, '.svg'] },
};

export class MediaLibrary {
  private roots: Record<MediaFolderId, string>;
  private files: Record<MediaFolderId, string[]> = {
    werbung: [],
    highlights: [],
    sounds: [],
    wettbewerbe: [],
  };

  /**
   * Ohne Argument werden die Ordner wie üblich gesucht
   * (`resolveDataFolder`). Die Tests geben stattdessen eigene
   * Wegwerf-Ordner vor: Ohne das griffen sie auf den
   * Entwicklungspfad `D:\\Anzeigetafel\\Vereinsdaten\\Werbung` durch --
   * also auf die echten Vereinsdaten.
   */
  constructor(roots?: Partial<Record<MediaFolderId, string>>) {
    this.roots = {
      werbung: roots?.werbung ?? resolveDataFolder(FOLDERS.werbung.dir),
      highlights: roots?.highlights ?? resolveDataFolder(FOLDERS.highlights.dir),
      sounds: roots?.sounds ?? resolveDataFolder(FOLDERS.sounds.dir),
      wettbewerbe: roots?.wettbewerbe ?? resolveDataFolder(FOLDERS.wettbewerbe.dir),
    };
    this.scan();
  }

  /**
   * Liest die Ordner neu ein. Wird beim Start und über „Medien neu
   * einlesen" aufgerufen -- so lassen sich am Spieltag noch Motive
   * nachlegen, ohne die App neu zu starten.
   */
  scan(): void {
    for (const id of MEDIA_FOLDER_IDS) {
      this.files[id] = listFiles(this.roots[id], FOLDERS[id].extensions);
    }
  }

  getLists(): MediaLists {
    const info = (id: MediaFolderId): MediaFolderInfo => ({
      rootPath: this.roots[id],
      // Kopie: Der Zustand ist ansonsten unveränderlich, und ein
      // durchgereichtes Array ließe sich von außen umsortieren.
      files: [...this.files[id]],
    });
    return {
      werbung: info('werbung'),
      highlights: info('highlights'),
      sounds: info('sounds'),
      wettbewerbe: info('wettbewerbe'),
    };
  }

  getRootPath(id: MediaFolderId): string {
    return this.roots[id];
  }

  /**
   * Löst einen Dateinamen aus einer `svh-media:`-URL zu einem echten Pfad
   * auf -- oder zu `null`, wenn er nicht in den Ordner gehört.
   *
   * Doppelt abgesichert, obwohl die URL aus dem eigenen Anzeigefenster
   * stammt: Der Dateiname selbst kommt aus dem Dateisystem, und ein
   * `..` darin dürfte nie dazu führen, dass das Anzeigefenster beliebige
   * Dateien der Platte anfordern kann.
   */
  resolveFile(id: MediaFolderId, fileName: string): string | null {
    const root = this.roots[id];
    // basename() entfernt jeden Pfadanteil -- damit ist Traversal schon
    // hier erledigt.
    const safeName = path.basename(fileName);
    if (safeName === '' || safeName === '.' || safeName === '..') return null;
    if (!FOLDERS[id].extensions.includes(path.extname(safeName).toLowerCase())) return null;

    const target = path.resolve(root, safeName);
    // Gürtel und Hosenträger: Auch nach basename() noch prüfen, dass das
    // Ergebnis wirklich im Ordner liegt.
    const relative = path.relative(path.resolve(root), target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;

    try {
      if (!fs.statSync(target).isFile()) return null;
    } catch {
      return null;
    }
    return target;
  }
}

/**
 * Passende Dateien eines Ordners, alphabetisch. Die Reihenfolge auf der
 * Tafel ergibt sich damit aus dem Dateinamen -- `01_`, `02_` … ist die
 * vorgesehene Pflege.
 */
function listFiles(dir: string, extensions: string[]): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && extensions.includes(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'de'));
  } catch {
    // Ordner gibt es nicht -- das ist der Normalfall, solange der Verein
    // noch keine Werbemotive hinterlegt hat.
    return [];
  }
}
