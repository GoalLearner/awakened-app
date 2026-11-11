/**
 * Awakened — battle FX from the free asset packs (W1188).
 *
 * Owner 2026-11-11: "Are there assets online that could change the battle graphics" → the packs were downloaded →
 * "Yes do all of them". Pinned here:
 *   - every file the effects name ships and loads: 28 Kenney particles, 11 LottieFiles effects (valid Lottie JSON),
 *     and the Lottie player (lib/lottie_light.min.js), which loads when a fight's stage mounts;
 *   - a real hit in a fight mounts the family's particle at the foe, tinted; a crit adds the shockwave ring;
 *   - each ultimate lands with its element at its blow: Hellfire's fire pillar in a real fight, Storm of Blades'
 *     lightning in the Preview, Dawnbreaker's gold ward on the hunter, every ultimate has one;
 *   - reduced motion: no Lottie, the particles only fade;
 *   - Settings › Help & About › Credits & licenses names the artists and carries both license texts.
 *
 * BFX_SHOTS=<dir> saves phone-size screenshots for the owner.
 */
import { test, expect, Page } from '@playwright/test';

const SHOTS = process.env.BFX_SHOTS || '';
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
      if (sessionStorage.getItem('__bfx')) return; sessionStorage.setItem('__bfx', '1');
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
      if (!a || a.__bfxPatched) return;
      a.__bfxPatched = true;
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
  await page.waitForFunction(() => !!(window as any).Arena && !!(window as any).__bfx && !!document.querySelector('[data-tab="profile"]'));
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
const allReady = (page: Page) => page.evaluate(() => { const s = (window as any).__bfx.state(); return s.lib === 'ready' && Object.values(s.json).every((v) => v === 'ready'); });
const OWN_ALL = JSON.stringify(['feast', 'quicksilver', 'hellfire', 'storm', 'worldbreaker', 'reaper', 'arise', 'dawnbreaker']);

test.use({ viewport: { width: 390, height: 844 } });

