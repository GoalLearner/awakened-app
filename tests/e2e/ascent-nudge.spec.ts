/**
 * Awakened — the Ascent nudge (W1238).
 *
 * Owner 2026-11-18: "Add the nudge or notification after their third boss kill that goes straight to the ascent upon
 * clicking". Pinned here:
 *   - a won boss result closing, with 3+ boss kills and no Ascent fight yet, brings one card; "Enter the Ascent"
 *     opens the tower;
 *   - two kills: no card; a hunter who has fought in the Ascent: no card;
 *   - once, ever: "Later" closes it and it never comes back;
 *   - it counts co-op kills too.
 *
 * ASCN_SHOTS=<dir> saves a phone-size screenshot for the owner.
 */
import { test, expect, Page } from '@playwright/test';

const SHOTS = process.env.ASCN_SHOTS || '';

async function boot(page: Page, extra?: Record<string, string>) {
  await page.addInitScript(([ex]: [Record<string, string>]) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__ascn')) return; sessionStorage.setItem('__ascn', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_bosses_engagement_migrated'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      Object.keys(ex || {}).forEach((k) => localStorage.setItem(k, ex[k]));
    } catch (_) { /* noop */ }
  }, [extra || {}] as [Record<string, string>]);
  await page.goto('/');
  await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => !!(window as any).__ascNudge && !!(window as any).__queueBossResult);
}
const KILLS = (n: number) => JSON.stringify({
  the_steel_wolf: { streak: 0, kill_count: Math.min(n, 2), last_eval_date: null, engaged: false, engaged_at: null },
  the_insomniac: { streak: 0, kill_count: Math.max(0, n - 2), last_eval_date: null, engaged: false, engaged_at: null },
});
// a won result, played through: tap to skip, tap to leave
async function winAndClose(page: Page, killNo: number) {
  await page.evaluate((k) => (window as any).__queueBossResult({ bossId: 'the_insomniac', bossName: 'The Insomniac', rank: 'E', kill_count: k,
    conditionLabel: 'Sleep 6.5+ hours', souls: 60, drop: null, mercy: null }), killNo);
  const frame = page.locator('#boss-result-overlay .hr-frame');
  await expect(frame).toBeVisible({ timeout: 6000 });
  await frame.click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  await frame.click({ position: { x: 20, y: 20 } });
  await expect.poll(() => page.evaluate(() => document.getElementById('boss-result-overlay')!.classList.contains('hidden')), { timeout: 4000 }).toBe(true);
}

test.use({ viewport: { width: 390, height: 844 } });

test.describe('W1238 — the Ascent nudge after the third boss', () => {
  test('the third kill brings the card; Enter the Ascent opens the tower', async ({ page }) => {
    await boot(page, { hb_bosses: KILLS(3) });
    await winAndClose(page, 1);
    const card = page.locator('#asc-nudge');
    await expect(card).toBeVisible({ timeout: 6000 });
    await expect(card.locator('.ascn-title')).toHaveText(/3 bosses down\.\s*Now climb\./);
    await expect(card.locator('button')).toHaveCount(2);
    await expect(card.locator('.ascn-go')).toHaveText('Enter the Ascent');
    await expect(card).not.toContainText(/\bfell(ed)?\b/i);
    if (SHOTS) { await page.waitForTimeout(350); await page.screenshot({ path: SHOTS + '/ascent-nudge.png' }); }
    await page.waitForTimeout(400);
    await card.locator('.ascn-go').click();
    await expect.poll(() => page.evaluate(() => !document.getElementById('arena-overlay')!.classList.contains('hidden')), { timeout: 5000 }).toBe(true);
    await expect(page.locator('#asc-nudge')).toHaveCount(0, { timeout: 2000 });
    const r = await page.evaluate(() => ({ key: localStorage.getItem('hb_asc_nudge_v1'), q: localStorage.getItem('hb_funnel_queue') || '' }));
    expect(Number(r.key)).toBeGreaterThan(0);
    expect(r.q).toContain('"e":"ascent_nudge","d":"shown"');
    expect(r.q).toContain('"e":"ascent_nudge","d":"go"');
  });

  test('two kills: no card', async ({ page }) => {
    await boot(page, { hb_bosses: KILLS(2) });
    await winAndClose(page, 1);
    await page.waitForTimeout(1500);
    await expect(page.locator('#asc-nudge')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__ascNudge.eligible())).toBe(false);
  });

  test('a hunter who has fought in the Ascent never sees it', async ({ page }) => {
    await boot(page, { hb_bosses: KILLS(5), hb_arena_v2: JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: 2, highestCleared: 1, wins: 1, losses: 0, streak: 1, bestStreak: 1 }) });
    await winAndClose(page, 4);
    await page.waitForTimeout(1500);
    await expect(page.locator('#asc-nudge')).toHaveCount(0);
  });

  test('once, ever: Later closes it and it does not come back', async ({ page }) => {
    await boot(page, { hb_bosses: KILLS(4) });
    await page.evaluate(() => (window as any).__ascNudge.maybe());
    const card = page.locator('#asc-nudge');
    await expect(card).toBeVisible({ timeout: 4000 });
    await page.waitForTimeout(400);
    await card.locator('.ascn-later').click();
    await expect(page.locator('#asc-nudge')).toHaveCount(0, { timeout: 2000 });
    expect(await page.evaluate(() => document.getElementById('arena-overlay')!.classList.contains('hidden'))).toBe(true);
    await winAndClose(page, 5);
    await page.waitForTimeout(1500);
    await expect(page.locator('#asc-nudge')).toHaveCount(0);
  });

  test('co-op kills count toward the three', async ({ page }) => {
    await boot(page, { hb_bosses: KILLS(1), hb_coop_kills: JSON.stringify({ the_twin_maw: { count: 2 } }) });
    expect(await page.evaluate(() => (window as any).__ascNudge.kills())).toBe(3);
    expect(await page.evaluate(() => (window as any).__ascNudge.eligible())).toBe(true);
  });
});
