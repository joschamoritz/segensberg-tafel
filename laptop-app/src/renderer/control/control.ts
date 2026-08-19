import { parseLineup, ParsedPlayer } from '../../shared/lineupParser';
import { controlPhaseLabel, revertTargetLabel } from '../../shared/phaseLabels';
import {
  ANNOUNCEMENTS_PER_SLIDE,
  AppStatus,
  audioMimeType,
  pickGoalSound,
  CARD_LABEL,
  CardColor,
  ClockState,
  clockView,
  DEFAULT_HALF_DURATION_MIN,
  formatClock,
  formatEventMinute,
  MatchState,
  parseClockInput,
  Player,
  playerLabel,
  slideFoldersForPhase,
  slideshowAvailable,
  sortPlayersByNumber,
  TeamId,
} from '../../shared/types';
import type { LibraryPayload } from '../window';

/**
 * Listen mit Eingabefeldern oder Auswahlmenüs dürfen nicht bei jedem
 * Zustands-Update neu aufgebaut werden -- sonst verliert man beim Tippen
 * den Fokus und ein geöffnetes Dropdown klappt sofort wieder zu. Deshalb
 * wird nur neu gezeichnet, wenn sich die zugrunde liegenden Daten wirklich
 * geändert haben.
 *
 * Verglichen werden die Revisionszähler aus dem Store. Früher stand hier
 * ein `JSON.stringify` über die Kader -- das lief samt aller Base64-Bilder
 * bei jedem Uhr-Tick, also fünfmal pro Sekunde.
 */
const renderSignatures = new Map<string, string>();

/** Letzter empfangener Zustand -- für Rückfragen, die den Kontext brauchen. */
let lastRenderedState: MatchState | null = null;

function hasChanged(key: string, signature: string): boolean {
  if (renderSignatures.get(key) === signature) return false;
  renderSignatures.set(key, signature);
  return true;
}

/**
 * Zeigt JS-Fehler direkt sichtbar auf der Seite an (zusätzlich zur Konsole),
 * damit ein kaputter main()-Lauf (z.B. durch ein falsches Element-ID) nicht
 * stillschweigend alle Button-Klicks lahmlegt, ohne dass man es merkt.
 */
function showError(text: string): void {
  const banner = document.getElementById('js-error-banner');
  if (!banner) return;
  banner.hidden = false;
  banner.textContent = banner.textContent ? `${banner.textContent}\n---\n${text}` : text;
}

window.addEventListener('error', (event) => {
  showError(`Fehler: ${event.message}\n  bei ${event.filename}:${event.lineno}:${event.colno}`);
});
window.addEventListener('unhandledrejection', (event) => {
  showError(`Unbehandelte Promise-Ablehnung: ${String(event.reason)}`);
});

/**
 * Merkt sich, welches Feld gerade bearbeitet wird.
 *
 * `document.activeElement` allein reicht nicht: Bei `<input type="time">`
 * und `type="number"` öffnet Chromium eigene Auswahl-Elemente, wodurch das
 * Feld zwischenzeitlich nicht mehr als aktiv gilt. Ein Zustands-Update
 * hätte die halbfertige Eingabe dann überschrieben -- genau das führte
 * dazu, dass sich die Anstoßzeit nicht eintragen ließ.
 *
 * `WeakSet`, damit entfernte Eingabefelder nicht dauerhaft im Speicher
 * gehalten werden -- der Kader-Editor tauscht Zeilen aus.
 */
const editingInputs = new WeakSet<HTMLElement>();

document.addEventListener('focusin', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    editingInputs.add(target);
  }
});

document.addEventListener('focusout', (event) => {
  const target = event.target;
  if (target instanceof HTMLElement) editingInputs.delete(target);
});

/**
 * Aktualisiert ein Eingabefeld aus dem Zustand, solange es nicht gerade
 * bearbeitet wird -- sonst würde jeder Uhr-Tick (alle 200ms) die Eingabe
 * überschreiben.
 */
function updateInputIfNotFocused(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  if (editingInputs.has(input) || document.activeElement === input) return;
  if (input.value === value) return;
  input.value = value;
}

function renderTeamSettings(team: TeamId, state: MatchState): void {
  const teamState = state[team];

  const nameInput = document.getElementById(`${team}-name-input`) as HTMLInputElement;
  updateInputIfNotFocused(nameInput, teamState.name);

  const shortNameInput = document.getElementById(`${team}-shortname-input`) as HTMLInputElement;
  updateInputIfNotFocused(shortNameInput, teamState.shortName);

  const preview = document.getElementById(`${team}-logo-preview`) as HTMLImageElement;
  const clearBtn = document.getElementById(`${team}-logo-clear`) as HTMLButtonElement;
  if (teamState.logoDataUrl) {
    preview.src = teamState.logoDataUrl;
    preview.hidden = false;
    clearBtn.hidden = false;
  } else {
    preview.hidden = true;
    clearBtn.hidden = true;
  }
}

/**
 * Füllt die Vereins-Auswahl aus der Logo-Bibliothek. Nach Liga gruppiert,
 * damit bei mehreren Spielzeiten/Ligen die Übersicht erhalten bleibt.
 */
function renderLibrary(payload: LibraryPayload): void {
  const info = document.getElementById('library-info')!;
  const leer = payload.teams.length === 0;

  // Ein leeres Dropdown ohne Erklärung ist der schlechteste Fall: Auf einem
  // anderen Rechner als dem Entwicklungsrechner liegen die Vereinsdaten
  // woanders, und man sucht den Fehler in der App.
  info.textContent = leer
    ? `Keine Vereinslogos gefunden in "${payload.rootPath}" – über „Logo-Ordner…" den richtigen Ordner wählen.`
    : `${payload.teams.length} Vereine · ${payload.rootPath}`;
  info.classList.toggle('is-empty', leer);

  const byLeague = new Map<string, typeof payload.teams>();
  for (const team of payload.teams) {
    const list = byLeague.get(team.league) ?? [];
    list.push(team);
    byLeague.set(team.league, list);
  }

  for (const team of ['home', 'away'] as TeamId[]) {
    const select = document.getElementById(`${team}-library-select`) as HTMLSelectElement;
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '– Verein wählen –';
    select.appendChild(placeholder);

    for (const [league, teams] of byLeague) {
      const group = document.createElement('optgroup');
      group.label = league;
      for (const entry of teams) {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name;
        group.appendChild(option);
      }
      select.appendChild(group);
    }
  }

  renderSquadNames(payload);
}

