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
      localStorage.setItem('hb_fri_banner_' + ymd, '1'); localStorage.setItem('hb_fri_banner_' + new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()), '1');   // the app keys it by the PT date (CI runs in UTC)
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
    await expect(page.locator('#guild-bosses-ledger-unique')).toHaveText(/^2\/\d+$/);   // BOSSES = 2 beaten, of every boss (W1202)

    // Both co-op bosses render as CO-OP-tagged rows.
    await expect(page.locator('.guild-bosses-row--coop:not(.guild-bosses-row--unslain)')).toHaveCount(2);
    await expect(page.locator('.guild-bosses-coop-tag').first()).toBeVisible();
  });

  test('a single co-op boss counts exactly its kill count (no double-count)', async ({ page }) => {
    await freshAppWithCoopKills(page, {
      the_twin_maw: { count: 5, last: '2026-06-28T10:00:00.000Z' },
    });
    await openKillLog(page);

    await expect(page.locator('#guild-bosses-ledger-total')).toHaveText('5');
    await expect(page.locator('#guild-bosses-ledger-unique')).toHaveText(/^1\/\d+$/);
    await expect(page.locator('.guild-bosses-row--coop:not(.guild-bosses-row--unslain)')).toHaveCount(1);
  });

  test('no kills at all → ledger total reads 0, no co-op rows', async ({ page }) => {
    await freshAppWithCoopKills(page, {});
    await openKillLog(page);

    await expect(page.locator('#guild-bosses-ledger-total')).toHaveText('0');
    await expect(page.locator('.guild-bosses-row--coop:not(.guild-bosses-row--unslain)')).toHaveCount(0);
  });

  // W1202 — owner 2026-11-13: "Make sure that every boss is on the boss kill log as well as the raid boss has it's own
  // category". Every solo and co-op boss is listed (not yet beaten = dimmed at 0, nothing to share), and the raid gate's
  // Grinning God sits in its own RAID group ahead of the ranks.
  test('W1202: every boss is on the log, unbeaten ones dimmed at 0; the Grinning God has its own Raid group first', async ({ page }) => {
    await freshAppWithCoopKills(page, { the_twin_maw: { count: 2, last: '2026-06-28T10:00:00.000Z' } });
    await openKillLog(page);
    const all = await page.evaluate(() => Object.keys((window as any).Bosses.BOSSES).length);
    expect(all).toBeGreaterThanOrEqual(40);
    await expect(page.locator('#guild-bosses-list .guild-bosses-row')).toHaveCount(all);
    await expect(page.locator('#guild-bosses-list .guild-bosses-row--unslain')).toHaveCount(all - 1);
    await expect(page.locator('#guild-bosses-ledger-unique')).toHaveText('1/' + all);
    await expect(page.locator('#guild-bosses-list .guild-bosses-row--unslain[data-bkshare]')).toHaveCount(0);   // nothing to share yet
    // the raid group leads, with the God alone in it
    const first = page.locator('#guild-bosses-list .guild-bosses-group').first();
    await expect(first).toHaveClass(/guild-bosses-group--raid/);
    await expect(first.locator('.guild-bosses-group-label')).toHaveText('Raid');
    await expect(first.locator('.guild-bosses-title')).toHaveText(['The Grinning GodCO-OP']);
    // the ranks follow, S first; a weekly boss and a duo are on the list too
    await expect(page.locator('#guild-bosses-list .guild-bosses-group').nth(1).locator('.guild-bosses-group-label')).toHaveText('S Rank');
    await expect(page.locator('#guild-bosses-list [data-boss-id="the_footsore_herald"]')).toHaveCount(1);
    await expect(page.locator('#guild-bosses-list [data-boss-id="the_coursing_dread"]')).toHaveCount(1);
    // the beaten boss leads its group and can be shared
    await expect(page.locator('#guild-bosses-list .guild-bosses-group--rank-e .guild-bosses-row').first()).toHaveAttribute('data-boss-id', 'the_twin_maw');
    await expect(page.locator('#guild-bosses-list [data-boss-id="the_twin_maw"][data-bkshare]')).toHaveCount(1);
  });
});
