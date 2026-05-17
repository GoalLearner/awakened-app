/**
 * accolade-week.ts — Deterministic Sunday-UTC week-start key.
 *
 * For v1 of the 100K Step Club accolade (v3 Phase 1z.27), the backend
 * needs a stable week key independent of the user's device timezone.
 * The client uses a rolling 7-day window for the leaderboard display,
 * but the server must own the durable "which week did you qualify"
 * stamp -- otherwise device-clock drift or timezone changes could
 * produce ambiguous repeat_count semantics.
 *
 * Choice: Sunday 00:00 UTC. Rationale:
 *   - Deterministic from `Date.now()` on the Worker (no timezone arg
 *     to get wrong).
 *   - Matches the "calendar week" mental model most users carry.
 *   - If a user in PT (UTC-7/-8) qualifies on what their phone shows
 *     as Sunday morning, that's still inside the same Sunday-UTC
 *     bucket they were in on Saturday evening UTC -- one bucket per
 *     ~7-day window globally, no edge-case double-awards.
 *
 * Format: ISO YYYY-MM-DD string. Storing as TEXT lets us index and
 * range-query cheaply via D1's lexicographic ORDER BY.
 */

/**
 * Returns the Sunday UTC date (00:00:00Z) at or before `nowMs`,
 * formatted as 'YYYY-MM-DD'. nowMs defaults to Date.now().
 *
 * Examples (treating Date.UTC for clarity):
 *   2026-05-17 13:00 UTC (Sunday)   -> '2026-05-17'
 *   2026-05-18 00:00 UTC (Monday)   -> '2026-05-17'
 *   2026-05-23 23:59 UTC (Saturday) -> '2026-05-17'
 *   2026-05-24 00:00 UTC (Sunday)   -> '2026-05-24'
 */
export function getAccoladeWeekStart(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  // JS Date.getUTCDay(): 0 = Sunday, 6 = Saturday. Subtract that many
  // days to land on the most recent Sunday in UTC.
  const dayOfWeek = d.getUTCDay();
  const sundayMs = nowMs - dayOfWeek * 24 * 60 * 60 * 1000;
  const sunday = new Date(sundayMs);
  const yyyy = sunday.getUTCFullYear();
  const mm = String(sunday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(sunday.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
