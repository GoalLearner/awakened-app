// W877 — the Starved Sentinel drop came back as a photographed canvas on a
// white gallery wall (white margin + drop shadow on every side), which would
// glow against the dark UI. Crop to the painting itself; no upscale after
// (house rule — withoutEnlargement), a ~1040px boss portrait is in range.
const sharp = require('sharp');

const SRC = 'assets/bosses/the-starved-sentinel.png';

(async () => {
  const buf = require('fs').readFileSync(SRC);
  const out = await sharp(buf)
    .extract({ left: 110, top: 100, width: 1035, height: 1030 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  require('fs').writeFileSync(SRC, out);
  const m = await sharp(SRC).metadata();
  console.log('OK', SRC, m.width + 'x' + m.height, Math.round(out.length / 1024) + 'KB');
})();
