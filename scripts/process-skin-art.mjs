#!/usr/bin/env node
// W281 — dev-time AVATAR SKIN pipeline (@imgly/background-removal-node + sharp;
// dev-only, NOT runtime deps). Turns raw Midjourney skin exports into avatars
// that match the free class set (avatar-*.png: 400×600 transparent PNG):
//   1. AI background removal (subject cutout with alpha),
//   2. trim transparent margins,
//   3. fit inside a transparent 400×600 canvas (2:3), character centered —
//      identical framing/crop behavior to the free avatars,
//   4. write PNG back to the repo root (overwrites the raw),
//   5. archive the raw original to art-originals/ (gitignored).
// Usage: node scripts/process-skin-art.mjs                 (all avatar-skin-*.png at root)
//        node scripts/process-skin-art.mjs avatar-skin-stardust.png [more...]
import { removeBackground } from '@imgly/background-removal-node';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const archDir = path.join(root, 'art-originals');
fs.mkdirSync(archDir, { recursive: true });

let files = process.argv.slice(2);
if (!files.length) files = fs.readdirSync(root).filter((f) => /^avatar-skin-.+\.png$/i.test(f));
if (!files.length) { console.error('no avatar-skin-*.png at root'); process.exit(1); }

for (const f of files) {
  const src = path.isAbsolute(f) ? f : path.join(root, f);
  const name = path.basename(src);
  const t0 = Date.now();
  // 1. cutout (Blob form: Windows drive letters parse as URI protocols)
  const blob = await removeBackground(new Blob([fs.readFileSync(src)], { type: 'image/png' }));
  const cut = Buffer.from(await blob.arrayBuffer());
  // 2-3. trim transparent margins, fit into a transparent 400×600 (centered)
  const png = await sharp(cut)
    .trim({ threshold: 12 })
    .resize({ width: 400, height: 600, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  // 4-5. archive the raw, then overwrite root with the processed avatar
  fs.copyFileSync(src, path.join(archDir, name));
  fs.writeFileSync(src, png);
  const kb = Math.round(fs.statSync(src).size / 1024);
  console.log(name + '  →  400×600 transparent PNG, ' + kb + ' KB  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
}
console.log('done — raws archived to art-originals/');
