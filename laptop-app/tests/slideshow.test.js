/**
 * Diashow: Medienordner, Folienfolge und die Regel, dass sie nur auf
 * Knopfdruck läuft und jeden Phasenwechsel beendet.
 *
 * Besonders wichtig ist `resolveFile()`: Darüber entscheidet der
 * `svh-media:`-Protokollhandler, welche Datei das Anzeigefenster von der
 * Platte bekommt. Ein Loch dort hieße, dass eine präparierte Anfrage
 * beliebige Dateien lesen könnte.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stubElectron, load } = require('./helpers');

const userData = stubElectron();
const { MatchStateStore } = load('main/state');
const { MediaLibrary } = load('main/media');
const v = load('main/validate');
const {
  mediaUrl,
  buildSlidePlan,
  slideshowAvailable,
  MAX_ANNOUNCEMENTS,
  MAX_ANNOUNCEMENT_LENGTH,
} = load('shared/types');

let ordnerZaehler = 0;

/**
 * Legt einen frischen Wegwerf-Ordner mit den angegebenen Dateien an und
 * gibt der MediaLibrary genau diesen vor.
 *
 * Die Ordner MÜSSEN vorgegeben werden: Ohne das fiele
 * `resolveDataFolder()` auf den Entwicklungspfad
 * `D:\Anzeigetafel\Vereinsdaten\Werbung` zurück -- die Tests liefen
 * dann auf den echten Vereinsdaten und löschten sie beim Aufräumen.
 */
function werbeOrdnerMit(dateien) {
  const root = path.join(userData, `media-${ordnerZaehler++}`, 'Werbung');
  fs.mkdirSync(root, { recursive: true });
  for (const name of dateien) fs.writeFileSync(path.join(root, name), 'x', 'utf-8');

  const library = new MediaLibrary({ werbung: root, highlights: path.join(root, 'leer') });
  return { library, root };
}

test('Bilddateien werden nach Dateinamen sortiert eingelesen', () => {
  // Die Reihenfolge auf der Tafel ergibt sich aus dem Dateinamen -- das
  // ist die vorgesehene Pflege ("01_", "02_" …).
  const { library } = werbeOrdnerMit(['03_c.png', '01_a.jpg', '02_b.webp']);
  assert.deepEqual(library.getLists().werbung.files, ['01_a.jpg', '02_b.webp', '03_c.png']);
});

test('Nicht-Bilder werden ignoriert', () => {
  // Im Ordner liegen erfahrungsgemäß auch Textdateien und Vorlagen.
  const { library } = werbeOrdnerMit(['01_a.png', 'notizen.txt', 'vorlage.psd']);
  assert.deepEqual(library.getLists().werbung.files, ['01_a.png']);
});

test('ein fehlender Ordner ergibt eine leere Liste statt eines Fehlers', () => {
  // Der Normalfall, solange der Verein noch keine Motive hinterlegt hat.
  const library = new MediaLibrary({
    werbung: path.join(userData, 'gibtesnicht'),
    highlights: path.join(userData, 'gibtesauchnicht'),
  });
  assert.deepEqual(library.getLists().highlights.files, []);
  assert.deepEqual(library.getLists().werbung.files, []);
});

test('der Ordnerpfad wandert mit in den Zustand', () => {
  // Ohne ihn könnte das Steuerungsfenster bei einem leeren Ordner nicht
  // sagen, WO nichts gefunden wurde.
  const { library, root } = werbeOrdnerMit(['01_a.png']);
  assert.equal(library.getLists().werbung.rootPath, root);
});

test('resolveFile findet eine echte Bilddatei', () => {
  const { library, root } = werbeOrdnerMit(['01_a.png']);
  assert.equal(library.resolveFile('werbung', '01_a.png'), path.resolve(root, '01_a.png'));
});

