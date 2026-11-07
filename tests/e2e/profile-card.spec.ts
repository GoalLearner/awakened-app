/**
 * Awakened — the Hunter Profile card (W1142, Claude Design handoff 8 "Player Card - Wardrobe").
 *
 * Owner 2026-11-07: "Make sure the avatar is centered... as well as removing the arena rating since we
 * don't have that open yet." Pinned here, rendered from fixture data through the QA hook (no network):
 *   - the medallion (the avatar) sits on the sheet's centre line, own card and a visitor's card alike;
 *   - no Arena Rating row, even when the profile data carries an arena standing;
 *   - the own card keeps CHANGE LOOK and its own closing line; a visitor's card names the worn look.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__pcard')) return; sessionStorage.setItem('__pcard', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_ascent_opening_seen_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      const st = { pts: 2400 };
      localStorage.setItem('hb_stats', JSON.stringify({ STR: st, VIT: st, INT: st, FOCUS: st, WILL: st, WLT: st }));
    } catch (_) { /* noop */ }
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__pcRender && !!document.querySelector('[data-tab="profile"]'));
}

const DATA = {
  alias: 'Richie', rankTier: 'S', rankLabel: 'S RANK', avatarId: 'avatar-skin-shadowborn.png', power: 5601, bossesSlain: 316, avgStepsPerDay: 5625,
  ultraRareDrops: 24, bestFloor: 99, arenaTitle: 'shadowborn', founderSeq: 1, arena: { elo: 1340, global: 3 }, verifiedStreakLabel: '41-day verified streak',
};
const render = (page: Page, own: boolean, extra?: Record<string, unknown>) => page.evaluate(([d, o]) => (window as any).__pcRender(d, o), [{ ...DATA, ...(extra || {}) }, own] as [Record<string, unknown>, boolean]);

for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  test.describe('W1142 — the Hunter Profile card @' + vp.width + 'x' + vp.height, () => {
    test.use({ viewport: vp });

    test('the avatar sits on the centre line and the Arena Rating row is gone (own card)', async ({ page }) => {
      await boot(page);
      await render(page, true);
      const sheet = page.locator('#pc-sheet');
      await expect(sheet).toBeVisible();
      const med = page.locator('#pc-body .pc-med');
      await expect(med).toBeVisible();
      const s = (await sheet.boundingBox())!, m = (await med.boundingBox())!, img = (await page.locator('#pc-body .pc-med-portrait img').boundingBox())!;
      expect(Math.abs((m.x + m.width / 2) - (s.x + s.width / 2))).toBeLessThanOrEqual(2);
      expect(Math.abs((img.x + img.width / 2) - (s.x + s.width / 2))).toBeLessThanOrEqual(2);
      await expect(page.locator('#pc-body .pc-arena')).toHaveCount(0);
      await expect(page.locator('#pc-body')).not.toContainText('ARENA RATING');
      await expect(page.locator('#pc-body .pc-skintag')).toContainText('CHANGE LOOK');
      await expect(page.locator('#pc-body .pc-prov')).toContainText('every hunter sees');
      await expect(page.locator('#pc-body .pc-stat .v.gold')).toHaveText('5,601');
    });

    test("a visitor's card: centred too, no Arena Rating, the worn look named", async ({ page }) => {
      await boot(page);
      await render(page, false, { alias: 'RenDIESEL' });
      const sheet = page.locator('#pc-sheet'), med = page.locator('#pc-body .pc-med');
      await expect(med).toBeVisible();
      const s = (await sheet.boundingBox())!, m = (await med.boundingBox())!;
      expect(Math.abs((m.x + m.width / 2) - (s.x + s.width / 2))).toBeLessThanOrEqual(2);
      await expect(page.locator('#pc-body .pc-arena')).toHaveCount(0);
      await expect(page.locator('#pc-body .pc-skintag')).toContainText('THE SHADOWBORN');
      await expect(page.locator('#pc-body .pc-prov')).toContainText('global leaderboard');
    });
  });
}
