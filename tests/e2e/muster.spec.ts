/**
 * Awakened — The Muster (W1255): the Worldgate and the Raids in one sheet.
 *
 * Owner 2026-11-20: "It would also be cool if there was a tab here that has the world gate boss and another tab that
 * you can see raid performance per teams because these two are big team battles" → the Claude Design handoff
 * "The Muster - Worldgate + Raids" → "yes port the muster". Pinned here:
 *   - two tabs; Home's world boss bar opens Worldgate, the Raid gate opens Raids, the last tab is remembered;
 *   - Raids: your team first (pace bars, the six, one tag each, the left-behind line), the others ranked by progress,
 *     a team card opens into its members, recently finished raids;
 *   - not in a raid: the next draw counts real opens; no raids: the quiet card.
 */
import { test, expect, Page } from '@playwright/test';

const SUN = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();   // this week's gate
const WG = { at: Date.now(), week: SUN, hp: 1061723, pool: 658268, status: 'open', my: 14862, floor: 15000, souls: 200,
  hunters: 29, guild: { steps: 96412, hunters: 3 }, my_rank: 4, top: [{ alias: 'Kestrel', steps: 41880, rank_tier: 'S' }],
  wall: [], wall_count: 0, recent: [{ alias: 'Thane', steps: 1204 }], rallied: false, kill: null, days_needed: 0, my_days: 3, waiting: 0 };

async function boot(page: Page) {
  await page.addInitScript(([wg]: [Record<string, unknown>]) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const st = document.createElement('style'); st.id = 'e2e-splash-kill'; st.textContent = css; root.appendChild(st); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__mu')) return; sessionStorage.setItem('__mu', '1');
      ['hb_onboarding_seen_v2', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_bosses_engagement_migrated', 'hb_welcomed'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_name', 'Richie');
      localStorage.setItem('hb_habits', JSON.stringify([{ id: 'mu-read', name: 'Read', emoji: '•', difficulty: 'easy', type: 'build' }]));
      const d = new Date();
      localStorage.setItem('hb_daily_insight_last_shown', d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
      localStorage.setItem('hb_worldgate_v1', JSON.stringify({ ...wg, at: Date.now() }));
      localStorage.setItem('hb_crown_roster_v1', JSON.stringify({ at: Date.now(), list: [{ alias: 'Richie', role: 'owner' }, { alias: 'RenDIESEL', role: 'mod' }] }));   // W1256
    } catch (_) { /* noop */ }
  }, [WG] as [Record<string, unknown>]);
  await page.goto('/');
  await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
}

const H = 3_600_000;
function feed(kind: 'in' | 'out' | 'none', waiting = false) {
  const now = Date.now(), starts = new Date(now - 41 * H).toISOString(), ends = new Date(now + 39 * H).toISOString();
  const m = (alias: string, rank: string, steps: number, flights: number, x: Record<string, unknown> = {}) => ({ alias, rank, steps, flights, ...x });
  const raids = kind === 'none' ? [] : [
    { id: 'kestrel', mine: false, starts_at: starts, ends_at: ends, banked_steps: 0, banked_flights: 0, ...(waiting ? { waiting: true } : {}),
      members: [m('Kestrel', 'S', 46395, 26), m('Oriel', 'A', 11177, 14), m('Thane', 'B', 9189, 8), m('Vey', 'C', 0, 0), m('Lumen', 'D', 0, 0), m('Sable', 'B', 0, 0)] },
    { id: 'mine', mine: kind === 'in', starts_at: starts, ends_at: ends, banked_steps: 4210, banked_flights: 0, ...(waiting ? { waiting: true } : {}),
      members: [m('Richie', 'B', 10281, 12, kind === 'in' ? { me: true } : {}), m('Marrow', 'A', 8171, 10), m('Pike', 'C', 5143, 6),
        m('Ashby', 'D', 0, 0, { away: true }), m('Corin', 'B', 0, 0, { sub: true }), m('Wren', 'E', 0, 0)] },
  ];
  return { ok: true, boss_id: 'the_grinning_god', goal_steps: 200000, goal_flights: 200, window_hours: 80, raids,
    finished: [{ won: true, hours: 61, mvp: 'Kestrel', pct: 100, at: '2026-11-17T20:00:00Z' }, { won: false, hours: null, mvp: null, pct: 74, at: '2026-11-15T08:00:00Z' }],
    draw: { opens: 3, need: 5, days: [true, false, true, false, false, false, true], in_raid: kind === 'in' } };
}
async function stubRaids(page: Page, kind: 'in' | 'out' | 'none', waiting = false) {
  await page.evaluate((f) => { (window as any).Auth.coopRaidsLive = async () => f; }, feed(kind, waiting));
}

