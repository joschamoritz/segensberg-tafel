import {
  ANNOUNCEMENTS_TITLE,
  buildSlidePlan,
  HISTORY_FALLBACK_TITLE,
  HistoryCaption,
  MatchState,
  SLIDE_DURATION_MS,
  SPONSORS_PER_PAGE,
} from '../../shared/types';
import { Slide, ui } from './common';

// Diashow: Sponsoren, Vereinsbeiträge und Ankündigungen, nur auf Knopfdruck.

let lastSlideshowId = 0;
let slideDeck: Slide[] = [];
let slideIndex = 0;
let slideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Die Folienfolge: erst die normale Ansicht, dann die Blöcke aus
 * `buildSlidePlan()` -- dieselbe Folge, deren Länge das Steuerungsfenster
 * im Hinweis nennt.
 */
function buildSlideDeck(state: MatchState): Slide[] {
  return [
    { kind: 'base' },
    ...buildSlidePlan(state.phase, state.media, state.announcements, state.sponsorSlots, state.slideBlocks),
  ];
}

/**
 * Füllt das Sponsoren-Fenster. Nicht belegte Kacheln bleiben leer statt zu
 * verschwinden: Sonst würden die übrigen größer, und gerade das soll das
 * Fenster verhindern -- alle Partner gleich groß.
 *
 * Der Hauptsponsor nutzt dasselbe Fenster mit nur der ersten Kachel
 * (`is-main`, das Stylesheet blendet die übrigen aus und gibt ihr die
 * ganze Fläche).
 *
 * Die Seitenanzeige (kleine Quadrate) erscheint erst ab zwei Seiten; bei
 * einer einzigen wäre sie ein Zeichen ohne Aussage.
 */
function renderSponsorWindow(slide: Extract<Slide, { kind: 'sponsors' }>): void {
  document.getElementById('sponsor-window')!.classList.toggle('is-main', slide.main);
  document.getElementById('sponsor-title')!.textContent = slide.title;

  for (let i = 0; i < SPONSORS_PER_PAGE; i++) {
    const logo = document.getElementById(`sponsor-logo-${i}`) as HTMLImageElement;
    const entry = slide.logos[i];
    // Weiße Fassung ohne Kachel auf dem Grund. Leere Kacheln bleiben
    // weiß, damit das Raster aus vier gleichen Flächen erhalten bleibt.
    logo.parentElement!.classList.toggle('is-white', entry?.white === true);
    logo.hidden = entry === undefined;
    if (entry === undefined) {
      logo.removeAttribute('src');
    } else if (logo.getAttribute('src') !== entry.url) {
      logo.src = entry.url;
    }
  }

  const marks = document.getElementById('sponsor-pages')!;
  marks.textContent = '';
  if (slide.pages < 2) return;
  for (let i = 0; i < slide.pages; i++) {
    const mark = document.createElement('i');
    if (i === slide.page) mark.className = 'is-current';
    marks.appendChild(mark);
  }
}

/**
 * Historisches Foto. Ohne Datum steht dessen Platz nicht leer, sondern
 * nennt den Block -- so bleibt erkennbar, dass hier kein Sponsor läuft.
 */
function renderHistory(url: string, caption: HistoryCaption): void {
  const image = document.getElementById('history-image') as HTMLImageElement;
  if (image.getAttribute('src') !== url) image.src = url;
  document.getElementById('history-date')!.textContent = caption.date ?? HISTORY_FALLBACK_TITLE;
  const title = document.getElementById('history-title')!;
  title.textContent = caption.title;
  title.hidden = caption.title === '';
}

/** Zeigt eine Station. `base` blendet die Folienfläche einfach aus. */
function showSlide(slide: Slide): void {
  ui.activeSlide = slide;
  if (slide.kind === 'base') {
    document.body.classList.remove('showing-slide');
    return;
  }

  const image = document.getElementById('slide-image') as HTMLImageElement;
  const text = document.getElementById('slide-text')!;
  const sponsors = document.getElementById('sponsor-window')!;
  const history = document.getElementById('history-slide')!;

  image.hidden = slide.kind !== 'image';
  text.hidden = slide.kind !== 'text';
  sponsors.hidden = slide.kind !== 'sponsors';
  history.hidden = slide.kind !== 'history';

  if (slide.kind === 'image') {
    image.src = slide.url;
  } else if (slide.kind === 'sponsors') {
    renderSponsorWindow(slide);
  } else if (slide.kind === 'history') {
    renderHistory(slide.url, slide.caption);
  } else {
    document.getElementById('slide-title')!.textContent = ANNOUNCEMENTS_TITLE;

    const list = document.getElementById('slide-lines')!;
    list.innerHTML = '';
    for (const line of slide.lines) {
      const item = document.createElement('li');
      item.textContent = line;
      list.appendChild(item);
    }
  }

  document.body.classList.add('showing-slide');
}

function stopSlideshow(): void {
  if (slideTimer) clearTimeout(slideTimer);
  slideTimer = null;
  slideDeck = [];
  slideIndex = 0;
  ui.activeSlide = null;
  document.body.classList.remove('showing-slide');
}

function advanceSlide(): void {
  slideIndex = (slideIndex + 1) % slideDeck.length;
  showSlide(slideDeck[slideIndex]);
  slideTimer = setTimeout(advanceSlide, SLIDE_DURATION_MS);
}

/**
 * Startet oder beendet die Diashow. Sie läuft ausschließlich auf
 * Knopfdruck (Nutzerwunsch) -- die Anzeige rotiert nie von selbst los.
 *
 * Die Folge wird nur beim Start zusammengestellt, nicht bei jedem
 * Zustands-Update: Sonst spränge die Rotation bei jedem Tastendruck im
 * Steuerungsfenster zurück auf die erste Folie.
 */
export function handleSlideshowRequest(state: MatchState): void {
  const request = state.slideshowRequest;

  if (request === null) {
    if (lastSlideshowId !== 0) {
      lastSlideshowId = 0;
      stopSlideshow();
    }
    return;
  }

  if (request.id === lastSlideshowId) return;
  lastSlideshowId = request.id;

  stopSlideshow();
  slideDeck = buildSlideDeck(state);

  // Nur die normale Ansicht ist keine Diashow -- dann bleibt die Anzeige
  // wie sie ist, statt still auf einer leeren Fläche zu stehen. Das
  // Steuerungsfenster weist auf den leeren Medienordner hin.
  if (slideDeck.length < 2) {
    slideDeck = [];
    return;
  }

  // Mit der ersten echten Folie beginnen: Die normale Ansicht steht
  // ohnehin schon auf der Tafel, sie gleich wieder zu "zeigen" sähe aus,
  // als hätte der Knopf nichts bewirkt.
  slideIndex = 1;
  showSlide(slideDeck[slideIndex]);
  slideTimer = setTimeout(advanceSlide, SLIDE_DURATION_MS);
}
