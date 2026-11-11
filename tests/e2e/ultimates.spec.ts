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
 *   - W1183 (owner 2026-11-11: "random drops from any monster kind of like a shiny pokemon"): ultimates are FOUND now,
 *     a 1-in-40 roll on every boss kill with a 60-kill safety net, never a duplicate; they lead Items › Archive; the old
 *     milestones carry over once for a hunter who had used the Ultimates tab.
 *   - W1185 (owner 2026-11-11: "I don't like how it redirects to the wardrobe... take this out the wardrobe and put all
 *     the information on the ultimates drops page"): no Ultimates tab; a card on Items opens the ultimate's own sheet
 *     there (#ult-sheet: what it does, when to use it, EQUIP / EQUIPPED / how it drops, PREVIEW, n / 9 arrows). The
 *     Ascent header's chip opens the same sheet on the equipped one.
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
// W1183 — Crimson Feast, Hellfire and Arise found (the kills and the shadow stay: they no longer unlock anything by themselves)
const EARNED = {
  hb_dev_ults: '1',
  hb_ult_owned: JSON.stringify(['feast', 'hellfire', 'arise']),
  hb_bosses: JSON.stringify({ the_steel_wolf: { streak: 0, kill_count: 1, last_eval_date: null, engaged: false, engaged_at: null } }),
  hb_coop_kills: JSON.stringify({ the_coursing_dread: { count: 1 } }),
  hb_shadows_v1: JSON.stringify({ extracted: { the_steel_wolf: { at: 1, name: 'The Steel Wolf' } }, active: [], windows: {}, pending: {}, zeroDays: 0, dormant: false, loyaltyDay: '' }),
};
const sheet = (page: Page) => page.locator('#wd-sheet');
const openWardrobe = async (page: Page) => { await page.evaluate(() => (window as any).__openWardrobe()); await expect(sheet(page)).toBeVisible(); };
const ult = (page: Page, id: string) => sheet(page).locator('.wx-sl-ult[data-ul="' + id + '"]');
const page0 = (page: Page) => sheet(page).locator('.wx-dt.open .wx-pg').nth(0);
// W1185 — the ultimate's sheet on Items
const us = (page: Page) => page.locator('#ult-sheet');
const usPg = (page: Page) => us(page).locator('.us-pg');
async function itemsUlts(page: Page) {
  await page.evaluate(() => (document.querySelector('[data-tab="items"]') as HTMLElement).click());
  const sec = page.locator('#pokedex-sections .pokedex-section--ultimates');
  await expect(sec).toBeVisible({ timeout: 6000 });
  if (await sec.evaluate((n) => n.classList.contains('pokedex-section--collapsed'))) await sec.locator('[data-section-toggle="ultimates"]').click();
  await expect(sec).not.toHaveClass(/pokedex-section--collapsed/);
  return sec;
}

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
  test('live (W1171): the Wardrobe keeps its six tabs (W1185: no Ultimates), and the fight fires the chosen one', async ({ page }) => {
    await boot(page, 37, Object.assign({}, EARNED, { hb_dev_ults: '0', hb_ult_choice: 'feast' }));
    expect(await page.evaluate(() => (window as any).Arena._battle.ultsLive())).toBe(true);
    await openWardrobe(page);
    await expect(sheet(page).locator('.wx-tab')).toHaveCount(6);   // W1185
    await expect(sheet(page).locator('.wx-tab[data-tab="ults"]')).toHaveCount(0);
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

  test('W1185: a card on Items opens its sheet right there — what it does, when to use it, EQUIP; arrows walk the nine; a locked one says how it drops', async ({ page }) => {
    await boot(page, 50, Object.assign({}, EARNED, { hb_tour_items_v1: '1' }));
    const sec = await itemsUlts(page);
    await sec.locator('.ua-card[data-ua="feast"]').click();
    await expect(us(page)).toBeVisible();
    await expect(us(page)).toHaveClass(/us-open/);
    await expect(sheet(page)).toBeHidden();   // never the Wardrobe
    await expect(usPg(page).locator('.us-nm')).toHaveText('Crimson Feast');
    await expect(usPg(page).locator('.us-kind')).toHaveText(/drain/i);
    await expect(usPg(page).locator('.us-eff')).toContainText('heals 10% of your health');
    await expect(usPg(page).locator('.us-how')).not.toHaveText('');
    await expect(us(page).locator('.us-n')).toHaveText('2 / 9');   // the Signature first, then the found ones
    await page.waitForTimeout(500);
    await shot(page, 'ult-01-sheet');
    await usPg(page).locator('[data-us="eq"]').click();
    await expect(usPg(page).locator('.us-worn')).toHaveText(/EQUIPPED/);
    await expect(usPg(page).locator('[data-us="eq"]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('hb_ult_choice'))).toBe('feast');
    await expect(sec.locator('.ua-card[data-ua="feast"] .ua-kd')).toHaveText('Equipped');   // the card behind follows
    await expect(sec.locator('.ua-card[data-ua="signature"] .ua-kd')).toHaveText('Signature');
    // back to the Signature (found: EQUIP), then onward
    await us(page).locator('[data-us="prev"]').click();
    await expect(usPg(page).locator('[data-us="eq"]')).toBeVisible();
    await expect(us(page).locator('.us-n')).toHaveText('1 / 9');
    await expect(us(page).locator('[data-us="prev"]')).toBeDisabled();
    await us(page).locator('[data-us="next"]').click();
    await us(page).locator('[data-us="next"]').click();
    await expect(usPg(page).locator('.us-nm')).toHaveText('Hellfire');
    // the close button ends it; a locked card opens the same sheet with how it drops, no EQUIP
    await us(page).locator('.us-x').click();
    await expect(us(page)).toHaveCount(0, { timeout: 2000 });
    await sec.locator('.ua-lock').last().click();
    await expect(us(page).locator('.us-n')).toHaveText('9 / 9');
    await expect(usPg(page)).toHaveClass(/is-locked/);
    await expect(usPg(page).locator('.us-cond')).toHaveText(/Drops from any boss you beat: 1 kill in 40/);
    await expect(usPg(page).locator('[data-us="eq"]')).toHaveCount(0);
    await expect(us(page).locator('[data-us="next"]')).toBeDisabled();
    await page.waitForTimeout(500);
    await shot(page, 'ult-02-sheet-locked');
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
    await boot(page, 50, Object.assign({}, EARNED, { hb_tour_items_v1: '1' }));
    const sec = await itemsUlts(page);
    await sec.locator('.ua-lock').first().click();   // not found yet: a hunter can still watch it
    await expect(usPg(page).locator('.us-nm')).toHaveText('Quicksilver');
    await usPg(page).locator('[data-us="pv"]').click();
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
    await expect(us(page)).toBeVisible();   // back on the ultimate's sheet
  });

  test('W1173 — the Ascent header wears the equipped ultimate beside POWER; a tap opens its sheet above the Ascent (W1185)', async ({ page }) => {
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
    await expect(us(page)).toBeVisible();
    await expect(sheet(page)).toBeHidden();
    await expect(us(page).locator('.us-n')).toHaveText('1 / 9');   // on the equipped one
    await expect(usPg(page).locator('.us-worn')).toHaveText(/EQUIPPED/);
    await us(page).locator('[data-us="next"]').click();
    await expect(usPg(page).locator('.us-nm')).toHaveText('Crimson Feast');
    await page.waitForTimeout(450);
    // the sheet sits above the Ascent: EQUIP is the top element where it is drawn
    const onTop = await page.evaluate(() => { const t = document.querySelector('#ult-sheet [data-us="eq"]') as HTMLElement; const r = t.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(e && t.contains(e)); });
    expect(onTop).toBe(true);
    await usPg(page).locator('[data-us="eq"]').click();
    await expect(chip.locator('.nm')).toHaveText('Crimson Feast');   // the chip follows at once
    await us(page).locator('.us-x').click();
    await expect(us(page)).toHaveCount(0, { timeout: 2000 });
  });

  // ── W1183 — the drops ──
  const owned = (page: Page) => page.evaluate(() => (window as any).__ultDrops.owned());
  test('W1183: a kill rolls 1 in 40 — a hit drops one not owned, its reveal plays, EQUIP IT wears it; never a duplicate', async ({ page }) => {
    await boot(page, 50, { hb_dev_ults: '1' });
    expect(await page.evaluate(() => [(window as any).__ultDrops.oneIn, (window as any).__ultDrops.pityAt])).toEqual([40, 60]);
    await page.evaluate(() => { (window as any).__ultDice = () => 0.024; (window as any).__ultPick = () => 0; (window as any).__ultDrops.roll('the_steel_wolf'); });   // 0.024 < 1/40
    expect(await owned(page)).toEqual(['feast']);
    const ov = page.locator('#ult-drop-overlay');
    await expect(ov.locator('.ud-name')).toHaveText('Crimson Feast', { timeout: 5000 });
    await expect(ov.locator('.ud-eyebrow')).toHaveText(/An ultimate dropped/i);
    await page.waitForTimeout(1300);
    await shot(page, 'ult-10-drop');
    await ov.locator('[data-ud="equip"]').click();
    await expect(ov).toHaveCount(0, { timeout: 3000 });
    expect(await page.evaluate(() => [localStorage.getItem('hb_ult_choice'), (window as any).__ultDrops.pending().length])).toEqual(['feast', 0]);
    // the same pick again lands on the next one: never a duplicate
    await page.evaluate(() => (window as any).__ultDrops.roll('the_carouser'));
    expect(await owned(page)).toEqual(['feast', 'quicksilver']);
    await expect(ov.locator('.ud-name')).toHaveText('Quicksilver', { timeout: 5000 });
    await page.waitForTimeout(900);
    await ov.locator('[data-ud="later"]').click();
    await expect(ov).toHaveCount(0, { timeout: 3000 });
    expect(await page.evaluate(() => localStorage.getItem('hb_ult_choice'))).toBe('feast');   // Later leaves the choice alone
  });

  test('W1183: misses feed the safety net — at 60 the next kill drops one; all eight found and the roll stops', async ({ page }) => {
    await boot(page, 50, { hb_dev_ults: '1' });
    const n = await page.evaluate(() => { const d = (window as any).__ultDrops; (window as any).__ultDice = () => 0.99; for (let i = 0; i < 60; i++) d.roll('the_steel_wolf'); return [d.owned().length, d.pity()]; });
    expect(n).toEqual([0, 60]);
    await page.evaluate(() => (window as any).__ultDrops.roll('the_steel_wolf'));   // the 61st kill: the net catches it
    expect(await page.evaluate(() => [(window as any).__ultDrops.owned().length, (window as any).__ultDrops.pity()])).toEqual([1, 0]);
    await page.evaluate(() => { localStorage.setItem('hb_ult_owned', JSON.stringify(['feast', 'quicksilver', 'hellfire', 'storm', 'worldbreaker', 'reaper', 'arise', 'dawnbreaker'])); localStorage.removeItem('hb_ult_drop_pending'); (window as any).__ultDice = () => 0; (window as any).__ultDrops.roll('the_steel_wolf'); });
    expect(await page.evaluate(() => [(window as any).__ultDrops.owned().length, (window as any).__ultDrops.pity(), (window as any).__ultDrops.pending().length])).toEqual([8, 0, 0]);
  });

  test('W1183: Items › Archive leads with the ultimates — found ones by name, the rest "?"; a card opens its page', async ({ page }) => {
    await boot(page, 50, { hb_dev_ults: '1', hb_ult_owned: JSON.stringify(['feast', 'arise']), hb_ult_choice: 'arise', hb_tour_items_v1: '1' });   // the Items coachmark already seen
    await page.evaluate(() => (document.querySelector('[data-tab="items"]') as HTMLElement).click());
    const sec = page.locator('#pokedex-sections .pokedex-section--ultimates');
    await expect(sec).toBeVisible({ timeout: 6000 });
    expect(await page.evaluate(() => (document.querySelector('#pokedex-sections .pokedex-section') as HTMLElement).getAttribute('data-section-key'))).toBe('ultimates');   // first, above Mega Rare
    // W1184 — it starts closed (owner: "I want it closed on default"); a tap opens it and that sticks
    await expect(sec).toHaveClass(/pokedex-section--collapsed/);
    await expect(sec.locator('.ua-card').first()).toBeHidden();
    await sec.locator('[data-section-toggle="ultimates"]').click();
    await expect(sec).not.toHaveClass(/pokedex-section--collapsed/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_pokedex_collapsed') || '[]').indexOf('ultimates'))).toBe(-1);
    await expect(sec.locator('.pokedex-section-count')).toHaveText('3 / 9');   // the Signature is always there
    await expect(sec.locator('.ua-card')).toHaveCount(3);
    await expect(sec.locator('.ua-card').first()).toHaveAttribute('data-ua', 'signature');
    await expect(sec.locator('.ua-card[data-ua="signature"] .ua-kd')).toHaveText('Signature');
    await expect(sec.locator('.ua-lock')).toHaveCount(6);
    await expect(sec.locator('.ua-lock').first()).toContainText('Drops from any boss');
    await expect(sec.locator('.ua-card[data-ua="arise"] .ua-kd')).toHaveText('Equipped');
    await shot(page, 'ult-11-items');
    await sec.locator('.ua-card[data-ua="feast"]').click();
    await expect(us(page)).toBeVisible();   // W1185 — its sheet, right on Items
    await expect(usPg(page).locator('[data-us="eq"]')).toBeVisible();
    await expect(sheet(page)).toBeHidden();
  });

  test('W1183: the old milestones carry over once for a hunter who had used the Ultimates tab; a new hunter starts with none', async ({ page }) => {
    const kills = { hb_bosses: EARNED.hb_bosses, hb_coop_kills: EARNED.hb_coop_kills, hb_shadows_v1: EARNED.hb_shadows_v1 };
    await boot(page, 50, Object.assign({ hb_dev_ults: '1', hb_ult_seen: JSON.stringify(['feast']) }, kills));
    expect((await owned(page)).sort()).toEqual(['arise', 'feast', 'hellfire']);
    expect(await page.evaluate(() => localStorage.getItem('hb_ult_seeded_v1'))).toBe('1');
  });

  test('W1183: every hunter has the surge ultimate in their kit — a new one sees the Signature, equipped, and eight to find', async ({ page }) => {
    await boot(page, 50, { hb_dev_ults: '1', hb_tour_items_v1: '1' });
    expect(await page.evaluate(() => (window as any).Arena._battle.ultEquipped())).toBe('signature');
    await page.evaluate(() => (document.querySelector('[data-tab="items"]') as HTMLElement).click());
    const sec = page.locator('#pokedex-sections .pokedex-section--ultimates');
    await expect(sec.locator('.pokedex-section-count')).toHaveText('1 / 9', { timeout: 6000 });
    await expect(sec).toHaveClass(/pokedex-section--collapsed/);   // W1184 — closed until tapped
    await expect(sec.locator('.ua-card')).toHaveCount(1);
    await expect(sec.locator('.ua-card[data-ua="signature"] .ua-kd')).toHaveText('Equipped');
    await expect(sec.locator('.ua-card[data-ua="signature"] .ua-nm')).not.toHaveText('');
    await expect(sec.locator('.ua-lock')).toHaveCount(8);
  });

  test('W1184: a saved section list from before (Ultimates open) closes it once; after that the hunter choice sticks', async ({ page }) => {
    await boot(page, 50, { hb_dev_ults: '1', hb_tour_items_v1: '1', hb_pokedex_collapsed: JSON.stringify(['rare']) });
    await page.evaluate(() => (document.querySelector('[data-tab="items"]') as HTMLElement).click());
    const sec = page.locator('#pokedex-sections .pokedex-section--ultimates');
    await expect(sec).toHaveClass(/pokedex-section--collapsed/, { timeout: 6000 });
    await expect(page.locator('#pokedex-sections .pokedex-section--rare')).toHaveClass(/pokedex-section--collapsed/);
    await sec.locator('[data-section-toggle="ultimates"]').click();
    await expect(sec).not.toHaveClass(/pokedex-section--collapsed/);
    await page.reload();
    await page.evaluate(() => (document.querySelector('[data-tab="items"]') as HTMLElement).click());
    await expect(page.locator('#pokedex-sections .pokedex-section--ultimates')).not.toHaveClass(/pokedex-section--collapsed/, { timeout: 6000 });
  });

  test('W1183: a hunter who never saw the old tab keeps nothing from the milestones', async ({ page }) => {
    const kills = { hb_bosses: EARNED.hb_bosses, hb_coop_kills: EARNED.hb_coop_kills, hb_shadows_v1: EARNED.hb_shadows_v1 };
    await boot(page, 50, Object.assign({ hb_dev_ults: '1' }, kills));
    expect(await owned(page)).toEqual([]);
  });

  test('a locked choice falls back to the Signature', async ({ page }) => {
    await boot(page, 37, Object.assign({}, EARNED, { hb_ult_choice: 'reaper' }));   // no S-rank kill
    expect(await page.evaluate(() => (window as any).Arena._battle.ultEquipped())).toBe('signature');
    await intoFight(page, 37);
    expect(await page.evaluate(() => (window as any).Arena._live.sess()._ultId)).toBe('signature');
  });
});
