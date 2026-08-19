/**
 * Gemeinsame Hilfen für die Tests.
 *
 * Getestet wird gegen den kompilierten Stand in `dist/` -- so braucht es
 * keine zusätzliche TypeScript-Toolchain für die Tests, und geprüft wird
 * genau das, was auch ausgeliefert wird. `npm test` baut deshalb vorher.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');

const DIST = path.join(__dirname, '..', 'dist');

/**
 * Ersetzt das `electron`-Modul durch eine Attrappe.
 *
 * Nötig für alles, was unter `main/` liegt: Diese Module laufen sonst nur
 * innerhalb von Electron. Der Store selbst kommt zwar ohne aus, die
 * Spielsicherung braucht aber `app.getPath()`.
 */
function stubElectron() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'anzeigetafel-test-'));

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...args) {
    if (request === 'electron') return 'electron-stub';
    return originalResolve.call(this, request, ...args);
  };

  require.cache['electron-stub'] = {
    id: 'electron-stub',
    filename: 'electron-stub',
    loaded: true,
    exports: { app: { getPath: () => userData } },
  };

  return userData;
}

/** Lädt ein Modul aus `dist/`, z.B. `load('main/state')`. */
function load(modulePath) {
  return require(path.join(DIST, modulePath));
}

const MIN = 60 * 1000;

/** Legt einen Spieler an -- die Pflichtfelder sind für Tests nur Beiwerk. */
function player(overrides = {}) {
  return {
    id: 'p1',
    number: 7,
    firstName: 'Max',
    lastName: 'Muster',
    position: '',
    role: 'start',
    isGoalkeeper: false,
    isCaptain: false,
    ...overrides,
  };
}

module.exports = { stubElectron, load, MIN, player };
