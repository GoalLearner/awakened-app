// tools/icons/process-jump-icons.js — W578
// One-shot pipeline for the 5 MidJourney jump-exercise habit icons.
//
// MJ delivers the figure on a plain flat charcoal/gray backdrop (per the house
// prompt) — but "flat" still means a soft vignette and, on some renders, a
// warm horizon band near the floor. A single corner-sampled bg color + global
// tolerance leaves fog rings / horizon strips (first attempt did exactly
// that), so the matte uses a PER-PIXEL LOCAL BACKGROUND FIELD:
//
//   localBg(x,y) = mean of  lerp(rowLeft(y), rowRight(y), x/W)
//                      and  lerp(colTop(x),  colBottom(x), y/H)
//
// where rowLeft/rowRight/colTop/colBottom are box-smoothed edge samples. The
// vignette and horizon live in that field, so distance-to-localBg is ~0 for
// all backdrop pixels regardless of position.
//
// Pass 1: edge-connected BFS flood over dist(pixel, localBg) < T_HIGH.
// Pass 2: enclosed near-bg pockets (components trapped between glow/limbs that
//         the edge flood can't reach — e.g. behind the weighted-jump torso):
//         any component of near-bg pixels with mean dist < POCKET_MEAN and
//         size > POCKET_MIN px is treated as backdrop too.
// Alpha:  smoothstep feather T_LOW..T_HIGH inside the backdrop region (keeps
//         the violet glow wisps fading naturally); everything else opaque.
// Then:   crop to the alpha bbox, pad to square +4% margin, lanczos to 192.
//
// House format: assets/habit-icons/icon-*.png 192x192 transparent final +
// icon-*-source.png 600x600 raw archive.
//
// Usage: node tools/icons/process-jump-icons.js [--preview]
//   --preview also writes 384px versions flattened onto the app navy
//   (#17182b) under tools/icons/preview/ for eyeballing.

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT  = path.join(ROOT, 'assets', 'habit-icons');
const PREVIEW = process.argv.includes('--preview');
const PREVIEW_DIR = path.join(ROOT, 'tools', 'icons', 'preview');

const ICONS = [
  { name: 'icon-maxjump' },
  { name: 'icon-depthjump' },
  { name: 'icon-broadjump' },
  { name: 'icon-bandjump' },
  { name: 'icon-weightedjump' },
];

// Floor-zone handling (maxjump's baked warm horizon band): below FLOOR_FRAC,
// pixels under FLOOR_SEVER_ALPHA are zeroed so the band disconnects from the
// figure's spark trail; then any component living ENTIRELY below FLOOR_FRAC is
// dropped as floor junk. Bottom-anchored art that belongs (depth-jump rubble,
// band-jump fire ring) is connected upward past the line, so it stays.
const FLOOR_FRAC = 0.84;
const FLOOR_SEVER_ALPHA = 170;

const T_LOW  = 14;   // dist below this (in backdrop region) -> fully transparent
const T_HIGH = 44;   // flood joins while dist < T_HIGH; feather band T_LOW..T_HIGH
const POCKET_MEAN = 22;  // enclosed component counts as backdrop if mean dist < this
                         // (22 not 14: the edge-sampled local-bg field underestimates the
                         // center-bright vignette, so genuinely-bg pockets trapped mid-frame
                         // read a touch "far"; real art pockets are vivid — dist >> 22)
const pocketMin = (N) => Math.max(24, Math.round(N / 40000));  // scale-aware size floor (≈105px at 2048², ≈24px at 600²)
const BBOX_ALPHA  = 12;  // alpha threshold for the crop box
const MARGIN = 0.04;     // padding around the figure in the final square
const EDGE_IN = 6, EDGE_W = 10;   // edge sampling: rows/cols EDGE_IN..EDGE_IN+EDGE_W px in
const SMOOTH = 21;                // box-smooth window for the edge arrays

function boxSmooth(arr, win) {
  const n = arr.length, half = win >> 1, out = new Array(n);
  for (let c = 0; c < 3; c++) {
    let sum = 0, cnt = 0;
    for (let i = 0; i < Math.min(n, half + 1); i++) { sum += arr[i][c]; cnt++; }
    for (let i = 0; i < n; i++) {
      if (!out[i]) out[i] = [0, 0, 0];
      out[i][c] = sum / cnt;
      const add = i + half + 1, drop = i - half;
      if (add < n) { sum += arr[add][c]; cnt++; }
      if (drop >= 0) { sum -= arr[drop][c]; cnt--; }
    }
  }
  return out;
}

