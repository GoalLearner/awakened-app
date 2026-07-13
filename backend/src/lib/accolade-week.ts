/**
 * accolade-week.ts — Deterministic Sunday-Pacific week-start key.
 *
 * v3 Phase 1z.218 — Switched the anchor from Sunday-UTC to
 * Sunday in America/Los_Angeles (Pacific Time). The product
 * decision (1z.217 audit): Awakened global high scores should
 * reset at Sunday midnight Pacific so the visible reset matches
 * the operator's local intuition. The previous UTC anchor caused
 * Pacific users to see the reset at 5 PM Saturday local, which
 * was mathematically correct but confusing.
 *
 * Anchor choice rationale:
 *   - Pacific Time (America/Los_Angeles) handles DST correctly via
 *     Intl.DateTimeFormat — no hard-coded UTC-7 / UTC-8 offset.
 *   - Single chokepoint: leaderboard-submit, leaderboard-top, and
 *     the 100K Club path all consume this function. Changing the
 *     anchor here changes all three uniformly.
 *   - Period key format unchanged ('YYYY-MM-DD') so the existing
 *     leaderboard_snapshots / weekly_step_records / user_accolades
 *     schemas are untouched. Old UTC-stamped rows coexist with new
 *     Pacific-stamped rows because they're just different date
 *     strings.
 *
 * Trust tag pairing: the client must send
 * weekly_sum_source = 'client_pacific_week_v1' for its submit to
 * be considered trustworthy. The transition allowlist in
 * leaderboard-submit.ts continues to honor 'client_sunday_utc_v2'
 * for ~2-3 weeks so older clients self-heal correctly during the
 * boundary swap.
 *
 * Format: ISO YYYY-MM-DD string. Storing as TEXT lets us index and
 * range-query cheaply via D1's lexicographic ORDER BY.
 */

const PACIFIC_TIMEZONE = 'America/Los_Angeles';

// Pre-allocated formatter — re-used across calls. Intl formatters
// are not cheap to construct on every invocation; the Worker
// instance keeps this around for the life of the isolate.
//
// 'en-CA' produces 'YYYY-MM-DD' parts via formatToParts, which is
// the most reliable way to extract Pacific-local date components
// without manual offset math. 'weekday: "short"' gives us a 3-char
// English weekday name ('Sun', 'Mon', ...) regardless of the
// locale's default formatting.
const PACIFIC_DATE_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC_TIMEZONE,
  year:    'numeric',
  month:   '2-digit',
  day:     '2-digit',
  weekday: 'short',
});

const DOW_BACK: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Returns the Sunday-Pacific date (the YYYY-MM-DD of the Sunday
 * that began the Pacific-local week containing `nowMs`),
 * formatted as 'YYYY-MM-DD'. nowMs defaults to Date.now().
 *
 * Examples (with PDT = UTC-7 in May):
 *   2026-05-17 13:00 UTC (Sunday 06:00 PDT)  -> '2026-05-17'
 *   2026-05-18 06:59 UTC (Sat 23:59 PDT)     -> '2026-05-10' (still in last week PT)
 *   2026-05-18 07:00 UTC (Sunday 00:00 PDT)  -> '2026-05-17'
 *   2026-05-31 06:30 UTC (Sat 23:30 PDT)     -> '2026-05-24' (still last week)
 *   2026-05-31 07:00 UTC (Sun 00:00 PDT)     -> '2026-05-31'
 *
 * DST examples:
 *   2026-03-08 09:59 UTC (Sat 23:59 PST=UTC-8) -> '2026-03-01'
 *   2026-03-08 10:00 UTC (Sun 02:00 PST→PDT)   -> '2026-03-08'
 *   2026-11-01 08:59 UTC (Sat 23:59 PDT=UTC-7) -> '2026-10-25'
 *   2026-11-01 09:00 UTC (Sun 01:00 PST=UTC-8) -> '2026-11-01'
 */
export function getAccoladeWeekStart(nowMs: number = Date.now()): string {
  // Render the moment in Pacific time and extract date + weekday.
  const parts = PACIFIC_DATE_PARTS.formatToParts(new Date(nowMs));
  // formatToParts returns an array; pull out the typed parts we need.
  let yStr  = '';
  let mStr  = '';
  let dStr  = '';
  let wkStr = '';
  for (const p of parts) {
    if (p.type === 'year')    yStr  = p.value;
    else if (p.type === 'month')   mStr  = p.value;
    else if (p.type === 'day')     dStr  = p.value;
    else if (p.type === 'weekday') wkStr = p.value;
  }
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const back = DOW_BACK[wkStr];
  if (
    !Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) ||
    typeof back !== 'number'
  ) {
    // Defensive: an unexpected Intl output. Fall back to a UTC
    // computation so we never throw inside a hot UPSERT path.
    return getAccoladeWeekStartUtcFallback(nowMs);
  }
  // Walk back `back` days from the Pacific-local Y-M-D. We do this
  // in UTC ms terms because the answer is a pure date string and
  // the walk-back of N whole days is timezone-agnostic when we're
  // already on the local date in question — DST transitions don't
  // affect "how many days back is the previous Sunday."
  const startMs = Date.UTC(y, m - 1, d) - back * 86_400_000;
  const s = new Date(startMs);
  const yyyy = s.getUTCFullYear();
  const mm   = String(s.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(s.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * W657 — the Sunday-Pacific week_start of the week BEFORE `weekStart`.
 * Pure date math: a fixed 7-day step in ms is exactly 7 calendar days off
 * a UTC-midnight anchor (no DST hazard — the anchor is date-only).
 * Centralized here so the recap/archive endpoints share ONE copy
 * (leaderboard-last-week.ts predates this and keeps its local twin).
 */
export function priorWeekStart(weekStart: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!m) return weekStart;
  const ms = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) - 7 * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

/** W657 — Saturday 'YYYY-MM-DD' that closes the week starting `weekStart`. */
export function weekEndFromStart(weekStart: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!m) return weekStart;
  const ms = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) + 6 * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

/**
 * UTC fallback for the rare case where Intl.DateTimeFormat
 * returns unexpected output. Mirrors the pre-1z.218 Sunday-UTC
 * helper exactly so the Worker never throws inside an UPSERT.
 */
function getAccoladeWeekStartUtcFallback(nowMs: number): string {
  const d = new Date(nowMs);
  const dayOfWeek = d.getUTCDay();
  const sundayMs = nowMs - dayOfWeek * 86_400_000;
  const sunday = new Date(sundayMs);
  const yyyy = sunday.getUTCFullYear();
  const mm = String(sunday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(sunday.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
