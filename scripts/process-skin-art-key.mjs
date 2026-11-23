#!/usr/bin/env node
// W1128 — soft colour-key cutout for GLOW-HEAVY skin art on a plain dark background, where the AI
// remover (scripts/process-skin-art.mjs) eats translucent wings, halos and auras (the Rising v2
// Ascendant lost both). Alpha comes from each pixel's distance to the background colour (sampled
// from the four corners), the background tint is taken back out of the semi-transparent edge, then
// the same trim + fit into a transparent 400x600 as the AI path. Not for dark figures: a body close
// to the background colour would turn see-through (keep those on the AI path).
// --merge-ai (W1131): a DARK figure wrapped in a bright aura (the anime Stridewalker: black gi, cyan
// lightning) needs both — the AI remover keeps the dark body, the key keeps the glow. Each pixel takes
// the higher of the two alphas, and the AI's untouched colour wherever the AI alpha wins.
// --dark-solid (W1288): a pixel clearly DARKER than the plain background cannot be background, so it stays solid with its
// true colour (the Violet Queen's near-black cape came out see-through on both the key and the AI paths).
// --fill-holes (W1288): fills see-through patches INSIDE the figure (see the comment at the pass).
// Usage: node scripts/process-skin-art-key.mjs art-originals/avatar-skin-ascendant.png avatar-skin-ascendant.png [--merge-ai] [--dark-solid] [--fill-holes]
// The Violet Queen (W1288): --merge-ai --dark-solid --fill-holes
import sharp from 'sharp';

const args = process.argv.slice(2);
const mergeAi = args.includes('--merge-ai');
const darkSolid = args.includes('--dark-solid');
const fillHoles = args.includes('--fill-holes');
const [src, out] = args.filter((a) => !a.startsWith('--'));
if (!src || !out) { console.error('usage: process-skin-art-key.mjs <raw.png> <out.png> [--merge-ai]'); process.exit(1); }
const D0 = 22, D1 = 85;   // distance below D0 = background, above D1 = solid

const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
let aiAlpha = null;
if (mergeAi) {
  const { removeBackground } = await import('@imgly/background-removal-node');
  const fs = await import('fs');
  const blob = await removeBackground(new Blob([fs.readFileSync(src)], { type: 'image/png' }));
  const cut = Buffer.from(await blob.arrayBuffer());
  aiAlpha = await sharp(cut).resize(W, H, { fit: 'fill' }).ensureAlpha().extractChannel(3).raw().toBuffer();
}
const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
const corners = [px(4, 4), px(W - 5, 4), px(4, H - 5), px(W - 5, H - 5)];
const bg = [0, 1, 2].map((c) => corners.reduce((s, p) => s + p[c], 0) / corners.length);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b, bgL = lum(bg[0], bg[1], bg[2]);
const outBuf = Buffer.alloc(W * H * 4);
for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
  const a = Math.max(0, Math.min(1, (d - D0) / (D1 - D0)));
  // a pixel the colour of the background is background, whatever the AI thinks (W1132: it kept a
  // navy patch between the Shadowborn's legs)
  const ai = aiAlpha && d >= D0 ? aiAlpha[j / 4] / 255 : 0;
  const dk = darkSolid ? Math.max(0, Math.min(1, (bgL - lum(r, g, b) - 5) / 12)) : 0;   // --dark-solid
  if (dk > 0 && dk >= a && dk >= ai) {
    outBuf[j] = r; outBuf[j + 1] = g; outBuf[j + 2] = b; outBuf[j + 3] = Math.round(dk * 255);
    continue;
  }
  if (ai >= a && ai > 0) {   // --merge-ai: the AI's alpha wins here, keep the true colour
    outBuf[j] = r; outBuf[j + 1] = g; outBuf[j + 2] = b; outBuf[j + 3] = Math.round(ai * 255);
    continue;
  }
  const un = (v, k) => (a > 0 ? Math.max(0, Math.min(255, (v - bg[k] * (1 - a)) / a)) : 0);
  outBuf[j] = un(r, 0); outBuf[j + 1] = un(g, 1); outBuf[j + 2] = un(b, 2); outBuf[j + 3] = Math.round(a * 255);
}
if (fillHoles) {
  // --fill-holes: close the solid part of the figure (blur + threshold = dilate, then erode) and make every
  // pixel inside it solid with its true colour, so navy-ish folds inside a dark cape or armour stop showing
  // what is behind. Gaps wider than ~2 * FILL_SIGMA (between the legs, beside the sword) stay open.
  const FILL_SIGMA = 12;
  const solid = Buffer.alloc(W * H);
  for (let k = 0; k < W * H; k++) solid[k] = outBuf[k * 4 + 3] >= 217 ? 255 : 0;
  const pass = async (buf, cut) => {
    const b = await sharp(buf, { raw: { width: W, height: H, channels: 1 } }).blur(FILL_SIGMA).toColourspace('b-w').raw().toBuffer();   // b-w: sharp hands back 3 channels otherwise
    for (let k = 0; k < b.length; k++) b[k] = b[k] > cut ? 255 : 0;
    return b;
  };
  const closed = await pass(await pass(solid, 24), 231);
  for (let k = 0, i = 0; k < W * H; k++, i += 3) {
    if (closed[k] && outBuf[k * 4 + 3] < 255) { outBuf[k * 4] = data[i]; outBuf[k * 4 + 1] = data[i + 1]; outBuf[k * 4 + 2] = data[i + 2]; outBuf[k * 4 + 3] = 255; }
  }
}
await sharp(outBuf, { raw: { width: W, height: H, channels: 4 } })
  .trim({ threshold: 12 })
  .resize({ width: 400, height: 600, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log(out, 'keyed against rgb(' + bg.map(Math.round).join(',') + ')');
