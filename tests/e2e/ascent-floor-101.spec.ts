/**
 * Awakened — Ascent floor 101, the first floor past the summit: two monsters at once (W1344).
 *
 * Owner 2026-11-27: "we want every floor after floor 100 to be a boss floor because of how difficult it is to defeat",
 * then "Thoughts on fighting a 2v1 so floor 101 is two monsters at once". His picks: both act every turn, you choose
 * who to hit, the survivor powers up; harder than floor 100; the reward is the title "The King" and a feed post.
 *
 * Pinned here:
 *   - past the summit the tower leads with floor 101 (ENTER THE HALL stays one tap under it);
 *   - the battle shows two monsters, two plates and two next-move badges, and a tap moves the target;
 *   - the first to fall makes the other ENRAGED and the target moves to it, the fight goes on;
 *   - both down is the win: FLOOR CLEARED, the two claimants slain, NEW TITLE The King, no summit ending;
 *     floor 101 is never rated (highestCleared stays 100) and the clear is kept in beyondCleared.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => { const root = document.head || document.documentElement; if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); } };
    inject(); document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__f101')) return; sessionStorage.setItem('__f101', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_ascent_opening_seen_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      const st = { pts: 2400 };
      localStorage.setItem('hb_stats', JSON.stringify({ STR: st, VIT: st, INT: st, FOCUS: st, WILL: st, WLT: st }));
      localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: 100, highestCleared: 100, wins: 100, losses: 0, streak: 0, bestStreak: 0,
        dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }));
    } catch (_) { /* noop */ }
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).Arena && !!document.querySelector('[data-tab="profile"]'));
}
const B = '#arena-body';
const sess = (page: Page, fn: string) => page.evaluate(fn);
const ready = (page: Page) => expect(page.locator(B + ' .ar-bmoves:not(.lock) [data-ar="move"]').first()).toBeVisible({ timeout: 15_000 });
const tapMove = (page: Page) => page.locator(B + ' .pkb-moves .ar-bmoves:not(.lock) [data-ar="move"]').first().click();
// both monsters hit for 1, the target is at 1 HP with nothing up: the next tap ends it
const doom = (page: Page) => sess(page, `(() => { const s = Arena._live.sess(); if (!s || s.done) return;
  [0, 1].forEach((i) => { const b = i === s._fi ? s.m.bot : s.foes[i].bot; if (b) b.attack = 1; });
  s.pHP = s.pMax; s.pS.stun = 0; s.bHP = 1; s.bS.guard = 0; s.bS.dodge = 0; s.bS.mods = []; Arena._live.paint(); })()`);

