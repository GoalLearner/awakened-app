/**
 * Awakened — key-screens render pass (W746, vibe-code audit item 7).
 *
 * "Screenshot tests on your five most important pages catch what your eyes
 * skip." The smoke suite covers Status / Habits / Leaderboard / Boss detail;
 * the two top-traffic surfaces it did NOT cover are exactly the ones with
 * recent churn:
 *   V. Armory sheet (W741 gear-power math + W742 tappable breakdown shipped
 *      this week) — opens from the Items tab, GEAR POWER pill renders a
 *      number, the W742 "How Gear Power works" popup opens on tap.
 *   W. Settings sheet — opens from the header ⚙️, renders, closes clean
 *      (a stranded overlay here would brick every subsequent tap).
 *
 * Boot/gate seeding + the overlay neutralizer are copied from smoke.spec.ts
 * (they are deliberately self-contained there; a shared helper module would
 * couple the suites' failure modes).
 */
import { test, expect, Page } from '@playwright/test';

// Same full-screen-overlay neutralizer as smoke.spec.ts (splash + Friday
// challenge + Monday update banner intercept clicks on CI runners).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) {
        const s = document.createElement('style');
        s.id = 'e2e-splash-kill';
        s.textContent = css;
        root.appendChild(s);
      }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
  });
});

async function freshApp(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hb_onboarding_seen_v2', '1');
      localStorage.setItem('hb_welcomed', '1');
      localStorage.setItem('hb_hunter_name_claimed', '1');
      localStorage.setItem('hb_cloud_restore_dismissed', '1');
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      const d = new Date();
      const ymd = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_fri_banner_' + ymd, '1');
    } catch (_) {}
  });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
  await page
    .locator('#awakened-splash')
    .waitFor({ state: 'detached', timeout: 6_000 })
    .catch(() => { /* tolerated */ });
  await page.evaluate(() => {
    const splash = document.getElementById('awakened-splash');
    if (splash) splash.remove();
    const ids = ['wn-overlay', 'wn-modal', 'modal-overlay', 'welcome-overlay', 'fri-challenge-modal', 'cin-onboarding'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) el.classList.add('hidden');
    });
  });
}

// ─────────────────────────────────────────────────────────────
// V. Armory sheet — W741 gear power + W742 breakdown popup
// ─────────────────────────────────────────────────────────────
test.describe('V · Armory sheet (W741/W742)', () => {
  test('opens from Items tab; GEAR POWER pill numeric; breakdown popup opens', async ({ page }) => {
    await freshApp(page);
    // The Armory entry lives on the Items tab (Relic Archive CTA).
    await page.locator('#tab-items').click();
    await expect(page.locator('#tab-items.active')).toBeVisible();
    const openBtn = page.locator('#armory-open-btn');
    await expect(openBtn).toBeVisible({ timeout: 10_000 });
    // DOM-level click (smoke-suite precedent, spec D): a first-run coachmark
    // pointer can hover the Items tab and intercept the hit-test even though
    // the button is visible/enabled — the app's own handler runs either way.
    await page.evaluate(() => document.getElementById('armory-open-btn')!.click());

    // Armory mounted: the W741 GEAR POWER pill renders a plain number
    // (0 for a fresh user with nothing equipped — numeric either way).
    const gp = page.locator('#armory-gear-power');
    await expect(gp).toBeVisible({ timeout: 10_000 });
    await expect(gp).toHaveText(/^\d+$/);

    // W742 — tapping the pill opens the "How Gear Power works" breakdown
    // (shared notice card). DOM-level click again: the sheet's slide-in
    // animation keeps the pill "not stable" for Playwright's hit-test.
    await page.evaluate(() => document.getElementById('armory-gp-pill')!.click());
    await expect(page.getByText(/how gear power works/i).first()).toBeVisible({ timeout: 5_000 });
  });
});

// ─────────────────────────────────────────────────────────────
// W. Settings sheet — open + close without stranding the overlay
// ─────────────────────────────────────────────────────────────
test.describe('W · Settings sheet', () => {
  test('opens from the header gear, renders, closes clean', async ({ page }) => {
    await freshApp(page);
    await page.locator('#settings-btn').click();
    const sheet = page.locator('#settings-sheet');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Settings').first()).toBeVisible();

    // Close must fully dismiss the sheet AND its overlay — a stranded
    // overlay silently swallows every subsequent tap (same failure class
    // as the smoke suite's Edit-Habit-modal regression).
    await page.locator('#settings-close').click();
    await expect(sheet).toBeHidden({ timeout: 5_000 });
    const overlayBlocks = await page.evaluate(() => {
      const ov = document.getElementById('settings-overlay');
      return !!ov && !ov.classList.contains('hidden');
    });
    expect(overlayBlocks).toBe(false);
  });
});
