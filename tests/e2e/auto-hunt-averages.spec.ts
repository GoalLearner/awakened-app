/**
 * Awakened — the automatic duo hunts pick from the hunters' averages (W1195), client side.
 *
 * Owner 2026-11-13: "get the averages of the users and then pick the closest duo boss for the
 * automated so it isn't just twin maw or coursing dread all the time ... even automate steps +
 * flights if a user averages flights per day". The server picks (coop-auto.ts); the phone:
 *   - works out its flights a day over the last 14 complete days (at least 3 recorded days);
 *   - sends it on the app-open ping (stubbed here: nothing reaches the live server);
 *   - shows both goals on a steps + flights hunt's row.
 */
import { test, expect, Page } from '@playwright/test';

const BACKEND = 'https://awakened-backend.richmondcampano93.workers.dev/**';

async function boot(page: Page, flights: Record<number, number>) {
  await page.addInitScript((fl) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) {
        const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s);
      }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      // flights_daily is keyed by the device-local date; key = days back from today (0 = today)
      const p2 = (n: number) => String(n).padStart(2, '0');
      const key = (back: number) => { const d = new Date(); d.setDate(d.getDate() - back); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
      const map: Record<string, number> = {};
      Object.keys(fl).forEach((b) => { map[key(Number(b))] = (fl as any)[b]; });
      localStorage.setItem('hb_leaderboard', JSON.stringify({ flights_daily: map }));
    } catch (_) { /* noop */ }
  }, flights);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}
const avg = (page: Page) => page.evaluate(() => (window as any).__flightsAvg14());

test.describe('The automatic duo hunts read the hunters’ averages (W1195)', () => {
  test('flights a day: the last 14 complete days the phone recorded, at least 3; today waits', async ({ page }) => {
    await boot(page, { 0: 50, 1: 2, 2: 4, 3: 6, 5: 8, 9: 10, 15: 99 });
    expect(await avg(page)).toBe(6);          // (2 + 4 + 6 + 8 + 10) / 5 — today's 50 and day 15's 99 are out
  });

  test('fewer than three recorded days: no figure', async ({ page }) => {
    await boot(page, { 0: 20, 1: 3, 2: 4 });
    expect(await avg(page)).toBeNull();
  });

  test('zero flights is a real day: a hunter who never climbs averages 0', async ({ page }) => {
    await boot(page, { 1: 0, 2: 0, 3: 0, 4: 0 });
    expect(await avg(page)).toBe(0);
  });

  test('the app-open ping carries it (one decimal)', async ({ page }) => {
    const bodies: any[] = [];
    await page.route(BACKEND, async (route) => {
      const req = route.request();
      if (/\/v1\/users\/me\/app-open/.test(req.url())) { try { bodies.push(JSON.parse(req.postData() || '{}')); } catch (_) { /* noop */ } }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await boot(page, { 1: 3, 2: 4, 3: 4 });
    expect(await avg(page)).toBe(3.7);
    // signed in only for this one ping (a signed-in boot would start the whole sync), and every
    // backend call is answered above, so nothing reaches the live server
    await page.evaluate(() => {
      localStorage.setItem('hb_user', JSON.stringify({ jwt: 'e2e-not-a-real-token', userId: 'e2e-user', alias: 'e2e' }));
      (window as any).Auth.reportAppOpen({ force: true });
      localStorage.removeItem('hb_user');
    });
    await expect.poll(() => bodies.length, { timeout: 6_000 }).toBeGreaterThan(0);
    expect(bodies[bodies.length - 1].flights_avg).toBe(3.7);
  });

  test('a steps + flights hunt row reads both goals; its bar is the one further behind', async ({ page }) => {
    await boot(page, {});
    const row = await page.evaluate(() => (window as any).__huntCoopItem({
      id: 'x1', boss_id: 'the_gaunt_wardens', metric: 'both', boss_rank: 'C', status: 'active', auto: 1,
      goal_steps: 8000, goal_flights: 6, combined_steps: 6000, combined_flights: 3, starts_at: new Date().toISOString(),
    }));
    expect(row.line).toBe('6,000 / 8,000 steps · 3 / 6 flights');
    expect(row.pct).toBe(0.5);
    const steps = await page.evaluate(() => (window as any).__huntCoopItem({
      id: 'x2', boss_id: 'the_coursing_dread', metric: 'steps', boss_rank: 'C', status: 'active', auto: 1,
      goal_steps: 8000, combined_steps: 2000, starts_at: new Date().toISOString(),
    }));
    expect(steps.line).toBe('2,000 / 8,000 steps together');
    const monarch = await page.evaluate(() => (window as any).__huntCoopItem({
      id: 'x3', boss_id: 'the_hollow_monarch', metric: 'flights', boss_rank: 'B', status: 'active', auto: 1,
      goal_steps: 12, combined_flights: 4, starts_at: new Date().toISOString(),
    }));
    expect(monarch.line).toBe('4 / 12 flights together');
  });

  // W1204 — owner: "I want to just have the name of the person I am hunting with instead of the
  // name of the boss here at this screen". The row's title is the partner; the boss stays in the art.
  test('W1204: a co-op hunt row is titled by who you hunt with, not the boss', async ({ page }) => {
    await boot(page, {});
    const name = (inst: Record<string, unknown>) => page.evaluate((x) => (window as any).__huntCoopItem(x).name, inst);
    const base = { boss_id: 'the_coursing_dread', metric: 'steps', boss_rank: 'C', status: 'active', goal_steps: 8000, combined_steps: 10, starts_at: new Date().toISOString() };
    expect(await name({ ...base, id: 'd1', role: 'challenger', challenger: { alias: 'e2e' }, partner: { alias: 'Rendell' } })).toBe('Rendell');
    expect(await name({ ...base, id: 'd2', role: 'partner', challenger: { alias: 'Sharr' }, partner: { alias: 'e2e' } })).toBe('Sharr');
    expect(await name({ ...base, id: 't1', role: 'challenger', challenger: { alias: 'e2e' }, partner: { alias: 'Rendell' }, partner2: { alias: 'Sharr' } })).toBe('Rendell & Sharr');
    expect(await name({ ...base, id: 'r1', party: [
      { user_id: 'nobody-a', alias: 'Rendell' }, { user_id: 'nobody-b', alias: 'Sharr' }, { user_id: 'nobody-c', alias: 'Galilea' }, { user_id: 'nobody-d', alias: 'Killua' },
    ] })).toBe('Rendell, Sharr +2');
    // no partner name yet: the boss name stands in
    expect(await name({ ...base, id: 'n1', role: 'challenger', challenger: { alias: 'e2e' } })).toBe('The Coursing Dread');
  });
});
