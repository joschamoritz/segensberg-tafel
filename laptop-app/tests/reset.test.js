/**
 * „Neues Spiel“ nach einem Vereinswechsel.
 *
 * Bis Fassung 1.6.0 holte `resetMatch()` die Mannschaften aus der
 * Konfiguration vom App-Start zurück. Wer seitdem einen anderen Gegner
 * gewählt hatte, sah danach wieder den alten -- mit dem Kader des neuen,
 * der beim nächsten Speichern unter dem alten Namen landete. Die Trainer
 * fielen dabei ganz weg (Review 2026-10, K1).
 */
const test = require('node:test');
const assert = require('node:assert');
const { stubElectron, load, player } = require('./helpers');

stubElectron();
const { MatchStateStore } = load('main/state');

function storeMitStartgegner() {
  return new MatchStateStore({
    home: { name: 'SV Hochlar 28', shortName: 'SVH', logoDataUrl: 'data:heim' },
    away: { name: 'Startgegner', shortName: 'STA', logoDataUrl: 'data:alt', logoVariant: 'white' },
  });
}

test('„Neues Spiel“ behält den zuletzt gewählten Gegner samt Logo, Kader und Trainer', () => {
  const store = storeMitStartgegner();
  store.setCoach('home', 'Trainer Heim');
  store.applyLibraryTeam('away', 'Neuer Gegner', 'data:neu', [player({ id: 'g1' })], 'Trainer Gast', 'color');

  store.resetMatch();
  const s = store.getState();

  assert.equal(s.away.name, 'Neuer Gegner');
  assert.equal(s.away.logoDataUrl, 'data:neu');
  assert.equal(s.away.logoVariant, 'color');
  assert.equal(s.away.coach, 'Trainer Gast');
  assert.deepEqual(s.squads.away.map((p) => p.id), ['g1']);
  assert.equal(s.home.coach, 'Trainer Heim');
});

test('„Neues Spiel“ behält einen von Hand geänderten Vereinsnamen', () => {
  const store = storeMitStartgegner();
  store.setTeamName('home', 'SV Hochlar 28 II');
  store.resetMatch();
  assert.equal(store.getState().home.name, 'SV Hochlar 28 II');
});

test('„Neues Spiel“ setzt den Spielstand trotzdem auf 0:0', () => {
  const store = storeMitStartgegner();
  store.incrementScore('home', 1);
  store.incrementScore('away', 1);
  store.incrementScore('away', 1);
  store.resetMatch();
  assert.equal(store.getState().home.score, 0);
  assert.equal(store.getState().away.score, 0);
  assert.equal(store.getState().events.length, 0);
});
