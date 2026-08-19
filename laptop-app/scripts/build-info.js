// Schreibt Version und Baudatum in dist/build-info.json, damit die App
// beides zur Laufzeit anzeigen kann.
//
// Warum das Datum dazugehört: Die Nummer allein beantwortet am Spieltag
// nicht die Frage, die tatsächlich gestellt wird -- "ist das der Stand
// von letzter Woche?". Das weiß nur der Bauvorgang.
//
// Warum eine erzeugte Datei und kein esbuild-define: main.ts wird nicht
// gebündelt (siehe bundle-renderer.js), läuft also im normalen
// Node-Kontext und kann die Datei schlicht lesen.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { version } = require(path.join(ROOT, 'package.json'));

const target = path.join(ROOT, 'dist', 'build-info.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(
  target,
  JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2),
  'utf-8'
);

console.log(`build-info.json geschrieben: ${version}`);
