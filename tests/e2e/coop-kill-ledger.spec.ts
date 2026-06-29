/**
 * Awakened — co-op kills in the Bosses Slain ledger (W545 / W546).
 *
 * Regression protection for:
 *   W545 — co-op dungeon wins now appear as rows in the Kill Log
 *          (Bosses Slain sheet), tagged CO-OP, via the per-boss
 *          hb_coop_kills counter.
 *   W546 — those co-op kills are folded into the ledger totals
 *          (TOTAL KILLS / BOSSES) so the headline counts agree.
 *
 * The bug class this guards: a co-op win that bumps the Kill Log rows
 * but NOT the headline totals (the inconsistency the owner reported),
 * or a regression that drops co-op from the ledger entirely.
 *
 * We assert against the Kill Log "Bosses Slain" sheet — the canonical,
 * always-mounted surface (its markup is static in index.html and it's
 * opened via the exposed window.openBossesSlainSheet). We seed
 * hb_coop_kills with co-op bosses and ZERO solo kills (no hb_bosses),
 * so every non-zero total is proof the co-op counts flow through.
 */
import { test, expect, Page } from '@playwright/test';

// ── Global overlay neutralizer (same as smoke.spec.ts) ───────────────────────
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal{display:none!important;visibility:hidden!important;pointer-events:none!important}';
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

type CoopKills = Record<string, { count: number; last: string }>;

async function freshAppWithCoopKills(page: Page, coopKills: CoopKills) {
  await page.addInitScript((kills) => {
    try {
      localStorage.setItem('hb_onboarding_seen_v2', '1');
      localStorage.setItem('hb_welcomed', '1');
      localStorage.setItem('hb_hunter_name_claimed', '1');
      localStorage.setItem('hb_cloud_restore_dismissed', '1');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_habits', '[]');
      const d = new Date();
      const ymd = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_fri_banner_' + ymd, '1');
      // The data under test: per-boss co-op kill counts. NO hb_bosses
      // (solo) is seeded, so every tally below is purely co-op-derived.
      localStorage.setItem('hb_coop_kills', JSON.stringify(kills));
    } catch (_) { /* noop */ }
  }, coopKills);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
  await page.locator('#awakened-splash').waitFor({ state: 'detached', timeout: 6_000 }).catch(() => { /* tolerated */ });
}

async function openKillLog(page: Page) {
  await page.evaluate(() => {
    const fn = (window as unknown as { openBossesSlainSheet?: () => void }).openBossesSlainSheet;
    if (fn) fn();
  });
  await expect(page.locator('#guild-bosses-sheet')).toBeVisible({ timeout: 10_000 });
}

test.describe('Co-op kills in the Bosses Slain ledger (W545/W546)', () => {
  test('two co-op bosses → ledger totals + tagged rows include co-op', async ({ page }) => {
    // twin_maw x3 + hollow_monarch x1 = 4 kills across 2 bosses, zero solo.
    await freshAppWithCoopKills(page, {
      the_twin_maw:       { count: 3, last: '2026-06-28T10:00:00.000Z' },
      the_hollow_monarch: { count: 1, last: '2026-06-27T10:00:00.000Z' },
    });
    await openKillLog(page);

    await expect(page.locator('#guild-bosses-ledger-total')).toHaveText('4');    // TOTAL KILLS = 3 + 1
    await expect(page.locator('#guild-bosses-ledger-unique')).toHaveText('2');   // BOSSES = 2 distinct

    // Both co-op bosses render as CO-OP-tagged rows.
    await expect(page.locator('.guild-bosses-row--coop')).toHaveCount(2);
    await expect(page.locator('.guild-bosses-coop-tag').first()).toBeVisible();
  });

  test('a single co-op boss counts exactly its kill count (no double-count)', async ({ page }) => {
    await freshAppWithCoopKills(page, {
      the_twin_maw: { count: 5, last: '2026-06-28T10:00:00.000Z' },
    });
    await openKillLog(page);

    await expect(page.locator('#guild-bosses-ledger-total')).toHaveText('5');
    await expect(page.locator('#guild-bosses-ledger-unique')).toHaveText('1');
    await expect(page.locator('.guild-bosses-row--coop')).toHaveCount(1);
  });

  test('no kills at all → ledger total reads 0, no co-op rows', async ({ page }) => {
    await freshAppWithCoopKills(page, {});
    await openKillLog(page);

    await expect(page.locator('#guild-bosses-ledger-total')).toHaveText('0');
    await expect(page.locator('.guild-bosses-row--coop')).toHaveCount(0);
  });
});
