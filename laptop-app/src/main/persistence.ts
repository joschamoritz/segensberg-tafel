import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  BoardSize,
  DEFAULT_APPEARANCE,
  DisplayAppearance,
  DEFAULT_BOARD_SIZE,
  DEFAULT_HALF_DURATION_MIN,
  LogoVariant,
  MatchState,
  TeamState,
} from '../shared/types';
import { readJsonFile } from './configFile';

export interface PersistedTeamInfo {
  name: string;
  shortName: string;
  logoDataUrl?: string;
  /** siehe `LogoVariant` -- entscheidet über die Kontrastfläche */
  logoVariant?: LogoVariant;
  /** Kurzname für das Retro-Design, leer = automatisch */
  retroName?: string;
}

export interface TeamsConfig {
  home: PersistedTeamInfo;
  away: PersistedTeamInfo;
  /** Wurzelordner der Vereinslogo-Bibliothek (siehe teamLibrary.ts) */
  logoLibraryPath?: string;
  /** Halbzeitdauer in Minuten -- gilt für den Verein, nicht für ein Spiel */
  halfDurationMin?: number;
  /** Auflösung der Anzeigefläche, siehe `BoardSize`. Gehört zum Gerät --
      deshalb hier und nicht in `live-match.json`. */
  board?: BoardSize;
  /** Gestaltung der Anzeige, siehe `DisplayAppearance`. Gerät, nicht Spiel. */
  appearance?: DisplayAppearance;
  /** Gewählter Wettbewerb, siehe `MatchState.competition`. */
  competition?: string | null;
}

/**
 * Was aus dem Zustand nach `teams.json` wandert: Stammdaten und
 * Geräteeinstellungen, nichts vom laufenden Spiel. Der Trainer gehört zum
 * Kader und steht in `squads.json`. Hier statt in `main.ts`, damit ein
 * vergessenes Feld im Test auffällt (Review 2026-10, T4).
 */
export function teamsConfigFromState(state: MatchState, logoLibraryPath: string): TeamsConfig {
  const team = (t: TeamState): PersistedTeamInfo => ({
    name: t.name,
    shortName: t.shortName,
    logoDataUrl: t.logoDataUrl,
    logoVariant: t.logoVariant,
    retroName: t.retroName,
  });
  return {
    home: team(state.home),
    away: team(state.away),
    logoLibraryPath,
    halfDurationMin: state.halfDurationMin,
    board: state.board,
    appearance: state.appearance,
    competition: state.competition,
  };
}

/**
 * Mögliche Orte eines Ordners unter `Vereinsdaten/`, in der Reihenfolge,
 * in der gesucht wird. Diese Ordner liegen bewusst außerhalb der App,
 * weil dort laufend neue Dateien dazukommen (Vereinslogos, Werbemotive,
 * Vereinsfotos).
 *
 * Ein fest verdrahteter Pfad funktionierte nur auf dem
 * Entwicklungsrechner: Auf dem Spieltags-Laptop gibt es kein D:-Laufwerk,
 * und das Vereins-Dropdown blieb dort kommentarlos leer.
 */
function dataFolderCandidates(folderName: string): string[] {
  // Bei der portablen Fassung liegt die .exe auf dem USB-Stick; Electron
  // entpackt sich in ein temporäres Verzeichnis und meldet dieses als
  // getPath('exe'), deshalb die Umgebungsvariable zuerst.
  const appDir = process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(app.getPath('exe'));

  return [
    // Neben der Anwendung -- so wandern die Vereinsdaten mit dem Stick mit
    path.join(appDir, 'Vereinsdaten', folderName),
    // Dauerhafte Ablage auf dem Spieltags-Laptop
    path.join(app.getPath('documents'), 'Anzeigetafel', 'Vereinsdaten', folderName),
    // Entwicklungsrechner
    path.join('D:\\Anzeigetafel\\Vereinsdaten', folderName),
  ];
}

