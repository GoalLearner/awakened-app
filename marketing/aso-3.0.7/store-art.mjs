// store-art.mjs — render the App Store product-page header and search-results art from store-art.html.
//   node marketing/aso-3.0.7/store-art.mjs
//     -> out/store-header.png (3840×1646) + out/store-search.png (3840×2560)
//     +  out/store-header-phone-crop.jpg (the middle a phone shows, to check nothing is cut)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
const PORT = 8132;
const SHAPES = { header: [3840, 1646], search: [3840, 2560] };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [join(ROOT, 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  let browser;
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch (_) { /* next */ }
  }
  try {
    for (const [shape, [w, h]] of Object.entries(SHAPES)) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await page.goto(`http://localhost:${PORT}/marketing/aso-3.0.7/store-art.html?shape=${shape}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 15000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(OUT, `store-${shape}.png`) });
      console.log(`saved out/store-${shape}.png (${w}x${h})`);
      if (shape === 'header') {
        const cw = Math.round(h * 1.15);   // about what a phone shows of the header
        await page.screenshot({ path: join(OUT, 'store-header-phone-crop.jpg'), type: 'jpeg', quality: 80, clip: { x: Math.round((w - cw) / 2), y: 0, width: cw, height: h } });
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
}
main().catch((e) => { console.error('STORE ART FAILED:', e); process.exit(1); });
