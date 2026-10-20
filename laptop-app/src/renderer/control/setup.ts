import { deriveRetroName } from '../../shared/retroMatrix';
import {
  AppStatus,
  BoardLinkStatus,
  competitionLabel,
  FlutlichtEffects,
  MatchState,
  preferredSponsorFile,
  sponsorBaseName,
  sponsorLogoFiles,
  SPONSOR_FOLDER_IDS,
  SPONSOR_SLOT_IDS,
  SponsorFolderId,
  SponsorRef,
  SponsorSlotId,
  TeamId,
} from '../../shared/types';
import type { LibraryPayload } from '../window';
import { showError, updateInputIfNotFocused } from './common';

// Einrichtung: Zielbildschirm, Tafel, Design, Wettbewerb, Teams,
// Logo-Bibliothek, Fernsteuerung, Verbindung zur Tafel und die Leiste,
// die diese Flächen öffnet.

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
        // Liegen beide Fassungen vor, stehen beide zur Wahl (Nutzerwunsch
        // 20.10.2026). Die erste Zeile nimmt wie bisher die weiße.
        if (entry.variants?.includes('white') && entry.variants.includes('color')) {
          option.textContent = `${entry.name} – weißes Logo`;
          const color = document.createElement('option');
          color.value = entry.id;
          color.dataset.variant = 'color';
          color.textContent = `${entry.name} – farbiges Logo`;
          group.appendChild(color);
        }
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

/**
 * Auswahl der „präsentiert von"-Plätze. Wie beim Wettbewerb nur bei
 * geänderten Dateien oder Zuordnungen neu aufgebaut, und eine fehlende
 * Datei bleibt als „(Datei fehlt)" sichtbar gewählt.
 *
 * Der Wert einer Option ist `ordner/datei` -- ein Schrägstrich kommt in
 * einem Dateinamen nicht vor, die Trennung ist also eindeutig.
 */
const SPONSOR_GROUP_LABELS: Record<SponsorFolderId, string> = {
  hauptsponsor: 'Hauptsponsor',
  partner: 'Partner',
  werbung: 'Partner',
};

let sponsorSlotsSignature = '';

export function renderSponsorSlotSelects(state: MatchState): void {
  const lists = SPONSOR_FOLDER_IDS.map((folder) => state.media[folder].files);
  const signature = JSON.stringify([lists, state.sponsorSlots]);
  if (signature === sponsorSlotsSignature) return;
  sponsorSlotsSignature = signature;

  for (const slot of SPONSOR_SLOT_IDS) {
    const select = document.getElementById(`sponsor-slot-${slot}`) as HTMLSelectElement;
    const children: HTMLElement[] = [new Option('– keiner –', '')];
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const folder of SPONSOR_FOLDER_IDS) {
      const label = SPONSOR_GROUP_LABELS[folder];
      // Ein Eintrag je Sponsor -- `Ott.png` und `Ott_weiß.png` sind einer.
      for (const file of sponsorLogoFiles(state.media[folder].files)) {
        let group = groups.get(label);
        if (!group) {
          group = document.createElement('optgroup');
          group.label = label;
          groups.set(label, group);
          children.push(group);
        }
        group.appendChild(new Option(competitionLabel(sponsorBaseName(file)), `${folder}/${file}`));
      }
    }

    // Gewählt ist der Sponsor, nicht die Fassung: Steht `Ott.png` im
    // Zustand und liegt inzwischen `Ott_weiß.png` daneben, gilt dessen
    // Eintrag als gewählt.
    const ref = state.sponsorSlots[slot];
    const shown = ref ? preferredSponsorFile(state.media[ref.folder].files, ref.file) : null;
    if (ref && shown === null) {
      children.push(
        new Option(`${competitionLabel(sponsorBaseName(ref.file))} (Datei fehlt)`, `${ref.folder}/${ref.file}`)
      );
    }
    select.replaceChildren(...children);
    select.value = ref ? `${ref.folder}/${shown ?? ref.file}` : '';
  }

  const hint = document.getElementById('sponsor-slots-hint')!;
  const leer = lists.every((files) => files.length === 0);
  hint.textContent = leer
    ? `Keine Logos gefunden unter "${state.media.werbung.rootPath}".`
    : 'Logos aus Werbung/Hauptsponsor/, Werbung/Partner/ und direkt aus Werbung/.';
  hint.classList.toggle('is-empty', leer);
}

/** Wert einer Option zurück in einen Verweis, siehe oben. */
export function parseSponsorOption(value: string): SponsorRef | null {
  const slash = value.indexOf('/');
  if (slash < 0) return null;
  return { folder: value.slice(0, slash) as SponsorFolderId, file: value.slice(slash + 1) };
}

