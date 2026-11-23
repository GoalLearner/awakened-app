#!/usr/bin/env node
// Cut a sheet of emblems painted on a flat green background into one transparent PNG per emblem, in reading order
// (top row left to right, then the next row). Used for the boss-kill badge ladder (W1293): the fal sheet has ten
// emblems with fire and embers, so the mask is dilated before labelling to keep each emblem's sparks with it.
// Usage: node scripts/cut-emblem-sheet.js <sheet.png> <outDir> [count=10] [size=128]
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const [, , SHEET, OUT, COUNT = '10', SIZE = '128'] = process.argv;
if (!SHEET || !OUT) { console.error('usage: cut-emblem-sheet.js <sheet.png> <outDir> [count] [size]'); process.exit(1); }

(async () => {
  const { data, info } = await sharp(SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, px = Buffer.from(data);
  // 1) key the green: how much greener than red/blue a pixel is decides its transparency; spill is pulled out of the rest
  const alpha = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = px[p], g = px[p + 1], b = px[p + 2], m = Math.max(r, b), k = g - m;
    let a = k <= 28 ? 255 : k >= 90 ? 0 : Math.round(255 * (90 - k) / 62);
    if (a > 0 && g > m) px[p + 1] = Math.max(m, Math.min(g, Math.round((r + b) / 2 + 8)));   // despill
    if (a < 40) a = 0;   // keyed noise in the green would stop the trim
    px[p + 3] = a; alpha[i] = a;
  }
  // 2) a coarse, dilated mask so an emblem and its flames/embers form one blob
  const S = 8, w = Math.ceil(W / S), h = Math.ceil(H / S), coarse = new Uint8Array(w * h);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (alpha[y * W + x] > 215) coarse[((y / S) | 0) * w + ((x / S) | 0)] = 1;
  const R = 1, dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!coarse[y * w + x]) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) dil[yy * w + xx] = 1; }
  }
  // 3) label the blobs, keep the biggest COUNT, read them in rows
  const lab = new Int32Array(w * h).fill(-1), blobs = [];
  for (let s = 0; s < w * h; s++) {
    if (!dil[s] || lab[s] >= 0) continue;
    const id = blobs.length, st = [s]; lab[s] = id;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
    while (st.length) {
      const q = st.pop(), x = q % w, y = (q / w) | 0; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const t = yy * w + xx; if (dil[t] && lab[t] < 0) { lab[t] = id; st.push(t); }
      }
    }
    blobs.push({ x0: x0 * S, y0: y0 * S, x1: Math.min(W, (x1 + 1) * S), y1: Math.min(H, (y1 + 1) * S), n });
  }
  let keep = blobs.sort((a, b) => b.n - a.n).slice(0, +COUNT);
  // GRID=CxR: the emblems sit in an even grid (touching spikes would merge blobs), so cut by cell instead
  const grid = /^(\d+)x(\d+)$/.exec(process.env.GRID || '');
  if (grid) {
    const C = +grid[1], Rw = +grid[2], cw = W / C, ch = H / Rw; keep = [];
    for (let r = 0; r < Rw; r++) for (let c = 0; c < C; c++) keep.push({ x0: Math.round(c * cw), x1: Math.round((c + 1) * cw), y0: Math.round(r * ch), y1: Math.round((r + 1) * ch), grid: 1 });
  }
  const rowH = Math.max(...keep.map((b) => b.y1 - b.y0)) * 0.5;
  if (!grid) keep.sort((a, b) => (Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) > rowH ? (a.y0 + a.y1) - (b.y0 + b.y1) : a.x0 - b.x0));
  // the core blobs leave out faint glow; widen each box toward its neighbours (half the gap) to take its glow back
  const M = 56;
  keep.forEach((b, j) => {
    if (b.grid) { b.cx0 = b.x0; b.cx1 = b.x1; b.cy0 = b.y0; b.cy1 = b.y1; return; }
    const prev = keep[j - 1], next = keep[j + 1], same = (o) => o && Math.abs((o.y0 + o.y1) / 2 - (b.y0 + b.y1) / 2) <= rowH;
    b.cx0 = Math.max(0, same(prev) ? Math.round((prev.x1 + b.x0) / 2) : b.x0 - M);
    b.cx1 = Math.min(W, same(next) ? Math.round((b.x1 + next.x0) / 2) : b.x1 + M);
    b.cy0 = Math.max(0, b.y0 - M); b.cy1 = Math.min(H, b.y1 + M);
  });
  fs.mkdirSync(OUT, { recursive: true });
  const keyed = sharp(px, { raw: { width: W, height: H, channels: 4 } });
  const full = await keyed.png().toBuffer();
  let i = 0;
  for (const b of keep) {
    i++;
    const box = await sharp(full).extract({ left: b.cx0, top: b.cy0, width: b.cx1 - b.cx0, height: b.cy1 - b.cy0 }).png().toBuffer();
    const crop = await sharp(box).trim({ threshold: 1 }).toBuffer();   // two steps: extract + trim in one pipeline trips sharp 0.32
    await sharp(crop).resize(+SIZE, +SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(OUT, 't' + i + '.png'));
    console.log('t' + i, b.cx1 - b.cx0, 'x', b.cy1 - b.cy0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
