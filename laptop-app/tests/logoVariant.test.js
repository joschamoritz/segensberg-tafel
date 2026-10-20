/**
 * Farbvariante der Vereinslogos.
 *
 * Daran hängt die weiße Kontrastfläche hinter dem Wappen. Sie muss
 * ausschließlich bei farbigen Varianten kommen: Ein weißes Logo auf
 * weißer Fläche verschwände ganz, das wäre schlimmer als der Zustand
 * ohne Fläche.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

const userData = stubElectron();

/**
 * Attrappe für `nativeImage`.
 *
 * `images.ts` und `teamLibrary.ts` brauchen sie; die echte gibt es nur
 * innerhalb von Electron. Der Bildinhalt wird über eine Zuordnung
 * Dateiname -> Bitmap vorgegeben, damit sich die Helligkeitsprüfung
 * gezielt ansteuern lässt. `toBitmap()` liefert BGRA.
 */
const bitmaps = new Map();

function fakeImage(bitmap) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width: 2, height: 2 }),
    resize: () => fakeImage(bitmap),
    toPNG: () => Buffer.from([0x89, 0x50]),
    toJPEG: () => Buffer.from([0xff, 0xd8]),
    toBitmap: () => bitmap,
  };
}

/** Eine Fläche aus n undurchsichtigen Bildpunkten derselben Farbe. */
function flaeche(r, g, b, n = 16) {
  const bytes = [];
  for (let i = 0; i < n; i++) bytes.push(b, g, r, 255);
  return Buffer.from(bytes);
}

require.cache['electron-stub'].exports.nativeImage = {
  createFromPath: (p) => fakeImage(bitmaps.get(path.basename(p)) ?? flaeche(0, 0, 0)),
};

const { detectLogoVariant } = load('main/images');
const { TeamLibrary } = load('main/teamLibrary');
const { MatchStateStore } = load('main/state');

/** Legt eine Datei mit vorgegebenem "Bildinhalt" an. */
function datei(ordner, name, bitmap) {
  fs.mkdirSync(ordner, { recursive: true });
  const p = path.join(ordner, name);
  fs.writeFileSync(p, '');
  if (bitmap) bitmaps.set(name, bitmap);
  return p;
}

const tempWurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'anzeigetafel-logos-'));

// --------------------------------------------------------------------
// Erkennung an der Datei
// --------------------------------------------------------------------

test('der Dateiname entscheidet, wenn er etwas sagt', () => {
  // So sind die Vereinsdaten sortiert -- das ist die verlässlichste
  // Auskunft, die es gibt, und sie schlägt die Bildanalyse.
  const dunkel = flaeche(20, 20, 20);
  assert.equal(
    detectLogoVariant(datei(tempWurzel, 'Bertlich_Weiß.png', dunkel)),
    'white',
    'trotz dunkler Bildpunkte: der Name sagt weiß'
  );
  assert.equal(detectLogoVariant(datei(tempWurzel, 'ETG_weiss.png', dunkel)), 'white');
  assert.equal(detectLogoVariant(datei(tempWurzel, 'FCMarl_white.png', dunkel)), 'white');

  const hell = flaeche(250, 250, 250);
  assert.equal(
    detectLogoVariant(datei(tempWurzel, 'Herten_Farbe.png', hell)),
    'color',
    'trotz heller Bildpunkte: der Name sagt farbig'
  );
});

test('sagt der Name nichts, entscheidet die Helligkeit', () => {
  assert.equal(
    detectLogoVariant(datei(tempWurzel, 'dunkles-logo.png', flaeche(20, 30, 40))),
    'color',
    'ein dunkles Logo braucht die Kontrastfläche'
  );
  assert.equal(
    detectLogoVariant(datei(tempWurzel, 'helles-logo.png', flaeche(250, 250, 250))),
    'white',
    'ein helles Logo steht auch ohne Fläche'
  );
});

test('durchsichtige Bildpunkte zählen bei der Helligkeit nicht mit', () => {
  // Ein freigestelltes Logo besteht überwiegend aus Nichts. Zählte das
  // mit, käme jedes Wappen als "dunkel" heraus und bekäme eine Fläche.
  const bytes = [];
  for (let i = 0; i < 60; i++) bytes.push(0, 0, 0, 0); // durchsichtig, schwarz
  for (let i = 0; i < 4; i++) bytes.push(250, 250, 250, 255); // sichtbar, weiß
  assert.equal(
    detectLogoVariant(datei(tempWurzel, 'freigestellt.png', Buffer.from(bytes))),
    'white'
  );
});

test('im Zweifel bleibt es bei "weiß", also ohne Fläche', () => {
  // SVGs kann nativeImage nicht lesen. Eine Fläche auf Verdacht wäre der
  // schlimmere Fehlgriff -- ein weißes Logo verschwände darauf ganz.
  assert.equal(detectLogoVariant(path.join(tempWurzel, 'irgendwas.svg')), 'white');
});

// --------------------------------------------------------------------
// Bibliothek
// --------------------------------------------------------------------

test('die Bibliothek kennt die Variante aus ihrer Ordnerstruktur', () => {
  // Hier muss nichts geraten werden: Die Bibliothek weiß, aus welchem
  // der beiden Ordner sie die Datei genommen hat.
  const wurzel = fs.mkdtempSync(path.join(userData, 'liga-'));
  const liga = path.join(wurzel, 'Kreisliga B2');
  // Namen wie echte Vereine. Ein Testverein "NurFarbe" ginge schief:
  // `cleanTeamName` streicht Farbkennungen aus dem Dateinamen und machte
  // daraus "Nur".
  datei(path.join(liga, 'Weiß'), 'Bertlich_Weiß.png', flaeche(250, 250, 250));
  datei(path.join(liga, 'Farbe'), 'Bertlich.png', flaeche(20, 20, 20));
  datei(path.join(liga, 'Farbe'), 'Herten.png', flaeche(20, 20, 20));

  const bibliothek = new TeamLibrary(wurzel);

  assert.equal(
    bibliothek.getLogo('Kreisliga B2/Bertlich').variant,
    'white',
    'gibt es die weiße Variante, wird sie genommen -- und braucht keine Fläche'
  );
  assert.equal(
    bibliothek.getLogo('Kreisliga B2/Herten').variant,
    'color',
    'ohne weiße Variante bleibt nur die farbige -- die braucht die Fläche'
  );
  assert.equal(bibliothek.getLogo('Kreisliga B2/GibtEsNicht'), undefined);
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

test('display: kein Wappen bekommt mehr eine Kontrastfläche (Nutzerentscheidung 20.10.2026)', (t) => {
  // Bis 1.9.0 lag hinter farbigen Logos eine weiße Fläche. Sie störte im
  // Probelauf; für schwierige Vereine wählt man die weiße Fassung.
  const r = openRenderer('display', t);
  const store = new MatchStateStore();
  store.setTeamLogo('home', 'data:image/png;base64,AAAA', 'color');
  store.setTeamLogo('away', 'data:image/png;base64,BBBB', 'white');
  r.emit('onStateUpdated', store.getState());

  const mitFlaeche = [...r.document.querySelectorAll('img')].filter((img) => img.classList.contains('has-plate'));
  assert.deepEqual(mitFlaeche.map((img) => img.id), []);
  assert.doesNotMatch(
    require('fs').readFileSync(require('path').join(__dirname, '..', 'dist', 'renderer', 'display', 'display.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ''),
    /has-plate/,
    'keine Regel für eine Fläche mehr im Stylesheet'
  );
  assert.deepEqual(r.drainErrors(), []);
});
