import { audioMimeType, pickGoalSound, MatchState } from '../../shared/types';
import { isRemote, showError, updateInputIfNotFocused } from './common';

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

/**
 * Spielt die Tormusik von vorn -- auch wenn sie noch läuft.
 *
 * Auf dem iPad schickt der Knopf nur einen Befehl: Die Musik gehört aus
 * den Lautsprechern am Laptop, nicht aus dem Tablet in der Hand.
 */
export function playGoalSound(): void {
  if (isRemote()) {
    window.api.soundCommand('play');
    return;
  }
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
export function stopGoalSound(): void {
  if (isRemote()) {
    window.api.soundCommand('stop');
    return;
  }
  const audio = goalSoundElement();
  audio.pause();
  audio.currentTime = 0;
}

export function renderSoundControls(state: MatchState): void {
  const audio = goalSoundElement();

  const datei = pickGoalSound(state.media.sounds.files);
  // Nur bei echter Änderung neu laden -- sonst risse jedes
  // Zustands-Update die laufende Musik ab.
  // Auf dem iPad wird die Datei nicht geladen: Gespielt wird am Laptop.
  if (goalSoundFile !== (datei ?? '') && !isRemote()) {
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

  // Der Schnellknopf am Spielstand wird genauso geschaltet wie der große
  // unten -- sonst stünde am Tor ein Knopf bereit, der ins Leere liefe.
  for (const id of ['sound-play', 'sound-stop', 'sound-play-quick']) {
    (document.getElementById(id) as HTMLButtonElement).disabled = datei === null;
  }

  const hint = document.getElementById('sound-hint')!;
  const leer = datei === null;
  hint.textContent = leer
    ? `Keine Audiodatei gefunden in "${state.media.sounds.rootPath}".`
    : `${datei} – läuft nur auf Knopfdruck, nie von selbst.`;
  hint.classList.toggle('is-empty', leer);
}

/** Regler, Stummschalter und Abspielknöpfe der Tormusik. */
export function wireSound(): void {
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

  // Schnellzugriff direkt neben "Tor +1" (Nutzerwunsch 20.08.2026): Nach
  // einem Treffer sollen Eintragen und Musikstart eine Handbewegung sein,
  // statt an den Fuß des Fensters zu wechseln. Regler, Stummschalter und
  // "Stopp" bleiben unten -- die stellt man einmal ein, nicht im Jubel.
  document.getElementById('sound-play-quick')!.addEventListener('click', playGoalSound);
}
