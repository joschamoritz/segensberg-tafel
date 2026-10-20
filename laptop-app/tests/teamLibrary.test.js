/**
 * Logo-Bibliothek: Vereinsnamen aus der Ordnerstruktur
 * `<Liga>/Farbe|Weiß/<Verein>.png` (Review 2026-10, T3).
 *
 * Die Namensbereinigung hat Fallen, die erst bei echten Dateinamen
 * auffallen: Farbkennungen in allen Schreibweisen, Variantennummern, die
 * eine Dublette meinen -- oder eben die zweite Mannschaft. Die offene
 * Backlog-Frage zu „Firtinaspor Marl 2“ hängt genau daran.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stubElectron, load } = require('./helpers');

stubElectron();
const { TeamLibrary } = load('main/teamLibrary');

/** Legt eine Bibliothek aus leeren Dateien an: { 'Liga/Weiß': ['A_weiß.png'] } */
function bibliothek(t, aufbau) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-'));
  t.after(() => fs.rmSync(wurzel, { recursive: true, force: true }));
  for (const [ordner, dateien] of Object.entries(aufbau)) {
    fs.mkdirSync(path.join(wurzel, ordner), { recursive: true });
    for (const datei of dateien) fs.writeFileSync(path.join(wurzel, ordner, datei), '');
  }
  return new TeamLibrary(wurzel);
}

const namen = (lib) => lib.list().map((e) => `${e.league}/${e.name}`);

test('Farbkennungen verschwinden aus dem Namen, beide Varianten ergeben einen Verein', (t) => {
  const lib = bibliothek(t, {
    'Kreisliga/Weiß': ['Erler SV_weiß.png', 'Langenbochum_Weiß.png', 'SG Herne 70 white.png'],
    'Kreisliga/Farbe': ['Erler SV.png', 'Langenbochum_BlauNeu.png', 'SG Herne 70_Farbe.jpg'],
  });
  assert.deepEqual(namen(lib), ['Kreisliga/Erler SV', 'Kreisliga/Langenbochum', 'Kreisliga/SG Herne 70']);
  assert.equal(lib.getName('Kreisliga/Erler SV'), 'Erler SV');
});

test('Variantennummer wird nur zusammengeführt, wenn es den Namen ohne Nummer gibt', (t) => {
  const lib = bibliothek(t, {
    'Liga/Weiß': ['VfB Börnig 2_weiß.png', 'VfB Börnig_weiß.png', 'SG Herne 70_weiß2.png', 'Firtinaspor Marl 2_weiß.png'],
  });
  // "VfB Börnig 2" ist eine Dublette, "Firtinaspor Marl 2" ohne Gegenstück
  // bleibt -- es könnte die zweite Mannschaft sein.
  assert.deepEqual(namen(lib), ['Liga/Firtinaspor Marl 2', 'Liga/SG Herne 70', 'Liga/VfB Börnig']);
});

test('fremde Ordner und Dateien werden übergangen', (t) => {
  const lib = bibliothek(t, {
    'Liga/Weiß': ['A_weiß.png', 'notizen.txt', 'B_weiß.PNG'],
    'Liga/Entwürfe': ['C.png'],
  });
  assert.deepEqual(namen(lib), ['Liga/A', 'Liga/B']);
});

test('sortiert nach Liga, dann Verein', (t) => {
  const lib = bibliothek(t, {
    'Kreisliga B2/Weiß': ['Zeche_weiß.png', 'Adler_weiß.png'],
    'Bezirksliga 9/Weiß': ['Westfalia_weiß.png'],
  });
  assert.deepEqual(namen(lib), ['Bezirksliga 9/Westfalia', 'Kreisliga B2/Adler', 'Kreisliga B2/Zeche']);
});

test('fehlender Ordner ergibt eine leere Liste statt eines Fehlers', () => {
  const lib = new TeamLibrary(path.join(os.tmpdir(), 'gibt-es-nicht-' + Date.now()));
  assert.deepEqual(lib.list(), []);
  assert.equal(lib.getName('x/y'), undefined);
});

// --------------------------------------------------------------------
// Weißes oder farbiges Logo wählen (Nutzerwunsch nach dem Probelauf)
// --------------------------------------------------------------------

const { openRenderer } = require('./dom');

test('die Bibliothek meldet, welche Logofassungen vorliegen', (t) => {
  const lib = bibliothek(t, {
    'Liga/Weiß': ['Beide_weiß.png', 'Bertlich_weiß.png'],
    'Liga/Farbe': ['Beide.png', 'Herten.png'],
  });
  assert.deepEqual(
    lib.list().map((e) => [e.name, e.variants]),
    [
      ['Beide', ['white', 'color']],
      ['Bertlich', ['white']],
      ['Herten', ['color']],
    ]
  );
});

test('Steuerung: bei zwei Fassungen stehen beide zur Wahl, die farbige wird mitgeschickt', (t) => {
  const r = openRenderer('control', t);
  r.emit('onLibraryUpdated', {
    rootPath: 'D:\Logos',
    squadNames: [],
    teams: [
      { id: 'Liga/Beide', name: 'Beide', league: 'Liga', variants: ['white', 'color'] },
      { id: 'Liga/NurFarbe', name: 'NurFarbe', league: 'Liga', variants: ['color'] },
    ],
  });
  const select = r.document.getElementById('away-library-select');
  const optionen = [...select.querySelectorAll('option')].filter((o) => o.value).map((o) => o.textContent);
  assert.deepEqual(optionen, ['Beide – weißes Logo', 'Beide – farbiges Logo', 'NurFarbe']);

  r.calls.length = 0;
  select.selectedIndex = [...select.options].findIndex((o) => o.textContent === 'Beide – farbiges Logo');
  select.dispatchEvent(new r.window.Event('change'));
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [
    { name: 'libraryPick', args: ['away', 'Liga/Beide', 'color'] },
  ]);
  assert.deepEqual(r.drainErrors(), []);
});
