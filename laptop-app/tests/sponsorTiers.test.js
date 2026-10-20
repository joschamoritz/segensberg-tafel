/**
 * Block L: Sponsor-Stufen und Vereinsgeschichte in der Diashow.
 *
 * - Hauptsponsoren (`Werbung/Hauptsponsor/`) bekommen je eine Folie mit
 *   EINER großen Kachel, Partner laufen zu viert. Logos direkt in
 *   `Werbung/` zählen weiter als Partner -- der alte Ordner muss ohne
 *   Umräumen weiterlaufen.
 * - Eine Schau, klar getrennte Blöcke in fester Folge: Hauptsponsor,
 *   Partner, Highlights, Vereinsgeschichte, Termine.
 * - Historische Fotos tragen Datum und Begegnung aus dem Dateinamen.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

const userData = stubElectron();
const { MatchStateStore } = load('main/state');
const { MediaLibrary } = load('main/media');
const {
  buildSlidePlan,
  historyCaption,
  HISTORY_FALLBACK_TITLE,
  SLIDE_DURATION_MS,
  SPONSORS_TITLE,
} = load('shared/types');

function medien(dateien = {}) {
  const ids = ['werbung', 'hauptsponsor', 'partner', 'highlights', 'historie', 'sounds', 'wettbewerbe'];
  return Object.fromEntries(ids.map((id) => [id, { rootPath: id, files: dateien[id] ?? [] }]));
}

// --------------------------------------------------------------------
// Beschriftung aus dem Dateinamen
// --------------------------------------------------------------------

test('historyCaption: Datum und Begegnung aus dem Dateinamen', () => {
  assert.deepEqual(historyCaption('1998-05-17_SV Hochlar - Westfalia Herten.jpg'), {
    date: '17.05.1998',
    title: 'SV Hochlar – Westfalia Herten',
  });
});

test('historyCaption: auch nur Monat oder nur Jahr', () => {
  // Bei alten Fotos ist oft nur die Saison bekannt.
  assert.equal(historyCaption('1987-08_Pokal.jpg').date, 'August 1987');
  assert.equal(historyCaption('1975_Aufstiegsmannschaft.png').date, '1975');
  assert.equal(historyCaption('1975_Aufstiegsmannschaft.png').title, 'Aufstiegsmannschaft');
});

test('historyCaption: Ordnungsnummer davor wird übergangen, eine Jahreszahl nicht', () => {
  assert.equal(historyCaption('03_1998-05-17_Derby.jpg').date, '17.05.1998');
  assert.equal(historyCaption('03_1998-05-17_Derby.jpg').title, 'Derby');
});

test('historyCaption: Ergebnis wird zum Doppelpunkt, vs und gegen zum Gedankenstrich', () => {
  assert.equal(historyCaption('2001-04-01_SVH vs Erkenschwick 3-1.jpg').title, 'SVH – Erkenschwick 3:1');
  assert.equal(historyCaption('2001_SV Hochlar 28 gegen TuS 05.jpg').title, 'SV Hochlar 28 – TuS 05');
});

test('historyCaption: ohne Datum bleibt der Name, ohne Namen bleibt das Datum', () => {
  assert.deepEqual(historyCaption('Altherren_Turnier.jpg'), { date: null, title: 'Altherren Turnier' });
  assert.deepEqual(historyCaption('1998-05-17.jpg'), { date: '17.05.1998', title: '' });
});

// --------------------------------------------------------------------
// Folienfolge
// --------------------------------------------------------------------

test('die Blöcke kommen in fester Folge: große Partner, Partner, Highlights, Geschichte, Termine', () => {
  const plan = buildSlidePlan(
    'half-time',
    medien({
      hauptsponsor: ['haupt.png'],
      partner: ['p1.png'],
      werbung: ['alt.png'],
      highlights: ['h.jpg'],
      historie: ['1998_Foto.jpg'],
    }),
    ['So 25.08. Heimspiel']
  );
  assert.deepEqual(
    plan.map((s) => (s.kind === 'sponsors' ? (s.main ? 'haupt' : 'partner') : s.kind)),
    ['haupt', 'partner', 'image', 'history', 'text']
  );
  // Partner aus Partner/ UND direkt aus Werbung/ teilen sich ein Fenster.
  assert.deepEqual(plan[1].logos.map((l) => l.url), ['svh-media://partner/p1.png', 'svh-media://werbung/alt.png']);
  // Kein eigener Titel „Hauptsponsor" (Nutzer 20.10.2026): groß, aber Partner.
  assert.equal(plan[0].title, SPONSORS_TITLE);
  assert.equal(plan[1].title, SPONSORS_TITLE);
  // Eine Reihe von Seitenmarken über große und kleine Partnerfolien.
  assert.deepEqual([plan[0].page, plan[0].pages, plan[1].page, plan[1].pages], [0, 2, 1, 2]);
});

test('jeder Hauptsponsor bekommt eine eigene Folie', () => {
  const plan = buildSlidePlan('pre-match', medien({ hauptsponsor: ['a.png', 'b.png'] }), []);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((s) => [s.logos.length, s.page, s.pages]), [[1, 0, 2], [1, 1, 2]]);
});

// --------------------------------------------------------------------
// Medienordner
// --------------------------------------------------------------------

test('Hauptsponsor- und Partnerordner werden getrennt vom alten Werbeordner gelesen', () => {
  const root = path.join(userData, 'stufen-test', 'Werbung');
  fs.mkdirSync(path.join(root, 'Hauptsponsor'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Partner'), { recursive: true });
  fs.writeFileSync(path.join(root, 'alt.png'), 'x');
  fs.writeFileSync(path.join(root, 'Hauptsponsor', 'haupt.png'), 'x');
  fs.writeFileSync(path.join(root, 'Partner', 'neu.png'), 'x');

  const library = new MediaLibrary({
    werbung: root,
    hauptsponsor: path.join(root, 'Hauptsponsor'),
    partner: path.join(root, 'Partner'),
  });
  const lists = library.getLists();
  assert.deepEqual(lists.werbung.files, ['alt.png'], 'Unterordner sind keine Motive');
  assert.deepEqual(lists.hauptsponsor.files, ['haupt.png']);
  assert.deepEqual(lists.partner.files, ['neu.png']);
  assert.equal(library.resolveFile('werbung', 'haupt.png'), null, 'nur im eigenen Ordner auflösbar');
  assert.ok(library.resolveFile('hauptsponsor', 'haupt.png'));
});

test('nicht vorgegebene Ordner bleiben in Tests leer, statt auf die Vereinsdaten zu greifen', () => {
  const library = new MediaLibrary({ werbung: path.join(userData, 'gibtesnicht') });
  const lists = library.getLists();
  assert.equal(lists.historie.rootPath, '');
  assert.deepEqual(lists.historie.files, []);
  assert.equal(library.resolveFile('historie', 'foto.jpg'), null);
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

/** Folienwechsel ohne Warten, wie in sponsorWindow.test.js. */
function zeitRaffen(r) {
  const geplant = new Map();
  let naechsteId = 1;
  r.window.setTimeout = (rueckruf, ms) => {
    geplant.set(naechsteId, { rueckruf, ms });
    return naechsteId++;
  };
  r.window.clearTimeout = (id) => geplant.delete(id);
  return () => {
    const [id, eintrag] = [...geplant].find(([, e]) => e.ms === SLIDE_DURATION_MS);
    geplant.delete(id);
    eintrag.rueckruf();
  };
}

