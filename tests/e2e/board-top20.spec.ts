/**
 * Awakened — the Steps board shows the top 20 (W1213).
 *
 * Owner 2026-11-15, with 25+ hunters on the week after the Reddit wave: "increase the step high scores
 * to 15-20" — the board showed the top 10 and pinned everyone else's own row under it. Now:
 *   - the list holds the top 20; #21 and below are not listed;
 *   - a hunter ranked inside the 20 sits in the list (no pinned row);
 *   - a hunter below the 20 still gets their own row pinned under the list.
 */
import { test, expect, Page } from '@playwright/test';

const row = (rank: number, alias: string, steps: number) => ({ rank, alias, current_value: steps, card_ink: null });

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

async function openBoard(page: Page, result: unknown) {
  await page.evaluate((res) => {
    const A = (window as any).Auth;
    A.fetchLeaderboardTop = async () => res;
    A.fetchLastWeekSteps = async () => ({ ok: true, champion: null, me: null, records: [] });
    A.fetchStep100kClub = async () => ({ ok: true, members: [] });
    A.fetchLeaderboardArchive = async (week: string) => ({ ok: true, week, records: [], me: null, weeksAvailable: [week] });
    (window as any).openLeaderboardRanking('step_total');
  }, result);
  await expect(page.locator('#lb-rank-sheet')).toBeVisible();
}

const board = (me: string, myRank: number) => {
  const top = Array.from({ length: 25 }, (_, i) => row(i + 1, i + 1 === myRank ? me : 'hunter' + String(i + 1).padStart(2, '0'), 100000 - i * 1000));
  return { ok: true, final: false, week: null, top, me: { rank: myRank, current_value: 100000 - (myRank - 1) * 1000 } };
};

test.describe('W1213 — the Steps board lists the top 20', () => {
  test('below the 20: twenty listed, #21 and on not, your own row pinned under them', async ({ page }) => {
    await boot(page);
    const me: string = await page.evaluate(() => { const u = (window as any).Auth.getCurrentUser(); return (u && u.alias) || 'DevUser'; });
    await openBoard(page, board(me, 22));
    const sheet = page.locator('#lb-rank-sheet');
    await expect(sheet).toContainText('hunter20');
    await expect(sheet).toContainText('hunter19');
    await expect(sheet).not.toContainText('hunter21');
    await expect(sheet).not.toContainText('hunter25');
    // your own row pinned under the list (#lb-you-footer)
    const foot = page.locator('#lb-you-footer');
    await expect(foot).toBeVisible();
    await expect(foot).toContainText('22');
    await expect(sheet).toHaveClass(/lb-has-youfoot/);
  });

  test('inside the 20 (#15): you sit in the list, nothing pinned', async ({ page }) => {
    await boot(page);
    const me: string = await page.evaluate(() => { const u = (window as any).Auth.getCurrentUser(); return (u && u.alias) || 'DevUser'; });
    await openBoard(page, board(me, 15));
    const sheet = page.locator('#lb-rank-sheet');
    await expect(page.locator('#lb-you-footer')).toBeHidden();
    await expect(sheet).not.toHaveClass(/lb-has-youfoot/);
    await expect(sheet).toContainText('hunter20');
    await expect(sheet).not.toContainText('hunter21');
  });
});
