// Maakt een DMG van de gebouwde app (alleen op macOS, gebruikt appdmg)
const path = require('path');
const fs = require('fs');
const appdmg = require('appdmg');
const version = require('../package.json').version;
const app = path.resolve('dist/Browsy-darwin-arm64/Browsy.app');
const target = path.resolve('dist/Browsy-' + version + '-arm64.dmg');
if (!fs.existsSync(app)) { console.error('Eerst bouwen: npm run pack'); process.exit(1); }
if (fs.existsSync(target)) fs.unlinkSync(target);
const ee = appdmg({
  target,
  basepath: path.resolve('.'),
  specification: {
    title: 'Browsy',
    icon: 'build/icon.icns',
    background: 'build/dmg-bg.png',
    'icon-size': 112,
    window: { size: { width: 660, height: 400 } },
    format: 'UDZO',
    contents: [
      { x: 180, y: 190, type: 'file', path: app },
      { x: 480, y: 190, type: 'link', path: '/Applications' }
    ]
  }
});
ee.on('finish', () => console.log('DMG klaar:', target));
ee.on('error', e => { console.error(e); process.exit(1); });
