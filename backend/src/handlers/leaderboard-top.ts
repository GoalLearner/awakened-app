/**
 * GET /v1/leaderboard/top?metric=X&limit=N
 *
 * Authenticated endpoint. Returns the top N entries for a metric +
 * the calling user's own rank/value.
 *
 * Response shape:
 *   {
 *     metric: "step_total",
 *     top: [
 *       { rank: 1, alias: "HunterShadow", current_value: 14820 },
 *       ...
 *     ],
 *     me: { rank: 42, current_value: 5300 } | null
 *   }
 *
 * me is null when the calling user hasn't submitted this metric yet.
 *
 * BACKEND.md §8.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { isValidMetric, type Metric } from '../lib/metrics';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

interface TopRow {
  alias: string;
  current_value: number;
}

interface MyRow {
  current_value: number;
}

interface RankRow {
  rank: number;
}

export async function handleLeaderboardTop(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_TOP.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many leaderboard requests. Slow down.');
  }

  const url = new URL(request.url);
  const metricParam = url.searchParams.get('metric');
  const limitParam = url.searchParams.get('limit');

  if (!isValidMetric(metricParam)) {
    return jsonError(
      400,
      'INVALID_METRIC',
      'Query param "metric" must be one of: step_total, sleep_streak, bedtime_streak.',
    );
  }
  const metric: Metric = metricParam;

  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  // Top-N query. Uses idx_leaderboard_metric_value for index-only
  // range scan; no full-table sort.
  const topResult = await env.DB.prepare(
    `SELECT u.alias AS alias, ls.current_value AS current_value
     FROM leaderboard_snapshots ls
     JOIN users u ON u.id = ls.user_id
     WHERE ls.metric = ?
     ORDER BY ls.current_value DESC
     LIMIT ?`,
  )
    .bind(metric, limit)
    .all<TopRow>();

  const top = (topResult.results ?? []).map((row, i) => ({
    rank: i + 1,
    alias: row.alias,
    current_value: row.current_value,
  }));

  // Caller's row (if they've submitted this metric).
  const myRow = await env.DB.prepare(
    'SELECT current_value FROM leaderboard_snapshots WHERE user_id = ? AND metric = ?',
  )
    .bind(session.userId, metric)
    .first<MyRow>();

  let me: { rank: number; current_value: number } | null = null;
  if (myRow) {
    // Rank = count of rows with strictly higher current_value + 1.
    // Ties get the same rank as the first of the tie group.
    const rankResult = await env.DB.prepare(
      `SELECT COUNT(*) + 1 AS rank
       FROM leaderboard_snapshots
       WHERE metric = ? AND current_value > ?`,
    )
      .bind(metric, myRow.current_value)
      .first<RankRow>();
    me = {
      rank: rankResult?.rank ?? -1,
      current_value: myRow.current_value,
    };
  }

  return jsonOk({ metric, top, me });
}
