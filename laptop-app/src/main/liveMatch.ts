import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  LiveMatchSnapshot,
  MatchPhase,
  MatchState,
  MAX_SHOOTOUT_KICKS,
  Shootout,
  ShootoutKick,
} from '../shared/types';

/**
 * Sicherung des laufenden Spiels.
 *
 * Spielstand, Uhr und Chronik lebten bisher ausschließlich im
 * Arbeitsspeicher -- ein Fehlklick aufs Fensterkreuz, ein leerer Akku oder
 * ein Absturz löschte mitten im Spiel alles. Hier landet der Spielstand
 * deshalb gedrosselt auf der Platte, damit die App danach dort weitermachen
 * kann, wo sie aufgehört hat.
 */

/**
 * Älter als das ist ein gefundenes Spiel offensichtlich nicht mehr das
 * laufende, sondern das vom letzten Spieltag. Dann startet die App wortlos
 * neu, statt beim Training mit einer Rückfrage im Weg zu stehen.
 */
export const RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function filePath(): string {
  return path.join(app.getPath('userData'), 'live-match.json');
}

/**
 * Es gibt nur dann etwas zu retten, wenn das Spiel tatsächlich begonnen hat
 * oder bereits Ereignisse eingetragen sind. Vereinsnamen, Logos und Kader
 * stehen ohnehin in `teams.json`/`squads.json`.
 */
export function isWorthSaving(state: MatchState): boolean {
  return state.phase !== 'pre-match' || state.events.length > 0;
}

export function toSnapshot(state: MatchState): LiveMatchSnapshot {
  return {
    version: 1,
    savedAt: Date.now(),
    home: {
      name: state.home.name,
      shortName: state.home.shortName,
      score: state.home.score,
      coach: state.home.coach,
    },
    away: {
      name: state.away.name,
      shortName: state.away.shortName,
      score: state.away.score,
      coach: state.away.coach,
    },
    half: state.half,
    phase: state.phase,
    elapsedMs: state.clock.elapsedMs,
    events: state.events,
    halfDurationMin: state.halfDurationMin,
    kickoffTime: state.kickoffTime,
    stoppageMinutes: state.stoppageMinutes,
    corners: state.corners,
    attendance: state.attendance,
    shootout: state.shootout,
  };
}

/**
 * Schreibt über eine temporäre Datei und benennt sie anschließend um --
 * genau wie `saveTeamsConfig()`. Ein Absturz mitten im Schreiben hinterlässt
 * sonst eine abgeschnittene Datei, und ausgerechnet die Rettungsleine wäre
 * dann unbrauchbar. Fehler dürfen den Spielbetrieb nie unterbrechen.
 */
export function saveLiveMatch(state: MatchState): void {
  try {
    const target = filePath();
    const temp = `${target}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(toSnapshot(state)), 'utf-8');
    fs.renameSync(temp, target);
  } catch (error) {
    console.error('live-match.json konnte nicht gespeichert werden:', error);
  }
}

export function clearLiveMatch(): void {
  try {
    fs.rmSync(filePath(), { force: true });
  } catch (error) {
    console.error('live-match.json konnte nicht gelöscht werden:', error);
  }
}

const PHASES: MatchPhase[] = ['pre-match', 'live', 'half-time', 'full-time'];

/** Zählerwert aus einer Sicherung; alles Unbrauchbare wird zu 0. */
function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/** Elfmeterschießen aus einer Sicherung; alles Unbrauchbare wird zu null. */
function sanitizeShootout(value: unknown): Shootout | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const kicks = (list: unknown): ShootoutKick[] =>
    Array.isArray(list)
      ? list
          .filter((k): k is ShootoutKick => k === 'goal' || k === 'miss')
          .slice(0, MAX_SHOOTOUT_KICKS)
      : [];
  return { home: kicks(raw.home), away: kicks(raw.away), finished: raw.finished === true };
}

/**
 * Liest die Sicherung und prüft sie auf Plausibilität. Bei einer kaputten
 * oder fremden Datei wird `null` geliefert -- die App startet dann normal,
 * statt mit halben Daten in einen Folgefehler zu laufen.
 */
export function loadLiveMatch(): LiveMatchSnapshot | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf-8')) as Partial<LiveMatchSnapshot>;

    if (parsed.version !== 1) return null;
    if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) return null;
    if (typeof parsed.elapsedMs !== 'number' || !Number.isFinite(parsed.elapsedMs)) return null;
    if (parsed.half !== 1 && parsed.half !== 2) return null;
    if (!parsed.phase || !PHASES.includes(parsed.phase)) return null;
    if (!Array.isArray(parsed.events)) return null;
    if (!parsed.home || !parsed.away) return null;
    if (typeof parsed.home.score !== 'number' || typeof parsed.away.score !== 'number') return null;

    return {
      version: 1,
      savedAt: parsed.savedAt,
      home: parsed.home,
      away: parsed.away,
      half: parsed.half,
      phase: parsed.phase,
      elapsedMs: Math.max(0, parsed.elapsedMs),
      events: parsed.events,
      halfDurationMin:
        typeof parsed.halfDurationMin === 'number' && parsed.halfDurationMin > 0
          ? parsed.halfDurationMin
          : 45,
      kickoffTime: typeof parsed.kickoffTime === 'string' ? parsed.kickoffTime : '',
      // Erst später ergänzt -- ältere Sicherungen haben das Feld nicht.
      stoppageMinutes:
        typeof parsed.stoppageMinutes === 'number' && parsed.stoppageMinutes > 0
          ? parsed.stoppageMinutes
          : 0,
      // Ebenfalls später ergänzt. Einzeln geprüft statt das ganze Objekt
      // zu übernehmen: eine halb geschriebene Datei könnte hier auch
      // Text stehen haben, und der landete sonst auf der Tafel.
      corners: {
        home: sanitizeCount(parsed.corners?.home),
        away: sanitizeCount(parsed.corners?.away),
      },
      attendance:
        typeof parsed.attendance === 'number' && Number.isFinite(parsed.attendance)
          ? Math.max(0, Math.round(parsed.attendance))
          : null,
      // Ein Elfmeterschießen gibt es nur nach dem Abpfiff.
      shootout: parsed.phase === 'full-time' ? sanitizeShootout(parsed.shootout) : null,
    };
  } catch {
    // Auch "Datei gibt es nicht" landet hier -- der Normalfall.
    return null;
  }
}

/**
 * Ist die Sicherung frisch genug und gehört sie zu einem Spiel, das
 * tatsächlich lief? Nur dann lohnt die Rückfrage beim Start.
 */
export function isResumable(snapshot: LiveMatchSnapshot): boolean {
  if (snapshot.phase === 'pre-match') return false;
  return Date.now() - snapshot.savedAt <= RESUME_MAX_AGE_MS;
}
