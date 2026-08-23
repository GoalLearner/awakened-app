// W877 — process the v3 wave-1 boss portrait drop (Starved Sentinel, Worldspine,
// Cloven Titan, Gray Pilgrim). Same recipe as W286 (process-sovereign-art.js):
// framed full-bleed paintings on dark backgrounds, NO background removal — just
// resize to the house box (≤1254px) + PNG-compress. Originals arrived as .jfif
// (JPEG) from the owner's Downloads; sharp transcodes to PNG in the same pass.
// Heavy originals are archived to gitignored art-originals/.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC_DIR = 'C:/Users/richm/Downloads';
const ids = [
  'the-starved-sentinel',
  'the-worldspine',
  'the-cloven-titan',
  'the-gray-pilgrim',
];

fs.mkdirSync('art-originals', { recursive: true });

(async () => {
  for (const id of ids) {
    const src = path.join(SRC_DIR, id + '.jfif');
    const dst = 'assets/bosses/' + id + '.png';
    if (!fs.existsSync(src)) { console.log('MISSING', src); continue; }
    const before = Math.round(fs.statSync(src).size / 1024);
    await sharp(fs.readFileSync(src))
      .resize({ width: 1254, height: 1254, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(dst);
    const m = await sharp(dst).metadata();
    const after = Math.round(fs.statSync(dst).size / 1024);
    console.log('OK', dst, m.width + 'x' + m.height, before + 'KB -> ' + after + 'KB');
    fs.renameSync(src, path.join('art-originals', id + '.jfif'));
  }
  console.log('done');
})();
