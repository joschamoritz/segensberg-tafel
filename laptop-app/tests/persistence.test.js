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

// --------------------------------------------------------------------
// Was aus dem Zustand nach teams.json wandert (Review 2026-10, T4)
// --------------------------------------------------------------------

const { MatchStateStore } = load('main/state');
const { teamsConfigFromState } = load('main/persistence');

test('teams.json: Stammdaten und Geräteeinstellungen überstehen den Neustart', () => {
  aufräumen();
  const store = new MatchStateStore();
  store.applyLibraryTeam('away', 'FC Gegner', 'data:image/png;base64,AA', [], 'Trainer', 'color');
  store.setTeamRetroName('away', 'GEGNER');
  store.setHalfDuration(35);
  store.setBoardSize({ width: 384, height: 224 });
  store.setCompetition('03_Pokal.jpg');
  store.setAppearance({ theme: 'retro', effects: store.getState().appearance.effects, retroColor: 'weiss' });

  saveTeamsConfig(teamsConfigFromState(store.getState(), 'D:\Logos'));
  const geladen = loadTeamsConfig();

  const neu = new MatchStateStore(geladen);
  assert.equal(neu.getState().away.name, 'FC Gegner');
  assert.equal(neu.getState().away.logoDataUrl, 'data:image/png;base64,AA');
  assert.equal(neu.getState().away.logoVariant, 'color');
  assert.equal(neu.getState().away.retroName, 'GEGNER');
  assert.equal(geladen.logoLibraryPath, 'D:\Logos');
  assert.equal(geladen.halfDurationMin, 35);
  assert.deepEqual(geladen.board, { width: 384, height: 224 });
  assert.equal(geladen.competition, '03_Pokal.jpg');
  assert.equal(geladen.appearance.theme, 'retro');
});

test('teams.json: jedes Feld einer Mannschaft ist bewusst gespeichert oder bewusst ausgenommen', () => {
  // Ein neues Feld an TeamState muss hier eine Entscheidung bekommen --
  // sonst ginge es beim nächsten Start still verloren.
  const AUSGENOMMEN = {
    score: 'gehört zum Spiel, steht in live-match.json',
    coach: 'gehört zum Kader, steht in squads.json',
  };
  const store = new MatchStateStore();
  store.applyLibraryTeam('home', 'SV Test', 'data:x', [], '', 'white');
  store.setTeamRetroName('home', 'TEST');
  const zustand = Object.keys(store.getState().home).sort();
  const gespeichert = Object.keys(teamsConfigFromState(store.getState(), '').home);
  const erwartet = zustand.filter((k) => !(k in AUSGENOMMEN)).sort();
  assert.deepEqual(gespeichert.sort(), erwartet);
});
