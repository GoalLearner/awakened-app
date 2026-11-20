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
function feed(kind: 'in' | 'out' | 'none') {
  const now = Date.now(), starts = new Date(now - 41 * H).toISOString(), ends = new Date(now + 39 * H).toISOString();
  const m = (alias: string, rank: string, steps: number, flights: number, x: Record<string, unknown> = {}) => ({ alias, rank, steps, flights, ...x });
  const raids = kind === 'none' ? [] : [
    { id: 'kestrel', mine: false, starts_at: starts, ends_at: ends, banked_steps: 0, banked_flights: 0,
      members: [m('Kestrel', 'S', 46395, 26), m('Oriel', 'A', 11177, 14), m('Thane', 'B', 9189, 8), m('Vey', 'C', 0, 0), m('Lumen', 'D', 0, 0), m('Sable', 'B', 0, 0)] },
    { id: 'mine', mine: kind === 'in', starts_at: starts, ends_at: ends, banked_steps: 4210, banked_flights: 0,
      members: [m('Richie', 'B', 10281, 12, kind === 'in' ? { me: true } : {}), m('Marrow', 'A', 8171, 10), m('Pike', 'C', 5143, 6),
        m('Ashby', 'D', 0, 0, { away: true }), m('Corin', 'B', 0, 0, { sub: true }), m('Wren', 'E', 0, 0)] },
  ];
  return { ok: true, boss_id: 'the_grinning_god', goal_steps: 200000, goal_flights: 200, window_hours: 80, raids,
    finished: [{ won: true, hours: 61, mvp: 'Kestrel', pct: 100, at: '2026-11-17T20:00:00Z' }, { won: false, hours: null, mvp: null, pct: 74, at: '2026-11-15T08:00:00Z' }],
    draw: { opens: 3, need: 5, days: [true, false, true, false, false, false, true], in_raid: kind === 'in' } };
}
async function stubRaids(page: Page, kind: 'in' | 'out' | 'none') {
  await page.evaluate((f) => { (window as any).Auth.coopRaidsLive = async () => f; }, feed(kind));
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
