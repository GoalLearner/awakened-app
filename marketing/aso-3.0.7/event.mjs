// event.mjs — render the In-App Event art from event.html.
//   node marketing/aso-3.0.7/event.mjs   -> out/event-card.png (1920×1080) + out/event-page.png (1080×1920)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
const PORT = 8131;
const SHAPES = { card: [1920, 1080], page: [1080, 1920] };

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
      await page.goto(`http://localhost:${PORT}/marketing/aso-3.0.7/event.html?shape=${shape}`, { waitUntil: 'load' });
      await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 15000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `event-${shape}.png`) });
      console.log(`saved out/event-${shape}.png (${w}x${h})`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
}
main().catch((e) => { console.error('EVENT FAILED:', e); process.exit(1); });
