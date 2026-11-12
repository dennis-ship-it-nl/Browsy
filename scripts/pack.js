// Bouwt "Browsy.app" voor Apple Silicon (arm64) in de map dist/
const { packager } = require('@electron/packager');
const { execFileSync } = require('child_process');
const path = require('path');
(async () => {
  const out = await packager({
    dir: '.',
    name: 'Browsy',
    platform: 'darwin',
    arch: 'arm64',
    out: 'dist',
    overwrite: true,
    appBundleId: 'nl.daarom.browsy',
    icon: 'build/icon',
    appCopyright: 'daar-om.nl',
    protocols: [{ name: 'Webadres', schemes: ['http', 'https'] }],
    extendInfo: {
      NSCameraUsageDescription: 'Voor videobellen in websites zoals Google Meet.',
      NSMicrophoneUsageDescription: 'Voor bellen in websites zoals Google Meet.'
    },
    ignore: [/^\/dist/, /^\/build\/dmg/, /^\/\.github/, /^\/scripts/, /^\/\.git/, /\.md$/, /\.command$/]
  });
  console.log('Gebouwd:', out.join(', '));
  // Op een Mac tekenen we de app "ad hoc". Zonder handtekening weigert Apple Silicon de app te starten.
  if (process.platform === 'darwin') {
    const app = path.join(out[0], 'Browsy.app');
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
    console.log('App ondertekend (ad hoc) en gecontroleerd.');
  }
})().catch(e => { console.error(e); process.exit(1); });