function schauInDerPause(t, dateien) {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  store.goToHalfTime();
  store.setMedia(medien(dateien));
  const r = openRenderer('display', t);
  const weiter = zeitRaffen(r);
  r.emit('onStateUpdated', store.getState());
  store.startSlideshow();
  r.emit('onStateUpdated', store.getState());
  return { r, weiter };
}

test('display: ein Hauptsponsor steht groß als Partner, danach das Fenster wieder zu viert', (t) => {
  const { r, weiter } = schauInDerPause(t, {
    hauptsponsor: ['haupt.png'],
    werbung: ['a.png', 'b.png'],
  });
  const fenster = r.document.getElementById('sponsor-window');

  assert.ok(fenster.classList.contains('is-main'));
  assert.equal(r.text('sponsor-title'), SPONSORS_TITLE);
  assert.equal(r.document.getElementById('sponsor-logo-0').getAttribute('src'), 'svh-media://hauptsponsor/haupt.png');
  assert.equal(r.document.getElementById('sponsor-logo-1').hidden, true);

  weiter();
  assert.ok(!fenster.classList.contains('is-main'), 'sonst stünden die Partner in einer einzigen Kachel');
  assert.equal(r.text('sponsor-title'), SPONSORS_TITLE);
  assert.equal(r.document.getElementById('sponsor-logo-1').getAttribute('src'), 'svh-media://werbung/b.png');
  assert.deepEqual(r.drainErrors(), []);
});

test('display: ein historisches Foto zeigt Datum und Begegnung', (t) => {
  const { r, weiter } = schauInDerPause(t, {
    historie: ['1998-05-17_SV Hochlar - Westfalia Herten.jpg', 'Altherren.jpg'],
  });
  const folie = r.document.getElementById('history-slide');

  assert.equal(folie.hidden, false);
  assert.equal(r.document.getElementById('sponsor-window').hidden, true);
  assert.equal(
    r.document.getElementById('history-image').getAttribute('src'),
    'svh-media://historie/1998-05-17_SV%20Hochlar%20-%20Westfalia%20Herten.jpg'
  );
  assert.equal(r.text('history-date'), '17.05.1998');
  assert.equal(r.text('history-title'), 'SV Hochlar – Westfalia Herten');

  weiter();
  assert.equal(r.text('history-date'), HISTORY_FALLBACK_TITLE, 'ohne Datum nennt die Zeile den Block');
  assert.equal(r.text('history-title'), 'Altherren');

  weiter();
  assert.ok(!r.document.body.classList.contains('showing-slide'), 'zurück zur normalen Ansicht');
  assert.deepEqual(r.drainErrors(), []);
});
