/**
 * Awakened — the official record-book posts in Hunter Activity (W1199), client side.
 *
 * Owner 2026-11-13: "If a person officially hits the hall of fame or 100K club, it should be posted on the
 * friend's feed for people to see or like it". The server writes the posts (backend lib/fame-posts.ts);
 * the app renders both in signature gold.
 */
import { test, expect } from '@playwright/test';

test('the Hall of Fame and 100K Club posts read in gold, each with its own mark', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
    } catch (_) { /* noop */ }
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__fa && typeof (window as any).__fa.parts === 'function');
  const r = await page.evaluate(() => {
    const fa = (window as any).__fa;
    return {
      hof: fa.parts({ eventType: 'hall_of_fame_entry', eventLabel: 'entered the Steps Hall of Fame at #3' }),
      club: fa.parts({ eventType: 'step_100k_club_unlocked', eventLabel: 'joined the 100K Step Club' }),
      hofIcon: fa.icon('hall_of_fame_entry'),
    };
  });
  expect(r.hof).toMatchObject({ prefix: 'entered the ', target: 'Steps Hall of Fame', suffix: ' at #3', cls: 'club' });
  expect(r.club).toMatchObject({ prefix: 'joined the ', target: '100K Step Club', cls: 'club' });
  expect(r.hofIcon).toEqual(['♛', 'club']);
});
