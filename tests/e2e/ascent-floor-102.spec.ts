/**
 * Awakened — Ascent floor 102, the King Black Dragon (W1348).
 *
 * Owner 2026-11-28: "a king black dragon with three heads and every attack applies burn that can't be immune because the
 * fire is too strong", then "Call it king black dragon ... The title earned is dragon slayer". Harder than floor 101.
 *
 * Pinned here:
 *   - floor 102 opens once floor 101 is beaten: the tower then leads with it (ENTER THE HALL stays one tap under it);
 *   - the battle shows three heads, three plates and three next-move badges, and a tap moves the target;
 *   - a swing lights DRAGONFIRE on you;
 *   - the first head to fall makes the other two ENRAGED (one beat), and stays on screen as ash; the fight goes on;
 *   - all three down is the win: FLOOR CLEARED, the dragon slain, NEW TITLE Dragon Slayer, no summit ending; floor 102 is
 *     never rated (highestCleared stays 100), the clear is kept in beyondCleared and the Highest Floor board hears 102.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, beyond: number) {
  await page.addInitScript((beyond) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => { const root = document.head || document.documentElement; if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); } };
    inject(); document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__f102')) return; sessionStorage.setItem('__f102', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_ascent_opening_seen_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      const st = { pts: 2400 };
      localStorage.setItem('hb_stats', JSON.stringify({ STR: st, VIT: st, INT: st, FOCUS: st, WILL: st, WLT: st }));
      localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: 100, highestCleared: 100, beyondCleared: beyond, wins: 100, losses: 0, streak: 0, bestStreak: 0,
        dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }));
    } catch (_) { /* noop */ }
  }, beyond);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).Arena && !!document.querySelector('[data-tab="profile"]'));
}
const B = '#arena-body';
const sess = (page: Page, fn: string) => page.evaluate(fn);
const ready = (page: Page) => expect(page.locator(B + ' .ar-bmoves:not(.lock) [data-ar="move"]').first()).toBeVisible({ timeout: 15_000 });
const tapMove = (page: Page) => page.locator(B + ' .pkb-moves .ar-bmoves:not(.lock) [data-ar="move"]').first().click();
const openTower = (page: Page) => page.evaluate(async () => {
  (document.querySelector('[data-tab="profile"]') as HTMLElement).click();
  await new Promise((r) => setTimeout(r, 400));
  (document.getElementById('sc-arena-btn') as HTMLElement).click();
});
// every head hits for 1; you at full (the dragonfire still burns); the target at 1 HP with nothing up: the next tap ends it
const doom = (page: Page) => sess(page, `(() => { const s = Arena._live.sess(); if (!s || s.done) return;
  s.foes.forEach((x, i) => { const b = i === s._fi ? s.m.bot : x.bot; if (b) b.attack = 1; });
  s.pHP = s.pMax; s.pS.stun = 0; s.bHP = 1; s.bS.guard = 0; s.bS.dodge = 0; s.bS.mods = []; Arena._live.paint(); })()`);
const calm = (page: Page) => sess(page, `(() => { const s = Arena._live.sess(); s.foes.forEach((x, i) => { const b = i === s._fi ? s.m.bot : x.bot; if (b) b.attack = 1; }); })()`);

