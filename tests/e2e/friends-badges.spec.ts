/**
 * Awakened — the Friends tab wears the same badges as This Week (W1291).
 *
 * Owner 2026-11-23 (two screenshots of the Steps board): "if you look on your friends steps, it doesn't show the
 * badges and such right there." rendiesel wore 100K + a 900 boss-kill stamp on This Week and nothing on Friends;
 * galilea wore 200 on This Week and nothing on Friends. The Friends rows now take the 100K / 200K / 300K stamps
 * from the same club roster, and the server sends each friend's boss kills.
 */
import { test, expect, Page } from '@playwright/test';

const SHOTS = process.env.LB_SHOTS || '';

async function boot(page: Page) {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed',
      'hb_tour_quests_v1', 'hb_tour_items_v1', 'hb_tour_stats_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1',
    ].forEach((k) => localStorage.setItem(k, '1'));
    localStorage.setItem('hb_habits', '[]');
    localStorage.setItem('hb_whats_new_seen', '99.99.99');
  });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

test.describe('W1291 — badges on the Friends tab', () => {
  test('a friend wears the 100K stamp and the boss-kill stamp, as on This Week', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.evaluate(() => {
      const A = (window as any).Auth;
      const rows = [
        { rank: 1, alias: 'ricin', current_value: 41720 },
        { rank: 2, alias: 'rendiesel', current_value: 10711, bosses_slain: 912 },
        { rank: 3, alias: 'galilea', current_value: 8339, bosses_slain: 204 },
        { rank: 4, alias: 'justin', current_value: 4344 },
      ];
      A.fetchLeaderboardTop = async () => ({ ok: true, final: false, week: null, top: rows, me: null });
      A.fetchFriendsLeaderboard = async () => ({ ok: true, final: false, total: rows.length, me: null, rows: rows.map((r) => ({ ...r })) });
      A.fetchLastWeekSteps = async () => ({ ok: true, champion: null, me: null, records: [] });
      A.fetchStep100kClub = async () => ({ ok: true, members: [{ alias: 'rendiesel', best_value: 133979 }], me: null });
      A.fetchLeaderboardArchive = async (week: string) => ({ ok: true, week, records: [], me: null, weeksAvailable: [week] });
      (window as any).openLeaderboardRanking('step_total');
    });
    const sheet = page.locator('#lb-rank-sheet');
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-lb-tab="friends"]').click();
    await expect(sheet.locator('[data-lb-tab="friends"]')).toHaveClass(/is-active/);
    const ren = sheet.locator('[data-profile-alias="rendiesel"]');
    await expect(ren.locator('.lb-rank-club100k')).toHaveText('100K', { timeout: 8_000 });
    await expect(ren.locator('.lb-rank-boss100')).toHaveText('900');
    const gal = sheet.locator('[data-profile-alias="galilea"]');
    await expect(gal.locator('.lb-rank-boss100')).toHaveText('200');
    await expect(gal.locator('.lb-rank-club100k')).toHaveCount(0);
    await expect(sheet.locator('[data-profile-alias="justin"] .lb-rank-boss100, [data-profile-alias="justin"] .lb-rank-club100k')).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/lb-friends-badges.png' });
  });
});
