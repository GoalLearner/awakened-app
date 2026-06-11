#!/usr/bin/env node
// W251 — dev-time NPC art pipeline (@imgly/background-removal-node + sharp;
// NOT runtime dependencies). Turns Midjourney generations into battle sprites:
//   1. AI background removal (subject cutout with alpha),
//   2. trim transparent borders,
//   3. resize to the sprite box (≤900px tall — renders ~180-220px, retina ×3),
//   4. encode webp q82 → assets/arena/<name>.webp (target ≤150KB),
//   5. archive the original to art-originals/.
// Usage: node scripts/process-foe-art.mjs <file.png> [more files...]
//        node scripts/process-foe-art.mjs --all   (every foe_*.png/boss_*.png at root)
import { removeBackground } from '@imgly/background-removal-node';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const outDir = path.join(root, 'assets', 'arena');
const archDir = path.join(root, 'art-originals');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(archDir, { recursive: true });

let files = process.argv.slice(2);
if (files[0] === '--all') {
  files = fs.readdirSync(root).filter((f) => /^(foe|boss)_.+\.png$/i.test(f));
}
if (!files.length) { console.error('no input files'); process.exit(1); }

for (const f of files) {
  const src = path.isAbsolute(f) ? f : path.join(root, f);
  const name = path.basename(src).replace(/\.png$/i, '');
  const t0 = Date.now();
  const blob = await removeBackground(new Blob([fs.readFileSync(src)], { type: 'image/png' }));   // Blob, not path: Windows drive letters parse as URI protocols
  const cut = Buffer.from(await blob.arrayBuffer());
  const out = path.join(outDir, name + '.webp');
  await sharp(cut)
    .trim({ threshold: 12 })                  // crop transparent margins
    .resize({ height: 900, width: 900, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toFile(out);
  const kb = Math.round(fs.statSync(out).size / 1024);
  const meta = await sharp(out).metadata();
  console.log(`${name}.webp  ${meta.width}×${meta.height}  ${kb}KB  (${((Date.now() - t0) / 1000).toFixed(1)}s)${kb > 150 ? '  ⚠ over 150KB target' : ''}`);
  fs.renameSync(src, path.join(archDir, path.basename(src)));
}
console.log('done — originals archived to art-originals/');
