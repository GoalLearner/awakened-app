/**
 * Awakened — the half-each duo bosses (W1339 server, W1340 app). Owner 2026-11-26: "one player can't carry the
 * load so it has to be a 50/50 split and when one player does his share ... the other player must complete his
 * portion for this to be rewarded." Each hunter must finish their own half; one hunter's extra never counts for
 * the other. These specs drive the real co-op screens against a stubbed hunt list (the coop-auto.spec pattern).
 */
import { test, expect, Page } from '@playwright/test';

const H = 3_600_000;

function inst(o: { id: string; boss: string; rank: string; goal: number; mine: number; theirs: number; status?: string; result?: string | null; flights?: boolean; award?: { owed: boolean; claimed: boolean } }): Record<string, unknown> {
  const now = Date.now();
  const status = o.status ?? 'active';
  const live = status === 'active';
  return {
    id: o.id,
    boss_id: o.boss,
    boss_rank: o.rank,
    metric: o.flights ? 'flights' : 'steps',
    status,
    result: o.result ?? null,
    role: 'challenger',
    auto: false,
    ...(o.award ? { award: o.award } : {}),
    goal_steps: o.goal,
    half_each: true,
    share_goal: Math.ceil(o.goal / 2),
    reward_souls: o.rank === 'S' ? 800 : 400,
    party_size: 2,
    party: [
      { user_id: 'me', alias: 'richie', role: 'challenger', steps: o.mine, joined: true },
      { user_id: 'f1', alias: 'anthony', role: 'ally', steps: o.theirs, joined: true },
    ],
    combined_steps: o.mine + o.theirs,
    challenger: { user_id: 'me', alias: 'richie', steps: o.mine },
    partner: { user_id: 'f1', alias: 'anthony', steps: o.theirs },
    starts_at: new Date(now - 6 * H).toISOString(),
    ends_at: new Date(now + (live ? 18 : -1) * H).toISOString(),
    time_remaining_ms: live ? 18 * H : null,
    resolved_at: live ? null : new Date(now - 0.5 * H).toISOString(),
    created_at: '2026-11-27 08:00:00',
    updated_at: '2026-11-27 08:00:00',
  };
}

async function boot(page: Page, instances: Record<string, unknown>[], rankXp = 0) {
  await page.addInitScript((a: { instances: Record<string, unknown>[]; xp: number }) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) {
        const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s);
      }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    (window as any).__shadowDice = () => 1;
    (window as any).__weekJackpotDice = () => 1;
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_coop_ever'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      if (a.xp) localStorage.setItem('hb_points', String(a.xp));
    } catch (_) { /* noop */ }
    const calls = { resolve: [] as string[] };
    (window as any).__coopCalls = calls;
    const patch = (au: any) => {
      if (!au || au.__w1340Patched) return;
      au.__w1340Patched = true;
      au.getBackendUserId = () => 'me';
      au.isMember = () => true;
      au.coopBossList = async () => ({ ok: true, instances: a.instances, auto_off: [] });
      au.coopBossGet = async (id: string) => ({ ok: true, instance: a.instances.find((i: any) => i.id === id) });
      au.coopBossResolve = async (id: string) => {
        calls.resolve.push(id);
        const it: any = a.instances.find((i: any) => i.id === id);
        // like the server (W1339): the kill only when EVERY hunter reached their own share
        const won = it && it.status === 'active' && it.party.every((p: any) => p.steps >= it.share_goal);
        return { ok: true, resolved: !!won, instance: won ? { ...it, status: 'completed', result: 'success', time_remaining_ms: null } : it };
      };
      au.coopBossClaim = async () => ({ ok: true, first: true });
      au.submitVerifiedEvents = async () => ({ ok: true });
      au.coopPacts = async () => ({ ok: true, day: '', pacts: {} });
    };
    let real: any;
    Object.defineProperty(window, 'Auth', {
      configurable: true,
      get() { return real; },
      set(v) { real = v; try { patch(v); } catch (_) { /* noop */ } },
    });
  }, { instances, xp: rankXp });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

async function openHunt(page: Page, id: string) {
  await page.evaluate(() => (window as any).__coopOpenDashboard());
  await page.locator('[data-coop-hunt="' + id + '"]').click();
  await expect(page.locator('.chd-battle')).toBeVisible({ timeout: 10_000 });
}

