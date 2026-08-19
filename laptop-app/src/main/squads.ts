import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Player } from '../shared/types';

/**
 * Kader werden **pro Verein** gespeichert, nicht pro Heim/Gast-Platz: In
 * einer Liga trifft man jeden Gegner zweimal pro Saison -- beim Rückspiel
 * ist der Kader dann schon da und muss nicht neu eingetippt werden.
 */
export interface ClubSquad {
  players: Player[];
  coach: string;
}

/** Altformat (nur Spielerliste) wird beim Lesen mit übersetzt. */
type StoredSquad = ClubSquad | Player[];
type SquadsByClub = Record<string, StoredSquad>;

function configPath(): string {
  return path.join(app.getPath('userData'), 'squads.json');
}

/**
 * Ergänzt Felder, die in älteren gespeicherten Kadern noch fehlen -- so
 * bleiben bereits erfasste Mannschaften nach einem Update nutzbar.
 */
function normalizePlayer(player: Partial<Player> & { id: string }): Player {
  // Bewusst die gespeicherten Werte über die Vorgaben legen statt Feld für
  // Feld aufzuzählen: Beim Aufzählen fiel schon einmal ein neu ergänztes
  // Feld (das Spielerportrait) still unter den Tisch.
  return {
    number: null,
    firstName: '',
    lastName: '',
    position: '',
    role: 'out',
    isGoalkeeper: false,
    isCaptain: false,
    ...player,
  };
}

export class SquadStore {
  private byClub: SquadsByClub = {};

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      this.byClub = JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as SquadsByClub;
    } catch {
      this.byClub = {};
    }
  }

  private save(): void {
    try {
      // Erst in eine temporäre Datei, dann umbenennen -- ein Absturz mitten
      // im Schreiben würde sonst alle gespeicherten Kader zerstören.
      const target = configPath();
      const temp = `${target}.tmp`;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(this.byClub, null, 2), 'utf-8');
      fs.renameSync(temp, target);
    } catch (error) {
      // Schreibfehler dürfen den Spielbetrieb nicht unterbrechen -- der
      // Kader bleibt dann nur für diese Sitzung erhalten.
      console.error('squads.json konnte nicht gespeichert werden:', error);
    }
  }

  get(clubName: string): ClubSquad {
    const stored = this.byClub[clubName];
    if (!stored) return { players: [], coach: '' };
    // Altformat: reine Spielerliste ohne Trainer
    if (Array.isArray(stored)) return { players: stored.map(normalizePlayer), coach: '' };
    return {
      players: (stored.players ?? []).map(normalizePlayer),
      coach: stored.coach ?? '',
    };
  }

  /** Alle gespeicherten Kadernamen -- z. B. "SV Hochlar 28", "… II", "… U19". */
  listNames(): string[] {
    return Object.keys(this.byClub).sort((a, b) => a.localeCompare(b, 'de'));
  }

  set(clubName: string, squad: ClubSquad): void {
    if (!clubName.trim()) return;
    this.byClub[clubName] = squad;
    this.save();
  }
}
