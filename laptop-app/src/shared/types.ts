import { Formation } from './formations';
/**
 * Farbvariante eines Vereinslogos.
 *
 * Entscheidet, ob hinter dem Wappen eine weiße Kontrastfläche steht: Die
 * Anzeige hat einen blauen Grund, auf dem eine weiße Logovariante bestens
 * steht -- eine farbige dagegen ist für helle Untergründe gezeichnet und
 * verschwindet dort mit ihren dunklen Linien. `undefined` bedeutet
 * "unbekannt" und wird wie `white` behandelt, also ohne Fläche: Das ist
 * der Stand vor dieser Unterscheidung, und eine weiße Fläche hinter einem
 * weißen Logo wäre schlimmer als gar keine.
 */
export type LogoVariant = 'white' | 'color';

export interface TeamState {
  name: string;
  shortName: string;
  score: number;
  /** Logo als data:-URL (Base64), damit teams.json ohne externe Dateiverweise auskommt */
  logoDataUrl?: string;
  /** siehe `LogoVariant` */
  logoVariant?: LogoVariant;
  /** Trainername; erscheint als letzter Eintrag auf der Aufstellungsseite */
  coach: string;
  /**
   * Kurzname für das Retro-Design ("Erkenschwick" statt "Spvgg.
   * Erkenschwick"). Leer = automatisch vorgeschlagen, siehe
   * `deriveRetroName()`. Wird beim Wechsel des Vereins aus der Bibliothek
   * geleert -- ein von Hand gesetzter Name gehört zum alten Verein.
   */
  retroName?: string;
}

export type TeamId = 'home' | 'away';

export interface ClockState {
  /** verstrichene Spielzeit in Millisekunden */
  elapsedMs: number;
  running: boolean;
}

/**
 * Spielphase. Steuert, was die Anzeigetafel darstellt -- vor dem Anpfiff
 * z.B. eine Begegnungs-/Markenansicht statt einer 0:0-Anzeige mit
 * stehender Uhr.
 */
export type MatchPhase = 'pre-match' | 'live' | 'half-time' | 'full-time';

/**
 * Spielereignis. Aktuell nur Tore -- Karten, Ecken und Wechsel werden
 * später als weitere `type`-Varianten ergänzt. Die Chronik ist die
 * Grundlage für Torschützen-Einblendungen und Statistiken.
 */
/**
 * Startelf, Ersatzbank oder heute gar nicht dabei. `out` ist wichtig für
 * den eigenen Verein: dort steht der komplette Saisonkader in der App,
 * von dem an einem Spieltag nur ein Teil im Spielbericht auftaucht.
 */
export type PlayerRole = 'start' | 'bench' | 'out';

export interface Player {
  /** stabile Id, damit Tore auch nach Umbenennungen zugeordnet bleiben */
  id: string;
  /** Trikotnummer; null, solange nichts eingetragen ist */
  number: number | null;
  firstName: string;
  lastName: string;
  position: string;
  role: PlayerRole;
  /** Torwart -- wird auf der Aufstellungsseite mit "TW" gekennzeichnet */
  isGoalkeeper: boolean;
  /** Spielführer -- Kennzeichnung "C" */
  isCaptain: boolean;
  /** Portraitfoto als data:-URL, für die Torschützen-Einblendung */
  photoDataUrl?: string;
}

/**
 * Sortiert nach Trikotnummer. Spieler ohne Nummer landen am Ende, damit
 * eine unvollständige Erfassung die Reihenfolge nicht durcheinanderbringt.
 */
export function sortPlayersByNumber<T extends { number: number | null }>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    if (a.number === null && b.number === null) return 0;
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return a.number - b.number;
  });
}

export type Squads = Record<TeamId, Player[]>;

/** Anzeigename eines Spielers: "12 Müller" bzw. "Müller" ohne Nummer. */
export function playerLabel(player: Player): string {
  const name = [player.firstName, player.lastName].filter(Boolean).join(' ').trim();
  const display = name || 'Unbenannt';
  return player.number !== null ? `${player.number} ${display}` : display;
}

export interface GoalEvent {
  /** fortlaufend; der Renderer erkennt daran neue Ereignisse */
  id: number;
  type: 'goal';
  team: TeamId;
  /** Spielminute nach Fußball-Konvention (0:30 = 1. Minute). In der
      Nachspielzeit die Basisminute, also 45 bzw. 90 -- siehe `stoppage`. */
  minute: number;
  /** Nachspielminute, falls das Ereignis dort fiel: 2 bedeutet "45+2".
      Fehlt bei allen Ereignissen der regulären Spielzeit. */
  stoppage?: number;
  /** Zwischenstand unmittelbar nach diesem Tor */
  scoreHome: number;
  scoreAway: number;
  /** nur Tore im laufenden Spiel lösen den Jubel aus, keine Korrekturen */
  celebrate: boolean;
  /** Torschütze; wird meist erst nach dem Tor nachgetragen */
  scorerId?: string;
  /**
   * Eigentor. `team` bleibt die Mannschaft, der das Tor gutgeschrieben
   * wird; `scorerId` zeigt dann in den Kader des GEGNERS. Ältere
   * Sicherungen ohne das Feld sind gewöhnliche Tore.
   */
  ownGoal?: boolean;
  /**
   * Tor per Strafstoß -- im Spielbericht „(FE)“ (Review 2026-10, N13).
   * Schließt `ownGoal` aus; der Store hält beide nie gleichzeitig.
   */
  penalty?: boolean;
}

/** Die jeweils andere Mannschaft. */
export function otherTeam(team: TeamId): TeamId {
  return team === 'home' ? 'away' : 'home';
}

/**
 * Aus welchem Kader der Torschütze stammt: bei einem Eigentor aus dem des
 * Gegners (Review 2026-10, W10). An einer Stelle, damit Chronik,
 * Torschützenliste, Einblendung und Retro nicht auseinanderlaufen.
 */
export function scorerTeam(goal: GoalEvent): TeamId {
  return goal.ownGoal ? otherTeam(goal.team) : goal.team;
}

export function goalScorer(goal: GoalEvent, squads: Record<TeamId, Player[]>): Player | undefined {
  if (!goal.scorerId) return undefined;
  return squads[scorerTeam(goal)].find((p) => p.id === goal.scorerId);
}

export type CardColor = 'yellow' | 'yellow-red' | 'red';

export interface CardEvent {
  id: number;
  type: 'card';
  team: TeamId;
  card: CardColor;
  /** siehe `GoalEvent.minute` */
  minute: number;
  /** siehe `GoalEvent.stoppage` */
  stoppage?: number;
  /** optional -- oft sieht man von der Tafel aus nur die Mannschaft */
  playerId?: string;
}

/**
 * Ein- und Auswechslung. Beide Spieler sind optional: Am Spielfeldrand
 * steht oft erst fest, DASS gewechselt wird, und die Namen kommen danach.
 * Sobald beide eingetragen sind, erscheint der Wechsel auf der Tafel; ohne
 * Namen lässt er sich von Hand mit der Mannschaft einblenden.
 */
export interface SubstitutionEvent {
  id: number;
  type: 'sub';
  team: TeamId;
  /** siehe `GoalEvent.minute` */
  minute: number;
  /** siehe `GoalEvent.stoppage` */
  stoppage?: number;
  /** Spieler, der den Platz verlässt */
  outId?: string;
  /** Spieler, der hereinkommt */
  inId?: string;
}

export type MatchEvent = GoalEvent | CardEvent | SubstitutionEvent;

export const CARD_LABEL: Record<CardColor, string> = {
  yellow: 'Gelb',
  'yellow-red': 'Gelb-Rot',
  red: 'Rot',
};

/**
 * Kurze Einblendung, die nach wenigen Sekunden von selbst wieder
 * verschwindet.
 *
 * Bewusst EIN Mechanismus für Karten, Ecken und Zuschauerzahl statt drei
 * eigener Zustände -- so kann sich keine zweite Einblendung über eine
 * laufende schieben. Die Darstellung unterscheidet sich trotzdem:
 * Karte und Ecken erscheinen als schmale Leiste am unteren Rand, die
 * Zuschauerzahl dagegen als Vollbild-Danksagung. Sie wird pro Spiel nur
 * einmal gezeigt und ist eher eine Geste ans Publikum als eine
 * Zusatzinformation nebenher.
 */
