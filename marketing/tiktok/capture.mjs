// capture.mjs — record REAL app gameplay for short-form video (TikTok / Reels / Shorts).
//   node marketing/tiktok/capture.mjs [scene ...]   -> marketing/tiktok/raw/<scene>.mp4 + <scene>.marks.json
// Boots the app from this repo on its own port, seeds a demo hunter (made-up name, never a real user), drives
// each scene through the app's own hooks, and records a CDP screencast at a 9:16 phone size (414x736 at 3x ->
// 1242x2208, scaled to 1080x1920), so the clip fills a vertical video edge to edge. Each scene logs time marks
// ("hit1", "ult", "ko" ...) so cut.mjs can cut on the music's beats.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RAW = join(HERE, 'raw');
const PORT = 8093;
const URL = `http://localhost:${PORT}/`;
const W = 414, H = 736, DSF = 3;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function seedScript() {
  return (ex) => {
    try {
      localStorage.clear();
      const set = (k, v) => localStorage.setItem(k, v);
      set('hb_onboarding_seen_v2', '1'); set('hb_welcomed', '1'); set('hb_hunter_name_claimed', '1');
      set('hb_cloud_restore_dismissed', '1'); set('hb_whats_new_seen', '99.99.99');
      const d = new Date(); const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      set('hb_fri_banner_' + ymd, '1'); set('hb_daily_insight_last_shown', ymd);
      ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted',
        'hb_first_completion_bonus_v1', 'hb_tour_day3_v1', 'hb_tour_day7_v1', 'hb_tour_quests_v1', 'hb_tour_items_v1', 'hb_ascent_opening_seen_v1'].forEach((k) => set(k, '1'));
      set('hb_onboarding_first_xp_date', '2026-07-01');
      set('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      set('hb_name', 'Kael');
      set('hb_points', '30000');   // S rank: the S dungeon is open
      set('hb_habits', JSON.stringify([{ id: 'v-walk', name: 'Daily walk', emoji: '🚶', difficulty: 'medium', type: 'build', primaryStat: 'VIT' }]));
      set('hb_bosses_engagement_migrated', '1');
      set('hb_souls', JSON.stringify({ balance: 4860, lastDailyBonusDate: ymd }));
      Object.keys(ex || {}).forEach((k) => set(k, ex[k]));
    } catch (_) {}
  };
}

const HUNTER = {
  // every hidden quest the tower can fire already found, so no SYSTEM notice lands on the fight (the 13th fires 'The Thirteenth')
  hb_stirs_v1: JSON.stringify({ fired: { thirteenth_floor: 1, the_long_day: 1, century_stair: 1 }, dawns: {}, fragments: [] }),
  hb_dev_ults: '1', hb_ult_choice: 'storm', hb_ult_owned: JSON.stringify(['feast', 'hellfire', 'storm', 'arise']),
  hb_hunter_build: JSON.stringify({ slots: [null, null, null, 'titan_oathblade', null, null, null, null] }),
  hb_inventory: JSON.stringify({ cards: { titan_oathblade: { discovered: true, count: 1, first_acquired_date: '2026-09-20' } } }),
  hb_arena_v2: JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: 40, highestCleared: 39, wins: 44, losses: 6, streak: 5, bestStreak: 9,
    dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }),
  hb_stats: JSON.stringify({ STR: { pts: 2600 }, VIT: { pts: 2300 }, INT: { pts: 1900 }, FOCUS: { pts: 2200 }, WILL: { pts: 2000 }, WLT: { pts: 1500 } }),
};

