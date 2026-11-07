/**
 * Awakened — the Ascent battle redesign (W1135, Claude Design handoff 5), the screen.
 *
 * Owner 2026-11-06: "Everything at once". Pinned here:
 *   - the face-off: the FOE INTENT badge names the move the foe has committed to, the TURN diamond
 *     counts, the Surge starts empty and fills from the trade;
 *   - full Surge turns the meter into UNLEASH: the cut-in plays, the ultimate lands, the Surge is spent;
 *   - boss floors open on the intro card (tap through), and a boss on floors 10-90 breaks at half
 *     (PHASE II + its line, the crimson tint) with no stat change;
 *   - the victory sheet: FLOOR CLEARED (or FLAWLESS), NEXT FLOOR · N+1, LEAVE THE ASCENT;
 *   - the defeat sheet: WHAT BEAT YOU, TRY AGAIN;
 *   - a duel keeps its turn status and shows neither the intent badge nor the Surge.
 *
 * PKB2_SHOTS=<dir> also saves phone-size screenshots of each state for the owner.
 */
import { test, expect, Page } from '@playwright/test';

const SHOTS = process.env.PKB2_SHOTS || '';

async function boot(page: Page, floor: number, pts = 2400) {
  await page.addInitScript(([floor, pts]) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__pkb2')) return; sessionStorage.setItem('__pkb2', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_ascent_opening_seen_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      const st = { pts: pts as number };
      localStorage.setItem('hb_stats', JSON.stringify({ STR: st, VIT: st, INT: st, FOCUS: st, WILL: st, WLT: st }));
      localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: floor, highestCleared: (floor as number) - 1, wins: 0, losses: 0, streak: 0, bestStreak: 0,
        dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }));
    } catch (_) { /* noop */ }
  }, [floor, pts]);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).Arena && !!document.querySelector('[data-tab="profile"]'));
}

// Tower → the Matchup → FIGHT; a boss floor's intro card is tapped through (or left up when keepIntro).
async function intoFight(page: Page, floor: number, keepIntro = false) {
  await page.evaluate(async (f) => {
    (document.querySelector('[data-tab="profile"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 400));
    (document.getElementById('sc-arena-btn') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 400));
    (document.querySelector('#arena-body [data-ar="fight"][data-floor="' + f + '"]') as HTMLElement).click();
  }, floor);
  await page.locator('#arena-body [data-ar="introgo"]').click();
  await expect(page.locator('#arena-body .pkb2')).toBeVisible();
  if (keepIntro) return;
  if (await page.locator('#arena-body .pkb2-intro').count()) await page.locator('#arena-body .pkb2-intro').click();
  await ready(page);
}
const ready = (page: Page) => expect(page.locator('#arena-body .ar-bmoves:not(.lock) [data-ar="move"]').first()).toBeVisible({ timeout: 12_000 });
const sess = (page: Page, fn: string) => page.evaluate(fn);
const resync = (page: Page) => page.evaluate(() => (window as any).Arena._live.paint());
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  const v = page.viewportSize();
  await page.screenshot({ path: SHOTS + '/' + name + '-' + (v ? v.width + 'x' + v.height : '') + '.png' });
};
// tap the first live card that is not the Surge (the Surge also carries data-ar="move" when full)
const tapMove = (page: Page) => page.locator('#arena-body .pkb-moves .ar-bmoves:not(.lock) [data-ar="move"]').first().click();
// play until the fight ends and the sheet rises. Before every move the losing side is held at 1 HP with its
// guard and buffs stripped, so a guard, a heal or a dodge only delays the end by a turn.
async function playOut(page: Page, loser: 'p' | 'b') {
  for (let i = 0; i < 60; i++) {
    if (await page.locator('#arena-body .pkb2-result').count()) return;
    const live = page.locator('#arena-body .pkb-moves .ar-bmoves:not(.lock) [data-ar="move"]').first();
    const done = await page.evaluate((side) => {
      const s = (window as any).Arena._live.sess(); if (!s || s.done) return true;
      if (document.querySelector('#arena-body .pkb-moves .ar-bmoves:not(.lock)')) {
        if (side === 'b') { s.bHP = Math.min(s.bHP, 1); if (s.bS) { s.bS.guard = 0; s.bS.mods = []; } }
        else { s.pHP = Math.min(s.pHP, 1); if (s.pS) { s.pS.guard = 0; s.pS.mods = []; } }
        (window as any).Arena._live.paint();
      }
      return false;
    }, loser);
    if (!done && await live.count()) await live.click();
    await page.waitForTimeout(500);
  }
}