export type InfoOverlay =
  | { kind: 'card'; eventId: number }
  | { kind: 'sub'; eventId: number }
  | { kind: 'corners' }
  | { kind: 'attendance' };

export interface InfoRequest {
  /** fortlaufend, damit auch ein erneuter Druck auf denselben Knopf wirkt */
  id: number;
  overlay: InfoOverlay;
}

/** Eckenstand beider Mannschaften. */
export interface Corners {
  home: number;
  away: number;
}

/**
 * Anzeigedauern der Einblendungen.
 *
 * Stehen hier und nicht im Renderer, weil sie an zwei Stellen gebraucht
 * werden: Der Renderer blendet danach aus, und der Store räumt die
 * Anfrage im Zustand ab. Ohne das Zweite bliebe die Anfrage dauerhaft
 * stehen -- ein neu geöffnetes Anzeigefenster spielte dann die letzte
 * Einblendung erneut ab.
 */
export const INFO_OVERLAY_MS = 4000;
export const SCORER_DISPLAY_MS = 8000;
/** Die Danksagung füllt das Bild und will in Ruhe gelesen werden. */
export const THANKS_DISPLAY_MS = 8000;

/** Wie lange die jeweilige Einblendung stehen bleibt. */
export function infoOverlayDurationMs(overlay: InfoOverlay): number {
  if (overlay.kind === 'attendance') return THANKS_DISPLAY_MS;
  // Ein Wechsel nennt zwei Namen -- etwas länger als eine Karte.
  if (overlay.kind === 'sub') return SUB_DISPLAY_MS;
  return INFO_OVERLAY_MS;
}

export const SUB_DISPLAY_MS = 6000;

/**
 * Stufen des Torjubels.
 *
 * Der Jubel spielt in zwei Akten, und der zweite läuft bewusst NICHT als
 * eigene Vollbildseite (Nutzerentscheidung 19.08.2026):
 *
 * - `word`  -- Vollbild "TOR!" mit Vereinswappen, nur beim eigenen Tor.
 * - `plain` -- dasselbe für das Gegentor, ruhig und mit Mannschaftsnamen
 *              statt Wappen.
 * - `boost` -- **die normale Spielansicht ist wieder da.** Hier läuft die
 *              neue Ziffer von oben in den Spielstand hinein, und beim
 *              eigenen Tor fällt Konfetti darüber. Der Zwischenstand
 *              wechselt damit dort, wo die Zuschauer ihn ohnehin suchen,
 *              statt auf einer weiteren Zwischenseite.
 *
 * Zwischenseiten mit Mannschaftsnamen oder Torschützen gibt es bewusst
 * nicht mehr: Die Mannschaft steht schon im Wappen, und der Torschütze
 * ist zum Zeitpunkt des Tores praktisch nie eingetragen -- für ihn gibt
 * es den Knopf "Torschütze einblenden" mit Portrait.
 */
export type GoalStage = 'word' | 'plain' | 'boost';

export interface GoalStagePlan {
  stage: GoalStage;
  ms: number;
}

/**
 * Ablauf beim eigenen Tor. Der Vollbildteil bleibt kurz -- Spielstand und
 * Uhr sind währenddessen verdeckt.
 */
// Vollbild 4 s statt 1,8 s (Befund des Nutzers, 16.10.2026): Ein Tor
// soll stehen bleiben, bis es auch hinten auf der Tribüne angekommen ist.
// Im Retro-Design geht dazu gut eine halbe Sekunde für den Aufbau ab.
export const HOME_GOAL_STAGES: GoalStagePlan[] = [
  { stage: 'word', ms: 4000 },
  { stage: 'boost', ms: 1800 },
];

/**
 * Ablauf beim Gegentor. Derselbe Aufbau -- das Wappen der treffenden
 * Mannschaft über dem Schriftzug --, nur zurückgenommen: kein Gold,
 * kleinerer Schriftzug, kein Farbwechsel, kein Konfetti. Auch der
 * Nachlauf auf der Spielansicht ist kürzer, dort schiebt sich nur die
 * Ziffer an ihren Platz.
 */
export const AWAY_GOAL_STAGES: GoalStagePlan[] = [
  { stage: 'plain', ms: 3000 },
  { stage: 'boost', ms: 1200 },
];

export function goalStagesFor(team: TeamId): GoalStagePlan[] {
  return team === 'home' ? HOME_GOAL_STAGES : AWAY_GOAL_STAGES;
}

/** Gesamtdauer eines Jubels. */
export function goalCelebrationMs(team: TeamId): number {
  return goalStagesFor(team).reduce((summe, stufe) => summe + stufe.ms, 0);
}

/**
 * Hat dieses Tor die Führung gedreht?
 *
 * Gemeint ist der Führungswechsel im Wortsinn: Die treffende Mannschaft
 * führt jetzt und führte vorher nicht. Ein Ausgleich zählt bewusst NICHT
 * -- dabei wechselt keine Führung, sie ist danach weg. Ebenso wenig das
 * 3:0 zum bereits Führenden.
 *
 * Der Stand vor dem Tor steht nirgends im Ereignis; er ergibt sich aus
 * dem Zwischenstand danach abzüglich dieses einen Treffers.
 */
export function isLeadChange(goal: GoalEvent): boolean {
  const vorherHeim = goal.scoreHome - (goal.team === 'home' ? 1 : 0);
  const vorherGast = goal.scoreAway - (goal.team === 'away' ? 1 : 0);

  const fuehrteVorher =
    goal.team === 'home' ? vorherHeim > vorherGast : vorherGast > vorherHeim;
  const fuehrtJetzt =
    goal.team === 'home' ? goal.scoreHome > goal.scoreAway : goal.scoreAway > goal.scoreHome;

  return fuehrtJetzt && !fuehrteVorher;
}

/**
 * Pulst der goldene Rahmen?
 *
 * Nur beim **eigenen** Führungswechsel (Nutzerentscheidung 19.08.2026).
 * Der Rahmen ist eine Feier, und die Führungsübernahme des Gegners ist
 * keine -- sie sachlich zu melden reicht.
 */
export function showsLeadChangeFrame(goal: GoalEvent): boolean {
  return goal.team === 'home' && isLeadChange(goal);
}

/**
 * Platzhalter im Dankestext, der durch die Zuschauerzahl ersetzt wird.
 * Die Zahl wird dabei groß herausgestellt, der Text davor und dahinter
 * kleiner gesetzt.
 */
export const ATTENDANCE_PLACEHOLDER = '{n}';

/**
 * Vorgabe für die Danksagung. Editierbar im Steuerungsfenster, weil die
 * Formulierung Geschmackssache ist und sich am Platz leichter beurteilen
 * lässt als am Schreibtisch.
 */
export const DEFAULT_ATTENDANCE_MESSAGE =
  'Danke für {n} Zuschauer heute am Segensberg!';

/** Genug für zwei Zeilen auf der Tafel, aber kein Aufsatz. */
export const MAX_ATTENDANCE_MESSAGE_LENGTH = 120;

/**
 * Zerlegt den Dankestext am Platzhalter. Fehlt er, steht die Zahl vorn --
 * besser als sie ganz zu verschlucken, wenn jemand den Platzhalter beim
 * Umformulieren löscht.
 */
export function splitAttendanceMessage(message: string): { before: string; after: string } {
  const index = message.indexOf(ATTENDANCE_PLACEHOLDER);
  if (index < 0) return { before: '', after: message.trim() };
  return {
    before: message.slice(0, index).trim(),
    after: message.slice(index + ATTENDANCE_PLACEHOLDER.length).trim(),
  };
}
/** Standzeit einer Aufstellungsseite (Startelf, danach Bank). */
export const LINEUP_PAGE_MS = 9000;

