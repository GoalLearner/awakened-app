/**
 * Awakened — relic power follows boss rank (W1112).
 *
 * Owner 2026-10-29: "A rares > E ultra rares ... a rare drop from an A tier should outpower
 * E and D tier drops ... Common is obviously the weakest of the bunch." The ladder is rank
 * first, then rarity; commons sit under every rare. An upgraded relic wears its level beside
 * its PWR, since a level is the one thing that lifts a relic past the next rank's.
 * These specs pin:
 *   - the PWR the Items grid shows, for all 109 relics, follows that ladder;
 *   - the owner's amulet and weapon sheets read in rank order, upgrades marked LV.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, inventory: Record<string, unknown>, build?: (string | null)[]) {
  await page.addInitScript(([inv, bld]) => {
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
      if (sessionStorage.getItem('__w1112')) return;
      sessionStorage.setItem('__w1112', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_pokedex_collapsed', '[]');
      localStorage.setItem('hb_inventory', JSON.stringify({ cards: inv }));
      if (bld) localStorage.setItem('hb_hunter_build', JSON.stringify({ slots: bld, updated_at: new Date().toISOString() }));
    } catch (_) { /* noop */ }
  }, [inventory, build || null] as [Record<string, unknown>, (string | null)[] | null]);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

async function openSlot(page: Page, slotIndex: number) {
  await page.evaluate(() => document.getElementById('tab-items')!.click());
  await expect(page.locator('#armory-open-btn')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => document.getElementById('armory-open-btn')!.click());
  const slot = page.locator('.gear-card[data-slot-index="' + slotIndex + '"]');
  await expect(slot).toBeVisible({ timeout: 10_000 });
  await slot.evaluate((el) => (el as HTMLElement).click());
}

const owned = (lvl = 0) => ({ count: 1, discovered: true, first_acquired_date: '2026-08-06', upgrade_level: lvl });

test.describe('Relic power follows boss rank (W1112)', () => {
  test('every relic the Items grid shows: rank first, then rarity; commons under every rare', async ({ page }) => {
    await boot(page, {});
    const ids: string[] = await page.evaluate(() => Object.keys((window as any).Drops.CARDS));
    expect(ids.length).toBeGreaterThan(100);
    const inv: Record<string, unknown> = {};
    ids.forEach((id) => { inv[id] = owned(); });
    await page.evaluate((v) => { localStorage.setItem('hb_inventory', JSON.stringify({ cards: v })); }, inv);
    await page.reload();
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    await expect(page.locator('.pokedex-card[data-card-id="nightfall_blade"] .pdx-pwr .pn')).toBeVisible({ timeout: 10_000 });
    const rows = await page.evaluate(() => {
      const C = (window as any).Drops.CARDS;
      return Array.from(document.querySelectorAll('.pokedex-card[data-card-id]')).map((el) => {
        const id = el.getAttribute('data-card-id')!;
        return { id, tier: C[id].tier, rarity: C[id].rarity, pwr: +(el.querySelector('.pdx-pwr .pn')!.textContent || 0) };
      });
    });
    expect(rows.length).toBe(ids.length);
    const T: Record<string, number> = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5 };
    const R: Record<string, number> = { rare: 0, ultra_rare: 1, mythic: 2 };
    const drops = rows.filter((r) => r.rarity in R);
    const commons = rows.filter((r) => r.rarity === 'common');
    const bad: string[] = [];
    drops.forEach((a) => drops.forEach((b) => {
      if (T[a.tier] * 3 + R[a.rarity] < T[b.tier] * 3 + R[b.rarity] && a.pwr >= b.pwr) bad.push(a.id + ' ' + a.pwr + ' >= ' + b.id + ' ' + b.pwr);
    }));
    const weakestRare = Math.min(...drops.map((r) => r.pwr));
    commons.forEach((c) => { if (c.pwr >= weakestRare) bad.push(c.id + ' (common) ' + c.pwr + ' >= weakest rare ' + weakestRare); });
    expect(bad).toEqual([]);
    // No upgrades here, so no level tags.
    await expect(page.locator('.pokedex-card .relic-lv')).toHaveCount(0);
  });

  test("the owner's amulet sheet: rank order, the upgraded ones marked", async ({ page }) => {
    await boot(page, {
      pendant_of_the_seventh_hour: owned(),
      ember_ledger_of_the_patient_flame: owned(3),
      amulet_of_the_endless_stair: owned(),
      keystone_pendant: owned(),
      pendant_of_the_wakeful: owned(3),
      moonlit_lens: owned(),
      sobriety_token: owned(),
    }, [null, 'pendant_of_the_seventh_hour', null, null, null, null, null, null]);
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    await expect(page.locator('.pokedex-card[data-card-id="ember_ledger_of_the_patient_flame"] .relic-lv')).toHaveText('LV 3', { timeout: 10_000 });
    await expect(page.locator('.pokedex-card[data-card-id="amulet_of_the_endless_stair"] .relic-lv')).toHaveCount(0);
    await openSlot(page, 1);
    await expect(page.locator('#build-picker-title')).toHaveText('SWAP AMULET', { timeout: 10_000 });
    const order = await page.locator('#build-picker-grid .build-picker-tile').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')));
    expect(order).toEqual(['pendant_of_the_seventh_hour', 'ember_ledger_of_the_patient_flame', 'amulet_of_the_endless_stair', 'keystone_pendant', 'pendant_of_the_wakeful', 'moonlit_lens', 'sobriety_token']);
    await expect(page.locator('.build-picker-tile[data-card-id="ember_ledger_of_the_patient_flame"] .build-picker-tile-lv')).toHaveText('LV 3');
    await expect(page.locator('.build-picker-tile[data-card-id="pendant_of_the_wakeful"] .build-picker-tile-lv')).toHaveText('LV 3');
    await expect(page.locator('.build-picker-tile[data-card-id="keystone_pendant"] .build-picker-tile-lv')).toHaveCount(0);
  });

  test("the owner's weapon sheet: B rares above a maxed D ultra, a maxed E ultra last of the drops", async ({ page }) => {
    await boot(page, {
      duskforge_greatblade: owned(3),
      titan_oathblade: owned(3),
      the_long_pursuit: owned(),
      crownpiercer: owned(),
      the_monarchs_writ: owned(),
      bothsight_longbow: owned(3),
      kilnforged_warblade: owned(),
      coursing_houndcall: owned(),
      houndsfang_recurve: owned(),
    }, [null, null, null, 'duskforge_greatblade', null, null, null, null]);
    await openSlot(page, 3);
    await expect(page.locator('#build-picker-title')).toHaveText('SWAP WEAPON', { timeout: 10_000 });
    const order = await page.locator('#build-picker-grid .build-picker-tile').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')));
    expect(order.indexOf('crownpiercer')).toBeLessThan(order.indexOf('titan_oathblade'));
    expect(order.indexOf('the_monarchs_writ')).toBeLessThan(order.indexOf('titan_oathblade'));
    expect(order[order.length - 1]).toBe('bothsight_longbow');
    // Kilnforged (C rare) now above Bothsight (E ultra), even maxed.
    expect(order.indexOf('kilnforged_warblade')).toBeLessThan(order.indexOf('bothsight_longbow'));
  });
});
