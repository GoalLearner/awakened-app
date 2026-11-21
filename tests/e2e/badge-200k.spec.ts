/**
 * Awakened — the 200K seal (W1257).
 *
 * Owner 2026-11-20: "We might need a 200K badge that is unique no need for 200K club but a 200K badge that
 * looks more unique and cool". A hunter whose best week (the 100K Club roster's best_value) reached 200,000
 * wears the 200K seal on the Steps board IN PLACE of the gold 100K stamp; a 100K member keeps the gold stamp;
 * everyone else wears nothing.
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

test.describe('W1257 — the 200K seal on the Steps board', () => {
  test('a 200,000-step week wears the 200K seal instead of the 100K stamp', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.evaluate(() => {
      const A = (window as any).Auth;
      A.fetchLeaderboardTop = async () => ({ ok: true, final: false, week: null,
        top: [
          { rank: 1, alias: 'Alpha', current_value: 267892 },
          { rank: 2, alias: 'Beta', current_value: 129973 },
          { rank: 3, alias: 'Gamma', current_value: 88039 },
        ], me: null });
      A.fetchLastWeekSteps = async () => ({ ok: true, champion: null, me: null, records: [] });
      A.fetchStep100kClub = async () => ({ ok: true, members: [
        { alias: 'Alpha', best_value: 267892 },
        { alias: 'Beta', best_value: 133979 },
      ], me: null });
      A.fetchLeaderboardArchive = async (week: string) => ({ ok: true, week, records: [], me: null, weeksAvailable: [week] });
      (window as any).openLeaderboardRanking('step_total');
    });
    const sheet = page.locator('#lb-rank-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.lb-rank-club200k')).toHaveCount(1);
    const leader = sheet.locator('.lb-rank-leader');
    await expect(leader.locator('.lb-rank-club200k')).toHaveText('200K');
    await expect(leader.locator('.lb-rank-club100k')).toHaveCount(0);   // the seal replaces the gold stamp
    await expect(sheet.locator('.lb-rank-club100k')).toHaveCount(1);    // Beta keeps the 100K stamp
    const box = await leader.locator('.lb-rank-club200k').boundingBox();
    expect(box && box.width).toBeGreaterThan(30);
    expect(box && box.height).toBeLessThanOrEqual(17);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/lb-200k.png' });
  });

  // W1264 — owner 2026-11-21 picked option B "Nebula": a 300,000-step week wears the 300K seal in place of the 200K seal.
  test('a 300,000-step week wears the 300K seal; 200K and 100K keep theirs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.evaluate(() => {
      const A = (window as any).Auth;
      A.fetchLeaderboardTop = async () => ({ ok: true, final: false, week: null,
        top: [
          { rank: 1, alias: 'Alpha', current_value: 306326 },
          { rank: 2, alias: 'Beta', current_value: 215091 },
          { rank: 3, alias: 'Gamma', current_value: 129973 },
          { rank: 4, alias: 'Delta', current_value: 88039 },
        ], me: null });
      A.fetchLastWeekSteps = async () => ({ ok: true, champion: null, me: null, records: [] });
      A.fetchStep100kClub = async () => ({ ok: true, members: [
        { alias: 'Alpha', best_value: 306326 },
        { alias: 'Beta', best_value: 299999 },
        { alias: 'Gamma', best_value: 133979 },
      ], me: null });
      A.fetchLeaderboardArchive = async (week: string) => ({ ok: true, week, records: [], me: null, weeksAvailable: [week] });
      (window as any).openLeaderboardRanking('step_total');
    });
    const sheet = page.locator('#lb-rank-sheet');
    await expect(sheet).toBeVisible();
    const leader = sheet.locator('.lb-rank-leader');
    await expect(leader.locator('.lb-rank-club300k')).toHaveText('300K');
    await expect(leader.locator('.lb-rank-club200k')).toHaveCount(0);
    await expect(leader.locator('.lb-rank-club100k')).toHaveCount(0);
    await expect(sheet.locator('.lb-rank-club300k')).toHaveCount(1);
    await expect(sheet.locator('.lb-rank-club200k')).toHaveCount(1);   // 299,999 stays 200K
    await expect(sheet.locator('.lb-rank-club100k')).toHaveCount(1);
    await expect(leader.locator('.lb-rank-club300k .w')).toHaveCount(0);   // W1265 — no wings
    const box = await leader.locator('.lb-rank-club300k').boundingBox();
    expect(box && box.width).toBeGreaterThan(40);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/lb-300k.png' });
  });
});