/**
 * Erster Kandidat, den es wirklich gibt. Existiert keiner, wird der
 * Dokumente-Pfad als Vorschlag zurückgegeben -- das Steuerungsfenster
 * meldet dann deutlich, dass dort nichts gefunden wurde, statt ein leeres
 * Dropdown zu zeigen.
 */
export function resolveDataFolder(folderName: string): string {
  const candidates = dataFolderCandidates(folderName);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Kandidat gibt es nicht -- nächsten probieren.
    }
  }
  return candidates[1];
}

export function resolveDefaultLibraryPath(): string {
  return resolveDataFolder('Liga-Logos');
}

/**
 * Diese App wird nur für einen einzigen Verein gebaut -- das Heim-Team ist
 * also immer SV Hochlar 28. Der Standardwert ist deshalb fest im Code
 * hinterlegt (inkl. Logo aus assets/heim-logo.png), bleibt in der UI aber
 * editierbar, falls sich mal etwas ändert (Logo-Update, Tippfehler).
 */
function loadDefaultHomeLogo(): string | undefined {
  try {
    const assetPath = path.join(__dirname, '..', '..', 'assets', 'heim-logo.png');
    const buffer = fs.readFileSync(assetPath);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return undefined;
  }
}

/**
 * Als Funktion statt als Konstante: `resolveDefaultLibraryPath()` fragt
 * Electron nach Anwendungs- und Dokumentenordner, und das darf erst
 * laufen, wenn die App bereit ist -- nicht schon beim Laden des Moduls.
 */
function defaults(): TeamsConfig {
  return {
    home: {
      name: 'SV Hochlar 28',
      shortName: 'SVH',
      logoDataUrl: loadDefaultHomeLogo(),
      // `heim-logo.png` ist die weiße Variante -- keine Kontrastfläche.
      logoVariant: 'white',
    },
    away: { name: 'Gast', shortName: 'GAST' },
    logoLibraryPath: resolveDefaultLibraryPath(),
    halfDurationMin: DEFAULT_HALF_DURATION_MIN,
    board: { ...DEFAULT_BOARD_SIZE },
    appearance: { ...DEFAULT_APPEARANCE, effects: { ...DEFAULT_APPEARANCE.effects } },
  };
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'teams.json');
}

/**
 * Team-Stammdaten (Name, Kürzel, Logo) überleben einen Neustart der App.
 * Spielstand/Uhr werden bewusst NICHT persistiert -- die starten bei jedem
 * Programmstart wieder bei null, wie bei einer klassischen Anzeigetafel.
 */
export function loadTeamsConfig(): TeamsConfig {
  const fallback = defaults();
  const raw = readJsonFile(configPath());
  if (!raw || typeof raw !== 'object') return fallback;
  const parsed = raw as Partial<TeamsConfig>;
  return {
    home: { ...fallback.home, ...parsed.home },
    away: { ...fallback.away, ...parsed.away },
    logoLibraryPath: parsed.logoLibraryPath ?? fallback.logoLibraryPath,
    halfDurationMin: parsed.halfDurationMin ?? fallback.halfDurationMin,
    board: parsed.board ?? fallback.board,
    appearance: parsed.appearance ?? fallback.appearance,
    competition: parsed.competition ?? null,
  };
}

/**
 * Schreibt über eine temporäre Datei und benennt sie anschließend um.
 * Ein Absturz mitten im Schreiben hinterlässt sonst eine abgeschnittene
 * Datei -- beim nächsten Start wären alle Stammdaten kommentarlos weg.
 * Fehler dürfen den Spielbetrieb nicht unterbrechen.
 */
export function saveTeamsConfig(config: TeamsConfig): void {
  try {
    const target = configPath();
    const temp = `${target}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(temp, target);
  } catch (error) {
    console.error('teams.json konnte nicht gespeichert werden:', error);
  }
}
