'use strict';
// Builds dist/ParakeetAI-win32-x64/ParakeetAI.exe (+ a .zip of that folder).
// Usage (repo root):  npm run dist:win
// The .env in the repo root is bundled next to the app (asar off, main.js reads
// ../.env), so the zip carries your keys: share it privately.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

(async () => {
  if (!fs.existsSync(path.join(ROOT, '.env'))) throw new Error('falta .env en la raíz del repo');
  const { packager } = await import('@electron/packager'); // ESM-only package
  const [out] = await packager({
    dir: ROOT,
    name: 'ParakeetAI',
    executableName: 'ParakeetAI',
    platform: 'win32',
    arch: 'x64',
    out: path.join(ROOT, 'dist'),
    overwrite: true,
    asar: false,
    prune: true,
    win32metadata: { ProductName: 'ParakeetAI', FileDescription: 'ParakeetAI', CompanyName: 'ParakeetAI' },
    ignore: [
      // No runtime dependencies: everything in node_modules is dev-only.
      /^\/(dist|mac|win|test|transcripciones|node_modules)($|\/)/,
      /^\/\.git($|\/)/,
      /\.(md|log|cmd|code-workspace)$/,
      /^\/\.(env\.example|gitignore)$/,
    ],
  });
  console.log('app:', out);

  const zip = out + '.zip';
  fs.rmSync(zip, { force: true });
  execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${out}' -DestinationPath '${zip}'`], { stdio: 'inherit' });
  console.log('zip:', zip, Math.round(fs.statSync(zip).size / 1048576) + ' MB');
})().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
