/**
 * Einrichtungsleiste und -flächen des Steuerungsfensters.
 *
 * Die Flächen nehmen auf, was einmal eingerichtet und dann nie wieder
 * angefasst wird (Zielbildschirm, Tafelauflösung, Team-Stammdaten,
 * Kader). Umgeschaltet wird über ein Attribut am <body>; welche Fläche
 * dann sichtbar ist, entscheidet das Stylesheet.
 *
 * Der wichtigste Test dieser Datei ist der letzte: Zeichnen darf NIE an
 * Sichtbarkeit gekoppelt werden. Wer das täte, verbrennte die
 * Revisionssignatur in `hasChanged()`, ohne das DOM zu schreiben -- und
 * Chronik wie Kader blieben danach dauerhaft auf altem Stand. Ein Tor,
 * das fällt, während jemand in den Kader schaut, tauchte nie in der
 * Chronik auf und bekäme nie einen Torschützen.
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');

function angepfiffen() {
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  return store;
}

function fenster(t, store = new MatchStateStore()) {
  const r = openRenderer('control', t);
  r.window.confirm = () => true;
  r.emit('onStateUpdated', store.getState());
  r.drainErrors();
  return r;
}

/** Name der gerade offenen Fläche, oder null. */
function offen(r) {
  return r.document.body.dataset.setup ?? null;
}

test('am Anfang ist keine Einrichtungsfläche offen', (t) => {
  const r = fenster(t);
  assert.strictEqual(offen(r), null, 'die Oberfläche startet im Spielbetrieb, nicht in der Einrichtung');
  r.close();
});

test('jeder Leisteneintrag öffnet seine Fläche', (t) => {
  const r = fenster(t);

  for (const name of ['anzeige', 'teams', 'kader']) {
    r.clickSelector(`.setup-entry[data-setup="${name}"]`);
    assert.strictEqual(offen(r), name, `"${name}" öffnet die falsche Fläche`);
  }

  r.close();
});

test('immer nur eine Fläche gleichzeitig', (t) => {
  // Ein einzelnes Attribut statt dreier Schalter kann das zusichern --
  // drei Boolesche Werte könnten auseinanderlaufen.
  const r = fenster(t);

  r.clickSelector('.setup-entry[data-setup="teams"]');
  r.clickSelector('.setup-entry[data-setup="kader"]');

  assert.strictEqual(offen(r), 'kader');
  r.close();
});

test('ein zweiter Druck auf denselben Eintrag schließt wieder', (t) => {
  const r = fenster(t);

  r.clickSelector('.setup-entry[data-setup="anzeige"]');
  r.clickSelector('.setup-entry[data-setup="anzeige"]');

  assert.strictEqual(offen(r), null);
  r.close();
});

