import { nativeImage, NativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { LogoVariant } from '../shared/types';

/**
 * Maximale Kantenlängen. Die Anzeigetafel ist nur 384x192px groß, in der
 * Vorschau maximal Full-HD -- Originaldateien mit mehreren tausend Pixeln
 * (teils >800 KB) blähen nur die Konfigurationsdateien auf und bremsen das
 * Rendern.
 *
 * Portraits dürfen etwas größer sein als Logos: sie füllen bei der
 * Torschützen-Einblendung fast die gesamte Bildhöhe, während ein Wappen
 * nur einen kleinen Teil der Fläche einnimmt.
 */
const MAX_EDGE: Record<ImageKind, number> = {
  logo: 256,
  portrait: 320,
};

/** Qualität für Portraits im JPEG-Fall. Darunter werden Gesichter fleckig. */
const JPEG_QUALITY = 85;

export type ImageKind = 'logo' | 'portrait';

/**
 * Ab welcher mittleren Helligkeit ein Logo als "weiße Variante" gilt.
 * Gemessen wird nur über die undurchsichtigen Bildpunkte -- ein
 * freigestelltes Logo besteht sonst überwiegend aus Nichts.
 */
const WHITE_LUMINANCE_THRESHOLD = 170;

/**
 * Weiße oder farbige Logovariante?
 *
 * Erst der Dateiname: Die Vereinsdaten sind genau so sortiert
 * (`.../Weiß/Bertlich_Weiß.png` gegen `.../Farbe/Bertlich.png`), und das
 * ist die verlässlichste Auskunft, die es gibt. Sagt der Name nichts,
 * entscheidet die mittlere Helligkeit der Bildpunkte.
 *
 * Im Zweifel `white`, also ohne Kontrastfläche: Das entspricht dem Stand
 * vor dieser Unterscheidung. Eine weiße Fläche hinter einem weißen Logo
 * wäre der schlimmere Fehlgriff -- das Logo verschwände ganz.
 */
export function detectLogoVariant(filePath: string): LogoVariant {
  const name = path.basename(filePath).toLowerCase();
  if (/wei(ss|ß)|white/.test(name)) return 'white';
  if (/farbe|color/.test(name)) return 'color';

  // SVGs kann `nativeImage` nicht lesen -- dort bleibt es beim Zweifel.
  if (path.extname(filePath).toLowerCase() === '.svg') return 'white';

  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return 'white';

    // toBitmap() liefert BGRA.
    const bitmap = image.toBitmap();
    let summe = 0;
    let gezaehlt = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      if (bitmap[i + 3] < 128) continue;
      summe += 0.0722 * bitmap[i] + 0.7152 * bitmap[i + 1] + 0.2126 * bitmap[i + 2];
      gezaehlt++;
    }
    if (gezaehlt === 0) return 'white';
    return summe / gezaehlt >= WHITE_LUMINANCE_THRESHOLD ? 'white' : 'color';
  } catch {
    return 'white';
  }
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/**
 * Ist das Bild irgendwo durchsichtig?
 *
 * Entscheidend für die Wahl des Speicherformats: JPEG kennt keinen
 * Alphakanal und legt transparente Bereiche schwarz an. Ein freigestelltes
 * Spielerportrait bekäme damit einen sichtbaren Kasten, weil die
 * Torschützen-Einblendung (`.spotlight-photo`) keinen eigenen Hintergrund
 * hat, auf dem der Rand aufginge.
 *
 * `toBitmap()` liefert BGRA -- jedes vierte Byte ist der Alphawert.
 */
function hasTransparency(image: NativeImage): boolean {
  const bitmap = image.toBitmap();
  for (let i = 3; i < bitmap.length; i += 4) {
    if (bitmap[i] !== 255) return true;
  }
  return false;
}

/**
 * Liest eine Bilddatei als data:-URL und verkleinert sie dabei auf eine
 * sinnvolle Anzeigegröße. SVGs bleiben unverändert -- sie sind bereits
 * klein, skalieren verlustfrei, und `nativeImage` kann sie nicht lesen.
 *
 * Das Speicherformat richtet sich nach dem Inhalt: Wappen bleiben immer PNG
 * (sie leben von ihrer Transparenz). Portraits werden als JPEG abgelegt --
 * für Fotos um ein Vielfaches kleiner als PNG --, aber nur, wenn sie
 * tatsächlich undurchsichtig sind. Freigestellte Portraits bleiben PNG.
 */
export function readImageAsDataUrl(
  filePath: string,
  kind: ImageKind = 'logo'
): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return undefined;

  try {
    if (ext === '.svg') {
      return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
    }

    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return undefined;

    const maxEdge = MAX_EDGE[kind];
    const { width, height } = image.getSize();
    const longestEdge = Math.max(width, height);
    const resized =
      longestEdge > maxEdge
        ? image.resize(
            width >= height
              ? { width: maxEdge, quality: 'best' }
              : { height: maxEdge, quality: 'best' }
          )
        : image;

    if (kind === 'portrait' && !hasTransparency(resized)) {
      return `data:image/jpeg;base64,${resized.toJPEG(JPEG_QUALITY).toString('base64')}`;
    }

    return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
  } catch {
    return undefined;
  }
}