/**
 * Auswahl bereits gespeicherter Kader. Praktisch für den eigenen Verein:
 * 1. Mannschaft, 2. Mannschaft und Jugendteams liegen unter eigenen Namen
 * und lassen sich hier umschalten.
 */
function renderSquadNames(payload: LibraryPayload): void {
  for (const team of ['home', 'away'] as TeamId[]) {
    const select = document.getElementById(`${team}-squad-select`) as HTMLSelectElement;
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent =
      payload.squadNames.length === 0 ? '– noch keine gespeichert –' : '– Kader wählen –';
    select.appendChild(placeholder);

    for (const name of payload.squadNames) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
  }
}

/** Kader-Editor einer Mannschaft. */
function renderSquad(team: TeamId, state: MatchState): void {
  const title = document.getElementById(`${team}-squad-title`)!;
  title.textContent = state[team].name;

  // Warnung bei zu vielen Startspielern: Die Aufstellungsseite fasst
  // 11 Spieler plus Trainer -- alles darüber würde auf der Tafel
  // kommentarlos abgeschnitten.
  const starters = state.squads[team].filter((p) => p.role === 'start').length;
  const warning = document.getElementById(`${team}-squad-warning`)!;
  if (starters > 11) {
    warning.textContent = `${starters} Spieler auf "Start" – es passen nur 11 auf die Aufstellungsseite.`;
    warning.hidden = false;
  } else {
    warning.hidden = true;
  }

  const coachInput = document.getElementById(`${team}-coach-input`) as HTMLInputElement;
  updateInputIfNotFocused(coachInput, state[team].coach);

  const players = state.squads[team];
  if (!hasChanged(`squad-${team}`, String(state.revisions.squads))) return;

  syncSquadRows(team, players);
}

/** Eine Zeile des Kader-Editors samt Funktion zum Nachführen der Werte. */
interface SquadRow {
  element: HTMLElement;
  update: (player: Player) => void;
}

interface SquadList {
  rows: Map<string, SquadRow>;
  /** Zielreihenfolge, die wegen eines aktiven Eingabefelds warten muss. */
  pendingOrder: string[] | null;
}

const squadLists = new Map<TeamId, SquadList>();

/**
 * Gleicht die Zeilen des Kader-Editors mit dem Zustand ab, statt die Liste
 * jedes Mal neu aufzubauen.
 *
 * Ein vollständiger Neuaufbau riss beim Tippen den Fokus aus dem Feld,
 * sobald ein Zustands-Update hereinkam -- beim Wechsel zwischen Vor- und
 * Nachname war der Cursor plötzlich weg.
 */
function syncSquadRows(team: TeamId, players: Player[]): void {
  const list = document.getElementById(`${team}-squad-list`)!;
  const state = squadLists.get(team) ?? initSquadList(team, list);

  if (players.length === 0) {
    list.innerHTML = '';
    state.rows.clear();
    state.pendingOrder = null;
    const empty = document.createElement('p');
    empty.className = 'squad-empty';
    empty.textContent = 'Noch keine Spieler angelegt.';
    list.appendChild(empty);
    return;
  }

  // Erste Zeile nach einem leeren Kader: Kopfzeile wieder herstellen.
  if (state.rows.size === 0) {
    list.innerHTML = '';
    list.appendChild(buildSquadHeader());
  }

  const sorted = sortPlayersByNumber(players);
  const wanted = new Set(sorted.map((p) => p.id));

  // Entfernte Spieler austragen
  for (const [id, row] of state.rows) {
    if (wanted.has(id)) continue;
    row.element.remove();
    state.rows.delete(id);
  }

  // Vorhandene aktualisieren, neue anlegen
  for (const player of sorted) {
    const existing = state.rows.get(player.id);
    if (existing) {
      existing.update(player);
      continue;
    }
    const row = buildPlayerRow(team, player);
    state.rows.set(player.id, row);
    list.appendChild(row.element);
  }

  applySquadOrder(team, list, state, sorted.map((p) => p.id));
}

/**
 * Bringt die Zeilen in die Reihenfolge der Trikotnummern.
 *
 * Ein im DOM verschobener Knoten verliert den Fokus. Wird gerade in dieser
 * Liste getippt, wartet die Sortierung deshalb, bis das Feld verlassen
 * wird -- sonst spränge der Cursor beim Eintragen einer Nummer weg.
 */
function applySquadOrder(
  team: TeamId,
  list: HTMLElement,
  state: SquadList,
  order: string[]
): void {
  if (list.contains(document.activeElement)) {
    state.pendingOrder = order;
    return;
  }
  state.pendingOrder = null;

  for (const id of order) {
    const row = state.rows.get(id);
    // appendChild verschiebt einen bereits vorhandenen Knoten ans Ende --
    // der Reihe nach ergibt das die gewünschte Sortierung.
    if (row) list.appendChild(row.element);
  }
}

function initSquadList(team: TeamId, list: HTMLElement): SquadList {
  const state: SquadList = { rows: new Map(), pendingOrder: null };
  squadLists.set(team, state);

  // Sortierung nachholen, sobald der Fokus die Liste verlässt.
  // `relatedTarget` ist das Element, das den Fokus bekommt -- beim Wechsel
  // innerhalb derselben Liste darf nicht umsortiert werden.
  list.addEventListener('focusout', (event) => {
    const next = (event as FocusEvent).relatedTarget;
    if (next instanceof Node && list.contains(next)) return;
    if (!state.pendingOrder) return;
    applySquadOrder(team, list, state, state.pendingOrder);
  });

  return state;
}

/** Spaltenüberschriften -- sonst wären die beiden Häkchen nicht erklärt. */
function buildSquadHeader(): HTMLElement {
  const header = document.createElement('div');
  header.className = 'squad-row squad-head';
  for (const label of ['Nr.', 'Vorname', 'Nachname', 'TW', 'C', 'Einsatz', 'Foto', '']) {
    const cell = document.createElement('span');
    cell.textContent = label;
    header.appendChild(cell);
  }
  return header;
}

