// W286 — process the Erebus / Sovereign's Regalia art drop.
// These are full framed paintings on dark backgrounds (NOT cutouts — the app's
// boss/item art has no alpha, hasAlpha=false), so NO background removal. We just
// resize to the house box (≤1254px, matching every existing boss/item) and
// PNG-compress to app-appropriate weight, then archive the heavy originals.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const jobs = [
  ['erebus-the-shadow-sovereign.png',     'assets/bosses/erebus-the-shadow-sovereign.png'],
  ['nightfall-blade-of-the-sovereign.png', 'assets/items/nightfall-blade-of-the-sovereign.png'],
  ['crown-of-eternal-night.png',           'assets/items/crown-of-eternal-night.png'],
  ['mantle-of-the-shadow-sovereign.png',   'assets/items/mantle-of-the-shadow-sovereign.png'],
  ['greaves-of-the-umbral-throne.png',     'assets/items/greaves-of-the-umbral-throne.png'],
];

fs.mkdirSync('art-originals', { recursive: true });

(async () => {
  for (const [src, dst] of jobs) {
    if (!fs.existsSync(src)) { console.log('MISSING', src); continue; }
    const before = Math.round(fs.statSync(src).size / 1024);
    await sharp(fs.readFileSync(src))
      .resize({ width: 1254, height: 1254, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(dst);
    const m = await sharp(dst).metadata();
    const after = Math.round(fs.statSync(dst).size / 1024);
    console.log('OK', dst, m.width + 'x' + m.height, before + 'KB -> ' + after + 'KB');
    fs.renameSync(src, path.join('art-originals', path.basename(src)));
  }
  console.log('done');
})();
