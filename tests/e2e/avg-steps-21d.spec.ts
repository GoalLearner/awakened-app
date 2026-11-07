/**
 * Awakened — the profile card's AVG STEPS / DAY is the last 21 full days (W1153).
 *
 * Owner 2026-11-07: "I want do the average steps a day to 21 days." Pinned here through the QA hook
 * window.__lbSnapshot(): the mean of the 21 calendar days before today, a day with no record counting as 0,
 * today left out, older days ignored. Day keys are made in the browser (its own time zone), never in Node.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, plan: { full: number; recent?: number; today?: number; older?: number }) {
  await page.addInitScript((p: { full: number; recent?: number; today?: number; older?: number }) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => { const root = document.head || document.documentElement; if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); } };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
    localStorage.setItem('hb_habits', '[]');
    localStorage.setItem('hb_whats_new_seen', '99.99.99');
    const key = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const sd: Record<string, number> = {};
    const d = new Date(); d.setHours(12, 0, 0, 0);
    if (p.today != null) sd[key(d)] = p.today;
    for (let i = 1; i <= 30; i++) {
      d.setDate(d.getDate() - 1);
      if (i <= p.full) sd[key(d)] = p.recent ?? 0;          // inside the 21-day window (only the first `full` days have a record)
      else if (i > 21 && p.older != null) sd[key(d)] = p.older;   // outside the window
    }
    localStorage.setItem('hb_leaderboard', JSON.stringify({ steps_daily: sd, lifetime_steps_total: 995833, lifetime_steps_start_date: '2026-05-15' }));
  }, plan);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__lbSnapshot && !!document.querySelector('[data-tab="profile"]'));
}
const avg = (page: Page) => page.evaluate(() => (window as any).__lbSnapshot().avg_steps_per_day_21d);

test.describe('W1153 — AVG STEPS / DAY over the last 21 days', () => {
  test('21 full days at 10,000 → 10,000; today and anything older are left out', async ({ page }) => {
    await boot(page, { full: 21, recent: 10000, today: 500, older: 50000 });
    expect(await avg(page)).toBe(10000);
  });

  test('only 7 of the 21 days recorded → the quiet days count as zero', async ({ page }) => {
    await boot(page, { full: 7, recent: 21000, today: 30000, older: 90000 });
    expect(await avg(page)).toBe(7000);
  });

  test('a hunter with no daily record yet reads 0, and the heartbeat carries the 21-day figure', async ({ page }) => {
    await boot(page, { full: 0 });
    expect(await avg(page)).toBe(0);
    const snap = await page.evaluate(() => (window as any).__lbSnapshot());
    expect(snap.avg_steps_per_day_lifetime).toBeGreaterThan(5000);   // the lifetime figure still exists, just not on the card
  });
});
