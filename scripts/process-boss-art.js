// Reusable per-boss art processor (W287+). Boss/item art are framed full-bleed
// paintings on dark backgrounds (NOT cutouts) — so NO background removal. Boss
// portraits keep their aspect (resized to fit the 1254 house box); item icons
// are resized + padded to a square via edge-copy (seamless on the dark bg).
// Heavy originals archived to gitignored art-originals/.
// Edit the JOBS list per boss, then: node scripts/process-boss-art.js
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const JOBS = [
  { src: 'the-tideless-marcher.png',        dst: 'assets/bosses/the-tideless-marcher.png',        kind: 'boss' },
  { src: 'striders-of-the-tideless-road.png', dst: 'assets/items/striders-of-the-tideless-road.png', kind: 'item' },
  { src: 'mantle-of-the-long-vigil.png',    dst: 'assets/items/mantle-of-the-long-vigil.png',    kind: 'item' },
  { src: 'band-of-the-roadkeeper.png',      dst: 'assets/items/band-of-the-roadkeeper.png',      kind: 'item' },
  { src: 'restplate-of-the-wanderer.png',   dst: 'assets/items/restplate-of-the-wanderer.png',   kind: 'item' },
];

fs.mkdirSync('art-originals', { recursive: true });

(async () => {
  for (const j of JOBS) {
    if (!fs.existsSync(j.src)) { console.log('MISSING', j.src); continue; }
    const before = Math.round(fs.statSync(j.src).size / 1024);
    let pipe = sharp(fs.readFileSync(j.src))
      .resize({ width: 1254, height: 1254, fit: 'inside', withoutEnlargement: true });
    if (j.kind === 'item') {
      const m = await sharp(fs.readFileSync(j.src))
        .resize({ width: 1254, height: 1254, fit: 'inside', withoutEnlargement: true })
        .toBuffer().then(b => sharp(b).metadata());
      const side = Math.max(m.width, m.height);
      const padL = Math.floor((side - m.width) / 2), padT = Math.floor((side - m.height) / 2);
      pipe = pipe.extend({ top: padT, bottom: side - m.height - padT, left: padL, right: side - m.width - padL, extendWith: 'copy' });
    }
    await pipe.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(j.dst);
    const out = await sharp(j.dst).metadata();
    const after = Math.round(fs.statSync(j.dst).size / 1024);
    console.log('OK', j.dst, out.width + 'x' + out.height, before + 'KB -> ' + after + 'KB');
    fs.renameSync(j.src, path.join('art-originals', path.basename(j.src)));
  }
  console.log('done');
})();