export function wireSponsorSlots(): void {
  document.querySelectorAll<HTMLSelectElement>('select[data-sponsor-slot]').forEach((select) => {
    select.addEventListener('change', () =>
      window.api.setSponsorSlot(select.dataset.sponsorSlot as SponsorSlotId, parseSponsorOption(select.value))
    );
  });
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
  // Fehlt bei einem Status aus einer älteren Fassung -- dann bleibt der
  // Abschnitt eben stehen, wie er ist.
  if (status.boardLink) renderBoardLink(status.boardLink);
}

/** Kurzform für die Kopfzeile; `warn` färbt sie als Hinweis. */
export function boardLinkSummary(link: BoardLinkStatus): { text: string; tone: 'ok' | 'idle' | 'warn' } {
  switch (link.state) {
    case 'off':
      return { text: '', tone: 'idle' };
    case 'searching':
      return { text: 'Tafel: suche …', tone: 'idle' };
    case 'not-found':
      return { text: 'Tafel: nicht gefunden', tone: 'idle' };
    case 'connecting':
      return { text: 'Tafel: verbinde …', tone: 'idle' };
    case 'login-failed':
      return { text: 'Tafel: Anmeldung abgelehnt', tone: 'warn' };
    case 'error':
      return { text: 'Tafel: Verbindung gestört', tone: 'warn' };
    case 'connected': {
      // Am Spieltag die wichtigste Frage: Zeigt die Tafel wirklich das
      // Bild des Laptops? Ein im ViPlex-Programm hängengebliebener Player
      // sieht am Steuerungsfenster sonst völlig normal aus.
      if (link.source === 'internal') return { text: 'Tafel zeigt eigenes Programm', tone: 'warn' };
      if (link.hdmiSignal === false) return { text: 'Tafel: kein HDMI-Signal', tone: 'warn' };
      const brightness = link.brightness === null ? '' : ` · ${link.brightness} %`;
      return { text: `Tafel verbunden${brightness}`, tone: 'ok' };
    }
  }
}

const SOURCE_LABELS: Record<'hdmi' | 'internal', string> = {
  hdmi: 'HDMI (Bild des Laptops)',
  internal: 'interner Player (ViPlex-Programm)',
};

/**
 * Abschnitt „Verbindung zur Tafel" und die Kurzanzeige in der Kopfzeile.
 * Felder, in denen gerade getippt oder gezogen wird, bleiben unangetastet
 * -- der Status kommt alle paar Sekunden neu und risse sonst den Regler
 * unter der Maus zurück.
 */
function renderBoardLink(link: BoardLinkStatus): void {
  const summary = boardLinkSummary(link);
  const pill = document.getElementById('board-link-pill')!;
  pill.hidden = link.state === 'off';
  pill.dataset.tone = summary.tone;
  document.getElementById('board-link-pill-text')!.textContent = summary.text;

  const toggle = document.getElementById('board-link-enabled') as HTMLInputElement;
  if (document.activeElement !== toggle) toggle.checked = link.enabled;
  document.getElementById('board-link-details')!.hidden = !link.enabled;

  const device = link.device;
  const where = device ? `${device.name || device.product || 'Tafel'} (${device.address})` : '';
  const stateText: Record<BoardLinkStatus['state'], string> = {
    off: '',
    searching: 'Suche die Tafel im Netz …',
    'not-found': 'Keine Tafel gefunden. Ist der Laptop im WLAN „Taurus-…“?',
    connecting: `Gefunden: ${where} – melde an …`,
    connected: `Verbunden mit ${where}`,
    'login-failed': `Gefunden: ${where} – Anmeldung abgelehnt.`,
    error: device ? `Gefunden: ${where} – Verbindung gestört.` : 'Verbindung gestört.',
  };
  // Ein Hinweis in der Kopfzeile braucht hier seinen Grund in Worten --
  // sonst stünde „Verbunden" in Warnfarbe da.
  const reason =
    link.state !== 'connected'
      ? ''
      : link.source === 'internal'
        ? ' – sie zeigt gerade ihr eigenes Programm statt des Laptop-Bilds.'
        : link.hdmiSignal === false
          ? ' – am HDMI-Eingang kommt kein Signal an.'
          : '';
  const message = reason || (link.message && link.state !== 'login-failed' ? ` ${link.message}` : '');
  const stateLine = document.getElementById('board-link-state')!;
  stateLine.textContent = `${stateText[link.state]}${link.state === 'login-failed' ? ' Benutzer und Passwort unter „Zugang zur Tafel“ prüfen.' : message}`;
  stateLine.dataset.tone = summary.tone;

  const connected = link.state === 'connected';
  document.getElementById('board-link-source')!.textContent =
    connected && link.source ? SOURCE_LABELS[link.source] : '–';
  document.getElementById('board-link-hdmi')!.textContent =
    connected && link.hdmiSignal !== null ? (link.hdmiSignal ? 'liegt an' : 'fehlt') : '–';
  document.getElementById('board-link-ambient')!.textContent =
    connected && link.ambientLight !== null ? String(link.ambientLight) : '–';
  document.getElementById('board-link-led')!.textContent = link.ledSize
    ? `${link.ledSize.width} × ${link.ledSize.height} px`
    : '–';

  const slider = document.getElementById('board-brightness') as HTMLInputElement;
  slider.disabled = !connected;
  if (document.activeElement !== slider && link.brightness !== null) slider.value = String(link.brightness);
  document.getElementById('board-brightness-value')!.textContent =
    link.brightness === null ? '–' : `${document.activeElement === slider ? slider.value : link.brightness} %`;

  const hdmiButton = document.getElementById('board-select-hdmi') as HTMLButtonElement;
  hdmiButton.disabled = !connected || link.source === 'hdmi';

  // Nur anbieten, wenn die Tafel etwas anderes meldet als eingestellt --
  // so beantwortet sich die offene Frage 384×192 gegen 384×224 von selbst.
  const sizeButton = document.getElementById('board-size-apply') as HTMLButtonElement;
  const board = boardSizeShown();
  sizeButton.hidden =
    !link.ledSize || (board !== null && board.width === link.ledSize.width && board.height === link.ledSize.height);
  sizeButton.dataset.width = link.ledSize ? String(link.ledSize.width) : '';
  sizeButton.dataset.height = link.ledSize ? String(link.ledSize.height) : '';

  const username = document.getElementById('board-username') as HTMLInputElement;
  const host = document.getElementById('board-host') as HTMLInputElement;
  if (document.activeElement !== username && !username.dataset.dirty) username.value = link.username;
  if (document.activeElement !== host && !host.dataset.dirty) host.value = link.host;
}

