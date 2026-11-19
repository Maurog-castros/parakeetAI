'use strict';
// Builds ParakeetAI.app on the Mac itself (so it is not quarantined and can be
// ad-hoc signed locally). Run by "Instalar ParakeetAI.command".
(async () => {
  const { packager } = await import('@electron/packager'); // ESM-only package
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
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
    },
  });
  console.log(paths[0]);
})().catch((e) => { console.error(e); process.exit(1); });
