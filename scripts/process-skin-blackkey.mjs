#!/usr/bin/env node
// W282 — black-key cutout for DARK skins on a solid-black background.
// @imgly's subject removal washes glowing/translucent dark figures (it
// assigns the body low alpha → pale on light bgs, ghostly in battle). For
// art generated on pure black, keying alpha off luminance keeps the body
// OPAQUE with its true colors while dropping only the near-black background.
// Usage: node scripts/process-skin-blackkey.mjs <name.png> [more...]
//        (reads the raw from art-originals/, writes the 400×600 PNG to root)
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const archDir = path.join(root, 'art-originals');
const LO = 14, HI = 60;   // max-channel: <=LO → transparent, >=HI → opaque, ramp between

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: process-skin-blackkey.mjs <name.png> ...'); process.exit(1); }

for (const f of files) {
  const name = path.basename(f);
  const srcRaw = path.join(archDir, name);          // the archived original (full color, on black)
  if (!fs.existsSync(srcRaw)) { console.error('no archived original: ' + srcRaw); continue; }
  const t0 = Date.now();
  // 1. raw RGBA of the original
  const { data, info } = await sharp(fs.readFileSync(srcRaw)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // 2. alpha from how-far-from-black each pixel is (keeps colored body opaque)
  for (let p = 0; p < data.length; p += 4) {
    const lum = Math.max(data[p], data[p + 1], data[p + 2]);
    data[p + 3] = lum <= LO ? 0 : lum >= HI ? 255 : Math.round(((lum - LO) / (HI - LO)) * 255);
  }
  // 3. trim transparent margins, fit into transparent 400×600 (match free avatars)
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 8 })
    .resize({ width: 400, height: 600, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(path.join(root, name), out);
  const kb = Math.round(fs.statSync(path.join(root, name)).size / 1024);
  console.log(name + '  →  black-keyed 400×600, ' + kb + ' KB  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
}