/**
 * Wie die Aufstellung abläuft (Ablauf in `shared/lineupSteps.ts`).
 * `overview`: Startelf und Bank als je eine Seite.
 * `single`: jeder Spieler der Startelf einzeln mit Portrait, danach der
 * Trainer, danach die Bank als eine Seite (Nutzerwunsch 20.10.2026).
 * `pitch`: die Grundordnung (`MatchState.formation`) mit leeren Trikots
 * auf einem Spielfeld, nur für das Heimteam (Nutzerwunsch 21.10.2026).
 * Der Gast-Knopf zeigt bei dieser Wahl die Übersicht.
 */
export type LineupStyle = 'overview' | 'single' | 'pitch';
export const LINEUP_STYLES: readonly LineupStyle[] = ['overview', 'single', 'pitch'];

/** Mehr Ecken als das gibt es in einem Spiel nicht. */
export const MAX_CORNERS = 99;
/**
 * Obergrenze der Zuschauerzahl. Großzügig gewählt -- die Zahl wird von
 * Hand eingetippt, und ein Vertipper soll die Tafel nicht sprengen.
 */
export const MAX_ATTENDANCE = 99999;

/**
 * Zähler je Datenbereich. Die Renderer erkennen daran, ob sich eine Liste
 * wirklich geändert hat, statt bei jedem Uhr-Tick `JSON.stringify` über
 * Kader samt Base64-Bilddaten laufen zu lassen.
 *
 * Wer im Store einen dieser Bereiche ändert, MUSS den passenden Zähler
 * hochzählen (`bump()` in `state.ts`) -- sonst aktualisiert die Anzeige
 * stumm nicht mehr.
 */
export interface StateRevisions {
  /** Name, Kürzel, Logo, Trainer einer Mannschaft */
  teams: number;
  /** Kaderlisten beider Mannschaften inklusive Portraits */
  squads: number;
  /** Chronik: Tore und Karten */
  events: number;
}

export interface MatchState {
  home: TeamState;
  away: TeamState;
  half: 1 | 2;
  phase: MatchPhase;
  clock: ClockState;
  /** Chronik in zeitlicher Reihenfolge */
  events: MatchEvent[];
  /** Kader der beiden Mannschaften */
  squads: Squads;
  /**
   * Aufforderung, die Aufstellung einer Mannschaft einzublenden. Wird per
   * Knopf im Steuerungsfenster ausgelöst -- die Anzeige läuft bewusst
   * nicht von selbst durch die Aufstellungen. Die fortlaufende `id` sorgt
   * dafür, dass auch ein erneuter Druck auf denselben Knopf wirkt.
   */
  lineupRequest: { id: number; team: TeamId; style: LineupStyle } | null;
  /** Gewählter Ablauf der Aufstellung, gemerkt in `content.json`. Die
      Anfrage nimmt ihn beim Auslösen mit -- ein Umschalten mittendrin
      ändert die laufende Einblendung nicht. */
  lineupStyle: LineupStyle;
  /** Grundordnung für die Spielfeld-Aufstellung, gemerkt in `content.json`. */
  formation: Formation;
  /**
   * Aufforderung, einen Torschützen groß einzublenden (Name, Portrait,
   * Spielstand). Wird nach dem Eintragen des Schützen per Knopf ausgelöst.
   */
  scorerRequest: { id: number; eventId: number } | null;
  /** Dauer einer Halbzeit in Minuten (Jugend spielt z. B. 2x35) */
  halfDurationMin: number;
  /** Auflösung der Anzeigefläche, siehe `BoardSize`. Gehört zum Gerät,
      nicht zum Spiel -- "Neues Spiel" lässt den Wert unangetastet. */
  board: BoardSize;
  /** Gestaltung der Anzeige, siehe `DisplayAppearance`. Gehört wie die
      Tafelmaße zum Gerät -- "Neues Spiel" lässt sie stehen. */
  appearance: DisplayAppearance;
  /**
   * Logo des Wettbewerbs (Dateiname im Ordner `Wettbewerbe/`), `null` =
   * keines. Steht auf der Begegnung vor dem Anpfiff. Überdauert "Neues
   * Spiel": Meist folgt Ligaspiel auf Ligaspiel, umgestellt wird nur für
   * den Pokal.
   */
  competition: string | null;
  /** „Präsentiert von"-Plätze, siehe `SponsorSlots`. */
  sponsorSlots: SponsorSlots;
  /** Abgehakte Blöcke der Diashow, siehe `SlideBlocks`. */
  slideBlocks: SlideBlocks;
  /** Geplanter Anstoß als "HH:MM"; leer = keine Angabe. Nur informativ --
      der Anpfiff wird weiterhin manuell ausgelöst. */
  kickoffTime: string;
  /**
   * Vom Schiedsrichter angezeigte Nachspielzeit in Minuten; 0 = keine
   * Anzeige. Wird von Hand gesetzt und bei jedem Anpfiff zurückgesetzt.
   */
  stoppageMinutes: number;
  /**
   * Eckenstand. Bewusst KEIN `MatchEvent`: Ecken fallen zu häufig und
   * würden die Chronik überschwemmen, in der Tore und Karten stehen.
   */
  corners: Corners;
  /** Zuschauerzahl; null, solange nichts eingetragen ist. */
  attendance: number | null;
  /** Dankestext für die Zuschauer-Einblendung, siehe `splitAttendanceMessage` */
  attendanceMessage: string;
  /** Ankündigungen für die Halbzeitpause, eine je Eintrag */
  announcements: string[];
  /** Dateinamen der Medienordner, siehe `MediaLists` */
  media: MediaLists;
  /** Laufende Diashow, siehe `SlideshowRequest` */
  slideshowRequest: SlideshowRequest | null;
  /** Lautstärke und Stummschaltung, siehe `SoundSettings` */
  sound: SoundSettings;
  /** siehe `InfoOverlay` */
  infoRequest: InfoRequest | null;
  /** Elfmeterschießen nach dem Abpfiff, siehe `Shootout` */
  shootout: Shootout | null;
  /** siehe `StateRevisions` */
  revisions: StateRevisions;
}

/**
 * Elfmeterschießen (Review 2026-10, W11).
 *
 * Für Pokalspiele, die unentschieden enden. Die Schüsse sind KEINE
 * Ereignisse der Chronik: Sie zählen nicht zum Spielstand und gehören
 * nicht in die Torschützenliste -- im Spielbericht steht „2:2, 4:3 i. E.“.
 * Gestartet wird es nur nach dem Abpfiff. Eine Verlängerung lässt sich
 * über die weiterlaufende Uhr abbilden (Nutzerentscheidung 20.10.2026).
 *
 * Solange `finished` false ist, zeigt die Tafel eine eigene Vollbildansicht
 * mit den Schüssen; danach steht das Ergebnis im Endstand.
 */
export type ShootoutKick = 'goal' | 'miss';

export interface Shootout {
  home: ShootoutKick[];
  away: ShootoutKick[];
  finished: boolean;
}

/** Schüsse je Mannschaft, die die Tafel mindestens als Felder zeigt. */
export const SHOOTOUT_ROUNDS = 5;

/** Höchstzahl Schüsse je Mannschaft -- weit über jedem echten Verlauf. */
export const MAX_SHOOTOUT_KICKS = 30;

export function shootoutScore(shootout: Shootout): { home: number; away: number } {
  const goals = (kicks: ShootoutKick[]) => kicks.filter((k) => k === 'goal').length;
  return { home: goals(shootout.home), away: goals(shootout.away) };
}

/**
 * Abzug eines laufenden Spiels, wie er nach `live-match.json` geschrieben
 * wird. Bewusst nur die spielbezogenen Daten -- Kader, Logos und Portraits
 * liegen bereits in `squads.json`/`teams.json` und würden die Datei bei
 * jedem Schreibvorgang um mehrere Megabyte Base64 aufblähen. Beim
 * Fortsetzen werden sie über den Vereinsnamen wieder zugespielt; die
 * Verweise der Chronik auf Spieler bleiben gültig, weil die Spieler-Ids
 * mitpersistiert sind.
 */
