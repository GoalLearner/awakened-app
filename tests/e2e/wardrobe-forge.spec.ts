/**
 * Awakened — Frames, Inks and Auras in the Wardrobe (W1143, Claude Design handoff 8 "Player Card - Wardrobe").
 *
 * Owner 2026-11-07: "build the wardrobe tabs". Pinned here:
 *   - five tabs: Looks · Backgrounds · Frames · Inks · Auras;
 *   - every slot opens on its default worn; an item the hunter's numbers have earned wears in one tap and the
 *     worn id lands in localStorage; a locked item opens the detail pager with its condition;
 *   - the hero medallion and the own profile card wear the frame, the ink and the aura; a visitor's card keeps
 *     the defaults (nothing is published yet).
 *
 * Auth is stubbed through a setter trap on window.Auth (auth.js assigns it once), as the Rising spec does.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, floor: number) {
  await page.addInitScript((f: number) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_skins_owned_cache', JSON.stringify({ skins: [], at: Date.now() }));
      localStorage.setItem('hb_earn_bg_seen_v1', '[]');
      localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: f + 1, highestCleared: f, wins: f, losses: 0, streak: 0, bestStreak: 0, dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }));
    } catch (_) { /* noop */ }
    const patch = (a: any) => {
      if (!a || a.__w1143Patched) return;
      a.__w1143Patched = true;
      a.getBackendUserId = () => 'me';
      a.isMember = () => true;
      a.founderSeq = () => 0;
      a.fetchEntitlements = async () => ({ ok: true, skins: [], premium: false, member: true });
      a.earnSkins = async () => ({ ok: true, skins: [], granted: [], progress: { opened: { best: 3, current: 3 }, flame: { best: 0 }, coop: { wins: 0, trioWins: 0, trioRanks: [], podium: 0 } }, acquired: null });
    };
    let real: any;
    Object.defineProperty(window, 'Auth', { configurable: true, get() { return real; }, set(v) { real = v; try { patch(v); } catch (_) { /* noop */ } } });
  }, floor);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}
const SHOTS = process.env.WX_SHOTS || '';   // WX_SHOTS=<dir> saves phone-size screenshots for the owner
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: SHOTS + '/' + name + '.png' }); };
const sheet = (page: Page) => page.locator('#wd-sheet');
const openWardrobe = async (page: Page) => { await page.evaluate(() => (window as any).__openWardrobe()); await expect(sheet(page)).toBeVisible(); };
const tab = (page: Page, t: string) => sheet(page).locator('.wx-tab[data-tab="' + t + '"]');
const tile = (page: Page, slot: string, id: string) => sheet(page).locator('.wx-sl[data-sl="' + slot + '"][data-id="' + id + '"]');
const CARD = { alias: 'Richie', rankTier: 'S', rankLabel: 'S RANK', avatarId: 'avatar-skin-shadowborn.png', power: 5601, bossesSlain: 316, avgStepsPerDay: 5625, ultraRareDrops: 24, bestFloor: 99, founderSeq: 1 };

