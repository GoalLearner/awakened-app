// W1105 — head-and-shoulders busts for the Rising, cropped from the raw 1696x2528 art.
// Boxes are [left, top, side] in the 300x450 contact-sheet tile, scaled by 1696/300.
// W1128 — boxes for the v2 art (C:\dev\videoforge\awk-rising-v2.mjs; v1 raws in art-originals/rising-v1/).
const sharp = require('sharp');
const K = 1696 / 300, OY = 1.5;
const BOX = {
  huntmaster: [65, 12, 160], vanguard: [92, 52, 116], ascendant: [75, 75, 150],   // W1130 — vanguard = the v5 art
  stridewalker: [150, 35, 135], unbroken: [75, 25, 145], oathbound: [65, 22, 160],
  thirdblade: [65, 28, 140], triarch: [62, 15, 190], gatebreaker: [65, 50, 160],
};
const only = process.argv.slice(2);
(async () => {
  for (const [slug, [l, t, s]] of Object.entries(BOX)) {
    if (only.length && !only.includes(slug)) continue;
    const src = 'art-originals/avatar-skin-' + slug + '.png';
    const m = await sharp(src).metadata();
    const side = Math.round(s * K), left = Math.max(0, Math.round(l * K)), top = Math.max(0, Math.round((t - OY) * K));
    const w = Math.min(side, m.width - left), h = Math.min(side, m.height - top);
    await sharp(src).extract({ left, top, width: w, height: h }).resize(400, 400, { fit: 'cover' })
      .webp({ quality: 82 }).toFile('assets/busts/avatar-skin-' + slug + '-bust.webp');
    console.log('OK', slug, left, top, w + 'x' + h);
  }
})();
