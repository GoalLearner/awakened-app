// render.js — record an animated HTML card to a 1080x1920 video clip.
//   node marketing/clips/render.js outro-card.html
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const file = process.argv[2] || 'outro-card.html';
const seconds = Number(process.argv[3] || 7.4);
const DIR = __dirname;
const OUT = path.join(DIR, 'out');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let browser;
  for (const ch of ['msedge', 'chrome', undefined]) {
    try { browser = await chromium.launch({ channel: ch, headless: true }); break; } catch (e) {}
  }
  if (!browser) throw new Error('No Chromium/Edge/Chrome available.');
  const ctx = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: 1080, height: 1920 } },
  });
  const page = await ctx.newPage();
  const url = 'file:///' + path.join(DIR, file).replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(Math.round(seconds * 1000));
  const vid = await page.video();
  await page.close();
  await ctx.close();        // finalizes the webm
  await browser.close();
  const base = path.basename(file, '.html');
  const finalWebm = path.join(OUT, base + '.webm');
  try {
    const src = await vid.path();
    fs.renameSync(src, finalWebm);
  } catch (e) {
    const got = fs.readdirSync(OUT).filter(f => f.endsWith('.webm') && f !== base + '.webm');
    if (got[0]) fs.renameSync(path.join(OUT, got[0]), finalWebm);
  }
  console.log('WEBM:', finalWebm);
})().catch((e) => { console.error('RENDER FAILED:', e.message); process.exit(1); });
