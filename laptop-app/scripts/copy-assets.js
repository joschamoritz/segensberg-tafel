// Kopiert statische Renderer-Assets (HTML/CSS), die tsc nicht anfasst,
// von src/renderer nach dist/renderer -- neben die kompilierten .js-Dateien.
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src', 'renderer');
const DIST_DIR = path.join(__dirname, '..', 'dist', 'renderer');
// .txt: die Lizenz der Schriften (OFL.txt) muss mit ausgeliefert werden.
const EXTENSIONS = ['.html', '.css', '.woff2', '.jpg', '.png', '.svg', '.txt'];

function copyRecursive(srcDir, distDir) {
  fs.mkdirSync(distDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const distPath = path.join(distDir, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, distPath);
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      fs.copyFileSync(srcPath, distPath);
    }
  }
}

copyRecursive(SRC_DIR, DIST_DIR);
console.log('Assets kopiert: src/renderer -> dist/renderer');
