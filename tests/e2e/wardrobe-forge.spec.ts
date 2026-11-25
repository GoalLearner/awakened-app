/**
 * Awakened — Frames, Inks and Auras in the Wardrobe (W1143, Claude Design handoff 8 "Player Card - Wardrobe").
 *
 * Owner 2026-11-07: "build the wardrobe tabs". Pinned here:
 *   - five tabs: Looks · Backgrounds · Inks · Auras · Pins (W1296 — the Frames tab is gone: the card shows the hunter
 *     full body with no box, owner 2026-11-23);
 *   - every slot opens on its default worn; an item the hunter's numbers have earned wears in one tap and the
 *     worn id lands in localStorage; a locked item opens the detail pager with its condition;
 *   - the hero medallion and the own profile card wear the frame, the ink and the aura; a visitor's card keeps
 *     the defaults (nothing is published yet).
 *
 * Auth is stubbed through a setter trap on window.Auth (auth.js assigns it once), as the Rising spec does.
 */
import { test, expect, Page } from '@playwright/test';

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
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_skins_owned_cache', JSON.stringify({ skins: [], at: Date.now() }));
      localStorage.setItem('hb_earn_bg_seen_v1', '[]');
      localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: f + 1, highestCleared: f, wins: f, losses: 0, streak: 0, bestStreak: 0, dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }));
      Object.keys(extra || {}).forEach((k) => localStorage.setItem(k, extra[k]));
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
  }, [floor, extra || {}] as [number, Record<string, string>]);
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
  test('five tabs, no Frames (W1296); each slot opens on its default; floor 50 earns Frost and Gold Motes, which wear in one tap', async ({ page }) => {
    await boot(page, 50);
    await page.evaluate(() => localStorage.setItem('hb_card_frame', 'runebound'));   // worn before W1296: it paints nothing now
    await openWardrobe(page);
    await expect(sheet(page).locator('.wx-tab')).toHaveCount(5);   // W1296 — Looks · Backgrounds · Inks · Auras · Pins
    await expect(sheet(page).locator('.wx-tab').nth(2)).toHaveText(/Inks/);
    await expect(tab(page, 'frames')).toHaveCount(0);
    await expect(sheet(page).locator('.wx-pane[data-pane="frames"]')).toHaveCount(0);
    await expect(sheet(page).locator('.wx-pane[data-pane="looks"] .wx-med')).toHaveClass(/wx-fr-gilded/);
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
    // W1145 — a tile's aura is a sibling BEHIND the mini medallion (never inside it): the portrait stays on top
    await expect(tile(page, 'aura', 'motes').locator('.wx-aurap > .wx-aura.motes + .wx-mini > .wx-art')).toHaveCount(1);
    await expect(tile(page, 'aura', 'motes').locator('.wx-mini .wx-aura')).toHaveCount(0);
    await tile(page, 'aura', 'motes').click();
    expect(await page.evaluate(() => localStorage.getItem('hb_card_aura'))).toBe('motes');
    await expect(sheet(page).locator('.wx-pane[data-pane="auras"] .wx-med .wx-aura.motes')).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).__wx.state())).toMatchObject({ tab: 'auras', frame: 'gilded', ink: 'frost', aura: 'motes' });
    await shot(page, 'forge-03-auras');
    // back on Looks, the hero wears the aura (and no frame: W1296)
    await tab(page, 'looks').click();
    await expect(sheet(page).locator('.wx-pane[data-pane="looks"] .wx-med')).toHaveClass(/wx-fr-gilded/);
    await expect(sheet(page).locator('.wx-pane[data-pane="looks"] .wx-med .wx-aura.motes')).toHaveCount(1);
  });

  test('a locked ink opens the detail pager with its condition; a locked item never wears', async ({ page }) => {   // W1296 — was a locked frame
    await boot(page, 10);
    await openWardrobe(page);
    await tab(page, 'inks').click();
    await expect(tile(page, 'ink', 'frost')).toHaveClass(/is-locked/);
    await expect(tile(page, 'ink', 'frost').locator('.wx-bt-st')).toHaveText('10 / 40');
    await tile(page, 'ink', 'frost').click();
    const dt = sheet(page).locator('.wx-dt');
    await expect(dt).toHaveClass(/open/);
    const pg = dt.locator('.wx-pg').filter({ hasText: 'Frost' });
    await expect(pg.locator('.wx-ms-c')).toHaveText('Clear Floor 40 of the Ascent');
    await shot(page, 'forge-04-locked');
    expect(await page.evaluate(() => localStorage.getItem('hb_card_ink'))).toBeNull();
    expect(await page.evaluate(() => (window as any).__wx.state().detail)).toBe('sl:ink');
    await dt.locator('.wx-dt-x').click();
    await expect(dt).not.toHaveClass(/open/);
  });

  // W1156/W1157 — PINS: a sixth slot, several worn at once (two at most, a third replaces the oldest), every pin a verified
  // number. The catalog has no Boss Slayer and no Summit (BOSS KILLS and BEST FLOOR already say them); one shadow is enough.
  test('pins: earned from the numbers, two at most, the oldest gives way; the own card wears them, a visitor\'s shows the published ones', async ({ page }) => {
    const day = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    await boot(page, 50, {
      hb_leaderboard: JSON.stringify({ steps_daily: { [day]: 16250 }, lifetime_steps_total: 1200000, lifetime_steps_start_date: '2026-05-15' }),
      hb_shadows_v1: JSON.stringify({ extracted: { the_twin_maw: { at: 1762000000000, name: 'The Twin Maw' } }, active: [], windows: {}, pending: {} }),
    });
    await openWardrobe(page);
    await tab(page, 'pins').click();
    await expect(tab(page, 'pins')).toHaveClass(/\bon\b/);
    const pane = sheet(page).locator('.wx-pane[data-pane="pins"]');
    await expect(pane.locator('.wx-sl')).toHaveCount(13);   // W1158 — the Step Club and Prestige joined; W1286 — the 200K and 300K weeks; W1312 — the Mythics; W1313 — four status pins
    await expect(tile(page, 'pin', 'club200k')).toHaveClass(/is-locked/);   // W1286 — no 200K week here
    await expect(tile(page, 'pin', 'club300k')).toHaveClass(/is-locked/);
    await expect(tile(page, 'pin', 'steps1m')).toHaveClass(/is-earned/);
    await expect(tile(page, 'pin', 'bestday')).toHaveClass(/is-earned/);
    await expect(tile(page, 'pin', 'shadows')).toHaveClass(/is-earned/);            // one shadow is enough
    await expect(tile(page, 'pin', 'wgmvp')).toHaveClass(/is-locked/);
    await expect(tile(page, 'pin', 'wgmvp').locator('.wx-bt-st')).toHaveText('0 / 1');
    await expect(tile(page, 'pin', 'club100k')).toHaveClass(/is-locked/);   // W1158 — no accolade cached on this device, no Prestige
    await expect(tile(page, 'pin', 'prestige')).toHaveClass(/is-locked/);
    await expect(pane.locator('.wx-hl .pc-pin')).toHaveText('NO PINS');
    // wear one, then a second
    await tile(page, 'pin', 'steps1m').click();
    await expect(tile(page, 'pin', 'steps1m')).toHaveClass(/is-worn/);
    await expect(pane.locator('.wx-hl .pc-pins .pc-pin')).toHaveText(['1,000,000 STEPS']);
    await tile(page, 'pin', 'bestday').click();
    expect(await page.evaluate(() => (window as any).__wx.state().pins)).toEqual(['steps1m', 'bestday']);
    await expect(pane.locator('.wx-hl .pc-pins .pc-pin')).toHaveText(['1,000,000 STEPS', '16,250 IN A DAY']);
    // a third replaces the oldest; tapping a worn pin takes it off
    await tile(page, 'pin', 'shadows').click();
    expect(await page.evaluate(() => (window as any).__wx.state().pins)).toEqual(['bestday', 'shadows']);
    await expect(tile(page, 'pin', 'steps1m')).toHaveClass(/is-earned/);
    await tile(page, 'pin', 'bestday').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_card_pins') || '[]'))).toEqual(['shadows']);
    await shot(page, 'forge-06-pins');
    // the own card wears what this phone chose; a visitor's card shows the published pins; the own row opens Pins
    await page.evaluate(() => document.getElementById('wd-overlay')!.click());   // the backdrop closes the Wardrobe
    await expect(sheet(page)).toBeHidden();
    await page.evaluate((d) => (window as any).__pcRender(d, true), CARD);
    const body = page.locator('#pc-body');
    await expect(body.locator('.pcc-seals--own .pcc-seal--pin')).toHaveText(['1 SHADOW']);
    await page.evaluate((d) => (window as any).__pcRender(Object.assign({}, d, { alias: 'RenDIESEL', cardPins: [{ id: 'wgmvp', v: 2 }, { id: 'shadows', v: 11 }] }), false), CARD);
    await expect(body.locator('.pcc-seal--pin')).toHaveText(['2× WORLDGATE MVP', '11 SHADOWS']);
    await expect(body.locator('.pcc-seals--own')).toHaveCount(0);
    await page.evaluate((d) => (window as any).__pcRender(d, true), CARD);
    await body.locator('.pcc-seals--own').click();
    await expect(sheet(page)).toBeVisible();
    await expect(tab(page, 'pins')).toHaveClass(/\bon\b/);
    // W1161 — the worn pin under the medallion is a button: tap its × to take it off; zero pins is allowed and published as []
    await sheet(page).locator('.wx-hl [data-pinrm="shadows"]').click();
    expect(await page.evaluate(() => (window as any).__wx.state().pins)).toEqual([]);
    await expect(pane.locator('.wx-hl .pc-pin')).toHaveText('NO PINS');
    expect(await page.evaluate(() => localStorage.getItem('hb_card_pins'))).toBe('[]');
  });

  // W1312 — owner 2026-11-24: "Yes build the mythics pin". Earned by a mythic weapon; one names it, two count, three read
  // ALL 3; the badge lights a panel per weapon owned; a locked tile shows the whole set; the card shows it as a seal.
  test('W1312 — the Mythics pin: earned by a mythic weapon, names one, counts two, ALL 3 at three; the card wears it', async ({ page }) => {
    await boot(page, 50, { hb_inventory: JSON.stringify({ cards: { reverie_staff: { discovered: true, count: 1, first_acquired_date: '2026-11-20', upgrade_level: 0 } } }) });
    expect(await page.evaluate(() => { const st = (window as any).__wx.stats(); return [st.mega, st.mythics]; })).toEqual([1, 2]);   // the staff: bit 2
    await openWardrobe(page);
    await tab(page, 'pins').click();
    const pane = sheet(page).locator('.wx-pane[data-pane="pins"]');
    await expect(pane.locator('.wx-sl').first()).toHaveAttribute('data-id', 'mythics');   // the rarest leads the shelf
    const t = tile(page, 'pin', 'mythics');
    await expect(t).toHaveClass(/is-earned/);
    await expect(t.locator('.pc-pin--mythics')).toHaveText('REVERIE');
    await expect(t.locator('.pmy-off')).toHaveCount(2);   // the blade and the bow still dark
    await t.click();
    expect(await page.evaluate(() => (window as any).__wx.state().pins)).toEqual(['mythics']);
    await expect(pane.locator('.wx-hl .pc-pins .pc-pin')).toHaveText(['REVERIE']);
    await shot(page, 'forge-07-mythics');
    // the own card wears it as a seal; a visitor's card names the right weapon from the published number
    await page.evaluate(() => document.getElementById('wd-overlay')!.click());
    await page.evaluate((d) => (window as any).__pcRender(d, true), CARD);
    const body = page.locator('#pc-body');
    await expect(body.locator('.pcc-seals--own .pcc-seal--pin')).toHaveText(['REVERIE']);
    await expect(body.locator('.pcc-seal--mythics .pmy img')).toHaveAttribute('src', 'assets/badges/pin-mythics.webp');
    await expect.poll(() => body.locator('.pcc-seal--mythics .pmy img').evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    for (const [v, txt, off] of [[1, 'NIGHTFALL', 2], [4, 'VIGIL', 2], [5, '2 MYTHICS', 1], [7, 'ALL 3 MYTHICS', 0]] as [number, string, number][]) {
      await page.evaluate(([d, n]) => (window as any).__pcRender(Object.assign({}, d, { alias: 'RenDIESEL', cardPins: [{ id: 'mythics', v: n }] }), false), [CARD, v] as [typeof CARD, number]);
      await expect(body.locator('.pcc-seal--pin')).toHaveText([txt]);
      await expect(body.locator('.pcc-seal--mythics .pmy-off')).toHaveCount(off);
    }
    if (SHOTS) await page.screenshot({ path: SHOTS + '/forge-08-mythics-card.png' });
  });

  test('W1312 — no mythic weapon: the Mythics tile is locked and shows the whole set', async ({ page }) => {
    await boot(page, 50);
    await openWardrobe(page);
    await tab(page, 'pins').click();
    const t = tile(page, 'pin', 'mythics');
    await expect(t).toHaveClass(/is-locked/);
    await expect(t.locator('.pc-pin--mythics')).toHaveText('ALL 3 MYTHICS');
    await expect(t.locator('.pmy-off')).toHaveCount(0);
    await expect(t.locator('.wx-bt-st')).toHaveText('0 / 1');
    await shot(page, 'forge-09-mythics-locked');
  });

  // W1313 — owner 2026-11-24: "Do all of them build". God Slayer (Grinning God raids won), Weekly Champion (weeks at #1,
  // the server's count), Anomaly Hunter (5+ hidden quests), Everest (2,903 flights since this hunter began).
  test('W1313 — the four status pins: earned from their numbers, their labels, and a visitor\'s card names them', async ({ page }) => {
    const progress = { opened: { best: 3, current: 3 }, flame: { best: 0 }, coop: { wins: 0, trioWins: 0, trioRanks: [], podium: 0 }, weekly: { wins: 3 } };
    await boot(page, 50, {
      hb_coop_kills: JSON.stringify({ the_grinning_god: { count: 2 } }),
      hb_earn_progress_v1: JSON.stringify({ weeklyWins: 3, at: Date.now() }),
      hb_stirs_v1: JSON.stringify({ fired: { the_long_day: 1, shadow_legion: 1, kill_before_dawn: 1, the_late_seal: 1, century_stair: 1, triple_hunt: 1 }, dawns: {}, fragments: [] }),
      hb_leaderboard: JSON.stringify({ steps_daily: {}, flights_daily: {}, lifetime_flights_total: 3000, lifetime_flights_at: Date.now(), lifetime_steps_start_date: '2026-05-15' }),
    });
    await page.evaluate((p) => { (window as any).Auth.earnSkins = async () => ({ ok: true, skins: [], granted: [], progress: p, acquired: null }); }, progress);
    expect(await page.evaluate(() => { const st = (window as any).__wx.stats(); return [st.godKills, st.weeklyWins, st.anomalies, st.flightsLife]; })).toEqual([2, 3, 6, 3000]);
    await openWardrobe(page);
    await tab(page, 'pins').click();
    const pane = sheet(page).locator('.wx-pane[data-pane="pins"]');
    expect(await pane.locator('.wx-sl').evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute('data-id')))).toEqual(['mythics', 'godslayer', 'weekly1', 'anomalies', 'everest']);
    for (const [id, txt] of [['godslayer', 'GOD SLAYER ×2'], ['weekly1', 'WEEKLY #1 ×3'], ['anomalies', '6 ANOMALIES'], ['everest', 'EVEREST CLIMBED']]) {
      await expect(tile(page, 'pin', id)).toHaveClass(/is-earned/);
      await expect(tile(page, 'pin', id).locator('.pc-pin--' + id)).toHaveText(txt);
      await expect(tile(page, 'pin', id).locator('.pim')).toHaveAttribute('src', 'assets/badges/pin-' + id + '.webp');
    }
    await expect.poll(() => tile(page, 'pin', 'everest').locator('.pim').evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await tile(page, 'pin', 'godslayer').click();
    await tile(page, 'pin', 'weekly1').click();
    expect(await page.evaluate(() => (window as any).__wx.state().pins)).toEqual(['godslayer', 'weekly1']);
    await shot(page, 'forge-10-status-pins');
    // a visitor's card from the published numbers
    await page.evaluate(() => document.getElementById('wd-overlay')!.click());
    const body = page.locator('#pc-body');
    for (const [pins, txt] of [
      [[{ id: 'godslayer', v: 1 }, { id: 'everest', v: 6000 }], ['GOD SLAYER', 'EVEREST ×2']],
      [[{ id: 'weekly1', v: 1 }, { id: 'anomalies', v: 9 }], ['WEEKLY #1', '9 ANOMALIES']],
    ] as [{ id: string; v: number }[], string[]][]) {
      await page.evaluate(([d, p]) => (window as any).__pcRender(Object.assign({}, d, { alias: 'RenDIESEL', cardPins: p }), false), [CARD, pins] as [typeof CARD, typeof pins]);
      await expect(body.locator('.pcc-seal--pin')).toHaveText(txt);
    }
    if (SHOTS) await page.screenshot({ path: SHOTS + '/forge-11-status-card.png' });
  });

  test('W1313 — none earned: the four status tiles are locked with their goals', async ({ page }) => {
    await boot(page, 50);
    await openWardrobe(page);
    await tab(page, 'pins').click();
    for (const id of ['godslayer', 'weekly1', 'anomalies', 'everest']) await expect(tile(page, 'pin', id)).toHaveClass(/is-locked/);
    await expect(tile(page, 'pin', 'anomalies').locator('.wx-bt-st')).toHaveText('0 / 5');
    await expect(tile(page, 'pin', 'anomalies').locator('.pc-pin--anomalies')).toHaveText('5 ANOMALIES');
    await expect(tile(page, 'pin', 'everest').locator('.pc-pin--everest')).toHaveText('EVEREST CLIMBED');
  });

  test('W1313 — Everest counts flights since the hunter began from Apple Health, never lower, never more than 1,000 a day', async ({ page }) => {
    await boot(page, 50, { hb_leaderboard: JSON.stringify({ steps_daily: {}, flights_daily: { '2026-11-20': 40, '2026-11-21': 60 }, lifetime_steps_start_date: '2026-11-01' }) });
    const run = (health: number | null, stamp?: number) => page.evaluate(async ([h, at]) => {
      const w = window as any;
      if (at !== undefined) { const st = JSON.parse(localStorage.getItem('hb_leaderboard') || '{}'); st.lifetime_flights_at = at; localStorage.setItem('hb_leaderboard', JSON.stringify(st)); }
      w.Health = Object.assign(w.Health || {}, { getFlightsClimbedBetween: async () => h });
      return w.__lbRefreshLifetimeFlights();
    }, [health, stamp] as [number | null, number | undefined]);
    expect(await run(3120, 0)).toBe(3120);            // Health since Nov 1
    expect(await run(10, 0)).toBe(3120);              // never lower
    expect(await run(5000, Date.now())).toBe(3120);   // asked within 6 hours: not again
    expect(await run(99999999, 0)).toBeLessThanOrEqual(1000 * 60);   // a day is at most 1,000 flights
    expect(await page.evaluate(() => (window as any).__wx.stats().flightsLife)).toBeGreaterThan(3120);
  });

  test('the own profile card wears the ink and the aura (no frame: W1296); a visitor\'s card keeps the defaults', async ({ page }) => {
    await boot(page, 50);
    await page.evaluate(() => { localStorage.setItem('hb_card_frame', 'runebound'); localStorage.setItem('hb_card_ink', 'frost'); localStorage.setItem('hb_card_aura', 'motes'); });
    await page.evaluate((d) => (window as any).__pcRender(d, true), CARD);
    const body = page.locator('#pc-body');
    await expect(body.locator('.pc-med, [class*="pc-fr-"]')).toHaveCount(0);   // W1296 — the hunter stands full body, no frame
    await expect(body.locator('.pc-alias')).toHaveClass(/wx-ink-s/);
    expect(await body.locator('.pc-alias').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(125, 211, 252)');
    await expect(body.locator('.pcc-plate > .wx-aura.motes')).toHaveCount(1);   // W1308 — the aura stands behind the hunter in the plate
    await shot(page, 'forge-05-card');
    await page.evaluate((d) => (window as any).__pcRender(Object.assign({}, d, { alias: 'RenDIESEL' }), false), CARD);
    await expect(body.locator('.pcc-art')).toHaveCount(1);
    await expect(body.locator('.pc-alias')).not.toHaveClass(/wx-ink/);
    await expect(body.locator('.pcc-hero .wx-aura')).toHaveCount(0);
  });
});