const SCENES = {
  // A boss floor of the Ascent: the entrance, a few blows, Storm of Blades, the KO and the win.
  async battle(page, mark) {
    await page.click('#tab-profile'); await wait(900);
    await page.evaluate(() => document.getElementById('sc-arena-btn').click()); await wait(2200);
    await page.evaluate(() => document.querySelector('#arena-body [data-ar="fight"][data-floor="40"]').click());
    await page.waitForSelector('#arena-body [data-ar="introgo"]', { timeout: 8000 });
    await wait(900);
    mark('introgo');
    await page.click('#arena-body [data-ar="introgo"]');
    mark('entrance');
    await page.waitForSelector('#arena-body .ar-bmoves:not(.lock) [data-ar="move"]', { timeout: 20000 });
    await page.waitForFunction(() => { const s = window.__bfx && window.__bfx.state(); return !!s && s.lib === 'ready' && Object.values(s.json).every((v) => v === 'ready'); }, null, { timeout: 15000 }).catch(() => {});
    if (process.env.PROBE) { console.log(JSON.stringify(await page.evaluate(() => { const s = window.Arena._live.sess(); const o = {}; Object.keys(s).forEach((k) => { const v = s[k]; if (typeof v === 'number' || typeof v === 'boolean') o[k] = v; }); return o; }))); }
    // a staged demo fight: steady rolls, the boss hits soft, the hunter stays standing between turns
    const steady = () => page.evaluate(() => { const s = window.Arena._live.sess(); if (!s || s.done) return; s.rng = () => 0.5; s.bEff = 0.35; if (s.pMax < 900) s.pMax = 900; s.pHP = s.pMax; if (s.bHP < s.bMax * 0.6) s.bHP = Math.round(s.bMax * 0.6); window.Arena._live.paint(); });
    await steady();
    await wait(600);
    for (let i = 0; i < 3; i++) {
      try { await page.waitForSelector('#arena-body .ar-bmoves:not(.lock) [data-ar="move"]', { timeout: 20000 }); } catch (e) { await page.screenshot({ path: join(RAW, 'debug-move' + i + '.png') }); throw e; }
      await steady();
      mark('move' + (i + 1));
      await page.evaluate((k) => { const b = document.querySelectorAll('#arena-body .ar-bmoves:not(.lock) [data-ar="move"]'); (b[k] || b[0]).click(); }, i === 2 ? 1 : 0);
      await wait(400);
    }
    try { await page.waitForSelector('#arena-body .ar-bmoves:not(.lock) [data-ar="move"]', { timeout: 20000 }); } catch (e) { await page.screenshot({ path: join(RAW, 'debug-ult.png') }); console.log('STATE', JSON.stringify(await page.evaluate(() => { const s = window.Arena._live.sess(); return s ? { pHP: s.pHP, bHP: s.bHP, done: s.done, won: s.won, turn: s.turn } : null; }))); throw e; }
    await page.evaluate(() => { const s = window.Arena._live.sess(); s._surge = 1; s.bHP = Math.max(1, Math.round(s.bHP * 0.12)); window.Arena._live.paint(); });
    await wait(900);
    mark('ult');
    await page.click('#pkb-surge');
    await wait(12000);
    mark('ko');
    await wait(7000);
    mark('end');
  },
  // Erebus falls on 21,000 steps + 12 flights over three days, and drops the Mythic blade.
  async erebus(page, mark) {
    await wait(500);
    mark('result');
    await page.evaluate(() => window.__queueBossResult({ bossId: 'erebus_the_shadow_sovereign', bossName: 'Erebus, the Shadow Sovereign', rank: 'S', kill_count: 1,
      conditionLabel: '21,000 steps + 12 flights in 3 days', souls: 1600,
      drop: { cardId: 'nightfall_blade', name: 'Nightfall, Blade of the Shadow Sovereign', rarity: 'mythic', wasFirst: true }, mercy: null }));
    await wait(11000);
    mark('end');
  },
  // The S-rank dungeon: the boss cards and their totals.
  async cards(page, mark) {
    await page.click('#tab-quests'); await wait(900);
    await page.evaluate(() => { const c = document.querySelector('.gate-cell[data-gate-rank="S"]'); if (c) c.click(); });
    await wait(1500);
    mark('cards');
    await page.evaluate(() => window.scrollBy({ top: 260, behavior: 'smooth' }));
    await wait(2500);
    await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }));
    await wait(2500);
    mark('end');
  },
};

async function record(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true,
    serviceWorkers: 'block', timezoneId: 'America/Los_Angeles', colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.addInitScript(seedScript(), HUNTER);
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner,#fa-coachmark-overlay{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => { const r = document.head || document.documentElement; if (r && !document.getElementById('cap-kill')) { const s = document.createElement('style'); s.id = 'cap-kill'; s.textContent = css; r.appendChild(s); } };
    inject(); document.addEventListener('DOMContentLoaded', inject);
  });
  await page.goto(URL);
  await page.waitForSelector('#tab-profile', { timeout: 20000 });
  await wait(2600);
  await page.evaluate(() => { const s = document.getElementById('awakened-splash'); if (s) s.remove(); });

  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => { frames.push({ ts: metadata.timestamp, data }); cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * DSF, maxHeight: H * DSF, everyNthFrame: 1 });
  const marks = [];
  const mark = (m) => marks.push({ m, ts: Date.now() / 1000 });
  await wait(300);
  await SCENES[name](page, mark);
  const stopTs = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await ctx.close();

  const TMP = join(RAW, '_' + name);
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  const first = frames[0].ts;
  let list = '';
  frames.forEach((f, i) => {
    const fn = `f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(TMP, fn), Buffer.from(f.data, 'base64'));
    const next = frames[i + 1] ? frames[i + 1].ts : Math.max(f.ts + 1 / 30, stopTs);
    list += `file '${fn}'\nduration ${Math.max(0.005, next - f.ts).toFixed(4)}\n`;
  });
  list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
  writeFileSync(join(TMP, 'list.txt'), list);
  const out = join(RAW, name + '.mp4');
  await new Promise((res, rej) => {
    const ff = spawn('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(TMP, 'list.txt'),
      '-vf', 'fps=30,scale=1080:1920:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '15', '-preset', 'slow', '-movflags', '+faststart', out],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; ff.stderr.on('data', (d) => { err += d; });
    ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg: ' + err.slice(-600)))));
  });
  rmSync(TMP, { recursive: true, force: true });
  const rel = marks.map((x) => ({ m: x.m, t: +(x.ts - first).toFixed(3) }));
  writeFileSync(join(RAW, name + '.marks.json'), JSON.stringify({ frames: frames.length, seconds: +(stopTs - first).toFixed(2), marks: rel }, null, 1));
  console.log(name, frames.length, 'frames', (stopTs - first).toFixed(1) + 's', JSON.stringify(rel));
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  const server = spawn(process.execPath, [join(ROOT, 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await wait(1200);
  let browser;
  for (const channel of ['msedge', 'chrome', undefined]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch (_) { /* next */ } }
  try {
    const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
    for (const n of names) await record(browser, n);
  } finally { await browser.close(); server.kill(); }
}
main().catch((e) => { console.error('CAPTURE FAILED:', e); process.exit(1); });