test('resolveFile weist alles ab, was aus dem Ordner herausführt', () => {
  const { library, root } = werbeOrdnerMit(['01_a.png']);
  // Datei außerhalb des Ordners, die es tatsächlich gibt.
  const draussen = path.join(path.dirname(root), 'geheim.png');
  fs.writeFileSync(draussen, 'x', 'utf-8');

  for (const eingabe of [
    '../geheim.png',
    '..\\geheim.png',
    '../../geheim.png',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    '',
    '.',
    '..',
  ]) {
    assert.equal(
      library.resolveFile('werbung', eingabe),
      null,
      `"${eingabe}" hätte abgewiesen werden müssen`
    );
  }

  fs.rmSync(draussen, { force: true });
});

test('resolveFile weist Nicht-Bilder und Unbekanntes ab', () => {
  const { library, root } = werbeOrdnerMit(['01_a.png']);
  fs.writeFileSync(path.join(root, 'notizen.txt'), 'x', 'utf-8');

  assert.equal(library.resolveFile('werbung', 'notizen.txt'), null);
  assert.equal(library.resolveFile('werbung', 'gibtesnicht.png'), null);
});

test('die Medien-Adresse kodiert Sonderzeichen im Dateinamen', () => {
  // Leerzeichen und Umlaute sind in Vereinsordnern die Regel.
  assert.equal(mediaUrl('werbung', '01 Grün & Co.png'), 'svh-media://werbung/01%20Gr%C3%BCn%20%26%20Co.png');
});

test('Folien laufen in jeder Phase außer dem laufenden Spiel', () => {
  // Im laufenden Spiel gehört der Spielstand auf die Tafel -- das ist die
  // einzige Phase, in der die Diashow gesperrt bleibt.
  //
  // Nach dem Abpfiff läuft sie seit dem 20.08.2026 mit (Nutzerwunsch):
  // Sie startet ohnehin nur auf Knopfdruck, verdrängt den Endstand also
  // nur, wenn jemand das will -- und während sich der Platz leert, ist
  // das die sinnvollste Zeit für Sponsorenmotive.
  assert.equal(slideshowAvailable('pre-match'), true);
  assert.equal(slideshowAvailable('half-time'), true);
  assert.equal(slideshowAvailable('full-time'), true);
  assert.equal(slideshowAvailable('live'), false);

});

test('was abgehakt ist, läuft in jeder Phase -- auch die Vereinsgeschichte vor dem Anpfiff', () => {
  // Nutzerwunsch 20.10.2026: Die feste Regel „vor dem Anpfiff nur
  // Sponsoren" ist entfallen, die Haken entscheiden.
  const media = Object.fromEntries(
    ['werbung', 'hauptsponsor', 'partner', 'highlights', 'historie', 'sounds', 'wettbewerbe'].map((id) => [
      id,
      { rootPath: id, files: [] },
    ])
  );
  media.werbung.files = ['a.png'];
  media.highlights.files = ['h.jpg'];
  media.historie.files = ['1998_Foto.jpg'];
  for (const phase of ['pre-match', 'half-time', 'full-time']) {
    assert.deepEqual(
      buildSlidePlan(phase, media, ['Termin']).map((f) => f.kind),
      ['sponsors', 'image', 'history', 'text'],
      phase
    );
  }
  assert.deepEqual(buildSlidePlan('live', media, ['Termin']), [], 'im Spiel nie');
  const nurGeschichte = { partner: false, highlights: false, historie: true, termine: false };
  assert.deepEqual(
    buildSlidePlan('pre-match', media, ['Termin'], undefined, nurGeschichte).map((f) => f.kind),
    ['history']
  );
  // Jeder Haken muss auch wirklich abschalten.
  for (const [block, kind] of [['partner', 'sponsors'], ['highlights', 'image'], ['historie', 'history'], ['termine', 'text']]) {
    const ohne = { partner: true, highlights: true, historie: true, termine: true, [block]: false };
    assert.ok(
      !buildSlidePlan('half-time', media, ['Termin'], undefined, ohne).some((f) => f.kind === kind),
      `${block} abgehakt, läuft aber`
    );
  }
});

