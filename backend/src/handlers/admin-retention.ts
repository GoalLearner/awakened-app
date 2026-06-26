/**
 * GET /v1/admin/retention — classic cohort retention (D1/D7/D14/D30). ADMIN-ONLY.
 *
 * NOT a user route: it authenticates via the ADMIN_METRICS_SECRET shared secret in
 * the Authorization header (same FAIL-CLOSED pattern as the RevenueCat webhook),
 * NOT a Sign-in-with-Apple session — so it lives among the public routes, BEFORE
 * the Bearer-session gate in index.ts.
 *
 * Cohort = a user's first-ever app-open UTC day (MIN(date_utc) from app_opens).
 * For each cohort it reports two retention numbers per horizon N ∈ {1,7,14,30}:
 *   - EXACT:    opened on the day EXACTLY N days after first_seen.
 *   - WINDOWED: opened at least once within (first_seen, first_seen + N days].
 * Plus a maturity-correct ROLL-UP across cohorts: a cohort only counts toward dN
 * once it is at least N days old, so young cohorts don't deflate D30. Roll-up
 * percentages are users-weighted (sum of retained / sum of eligible cohort sizes).
 */
import type { Env } from '../env';
import { jsonOk, jsonError } from '../lib/responses';

interface CohortRow {
  cohort_date: string;
  cohort_size: number;
  r1_exact: number;
  r7_exact: number;
  r14_exact: number;
  r30_exact: number;
  r1_win: number;
  r7_win: number;
  r14_win: number;
  r30_win: number;
}

const HORIZONS = [1, 7, 14, 30] as const;

function pct(num: number, den: number): number | null {
  return den > 0 ? Math.round((1000 * num) / den) / 10 : null;
}

function addDaysUtc(dateUtc: string, n: number): string {
  const t = new Date(dateUtc + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export async function handleAdminRetention(request: Request, env: Env): Promise<Response> {
  // FAIL CLOSED: a missing/mismatched secret → 401, and an UNSET env secret also
  // → 401 (a misconfigured deploy can't accidentally expose retention publicly).
  const expected = env.ADMIN_METRICS_SECRET;
  const provided = request.headers.get('Authorization');
  if (!expected || !provided || provided !== `Bearer ${expected}`) {
    return jsonError(401, 'ADMIN_AUTH_FAILED', 'Invalid or missing admin secret.');
  }

  // One pass over app_opens: per-cohort COUNTS (not percentages) so the handler
  // can compute both per-cohort rates AND the maturity-correct roll-up in JS.
  // `localhost-dev-user` (the local-dev session stub) is excluded so dev opens
  // never pollute real retention.
  const res = await env.DB.prepare(
    `WITH first_seen AS (
       SELECT user_id, MIN(date_utc) AS cohort_date
         FROM app_opens
        WHERE user_id <> 'localhost-dev-user'
        GROUP BY user_id
     )
     SELECT
       fs.cohort_date                                                                                          AS cohort_date,
       COUNT(DISTINCT fs.user_id)                                                                              AS cohort_size,
       COUNT(DISTINCT CASE WHEN o.date_utc =  date(fs.cohort_date, '+1 day')  THEN fs.user_id END)             AS r1_exact,
       COUNT(DISTINCT CASE WHEN o.date_utc =  date(fs.cohort_date, '+7 day')  THEN fs.user_id END)             AS r7_exact,
       COUNT(DISTINCT CASE WHEN o.date_utc =  date(fs.cohort_date, '+14 day') THEN fs.user_id END)             AS r14_exact,
       COUNT(DISTINCT CASE WHEN o.date_utc =  date(fs.cohort_date, '+30 day') THEN fs.user_id END)             AS r30_exact,
       COUNT(DISTINCT CASE WHEN o.date_utc >  fs.cohort_date AND o.date_utc <= date(fs.cohort_date, '+1 day')  THEN fs.user_id END) AS r1_win,
       COUNT(DISTINCT CASE WHEN o.date_utc >  fs.cohort_date AND o.date_utc <= date(fs.cohort_date, '+7 day')  THEN fs.user_id END) AS r7_win,
       COUNT(DISTINCT CASE WHEN o.date_utc >  fs.cohort_date AND o.date_utc <= date(fs.cohort_date, '+14 day') THEN fs.user_id END) AS r14_win,
       COUNT(DISTINCT CASE WHEN o.date_utc >  fs.cohort_date AND o.date_utc <= date(fs.cohort_date, '+30 day') THEN fs.user_id END) AS r30_win
     FROM first_seen fs
     JOIN app_opens o ON o.user_id = fs.user_id
     GROUP BY fs.cohort_date
     ORDER BY fs.cohort_date DESC`,
  ).all<CohortRow>();

  const rows: CohortRow[] = res.results ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const exactCount = (r: CohortRow, n: number): number =>
    n === 1 ? r.r1_exact : n === 7 ? r.r7_exact : n === 14 ? r.r14_exact : r.r30_exact;
  const winCount = (r: CohortRow, n: number): number =>
    n === 1 ? r.r1_win : n === 7 ? r.r7_win : n === 14 ? r.r14_win : r.r30_win;

  const cohorts = rows.map((r) => {
    const exact: Record<string, number | null> = {};
    const windowed: Record<string, number | null> = {};
    for (const n of HORIZONS) {
      exact[`d${n}`] = pct(exactCount(r, n), r.cohort_size);
      windowed[`d${n}`] = pct(winCount(r, n), r.cohort_size);
    }
    return { cohort_date: r.cohort_date, cohort_size: r.cohort_size, exact, windowed };
  });

  // Maturity-correct roll-up: a cohort counts toward dN only once it is ≥ N days
  // old (cohort_date + N <= today), so recent cohorts don't artificially deflate
  // the longer horizons.
  const rollup: {
    exact: Record<string, { pct: number | null; users: number; cohorts: number }>;
    windowed: Record<string, { pct: number | null; users: number; cohorts: number }>;
  } = { exact: {}, windowed: {} };

  for (const n of HORIZONS) {
    let den = 0;
    let numExact = 0;
    let numWin = 0;
    let eligible = 0;
    for (const r of rows) {
      if (addDaysUtc(r.cohort_date, n) <= today) {
        den += r.cohort_size;
        numExact += exactCount(r, n);
        numWin += winCount(r, n);
        eligible += 1;
      }
    }
    rollup.exact[`d${n}`] = { pct: pct(numExact, den), users: den, cohorts: eligible };
    rollup.windowed[`d${n}`] = { pct: pct(numWin, den), users: den, cohorts: eligible };
  }

  return jsonOk({
    as_of: today,
    total_users: rows.reduce((acc, r) => acc + r.cohort_size, 0),
    definitions: {
      cohort: "A user's first-ever app-open UTC day (MIN(date_utc)).",
      exact: 'Opened on the day EXACTLY N days after first_seen.',
      windowed: 'Opened at least once within (first_seen, first_seen + N days].',
      rollup:
        'Across cohorts at least N days old (younger cohorts excluded so they do not deflate dN). pct is users-weighted: sum(retained) / sum(eligible cohort sizes).',
    },
    rollup,
    cohorts,
  });
}
