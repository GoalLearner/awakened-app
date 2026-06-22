// _shot.js — screenshot a trailer HTML at given second-marks (verify scenes).
//   node marketing/clips/_shot.js coop-hunt.html 2.5 8 13 19 24 28
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const file = process.argv[2];
const times = process.argv.slice(3).map(Number);
const DIR = __dirname;
const OUT = path.join(DIR, 'out');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let browser;
  for (const ch of ['msedge', 'chrome', undefined]) { try { browser = await chromium.launch({ channel: ch, headless: true }); break; } catch (e) {} }
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 0.5 });
  const page = await ctx.newPage();
  const url = 'file:///' + path.join(DIR, file).replace(/\\/g, '/');
  const base = path.basename(file, '.html');
  for (const t of times) {
    await page.goto(url, { waitUntil: 'load' });   // restart the timeline each capture
    await page.waitForTimeout(Math.round(t * 1000));
    const out = path.join(OUT, base + '-' + String(t).replace('.', '_') + 's.png');
    await page.screenshot({ path: out });
    console.log('SHOT', out);
  }
  await browser.close();
})().catch((e) => { console.error('SHOT FAILED:', e.message); process.exit(1); });
