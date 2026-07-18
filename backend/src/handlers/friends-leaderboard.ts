/**
 * Friends leaderboard (W320) — "Steps this week, among your friends".
 *
 * GET /v1/friends/leaderboard?metric=step_total&limit=N
 *   Ranks the caller's accepted-friends-UNION-self set by their current-week
 *   value for a weekly metric (step_total by default; flights_climbed also
 *   allowed). Returns { metric, weekStart, total, me, rows[] }.
 *
 *   The friend set reuses the exact accepted-edges-UNION-self pattern from
 *   handleFriendsActivityGet (GET /v1/friends/activity). A LEFT JOIN onto
 *   leaderboard_snapshots (metric + current week_start) means EVERY accepted
 *   friend + self appears even with no steps this week (COALESCE 0) — so the
 *   board shows your whole roster, not just the active steppers. No sim
 *   filler: friends are real people you added; fabricating "friends" would be
 *   a lie. Week boundary is the single-sourced Sunday-Pacific key
 *   (getAccoladeWeekStart), identical to the global Steps board.
 *
 *   No new schema, no new binding (reuses RL_FRIENDS_READ). Trust model
 *   matches the global step board (client-submitted, range-validated values).
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { getAccoladeWeekStart } from '../lib/accolade-week';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
// Only weekly metrics make sense for a "this week among friends" board.
const ALLOWED_METRICS = new Set(['step_total', 'flights_climbed']);

interface FriendRow {
  user_id: string;
  alias: string;
  current_value: number;
  rank_label: string | null;
  arena_title: string | null;
  avatar_id: string | null;
  card_bg: string | null;
  rank_tier: string | null;
  prestige: number | null;
  founder_seq: number | null;
}

export async function handleFriendsLeaderboardGet(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  }

  const url = new URL(request.url);
  let metric = url.searchParams.get('metric') || 'step_total';
  if (!ALLOWED_METRICS.has(metric)) metric = 'step_total';

  const limitParam = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) limit = Math.min(parsed, MAX_LIMIT);
  }

  const weekStart = getAccoladeWeekStart();

  // accepted-friends-UNION-self, LEFT JOINed to this week's snapshot so
  // every member appears (0 if they have no steps this week). ?3 = caller's
  // user_id, reused in the self clause + the friend-edge subquery.
  const result = await env.DB.prepare(
    `SELECT u.id AS user_id, u.alias AS alias,
            COALESCE(ls.current_value, 0) AS current_value,
            p.rank_label AS rank_label, p.arena_title AS arena_title, p.avatar_id AS avatar_id, p.card_bg AS card_bg,
            p.rank_tier AS rank_tier, p.prestige_level AS prestige, p.founder_seq AS founder_seq
       FROM users u
       LEFT JOIN leaderboard_snapshots ls
         ON ls.user_id = u.id AND ls.metric = ?1 AND ls.week_start = ?2
       LEFT JOIN public_profile_summary p ON p.user_id = u.id
      WHERE u.id = ?3
         OR u.id IN (
             SELECT CASE WHEN f.requester_user_id = ?3
                         THEN f.recipient_user_id
                         ELSE f.requester_user_id END
               FROM friends f
              WHERE f.status = 'accepted'
                AND (f.requester_user_id = ?3 OR f.recipient_user_id = ?3)
           )
      ORDER BY current_value DESC, u.alias ASC
      LIMIT ?4`,
  )
    .bind(metric, weekStart, session.userId, limit)
    .all<FriendRow>();

  const rowsRaw = result.results ?? [];
  let meRank = 0;
  let meValue = 0;
  const rows = rowsRaw.map((r, i) => {
    const you = r.user_id === session.userId;
    if (you) {
      meRank = i + 1;
      meValue = r.current_value || 0;
    }
    return {
      rank: i + 1,
      alias: r.alias,
      current_value: r.current_value || 0,
      rank_label: r.rank_label || null,
      arena_title: r.arena_title || null,
      avatar_id: r.avatar_id || null,
      card_bg: r.card_bg || null,   // W706 — member card background
      rankTier: r.rank_tier || undefined,
      prestige: r.prestige ?? 0,
      founderSeq: r.founder_seq ?? 0,
      you,
    };
  });

  return jsonOk({
    metric,
    weekStart,
    total: rows.length,
    me: meRank > 0 ? { rank: meRank, current_value: meValue } : null,
    rows,
  });
}
