/**
 * Das `hidden`-Attribut muss in beiden Fenstern wirksam sein.
 *
 * Die Falle: Eine Autoren-Regel mit `display` schlägt die Browser-Regel
 * `[hidden] { display: none }` -- unabhängig von der Spezifität. Wer
 * einem Element im CSS ein `display` gibt und es im Renderer über
 * `element.hidden` schaltet, bekommt ein Element, das der Renderer für
 * versteckt hält und das trotzdem dasteht.
 *
 * Das war kein theoretisches Risiko: In der ausgelieferten Fassung 1.0.0
 * standen im Steuerungsfenster zwei leere 120x36-Kästen (`.logo-preview`,
 * `display: block` in `control.css:391`), die der Renderer für
 * ausgeblendet hielt. `control.css` enthielt null `[hidden]`-Regeln,
 * `display.css` dagegen zehn.
 *
 * Geprüft wird gegen `dist/`, also gegen den ausgelieferten Stand --
 * gleiche Regel wie in `helpers.js`. jsdom rechnet keine Kaskade, deshalb
 * wird das Stylesheet als Text geprüft statt am gerenderten Element.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, '..', 'dist', 'renderer');

/**
 * Stylesheet ohne Kommentare.
 *
 * Nötig, weil die Kommentare hier die Regeln erklären, die sie
 * begleiten -- ein `[hidden] { display: none }` im erklärenden Text
 * sähe für eine Textsuche aus wie die Regel selbst. Der erste Anlauf
 * dieses Tests ist genau darauf hereingefallen.
 */
function stylesheet(name) {
  const roh = fs.readFileSync(path.join(RENDERER, name, `${name}.css`), 'utf-8');
  return roh.replace(/\/\*[\s\S]*?\*\//g, '');
}

function quelltext(name) {
  return fs.readFileSync(path.join(RENDERER, name, `${name}.js`), 'utf-8');
}

test('control.css macht das hidden-Attribut global wirksam', () => {
  const css = stylesheet('control');

  // Eine globale Regel statt einer je Element: Sie kann nicht vergessen
  // werden, wenn jemand später einem versteckbaren Element ein `display`
  // gibt -- und genau dieses Vergessen ist der Fehler.
  const regel = css.match(/\[hidden\]\s*\{[^}]*\}/);
  assert.ok(regel, 'control.css braucht eine [hidden]-Regel');
  assert.match(
    regel[0],
    /display:\s*none\s*!important/,
    'ohne !important schlägt jede Autoren-Regel mit display das Attribut wieder'
  );
});

test('die Logo-Vorschau ist wirklich versteckbar', () => {
  // Der konkrete Fall, an dem der Fehler aufgefallen ist. `.logo-preview`
  // braucht ein `display: block` und wird zugleich über `element.hidden`
  // geschaltet -- ohne die Guardrail stand sie als leerer Kasten da.
  const css = stylesheet('control');

  assert.match(css, /\.logo-preview\s*\{[^}]*display:\s*block/, 'Vorbedingung: sie hat ein display');

  const hiddenRegel = css.indexOf('[hidden]');
  const logoRegel = css.indexOf('.logo-preview {');
  assert.ok(hiddenRegel >= 0 && logoRegel >= 0);
  assert.ok(
    hiddenRegel < logoRegel,
    'die globale Regel steht vor den Komponenten -- mit !important zwar ' +
      'unerheblich, aber die Reihenfolge dokumentiert die Absicht'
  );
});

test('jedes per element.hidden geschaltete Element ist abgedeckt', () => {
  // Zählt, wie oft der Renderer `hidden` schaltet. Der Test hängt nicht
  // an der genauen Zahl, sondern daran, dass es überhaupt geschieht --
  // sonst wäre die Guardrail gegenstandslos und dieser Test würde still
  // durchlaufen, obwohl er nichts mehr prüft.
  const js = quelltext('control');
  const treffer = js.match(/\.hidden\s*=/g) ?? [];
  assert.ok(
    treffer.length >= 5,
    `der Renderer schaltet nur ${treffer.length} Elemente über hidden -- ` +
      'stimmt das noch, oder prüft dieser Test ins Leere?'
  );
});

test('display.css hält dieselbe Regel ein', () => {
  // Dort ist sie je Element gelöst und funktioniert seit Block D. Der
  // Test hält nur fest, dass es sie gibt -- ein Umbau, der die zehn
  // Einzelregeln entfernt, soll auffallen.
  const css = stylesheet('display');
  const regeln = css.match(/\[hidden\]/g) ?? [];
  assert.ok(regeln.length >= 5, `display.css hat nur ${regeln.length} [hidden]-Regeln`);
});