/** Eingestellte Tafelauflösung, wie sie in den Feldern steht. */
function boardSizeShown(): { width: number; height: number } | null {
  const width = Number((document.getElementById('board-width-input') as HTMLInputElement).value);
  const height = Number((document.getElementById('board-height-input') as HTMLInputElement).value);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function wireBoardLink(): void {
  const toggle = document.getElementById('board-link-enabled') as HTMLInputElement;
  toggle.addEventListener('change', () => window.api.boardLinkSetEnabled(toggle.checked));

  const slider = document.getElementById('board-brightness') as HTMLInputElement;
  const value = document.getElementById('board-brightness-value')!;
  // `input` statt `change`: Die Wirkung soll man an der Tafel beim Ziehen
  // sehen, wie beim Lautstärkeregler. Der Hauptprozess schickt davon nur
  // den jeweils jüngsten Wert los.
  slider.addEventListener('input', () => {
    value.textContent = `${slider.value} %`;
    window.api.boardSetBrightness(Number(slider.value));
  });

  document.getElementById('board-select-hdmi')!.addEventListener('click', () => window.api.boardSelectHdmi());

  const sizeButton = document.getElementById('board-size-apply') as HTMLButtonElement;
  sizeButton.addEventListener('click', () => {
    const width = Number(sizeButton.dataset.width);
    const height = Number(sizeButton.dataset.height);
    if (width > 0 && height > 0) window.api.setBoardSize({ width, height });
    sizeButton.hidden = true;
  });

  const username = document.getElementById('board-username') as HTMLInputElement;
  const password = document.getElementById('board-password') as HTMLInputElement;
  const host = document.getElementById('board-host') as HTMLInputElement;
  // Ein angefangener Eintrag soll den nächsten Status überstehen, auch
  // wenn das Feld den Fokus schon abgegeben hat.
  for (const field of [username, host]) {
    field.addEventListener('input', () => (field.dataset.dirty = '1'));
  }
  document.getElementById('board-link-save')!.addEventListener('click', () => {
    window.api.boardLinkSetConfig(username.value, password.value, host.value);
    delete username.dataset.dirty;
    delete host.dataset.dirty;
    password.value = '';
  });
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
    const chosen = librarySelect.selectedOptions[0];
    const variant = chosen?.dataset.variant === 'color' ? 'color' : undefined;
    window.api.libraryPick(team, librarySelect.value, variant);
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

  // Knöpfe außerhalb der Leiste, die eine Fläche nur öffnen (die
  // Tafel-Anzeige in der Kopfzeile). Ein zweiter Druck schließt hier
  // NICHT -- wer auf „Tafel: kein HDMI-Signal" drückt, will hinsehen.
  for (const opener of document.querySelectorAll<HTMLElement>('[data-setup-open]')) {
    opener.addEventListener('click', () => open(opener.dataset.setupOpen ?? null));
  }

  for (const close of document.querySelectorAll<HTMLButtonElement>('[data-setup-close]')) {
    close.addEventListener('click', () => open(null));
  }

  document.getElementById('setup-scrim')!.addEventListener('click', () => open(null));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.dataset.setup) open(null);
  });
}