// W1348 — owner 2026-11-28: "It would be cool to have the dragon slayer title burn in flames", then "It unlocks the burning
// flames effect": Dragon Slayer burns, and beating floor 102 opens Flames as a title colour for any title.
const openTitles = async (page: Page) => {
  await openTower(page);
  await page.locator(B + ' [data-ar="titles"]').first().click();
  await expect(page.locator(B + ' .tm-inks')).toBeVisible();
};
test('W1348 — Flames: locked until floor 102 is beaten (the King stays crimson)', async ({ page }) => {
  await boot(page, 101);
  await page.evaluate(() => localStorage.setItem('hb_arena_title', 'beyond_the_king'));
  await openTitles(page);
  await expect(page.locator(B + ' .tm-ink--fire')).toHaveClass(/lock/);
  await page.locator(B + ' .tm-ink--fire').click({ force: true });   // aria-disabled: a tap still lands
  expect(await page.evaluate(() => localStorage.getItem('hb_title_ink'))).toBeNull();
  await expect(page.locator(B + ' .ttl-fire')).toHaveCount(0);
});
test('W1348 — Flames: floor 102 beaten, Dragon Slayer burns, and Flames burns any title', async ({ page }) => {
  await boot(page, 102);
  await page.evaluate(() => localStorage.setItem('hb_arena_title', 'beyond_dragon_slayer'));
  await openTitles(page);
  await expect(page.locator(B + ' .tm-row--worn .nm.ttl-fire')).toHaveText('Dragon Slayer');   // its own colour: fire
  await expect(page.locator(B + ' .tm-row--worn .tm-gem.ttl-flame')).toHaveCount(1);
  // owner: "Make sure that exit isn't blocking the color" — the list scrolls in a box that starts below the EXIT pill
  const gap = await page.evaluate(() => { const b = document.getElementById('arena-body')!.getBoundingClientRect(), x = document.getElementById('arena-close')!.getBoundingClientRect(); return b.top - x.bottom; });
  expect(gap).toBeGreaterThanOrEqual(0);
  // wear The King in Flames
  await page.locator(B + ' .tm-row[data-tid="beyond_the_king"]').click();
  await expect(page.locator(B + ' .tm-row--worn .nm')).toHaveText('The King');
  await expect(page.locator(B + ' .tm-row--worn .nm.ttl-fire')).toHaveCount(0);
  await page.locator(B + ' .tm-ink--fire').click();
  expect(await page.evaluate(() => localStorage.getItem('hb_title_ink'))).toBe('flames');
  await expect(page.locator(B + ' .tm-row--worn .nm.ttl-fire')).toHaveText('The King');
  // a picked ink still wins over Dragon Slayer's own fire
  await page.locator(B + ' .tm-row[data-tid="beyond_dragon_slayer"]').click();
  await page.locator(B + ' .tm-ink[data-ink="frost"]').click();
  await expect(page.locator(B + ' .tm-row--worn .nm.ttl-fire')).toHaveCount(0);
});

test('W1348 — floor 102 waits for floor 101: the tower leads with 101 until it is beaten', async ({ page }) => {
  await boot(page, 0);
  await openTower(page);
  await expect(page.locator(B + ' #tw-hero .tw-hl')).toContainText('BEYOND THE SUMMIT · FLOOR 101');
  const locked = await sess(page, 'JSON.stringify([Arena.floorInfo(102).locked, Arena.floorInfo(101).locked])');
  expect(JSON.parse(locked as string)).toEqual([true, false]);
});

