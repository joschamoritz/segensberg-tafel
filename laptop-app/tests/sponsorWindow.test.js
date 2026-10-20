/**
 * Sponsoren-Fenster der Diashow.
 *
 * Werbemotive laufen nicht mehr einzeln im Vollbild, sondern zu viert in
 * gleich großen Kacheln (Nutzerwunsch 16.10.2026). Daran hängen drei
 * Zusagen, die ohne Test beim nächsten Umbau still brechen könnten:
 *
 * - Fehlende Logos lassen Kacheln LEER, statt sie verschwinden zu lassen
 *   -- sonst würden die übrigen größer, und gleich große Partner sind
 *   der Zweck des Fensters.
 * - Die Folienzahl im Steuerungsfenster stimmt mit der Schau überein,
 *   die tatsächlich läuft.
 * - Die übrigen Folien (Highlights, Termine) laufen weiter im Vollbild.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const { slideCount, SPONSORS_PER_PAGE, SLIDE_DURATION_MS } = load('shared/types');

function medien(werbung, highlights = [], weitere = {}) {
  const extra = Object.fromEntries(
    Object.entries(weitere).map(([id, files]) => [id, { rootPath: id, files }])
  );
  return {
    werbung: { rootPath: 'W', files: werbung },
    highlights: { rootPath: 'H', files: highlights },
    wettbewerbe: { rootPath: 'W', files: [] },
    hauptsponsor: { rootPath: 'HS', files: [] },
    partner: { rootPath: 'P', files: [] },
    historie: { rootPath: 'HI', files: [] },
    sounds: { rootPath: 'S', files: [] },
    ...extra,
  };
}

const termine = (n) => Array.from({ length: n }, (_, i) => `Termin ${i + 1}`);
const logos = (n) => Array.from({ length: n }, (_, i) => `0${i + 1}_partner.png`);

/** Ersetzt die Zeitschalter des Fensters, damit die Schau ohne Warten weiterläuft. */
function zeitRaffen(r) {
  const geplant = new Map();
  let naechsteId = 1;
  r.window.setTimeout = (rueckruf, ms) => {
    const id = naechsteId++;
    geplant.set(id, { rueckruf, ms });
    return id;
  };
  r.window.clearTimeout = (id) => geplant.delete(id);
  return {
    /** Führt den nächsten Folienwechsel aus. */
    weiter() {
      const [id, eintrag] = [...geplant].find(([, e]) => e.ms === SLIDE_DURATION_MS);
      geplant.delete(id);
      eintrag.rueckruf();
    },
  };
}

function sichtbareLogos(r) {
  const result = [];
  for (let i = 0; i < SPONSORS_PER_PAGE; i++) {
    const img = r.document.getElementById(`sponsor-logo-${i}`);
    result.push(img.hidden ? null : img.getAttribute('src'));
  }
  return result;
}

function seitenmarken(r) {
  return [...r.document.querySelectorAll('#sponsor-pages i')].map((i) =>
    i.classList.contains('is-current')
  );
}

// --------------------------------------------------------------------
// Zählung
// --------------------------------------------------------------------

test('Sponsoren zählen je angefangene vier als eine Folie', () => {
  assert.equal(slideCount('pre-match', medien(logos(0)), []), 0);
  assert.equal(slideCount('pre-match', medien(logos(1)), []), 1);
  assert.equal(slideCount('pre-match', medien(logos(4)), []), 1);
  assert.equal(slideCount('pre-match', medien(logos(5)), []), 2);
});