export interface LiveMatchSnapshot {
  /** Formatstand der Datei -- erlaubt späteres Umstellen ohne Fehlgriff */
  version: 1;
  /** Zeitpunkt des Schreibens (Date.now()), für die Altersprüfung */
  savedAt: number;
  home: { name: string; shortName: string; score: number; coach: string };
  away: { name: string; shortName: string; score: number; coach: string };
  half: 1 | 2;
  phase: MatchPhase;
  /** Uhrstand; beim Fortsetzen wird die Uhr immer angehalten übernommen */
  elapsedMs: number;
  events: MatchEvent[];
  halfDurationMin: number;
  kickoffTime: string;
  /** Nachträglich ergänzt -- ältere Sicherungen ohne dieses Feld werden
      mit 0 gelesen, statt sie zu verwerfen. */
  stoppageMinutes?: number;
  /** Ebenfalls nachträglich ergänzt, siehe `stoppageMinutes`. */
  corners?: Corners;
  /** Ebenfalls nachträglich ergänzt, siehe `stoppageMinutes`. */
  attendance?: number | null;
  /** Ebenfalls nachträglich ergänzt, siehe `stoppageMinutes`. */
  shootout?: Shootout | null;
}

/**
 * Medienordner unter `Vereinsdaten/`. Die Werte sind zugleich der
 * Host-Teil der `svh-media:`-URLs (`svh-media://werbung/01_sponsor.jpg`).
 *
 * `sounds` läuft bewusst über denselben Mechanismus wie die Bilder: Ein
 * zweiter Weg für Dateien von der Platte ins Fenster wäre eine zweite
 * Stelle, an der die Pfadprüfung sitzen müsste.
 */
export type MediaFolderId =
  | 'werbung'
  | 'hauptsponsor'
  | 'partner'
  | 'highlights'
  | 'historie'
  | 'sounds'
  | 'wettbewerbe';

export const MEDIA_FOLDER_IDS: MediaFolderId[] = [
  'werbung',
  'hauptsponsor',
  'partner',
  'highlights',
  'historie',
  'sounds',
  'wettbewerbe',
];

/**
 * Lesbarer Name eines Wettbewerbs aus seinem Dateinamen:
 * "02_Krombacher_Westfalenpokal.png" -> "Krombacher Westfalenpokal".
 * Ohne eigenes Namensfeld -- der Ordner ist die Verwaltung, wie bei der
 * Diashow. Dient als Eintrag der Auswahl und als Text im Retro-Design.
 */
export function competitionLabel(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[_\s-]+/, '')
    .replace(/[_]+/g, ' ')
    .trim();
}

/**
 * „Präsentiert von"-Plätze (Nutzerwunsch 20.10.2026): An fünf Stellen
 * kann ein Logo aus den Sponsorenordnern stehen.
 *
 * - `lineup`: in der Kopfzeile der Aufstellungsseiten
 * - `halfTime`: als erste Folie der Diashow in der Halbzeitpause
 *   (Nutzerentscheidung: eigene Folie statt Logo in der Halbzeitansicht)
 * - `goal`: unter „TOR!" im Vollbild-Akt des Torjubels
 * - `corners`: rechts in der Info-Leiste der Ecken
 * - `matchday`: auf der Begegnung vor dem Anpfiff
 *
 * Tor und Ecken stehen bewusst im bestehenden Akt, nicht in einem eigenen
 * (Nutzerentscheidung) -- der Jubel wird dadurch nicht länger.
 *
 * Gehört in `teams.json` und überdauert „Neues Spiel": Ein Sponsor für
 * Tore oder Ecken ist ein Saisonvertrag. Nur der Spieltagssponsor
 * wechselt je Spiel und wird geleert.
 */
export type SponsorSlotId = 'lineup' | 'halfTime' | 'goal' | 'corners' | 'matchday';

export const SPONSOR_SLOT_IDS: SponsorSlotId[] = ['lineup', 'halfTime', 'goal', 'corners', 'matchday'];

/** Beschriftung der Auswahl im Steuerungsfenster. */
export const SPONSOR_SLOT_LABELS: Record<SponsorSlotId, string> = {
  lineup: 'Aufstellung',
  halfTime: 'Halbzeit',
  goal: 'Torjubel',
  corners: 'Ecken',
  matchday: 'Spieltagssponsor',
};

/** Ordner, aus denen ein Platz sein Logo nehmen darf. */
export type SponsorFolderId = 'hauptsponsor' | 'partner' | 'werbung';

export const SPONSOR_FOLDER_IDS: SponsorFolderId[] = ['hauptsponsor', 'partner', 'werbung'];

/** Ein Logo: Ordner und Dateiname -- nie ein Pfad, siehe `sanitizeSponsorRef`. */
export interface SponsorRef {
  folder: SponsorFolderId;
  file: string;
}

export type SponsorSlots = Record<SponsorSlotId, SponsorRef | null>;

export function emptySponsorSlots(): SponsorSlots {
  return { lineup: null, halfTime: null, goal: null, corners: null, matchday: null };
}

/** Schriftzug neben bzw. über einem Logo an einem Platz. */
export const PRESENTED_BY = 'PRÄSENTIERT VON';

/** Titel der Halbzeit-Folie. */
export const HALFTIME_SPONSOR_TITLE = 'HALBZEIT PRÄSENTIERT VON';

/**
 * Ein Sponsorenlogo, wie es auf der Tafel steht. `white` heißt: weiße
 * Fassung auf transparentem Grund -- sie steht direkt auf dem Vereinsblau,
 * ohne weiße Kachel (Nutzerwunsch 20.10.2026, „für besseres Design").
 */
export interface SponsorLogo {
  url: string;
  white: boolean;
}

/** Kennung der weißen Fassung am Ende des Dateinamens: `Ott_weiß.png`. */
const WHITE_LOGO_SUFFIX = /[_\s-]*(weiß|weiss|white)\s*$/i;

/** Name ohne Endung und ohne Weiß-Kennung: `Ott_weiß.png` -> `Ott`. */
export function sponsorBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(WHITE_LOGO_SUFFIX, '');
}

export function isWhiteLogoFile(fileName: string): boolean {
  return WHITE_LOGO_SUFFIX.test(fileName.replace(/\.[^.]+$/, ''));
}

/**
 * Ein Eintrag je Sponsor: Liegen `Ott.png` und `Ott_weiß.png` im selben
 * Ordner, gilt das als EIN Sponsor in zwei Fassungen, und die weiße wird
 * genommen -- wie bei den Vereinslogos. Die farbige bleibt Rückfall, falls
 * die weiße fehlt. Reihenfolge: wie im Ordner (nach Dateinamen).
 */
export function sponsorLogoFiles(files: string[]): string[] {
  const chosen = new Map<string, string>();
  for (const file of files) {
    const base = sponsorBaseName(file).toLowerCase();
    const current = chosen.get(base);
    if (current === undefined || (!isWhiteLogoFile(current) && isWhiteLogoFile(file))) {
      chosen.set(base, file);
    }
  }
  return [...chosen.values()].sort(
    (x, y) => files.indexOf(x) - files.indexOf(y)
  );
}

/**
 * Die Fassung, die für eine gewählte Datei gezeigt wird: die weiße, wenn
 * es sie gibt, sonst die Datei selbst. Fehlt die Datei, aber eine andere
 * Fassung desselben Sponsors liegt da, wird diese genommen -- wer die
 * farbige gewählt und später durch die weiße ersetzt hat, verliert den
 * Platz nicht. `null`, wenn vom Sponsor nichts mehr im Ordner liegt.
 */
export function preferredSponsorFile(files: string[], fileName: string): string | null {
  const base = sponsorBaseName(fileName).toLowerCase();
  return sponsorLogoFiles(files).find((f) => sponsorBaseName(f).toLowerCase() === base) ?? null;
}

export function sponsorLogo(folder: MediaFolderId, fileName: string): SponsorLogo {
  return { url: mediaUrl(folder, fileName), white: isWhiteLogoFile(fileName) };
}

/**
 * Logo an einem Platz -- oder `null`, wenn keiner gewählt ist oder vom
 * Sponsor nichts mehr im Ordner liegt. Dann bleibt der Platz leer statt
 * ein zerbrochenes Bild zu zeigen; die Wahl bleibt erhalten, falls die
 * Datei nur kurz umbenannt war (wie beim Wettbewerbslogo).
 */
