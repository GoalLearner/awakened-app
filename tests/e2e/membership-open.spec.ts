/**
 * Awakened — no memberships for now (W1122).
 *
 * Owner, 2026-11-01: "don't really need to have any memberships at this moment. Can we get
 * rid of this..." Nothing offers the subscription, and what it locked is open to every hunter.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.addInitScript(() => {
    ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed',
      'hb_tour_quests_v1', 'hb_tour_items_v1', 'hb_tour_stats_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1',
    ].forEach((k) => localStorage.setItem(k, '1'));
    localStorage.setItem('hb_habits', '[]');
    localStorage.setItem('hb_whats_new_seen', '99.99.99');
  });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

test.describe('No memberships for now (W1122)', () => {
  test('every hunter is a member, and the paywall never opens', async ({ page }) => {
    await boot(page);
    const state = await page.evaluate(() => {
      const w = window as any;
      w.__openFounder();
      return {
        member: w.Auth.isMember(),
        sheetHidden: document.getElementById('founder-sheet')!.classList.contains('hidden'),
      };
    });
    expect(state).toEqual({ member: true, sheetHidden: true });
  });

  test('Settings has no membership row', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (document.getElementById('settings-btn') as HTMLElement).click());
    await expect(page.locator('#settings-whats-new-btn')).toBeAttached();
    await expect.poll(() => page.evaluate(() => document.getElementById('settings-founder-row')!.style.display)).toBe('none');
  });

  test('no surface left in the page sells or locks a membership', async ({ page }) => {
    await boot(page);
    const text = await page.evaluate(() => [
      document.querySelector('.gate-cell--members')!.textContent,
      document.getElementById('members-hall-sheet')!.textContent,
    ].join(' '));
    expect(text).not.toMatch(/members/i);
    expect(text).toContain('RAID');
  });
});
