// Preload- und Renderer-Skripte dürfen keine cross-file require()/import
// Aufrufe im kompilierten Output enthalten:
// - preload.js läuft im (standardmäßig sandboxed) Electron-Preload-Kontext,
//   der require() auf lokale Projektdateien nicht auflösen kann
//   ("Error: module not found: ../shared/types")
// - control.js/display.js laufen als normales <script>-Tag im Browser,
//   der das von tsc erzeugte CommonJS-Modul-Boilerplate (exports/require)
//   gar nicht kennt ("Uncaught ReferenceError: exports is not defined")
// esbuild bündelt jeden Einstiegspunkt zu einer einzigen, in sich
// geschlossenen Datei und löst damit beide Probleme.
const esbuild = require('esbuild');
const path = require('path');

const ROOT = path.join(__dirname, '..');

async function build() {
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/main/preload.ts')],
    outfile: path.join(ROOT, 'dist/main/preload.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['electron'],
  });

  for (const name of ['control', 'display']) {
    await esbuild.build({
      entryPoints: [path.join(ROOT, `src/renderer/${name}/${name}.ts`)],
      outfile: path.join(ROOT, `dist/renderer/${name}/${name}.js`),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      // Safari dazu: Das Steuerungsskript läuft auch auf dem iPad (Fernsteuerung).
      target: ['chrome120', 'safari15'],
    });
  }

  // Brücke der Fernsteuerung im WLAN -- wird vom Laptop an das iPad
  // ausgeliefert, siehe main/remoteServer.ts.
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/renderer/remote/remote.ts')],
    outfile: path.join(ROOT, 'dist/renderer/remote/remote.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'safari15',
  });

  console.log('esbuild: preload.js, control.js, display.js, remote.js gebündelt');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
