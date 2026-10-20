import { parseLineup } from '../../shared/lineupParser';
import { MatchState, Player, playerLabel, sortPlayersByNumber, TeamId } from '../../shared/types';
import { hasChanged, updateInputIfNotFocused } from './common';

// Kader-Editor und Einfügefeld für Aufstellungen.

/** Kader-Editor einer Mannschaft. */
export function renderSquad(team: TeamId, state: MatchState): void {
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

  applySquadOrder(list, state, sorted.map((p) => p.id));
}

/**
 * Bringt die Zeilen in die Reihenfolge der Trikotnummern.
 *
 * Ein im DOM verschobener Knoten verliert den Fokus. Wird gerade in dieser
 * Liste getippt, wartet die Sortierung deshalb, bis das Feld verlassen
 * wird -- sonst spränge der Cursor beim Eintragen einer Nummer weg.
 */
function applySquadOrder(
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
    applySquadOrder(list, state, state.pendingOrder);
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
  // Mit Rückfrage: Das ist endgültig -- squads.json wird sofort
  // geschrieben, und Tore oder Karten in der Chronik verlören den Namen
  // (Review 2026-10, N11).
  remove.addEventListener('click', () => {
    const name = playerLabel(current) || 'diesen Spieler';
    if (confirm(`${name} aus dem Kader entfernen?`)) window.api.squadRemovePlayer(team, current.id);
  });

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

/**
 * Einfügefeld für kopierte Aufstellungen. Die Vorschau zeigt sofort, was
 * erkannt wurde -- bei einem unerwarteten Format sieht man das, bevor der
 * Kader überschrieben wird.
 */
export function wireLineupPaste(team: TeamId): void {
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
