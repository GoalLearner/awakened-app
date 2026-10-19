// shoot.mjs — capture the REAL app's screens for the 3.0.7 App Store set.
//   node marketing/aso-3.0.7/shoot.mjs [name ...]   -> marketing/aso-3.0.7/raw/<name>.png (1320×2691)
// Boots the app from this repo on its own port (8091), seeds a demo hunter
// (made-up names only — never a real user's alias), drives each scene through
// the app's own preview / QA hooks, and screenshots at iPhone 16 Pro Max size
// (440 wide at 3×, below the status bar). compose.mjs then frames these with the headlines.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RAW = join(HERE, 'raw');
const PORT = 8091;
const URL = `http://localhost:${PORT}/`;

const day = (off) => new Date(Date.now() - off * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// The demo hunter. Vows read like a real, good routine.
const VOWS = [   // library vows, so each wears its painted icon
  { id: 'v-walk', name: 'Daily walk', emoji: '🚶', difficulty: 'medium', type: 'build', primaryStat: 'VIT' },
  { id: 'v-sun', name: 'Get morning sunlight', emoji: '☀️', difficulty: 'easy', type: 'build', primaryStat: 'FOCUS' },
  { id: 'v-read', name: 'Read', emoji: '📖', difficulty: 'easy', type: 'build', primaryStat: 'INT' },
  { id: 'v-cold', name: 'Cold shower', emoji: '🚿', difficulty: 'medium', type: 'build', primaryStat: 'STR' },
  { id: 'v-lift', name: 'Workout', emoji: '🏋️', difficulty: 'hard', type: 'build', primaryStat: 'STR' },
  { id: 'v-med', name: 'Meditate & Breathwork', emoji: '🧘', difficulty: 'easy', type: 'build', primaryStat: 'FOCUS' },
];
function completions() {
  const c = {};
  for (let i = 1; i <= 20; i++) c[day(i)] = VOWS.map((v) => v.id).filter((_, k) => (i + k) % 7 !== 0);
  c[day(0)] = ['v-walk', 'v-sun', 'v-read'];   // mid-morning: three sealed, three to go
  return c;
}

function seedScript(extra) {
  return ([vows, comp, ex]) => {
    try {
      localStorage.clear();
      const set = (k, v) => localStorage.setItem(k, v);
      set('hb_onboarding_seen_v2', '1'); set('hb_welcomed', '1'); set('hb_hunter_name_claimed', '1');
      set('hb_cloud_restore_dismissed', '1'); set('hb_whats_new_seen', '99.99.99');
      const d = new Date(); const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      set('hb_fri_banner_' + ymd, '1'); set('hb_daily_insight_last_shown', ymd);
      ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => set(k, '1'));
      set('hb_onboarding_first_xp_date', '2026-07-01');
      set('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      set('hb_name', 'Kael');
      set('hb_points', '2140');
      set('hb_habits', JSON.stringify(vows));
      set('hb_completions', JSON.stringify(comp));
      // a lived-in hunter: a Steel Wolf hunt under way, nine bosses slain, a world rank
      const now = Date.now();
      set('hb_bosses', JSON.stringify({
        the_steel_wolf: { engaged: true, engaged_at: new Date(now - 5 * 3600e3).toISOString(), hunt_started_at: now - 5 * 3600e3, step_progress: 4630, kill_count: 2 },
        the_insomniac: { kill_count: 3 }, the_iron_warden: { kill_count: 2 }, the_patient_flame: { kill_count: 2 },
      }));
      const o = new Date(now - 47 * 86400000);   // day 48 of the journey (the briefing's DAY N)
      set('hb_origin_beginning', JSON.stringify({ migrated: true, text: 'Kael was nothing yet. But on this day he made the only choice that matters: to begin.',
        dateISO: o.getFullYear() + '-' + String(o.getMonth() + 1).padStart(2, '0') + '-' + String(o.getDate()).padStart(2, '0'),
        dateDisplay: o.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }));
      set('hb_bosses_engagement_migrated', '1');   // else the one-time migration clears the seeded hunt
      set('hb_souls', JSON.stringify({ balance: 4860, lastDailyBonusDate: ymd }));
      set('hb_lb_cache_step_total', JSON.stringify({ fetched_at: now, top: [], me: { rank: 12, current_value: 38420, alias: 'Kael' } }));
      Object.keys(ex || {}).forEach((k) => set(k, ex[k]));
    } catch (_) {}
  };
}

async function boot(browser, extra) {
  const ctx = await browser.newContext({
    // 956 minus the 59pt status bar compose.mjs draws above it
    viewport: { width: 440, height: 897 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    serviceWorkers: 'block', timezoneId: 'America/Los_Angeles', colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.addInitScript(seedScript(), [VOWS, completions(), extra || {}]);
  await page.goto(URL);
  await page.waitForSelector('#tab-profile', { timeout: 20000 });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const s = document.getElementById('awakened-splash'); if (s) s.remove();
    ['wn-overlay', 'wn-modal', 'modal-overlay', 'welcome-overlay', 'fri-challenge-modal', 'cin-onboarding', 'fa-coachmark-overlay'].forEach((id) => {
      const el = document.getElementById(id); if (el && !el.classList.contains('hidden')) el.classList.add('hidden');
    });
  });
  return { ctx, page };
}

const skip = (page) => page.mouse.click(30, 30);   // the results screens skip to their end on a tap
const SCENES = {
  async habits(page) {
    await page.click('#tab-habits');
    await page.waitForTimeout(1200);
  },
  async victory(page) {
    await page.evaluate(() => window.__queueBossResult({ bossId: 'the_steel_wolf', bossName: 'The Steel Wolf', rank: 'E', kill_count: 1,
      conditionLabel: 'Walk 6,000+ steps in a single day', souls: 120, drop: { cardId: 'x', name: 'Fang of the Pack', rarity: 'rare', wasFirst: false }, mercy: null }));
    await page.waitForSelector('#boss-result-overlay .hr-frame', { timeout: 8000 });
    await page.waitForTimeout(600); await skip(page); await page.waitForTimeout(1800);

  },
  async coop(page) {
    await page.evaluate(() => window.__queueBossResult({ bossId: 'the_twin_maw', bossName: 'The Twin Maw', rank: 'E', kill_count: 3, souls: 360,
      drop: { cardId: 'x', name: 'Bramble Wardplate', rarity: 'rare', wasFirst: false }, mercy: null,
      coop: { party: [{ n: 'Mara', s: 14210, f: 0 }, { n: 'Kael', s: 11840, f: 0, you: true }, { n: 'Soren', s: 7900, f: 0 }],
        goal: 30000, fgoal: 0, unit: 'steps', mvp: 'Mara', pact: null, fed: true, time: '19h 05m' } }));
    await page.waitForSelector('#boss-result-overlay .hr-frame', { timeout: 8000 });
    await page.waitForTimeout(600); await skip(page); await page.waitForTimeout(1800);
  },
  async mvp(page) {
    await page.evaluate(() => window.__wgm.show({ boss: 'The Drowned Abbot', hunters: 41, pool: 1284000, fell: 'Sat 26 Sep',
      mvps: [{ alias: 'Kael', rank: 'C', steps: 48210 }, { alias: 'Mara', rank: 'B', steps: 41377 }, { alias: 'Soren', rank: 'D', steps: 36902 }],
      you: 1, meSteps: 48210, mePos: 1, bonus: [150, 100, 50], bounty: 200 }));
    await page.waitForTimeout(5200);
  },
  async briefing(page) {
    await page.evaluate(() => window.__previewTodaysBriefing());
    await page.waitForTimeout(3200);
  },
  async rank(page) {
    await page.evaluate(() => window.__previewRankCelebrations());
    await page.waitForTimeout(7500);
  },
  // 2026-10-19 (3.0.14 set, App Review 2.3.3): every frame a real screen. The Tower and the Items tab.
  async tower(page) {
    await page.click('#tab-profile');
    await page.waitForTimeout(900);
    await page.evaluate(() => document.getElementById('sc-arena-btn').click());
    await page.waitForTimeout(3000);
  },
  async relics(page) {
    await page.click('#tab-items');
    await page.waitForTimeout(1500);
    // fold the mega-rare row (all locked), open the ultra-rare relics (owned ones show their art)
    await page.evaluate(() => {
      const t = (k) => document.querySelector('[data-section-toggle="' + k + '"]');
      const m = t('mythic'); if (m && m.getAttribute('aria-expanded') === 'true') m.click();
      const u = t('ultra_rare'); if (u && u.getAttribute('aria-expanded') !== 'true') u.click();
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => { const sec = document.querySelector('.pokedex-section--mythic'); if (sec) sec.scrollIntoView({ block: 'start' }); });
    await page.waitForTimeout(1200);
  },
};
// Extra seeds per scene (on top of the demo hunter).
const OWNED = ['trail_worn_boots', 'pendant_of_the_wakeful', 'sleepwalkers_cloak', 'alphas_mantle', 'titan_oathblade', 'crown_of_deep_rest',
  'glass_path_boots', 'wardens_plate', 'crown_of_the_ascendant', 'greaves_of_the_endless_road', 'ashen_monarchs_cape', 'keystone_pendant',
  'ten_thousand_step_blade', 'amulet_of_the_kept_word', 'gauntlets_of_ten_thousand_days', 'boots_of_the_long_road'];
const SEEDS = {
  tower: {
    hb_ascent_opening_seen_v1: '1',
    hb_arena_v2: JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: 38, highestCleared: 37, wins: 41, losses: 6, streak: 5, bestStreak: 9,
      dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }),
    hb_stats: JSON.stringify({ STR: { pts: 2400 }, VIT: { pts: 2200 }, INT: { pts: 1900 }, FOCUS: { pts: 2100 }, WILL: { pts: 2000 }, WLT: { pts: 1500 } }),
  },
  relics: {
    hb_tour_items_v1: '1', hb_tour_quests_v1: '1',
    hb_inventory: JSON.stringify({ cards: Object.fromEntries(OWNED.map((id, i) => [id, { discovered: true, count: 1, first_acquired_date: '2026-09-' + String(10 + (i % 18)).padStart(2, '0') }])) }),
  },
};

async function main() {
  mkdirSync(RAW, { recursive: true });
  const server = spawn(process.execPath, [join(ROOT, 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  let browser;
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch (_) { /* next */ }
  }
  try {
    const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
    for (const name of names) {
      const { ctx, page } = await boot(browser, SEEDS[name]);
      await SCENES[name](page);
      await page.screenshot({ path: join(RAW, name + '.png') });
      console.log('saved raw/' + name + '.png');
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
}
main().catch((e) => { console.error('SHOOT FAILED:', e); process.exit(1); });
