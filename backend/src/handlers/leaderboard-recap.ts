/**
 * W657 — Week Recap (the Sunday ceremony).
 *
 *   GET  /v1/leaderboard/recap        — last week's final standings + the
 *                                       caller's personal recap blocks
 *   POST /v1/leaderboard/recap/seen   — mark the recap dismissed ({week})
 *
 * The recap is a DISPLAY layer over data that already persists. Nothing
 * pauses at the week boundary — scoring, habits, streaks and the live board
 * all continue; this endpoint just lets the client hold a one-time ceremony
 * for the week that finished.
 *
 * DATA SOURCE (the trap this deliberately avoids): leaderboard_snapshots
 * holds ONE row per (user, metric) and is overwritten in place as users
 * resubmit in the new week — it ERODES within hours of the boundary. All
 * week-scoped reads here use the same merged view as /last-week and the
 * Hall of Fame: weekly_step_records (append-only, one row per user-week,
 * never pruned) UNION eligible snapshot rows not yet superseded. Real users
 * only — sims have no rows and are merged client-side, deterministically,
 * exactly like the live board.
 *
 * Seen-flag: users.recap_seen_week (migration 0032) — the high-water Sunday
 * key the user has dismissed. Server-authoritative; persists until seen; a
 * user who misses N weeks gets only the most recent finished week (a single
 * high-water value models that exactly).
 *
 * Step Crown: rank-1 callers are credited the 'weekly_step_champion'
 * accolade through lib/weekly-champion.ts — the SAME idempotent path
 * /last-week uses, so viewing the recap and the recap strip can never
 * double-grant a crown for one week (proven by weekly-champion.itest).
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { getAccoladeWeekStart, priorWeekStart, weekEndFromStart } from '../lib/accolade-week';
import { grantWeeklyChampionIfEarned } from '../lib/weekly-champion';

const TOP_LIMIT = 100;          // plenty for podium + movement + near-miss math

interface RecordRow {
  user_id: string;
  alias: string;
  steps: number;
}

interface MeRow {
  my_steps: number | null;
  total: number | null;
  above: number | null;
}

// merged = weekly_step_records ∪ eligible leaderboard_snapshots, for ONE week,
// real users only, steps > 0. ?1 = the target week_start (reused). Same CTE
// family as /last-week + Hall of Fame (the durable, non-eroding view).
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

/** Own-history ordinal at week close. ?1 user_id, ?2 the finished week's
 *  steps, ?3 the finished week key — rows AFTER the celebrated week (i.e. the
 *  in-progress current week) and zero-step rows are excluded. Exported so the
 *  real-SQL itest proves the bounds against actual SQLite. */
export const RECAP_MY_HISTORY_SQL = `WITH my_rows AS (
   SELECT week_start, steps FROM weekly_step_records
    WHERE user_id = ?1 AND week_start <= ?3 AND steps > 0
   UNION ALL
   SELECT ls.week_start, ls.current_value AS steps
     FROM leaderboard_snapshots ls
    WHERE ls.user_id = ?1 AND ls.metric = 'step_total'
      AND ls.week_start IS NOT NULL AND ls.week_start <= ?3 AND ls.current_value > 0
      AND NOT EXISTS (
        SELECT 1 FROM weekly_step_records w
        WHERE w.user_id = ?1 AND w.week_start = ls.week_start
      )
 )
 SELECT (SELECT COUNT(*) FROM my_rows WHERE steps > ?2) + 1 AS ordinal,
        (SELECT COUNT(*) FROM my_rows)                      AS totalWeeks`;

/** Top rows + the caller's placement for ONE week, off the merged view. */
async function readWeekBoard(env: Env, weekKey: string, userId: string): Promise<{
  records: Array<{ rank: number; alias: string; steps: number }>;
  me: { rank: number; steps: number } | null;
  total: number;
}> {
  const topResult = await env.DB.prepare(
    `${MERGED_FOR_WEEK}
     SELECT u.alias AS alias, m.steps AS steps, m.user_id AS user_id
       FROM merged m
       JOIN users u ON u.id = m.user_id
      ORDER BY m.steps DESC, u.alias ASC
      LIMIT ?2`,
  )
    .bind(weekKey, TOP_LIMIT)
    .all<RecordRow>();

  const meResult = await env.DB.prepare(
    `${MERGED_FOR_WEEK}
     SELECT (SELECT steps FROM merged WHERE user_id = ?2)                                          AS my_steps,
            (SELECT COUNT(*) FROM merged)                                                          AS total,
            (SELECT COUNT(*) FROM merged WHERE steps > (SELECT steps FROM merged WHERE user_id = ?2)) AS above`,
  )
    .bind(weekKey, userId)
    .first<MeRow>();

  const records = (topResult.results ?? []).map((r, i) => ({
    rank: i + 1,
    alias: r.alias,
    steps: r.steps,
  }));
  const mySteps = meResult && typeof meResult.my_steps === 'number' ? meResult.my_steps : null;
  const me = (mySteps && mySteps > 0)
    ? { rank: (meResult && typeof meResult.above === 'number' ? meResult.above : 0) + 1, steps: mySteps }
    : null;
  const total = meResult && typeof meResult.total === 'number' ? meResult.total : records.length;
  return { records, me, total };
}