test.describe('W1255 — Team Battles (the handoff named it The Muster)', () => {
  test('two tabs: Home\'s world boss bar opens Worldgate; switching shows Raids; the last tab is remembered', async ({ page }) => {
    await boot(page);
    await stubRaids(page, 'in');
    await page.evaluate(() => (window as any).__worldgate.open());
    const frame = page.locator('.mu-wrap .mu-frame');
    await expect(frame).toHaveAttribute('data-tab', 'wg');
    await expect(page.locator('.mu-eye')).toContainText('Team Battles');
    await expect(page.locator('[data-pane="wg"] .mu-foe h2')).not.toBeEmpty();
    await expect(page.locator('[data-pane="wg"] .mu-clock')).toContainText(/new boss rises/i);
    await expect(page.locator('[data-pane="wg"] .mu-share .mu-sv')).toContainText('Walk 138 more to be named on the Kill Wall');   // the true 15,000 rule
    await expect(page.locator('.mu-tab[data-mu-go="wg"] em')).toHaveText('62%');
    await page.locator('.mu-tab[data-mu-go="raids"]').click();
    await expect(frame).toHaveAttribute('data-tab', 'raids');
    await expect(page.locator('.mu-tab[data-mu-go="raids"] em')).toContainText('2 live');
    expect(await page.evaluate(() => localStorage.getItem('hb_muster_tab'))).toBe('raids');
    await page.locator('.mu-x').click();
    await expect(page.locator('.mu-wrap')).toHaveCount(0);
    // the Raid gate opens Raids
    await page.evaluate(() => (window as any).__openMembersHall());
    await expect(page.locator('.mu-wrap .mu-frame')).toHaveAttribute('data-tab', 'raids');
  });

  test('Raids, in a raid: your team first, its pace, its six with one tag each and what left; the others ranked; a card opens', async ({ page }) => {
    await boot(page);
    await stubRaids(page, 'in');
    await page.evaluate(() => (window as any).__muster.open('raids'));
    const team = page.locator('[data-pane="raids"] .mu-team');
    await expect(team).toBeVisible({ timeout: 8_000 });
    await expect(team.locator('.mu-tk')).toHaveText('Your team');
    await expect(team.locator('.mu-tr')).toHaveText('2nd of 2 teams');
    await expect(team.locator('.mu-tl b')).toHaveText('39h left');
    await expect(team.locator('.mu-pace.steps .mu-tag')).toHaveText('Behind');
    await expect(team.locator('.mu-pace.steps .mu-pv')).toContainText('27,805 / 200,000');   // 23,595 walked + 4,210 left behind
    await expect(team.locator('.mu-mem')).toHaveCount(6);
    await expect(team.locator('.mu-mt.mvp')).toHaveCount(1);
    await expect(team.locator('.mu-mem').filter({ hasText: 'ashby' }).locator('.mu-mt.away')).toHaveText('Away');
    await expect(team.locator('.mu-mem').filter({ hasText: 'corin' }).locator('.mu-mt.sub')).toHaveText('Stand-in');
    await expect(team.locator('.mu-left')).toContainText('From hunters who left: 4,210 steps');
    const card = page.locator('[data-pane="raids"] .mu-tc');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.mu-tn')).toHaveText("kestrel's team");
    await expect(card.locator('.mu-mk')).toHaveCount(6);
    await card.click();
    await expect(card).toHaveClass(/is-open/);
    await expect(card.locator('.mu-tbody .mu-mem')).toHaveCount(6);
    await card.click();
    await expect(card).not.toHaveClass(/is-open/);
    const fins = page.locator('[data-pane="raids"] .mu-fin');
    await expect(fins).toHaveCount(2);
    await expect(fins.first()).toContainText('Won');
    await expect(fins.first()).toContainText('61h');
    await expect(fins.nth(1)).toContainText('Time ran out');
    await expect(fins.nth(1)).toContainText('74%');
    const text = await page.locator('[data-pane="raids"]').innerText();
    expect(text).not.toMatch(/\bfell(ed)?\b/i);
  });

  test('Raids, not in a raid: the next draw counts real opens and every raid stays watchable; no raids: the quiet card', async ({ page }) => {
    await boot(page);
    await stubRaids(page, 'out');
    await page.evaluate(() => (window as any).__muster.open('raids'));
    const draw = page.locator('[data-pane="raids"] .mu-draw');
    await expect(draw).toBeVisible({ timeout: 8_000 });
    await expect(draw.locator('.mu-dn')).toContainText('3');
    await expect(draw.locator('.mu-dn')).toContainText('of 5 opens');
    await expect(draw.locator('.mu-days i.on')).toHaveCount(3);
    await expect(draw.locator('.mu-dc')).toHaveText('Open the app 5 times in 7 days to be drawn for the next raid.');
    await expect(page.locator('[data-pane="raids"] .mu-team')).toHaveCount(0);
    await expect(page.locator('[data-pane="raids"] .mu-tc')).toHaveCount(2);
    await page.locator('.mu-x').click();
    await expect(page.locator('.mu-wrap')).toHaveCount(0);
    await stubRaids(page, 'none');
    await page.evaluate(() => { localStorage.removeItem('hb_muster_raids_v1'); });
    await page.evaluate(() => (window as any).__muster.open('raids'));
    await expect(page.locator('[data-pane="raids"] .mu-quiet')).toContainText('The next raid forms when six active hunters are free.', { timeout: 8_000 });
    await expect(page.locator('.mu-tab[data-mu-go="raids"] em')).toHaveText('0 live');
  });

  // W1256 — owner 2026-11-20: "Make sure that me and rendisel have our crowns on these new screens as well"
  test('the owner and the moderator wear their crowns on every name on both tabs; nobody else does', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('hb_worldgate_v1')!);
      c.top = [{ alias: 'RenDIESEL', steps: 30112, rank_tier: 'A' }, { alias: 'Kestrel', steps: 18220, rank_tier: 'S' }];
      c.recent = [{ alias: 'Richie', steps: 900 }, { alias: 'Kestrel', steps: 400 }];
      c.wall = [{ alias: 'RenDIESEL' }, { alias: 'Kestrel' }]; c.wall_count = 2;
      localStorage.setItem('hb_worldgate_v1', JSON.stringify(c));
    });
    const f = feed('in') as any;
    f.raids[0].members[0].alias = 'RenDIESEL';   // the other team's leading walker
    f.finished[0].mvp = 'RenDIESEL';
    await page.evaluate((x) => { (window as any).Auth.coopRaidsLive = async () => x; }, f);
    await page.evaluate(() => (window as any).__worldgate.open());
    const wg = page.locator('[data-pane="wg"]');
    const crowns = (loc: any) => loc.locator('.name-crown').count();
    await expect(wg.locator('.mu-row').first()).toBeVisible({ timeout: 8_000 });
    expect(await crowns(wg.locator('.mu-row').filter({ hasText: 'richie' }))).toBe(1);   // Recent strikes
    expect(await crowns(wg.locator('.mu-row').filter({ hasText: 'kestrel' }))).toBe(0);
    await page.locator('[data-wg-tab="rank"]').click();
    await expect(wg.locator('.mu-hrow').first()).toBeVisible();
    expect(await crowns(wg.locator('.mu-hrow').filter({ hasText: 'rendiesel' }))).toBe(1);   // Top hunters
    expect(await crowns(wg.locator('.mu-hrow').filter({ hasText: 'kestrel' }))).toBe(0);
    await page.locator('[data-wg-tab="kill"]').click();
    expect(await crowns(wg.locator('.mu-wn').filter({ hasText: 'rendiesel' }))).toBe(1);   // the Kill Wall
    expect(await crowns(wg.locator('.mu-wn').filter({ hasText: 'kestrel' }))).toBe(0);
    await page.locator('.mu-tab[data-mu-go="raids"]').click();
    const rd = page.locator('[data-pane="raids"]');
    await expect(rd.locator('.mu-team')).toBeVisible({ timeout: 8_000 });
    expect(await crowns(rd.locator('.mu-team .mu-mem').filter({ hasText: 'richie' }))).toBe(1);   // your team
    expect(await crowns(rd.locator('.mu-team .mu-mem').filter({ hasText: 'marrow' }))).toBe(0);
    const card = rd.locator('.mu-tc');
    expect(await crowns(card.locator('.mu-tn'))).toBe(1);   // "rendiesel[crown]'s team"
    await expect(card.locator('.mu-tn')).toHaveText("rendiesel's team");
    await card.click();
    expect(await crowns(card.locator('.mu-tbody .mu-mem').filter({ hasText: 'rendiesel' }))).toBe(1);
    expect(await crowns(card.locator('.mu-tbody .mu-mem').filter({ hasText: 'oriel' }))).toBe(0);
    expect(await crowns(rd.locator('.mu-fin').first())).toBe(1);   // MVP rendiesel on a finished raid
    expect(await crowns(rd.locator('.mu-fin').nth(1))).toBe(0);
  });
});

