/**
 * Awakened — the boss's rank beside its name in Friend Activity (W1114).
 *
 * Owner, 2026-10-30: "I kind of want the rank next to the boss defeated." The opened row and a
 * hunter's folded single-boss chip both carry the rank chip in its canonical colour; a folded
 * "N bosses" chip names no one boss, so it carries none. The catalog speaks first; the event's
 * own rank covers a boss the catalog no longer lists.
 */
import { test, expect, Page } from '@playwright/test';

const ev = (id: string, alias: string, boss: string, rarity: string | null, at: number) => ({
  id, alias, rankLabel: 'C I', eventType: 'boss_kill', eventKey: id, eventLabel: 'defeated ' + boss,
  eventValue: 1, rarity, createdAt: new Date(at).toISOString(), likes: 0, liked: false, likers: [], likedAt: null,
});

async function openFeed(page: Page, events: unknown[]) {
  await page.addInitScript((evs) => {
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      const d = new Date();
      const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_fri_banner_' + ymd, '1');
      localStorage.setItem('hb_daily_insight_last_shown', ymd);
      localStorage.setItem('hb_fa_seen_ts', String(Date.now()));
      localStorage.setItem('hb_friends_activity_cache_v1', JSON.stringify({ ts: Date.now(), events: evs }));
    } catch (_) {}
  }, events);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.getElementById('tab-social')!.click());
  await page.evaluate(() => (document.querySelector('[data-cm-pane="friends"]') as HTMLElement).click());
  await page.locator('.fa-dh').first().click();
}

test.describe('Friend Activity shows the rank of each boss (W1114)', () => {
  test('the opened rows carry each boss rank in its rank colour', async ({ page }) => {
    const now = Date.now();
    await openFeed(page, [
      ev('a1', 'Justin', 'The Glass Strider', 'D', now),
      ev('a2', 'Justin', 'The Marathon Wraith', null, now - 1000),
      ev('a3', 'Justin', 'The Retired Beast', 'A', now - 2000),
    ]);
    await page.locator('.fa-hh').first().click();
    const rows = page.locator('.fa-act');
    await expect(rows).toHaveCount(3);
    const chip = (i: number) => rows.nth(i).locator('.guildhall-boss-sub-rank');
    await expect(chip(0)).toHaveText('D');
    await expect(chip(0)).toHaveCSS('color', 'rgb(34, 211, 238)');
    await expect(chip(1)).toHaveText('C');            // from the catalog, the event had none
    await expect(chip(2)).toHaveText('A');            // the event's own rank for an unlisted boss
    await expect(rows.nth(0).locator('.fa-c')).toHaveText('The Glass Strider');
    await expect(rows.nth(0).locator('.fa-act-txt')).not.toContainText('defeated');   // W1115 — chip + name only
  });

  test('a folded hunter shows the rank on one boss, none on "N bosses"', async ({ page }) => {
    const now = Date.now();
    await openFeed(page, [
      ev('b1', 'RenDIESEL', 'The Footsore Herald', 'E', now),
      ev('b2', 'Justin', 'The Steel Wolf', 'E', now - 1000),
      ev('b3', 'Justin', 'The Carouser', 'E', now - 2000),
    ]);
    const one = page.locator('.fa-hunter').filter({ hasText: /rendiesel/i }).locator('.fa-chip--bs');
    await expect(one).toContainText('The Footsore Herald');
    await expect(one.locator('.guildhall-boss-sub-rank')).toHaveText('E');
    const two = page.locator('.fa-hunter').filter({ hasText: /justin/i }).locator('.fa-chip--bs');
    await expect(two).toHaveText('2 bosses');
    await expect(two.locator('.guildhall-boss-sub-rank')).toHaveCount(0);
  });

  test('a feat that is not a boss carries no rank chip', async ({ page }) => {
    await openFeed(page, [{ ...ev('c1', 'Justin', 'x', null, Date.now()), eventType: 'step_milestone_bucket', eventLabel: 'crossed 10,000 steps today', eventValue: 10000 }]);
    await page.locator('.fa-hh').first().click();
    await expect(page.locator('.fa-act')).toHaveCount(1);
    await expect(page.locator('.guildhall-boss-sub-rank')).toHaveCount(0);
  });
});
