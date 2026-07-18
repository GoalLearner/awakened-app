/**
 * GET /v1/leaderboard/step-100k-club?limit=N
 *
 * Authenticated endpoint. Returns the roster of real users who have
 * earned the 100K Step Club accolade (recorded 100,000+ verified
 * steps in a single Sunday-UTC week), plus the caller's personal
 * membership status. Companion surface to:
 *   - /v1/leaderboard/top              (current-week ranking)
 *   - /v1/leaderboard/hall-of-fame     (all-time top weekly totals)
 *
 * This board is the "exclusive prestige" view — only real users who
 * crossed the 100,000-step weekly threshold appear. Sim/test users
 * (apple_sub LIKE 'sim_test_%') are filtered both at the write
 * boundary (leaderboard-submit's 100K branch refuses to award the
 * accolade to sim users) and again here at read time as defense in
 * depth. Sim filler in `simulated-leaderboard.js` is capped at
 * 45,555 / week so sims could never qualify even client-side.
 *
 * Data source: `user_accolades` table (one row per (user, accolade_type)).
 * Alias is JOINed live from `users.alias` so name changes flow through.
 *
 * Response shape:
 *   {
 *     type: "step_100k_club",
 *     members: [
 *       {
 *         rank: 1,
 *         alias: "Richie",
 *         best_value: 104821,
 *         unlock_week_start: "2026-05-17",
 *         unlock_week_end:   "2026-05-23",
 *         repeat_count: 2,
 *         last_qualified_week_start: "2026-05-17",
 *         last_qualified_week_end:   "2026-05-23",
 *         unlocked_at: 1760000000000
 *       }, ...
 *     ],
 *     me: { rank, best_value, unlock_week_start, repeat_count } | null
 *   }
 *
 * Ordering: best_value DESC, repeat_count DESC, unlocked_at ASC.
 *   - Highest single-week total wins outright.
 *   - Ties at best_value: more repeat qualifications break first.
 *   - Ties at both: earliest unlocker wins (first-to-the-summit).
 *
 * Rank semantic: rank for the caller is computed as
 * `COUNT(*) WHERE best_value > me.best_value + 1`, matching the
 * stable-tie convention used by /top + /hall-of-fame. Ties at the
 * same best_value all receive the same rank number.
 *
 * Rate limit: RL_LEADERBOARD_STEP_100K_CLUB (wrangler.toml
 * namespace_id 1013), 30/min per user — mirrors the HoF read budget.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

const ACCOLADE_TYPE = 'step_100k_club';
const SIM_APPLE_SUB_PREFIX = 'sim_test_';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface MemberRow {
  alias: string;
  best_value: number;
  unlock_week_start: string;
  repeat_count: number;
  last_qualified_week_start: string;
  unlocked_at: number;
  // W704 — avatar crest filename off public_profile_summary (null = never synced).
  avatar_id: string | null;
  // W706 — member card background
  card_bg: string | null;
  // W713 — tier-colored crest ring + number, prestige ✦, Founder mark (main-board parity).
  rank_tier: string | null;
  prestige: number | null;
  founder_seq: number | null;
}

interface MyRow {
  best_value: number;
  unlock_week_start: string;
  repeat_count: number;
}

interface RankRow {
  rank: number;
}

/**
 * Returns Saturday-UTC YYYY-MM-DD from the Sunday-UTC week_start.
 * Pure date math; same helper shape used by hall-of-fame.ts.
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

export async function handleStep100kClub(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_STEP_100K_CLUB.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many 100K Club requests. Slow down.');
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  // Top-N members. JOIN users for live alias. Filter sims defensively
  // (the write path in leaderboard-submit already refuses to award
  // the accolade to sim users, but a future schema migration or
  // backfill could introduce sim rows — keep the filter here so the
  // read path is correct in isolation).
  const topResult = await env.DB.prepare(
    `SELECT u.alias                       AS alias,
            ua.best_value                 AS best_value,
            ua.unlock_week_start          AS unlock_week_start,
            ua.repeat_count               AS repeat_count,
            ua.last_qualified_week_start  AS last_qualified_week_start,
            ua.unlocked_at                AS unlocked_at,
            pps.avatar_id                 AS avatar_id,
            pps.card_bg                   AS card_bg,
            pps.rank_tier                 AS rank_tier,
            pps.prestige_level            AS prestige,
            pps.founder_seq               AS founder_seq
     FROM user_accolades ua
     JOIN users u ON u.id = ua.user_id
     LEFT JOIN public_profile_summary pps ON pps.user_id = ua.user_id
     WHERE ua.accolade_type = ?
       AND u.apple_sub NOT LIKE 'sim_test_%'
     ORDER BY ua.best_value DESC,
              ua.repeat_count DESC,
              ua.unlocked_at ASC
     LIMIT ?`,
  )
    .bind(ACCOLADE_TYPE, limit)
    .all<MemberRow>();

  const members = (topResult.results ?? []).map((row, i) => ({
    rank: i + 1,
    alias: row.alias,
    best_value: row.best_value,
    unlock_week_start: row.unlock_week_start,
    unlock_week_end:   weekEndFromStart(row.unlock_week_start),
    repeat_count: row.repeat_count,
    last_qualified_week_start: row.last_qualified_week_start,
    last_qualified_week_end:   weekEndFromStart(row.last_qualified_week_start),
    unlocked_at: row.unlocked_at,
    avatar_id: row.avatar_id ?? null,   // W704 — row crest
    card_bg: row.card_bg ?? null,   // W706 — member card background
    rankTier: row.rank_tier ?? null,       // W713 — tier-colored crest ring + number
    prestige: row.prestige ?? 0,
    founderSeq: row.founder_seq ?? 0,
  }));

  // Caller's membership row (if they're a member). Defensively
  // filters the sim prefix even though the write path blocks sim
  // users -- the caller is the authenticated user, so this is a
  // belt-and-suspenders check.
  const myRow = await env.DB.prepare(
    `SELECT ua.best_value         AS best_value,
            ua.unlock_week_start  AS unlock_week_start,
            ua.repeat_count       AS repeat_count
     FROM user_accolades ua
     JOIN users u ON u.id = ua.user_id
     WHERE ua.user_id = ?
       AND ua.accolade_type = ?
       AND u.apple_sub NOT LIKE 'sim_test_%'`,
  )
    .bind(session.userId, ACCOLADE_TYPE)
    .first<MyRow>();

  let me: {
    rank: number;
    best_value: number;
    unlock_week_start: string;
    unlock_week_end: string;
    repeat_count: number;
  } | null = null;
  if (myRow) {
    // Rank = count of members with strictly higher best_value, + 1.
    // Same stable-tie convention as /top and /hall-of-fame.
    const rankResult = await env.DB.prepare(
      `SELECT COUNT(*) + 1 AS rank
       FROM user_accolades ua
       JOIN users u ON u.id = ua.user_id
       WHERE ua.accolade_type = ?
         AND u.apple_sub NOT LIKE 'sim_test_%'
         AND ua.best_value > ?`,
    )
      .bind(ACCOLADE_TYPE, myRow.best_value)
      .first<RankRow>();
    me = {
      rank: rankResult?.rank ?? -1,
      best_value: myRow.best_value,
      unlock_week_start: myRow.unlock_week_start,
      unlock_week_end:   weekEndFromStart(myRow.unlock_week_start),
      repeat_count: myRow.repeat_count,
    };
  }

  return jsonOk({ type: ACCOLADE_TYPE, members, me });
}
