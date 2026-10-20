/**
 * Jeder IPC-Handler nimmt seine Argumente als `unknown` entgegen.
 *
 * Die Prüfschicht (`validate.ts`) ist nur so gut wie ihre Lücken. Bis
 * Fassung 1.6.0 nahmen rund ein Dutzend Handler `team: TeamId` oder
 * `playerId: string` ungeprüft an. Vom eigenen Fenster aus harmlos -- über
 * die Fernsteuerung aber kann jedes Gerät mit PIN beliebige Werte
 * schicken, und ein `team: 'x'` warf im Handler oder landete als
 * Aufstellungs-Anfrage einer Mannschaft, die es nicht gibt (Review
 * 2026-10, N1).
 *
 * TypeScript hilft hier nicht: Die Handler-Typen erlauben `any`. Mit
 * `unknown` dagegen erzwingt der Compiler die Prüfung, bevor ein Wert
 * benutzt wird. Dieser Test sorgt dafür, dass es dabei bleibt.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Alle Dateien des Hauptprozesses: Die Handler stehen in ipcHandlers.ts,
// ein neuer an anderer Stelle soll aber genauso geprüft werden.
const MAIN_DIR = path.join(__dirname, '..', 'src', 'main');
const MAIN = fs
  .readdirSync(MAIN_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => fs.readFileSync(path.join(MAIN_DIR, f), 'utf-8'))
  .join('\n');

test('alle Handler nehmen ihre Argumente als unknown entgegen (Review N1)', () => {
  const handler = [...MAIN.matchAll(/(?:onIpc|handleIpc)\(\s*IPC\.(\w+),\s*(?:async\s*)?\(([^)]*)\)/g)];
  assert.ok(handler.length > 60, `zu wenige Handler gefunden (${handler.length}) -- Muster prüfen`);

  const ungeprüft = [];
  for (const [, kanal, parameter] of handler) {
    const liste = parameter.split(',').map((p) => p.trim()).filter(Boolean);
    for (const p of liste.slice(1)) {
      if (!/:\s*unknown$/.test(p)) ungeprüft.push(`${kanal}: ${p}`);
    }
  }
  assert.deepEqual(ungeprüft, []);
});
