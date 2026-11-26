'use strict';
// Builds ParakeetAI.app on a Mac. Run by "Instalar ParakeetAI.command" (on the
// user's Mac) and by .github/workflows/mac-dmg.yml (the downloadable .dmg).
(async () => {
  const { packager } = await import('@electron/packager'); // ESM-only package
  // TARGET_ARCH lets CI build the Intel app on an Apple Silicon runner.
  const want = process.env.TARGET_ARCH || process.arch;
  const arch = want === 'arm64' ? 'arm64' : 'x64';
  const paths = await packager({
    dir: __dirname,
    name: 'ParakeetAI',
    platform: 'darwin',
    arch,
    out: 'build',
    overwrite: true,
    asar: false,           // main.js reads ../.env from disk
    prune: true,
    appBundleId: 'local.parakeetai.mvp',
    ignore: [/^\/build($|\/)/, /\.command$/, /^\/LEEME/, /^\/\.node($|\/)/],
    extendInfo: {
      // Required by Electron 39+ for CoreAudio-tap system audio on macOS 14.2+.
      NSAudioCaptureUsageDescription: 'ParakeetAI escucha el audio del sistema para transcribir al entrevistador.',
      NSMicrophoneUsageDescription: 'ParakeetAI usa el micrófono para transcribir tu voz.',
      NSScreenCaptureUsageDescription: 'ParakeetAI necesita este permiso para acceder al audio del sistema.',
      // Packaged builds save sessions to ~/Documents/ParakeetAI/transcripciones.
      NSDocumentsFolderUsageDescription: 'ParakeetAI guarda las transcripciones en Documentos/ParakeetAI.',
    },
  });
  console.log(require('path').resolve(paths[0]));
})().catch((e) => { console.error(e); process.exit(1); });