for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  test.describe('W1135 — the Ascent battle redesign @' + vp.width + 'x' + vp.height, () => {
    test.use({ viewport: vp });

    test('the face-off: the intent badge names the committed move; turn and Surge advance with the trade', async ({ page }) => {
      await boot(page, 37);
      await intoFight(page, 37);
      await shot(page, '01-battle');
      const intent = page.locator('#pkb-intent');
      await expect(intent).not.toHaveClass(/hidden/);
      const word = await sess(page, 'Arena._battle.intentWord(Arena._live.sess())');
      expect(['HEAVY', 'STRIKE', 'CURSE', 'GUARD', 'CHARGE', 'STUNNED']).toContain(word);
      await expect(intent).toHaveText(String(word));
      await expect(page.locator('#pkb-turn')).toHaveText('1');
      await expect(page.locator('#pkb-surge .sv')).toHaveText('0%');
      // the badge's word is the move the foe then plays (unless it is stunned)
      const committed = await sess(page, 'Arena._live.sess()._bNext && Arena._live.sess()._bNext.id');
      expect(committed).toBeTruthy();
      await tapMove(page);
      await ready(page);
      await expect(page.locator('#pkb-turn')).toHaveText('2');
      expect(await sess(page, 'Arena._live.sess()._surge')).toBeGreaterThan(0);
      await expect(page.locator('#pkb-surge .sv')).not.toHaveText('0%');
      // the whole stage, band and moves fit the phone: no scrolling the battle
      const fits = await page.evaluate(() => { const b = document.getElementById('arena-body') as HTMLElement; return b.scrollHeight <= b.clientHeight + 1; });
      expect(fits).toBe(true);
    });

    test('full Surge: UNLEASH plays the cut-in, lands the ultimate and spends the Surge', async ({ page }) => {
      await boot(page, 37);
      await intoFight(page, 37);
      await page.evaluate(() => { const s = (window as any).Arena._live.sess(); s._surge = 1; (window as any).Arena._live.paint(); });
      const surge = page.locator('#pkb-surge');
      await expect(surge).toHaveClass(/full/);
      await expect(surge).toHaveAttribute('data-move', 'ultimate');
      await expect(surge.locator('.ult .n')).toHaveText(String(await sess(page, 'Arena._battle.ultimate(Arena._live.sess()).name')));
      await shot(page, '02-surge-full');
      const turn0 = await sess(page, 'Arena._live.sess().turn');
      await surge.click();
      await expect(page.locator('#arena-body .pkb2-cutin')).toBeVisible();
      await page.waitForTimeout(700);
      await shot(page, '03-cutin');
      await expect(page.locator('#arena-body .pkb2-cutin')).toHaveCount(0, { timeout: 4000 });
      await page.waitForFunction((t) => { const s = (window as any).Arena._live.sess(); return !s || s.done || s.turn > (t as number); }, turn0);
      expect(await sess(page, 'Arena._live.sess()._surge')).toBe(0);
      await expect(surge).not.toHaveClass(/full/, { timeout: 12_000 });
    });

    test('the finisher strip sits under the cards, dormant above 30% and IGNITED at or below it', async ({ page }) => {
      await boot(page, 37);
      await intoFight(page, 37);
      // a 5-move kit: Reckoning (the real execute) joins the four
      await page.evaluate(() => {
        const s = (window as any).Arena._live.sess();
        s.pMoves = s.pMoves.slice(0, 4).concat([{ id: 'reckoning', name: 'Reckoning', gl: 'sword', power: 1.05, acc: 0.9, cd: 2, exe: { thr: 0.30, mult: 2.0 }, desc: 'Ends what the fight began — brutal below 30%.' }]);
        (window as any).Arena._live.paint();
      });
      const fin = page.locator('#arena-body .ar-bmove.exe');
      await expect(fin).toHaveCount(1);
      await expect(fin).not.toHaveClass(/exe-ready/);
      await expect(fin.locator('.stat .c')).toHaveText('≤30%');
      expect(await page.evaluate(() => Array.from(document.querySelectorAll('#arena-body .ar-bmoves > *')).pop()!.classList.contains('exe'))).toBe(true);
      await page.evaluate(() => { const s = (window as any).Arena._live.sess(); s.bHP = Math.floor(s.bMax * 0.28); (window as any).Arena._live.paint(); });
      await expect(fin).toHaveClass(/exe-ready/);
      await expect(fin.locator('.stat .c')).toHaveText('IGNITED');
      await shot(page, '09-finisher');
      const fits = await page.evaluate(() => { const b = document.getElementById('arena-body') as HTMLElement; return b.scrollHeight <= b.clientHeight + 1; });
      expect(fits).toBe(true);
    });

    test('boss floor: the intro card taps through; the boss breaks at half without a stat change', async ({ page }) => {
      await boot(page, 10, 120);   // under W1067's 3x outclass: an outclassing hunter's first hit ends any fight
      await intoFight(page, 10, true);
      const intro = page.locator('#arena-body .pkb2-intro');
      await expect(intro).toBeVisible();
      await expect(intro).toContainText('FLOOR 10 · BOSS');
      await page.waitForTimeout(1700);
      await shot(page, '04-boss-intro');
      await intro.click();
      await expect(intro).toHaveCount(0);
      await ready(page);
      await shot(page, '05-boss-battle');
      // a deep pool just above half, so one blow crosses the line without ending the fight
      await page.evaluate(() => { const s = (window as any).Arena._live.sess(); s.bMax *= 40; s.bHP = Math.ceil(s.bMax * 0.502); (window as any).Arena._live.paint(); });
      const before = await sess(page, 'JSON.stringify({ atk: Arena._live.sess().bot && Arena._live.sess().bot.atk, bMax: Arena._live.sess().bMax })');
      const phase = page.locator('#arena-body .pkb2-phase');
      for (let i = 0; i < 6 && !(await phase.count()); i++) {
        if (await page.evaluate(() => (window as any).Arena._live.sess()._phaseLineShown)) break;
        await tapMove(page);
        await page.waitForTimeout(250);
        await page.waitForFunction(() => document.querySelector('#arena-body .pkb2-phase') || document.querySelector('#arena-body .ar-bmoves:not(.lock)') || document.querySelector('#arena-body .pkb2-result'), null, { timeout: 15_000 });
      }
      expect(await page.evaluate(() => (window as any).Arena._live.sess()._phaseLineShown)).toBe(true);
      if (SHOTS) { await phase.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); await shot(page, '10-phase'); }
      await expect(page.locator('#pkb-stage')).toHaveClass(/p2/);
      expect(await sess(page, 'JSON.stringify({ atk: Arena._live.sess().bot && Arena._live.sess().bot.atk, bMax: Arena._live.sess().bMax })')).toBe(before);
    });

    test('victory: FLOOR CLEARED, NEXT FLOOR · 38, LEAVE THE ASCENT', async ({ page }) => {
      await boot(page, 37);
      await intoFight(page, 37);
      test.setTimeout(60_000);
      await playOut(page, 'b');
      const sheet = page.locator('#arena-body .pkb2-result.win');
      await expect(sheet).toBeVisible({ timeout: 12_000 });
      await expect(sheet.locator('.ar-result-word')).toHaveText(/^(FLOOR CLEARED|FLAWLESS)$/);
      await expect(sheet.locator('[data-ar="fight"][data-floor="38"]')).toHaveText('NEXT FLOOR · 38');
      await expect(sheet.locator('[data-ar="tower"]')).toHaveText('LEAVE THE ASCENT');
      await expect(sheet.locator('.loot')).toContainText('Floor 38 is open');
      await page.waitForTimeout(1500);
      await shot(page, '06-victory');
      // NEXT FLOOR opens the next matchup
      await sheet.locator('[data-ar="fight"][data-floor="38"]').click();
      await expect(page.locator('#arena-body [data-ar="introgo"]')).toBeVisible();
    });

    test('defeat: WHAT BEAT YOU names the blow; TRY AGAIN', async ({ page }) => {
      await boot(page, 37);
      await intoFight(page, 37);
      test.setTimeout(60_000);
      await playOut(page, 'p');
      const sheet = page.locator('#arena-body .pkb2-result.loss');
      await expect(sheet).toBeVisible({ timeout: 12_000 });
      await expect(sheet.locator('.ar-result-word')).toHaveText('DEFEAT');
      await expect(sheet.locator('.cause')).toContainText('WHAT BEAT YOU');
      await expect(sheet.locator('.cause')).toContainText(/turn \d+/);
      await expect(sheet.locator('[data-ar="rematch"][data-floor="37"]')).toHaveText('TRY AGAIN');
      await page.waitForTimeout(1500);
      await shot(page, '07-defeat');
    });

    test('floor 100: the First Awakened (screenshots only)', async ({ page }) => {
      test.skip(!SHOTS, 'screenshots only');
      await boot(page, 100, 6650);
      await intoFight(page, 100, true);
      await page.waitForTimeout(1900);
      await shot(page, '11-f100-intro');
      await page.locator('#arena-body .pkb2-intro').click();
      await ready(page);
      await shot(page, '12-f100-battle');
    });

    test('a duel keeps its turn status and shows no intent badge and no Surge', async ({ page }) => {
      await boot(page, 37);
      await page.evaluate(() => (window as any).__pvpDemo());
      await expect(page.locator('#arena-body .pkb2.pkb2--pvp')).toBeVisible();
      await expect(page.locator('#pvp-status')).toHaveCount(1);
      await expect(page.locator('#pkb-intent')).toHaveClass(/hidden/);
      await expect(page.locator('#pkb-surge')).toHaveCount(0);
      await page.waitForTimeout(1500);
      await shot(page, '08-duel');
    });
  });
}