test('die Diashow startet nur in den passenden Phasen', () => {
  const store = new MatchStateStore();
  store.startSlideshow();
  assert.ok(store.getState().slideshowRequest, 'vor dem Anpfiff muss sie starten');

  store.kickoff();
  store.startSlideshow();
  assert.equal(
    store.getState().slideshowRequest,
    null,
    'im laufenden Spiel darf keine Werbung starten'
  );
  store.stopClock();
});

test('jeder Phasenwechsel beendet die Diashow', () => {
  // Eine Folie darf einen Anpfiff nicht überleben -- sonst steht beim
  // Anstoß ein Sponsorenmotiv auf der Tafel.
  const store = new MatchStateStore();

  store.startSlideshow();
  store.kickoff();
  assert.equal(store.getState().slideshowRequest, null, 'Anpfiff');

  store.goToHalfTime();
  store.startSlideshow();
  assert.ok(store.getState().slideshowRequest);
  store.startSecondHalf();
  assert.equal(store.getState().slideshowRequest, null, '2. Halbzeit');

  store.goToFullTime();
  store.stopClock();
});

test('"Phase zurück" beendet die Diashow ebenfalls', () => {
  const store = new MatchStateStore();
  store.kickoff();
  store.goToHalfTime();
  store.startSlideshow();
  store.revertPhase();
  assert.equal(store.getState().slideshowRequest, null);
  store.stopClock();
});

test('Aufstellung und Torschützen-Einblendung lösen die Diashow ab', () => {
  // Beides läuft in denselben Phasen -- gleichzeitig ginge nicht.
  const store = new MatchStateStore();
  store.startSlideshow();
  store.showLineup('home');
  assert.equal(store.getState().slideshowRequest, null);
  assert.ok(store.getState().lineupRequest);

  store.startSlideshow();
  assert.equal(
    store.getState().lineupRequest,
    null,
    'umgekehrt muss die Diashow die Aufstellung ablösen'
  );
});

test('"Neues Spiel" behält Medien und Ankündigungen', () => {
  // Beide gehören zum Verein, nicht zur Begegnung.
  const store = new MatchStateStore();
  store.setAnnouncements(['Nächstes Heimspiel: So 15:00']);
  store.setMedia({
    werbung: { rootPath: 'C:/x', files: ['01.png'] },
    highlights: { rootPath: 'C:/y', files: [] },
    wettbewerbe: { rootPath: 'W', files: [] },
    hauptsponsor: { rootPath: 'HS', files: [] },
    partner: { rootPath: 'P', files: [] },
    historie: { rootPath: 'HI', files: [] },
    sounds: { rootPath: 'C:/z', files: ['tor.mp3'] },
  });

  store.resetMatch();
  assert.deepEqual(store.getState().announcements, ['Nächstes Heimspiel: So 15:00']);
  assert.deepEqual(store.getState().media.werbung.files, ['01.png']);
});

test('Ankündigungen: leere Zeilen fallen raus, der Rest wird gekappt', () => {
  const geprueft = v.sanitizeAnnouncements([
    '  Sommerfest am 30.08.  ',
    '',
    '   ',
    'x'.repeat(200),
  ]);

  assert.deepEqual(geprueft.slice(0, 1), ['Sommerfest am 30.08.']);
  assert.equal(geprueft.length, 2, 'leere Zeilen hätten wegfallen müssen');
  assert.equal(geprueft[1].length, MAX_ANNOUNCEMENT_LENGTH);
});

test('Ankündigungen sind in der Anzahl begrenzt', () => {
  // Ein versehentlich eingefügter Textblock soll keine 500 Folien ergeben.
  const viele = Array.from({ length: 100 }, (_, i) => `Termin ${i}`);
  assert.equal(v.sanitizeAnnouncements(viele).length, MAX_ANNOUNCEMENTS);
});

test('Ankündigungen ignorieren Unsinn statt zu werfen', () => {
  assert.deepEqual(v.sanitizeAnnouncements(null), []);
  assert.deepEqual(v.sanitizeAnnouncements('Text'), []);
  assert.deepEqual(v.sanitizeAnnouncements([42, {}, null]), []);
});
