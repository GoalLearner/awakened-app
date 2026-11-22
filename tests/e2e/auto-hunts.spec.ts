/**
 * Awakened — Auto Hunts (W1268 server, W1269 app).
 *
 * Owner 2026-11-21: the Claude Design "Auto Hunts" handoff (way in A, the status row; "Make sure no emoji"), then
 * "DO it all ... obviously allow users to manage how they please but yeah make the automation geared toward items
 * they still want/need/achievements/backgrounds anything not discovered yet". Pinned here:
 *   - Your Hunts: the status row (targets / auto / warning) and the reason tags; line icons, no emoji;
 *   - the manager: mode switch, targets, partners (the W1094 switch, moved here), match + raid, the Tomorrow
 *     preview in the server's order (both want > whose turn > own > Auto);
 *   - the picker: eligibility, a locked boss never opens, Chase a drop, the swap sheet at three;
 *   - Chase this on the co-op boss sheet.
 */
import { test, expect, Page } from '@playwright/test';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

const PREFS = {
  ok: true, mode: 'targets', match: true, raid: true, rank: 'B', walking: true, day: '2026-11-22', max: 3,
  targets: [{ b: 'the_hollow_monarch', d: 'the_hollow_crown' }, { b: 'the_gaunt_wardens', d: 'any' }],
  partners: [
    { id: 'u-oriel', alias: 'Oriel', rank: 'A', on: true, their_off: false, walking: true, targets: ['the_hollow_monarch'], turn: 'me' },
    { id: 'u-thane', alias: 'Thane', rank: 'C', on: true, their_off: false, walking: true, targets: ['the_coursing_dread'], turn: 'them' },
    { id: 'u-vey', alias: 'Vey', rank: 'E', on: true, their_off: false, walking: true, targets: [], turn: 'me' },
  ],
  eligible: {
    the_hollow_monarch: ['u-oriel'], the_gaunt_wardens: ['u-oriel', 'u-thane'], the_coursing_dread: ['u-oriel', 'u-thane', 'u-vey'],
    the_twin_maw: ['u-oriel', 'u-thane', 'u-vey'], the_sundered_choir: [],
    the_trinity_colossus: [], the_triune_sentinel: ['u-oriel', 'u-thane'], the_threefold_court: [], the_crossroads_hound: ['u-oriel', 'u-thane', 'u-vey'],
  },
};

async function boot(page: Page, prefs: Record<string, unknown> = PREFS) {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const st = document.createElement('style'); st.id = 'e2e-splash-kill'; st.textContent = css; root.appendChild(st); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      if (sessionStorage.getItem('__ah')) return; sessionStorage.setItem('__ah', '1');
      ['hb_onboarding_seen_v2', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_bosses_engagement_migrated', 'hb_welcomed'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_name', 'Richie');
      localStorage.setItem('hb_habits', JSON.stringify([{ id: 'ah-read', name: 'Read', emoji: '•', difficulty: 'easy', type: 'build' }]));
      const d = new Date();
      localStorage.setItem('hb_daily_insight_last_shown', d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
    } catch (_) { /* noop */ }
  });
  await page.goto('/');
  await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  await page.evaluate((p) => {
    const A = (window as any).Auth;
    (window as any).__ahPuts = [];
    let cur = JSON.parse(JSON.stringify(p));
    A.getBackendUserId = () => 'me';
    A.coopAutoPrefs = async () => JSON.parse(JSON.stringify(cur));
    A.coopAutoPrefsSave = async (body: Record<string, unknown>) => { (window as any).__ahPuts.push(body); cur = { ...cur, ...body }; return JSON.parse(JSON.stringify(cur)); };
    A.coopAutoOptOut = async (id: string) => ({ ok: true, auto_off: [id] });
    A.coopAutoOptIn = async () => ({ ok: true, auto_off: [] });
    try { localStorage.removeItem('hb_auto_prefs_v1'); } catch (_) { /* noop */ }
  }, prefs);
}

const H = 3_600_000;
function hunt(id: string, boss: string, partner: string, partnerId: string, reason?: string[]) {
  const now = Date.now();
  return {
    id, boss_id: boss, boss_rank: 'C', status: 'active', auto: true, goal_steps: 8000, combined_steps: 4976,
    starts_at: new Date(now - 4 * H).toISOString(), ends_at: new Date(now + 7 * H).toISOString(), time_remaining_ms: 7 * H,
    party: [{ user_id: 'me', alias: 'Richie' }, { user_id: partnerId, alias: partner }], ...(reason ? { reason } : {}),
  };
}

