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

// W1316 — owner 2026-11-25: "It didn't change the color/effect in these rows". The title's colour (W1315) on the board
// rows: another hunter's published ink, my own row from this phone (instant), none → the tier's own label.
test.describe('W1316 — the title colour on the board rows', () => {
  for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
    test('published inks on the rows, my row from this phone, none = the tier @' + vp.width, async ({ page }) => {
      await page.setViewportSize(vp);
      await boot(page);
      await page.evaluate(() => {
        localStorage.setItem('hb_arena_title', 'summit_second_awakened');
        localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: 100, highestCleared: 100, wins: 100, losses: 0, streak: 0, bestStreak: 0, dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }));
        localStorage.setItem('hb_title_ink', 'stardust');
        const A = (window as any).Auth;
        A.getCurrentUser = () => ({ jwt: 'e2e', alias: 'Richie' });
        const rows = [
          { rank: 1, alias: 'galilea', current_value: 24414, bosses_slain: 224, arena_title: 'rt_sovereign', card_title_ink: 'void' },
          { rank: 2, alias: 'anthony', current_value: 20100, bosses_slain: 412, arena_title: 'rt_apex', card_title_ink: 'teal' },
          { rank: 3, alias: 'zynfandel', current_value: 18483, bosses_slain: 100, arena_title: 'rt_sovereign', card_title_ink: null },
          { rank: 4, alias: 'Richie', current_value: 17726, bosses_slain: 400, arena_title: 'summit_second_awakened', card_title_ink: 'rose' },
        ];
        A.fetchLeaderboardTop = async () => ({ ok: true, final: false, week: null, top: rows, me: { rank: 4, current_value: 17726 } });
        A.fetchLastWeekSteps = async () => ({ ok: true, champion: null, me: null, records: [] });
        A.fetchStep100kClub = async () => ({ ok: true, members: [], me: null });
        A.fetchLeaderboardArchive = async (week: string) => ({ ok: true, week, records: [], me: null, weeksAvailable: [week] });
        (window as any).openLeaderboardRanking('step_total');
      });
      const sheet = page.locator('#lb-rank-sheet');
      const label = (alias: string) => sheet.locator('[data-profile-alias="' + alias + '"] .lb-rank-class').first();
      const name = (alias: string) => label(alias).locator('.lb-rank-class-name');
      await expect(name('galilea')).toHaveText(/Sovereign/i, { timeout: 8_000 });
      // a living ink: the gradient sweeps over the words
      await expect(label('galilea')).toHaveClass(/lb-rank-class--g/);
      expect(await name('galilea').evaluate((e) => { const c = getComputedStyle(e); return [c.backgroundImage.startsWith('linear-gradient'), c.webkitTextFillColor]; })).toEqual([true, 'rgba(0, 0, 0, 0)']);
      // a solid ink
      expect(await name('anthony').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(94, 234, 212)');
      // none: the tier's own violet
      await expect(label('zynfandel')).not.toHaveClass(/lb-rank-class--g/);
      expect(await name('zynfandel').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(167, 139, 250)');
      // my row: this phone's choice (stardust) beats the published rose
      await expect(name('Richie')).toHaveText(/Grandmaster/i);
      await expect(label('Richie')).toHaveClass(/lb-rank-class--g/);
      expect(await name('Richie').evaluate((e) => getComputedStyle(e).backgroundImage)).toContain('rgb(253, 230, 138)');   // stardust's gold
      if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: SHOTS + '/lb-title-ink-' + vp.width + '.png' }); }
    });
  }
});