export function sponsorSlotLogo(
  slots: SponsorSlots,
  media: MediaLists,
  slot: SponsorSlotId
): SponsorLogo | null {
  const ref = slots[slot];
  if (!ref) return null;
  const file = preferredSponsorFile(media[ref.folder].files, ref.file);
  return file === null ? null : sponsorLogo(ref.folder, file);
}

/** Beschriftung eines historischen Fotos, siehe `historyCaption()`. */
export interface HistoryCaption {
  /** "17.05.1998", "Mai 1998" oder "1998" -- `null` ohne Datum */
  date: string | null;
  /** "SV Hochlar 28 – Westfalia Herten 3:1" -- leer, wenn nichts dasteht */
  title: string;
}

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/**
 * Duell und Datum eines historischen Mannschaftsfotos aus dem Dateinamen
 * (Nutzerentscheidung 20.10.2026 -- Ordner statt Verwaltung, wie beim
 * Wettbewerbslogo):
 *
 *   "1998-05-17_SV Hochlar - Westfalia Herten 3-1.jpg"
 *     -> { date: "17.05.1998", title: "SV Hochlar – Westfalia Herten 3:1" }
 *
 * Das Datum steht vorn, damit die alphabetische Ordnung des Ordners
 * zugleich die zeitliche ist. Erlaubt sind Tag, Monat oder nur das Jahr
 * -- bei alten Fotos ist oft nur die Saison bekannt. Eine Ordnungsnummer
 * davor (`01_`) wird übergangen; sie hat höchstens drei Stellen und ist
 * so von einer Jahreszahl zu unterscheiden.
 */
export function historyCaption(fileName: string): HistoryCaption {
  let rest = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/^\d{1,3}[_\s]+(?=\d{4})/, '');

  let date: string | null = null;
  const match = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?=[_\s-]|$)/.exec(rest);
  if (match) {
    const [, year, month, day] = match;
    const m = month ? Number(month) : 0;
    const d = day ? Number(day) : 0;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      date = `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${year}`;
    } else if (m >= 1 && m <= 12) {
      date = `${MONTHS[m - 1]} ${year}`;
    } else {
      date = year;
    }
    rest = rest.slice(match[0].length);
  }

  const title = rest
    .replace(/_+/g, ' ')
    .replace(/^[\s\-–]+/, '')
    // Ergebnis am Ende: "3-1" -> "3:1", wie auf der Tafel
    .replace(/(\d+)\s*-\s*(\d+)\s*$/, '$1:$2')
    // Begegnung: "A - B", "A vs B", "A gegen B" -> Gedankenstrich
    .replace(/\s+(?:-|–|vs\.?|gegen)\s+/gi, ' – ')
    .replace(/\s+/g, ' ')
    .trim();

  return { date, title };
}

/**
 * Ein Medienordner: wo er liegt und was drinsteht -- **nur die
 * Dateinamen**, keine Bilddaten. Die Bilder selbst laufen über das
 * `svh-media:`-Protokoll direkt von der Platte ins Anzeigefenster und
 * gehen nie durch die IPC-Brücke. Deshalb dürfen diese Listen im Zustand
 * stehen: Zwanzig Dateinamen sind Bytes, zwanzig Base64-Bilder wären
 * Megabyte.
 *
 * Der Pfad gehört mit dazu, damit das Steuerungsfenster bei einem leeren
 * Ordner sagen kann, WO es nichts gefunden hat -- bei der Logo-Bibliothek
 * war ein wortlos leeres Dropdown der schlechteste Fall.
 */
export interface MediaFolderInfo {
  rootPath: string;
  files: string[];
}

export type MediaLists = Record<MediaFolderId, MediaFolderInfo>;

/** Adresse eines Mediums für das `svh-media:`-Protokoll. */
export function mediaUrl(folder: MediaFolderId, fileName: string): string {
  return `svh-media://${folder}/${encodeURIComponent(fileName)}`;
}

/**
 * Laufende Diashow. Startet **nur auf Knopfdruck** (Nutzerwunsch) und
 * endet per Knopf oder mit dem nächsten Phasenwechsel -- die Anzeige
 * rotiert nie von selbst los, damit auf der Tafel immer das steht, was
 * die Person am Steuerungsfenster erwartet.
 */
export interface SlideshowRequest {
  /** fortlaufend, damit ein erneuter Druck die Schau neu startet */
  id: number;
  /** Phase, in der sie gestartet wurde -- siehe `slidesForPhase` */
  phase: MatchPhase;
}

/**
 * Standzeit einer Folie. 12 statt 8 s (Nutzerbefund 21.10.2026): Auf der
 * Leinwand wirkte der Wechsel zu schnell, gerade bei Fotos.
 */
export const SLIDE_DURATION_MS = 12000;

/**
 * Standzeit der normalen Ansicht zwischen zwei Runden. Länger als eine
 * Folie (Nutzerwunsch 21.10.2026): Der Zwischenstand soll zwischen den
 * Runden eine Weile stehen, nicht nur kurz aufblitzen.
 */
export const SLIDE_BASE_DURATION_MS = 20000;

/** Ankündigungen für die Halbzeitpause, eine je Zeile. */
export const MAX_ANNOUNCEMENTS = 20;
export const MAX_ANNOUNCEMENT_LENGTH = 60;
/** Mehr Zeilen passen bei 384x192 nicht lesbar auf eine Folie. */
export const ANNOUNCEMENTS_PER_SLIDE = 5;

/** Überschrift der Ankündigungs-Folien. */
export const ANNOUNCEMENTS_TITLE = 'TERMINE';

/**
 * Sponsoren erscheinen nicht einzeln als Vollbild, sondern zu viert in
 * einem Fenster aus gleich großen Kacheln (Nutzerwunsch 16.10.2026). Ein
 * Logo im Vollbild wirkte je nach Seitenverhältnis riesig oder verloren;
 * in gleichen Kacheln stehen alle Partner gleichwertig nebeneinander.
 */
export const SPONSORS_PER_PAGE = 4;

/** Titelzeile des Sponsoren-Fensters. */
export const SPONSORS_TITLE = 'UNSERE PARTNER';

/**
 * Blöcke der Diashow, die sich im Steuerungsfenster abhaken lassen
 * (Nutzerwunsch 20.10.2026). Eine Auswahl für alle Phasen: Was abgehakt
 * ist, läuft vor dem Anpfiff, in der Pause und nach dem Abpfiff. Die
 * frühere feste Regel „vor dem Anpfiff nur Sponsoren" ist damit
 * entfallen -- die Person am Steuerungsfenster entscheidet.
 *
 * Gehört nach `content.json` und überdauert „Neues Spiel".
 */
export type SlideBlockId = 'partner' | 'highlights' | 'historie' | 'termine';

export const SLIDE_BLOCK_IDS: SlideBlockId[] = ['partner', 'highlights', 'historie', 'termine'];

export const SLIDE_BLOCK_LABELS: Record<SlideBlockId, string> = {
  partner: 'Partner',
  highlights: 'Highlights',
  historie: 'Vereinsgeschichte',
  termine: 'Termine',
};

export type SlideBlocks = Record<SlideBlockId, boolean>;

export function allSlideBlocks(): SlideBlocks {
  return { partner: true, highlights: true, historie: true, termine: true };
}

/** Kopfzeile eines historischen Fotos ohne Datum im Dateinamen. */
export const HISTORY_FALLBACK_TITLE = 'AUS DER VEREINSGESCHICHTE';

/**
 * Eine Folie der Diashow, ohne die normale Ansicht.
 *
 * Hauptsponsoren erscheinen als Partner, nur großflächig: dasselbe
 * Fenster unter „UNSERE PARTNER", aber mit EINER Kachel über die ganze
 * Fläche (`main`). Ein eigener Titel „Hauptsponsor" war nicht gewünscht
 * (Nutzer 20.10.2026) -- die Größe macht den Unterschied.
 */
export type SlidePlanItem =
  | { kind: 'sponsors'; main: boolean; title: string; logos: SponsorLogo[]; page: number; pages: number }
  | { kind: 'image'; url: string }
  | { kind: 'history'; url: string; caption: HistoryCaption }
  | { kind: 'text'; lines: string[] };

