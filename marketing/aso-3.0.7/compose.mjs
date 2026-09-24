// compose.mjs — frame the raw captures into App Store shots.
//   node marketing/aso-3.0.7/compose.mjs [name ...]   -> marketing/aso-3.0.7/out/<nn>-<name>.png (1320×2868)
// Serves the repo (so compose.html can read raw/*.png same-origin) and renders
// compose.html?shot=<name> for each shot, in App Store order.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
const PORT = 8092;
const ORDER = ['habits', 'victory', 'coop', 'mvp', 'briefing'];   // promise → payoff → together → everyone → every day

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [join(ROOT, 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  let browser;
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch (_) { /* next */ }
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1320, height: 2868 }, deviceScaleFactor: 1 });
    const names = process.argv.slice(2).length ? process.argv.slice(2) : ORDER;
    for (const name of names) {
      await page.goto(`http://localhost:${PORT}/marketing/aso-3.0.7/compose.html?shot=${name}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 15000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const nn = String(ORDER.indexOf(name) + 1).padStart(2, '0');
      await page.screenshot({ path: join(OUT, `${nn}-${name}.png`) });
      console.log(`saved out/${nn}-${name}.png`);
    }
  } finally {
    await browser.close();
    server.kill();
  }
}
main().catch((e) => { console.error('COMPOSE FAILED:', e); process.exit(1); });
