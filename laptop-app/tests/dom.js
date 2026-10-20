/**
 * Lädt ein Renderer-Fenster in eine jsdom-Umgebung.
 *
 * Zweck: TypeScript prüft keine Element-Zugriffe. Ein
 * `document.getElementById('x')!` auf ein aus dem HTML entferntes Element
 * übersetzt sauber und bricht erst zur Laufzeit ab -- das hat schon
 * einmal die halbe Anzeige mitgerissen. Hier läuft der echte,
 * gebündelte Renderer gegen das echte `index.html`, sodass so ein
 * Zugriff beim Testlauf auffällt statt am Spieltag.
 *
 * Geladen wird aus `dist/`, also aus genau dem Stand, der auch
 * ausgeliefert wird -- gleiche Regel wie in `helpers.js`.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DIST = path.join(__dirname, '..', 'dist', 'renderer');

/**
 * Attrappe der Preload-Brücke.
 *
 * Ein Proxy statt einer ausgeschriebenen Liste: Die echte Brücke hat über
 * sechzig Mitglieder, und eine handgepflegte Zweitschrift wäre genau die
 * Fehlerquelle, die `window.d.ts` mit `typeof api` schon einmal
 * beseitigt hat. Callbacks (`on…`) werden gemerkt, damit der Test
 * anschließend Zustände hineinschieben kann; alles andere ist ein
 * Leerlauf, der ein aufgelöstes Promise liefert -- das deckt sowohl
 * `send` als auch `invoke` ab.
 *
 * `overrides` ersetzt einzelne Mitglieder durch eine eigene Fassung. Das
 * braucht jede Funktion, die der Renderer per `invoke` ABFRAGT statt sie
 * nur zu rufen: Der Leerlauf liefert `null`, und ein Test, der nur den
 * Leerlauf sieht, kann nicht umfallen, wenn die Anzeige des Ergebnisses
 * kaputtgeht.
 *
 * @param {Record<string, Function>} [overrides]
 */
function makeApiStub(overrides = {}) {
  const callbacks = new Map();

  /**
   * Mitschnitt jedes Aufrufs über die Brücke, in der Reihenfolge des
   * Auftretens: `{ name, args }`.
   *
   * Wozu: Die Suite prüfte bisher nur, dass Element-Ids überleben -- sie
   * klickte nie. Damit war die Fehlerklasse unsichtbar, die ein Umbau des
   * HTML tatsächlich erzeugt: Alle Ereignis-Handler werden genau einmal in
   * `main()` gesetzt und leben danach in Closures auf konkreten Knoten.
   * Wird ein Knoten ausgetauscht, sieht die Anzeige weiter korrekt aus --
   * `renderState` holt jedes Mal frisch per `getElementById` --, aber der
   * Knopf tut nichts. Am Spielfeldrand ist das der schlechteste denkbare
   * Ausfall, weil nichts darauf hinweist.
   */
  const calls = [];

  const api = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (Object.prototype.hasOwnProperty.call(overrides, prop)) return overrides[prop];
        return (...args) => {
          if (prop.startsWith('on') && typeof args[0] === 'function') {
            callbacks.set(prop, args[0]);
            return undefined;
          }
          calls.push({ name: prop, args });
          return Promise.resolve(null);
        };
      },
      has: () => true,
    }
  );

  return { api, callbacks, calls };
}

/**
 * Baut ein Fenster auf und führt den gebündelten Renderer darin aus.
 *
 * `runScripts: 'outside-only'` statt `'dangerously'`: Das `<script src>`
 * im HTML soll NICHT vom Parser ausgeführt werden. Sonst hinge der Test
 * daran, ob `window.api` rechtzeitig vor `DOMContentLoaded` gesetzt ist
 * -- eine Wettlaufsituation, die mal durchgeht und mal nicht. Stattdessen
 * wird der Bündel-Code von Hand ausgeführt und `DOMContentLoaded`
 * anschließend selbst ausgelöst, wenn alles steht.
 *
 * @param {'control'|'display'} name
 * @param {import('node:test').TestContext} [t] Testkontext. Wird er
 *   übergeben, schließt sich das Fenster auch dann, wenn eine Zusicherung
 *   vorher wirft -- siehe unten.
 * @param {Record<string, Function>} [overrides] Einzelne Mitglieder der
 *   Preload-Attrappe ersetzen -- siehe makeApiStub().
 */
