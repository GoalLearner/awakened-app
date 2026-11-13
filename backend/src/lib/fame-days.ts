/**
 * fame-days.ts — W1197: a week makes the Hall of Fame and the 100K Club only with two days in the app.
 *
 * Owner 2026-11-13, on Killua (a new hunter whose first Apple Health read sent 150,000 steps, the week's
 * cap, an hour after install, straight to #1 of the 100K Club): "They must sign in two-days out of the
 * week to make hall of fame so no random person can just hit the hall of fame and delete the app after".
 *
 * The Worldgate's W1134 rule, reused: a hunter's week counts on these record books only once they have
 * opened the app on FAME_MIN_DAYS Pacific days of that week (app_open_counts, migration 0071, opens > 0).
 * Weeks before FAME_DAYS_FROM keep counting: the open counter only began on 2026-11-05. The live weekly
 * Steps board is unchanged (it still shows every step as it lands).
 */
export const FAME_MIN_DAYS = 2;
export const FAME_DAYS_FROM = '2026-11-08';

/** SQL: how many Pacific days the hunter in `uidCol` opened the app in the week starting at `weekCol`. */
export function appDaysIn(uidCol: string, weekCol: string): string {
  return `(SELECT COUNT(*) FROM app_open_counts fc
      WHERE fc.user_id = ${uidCol} AND fc.day_pt >= ${weekCol} AND fc.day_pt <= date(${weekCol}, '+6 days')
        AND fc.opens > 0)`;
}

/** W1198 — the LIVE weekly Steps board (owner 2026-11-13: "yes apply it to those too"). A week still in
 *  progress cannot ask for two days of itself (every Sunday the board would be empty), so a hunter shows
 *  once they have opened the app on FAME_MIN_DAYS days of this week OR of last week: regulars from the
 *  first day, a newcomer from their second day. Never grandfathered — the live week is always new. */
export function liveBoardOk(uidCol: string, weekCol: string): string {
  return `(${appDaysIn(uidCol, weekCol)} >= ${FAME_MIN_DAYS} OR ${appDaysIn(uidCol, `date(${weekCol}, '-7 days')`)} >= ${FAME_MIN_DAYS})`;
}

/** SQL: true when the hunter in `uidCol` opened the app on enough Pacific days of the week starting at
 *  `weekCol` (both SQL expressions, e.g. column names), or the week predates the open counter. */
export function fameWeekOk(uidCol: string, weekCol: string): string {
  return `(${weekCol} < '${FAME_DAYS_FROM}' OR (SELECT COUNT(*) FROM app_open_counts fc
      WHERE fc.user_id = ${uidCol} AND fc.day_pt >= ${weekCol} AND fc.day_pt <= date(${weekCol}, '+6 days')
        AND fc.opens > 0) >= ${FAME_MIN_DAYS})`;
}
