// capture.js — render index.html and save each App Store shot as a real PNG.
//   node marketing/aso-2.2.7/capture.js          -> iPhone 6.9"  1320×2868 -> out/
//   node marketing/aso-2.2.7/capture.js ipad     -> iPad 13"     2064×2752 -> out/ipad/
// Uses the system Edge/Chrome via Playwright (no browser download).

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const IPAD = process.argv[2] === 'ipad';
const DIR = __dirname;
const OUT = IPAD ? path.join(DIR, 'out', 'ipad') : path.join(DIR, 'out');
const FILE_URL = 'file:///' + path.join(DIR, 'index.html').replace(/\\/g, '/') + (IPAD ? '?device=ipad' : '');
const IDS = ['01-profile', '02-ascent', '03-report', '04-boss', '05-leaderboard'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let browser;
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; }
    catch (e) { /* try next */ }
  }
  if (!browser) throw new Error('No Chromium/Edge/Chrome browser could be launched.');

  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 2200, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(FILE_URL, { waitUntil: 'load', timeout: 60000 });

  await page.waitForFunction(() => document.querySelectorAll('.aso-shot').length >= 5, null, { timeout: 60000 });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('.aso-shot img')).every((i) => i.complete && i.naturalWidth > 0),
    null, { timeout: 60000 },
  );
  await page.waitForTimeout(1000); // let fonts settle

  const shots = await page.$$('.aso-shot');
  for (let i = 0; i < shots.length; i++) {
    const box = await shots[i].boundingBox();
    await shots[i].screenshot({ path: path.join(OUT, IDS[i] + '.png') });
    console.log('saved', IDS[i] + '.png', box ? Math.round(box.width) + 'x' + Math.round(box.height) : '');
  }

  await browser.close();
  console.log('\nDONE (' + (IPAD ? 'iPad 13"' : 'iPhone 6.9"') + ') -> ' + OUT);
})().catch((e) => { console.error('CAPTURE FAILED:', e.message); process.exit(1); });
