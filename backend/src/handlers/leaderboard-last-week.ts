/**
 * Last week's step standings (W321) — the retention recap.
 *
 * GET /v1/leaderboard/last-week
 *   Returns last week's final step standings (the champion + the caller's
 *   placement), powering the "you placed #N last week — beat the champion
 *   this week" loss-aversion hook on the weekly Steps board.
 *
 *   NO new table and NO Worker cron: last week's per-user totals are ALREADY
 *   bucketed in weekly_step_records (migration 0009), and once the Sunday-
 *   Pacific boundary rolls over the prior week's rows are effectively frozen
 *   (new submits stamp the CURRENT week_start, never the old one). So "last
 *   week's final standings" is a pure read of a completed bucket. Mirrors the
 *   Hall of Fame `merged` CTE (weekly_step_records UNION eligible
 *   leaderboard_snapshots, sim users excluded) but filtered to a single
 *   week_start = (current Pacific week − 7 days).
 *
 *   Read-only; no badge writes (a persistent auto-awarded "weekly champion"
 *   accolade is a separate follow-up that would need a scheduled finalizer).
 *   Reuses RL_LEADERBOARD_HOF. step_total only (the weekly metric).
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { getAccoladeWeekStart } from '../lib/accolade-week';
import { grantWeeklyChampionIfEarned } from '../lib/weekly-champion';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface RecordRow {
  user_id: string;
  alias: string;
  steps: number;
  // W704 — avatar crest filename off public_profile_summary (null = never synced).
  avatar_id: string | null;
  // W706 — member card background
  card_bg: string | null;
}

interface MeRow {
  my_steps: number | null;
  total: number | null;
  above: number | null;
}

// Sunday-Pacific week_start of the week BEFORE `weekStart`. Pure date math:
// a fixed 7-day step in ms is exactly 7 calendar days off a UTC-midnight
// anchor (no DST hazard — the anchor is date-only).
function priorWeekStart(weekStart: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!m) return weekStart;
  const ms = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) - 7 * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

function weekEndFromStart(weekStart: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!m) return weekStart;
  const ms = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) + 6 * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

// merged = weekly_step_records ∪ eligible leaderboard_snapshots, for ONE week,
// real users only, steps > 0. ?1 = the target week_start (reused).
const MERGED_FOR_WEEK = `
  WITH merged AS (
    SELECT user_id, steps FROM weekly_step_records WHERE week_start = ?1 AND steps > 0
    UNION ALL
    SELECT ls.user_id, ls.current_value AS steps
      FROM leaderboard_snapshots ls
      JOIN users u ON u.id = ls.user_id
     WHERE ls.metric = 'step_total' AND ls.week_start = ?1 AND ls.current_value > 0
       AND u.apple_sub NOT LIKE 'sim_test_%'
       AND NOT EXISTS (
         SELECT 1 FROM weekly_step_records w WHERE w.user_id = ls.user_id AND w.week_start = ?1
       )
  )`;

export async function handleLeaderboardLastWeek(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_HOF.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) limit = Math.min(parsed, MAX_LIMIT);
  }

  const lastWeek = priorWeekStart(getAccoladeWeekStart());

  // Top-N final standings for last week.
  const topResult = await env.DB.prepare(
    `${MERGED_FOR_WEEK}
     SELECT u.alias AS alias, m.steps AS steps, m.user_id AS user_id,
            pps.avatar_id AS avatar_id, pps.card_bg AS card_bg
       FROM merged m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN public_profile_summary pps ON pps.user_id = m.user_id
      ORDER BY m.steps DESC, u.alias ASC
      LIMIT ?2`,
  )
    .bind(lastWeek, limit)
    .all<RecordRow>();

  // Caller's placement + the field size, computed across the whole week.
  const meResult = await env.DB.prepare(
    `${MERGED_FOR_WEEK}
     SELECT (SELECT steps FROM merged WHERE user_id = ?2)                                          AS my_steps,
            (SELECT COUNT(*) FROM merged)                                                          AS total,
            (SELECT COUNT(*) FROM merged WHERE steps > (SELECT steps FROM merged WHERE user_id = ?2)) AS above`,
  )
    .bind(lastWeek, session.userId)
    .first<MeRow>();

  const records = (topResult.results ?? []).map((r, i) => ({
    rank: i + 1,
    alias: r.alias,
    steps: r.steps,
    avatar_id: r.avatar_id ?? null,   // W704 — row crest
    card_bg: r.card_bg ?? null,   // W706 — member card background
  }));
  const champion = records.length > 0 ? { alias: records[0].alias, steps: records[0].steps } : null;

  const mySteps = meResult && typeof meResult.my_steps === 'number' ? meResult.my_steps : null;
  const total = meResult && typeof meResult.total === 'number' ? meResult.total : records.length;
  const me = (mySteps && mySteps > 0)
    ? { rank: (meResult && typeof meResult.above === 'number' ? meResult.above : 0) + 1, steps: mySteps }
    : null;

  // W322 — lazy weekly-champion badge. If the caller topped last week
  // (rank 1, real steps), credit the persistent 'weekly_step_champion'
  // accolade. W657 — extracted to lib/weekly-champion.ts so the Week Recap
  // endpoint shares the SAME idempotent SQL: viewing this strip AND the
  // recap ceremony can never double-count a week's crown.
  const myTitle = await grantWeeklyChampionIfEarned(
    env, session.userId, lastWeek, me ? me.rank : null, me ? me.steps : null,
  );

  return jsonOk({
    metric: 'step_total',
    weekStart: lastWeek,
    weekEnd: weekEndFromStart(lastWeek),
    total,
    champion,
    me,
    records,
    myTitle,
  });
}