// W1263 — owner 2026-11-20: short teams wait for hunters instead of closing (server W1262 sends waiting: true).
test.describe('W1263 — a team waiting for hunters', () => {
  test('your team and another team say they are waiting; the clock is stopped', async ({ page }) => {
    await boot(page);
    await stubRaids(page, 'in', true);
    await page.evaluate(() => (window as any).__muster.open('raids'));
    const team = page.locator('[data-pane="raids"] .mu-team');
    await expect(team).toBeVisible({ timeout: 8_000 });
    await expect(team.locator('.mu-tl b')).toHaveText('Waiting');
    await expect(team.locator('.mu-tl span')).toHaveText(/Clock stopped · 39h left/i);
    await expect(team.locator('.mu-wait')).toHaveText('Your team needs more hunters. The clock starts again when they join.');
    const card = page.locator('[data-pane="raids"] .mu-tc');
    await expect(card.locator('.mu-ttl')).toHaveText(/Waiting for hunters/i);
  });
  test('a running team shows its hours, never the waiting label', async ({ page }) => {
    await boot(page);
    await stubRaids(page, 'in');
    await page.evaluate(() => (window as any).__muster.open('raids'));
    await expect(page.locator('[data-pane="raids"] .mu-team .mu-tl b')).toHaveText('39h left', { timeout: 8_000 });
    await expect(page.locator('[data-pane="raids"] .mu-wait')).toHaveCount(0);
    await expect(page.locator('[data-pane="raids"] .mu-ttl.is-wait')).toHaveCount(0);
  });
});

