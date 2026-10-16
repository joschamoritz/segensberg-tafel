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

export type MatchEvent = GoalEvent | CardEvent;

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
  return overlay.kind === 'attendance' ? THANKS_DISPLAY_MS : INFO_OVERLAY_MS;
}

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
export const HOME_GOAL_STAGES: GoalStagePlan[] = [
  { stage: 'word', ms: 1800 },
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
  { stage: 'plain', ms: 2200 },
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
/** Mehr Seiten hat eine Aufstellungs-Einblendung nicht. */
export const LINEUP_MAX_PAGES = 2;

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
  lineupRequest: { id: number; team: TeamId } | null;
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
  /** siehe `StateRevisions` */
  revisions: StateRevisions;
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
}

/**
 * Medienordner unter `Vereinsdaten/`. Die Werte sind zugleich der
 * Host-Teil der `svh-media:`-URLs (`svh-media://werbung/01_sponsor.jpg`).
 *
 * `sounds` läuft bewusst über denselben Mechanismus wie die Bilder: Ein
 * zweiter Weg für Dateien von der Platte ins Fenster wäre eine zweite
 * Stelle, an der die Pfadprüfung sitzen müsste.
 */
export type MediaFolderId = 'werbung' | 'highlights' | 'sounds';

export const MEDIA_FOLDER_IDS: MediaFolderId[] = ['werbung', 'highlights', 'sounds'];

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

/** Standzeit einer Folie. */
export const SLIDE_DURATION_MS = 8000;

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
 * Zahl der Folien einer Diashow, ohne die normale Ansicht.
 *
 * Gemeinsam für Anzeige und Steuerungsfenster: Die Anzeige baut daraus
 * ihre Folge, das Steuerungsfenster nennt die Zahl im Hinweis. Liefen die
 * beiden auseinander, kündigte der Hinweis eine andere Schau an, als
 * dann tatsächlich läuft.
 */
export function slideCount(
  phase: MatchPhase,
  media: MediaLists,
  announcementCount: number
): number {
  let count = 0;
  for (const folder of slideFoldersForPhase(phase)) {
    const files = media[folder].files.length;
    count += folder === 'werbung' ? Math.ceil(files / SPONSORS_PER_PAGE) : files;
  }
  if (announcementsVisible(phase)) {
    count += Math.ceil(announcementCount / ANNOUNCEMENTS_PER_SLIDE);
  }
  return count;
}

/**
 * Welche Medienordner in welcher Phase laufen.
 *
 * Vor dem Anpfiff nur Werbung -- Highlights und Termine gehören in die
 * Pause, wo die Zuschauer Zeit zum Lesen haben.
 *
 * Nach dem Abpfiff laufen dieselben Ordner wie in der Pause
 * (Nutzerwunsch 20.08.2026). Die frühere Begründung "dort steht der
 * Endstand mit der Torschützenliste" trägt nicht: Die Diashow startet
 * ausschließlich auf Knopfdruck, verdrängt den Endstand also nur, wenn
 * jemand das ausdrücklich will -- und während sich der Platz leert, ist
 * das die sinnvollste Zeit für Sponsorenmotive. Der Endstand ist über
 * "Diashow beenden" jederzeit zurück.
 */
export function slideFoldersForPhase(phase: MatchPhase): MediaFolderId[] {
  if (phase === 'pre-match') return ['werbung'];
  if (phase === 'half-time' || phase === 'full-time') return ['werbung', 'highlights'];
  return [];
}

/**
 * Laufen in dieser Phase Ankündigungsfolien mit?
 *
 * Vor dem Anpfiff nicht -- da schauen die Zuschauer auf die Begegnung,
 * nicht auf den Vereinskalender. In der Pause und nach dem Abpfiff schon:
 * Genau dann ist "Nächstes Heimspiel: So 25.08." die Information, die
 * jemand mitnehmen soll.
 *
 * Gemeinsame Funktion, weil die Regel sonst an zwei Stellen stünde -- im
 * Folienaufbau der Anzeige und in der Folienzählung des
 * Steuerungsfensters. Zwei Kopien liefen beim nächsten Umbau
 * auseinander, und das Steuerungsfenster meldete dann eine Folienzahl,
 * die auf der Tafel nicht stimmt.
 */
export function announcementsVisible(phase: MatchPhase): boolean {
  return phase === 'half-time' || phase === 'full-time';
}

/** Laufen in dieser Phase überhaupt Folien? */
export function slideshowAvailable(phase: MatchPhase): boolean {
  return slideFoldersForPhase(phase).length > 0;
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
 * Retro (Punktmatrix) kommt als eigene Etappe dazu.
 */
export type DisplayTheme = 'klassisch' | 'flutlicht';

export const DISPLAY_THEMES: DisplayTheme[] = ['klassisch', 'flutlicht'];

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
}

/**
 * Klassisch als Vorgabe: Ein Update soll die Tafel nicht ungefragt
 * umgestalten. Das neue Design wird bewusst eingeschaltet.
 */
export const DEFAULT_APPEARANCE: DisplayAppearance = {
  theme: 'klassisch',
  effects: { verlauf: true, strahlen: true, leuchten: true, schatten: true },
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
}

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
  mediaReload: 'media:reload',
  setSound: 'sound:set',
  soundRead: 'sound:read',
  cardAdd: 'card:add',
  cardSetPlayer: 'card:set-player',
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
  goalSetScorer: 'goal:set-scorer',
  /** einmalig abgefragt, liefert `AppInfo` -- siehe dort */
  appInfo: 'app:info',
} as const;
