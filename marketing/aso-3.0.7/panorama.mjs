// panorama.mjs — render panorama.html (the whole set as one strip) and slice it
// into the six App Store cards.
//   node marketing/aso-3.0.7/panorama.mjs   -> marketing/aso-3.0.7/out/<nn>-<name>.png (1320×2868 each)
//                                           +  out/strip-preview.jpg (the set as it scrolls)
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
const PORT = 8094;
const NAMES = ['habits', 'vows', 'victory', 'coop', 'worldgate', 'relics'];

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (/\.(png|jpg)$/.test(f)) unlinkSync(join(OUT, f));
  const server = spawn(process.execPath, [join(ROOT, 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  let browser;
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch (_) { /* next */ }
  }
  try {
    const page = await browser.newPage({ viewport: { width: 7920, height: 2868 }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:${PORT}/marketing/aso-3.0.7/panorama.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 20000 });
    await page.waitForTimeout(500);
    for (let i = 0; i < NAMES.length; i++) {
      const file = `${String(i + 1).padStart(2, '0')}-${NAMES[i]}.png`;
      await page.screenshot({ path: join(OUT, file), clip: { x: i * 1320, y: 0, width: 1320, height: 2868 } });
      console.log('saved out/' + file);
    }
    // the set as the App Store shows it: small gaps between cards
    await page.evaluate(() => { document.querySelectorAll('.card').forEach((c) => { c.style.outline = '0'; }); });
    await page.screenshot({ path: join(OUT, 'strip-preview.jpg'), type: 'jpeg', quality: 80, fullPage: false });
    console.log('saved out/strip-preview.jpg');
  } finally {
    await browser.close();
    server.kill();
  }
}
main().catch((e) => { console.error('PANORAMA FAILED:', e); process.exit(1); });
