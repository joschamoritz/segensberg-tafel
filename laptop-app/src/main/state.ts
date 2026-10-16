import {
  BoardSize,
  DEFAULT_APPEARANCE,
  DisplayAppearance,
  CardColor,
  CardEvent,
  SubstitutionEvent,
  ClockState,
  DEFAULT_ATTENDANCE_MESSAGE,
  DEFAULT_BOARD_SIZE,
  DEFAULT_HALF_DURATION_MIN,
  DEFAULT_SOUND_SETTINGS,
  GoalEvent,
  infoOverlayDurationMs,
  InfoOverlay,
  LINEUP_MAX_PAGES,
  LINEUP_PAGE_MS,
  LogoVariant,
  LiveMatchSnapshot,
  MatchEvent,
  MatchState,
  MAX_ATTENDANCE,
  MAX_ATTENDANCE_MESSAGE_LENGTH,
  MAX_CORNERS,
  MAX_STOPPAGE_MIN,
  MediaLists,
  Player,
  SoundSettings,
  SCORER_DISPLAY_MS,
  slideshowAvailable,
  StateRevisions,
  TeamId,
  toMatchMinute,
} from '../shared/types';
import { isCompleteSubstitution } from '../shared/substitutions';
import { TeamsConfig } from './persistence';

type Listener = (state: MatchState) => void;
type ClockListener = (clock: ClockState) => void;

const TICK_MS = 200;

/**
 * Obergrenze für ein einzelnes Uhr-Delta. Auch eine monotone Zeitquelle
 * liefert nach einem Standby oder unter Last große Sprünge -- ohne Deckel
 * landete die gesamte Pause auf der Spielzeit.
 */
const MAX_TICK_DELTA_MS = TICK_MS * 5;

/**
 * Kürzel aus einem Vereinsnamen ableiten -- dient nur als Rückfallebene,
 * falls für den Verein kein Logo hinterlegt ist. Nimmt die Anfangsbuchstaben
 * der Wörter ("SV Horst Emscher" -> "SHE"), bei einwortigen Namen die
 * ersten Zeichen ("Langenbochum" -> "LANGEN").
 */
function deriveShortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 6).toUpperCase();
  return words
    .map((w) => w[0])
    .join('')
    .slice(0, 6)
    .toUpperCase();
}

function initialState(): MatchState {
  return {
    home: { name: 'Heim', shortName: 'HEIM', score: 0, coach: '' },
    away: { name: 'Gast', shortName: 'GAST', score: 0, coach: '' },
    half: 1,
    phase: 'pre-match',
    clock: { elapsedMs: 0, running: false },
    events: [],
    squads: { home: [], away: [] },
    lineupRequest: null,
    scorerRequest: null,
    infoRequest: null,
    halfDurationMin: DEFAULT_HALF_DURATION_MIN,
    board: { ...DEFAULT_BOARD_SIZE },
    appearance: { ...DEFAULT_APPEARANCE, effects: { ...DEFAULT_APPEARANCE.effects } },
    kickoffTime: '',
    stoppageMinutes: 0,
    corners: { home: 0, away: 0 },
    attendance: null,
    attendanceMessage: DEFAULT_ATTENDANCE_MESSAGE,
    announcements: [],
    media: {
      werbung: { rootPath: '', files: [] },
      highlights: { rootPath: '', files: [] },
      sounds: { rootPath: '', files: [] },
      wettbewerbe: { rootPath: '', files: [] },
    },
    competition: null,
    slideshowRequest: null,
    sound: { ...DEFAULT_SOUND_SETTINGS },
    revisions: { teams: 0, squads: 0, events: 0 },
  };
}

/**
 * Rechnet die Zwischenstände der Chronik neu durch. Nötig, wenn ein Tor
 * nachträglich zurückgenommen wurde: alle danach gefallenen Tore hätten
 * sonst einen veralteten Zwischenstand gespeichert.
 */
export function recomputeStandings(events: MatchEvent[]): MatchEvent[] {
  let home = 0;
  let away = 0;
  return events.map((event) => {
    // Nur Tore verändern den Spielstand -- Karten bleiben unangetastet.
    if (event.type !== 'goal') return event;
    if (event.team === 'home') home++;
    else away++;
    return { ...event, scoreHome: home, scoreAway: away };
  });
}

/**
 * Einzige Quelle der Wahrheit für den Spielstand. Läuft im Main-Prozess,
 * damit Control- und Display-Fenster nie auseinanderlaufen können (kein
 * eigenständiges Client-seitiges Uhr-Ticking).
 */
export class MatchStateStore {
  private state: MatchState = initialState();
  private teams: TeamsConfig | undefined;