function openRenderer(name, t, overrides) {
  const html = fs.readFileSync(path.join(DIST, name, 'index.html'), 'utf-8');
  const bundle = fs.readFileSync(path.join(DIST, name, `${name}.js`), 'utf-8');

  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'file:///anzeigetafel/',
  });
  const { window } = dom;

  // Fehlerkanäle. Beide Fenster melden Fehler unterschiedlich:
  // das Steuerungsfenster über ein sichtbares Banner (`showError`), die
  // Anzeige über `console.error` aus `step()`, weil dort ein einzelner
  // fehlgeschlagener Schritt die übrigen nicht mitreißen darf.
  const consoleErrors = [];
  window.console.error = (...args) => consoleErrors.push(args.map(String).join(' '));

  // In jsdom nicht vorhanden. Wird nur erreicht, wenn eine Tondatei
  // gesetzt ist -- ohne Attrappe schlüge das als Ladefehler auf.
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};

  const { api, callbacks, calls } = makeApiStub(overrides);
  window.api = api;

  window.eval(bundle);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  // jsdom feuert `DOMContentLoaded` kurz darauf noch einmal selbst. Ohne
  // diese Sperre lief `main()` der Anzeige ein zweites Mal -- mit neuem
  // `showPage('matchup')`, das eine eben gestartete Aufstellung zurück auf
  // die Begegnung warf (aufgefallen an der Einzel-Aufstellung im Retro-
  // Design), und mit doppelt eingetragenen Rückrufen. Die Sperre greift
  // in der Zielphase vor den Listenern des Renderers, weil Capture-
  // Listener am Ziel zuerst laufen.
  window.document.addEventListener('DOMContentLoaded', (event) => event.stopImmediatePropagation(), {
    capture: true,
  });

  /** Text des Fehlerbanners im Steuerungsfenster, '' wenn keiner steht. */
  function bannerText() {
    const banner = window.document.getElementById('js-error-banner');
    if (!banner || banner.hidden) return '';
    return banner.textContent ?? '';
  }

  /**
   * Sammelt alles, was seit dem letzten Aufruf schiefging, und räumt die
   * Sammler ab -- so lässt sich jeder Schritt einzeln zuordnen.
   */
  function drainErrors() {
    const gesammelt = [...consoleErrors];
    consoleErrors.length = 0;

    const banner = bannerText();
    if (banner) {
      gesammelt.push(banner);
      const element = window.document.getElementById('js-error-banner');
      element.hidden = true;
      element.textContent = '';
    }
    return gesammelt;
  }

  /**
   * Ruft einen gemerkten Callback der Preload-Attrappe auf.
   *
   * Der `try`/`catch` bildet nach, was in Electron geschieht: Wirft ein
   * Renderschritt, fängt das der `window.onerror`-Handler des Fensters ab
   * und schreibt ihn ins Fehlerbanner -- die App stirbt nicht. Hier
   * käme der Fehler sonst im Test heraus und risse alle folgenden
   * Schritte mit, statt sie einzeln zuzuordnen.
   */
  function emit(channel, ...args) {
    const callback = callbacks.get(channel);
    if (!callback) throw new Error(`Renderer hat "${channel}" nie abonniert`);
    try {
      callback(...args);
    } catch (error) {
      consoleErrors.push(`${channel}: ${error && error.stack ? error.stack : String(error)}`);
    }
  }

  /**
   * Schließt das Fenster. Mehrfach aufrufbar, damit ein Test seinen
   * gewohnten `r.close()` behalten kann, obwohl `t.after` denselben
   * Aufruf noch einmal macht.
   */
  let geschlossen = false;
  function close() {
    if (geschlossen) return;
    geschlossen = true;
    window.close();
  }

  /*
   * Ein offenes jsdom-Fenster hält den Node-Prozess am Leben: Die Anzeige
   * startet in `main()` ein `setInterval` für den Anstoß-Countdown. Wirft
   * eine Zusicherung, wird das abschließende `r.close()` nie erreicht --
   * der Testlauf blieb dann stehen, statt rot abzubrechen. Genau darauf
   * verlässt sich aber `npm run dist`.
   */
  if (t && typeof t.after === 'function') t.after(close);

  /**
   * Klickt ein Element und liefert die Brücken-Aufrufe, die dabei
   * herauskamen.
   *
   * Der Mitschnitt wird VOR dem Klick geleert, damit jeder Klick für sich
   * beurteilbar ist -- sonst schleppte man alles mit, was beim Aufbau des
   * Fensters schon gelaufen ist.
   *
   * `element.click()` statt eines von Hand gebauten Ereignisses: Der
   * Renderer hängt seine Handler mit `addEventListener('click', …)` an,
   * und jsdom löst darüber dieselbe Kette aus wie ein echter Klick --
   * einschließlich der Prüfung auf `disabled`, die ein direkt
   * abgeschickter Event umgehen würde.
   *
   * @param {string} id Element-Id
   * @returns {{name: string, args: unknown[]}[]}
   */
  function click(id) {
    const element = window.document.getElementById(id);
    if (!element) throw new Error(`Element "${id}" gibt es nicht`);
    calls.length = 0;
    element.click();
    return [...calls];
  }

  /** Wie `click`, aber über einen Selektor -- für Knöpfe ohne eigene Id. */
  function clickSelector(selector) {
    const element = window.document.querySelector(selector);
    if (!element) throw new Error(`Kein Element für "${selector}"`);
    calls.length = 0;
    element.click();
    return [...calls];
  }

  return {
    window,
    document: window.document,
    emit,
    drainErrors,
    click,
    clickSelector,
    calls,
    /** Textinhalt eines Elements -- Kurzform für die Zusicherungen. */
    text: (id) => window.document.getElementById(id)?.textContent ?? null,
    close,
  };
}

module.exports = { openRenderer };
