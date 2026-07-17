/**
 * GET /v1/leaderboard/hall-of-fame?metric=step_total&limit=N
 *
 * Authenticated endpoint. Returns the top N all-time weekly step
 * records ever recorded by real users, plus the caller's personal
 * best record (me_best).
 *
 * v3 Phase 1z.36 — Weekly Steps Hall of Fame (the all-time record
 * book for highest verified weekly step totals). Source table:
 * `weekly_step_records` (migration 0009). A single user can appear
 * multiple times in the response — once per qualifying week.
 *
 * Simulated/test users (apple_sub LIKE 'sim_test_%') never appear:
 * the write path in leaderboard-submit excludes them, so the table
 * itself contains no sim rows. Defense-in-depth: this reader also
 * does NOT merge anything from simulated-leaderboard.js.
 *
 * v1 supports `metric=step_total` only. Streak metrics
 * (sleep_streak, bedtime_streak) are running counts that carry
 * across weeks — they don't have a meaningful "weekly best ever"
 * shape so they're rejected with 400 INVALID_METRIC.
 *
 * Response shape:
 *   {
 *     metric: "step_total",
 *     records: [
 *       { rank: 1, alias: "Richie", steps: 104821,
 *         week_start: "2026-05-17", week_end: "2026-05-23" },
 *       ...
 *     ],
 *     me_best: { rank: 7, steps: 88420,
 *                week_start: "2026-05-17",
 *                week_end: "2026-05-23" } | null
 *   }
 *
 * Ordering: `steps DESC`, ties broken by older `week_start ASC`
 * (oldest record wins the tie — first-to-the-summit semantic).
 *
 * Rate limit: RL_LEADERBOARD_HOF (wrangler.toml namespace_id 1012).
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

const SUPPORTED_METRICS = new Set(['step_total']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface RecordRow {
  alias: string;
  steps: number;
  week_start: string;
  // W704 — avatar crest filename off public_profile_summary (null = never synced).
  avatar_id: string | null;
}

interface MyBestRow {
  steps: number;
  week_start: string;
}

interface RankRow {
  rank: number;
}

/**
 * Returns Saturday-UTC YYYY-MM-DD given the Sunday-UTC week_start
 * key. Pure date math; no Date object needed beyond construction.
 * 'YYYY-MM-DD' is lexicographically ordered so the read query's
 * ASC tiebreaker on week_start is correct.
 */
