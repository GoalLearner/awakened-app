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

  // Top-N global query. JOIN users so alias edits flow through; the
  // table itself stores user_id only. Tie-breaker: older week wins
  // (week_start ASC) -- first-to-the-summit semantic.
  const topResult = await env.DB.prepare(
    `SELECT u.alias AS alias, wsr.steps AS steps, wsr.week_start AS week_start
     FROM weekly_step_records wsr
     JOIN users u ON u.id = wsr.user_id
     ORDER BY wsr.steps DESC, wsr.week_start ASC
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
  }));

  // Caller's personal best record across all weeks. Two cheap
  // queries: (1) pick the row with the highest steps for this user,
  // (2) count rows with strictly higher steps to compute rank in the
  // global ranking. Ties: a strict > rank with ASC week_start
  // tiebreaker means our row gets the rank position of the FIRST
  // record at our exact value -- consistent with the records[] order.
  const myBestRow = await env.DB.prepare(
    `SELECT steps, week_start
     FROM weekly_step_records
     WHERE user_id = ?
     ORDER BY steps DESC, week_start ASC
     LIMIT 1`,
  )
    .bind(session.userId)
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
    const rankResult = await env.DB.prepare(
      `SELECT COUNT(*) + 1 AS rank
       FROM weekly_step_records
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