test.describe('Half-each duo bosses (W1340)', () => {
  test('the battle screen counts each hunter only up to their half, and names who is done', async ({ page }) => {
    await boot(page, [inst({ id: 'h1', boss: 'the_yoked_wanderers', rank: 'A', goal: 12000, mine: 10000, theirs: 2000 })]);
    await openHunt(page, 'h1');
    await expect(page.locator('.chd-big b')).toHaveText('8,000');       // 6,000 of my 10,000 counts, + their 2,000
    await expect(page.locator('.chd-big')).toContainText('/ 12,000');
    const shares = page.locator('.chd-row .chd-share');
    await expect(shares).toHaveText(['Done', '4,000 to go']);
    await expect(page.locator('.chd-row .chd-val')).toHaveText(['6,000', '2,000']);   // owner: never past 50%
    await expect(page.locator('.chd-crown')).toHaveCount(0);            // nobody carries a half-each hunt
  });

  test('past the goal together but one half short: the phone does not keep asking the server to resolve', async ({ page }) => {
    await boot(page, [inst({ id: 'h2', boss: 'the_bound_kings', rank: 'S', goal: 14000, mine: 13000, theirs: 3000 })]);
    await openHunt(page, 'h2');
    await page.waitForTimeout(3000);
    const n = await page.evaluate(() => (window as any).__coopCalls.resolve.filter((x: string) => x === 'h2').length);
    expect(n).toBeLessThanOrEqual(1);
  });

  test('both halves done: the kill lands and pays 400 souls, with no MVP bonus for the bigger half', async ({ page }) => {
    // 6,200 vs 6,000: uncapped, I would be MVP (+1% = 404); capped at the half, it is a tie
    await boot(page, [inst({ id: 'h3', boss: 'the_yoked_wanderers', rank: 'A', goal: 12000, mine: 6200, theirs: 6000, award: { owed: true, claimed: false } })]);
    await page.evaluate(() => { try { (window as any)._coopBackgroundSync(); } catch (_) { /* noop */ } });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hb_coop_awarded') || '{}')['h3']), { timeout: 15_000 }).toBe(true);
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_souls_ledger') || '[]'));
    const win = log.find((e: any) => e.type === 'coop_kill' && e.ref_id === 'the_yoked_wanderers');
    expect(win && win.delta).toBe(400);
  });

  test('a flights boss reads flights, each against their own 7', async ({ page }) => {
    await boot(page, [inst({ id: 'h4', boss: 'the_chained_ascendants', rank: 'A', goal: 14, mine: 3, theirs: 9, flights: true })]);
    await openHunt(page, 'h4');
    await expect(page.locator('.chd-big b')).toHaveText('10');           // 3 + 7 (their 9 stops at 7)
    await expect(page.locator('.chd-row .chd-share')).toHaveText(['4 to go', 'Done']);
  });

  test('the dashboard card counts the capped halves', async ({ page }) => {
    await boot(page, [inst({ id: 'h5', boss: 'the_yoked_wanderers', rank: 'A', goal: 12000, mine: 10000, theirs: 2000 })]);
    await page.evaluate(() => (window as any).__coopOpenDashboard());
    const card = page.locator('[data-coop-hunt="h5"]');
    await expect(card.locator('.cph-pct')).toHaveText('66%', { timeout: 10_000 });   // 8,000 / 12,000
    await expect(card.locator('.cph-leg.cph-you b')).toHaveText('Done');
  });

  test('the defeat screen names the hunter who came up short', async ({ page }) => {
    await boot(page, [inst({ id: 'h6', boss: 'the_yoked_wanderers', rank: 'A', goal: 12000, mine: 6000, theirs: 4800, status: 'expired', result: 'defeat' })]);
    await page.evaluate(() => { try { (window as any)._coopBackgroundSync(); } catch (_) { /* noop */ } });
    await expect(page.locator('#boss-result-overlay .hr-sub').first()).toHaveText(/^anthony: 1,200 steps short$/i, { timeout: 15_000 });
  });

  test('the loss screen never shows a hunter past their half (9 flights climbed reads 7 of 14)', async ({ page }) => {
    await boot(page, [inst({ id: 'h7', boss: 'the_chained_ascendants', rank: 'A', goal: 14, mine: 9, theirs: 5, flights: true, status: 'expired', result: 'defeat' })]);
    await page.evaluate(() => { try { (window as any)._coopBackgroundSync(); } catch (_) { /* noop */ } });
    await expect(page.locator('#boss-result-overlay .hr-sub').first()).toHaveText(/^rendiesel: 2 flights short$|^anthony: 2 flights short$/i, { timeout: 15_000 });
    const tos = await page.locator('#boss-result-overlay .hr-party .hr-cnt').evaluateAll((els) => els.map((e) => e.getAttribute('data-to')));
    expect(tos).toEqual(['7', '5']);
  });

  test('the recruit sheet asks for 6,000 steps each', async ({ page }) => {
    await boot(page, []);
    await page.evaluate(() => (window as any).openCoopSheet('the_yoked_wanderers'));
    await expect(page.locator('.coop-goal-big')).toHaveText('6,000', { timeout: 10_000 });
    await expect(page.locator('.coop-goal-sub')).toHaveText(/^steps each · 24h · two hunters$/);
  });

  test('each boss drops its themed pieces; the S pair also the mythics', async ({ page }) => {
    await boot(page, []);
    const r = await page.evaluate(() => {
      const w = window as any;
      return {
        bow: w.__relicSources('wraithwind_bow'),
        staff: w.__relicSources('aetherspire_staff'),
        boots: w.__relicSources('striders_of_the_waking_march'),
        pendant: w.__relicSources('pendant_of_the_seventh_hour'),
        night: w.__relicSources('nightfall_blade'),
        dusk: w.__relicSources('duskforge_greatblade'),
      };
    });
    expect(r.bow).toContain('The Yoked Wanderers');
    expect(r.bow).not.toContain('The Chained Ascendants');
    expect(r.staff).toContain('The Chained Ascendants');
    expect(r.boots).toContain('The Bound Kings');
    expect(r.boots).not.toContain('The Halved Seraph');
    expect(r.pendant).toContain('The Halved Seraph');
    expect(r.night).toEqual(expect.arrayContaining(['The Bound Kings', 'The Halved Seraph']));
    expect(r.dusk).not.toContain('The Yoked Wanderers');   // the easy A piece stays where it is
  });
});