  private listeners: Listener[] = [];
  private clockListeners: ClockListener[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  /** läuft über die Lebensdauer des Prozesses weiter, auch über "Neues Spiel"
      hinaus -- so kann der Renderer bereits gesehene Ereignisse sicher
      unterscheiden und wiederholt keinen Jubel. */
  private nextEventId = 1;
  private nextLineupId = 1;
  private nextScorerId = 1;
  private nextInfoId = 1;
  private nextSlideshowId = 1;

  /**
   * Laufende Selbstabräumung der Einblendungen, je Art ein Eintrag.
   *
   * Ohne sie bliebe eine einmal gestellte Anfrage dauerhaft im Zustand
   * stehen. Ein neu geöffnetes Anzeigefenster kennt die Anfrage-Id noch
   * nicht und spielte die letzte Einblendung dann erneut ab -- mitten im
   * Spiel stünde plötzlich wieder ein alter Torschütze auf der Tafel.
   */
  private autoHideTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Uhrstand, an dem die 2. Halbzeit fortgesetzt werden soll.
   *
   * Nötig, weil sich zwei Fälle am Uhrstand allein nicht unterscheiden
   * lassen: Endet die 1. Halbzeit mit Nachspielzeit bei 48:00, muss die
   * 2. Halbzeit trotzdem bei 45:00 beginnen. Wurde dagegen ein Anpfiff der
   * 2. Halbzeit versehentlich zurückgenommen, soll der Uhrstand von
   * damals (z.B. 58:00) erhalten bleiben. Deshalb wird er beim
   * Zurücknehmen ausdrücklich gemerkt und beim nächsten Anpfiff
   * verbraucht.
   */
  private secondHalfResumeMs: number | null = null;

  constructor(persistedTeams?: TeamsConfig) {
    this.teams = persistedTeams;
    this.applyTeams();
  }

  /** Übernimmt Name/Kürzel/Logo aus der persistierten Konfiguration. */
  private applyTeams(): void {
    if (!this.teams) return;
    this.state = {
      ...this.state,
      home: { ...this.state.home, ...this.teams.home },
      away: { ...this.state.away, ...this.teams.away },
    };
  }

  getState(): MatchState {
    return this.state;
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  /**
   * Eigener Kanal nur für den Uhr-Tick. Der vollständige Zustand enthält
   * alle Logos und Portraits als Base64 -- ihn fünfmal pro Sekunde durch
   * die IPC-Brücke an beide Fenster zu schicken, war die mit Abstand
   * teuerste Stelle der App.
   */
  onClockTick(listener: ClockListener): void {
    this.clockListeners.push(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  /**
   * Blendet eine Einblendung nach Ablauf ihrer Anzeigedauer wieder aus.
   * Ein erneuter Aufruf mit demselben Schlüssel löst den vorherigen
   * Timer ab -- so verlängert eine zweite Einblendung die Zeit, statt
   * dass der alte Timer die neue vorzeitig beendet.
   */
  private scheduleAutoHide(key: string, delayMs: number, hide: () => void): void {
    this.cancelAutoHide(key);
    const timer = setTimeout(() => {
      this.autoHideTimers.delete(key);
      hide();
    }, delayMs) as ReturnType<typeof setTimeout> & { unref?: () => void };
    // Ohne unref() hielte ein laufender Timer den Node-Prozess der Tests
    // am Leben, bis die Einblendung abgelaufen ist.
    timer.unref?.();
    this.autoHideTimers.set(key, timer);
  }

  private cancelAutoHide(key: string): void {
    const timer = this.autoHideTimers.get(key);
    if (timer) clearTimeout(timer);
    this.autoHideTimers.delete(key);
  }

  /** Räumt alle laufenden Einblendungen ab (neues Spiel, Wiederherstellung). */
  private cancelAllAutoHide(): void {
    for (const timer of this.autoHideTimers.values()) clearTimeout(timer);
    this.autoHideTimers.clear();
  }

  private emitClock(): void {
    for (const listener of this.clockListeners) listener(this.state.clock);
  }

  /**
   * Zählt die Revision der angegebenen Bereiche hoch. Muss aus jeder
   * Methode aufgerufen werden, die den jeweiligen Bereich verändert --
   * sonst zeichnen die Renderer die betroffene Liste nicht neu.
   * Reihenfolge beachten: erst den Zustand ändern, dann `bump()`, dann
   * `emit()`.
   */
  private bump(...areas: (keyof StateRevisions)[]): void {
    const revisions = { ...this.state.revisions };
    for (const area of areas) revisions[area]++;
    this.state = { ...this.state, revisions };
  }

  /**
   * Ändert den Spielstand und pflegt dabei die Ereignis-Chronik:
   * ein Tor wird protokolliert, eine Korrektur (-1) nimmt das letzte Tor
   * dieser Mannschaft wieder zurück. Nur echte Tore im laufenden Spiel
   * lösen den Jubel auf der Anzeige aus.
   */
  incrementScore(team: TeamId, delta: number): void {
    const current = this.state[team].score;
    const next = Math.max(0, current + delta);
    if (next === current) return;

    const withScore: MatchState = {
      ...this.state,
      [team]: { ...this.state[team], score: next },
    };

    let events = this.state.events;

    if (delta > 0) {
      const goal: GoalEvent = {
        id: this.nextEventId++,
        type: 'goal',
        team,
        ...toMatchMinute(
          withScore.clock.elapsedMs,
          withScore.half,
          withScore.halfDurationMin
        ),
        scoreHome: withScore.home.score,
        scoreAway: withScore.away.score,
        celebrate: withScore.phase === 'live',
      };
      events = [...events, goal];
    } else {
      // Korrektur: jüngstes Tor dieser Mannschaft aus der Chronik nehmen
      // (Karten dabei überspringen)
      let lastIndex = -1;
      for (let i = events.length - 1; i >= 0; i--) {
        const candidate = events[i];
        if (candidate.type === 'goal' && candidate.team === team) {
          lastIndex = i;
          break;
        }
      }
      if (lastIndex >= 0) {
        events = recomputeStandings([
          ...events.slice(0, lastIndex),
          ...events.slice(lastIndex + 1),
        ]);
      }
    }

    this.state = { ...withScore, events };
    this.bump('events');
    this.emit();
  }

  setTeamName(team: TeamId, name: string): void {
    // Bei leerer Eingabe alten Namen behalten, aber trotzdem neu rendern
    // (State-Update), damit das Eingabefeld im Control-Fenster wieder auf
    // den gültigen Wert zurückspringt statt leer stehen zu bleiben.
    const trimmed = name.trim();
    if (trimmed) {
      this.state = { ...this.state, [team]: { ...this.state[team], name: trimmed } };
      this.bump('teams');
    }
    this.emit();
  }

  setTeamShortName(team: TeamId, shortName: string): void {
    const trimmed = shortName.trim().slice(0, 6).toUpperCase();
    if (trimmed) {
      this.state = { ...this.state, [team]: { ...this.state[team], shortName: trimmed } };
      this.bump('teams');
    }
    this.emit();
  }

  /**
   * Kurzname für das Retro-Design. Anders als beim Kürzel ist ein leerer
   * Wert gültig: Er heißt "automatisch vorschlagen".
   */
  setTeamRetroName(team: TeamId, retroName: string): void {
    const trimmed = retroName.trim();
    if (trimmed === (this.state[team].retroName ?? '')) return;
    this.state = { ...this.state, [team]: { ...this.state[team], retroName: trimmed } };
    this.bump('teams');
    this.emit();
  }

  setTeamLogo(
    team: TeamId,
    logoDataUrl: string | undefined,
    logoVariant?: LogoVariant
  ): void {
    this.state = { ...this.state, [team]: { ...this.state[team], logoDataUrl, logoVariant } };
    this.bump('teams');
    this.emit();
  }

  /** Übernimmt Name und Logo eines Vereins aus der Logo-Bibliothek. */
  applyLibraryTeam(
    team: TeamId,
    name: string,
    logoDataUrl: string | undefined,
    squad: Player[] = [],
    coach = '',
    logoVariant?: LogoVariant
  ): void {
    this.state = {
      ...this.state,
      [team]: {
        ...this.state[team],
        name,
        shortName: deriveShortName(name),
        // Ein von Hand gesetzter Retro-Name gehört zum alten Verein.
        retroName: '',
        logoDataUrl,
        logoVariant,
        coach,
      },
      // Kader des neuen Vereins laden -- der bisherige gehört zu einem
      // anderen Verein und darf nicht stehen bleiben.
      squads: { ...this.state.squads, [team]: squad },
    };
    this.bump('teams', 'squads');
    this.emit();
  }

  setSquad(team: TeamId, players: Player[]): void {
    this.state = { ...this.state, squads: { ...this.state.squads, [team]: players } };
    this.bump('squads');
    this.emit();
  }

  /**
   * Startet die Diashow -- **nur auf Knopfdruck**, nie von selbst
   * (Nutzerwunsch). Sie endet per Knopf oder mit dem nächsten
   * Phasenwechsel.
   */
  startSlideshow(): void {
    if (!slideshowAvailable(this.state.phase)) return;
    this.state = {
      ...this.state,
      slideshowRequest: { id: this.nextSlideshowId++, phase: this.state.phase },
      // Aufstellung und Torschützen-Einblendung würden sich sonst mit den
      // Folien überlagern -- beides läuft in denselben Phasen.
      lineupRequest: null,
      scorerRequest: null,
    };
    this.cancelAutoHide('lineup');
    this.cancelAutoHide('scorer');
    this.emit();
  }

  stopSlideshow(): void {
    if (this.state.slideshowRequest === null) return;
    this.state = { ...this.state, slideshowRequest: null };
    this.emit();
  }

  /**
   * Beendet die Diashow ohne zu senden. Für die Phasenwechsel, die
   * ohnehin gleich `emit()` aufrufen -- eine Folie darf einen Anpfiff
   * nicht überleben.
   */
  private clearSlideshow(): void {
    if (this.state.slideshowRequest === null) return;
    this.state = { ...this.state, slideshowRequest: null };
  }

  /** Setzt die Ankündigungen für die Halbzeitpause. */
  setAnnouncements(announcements: string[]): void {
    this.state = { ...this.state, announcements };
    this.emit();
  }

  /** Übernimmt die eingelesenen Dateinamen der Medienordner. */
  setMedia(media: MediaLists): void {
    this.state = { ...this.state, media };
    this.emit();
  }

  /**
   * Lautstärke und Stummschaltung. Gehören zum Gerät, nicht zum Spiel --
   * "Neues Spiel" lässt sie deshalb stehen.
   */
  setSound(sound: SoundSettings): void {
    const volume = Number.isFinite(sound.volume)
      ? Math.min(100, Math.max(0, Math.round(sound.volume)))
      : this.state.sound.volume;
    this.state = { ...this.state, sound: { volume, muted: sound.muted === true } };
    this.emit();
  }

  /** Blendet die Aufstellung einer Mannschaft ein (per Knopf ausgelöst). */
  showLineup(team: TeamId): void {
    // Eine laufende Diashow würde sich sonst über die Aufstellung legen.
    this.clearSlideshow();
    this.state = { ...this.state, lineupRequest: { id: this.nextLineupId++, team } };
    // Die Anzeige kehrt nach Startelf und Bank von selbst zur Begegnung
    // zurück; hier wird nur noch die Anfrage im Zustand abgeräumt.
    this.scheduleAutoHide('lineup', LINEUP_PAGE_MS * LINEUP_MAX_PAGES, () => this.hideLineup());
    this.emit();
  }

  /** Zurück zur Begegnungsansicht. */
  hideLineup(): void {
    this.cancelAutoHide('lineup');
    if (this.state.lineupRequest === null) return;
    this.state = { ...this.state, lineupRequest: null };
    this.emit();
  }

  /** Blendet einen Torschützen groß ein (Name, Portrait, Spielstand). */
  showScorer(eventId: number): void {
    // In der Halbzeitpause kann beides gleichzeitig angefordert werden.
    this.clearSlideshow();
    this.state = { ...this.state, scorerRequest: { id: this.nextScorerId++, eventId } };
    this.scheduleAutoHide('scorer', SCORER_DISPLAY_MS, () => this.hideScorer());
    this.emit();
  }

  hideScorer(): void {
    this.cancelAutoHide('scorer');
    if (this.state.scorerRequest === null) return;
    this.state = { ...this.state, scorerRequest: null };
    this.emit();
  }

  /**
   * Blendet eine kurze Zusatzinformation als Leiste am unteren Rand ein
   * (Karte, Eckenstand, Zuschauerzahl).
   */
  showInfo(overlay: InfoOverlay): void {
    this.state = { ...this.state, infoRequest: { id: this.nextInfoId++, overlay } };
    // Die Danksagung steht länger als die schmale Leiste -- sie füllt das
    // Bild und will in Ruhe gelesen werden.
    this.scheduleAutoHide('info', infoOverlayDurationMs(overlay), () => this.hideInfo());
    this.emit();
  }

  hideInfo(): void {
    this.cancelAutoHide('info');
    if (this.state.infoRequest === null) return;
    this.state = { ...this.state, infoRequest: null };
    this.emit();
  }

  /**
   * Eckenstand ändern. Bewusst kein Eintrag in der Chronik: Ecken fallen
   * zu häufig und würden die Liste überschwemmen, in der Tore und Karten
   * stehen. Deshalb auch kein bump() -- es hängt keine gepufferte Liste
   * daran, beide Fenster lesen den Zahlenwert direkt.
   */
  adjustCorners(team: TeamId, delta: number): void {
    if (!Number.isFinite(delta)) return;
    const current = this.state.corners[team];
    const next = Math.min(MAX_CORNERS, Math.max(0, current + Math.round(delta)));
    if (next === current) return;
    this.state = { ...this.state, corners: { ...this.state.corners, [team]: next } };
    this.emit();
  }

  /** Zuschauerzahl setzen; `null` löscht die Angabe wieder. */
  setAttendance(value: number | null): void {
    if (value === null) {
      if (this.state.attendance === null) return;
      this.state = { ...this.state, attendance: null };
      this.emit();
      return;
    }
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(MAX_ATTENDANCE, Math.max(0, Math.round(value)));
    if (clamped === this.state.attendance) return;
    this.state = { ...this.state, attendance: clamped };
    this.emit();
  }

  /**
   * Dankestext für die Zuschauer-Einblendung. Eine leere Eingabe fällt auf
   * die Vorgabe zurück, statt eine leere Tafel zu erzeugen.
   */
  setAttendanceMessage(message: string): void {
    const trimmed = message.trim().slice(0, MAX_ATTENDANCE_MESSAGE_LENGTH);
    this.state = {
      ...this.state,
      attendanceMessage: trimmed === '' ? DEFAULT_ATTENDANCE_MESSAGE : trimmed,
    };
    this.emit();
  }

  setPlayerPhoto(team: TeamId, playerId: string, photoDataUrl: string | undefined): void {
    this.state = {
      ...this.state,
      squads: {
        ...this.state.squads,
        [team]: this.state.squads[team].map((p) =>
          p.id === playerId ? { ...p, photoDataUrl } : p
        ),
      },
    };
    this.bump('squads');
    this.emit();
  }

  setCoach(team: TeamId, coach: string): void {
    this.state = { ...this.state, [team]: { ...this.state[team], coach: coach.trim() } };
    // Der Trainer steht als letzter Eintrag auf der Aufstellungsseite.
    this.bump('teams');
    this.emit();
  }

  /** Ordnet einem Tor nachträglich den Torschützen zu (oder entfernt ihn). */
  setGoalScorer(eventId: number, scorerId: string | undefined): void {
    this.state = {
      ...this.state,
      events: this.state.events.map((event) =>
        event.id === eventId && event.type === 'goal' ? { ...event, scorerId } : event
      ),
    };
    this.bump('events');
    this.emit();
  }

  /**
   * Trägt eine Karte ein. Der Spieler ist optional -- von der Tafel aus
   * sieht man oft nur, welche Mannschaft betroffen ist.
   */
  addCard(team: TeamId, card: CardColor): void {
    const event: CardEvent = {
      id: this.nextEventId++,
      type: 'card',
      team,
      card,
      ...toMatchMinute(
        this.state.clock.elapsedMs,
        this.state.half,
        this.state.halfDurationMin
      ),
    };
    this.state = { ...this.state, events: [...this.state.events, event] };
    this.bump('events');

    // Im laufenden Spiel gehört die Karte sofort auf die Tafel -- am
    // Spielfeldrand soll dafür kein zweiter Klick nötig sein. Der Spieler
    // ist dabei meist noch nicht zugeordnet; über den Knopf in der Chronik
    // lässt sich die Karte danach mit Namen wiederholen.
    // showInfo() sendet selbst, deshalb hier kein zweites emit().
    if (this.state.phase === 'live') {
      this.showInfo({ kind: 'card', eventId: event.id });
      return;
    }

    this.emit();
  }

  setCardPlayer(eventId: number, playerId: string | undefined): void {
    this.state = {
      ...this.state,
      events: this.state.events.map((event) =>
        event.id === eventId && event.type === 'card' ? { ...event, playerId } : event
      ),
    };
    this.bump('events');
    this.emit();
  }

  /**
   * Trägt einen Wechsel ein, zunächst ohne Spieler. Anders als die Karte
   * erscheint er NICHT sofort auf der Tafel: Ohne Namen sagt ein Wechsel
   * wenig, und die Spieler werden gleich danach in der Chronik gewählt
   * (Nutzerwunsch 16.10.2026).
   */
  addSubstitution(team: TeamId): void {
    const event: SubstitutionEvent = {
      id: this.nextEventId++,
      type: 'sub',
      team,
      ...toMatchMinute(
        this.state.clock.elapsedMs,
        this.state.half,
        this.state.halfDurationMin
      ),
    };
    this.state = { ...this.state, events: [...this.state.events, event] };
    this.bump('events');
    this.emit();
  }

  /**
   * Ordnet einem Wechsel die Spieler zu. Sind damit erstmals BEIDE
   * eingetragen, erscheint der Wechsel von selbst auf der Tafel -- im
   * Spiel und in der Halbzeitpause, in der oft gewechselt wird. Wer nur
   * einen Namen kennt oder keinen, blendet ihn über die Chronik von Hand
   * ein.
   */
  setSubstitutionPlayers(eventId: number, outId: string | undefined, inId: string | undefined): void {
    const before = this.state.events.find((e) => e.id === eventId);
    if (!before || before.type !== 'sub') return;

    const after: SubstitutionEvent = { ...before, outId, inId };
    this.state = {
      ...this.state,
      events: this.state.events.map((event) => (event.id === eventId ? after : event)),
    };
    this.bump('events');

    const phase = this.state.phase;
    if (
      isCompleteSubstitution(after) &&
      !isCompleteSubstitution(before) &&
      (phase === 'live' || phase === 'half-time')
    ) {
      // showInfo() sendet selbst, deshalb hier kein zweites emit().
      this.showInfo({ kind: 'sub', eventId });
      return;
    }
    this.emit();
  }

  /** Entfernt ein Ereignis (Fehleingabe). Tore ziehen den Stand mit. */
  removeEvent(eventId: number): void {
    const event = this.state.events.find((e) => e.id === eventId);
    if (!event) return;

    const events = recomputeStandings(this.state.events.filter((e) => e.id !== eventId));

    if (event.type === 'goal') {
      const score = Math.max(0, this.state[event.team].score - 1);
      this.state = {
        ...this.state,
        [event.team]: { ...this.state[event.team], score },
        events,
      };
    } else {
      this.state = { ...this.state, events };
    }
    this.bump('events');
    this.emit();
  }

  setKickoffTime(kickoffTime: string): void {
    this.state = { ...this.state, kickoffTime: kickoffTime.trim() };
    this.emit();
  }

  // --- Spielphasen -------------------------------------------------------
  // Die Phasenwechsel entsprechen dem, was am Spielfeldrand tatsächlich
  // passiert (Anpfiff, Halbzeit, Wiederanpfiff, Abpfiff) und steuern
  // gleichzeitig die Uhr. Die einzelnen Uhr-Buttons bleiben zusätzlich
  // erhalten, um bei Bedarf nachkorrigieren zu können.

  /** Anpfiff der 1. Halbzeit: Uhr auf 0 und starten. */
  kickoff(): void {
    if (this.state.phase !== 'pre-match') return;
    this.stopTicking();
    this.secondHalfResumeMs = null;
    this.state = {
      ...this.state,
      phase: 'live',
      half: 1,
      clock: { elapsedMs: 0, running: false },
      stoppageMinutes: 0,
      // Eine noch offene Aufstellungs-Einblendung endet mit dem Anpfiff.
      lineupRequest: null,
      // Ebenso die Diashow -- nach dem Anpfiff gehört der Spielstand auf
      // die Tafel, nicht ein Sponsorenmotiv.
      slideshowRequest: null,
    };
    this.cancelAutoHide('lineup');
    this.startClock();
  }

  /** Halbzeitpfiff: Uhr anhalten, Pausenansicht zeigen. */
  goToHalfTime(): void {
    if (this.state.phase !== 'live' || this.state.half !== 1) return;
    this.stopClock();
    this.secondHalfResumeMs = null;
    this.clearSlideshow();
    this.state = { ...this.state, phase: 'half-time' };
    this.emit();
  }

  /** Anpfiff der 2. Halbzeit: Uhr läuft ab der Halbzeitdauer weiter. */
  startSecondHalf(): void {
    if (this.state.phase !== 'half-time') return;
    this.stopTicking();
    // Regulär beginnt die 2. Halbzeit bei der Halbzeitdauer -- auch wenn
    // die erste mit Nachspielzeit bis 48:00 lief. Nur nach einer
    // zurückgenommenen 2. Halbzeit wird dort fortgesetzt, wo sie stand.
    const elapsedMs = this.secondHalfResumeMs ?? this.state.halfDurationMin * 60 * 1000;
    this.secondHalfResumeMs = null;
    this.state = {
      ...this.state,
      phase: 'live',
      half: 2,
      clock: { elapsedMs, running: false },
      // Die Nachspielzeit der 1. Halbzeit ist mit dem Anpfiff erledigt.
      stoppageMinutes: 0,
      // Das Pausenprogramm endet mit dem Wiederanpfiff.
      slideshowRequest: null,
    };
    this.startClock();
  }

  /**
   * Vom Schiedsrichter angezeigte Nachspielzeit. 0 blendet sie wieder aus.
   */
  setStoppage(minutes: number): void {
    if (!Number.isFinite(minutes)) return;
    const clamped = Math.min(MAX_STOPPAGE_MIN, Math.max(0, Math.round(minutes)));
    if (clamped === this.state.stoppageMinutes) return;
    this.state = { ...this.state, stoppageMinutes: clamped };
    this.emit();
  }

  /**
   * Halbzeitdauer setzen (Jugend spielt kürzer). Wirkt auf die
   * Nachspielzeit-Anzeige und darauf, wo die 2. Halbzeit startet.
   */
  setHalfDuration(minutes: number): void {
    const clamped = Math.min(60, Math.max(1, Math.round(minutes)));
    if (!Number.isFinite(clamped)) return;
    this.state = { ...this.state, halfDurationMin: clamped };
    this.emit();
  }

  /**
   * Auflösung der Anzeigefläche setzen. Die Anzeige rechnet ihr Layout in
   * dieser Größe und skaliert es formatfüllend hoch -- siehe `BoardSize`.
   *
   * Die Werte kommen bereits geprüft aus `sanitizeBoardSize()`; hier wird
   * nur noch verglichen, damit ein unverändertes Feld nicht bei jedem
   * Tastendruck ein Zustands-Update durch die IPC-Brücke schickt.
   */
  setBoardSize(board: BoardSize): void {
    const current = this.state.board;
    if (current.width === board.width && current.height === board.height) return;
    this.state = { ...this.state, board: { ...board } };
    this.emit();
  }

  /**
   * Gestaltung der Anzeige setzen. Kommt bereits geprüft aus
   * `sanitizeAppearance()`. Verglichen wird, damit ein erneutes Setzen
   * desselben Werts kein Zustands-Update durch die Brücke schickt.
   */
  setAppearance(appearance: DisplayAppearance): void {
    if (JSON.stringify(appearance) === JSON.stringify(this.state.appearance)) return;
    this.state = {
      ...this.state,
      appearance: {
        theme: appearance.theme,
        effects: { ...appearance.effects },
        retroColor: appearance.retroColor,
      },
    };
    this.emit();
  }

  /**
   * Wettbewerb wählen (Dateiname im Ordner `Wettbewerbe/`) oder mit `null`
   * abwählen. Ob die Datei dort liegt, prüft die Anzeige beim Zeichnen
   * gegen die Medienliste: Fehlt sie, bleibt der Platz leer, statt ein
   * zerbrochenes Bild zu zeigen -- und die Wahl bleibt erhalten, falls
   * die Datei nur kurz umbenannt war.
   */
  setCompetition(fileName: string | null): void {
    if (fileName === this.state.competition) return;
    this.state = { ...this.state, competition: fileName };
    this.emit();
  }

  /** Abpfiff: Uhr anhalten, Endstand anzeigen. */
  goToFullTime(): void {
    if (this.state.phase !== 'live') return;
    this.stopClock();
    this.clearSlideshow();
    this.state = { ...this.state, phase: 'full-time' };
    this.emit();
  }

  /**
   * Nimmt den letzten Phasenwechsel zurück -- gedacht für den Fall, dass
   * versehentlich abgepfiffen wurde. Spielstand, Chronik und Uhrstand
   * bleiben dabei unangetastet; die Uhr läuft nach dem Zurücknehmen
   * bewusst NICHT von selbst weiter, sondern wird per "Start" fortgesetzt.
   *
   * Wohin es von hier aus zurückgeht, kündigt `revertTargetLabel()` in
   * `shared/phaseLabels.ts` an. Wer diesen Ablauf ändert, muss dort
   * mitziehen -- `tests/phaseLabels.test.js` spielt beide gegeneinander
   * durch.
   */
  revertPhase(): void {
    // In der Zielphase läuft möglicherweise gar keine Diashow -- sie hier
    // pauschal zu beenden ist der berechenbare Weg.
    this.clearSlideshow();
    switch (this.state.phase) {
      case 'full-time':
        this.state = { ...this.state, phase: 'live' };
        break;
      case 'half-time':
        this.secondHalfResumeMs = null;
        this.state = { ...this.state, phase: 'live', half: 1 };
        break;
      case 'live':
        if (this.state.half === 2) {
          this.stopClock();
          // Uhrstand festhalten, damit ein erneuter Anpfiff der
          // 2. Halbzeit hier weitermacht statt bei der Halbzeitdauer.
          this.secondHalfResumeMs = this.state.clock.elapsedMs;
          this.state = { ...this.state, phase: 'half-time', half: 1 };
        } else {
          this.stopClock();
          this.secondHalfResumeMs = null;
          this.state = { ...this.state, phase: 'pre-match' };
        }
        break;
      case 'pre-match':
        return;
    }
    this.emit();
  }

  /**
   * Stellt ein abgebrochenes Spiel aus der Sicherung wieder her.
   *
   * Die Uhr wird bewusst IMMER angehalten übernommen: Nach einem Absturz
   * weiß niemand, wie viel Zeit seither vergangen ist -- weiterlaufen zu
   * lassen wäre geraten. Fortgesetzt wird per Start-Knopf.
   *
   * Logos bleiben unangetastet: sie stammen aus `teams.json` und wurden vom
   * Konstruktor bereits gesetzt. Kader lädt der Aufrufer anschließend über
   * den hier wiederhergestellten Vereinsnamen nach.
   */
  restoreLiveMatch(snapshot: LiveMatchSnapshot): void {
    this.stopTicking();
    this.secondHalfResumeMs = null;
    this.state = {
      ...this.state,
      home: { ...this.state.home, ...snapshot.home },
      away: { ...this.state.away, ...snapshot.away },
      half: snapshot.half,
      phase: snapshot.phase,
      clock: { elapsedMs: snapshot.elapsedMs, running: false },
      events: snapshot.events,
      halfDurationMin: snapshot.halfDurationMin,
      kickoffTime: snapshot.kickoffTime,
      stoppageMinutes: snapshot.stoppageMinutes ?? 0,
      corners: snapshot.corners ?? { home: 0, away: 0 },
      attendance: snapshot.attendance ?? null,
      // Einblendungen sind flüchtig und gehören nicht zum Spielstand.
      lineupRequest: null,
      scorerRequest: null,
      infoRequest: null,
      slideshowRequest: null,
    };
    this.cancelAllAutoHide();

    // Ereignis-Zähler hinter die wiederhergestellten Ids setzen. Ohne das
    // bekäme das nächste Tor eine bereits vergebene Id -- die Anzeige würde
    // es nicht als neu erkennen und der Torjubel bliebe aus.
    for (const event of snapshot.events) {
      if (event.id >= this.nextEventId) this.nextEventId = event.id + 1;
    }

    this.bump('teams', 'events');
    this.emit();
  }

  /**
   * Neues Spiel: Spielstand, Uhr und Chronik zurück auf Anfang.
   * Team-Stammdaten und Kader bleiben erhalten -- die gehören zum Verein,
   * nicht zur einzelnen Begegnung.
   */
  resetMatch(): void {
    this.stopTicking();
    this.cancelAllAutoHide();
    this.secondHalfResumeMs = null;
    // Kader, Spielzeit-Einstellung, Tafelmaße und der Dankestext sind
    // Konfiguration, keine Spieldaten -- sie gehören zum Verein bzw. zum
    // Gerät, nicht zur einzelnen Begegnung. Der Wettbewerb bleibt ebenfalls:
    // Auf ein Ligaspiel folgt meist das nächste.
    const {
      squads,
      halfDurationMin,
      board,
      appearance,
      competition,
      attendanceMessage,
      announcements,
      media,
      sound,
    } = this.state;
    const previous = this.state.revisions;
    this.state = initialState();
    this.applyTeams();
    this.state = {
      ...this.state,
      squads,
      halfDurationMin,
      board,
      appearance,
      competition,
      attendanceMessage,
      announcements,
      media,
      sound,
    };
    // initialState() setzt die Zähler zurück auf 0 -- die Renderer
    // vergleichen aber gegen ihren zuletzt gesehenen Wert und hielten die
    // Listen sonst für unverändert. Deshalb hier bewusst hochzählen.
    this.state = {
      ...this.state,
      revisions: {
        teams: previous.teams + 1,
        squads: previous.squads + 1,
        events: previous.events + 1,
      },
    };
    this.emit();
  }

  // --- Uhr ---------------------------------------------------------------

  startClock(): void {
    if (this.state.clock.running) return;
    // Bedingungslos aufräumen, bevor ein neues Intervall gesetzt wird: Sind
    // Flag und Timer je auseinandergelaufen, liefen sonst zwei Intervalle
    // parallel und die Uhr tickte doppelt so schnell.
    this.stopTicking();
    this.lastTickAt = performance.now();
    this.state = { ...this.state, clock: { ...this.state.clock, running: true } };
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.emit();
  }

  stopClock(): void {
    // Auch bei bereits stehendem Flag den Timer abräumen -- sonst bliebe ein
    // verwaistes Intervall zurück, das die Uhr weiterzählen lässt.
    if (!this.state.clock.running) {
      this.stopTicking();
      return;
    }
    this.tick();
    this.stopTicking();
    this.state = { ...this.state, clock: { ...this.state.clock, running: false } };
    this.emit();
  }

  /**
   * Setzt die Spielzeit von Hand -- Notausgang, wenn die Uhr aus dem Tritt
   * geraten ist (vergessener Start, versehentlicher Reset). Der Laufzustand
   * bleibt, wie er ist: Läuft die Uhr, zählt sie vom neuen Wert aus weiter.
   *
   * `lastTickAt` muss dabei mitgezogen werden, sonst rechnete der nächste
   * Tick die Zeit seit dem letzten Tick noch obendrauf.
   */
  setClock(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs)) return;
    this.lastTickAt = performance.now();
    this.state = {
      ...this.state,
      clock: { ...this.state.clock, elapsedMs: Math.max(0, Math.round(elapsedMs)) },
    };
    this.emit();
  }

  resetClock(): void {
    this.stopTicking();
    this.state = { ...this.state, clock: { elapsedMs: 0, running: false } };
    this.emit();
  }

  private stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private tick(): void {
    // performance.now() statt Date.now(): monoton steigend, also unempfindlich
    // gegen Zeitsynchronisation und Sommerzeitumstellung mitten im Spiel.
    const now = performance.now();
    // Auf ganze Millisekunden runden: performance.now() liefert
    // Nachkommastellen, die sonst bis in die Sicherungsdatei durchschlagen.
    const delta = Math.round(Math.min(Math.max(0, now - this.lastTickAt), MAX_TICK_DELTA_MS));
    this.lastTickAt = now;
    this.state = {
      ...this.state,
      clock: { ...this.state.clock, elapsedMs: this.state.clock.elapsedMs + delta },
    };
    // Bewusst NICHT emit(): der Tick geht über den schlanken Uhr-Kanal,
    // sonst ginge fünfmal pro Sekunde der komplette Zustand samt aller
    // Bilddaten an beide Fenster.
    this.emitClock();
  }
}
