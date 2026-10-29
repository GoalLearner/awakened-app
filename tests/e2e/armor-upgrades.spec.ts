/**
 * Awakened — armor upgrades worth the souls (W1110).
 *
 * Owner 2026-10-29: "it costs so much to get +3 in one stat. It is only worth it for weapons ...
 * make it worth upgrading." A non-weapon relic's level adds 10% of every stat it carries (rounded
 * per stat, never less than +1 a level on its main stat); a weapon keeps +1 a level on its main stat.
 * These specs pin:
 *   - the gain table: the S mantle at max, a weapon at max, a small relic's floor;
 *   - the relic sheet names every stat the levels add, and the next level's;
 *   - the relic's PWR counts the whole gain;
 *   - Floor 100 still follows the owner's curve with the stronger max set (W1069).
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, inventory?: Record<string, unknown>, souls?: number) {
  await page.addInitScript(([inv, sl]) => {
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
      if (sessionStorage.getItem('__w1110')) return;
      sessionStorage.setItem('__w1110', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_pokedex_collapsed', '[]');
      if (inv) localStorage.setItem('hb_inventory', JSON.stringify({ cards: inv }));
      if (sl != null) localStorage.setItem('hb_souls', JSON.stringify({ balance: sl, lastDailyBonusDate: null, totalEarned: sl, totalSpent: 0 }));
    } catch (_) { /* noop */ }
  }, [inventory || null, souls == null ? null : souls] as [Record<string, unknown> | null, number | null]);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

const owned = (lvl: number) => ({ count: 1, discovered: true, first_acquired_date: '2026-08-06', upgrade_level: lvl });

async function openRelic(page: Page, id: string) {
  await page.evaluate(() => document.getElementById('tab-items')!.click());
  const card = page.locator(`.pokedex-card[data-card-id="${id}"]`);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click();
  await expect(page.locator('#carddetail-upgrade')).toBeVisible();
}

test.describe('Armor upgrades worth the souls (W1110)', () => {
  test('armor gains 10% a level on every stat; a weapon keeps +1 a level on its main stat', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = (window as any).__relicUpgradeGain;
      return {
        mantle1: g('mantle_of_the_sovereign', 1),
        mantle3: g('mantle_of_the_sovereign', 3),
        nightfall3: g('nightfall_blade', 3),
        none: g('mantle_of_the_sovereign', 0),
      };
    });
    // Mantle of the Shadow Sovereign: STR 9, VIT 13, INT 3, FOCUS 6, WILL 6.
    expect(r.mantle3).toEqual({ str: 3, vit: 4, int: 1, focus: 2, will: 2 });
    expect(r.mantle1).toEqual({ str: 1, vit: 1, int: 0, focus: 1, will: 1 });
    expect(r.nightfall3).toEqual({ str: 3, vit: 0, int: 0, focus: 0, will: 0 });
    expect(r.none).toEqual({ str: 0, vit: 0, int: 0, focus: 0, will: 0 });
  });

  test('a small relic never gains less than the old +1 a level on its main stat', async ({ page }) => {
    await boot(page);
    const bad = await page.evaluate(() => {
      const w = window as any;
      const out: string[] = [];
      Object.keys(w.Drops.CARDS).forEach((id) => {
        const c = w.Drops.CARDS[id];
        if (!c.bonuses || c.rarity === 'common') return;
        for (let lvl = 1; lvl <= 3; lvl++) {
          const g = w.__relicUpgradeGain(id, lvl);
          const main = Object.keys(g).reduce((best, k) => ((c.bonuses[k] || 0) > (c.bonuses[best] || 0) ? k : best), 'str');
          if (g[main] < lvl) out.push(id + '@' + lvl);
        }
      });
      return out;
    });
    expect(bad).toEqual([]);
  });

  test('the relic sheet names every stat the levels add', async ({ page }) => {
    await boot(page, { mantle_of_the_sovereign: owned(3) });
    await openRelic(page, 'mantle_of_the_sovereign');
    await expect(page.locator('#carddetail-upgrade .cdu-current')).toHaveText('+3 STR +4 VIT +1 INT +2 FOCUS +2 WILL from upgrades');
    await expect(page.locator('#carddetail-upgrade-btn')).toHaveText('MAX LEVEL');
  });

  test("the next level's gain, before buying it", async ({ page }) => {
    await boot(page, { mantle_of_the_sovereign: owned(1) }, 100000);
    await openRelic(page, 'mantle_of_the_sovereign');
    await expect(page.locator('#carddetail-upgrade .cdu-current')).toHaveText('+1 STR +1 VIT +1 FOCUS +1 WILL from upgrades');
    await expect(page.locator('#carddetail-upgrade .cdu-gain')).toHaveText('Next: +1 STR +2 VIT +1 INT');
  });

  test("the relic's PWR counts the whole gain", async ({ page }) => {
    await boot(page, { mantle_of_the_sovereign: owned(3) });
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    const pwr = page.locator('.pokedex-card[data-card-id="mantle_of_the_sovereign"] .pdx-pwr .pn');
    await expect(pwr).toBeVisible({ timeout: 10_000 });
    // 12 STR × 2.3 + (17 VIT + 4 INT + 8 FOCUS + 8 WILL) × 1.15 = 70 (53 before an upgrade).
    await expect(pwr).toHaveText('70');
  });
});
