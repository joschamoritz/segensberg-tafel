/**
 * Konfigurationsdateien im userData-Ordner: Hin- und Rückweg, Altformat
 * und vor allem der Umgang mit einer beschädigten Datei.
 *
 * Bis Fassung 1.6.0 startete ein Speicher bei einer unlesbaren Datei leer,
 * und der nächste Schreibvorgang überschrieb sie. Bei `squads.json` waren
 * damit alle Kader endgültig weg (Review 2026-10, W3).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stubElectron, load, player } = require('./helpers');

const userData = stubElectron();
const { SquadStore } = load('main/squads');
const { loadTeamsConfig, saveTeamsConfig } = load('main/persistence');
const { loadContentConfig, saveContentConfig } = load('main/content');
const { configWarnings } = load('main/configFile');

function datei(name) {
  return path.join(userData, name);
}

function aufräumen() {
  for (const name of fs.readdirSync(userData)) fs.rmSync(datei(name), { force: true });
}

function defekte(prefix) {
  return fs.readdirSync(userData).filter((n) => n.startsWith(`${prefix}.defekt-`));
}

test('Kader: Hin- und Rückweg je Verein', () => {
  aufräumen();
  const store = new SquadStore();
  store.set('SV Test', { players: [player({ id: 'a' })], coach: 'Trainer' });
  const wieder = new SquadStore().get('SV Test');
  assert.deepEqual(wieder.players.map((p) => p.id), ['a']);
  assert.equal(wieder.coach, 'Trainer');
});

test('Kader: Altformat (reine Spielerliste) bleibt lesbar', () => {
  aufräumen();
  fs.writeFileSync(datei('squads.json'), JSON.stringify({ 'SV Alt': [{ id: 'x', lastName: 'Alt' }] }));
  const kader = new SquadStore().get('SV Alt');
  assert.equal(kader.players[0].lastName, 'Alt');
  assert.equal(kader.players[0].role, 'out');
  assert.equal(kader.coach, '');
});

test('beschädigte squads.json wird beiseitegelegt, nicht überschrieben', () => {
  aufräumen();
  const kaputt = '{"SV Test": {"players": [ abgeschnitten';
  fs.writeFileSync(datei('squads.json'), kaputt);

  const store = new SquadStore();
  assert.deepEqual(store.listNames(), []);

  // Das nächste Speichern darf den alten Inhalt nicht vernichten.
  store.set('SV Neu', { players: [], coach: '' });
  const gesichert = defekte('squads');
  assert.equal(gesichert.length, 1);
  assert.equal(fs.readFileSync(datei(gesichert[0]), 'utf-8'), kaputt);
  assert.ok(configWarnings().some((w) => w.includes('squads.json')));
});

test('Mannschaften: Hin- und Rückweg, beschädigte Datei fällt auf die Vorgaben', () => {
  aufräumen();
  saveTeamsConfig({
    home: { name: 'SV Hochlar 28', shortName: 'SVH' },
    away: { name: 'Gegner', shortName: 'GEG', retroName: 'GEGNER' },
    halfDurationMin: 35,
    competition: '01_Kreisliga.png',
  });
  const geladen = loadTeamsConfig();
  assert.equal(geladen.away.name, 'Gegner');
  assert.equal(geladen.away.retroName, 'GEGNER');
  assert.equal(geladen.halfDurationMin, 35);
  assert.equal(geladen.competition, '01_Kreisliga.png');

  fs.writeFileSync(datei('teams.json'), 'kein json');
  const vorgabe = loadTeamsConfig();
  assert.equal(vorgabe.home.name, 'SV Hochlar 28');
  assert.equal(vorgabe.away.name, 'Gast');
  assert.equal(defekte('teams').length, 1);
});

test('Texte: Hin- und Rückweg, fremde Werte werden nicht übernommen', () => {
  aufräumen();
  saveContentConfig({ attendanceMessage: 'Danke {n}!', announcements: ['So 25.08.'], sound: { volume: 40, muted: true } });
  assert.deepEqual(loadContentConfig(), {
    attendanceMessage: 'Danke {n}!',
    announcements: ['So 25.08.'],
    sound: { volume: 40, muted: true },
  });

  fs.writeFileSync(datei('content.json'), JSON.stringify({ announcements: ['ok', 7, { a: 1 }], sound: { volume: 900 } }));
  const geprüft = loadContentConfig();
  assert.deepEqual(geprüft.announcements, ['ok']);
  assert.equal(geprüft.sound.volume, 100);
});

test('fehlende Datei ist der Normalfall: keine Warnung, nichts beiseitegelegt', () => {
  aufräumen();
  const vorher = configWarnings().length;
  new SquadStore();
  loadTeamsConfig();
  loadContentConfig();
  assert.equal(configWarnings().length, vorher);
  assert.deepEqual(fs.readdirSync(userData), []);
});