test.describe('W1269 — Auto Hunts', () => {
  test('Your Hunts: the status row and the reason tags; no emoji', async ({ page }) => {
    await boot(page);
    await page.evaluate(async (list) => { const ah = (window as any).__autoHunts; await ah.load(); ah.setCoop(list); ah.list(); }, [
      hunt('h1', 'the_hollow_monarch', 'Oriel', 'u-oriel', ['me']),
      hunt('h2', 'the_coursing_dread', 'Thane', 'u-thane', ['u-thane']),
      hunt('h3', 'the_twin_maw', 'Vey', 'u-vey'),
    ]);
    const sheet = page.locator('.hunt-list-sheet');
    const row = sheet.locator('.ah-status');
    await expect(row).toHaveClass(/tgt/);
    await expect(row).toContainText('Chasing: The Hollow Monarch');
    await expect(row).toContainText('+1');
    await expect(row).toContainText(/Change/i);
    await expect(row.locator('svg')).toHaveCount(2);   // the reticle and the chevron: line icons
    await expect(sheet.locator('.ah-tag.mine')).toHaveText(/Your target/i);
    await expect(sheet.locator('.ah-tag.theirs')).toHaveText(/Thane needs this drop/i);
    await expect(sheet.locator('.ah-tag')).toHaveCount(2);   // none on the Auto pick
    expect(EMOJI.test(await row.innerText())).toBe(false);
  });

  test('the manager: preview in the server order, partners, mode switch saves', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => { const ah = (window as any).__autoHunts; await ah.load(); ah.open(); });
    const m = page.locator('#ah-overlay');
    await expect(m.locator('.ah-scr:not(.out) .ah-top h1')).toHaveText(/Auto Hunts/i);
    await expect(m.locator('.ah-scr:not(.out) .ah-tc')).toHaveCount(2);
    await expect(m.locator('.ah-scr:not(.out) .ah-tc').first()).toContainText('Chasing The Hollow Crown');
    await expect(m.locator('.ah-scr:not(.out) .ah-tc').first()).toContainText(/Eligible with: oriel/i);
    await expect(m.locator('.ah-prow[data-on]')).toHaveCount(3);
    const pv = m.locator('[data-ah-r="preview"] .ah-pv');
    await expect(pv).toHaveCount(4);   // Oriel, Thane, Vey, the raid draw
    await expect(pv.nth(0)).toContainText(/oriel · The Hollow Monarch/i);
    await expect(pv.nth(0)).toContainText(/Your target · oriel wants it too/i);
    await expect(pv.nth(1)).toContainText(/thane · The Coursing Dread/i);
    await expect(pv.nth(1)).toContainText(/thane’s turn: their target/i);
    await expect(pv.nth(2)).toContainText(/vey · chosen at midnight/i);
    await expect(pv.nth(3)).toContainText('Raid team · The Grinning God');
    expect(EMOJI.test(await m.innerText())).toBe(false);
    // a partner off: their row greys and leaves the preview
    await m.locator('[data-ah-act="partner:u-vey"]').click();
    await expect(m.locator('.ah-prow[data-on="0"]')).toContainText('Off: no daily hunts together');
    await expect(pv).toHaveCount(3);
    // Auto: the targets fold into one line, kept; the save goes up
    await m.locator('[data-ah-act="mode:auto"]').click();
    await expect(m.locator('.ah-calm').first()).toContainText('never beaten');
    await expect(m.locator('.ah-calm').first()).toContainText('Your 2 targets are kept.');
    await expect.poll(() => page.evaluate(() => (window as any).__ahPuts.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).__ahPuts.slice(-1)[0].mode)).toBe('auto');
    await m.locator('[data-ah-act="back"]').click();
    await expect(page.locator('#ah-overlay')).toHaveCount(0);
  });

  test('the picker: a locked boss never opens; chase a drop; the swap sheet at three', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => { const ah = (window as any).__autoHunts; await ah.load(); ah.open(); });
    const m = page.locator('#ah-overlay');
    await m.locator('.ah-scr:not(.out) [data-ah-act="add"]').click();
    await expect(m.locator('.ah-scr:not(.out) .ah-top h1')).toHaveText(/Add a target/i);
    const choir = m.locator('.ah-scr:not(.out) .ah-pk.lock', { hasText: 'The Sundered Choir' });
    await expect(choir).toContainText('No current partner can run this yet');
    await choir.locator('.hd').click({ force: true });   // aria-disabled on purpose: a tap only nudges it
    await expect(choir).toHaveAttribute('data-open', '0');
    const maw = m.locator('.ah-scr:not(.out) .ah-pk', { hasText: 'The Twin Maw' });
    await expect(maw).toContainText('Eligible with: all 3 partners');
    await maw.locator('.hd').click();
    await expect(maw).toHaveAttribute('data-open', '1');
    await maw.locator('.ah-dr', { hasText: 'Twin-Fang Cleaver' }).locator('[data-ah-act^="chase:"]').click();
    await expect(m.locator('.ah-scr:not(.out) .ah-top h1')).toHaveText(/Auto Hunts/i, { timeout: 4000 });   // the picker pops
    await expect(m.locator('.ah-scr:not(.out) .ah-tc')).toHaveCount(3);
    await expect(m.locator('.ah-scr:not(.out) .ah-add')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ((window as any).__ahPuts.slice(-1)[0] || {}).targets?.length)).toBe(3);
    // a fourth: the swap sheet
    await m.locator('.ah-scr:not(.out) [data-ah-act="edit:the_gaunt_wardens"]').click();
    const dread = m.locator('.ah-scr:not(.out) .ah-pk', { hasText: 'The Coursing Dread' });
    await dread.locator('.hd').click();
    await dread.locator('.ah-any').click();
    const sheet = page.locator('#ah-sheet-ov');
    await expect(sheet.locator('h3')).toHaveText(/Three targets set/i);
    await sheet.locator('[data-ah-act="swap:the_twin_maw"]').click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ((window as any).__ahPuts.slice(-1)[0] || {}).targets.map((t: { b: string }) => t.b).join(','))).toContain('the_coursing_dread');
  });

  test('a target nobody can run: the warning on the status row and the card', async ({ page }) => {
    await boot(page, { ...PREFS, eligible: { ...PREFS.eligible, the_hollow_monarch: [] } });
    await page.evaluate(async () => { const ah = (window as any).__autoHunts; await ah.load(); ah.setCoop([]); ah.list(); });
    const row = page.locator('.hunt-list-sheet .ah-status');
    await expect(row).toHaveClass(/warn/);
    await expect(row).toContainText('No partner can run The Hollow Monarch right now');
    await row.click();
    const card = page.locator('#ah-overlay .ah-tc.stale');
    await expect(card).toContainText('No partner can run this right now');
    await expect(card).toContainText('Its hunts fall back to Auto.');
  });

  test('Chase this on the co-op boss sheet', async ({ page }) => {
    await boot(page, { ...PREFS, targets: [] });
    await page.evaluate(async () => { await (window as any).__autoHunts.load(); (window as any).openCoopSheet('the_coursing_dread'); });
    const box = page.locator('[data-ah-coop="the_coursing_dread"]');
    await expect(box.locator('.ah-btn1')).toHaveText(/Chase this boss/i, { timeout: 8000 });
    await box.locator('.ah-btn1').click();
    await expect(page.locator('[data-ah-coop="the_coursing_dread"] .ah-chasing')).toContainText(/Chasing/i);
    await expect.poll(() => page.evaluate(() => ((window as any).__ahPuts.slice(-1)[0] || {}).mode)).toBe('targets');
  });

  // W1274 — owner 2026-11-22: "add all the common drops to the twin maw ... trio bosses...tap for drops for them as well ...
  // I wish I had the options of the ones that I haven't completed yet."
  test('the Twin Maw drops every common; trio bosses open their drops; bosses still to complete come first', async ({ page }) => {
    await boot(page);
    const facts = await page.evaluate(() => {
      const src = (window as any).__relicSources('vow_ring') as string[];
      return { src };
    });
    expect(facts.src).toContain('The Twin Maw');
    await page.evaluate(async () => { const ah = (window as any).__autoHunts; await ah.load(); ah.open([{ name: 'manager' }, { name: 'picker', open: 'the_twin_maw' }]); });
    const cur = page.locator('#ah-overlay .ah-scr:not(.out)');
    const maw = cur.locator('.ah-pk', { hasText: 'The Twin Maw' });
    await expect(maw).toHaveAttribute('data-open', '1');
    await expect(maw.locator('.ry.common').first()).toHaveText(/Common/i);
    expect(await maw.locator('.ah-dr').count()).toBeGreaterThan(30);   // 3 weapons + every common
    const sentinel = cur.locator('.ah-pk', { hasText: 'The Triune Sentinel' });
    await sentinel.locator('.hd').click();
    await expect(sentinel).toHaveAttribute('data-open', '1');
    expect(await sentinel.locator('.ah-dr').count()).toBeGreaterThan(5);
    await expect(sentinel.locator('.ah-ch').first()).toHaveText(/Chase/i);
  });
});
