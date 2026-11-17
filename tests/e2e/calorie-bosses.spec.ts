/**
 * Awakened — the calorie bosses (W1227), checked end to end before build 654.
 *
 * Owner 2026-11-16: "build these and have the drop table for these bosses basically the same drops as
 * those that need a sleep device ... shadows as well. Check automations and all" → "Yes once everything
 * is updated and checked... automation is in and collection logs and drops are in as well as shadows".
 * The Ready Hunt and engaged-hunt automation are covered in smoke.spec.ts (W1227 tests in "CB · The
 * ready hunt"); this file holds the catalog, the drops, the shadows and the Collection Log.
 */
import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const BACKEND = readFileSync(join(__dirname, '../../backend/src/handlers/public-achievement-events.ts'), 'utf8');

const CAL = [
  { id: 'the_sweat_imp',        name: 'The Sweat Imp',        rank: 'E', kcal: 150,  pct: 0.75 },
  { id: 'the_ember_glutton',    name: 'The Ember Glutton',    rank: 'D', kcal: 300,  pct: 1 },
  { id: 'the_burn_warden',      name: 'The Burn Warden',      rank: 'C', kcal: 500,  pct: 1.25 },
  { id: 'the_furnace_hydra',    name: 'The Furnace Hydra',    rank: 'B', kcal: 700,  pct: 1.5 },
  { id: 'the_inferno_devourer', name: 'The Inferno Devourer', rank: 'A', kcal: 900,  pct: 1.75 },
  { id: 'the_calorie_colossus', name: 'The Calorie Colossus', rank: 'S', kcal: 1000, pct: 2 },
];
// The sleep boss of each rank whose relics a calorie boss drops (C: the whole C gate, the Lullaby Wraith's prize).
const SLEEP_SOURCE: Record<string, string[] | 'C_GATE'> = {
  the_sweat_imp: ['the_insomniac'],
  the_ember_glutton: ['the_dream_tyrant'],
  the_burn_warden: 'C_GATE',
  the_furnace_hydra: ['the_vow_keeper'],
  the_inferno_devourer: ['the_sleepless_ascent'],
  the_calorie_colossus: ['the_starved_sentinel'],
};

async function boot(page: Page) {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => { const r = document.head || document.documentElement; if (r && !document.getElementById('e2e-k')) { const s = document.createElement('style'); s.id = 'e2e-k'; s.textContent = css; r.appendChild(s); } };
    inject(); document.addEventListener('DOMContentLoaded', inject);
    ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed'].forEach((k) => localStorage.setItem(k, '1'));
    localStorage.setItem('hb_habits', '[]');
    localStorage.setItem('hb_whats_new_seen', '99.99.99');
  });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

