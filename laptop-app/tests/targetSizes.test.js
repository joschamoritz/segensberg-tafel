/**
 * Mindest-Zielflächen der Bedienelemente im Steuerungsfenster.
 *
 * Warum als Text über das Stylesheet und nicht am gerenderten Element:
 * jsdom rechnet keine Kaskade und kein Layout. Die Alternative wäre gar
 * keine Absicherung -- und die Werte hier sind nicht Geschmack, sondern
 * das Ergebnis einer Messung am gebauten Fenster:
 *
 *   Löschkreuz der Chronik   13x16 px  (neben einem Löschvorgang!)
 *   Ecken-Schrittknöpfe      28x27 px
 *   Kartenknöpfe             35 px hoch
 *
 * Bedient wird mit der Maus, nicht mit dem Finger -- 44px sind hier also
 * nicht der Maßstab. Aber unter ~24px wird auch ein Mausklick zur
 * Zielübung, und beim Löschkreuz hängt daran ein nicht umkehrbarer
 * Schritt.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'dist', 'renderer', 'control', 'control.css');

/** Regelblock zu einem Selektor, ohne Kommentare. */
function regel(selektor) {
  const css = fs.readFileSync(CSS, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
  const start = css.indexOf(selektor + ' {');
  assert.ok(start >= 0, `Regel "${selektor}" gibt es nicht mehr`);
  const ende = css.indexOf('}', start);
  return css.slice(start, ende);
}

/** Wert einer Eigenschaft in Pixeln. */
function px(selektor, eigenschaft) {
  const treffer = regel(selektor).match(new RegExp(eigenschaft + ':\\s*(\\d+)px'));
  assert.ok(treffer, `"${selektor}" hat kein ${eigenschaft} in px`);
  return Number(treffer[1]);
}

test('das Löschkreuz der Chronik ist groß genug zum Treffen', () => {
  // Es saß bei 13x16px direkt am Nachbarelement -- die kleinste
  // Zielfläche der Oberfläche ausgerechnet an der einzigen nicht
  // umkehrbaren Aktion.
  assert.ok(px('.goal-remove', 'min-width') >= 24, 'mindestens 24px breit');
  assert.ok(px('.goal-remove', 'min-height') >= 24, 'mindestens 24px hoch');
});

test('die Ecken-Schrittknöpfe sind größer als der Standard-Kleinknopf', () => {
  // Oft gebraucht, aber folgenlos: ein Fehlklick ist mit dem Gegenknopf
  // sofort behoben. Deshalb größer als .btn-small, aber kleiner als der
  // Spielstand-Stepper.
  assert.ok(px('.corner-row .btn', 'min-width') >= 34);
  assert.ok(px('.corner-row .btn', 'min-height') >= 34);
});

test('Kartenknöpfe haben volle Zielgröße', () => {
  // Eine Karte steht sofort auf der Tafel -- ein Fehlklick ist teuer.
  assert.ok(px('.card-buttons .btn', 'min-height') >= 40);
});

test('Karten sind volle Farbflächen, keine blassen Tönungen', () => {
  // Man soll sie treffen, ohne zu lesen (Nutzerwunsch 20.08.2026).
  const gelb = regel('.card-yellow');
  const rot = regel('.card-red');
  const gelbrot = regel('.card-yellow-red');

  assert.match(gelb, /background:\s*var\(--card-yellow\)/);
  assert.match(rot, /background:\s*var\(--card-red\)/);
  assert.match(gelbrot, /linear-gradient/, 'Gelb-Rot trägt beide Farben');

  // Die blassen Tönungen gehören zu Hinweisflächen, nicht zu Karten.
  for (const [name, block] of [['gelb', gelb], ['rot', rot], ['gelb-rot', gelbrot]]) {
    assert.doesNotMatch(block, /--tint-/, `${name} nutzt wieder eine Tönung`);
  }
});

test('die Kartenfarben stimmen mit der Anzeige überein', () => {
  // Eine gelbe Karte soll auf der Tafel und im Steuerungsfenster
  // dieselbe Farbe haben. Beide Stylesheets führen die Werte im
  // :root-Block (Guardrail aus DESIGN.md).
  const lies = (datei) => fs.readFileSync(datei, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
  const control = lies(CSS);
  const display = lies(path.join(path.dirname(path.dirname(CSS)), 'display', 'display.css'));

  for (const token of ['--card-yellow', '--card-red']) {
    const a = control.match(new RegExp(token + ':\\s*(#[0-9a-fA-F]+)'));
    const b = display.match(new RegExp(token + ':\\s*(#[0-9a-fA-F]+)'));
    assert.ok(a && b, `${token} fehlt in einem der beiden Stylesheets`);
    assert.equal(a[1], b[1], `${token} läuft zwischen Tafel und Steuerung auseinander`);
  }
});
