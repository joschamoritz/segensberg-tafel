import {
  ANNOUNCEMENTS_PER_SLIDE,
  announcementsVisible,
  ANNOUNCEMENTS_TITLE,
  MatchState,
  mediaUrl,
  SLIDE_DURATION_MS,
  slideFoldersForPhase,
  SPONSORS_PER_PAGE,
  SPONSORS_TITLE,
} from '../../shared/types';
import { Slide, ui } from './common';

// Diashow: Sponsoren, Highlights und Ankündigungen, nur auf Knopfdruck.

let lastSlideshowId = 0;
let slideDeck: Slide[] = [];
let slideIndex = 0;
let slideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Stellt die Folienfolge für die aktuelle Phase zusammen: erst die
 * normale Ansicht, dann die Bilder der zuständigen Ordner, in der
 * Halbzeitpause zuletzt die Ankündigungen.
 */
function buildSlideDeck(state: MatchState): Slide[] {
  const slides: Slide[] = [{ kind: 'base' }];

  for (const folder of slideFoldersForPhase(state.phase)) {
    const urls = state.media[folder].files.map((fileName) => mediaUrl(folder, fileName));

    // Sponsoren zu viert im Fenster, alles andere einzeln im Vollbild.
    // Die Zählung muss zu slideCount() passen -- danach richtet sich der
    // Hinweis im Steuerungsfenster.
    if (folder === 'werbung') {
      const pages = Math.ceil(urls.length / SPONSORS_PER_PAGE);
      for (let page = 0; page < pages; page++) {
        slides.push({
          kind: 'sponsors',
          urls: urls.slice(page * SPONSORS_PER_PAGE, (page + 1) * SPONSORS_PER_PAGE),
          page,
          pages,
        });
      }
      continue;
    }

    for (const url of urls) slides.push({ kind: 'image', url });
  }

  // Welche Phasen Ankündigungen zeigen, entscheidet announcementsVisible()
  // -- dieselbe Regel nutzt die Folienzählung im Steuerungsfenster.
  if (announcementsVisible(state.phase)) {
    for (let i = 0; i < state.announcements.length; i += ANNOUNCEMENTS_PER_SLIDE) {
      slides.push({
        kind: 'text',
        lines: state.announcements.slice(i, i + ANNOUNCEMENTS_PER_SLIDE),
      });
    }
  }

  return slides;
}

/**
 * Füllt das Sponsoren-Fenster. Nicht belegte Kacheln bleiben leer statt zu
 * verschwinden: Sonst würden die übrigen größer, und gerade das soll das
 * Fenster verhindern -- alle Partner gleich groß.
 *
 * Die Seitenanzeige (kleine Quadrate) erscheint erst ab zwei Seiten; bei
 * einer einzigen wäre sie ein Zeichen ohne Aussage.
 */
function renderSponsorWindow(urls: string[], page: number, pages: number): void {
  document.getElementById('sponsor-title')!.textContent = SPONSORS_TITLE;

  for (let i = 0; i < SPONSORS_PER_PAGE; i++) {
    const logo = document.getElementById(`sponsor-logo-${i}`) as HTMLImageElement;
    const url = urls[i];
    logo.hidden = url === undefined;
    if (url === undefined) {
      logo.removeAttribute('src');
    } else if (logo.getAttribute('src') !== url) {
      logo.src = url;
    }
  }

  const marks = document.getElementById('sponsor-pages')!;
  marks.textContent = '';
  if (pages < 2) return;
  for (let i = 0; i < pages; i++) {
    const mark = document.createElement('i');
    if (i === page) mark.className = 'is-current';
    marks.appendChild(mark);
  }
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

  image.hidden = slide.kind !== 'image';
  text.hidden = slide.kind !== 'text';
  sponsors.hidden = slide.kind !== 'sponsors';

  if (slide.kind === 'image') {
    image.src = slide.url;
  } else if (slide.kind === 'sponsors') {
    renderSponsorWindow(slide.urls, slide.page, slide.pages);
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
