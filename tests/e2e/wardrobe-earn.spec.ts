/**
 * Awakened — the two-tab Wardrobe and earned top-tier skins (W1098), client side.
 *
 * Owner 2026-10-26: the seven top-tier skins are earned by milestones, not sold; every card
 * background is free; the Wardrobe is two tabs (LOOKS · BACKGROUNDS) with the seven up front and
 * a locked skin opens its condition; earning one plays the celebration from Claude Design.
 * These specs pin:
 *   - the sheet: tabs, the seven, a locked tap opens the condition, an owned tap wears it;
 *   - a background is worn without membership;
 *   - the phone claims a milestone its own numbers meet, and never The Verdant Oracle;
 *   - a server grant plays the celebration once, EQUIP wears it, and the launch-time auto-equip
 *     (W1032) never puts it on by itself;
 *   - LATER holds the rest back; day one stays quiet;
 *   - first run: a member hears nothing about backgrounds, anyone else at most four.
 *
 * Auth is stubbed through a setter trap on window.Auth (auth.js assigns it once).
 */
import { test, expect, Page } from '@playwright/test';

interface Fx {
  member?: boolean;
  founderSeq?: number;
  owned?: string[];
  granted?: string[];
  progress?: { opened?: { best: number; current: number }; flame?: { best: number } };
  firstDay?: boolean;
  bgSeen?: string[] | null;
  owner?: boolean;
}

async function boot(page: Page, fx: Fx) {
  await page.addInitScript((f: Fx) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) {
        const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s);
      }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      if (!f.firstDay) localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_skins_owned_cache', JSON.stringify({ skins: f.owned || [], at: Date.now() }));
      if (f.bgSeen !== null) localStorage.setItem('hb_earn_bg_seen_v1', JSON.stringify(f.bgSeen || []));
      if (f.owner) localStorage.setItem('hb_board_cache_v1', JSON.stringify({ me: { role: 'owner' } }));
    } catch (_) { /* noop */ }
    const calls = { earn: [] as string[][] };
    (window as any).__earnCalls = calls;
    (window as any).__earnFx = f;
    const patch = (a: any) => {
      if (!a || a.__w1098Patched) return;
      a.__w1098Patched = true;
      a.getBackendUserId = () => 'me';
      a.isMember = () => !!f.member;
      a.founderSeq = () => f.founderSeq || 0;
      a.fetchEntitlements = async () => ({ ok: true, skins: f.owned || [], premium: false, member: !!f.member });
      a.earnSkins = async (claims: string[]) => {
        calls.earn.push(claims);
        const granted = (f.granted || []).filter((id) => !(f.owned || []).includes(id));
        f.owned = Array.from(new Set([...(f.owned || []), ...granted]));
        f.granted = [];
        return { ok: true, skins: f.owned, granted, progress: f.progress || { opened: { best: 3, current: 3 }, flame: { best: 0 } } };
      };
    };
    let real: any;
    Object.defineProperty(window, 'Auth', {
      configurable: true,
      get() { return real; },
      set(v) { real = v; try { patch(v); } catch (_) { /* noop */ } },
    });
  }, fx);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

const VOID = 'avatar-skin-voidtouched.png', VERDANT = 'avatar-skin-verdant.png', DAWN = 'avatar-skin-dawnbringer.png';
// Taps on an empty strip of the celebration (the bottom of its 390 × 844 stage).
async function tapStage(page: Page, n = 1) {
  const vp = page.viewportSize()!;
  for (let i = 0; i < n; i++) { await page.mouse.click(vp.width / 2, vp.height - 12); await page.waitForTimeout(320); }
}

