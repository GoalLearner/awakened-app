// W286 fix — Midjourney baked garbled item-name text along the bottom of 3 item
// arts (I quoted the names in the prompts). Crop the bottom ~8% to kill the text,
// then pad to a square (the house item convention is 1254x1254) using edge-copy so
// the dark background extends seamlessly — no solid-color seam. Reads the heavy
// originals from art-originals/ for max quality. (Greaves is excluded — wrong
// aesthetic, needs a regen; Erebus has no text and is left untouched.)
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const items = [
  ['nightfall-blade-of-the-sovereign.png', 'assets/items/nightfall-blade-of-the-sovereign.png'],
  ['crown-of-eternal-night.png',           'assets/items/crown-of-eternal-night.png'],
  ['mantle-of-the-shadow-sovereign.png',   'assets/items/mantle-of-the-shadow-sovereign.png'],
];

(async () => {
  for (const [orig, dst] of items) {
    const src = path.join('art-originals', orig);
    if (!fs.existsSync(src)) { console.log('MISSING', src); continue; }
    const m = await sharp(src).metadata();
    const cropH = Math.round(m.height * 0.92);              // drop bottom 8% (the text band)
    // 1) crop text  2) fit into 1254  3) pad to square via edge-copy
    const cropped = await sharp(src)
      .extract({ left: 0, top: 0, width: m.width, height: cropH })
      .resize({ width: 1254, height: 1254, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    const cm = await sharp(cropped).metadata();
    const side = Math.max(cm.width, cm.height);
    const padL = Math.floor((side - cm.width) / 2);
    const padT = Math.floor((side - cm.height) / 2);
    await sharp(cropped)
      .extend({
        top: padT, bottom: side - cm.height - padT,
        left: padL, right: side - cm.width - padL,
        extendWith: 'copy',
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(dst);
    const out = await sharp(dst).metadata();
    const kb = Math.round(fs.statSync(dst).size / 1024);
    console.log('FIXED', dst, out.width + 'x' + out.height, kb + 'KB');
  }
  console.log('done');
})();