// W1282 — owner 2026-11-22: "I want to create a grinning god raid hall of fame here just like this instead of how it look currently."
test.describe('W1282 — the Grinning God Hall of Fame', () => {
  const six = (lead: string, x: Record<string, unknown> = {}) => [
    { alias: lead, rank: 'S', mvp: true, ...x }, { alias: 'Oriel', rank: 'A' }, { alias: 'Thane', rank: 'B' },
    { alias: 'Vey', rank: 'C' }, { alias: 'Lumen', rank: 'D' }, { alias: 'Sable', rank: 'E' }];
  const hall = [
    { ms: 58 * H + 42 * 60_000, at: '2026-11-13T12:00:00Z', members: six('Kestrel') },
    { ms: 63 * H + 5 * 60_000, at: '2026-11-08T12:00:00Z', members: six('RenDIESEL') },
    { ms: 67 * H + 30 * 60_000, at: '2026-10-30T12:00:00Z', members: [{ alias: 'Richie', rank: 'B', me: true }, ...six('Marrow').slice(0, 5)] },
    { ms: 71 * H, at: '2026-10-21T12:00:00Z', members: six('Pike') },
    { ms: 76 * H + 9 * 60_000, at: '2026-10-11T12:00:00Z', members: six('Ashby') },
  ];
  test('five clears ranked by time; a row opens into its six with the MVP marked; one open at a time', async ({ page }) => {
    await boot(page);
    const f = { ...feed('in'), hall };
    await page.evaluate((x) => { (window as any).Auth.coopRaidsLive = async () => x; }, f);
    await page.evaluate(() => (window as any).__muster.open('raids'));
    const rd = page.locator('[data-pane="raids"]');
    const rows = rd.locator('.mu-hof .mu-hr');
    await expect(rows).toHaveCount(5, { timeout: 8_000 });
    await expect(rd.locator('.mu-sec').filter({ hasText: /Hall of Fame/i })).toHaveCount(1);
    await expect(rd.locator('.mu-sec').filter({ hasText: /Recently finished/i })).toHaveCount(0);
    await expect(rd.locator('.mu-fin')).toHaveCount(0);
    await expect(rows.first().locator('.mu-hp')).toHaveText('1');
    await expect(rows.first().locator('.mu-hp')).toHaveClass(/r1/);
    await expect(rows.first().locator('.mu-ht')).toHaveText('58h42m');
    await expect(rows.first()).toHaveClass(/p1/);
    await expect(rows.nth(1).locator('.mu-ht')).toHaveText('63h05m');
    await expect(rows.nth(3).locator('.mu-ht')).toHaveText('71h00m');
    await expect(rows.first().locator('.mu-hd')).toHaveText(/13 Nov/);
    await rows.first().click();
    await expect(rows.first()).toHaveClass(/is-open/);
    await expect(rows.first().locator('.mu-hn')).toHaveCount(6);
    await expect(rows.first().locator('.mu-hmvp')).toHaveCount(1);
    await expect(rows.first().locator('.mu-hn').filter({ has: page.locator('.mu-hmvp') })).toContainText(/kestrel/i);
    await expect(rows.first().locator('.mu-hmvp')).toHaveText('MVP');
    await rows.nth(1).click();   // RenDIESEL's six: the moderator wears the crown
    await expect(rows.nth(1)).toHaveClass(/is-open/);
    await expect(rows.first()).not.toHaveClass(/is-open/);
    expect(await rows.nth(1).locator('.mu-hn').filter({ hasText: /rendiesel/i }).locator('.name-crown').count()).toBe(1);
    expect(await rows.nth(1).locator('.mu-hn').filter({ hasText: /oriel/i }).locator('.name-crown').count()).toBe(0);
    await rows.nth(2).click();
    await expect(rows.nth(2).locator('.mu-hn.is-me')).toContainText(/richie/i);
    await rows.nth(2).click();
    await expect(rows.nth(2)).not.toHaveClass(/is-open/);
    const text = await rd.innerText();
    expect(text).not.toMatch(/\bfell(ed)?\b/i);
  });
  test('no win yet: the hall says so', async ({ page }) => {
    await boot(page);
    const f = { ...feed('out'), hall: [] };
    await page.evaluate((x) => { (window as any).Auth.coopRaidsLive = async () => x; }, f);
    await page.evaluate(() => (window as any).__muster.open('raids'));
    const rd = page.locator('[data-pane="raids"]');
    await expect(rd.locator('.mu-hof-empty')).toHaveText('No team has beaten The Grinning God yet. The first team to win is written here.', { timeout: 8_000 });
    await expect(rd.locator('.mu-hr')).toHaveCount(0);
    await expect(rd.locator('.mu-fin')).toHaveCount(0);
  });
});