test.describe('The Wardrobe, two tabs (W1098)', () => {
  test('the seven up front; a locked one opens its condition; an owned one is worn', async ({ page }) => {
    await boot(page, { owned: [VOID] });
    await page.evaluate(() => (window as any).__openWardrobe());
    const sh = page.locator('#wd-sheet');
    await expect(sh.locator('.wx-tab')).toHaveCount(2);
    await expect(sh.locator('.wx-seven:not(.wx-rising) .wx-sk')).toHaveCount(7);   // W1105 — the Rising's nine sit below
    await expect(sh.locator('.wx-rising .wx-sk')).toHaveCount(9);
    await expect(sh.locator('.wx-sec-h em').first()).toHaveText('1');
    await expect(sh.locator('[data-sk="voidtouched"] .wx-sk-st')).toHaveText('EARNED');
    // locked → the condition, not a shop
    await sh.locator('[data-sk="stardust"]').click();
    await expect(sh.locator('.wx-dt.open .wx-ms-c').nth(5)).toHaveText('Walk 1,000,000 steps');
    expect(await page.evaluate(() => (window as any).__wx.state())).toMatchObject({ detail: 'sk', pages: 15 });   // 6 of the seven + the Rising's 9 (W1105)
    await sh.locator('.wx-dt-x').click();
    await expect(sh.locator('.wx-dt.open')).toHaveCount(0);
    // owned → worn
    await sh.locator('[data-sk="voidtouched"]').click();
    await expect(sh.locator('[data-sk="voidtouched"] .wx-sk-st')).toHaveText('WORN');
    expect(await page.evaluate(() => localStorage.getItem('hb_avatar_skin'))).toBe(VOID);
    // a free look
    await sh.locator('[data-lk="avatar-mage.png"]').click();
    expect(await page.evaluate(() => localStorage.getItem('hb_avatar_skin'))).toBe('avatar-mage.png');
    await sh.locator('#wd-close').click();
    await expect(sh).toBeHidden();
  });

  test('a background is worn without membership', async ({ page }) => {
    await boot(page, { member: false, founderSeq: 3 });
    await page.evaluate(() => (window as any).__openWardrobe());
    const sh = page.locator('#wd-sheet');
    await sh.locator('.wx-tab[data-tab="bgs"]').click();
    await expect(sh.locator('.wx-bt.basic .wx-bt-st')).toHaveText('WORN');
    await expect(sh.locator('[data-bg="bg-founder"]')).toHaveClass(/is-earned/);
    await sh.locator('[data-bg="bg-founder"]').click();
    await expect(sh.locator('[data-bg="bg-founder"]')).toHaveClass(/is-worn/);
    expect(await page.evaluate(() => (window as any).__wx.state().bg)).toBe('bg-founder');
    // a locked one explains itself instead
    await sh.locator('[data-bg="bg-floor100"]').click();
    await expect(sh.locator('.wx-dt.open .wx-ms-c').first()).toHaveText('Clear Floor 100 of the Ascent');
  });
});

