/**
 * Awakened — the Hunter Profile card (W1142, Claude Design handoff 8 "Player Card - Wardrobe").
 *
 * Owner 2026-11-07: "Make sure the avatar is centered... as well as removing the arena rating since we
 * don't have that open yet." Pinned here, rendered from fixture data through the QA hook (no network):
 *   - W1296: the hunter stands FULL BODY on the left (no box, no frame), the rank crest at the feet and the look's name
 *     under it; the name, the title and the pins sit beside the figure (W1142 had a centred medallion);
 *   - no Arena Rating row, even when the profile data carries an arena standing;
 *   - the own card keeps CHANGE LOOK and its own closing line; a visitor's card names the worn look.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner,.habit-toast{display:none!important;visibility:hidden!important;pointer-events:none!important}';   // W1296 — .habit-toast: the daily-bonus toast can land over the crest
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
const settle = (page: Page) => page.evaluate(async () => {   // the sheet slides up on open: wait for it to stop
  const sh = document.getElementById('pc-sheet')!;
  let last = -1; for (let i = 0; i < 60; i++) { const y = sh.getBoundingClientRect().top; if (y === last) break; last = y; await new Promise((r) => requestAnimationFrame(r)); }
});

for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  test.describe('W1142 — the Hunter Profile card @' + vp.width + 'x' + vp.height, () => {
    test.use({ viewport: vp });

    // W1296 — owner 2026-11-23: "Thoughts on showing the full body on the card, rather than just the face", then "move the
    // name of the skin under the avatar so the ascendant goes under the C ranked box" and "without borders is better".
    test('the hunter stands full body beside the name, and the Arena Rating row is gone (own card)', async ({ page }) => {
      await boot(page);
      await render(page, true);
      const sheet = page.locator('#pc-sheet');
      await expect(sheet).toBeVisible();
      await settle(page);
      const art = page.locator('#pc-body .pc-fb-art');
      await expect(art).toHaveAttribute('src', 'avatar-skin-shadowborn.png');   // the full-body file, not the bust
      expect(await art.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
      await expect(page.locator('#pc-body .pc-med')).toHaveCount(0);           // no medallion, no frame
      const fb = (await page.locator('#pc-body .pc-fb').boundingBox())!, id = (await page.locator('#pc-body .pc-identity').boundingBox())!;
      expect(fb.x + fb.width).toBeLessThanOrEqual(id.x + 1);                   // the figure on the left, who they are on the right
      expect(Math.round(fb.width)).toBe(150);
      expect(Math.round(fb.height)).toBe(226);
      await expect(page.locator('#pc-body .pc-arena')).toHaveCount(0);
      await expect(page.locator('#pc-body')).not.toContainText('ARENA RATING');
      await expect(page.locator('#pc-body .pc-identity .pc-skintag')).toContainText('CHANGE LOOK');   // W1299 — under the name and pins
      await expect(page.locator('#pc-body .pc-prov')).toContainText('every hunter sees');
      await expect(page.locator('#pc-body .pc-stat .v.gold')).toHaveText('5,601');
    });

    // W1144 — owner 2026-11-07 on build 623: "it is covering the rank too... the aura isn't working correctly on the
    // playercard". W1296 — the crest stands at the hunter's feet, on top of everything; a worn aura wraps the figure,
    // behind the art; a frame chosen before W1296 (or a published one) paints nothing.
    test('the rank crest sits at the hunter\'s feet on top, a worn aura wraps the figure, and no frame paints', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => { localStorage.setItem('hb_card_aura', 'storm'); localStorage.setItem('hb_card_frame', 'eclipse'); });
      await render(page, true);
      const crest = page.locator('#pc-body .pc-crest');
      await expect(crest).toHaveText('S');
      await settle(page);
      const geo = await page.evaluate(() => {
        const f = document.querySelector('#pc-body .pc-fb')!.getBoundingClientRect(), c = document.querySelector('#pc-body .pc-crest')!.getBoundingClientRect();
        const t = document.querySelector('#pc-body .pc-fb-col .pc-shard')!.getBoundingClientRect();   // W1299 — the title, under the crest
        const top = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
        return { fcx: f.x + f.width / 2, fBottom: f.bottom, ccx: c.x + c.width / 2, cBottom: c.bottom, cw: c.width, tagTop: t.top, top: top ? top.className : '' };
      });
      expect(Math.round(geo.cw)).toBe(38);
      expect(Math.abs(geo.ccx - geo.fcx)).toBeLessThanOrEqual(1);   // under the hunter's centre line
      expect(geo.cBottom).toBeGreaterThan(geo.fBottom);             // standing at the feet
      expect(geo.tagTop).toBeGreaterThan(geo.cBottom);              // the title under the crest (W1299; was the look's name)
      expect(geo.top).toBe('pc-crest');                             // the element on top at its own centre
      const aura = page.locator('#pc-body .pc-fb > .wx-aura.storm');
      await expect(aura).toHaveCount(1);
      expect(await aura.locator('.wx-ap').count()).toBe(10);
      expect(await page.evaluate(() => [getComputedStyle(document.querySelector('#pc-body .pc-fb > .wx-aura') as HTMLElement).zIndex, getComputedStyle(document.querySelector('#pc-body .pc-fb-art') as HTMLElement).zIndex])).toEqual(['0', '1']);   // behind the art
      await expect(page.locator('#pc-body [class*="pc-fr-"]')).toHaveCount(0);
      await render(page, false, { cardFrame: 'runebound' });
      await expect(page.locator('#pc-body [class*="pc-fr-"], #pc-body .pc-med')).toHaveCount(0);
    });

    // W1154 — no Founder badge on any card; the title sits centred (W1296: beside the hunter, under the name); on the own card it is a button that opens the
    // Ascent's Titles view (CHOOSE A TITLE when none is worn); a visitor's title is a plain shard.
    test('own card: no Founder badge, the title under the rank crest and tappable → the Titles view; none worn → CHOOSE A TITLE', async ({ page }) => {
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
      await settle(page);
      const geo = await page.evaluate(() => {   // W1299 — under the rank crest, on the hunter's centre line (W1296 had it beside, W1154 centred)
        const f = document.querySelector('#pc-body .pc-fb')!.getBoundingClientRect(), p = document.querySelector('#pc-body .pc-shard--pick')!.getBoundingClientRect();
        const c = document.querySelector('#pc-body .pc-crest')!.getBoundingClientRect();
        return { under: p.top - c.bottom, centre: Math.abs((p.left + p.width / 2) - (f.left + f.width / 2)) };
      });
      expect(geo.under).toBeGreaterThan(0);
      expect(geo.centre).toBeLessThanOrEqual(2);
      await pick.click();
      await expect(page.locator('#pc-sheet')).toBeHidden();
      await expect(page.locator('#arena-overlay')).toBeVisible();
      await expect(page.locator('#arena-overlay .tm-name')).toHaveText('Titles');
      await expect(page.locator('#arena-overlay .tm-row--worn .nm')).toHaveText('Contender');
    });

    test("a visitor's card: the hunter full body, no Arena Rating, no look name, the title under the crest", async ({ page }) => {
      await boot(page);
      await render(page, false, { alias: 'RenDIESEL', arenaTitle: 'rt_blade', founderSeq: 2 });
      await expect(page.locator('#pc-body .pc-fb-art')).toHaveAttribute('src', 'avatar-skin-shadowborn.png');
      await expect(page.locator('#pc-body .pc-med')).toHaveCount(0);
      await expect(page.locator('#pc-body .pc-arena')).toHaveCount(0);
      await expect(page.locator('#pc-body .pc-founder')).toHaveCount(0);                 // W1154 — no Founder badge
      await expect(page.locator('#pc-body div.pc-shard')).toHaveText(/Blade/i);         // W1154 — a plain shard, from the published title
      await expect(page.locator('#pc-body button.pc-shard--pick')).toHaveCount(0);
      await expect(page.locator('#pc-body .pc-skintag')).toHaveCount(0);                // W1299 — the look's name left the card
      await expect(page.locator('#pc-body .pc-fb-col div.pc-shard')).toHaveText(/Blade/i);   // the title sits under the crest
      await expect(page.locator('#pc-body .pc-prov')).toContainText('global leaderboard');
    });
  });
}

// W1158 — the gold 100K STEP CLUB seal and the PRESTIGE chip left the id-row: both are pins now (owner, on rendiesel's card:
// "keep in mind the 100K club and I just saw rendiesel has a prestige 1"). Until a hunter chooses, the card wears them by
// default: a visitor's card from the published profile while cardPins is null (never chose), the own card from this phone's
// numbers; [] means chose none; published pins win over the defaults.
test.describe('W1158 — the Step Club seal and the Prestige chip are pins', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const REN = { alias: 'RenDIESEL', rankTier: 'S+', rankLabel: 'S+ RANK', prestige: 1, club100k: { repeatCount: 2, best: 112400 } };

  test("a visitor's card: null → the two defaults as pins, [] → none, published → those; no seal, no chip", async ({ page }) => {
    await boot(page);
    const body = page.locator('#pc-body');
    await render(page, false, { ...REN, cardPins: null });
    await expect(body.locator('.pc-pins .pc-pin')).toHaveText(['100K CLUB ×2', 'PRESTIGE 1']);
    // W1160 — each pin wears its own metal (emblem + material class); the emblem adds no text of its own
    await expect(body.locator('.pc-pin--club100k .em svg')).toHaveCount(1);
    await expect(body.locator('.pc-pin--prestige .em .st')).toHaveCount(1);        // one star for Prestige 1
    await expect(body.locator('.pc-club100k')).toHaveCount(0);
    await expect(body.locator('.pc-prestige')).toHaveCount(0);
    await expect(body.locator('.pc-pins--own')).toHaveCount(0);
    await render(page, false, { ...REN, cardPins: [] });
    await expect(body.locator('.pc-pins')).toHaveCount(0);
    await render(page, false, { ...REN, cardPins: [{ id: 'bestday', v: 20140 }] });
    await expect(body.locator('.pc-pins .pc-pin')).toHaveText(['20,140 IN A DAY']);
    // Prestige is the S+ endgame: an S hunter's stray prestige number is not a pin; a club member below S+ wears the club alone
    await render(page, false, { alias: 'RenDIESEL', rankTier: 'S', prestige: 1, club100k: { repeatCount: 1, best: 101000 } });
    await expect(body.locator('.pc-pins .pc-pin')).toHaveText(['100K CLUB']);
  });

  test('the own card: the accolade cached on this phone wears the club pin by default; "[]" chosen → none', async ({ page }) => {
    await boot(page);
    const body = page.locator('#pc-body');
    await page.evaluate(() => { localStorage.removeItem('hb_card_pins'); localStorage.removeItem('hb_accolades_cache'); });
    await render(page, true);
    await expect(body.locator('.pc-pins')).toHaveCount(0);   // nothing earned, nothing chosen
    await page.evaluate(() => localStorage.setItem('hb_accolades_cache', JSON.stringify({ accolades: [{ type: 'step_100k_club', repeat_count: 3, best_value: 120000 }], fetched_at: Date.now() })));
    await render(page, true);
    await expect(body.locator('.pc-pins--own .pc-pin')).toHaveText(['100K CLUB ×3']);
    await page.evaluate(() => localStorage.setItem('hb_card_pins', '[]'));
    await render(page, true);
    await expect(body.locator('.pc-pins')).toHaveCount(0);
  });
});

// W1259 — a 200,000-step week turns the 100K Step Club pin into the 200K pin (owner 2026-11-20: "Give killua the 200K badge
// on her profile card"): a visitor's card from the published club100k.best, the own card from the accolade cached here.
test.describe('W1259 — the 200K pin', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("a 200K week wears the 200K pin in the club pin's place, on a visitor's card and the own card", async ({ page }) => {
    await boot(page);
    const body = page.locator('#pc-body');
    await render(page, false, { alias: 'Killua', rankTier: 'E', club100k: { repeatCount: 2, best: 267892 }, cardPins: null });
    await expect(body.locator('.pc-pins .pc-pin')).toHaveText(['200K WEEK']);
    await expect(body.locator('.pc-pin--club200k .em svg')).toHaveCount(1);
    await expect(body.locator('.pc-pin--club100k')).toHaveCount(0);
    if (process.env.LB_SHOTS) await page.locator('#pc-body .pc-pins').screenshot({ path: process.env.LB_SHOTS + '/pin-200k.png' });
    // a chosen club pin upgrades too; a 199,999 week stays the 100K pin
    await render(page, false, { alias: 'Killua', rankTier: 'E', club100k: { repeatCount: 2, best: 267892 }, cardPins: [{ id: 'club100k', v: 2 }] });
    await expect(body.locator('.pc-pins .pc-pin')).toHaveText(['200K WEEK']);
    await render(page, false, { alias: 'Angelo', rankTier: 'E', club100k: { repeatCount: 2, best: 199999 }, cardPins: null });
    await expect(body.locator('.pc-pins .pc-pin')).toHaveText(['100K CLUB ×2']);
    // the own card
    await page.evaluate(() => { localStorage.removeItem('hb_card_pins'); localStorage.setItem('hb_accolades_cache', JSON.stringify({ accolades: [{ type: 'step_100k_club', repeat_count: 2, best_value: 250000 }], fetched_at: Date.now() })); });
    await render(page, true);
    await expect(body.locator('.pc-pins--own .pc-pin')).toHaveText(['200K WEEK']);
    if (process.env.LB_SHOTS) await page.screenshot({ path: process.env.LB_SHOTS + '/card-200k.png' });
  });

  // W1264 — a 300,000-step week: the 300K "Nebula" pin.
  test('a 300K week wears the 300K pin on a visitor\'s card and the own card; 299,999 stays 200K', async ({ page }) => {
    await boot(page);
    const body = page.locator('#pc-body');
    await render(page, false, { alias: 'Killua', rankTier: 'E', club100k: { repeatCount: 3, best: 306326 }, cardPins: null });
    await expect(body.locator('.pc-pins .pc-pin')).toHaveText(['300K WEEK']);
    await expect(body.locator('.pc-pin3w .w')).toHaveCount(0);   // W1265 — no wings on the pin
    await expect(body.locator('.pc-pin--club200k')).toHaveCount(0);
    if (process.env.LB_SHOTS) await page.screenshot({ path: process.env.LB_SHOTS + '/card-300k.png' });
    await render(page, false, { alias: 'Ricin', rankTier: 'E', club100k: { repeatCount: 1, best: 299999 }, cardPins: null });
    await expect(body.locator('.pc-pins .pc-pin')).toHaveText(['200K WEEK']);
    await page.evaluate(() => { localStorage.removeItem('hb_card_pins'); localStorage.setItem('hb_accolades_cache', JSON.stringify({ accolades: [{ type: 'step_100k_club', repeat_count: 3, best_value: 306326 }], fetched_at: Date.now() })); });
    await render(page, true);
    await expect(body.locator('.pc-pins--own .pc-pin')).toHaveText(['300K WEEK']);
  });

  // W1286 — owner 2026-11-22: "There's 2 new pins that we've added that needs to go here" (the Wardrobe's Pins).
  test('the 200K and 300K weeks are pins of their own; a worn 100K pin moves to the best one once; the 100K pin stays itself', async ({ page }) => {
    await boot(page);
    const body = page.locator('#pc-body');
    await page.evaluate(() => {
      localStorage.setItem('hb_accolades_cache', JSON.stringify({ accolades: [{ type: 'step_100k_club', repeat_count: 3, best_value: 306326 }], fetched_at: Date.now() }));
      localStorage.setItem('hb_card_pins', JSON.stringify(['club100k', 'shadows']));
      localStorage.removeItem('hb_card_pins_split_v1');
    });
    await render(page, true);
    await expect(body.locator('.pc-pins--own .pc-pin')).toHaveText(['300K WEEK']);   // moved once (shadows not earned here)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_card_pins') || '[]'))).toEqual(['club300k', 'shadows']);
    // chosen afterwards, the 100K pin stays the 100K pin beside the 300K one
    await page.evaluate(() => localStorage.setItem('hb_card_pins', JSON.stringify(['club100k', 'club300k'])));
    await render(page, true);
    await expect(body.locator('.pc-pins--own .pc-pin')).toHaveText(['100K CLUB ×3', '300K WEEK']);
    // a newer app's card shows each pin as chosen; an older app's 100K pin still turns into the best week
    await render(page, false, { alias: 'Killua', rankTier: 'E', club100k: { repeatCount: 3, best: 306326 }, cardPins: [{ id: 'club200k', v: 306326 }, { id: 'club100k', v: 3 }] });
    await expect(body.locator('.pc-pins .pc-pin')).toHaveText(['200K WEEK', '100K CLUB ×3']);
    await render(page, false, { alias: 'Killua', rankTier: 'E', club100k: { repeatCount: 3, best: 306326 }, cardPins: [{ id: 'club100k', v: 3 }] });
    await expect(body.locator('.pc-pins .pc-pin')).toHaveText(['300K WEEK']);
  });
});
