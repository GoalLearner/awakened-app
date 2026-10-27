/**
 * Awakened — the Rising: nine more earned looks (W1105), client side.
 *
 * Owner 2026-10-27: earned skins for milestones on the way up — 50 bosses, A rank, Floor 50,
 * a 15,000-step day, a perfect month (the phone claims these), and 10 friend hunts won, 25
 * trios won, a trio at every rank, a Worldgate podium (only the server grants these). Pinned:
 *   - the Wardrobe shows the Rising under the Seven, three rows of three, with progress;
 *   - the phone claims the solo five from its own numbers, never the four co-op ones;
 *   - the best day of steps outlives the 30-day daily map;
 *   - a Rising skin the server granted while an older build ran is celebrated once.
 *
 * Auth is stubbed through a setter trap on window.Auth (auth.js assigns it once).
 */
import { test, expect, Page } from '@playwright/test';

interface Fx { owned?: string[]; granted?: string[]; seed?: Record<string, string> }

async function boot(page: Page, fx: Fx) {
  await page.addInitScript((f: Fx) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) {
        const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s);
      }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_skins_owned_cache', JSON.stringify({ skins: f.owned || [], at: Date.now() }));
      localStorage.setItem('hb_earn_bg_seen_v1', '[]');
      Object.keys(f.seed || {}).forEach((k) => localStorage.setItem(k, (f.seed as Record<string, string>)[k]));
    } catch (_) { /* noop */ }
    const patch = (a: any) => {
      if (!a || a.__w1105Patched) return;
      a.__w1105Patched = true;
      a.getBackendUserId = () => 'me';
      a.isMember = () => true;
      a.founderSeq = () => 0;
      a.fetchEntitlements = async () => ({ ok: true, skins: f.owned || [], premium: false, member: true });
      a.earnSkins = async () => {
        const granted = (f.granted || []).filter((id) => !(f.owned || []).includes(id));
        f.owned = Array.from(new Set([...(f.owned || []), ...granted]));
        f.granted = [];
        return { ok: true, skins: f.owned, granted, progress: { opened: { best: 3, current: 3 }, flame: { best: 0 }, coop: { wins: 12, trioWins: 3, trioRanks: ['D', 'C'], podium: 0 } } };
      };
    };
    let real: any;
    Object.defineProperty(window, 'Auth', {
      configurable: true,
      get() { return real; },
      set(v) { real = v; try { patch(v); } catch (_) { /* noop */ } },
    });
  }, fx);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

const OATH = 'avatar-skin-oathbound.png', HUNT = 'avatar-skin-huntmaster.png';
const STRIDE = 'avatar-skin-stridewalker.png', UNBROKEN = 'avatar-skin-unbroken.png';

test.describe('The Rising (W1105)', () => {
  test('nine looks under the seven, three rows of three, with progress', async ({ page }) => {
    await boot(page, { owned: [HUNT], seed: { hb_leaderboard: JSON.stringify({ steps_daily: { '2026-10-20': 12000 } }) } });
    await page.evaluate(() => (window as any).__openWardrobe());
    const sh = page.locator('#wd-sheet');
    const rising = sh.locator('.wx-rising .wx-sk');
    await expect(rising).toHaveCount(9);
    await expect(sh.locator('.wx-sec-h span', { hasText: 'The Rising' })).toBeVisible();
    await expect(sh.locator('[data-sk="huntmaster"] .wx-sk-st')).toHaveText('EARNED');
    await expect(sh.locator('[data-sk="stridewalker"] .wx-sk-st')).toHaveText('12K / 15K');
    await expect(sh.locator('[data-sk="oathbound"]')).toHaveClass(/is-locked/);
    // three per row: the 4th tile starts a new row, level with the 1st
    const boxes = await rising.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.top)]));
    expect(boxes[3][0]).toBe(boxes[0][0]);
    expect(boxes[3][1]).toBeGreaterThan(boxes[0][1]);
    expect(boxes[1][1]).toBe(boxes[0][1]);
    // a locked one explains itself
    await sh.locator('[data-sk="triarch"]').click();
    await expect(sh.locator('.wx-dt.open')).toContainText('Win a trio hunt at every rank, D to A');
  });

  test('the phone claims the solo ones its numbers meet, never the co-op four', async ({ page }) => {
    await boot(page, {
      owned: [],
      seed: {
        hb_leaderboard: JSON.stringify({ steps_daily: { '2026-10-20': 16000 } }),
        hb_achievements: JSON.stringify(['perfect_month']),
        hb_earn_progress_v1: JSON.stringify({ opened: 3, flame: 0, coopWins: 30, trioWins: 30, trioRanks: 4, podium: 2 }),
      },
    });
    const claims = await page.evaluate(() => (window as any).__earn.claims());
    expect(claims.sort()).toEqual([STRIDE, UNBROKEN].sort());
  });

  test('the best day of steps outlives the 30-day map', async ({ page }) => {
    await boot(page, { owned: [], seed: { hb_leaderboard: JSON.stringify({ steps_daily: { '2026-10-20': 16000 } }) } });
    await page.evaluate(() => (window as any).__earn.claims());
    expect(await page.evaluate(() => localStorage.getItem('hb_best_day_steps_v1'))).toBe('16000');
    const claims = await page.evaluate(() => {
      localStorage.setItem('hb_leaderboard', JSON.stringify({ steps_daily: { '2026-10-27': 900 } }));
      return (window as any).__earn.claims();
    });
    expect(claims).toContain(STRIDE);
    expect(await page.evaluate(() => localStorage.getItem('hb_best_day_steps_v1'))).toBe('16000');
  });

  test('a Rising skin granted while an older build ran is celebrated once', async ({ page }) => {
    await boot(page, { owned: [OATH] });   // the server already holds it; this call grants nothing new
    await page.evaluate(() => (window as any).__earn.tick(true));
    await expect(page.locator('#earn-ce')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#earn-ce')).toContainText('The Oathbound');
    await expect(page.locator('#earn-ce')).toContainText('Epic');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_earn_rising_seen_v1') || '[]'))).toEqual([OATH]);
    // the next answer owes nothing
    await page.evaluate(() => { localStorage.setItem('hb_earn_pending_v1', '[]'); return (window as any).__earn.tick(true); });
    expect(await page.evaluate(() => (window as any).__earn.pending())).toEqual([]);
  });
});
