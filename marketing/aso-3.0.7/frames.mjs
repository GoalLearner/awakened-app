// frames.mjs — render frames.html (six self-contained App Store frames, each a real screen) and
// write them at the three iPhone sizes App Store Connect asks for.
//   node marketing/aso-3.0.7/frames.mjs
//     -> out/frames/<nn>-<name>.png          1320×2868 (6.9")
//        out/frames/6.5-inch/<nn>-<name>.png 1284×2778
//        out/frames/6.3-inch/<nn>-<name>.png 1206×2622
//        out/frames/strip-preview.jpg
// 2026-10-19: replaces the panorama set after App Review 2.3.3. Touches nothing else in out/.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out', 'frames');
const PORT = 8095;
const NAMES = ['habits', 'victory', 'tower', 'coop', 'worldgate', 'relics'];
const SIZES = [['6.5-inch', 1284, 2778], ['6.3-inch', 1206, 2622]];
const sharp = createRequire(import.meta.url)(join(ROOT, 'node_modules', 'sharp'));

async function main() {
  for (const d of [OUT].concat(SIZES.map((s) => join(OUT, s[0])))) mkdirSync(d, { recursive: true });
  const server = spawn(process.execPath, [join(ROOT, 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  let browser;
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch (_) { /* next */ }
  }
  try {
    const page = await browser.newPage({ viewport: { width: 7920, height: 2868 }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:${PORT}/marketing/aso-3.0.7/frames.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 20000 });
    await page.waitForTimeout(500);
    for (let i = 0; i < NAMES.length; i++) {
      const file = `${String(i + 1).padStart(2, '0')}-${NAMES[i]}.png`;
      const full = join(OUT, file);
      await page.screenshot({ path: full, clip: { x: i * 1320, y: 0, width: 1320, height: 2868 } });
      for (const [dir, w, h] of SIZES) await sharp(full).resize(w, h, { fit: 'fill' }).png().toFile(join(OUT, dir, file));
      console.log('saved out/frames/' + file + ' (+ 6.5 and 6.3)');
    }
    await page.screenshot({ path: join(OUT, 'strip-preview.jpg'), type: 'jpeg', quality: 80 });
  } finally {
    await browser.close();
    server.kill();
  }
}
main().catch((e) => { console.error('FRAMES FAILED:', e); process.exit(1); });
