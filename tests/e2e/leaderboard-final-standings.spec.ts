/**
 * Awakened — the Steps board rests on the final standings Sunday morning (W1120).
 *
 * Owner, 2026-10-31: "I want it to marinade and show the final results for the week on Sunday
 * before showing the new leaderboard and not having zero people at 12:01AM Sunday." The server
 * decides and answers with final + week until 12:00 PM Pacific; new steps keep landing underneath.
 */
import { test, expect, Page } from '@playwright/test';

// The newest finished week, so the ‹ arrow stays inside the 8-week archive cap whenever this runs.
function finishedWeek(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const back = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const ms = Date.UTC(+get('year'), +get('month') - 1, +get('day')) - (back + 7) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}
const priorOf = (week: string) => new Date(Date.parse(week + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);

const row = (rank: number, alias: string, steps: number) => ({ rank, alias, current_value: steps });

async function boot(page: Page) {
  await page.addInitScript(() => {
    ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed',
      'hb_tour_quests_v1', 'hb_tour_items_v1', 'hb_tour_stats_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1',
    ].forEach((k) => localStorage.setItem(k, '1'));
    localStorage.setItem('hb_habits', '[]');
    localStorage.setItem('hb_whats_new_seen', '99.99.99');
  });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

async function openBoard(page: Page, result: unknown) {
  await page.evaluate((res) => {
    const A = (window as any).Auth;
    (window as any).__archAsked = [];
    A.fetchLeaderboardTop = async () => res;
    A.fetchLastWeekSteps = async () => ({ ok: true, champion: { alias: 'Alpha', steps: 92297 }, me: null, records: [] });
    A.fetchStep100kClub = async () => ({ ok: true, members: [] });
    A.fetchLeaderboardArchive = async (week: string) => { (window as any).__archAsked.push(week); return { ok: true, week, records: [], me: null, weeksAvailable: [week] }; };
    (window as any).openLeaderboardRanking('step_total');
  }, result);
  await expect(page.locator('#lb-rank-sheet')).toBeVisible();
}

test.describe('The Steps board rests on the final standings (W1120)', () => {
  test('a final answer shows the finished week, FINAL, and when the new board comes', async ({ page }) => {
    await boot(page);
    const week = finishedWeek();
    await openBoard(page, { ok: true, final: true, week, top: [row(1, 'Alpha', 92297), row(2, 'Beta', 50426)], me: null });
    const head = page.locator('#lb-week-reset');
    await expect(page.locator('#lb-rank-list .lb-list-foot')).toHaveText('Final standings · New board at 12:00 PM Pacific');
    await expect(head.locator('.lb-arch-final')).toHaveText('FINAL');
    await expect(head).not.toContainText('RESETS SUNDAY');
    await expect(head).not.toContainText(/D LEFT|FINAL DAY/);
    await expect(page.locator('#lb-rank-list')).toContainText('92,297');
    await expect(page.locator('#lb-rank-list')).not.toContainText('submitting');           // not on it = no pending row
    await expect(page.locator('#lb-rank-list .lb-leader-lastweek')).toHaveCount(0);        // #1 IS last week's winner
    await expect(page.locator('#lb-lastweek-recap')).toBeHidden();
    // ‹ goes to the week before this one, not to the same board again.
    await head.locator('[data-lb-arch="prev"]').click();
    await expect.poll(() => page.evaluate(() => (window as any).__archAsked)).toEqual([priorOf(week)]);
  });

  test('a live answer shows the live race, even if the phone thinks it is Sunday morning', async ({ page }) => {
    await boot(page);
    await page.clock.setFixedTime(new Date('2026-11-01T15:00:00Z'));   // Sunday 7:00 AM PST
    await openBoard(page, { ok: true, final: false, week: null, top: [row(1, 'Alpha', 4200)], me: null });
    await expect(page.locator('#lb-rank-list .lb-list-foot')).toContainText('Resets Sunday 12:00 AM Pacific');
    await expect(page.locator('#lb-week-reset')).toContainText('RESETS SUNDAY');
    await expect(page.locator('#lb-week-reset .lb-arch-final')).toHaveCount(0);
  });

  test('on the phone\'s Sunday morning the header says FINAL before the fetch lands', async ({ page }) => {
    await boot(page);
    await page.clock.setFixedTime(new Date('2026-11-01T15:00:00Z'));
    await page.evaluate(() => {
      (window as any).Auth.fetchLeaderboardTop = () => new Promise(() => {});
      (window as any).openLeaderboardRanking('step_total');
    });
    await expect(page.locator('#lb-week-reset .lb-arch-final')).toHaveText('FINAL');
    await expect(page.locator('#lb-week-reset .lb-ctx-date')).toHaveText('Oct 25 – 31');
  });

  test('the phone\'s noon is the live header again', async ({ page }) => {
    await boot(page);
    await page.clock.setFixedTime(new Date('2026-11-01T20:00:00Z'));   // Sunday 12:00 PM PST
    await page.evaluate(() => {
      (window as any).Auth.fetchLeaderboardTop = () => new Promise(() => {});
      (window as any).openLeaderboardRanking('step_total');
    });
    await expect(page.locator('#lb-week-reset')).toContainText('RESETS SUNDAY');
  });

  test('a finished week\'s rank is not a new top-10 feat', async ({ page }) => {
    await boot(page);
    await openBoard(page, { ok: true, final: true, week: finishedWeek(), top: [row(1, 'Alpha', 92297), row(2, 'DevUser', 60000)], me: { rank: 2, current_value: 60000 } });
    await expect(page.locator('#lb-rank-list .lb-list-foot')).toBeVisible();
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hb_lb_best_rank_')));
    expect(keys).toEqual([]);
  });

  test('the Friends tab rests too', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      (window as any).Auth.fetchFriendsLeaderboard = async () => ({ ok: true, final: true, weekStart: '2026-10-25', total: 2, rows: [row2(1, 'Alpha', 92297), row2(2, 'DevUser', 31684)], me: { rank: 2, current_value: 31684 } });
      function row2(rank: number, alias: string, steps: number) { return { rank, alias, current_value: steps }; }
    });
    await openBoard(page, { ok: true, final: false, top: [], me: null });
    await page.evaluate(() => (document.querySelector('[data-lb-tab="friends"]') as HTMLElement).click());
    await expect(page.locator('#lb-rank-blurb')).toHaveText('Final standings · New board at 12:00 PM Pacific');
    await expect(page.locator('#lb-week-reset')).toBeHidden();
    await expect(page.locator('#lb-rank-list')).toContainText('92,297');
  });
});
