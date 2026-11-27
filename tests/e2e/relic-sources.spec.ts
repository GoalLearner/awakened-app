/**
 * Awakened — every boss that drops a relic, on the relic (W1109).
 *
 * Owner 2026-10-29: the mega-rares drop from other bosses now (the Grinning God's raid pool,
 * the weekly bosses' S jackpot), so a relic's source must list them all, the newer bosses too.
 * These specs pin:
 *   - the unknown-relic sheet lists every source, tags the co-op ones, and says "any of these";
 *   - the card detail line names every source in one sentence;
 *   - the newer bosses (weekly, trio) show up on the relics in their pools, and every relic has a source;
 *   - the reveal names the boss that actually dropped the relic, not the relic's own boss.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, inventory?: Record<string, unknown>) {
  await page.addInitScript((inv) => {
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
      if (sessionStorage.getItem('__w1109')) return;
      sessionStorage.setItem('__w1109', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_pokedex_collapsed', '[]');
      if (inv) localStorage.setItem('hb_inventory', JSON.stringify({ cards: inv }));
    } catch (_) { /* noop */ }
  }, inventory || null);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

test.describe('Every boss that drops a relic (W1109)', () => {
  test('the unknown-relic sheet lists every source of a mega-rare and tags the co-op raid', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    const card = page.locator('.pokedex-card[data-card-id="nightfall_blade"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.locator('#mystery-card-modal')).toBeVisible();
    await expect(page.locator('#mystery-card-source .mcs-src')).toHaveText([
      'Erebus, the Shadow Sovereign',
      'The Calorie Colossus',   // W1228 — the S calorie boss drops a mythic at 1%
      'The Bound KingsCO-OP',   // W1340 — the S half-each duos
      'The Grinning GodCO-OP',
      'The Halved SeraphCO-OP',
      'Every weekly boss',
    ]);
    await expect(page.locator('#mystery-card-howto')).toHaveText('');   // W1332 — the sources and HUNT BOSS say how
  });

  test('the card detail names every source in one line', async ({ page }) => {
    await boot(page, { mantle_of_the_sovereign: { count: 1, discovered: true, first_acquired_date: '2026-08-06' } });
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    const card = page.locator('.pokedex-card[data-card-id="mantle_of_the_sovereign"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    const src = page.locator('#carddetail-source');
    await expect(src).toHaveText(/^Dropped from Erebus, the Shadow Sovereign, .+ and every weekly boss$/);
  });

  test('the newer bosses are on the relics they drop, and no relic is left without a source', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const ids = Object.keys(w.Drops.CARDS);
      return {
        none: ids.filter((id) => w.__relicSources(id).length === 0),
        boots: w.__relicSources('trail_worn_boots'),
        dusk: w.__relicSources('duskforge_greatblade'),
        vigil: w.__relicSources('vigil_bow'),
      };
    });
    expect(r.none).toEqual([]);
    expect(r.boots[0]).toBe('The Steel Wolf');                 // its own boss leads
    expect(r.boots).toContain('The Footsore Herald');          // W1070 weekly boss, E
    expect(r.dusk).toContain('The Unending Road');             // W1070 weekly boss, A
    expect(r.dusk).toContain('The Oracle of Deep Hours');      // W1071 weekly sleep boss, A
    expect(r.dusk).toContain('The Trinity Colossus');          // W1104 trio, A
    expect(r.vigil).toEqual(['The Myrmidon King', 'The Calorie Colossus', 'The Bound Kings', 'The Grinning God', 'The Halved Seraph', 'Every weekly boss']);   // W1228, W1340
  });

  test("the reveal names the boss that dropped the relic, not the relic's own boss", async ({ page }) => {
    await boot(page);
    const from = await page.evaluate(() => {
      const w = window as any;
      const dice = [0.005, 0.5, 0.4]; let i = 0;   // under E's 1%, not the 1-in-10 mythic, the second regalia piece
      w.__weekJackpotDice = () => (i < dice.length ? dice[i++] : 1);
      const got = w.Drops.rollBossDrop('the_footsore_herald');
      w.__weekJackpotDice = () => 1;
      return got && got.card ? got.card.id : (got && got.id) || null;
    });
    expect(from).toBe('mantle_of_the_sovereign');
    await page.evaluate(() => (window as any).__processRevealQueue());
    await expect(page.locator('#reveal-card-source')).toHaveText('From: The Footsore Herald', { timeout: 10_000 });
  });
});

// W1287 — owner 2026-11-22: "If a cap is reached, item should be sold so at least user gets rewarded even tho they reached
// their cap". A drop past its stack cap sells on the spot: a rare at its market sell price, a common at a quarter of what a
// rare of its tier sells for.
test.describe('W1287 — a drop past its cap sells for souls', () => {
  test('every capped drop pays souls, the Drop History says what it sold for, the toast says so', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const C = w.Drops.CARDS;
      const ids = Object.keys(C).filter((k) => C[k].source_boss === 'the_steel_wolf' && (C[k].rarity === 'common' || C[k].rarity === 'rare'));
      const inv = w.Drops.state;
      ids.forEach((id) => { inv.cards[id] = { discovered: true, count: C[id].rarity === 'common' ? 1 : 3, first_acquired_date: '2026-01-01' }; });
      const souls = () => JSON.parse(localStorage.getItem('hb_souls') || '{"balance":0}').balance;
      const before = souls();
      let paid = 0; const capped: any[] = [];
      for (let i = 0; i < 300 && capped.length < 6; i++) {
        const d = w.Drops.rollBossDrop('the_steel_wolf');
        if (d && d.wasCapped) { capped.push({ id: d.card.id, rarity: d.card.rarity, tier: d.card.tier, soldFor: d.soldFor }); paid += d.soldFor; }
      }
      const ledger = JSON.parse(localStorage.getItem('hb_drop_ledger') || '[]').filter((e: any) => e.wasCapped);
      const hand: Record<string, number> = {}; ids.forEach((id) => { hand[id] = w.Drops.relicSellPrice ? w.Drops.relicSellPrice(id) : 0; });
      return { capped, paid, delta: souls() - before, ledgerSold: ledger.map((e: any) => e.soldFor), ids: ids.length, hand };
    });
    expect(r.ids).toBeGreaterThan(0);
    expect(r.capped.length).toBeGreaterThan(0);
    for (const c of r.capped) {
      expect(c.soldFor, c.id).toBeGreaterThan(0);
      if (c.rarity === 'common' && c.tier === 'E') expect(c.soldFor).toBe(10);   // W1321 — the auto-sell pays half (was 20)
      if (c.rarity === 'rare') expect(c.soldFor).toBe(Math.max(10, Math.round(r.hand[c.id] * 0.5 / 10) * 10));   // half the hand price
    }
    expect(r.delta).toBe(r.paid);
    expect(r.ledgerSold.slice(0, r.capped.length).every((n: number) => n > 0)).toBe(true);
    await page.evaluate(() => (window as any).openDropLedger());
    const st = page.locator('.dh-state--sold').first();
    await expect(st).toBeVisible({ timeout: 8_000 });
    await expect(st).toContainText(/Sold \+\d[\d,]* souls/i);
    await expect(page.locator('.dh-state--cap')).toHaveCount(0);
  });
});
