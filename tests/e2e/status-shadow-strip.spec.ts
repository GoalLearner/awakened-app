/**
 * Awakened — the Shadow Army strip on the Status card (W1119).
 *
 * Owner, 2026-10-31: "get rid of these words on the status tab and replace it with the shadow army."
 * The class flavor line is gone for every awakened class, and the strip moved here from Co-op. A
 * Civilian keeps the line, because it says how to awaken a class. No shadows, no strip.
 */
import { test, expect, Page } from '@playwright/test';

const PALADIN = "Unbreakable. You do what others won't on the days they can't.";

async function openStatus(page: Page, opts: { cls?: string; shadows?: string[] }) {
  await page.addInitScript((o) => {
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed',
        'hb_tour_quests_v1', 'hb_tour_items_v1', 'hb_tour_stats_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1',
      ].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      if (o.cls) localStorage.setItem('hb_class', o.cls);
      if (o.shadows) {
        const extracted: Record<string, unknown> = {};
        o.shadows.forEach((id) => { extracted[id] = { at: Date.now(), name: 'Shadow of ' + id }; });
        localStorage.setItem('hb_shadows_v1', JSON.stringify({ extracted, active: o.shadows, windows: {}, pending: {} }));
      }
    } catch (_) {}
  }, opts);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
  await page.reload();   // a first launch settles the class back to Civilian; the second keeps the seed
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.getElementById('tab-profile')!.click());
  await expect(page.locator('#status-content .sc-identity-class')).toHaveAttribute('data-class-key', opts.cls || 'CIVILIAN', { timeout: 15_000 });
}

test.describe('The Shadow Army strip sits on the Status card (W1119)', () => {
  test('an awakened hunter sees the strip and not the flavor line; a tap opens the roster', async ({ page }) => {
    await openStatus(page, { cls: 'WILL', shadows: ['the_carouser', 'the_steel_wolf'] });
    const card = page.locator('#status-content .sc-card--profile');
    await expect(card.locator('#shadow-strip')).toContainText('SHADOW ARMY · 2 RAISED');
    await expect(card.locator('#shadow-strip')).not.toHaveClass(/hidden/);
    await expect(card).not.toContainText(PALADIN);
    await expect(card.locator('.sc-awakening-msg')).toHaveCount(0);
    await expect(page.locator('#quests-panel #shadow-strip')).toHaveCount(0);
    await page.evaluate(() => (document.getElementById('shadow-strip') as HTMLElement).click());
    await expect(page.locator('#shadow-roster .shr-row')).toHaveCount(2);
  });

  test('the strip waits for the first shadow', async ({ page }) => {
    await openStatus(page, { cls: 'WILL' });
    await expect(page.locator('#shadow-strip')).toHaveClass(/hidden/);
    await expect(page.locator('#status-content .sc-card--profile')).not.toContainText(PALADIN);
  });

  test('a Civilian keeps the line that says how to awaken', async ({ page }) => {
    await openStatus(page, { cls: 'CIVILIAN' });
    await expect(page.locator('.sc-awakening-msg')).toHaveText('Train any stat to Lv5 to awaken your path.');
  });
});
