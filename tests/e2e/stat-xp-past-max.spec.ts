/**
 * Awakened — stat XP past level 20 (W1320).
 *
 * Owner 2026-11-25: "Even though I hit max level on this...it would be cool to allow pass this XP. Kind of like how in
 * OSRS players at level 99 can exceed the xp and get to 200,000 xp for a skill." The level stays 20 and the capped
 * points every level / combat read stay at 6,650; what lands past the cap is counted on, up to 200,000 per stat, and
 * the stat sheet climbs toward it.
 */
import { test, expect, Page } from '@playwright/test';

const SHOTS = process.env.LB_SHOTS || '';

async function boot(page: Page, stats: Record<string, unknown>) {
  await page.addInitScript((st) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner,.habit-toast{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__w1320')) return; sessionStorage.setItem('__w1320', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_ascent_opening_seen_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_stats', JSON.stringify(st));
    } catch (_) { /* noop */ }
  }, stats);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__openStatDetail && !!(window as any).__applyStatPts);
}

const txt = (page: Page, id: string) => page.locator('#' + id).textContent();

for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  test.describe('W1320 — stat XP past level 20 @' + vp.width, () => {
    test.use({ viewport: vp });

    test('at level 20 the sheet shows the XP past max and climbs toward 200,000; a habit keeps adding; an undo takes it back', async ({ page }) => {
      await boot(page, { STR: { pts: 300 }, VIT: { pts: 0 }, INT: { pts: 0 }, FOCUS: { pts: 0 }, WILL: { pts: 6650, over: 1250 }, WLT: { pts: 0 } });
      await page.evaluate(() => (window as any).__openStatDetail('WILL'));
      await expect(page.locator('#stat-detail-level')).toContainText('Level 20');
      await expect(page.locator('#stat-detail-cur-xp')).toHaveText('1,250 XP');
      await expect(page.locator('#stat-detail-cur-xp + .stat-detail-xp-lbl')).toHaveText('Past max');
      await expect(page.locator('#stat-detail-total-xp')).toHaveText('7,900 XP');
      expect(await txt(page, 'stat-detail-pts')).toBe('7,900 XP');
      expect(await txt(page, 'stat-detail-tonext')).toBe('200,000 XP');
      await expect.poll(() => page.locator('#stat-detail-prog-bar').evaluate((e) => (e as HTMLElement).style.width)).toBe('4%');   // 7,900 of 200,000
      if (SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: SHOTS + '/stat-past-max-' + vp.width + '.png' }); }
      // a WILL habit at the cap: the level's points stay 6,650, the rest counts on
      await page.evaluate(() => (window as any).__applyStatPts({ name: 'Cold shower' }, 25, 1));
      await page.evaluate(() => (window as any).__openStatDetail('WILL'));
      await expect(page.locator('#stat-detail-cur-xp')).toHaveText('1,275 XP');
      await expect(page.locator('#stat-detail-total-xp')).toHaveText('7,925 XP');
      // the undo of that completion takes it back from the XP past max, not from the level
      await page.evaluate(() => (window as any).__applyStatPts({ name: 'Cold shower' }, 25, -1));
      await page.evaluate(() => (window as any).__openStatDetail('WILL'));
      await expect(page.locator('#stat-detail-cur-xp')).toHaveText('1,250 XP');
      await expect(page.locator('#stat-detail-level')).toContainText('Level 20');
    });

    test('below level 20 nothing changes: Current XP and the XP to the next level', async ({ page }) => {
      await boot(page, { STR: { pts: 300 }, VIT: { pts: 0 }, INT: { pts: 0 }, FOCUS: { pts: 0 }, WILL: { pts: 0 }, WLT: { pts: 0 } });
      await page.evaluate(() => (window as any).__openStatDetail('STR'));
      await expect(page.locator('#stat-detail-cur-xp + .stat-detail-xp-lbl')).toHaveText('Current XP');
      await expect(page.locator('#stat-detail-tonext')).toContainText('XP to Level');
      await expect(page.locator('#stat-detail-total-xp')).toHaveText('300 XP');
    });

    test('the 200,000 ceiling reads MAXED', async ({ page }) => {
      await boot(page, { STR: { pts: 0 }, VIT: { pts: 0 }, INT: { pts: 0 }, FOCUS: { pts: 0 }, WILL: { pts: 6650, over: 200000 - 6650 }, WLT: { pts: 0 } });
      await page.evaluate(() => (window as any).__applyStatPts({ name: 'Cold shower' }, 25, 1));   // nothing past the ceiling
      await page.evaluate(() => (window as any).__openStatDetail('WILL'));
      await expect(page.locator('#stat-detail-total-xp')).toHaveText('200,000 XP');
      await expect(page.locator('#stat-detail-tonext')).toHaveText('MAXED');
      await expect.poll(() => page.locator('#stat-detail-prog-bar').evaluate((e) => (e as HTMLElement).style.width)).toBe('100%');
    });
  });
}
