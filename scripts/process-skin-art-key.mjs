#!/usr/bin/env node
// W1128 — soft colour-key cutout for GLOW-HEAVY skin art on a plain dark background, where the AI
// remover (scripts/process-skin-art.mjs) eats translucent wings, halos and auras (the Rising v2
// Ascendant lost both). Alpha comes from each pixel's distance to the background colour (sampled
// from the four corners), the background tint is taken back out of the semi-transparent edge, then
// the same trim + fit into a transparent 400x600 as the AI path. Not for dark figures: a body close
// to the background colour would turn see-through (keep those on the AI path).
// Usage: node scripts/process-skin-art-key.mjs art-originals/avatar-skin-ascendant.png avatar-skin-ascendant.png
import sharp from 'sharp';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: process-skin-art-key.mjs <raw.png> <out.png>'); process.exit(1); }
const D0 = 22, D1 = 85;   // distance below D0 = background, above D1 = solid

const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
const corners = [px(4, 4), px(W - 5, 4), px(4, H - 5), px(W - 5, H - 5)];
const bg = [0, 1, 2].map((c) => corners.reduce((s, p) => s + p[c], 0) / corners.length);
const outBuf = Buffer.alloc(W * H * 4);
for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
  const a = Math.max(0, Math.min(1, (d - D0) / (D1 - D0)));
  const un = (v, k) => (a > 0 ? Math.max(0, Math.min(255, (v - bg[k] * (1 - a)) / a)) : 0);
  outBuf[j] = un(r, 0); outBuf[j + 1] = un(g, 1); outBuf[j + 2] = un(b, 2); outBuf[j + 3] = Math.round(a * 255);
}
await sharp(outBuf, { raw: { width: W, height: H, channels: 4 } })
  .trim({ threshold: 12 })
  .resize({ width: 400, height: 600, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log(out, 'keyed against rgb(' + bg.map(Math.round).join(',') + ')');
