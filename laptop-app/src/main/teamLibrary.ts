import * as fs from 'fs';
import * as path from 'path';
import { LibraryTeam, LogoVariant } from '../shared/types';
import { readImageAsDataUrl } from './images';

/**
 * Liest die Vereinslogos aus einer Ordnerstruktur
 *
 *   <Wurzel>/<Liga>/Farbe/<Verein>.png
 *   <Wurzel>/<Liga>/Weiß/<Verein>_weiß.png
 *
 * Bewusst dynamisch statt fest verdrahtet: Es kommen laufend Vereine dazu,
 * und pro Saison ändert sich die Liga. Neue Logos einfach in den Ordner
 * legen -- die App findet sie beim nächsten Einlesen.
 */

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];

/** Farbvariante. Weiß passt auf den blauen Anzeigen-Hintergrund. */
const WHITE_DIRS = ['weiß', 'weiss', 'white'];
const COLOR_DIRS = ['farbe', 'color'];

interface TeamEntry {
  name: string;
  league: string;
  whitePath?: string;
  colorPath?: string;
}

/** Entfernt Farb- und Variantenkennungen aus dem Dateinamen. */
function cleanTeamName(fileName: string): string {
  let name = path.basename(fileName, path.extname(fileName));
  // Farbkennungen: "_weiß", "_Weiß", "_BlauNeu", ...
  name = name.replace(/[_\s]*(weiß|weiss|white|farbe|color|blauneu|blau|indigo)\s*\d*$/i, '');
  return name.trim();
}

/**
 * Hängt an einen Namen noch eine Variantennummer? "SG Herne 70_weiß2" und
 * "VfB Börnig_weiß 2" sind Dublettten derselben Mannschaft. Achtung: bei
 * Namen wie "Firtinaspor Marl 2" kann die 2 auch die zweite Mannschaft
 * meinen -- deshalb wird nur zusammengeführt, wenn es den Namen ohne
 * Nummer ebenfalls gibt.
 */
function stripVariantSuffix(name: string): string {
  return name.replace(/[_\s]+\d+$/, '').trim();
}

function listImages(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && IMAGE_EXTENSIONS.includes(path.extname(e.name).toLowerCase()))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function scanLeague(leagueDir: string, league: string): TeamEntry[] {
  const byName = new Map<string, TeamEntry>();

  const subDirs = (() => {
    try {
      return fs.readdirSync(leagueDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      return [];
    }
  })();

  for (const sub of subDirs) {
    const lower = sub.name.toLowerCase();
    const isWhite = WHITE_DIRS.includes(lower);
    const isColor = COLOR_DIRS.includes(lower);
    if (!isWhite && !isColor) continue;

    for (const file of listImages(path.join(leagueDir, sub.name))) {
      const name = cleanTeamName(file);
      if (!name) continue;
      const entry = byName.get(name) ?? { name, league };
      // Erste gefundene Datei gewinnt -- Dubletten ("_2") ignorieren wir.
      if (isWhite && !entry.whitePath) entry.whitePath = file;
      if (isColor && !entry.colorPath) entry.colorPath = file;
      byName.set(name, entry);
    }
  }

  // Variantennamen ("… 2") auf den Basisnamen zusammenführen, sofern dieser
  // ebenfalls existiert.
  for (const [name, entry] of [...byName]) {
    const base = stripVariantSuffix(name);
    if (base === name || !byName.has(base)) continue;
    const target = byName.get(base)!;
    if (!target.whitePath && entry.whitePath) target.whitePath = entry.whitePath;
    if (!target.colorPath && entry.colorPath) target.colorPath = entry.colorPath;
    byName.delete(name);
  }

  return [...byName.values()];
}

export class TeamLibrary {
  private entries: TeamEntry[] = [];

  constructor(private rootPath: string) {
    this.reload();
  }

  getRootPath(): string {
    return this.rootPath;
  }

  setRootPath(rootPath: string): void {
    this.rootPath = rootPath;
    this.reload();
  }

  reload(): void {
    this.entries = [];
    let leagueDirs: fs.Dirent[];
    try {
      leagueDirs = fs.readdirSync(this.rootPath, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      return;
    }
    for (const league of leagueDirs) {
      this.entries.push(...scanLeague(path.join(this.rootPath, league.name), league.name));
    }
    this.entries.sort((a, b) => a.league.localeCompare(b.league) || a.name.localeCompare(b.name, 'de'));
  }

  list(): LibraryTeam[] {
    return this.entries.map((e) => ({ id: `${e.league}/${e.name}`, name: e.name, league: e.league }));
  }

  /**
   * Logo als data:-URL, dazu die Farbvariante. Bevorzugt wird die weiße,
   * weil die Anzeige einen blauen Hintergrund hat; sonst die farbige.
   *
   * Die Variante kommt hier direkt aus der Ordnerstruktur und muss nicht
   * geraten werden -- die Bibliothek weiß ja, aus welchem der beiden
   * Ordner sie die Datei genommen hat. Hinter einer farbigen Variante
   * legt die Anzeige eine weiße Kontrastfläche.
   */
  getLogo(id: string): { dataUrl: string; variant: LogoVariant } | undefined {
    const entry = this.entries.find((e) => `${e.league}/${e.name}` === id);
    const white = entry?.whitePath;
    const file = white ?? entry?.colorPath;
    if (!file) return undefined;
    const dataUrl = readImageAsDataUrl(file);
    if (!dataUrl) return undefined;
    return { dataUrl, variant: white ? 'white' : 'color' };
  }

  getName(id: string): string | undefined {
    return this.entries.find((e) => `${e.league}/${e.name}` === id)?.name;
  }
}