test('Highlights und Termine zählen weiter einzeln bzw. je fünf', () => {
  // 5 Partner = 2 Fenster, 2 Highlights = 2 Folien, 6 Termine = 2 Folien
  assert.equal(slideCount('half-time', medien(logos(5), ['a.jpg', 'b.jpg']), termine(6)), 6);
  // vor dem Anpfiff genauso -- es entscheiden die Haken, nicht die Phase
  assert.equal(slideCount('pre-match', medien(logos(5), ['a.jpg', 'b.jpg']), termine(6)), 6);
  assert.equal(slideCount('live', medien(logos(5)), termine(6)), 0);
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

function schauMit(t, werbung, highlights = []) {
  const r = openRenderer('display', t);
  const uhr = zeitRaffen(r);
  const store = new MatchStateStore();
  store.setMedia(medien(werbung, highlights));
  r.emit('onStateUpdated', store.getState());
  store.startSlideshow();
  r.emit('onStateUpdated', store.getState());
  return { r, uhr, store };
}

test('display: die erste Folie ist das Fenster mit vier Partnern', (t) => {
  const { r } = schauMit(t, logos(5));

  assert.ok(r.document.body.classList.contains('showing-slide'));
  assert.equal(r.document.getElementById('sponsor-window').hidden, false);
  assert.equal(r.document.getElementById('slide-image').hidden, true);
  assert.equal(r.text('sponsor-title'), 'UNSERE PARTNER');
  assert.deepEqual(sichtbareLogos(r), [
    'svh-media://werbung/01_partner.png',
    'svh-media://werbung/02_partner.png',
    'svh-media://werbung/03_partner.png',
    'svh-media://werbung/04_partner.png',
  ]);
  assert.deepEqual(seitenmarken(r), [true, false], 'Seite 1 von 2');
  assert.deepEqual(r.drainErrors(), []);
});

test('display: eine angebrochene Seite lässt Kacheln leer, alle vier bleiben', (t) => {
  const { r, uhr } = schauMit(t, logos(5));
  uhr.weiter();

  assert.deepEqual(sichtbareLogos(r), ['svh-media://werbung/05_partner.png', null, null, null]);
  assert.equal(
    r.document.querySelectorAll('.sponsor-tile').length,
    SPONSORS_PER_PAGE,
    'die Kacheln selbst dürfen nicht verschwinden -- sonst würden die übrigen größer'
  );
  assert.equal(
    r.document.getElementById('sponsor-logo-1').hasAttribute('src'),
    false,
    'eine leere Kachel darf kein altes Logo der Vorseite behalten'
  );
  assert.deepEqual(seitenmarken(r), [false, true], 'Seite 2 von 2');
  assert.deepEqual(r.drainErrors(), []);
});

test('display: bei nur einer Seite gibt es keine Seitenmarken', (t) => {
  const { r } = schauMit(t, logos(3));
  assert.deepEqual(seitenmarken(r), []);
  assert.deepEqual(sichtbareLogos(r).filter(Boolean).length, 3);
  assert.deepEqual(r.drainErrors(), []);
});

test('display: Highlights laufen weiter im Vollbild', (t) => {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.goToHalfTime();

  const r = openRenderer('display', t);
  const uhr = zeitRaffen(r);
  store.setMedia(medien(logos(2), ['tor.jpg']));
  r.emit('onStateUpdated', store.getState());
  store.startSlideshow();
  r.emit('onStateUpdated', store.getState());

  assert.equal(r.document.getElementById('sponsor-window').hidden, false, 'erst die Partner');
  uhr.weiter();
  assert.equal(r.document.getElementById('sponsor-window').hidden, true);
  assert.equal(r.document.getElementById('slide-image').hidden, false);
  assert.equal(
    r.document.getElementById('slide-image').getAttribute('src'),
    'svh-media://highlights/tor.jpg'
  );
  assert.deepEqual(r.drainErrors(), []);
});

test('display: die Schau hat genau so viele Folien, wie das Steuerungsfenster ankündigt', (t) => {
  // Folien zählen, bis die normale Ansicht wieder an der Reihe ist.
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.goToHalfTime();
  const werbung = logos(6);
  const highlights = ['a.jpg', 'b.jpg', 'c.jpg'];
  store.setAnnouncements(['So 25.08. Heimspiel', 'Sa 31.08. Jugendturnier']);

  const r = openRenderer('display', t);
  const uhr = zeitRaffen(r);
  store.setMedia(
    medien(werbung, highlights, {
      hauptsponsor: ['01_haupt.png', '02_haupt.png'],
      partner: ['01_neu.png'],
      historie: ['1998-05-17_SV Hochlar - Herten.jpg', '2004_Aufstieg.jpg'],
    })
  );
  r.emit('onStateUpdated', store.getState());
  store.startSlideshow();
  r.emit('onStateUpdated', store.getState());

  let folien = 1;
  while (r.document.body.classList.contains('showing-slide')) {
    uhr.weiter();
    if (r.document.body.classList.contains('showing-slide')) folien++;
    assert.ok(folien < 50, 'die Schau kehrt nie zur normalen Ansicht zurück');
  }

  const angekuendigt = slideCount('half-time', store.getState().media, store.getState().announcements);
  // 2 Hauptsponsoren, 7 Partner = 2 Fenster, 3 Highlights, 2 Fotos, 1 Terminfolie
  assert.equal(angekuendigt, 2 + 2 + 3 + 2 + 1);
  assert.equal(folien, angekuendigt);
  assert.deepEqual(r.drainErrors(), []);
});
