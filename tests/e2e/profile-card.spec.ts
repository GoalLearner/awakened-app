/**
 * Awakened — the Hunter Profile card (W1142, Claude Design handoff 8 "Player Card - Wardrobe").
 *
 * Owner 2026-11-07: "Make sure the avatar is centered... as well as removing the arena rating since we
 * don't have that open yet." Pinned here, rendered from fixture data through the QA hook (no network):
 *   - W1308 (Claude Design "Hunter Profile - Clean", B; owner 2026-11-24: "more organized and aligned correctly and more
 *     clean"): one grid, 20px margins and two equal columns shared by the hero and the record. The hunter stands in a
 *     framed plate with the rank crest in its corner; the name, the title and the seals (pins + boss kills) sit on the
 *     plate's baseline, starting where the record's right column starts; the record is one panel; the actions share
 *     one row pattern (the own card's Change look, a friend's Spar their Echo, the owner's Make moderator);
 *   - no Arena Rating row, even when the profile data carries an arena standing.
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

const box = (page: Page, sel: string) => page.evaluate((q) => { const r = document.querySelector(q)!.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, sel);

for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  test.describe('W1308 — the Hunter Profile card @' + vp.width + 'x' + vp.height, () => {
    test.use({ viewport: vp });

    test('one grid: the plate, the name column and the record line up; no Arena Rating; the own card changes its look', async ({ page }) => {
      await boot(page);
      await render(page, true);
      await expect(page.locator('#pc-sheet')).toBeVisible();
      await settle(page);
      const art = page.locator('#pc-body .pcc-plate .pcc-art');
      await expect(art).toHaveAttribute('src', 'avatar-skin-shadowborn.png');   // the full-body file
      expect(await art.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
      await expect(page.locator('#pc-body .pc-med, #pc-body .pc-fb, #pc-body .pc-prov, #pc-body .pc-flavor, #pc-body .pc-skintag')).toHaveCount(0);
      await expect(page.locator('#pc-sheet .pc-head')).toBeHidden();
      const sh = await box(page, '#pc-sheet'), plate = await box(page, '#pc-body .pcc-plate'), rec = await box(page, '#pc-body .pcc-rec');
      const name = await box(page, '#pc-body .pcc-name'), id = await box(page, '#pc-body .pcc-id'), lbl2 = await box(page, '#pc-body .pcc-cell:nth-child(2) .pcc-lbl');
      expect(Math.abs(plate.l - sh.l - 20)).toBeLessThanOrEqual(1.5);   // 20px margins
      expect(Math.abs(rec.l - plate.l)).toBeLessThanOrEqual(1);
      expect(Math.abs(sh.r - rec.r - 20)).toBeLessThanOrEqual(1.5);
      expect(Math.round(plate.h)).toBe(252);
      expect(Math.abs(plate.w - rec.w / 2)).toBeLessThanOrEqual(1);    // the plate is the record's left column
      expect(Math.abs(name.l - lbl2.l)).toBeLessThanOrEqual(1);        // the name starts where the right column's text does
      expect(Math.abs(id.b - plate.b)).toBeLessThanOrEqual(1);         // on the plate's baseline
      expect(rec.t).toBeGreaterThan(plate.b);
      await expect(page.locator('#pc-body .pc-arena')).toHaveCount(0);
      await expect(page.locator('#pc-body')).not.toContainText('ARENA RATING');
      await expect(page.locator('#pc-body .pcc-v.gold')).toHaveText('5,601');
      await expect(page.locator('#pc-body .pcc-cell')).toHaveCount(4);
      await expect(page.locator('#pc-body .pcc-fv')).toHaveText('99 / 100');
      const look = page.locator('#pc-body .pcc-actions > .pcc-act--gold[data-wardrobe]');
      await expect(look).toContainText('Change look');
      await expect(look).toContainText('every hunter sees');
      const act = await box(page, '#pc-body .pcc-act');
      expect(Math.abs(act.l - rec.l)).toBeLessThanOrEqual(1);
      expect(Math.abs(act.r - rec.r)).toBeLessThanOrEqual(1);
      if (process.env.LB_SHOTS) await page.screenshot({ path: process.env.LB_SHOTS + '/card-own-' + vp.width + '.png' });
      await look.click();
      await expect(page.locator('#pc-sheet')).toBeHidden();
      await expect(page.locator('#wd-sheet')).toBeVisible();
    });

    // W1144 — a worn aura shows behind the hunter, never over them or the crest; a frame chosen before W1296 paints nothing.
    test('the rank crest sits in the plate\'s corner on top, a worn aura stays behind the hunter, and no frame paints', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => { localStorage.setItem('hb_card_aura', 'storm'); localStorage.setItem('hb_card_frame', 'eclipse'); });
      await render(page, true);
      const crest = page.locator('#pc-body .pcc-plate > .pcc-crest');
      await expect(crest).toHaveText('S');
      await settle(page);
      const geo = await page.evaluate(() => {
        const p = document.querySelector('#pc-body .pcc-plate')!.getBoundingClientRect(), c = document.querySelector('#pc-body .pcc-crest')!.getBoundingClientRect();
        const top = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
        return { dl: c.left - p.left, dt: c.top - p.top, cw: c.width, top: top ? top.className : '' };
      });
      expect(Math.round(geo.dl)).toBe(10);
      expect(Math.round(geo.dt)).toBe(10);
      expect(Math.round(geo.cw)).toBe(28);
      expect(geo.top).toBe('pcc-crest');
      const aura = page.locator('#pc-body .pcc-plate > .wx-aura.storm');
      await expect(aura).toHaveCount(1);
      expect(await aura.locator('.wx-ap').count()).toBe(10);
      expect(await page.evaluate(() => [getComputedStyle(document.querySelector('#pc-body .pcc-plate > .wx-aura') as HTMLElement).zIndex, getComputedStyle(document.querySelector('#pc-body .pcc-art') as HTMLElement).zIndex])).toEqual(['0', '1']);
      await expect(page.locator('#pc-body [class*="pc-fr-"]')).toHaveCount(0);
      await render(page, false, { cardFrame: 'runebound' });
      await expect(page.locator('#pc-body [class*="pc-fr-"], #pc-body .pc-med')).toHaveCount(0);
    });

    // W1154 — the own card's title is a button that opens the Ascent's Titles view (CHOOSE A TITLE when none is worn).
    // W1308 — it sits under the name, on the name's left edge.
    test('own card: no Founder badge; the title under the name, tappable → the Titles view; none worn → CHOOSE A TITLE', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => { localStorage.removeItem('hb_arena_title'); });
      await render(page, true);
      const body = page.locator('#pc-body');
      await expect(body.locator('.pc-founder')).toHaveCount(0);
      const pick = body.locator('button.pcc-title--pick');
      await expect(pick).toHaveCount(1);
      await expect(pick).toHaveText(/Choose a title/i);
      await page.evaluate(() => { localStorage.setItem('hb_arena_title', 'rt_contender'); localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: 51, highestCleared: 50, wins: 50, losses: 0, streak: 0, bestStreak: 0, dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 })); });
      await page.reload();   // the Ascent state is read at boot
      await page.waitForFunction(() => !!(window as any).__pcRender && !!document.querySelector('[data-tab="profile"]'));
      await render(page, true);
      await expect(pick).toHaveText(/Contender/i);
      await settle(page);
      const n = await box(page, '#pc-body .pcc-name'), t = await box(page, '#pc-body .pcc-title');
      expect(t.t).toBeGreaterThanOrEqual(n.b);
      expect(Math.abs(t.l - n.l)).toBeLessThanOrEqual(1);
      await pick.click();
      await expect(page.locator('#pc-sheet')).toBeHidden();
      await expect(page.locator('#arena-overlay')).toBeVisible();
      await expect(page.locator('#arena-overlay .tm-name')).toHaveText('Titles');
      await expect(page.locator('#arena-overlay .tm-row--worn .nm')).toHaveText('Contender');
    });

    test("a visitor's card: the hunter in the plate, the published title, no Change look; the owner's Make moderator keeps the grid", async ({ page }) => {
      await boot(page);
      await render(page, false, { alias: 'RenDIESEL', arenaTitle: 'rt_blade', founderSeq: 2 });
      await expect(page.locator('#pc-body .pcc-art')).toHaveAttribute('src', 'avatar-skin-shadowborn.png');
      await expect(page.locator('#pc-body .pc-arena, #pc-body .pc-founder, #pc-body .pc-prov')).toHaveCount(0);
      await expect(page.locator('#pc-body div.pcc-title')).toHaveText(/Blade/i);
      await expect(page.locator('#pc-body button.pcc-title--pick, #pc-body .pcc-act--gold')).toHaveCount(0);
      await expect(page.locator('#pc-body .pcc-actions')).toBeHidden();   // a stranger: no rows at all
      // the owner's Make moderator joins the actions column (as _boardDecorateProfileCard places it), the record's width
      await page.evaluate(() => { const b = document.createElement('button'); b.className = 'board-grant'; b.textContent = 'Make moderator'; document.querySelector('#pc-body .pcc-actions')!.appendChild(b); });
      await settle(page);
      const rec = await box(page, '#pc-body .pcc-rec'), mod = await box(page, '#pc-body .pcc-actions .board-grant');
      expect(Math.abs(mod.l - rec.l)).toBeLessThanOrEqual(1);
      expect(Math.abs(mod.r - rec.r)).toBeLessThanOrEqual(1);
      expect(Math.round(mod.h)).toBe(46);
      if (process.env.LB_SHOTS) await page.screenshot({ path: process.env.LB_SHOTS + '/card-visitor-' + vp.width + '.png' });
    });

    // W1303 — owner 2026-11-23: "I want to add bosses slain on the profile card"; W1304 — under the pins. W1308 — one seal
    // in the list: the tier emblem and "300+ BOSS KILLS", the last line. Nothing below 100; a sim wears none.
    test('the boss-kill tier is the last seal under the pins; none below 100', async ({ page }) => {
      await boot(page);
      await render(page, true);   // 316 kills
      const bk = page.locator('#pc-body .pcc-seals > .pcc-seal--bk');
      await expect(bk).toHaveCount(1);
      await expect(bk).toHaveText('300+ BOSS KILLS');
      await expect(bk.locator('b')).toHaveText('300+');
      await expect(bk.locator('img')).toHaveAttribute('src', 'assets/badges/boss-kills-3.webp');
      await expect.poll(() => bk.locator('img').evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
      await render(page, false, { alias: 'Richie', cardPins: [{ id: 'steps1m', v: 1000000 }, { id: 'shadows', v: 7 }] });
      await expect(page.locator('#pc-body .pcc-seal')).toHaveText(['1,000,000 STEPS', '7 SHADOWS', '300+ BOSS KILLS']);
      await settle(page);
      const s1 = await box(page, '#pc-body .pcc-seal:nth-child(1)'), s3 = await box(page, '#pc-body .pcc-seal:nth-child(3)'), n = await box(page, '#pc-body .pcc-name');
      expect(s3.t).toBeGreaterThan(s1.b);
      expect(Math.abs(s1.l - n.l)).toBeLessThanOrEqual(1);   // the seals start on the name's left edge
      await render(page, false, { alias: 'RenDIESEL', bossesSlain: 1234 });
      await expect(bk).toHaveText('1,200+ BOSS KILLS');
      await expect(bk.locator('img')).toHaveAttribute('src', 'assets/badges/boss-kills-10.webp');
      await render(page, false, { alias: 'justin', bossesSlain: 99 });
      await expect(page.locator('#pc-body .pcc-seal--bk')).toHaveCount(0);
      await render(page, false, { alias: 'sim', bossesSlain: 500, _sim: true });   // never faked: a sim wears none
      await expect(page.locator('#pc-body .pcc-seal--bk')).toHaveCount(0);
    });

    test('a long name steps down a size and stays inside its column', async ({ page }) => {
      await boot(page);
      await render(page, false, { alias: 'Immortalshadow' });
      await expect(page.locator('#pc-body .pcc-name')).toHaveClass(/pcc-name--xl/);
      await settle(page);
      const n = await box(page, '#pc-body .pcc-name'), sh = await box(page, '#pc-sheet');
      expect(n.r).toBeLessThanOrEqual(sh.r - 16 + 1);
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
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['100K CLUB ×2', 'PRESTIGE 1']);
    // W1160 / W1308 — each seal wears its pin's badge (the club's hex, the prestige star); the badge adds no text of its own
    await expect(body.locator('.pcc-seal--club100k .pcc-hex svg')).toHaveCount(1);
    await expect(body.locator('.pcc-seal--prestige .st')).toHaveCount(1);        // one star for Prestige 1
    await expect(body.locator('.pc-club100k')).toHaveCount(0);
    await expect(body.locator('.pc-prestige')).toHaveCount(0);
    await expect(body.locator('.pcc-seals--own')).toHaveCount(0);
    await render(page, false, { ...REN, cardPins: [] });
    await expect(body.locator('.pcc-seal--pin')).toHaveCount(0);
    await render(page, false, { ...REN, cardPins: [{ id: 'bestday', v: 20140 }] });
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['20,140 IN A DAY']);
    // Prestige is the S+ endgame: an S hunter's stray prestige number is not a pin; a club member below S+ wears the club alone
    await render(page, false, { alias: 'RenDIESEL', rankTier: 'S', prestige: 1, club100k: { repeatCount: 1, best: 101000 } });
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['100K CLUB']);
  });

  test('the own card: the accolade cached on this phone wears the club pin by default; "[]" chosen → none', async ({ page }) => {
    await boot(page);
    const body = page.locator('#pc-body');
    await page.evaluate(() => { localStorage.removeItem('hb_card_pins'); localStorage.removeItem('hb_accolades_cache'); });
    await render(page, true);
    await expect(body.locator('.pcc-seal--pin')).toHaveCount(0);   // nothing earned, nothing chosen
    await page.evaluate(() => localStorage.setItem('hb_accolades_cache', JSON.stringify({ accolades: [{ type: 'step_100k_club', repeat_count: 3, best_value: 120000 }], fetched_at: Date.now() })));
    await render(page, true);
    await expect(body.locator('.pcc-seals--own .pcc-seal--pin')).toHaveText(['100K CLUB ×3']);
    await page.evaluate(() => localStorage.setItem('hb_card_pins', '[]'));
    await render(page, true);
    await expect(body.locator('.pcc-seal--pin')).toHaveCount(0);
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
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['200K WEEK']);
    await expect(body.locator('.pcc-seal--club200k .pcc-hex--violet svg')).toHaveCount(1);
    await expect(body.locator('.pcc-seal--club100k')).toHaveCount(0);
    if (process.env.LB_SHOTS) await page.locator('#pc-body .pcc-seals').screenshot({ path: process.env.LB_SHOTS + '/pin-200k.png' });
    // a chosen club pin upgrades too; a 199,999 week stays the 100K pin
    await render(page, false, { alias: 'Killua', rankTier: 'E', club100k: { repeatCount: 2, best: 267892 }, cardPins: [{ id: 'club100k', v: 2 }] });
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['200K WEEK']);
    await render(page, false, { alias: 'Angelo', rankTier: 'E', club100k: { repeatCount: 2, best: 199999 }, cardPins: null });
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['100K CLUB ×2']);
    // the own card
    await page.evaluate(() => { localStorage.removeItem('hb_card_pins'); localStorage.setItem('hb_accolades_cache', JSON.stringify({ accolades: [{ type: 'step_100k_club', repeat_count: 2, best_value: 250000 }], fetched_at: Date.now() })); });
    await render(page, true);
    await expect(body.locator('.pcc-seals--own .pcc-seal--pin')).toHaveText(['200K WEEK']);
    if (process.env.LB_SHOTS) await page.screenshot({ path: process.env.LB_SHOTS + '/card-200k.png' });
  });

  // W1264 — a 300,000-step week: the 300K "Nebula" pin.
  test('a 300K week wears the 300K pin on a visitor\'s card and the own card; 299,999 stays 200K', async ({ page }) => {
    await boot(page);
    const body = page.locator('#pc-body');
    await render(page, false, { alias: 'Killua', rankTier: 'E', club100k: { repeatCount: 3, best: 306326 }, cardPins: null });
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['300K WEEK']);
    await expect(body.locator('.pcc-seal--club300k .pcc-hex--nebula')).toHaveCount(1);
    await expect(body.locator('.pcc-seal--club200k')).toHaveCount(0);
    if (process.env.LB_SHOTS) await page.screenshot({ path: process.env.LB_SHOTS + '/card-300k.png' });
    await render(page, false, { alias: 'Ricin', rankTier: 'E', club100k: { repeatCount: 1, best: 299999 }, cardPins: null });
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['200K WEEK']);
    await page.evaluate(() => { localStorage.removeItem('hb_card_pins'); localStorage.setItem('hb_accolades_cache', JSON.stringify({ accolades: [{ type: 'step_100k_club', repeat_count: 3, best_value: 306326 }], fetched_at: Date.now() })); });
    await render(page, true);
    await expect(body.locator('.pcc-seals--own .pcc-seal--pin')).toHaveText(['300K WEEK']);
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
    await expect(body.locator('.pcc-seals--own .pcc-seal--pin')).toHaveText(['300K WEEK']);   // moved once (shadows not earned here)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_card_pins') || '[]'))).toEqual(['club300k', 'shadows']);
    // chosen afterwards, the 100K pin stays the 100K pin beside the 300K one
    await page.evaluate(() => localStorage.setItem('hb_card_pins', JSON.stringify(['club100k', 'club300k'])));
    await render(page, true);
    await expect(body.locator('.pcc-seals--own .pcc-seal--pin')).toHaveText(['100K CLUB ×3', '300K WEEK']);
    // a newer app's card shows each pin as chosen; an older app's 100K pin still turns into the best week
    await render(page, false, { alias: 'Killua', rankTier: 'E', club100k: { repeatCount: 3, best: 306326 }, cardPins: [{ id: 'club200k', v: 306326 }, { id: 'club100k', v: 3 }] });
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['200K WEEK', '100K CLUB ×3']);
    await render(page, false, { alias: 'Killua', rankTier: 'E', club100k: { repeatCount: 3, best: 306326 }, cardPins: [{ id: 'club100k', v: 3 }] });
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['300K WEEK']);
  });
});