export async function handleLeaderboardRecapGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_HOF.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  }

  const currentWeek = getAccoladeWeekStart();
  const week = priorWeekStart(currentWeek);      // the finished week being celebrated
  const prevWeek = priorWeekStart(week);         // the week before it (movement baseline)

  // Eligibility + seen in one read. Accounts created THIS week have no prior
  // week as a user → no recap (brand-new users go straight to the live board).
  const u = await env.DB.prepare(
    'SELECT created_at, recap_seen_week FROM users WHERE id = ? LIMIT 1',
  )
    .bind(session.userId)
    .first<{ created_at: number; recap_seen_week: string | null }>();
  if (!u) return jsonError(404, 'NOT_FOUND', 'No such user.');

  const createdWeek = getAccoladeWeekStart(Number(u.created_at) || 0);
  if (createdWeek >= currentWeek) {
    return jsonOk({ eligible: false, seen: true, week, weekEnd: weekEndFromStart(week) });
  }
  const seen = !!(u.recap_seen_week && u.recap_seen_week >= week);

  // The finished week's final board + the caller's row (merged durable view).
  const board = await readWeekBoard(env, week, session.userId);

  // Movement baseline: the caller's placement the week BEFORE. Board rows for
  // prevWeek ship too (capped) so the client can recompute movement + the
  // week-over-week "pass" line after its deterministic sim merge.
  const prevBoard = await readWeekBoard(env, prevWeek, session.userId);

  // "Your second-best week" — ordinal of the finished week's total within the
  // caller's OWN history AT WEEK CLOSE (own rows only; sims never affect this).
  // W657 review fix — both arms are bounded to weeks <= the celebrated week and
  // to positive totals: the launch sync submits the CURRENT week's running
  // total BEFORE the recap GET fires, and an unbounded merge would let that
  // in-progress row demote "your best week yet." to "second-best" (and a
  // zero-step row would inflate totalWeeks past the vacuous-claim gate).
  // Deliberately diverges from the Hall of Fame me_best merge, where including
  // the live week is correct for an all-time record book.
  let myHistory: { ordinal: number; totalWeeks: number } | null = null;
  if (board.me) {
    const hist = await env.DB.prepare(RECAP_MY_HISTORY_SQL)
      .bind(session.userId, board.me.steps, week)
      .first<{ ordinal: number; totalWeeks: number }>();
    if (hist) {
      myHistory = {
        ordinal: Number(hist.ordinal) || 1,
        totalWeeks: Number(hist.totalWeeks) || 1,
      };
    }
  }

  // Step Crown — same idempotent path as /last-week (lib/weekly-champion.ts).
  // Re-viewing the recap, or viewing recap AND the last-week strip, can never
  // double-count a week.
  const myTitle = await grantWeeklyChampionIfEarned(
    env,
    session.userId,
    week,
    board.me ? board.me.rank : null,
    board.me ? board.me.steps : null,
  );

  return jsonOk({
    eligible: true,
    seen,
    week,
    weekEnd: weekEndFromStart(week),
    total: board.total,
    records: board.records,
    me: board.me,
    prev: { week: prevWeek, records: prevBoard.records, me: prevBoard.me },
    myHistory,
    myTitle,
  });
}

interface SeenBody {
  week?: unknown;
}

/** Exported so the real-SQL test proves the high-water semantics (monotonic,
 *  never lowered) against actual SQLite. Bind order: week, user_id. */
export const RECAP_SEEN_UPDATE_SQL =
  `UPDATE users SET recap_seen_week = MAX(COALESCE(recap_seen_week, ''), ?) WHERE id = ?`;

export async function handleLeaderboardRecapSeenPost(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_HOF.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  }

  let body: SeenBody;
  try {
    body = (await request.json()) as SeenBody;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const week = typeof body?.week === 'string' ? body.week : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return jsonError(400, 'INVALID_WEEK', 'week must be YYYY-MM-DD.');
  }
  // Can only mark finished weeks — the newest markable key is the week that
  // just ended. (Guards a client clock ahead of the server minting a future
  // high-water mark that would swallow the NEXT week's unseen recap.)
  const newestMarkable = priorWeekStart(getAccoladeWeekStart());
  if (week > newestMarkable) {
    return jsonError(400, 'INVALID_WEEK', 'week is not finished yet.');
  }

  // Monotonic high-water: never lowered. MAX over ISO date strings is safe
  // (lexicographic == chronological). A stale/duplicate POST is a no-op.
  await env.DB.prepare(RECAP_SEEN_UPDATE_SQL)
    .bind(week, session.userId)
    .run();

  const row = await env.DB.prepare(
    'SELECT recap_seen_week FROM users WHERE id = ? LIMIT 1',
  )
    .bind(session.userId)
    .first<{ recap_seen_week: string | null }>();

  return jsonOk({ recap_seen_week: row?.recap_seen_week ?? week });
}
