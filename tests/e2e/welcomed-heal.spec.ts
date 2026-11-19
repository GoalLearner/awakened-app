/**
 * Awakened — the missing welcome mark heals (W1244).
 *
 * Owner 2026-11-19: "Gali says she has never seen a daily briefing .. investigate why I am the only one that is
 * getting it". Gali and Nicole were playing with vows and a name but no `hb_welcomed`, and that mark gates the
 * morning briefing and the daily soul bonus. Pinned here:
 *   - a hunter with vows and a name, no mark: the mark is set at boot, the daily souls arrive, the briefing can open;
 *   - no vows yet: nothing is set (onboarding still owns those hunters).
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, seed: Record<string, string>) {
  await page.addInitScript(([s]: [Record<string, string>]) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const st = document.createElement('style'); st.id = 'e2e-splash-kill'; st.textContent = css; root.appendChild(st); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__wh')) return; sessionStorage.setItem('__wh', '1');
      // a returning hunter's keys, WITHOUT hb_welcomed
      ['hb_onboarding_seen_v2', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_bosses_engagement_migrated'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_origin_beginning', JSON.stringify({ text: 'Hunter was nothing yet.', classKey: null, dateISO: '2026-05-04', dateDisplay: 'May 4, 2026' }));
      const d = new Date();
      const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_daily_insight_last_shown', ymd);   // keep the sheet from opening over the checks; canReopen still answers
      Object.keys(s).forEach((k) => localStorage.setItem(k, s[k]));
      localStorage.removeItem('hb_welcomed');
    } catch (_) { /* noop */ }
  }, [seed] as [Record<string, string>]);
  await page.goto('/');
  await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
}

const VOW = JSON.stringify([{ id: 'wh-read', name: 'Read', emoji: '•', difficulty: 'easy', type: 'build' }]);
const state = (page: Page) => page.evaluate(() => {
  const souls = JSON.parse(localStorage.getItem('hb_souls') || '{}');
  const d = new Date();
  const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { welcomed: localStorage.getItem('hb_welcomed'), bonusToday: souls.lastDailyBonusDate === ymd, canReopen: !!(window as any).__tb.canReopen() };
});

test.describe('W1244 — the welcome mark heals', () => {
  test('a hunter with vows and a name gets the mark, the daily souls and the briefing', async ({ page }) => {
    await boot(page, { hb_name: 'Galilea', hb_habits: VOW });
    await expect.poll(() => state(page)).toEqual({ welcomed: '1', bonusToday: true, canReopen: true });
  });

  test('no vows yet: nothing is set', async ({ page }) => {
    await boot(page, { hb_name: 'Galilea', hb_habits: '[]' });
    await page.waitForTimeout(800);
    expect(await state(page)).toEqual({ welcomed: null, bonusToday: false, canReopen: false });
  });
  // (no "no name" case: the localhost dev sign-in always writes hb_name = 'DevUser' before boot, as a real
  // sign-in writes the alias, so a nameless hunter with vows can't be staged here.)
});