test.describe('Earned skins (W1098)', () => {
  test('the phone claims what its numbers meet, never The Verdant Oracle', async ({ page }) => {
    await boot(page, { owned: [] });
    const claims = await page.evaluate(() => {
      const w = window as any;
      const ex: Record<string, unknown> = {};
      for (let i = 0; i < 10; i++) ex['boss_' + i] = { at: 1, name: 'b' + i };
      localStorage.setItem('hb_shadows_v1', JSON.stringify({ extracted: ex, active: [] }));
      localStorage.setItem('hb_earn_progress_v1', JSON.stringify({ opened: 45, flame: 0 }));
      return w.__earn.claims();
    });
    expect(claims).toEqual([VOID]);
  });

  test('a server grant plays once; EQUIP wears it; W1032 never puts it on by itself', async ({ page }) => {
    await boot(page, { owned: [], granted: [VERDANT], progress: { opened: { best: 30, current: 30 }, flame: { best: 0 } } });
    await page.evaluate(() => (window as any).__earn.tick(true));
    await expect(page.locator('#earn-ce')).toBeVisible({ timeout: 5000 });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_skins_worn_v1') || '[]'))).toContain(VERDANT);
    expect(await page.evaluate(() => localStorage.getItem('hb_wx_new_v1'))).toBe(VERDANT);
    await page.waitForTimeout(900);
    await tapStage(page, 3);
    await expect(page.locator('#earn-ce .ex-t-n')).toHaveText('The Verdant Oracle');
    await page.locator('#earn-ce .ex-acts.on .ex-b-eq').click({ timeout: 6000 });
    await page.waitForTimeout(1700);
    await tapStage(page, 1);
    await expect(page.locator('#earn-ce')).toHaveCount(0, { timeout: 4000 });
    expect(await page.evaluate(() => localStorage.getItem('hb_avatar_skin'))).toBe(VERDANT);
    expect(await page.evaluate(() => (window as any).__earn.pending())).toEqual([]);
    // the next entitlement refresh sees it owned and worn: nothing changes, no "is on" toast
    await page.evaluate(() => localStorage.setItem('hb_avatar_skin', 'avatar-ranger.png'));
    expect(await page.evaluate(async () => { await (window as any).__skins.refresh(); return (window as any).__skins.equipped(); })).toBe('avatar-ranger.png');
  });

  test('LATER: the round closes and the rest waits', async ({ page }) => {
    await boot(page, { owned: [], granted: [VERDANT, DAWN, VOID, 'avatar-skin-stardust.png'] });
    await page.evaluate(() => (window as any).__earn.tick(true));
    await expect(page.locator('#earn-ce .ex-bl-n')).toHaveText('3', { timeout: 5000 });
    // open the three (a tap mid-animation finishes it, the next one moves on), then LATER
    for (let i = 0; i < 40 && !(await page.locator('#earn-ce .ex-acts.on').count()); i++) {
      await page.waitForTimeout(450);
      await tapStage(page, 1);
    }
    await expect(page.locator('#earn-ce .ex-it.open')).toHaveCount(3);
    await page.locator('#earn-ce .ex-acts.on .ex-b-lt').click({ timeout: 6000 });
    await expect(page.locator('#earn-ce')).toHaveCount(0, { timeout: 4000 });
    await page.waitForTimeout(1200);
    await expect(page.locator('#earn-ce')).toHaveCount(0);
    expect((await page.evaluate(() => (window as any).__earn.pending())).length).toBe(1);
  });

  test('day one stays quiet: an earned moment waits', async ({ page }) => {
    await boot(page, { owned: [], granted: [VERDANT], firstDay: true });
    await page.evaluate(() => localStorage.setItem('hb_onboarding_first_xp_date', new Date().toLocaleDateString('en-CA')));
    expect(await page.evaluate(() => (window as any).__newHunterQuiet())).toBe(true);
    await page.evaluate(() => (window as any).__earn.tick(true));
    await page.waitForTimeout(800);
    await expect(page.locator('#earn-ce')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__earn.pending())).toEqual([{ t: 'sk', id: 'verdant' }]);
  });

  test('first run: a member hears nothing about backgrounds; anyone else at most four', async ({ page }) => {
    await boot(page, { member: true, founderSeq: 3, bgSeen: null });
    await page.evaluate(() => (window as any).__earn.tick(true));
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).__earn.pending())).toEqual([]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_earn_bg_seen_v1') || '[]'))).toContain('bg-founder');
  });

  // W1099 — the owner's Settings row plays every flow and saves nothing.
  test('the owner preview: a row in Settings, every flow, nothing saved', async ({ page }) => {
    await boot(page, { owned: [], owner: true });
    await page.evaluate(() => {
      localStorage.setItem('hb_avatar_skin', 'avatar-ranger.png');
      localStorage.setItem('hb_card_bg', '');
    });
    await page.locator('#settings-btn').click();
    await page.locator('.settings-collapsible-lbl', { hasText: 'HELP & ABOUT' }).click();   // the owner rows live in Help & About
    await expect(page.locator('#settings-preview-earn')).toBeVisible({ timeout: 6000 });
    await page.locator('#settings-preview-earn').click();
    // round 1: one skin
    await expect(page.locator('#earn-ce .ex-t-n')).toHaveText('Stardust Sovereign', { timeout: 5000 });
    await page.waitForTimeout(900);
    await tapStage(page, 3);
    await page.locator('#earn-ce .ex-acts.on .ex-b-eq').click({ timeout: 6000 });
    await page.waitForTimeout(1700);
    await tapStage(page, 1);
    // round 2: one background
    await expect(page.locator('#earn-ce .ex-t-n')).toHaveText('Stormbreaker', { timeout: 5000 });
    await page.waitForTimeout(800);
    await tapStage(page, 1);
    await page.locator('#earn-ce .ex-acts.on .ex-b-eq').click({ timeout: 6000 });
    await page.waitForTimeout(900);
    await tapStage(page, 1);
    // round 3: both together — LATER moves on
    await expect(page.locator('#earn-ce .ex-t-n').first()).toHaveText('The Verdant Oracle', { timeout: 5000 });
    for (let i = 0; i < 20 && !(await page.locator('#earn-ce .ex-acts.on').count()); i++) { await page.waitForTimeout(450); await tapStage(page, 1); }
    await page.locator('#earn-ce .ex-acts.on .ex-b-lt').click();
    // round 4: the backlog
    await expect(page.locator('#earn-ce .ex-bl-n')).toHaveText('7', { timeout: 5000 });
    await page.locator('#earn-ce .ex-it').first().waitFor();
    expect(await page.evaluate(() => [localStorage.getItem('hb_avatar_skin'), localStorage.getItem('hb_card_bg')])).toEqual(['avatar-ranger.png', '']);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_skins_worn_v1') || '[]'))).toEqual([]);
  });

  test('first run, not a member: the earned background is handed over', async ({ page }) => {
    await boot(page, { member: false, founderSeq: 3, bgSeen: null });
    await page.evaluate(() => (window as any).__earn.tick(true));
    await expect(page.locator('#earn-ce .ex-t-n')).toHaveText("Founder's Dawn", { timeout: 5000 });
  });
});
