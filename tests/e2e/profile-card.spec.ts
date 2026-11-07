/**
 * Awakened — the Hunter Profile card (W1142, Claude Design handoff 8 "Player Card - Wardrobe").
 *
 * Owner 2026-11-07: "Make sure the avatar is centered... as well as removing the arena rating since we
 * don't have that open yet." Pinned here, rendered from fixture data through the QA hook (no network):
 *   - the medallion (the avatar) sits on the sheet's centre line, own card and a visitor's card alike;
 *   - no Arena Rating row, even when the profile data carries an arena standing;
 *   - the own card keeps CHANGE LOOK and its own closing line; a visitor's card names the worn look.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__pcard')) return; sessionStorage.setItem('__pcard', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_ascent_opening_seen_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      const st = { pts: 2400 };
      localStorage.setItem('hb_stats', JSON.stringify({ STR: st, VIT: st, INT: st, FOCUS: st, WILL: st, WLT: st }));
    } catch (_) { /* noop */ }
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__pcRender && !!document.querySelector('[data-tab="profile"]'));
}

const DATA = {
  alias: 'Richie', rankTier: 'S', rankLabel: 'S RANK', avatarId: 'avatar-skin-shadowborn.png', power: 5601, bossesSlain: 316, avgStepsPerDay: 5625,
  ultraRareDrops: 24, bestFloor: 99, arenaTitle: 'shadowborn', founderSeq: 1, arena: { elo: 1340, global: 3 }, verifiedStreakLabel: '41-day verified streak',
};
const render = (page: Page, own: boolean, extra?: Record<string, unknown>) => page.evaluate(([d, o]) => (window as any).__pcRender(d, o), [{ ...DATA, ...(extra || {}) }, own] as [Record<string, unknown>, boolean]);

