import { lineupNow } from '../../shared/substitutions';
import {
  CARD_LABEL,
  formatEventMinute,
  MatchState,
  otherTeam,
  Player,
  playerLabel,
  sortPlayersByNumber,
  SubstitutionEvent,
  TeamId,
} from '../../shared/types';
import { hasChanged } from './common';

// Chronik: Tore, Karten und Wechsel samt Spielerzuordnung.

function playerOption(player: Player): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = player.id;
  option.textContent = playerLabel(player);
  return option;
}

function optionGroup(label: string, players: Player[]): HTMLOptGroupElement | null {
  if (players.length === 0) return null;
  const group = document.createElement('optgroup');
  group.label = label;
  for (const player of players) group.appendChild(playerOption(player));
  return group;
}

/**
 * Spieler für Torschützen- und Kartenauswahl, gruppiert nach dem Stand
 * NACH allen Wechseln: wer spielt, zuerst. Ein Eingewechselter steht dort
 * also oben, wo man ihn nach einem Tor sucht. Die übrigen bleiben
 * wählbar -- ein Tor kann vor der Auswechslung gefallen sein und wird
 * erst später nachgetragen.
 */
function appendPlayersByStatus(select: HTMLSelectElement, state: MatchState, team: TeamId): void {
  const squad = state.squads[team];
  const now = lineupNow(team, squad, state.events);
  const placed = new Set([...now.onPitch, ...now.bench, ...now.substitutedOut].map((p) => p.id));
  const others = sortPlayersByNumber(squad.filter((p) => !placed.has(p.id)));

  // Ohne Aufstellung (alle Spieler ohne Rolle "Start"/"Bank") gibt es
  // nichts zu gruppieren -- dann wie bisher eine flache Liste.
  if (now.onPitch.length === 0 && now.bench.length === 0 && now.substitutedOut.length === 0) {
    for (const player of sortPlayersByNumber(squad)) select.appendChild(playerOption(player));
    return;
  }

  for (const group of [
    optionGroup('Auf dem Platz', now.onPitch),
    optionGroup('Ausgewechselt', now.substitutedOut),
    optionGroup('Bank', now.bench),
    optionGroup('Übrige', others),
  ]) {
    if (group) select.appendChild(group);
  }
}

/**
 * Zeile eines Wechsels: wer raus, wer rein. Zur Wahl stehen die Spieler,
 * die VOR diesem Wechsel spielten bzw. auf der Bank saßen -- der Wechsel
 * selbst bleibt dabei außen vor, sonst fiele der gewählte Spieler aus
 * seiner eigenen Liste. Ein bereits gewählter Spieler bleibt sichtbar,
 * auch wenn ein späterer Wechsel ihn verschoben hat.
 */
function renderSubstitutionRow(event: SubstitutionEvent, state: MatchState): HTMLLIElement {
  const item = document.createElement('li');
  item.classList.add('is-sub');

  const minute = document.createElement('span');
  minute.className = 'goal-minute';
  minute.textContent = formatEventMinute(event);

  const kind = document.createElement('span');
  kind.className = 'goal-standing';
  kind.textContent = 'Wechsel';

  const squad = state.squads[event.team];
  const before = lineupNow(event.team, squad, state.events, event.id);

  const makeSelect = (placeholder: string, candidates: Player[], currentId?: string) => {
    const select = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = placeholder;
    select.appendChild(none);
    const ids = new Set(candidates.map((p) => p.id));
    const current = currentId ? squad.find((p) => p.id === currentId) : undefined;
    for (const player of sortPlayersByNumber(current && !ids.has(current.id) ? [...candidates, current] : candidates)) {
      select.appendChild(playerOption(player));
    }
    select.value = currentId ?? '';
    return select;
  };

  // Ohne Aufstellung bietet jede Liste den ganzen Kader an -- sonst
  // ließe sich ein Wechsel gar nicht zuordnen.
  const hasLineup = before.onPitch.length + before.bench.length > 0;
  const outSelect = makeSelect('– raus –', hasLineup ? before.onPitch : squad, event.outId);
  const inSelect = makeSelect('– rein –', hasLineup ? before.bench : squad, event.inId);
  outSelect.classList.add('sub-out');
  inSelect.classList.add('sub-in');

  const eventId = event.id;
  const send = () =>
    window.api.subSetPlayers(eventId, outSelect.value || undefined, inSelect.value || undefined);
  outSelect.addEventListener('change', send);
  inSelect.addEventListener('change', send);

  const show = document.createElement('button');
  show.className = 'btn btn-small';
  show.textContent = 'Einblenden';
  show.title = 'Wechsel auf der Tafel zeigen -- auch ohne Namen, dann mit der Mannschaft';
  show.addEventListener('click', () => window.api.showInfo({ kind: 'sub', eventId }));

  const remove = document.createElement('button');
  remove.className = 'goal-remove';
  remove.textContent = '×';
  remove.title = 'Eintrag löschen';
  remove.addEventListener('click', () => {
    if (confirm('Diesen Eintrag löschen?')) window.api.eventRemove(eventId);
  });

  item.append(minute, kind, outSelect, inSelect, show, remove);
  return item;
}

