import {
  BoardSize,
  CardColor,
  DEFAULT_APPEARANCE,
  DEFAULT_BOARD_SIZE,
  DISPLAY_THEMES,
  DisplayAppearance,
  DisplayTheme,
  FLUTLICHT_EFFECT_KEYS,
  FlutlichtEffects,
  InfoOverlay,
  MAX_ANNOUNCEMENT_LENGTH,
  MAX_ANNOUNCEMENTS,
  MAX_ATTENDANCE,
  MAX_BOARD_EDGE,
  MIN_BOARD_EDGE,
  Player,
  PlayerRole,
  RETRO_COLORS,
  RetroColor,
  TeamId,
} from '../shared/types';

/**
 * Prüfschicht zwischen IPC und Zustand.
 *
 * Die Nachrichten kommen zwar aus dem eigenen Steuerungsfenster, aber die
 * Werte darin stammen aus Eingabefeldern: Ein leeres Zahlenfeld liefert
 * `NaN`, ein eingefügter Text kann beliebig lang sein, und eine negative
 * Trikotnummer landete bisher ungeprüft auf der Anzeigetafel.
 */

/** Trikotnummern im Amateurbereich. 0 zugelassen, kommt bei Turnieren vor. */
const MIN_NUMBER = 0;
const MAX_NUMBER = 99;

const MAX_NAME_LENGTH = 40;
const MAX_POSITION_LENGTH = 24;

/** Obergrenze für einen eingefügten Kader -- ein versehentlich kopierter
    Zeitungsartikel soll nicht 5000 leere Zeilen anlegen. */
const MAX_SQUAD_SIZE = 60;

const ROLES: PlayerRole[] = ['start', 'bench', 'out'];
const CARDS: CardColor[] = ['yellow', 'yellow-red', 'red'];

export function isTeamId(value: unknown): value is TeamId {
  return value === 'home' || value === 'away';
}

export function isCardColor(value: unknown): value is CardColor {
  return typeof value === 'string' && CARDS.includes(value as CardColor);
}

export function isEventId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Anforderung einer Einblendung. Die Art muss bekannt sein, sonst stünde
 * auf der Tafel eine leere Leiste; bei einer Karte muss zusätzlich eine
 * brauchbare Ereignis-Id dabei sein.
 */
export function isInfoOverlay(value: unknown): value is InfoOverlay {
  if (!value || typeof value !== 'object') return false;
  const overlay = value as Record<string, unknown>;
  if (overlay.kind === 'corners' || overlay.kind === 'attendance') return true;
  return (overlay.kind === 'card' || overlay.kind === 'sub') && isEventId(overlay.eventId);
}

/**
 * Zuschauerzahl. Ein leeres Feld bedeutet "keine Angabe" und ergibt
 * `null` -- ein `NaN` aus einem halb geleerten Zahlenfeld darf nicht als
 * Zuschauerzahl auf der Tafel landen.
 */
export function sanitizeAttendance(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(MAX_ATTENDANCE, Math.max(0, Math.round(parsed)));
}

/**
 * Ankündigungen für die Halbzeitpause. Kommen als Textblock aus einem
 * Textfeld, eine Zeile je Ankündigung -- leere Zeilen fallen raus, damit
 * ein Absatz im Eingabefeld keine leere Folienzeile erzeugt.
 */
export function sanitizeAnnouncements(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => sanitizeText(entry, MAX_ANNOUNCEMENT_LENGTH))
    .filter((entry) => entry !== '')
    .slice(0, MAX_ANNOUNCEMENTS);
}

/** Optionale Spieler-Id: leerer Wert bedeutet "keine Zuordnung". */
export function sanitizeOptionalId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, 64);
}

export function sanitizeText(value: unknown, maxLength = MAX_NAME_LENGTH): string {
  if (typeof value !== 'string') return '';
  // Zeilenumbrüche aus eingefügtem Text würden das Layout der Tafel
  // zerreißen.
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * Trikotnummer. Alles, was keine sinnvolle Nummer ist -- leeres Feld,
 * `NaN`, negative oder absurd große Werte --, wird zu `null` und damit zu
 * "keine Nummer eingetragen".
 */
export function sanitizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < MIN_NUMBER || rounded > MAX_NUMBER) return null;
  return rounded;
}