test('Schließen-Knopf, Abdeckung und Escape schließen die Fläche', (t) => {
  const r = fenster(t);

  r.clickSelector('.setup-entry[data-setup="teams"]');
  r.clickSelector('#setup-teams [data-setup-close]');
  assert.strictEqual(offen(r), null, 'der Schließen-Knopf hat nicht gewirkt');

  r.clickSelector('.setup-entry[data-setup="teams"]');
  r.click('setup-scrim');
  assert.strictEqual(offen(r), null, 'der Klick neben die Fläche hat nicht gewirkt');

  r.clickSelector('.setup-entry[data-setup="kader"]');
  r.document.dispatchEvent(
    new r.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  assert.strictEqual(offen(r), null, 'Escape hat nicht gewirkt');

  r.close();
});

test('das Umschalten gibt den Fokus ab', (t) => {
  // Ein Eingabefeld, das mit Fokus verschwindet, bekommt sein `focusout`
  // nicht zugesichert. Es bliebe dann in `editingInputs` hängen und würde
  // nie wieder aus dem Zustand gepflegt -- betroffen wären Anstoßzeit,
  // Tafelauflösung und die Zahlenfelder, bei denen Chromium eigene
  // Auswahl-Elemente öffnet.
  const r = fenster(t);

  const kickoff = r.document.getElementById('kickoff-input');
  kickoff.focus();
  assert.strictEqual(r.document.activeElement, kickoff, 'Vorbedingung: das Feld hat den Fokus');

  r.clickSelector('.setup-entry[data-setup="kader"]');

  assert.notStrictEqual(
    r.document.activeElement,
    kickoff,
    'beim Umschalten muss das Feld den Fokus verlieren'
  );

  r.close();
});

test('die Spielbedienung bleibt außerhalb der Flächen', (t) => {
  // Wäre der Spielstand versehentlich in eine Einrichtungsfläche geraten,
  // wäre er im Spiel nur noch über einen Umweg erreichbar. Das ist der
  // Kern des Umbaus und deshalb eine eigene Zusicherung wert.
  const r = fenster(t);
  const doc = r.document;

  for (const selector of ['.phase-control', 'main.teams', '.goal-log-block']) {
    const element = doc.querySelector(selector);
    assert.ok(element, `"${selector}" gibt es nicht mehr`);
    assert.strictEqual(
      element.closest('.setup-panel'),
      null,
      `"${selector}" darf nicht in einer Einrichtungsfläche liegen`
    );
  }

  // Und umgekehrt: Das Einmalige liegt vollständig darin.
  for (const selector of ['.display-picker', '.team-settings', '.squad-settings']) {
    assert.ok(
      doc.querySelector(selector).closest('.setup-panel'),
      `"${selector}" gehört in eine Einrichtungsfläche`
    );
  }

  r.close();
});

test('die Chronik springt ans Ende, wo das jüngste Ereignis steht', (t) => {
  // Die Liste sortiert chronologisch, das jüngste Ereignis steht also
  // unten -- und genau dem wird gleich ein Torschütze zugeordnet. Seit
  // die Liste einen eigenen Scrollbalken hat, wäre es sonst nach ein
  // paar Ereignissen außer Sicht.
  //
  // jsdom rechnet kein Layout, `scrollHeight` bliebe also 0 und der Test
  // wäre gehaltlos. Deshalb wird die Höhe vorgegeben.
  const store = angepfiffen();
  const r = fenster(t, store);

  const liste = r.document.getElementById('goal-log');
  Object.defineProperty(liste, 'scrollHeight', { value: 500, configurable: true });

  store.incrementScore('home', 1);
  r.emit('onStateUpdated', store.getState());
  assert.deepEqual(r.drainErrors(), []);

  assert.strictEqual(liste.scrollTop, 500, 'die Liste muss ans Ende gescrollt sein');

  r.close();
});

test('bei offener Fläche wird weitergezeichnet', (t) => {
  // Die teuerste Falle des Umbaus: Wer "nicht zeichnen, wenn die Fläche
  // zu ist" baut, verbrennt die Revisionssignatur in hasChanged(), ohne
  // das DOM zu schreiben. Chronik und Kader blieben danach für immer auf
  // altem Stand -- lautlos, ohne Fehler, ohne roten Test.
  const store = angepfiffen();
  const r = fenster(t, store);

  // Kader-Fläche öffnen und dort hineinschauen, wie am Spielfeldrand.
  r.clickSelector('.setup-entry[data-setup="kader"]');
  assert.strictEqual(offen(r), 'kader', 'Vorbedingung: die Fläche ist offen');

  // Währenddessen fällt ein Tor.
  store.incrementScore('home', 1);
  r.emit('onStateUpdated', store.getState());
  assert.deepEqual(r.drainErrors(), []);

  assert.strictEqual(
    r.document.querySelectorAll('#goal-log li').length,
    1,
    'das Tor muss auch bei offener Einrichtungsfläche in der Chronik landen'
  );

  // Und ebenso der Kader, der ja selbst in der offenen Fläche steht.
  store.setSquad('home', [player({ id: 'h1', number: 7, lastName: 'Bergmann' })]);
  r.emit('onStateUpdated', store.getState());
  assert.deepEqual(r.drainErrors(), []);

  // Die Namen stehen in Eingabefeldern -- `textContent` sähe sie nicht.
  const felder = [...r.document.querySelectorAll('#home-squad-list input')].map((i) => i.value);
  assert.ok(
    felder.includes('Bergmann'),
    `der Kader muss sich in der offenen Fläche fortschreiben (gefunden: ${felder.join(', ')})`
  );

  // Nach dem Schließen darf nichts verlorengegangen sein.
  r.clickSelector('#setup-kader [data-setup-close]');
  store.incrementScore('away', 1);
  r.emit('onStateUpdated', store.getState());

  assert.strictEqual(
    r.document.querySelectorAll('#goal-log li').length,
    2,
    'nach dem Schließen muss die Chronik weiterlaufen'
  );

  r.close();
});