/**
 * Die Folienfolge einer Diashow, in klar getrennten Blöcken
 * (Nutzerentscheidung 20.10.2026: eine Schau, nicht zwei Knöpfe):
 * Partner (zuerst die großen, dann die Vierer-Fenster), Highlights,
 * Vereinsgeschichte, Termine -- jeweils nur, wenn abgehakt.
 *
 * Der Halbzeit-Sponsor steht davor und hängt an keinem Haken: Er ist ein
 * „präsentiert von"-Platz der Pause, kein Teil der Partner-Rotation.
 *
 * Partner kommen aus `Werbung/Hauptsponsor/`, `Werbung/Partner/` und
 * direkt aus `Werbung/`. Die Seitenmarken zählen alle Partnerfolien als
 * eine Reihe, große wie kleine.
 *
 * Gemeinsam für Anzeige und Steuerungsfenster: Die Anzeige spielt genau
 * diese Folge ab, das Steuerungsfenster nennt ihre Länge im Hinweis.
 */
export function buildSlidePlan(
  phase: MatchPhase,
  media: MediaLists,
  announcements: string[],
  sponsorSlots: SponsorSlots = emptySponsorSlots(),
  blocks: SlideBlocks = allSlideBlocks()
): SlidePlanItem[] {
  if (!slideshowAvailable(phase)) return [];
  const slides: SlidePlanItem[] = [];
  const logos = (folder: MediaFolderId): SponsorLogo[] =>
    sponsorLogoFiles(media[folder].files).map((file) => sponsorLogo(folder, file));

  // Halbzeit-Sponsor zuerst -- er „präsentiert" die Pause, also gehört
  // er an ihren Anfang. Nur in der Halbzeit, nicht nach dem Abpfiff.
  const halfTime = phase === 'half-time' ? sponsorSlotLogo(sponsorSlots, media, 'halfTime') : null;
  if (halfTime) {
    slides.push({ kind: 'sponsors', main: true, title: HALFTIME_SPONSOR_TITLE, logos: [halfTime], page: 0, pages: 1 });
  }

  if (blocks.partner) {
    const main = logos('hauptsponsor');
    const partners = [...logos('partner'), ...logos('werbung')];
    const gridPages = Math.ceil(partners.length / SPONSORS_PER_PAGE);
    const pages = main.length + gridPages;
    main.forEach((logo, page) =>
      slides.push({ kind: 'sponsors', main: true, title: SPONSORS_TITLE, logos: [logo], page, pages })
    );
    for (let i = 0; i < gridPages; i++) {
      slides.push({
        kind: 'sponsors',
        main: false,
        title: SPONSORS_TITLE,
        logos: partners.slice(i * SPONSORS_PER_PAGE, (i + 1) * SPONSORS_PER_PAGE),
        page: main.length + i,
        pages,
      });
    }
  }

  if (blocks.highlights) {
    for (const file of media.highlights.files) slides.push({ kind: 'image', url: mediaUrl('highlights', file) });
  }

  if (blocks.historie) {
    for (const file of media.historie.files) {
      slides.push({ kind: 'history', url: mediaUrl('historie', file), caption: historyCaption(file) });
    }
  }

  if (blocks.termine) {
    for (let i = 0; i < announcements.length; i += ANNOUNCEMENTS_PER_SLIDE) {
      slides.push({ kind: 'text', lines: announcements.slice(i, i + ANNOUNCEMENTS_PER_SLIDE) });
    }
  }

  return slides;
}

/** Zahl der Folien einer Diashow, ohne die normale Ansicht. */
export function slideCount(
  phase: MatchPhase,
  media: MediaLists,
  announcements: string[],
  sponsorSlots?: SponsorSlots,
  blocks?: SlideBlocks
): number {
  return buildSlidePlan(phase, media, announcements, sponsorSlots, blocks).length;
}

/**
 * Laufen in dieser Phase überhaupt Folien? In jeder außer dem laufenden
 * Spiel -- dort gehört der Spielstand auf die Tafel. Nach dem Abpfiff
 * läuft sie mit (Nutzerwunsch 20.08.2026): Sie startet ohnehin nur auf
 * Knopfdruck und verdrängt den Endstand also nur, wenn jemand das will.
 */
export function slideshowAvailable(phase: MatchPhase): boolean {
  return phase !== 'live';
}

/**
 * Wählt die Tormusik aus den Dateien im Sounds-Ordner.
 *
 * Bevorzugt wird eine Datei namens `tor.*` -- das ist die dokumentierte
 * Ablage. Liegt keine solche da, wird die erste Audiodatei genommen,
 * damit ein anderer Dateiname nicht stumm ins Leere läuft.
 */
export const GOAL_SOUND_BASENAME = 'tor';

export function pickGoalSound(files: string[]): string | null {
  if (files.length === 0) return null;
  const benannt = files.find(
    (name) => name.slice(0, name.lastIndexOf('.')).toLowerCase() === GOAL_SOUND_BASENAME
  );
  return benannt ?? files[0];
}

/**
 * MIME-Typ einer Audiodatei anhand ihrer Endung.
 *
 * Wird gebraucht, weil die Tormusik als Blob abgespielt wird: Ohne Typ
 * rät Chromium, und bei einem Fehlgriff bleibt es stumm.
 */
const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
};

export function audioMimeType(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return AUDIO_MIME[ext] ?? 'audio/mpeg';
}

