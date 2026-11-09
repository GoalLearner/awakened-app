/**
 * Awakened — earned ultimates (W1168 engine, W1169 Wardrobe + screen).
 *
 * Owner 2026-11-09: "Everyone loves the surge ultimate... I want to create different types of ultimates not just the
 * surge so that there's different ultimate animations." Earned, then chosen in the Wardrobe; each with its own damage,
 * use, name and (W1170) animation. Pinned here:
 *   - dark by default (ULTS_EARNED_LIVE false): six Wardrobe tabs, every fight on the Signature;
 *   - with the preview switch (hb_dev_ults = '1'): a seventh tab, Ultimates. Unlocks come from the hunter's own state
 *     (a kill at each rank, solo or co-op; a shadow; floor 100). Locked tiles name their condition, every tile opens
 *     its page, EQUIP wears an earned one (hb_ult_choice), a newly earned one wears NEW until the tab is seen;
 *   - the battle fires the chosen one: its name on the Surge bar, BEST NOW when a waiting ult meets its moment, its
 *     kind word and colour on the cut-in; a locked choice falls back to the Signature.
 *
 * ULT_SHOTS=<dir> saves phone-size screenshots for the owner.
 */
import { test, expect, Page } from '@playwright/test';

const SHOTS = process.env.ULT_SHOTS || '';
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: SHOTS + '/' + name + '.png' }); };

async function boot(page: Page, floor: number, extra?: Record<string, string>) {
  await page.addInitScript(([f, extra]: [number, Record<string, string>]) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__ults')) return; sessionStorage.setItem('__ults', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_ascent_opening_seen_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_skins_owned_cache', JSON.stringify({ skins: [], at: Date.now() }));
      localStorage.setItem('hb_earn_bg_seen_v1', '[]');
      const st = { pts: 2400 };
      localStorage.setItem('hb_stats', JSON.stringify({ STR: st, VIT: st, INT: st, FOCUS: st, WILL: st, WLT: st }));
      localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: f, highestCleared: f - 1, wins: 0, losses: 0, streak: 0, bestStreak: 0, dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }));
      Object.keys(extra || {}).forEach((k) => localStorage.setItem(k, extra[k]));
    } catch (_) { /* noop */ }
    const patch = (a: any) => {
      if (!a || a.__w1169Patched) return;
      a.__w1169Patched = true;
      a.getBackendUserId = () => 'me';
      a.isMember = () => true;
      a.founderSeq = () => 0;
      a.fetchEntitlements = async () => ({ ok: true, skins: [], premium: false, member: true });
      a.earnSkins = async () => ({ ok: true, skins: [], granted: [], progress: { opened: { best: 3, current: 3 }, flame: { best: 0 }, coop: { wins: 0, trioWins: 0, trioRanks: [], podium: 0 } }, acquired: null });
    };
    let real: any;
    Object.defineProperty(window, 'Auth', { configurable: true, get() { return real; }, set(v) { real = v; try { patch(v); } catch (_) { /* noop */ } } });
  }, [floor, extra || {}] as [number, Record<string, string>]);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).Arena && !!document.querySelector('[data-tab="profile"]'));
}
// an E-rank solo kill, a C-rank co-op kill and one shadow raised: Crimson Feast, Hellfire and Arise are earned
const EARNED = {
  hb_dev_ults: '1',
  hb_bosses: JSON.stringify({ the_steel_wolf: { streak: 0, kill_count: 1, last_eval_date: null, engaged: false, engaged_at: null } }),
  hb_coop_kills: JSON.stringify({ the_coursing_dread: { count: 1 } }),
  hb_shadows_v1: JSON.stringify({ extracted: { the_steel_wolf: { at: 1, name: 'The Steel Wolf' } }, active: [], windows: {}, pending: {}, zeroDays: 0, dormant: false, loyaltyDay: '' }),
};
const sheet = (page: Page) => page.locator('#wd-sheet');
const openWardrobe = async (page: Page) => { await page.evaluate(() => (window as any).__openWardrobe()); await expect(sheet(page)).toBeVisible(); };
const ult = (page: Page, id: string) => sheet(page).locator('.wx-sl-ult[data-ul="' + id + '"]');
const page0 = (page: Page) => sheet(page).locator('.wx-dt.open .wx-pg').nth(0);