test('W1348 — floor 102: three heads, tap to target, dragonfire, a fall enrages the rest, all down earns Dragon Slayer', async ({ page }) => {
  test.setTimeout(150_000);
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await boot(page, 101);
  await openTower(page);
  await expect(page.locator(B + ' #tw-hero.duo .tw-hl')).toContainText('BEYOND THE SUMMIT · FLOOR 102');
  await expect(page.locator(B + ' #tw-hero .tw-fname')).toHaveText('King Black Dragon');
  await expect(page.locator(B + ' [data-ar="hall"]')).toHaveText(/ENTER THE HALL/);
  await page.locator(B + ' #tw-hero [data-ar="fight"][data-floor="102"]').click();
  await expect(page.locator(B + ' .mx')).toContainText('Win: the title Dragon Slayer');
  await expect(page.locator(B + ' .mx-ribbon')).toContainText('THREE HEADS');
  await page.locator(B + ' [data-ar="introgo"]').click();
  await expect(page.locator(B + ' .pkb2-intro .kick')).toHaveText(/FLOOR 102 · THREE HEADS/);
  await page.locator(B + ' .pkb2-intro').click();
  await ready(page);
  await calm(page);

  // three of everything; the Fang head is the first target; tap the Fire head (left) and the Smoke head (right)
  await expect(page.locator(B + ' .pkb-spot.duo.head')).toHaveCount(3);
  await expect(page.locator(B + ' .pkb-plate.duo')).toHaveCount(3);
  await expect(page.locator(B + ' .pkb2-intent[data-fi]:not(.hidden)')).toHaveCount(3);
  await expect(page.locator(B + ' .pkb-plate.duo.tgt .nm')).toHaveText('Fang Head');
  await page.locator(B + ' .pkb-spot.duo.d1').click();
  await expect(page.locator(B + ' .pkb-plate.duo.tgt .nm')).toHaveText('Fire Head');
  await page.locator(B + ' .pkb-plate.duo.d2').click();
  expect(await sess(page, 'Arena._live.sess().target')).toBe(2);

  // one turn: the heads swing and you catch dragonfire
  await tapMove(page);
  await ready(page);
  await expect(page.locator(B + ' #pkb-chips-p .ar-st.df')).toHaveText('DRAGONFIRE');

  // the Fire head falls: its last words, one ENRAGED beat, the other two enraged, it stays as ash; the fire cools
  await page.locator(B + ' .pkb-spot.duo.d1').click();
  await doom(page);
  await tapMove(page);
  await expect(page.locator(B + ' .pkb2-lastword')).toHaveText('“The fire… goes on without me.”', { timeout: 30_000 });
  await expect(page.locator(B + ' .pkb2-phase .k')).toHaveText('ENRAGED', { timeout: 30_000 });
  await ready(page);
  const mid = await sess(page, 'JSON.stringify((() => { const s = Arena._live.sess(); return { done: s.done, target: s.target, dead: s.foes.map((f) => !!f.dead), enraged: s.foes.map((f) => !!f.enraged), heat: Arena._battle.dragonfireHeat(s).heads }; })())');
  expect(JSON.parse(mid as string)).toEqual({ done: false, target: 0, dead: [false, true, false], enraged: [true, false, true], heat: 2 });
  await expect(page.locator(B + ' .pkb-spot.duo.d1')).toHaveClass(/ko/);
  await expect(page.locator(B + ' .pkb-plate.duo.d1')).toHaveClass(/ko/);
  await expect(page.locator(B + ' .pkb2-intent[data-fi]:not(.hidden)')).toHaveCount(2);

  // the other two fall: the win, Dragon Slayer, no summit ending, and the Highest Floor board hears 102 right away
  await page.evaluate(() => { const w = window as any; w.__lbSent = []; w.Auth.submitLeaderboardSnapshot = async (m: string, v: number) => { w.__lbSent.push([m, v]); return { ok: true, metric: m, current_value: Math.min(v, 100), best_value: Math.min(v, 100), best_beyond: v > 100 ? v : 0 }; }; });
  for (let i = 0; i < 10 && !(await page.locator(B + ' .pkb2-result').count()); i++) {
    await doom(page);
    await tapMove(page);
    await Promise.race([
      page.locator(B + ' .pkb2-result').waitFor({ timeout: 30_000 }),
      page.locator(B + ' .ar-bmoves:not(.lock) [data-ar="move"]').first().waitFor({ timeout: 30_000 }),
    ]).catch(() => {});
  }
  await expect(page.locator(B + ' .pkb2-result')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(B + ' .pkb2-result')).toContainText('FLOOR CLEARED');
  await expect(page.locator(B + ' .pkb2-result')).toContainText('King Black Dragon falls');
  await expect(page.locator(B + ' .pkb2-result')).toContainText('Dragon Slayer');
  await expect(page.locator(B + ' .pkb2-result')).not.toContainText('EXHIBITION');
  await expect(page.locator('.bc-bgfx')).toHaveCount(0);   // the floor-100 ending never plays here
  const st = JSON.parse(await page.evaluate(() => localStorage.getItem('hb_arena_v2') || '{}'));
  expect([st.highestCleared, st.beyondCleared, st.wins]).toEqual([100, 102, 100]);
  await expect.poll(() => page.evaluate(() => JSON.stringify(((window as any).__lbSent || []).filter((x: [string, number]) => x[0] === 'floor_best'))), { timeout: 15_000 }).toContain('["floor_best",102]');
  expect(errs).toEqual([]);
});
