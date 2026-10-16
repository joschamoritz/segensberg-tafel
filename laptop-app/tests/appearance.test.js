/**
 * Gestaltung der Anzeige: Design-Auswahl und Effektschalter.
 *
 * Das klassische Design bleibt neben dem neuen Flutlicht-Design erhalten,
 * umgeschaltet wird in der Einrichtung. Die Effekte des Flutlicht-Designs
 * (Verlauf, Lichtstrahlen, Leuchten, Schatten) lassen sich einzeln
 * abschalten, weil erst der Test an der echten LED-Wand zeigt, welche
 * davon dort tragen. Ein Schalter, der nichts bewirkt, fiele genau dann
 * auf, wenn es niemand gebrauchen kann -- vor Ort mit der Tafel.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load } = require('./helpers');
const { openRenderer } = require('./dom');

stubElectron();
const { MatchStateStore } = load('main/state');
const { sanitizeAppearance } = load('main/validate');
const { DEFAULT_APPEARANCE, FLUTLICHT_EFFECT_KEYS } = load('shared/types');

const ALLE_AN = { verlauf: true, strahlen: true, leuchten: true, schatten: true };

// --------------------------------------------------------------------
// Prüfschicht
// --------------------------------------------------------------------

test('eine gültige Gestaltung geht unverändert durch', () => {
  const wert = {
    theme: 'flutlicht',
    effects: { verlauf: false, strahlen: true, leuchten: false, schatten: true },
    retroColor: 'weiss',
  };
  assert.deepEqual(sanitizeAppearance(wert), wert);
});

test('ein unbekanntes Design fällt auf Klassisch zurück', () => {
  // Etwa ein Tippfehler in einer von Hand bearbeiteten teams.json, oder
  // eine spätere Fassung mit einem Design, das diese noch nicht kennt.
  assert.equal(sanitizeAppearance({ theme: 'disco', effects: ALLE_AN }).theme, 'klassisch');
  assert.equal(sanitizeAppearance({ theme: 42 }).theme, 'klassisch');
});

test('eine ältere teams.json ohne Gestaltung ergibt die Vorgabe', () => {
  for (const kaputt of [undefined, null, {}, 'flutlicht', []]) {
    assert.deepEqual(sanitizeAppearance(kaputt), DEFAULT_APPEARANCE, JSON.stringify(kaputt));
  }
});

test('ein unbrauchbarer Effektschalter wird "an", die übrigen bleiben', () => {
  // Ein einzelner kaputter Wert darf nicht still die anderen Effekte
  // mitnehmen -- und "an" ist der Stand, mit dem das Design gedacht ist.
  const ergebnis = sanitizeAppearance({
    theme: 'flutlicht',
    effects: { verlauf: 'nein', strahlen: false, leuchten: 0 },
  });
  assert.deepEqual(ergebnis.effects, {
    verlauf: true,
    strahlen: false,
    leuchten: true,
    schatten: true,
  });
});

test('das Standarddesign ist Klassisch', () => {
  // Ein Update soll die Tafel nicht ungefragt umgestalten.
  assert.equal(DEFAULT_APPEARANCE.theme, 'klassisch');
  assert.equal(new MatchStateStore().getState().appearance.theme, 'klassisch');
});

// --------------------------------------------------------------------
// Store
// --------------------------------------------------------------------

test('die Gestaltung übersteht "Neues Spiel"', () => {
  // Sie gehört zum Gerät, nicht zur Begegnung -- wie die Tafelmaße.
  const store = new MatchStateStore();
  store.setAppearance({ theme: 'flutlicht', effects: { ...ALLE_AN, strahlen: false }, retroColor: 'bernstein' });
  store.incrementScore('home', 1);

  store.resetMatch();

  assert.equal(store.getState().appearance.theme, 'flutlicht');
  assert.equal(store.getState().appearance.effects.strahlen, false);
  assert.equal(store.getState().home.score, 0);
});

test('eine unveränderte Gestaltung löst kein Zustands-Update aus', () => {
  const store = new MatchStateStore();
  let updates = 0;
  store.onChange(() => updates++);

  store.setAppearance({ theme: 'klassisch', effects: { ...ALLE_AN }, retroColor: 'bernstein' });
  assert.equal(updates, 0, 'gleicher Wert hätte nichts auslösen dürfen');

  store.setAppearance({ theme: 'flutlicht', effects: { ...ALLE_AN }, retroColor: 'bernstein' });
  assert.equal(updates, 1);
});

test('der Store hält eine eigene Kopie der Effekte', () => {
  // Sonst änderte ein Aufrufer, der sein Objekt weiterverwendet, den
  // Zustand an der Änderungsmeldung vorbei.
  const store = new MatchStateStore();
  const effects = { ...ALLE_AN };
  store.setAppearance({ theme: 'flutlicht', effects, retroColor: 'bernstein' });
  effects.verlauf = false;
  assert.equal(store.getState().appearance.effects.verlauf, true);
});

// --------------------------------------------------------------------
// Anzeige
// --------------------------------------------------------------------

test('display: Design und Effekte landen am body', (t) => {
  const r = openRenderer('display', t);
  const store = new MatchStateStore();
  const body = r.document.body;

  assert.equal(body.dataset.theme, 'klassisch', 'vor dem ersten Zustand gilt Klassisch');

  r.emit('onStateUpdated', store.getState());
  assert.equal(body.dataset.theme, 'klassisch');

  store.setAppearance({
    theme: 'flutlicht',
    effects: { verlauf: true, strahlen: false, leuchten: true, schatten: false },
    retroColor: 'weiss',
  });
  r.emit('onStateUpdated', store.getState());
  assert.equal(body.dataset.theme, 'flutlicht');
  assert.equal(body.dataset.retroColor, 'weiss', 'die Leuchtfarbe kommt mit');
  assert.equal(body.dataset.fx, 'verlauf leuchten', 'nur die eingeschalteten Effekte');

  store.setAppearance({ theme: 'klassisch', effects: { ...ALLE_AN }, retroColor: 'bernstein' });
  r.emit('onStateUpdated', store.getState());
  assert.equal(body.dataset.theme, 'klassisch', 'und wieder zurück');

  assert.deepEqual(r.drainErrors(), []);
});

test('display: neben der Uhr steht die laufende Halbzeit', (t) => {
  const r = openRenderer('display', t);
  const store = new MatchStateStore();
  store.kickoff();
  store.stopClock();
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.text('clock-half'), '1. HZ');

  store.goToHalfTime();
  store.startSecondHalf();
  store.stopClock();
  r.emit('onStateUpdated', store.getState());
  assert.equal(r.text('clock-half'), '2. HZ');
  assert.deepEqual(r.drainErrors(), []);
});

test('jeder Effektschalter hat eine Regel im Stylesheet', () => {
  // Der Renderer setzt `data-fx` nur -- wirken muss es im CSS. Ein
  // umbenannter Schlüssel ließe den Schalter im Steuerungsfenster stehen,
  // ohne dass er noch etwas tut.
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'display', 'display.css'),
    'utf8'
  );
  for (const key of FLUTLICHT_EFFECT_KEYS) {
    assert.ok(
      css.includes(`[data-fx~='${key}']`),
      `keine Regel für den Effekt "${key}" in display.css`
    );
  }
});

// --------------------------------------------------------------------
// Steuerungsfenster
// --------------------------------------------------------------------

function steuerungMit(store, t) {
  const r = openRenderer('control', t);
  r.emit('onStateUpdated', store.getState());
  r.drainErrors();
  return r;
}

test('control: die Design-Auswahl schickt Design und alle Effekte', (t) => {
  const store = new MatchStateStore();
  store.setAppearance({ theme: 'klassisch', effects: { ...ALLE_AN, schatten: false }, retroColor: 'bernstein' });
  const r = steuerungMit(store, t);

  const select = r.document.getElementById('theme-select');
  assert.equal(select.value, 'klassisch');

  r.calls.length = 0;
  select.value = 'flutlicht';
  select.dispatchEvent(new r.window.Event('change'));

  const aufrufe = r.calls.filter((c) => c.name === 'setAppearance');
  assert.equal(aufrufe.length, 1);
  // JSON statt deepStrictEqual: Das Objekt stammt aus dem jsdom-Realm.
  assert.equal(
    JSON.stringify(aufrufe[0].args[0]),
    JSON.stringify({
      theme: 'flutlicht',
      effects: { verlauf: true, strahlen: true, leuchten: true, schatten: false },
      retroColor: 'bernstein',
    }),
    'der abgeschaltete Schatten muss abgeschaltet mitgehen'
  );
  assert.deepEqual(r.drainErrors(), []);
});

test('control: ein Effektschalter schickt seinen neuen Stand', (t) => {
  const store = new MatchStateStore();
  store.setAppearance({ theme: 'flutlicht', effects: { ...ALLE_AN }, retroColor: 'bernstein' });
  const r = steuerungMit(store, t);

  const aufrufe = r.click('fx-strahlen').filter((c) => c.name === 'setAppearance');
  assert.equal(aufrufe.length, 1);
  const gesendet = JSON.parse(JSON.stringify(aufrufe[0].args[0]));
  assert.equal(gesendet.theme, 'flutlicht');
  assert.equal(gesendet.effects.strahlen, false);
  assert.equal(gesendet.effects.verlauf, true);
  assert.deepEqual(r.drainErrors(), []);
});

test('control: im klassischen Design sind die Effektschalter gesperrt', (t) => {
  // Dort wirken sie nicht. Ein Schalter, der klickbar ist und nichts
  // tut, wäre vor Ort ein Rätsel.
  const store = new MatchStateStore();
  const r = steuerungMit(store, t);
  const switches = r.document.getElementById('fx-switches');

  assert.equal(switches.disabled, true);
  assert.deepEqual(
    r.click('fx-verlauf').filter((c) => c.name === 'setAppearance'),
    [],
    'gesperrter Schalter muss folgenlos bleiben'
  );

  store.setAppearance({ theme: 'flutlicht', effects: { ...ALLE_AN }, retroColor: 'bernstein' });
  r.emit('onStateUpdated', store.getState());
  assert.equal(switches.disabled, false);
  assert.equal(r.document.getElementById('fx-verlauf').checked, true);
  assert.deepEqual(r.drainErrors(), []);
});