/** Chronik der Tore: Minute, Mannschaft, Zwischenstand und Torschütze. */
/**
 * Setzt eine Zeile auf die Seite ihrer Mannschaft und in eine eigene Zeile
 * des Rasters. Die Zeile muss ausdrücklich gesetzt werden: Ohne sie legte
 * das Raster ein Gasttor neben das vorangehende Heimtor, und die Zeit
 * liefe wieder im Zickzack. `element.style` statt eines style-Attributs --
 * die CSP setzt `style-src 'self'`, CSSOM-Zugriffe fallen nicht darunter.
 */
function placeRow(item: HTMLLIElement, team: TeamId, row: number): HTMLLIElement {
  item.classList.add(team === 'home' ? 'side-home' : 'side-away');
  item.style.gridRow = String(row);
  return item;
}

export function renderGoalLog(state: MatchState): void {
  const empty = document.getElementById('goal-log-empty')!;
  empty.hidden = state.events.length > 0;
  // Ohne Ereignisse gibt es keine Spalten zu beschriften.
  const leer = state.events.length === 0;
  document.getElementById('goal-log-home')!.textContent = leer
    ? 'Spielverlauf'
    : `Spielverlauf · ${state.home.name}`;
  document.getElementById('goal-log-away')!.textContent = leer ? '' : state.away.name;

  // Kader und Vereinsnamen gehören mit in die Signatur -- sonst tauchten
  // neu angelegte Spieler nicht in den Torschützen-Auswahlfeldern auf und
  // eine Umbenennung bliebe in der Chronik stehen.
  const { events, squads, teams } = state.revisions;
  if (!hasChanged('goal-log', `${events}-${squads}-${teams}`)) return;

  const list = document.getElementById('goal-log')!;
  list.innerHTML = '';

  state.events.forEach((event, index) => {
    const row = index + 1;
    if (event.type === 'sub') {
      list.appendChild(placeRow(renderSubstitutionRow(event, state), event.team, row));
      return;
    }

    const item = document.createElement('li');
    item.classList.add(event.type === 'goal' ? 'is-goal' : `is-card-${event.card}`);

    const minute = document.createElement('span');
    minute.className = 'goal-minute';
    minute.textContent = formatEventMinute(event);

    // Kein Vereinsname mehr: Die Spalte sagt, welche Mannschaft es ist.
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
    // Bei einem Eigentor steht ein Gegenspieler zur Wahl (Review W10).
    const ownGoal = event.type === 'goal' && event.ownGoal === true;
    appendPlayersByStatus(playerSelect, state, ownGoal ? otherTeam(event.team) : event.team);
    playerSelect.value = currentPlayerId ?? '';

    const eventId = event.id;
    const eventType = event.type;
    playerSelect.addEventListener('change', () => {
      const value = playerSelect.value === '' ? undefined : playerSelect.value;
      if (eventType === 'goal') window.api.goalSetScorer(eventId, value);
      else window.api.cardSetPlayer(eventId, value);
    });

    item.append(minute, kind);

    // Eigentor-Schalter. Er sitzt vor der Auswahl, weil er bestimmt, aus
    // welchem Kader sie kommt; ein Umschalten leert den gewählten Schützen.
    if (event.type === 'goal') {
      const og = document.createElement('button');
      og.className = 'btn btn-small own-goal-toggle';
      og.textContent = 'ET';
      og.title = ownGoal ? 'Eigentor -- zurück zum normalen Tor' : 'Als Eigentor markieren (Schütze aus dem Gegnerkader)';
      og.setAttribute('aria-pressed', String(ownGoal));
      og.classList.toggle('is-active', ownGoal);
      og.addEventListener('click', () => window.api.goalSetOwnGoal(eventId, !ownGoal));
      item.appendChild(og);

      // Strafstoß -- erscheint als "(FE)" hinter dem Schützen (Review N13).
      const penalty = event.penalty === true;
      const fe = document.createElement('button');
      fe.className = 'btn btn-small penalty-toggle';
      fe.textContent = 'FE';
      fe.title = penalty ? 'Strafstoß -- zurück zum normalen Tor' : 'Als Strafstoß markieren';
      fe.setAttribute('aria-pressed', String(penalty));
      fe.classList.toggle('is-active', penalty);
      fe.addEventListener('click', () => window.api.goalSetPenalty(eventId, !penalty));
      item.appendChild(fe);
    }

    item.appendChild(playerSelect);

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

    list.appendChild(placeRow(item, event.team, row));
  });

  // Ans Ende springen. Die Chronik sortiert chronologisch, das JÜNGSTE
  // Ereignis steht also unten -- und genau das ist das, dem gleich ein
  // Torschütze zugeordnet wird. Ohne diesen Sprung wäre es nach dem
  // zwanzigsten Ereignis wieder außer Sicht, diesmal im Scrollbalken der
  // Liste statt in dem der Seite.
  list.scrollTop = list.scrollHeight;
}
