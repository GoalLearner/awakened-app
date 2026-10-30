/**
 * Awakened — relic cards, three across (W1113).
 *
 * ClaudeDesign "Relic Cards · Three Across": the same three-column Items grid, every fact in
 * its own place. The art carries only the slot + class strip and the EQUIPPED/NEW pill (and
 * the level); tier, count and PWR sit on a solid row; the name and source wrap in full; the
 * trade control is the card's own footer, so a row of three lines up.
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
      if (sessionStorage.getItem('__w1113')) return;
      sessionStorage.setItem('__w1113', '1');
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
  await page.evaluate(() => document.getElementById('tab-items')!.click());
}

const owned = (lvl = 0, count = 1) => ({ count, discovered: true, first_acquired_date: '2026-08-06', upgrade_level: lvl });
const card = (page: Page, id: string) => page.locator('.pokedex-card[data-card-id="' + id + '"]');

test.describe('Relic cards, three across (W1113)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('one relic is one object: art strip, stats row, full name and source, trade footer', async ({ page }) => {
    await boot(page, {
      duskforge_greatblade: owned(3),
      pendant_of_the_seventh_hour: owned(),
      ember_ledger_of_the_patient_flame: owned(3),
      crownpiercer: owned(0, 3),
    }, [null, 'pendant_of_the_seventh_hour', null, 'duskforge_greatblade', null, null, null, null]);
    const dusk = card(page, 'duskforge_greatblade');
    await expect(dusk).toBeVisible({ timeout: 10_000 });
    // The art: slot + class along its foot, EQUIPPED + the level up top.
    await expect(dusk.locator('.pokedex-card-art .archive-slot-badge')).toHaveText('WEAPON');
    await expect(dusk.locator('.pokedex-card-art .pdx-class')).toHaveText(/melee/i);
    await expect(dusk.locator('.pdx-art-top .archive-equipped-badge')).toHaveText('EQUIPPED');
    await expect(dusk.locator('.pdx-art-top .relic-lv')).toHaveText('LV 3');
    // Tier, count and power on their own row, off the picture.
    await expect(dusk.locator('.pdx-stats .relic-tier')).toHaveText('A');
    await expect(dusk.locator('.pdx-stats .pdx-pwr .pn')).toHaveText(/^\d+$/);
    await expect(card(page, 'crownpiercer').locator('.pdx-stats .pdx-count')).toHaveText('×3');
    await expect(page.locator('.pdx-artfoot, .pdx-pmeter')).toHaveCount(0);
    // Words finish: no clamp, no ellipsis.
    const text = await dusk.evaluate((el) => {
      const n = el.querySelector('.pokedex-card-name') as HTMLElement, s = el.querySelector('.archive-item-source') as HTMLElement;
      return { name: n.textContent, nameCut: n.scrollHeight > n.clientHeight + 1, srcWS: getComputedStyle(s).whiteSpace, srcCut: s.scrollWidth > s.clientWidth + 1 };
    });
    expect(text).toEqual({ name: 'Duskforge, Verdict of the Anvil', nameCut: false, srcWS: 'normal', srcCut: false });
    // The cell draws the card; the trade control is its footer, flush with the bottom.
    const box = await page.evaluate(() => [].map.call(document.querySelectorAll('.pokedex-section--ultra_rare .pokedex-cell'), (c: HTMLElement) => {
      // the footer = the trade button (+ its "Need N more" line on an unaffordable BUY)
      const cr = c.getBoundingClientRect(), t = c.querySelector('.market-trade')!.getBoundingClientRect(), last = c.lastElementChild!.getBoundingClientRect();
      const footerLast = c.lastElementChild!.matches('.market-trade, .market-trade-need');
      return { flush: footerLast && Math.abs(cr.bottom - 1 - last.bottom) < 1.5, foot: Math.round(t.bottom), eq: c.classList.contains('pokedex-cell--eq') };
    }));
    expect(box.length).toBeGreaterThanOrEqual(3);
    box.forEach((b: any) => expect(b.flush).toBe(true));
    expect(new Set(box.slice(0, 3).map((b: any) => b.foot)).size).toBe(1);   // a row of three lines up on the footer
    expect(box.filter((b: any) => b.eq).length).toBe(2);
  });

  test('the level never runs into EQUIPPED on a narrow card', async ({ page }) => {
    await boot(page, { duskforge_greatblade: owned(3) }, [null, null, null, 'duskforge_greatblade', null, null, null, null]);
    const dusk = card(page, 'duskforge_greatblade');
    await expect(dusk.locator('.pdx-art-top .relic-lv')).toBeVisible({ timeout: 10_000 });
    const r = await dusk.evaluate((el) => {
      const a = el.querySelector('.archive-equipped-badge')!.getBoundingClientRect(), b = el.querySelector('.pdx-art-top .relic-lv')!.getBoundingClientRect(), art = el.querySelector('.pokedex-card-art')!.getBoundingClientRect();
      return { apart: a.left >= b.right || b.left >= a.right || a.top >= b.bottom || b.top >= a.bottom, eqRight: Math.round(art.right - a.right), lvLeft: Math.round(b.left - art.left) };
    });
    expect(r).toEqual({ apart: true, eqRight: 7, lvLeft: 7 });
  });

  // Owner 2026-10-30: "all the tiers already have their own colors" — the design's metal
  // palette was not taken; a relic's tier keeps the rank colours it shares with its boss.
  test('the tier chip keeps the rank colours: S pink, A red, B amber', async ({ page }) => {
    await boot(page, { pendant_of_the_seventh_hour: owned(), duskforge_greatblade: owned(), ember_ledger_of_the_patient_flame: owned() });
    await expect(card(page, 'pendant_of_the_seventh_hour').locator('.relic-tier')).toBeVisible({ timeout: 10_000 });
    const colours = await page.evaluate(() => ['pendant_of_the_seventh_hour', 'duskforge_greatblade', 'ember_ledger_of_the_patient_flame'].map((id) =>
      getComputedStyle(document.querySelector('.pokedex-card[data-card-id="' + id + '"] .relic-tier')!).color));
    expect(colours).toEqual(['rgb(232, 121, 249)', 'rgb(239, 68, 68)', 'rgb(251, 191, 36)']);
  });
});
