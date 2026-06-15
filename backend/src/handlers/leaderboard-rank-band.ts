/**
 * Rank-band leaderboard (W319) — the "Hunters in your rank" cohort board.
 *
 * GET /v1/leaderboard/rank-band?limit=N
 *   Returns { tier, total, me, top[], near[] } scoped to the CALLER'S OWN
 *   rank tier: the strongest hunters who share that tier (ordered by power
 *   DESC), the caller's neighbourhood (±2 around their placement), and the
 *   caller's own placement. Aliases are JOINed live from `users`.
 *
 *   Cohort = `rank_tier` read from the caller's own public_profile_summary
 *   row. No new schema: reuses public_profile_summary.rank_tier / power /
 *   rank_label / avatar_id / arena_title, JOIN users for the live alias.
 *   No migration, no new binding (the read budget reuses RL_HALL_READ).
 *
 *   Trust model: identical to the other cosmetic boards — power and rank
 *   are client-submitted via the profile heartbeat (PUT public-profile-
 *   summary) and only range/shape-validated server-side. The board grants
 *   no rewards, so client-asserted values are acceptable.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

const DEFAULT_TOP = 25;
const MAX_TOP = 50;
const NEIGHBORS = 2; // ±N rows around the caller for the "your place" cluster

interface BandRow {
  user_id: string;
  alias: string;
  power: number;
  rank_label: string | null;
  rank_division: string | null;
  arena_title: string | null;
  avatar_id: string | null;
}
interface MeProfileRow {
  rank_tier: string;
  power: number;
}
interface CountRow {
  total: number;
}
interface HigherRow {
  higher: number;
}

function publicRow(r: BandRow, rank: number, meUserId: string) {
  return {
    rank,
    alias: r.alias,
    current_value: r.power || 0,
    rank_label: r.rank_label || null,
    arena_title: r.arena_title || null,
    avatar_id: r.avatar_id || null,
    you: r.user_id === meUserId,
  };
}

export async function handleRankBandGet(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_HALL_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  let topN = DEFAULT_TOP;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) topN = Math.min(parsed, MAX_TOP);
  }

  // The caller's band = their own rank_tier. If they have never sent a
  // profile heartbeat there is no row → empty board, handled gracefully.
  const meProfile = await env.DB.prepare(
    `SELECT rank_tier, power FROM public_profile_summary WHERE user_id = ?`,
  )
    .bind(session.userId)
    .first<MeProfileRow>();

  if (!meProfile || !meProfile.rank_tier) {
    return jsonOk({ tier: null, total: 0, me: null, top: [], near: [] });
  }
  const tier = meProfile.rank_tier;
  const mePower = meProfile.power || 0;

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM public_profile_summary WHERE rank_tier = ?`,
  )
    .bind(tier)
    .first<CountRow>();
  const total = countRow?.total ?? 0;

  // Top-N of the band, strongest first. server_updated_at ASC is a stable
  // tiebreaker so the OFFSET-based neighbourhood paging below is deterministic.
  const topResult = await env.DB.prepare(
    `SELECT p.user_id AS user_id, u.alias AS alias, p.power AS power,
            p.rank_label AS rank_label, p.rank_division AS rank_division,
            p.arena_title AS arena_title, p.avatar_id AS avatar_id
     FROM public_profile_summary p
     JOIN users u ON u.id = p.user_id
     WHERE p.rank_tier = ?
     ORDER BY p.power DESC, p.server_updated_at ASC
     LIMIT ?`,
  )
    .bind(tier, topN)
    .all<BandRow>();
  const top = (topResult.results ?? []).map((r, i) => publicRow(r, i + 1, session.userId));

  // Caller's placement within the band = (count strictly stronger) + 1.
  // Mirrors leaderboard-top.ts's COUNT(*) WHERE value > mine rank logic.
  const higherRow = await env.DB.prepare(
    `SELECT COUNT(*) AS higher FROM public_profile_summary
     WHERE rank_tier = ? AND power > ?`,
  )
    .bind(tier, mePower)
    .first<HigherRow>();
  const meRank = (higherRow?.higher ?? 0) + 1;

  // Neighbourhood (±NEIGHBORS) only when the caller sits below the top block
  // (otherwise `top` already shows them). The ±2 window absorbs tie jitter
  // between the count-based rank and the OFFSET position.
  let near: ReturnType<typeof publicRow>[] = [];
  if (meRank > topN) {
    const offset = Math.max(0, meRank - NEIGHBORS - 1);
    const nearResult = await env.DB.prepare(
      `SELECT p.user_id AS user_id, u.alias AS alias, p.power AS power,
              p.rank_label AS rank_label, p.rank_division AS rank_division,
              p.arena_title AS arena_title, p.avatar_id AS avatar_id
       FROM public_profile_summary p
       JOIN users u ON u.id = p.user_id
       WHERE p.rank_tier = ?
       ORDER BY p.power DESC, p.server_updated_at ASC
       LIMIT ? OFFSET ?`,
    )
      .bind(tier, NEIGHBORS * 2 + 1, offset)
      .all<BandRow>();
    near = (nearResult.results ?? []).map((r, i) => publicRow(r, offset + i + 1, session.userId));
  }

  return jsonOk({
    tier,
    total,
    me: { rank: meRank, current_value: mePower },
    top,
    near,
  });
}
