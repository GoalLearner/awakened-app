/**
 * Awakened — the boss-kill badge ladder (W1293).
 *
 * Owner 2026-11-23: "I wish it were to be like in COD modern warfare 2 where the badge just gets better every time they
 * prestige... Every 100th kill the badge gets something better ... until 1000 kills", then "maybe some diamonds would be
 * nice" and, of the painted sets, "Set 1, add it". Ten emblems: 100 iron … 1000 the crowned crest; past 1000 the crest
 * stays and the count keeps climbing; under 100 there is no badge.
 */
import { test, expect, Page } from '@playwright/test';

const SHOTS = process.env.LB_SHOTS || '';

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
  });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

test.describe('W1293 — the boss-kill badge ladder', () => {
  test('a new emblem every 100 kills, the crest past 1000, nothing under 100', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.evaluate(() => {
      const A = (window as any).Auth;
      const rows = [
        { rank: 1, alias: 'crest', current_value: 41720, bosses_slain: 1234, arena_title: 'rt_warbringer' },
        { rank: 2, alias: 'gilded', current_value: 10711, bosses_slain: 912, arena_title: 'summit_second_awakened' },
        { rank: 3, alias: 'bronze', current_value: 8339, bosses_slain: 204 },
        { rank: 4, alias: 'iron', current_value: 7000, bosses_slain: 150 },
        { rank: 5, alias: 'rookie', current_value: 6000, bosses_slain: 99 },
      ];
      A.fetchLeaderboardTop = async () => ({ ok: true, final: false, week: null, top: rows, me: null });
      A.fetchLastWeekSteps = async () => ({ ok: true, champion: null, me: null, records: [] });
      A.fetchStep100kClub = async () => ({ ok: true, members: [{ alias: 'gilded', best_value: 133979 }], me: null });
      A.fetchLeaderboardArchive = async (week: string) => ({ ok: true, week, records: [], me: null, weeksAvailable: [week] });
      (window as any).openLeaderboardRanking('step_total');
    });
    const sheet = page.locator('#lb-rank-sheet');
    const badge = (alias: string) => sheet.locator('[data-profile-alias="' + alias + '"] .lb-rank-boss100');
    await expect(badge('bronze')).toHaveText('200', { timeout: 8_000 });
    await expect(badge('bronze')).toHaveClass(/lb-bk-t2\b/);
    await expect(badge('iron')).toHaveText('100');
    await expect(badge('iron').locator('img')).toHaveAttribute('src', 'assets/badges/boss-kills-1.webp');
    await expect(badge('gilded')).toHaveText('900');
    await expect(badge('gilded').locator('img')).toHaveAttribute('src', 'assets/badges/boss-kills-9.webp');
    await expect(badge('crest')).toHaveText('1200');   // past 1000: the crest stays, the count climbs
    await expect(badge('crest').locator('img')).toHaveAttribute('src', 'assets/badges/boss-kills-10.webp');
    await expect(badge('rookie')).toHaveCount(0);
    // every emblem loads, and none is cut off by the title line (it clips for the ellipsis)
    const shown = await sheet.locator('.lb-rank-boss100 img').evaluateAll((imgs) => imgs.map((el) => {
      const img = el as HTMLImageElement, line = img.closest('.lb-rank-class') as HTMLElement;
      const a = img.getBoundingClientRect(), b = line.getBoundingClientRect();
      return { ok: img.complete && img.naturalWidth > 0, inside: a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5 };
    }));
    expect(shown).toHaveLength(4);
    for (const s of shown) expect(s).toEqual({ ok: true, inside: true });
    if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: SHOTS + '/lb-boss-ladder.png' }); }
  });
});