async function processOne(spec) {
  const name = spec.name;
  // Input: the raw MJ drop at repo root if present, else the committed 600x600
  // -source.png archive (still 3x the 192 final — the pipeline is reproducible
  // from the repo alone once the archives are in).
  let inFile = path.join(ROOT, name + '.png');
  let fromArchive = false;
  if (!fs.existsSync(inFile)) {
    inFile = path.join(OUT, name + '-source.png');
    fromArchive = true;
    if (!fs.existsSync(inFile)) { console.log(`  SKIP ${name} (no root drop and no -source archive)`); return false; }
  }

  const { data, info } = await sharp(inFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;

  // ── Local background field from smoothed edge samples ──
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const sampleBand = (fixed, alongLen, horizontal) => {
    // median-ish (mean of the band) color per position along an edge band
    const arr = new Array(alongLen);
    for (let a = 0; a < alongLen; a++) {
      let r = 0, g = 0, b = 0;
      for (let d = EDGE_IN; d < EDGE_IN + EDGE_W; d++) {
        const c = horizontal ? px(a, fixed + d) : px(fixed + d, a);
        r += c[0]; g += c[1]; b += c[2];
      }
      arr[a] = [r / EDGE_W, g / EDGE_W, b / EDGE_W];
    }
    return boxSmooth(arr, SMOOTH);
  };
  const top = sampleBand(0, W, true);            // colTop(x): rows EDGE_IN.. from the top
  const bot = sampleBand(H - EDGE_IN - EDGE_W - EDGE_IN, W, true);   // near the bottom
  const left  = sampleBand(0, H, false);
  const right = sampleBand(W - EDGE_IN - EDGE_W - EDGE_IN, H, false);

  const distToLocal = (x, y) => {
    const i = (y * W + x) * 4;
    const fx = x / (W - 1), fy = y / (H - 1);
    let dr = 0, dg = 0, db = 0;
    // horizontal blend + vertical blend, averaged
    const hr = left[y][0] + (right[y][0] - left[y][0]) * fx;
    const hg = left[y][1] + (right[y][1] - left[y][1]) * fx;
    const hb = left[y][2] + (right[y][2] - left[y][2]) * fx;
    const vr = top[x][0] + (bot[x][0] - top[x][0]) * fy;
    const vg = top[x][1] + (bot[x][1] - top[x][1]) * fy;
    const vb = top[x][2] + (bot[x][2] - top[x][2]) * fy;
    dr = data[i]     - (hr + vr) / 2;
    dg = data[i + 1] - (hg + vg) / 2;
    db = data[i + 2] - (hb + vb) / 2;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  // Precompute distances once (used by flood, pockets, feather).
  const distMap = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) distMap[y * W + x] = distToLocal(x, y);

  // ── Pass 1: edge-connected flood over near-bg pixels ──
  const region = new Uint8Array(N);   // 1 = backdrop
  const qx = new Int32Array(N), qy = new Int32Array(N);
  let qh = 0, qt = 0;
  const tryPush = (x, y) => {
    const p = y * W + x;
    if (region[p] || distMap[p] >= T_HIGH) return;
    region[p] = 1; qx[qt] = x; qy[qt] = y; qt++;
  };
  for (let x = 0; x < W; x++) { tryPush(x, 0); tryPush(x, H - 1); }
  for (let y = 0; y < H; y++) { tryPush(0, y); tryPush(W - 1, y); }
  while (qh < qt) {
    const x = qx[qh], y = qy[qh]; qh++;
    if (x > 0) tryPush(x - 1, y);
    if (x < W - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < H - 1) tryPush(x, y + 1);
  }

  // ── Pass 2: enclosed near-bg pockets ──
  // Components of dist<T_HIGH pixels NOT reached by the edge flood. Clearly-bg
  // ones (mean dist < POCKET_MEAN, size >= POCKET_MIN) join the backdrop.
  const seen = new Uint8Array(N);
  let pockets = 0;
  for (let p0 = 0; p0 < N; p0++) {
    if (region[p0] || seen[p0] || distMap[p0] >= T_HIGH) continue;
    // BFS this component
    let h = 0, t = 0; qx[t] = p0 % W; qy[t] = (p0 / W) | 0; t++; seen[p0] = 1;
    const members = [];
    let sum = 0;
    while (h < t) {
      const x = qx[h], y = qy[h]; h++;
      const p = y * W + x;
      members.push(p); sum += distMap[p];
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx;
        if (seen[np] || region[np] || distMap[np] >= T_HIGH) continue;
        seen[np] = 1; qx[t] = nx; qy[t] = ny; t++;
      }
    }
    if (members.length >= pocketMin(N) && sum / members.length < POCKET_MEAN) {
      for (const p of members) region[p] = 1;
      pockets++;
    }
  }

  // ── Alpha: smoothstep feather inside the backdrop region ──
  for (let p = 0; p < N; p++) {
    if (!region[p]) continue;
    const d = distMap[p];
    const t = d <= T_LOW ? 0 : Math.min(1, (d - T_LOW) / (T_HIGH - T_LOW));
    data[p * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255);
  }

  // ── Ground-sever pass ──
  // MJ often paints a warm horizon smear along the floor. Its core survives
  // the matte (genuinely far from the local bg), and faint particles bridge it
  // to the figure so a pure component filter can't isolate it. Zero the sub-
  // FLOOR_SEVER_ALPHA pixels in the floor zone: the smear disconnects, and the
  // "entirely below FLOOR_FRAC" rule in the component filter drops what's left.
  for (let y = Math.floor(H * FLOOR_FRAC); y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4 + 3;
      if (data[i] < FLOOR_SEVER_ALPHA) data[i] = 0;
    }
  }

  // ── Component filter: keep the figure, drop stray debris ──
  // The matte can leave disconnected leftovers (e.g. a faint horizon smear far
  // below the figure). Find connected components of alpha>BBOX_ALPHA, keep the
  // LARGEST plus every component whose bbox intersects the largest's bbox
  // (expanded 2%) — attached glow/debris stays, far-away junk goes.
  const comp = new Int32Array(N).fill(-1);
  const comps = [];   // {size, minX, minY, maxX, maxY, id}
  for (let p0 = 0; p0 < N; p0++) {
    if (comp[p0] !== -1 || data[p0 * 4 + 3] <= BBOX_ALPHA) continue;
    const id = comps.length;
    let h = 0, t = 0; qx[t] = p0 % W; qy[t] = (p0 / W) | 0; t++; comp[p0] = id;
    const c = { id, size: 0, minX: W, minY: H, maxX: -1, maxY: -1 };
    while (h < t) {
      const x = qx[h], y = qy[h]; h++;
      c.size++;
      if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx;
        if (comp[np] !== -1 || data[np * 4 + 3] <= BBOX_ALPHA) continue;
        comp[np] = id; qx[t] = nx; qy[t] = ny; t++;
      }
    }
    comps.push(c);
  }
  if (!comps.length) { console.log(`  FAIL ${name}: everything transparent`); return false; }
  const floorY = Math.floor(H * FLOOR_FRAC);
  const main = comps.reduce((a, b) => (b.size > a.size ? b : a));
  const grow = Math.round(Math.max(W, H) * 0.02);
  const keep = new Set([main.id]);
  for (const c of comps) {
    if (c.id === main.id) continue;
    if (c.minY >= floorY) continue;   // floor junk: lives entirely below the line
    const overlaps = c.minX <= main.maxX + grow && c.maxX >= main.minX - grow &&
                     c.minY <= main.maxY + grow && c.maxY >= main.minY - grow;
    if (overlaps) keep.add(c.id);
  }
  let dropped = 0;
  for (let p = 0; p < N; p++) {
    const id = comp[p];
    if (id !== -1 && !keep.has(id)) { data[p * 4 + 3] = 0; dropped++; }
  }

  // ── Crop to alpha bbox (kept components only), pad square, resize ──
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (const c of comps) {
    if (!keep.has(c.id)) continue;
    if (c.minX < minX) minX = c.minX; if (c.maxX > maxX) maxX = c.maxX;
    if (c.minY < minY) minY = c.minY; if (c.maxY > maxY) maxY = c.maxY;
  }

  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const side = Math.ceil(Math.max(bw, bh) * (1 + MARGIN * 2));
  const padX = Math.round((side - bw) / 2), padY = Math.round((side - bh) / 2);

  // TWO stages on purpose: sharp applies ops in a FIXED internal order
  // (extract -> resize -> extend), NOT call order — a single
  // extract+extend+resize pipeline pads AFTER the 192 resize and ships a
  // non-square ~268px image. Materialize the padded square first, then resize.
  const paddedBuf = await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: bw, height: bh })
    .extend({ top: padY, bottom: side - bh - padY, left: padX, right: side - bw - padX,
              background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();

  const finalBuf = await sharp(paddedBuf).resize(192, 192, { kernel: 'lanczos3' }).png().toBuffer();
  fs.writeFileSync(path.join(OUT, name + '.png'), finalBuf);

  // Raw 600x600 archive of the original (house -source.png convention).
  // Skip when the archive itself was the input.
  if (!fromArchive) {
    await sharp(inFile).resize(600, 600, { kernel: 'lanczos3' }).png().toFile(path.join(OUT, name + '-source.png'));
  }

  if (PREVIEW) {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
    await sharp(finalBuf).resize(384, 384, { kernel: 'nearest' })
      .flatten({ background: '#17182b' })
      .png().toFile(path.join(PREVIEW_DIR, name + '-preview.png'));
  }

  const fullFrame = (bw === W && bh === H) ? '  ⚠ bbox = full frame' : '';
  const drops = comps.length - keep.size;
  console.log(`  OK ${name}: bbox ${bw}x${bh}, ${pockets} pocket(s), ${drops} stray comp(s) dropped (${dropped}px), final 192px (${(finalBuf.length / 1024).toFixed(0)} KB)${fullFrame}`);
  return true;
}

(async () => {
  console.log('Processing jump icons -> ' + OUT);
  let ok = 0;
  for (const spec of ICONS) { if (await processOne(spec)) ok++; }
  console.log(ok === ICONS.length ? 'ALL DONE' : `DONE with ${ICONS.length - ok} skip/fail`);
  process.exit(ok === ICONS.length ? 0 : 1);
})();
