/**
 * Schutz der beiden Fenster vor Dingen, die am Spieltag passieren, ohne
 * dass jemand etwas falsch machen will (Review 2026-10):
 *
 * - W1: Die Maus wandert über den Bildschirmrand auf die Tafel.
 * - W5: Ein Bild wird aufs Steuerungsfenster gezogen, und Electron
 *   navigiert zu ihm -- die Bedienung ist weg.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stubElectron, load } = require('./helpers');

stubElectron();
const { lockNavigation } = load('main/windows');

/** Fenster-Attrappe, die mitschreibt, was angemeldet wurde. */
function fenster() {
  const handler = {};
  let openHandler = null;
  return {
    handler,
    openHandler: () => openHandler,
    webContents: {
      on: (name, fn) => {
        handler[name] = fn;
      },
      setWindowOpenHandler: (fn) => {
        openHandler = fn;
      },
    },
  };
}

test('W5: ein Fenster navigiert nicht weg, wenn eine Datei darauf landet', () => {
  const win = fenster();
  lockNavigation(win);

  let verhindert = false;
  win.handler['will-navigate']({ preventDefault: () => (verhindert = true) }, 'file:///C:/logo.png');
  assert.equal(verhindert, true);
  assert.deepEqual(win.openHandler()({ url: 'https://example.com' }), { action: 'deny' });
});

test('W5: beide Fenster werden geschützt', () => {
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'windows.ts'), 'utf-8');
  // Einmal die Definition, je einmal im Steuerungs- und im Anzeigefenster.
  assert.equal(quelle.match(/lockNavigation\(win\)/g)?.length, 2);
});

test('W1: auf der Tafel gibt es keinen Mauszeiger', () => {
  const css = fs
    .readFileSync(path.join(__dirname, '..', 'dist', 'renderer', 'display', 'display.css'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const body = css.match(/html,\s*body\s*\{[^}]*\}/);
  assert.ok(body, 'Regel für html, body fehlt');
  assert.match(body[0], /cursor:\s*none/);
});

test('Retro: kein Element setzt sich mit visibility: visible über das Ausblenden hinweg', () => {
  // Das Retro-Design blendet alles außer der Punktmatrix per
  // `visibility: hidden` aus. Ein Kind mit `visibility: visible` erbt das
  // nicht -- so stand das Vereinstrikot der Einzel-Aufstellung über dem
  // Raster (Probelauf 20.10.2026). Erlaubt ist nur die bewusste Ausnahme
  // der Diashow-Bilder.
  const css = fs
    .readFileSync(path.join(__dirname, '..', 'dist', 'renderer', 'display', 'display.css'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const sichtbar = [...css.matchAll(/([^{}]+)\{[^}]*visibility:\s*visible[^}]*\}/g)].map((m) => m[1].trim());
  assert.deepEqual(sichtbar, ["body[data-theme='retro'][data-retro-overlay='slide'] .board-slides"]);
});

test('Bilder der Anzeige haben eine feste Größe, nicht nur ein Höchstmaß', () => {
  // `max-height`/`max-width` verkleinern, vergrößern aber nie. Logos
  // liegen mit höchstens 256 px vor, Portraits mit 320 px -- bei einer
  // Tafelauflösung über 384×192 blieben sie auf Dateigröße stehen, und
  // die Vorschau zeigte ein anderes Bild als die Tafel (Befund
  // 21.10.2026: Foto klein neben dem Trikot, Wappen und Diashow zu klein).
  const dir = path.join(__dirname, '..', 'dist', 'renderer', 'display');
  const css = fs.readFileSync(path.join(dir, 'display.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf-8');
  const klassen = new Set(
    [...html.matchAll(/<img\b[^>]*\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/))
  );
  klassen.add('pitch-shirt'); // entsteht in lineup.ts
  assert.ok(klassen.has('crest-img') && klassen.has('slide-image'), 'Bildklassen nicht gefunden');

  const regeln = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  for (const klasse of klassen) {
    // Auch Selektorlisten wie `.card-jersey-home, .card-jersey-blank`.
    const eigene = regeln.filter((m) => m[1].split(',').map((s) => s.trim()).includes(`.${klasse}`));
    assert.ok(eigene.length > 0, `.${klasse} hat keine eigene Regel`);
    assert.ok(
      eigene.some((m) => /(^|[;\s])(height|width):/.test(m[2])),
      `.${klasse} hat nur ein Höchstmaß`
    );
  }
  // Und nirgends ein Höchstmaß der Höhe ohne feste Höhe daneben.
  const nurMax = regeln
    .filter((m) => /max-height/.test(m[2]) && !/(^|[;\s])height:/.test(m[2]))
    .map((m) => m[1].trim());
  assert.deepEqual(nurMax, []);
});

test('Sponsorenlogos stehen ohne weiße Kachel (Nutzerentscheidung 20./21.10.2026)', () => {
  const css = fs
    .readFileSync(path.join(__dirname, '..', 'dist', 'renderer', 'display', 'display.css'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const regeln = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /sponsor-(chip|tile)/.test(m[1]) && /background:\s*var\(--svh-wh\)/.test(m[2]))
    .map((m) => m[1].trim());
  assert.deepEqual(regeln, []);
});