test.describe('W1188 — battle FX from the free packs', () => {
  test('every file the effects name ships and loads: 28 particles, 11 Lottie effects, the player', async ({ page }) => {
    await boot(page, 37);
    const r = await page.evaluate(async () => {
      const B = (window as any).__bfx, out: string[] = [];
      for (const n of B.png) { const res = await fetch('assets/fx/k-' + n + '.png'); if (!res.ok || !/image\/png/.test(res.headers.get('content-type') || '')) out.push('png ' + n); }
      for (const id of B.files) { const res = await fetch('assets/fx/lottie/' + id + '.json'); let ok = res.ok; try { const j = await res.json(); ok = ok && j.w > 0 && j.h > 0 && Array.isArray(j.layers) && j.op > j.ip; } catch (_) { ok = false; } if (!ok) out.push('lottie ' + id); }
      const lib = await fetch('lib/lottie_light.min.js'); if (!lib.ok) out.push('lib');
      // every family's shapes and every ultimate's element name a shipped file
      Object.values(B.fam).forEach((f: any) => f.main.concat(f.acc).forEach((n: string) => { if (B.png.indexOf(n) < 0) out.push('fam ' + n); }));
      Object.keys(B.ult).forEach((u) => B.ult[u].forEach((o: any) => { if (B.files.indexOf(o.id) < 0) out.push('ult ' + u + ' ' + o.id); }));
      return { bad: out, ults: Object.keys(B.ult).sort() };
    });
    expect(r.bad).toEqual([]);
    expect(r.ults).toEqual(['arise', 'dawnbreaker', 'feast', 'hellfire', 'quicksilver', 'rain', 'reaper', 'starfall', 'storm', 'verdict', 'worldbreaker']);   // every ultimate, the three Signatures too
    expect(await page.evaluate(() => (window as any).__bfx.state().lib)).toBe('');   // nothing loads before a fight
  });

  test('a real hit mounts the family\'s particle at the foe, tinted; a crit adds the shockwave ring', async ({ page }) => {
    await boot(page, 37);
    await intoFight(page, 37);
    await expect.poll(() => allReady(page), { timeout: 15_000 }).toBe(true);   // the fight's stage loaded the player and the files
    // the next exchange lands without a crit
    await page.evaluate(() => { const s = (window as any).Arena._live.sess(); s.rng = () => 0.5; });
    await page.locator('#arena-body .ar-bmoves:not(.lock) [data-ar="move"]').first().click();
    const p = page.locator('#pkb-stage .bfx-layer .bfx-p.bfx-main').first();
    await expect(p).toBeAttached({ timeout: 8000 });
    const look = await p.evaluate((el) => ({ tint: getComputedStyle(el).getPropertyValue('--c').trim(), mask: (el.querySelector('b') as HTMLElement).style.webkitMaskImage || (el.querySelector('b') as HTMLElement).style.maskImage }));
    expect(look.tint).toMatch(/^#/);
    expect(look.mask).toMatch(/assets\/fx\/k-[a-z]+_\d+\.png/);
    // a crit, straight through the hook: a second slash, a ring and the Lottie shockwave
    await page.evaluate(() => (window as any).__bfx.hit({ gl: 'sword', crit: true }, 'b', false));
    await expect(page.locator('#pkb-stage .bfx-layer .bfx-ring')).toHaveCount(1);
    await expect(page.locator('#pkb-stage .bfx-layer [data-bfx="poof"] svg')).toHaveCount(1);
    await page.waitForTimeout(90);
    await shot(page, 'bfx-01-crit');
    // a killing blow on the foe gets the boom; the particles clean themselves up
    await page.evaluate(() => (window as any).__bfx.hit({ gl: 'magic' }, 'b', true));
    await expect(page.locator('#pkb-stage [data-bfx="explosion-anisimov"]')).toHaveCount(1);
    await page.waitForTimeout(150);
    await shot(page, 'bfx-02-ko-boom');
    await expect(page.locator('#pkb-stage .bfx-layer .bfx-p')).toHaveCount(0, { timeout: 4000 });
    await expect(page.locator('#pkb-stage .bfx-layer .bfx-lot')).toHaveCount(0, { timeout: 6000 });
  });

  test('Hellfire in a real fight: its fire pillar rises at the foe with the blow', async ({ page }) => {
    await boot(page, 37, { hb_dev_ults: '1', hb_ult_owned: OWN_ALL, hb_ult_choice: 'hellfire' });
    await intoFight(page, 37);
    await expect.poll(() => allReady(page), { timeout: 15_000 }).toBe(true);
    await page.evaluate(() => { const s = (window as any).Arena._live.sess(); s._surge = 1; s.rng = () => 0.5; (window as any).Arena._live.paint(); });
    await page.locator('#pkb-surge').click();
    const fire = page.locator('#pkb-stage [data-bfx="fire-element"]');
    await expect(fire).toHaveCount(1, { timeout: 12_000 });
    await page.waitForTimeout(250);
    await shot(page, 'bfx-03-hellfire');
    // it sits on the foe's side of the stage
    const pos = await page.evaluate(() => { const f = document.querySelector('#pkb-stage [data-bfx="fire-element"]')!.getBoundingClientRect(), b = document.getElementById('pkb-spot-b')!.getBoundingClientRect(); return Math.abs((f.left + f.width / 2) - (b.left + b.width / 2)); });
    expect(pos).toBeLessThan(40);
  });

  test('the Preview plays each element too: Storm of Blades\' lightning on the foe, Dawnbreaker\'s gold ward on the hunter', async ({ page }) => {
    await boot(page, 50, { hb_dev_ults: '1', hb_ult_owned: OWN_ALL });
    await page.evaluate(() => (window as any).__ultPreview.open('storm'));
    await expect.poll(() => allReady(page), { timeout: 15_000 }).toBe(true);
    await page.locator('.ult-pv [data-pv="again"]').click();   // replay now that the files are in
    await expect(page.locator('.ult-pv [data-bfx="thunder-element"]')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(200);
    await shot(page, 'bfx-04-storm-preview');
    await page.locator('.ult-pv [data-pv="x"]').click();
    await page.evaluate(() => (window as any).__ultPreview.open('dawnbreaker'));
    const glow = page.locator('.ult-pv [data-bfx="golden-glow"]');
    await expect(glow).toHaveCount(1, { timeout: 10_000 });
    const d = await page.evaluate(() => { const g = document.querySelector('.ult-pv [data-bfx="golden-glow"]')!.getBoundingClientRect(), p = document.querySelector('.ult-pv #pkb-spot-p')!.getBoundingClientRect(); return Math.abs((g.left + g.width / 2) - (p.left + p.width / 2)); });
    expect(d).toBeLessThan(40);   // on the hunter: a ward is worn, not thrown
    await page.waitForTimeout(250);
    await shot(page, 'bfx-05-dawnbreaker-preview');
  });

  test('reduced motion: no Lottie, the particles only fade', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, 37);
    await intoFight(page, 37);
    await expect.poll(() => allReady(page), { timeout: 15_000 }).toBe(true);
    expect(await page.evaluate(() => (window as any).__bfx.lottie('poof', 'b', {}))).toBeNull();
    await page.evaluate(() => (window as any).__bfx.hit({ gl: 'sword', crit: true }, 'b', true));
    await expect(page.locator('#pkb-stage .bfx-layer .bfx-p').first()).toBeAttached();
    expect(await page.locator('#pkb-stage .bfx-lot').count()).toBe(0);
    expect(await page.locator('#pkb-stage .bfx-layer .bfx-p').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('bfx-fade');
  });

  test('Settings › Credits & licenses names every artist and carries both license texts', async ({ page }) => {
    await boot(page, 37);
    await page.evaluate(() => (document.getElementById('settings-btn') as HTMLElement).click());
    await page.evaluate(() => (document.getElementById('settings-credits') as HTMLElement).click());
    const sh = page.locator('#credits-sheet');
    await expect(sh).toHaveClass(/cr-open/);
    await expect(sh.locator('.cr-h')).toHaveText('Credits & licenses');
    await expect(sh).toContainText('Particle Pack by Kenney');
    await expect(sh.locator('.cr-list li')).toHaveCount(11);
    for (const who of ['Zoro', 'Vinzenz', 'MRouquin', 'Viktor Anisimov', 'SMNV', 'Milad Ghiravani', 'Souvik Sur', 'Whitesushi', 'Nareswara Widito', 'Ladon Sklyarov']) await expect(sh.locator('.cr-list')).toContainText(who);
    await expect(sh.locator('details.cr-d')).toHaveCount(2);
    await expect(sh.locator('details.cr-d').nth(0)).toContainText('Lottie Simple License (FL 9.13.21)');
    await expect(sh.locator('details.cr-d').nth(1)).toContainText('Copyright (c) 2015 Bodymovin');
    await page.waitForTimeout(450);
    await shot(page, 'bfx-06-credits');
    await sh.locator('.cr-x').click();
    await expect(page.locator('#credits-sheet')).toHaveCount(0, { timeout: 2000 });
  });
});
