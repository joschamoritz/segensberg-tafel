import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_ATTENDANCE_MESSAGE,
  DEFAULT_SOUND_SETTINGS,
  SlideBlocks,
  SoundSettings,
} from '../shared/types';
import { readJsonFile } from './configFile';

/**
 * Redaktionelle Inhalte, die auf der Tafel erscheinen, aber weder zu einer
 * Mannschaft noch zu einem einzelnen Spiel gehören: Dankestext an die
 * Zuschauer, später Termine und Ankündigungen für die Halbzeitpause.
 *
 * Bewusst eine eigene Datei neben `teams.json`: Dort stehen laut README
 * die Mannschaftsstammdaten, und ein Vereinswechsel oder ein Zurücksetzen
 * der Team-Konfiguration darf die redaktionellen Texte nicht mitnehmen.
 */
export interface ContentConfig {
  /** siehe `splitAttendanceMessage` in shared/types.ts */
  attendanceMessage: string;
  /** Ankündigungen für die Halbzeitpause, eine je Eintrag */
  announcements: string[];
  /** Lautstärke und Stummschaltung der Tonausgabe */
  sound: SoundSettings;
  /** Abgehakte Blöcke der Diashow -- geprüft wird in `sanitizeSlideBlocks` */
  slideBlocks?: SlideBlocks;
  /** Ablauf der Aufstellung -- geprüft wird in `sanitizeLineupStyle` */
  lineupStyle?: unknown;
  /** Grundordnung der Spielfeld-Aufstellung -- geprüft in `sanitizeFormation` */
  formation?: unknown;
}

function defaults(): ContentConfig {
  return {
    attendanceMessage: DEFAULT_ATTENDANCE_MESSAGE,
    announcements: [],
    sound: { ...DEFAULT_SOUND_SETTINGS },
  };
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'content.json');
}

/**
 * Fehlende oder kaputte Datei ergibt die Vorgabewerte -- ein leerer
 * Dankestext auf der Tafel wäre schlimmer als der Standardsatz.
 */
export function loadContentConfig(): ContentConfig {
  const fallback = defaults();
  const raw = readJsonFile(configPath());
  if (!raw || typeof raw !== 'object') return fallback;
  const parsed = raw as Partial<ContentConfig>;
  return {
    attendanceMessage:
      typeof parsed.attendanceMessage === 'string' && parsed.attendanceMessage.trim() !== ''
        ? parsed.attendanceMessage
        : fallback.attendanceMessage,
    // Einzeln geprüft: Eine von Hand bearbeitete Datei könnte hier auch
    // Zahlen oder Objekte stehen haben, und die landeten sonst auf der
    // Tafel.
    announcements: Array.isArray(parsed.announcements)
      ? parsed.announcements.filter((entry): entry is string => typeof entry === 'string')
      : fallback.announcements,
    sound: {
      volume:
        typeof parsed.sound?.volume === 'number' && Number.isFinite(parsed.sound.volume)
          ? Math.min(100, Math.max(0, Math.round(parsed.sound.volume)))
          : fallback.sound.volume,
      muted: parsed.sound?.muted === true,
    },
    slideBlocks: parsed.slideBlocks,
    lineupStyle: parsed.lineupStyle,
    formation: parsed.formation,
  };
}

/**
 * Schreibt über eine temporäre Datei und benennt sie anschließend um --
 * wie `saveTeamsConfig()`. Fehler dürfen den Spielbetrieb nicht
 * unterbrechen.
 */
export function saveContentConfig(config: ContentConfig): void {
  try {
    const target = configPath();
    const temp = `${target}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(temp, target);
  } catch (error) {
    console.error('content.json konnte nicht gespeichert werden:', error);
  }
}
