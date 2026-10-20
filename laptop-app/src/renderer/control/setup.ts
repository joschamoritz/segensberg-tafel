import { deriveRetroName } from '../../shared/retroMatrix';
import {
  AppStatus,
  competitionLabel,
  FlutlichtEffects,
  MatchState,
  TeamId,
} from '../../shared/types';
import type { LibraryPayload } from '../window';
import { showError, updateInputIfNotFocused } from './common';

// Einrichtung: Zielbildschirm, Tafel, Design, Wettbewerb, Teams,
// Logo-Bibliothek, Fernsteuerung und die Leiste, die diese Flächen öffnet.

export function renderTeamSettings(team: TeamId, state: MatchState): void {
  const teamState = state[team];

  const nameInput = document.getElementById(`${team}-name-input`) as HTMLInputElement;
  updateInputIfNotFocused(nameInput, teamState.name);

  const shortNameInput = document.getElementById(`${team}-shortname-input`) as HTMLInputElement;
  updateInputIfNotFocused(shortNameInput, teamState.shortName);

  // Leeres Feld heißt "automatisch" -- der Vorschlag steht deshalb als
  // Platzhalter darin, damit man sieht, was ohne Eingabe auf der Tafel
  // steht.
  const retroNameInput = document.getElementById(`${team}-retroname-input`) as HTMLInputElement;
  updateInputIfNotFocused(retroNameInput, teamState.retroName ?? '');
  retroNameInput.placeholder = deriveRetroName(teamState.name);

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
export function renderLibrary(payload: LibraryPayload): void {
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

/**
 * Design-Auswahl und Effektschalter. Die Schalter wirken nur im
 * Flutlicht-Design und sind im klassischen deshalb gesperrt.
 */
export function renderAppearanceControls(state: MatchState): void {
  const select = document.getElementById('theme-select') as HTMLSelectElement;
  if (document.activeElement !== select && select.value !== state.appearance.theme) {
    select.value = state.appearance.theme;
  }

  const retroColor = document.getElementById('retro-color-select') as HTMLSelectElement;
  if (document.activeElement !== retroColor && retroColor.value !== state.appearance.retroColor) {
    retroColor.value = state.appearance.retroColor;
  }
  retroColor.disabled = state.appearance.theme !== 'retro';

  const switches = document.getElementById('fx-switches') as HTMLFieldSetElement;
  switches.disabled = state.appearance.theme !== 'flutlicht';
  for (const box of switches.querySelectorAll<HTMLInputElement>('input[data-fx]')) {
    box.checked = state.appearance.effects[box.dataset.fx as keyof FlutlichtEffects];
  }
}

/**
 * Auswahl des Wettbewerbs aus dem Ordner `Wettbewerbe/`. Neu aufgebaut
 * wird nur, wenn sich Dateien oder Wahl geändert haben -- sonst klappte
 * eine offene Liste bei jedem Zustands-Update zu.
 *
 * Liegt die gewählte Datei nicht (mehr) im Ordner, bleibt sie als
 * markierter Eintrag stehen: Die Tafel zeigt dann kein Logo, und das soll
 * hier sichtbar sein, statt dass die Auswahl still auf "keiner" springt.
 */
let competitionSignature = '';

export function renderCompetitionSelect(state: MatchState): void {
  const select = document.getElementById('competition-select') as HTMLSelectElement;
  const files = state.media.wettbewerbe.files;
  const signature = JSON.stringify([files, state.competition]);
  if (signature === competitionSignature) return;
  competitionSignature = signature;

  const options: HTMLOptionElement[] = [new Option('– keiner –', '')];
  for (const file of files) options.push(new Option(competitionLabel(file), file));
  if (state.competition !== null && !files.includes(state.competition)) {
    options.push(new Option(`${competitionLabel(state.competition)} (Datei fehlt)`, state.competition));
  }
  select.replaceChildren(...options);
  select.value = state.competition ?? '';
  select.title =
    files.length === 0 ? `Keine Logos gefunden in "${state.media.wettbewerbe.rootPath}".` : '';
}

/** Schon im Banner gezeigte Hinweise -- der Status kommt bei jedem
    Bildschirmereignis erneut. */
const shownWarnings = new Set<string>();

export function renderStatus(status: AppStatus): void {
  // Beschädigte Konfigurationsdatei: gehört gut sichtbar ins rote Banner,
  // sonst fiele es erst beim nächsten Spiel an den fehlenden Kadern auf.
  for (const warning of status.warnings ?? []) {
    if (shownWarnings.has(warning)) continue;
    shownWarnings.add(warning);
    showError(`Hinweis: ${warning}`);
  }

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

  renderRemoteStatus(status.remote);
}

/**
 * Fernsteuerung im WLAN: Schalter, Adresse und PIN. Am iPad selbst ist
 * der Abschnitt ausgeblendet -- dort hat er nichts zu suchen, und
 * abschalten ließe sich die Fernsteuerung von dort ohnehin nicht.
 */
function renderRemoteStatus(remote: AppStatus['remote']): void {
  const toggle = document.getElementById('remote-enabled') as HTMLInputElement;
  if (document.activeElement !== toggle) toggle.checked = remote.enabled;

  const details = document.getElementById('remote-details')!;
  details.hidden = !remote.enabled;
  document.getElementById('remote-urls')!.textContent =
    remote.urls.length > 0 ? remote.urls.join('  ·  ') : 'kein WLAN gefunden';
  document.getElementById('remote-pin')!.textContent = remote.pin;
  document.getElementById('remote-clients')!.textContent =
    remote.clients === 1 ? '1 Gerät verbunden' : `${remote.clients} Geräte verbunden`;

  const error = document.getElementById('remote-error')!;
  error.textContent = remote.error;
  error.hidden = remote.error === '';
}

export function wireTeamSettings(team: TeamId): void {
  const nameInput = document.getElementById(`${team}-name-input`) as HTMLInputElement;
  nameInput.addEventListener('change', () => window.api.teamSetName(team, nameInput.value));

  const shortNameInput = document.getElementById(`${team}-shortname-input`) as HTMLInputElement;
  shortNameInput.addEventListener('change', () =>
    window.api.teamSetShortName(team, shortNameInput.value)
  );

  const retroNameInput = document.getElementById(`${team}-retroname-input`) as HTMLInputElement;
  retroNameInput.addEventListener('change', () =>
    window.api.teamSetRetroName(team, retroNameInput.value)
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

/**
 * Fassung und Baudatum in die Kopfzeile.
 *
 * Zweck ist nicht Zierde: Auf dem Vereinsrechner war bisher nicht
 * ablesbar, welcher Stand dort läuft -- und ohne das ist eine
 * Rückmeldung vom Spieltag ("das ging nicht") keiner Fassung zuzuordnen.
 *
 * Verträgt ein fehlendes Ergebnis, statt sich darauf zu verlassen: Der
 * Preload-Stub der Tests liefert für jede Funktion `null`, und im
 * gepackten Stand könnte `build-info.json` fehlen. Dann bleibt die Zeile
 * eben leer -- ein abgestürztes Steuerungsfenster wäre der weit
 * schlechtere Tausch.
 */
export function renderAppVersion(): void {
  const element = document.getElementById('app-version')!;
  window.api
    .appInfo()
    .then((info) => {
      if (!info || !info.version) return;
      const date = new Date(info.builtAt);
      const built = info.builtAt && !Number.isNaN(date.getTime())
        ? ` · ${date.toLocaleDateString('de-DE')}`
        : '';
      element.textContent = `Fassung ${info.version}${built}`;
    })
    .catch(() => {
      // Ohne Angabe bleibt die Zeile leer.
    });
}

/**
 * Leiste und Flächen für das Einmalige (Anzeige, Teams, Kader).
 *
 * Geschaltet wird ausschließlich `document.body.dataset.setup` -- welche
 * Fläche dann sichtbar ist, entscheidet `control.css`. Zwei Dinge hängen
 * daran, die man leicht anders bauen würde und die dann kaputtgingen:
 *
 * - **Kein Ein-/Ausbau von DOM-Knoten.** Die gesamte Verdrahtung läuft
 *   genau einmal in `main()`; ein ausgetauschter Knoten hätte danach
 *   keinen Handler mehr, während die Anzeige weiter korrekt aussieht.
 * - **Kein `hidden`.** Die Flächen brauchen eine `display`-Angabe, und
 *   eine Autoren-Regel mit `display` schlägt `[hidden] { display: none }`
 *   (Guardrail in DESIGN.md).
 *
 * Gezeichnet wird auch in eine geschlossene Fläche weiter -- `renderSquad`
 * und `renderGoalLog` dürfen NICHT an die Sichtbarkeit gekoppelt werden.
 * Sie verbrennen sonst ihre Revisionssignatur, ohne das DOM zu schreiben,
 * und blieben danach dauerhaft auf altem Stand. Der zugeklappte
 * Kader-Editor macht das seit 1.0.0 genauso.
 */
export function wireSetupPanels(): void {
  const open = (name: string | null): void => {
    // Vor dem Umschalten den Fokus abgeben. Ein Feld, das mit Fokus
    // verschwindet, bekommt sein `focusout` nicht zugesichert -- es bliebe
    // dann in `editingInputs` hängen und würde nie wieder aus dem Zustand
    // gepflegt. Betroffen wären Anstoßzeit, Tafelauflösung und die
    // Zahlenfelder, bei denen Chromium eigene Auswahl-Elemente öffnet.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    if (name === null) delete document.body.dataset.setup;
    else document.body.dataset.setup = name;
  };

  for (const entry of document.querySelectorAll<HTMLButtonElement>('.setup-entry')) {
    entry.addEventListener('click', () => {
      const name = entry.dataset.setup ?? null;
      // Ein zweiter Druck auf denselben Eintrag schließt wieder -- sonst
      // wäre der Eintrag der einzige Knopf der Oberfläche, der nichts tut.
      open(document.body.dataset.setup === name ? null : name);
    });
  }

  for (const close of document.querySelectorAll<HTMLButtonElement>('[data-setup-close]')) {
    close.addEventListener('click', () => open(null));
  }

  document.getElementById('setup-scrim')!.addEventListener('click', () => open(null));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.dataset.setup) open(null);
  });
}