test.describe('W1143 — Frames, Inks and Auras', () => {
  test('five tabs; each slot opens on its default; floor 50 earns Runebound, Frost and Gold Motes, which wear in one tap', async ({ page }) => {
    await boot(page, 50);
    await openWardrobe(page);
    await expect(sheet(page).locator('.wx-tab')).toHaveCount(5);
    await expect(sheet(page).locator('.wx-tab').nth(2)).toHaveText(/Frames/);
    // FRAMES
    await tab(page, 'frames').click();
    await expect(tab(page, 'frames')).toHaveClass(/\bon\b/);
    await expect(sheet(page).locator('.wx-pane[data-pane="frames"] .wx-sl')).toHaveCount(5);
    await expect(tile(page, 'frame', 'gilded')).toHaveClass(/is-worn/);
    await expect(tile(page, 'frame', 'runebound')).toHaveClass(/is-earned/);
    await expect(tile(page, 'frame', 'eclipse')).toHaveClass(/is-locked/);
    await expect(tile(page, 'frame', 'obsidian').locator('.wx-bt-st')).toHaveText('0 / 100');
    await tile(page, 'frame', 'runebound').click();
    await expect(tile(page, 'frame', 'runebound')).toHaveClass(/is-worn/);
    await expect(tile(page, 'frame', 'gilded')).toHaveClass(/is-earned/);
    expect(await page.evaluate(() => localStorage.getItem('hb_card_frame'))).toBe('runebound');
    await expect(sheet(page).locator('.wx-pane[data-pane="frames"] .wx-med')).toHaveClass(/wx-fr-runebound/);
    await expect(sheet(page).locator('.wx-pane[data-pane="frames"] .wx-hl-how')).toHaveText('Earned · Floor 50 cleared');
    await shot(page, 'forge-01-frames');
    // INKS
    await tab(page, 'inks').click();
    await expect(tile(page, 'ink', 'ivory')).toHaveClass(/is-worn/);
    await expect(tile(page, 'ink', 'frost')).toHaveClass(/is-earned/);
    await expect(tile(page, 'ink', 'violet')).toHaveClass(/is-locked/);
    await tile(page, 'ink', 'frost').click();
    expect(await page.evaluate(() => localStorage.getItem('hb_card_ink'))).toBe('frost');
    await expect(sheet(page).locator('.wx-pane[data-pane="inks"] .wx-card-nm')).toHaveClass(/wx-ink-s/);
    await expect(sheet(page).locator('.wx-pane[data-pane="inks"] .wx-hb-nm')).toHaveText('Frost');
    await shot(page, 'forge-02-inks');
    // AURAS
    await tab(page, 'auras').click();
    await expect(tile(page, 'aura', 'none')).toHaveClass(/is-worn/);
    await expect(tile(page, 'aura', 'motes')).toHaveClass(/is-earned/);
    await expect(tile(page, 'aura', 'storm')).toHaveClass(/is-locked/);
    await expect(tile(page, 'aura', 'storm').locator('.wx-bt-st')).toHaveText('50 / 75');
    await tile(page, 'aura', 'motes').click();
    expect(await page.evaluate(() => localStorage.getItem('hb_card_aura'))).toBe('motes');
    await expect(sheet(page).locator('.wx-pane[data-pane="auras"] .wx-med .wx-aura.motes')).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).__wx.state())).toMatchObject({ tab: 'auras', frame: 'runebound', ink: 'frost', aura: 'motes' });
    await shot(page, 'forge-03-auras');
    // back on Looks, the hero wears all three
    await tab(page, 'looks').click();
    await expect(sheet(page).locator('.wx-pane[data-pane="looks"] .wx-med')).toHaveClass(/wx-fr-runebound/);
    await expect(sheet(page).locator('.wx-pane[data-pane="looks"] .wx-med .wx-aura.motes')).toHaveCount(1);
  });

  test('a locked frame opens the detail pager with its condition; a locked item never wears', async ({ page }) => {
    await boot(page, 10);
    await openWardrobe(page);
    await tab(page, 'frames').click();
    await expect(tile(page, 'frame', 'runebound')).toHaveClass(/is-locked/);
    await expect(tile(page, 'frame', 'runebound').locator('.wx-bt-st')).toHaveText('10 / 50');
    await tile(page, 'frame', 'runebound').click();
    const dt = sheet(page).locator('.wx-dt');
    await expect(dt).toHaveClass(/open/);
    // the pager holds every locked frame (Rank-forged, Obsidian, Runebound, Eclipse) and opens on the one tapped
    await expect(dt.locator('.wx-pg')).toHaveCount(4);
    await expect(dt.locator('.wx-pgt')).toHaveAttribute('style', /translateX\(-200%\)/);
    const pg = dt.locator('.wx-pg').filter({ hasText: 'Runebound' });
    await expect(pg.locator('.wx-ms-c')).toHaveText('Clear Floor 50 of the Ascent');
    await expect(pg.locator('.wx-mini')).toHaveClass(/wx-fr-runebound/);
    await shot(page, 'forge-04-locked');
    expect(await page.evaluate(() => localStorage.getItem('hb_card_frame'))).toBeNull();
    expect(await page.evaluate(() => (window as any).__wx.state().detail)).toBe('sl:frame');
    await dt.locator('.wx-dt-x').click();
    await expect(dt).not.toHaveClass(/open/);
  });

  test('the own profile card wears the frame, ink and aura; a visitor\'s card keeps the defaults', async ({ page }) => {
    await boot(page, 50);
    await page.evaluate(() => { localStorage.setItem('hb_card_frame', 'runebound'); localStorage.setItem('hb_card_ink', 'frost'); localStorage.setItem('hb_card_aura', 'motes'); });
    await page.evaluate((d) => (window as any).__pcRender(d, true), CARD);
    const body = page.locator('#pc-body');
    await expect(body.locator('.pc-med')).toHaveClass(/pc-fr-runebound/);
    await expect(body.locator('.pc-alias')).toHaveClass(/wx-ink-s/);
    expect(await body.locator('.pc-alias').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(125, 211, 252)');
    await expect(body.locator('.pc-hero > .wx-aura.motes')).toHaveCount(1);   // W1144 — the aura is the hero's weather, behind the medallion
    await shot(page, 'forge-05-card');
    await page.evaluate((d) => (window as any).__pcRender(Object.assign({}, d, { alias: 'RenDIESEL' }), false), CARD);
    await expect(body.locator('.pc-med')).toHaveClass(/pc-fr-gilded/);
    await expect(body.locator('.pc-alias')).not.toHaveClass(/wx-ink/);
    await expect(body.locator('.pc-hero .wx-aura')).toHaveCount(0);
  });
});
