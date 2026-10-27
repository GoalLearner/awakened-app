// W1105 — head-and-shoulders busts for the Rising, cropped from the raw 1696x2528 art.
// Boxes are [left, top, side] in the 300x450 contact-sheet tile, scaled by 1696/300.
const sharp = require('sharp');
const K = 1696 / 300, OY = 1.5;
const BOX = {
  huntmaster: [83, 15, 130], vanguard: [87, 25, 130], ascendant: [90, 12, 120],
  stridewalker: [85, 25, 130], unbroken: [92, 50, 125], oathbound: [90, 20, 130],
  thirdblade: [65, 35, 125], triarch: [76, 82, 125], gatebreaker: [68, 45, 135],
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