for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  test.describe('W1142 — the Hunter Profile card @' + vp.width + 'x' + vp.height, () => {
    test.use({ viewport: vp });

    test('the avatar sits on the centre line and the Arena Rating row is gone (own card)', async ({ page }) => {
      await boot(page);
      await render(page, true);
      const sheet = page.locator('#pc-sheet');
      await expect(sheet).toBeVisible();
      const med = page.locator('#pc-body .pc-med');
      await expect(med).toBeVisible();
      const s = (await sheet.boundingBox())!, m = (await med.boundingBox())!, img = (await page.locator('#pc-body .pc-med-portrait img').boundingBox())!;
      expect(Math.abs((m.x + m.width / 2) - (s.x + s.width / 2))).toBeLessThanOrEqual(2);
      expect(Math.abs((img.x + img.width / 2) - (s.x + s.width / 2))).toBeLessThanOrEqual(2);
      await expect(page.locator('#pc-body .pc-arena')).toHaveCount(0);
      await expect(page.locator('#pc-body')).not.toContainText('ARENA RATING');
      await expect(page.locator('#pc-body .pc-skintag')).toContainText('CHANGE LOOK');
      await expect(page.locator('#pc-body .pc-prov')).toContainText('every hunter sees');
      await expect(page.locator('#pc-body .pc-stat .v.gold')).toHaveText('5,601');
    });

    // W1144 — owner 2026-11-07 on build 623: "why it made the avatar so big and that it is covering the rank too...
    // the aura isn't working correctly on the playercard". The medallion is the handoff's 166px, the rank crest paints
    // on top of it, and a worn aura fills the hero block behind the medallion instead of hiding under it.
    test('the medallion is 166px, the rank crest sits on top of it, and a worn aura fills the hero block', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => { localStorage.setItem('hb_card_aura', 'storm'); localStorage.removeItem('hb_card_frame'); });
      await render(page, true);
      const med = page.locator('#pc-body .pc-med'), crest = page.locator('#pc-body .pc-crest');
      await expect(med).toBeVisible();
      await expect(crest).toHaveText('S');
      // the sheet slides up on open: measure the medallion and the crest in ONE frame once the sheet has settled
      const geo = await page.evaluate(async () => {
        const sh = document.getElementById('pc-sheet')!;
        let last = -1; for (let i = 0; i < 60; i++) { const y = sh.getBoundingClientRect().top; if (y === last) break; last = y; await new Promise((r) => requestAnimationFrame(r)); }
        const m = document.querySelector('#pc-body .pc-med')!.getBoundingClientRect(), c = document.querySelector('#pc-body .pc-crest')!.getBoundingClientRect();
        const top = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
        return { mw: m.width, mh: m.height, mcx: m.x + m.width / 2, mBottom: m.bottom, cw: c.width, ccx: c.x + c.width / 2, cBottom: c.bottom, top: top ? top.className : '' };
      });
      expect(Math.round(geo.mw)).toBe(166);
      expect(Math.round(geo.mh)).toBe(166);
      expect(Math.round(geo.cw)).toBe(48);
      expect(Math.abs(geo.ccx - geo.mcx)).toBeLessThanOrEqual(1);   // on the medallion's centre line
      expect(geo.cBottom).toBeGreaterThan(geo.mBottom);             // hanging off its base
      expect(geo.top).toBe('pc-crest');                             // the element on top at its own centre (W1143 had lifted the medallion over it)
      // the aura: one, a direct child of the hero block, spanning it; nothing left inside the medallion wrap
      const aura = page.locator('#pc-body .pc-hero > .wx-aura.storm');
      await expect(aura).toHaveCount(1);
      await expect(page.locator('#pc-body .pc-med-wrap .wx-aura')).toHaveCount(0);
      const h = (await page.locator('#pc-body .pc-hero').boundingBox())!, a = (await aura.boundingBox())!;
      expect(Math.abs(a.width - h.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.height - h.height)).toBeLessThanOrEqual(1);
      expect(await aura.locator('.wx-ap').count()).toBe(10);
      expect(await page.evaluate(() => { const a = document.querySelector('#pc-body .pc-hero > .wx-aura') as HTMLElement, w = document.querySelector('#pc-body .pc-med-wrap') as HTMLElement; return [getComputedStyle(a).zIndex, getComputedStyle(w).zIndex]; })).toEqual(['0', '1']);   // behind the medallion
    });

    // W1154 — no Founder badge on any card; the title sits centred; on the own card it is a button that opens the
    // Ascent's Titles view (CHOOSE A TITLE when none is worn); a visitor's title is a plain shard.
    test('own card: no Founder badge, the title centred and tappable → the Titles view; none worn → CHOOSE A TITLE', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => { localStorage.removeItem('hb_arena_title'); });
      await render(page, true);
      const body = page.locator('#pc-body');
      await expect(body.locator('.pc-founder')).toHaveCount(0);
      const pick = body.locator('button.pc-shard--pick');
      await expect(pick).toHaveCount(1);
      await expect(pick).toHaveText(/Choose a title/i);
      // a worn title shows by name, from this phone (not the published data), on the centre line
      await page.evaluate(() => { localStorage.setItem('hb_arena_title', 'rt_contender'); localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: 51, highestCleared: 50, wins: 50, losses: 0, streak: 0, bestStreak: 0, dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 })); });
      await page.reload();   // the Ascent state is read at boot
      await page.waitForFunction(() => !!(window as any).__pcRender && !!document.querySelector('[data-tab="profile"]'));
      await render(page, true);
      await expect(pick).toHaveText(/Contender/i);
      const geo = await page.evaluate(async () => {
        const sh = document.getElementById('pc-sheet')!;
        let last = -1; for (let i = 0; i < 60; i++) { const y = sh.getBoundingClientRect().top; if (y === last) break; last = y; await new Promise((r) => requestAnimationFrame(r)); }
        const s = sh.getBoundingClientRect(), p = document.querySelector('#pc-body .pc-shard--pick')!.getBoundingClientRect();
        return Math.abs((p.left + p.width / 2) - (s.left + s.width / 2));
      });
      expect(geo).toBeLessThanOrEqual(2);
      await pick.click();
      await expect(page.locator('#pc-sheet')).toBeHidden();
      await expect(page.locator('#arena-overlay')).toBeVisible();
      await expect(page.locator('#arena-overlay .tm-name')).toHaveText('Titles');
      await expect(page.locator('#arena-overlay .tm-row--worn .nm')).toHaveText('Contender');
    });

    test("a visitor's card: centred too, no Arena Rating, the worn look named", async ({ page }) => {
      await boot(page);
      await render(page, false, { alias: 'RenDIESEL', arenaTitle: 'rt_blade', founderSeq: 2 });
      const sheet = page.locator('#pc-sheet'), med = page.locator('#pc-body .pc-med');
      await expect(med).toBeVisible();
      const s = (await sheet.boundingBox())!, m = (await med.boundingBox())!;
      expect(Math.abs((m.x + m.width / 2) - (s.x + s.width / 2))).toBeLessThanOrEqual(2);
      await expect(page.locator('#pc-body .pc-arena')).toHaveCount(0);
      await expect(page.locator('#pc-body .pc-founder')).toHaveCount(0);                 // W1154 — no Founder badge
      await expect(page.locator('#pc-body div.pc-shard')).toHaveText(/Blade/i);         // W1154 — a plain shard, from the published title
      await expect(page.locator('#pc-body button.pc-shard--pick')).toHaveCount(0);
      await expect(page.locator('#pc-body .pc-skintag')).toContainText('THE SHADOWBORN');
      await expect(page.locator('#pc-body .pc-prov')).toContainText('global leaderboard');
    });
  });
}