function weekEndFromStart(weekStart: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!m) return weekStart;
  const ms = Date.UTC(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
  ) + 6 * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function handleLeaderboardHallOfFame(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_HOF.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many Hall of Fame requests. Slow down.');
  }

  const url = new URL(request.url);
  const metricParam = url.searchParams.get('metric');
  const limitParam = url.searchParams.get('limit');

  if (!metricParam || !SUPPORTED_METRICS.has(metricParam)) {
    return jsonError(
      400,
      'INVALID_METRIC',
      'Query param "metric" must be one of: step_total. (v1: step_total only.)',
    );
  }
  const metric = metricParam;

  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  // v3 Phase 1z.41 -- fallback union from leaderboard_snapshots.
  //
  // The 1z.36 deploy created weekly_step_records empty. Real users
  // with existing valid step_total snapshots (week_start IS NOT NULL,
  // post-1z.33 submits) wouldn't appear in Hall of Fame until they
  // submitted again, even though their week is legitimate. Visible
  // Hall of Fame on launch day looked like just simulated filler.
  //
  // Fix: UNION the authoritative weekly_step_records table with
  // eligible leaderboard_snapshots rows that AREN'T already in it.
  // Once a user submits post-1z.36 their wsr row supersedes the
  // ls fallback for the same (user, week) via NOT EXISTS.
  //
  // Eligibility for the snapshot fallback:
  //   - metric = 'step_total'
  //   - week_start IS NOT NULL   (excludes pre-1z.33 stale rows --
  //     they can't be attributed to any specific week, so they
  //     would be misleading historical records)
  //   - users.apple_sub NOT LIKE 'sim_test_%'   (excludes sim test
  //     users; defense in depth -- they shouldn't have submitted
  //     via the production path anyway, but mirror the same filter
  //     used at write time in leaderboard-submit)
  //   - NOT EXISTS in weekly_step_records for the same
  //     (user_id, week_start)   (dedupe -- prefer wsr's MAX(stored,
  //     new) semantic over ls's current_value LAST-write semantic)
  //
  // Top-N global query. JOIN users so alias edits flow through.
  // Tie-breaker: older week wins (week_start ASC) -- first-to-the-
  // summit semantic.
  const topResult = await env.DB.prepare(
    `WITH merged AS (
       SELECT user_id, week_start, steps
         FROM weekly_step_records
       UNION ALL
       SELECT ls.user_id, ls.week_start, ls.current_value AS steps
         FROM leaderboard_snapshots ls
         JOIN users u ON u.id = ls.user_id
         WHERE ls.metric = 'step_total'
           AND ls.week_start IS NOT NULL
           AND u.apple_sub NOT LIKE 'sim_test_%'
           AND NOT EXISTS (
             SELECT 1 FROM weekly_step_records w
             WHERE w.user_id = ls.user_id AND w.week_start = ls.week_start
           )
     )
     SELECT u.alias AS alias, m.steps AS steps, m.week_start AS week_start,
            pps.avatar_id AS avatar_id
     FROM merged m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN public_profile_summary pps ON pps.user_id = m.user_id
     ORDER BY m.steps DESC, m.week_start ASC
     LIMIT ?`,
  )
    .bind(limit)
    .all<RecordRow>();

  const records = (topResult.results ?? []).map((row, i) => ({
    rank: i + 1,
    alias: row.alias,
    steps: row.steps,
    week_start: row.week_start,
    week_end: weekEndFromStart(row.week_start),
    avatar_id: row.avatar_id ?? null,   // W704 — row crest
  }));

  // Caller's personal best record across all weeks. Two cheap
  // queries: (1) pick the row with the highest steps for this user,
  // (2) count rows with strictly higher steps to compute rank in the
  // global ranking. Ties: a strict > rank with ASC week_start
  // tiebreaker means our row gets the rank position of the FIRST
  // record at our exact value -- consistent with the records[] order.
  //
  // v3 Phase 1z.41 -- the me_best query also unions
  // leaderboard_snapshots so a user whose only step_total row is
  // still in the legacy table (pre-1z.36 submit, but post-1z.33
  // week_start tagging) appears as their own best. Same dedupe
  // rules as the top-N query.
  const myBestRow = await env.DB.prepare(
    `WITH my_rows AS (
       SELECT week_start, steps
         FROM weekly_step_records
         WHERE user_id = ?
       UNION ALL
       SELECT ls.week_start, ls.current_value AS steps
         FROM leaderboard_snapshots ls
         WHERE ls.user_id = ?
           AND ls.metric = 'step_total'
           AND ls.week_start IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM weekly_step_records w
             WHERE w.user_id = ? AND w.week_start = ls.week_start
           )
     )
     SELECT week_start, steps FROM my_rows
     ORDER BY steps DESC, week_start ASC
     LIMIT 1`,
  )
    .bind(session.userId, session.userId, session.userId)
    .first<MyBestRow>();

  let me_best: {
    rank: number;
    steps: number;
    week_start: string;
    week_end: string;
  } | null = null;
  if (myBestRow) {
    // Rank = count of records with strictly higher steps, plus 1.
    // Same convention as leaderboard-top.ts. Ties at our exact value
    // get our row's actual position (the older-week tiebreaker
    // determines which record at that value is "rank N" -- but for
    // the user themselves, COUNT(*) WHERE steps > ours produces a
    // stable, defensible number that matches the records[] ordering.
    //
    // v3 Phase 1z.41 -- count is computed against the same merged
    // set (weekly_step_records UNION eligible leaderboard_snapshots
    // fallback) so the rank matches the top-N ordering. Without
    // this, a user whose best is in the ls fallback could see their
    // me_best.rank computed against only the wsr rows above them.
    const rankResult = await env.DB.prepare(
      `WITH merged AS (
         SELECT steps FROM weekly_step_records
         UNION ALL
         SELECT ls.current_value AS steps
           FROM leaderboard_snapshots ls
           JOIN users u ON u.id = ls.user_id
           WHERE ls.metric = 'step_total'
             AND ls.week_start IS NOT NULL
             AND u.apple_sub NOT LIKE 'sim_test_%'
             AND NOT EXISTS (
               SELECT 1 FROM weekly_step_records w
               WHERE w.user_id = ls.user_id AND w.week_start = ls.week_start
             )
       )
       SELECT COUNT(*) + 1 AS rank
       FROM merged
       WHERE steps > ?`,
    )
      .bind(myBestRow.steps)
      .first<RankRow>();
    me_best = {
      rank: rankResult?.rank ?? -1,
      steps: myBestRow.steps,
      week_start: myBestRow.week_start,
      week_end: weekEndFromStart(myBestRow.week_start),
    };
  }

  return jsonOk({ metric, records, me_best });
}