function buildPlayerRow(team: TeamId, player: Player): SquadRow {
  const row = document.createElement('div');
  row.className = 'squad-row';

  /** Aktueller Stand dieses Spielers -- wird bei jedem Update nachgeführt,
      damit `emit()` nicht mit veralteten Werten arbeitet. */
  let current = player;

  /** Sendet die geänderte Zeile als vollständigen Spieler zurück. */
  const emit = (): void => {
    window.api.squadUpdatePlayer(team, {
      id: current.id,
      number: numberInput.value === '' ? null : Number(numberInput.value),
      firstName: firstNameInput.value,
      lastName: lastNameInput.value,
      // Position wird nicht angezeigt (auf der Tafel stehen Nummer und
      // Nachname), aber erhalten -- der Aufstellungs-Parser trägt sie ein.
      position: current.position,
      role: roleSelect.value as Player['role'],
      isGoalkeeper: keeperBox.checked,
      isCaptain: captainBox.checked,
      photoDataUrl: current.photoDataUrl,
    });
  };

  const keeperBox = document.createElement('input');
  keeperBox.type = 'checkbox';
  keeperBox.title = 'Torwart';
  keeperBox.checked = player.isGoalkeeper;
  keeperBox.addEventListener('change', emit);

  const captainBox = document.createElement('input');
  captainBox.type = 'checkbox';
  captainBox.title = 'Spielführer';
  captainBox.checked = player.isCaptain;
  captainBox.addEventListener('change', emit);

  const roleSelect = document.createElement('select');
  roleSelect.className = 'squad-role';
  for (const [value, label] of [
    ['start', 'Start'],
    ['bench', 'Bank'],
    ['out', 'Nicht dabei'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    roleSelect.appendChild(option);
  }
  roleSelect.value = player.role;
  roleSelect.addEventListener('change', emit);

  const numberInput = document.createElement('input');
  numberInput.type = 'number';
  numberInput.min = '0';
  numberInput.placeholder = 'Nr.';
  numberInput.value = player.number === null ? '' : String(player.number);
  numberInput.addEventListener('change', emit);

  const firstNameInput = document.createElement('input');
  firstNameInput.type = 'text';
  firstNameInput.placeholder = 'Vorname';
  firstNameInput.value = player.firstName;
  firstNameInput.addEventListener('change', emit);

  const lastNameInput = document.createElement('input');
  lastNameInput.type = 'text';
  lastNameInput.placeholder = 'Nachname';
  lastNameInput.value = player.lastName;
  lastNameInput.addEventListener('change', emit);

  // Portrait: Klick wählt ein Bild, bei vorhandenem Bild entfernt ein
  // zweiter Klick es wieder (mit Rückfrage).
  const photo = document.createElement('button');
  photo.addEventListener('click', () => {
    if (current.photoDataUrl && confirm('Portrait entfernen? Abbrechen wählt stattdessen ein neues.')) {
      window.api.playerClearPhoto(team, current.id);
    } else {
      window.api.playerPickPhoto(team, current.id);
    }
  });

  const remove = document.createElement('button');
  remove.className = 'squad-remove';
  remove.textContent = '×';
  remove.title = 'Spieler entfernen';
  remove.addEventListener('click', () => window.api.squadRemovePlayer(team, current.id));

  row.append(
    numberInput,
    firstNameInput,
    lastNameInput,
    keeperBox,
    captainBox,
    roleSelect,
    photo,
    remove
  );

  /**
   * Führt die Zeile auf den neuen Stand nach. Eingabefelder werden dabei
   * nur angefasst, wenn sie nicht gerade bearbeitet werden -- sonst
   * überschriebe ein Zustands-Update die halbfertige Eingabe.
   */
  const update = (next: Player): void => {
    current = next;

    updateInputIfNotFocused(numberInput, next.number === null ? '' : String(next.number));
    updateInputIfNotFocused(firstNameInput, next.firstName);
    updateInputIfNotFocused(lastNameInput, next.lastName);

    if (document.activeElement !== keeperBox) keeperBox.checked = next.isGoalkeeper;
    if (document.activeElement !== captainBox) captainBox.checked = next.isCaptain;
    if (document.activeElement !== roleSelect) roleSelect.value = next.role;

    photo.className = next.photoDataUrl ? 'squad-photo has-photo' : 'squad-photo';
    photo.textContent = next.photoDataUrl ? '🖼' : '+';
    photo.title = next.photoDataUrl
      ? 'Portrait ersetzen oder entfernen'
      : 'Portrait hinterlegen';
  };

  update(player);
  return { element: row, update };
}

/** Chronik der Tore: Minute, Mannschaft, Zwischenstand und Torschütze. */
function renderGoalLog(state: MatchState): void {
  const empty = document.getElementById('goal-log-empty')!;
  empty.hidden = state.events.length > 0;

  // Kader und Vereinsnamen gehören mit in die Signatur -- sonst tauchten
  // neu angelegte Spieler nicht in den Torschützen-Auswahlfeldern auf und
  // eine Umbenennung bliebe in der Chronik stehen.
  const { events, squads, teams } = state.revisions;
  if (!hasChanged('goal-log', `${events}-${squads}-${teams}`)) return;

  const list = document.getElementById('goal-log')!;
  list.innerHTML = '';

  for (const event of state.events) {
    const item = document.createElement('li');
    item.classList.add(event.type === 'goal' ? 'is-goal' : `is-card-${event.card}`);

    const minute = document.createElement('span');
    minute.className = 'goal-minute';
    minute.textContent = formatEventMinute(event);

    const teamName = document.createElement('span');
    teamName.textContent = state[event.team].name;

    const kind = document.createElement('span');
    kind.className = 'goal-standing';
    kind.textContent =
      event.type === 'goal' ? `${event.scoreHome}:${event.scoreAway}` : CARD_LABEL[event.card];

    // Spieler wird meist erst nachträglich zugeordnet -- deshalb hier und
    // nicht als Pflichtfeld beim Klick auf Tor bzw. Karte.
    const currentPlayerId = event.type === 'goal' ? event.scorerId : event.playerId;
    const playerSelect = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = event.type === 'goal' ? '– Torschütze –' : '– Spieler (optional) –';
    playerSelect.appendChild(none);
    for (const player of sortPlayersByNumber(state.squads[event.team])) {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = playerLabel(player);
      playerSelect.appendChild(option);
    }
    playerSelect.value = currentPlayerId ?? '';

    const eventId = event.id;
    const eventType = event.type;
    playerSelect.addEventListener('change', () => {
      const value = playerSelect.value === '' ? undefined : playerSelect.value;
      if (eventType === 'goal') window.api.goalSetScorer(eventId, value);
      else window.api.cardSetPlayer(eventId, value);
    });

    item.append(minute, teamName, kind, playerSelect);

    // Einblendung gibt es nur für Tore und erst mit zugeordnetem Schützen
    if (event.type === 'goal') {
      const show = document.createElement('button');
      show.className = 'btn btn-small';
      show.textContent = 'Torschütze anzeigen';
      show.disabled = !event.scorerId;
      show.title = event.scorerId
        ? 'Name, Portrait und Spielstand auf der Tafel einblenden'
        : 'Erst einen Torschützen auswählen';
      show.addEventListener('click', () => window.api.showScorer(eventId));
      item.appendChild(show);
    }

    // Karten erscheinen im laufenden Spiel automatisch -- da ist der
    // Spieler aber meist noch nicht zugeordnet. Dieser Knopf wiederholt
    // die Einblendung, dann mit Namen.
    if (event.type === 'card') {
      const show = document.createElement('button');
      show.className = 'btn btn-small';
      show.textContent = 'Karte einblenden';
      show.title = 'Karte erneut auf der Tafel zeigen (jetzt mit Spielername)';
      show.addEventListener('click', () =>
        window.api.showInfo({ kind: 'card', eventId })
      );
      item.appendChild(show);
    }

    const remove = document.createElement('button');
    remove.className = 'goal-remove';
    remove.textContent = '×';
    remove.title = 'Eintrag löschen';
    remove.addEventListener('click', () => {
      if (confirm('Diesen Eintrag löschen?')) window.api.eventRemove(eventId);
    });
    item.appendChild(remove);

    list.appendChild(item);
  }
}

/**
 * Schaltet die Phasen-Buttons: `enabled` spiegelt exakt, was der Store
 * erlaubt, `next` hebt zusätzlich den im normalen Spielverlauf fälligen
 * Schritt hervor. Abpfiff ist bewusst auch in der 1. Halbzeit möglich
 * (Spielabbruch wegen Wetter/Verletzung), nur eben nicht hervorgehoben.
 */
function renderPhaseControls(state: MatchState): void {
  document.getElementById('phase-current-label')!.textContent = controlPhaseLabel(state.phase, state.half);

  const isLive = state.phase === 'live';
  const buttons: Record<string, { enabled: boolean; next: boolean }> = {
    'phase-kickoff': {
      enabled: state.phase === 'pre-match',
      next: state.phase === 'pre-match',
    },
    'phase-halftime': {
      enabled: isLive && state.half === 1,
      next: isLive && state.half === 1,
    },
    'phase-second-half': {
      enabled: state.phase === 'half-time',
      next: state.phase === 'half-time',
    },
    'phase-fulltime': {
      enabled: isLive,
      next: isLive && state.half === 2,
    },
  };

  for (const [id, { enabled, next }] of Object.entries(buttons)) {
    const btn = document.getElementById(id) as HTMLButtonElement;
    btn.disabled = !enabled;
    btn.classList.toggle('btn-next', next);
  }

  // Rückfallebene für versehentliche Phasenwechsel
  const revert = document.getElementById('phase-revert') as HTMLButtonElement;
  const target = revertTargetLabel(state.phase, state.half);
  revert.disabled = target === null;
  revert.title = target === null ? '' : `Zurück zu: ${target}`;
}


/**
 * Aufstellungs-Knöpfe. Die Einblendung wirkt nur in der Vor-Anpfiff-Ansicht,
 * deshalb sind die Knöpfe danach deaktiviert statt wirkungslos.
 */
function renderLineupControls(state: MatchState): void {
  const enabled = state.phase === 'pre-match';
  for (const id of ['lineup-show-home', 'lineup-show-away', 'lineup-hide']) {
    (document.getElementById(id) as HTMLButtonElement).disabled = !enabled;
  }

  const hint = document.getElementById('lineup-controls-hint')!;
  if (!enabled) {
    hint.textContent = 'Nur vor dem Anpfiff verfügbar.';
    return;
  }

  const missing = (['home', 'away'] as TeamId[]).filter(
    (team) => state.squads[team].filter((p) => p.role !== 'out').length === 0
  );
  hint.textContent =
    missing.length === 0
      ? ''
      : `Kein Kader erfasst für: ${missing.map((team) => state[team].name).join(', ')}`;
}

/**
 * Eckenzähler und Zuschauerzahl.
 *
 * Beide erscheinen auf der Tafel nur auf Knopfdruck, nicht dauerhaft: Im
 * laufenden Spiel ist bei 384x192 kein Platz für eine weitere feste
 * Zeile, ohne dem Uhr-Panel etwas wegzunehmen.
 */
function renderInfoControls(state: MatchState): void {
  for (const team of ['home', 'away'] as TeamId[]) {
    document.getElementById(`${team}-corner-count`)!.textContent = String(
      state.corners[team]
    );
  }

  const input = document.getElementById('attendance-input') as HTMLInputElement;
  updateInputIfNotFocused(input, state.attendance === null ? '' : String(state.attendance));

  const message = document.getElementById('attendance-message-input') as HTMLInputElement;
  updateInputIfNotFocused(message, state.attendanceMessage);

  // Ohne eingetragene Zahl bliebe die Danksagung ohne Inhalt -- dann
  // lieber den Knopf sperren, als dass ein Druck folgenlos bleibt.
  const showAttendance = document.getElementById('info-show-attendance') as HTMLButtonElement;
  showAttendance.disabled = state.attendance === null;

  document.getElementById('info-controls-hint')!.textContent =
    state.attendance === null
      ? 'Zuschauerzahl eintragen, dann einblenden.'
      : 'Ecken als Leiste unten, Zuschauer als Danksagung über das ganze Bild.';
}

/**
 * Tormusik.
 *
 * Sie läuft im Steuerungsfenster, nicht im Anzeigefenster: Chromium gibt
 * Ton immer auf dem Windows-Standardgerät aus -- welches Fenster ihn
 * abspielt, ändert daran nichts. Regler und Schalter gehören dorthin, wo
 * die Person sitzt.
 *
 * Ausgelöst wird sie **ausschließlich von Hand** (Nutzerwunsch
 * 19.08.2026). Eine automatische Auslösung beim Tor war zwischenzeitlich
 * eingebaut und ist wieder entfernt: Ob Musik läuft, hängt an Dingen, die
 * die App nicht weiß -- läuft gerade eine Durchsage, ist der Gegner in
 * Trauerflor, war es ein Eigentor. Nebenbei erledigt sich damit auch die
 * Frage, ob bei einem Gegentor Musik laufen soll: Sie tut es nur, wenn
 * jemand sie startet.
 */
function goalSoundElement(): HTMLAudioElement {
  return document.getElementById('goal-sound') as HTMLAudioElement;
}

/**
 * Zuletzt geladene Datei und der zugehörige Blob-Verweis.
 *
 * Die Datei wird einmal vollständig über IPC geholt und aus dem Speicher
 * abgespielt. Zwei Wege wurden vorher probiert und verworfen:
 *
 * - Direkt aus `svh-media:` streamen (`<audio src="svh-media://…">`):
 *   Der Protokollhandler reicht `net.fetch` auf eine `file:`-URL durch
 *   und beantwortet keine Teilbereichs-Anfragen (Range). Chromium spielte
 *   an, wollte nachpuffern, brach ab und begann von vorn -- hörbar als
 *   Aussetzer nach etwa zwei Sekunden.
 * - Per `fetch('svh-media://…')` holen: scheitert an der
 *   Herkunftsprüfung. Das Fenster läuft unter `file://`, das Schema ist
 *   eine eigene Herkunft, und der Handler schickt keine CORS-Kopfzeile
 *   ("TypeError: Failed to fetch").
 *
 * Über IPC entfallen beide Fragen. Der Aufruf passiert nur, wenn sich
 * der Dateiname ändert -- nicht bei jedem Abspielen.
 */
let goalSoundFile = '';
let goalSoundObjectUrl: string | null = null;

function releaseGoalSound(): void {
  if (goalSoundObjectUrl) URL.revokeObjectURL(goalSoundObjectUrl);
  goalSoundObjectUrl = null;
}

async function loadGoalSound(fileName: string): Promise<void> {
  const audio = goalSoundElement();

  if (fileName === '') {
    audio.removeAttribute('src');
    releaseGoalSound();
    return;
  }

  try {
    const bytes = await window.api.readGoalSound(fileName);
    if (bytes === null) throw new Error('Datei nicht lesbar oder nicht erlaubt');
    releaseGoalSound();
    // Kopie in ein frisches Uint8Array: Über IPC kommt der Puffer als
    // ArrayBufferLike an, und Blob() verlangt ausdrücklich ArrayBuffer.
    const blob = new Blob([new Uint8Array(bytes)], { type: audioMimeType(fileName) });
    goalSoundObjectUrl = URL.createObjectURL(blob);
    audio.src = goalSoundObjectUrl;
  } catch (error) {
    showError(`Tormusik konnte nicht geladen werden (${fileName}): ${String(error)}`);
  }
}

/**
 * Meldet Ladefehler der Tonspur sichtbar.
 *
 * Ein <audio>-Element scheitert lautlos: Ohne diesen Melder sitzt man
 * vor einem Knopf, der nichts tut, und weiß nicht, ob die Datei fehlt,
 * das Format nicht passt oder der Pfad falsch ist.
 */
function wireSoundDiagnostics(): void {
  const audio = goalSoundElement();
  audio.addEventListener('error', () => {
    const quelle = audio.getAttribute('src') ?? '(keine)';
    showError(`Tormusik konnte nicht geladen werden: ${quelle}`);
  });
}

/** Spielt die Tormusik von vorn -- auch wenn sie noch läuft. */
function playGoalSound(): void {
  const audio = goalSoundElement();
  if (!audio.getAttribute('src')) return;
  audio.currentTime = 0;
  // Ein abgewiesenes play() darf den Spielbetrieb nicht stören -- aber
  // stumm scheitern darf es auch nicht, sonst sucht man den Fehler bei
  // der Anlage statt bei der App.
  void audio.play().catch((error) => {
    showError(`Tormusik ließ sich nicht abspielen: ${String(error)}`);
  });
}

/** Hält die Musik an und setzt sie auf den Anfang zurück. */
function stopGoalSound(): void {
  const audio = goalSoundElement();
  audio.pause();
  audio.currentTime = 0;
}

function renderSoundControls(state: MatchState): void {
  const audio = goalSoundElement();

  const datei = pickGoalSound(state.media.sounds.files);
  // Nur bei echter Änderung neu laden -- sonst risse jedes
  // Zustands-Update die laufende Musik ab.
  if (goalSoundFile !== (datei ?? '')) {
    goalSoundFile = datei ?? '';
    void loadGoalSound(goalSoundFile);
  }

  audio.volume = state.sound.volume / 100;
  audio.muted = state.sound.muted;

  const slider = document.getElementById('sound-volume') as HTMLInputElement;
  updateInputIfNotFocused(slider, String(state.sound.volume));
  document.getElementById('sound-volume-value')!.textContent = `${state.sound.volume} %`;

  const mute = document.getElementById('sound-muted') as HTMLInputElement;
  if (document.activeElement !== mute) mute.checked = state.sound.muted;

  (document.getElementById('sound-play') as HTMLButtonElement).disabled = datei === null;
  (document.getElementById('sound-stop') as HTMLButtonElement).disabled = datei === null;

  const hint = document.getElementById('sound-hint')!;
  const leer = datei === null;
  hint.textContent = leer
    ? `Keine Audiodatei gefunden in "${state.media.sounds.rootPath}".`
    : `${datei} – läuft nur auf Knopfdruck, nie von selbst.`;
  hint.classList.toggle('is-empty', leer);
}

/**
 * Diashow-Knöpfe und Ankündigungen.
 *
 * Die Schau läuft nur in den Phasen, in denen sie sinnvoll ist -- im
 * laufenden Spiel gehört der Spielstand auf die Tafel, nach dem Abpfiff
 * der Endstand. Findet sich kein Motiv, sagt der Hinweis deutlich WO
 * gesucht wurde: Bei der Logo-Bibliothek war ein wortlos leeres Ergebnis
 * der schlechteste Fall.
 */
function renderSlideshowControls(state: MatchState): void {
  const available = slideshowAvailable(state.phase);
  const running = state.slideshowRequest !== null;

  const folders = slideFoldersForPhase(state.phase);
  const bilder = folders.reduce((sum, folder) => sum + state.media[folder].files.length, 0);
  const termine =
    state.phase === 'half-time'
      ? Math.ceil(state.announcements.length / ANNOUNCEMENTS_PER_SLIDE)
      : 0;
  const folien = bilder + termine;

  const start = document.getElementById('slideshow-start') as HTMLButtonElement;
  const stop = document.getElementById('slideshow-stop') as HTMLButtonElement;

  start.disabled = !available || folien === 0;
  stop.disabled = !running;
  start.classList.toggle('btn-next', available && !running && folien > 0);

  const hint = document.getElementById('slideshow-hint')!;
  const leer = available && folien === 0;

  if (!available) {
    hint.textContent = 'Nur vor dem Anpfiff und in der Halbzeitpause.';
  } else if (leer) {
    hint.textContent =
      'Keine Motive gefunden in "' + state.media.werbung.rootPath + '".';
  } else if (running) {
    hint.textContent = folien + ' Folien laufen im Wechsel mit dem Spielstand.';
  } else {
    hint.textContent = folien + ' Folien bereit.';
  }
  hint.classList.toggle('is-empty', leer);

  const announcements = document.getElementById('announcements-input') as HTMLTextAreaElement;
  updateInputIfNotFocused(announcements, state.announcements.join('\n'));
}

/**
 * Uhr und Nachspielzeit. Wird sowohl aus dem vollständigen Zustand als auch
 * aus dem schlanken Uhr-Tick aufgerufen; Halbzeit und Halbzeitdauer kommen
 * dabei aus dem zuletzt empfangenen Zustand.
 */
function renderClock(clock: ClockState): void {
  const view = clockView(
    clock.elapsedMs,
    lastRenderedState?.half ?? 1,
    lastRenderedState?.halfDurationMin ?? DEFAULT_HALF_DURATION_MIN,
    lastRenderedState?.stoppageMinutes ?? 0
  );
  document.getElementById('clock-display')!.textContent = formatClock(view.displayMs);

  const stoppage = document.getElementById('stoppage-display')!;
  stoppage.textContent = view.stoppage === null ? '' : `+${view.stoppage}`;
  stoppage.hidden = view.stoppage === null;
}

/**
 * Hebt den gesetzten Wert hervor und hält das Eingabefeld für größere
 * Werte auf Stand.
 */
function renderStoppageControls(state: MatchState): void {
  const current = state.stoppageMinutes;

  for (const btn of document.querySelectorAll<HTMLButtonElement>('#stoppage-buttons button')) {
    btn.classList.toggle('is-active', Number(btn.dataset.stoppage) === current);
  }

  const input = document.getElementById('stoppage-input') as HTMLInputElement;
  updateInputIfNotFocused(input, current === 0 ? '' : String(current));
}

function renderState(state: MatchState): void {
  lastRenderedState = state;
  document.getElementById('home-score')!.textContent = String(state.home.score);
  document.getElementById('away-score')!.textContent = String(state.away.score);
  renderClock(state.clock);

  document.getElementById('half-display')!.textContent = `${state.half}. Halbzeit`;

  document.getElementById('home-team-label')!.textContent = state.home.name;
  document.getElementById('away-team-label')!.textContent = state.away.name;

  const kickoffInput = document.getElementById('kickoff-input') as HTMLInputElement;
  updateInputIfNotFocused(kickoffInput, state.kickoffTime);

  const halfDurationInput = document.getElementById('half-duration-input') as HTMLInputElement;
  updateInputIfNotFocused(halfDurationInput, String(state.halfDurationMin));

  const boardWidthInput = document.getElementById('board-width-input') as HTMLInputElement;
  const boardHeightInput = document.getElementById('board-height-input') as HTMLInputElement;
  updateInputIfNotFocused(boardWidthInput, String(state.board.width));
  updateInputIfNotFocused(boardHeightInput, String(state.board.height));

  renderStoppageControls(state);
  renderPhaseControls(state);
  renderLineupControls(state);
  renderInfoControls(state);
  renderSlideshowControls(state);
  renderSoundControls(state);
  renderGoalLog(state);
  renderSquad('home', state);
  renderSquad('away', state);
  renderTeamSettings('home', state);
  renderTeamSettings('away', state);
}

function renderStatus(status: AppStatus): void {
  const banner = document.getElementById('display-status')!;
  if (!status.displayOpen) {
    // Das Anzeigefenster steht randlos und ohne Taskleisteneintrag auf dem
    // zweiten Bildschirm -- dass es fehlt, sieht man am Steuerungsfenster
    // sonst nicht.
    banner.textContent =
      'Anzeigefenster ist geschlossen – über „Anzeigefenster neu öffnen" zurückholen.';
    banner.classList.add('warning');
  } else if (status.previewMode) {
    banner.textContent =
      'Kein zweiter Bildschirm erkannt – Anzeige läuft im Vorschau-Fenster.';
    banner.classList.add('warning');
  } else {
    const target = status.displays.find((d) => d.id === status.selectedDisplayId);
    banner.textContent = target
      ? `Anzeige läuft auf: ${target.label}`
      : 'Anzeige-Fenster aktiv.';
    banner.classList.remove('warning');
  }

  const select = document.getElementById('display-select') as HTMLSelectElement;
  select.innerHTML = '';

  const previewOption = document.createElement('option');
  previewOption.value = '';
  previewOption.textContent = 'Vorschau-Fenster (kein externer Bildschirm)';
  select.appendChild(previewOption);

  for (const display of status.displays) {
    const option = document.createElement('option');
    option.value = String(display.id);
    option.textContent = `${display.label}${display.isPrimary ? ' (Haupt-Bildschirm)' : ''}`;
    select.appendChild(option);
  }

  select.value = status.previewMode ? '' : String(status.selectedDisplayId ?? '');
}

function wireTeamSettings(team: TeamId): void {
  const nameInput = document.getElementById(`${team}-name-input`) as HTMLInputElement;
  nameInput.addEventListener('change', () => window.api.teamSetName(team, nameInput.value));

  const shortNameInput = document.getElementById(`${team}-shortname-input`) as HTMLInputElement;
  shortNameInput.addEventListener('change', () =>
    window.api.teamSetShortName(team, shortNameInput.value)
  );

  document
    .getElementById(`${team}-logo-pick`)!
    .addEventListener('click', () => window.api.teamPickLogo(team));
  document
    .getElementById(`${team}-logo-clear`)!
    .addEventListener('click', () => window.api.teamClearLogo(team));

  const librarySelect = document.getElementById(`${team}-library-select`) as HTMLSelectElement;
  librarySelect.addEventListener('change', () => {
    if (!librarySelect.value) return;
    window.api.libraryPick(team, librarySelect.value);
    // Auswahl zurücksetzen: der übernommene Verein steht danach im
    // Namensfeld, das Dropdown dient nur als Auswahlhilfe.
    librarySelect.value = '';
  });
}

function main(): void {
  window.api.onStateUpdated(renderState);
  window.api.onClockTick(renderClock);
  window.api.onStatusUpdated(renderStatus);
  window.api.onLibraryUpdated(renderLibrary);
  window.api.requestState();
  window.api.requestStatus();
  window.api.requestLibrary();

  const kickoffInput = document.getElementById('kickoff-input') as HTMLInputElement;
  kickoffInput.addEventListener('change', () => window.api.setKickoffTime(kickoffInput.value));

  const halfDurationInput = document.getElementById('half-duration-input') as HTMLInputElement;
  halfDurationInput.addEventListener('change', () =>
    window.api.setHalfDuration(Number(halfDurationInput.value))
  );

  // Beide Maße gehen immer gemeinsam raus: Die Prüfschicht behandelt einen
  // unbrauchbaren Einzelwert für sich, aber der Zustand kennt nur ein
  // vollständiges Paar. `change` statt `input` -- beim Tippen von "384"
  // wäre "3" ein Zwischenstand, der die Bühne kurz auf das Mindestmaß
  // zöge.
  const boardWidthInput = document.getElementById('board-width-input') as HTMLInputElement;
  const boardHeightInput = document.getElementById('board-height-input') as HTMLInputElement;
  const sendBoardSize = () =>
    window.api.setBoardSize({
      width: Number(boardWidthInput.value),
      height: Number(boardHeightInput.value),
    });
  boardWidthInput.addEventListener('change', sendBoardSize);
  boardHeightInput.addEventListener('change', sendBoardSize);

  document
    .getElementById('library-folder')!
    .addEventListener('click', () => window.api.libraryChooseFolder());
  document
    .getElementById('library-reload')!
    .addEventListener('click', () => window.api.requestLibrary());

  document.querySelectorAll<HTMLButtonElement>('button[data-team]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const team = btn.dataset.team as TeamId;
      const delta = Number(btn.dataset.delta);
      window.api.incrementScore(team, delta);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('button[data-card-team]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.api.cardAdd(btn.dataset.cardTeam as TeamId, btn.dataset.card as CardColor);
    });
  });

  wireInfoControls();

  wireClockSet();
  wireStoppage();

  document.getElementById('clock-start')!.addEventListener('click', () => window.api.clockStart());
  document.getElementById('clock-stop')!.addEventListener('click', () => window.api.clockStop());
  document.getElementById('clock-reset')!.addEventListener('click', () => {
    if (confirm('Uhr wirklich zurücksetzen?')) window.api.clockReset();
  });

  // Jeder Phasenwechsel wird bestätigt -- ein versehentlicher Abpfiff
  // mitten im Spiel ist am Spielfeldrand sonst schnell passiert.
  const confirmPhase = (question: string, action: () => void) => () => {
    if (confirm(question)) action();
  };

  document
    .getElementById('phase-kickoff')!
    .addEventListener('click', confirmPhase('Anpfiff? Die Uhr startet bei 00:00.', () => window.api.phaseKickoff()));
  document
    .getElementById('phase-halftime')!
    .addEventListener('click', confirmPhase('Halbzeitpfiff? Die Uhr wird angehalten.', () => window.api.phaseHalfTime()));
  document
    .getElementById('phase-second-half')!
    .addEventListener('click', confirmPhase('2. Halbzeit anpfeifen? Die Uhr läuft weiter.', () => window.api.phaseSecondHalf()));
  document
    .getElementById('phase-fulltime')!
    .addEventListener('click', confirmPhase('Abpfiff? Das Spiel wird beendet.', () => window.api.phaseFullTime()));

  document.getElementById('phase-revert')!.addEventListener('click', () => {
    const target = lastRenderedState
      ? revertTargetLabel(lastRenderedState.phase, lastRenderedState.half)
      : null;
    if (target && confirm(`Phasenwechsel zurücknehmen und zurück zu "${target}"?`)) {
      window.api.phaseRevert();
    }
  });
  document
    .getElementById('lineup-show-home')!
    .addEventListener('click', () => window.api.showLineup('home'));
  document
    .getElementById('lineup-show-away')!
    .addEventListener('click', () => window.api.showLineup('away'));
  document.getElementById('lineup-hide')!.addEventListener('click', () => window.api.hideLineup());

  document.getElementById('match-reset')!.addEventListener('click', () => {
    if (confirm('Neues Spiel starten? Spielstand und Uhr werden zurückgesetzt.')) {
      window.api.matchReset();
    }
  });

  document
    .getElementById('display-reopen')!
    .addEventListener('click', () => window.api.reopenDisplay());

  document.getElementById('display-select')!.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    window.api.selectDisplay(value === '' ? null : Number(value));
  });

  wireTeamSettings('home');
  wireTeamSettings('away');

  for (const team of ['home', 'away'] as TeamId[]) {
    document
      .getElementById(`${team}-squad-add`)!
      .addEventListener('click', () => window.api.squadAddPlayer(team));

    const coachInput = document.getElementById(`${team}-coach-input`) as HTMLInputElement;
    coachInput.addEventListener('change', () => window.api.teamSetCoach(team, coachInput.value));

    const squadSelect = document.getElementById(`${team}-squad-select`) as HTMLSelectElement;
    squadSelect.addEventListener('change', () => {
      const name = squadSelect.value;
      if (!name) return;
      squadSelect.value = '';
      // Rückfrage erst nach dem Auswahl-Ereignis stellen: Ein synchrones
      // confirm() mitten im change-Handler blockiert Chromiums
      // Auswahlmenü-Logik, danach reagieren für einige Sekunden ALLE
      // Auswahlfelder im Fenster nicht mehr.
      setTimeout(() => {
        if (confirm(`Kader "${name}" laden? Der aktuelle Kader wird ersetzt.`)) {
          window.api.squadLoadByName(team, name);
        }
      }, 0);
    });

    wireLineupPaste(team);
  }
}

