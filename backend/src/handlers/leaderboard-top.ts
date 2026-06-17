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
import { isValidMetric, isWeeklyMetric, type Metric } from '../lib/metrics';
import { getAccoladeWeekStart } from '../lib/accolade-week';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

interface TopRow {
  alias: string;
  current_value: number;
  // W257 — equipped Arena title ID (nullable; cosmetic chip on the client)
  arena_title: string | null;
  // W388 — lifetime boss kills (from public_profile_summary; the client shows a
  // crimson "100" stamp at >= 100). Nullable: LEFT JOIN, no pps row yet → null.
  bosses_slain: number | null;
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
      'Query param "metric" must be one of: step_total, sleep_streak, bedtime_streak, workout_streak.',
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

  // v3 Phase 1z.33 -- weekly scoping. For weekly metrics, all reads
  // filter on the current Sunday-UTC week key so prior-week snapshots
  // don't leak into the ranking. Non-weekly metrics keep their
  // historical query path (no week filter).
  const weekly = isWeeklyMetric(metric);
  const currentWeek: string | null = weekly ? getAccoladeWeekStart() : null;

  // Top-N query. Uses idx_leaderboard_metric_week_value (weekly path)
  // or idx_leaderboard_metric_value (non-weekly) for index-only range
  // scan; no full-table sort.
  // CROSS-LINK (parked): join hall_of_awakened to show finisher ordinal on the floor-100 crown — build when first real climber nears floor 100
  const topResult = weekly
    ? await env.DB.prepare(
        `SELECT u.alias AS alias, ls.current_value AS current_value,
                pps.arena_title AS arena_title,
                pps.bosses_slain_total AS bosses_slain
         FROM leaderboard_snapshots ls
         JOIN users u ON u.id = ls.user_id
         LEFT JOIN public_profile_summary pps ON pps.user_id = ls.user_id
         WHERE ls.metric = ? AND ls.week_start = ?
         ORDER BY ls.current_value DESC
         LIMIT ?`,
      )
        .bind(metric, currentWeek, limit)
        .all<TopRow>()
    : await env.DB.prepare(
        `SELECT u.alias AS alias, ls.current_value AS current_value,
                pps.arena_title AS arena_title,
                pps.bosses_slain_total AS bosses_slain
         FROM leaderboard_snapshots ls
         JOIN users u ON u.id = ls.user_id
         LEFT JOIN public_profile_summary pps ON pps.user_id = ls.user_id
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
    // W257 — null/undefined → client renders no chip (back/forward compatible)
    arena_title: row.arena_title ?? null,
    // W388 — lifetime boss kills (null when the hunter has no pps row yet)
    bosses_slain: row.bosses_slain ?? null,
  }));

  // Caller's row (if they've submitted this metric). For weekly metrics,
  // we additionally require the row's week_start to match the current
  // week -- otherwise the user is treated as "not yet ranked this week".
  const myRow = weekly
    ? await env.DB.prepare(
        `SELECT current_value FROM leaderboard_snapshots
         WHERE user_id = ? AND metric = ? AND week_start = ?`,
      )
        .bind(session.userId, metric, currentWeek)
        .first<MyRow>()
    : await env.DB.prepare(
        'SELECT current_value FROM leaderboard_snapshots WHERE user_id = ? AND metric = ?',
      )
        .bind(session.userId, metric)
        .first<MyRow>();

  let me: { rank: number; current_value: number } | null = null;
  if (myRow) {
    // Rank = count of rows with strictly higher current_value + 1.
    // Ties get the same rank as the first of the tie group. The same
    // weekly filter applies so the rank is computed against the same
    // population as `top`.
    const rankResult = weekly
      ? await env.DB.prepare(
          `SELECT COUNT(*) + 1 AS rank
           FROM leaderboard_snapshots
           WHERE metric = ? AND week_start = ? AND current_value > ?`,
        )
          .bind(metric, currentWeek, myRow.current_value)
          .first<RankRow>()
      : await env.DB.prepare(
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
