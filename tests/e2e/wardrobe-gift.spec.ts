/**
 * Awakened — a one-of-one look (W1288), client side.
 *
 * Owner 2026-11-23: "I want to create 1 avatar skin specifically for galilea ... a purple aesthetic".
 * The Violet Queen is granted on the server to one hunter (a skin_entitlements row). Pinned:
 *   - its owner sees it in a "Yours Alone" row above the Elite Eight, and can wear it;
 *   - everyone else never sees it: no tile, no locked page, never a phone claim;
 *   - the owner gets one reveal ("MADE FOR YOU", One of One) the first time the phone sees it;
 *   - the launch-time auto-equip leaves it to the reveal;
 *   - a visitor's card names it in violet.
 *
 * Auth is stubbed through a setter trap on window.Auth (auth.js assigns it once).
 */
import { test, expect, Page } from '@playwright/test';

interface Fx { owned?: string[]; seed?: Record<string, string>; acquired?: Record<string, { at: string; how: string }> }
const VQ = 'avatar-skin-violetqueen.png';
const SHOTS = process.env.WX_SHOTS || '';

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
      if (!a || a.__w1288Patched) return;
      a.__w1288Patched = true;
      a.getBackendUserId = () => 'me';
      a.isMember = () => true;
      a.founderSeq = () => 0;
      a.fetchEntitlements = async () => ({ ok: true, skins: f.owned || [], premium: false, member: true });
      a.earnSkins = async () => ({ ok: true, skins: f.owned || [], granted: [], progress: { opened: { best: 3, current: 3 }, flame: { best: 0 }, coop: { wins: 0, trioWins: 0, trioRanks: [], podium: 0 } }, acquired: f.acquired || null });
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

test.describe('A one-of-one look (W1288)', () => {
  test('its owner sees it in Yours Alone, above the Elite Eight, and can wear it', async ({ page }) => {
    await boot(page, {
      owned: [VQ],
      acquired: { [VQ]: { at: '2026-11-23', how: 'earned' } },
      seed: { hb_earn_rising_seen_v1: JSON.stringify([VQ]) },   // already revealed
    });
    await page.evaluate(() => (window as any).__earn.tick(true));
    await page.evaluate(() => (window as any).__openWardrobe());
    const sh = page.locator('#wd-sheet');
    await expect(sh.locator('.wx-sec-h span').first()).toHaveText('Yours Alone');
    await expect(sh.locator('.wx-only .wx-sk')).toHaveCount(1);
    await expect(sh.locator('.wx-only [data-sk="violetqueen"] .wx-sk-st')).toHaveText('EARNED');
    await expect(sh.locator('.wx-eight .wx-sk')).toHaveCount(8);   // the Elite Eight stay eight
    await sh.locator('[data-sk="violetqueen"]').click();
    await expect(sh.locator('.wx-hl-nm')).toHaveText('The Violet Queen');
    await expect(sh.locator('.wx-hl-sub')).toContainText('One of One');
    await expect(sh.locator('.wx-hl-how')).toHaveText('');   // W1289 — owner: no "Made for Galilea" line
    expect(await page.evaluate(() => localStorage.getItem('hb_avatar_skin'))).toBe('avatar-skin-violetqueen.png');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/gift-01-wardrobe.png' });
  });

  test('everyone else never sees it: no tile, no locked page, never a claim', async ({ page }) => {
    await boot(page, { owned: [] });
    await page.evaluate(() => (window as any).__openWardrobe());
    const sh = page.locator('#wd-sheet');
    await expect(sh.locator('.wx-eight .wx-sk')).toHaveCount(8);
    await expect(sh.locator('[data-sk="violetqueen"]')).toHaveCount(0);
    await expect(sh.locator('.wx-sec-h span', { hasText: 'Yours Alone' })).toHaveCount(0);
    // the locked pager pages every locked look but this one
    await sh.locator('[data-sk="shadowborn"]').click();
    await expect(sh.locator('.wx-dt.open')).toBeVisible();
    await expect(sh.locator('.wx-dt.open')).not.toContainText('The Violet Queen');
    expect(await page.evaluate(() => (window as any).__earn.claims())).not.toContain('avatar-skin-violetqueen.png');
    // it cannot be worn without owning it
    expect(await page.evaluate(() => (window as any).__skinFileAllowed('avatar-skin-violetqueen.png'))).toBe(false);
  });

  test('its owner gets one reveal the first time the phone sees it', async ({ page }) => {
    await boot(page, { owned: [VQ] });   // granted by hand on the server; this phone has never seen it
    await page.evaluate(() => (window as any).__earn.tick(true));
    const ce = page.locator('#earn-ce');
    await expect(ce).toBeVisible({ timeout: 5000 });
    await expect(ce).toContainText('The Violet Queen');
    await expect(ce).toContainText('One of One');
    await expect(ce).toContainText('MADE FOR YOU');
    await expect(ce).not.toContainText('Galilea');   // W1289
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_earn_rising_seen_v1') || '[]'))).toEqual(['avatar-skin-violetqueen.png']);
    if (SHOTS) { await page.waitForTimeout(3500); await page.screenshot({ path: SHOTS + '/gift-02-reveal.png' }); }
    // the next answer owes nothing
    await page.evaluate(() => { localStorage.setItem('hb_earn_pending_v1', '[]'); return (window as any).__earn.tick(true); });
    expect(await page.evaluate(() => (window as any).__earn.pending())).toEqual([]);
  });

  test('a visitor sees it named in violet on her card', async ({ page }) => {
    await boot(page, { owned: [] });
    const tag = await page.evaluate(() => (window as any).__pcLookTag('avatar-skin-violetqueen.png'));
    expect(tag).toEqual({ name: 'The Violet Queen', color: '192,132,252' });
  });
});