function sanitizeRole(value: unknown): PlayerRole {
  return ROLES.includes(value as PlayerRole) ? (value as PlayerRole) : 'out';
}

/** Spielerfelder ohne Id -- gemeinsam für Bearbeiten und Importieren. */
function sanitizeFields(raw: Record<string, unknown>): Omit<Player, 'id'> {
  return {
    number: sanitizeNumber(raw.number),
    firstName: sanitizeText(raw.firstName),
    lastName: sanitizeText(raw.lastName),
    position: sanitizeText(raw.position, MAX_POSITION_LENGTH),
    role: sanitizeRole(raw.role),
    isGoalkeeper: raw.isGoalkeeper === true,
    isCaptain: raw.isCaptain === true,
    // Bilddaten stammen aus `images.ts`, nicht aus der Eingabemaske --
    // hier unverändert durchreichen.
    photoDataUrl: typeof raw.photoDataUrl === 'string' ? raw.photoDataUrl : undefined,
  };
}

/** Ein bearbeiteter Spieler. Ohne brauchbare Id gibt es nichts zu ändern. */
export function sanitizePlayer(raw: unknown): Player | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = sanitizeOptionalId(record.id);
  if (!id) return null;
  return { id, ...sanitizeFields(record) };
}

/** Eingefügte oder aus einer Datei geladene Aufstellung. */
export function sanitizeImportedPlayers(raw: unknown): Omit<Player, 'id'>[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_SQUAD_SIZE)
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map(sanitizeFields);
}

/**
 * Auflösung der Anzeigefläche.
 *
 * Kommt aus zwei Zahlenfeldern und wird von der Anzeige als Bühnengröße
 * verwendet -- eine 0, ein `NaN` aus einem halb geleerten Feld oder ein
 * Vertipper wie `38400` machten die Tafel unbenutzbar. Unbrauchbare
 * Einzelwerte fallen deshalb auf die Herstellerangabe zurück, statt die
 * ganze Eingabe zu verwerfen: Wer nur die Höhe ändert, soll die Breite
 * nicht mitkorrigieren müssen.
 */
function sanitizeBoardEdge(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < MIN_BOARD_EDGE || rounded > MAX_BOARD_EDGE) return fallback;
  return rounded;
}

export function sanitizeBoardSize(value: unknown): BoardSize {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    width: sanitizeBoardEdge(raw.width, DEFAULT_BOARD_SIZE.width),
    height: sanitizeBoardEdge(raw.height, DEFAULT_BOARD_SIZE.height),
  };
}

/**
 * Gestaltung der Anzeige. Kommt aus dem Steuerungsfenster und aus
 * `teams.json`, die von Hand bearbeitet worden sein kann.
 *
 * Ein unbekanntes Design fällt auf Klassisch zurück, ein fehlender oder
 * unbrauchbarer Effektschalter auf "an". So bleibt eine ältere
 * `teams.json` ohne dieses Feld gültig, und ein Tippfehler im Namen
 * eines Effekts schaltet nicht still die übrigen ab.
 */
export function sanitizeAppearance(value: unknown): DisplayAppearance {
  const raw = (value ?? {}) as Record<string, unknown>;
  const theme = DISPLAY_THEMES.includes(raw.theme as DisplayTheme)
    ? (raw.theme as DisplayTheme)
    : DEFAULT_APPEARANCE.theme;

  const rawEffects = (raw.effects ?? {}) as Record<string, unknown>;
  const effects = { ...DEFAULT_APPEARANCE.effects };
  for (const key of FLUTLICHT_EFFECT_KEYS) {
    if (typeof rawEffects[key] === 'boolean') effects[key] = rawEffects[key] as boolean;
  }

  const retroColor = RETRO_COLORS.includes(raw.retroColor as RetroColor)
    ? (raw.retroColor as RetroColor)
    : DEFAULT_APPEARANCE.retroColor;

  return { theme, effects: effects as FlutlichtEffects, retroColor };
}

/**
 * Anstoßzeit als "HH:MM". Alles andere wird zu einem leeren Wert, damit
 * die Anzeige keinen unsinnigen Countdown rechnet.
 */
export function sanitizeKickoffTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (text === '') return '';
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