test('W1344 — floor 101: two monsters, tap to target, the survivor is ENRAGED, both down earns The King', async ({ page }) => {
  test.setTimeout(120_000);
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await boot(page);
  await page.evaluate(async () => {
    (document.querySelector('[data-tab="profile"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 400));
    (document.getElementById('sc-arena-btn') as HTMLElement).click();
  });
  // the tower, past the summit: floor 101 leads, the Hall is one tap under it
  await expect(page.locator(B + ' #tw-hero.duo .tw-hl')).toContainText('BEYOND THE SUMMIT · FLOOR 101');
  await expect(page.locator(B + ' #tw-hero .tw-fname')).toHaveText('The Two Claimants');
  await expect(page.locator(B + ' [data-ar="hall"]')).toHaveText(/ENTER THE HALL/);
  await page.locator(B + ' #tw-hero [data-ar="fight"][data-floor="101"]').click();
  await expect(page.locator(B + ' .mx-fight')).toContainText('CHALLENGE BOTH');
  await expect(page.locator(B + ' .mx')).toContainText('Win: the title The King');
  await page.locator(B + ' [data-ar="introgo"]').click();
  await expect(page.locator(B + ' .pkb2-intro .kick')).toHaveText(/FLOOR 101 · TWO AT ONCE/);
  await page.locator(B + ' .pkb2-intro').click();
  await ready(page);

  // two of everything; the front one is the first target
  await expect(page.locator(B + ' .pkb-spot.duo')).toHaveCount(2);
  await expect(page.locator(B + ' .pkb-plate.duo')).toHaveCount(2);
  await expect(page.locator(B + ' .pkb2-intent[data-fi]:not(.hidden)')).toHaveCount(2);
  await expect(page.locator(B + ' .pkb-plate.duo.tgt .nm')).toHaveText('The Usurper');
  await page.locator(B + ' .pkb-spot.duo.d1').click();
  await expect(page.locator(B + ' .pkb-plate.duo.tgt .nm')).toHaveText('The Pretender');
  expect(await sess(page, 'Arena._live.sess().target')).toBe(1);
  await page.locator(B + ' .pkb-plate.duo.d0').click();
  expect(await sess(page, 'Arena._live.sess().target')).toBe(0);

  // the Usurper falls: the Pretender rises, the target follows it, the fight goes on
  await doom(page);
  await tapMove(page);
  await expect(page.locator(B + ' .pkb2-lastword')).toHaveText('“Even stolen, it was heavy.”', { timeout: 30_000 });   // its last words, then it crumbles
  await expect(page.locator(B + ' .pkb-spot.duo.d0')).toHaveClass(/crumble/, { timeout: 10_000 });
  await expect(page.locator(B + ' .pkb2-phase .k')).toHaveText('ENRAGED', { timeout: 30_000 });
  await ready(page);
  const mid = await sess(page, 'JSON.stringify((() => { const s = Arena._live.sess(); return { done: s.done, target: s.target, dead: s.foes.map((f) => !!f.dead), enraged: s.foes.map((f) => !!f.enraged) }; })())');
  expect(JSON.parse(mid as string)).toEqual({ done: false, target: 1, dead: [true, false], enraged: [false, true] });
  await expect(page.locator(B + ' .pkb-plate.duo.d0')).toHaveClass(/ko/);
  await expect(page.locator(B + ' .pkb-plate.duo.d1')).toHaveClass(/enraged/);
  await expect(page.locator(B + ' .pkb2-intent[data-fi]:not(.hidden)')).toHaveCount(1);

  // the Pretender falls: the win, The King, no summit ending, and the Highest Floor board hears 101 right away
  await page.evaluate(() => { const w = window as any; w.__lbSent = []; w.Auth.submitLeaderboardSnapshot = async (m: string, v: number) => { w.__lbSent.push([m, v]); return { ok: true, metric: m, current_value: Math.min(v, 100), best_value: Math.min(v, 100), best_beyond: v > 100 ? v : 0 }; }; });
  for (let i = 0; i < 6 && !(await page.locator(B + ' .pkb2-result').count()); i++) {
    await doom(page);
    await tapMove(page);
    await Promise.race([
      page.locator(B + ' .pkb2-result').waitFor({ timeout: 30_000 }),
      page.locator(B + ' .ar-bmoves:not(.lock) [data-ar="move"]').first().waitFor({ timeout: 30_000 }),
    ]).catch(() => {});
  }
  await expect(page.locator(B + ' .pkb2-result')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(B + ' .pkb2-result')).toContainText('FLOOR CLEARED');
  await expect(page.locator(B + ' .pkb2-result')).toContainText('The Two Claimants fall');
  await expect(page.locator(B + ' .pkb2-result')).toContainText('The King');
  await expect(page.locator(B + ' .pkb2-result')).not.toContainText('EXHIBITION');
  await expect(page.locator('.bc-bgfx')).toHaveCount(0);   // the floor-100 ending never plays here
  const st = JSON.parse(await page.evaluate(() => localStorage.getItem('hb_arena_v2') || '{}'));
  expect([st.highestCleared, st.beyondCleared, st.wins]).toEqual([100, 101, 100]);
  await expect.poll(() => page.evaluate(() => JSON.stringify(((window as any).__lbSent || []).filter((x: [string, number]) => x[0] === 'floor_best'))), { timeout: 15_000 }).toContain('["floor_best",101]');
  expect(errs).toEqual([]);
});