/** Lautstärke und Stummschaltung der Tonausgabe. */
export interface SoundSettings {
  /** 0-100; die Tonausgabe rechnet daraus 0.0-1.0 */
  volume: number;
  muted: boolean;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { volume: 80, muted: false };

/** Ein Verein aus der Logo-Bibliothek (Ordner `Liga-Logos`). */
export interface LibraryTeam {
  /** stabiler Schlüssel, aus Liga + Name gebildet */
  id: string;
  name: string;
  league: string;
  /** Welche Logofassungen vorliegen -- bei beiden bietet die Auswahl
      im Steuerungsfenster beide an. */
  variants: LogoVariant[];
}

/** Übliche Halbzeitdauer im Herrenbereich. */
export const DEFAULT_HALF_DURATION_MIN = 45;

/**
 * Auflösung der Anzeigefläche in Pixeln -- die Größe der "Bühne", in der
 * die Anzeige ihr Layout rechnet.
 *
 * Die Anzeige legt ihr Layout NICHT in der Fenstergröße aus, sondern in
 * genau dieser Größe, und skaliert das Ergebnis anschließend
 * formatfüllend hoch (siehe `.stage` in `display.css`). Damit zeigt schon
 * das Vorschaufenster exakt das Layout, das später auf der LED-Wand
 * steht: dieselben Zeilenumbrüche, dieselben Kürzungen, dieselbe Zahl an
 * Zeilen in der Torschützenliste.
 *
 * Der Wert steht bewusst NICHT im CSS (siehe Guardrail in DESIGN.md),
 * sondern in den Einstellungen: Die tatsächliche Auflösung des TB50 ist
 * noch nicht verifiziert (384x192 laut Anleitung, 384x224 laut einem
 * Werbemittel-Dateinamen). Nach der Lieferung wird ein Eingabefeld
 * korrigiert, kein Stylesheet umgeschrieben.
 */
export interface BoardSize {
  width: number;
  height: number;
}

/** Offizielle Herstellerangabe aus der goracon-Anleitung. */
export const DEFAULT_BOARD_SIZE: BoardSize = { width: 384, height: 192 };

/**
 * Gestaltung der Anzeige.
 *
 * - `klassisch`: das Design bis Fassung 1.1.0, unverändert. Bleibt als
 *   Rückfall und zum Vergleich an der echten Tafel erhalten.
 * - `flutlicht`: modernes Design mit Lichtkegel, großen geneigten
 *   Ziffern und Vereinsstreifen (Entwurf vom 16.10.2026).
 *
 * - `retro`: Punktmatrix wie alte Stadiontafeln (`shared/retroMatrix.ts`).
 */
export type DisplayTheme = 'klassisch' | 'flutlicht' | 'retro';

export const DISPLAY_THEMES: DisplayTheme[] = ['klassisch', 'flutlicht', 'retro'];

/** Leuchtfarbe der Punkte im Retro-Design -- beide Vorbilder gab es. */
export type RetroColor = 'bernstein' | 'weiss';

export const RETRO_COLORS: RetroColor[] = ['bernstein', 'weiss'];

/**
 * Obergrenze für den Retro-Kurznamen. Auf eine Zeile der Matrix passen
 * rund sechzehn Zeichen in großer Schrift; etwas Luft darüber, weil die
 * kleine Schrift mehr fasst und die Anzeige ohnehin kürzt.
 */
export const MAX_RETRO_NAME_LENGTH = 20;

/**
 * Einzeln abschaltbare Effekte des Flutlicht-Designs.
 *
 * Verläufe, Transparenz und Leuchten verbietet `DESIGN.md` für das
 * klassische Design, weil LED-Wände sie oft schlecht darstellen. Ob sie
 * auf DIESER Wand tragen, zeigt erst der Test am Gerät -- deshalb lässt
 * sich jeder Effekt dort einzeln abschalten, statt das Design umbauen zu
 * müssen, wenn einer Banding oder Flimmern erzeugt.
 */
export interface FlutlichtEffects {
  /** Lichtkegel als Farbverlauf; aus = eine ruhige Blaufläche */
  verlauf: boolean;
  /** drei weiche Lichtstrahlen von oben */
  strahlen: boolean;
  /** blauer Schein hinter den Wappen */
  leuchten: boolean;
  /** weicher Schatten unter Ziffern und Uhr-Plakette */
  schatten: boolean;
}

export const FLUTLICHT_EFFECT_KEYS: (keyof FlutlichtEffects)[] = [
  'verlauf',
  'strahlen',
  'leuchten',
  'schatten',
];

export interface DisplayAppearance {
  theme: DisplayTheme;
  effects: FlutlichtEffects;
  retroColor: RetroColor;
}

/**
 * Klassisch als Vorgabe: Ein Update soll die Tafel nicht ungefragt
 * umgestalten. Das neue Design wird bewusst eingeschaltet.
 */
export const DEFAULT_APPEARANCE: DisplayAppearance = {
  theme: 'klassisch',
  effects: { verlauf: true, strahlen: true, leuchten: true, schatten: true },
  retroColor: 'bernstein',
};

/**
 * Grenzen der Tafelmaße. Großzügig gewählt -- die Werte werden von Hand
 * eingetippt, und eine andere Controller-Generation könnte eine deutlich
 * andere Auflösung haben.
 */
export const MIN_BOARD_EDGE = 64;
export const MAX_BOARD_EDGE = 4096;

/**
 * Spielminute eines Ereignisses nach Fußball-Konvention.
 *
 * Innerhalb der regulären Zeit zählt die angebrochene Minute: 0:30 gehört
 * zur 1. Minute. Ab dem Ende der Halbzeit wird nicht weitergezählt,
 * sondern wie im Spielbericht "45+2" ausgewiesen.
 *
 * Ohne diese Trennung wären zwei Ereignisse nicht auseinanderzuhalten:
 * Ein Tor in der Nachspielzeit der 1. Halbzeit (bei 46:30) und eines kurz
 * nach dem Wiederanpfiff (ebenfalls bei 46:30) stünden beide als "47." in
 * der Chronik -- obwohl eine halbe Stunde dazwischen liegt.
 */
export function toMatchMinute(
  elapsedMs: number,
  half: 1 | 2,
  halfDurationMin: number
): { minute: number; stoppage?: number } {
  const halfEndMs = halfDurationMin * 60 * 1000 * half;

  if (elapsedMs >= halfEndMs) {
    return {
      minute: halfDurationMin * half,
      stoppage: Math.floor((elapsedMs - halfEndMs) / 60000) + 1,
    };
  }

  return { minute: Math.floor(elapsedMs / 60000) + 1 };
}

/** Anzeigeform einer Ereignisminute: "23'" bzw. "45+2'". */
export function formatEventMinute(event: { minute: number; stoppage?: number }): string {
  return event.stoppage === undefined
    ? `${event.minute}'`
    : `${event.minute}+${event.stoppage}'`;
}

/** Höchste sinnvolle Nachspielzeit. Deckt auch Ausreißer ab. */
export const MAX_STOPPAGE_MIN = 20;

/**
 * Was auf der Tafel steht: die durchlaufende Spielzeit und daneben die vom
 * Schiedsrichter **vorgegebene** Nachspielzeit.
 *
 * Genau wie im Stadion: Die Uhr läuft über 45:00 bzw. 90:00 hinaus weiter
 * (46:12, 47:30 …), und "+3" bezeichnet die angezeigte Dauer der
 * Nachspielzeit -- nicht, wie viel davon schon gespielt ist.
 *
 * Früher lief es hier andersherum: Die Uhr blieb bei 45:00 stehen und
 * "+1", "+2" zählte die laufende Nachspielzeit hoch. Das sah aus wie die
 * Fernsehanzeige, bedeutete aber das Gegenteil und war deshalb
 * irreführend.
 *
 * Die Vorgabe erscheint erst, wenn die reguläre Zeit überschritten ist --
 * so lässt sie sich schon eintragen, während der Schiedsrichter sie
 * hochhält, ohne neben einer Uhr bei 43:00 zu stehen.
 */
export function clockView(
  elapsedMs: number,
  half: 1 | 2,
  halfDurationMin: number,
  stoppageMinutes: number
): { displayMs: number; stoppage: number | null } {
  const halfEndMs = halfDurationMin * 60 * 1000 * half;
  const ueberzogen = elapsedMs > halfEndMs;
  return {
    displayMs: elapsedMs,
    stoppage: ueberzogen && stoppageMinutes > 0 ? stoppageMinutes : null,
  };
}

/**
 * Liest eine von Hand eingetippte Spielzeit. Erlaubt sind "MM:SS" und die
 * reine Minutenangabe ("67" = 67:00). Ungültige Eingaben ergeben `null` --
 * der Aufrufer lässt die Uhr dann unangetastet, statt sie auf `NaN` zu
 * setzen.
 *
 * Gemeint ist immer die GESAMTE gespielte Zeit, nicht die Zeit seit
 * Beginn der 2. Halbzeit: Die Tafel zeigt in der 2. Halbzeit ebenfalls
 * durchlaufende Minuten (46:00 …), und ab dem Ende der regulären Zeit
 * bleibt sie bei 45:00 bzw. 90:00 stehen und weist die Nachspielzeit
 * separat aus.
 */
export function parseClockInput(value: string): number | null {
  const text = value.trim();
  if (text === '') return null;

  const match = /^(\d{1,3})(?::([0-5]?\d))?$/.exec(text);
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = match[2] === undefined ? 0 : Number(match[2]);
  // Obergrenze mit Luft nach oben: 2x60 Minuten plus reichlich
  // Nachspielzeit deckt auch Verlängerungen ab.
  if (minutes > 150) return null;

  return (minutes * 60 + seconds) * 1000;
}

/** "MM:SS" aus Millisekunden. */
export function formatClock(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

export interface AppStatus {
  displays: DisplayInfo[];
  selectedDisplayId: number | null;
  /** true, wenn das Display-Fenster gerade als Vorschau (kein zweiter Monitor) läuft */
  previewMode: boolean;
  /** false, wenn das Anzeigefenster geschlossen wurde -- dann hilft nur
      der Knopf "Anzeigefenster neu öffnen" */
  displayOpen: boolean;
  /** Fernsteuerung im WLAN, siehe `RemoteStatus` */
  remote: RemoteStatus;
  /** Verbindung zum TB50, siehe `BoardLinkStatus` */
  boardLink: BoardLinkStatus;
  /**
   * Beschädigte Konfigurationsdateien, die beim Start beiseitegelegt
   * wurden (siehe `main/configFile.ts`). Meist leer.
   */
  warnings: string[];
}

/**
 * Fernsteuerung im WLAN: Ein iPad (oder jedes andere Gerät mit Browser)
 * öffnet die Steuerung über die Adresse des Laptops. Der Laptop bleibt an
 * der Tafel und bespielt sie weiter per HDMI.
 *
 * Steht im `AppStatus`, weil sich die Zahl der verbundenen Geräte im
 * Betrieb ändert und das Steuerungsfenster sie anzeigen soll.
 */
export interface RemoteStatus {
  enabled: boolean;
  /** Adressen, unter denen der Laptop im WLAN erreichbar ist */
  urls: string[];
  /** Zugangs-PIN -- ohne sie nimmt der Laptop keine Befehle an */
  pin: string;
  /** verbundene Geräte */
  clients: number;
  /** Fehlermeldung, falls der Port belegt war o. Ä.; sonst leer */
  error: string;
}

/** Port der Fernsteuerung. 28 wie im Vereinsnamen. */
export const REMOTE_PORT = 8028;

/**
 * Verbindung zum TB50-Controller im WLAN der Tafel (siehe
 * `main/boardLink.ts`).
 *
 * - `off`: in der Einrichtung abgeschaltet, etwa am Schreibtisch
 * - `searching` / `not-found`: Suche läuft bzw. ergab nichts -- meist ist
 *   der Laptop nicht im WLAN `Taurus-…`
 * - `connecting`: gefunden, Anmeldung läuft
 * - `connected`: angemeldet, Werte werden laufend gelesen
 * - `login-failed`: Benutzer oder Passwort falsch
 * - `error`: gefunden, aber die Verbindung brach ab (Text in `message`)
 */
export type BoardLinkState =
  | 'off'
  | 'searching'
  | 'not-found'
  | 'connecting'
  | 'connected'
  | 'login-failed'
  | 'error';

export interface BoardLinkStatus {
  enabled: boolean;
  state: BoardLinkState;
  /** gefundenes Gerät; null, solange keins gefunden ist */
  device: { name: string; product: string; sn: string; address: string } | null;
  /** Helligkeit in Prozent */
  brightness: number | null;
  /** Rohwert des Lichtsensors; null ohne Sensor */
  ambientLight: number | null;
  /** was die Tafel zeigt: das HDMI-Bild des Laptops oder ihren internen Player */
  source: 'hdmi' | 'internal' | null;
  /** ob am HDMI-Eingang ein Signal anliegt */
  hdmiSignal: boolean | null;
  /** Pixelgröße der LED-Wand laut Controller */
  ledSize: BoardSize | null;
  /** Anmeldename und feste Adresse aus der Einrichtung. Das Passwort steht
      bewusst NICHT hier: Der Status geht auch an die Geräte im WLAN. */
  username: string;
  host: string;
  /** Fehlertext oder Hinweis; sonst leer */
  message: string;
}

export const MIN_BOARD_BRIGHTNESS = 0;
export const MAX_BOARD_BRIGHTNESS = 100;

/** Tormusik-Befehl von der Fernsteuerung an den Laptop. */
export type SoundCommand = 'play' | 'stop';

/**
 * Fassung und Baudatum der laufenden App.
 *
 * Bewusst NICHT Teil von `AppStatus`: Der geht bei jedem
 * Bildschirmereignis neu an beide Fenster, die Fassung ändert sich
 * dagegen nie. Sie wird einmal beim Start abgerufen.
 */
export interface AppInfo {
  /** aus package.json, z. B. "1.0.0" */
  version: string;
  /** ISO-Zeitstempel des Bauvorgangs; leer, wenn build-info.json fehlt */
  builtAt: string;
}

/** IPC-Kanalnamen, zentral gepflegt damit Control/Display/Main nicht auseinanderlaufen */
export const IPC = {
  /**
   * Vollständiger Zustand. Geht nur bei echten Änderungen raus -- er
   * enthält alle Logos und Spielerportraits als Base64 und ist damit
   * schnell einige Megabyte groß. Der Uhr-Tick läuft deshalb über den
   * schlanken Kanal `clockTick`.
   */
  stateUpdated: 'state:updated',
  statusUpdated: 'status:updated',
  scoreIncrement: 'score:increment',
  /** nur `{elapsedMs, running}` -- siehe Kommentar an `IPC.stateUpdated` */
  clockTick: 'clock:tick',
  clockStart: 'clock:start',
  clockSet: 'clock:set',
  setStoppage: 'match:set-stoppage',
  clockStop: 'clock:stop',
  clockReset: 'clock:reset',
  selectDisplay: 'display:select',
  reopenDisplay: 'display:reopen',
  requestState: 'state:request',
  requestStatus: 'status:request',
  teamSetName: 'team:set-name',
  teamSetShortName: 'team:set-short-name',
  teamSetRetroName: 'team:set-retro-name',
  teamPickLogo: 'team:pick-logo',
  teamClearLogo: 'team:clear-logo',
  phaseKickoff: 'phase:kickoff',
  phaseHalfTime: 'phase:half-time',
  phaseSecondHalf: 'phase:second-half',
  phaseFullTime: 'phase:full-time',
  matchReset: 'match:reset',
  phaseRevert: 'phase:revert',
  playerPickPhoto: 'player:pick-photo',
  playerClearPhoto: 'player:clear-photo',
  showScorer: 'scorer:show',
  hideScorer: 'scorer:hide',
  showInfo: 'info:show',
  hideInfo: 'info:hide',
  cornerAdjust: 'corners:adjust',
  setAttendance: 'match:set-attendance',
  setAttendanceMessage: 'match:set-attendance-message',
  setAnnouncements: 'content:set-announcements',
  slideshowStart: 'slideshow:start',
  slideshowStop: 'slideshow:stop',
  shootoutStart: 'shootout:start',
  shootoutKick: 'shootout:kick',
  shootoutUndo: 'shootout:undo',
  shootoutFinish: 'shootout:finish',
  shootoutCancel: 'shootout:cancel',
  mediaReload: 'media:reload',
  setSound: 'sound:set',
  soundRead: 'sound:read',
  cardAdd: 'card:add',
  cardSetPlayer: 'card:set-player',
  subAdd: 'sub:add',
  subSetPlayers: 'sub:set-players',
  eventRemove: 'event:remove',
  setKickoffTime: 'match:set-kickoff-time',
  libraryUpdated: 'library:updated',
  requestLibrary: 'library:request',
  libraryPick: 'library:pick',
  libraryChooseFolder: 'library:choose-folder',
  squadAddPlayer: 'squad:add-player',
  squadUpdatePlayer: 'squad:update-player',
  squadRemovePlayer: 'squad:remove-player',
  squadImport: 'squad:import',
  squadLoadByName: 'squad:load-by-name',
  teamSetCoach: 'team:set-coach',
  showLineup: 'lineup:show',
  hideLineup: 'lineup:hide',
  squadPickFile: 'squad:pick-file',
  squadFileLoaded: 'squad:file-loaded',
  setHalfDuration: 'match:set-half-duration',
  setBoardSize: 'display:set-board-size',
  setAppearance: 'display:set-appearance',
  setCompetition: 'match:set-competition',
  setSponsorSlot: 'match:set-sponsor-slot',
  setSlideBlocks: 'slideshow:set-blocks',
  setLineupStyle: 'lineup:set-style',
  setFormation: 'lineup:set-formation',
  goalSetScorer: 'goal:set-scorer',
  goalSetOwnGoal: 'goal:set-own-goal',
  goalSetPenalty: 'goal:set-penalty',
  /** einmalig abgefragt, liefert `AppInfo` -- siehe dort */
  appInfo: 'app:info',
  /** Tormusik von der Fernsteuerung am Laptop abspielen, siehe `SoundCommand` */
  soundCommand: 'sound:command',
  remoteSetEnabled: 'remote:set-enabled',
  remoteNewPin: 'remote:new-pin',
  /** Verbindung zum TB50 ein/aus -- nur am Laptop */
  boardLinkSetEnabled: 'board-link:set-enabled',
  /** Anmeldung und feste Adresse -- nur am Laptop */
  boardLinkSetConfig: 'board-link:set-config',
  boardSetBrightness: 'board-link:set-brightness',
  boardSelectHdmi: 'board-link:select-hdmi',
} as const;
