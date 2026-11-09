/**
 * Awakened — the name's ink on the high scores (W1147; W1146 publishes card_ink on every board row).
 *
 * Owner 2026-11-07, after wearing the Teal ink: "Is it possible to have that color change also apply to
 * high scores?" Pinned here on a stubbed Steps board:
 *   - a row's published card_ink paints its name: a solid ink in its colour, a gradient ink with the sweep class;
 *   - the own row reads the LOCAL equip (instant), not the published value;
 *   - a row without an ink, or with an unknown one, stays the plain name.
 */
import { test, expect, Page } from '@playwright/test';

const SHOTS = process.env.LB_SHOTS || '';
const row = (rank: number, alias: string, steps: number, ink?: string | null) => ({ rank, alias, current_value: steps, card_ink: ink ?? null });

async function boot(page: Page) {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed',
      'hb_tour_quests_v1', 'hb_tour_items_v1', 'hb_tour_stats_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1',
    ].forEach((k) => localStorage.setItem(k, '1'));
    localStorage.setItem('hb_habits', '[]');
    localStorage.setItem('hb_whats_new_seen', '99.99.99');
    localStorage.setItem('hb_card_ink', 'frost');   // what THIS phone wears
  });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

async function openBoard(page: Page, result: unknown) {
  await page.evaluate((res) => {
    const A = (window as any).Auth;
    A.fetchLeaderboardTop = async () => res;
    A.fetchLastWeekSteps = async () => ({ ok: true, champion: null, me: null, records: [] });
    A.fetchStep100kClub = async () => ({ ok: true, members: [] });
    A.fetchLeaderboardArchive = async (week: string) => ({ ok: true, week, records: [], me: null, weeksAvailable: [week] });
    (window as any).openLeaderboardRanking('step_total');
  }, result);
  await expect(page.locator('#lb-rank-sheet')).toBeVisible();
}

const rgb = (hex: string) => { const n = parseInt(hex.replace('#', ''), 16); return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')'; };

test.describe('W1147 — the name in its ink on the Steps board', () => {
  test('published inks paint the names; the own row follows the local equip; plain rows stay plain', async ({ page }) => {
    await boot(page);
    const me: string = await page.evaluate(() => { const u = (window as any).Auth.getCurrentUser(); return (u && u.alias) || 'DevUser'; });   // what lbGetMyAlias() reads
    await openBoard(page, { ok: true, final: false, week: null, top: [row(1, 'Alpha', 92297, 'dawn'), row(2, 'Beta', 50426, 'teal'), row(3, me, 40000, 'teal'), row(4, 'Gamma', 30000), row(5, 'Delta', 20000, 'neon')], me: { rank: 3, current_value: 40000 } });
    const inks = await page.evaluate(() => { const o: Record<string, string> = {}; (window as any).__wxSlot.items('ink').forEach((i: any) => { o[i.id] = i.css || ''; }); return o; });
    const sheet = page.locator('#lb-rank-sheet');
    // the leader wears the Dawn gradient (class, no solid colour)
    const leader = sheet.locator('.lb-rank-leader-name .lb-ink');
    await expect(leader).toHaveCount(1);
    await expect(leader).toHaveClass(/wx-ink-g/);
    await expect(leader).toHaveText(/alpha/i);   // names display as typed, lowercased by the board's display rule
    // Beta's published Teal
    const beta = sheet.locator('.lb-rank-row').filter({ hasText: 'Beta' }).locator('.lb-rank-name .lb-ink');
    await expect(beta).toHaveClass(/wx-ink-s/);
    expect(await beta.evaluate((el) => getComputedStyle(el).color)).toBe(rgb(inks.teal));
    // the own row: the phone wears Frost, the server still says Teal → Frost
    const mine = sheet.locator('.lb-rank-row--me .lb-rank-name .lb-ink');
    await expect(mine).toHaveCount(1);
    expect(await mine.evaluate((el) => getComputedStyle(el).color)).toBe(rgb(inks.frost));
    // Gamma (no ink) and Delta (unknown id) are plain
    await expect(sheet.locator('.lb-rank-row').filter({ hasText: 'Gamma' }).locator('.lb-ink')).toHaveCount(0);
    await expect(sheet.locator('.lb-rank-row').filter({ hasText: 'Delta' }).locator('.lb-ink')).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/board-ink.png' });
  });

  // W1172 — owner 2026-11-09 (Galilea's row, iPhone): her name looked cut off by the 100-kill stamp under it. The name
  // clips its overflow for the ellipsis, and at line-height 1.05 the iPhone font's descenders (the g) hung below the
  // line box and were sliced flat. The line box must hold a descender: at least 1.2 em.
  test("a row name's line box holds its descenders (Galilea's g under her kill stamp)", async ({ page }) => {
    await boot(page);
    await openBoard(page, { ok: true, final: false, week: null, top: [row(1, 'justin', 14223), Object.assign(row(2, 'galilea', 9028, 'violet'), { bosses_slain: 102 }), row(3, 'giorgio', 14)], me: null });
    const m = await page.evaluate(() => Array.from(document.querySelectorAll('#lb-rank-sheet .lb-rank-row .lb-rank-id .lb-rank-name')).map((el) => { const cs = getComputedStyle(el); return { t: (el.textContent || '').trim(), lh: parseFloat(cs.lineHeight), fs: parseFloat(cs.fontSize), h: el.getBoundingClientRect().height }; }));
    const gal = m.find((x) => /galilea/i.test(x.t));
    expect(gal).toBeTruthy();
    for (const x of m) { expect(x.lh / x.fs).toBeGreaterThanOrEqual(1.2); expect(x.h).toBeGreaterThanOrEqual(x.fs * 1.2 - 0.5); }
    await expect(page.locator('#lb-rank-sheet .lb-rank-row').filter({ hasText: 'galilea' }).locator('.lb-rank-boss100')).toHaveCount(1);
  });
});