// W1283 — owner 2026-11-22: "I want to have the world gate do the steps + flights HP bar + Sleep total ... So this worldgate will
// have all of these to complete to kill it", "the kill wall has to be % damage" and the bounty's 1% / 0.5% relic rolls.
test.describe('W1283 — the three-bar Worldgate', () => {
  const WG3 = {
    ...WG, hp: 1500000, pool: 600000, my: 12000, hunters: 31, my_rank: 4,
    guild: { steps: 50000, hunters: 2, pct: 3.1 },
    top: [{ alias: 'Kestrel', steps: 90000, flights: 200, sleep: 3000, pct: 9.4, rank_tier: 'S' }, { alias: 'RenDIESEL', steps: 70000, flights: 40, sleep: 2400, pct: 4.6, rank_tier: 'A' }],
    wall: [{ alias: 'Kestrel', steps: 90000, pct: 9.4 }], wall_count: 1, my_days: 3,
    bars: { steps: { hp: 1500000, pool: 600000, my: 12000 }, flights: { hp: 1500, pool: 420, my: 30 }, sleep: { hp: 36000, pool: 9000, my: 1200 } },
    pct3: 31.0, my_pct: 1.6, wall_pct: 0.5, wait_f: 0, wait_s: 0, odds: { s_tier: 0.01, mythic: 0.005 },
  };
  async function boot3(page: Page, extra: Record<string, unknown> = {}) {
    await boot(page);
    await page.evaluate((c) => { localStorage.setItem('hb_worldgate_v1', JSON.stringify({ ...c, at: Date.now() })); (window as any).__worldgate(); }, { ...WG3, ...extra });
  }
  // W1323 — owner 2026-11-25: "the sleep shouldn't be at 313h / 300h. It should hit the 300h and stop". The server caps it
  // now; the sheet caps it too (a kill frozen before W1323 can still carry a bar past its HP).
  test('a bar past its HP reads its HP: 300h / 300h, DONE', async ({ page }) => {
    await boot3(page, { bars: { steps: { hp: 1274068, pool: 675875, my: 18139 }, flights: { hp: 750, pool: 663, my: 27 }, sleep: { hp: 18000, pool: 18780, my: 0 } } });
    await page.evaluate(() => (window as any).__muster.open('wg'));
    const wg = page.locator('[data-pane="wg"]');
    await expect(wg.locator('.mu-wgbar.sleep .mu-pv')).toHaveText('300h / 300h', { timeout: 8_000 });
    await expect(wg.locator('.mu-wgbar.sleep .mu-tag')).toContainText(/done/i);
    await expect(wg.locator('.mu-wgbar.steps .mu-pv')).toHaveText('675,875 / 1,274,068');
  });
  test('three bars, the gate\'s damage and yours, every list by damage, the Kill tab in % with the bounty\'s odds', async ({ page }) => {
    await boot3(page);
    await page.evaluate(() => (window as any).__muster.open('wg'));
    const wg = page.locator('[data-pane="wg"]');
    await expect(wg.locator('.mu-wgbar')).toHaveCount(3, { timeout: 8_000 });
    await expect(wg.locator('.mu-wgbar.steps .mu-pv')).toHaveText('600,000 / 1,500,000');
    await expect(wg.locator('.mu-wgbar.flights .mu-pv')).toHaveText('420 / 1,500');
    await expect(wg.locator('.mu-wgbar.sleep .mu-pv')).toHaveText('150h / 600h');
    await expect(wg.locator('.mu-wgbar.flights .mu-tag')).toHaveText('28%');
    await expect(wg.locator('.mu-bars-n')).toHaveText(/All three bars must be emptied/i);
    await expect(wg.locator('.mu-total .mu-big b')).toHaveText('31.0%');
    await expect(wg.locator('.mu-total .mu-lab')).toHaveText(/Damage dealt · 31 hunters/i);
    await expect(wg.locator('.mu-rule')).toContainText('hour of sleep');
    await expect(wg.locator('.mu-hpn')).toContainText('31.0% down');
    await expect(wg.locator('.mu-share .mu-rv b')).toHaveText('1.6%');
    await expect(wg.locator('.mu-share .mu-sv')).toContainText('Kill Wall secured');
    await expect(wg.locator('.mu-sparts')).toHaveText('12,000 steps · 30 flights · 20h sleep');
    await page.locator('[data-wg-tab="rank"]').click();
    await expect(wg.locator('.mu-hrow').first().locator('.a')).toHaveText('9.4%');
    await page.locator('[data-wg-tab="kill"]').click();
    await expect(wg.locator('.mu-kill')).toContainText('Deal 0.5% of the damage before Sunday');
    await expect(wg.locator('.mu-kill')).toContainText('with a 1% chance at an S-rank relic and 0.5% at a mythic weapon');
    await expect(wg.locator('.mu-kill')).toContainText('The three who dealt the most damage when it falls');
    await expect(page.locator('#wg-pulse .wg-pulse-pct')).toHaveText('31.0%');
    const text = await wg.innerText();
    expect(text).not.toMatch(/\bfell(ed)?\b/i);
  });
  // W1290 — owner 2026-11-23: "Richie struck the gate +4,186 steps and +7 flights / Ricin ... +7,000 steps, +2 flights,
  // 7 hours of sleep / Karen +500 steps" — and no sleep for a hunter without sleep data
  test('each strike says what it hit with; a part that is 0 is left out', async ({ page }) => {
    await boot3(page, { recent: [
      { alias: 'Richie', steps: 4186, flights: 7, sleep: 0 },
      { alias: 'ricin', steps: 7000, flights: 2, sleep: 420 },
      { alias: 'Karen', steps: 500, flights: 0, sleep: 0 },
      { alias: 'owl', steps: 1, flights: 1, sleep: 45 },
      { alias: 'Thane', steps: 1204 },   // a kill frozen before W1290: steps only
    ] });
    await page.evaluate(() => (window as any).__muster.open('wg'));
    const rows = page.locator('[data-pane="wg"] .mu-row');
    await expect(rows).toHaveCount(5, { timeout: 8_000 });
    await expect(rows.nth(0).locator('.mu-hit')).toHaveText('+4,186 steps and +7 flights');
    await expect(rows.nth(1).locator('.mu-hit')).toHaveText('+7,000 steps, +2 flights, 7 hours of sleep');
    await expect(rows.nth(2).locator('.mu-hit')).toHaveText('+500 steps');
    await expect(rows.nth(3).locator('.mu-hit')).toHaveText('+1 step, +1 flight, 45 min of sleep');
    await expect(rows.nth(4).locator('.mu-hit')).toHaveText('+1,204 steps');
    await expect(rows.nth(1)).toContainText('struck the gate');
    expect(await page.evaluate(() => (window as any).__wgStrikeHit({ steps: 9000, sleep: 465 }))).toBe('+9,000 steps and 7.8 hours of sleep');
  });
  // W1291 — owner 2026-11-23: "have the R colored the color of the person's rank" and "flights and steps and sleep had
  // different colors differentiating the three"
  test('a strike circle wears the rank colour; steps, flights and sleep each wear their bar colour', async ({ page }) => {
    await boot3(page, { recent: [
      { alias: 'ricin', steps: 7000, flights: 2, sleep: 420, rank_tier: 'C' },
      { alias: 'galilea', steps: 8339, rank_tier: 'A' },
      { alias: 'Thane', steps: 1204 },   // no rank sent: the E colour
      { alias: 'Richie', steps: 4186, flights: 6, rank_tier: 'S+' },
      { alias: 'nicole', steps: 12460, rank_tier: 'D' },
      { alias: 'anthony', steps: 15702, rank_tier: 'B' },
    ] });
    await page.evaluate(() => (window as any).__muster.open('wg'));
    const rows = page.locator('[data-pane="wg"] .mu-row');
    await expect(rows).toHaveCount(6, { timeout: 8_000 });
    const rc = (i: number) => rows.nth(i).locator('.mu-av').evaluate((el) => getComputedStyle(el).color);
    expect(await rc(0)).toBe('rgb(52, 211, 153)');    // C
    expect(await rc(1)).toBe('rgb(239, 68, 68)');     // A, the leaderboard's red
    expect(await rc(2)).toBe('rgb(139, 92, 246)');    // E
    const hit = rows.nth(0).locator('.mu-hit');
    await expect(hit).toHaveText('+7,000 steps, +2 flights, 7 hours of sleep');
    await expect(hit.locator('.mu-h-steps')).toHaveText('+7,000 steps');
    await expect(hit.locator('.mu-h-flights')).toHaveText('+2 flights');
    await expect(hit.locator('.mu-h-sleep')).toHaveText('7 hours of sleep');
    const col = (sel: string) => hit.locator(sel).evaluate((el) => getComputedStyle(el).color);
    expect(await col('.mu-h-steps')).toBe('rgb(74, 222, 128)');
    expect(await col('.mu-h-flights')).toBe('rgb(245, 158, 11)');
    expect(await col('.mu-h-sleep')).toBe('rgb(167, 139, 250)');
    await expect(rows.nth(1).locator('.mu-hit b')).toHaveCount(1);   // steps only: no flights or sleep part
    if (process.env.LB_SHOTS) { await rows.nth(0).scrollIntoViewIfNeeded(); await page.waitForTimeout(900); await page.screenshot({ path: process.env.LB_SHOTS + '/wg-strike-colours.png' }); }
  });
  test('under 0.5% the card says what is left; under two days everything waits', async ({ page }) => {
    await boot3(page, { my_pct: 0.2, my_rank: 20 });
    await page.evaluate(() => (window as any).__muster.open('wg'));
    const wg = page.locator('[data-pane="wg"]');
    await expect(wg.locator('.mu-share .mu-sv')).toHaveText('0.2% of the kill so far. Reach 0.5% to be named on the Kill Wall.', { timeout: 8_000 });
    await page.evaluate(() => (window as any).__muster.close && (window as any).__muster.close());
    await page.evaluate((c) => { localStorage.setItem('hb_worldgate_v1', JSON.stringify({ ...c, at: Date.now(), days_needed: 2, my_days: 1, my_pct: 0, waiting: 4200, wait_f: 12, wait_s: 840 })); }, WG3);
    await page.evaluate(() => (window as any).__muster.open('wg'));
    await expect(wg.locator('.mu-share .mu-sv')).toContainText('Your steps, flights and sleep count once you open the app on 2 days this week.', { timeout: 8_000 });
    await expect(wg.locator('.mu-share .mu-sv')).toContainText('4,200 steps, 12 flights, 14h sleep waiting');
    await expect(wg.locator('.mu-share button')).toHaveText('Counts from day 2');
  });
  test('sleep counts one source per night; the S-rank pool has no mythic; a bounty roll grants the relic', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const w = (window as any).__wg3;
      const t0 = Date.parse('2026-11-30T08:00:00Z');
      const s = (src: string, startH: number, hours: number) => ({ startDate: new Date(t0 + startH * 3600e3).toISOString(), duration: hours, sleepState: 'Asleep', sourceBundleId: src });
      const samples = [s('com.apple.health.watch', 0, 7), s('com.ouraring.oura', 0, 8), s('com.apple.health.watch', 20, 3)];
      const night = w.sleepMin(samples, t0 - 2 * 3600e3, t0 + 10 * 3600e3);   // Apple's 7h, not 15h, not Oura's 8h
      const clipped = w.sleepMin(samples, t0 + 5 * 3600e3, t0 + 10 * 3600e3);   // 2h of the watch's night left inside
      const pool = w.sTierPool();
      const got = w.grant('mythic');
      const s1 = w.grant('s_tier');
      return { night, clipped, pool, got: got && got.id, rarity: got && got.rarity, s1: s1 && s1.id, s1r: s1 && s1.rarity };
    });
    expect(r.night).toBe(7 * 60);
    expect(r.clipped).toBe(2 * 60);
    expect(r.pool.length).toBeGreaterThan(5);
    for (const id of ['nightfall_blade', 'reverie_staff', 'vigil_bow']) expect(r.pool).not.toContain(id);
    expect(['nightfall_blade', 'reverie_staff', 'vigil_bow']).toContain(r.got);
    expect(r.rarity).toBe('mythic');
    expect(r.pool).toContain(r.s1);
    expect(['rare', 'ultra_rare']).toContain(r.s1r);
  });
});