async function intoFight(page: Page, floor: number) {
  await page.evaluate(async (f) => {
    (document.querySelector('[data-tab="profile"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 400));
    (document.getElementById('sc-arena-btn') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 400));
    (document.querySelector('#arena-body [data-ar="fight"][data-floor="' + f + '"]') as HTMLElement).click();
  }, floor);
  await page.locator('#arena-body [data-ar="introgo"]').click();
  await expect(page.locator('#arena-body .pkb2')).toBeVisible();
  if (await page.locator('#arena-body .pkb2-intro').count()) await page.locator('#arena-body .pkb2-intro').click();
  await expect(page.locator('#arena-body .ar-bmoves:not(.lock) [data-ar="move"]').first()).toBeVisible({ timeout: 12_000 });
}

test.use({ viewport: { width: 390, height: 844 } });

test.describe('W1168/W1169 — earned ultimates', () => {
  test('live (W1171): seven Wardrobe tabs without the preview switch, and the fight fires the chosen one', async ({ page }) => {
    await boot(page, 37, Object.assign({}, EARNED, { hb_dev_ults: '0', hb_ult_choice: 'feast' }));
    expect(await page.evaluate(() => (window as any).Arena._battle.ultsLive())).toBe(true);
    await openWardrobe(page);
    await expect(sheet(page).locator('.wx-tab')).toHaveCount(7);
    await expect(sheet(page).locator('.wx-tab[data-tab="ults"]')).toHaveCount(1);
    await page.evaluate(() => { const b = document.getElementById('wd-close'); if (b) (b as HTMLElement).click(); });
    await intoFight(page, 37);
    expect(await page.evaluate(() => (window as any).Arena._live.sess()._ultId)).toBe('feast');
  });
  test('an earned ultimate that misses plays its own ending, not the plain whiff', async ({ page }) => {
    await boot(page, 37, Object.assign({}, EARNED, { hb_ult_choice: 'hellfire' }));
    await intoFight(page, 37);
    // force the miss: a perfect dodge on the foe for this turn (the Hellfire blow has no pierce)
    await page.evaluate(() => { const s = (window as any).Arena._live.sess(); s._surge = 1; s.bS.mods.push({ k: 'dodge', kind: 'evade', mag: 0.5, dur: 2 }); s.rng = () => 0.001; (window as any).Arena._live.paint(); });
    await page.locator('#pkb-surge').click();
    await expect(page.locator('#arena-body .pkb2-cutin')).toBeVisible();
    await expect(page.locator('#arena-body .pkb2-cutin')).toHaveCount(0, { timeout: 4000 });
    // its miss ending mounts the rift and the fissure on the stage (the plain whiff draws neither)
    await expect(page.locator('#pkb-stage .pkb-mvfxd .u-fis')).toHaveCount(1, { timeout: 3000 });
  });

  test('the Ultimates tab: earned from kills and a shadow, locked ones name their condition, EQUIP wears one, NEW clears', async ({ page }) => {
    await boot(page, 50, EARNED);
    await openWardrobe(page);
    await expect(sheet(page).locator('.wx-tab')).toHaveCount(7);
    await sheet(page).locator('.wx-tab[data-tab="ults"]').click();
    await expect(sheet(page).locator('.wx-pane[data-pane="ults"] .wx-sl-ult')).toHaveCount(9);
    await expect(ult(page, 'signature')).toHaveClass(/is-worn/);
    for (const id of ['feast', 'hellfire', 'arise']) await expect(ult(page, id)).toHaveClass(/is-earned/);
    await expect(ult(page, 'feast').locator('.wx-chip-new')).toHaveCount(1);
    await expect(ult(page, 'quicksilver')).toHaveClass(/is-locked/);
    await expect(ult(page, 'quicksilver').locator('.wx-bt-st')).toHaveText('D-RANK KILL');
    await expect(ult(page, 'dawnbreaker').locator('.wx-bt-st')).toHaveText('FLOOR 100');
    await shot(page, 'ult-01-tab');
    // an earned tile opens its page: effect, use, EQUIP
    await ult(page, 'feast').click();
    await expect(sheet(page).locator('.wx-dt')).toHaveClass(/open/);
    const cur = sheet(page).locator('.wx-pg-ult[data-p]').filter({ has: page.locator('[data-ulequip="feast"]') });
    await expect(cur).toHaveCount(1);
    await expect(cur.locator('.wx-ms-c')).toContainText('heals 10% of your health');
    await shot(page, 'ult-02-page');
    await cur.locator('[data-ulequip="feast"]').click();
    await expect(sheet(page).locator('.wx-dt')).not.toHaveClass(/open/);
    await expect(ult(page, 'feast')).toHaveClass(/is-worn/);
    await expect(ult(page, 'signature')).toHaveClass(/is-earned/);
    await expect(sheet(page).locator('.wx-pane[data-pane="ults"] .wx-hl-nm')).toHaveText('Crimson Feast');
    expect(await page.evaluate(() => localStorage.getItem('hb_ult_choice'))).toBe('feast');
    await shot(page, 'ult-03-equipped');
    // a locked tile opens its page too: the condition, no EQUIP
    await ult(page, 'dawnbreaker').click();
    const lockedPg = sheet(page).locator('.wx-pg-ult.is-locked').filter({ hasText: 'Dawnbreaker' });
    await expect(lockedPg.locator('.wx-ult-cond')).toHaveText(/Clear Floor 100 of the Ascent/);
    await expect(lockedPg.locator('[data-ulequip]')).toHaveCount(0);
    // seen: the next visit has no NEW chip
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_ult_seen') || '[]'))).toEqual(expect.arrayContaining(['feast', 'hellfire', 'arise']));
    await page.evaluate(() => { const b = document.getElementById('wd-close'); if (b) (b as HTMLElement).click(); });
    await openWardrobe(page);
    await sheet(page).locator('.wx-tab[data-tab="ults"]').click();
    await expect(ult(page, 'feast').locator('.wx-chip-new')).toHaveCount(0);
  });

  test('the battle fires the chosen one: its name on the bar, BEST NOW at its moment, its kind and colour on the cut-in', async ({ page }) => {
    await boot(page, 37, Object.assign({}, EARNED, { hb_ult_choice: 'feast' }));
    await intoFight(page, 37);
    expect(await page.evaluate(() => (window as any).Arena._live.sess()._ultId)).toBe('feast');
    await page.evaluate(() => { const s = (window as any).Arena._live.sess(); s._surge = 1; s.pHP = s.pMax; (window as any).Arena._live.paint(); });
    const surge = page.locator('#pkb-surge');
    await expect(surge).toHaveClass(/full/);
    await expect(surge.locator('.ult .n')).toHaveText('Crimson Feast');
    await expect(surge).not.toHaveClass(/\bbest\b/);   // full health: not the moment to drain
    await page.evaluate(() => { const s = (window as any).Arena._live.sess(); s.pHP = Math.round(s.pMax * 0.4); (window as any).Arena._live.paint(); });
    await expect(surge).toHaveClass(/\bbest\b/);
    await shot(page, 'ult-04-best-now');
    await surge.click();
    const cut = page.locator('#arena-body .pkb2-cutin');
    await expect(cut).toBeVisible();
    await expect(cut).toHaveClass(/has-tint/);
    await expect(cut.locator('.name .k')).toContainText('DRAIN');
    await expect(cut.locator('.name .n')).toContainText('Crimson');
    await page.waitForTimeout(600);
    await shot(page, 'ult-05-cutin');
    await expect(cut).toHaveCount(0, { timeout: 4000 });
    await page.waitForFunction(() => { const s = (window as any).Arena._live.sess(); return !s || s.done || (s._surge || 0) < 1; });
  });

  test('PREVIEW on any ultimate page plays it on the real stage (cut-in, then the sequence); REPLAY again; CLOSE ends it', async ({ page }) => {
    await boot(page, 50, EARNED);
    await openWardrobe(page);
    await sheet(page).locator('.wx-tab[data-tab="ults"]').click();
    await ult(page, 'quicksilver').click();   // locked: a hunter can still watch it
    const pg = sheet(page).locator('.wx-pg-ult').filter({ hasText: 'Quicksilver' });
    await pg.locator('[data-ulpv="quicksilver"]').click();
    const pv = page.locator('.ult-pv');
    await expect(pv).toBeVisible();
    await expect(pv.locator('.ult-pv-nm .n')).toHaveText('Quicksilver');
    await expect(pv.locator('.pkb2-cutin.has-tint .name .k')).toContainText('SWIFT');
    await page.waitForTimeout(500);
    await shot(page, 'ult-06-preview-cutin');
    await expect(pv.locator('.pkb2-cutin')).toHaveCount(0, { timeout: 4000 });
    // the sequence runs on the preview's own stage: the motion layer mounts and the hunter takes a pose
    await expect(pv.locator('#pkb-stage .pkb-mvfx')).toHaveCount(1, { timeout: 3000 });
    await page.waitForTimeout(900);
    await shot(page, 'ult-07-preview-sequence');
    await pv.locator('[data-pv="again"]').click();
    await expect(pv.locator('.pkb2-cutin')).toBeVisible();
    await pv.locator('[data-pv="x"]').click();
    await expect(page.locator('.ult-pv')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__ultPreview.live())).toBe(false);
    await expect(sheet(page)).toBeVisible();   // back on the Wardrobe
  });

  test('W1173 — the Ascent header wears the equipped ultimate beside POWER; a tap opens the Ultimates above the Ascent', async ({ page }) => {
    await boot(page, 37, EARNED);
    await page.evaluate(async () => {
      (document.querySelector('[data-tab="profile"]') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 400));
      (document.getElementById('sc-arena-btn') as HTMLElement).click();
    });
    const chip = page.locator('#arena-body .tw-ult');
    await expect(chip).toBeVisible();
    await expect(chip.locator('.nm')).toHaveText(/Sundering Verdict|Starfall|Heartpiercer Rain/);   // the Signature to start
    await shot(page, 'ult-08-ascent-chip');
    await chip.click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toHaveClass(/wx-over/);
    await expect(sheet(page).locator('.wx-tab[data-tab="ults"]')).toHaveClass(/\bon\b/);
    // the Wardrobe sits above the Ascent: the tile is the top element where it is drawn
    const onTop = await page.evaluate(() => { const t = document.querySelector('#wd-sheet .wx-sl-ult[data-ul="feast"]') as HTMLElement; const r = t.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(e && t.contains(e)); });
    expect(onTop).toBe(true);
    await ult(page, 'feast').click();
    await sheet(page).locator('.wx-pg-ult [data-ulequip="feast"]').click();
    await expect(ult(page, 'feast')).toHaveClass(/is-worn/);
    await page.locator('#wd-close').click();
    await expect(sheet(page)).toBeHidden();
    await expect(chip.locator('.nm')).toHaveText('Crimson Feast');
    await expect(page.locator('#wd-sheet')).not.toHaveClass(/wx-over/);
  });

  test('a locked choice falls back to the Signature', async ({ page }) => {
    await boot(page, 37, Object.assign({}, EARNED, { hb_ult_choice: 'reaper' }));   // no S-rank kill
    expect(await page.evaluate(() => (window as any).Arena._battle.ultEquipped())).toBe('signature');
    await intoFight(page, 37);
    expect(await page.evaluate(() => (window as any).Arena._live.sess()._ultId)).toBe('signature');
  });
});