test.describe('The calorie bosses (W1227)', () => {
  test('six one-day bosses, E to S, active calories alone, not automatic, each with its portrait', async ({ page }) => {
    await boot(page);
    const got = await page.evaluate((ids) => {
      const B = (window as any).Bosses.BOSSES;
      return ids.map((id: string) => { const c = B[id] || {}; return { id, name: c.name, rank: c.rank, kcal: c.activeEnergyKcal, workout: c.workoutMinutes, cadence: c.cadence, auto: !!c.autoKill, coop: !!c.coopOnly, art: (window as any).__bossArt.path(id) }; });
    }, CAL.map((c) => c.id));
    for (const c of CAL) {
      const g = got.find((x: any) => x.id === c.id)!;
      expect([g.name, g.rank, g.kcal, g.workout, g.cadence, g.auto, g.coop]).toEqual([c.name, c.rank, c.kcal, undefined, 'daily', false, false]);
      expect(g.art).toBe('assets/bosses/' + c.id.replace(/_/g, '-') + '.webp');
      const res = await page.request.get('/' + g.art);
      expect(res.status(), g.art).toBe(200);
    }
  });

  test('drops: each pool is exactly its rank\'s sleep-boss relics (the S boss adds the three mythics), and every roll lands inside it', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(({ cal, src }) => {
      const w = window as any, CARDS = w.Drops.CARDS;
      const cGate = Object.keys(CARDS).filter((k) => ['the_marathon_wraith', 'the_furnace_knight', 'the_ascendant_colossus'].includes(CARDS[k].source_boss));
      const out: any = {};
      for (const c of cal) {
        const pool: string[] = w.__weekBoss.pool(c.id);
        const want = src[c.id] === 'C_GATE' ? cGate
          : c.id === 'the_calorie_colossus' ? ['crown_of_eternal_night', 'mantle_of_the_sovereign', 'greaves_of_the_umbral_throne', 'nightfall_blade', 'reverie_staff', 'vigil_bow']   // the Sentinel's regalia + W1228 the three mythics
          : Object.keys(CARDS).filter((k) => (src[c.id] as string[]).includes(CARDS[k].source_boss) && CARDS[k].rarity !== 'mythic');
        const rolled = new Set<string>(); let nothing = 0;
        for (let i = 0; i < 400; i++) { const d = w.Drops.rollBossDrop(c.id); if (d && d.card) rolled.add(d.card.id); else nothing++; }
        out[c.id] = { pool: pool.slice().sort(), want: want.slice().sort(), outside: [...rolled].filter((x) => !pool.includes(x)), rolledN: rolled.size, nothing,
          mythic: pool.filter((x) => CARDS[x] && CARDS[x].rarity === 'mythic') };
      }
      return out;
    }, { cal: CAL, src: SLEEP_SOURCE });
    for (const c of CAL) {
      const x = r[c.id];
      expect(x.pool, c.id + ' pool').toEqual(x.want);
      expect(x.mythic, c.id + ' mythics').toEqual(c.rank === 'S' ? ['nightfall_blade', 'reverie_staff', 'vigil_bow'] : []);   // W1228 — only the S boss
      expect(x.outside, c.id + ' rolls stay in the pool').toEqual([]);
      expect(x.rolledN, c.id + ' rolls something').toBeGreaterThan(0);
    }
  });

  test('drop odds: E–B on their rank tables, A on the one-day A table, S at 7% regalia and 1% mythic, nothing else', async ({ page }) => {
    await boot(page);
    const sim = await page.evaluate((ids) => { const D = (window as any).Drops; const o: any = {}; ids.forEach((id: string) => { o[id] = D.simulateDrops(id, 20000); }); return o; }, CAL.map((c) => c.id));
    const pct = (t: any, k: string) => (t[k] || 0) / 20000 * 100;
    for (const c of CAL) {
      const t = sim[c.id];
      if (c.rank !== 'S') expect(t.mythic || 0, c.id).toBe(0);
      if ('EDCB'.includes(c.rank)) expect(pct(t, 'common'), c.id + ' drops commons').toBeGreaterThan(30);
    }
    expect(pct(sim.the_inferno_devourer, 'ultra_rare')).toBeGreaterThan(6);
    expect(pct(sim.the_inferno_devourer, 'rare')).toBeGreaterThan(18);
    const s = sim.the_calorie_colossus;
    expect(pct(s, 'ultra_rare')).toBeGreaterThan(6);
    expect(pct(s, 'ultra_rare')).toBeLessThan(12);       // 7% plus the S mercy, not the Sentinel's 20%
    expect((s.rare || 0) + (s.common || 0)).toBe(0);     // the regalia or nothing, like the Sentinel
    expect(pct(s, 'mythic')).toBeGreaterThan(0.6);       // W1228 — 1% a kill (200 in 20,000), never forced
    expect(pct(s, 'mythic')).toBeLessThan(1.5);
  });

  test('shadows: all six raise one, worth their rank, and the server takes their names', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate((ids) => {
      const w = window as any;
      return { solo: w.__shadowSoloIds(), pct: ids.map((id: string) => w.__shadowPct(id)), slotsS: w.__shadowSlots('S') };
    }, CAL.map((c) => c.id));
    for (const c of CAL) expect(r.solo).toContain(c.id);
    expect(r.pct).toEqual(CAL.map((c) => c.pct));
    expect(r.slotsS).toBe(r.solo.length);
    expect(r.solo.length).toBe(35);
    for (const c of CAL) expect(BACKEND).toContain(`  ${c.id}: "${c.name}",`);
  });

  test('Collection Log: each calorie boss is listed with its relics, without a Co-op tag; the Gray Pilgrim loses its stray tag too', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    await page.locator('#cl-lens [data-mode="collection"]').click();
    const root = page.locator('#cl-dungeons');
    await expect(root).toContainText('The Sweat Imp', { timeout: 8000 });
    const blocks = await page.evaluate((names) => names.map((n: string) => {
      const el = [].find.call(document.querySelectorAll('#cl-dungeons .cl-boss'), (b: any) => (b.querySelector('.cl-bname') || {}).textContent && b.querySelector('.cl-bname').textContent.indexOf(n) === 0) as any;
      return el ? { name: n, coop: !!el.querySelector('.cl-coop'), tiles: el.querySelectorAll('.cl-grid > *').length } : { name: n, missing: true };
    }), [...CAL.map((c) => c.name), 'The Gray Pilgrim', 'The Twin Maw']);
    for (const c of CAL) {
      const b = blocks.find((x: any) => x.name === c.name);
      expect(b.missing, c.name + ' listed').toBeUndefined();
      expect(b.coop, c.name + ' is not co-op').toBe(false);
      expect(b.tiles, c.name + ' shows its relics').toBeGreaterThan(0);
    }
    expect(blocks.find((x: any) => x.name === 'The Gray Pilgrim').coop).toBe(false);
  });
});