/**
 * Ecken, Zuschauerzahl und deren Einblendungen. Alles ohne Rückfrage --
 * ein Fehlklick ist mit dem Gegenknopf sofort behoben, und am
 * Spielfeldrand muss es schnell gehen.
 */
function wireInfoControls(): void {
  document.querySelectorAll<HTMLButtonElement>('button[data-corner-team]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.api.adjustCorners(btn.dataset.cornerTeam as TeamId, Number(btn.dataset.cornerDelta));
    });
  });

  const input = document.getElementById('attendance-input') as HTMLInputElement;
  input.addEventListener('change', () => {
    // Leeres Feld bedeutet "keine Angabe" -- die Prüfschicht im
    // Hauptprozess macht daraus null, statt NaN durchzureichen.
    window.api.setAttendance(input.value === '' ? null : Number(input.value));
  });

  const message = document.getElementById('attendance-message-input') as HTMLInputElement;
  message.addEventListener('change', () => {
    window.api.setAttendanceMessage(message.value);
    // Fokus abgeben, damit der zurückgemeldete Wert (ggf. der
    // Standardtext nach leerer Eingabe) das Feld wieder pflegen darf.
    message.blur();
  });

  const announcements = document.getElementById('announcements-input') as HTMLTextAreaElement;
  announcements.addEventListener('change', () => {
    // Eine Zeile je Ankündigung. Leere Zeilen filtert die Prüfschicht im
    // Hauptprozess heraus, damit ein Absatz keine leere Folienzeile ergibt.
    window.api.setAnnouncements(announcements.value.split('\n'));
    announcements.blur();
  });

  wireSoundDiagnostics();

  const volume = document.getElementById('sound-volume') as HTMLInputElement;
  const muted = document.getElementById('sound-muted') as HTMLInputElement;
  const sendSound = (): void => window.api.setSound(Number(volume.value), muted.checked);

  // "input" statt "change": Der Regler soll beim Ziehen sofort wirken,
  // damit sich der Pegel am Platz einstellen lässt.
  volume.addEventListener('input', sendSound);
  muted.addEventListener('change', sendSound);
  document.getElementById('sound-play')!.addEventListener('click', playGoalSound);
  document.getElementById('sound-stop')!.addEventListener('click', stopGoalSound);

  document
    .getElementById('slideshow-start')!
    .addEventListener('click', () => window.api.slideshowStart());
  document
    .getElementById('slideshow-stop')!
    .addEventListener('click', () => window.api.slideshowStop());
  document
    .getElementById('media-reload')!
    .addEventListener('click', () => window.api.mediaReload());

  document
    .getElementById('info-show-corners')!
    .addEventListener('click', () => window.api.showInfo({ kind: 'corners' }));
  document
    .getElementById('info-show-attendance')!
    .addEventListener('click', () => window.api.showInfo({ kind: 'attendance' }));
}

