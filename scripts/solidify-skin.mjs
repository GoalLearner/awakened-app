// W1298 — SOLIDIFY a look whose BODY came out see-through in the colour-key cutout (owner 2026-11-23 on Christine's
// full-body card, build 679: "This avatar's body isn't showing"). The key (process-skin-art-key.mjs) takes alpha from each
// pixel's distance to the painting's background, so a body close to that colour turns see-through; the round medallion's
// dark backing hid it, the W1296 full-body card does not. Here the local AI remover (@imgly, free) says what is FIGURE:
// that mask, with a soft edge, lays the painting's own colours OVER the existing 400x600 cutout, so the glows the key kept
// (wings, ribbons, sparks) stay and the body is solid. Writes a new file; never touches art-originals/.
// Usage: node scripts/solidify-skin.mjs art-originals/avatar-skin-X.png avatar-skin-X.png <out.png>
import { removeBackground } from '@imgly/background-removal-node';
import sharp from 'sharp';
import fs from 'fs';

const [src, cur, out] = process.argv.slice(2);
const raw = fs.readFileSync(src);
const blob = await removeBackground(new Blob([raw], { type: 'image/png' }));
const ai = Buffer.from(await blob.arrayBuffer());
// the AI cut at the original size, then into the same 400x600 frame as the current cutout: trim + contain, like the pipeline
const meta = await sharp(raw).metadata();
const aiFull = await sharp(ai).resize(meta.width, meta.height).ensureAlpha().raw().toBuffer();
const orig = await sharp(raw).ensureAlpha().raw().toBuffer();
// merge at full size: AI says figure -> solid with the painting's colour; else keep nothing (the glow comes from `cur` below)
const merged = Buffer.alloc(meta.width * meta.height * 4);
for (let i = 0; i < meta.width * meta.height; i++) {
  const a = aiFull[i * 4 + 3];
  merged[i * 4] = orig[i * 4]; merged[i * 4 + 1] = orig[i * 4 + 1]; merged[i * 4 + 2] = orig[i * 4 + 2];
  merged[i * 4 + 3] = a >= 192 ? 255 : a <= 64 ? 0 : Math.round((a - 64) * 2);   // a soft edge, not a hard cut
}
// frame it like the current file: same trim box is unknown, so fit the AI figure by matching the current cutout's bbox
const curImg = sharp(cur).ensureAlpha();
const cm = await curImg.metadata();
const curRaw = await curImg.raw().toBuffer();
const bbox = (buf, w, h, thr) => { let x0 = w, y0 = h, x1 = -1, y1 = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (buf[(y * w + x) * 4 + 3] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; };
// the current cutout's bbox in 400x600 and the original's key bbox are the same figure+glow; map the original onto it
const keyFull = await sharp(cur).ensureAlpha().raw().toBuffer();
const cb = bbox(curRaw, cm.width, cm.height, 20);
// the original's content box: where the original differs from its corner colour
const c0 = [orig[0], orig[1], orig[2]];
let ob = { x0: meta.width, y0: meta.height, x1: -1, y1: -1 };
for (let y = 0; y < meta.height; y++) for (let x = 0; x < meta.width; x++) { const p = (y * meta.width + x) * 4; const d = Math.abs(orig[p] - c0[0]) + Math.abs(orig[p + 1] - c0[1]) + Math.abs(orig[p + 2] - c0[2]); if (d > 60) { if (x < ob.x0) ob.x0 = x; if (x > ob.x1) ob.x1 = x; if (y < ob.y0) ob.y0 = y; if (y > ob.y1) ob.y1 = y; } }
const sx = (cb.x1 - cb.x0 + 1) / (ob.x1 - ob.x0 + 1), sy = (cb.y1 - cb.y0 + 1) / (ob.y1 - ob.y0 + 1);
const s = (sx + sy) / 2;
const scaled = await sharp(merged, { raw: { width: meta.width, height: meta.height, channels: 4 } }).resize(Math.round(meta.width * s), Math.round(meta.height * s)).raw().toBuffer({ resolveWithObject: true });
const ox = Math.round(cb.x0 - ob.x0 * s), oy = Math.round(cb.y0 - ob.y0 * s);
const outBuf = Buffer.from(keyFull);
for (let y = 0; y < cm.height; y++) for (let x = 0; x < cm.width; x++) {
  const sxp = x - ox, syp = y - oy; if (sxp < 0 || syp < 0 || sxp >= scaled.info.width || syp >= scaled.info.height) continue;
  const q = (syp * scaled.info.width + sxp) * 4, fa = scaled.data[q + 3] / 255; if (fa <= 0) continue;
  const p = (y * cm.width + x) * 4, ba = outBuf[p + 3] / 255, oa = fa + ba * (1 - fa);   // the solid body OVER the glow layer
  for (let c = 0; c < 3; c++) outBuf[p + c] = Math.round((scaled.data[q + c] * fa + outBuf[p + c] * ba * (1 - fa)) / Math.max(oa, 1e-6));
  outBuf[p + 3] = Math.round(oa * 255);
}
await sharp(outBuf, { raw: { width: cm.width, height: cm.height, channels: 4 } }).png().toFile(out);
console.log('ok', out, 'scale', s.toFixed(3), 'offset', ox, oy);
