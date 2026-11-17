/**
 * Awakened — duels armed (W1232, W1233).
 *
 * Owner 2026-11-17, sparring a friend's Echo: "When sparring an echo .. make sure that your personal ultimate and
 * special attack and shadows are there as well". He chose both sides armed. The server engine fights with them
 * (backend/src/w1233-duel-ults.test.ts); here: what the app sends, the Surge + UNLEASH in a duel, and the cut-in +
 * mirrored stage when the opponent fires its own.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, init: Record<string, string> = {}) {
  await page.addInitScript((extra) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__duel')) return; sessionStorage.setItem('__duel', '1');
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_ascent_opening_seen_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      Object.keys(extra).forEach((k) => localStorage.setItem(k, extra[k]));
    } catch (_) { /* noop */ }
  }, init);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).Arena && !!(window as any).__pvpDemo && !!document.querySelector('[data-tab="profile"]'));
}

test.describe('Duels armed (W1232 · W1233)', () => {
  test('a duel sends your chosen ultimate, your army and your earned special attack flag', async ({ page }) => {
    await boot(page, { hb_ult_owned: JSON.stringify(['storm']), hb_ult_choice: 'storm' });
    const c = await page.evaluate(() => (window as any).__pvpCombatant());
    expect(c.ultId).toBe('storm');
    expect(typeof c.shadows).toBe('number');
    expect(typeof c.shadowPct).toBe('number');
    expect(typeof c.exeMax).toBe('boolean');
    expect(c.duelUlt).toBe(true);   // the server arms a duel only for apps that show the UNLEASH
  });

  test('the Surge fills in a duel, and a full one is an UNLEASH that submits the ultimate', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).__pvpDemo({ surge: 0.4 }));
    const pill = page.locator('#pkb-surge');
    await expect(pill).toBeVisible();
    await expect(pill.locator('.sv')).toHaveText('40%');
    await expect(pill).not.toHaveClass(/full/);
    await page.evaluate(() => (window as any).__pvpDemo({ surge: 1 }));
    await expect(pill).toHaveClass(/full/);
    await expect(pill).toHaveAttribute('data-move', 'ultimate');
    await expect(pill).not.toHaveClass(/canparry/);
    await expect(pill.locator('.ult .n')).not.toHaveText('');
    await page.evaluate(() => { const w = window as any; w.__sub = null; w.PvP.submit = (_t: number, m: string) => { w.__sub = m; }; });
    await page.waitForTimeout(900);   // the opening line plays before the board takes a tap
    await pill.click();
    await expect.poll(() => page.evaluate(() => (window as any).__sub)).toBe('ultimate');
  });

  test('your ultimate opens on your cut-in; the opponent\'s on theirs, named, and drawn from its side', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).__pvpDemo({ surge: 1, opp: 'Galilea', foeUlt: 'storm' }));
    await page.waitForTimeout(900);
    await page.evaluate(() => (window as any).__pvpDemoTurn('ult'));
    const mine = page.locator('.pkb2-cutin');
    await expect(mine).toHaveCount(1);
    await expect(mine).not.toHaveClass(/foe/);
    await expect(mine.locator('.name .k')).toHaveText(/^ULTIMATE/);
    await expect(page.locator('.pkb2-cutin')).toHaveCount(0, { timeout: 6000 });
    await page.waitForTimeout(4500);   // the turn plays out
    await page.evaluate(() => (window as any).__pvpDemoTurn('foeult'));
    const theirs = page.locator('.pkb2-cutin.foe');
    await expect(theirs).toHaveCount(1);
    await expect(theirs.locator('.name .k')).toHaveText('GALILEA · ULTIMATE · BLADES');
    await expect(theirs.locator('.name .n')).toContainText('Blades');
    // the sequence is composed mirrored: the effect layer flips while the opponent's storm plays
    await expect.poll(() => page.evaluate(() => { const g = document.querySelector('.pkb-mvfx') as HTMLElement | null; return g ? g.style.transform : ''; }), { timeout: 6000 }).toBe('scaleX(-1)');
  });

  test('a duel opponent glows while its Surge is full', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).__pvpDemo({ foeSurge: 1 }));
    await expect(page.locator('#pkb-spot-b')).toHaveClass(/surged/);
    await page.evaluate(() => (window as any).__pvpDemo({ foeSurge: 0.5 }));
    await expect(page.locator('#pkb-spot-b')).not.toHaveClass(/surged/);
  });
});