/**
 * Nachspielzeit setzen. Bewusst ohne Rückfrage -- anders als beim Setzen
 * der Spielzeit ist hier nichts kaputtzumachen, und am Spielfeldrand muss
 * es schnell gehen.
 */
function wireStoppage(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#stoppage-buttons button')) {
    btn.addEventListener('click', () => {
      window.api.setStoppage(Number(btn.dataset.stoppage));
    });
  }

  const input = document.getElementById('stoppage-input') as HTMLInputElement;
  input.addEventListener('change', () => {
    const value = input.value === '' ? 0 : Number(input.value);
    if (!Number.isFinite(value)) return;
    window.api.setStoppage(value);
  });
}

/**
 * Notfall-Eingabe für die Spielzeit. Bewusst mit Rückfrage: Ein
 * versehentliches Verstellen mitten im Spiel wäre schlimmer als der
 * zusätzliche Klick.
 */
function wireClockSet(): void {
  const input = document.getElementById('clock-set-input') as HTMLInputElement;
  const hint = document.getElementById('clock-set-hint')!;
  const standardHinweis = hint.innerHTML;

  const apply = (): void => {
    const elapsedMs = parseClockInput(input.value);

    if (elapsedMs === null) {
      hint.textContent = 'Bitte als MM:SS oder in Minuten angeben, z. B. 67:30 oder 67.';
      hint.classList.add('is-error');
      input.focus();
      input.select();
      return;
    }

    hint.innerHTML = standardHinweis;
    hint.classList.remove('is-error');

    if (!confirm(`Spielzeit auf ${formatClock(elapsedMs)} setzen?`)) return;
    window.api.clockSet(elapsedMs);
    input.value = '';
    // Fokus abgeben, damit der nächste Zustand das Feld wieder pflegen darf.
    input.blur();
  };

  document.getElementById('clock-set-apply')!.addEventListener('click', apply);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') apply();
  });
}

