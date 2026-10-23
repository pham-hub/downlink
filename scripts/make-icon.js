// Renders build/icon.svg onto Apple's macOS icon grid (824px rounded square with a soft shadow
// on a 1024px canvas) and writes build/icon.png and build/icon.icns.
//
//   npm run icon
//
// build/icon.svg is the PNR topographic tile (contours at 30% of the brand strength) with the
// arrow-into-tray glyph in the blue -> teal -> sea foam gradient.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BUILD = path.join(__dirname, '..', 'build');
const ICONSET_NAMES = {
  16: ['16x16'], 32: ['16x16@2x', '32x32'], 64: ['32x32@2x'], 128: ['128x128'],
  256: ['128x128@2x', '256x256'], 512: ['256x256@2x', '512x512'], 1024: ['512x512@2x'],
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const svg = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(BUILD, 'icon.svg')).toString('base64');
  const pngs = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(svg)}; await img.decode();
    const out = {};
    for (const size of ${JSON.stringify(Object.keys(ICONSET_NAMES).map(Number))}) {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d'); const k = size / 1024;
      const x = 100 * k, w = 824 * k, r = 185.4 * k;
      g.save(); g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 20 * k; g.shadowOffsetY = 10 * k;
      g.beginPath(); g.roundRect(x, x, w, w, r); g.fillStyle = '#04080C'; g.fill(); g.restore();
      g.save(); g.beginPath(); g.roundRect(x, x, w, w, r); g.clip();
      g.imageSmoothingQuality = 'high'; g.drawImage(img, x, x, w, w); g.restore();
      g.beginPath(); g.roundRect(x + 0.5 * k, x + 0.5 * k, w - k, w - k, r);
      g.strokeStyle = 'rgba(220,236,240,0.14)'; g.lineWidth = Math.max(1, 2 * k); g.stroke();
      out[size] = c.toDataURL('image/png').split(',')[1];
    }
    return out;
  })()`);

  const iconset = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icon-')), 'icon.iconset');
  fs.mkdirSync(iconset);
  for (const [size, names] of Object.entries(ICONSET_NAMES)) {
    for (const name of names) fs.writeFileSync(path.join(iconset, `icon_${name}.png`), Buffer.from(pngs[size], 'base64'));
  }
  fs.writeFileSync(path.join(BUILD, 'icon.png'), Buffer.from(pngs[1024], 'base64'));
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD, 'icon.icns')]);
  fs.rmSync(path.dirname(iconset), { recursive: true, force: true });
  console.log('Wrote build/icon.png and build/icon.icns');
  app.exit(0);
});