/**
 * Einfügefeld für kopierte Aufstellungen. Die Vorschau zeigt sofort, was
 * erkannt wurde -- bei einem unerwarteten Format sieht man das, bevor der
 * Kader überschrieben wird.
 */
function wireLineupPaste(team: TeamId): void {
  const input = document.getElementById(`${team}-paste-input`) as HTMLTextAreaElement;
  const preview = document.getElementById(`${team}-paste-preview`)!;

  const updatePreview = (): void => {
    const { players, coach } = parseLineup(input.value);
    preview.innerHTML = '';

    if (input.value.trim() === '') return;

    const starters = players.filter((p) => p.role === 'start').length;
    const bench = players.length - starters;

    const summary = document.createElement('strong');
    summary.textContent =
      players.length === 0
        ? 'Nichts erkannt – bitte Format prüfen.'
        : `${starters} Startelf, ${bench} Bank${coach ? `, Trainer: ${coach}` : ''}`;
    preview.appendChild(summary);

    if (players.length === 0) return;

    const list = document.createElement('ul');
    for (const player of players) {
      const item = document.createElement('li');
      const number = player.number === null ? '–' : String(player.number);
      const name = [player.firstName, player.lastName].filter(Boolean).join(' ') || '(ohne Namen)';
      item.textContent = `${number} ${name}${player.role === 'bench' ? ' – Bank' : ''}`;
      list.appendChild(item);
    }
    preview.appendChild(list);
  };

  input.addEventListener('input', updatePreview);

  // Aus dem Hauptprozess geladene Datei landet im selben Feld -- so
  // durchläuft auch sie die Vorschau, bevor der Kader überschrieben wird.
  window.api.onSquadFileLoaded((loadedTeam, text) => {
    if (loadedTeam !== team) return;
    input.value = text;
    updatePreview();
  });

  document
    .getElementById(`${team}-paste-file`)!
    .addEventListener('click', () => window.api.squadPickFile(team));

  const apply = (replace: boolean): void => {
    const { players, coach } = parseLineup(input.value);
    if (players.length === 0) return;
    if (replace && !confirm(`Kader durch ${players.length} eingefügte Spieler ersetzen?`)) return;
    window.api.squadImport(team, players, replace, coach);
    input.value = '';
    updatePreview();
  };

  document.getElementById(`${team}-paste-replace`)!.addEventListener('click', () => apply(true));
  document.getElementById(`${team}-paste-append`)!.addEventListener('click', () => apply(false));
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    main();
  } catch (error) {
    showError(`main() abgebrochen: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
});
