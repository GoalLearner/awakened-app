/**
 * GET /v1/users/:alias/profile — public profile card data (W-next).
 *
 * Returns the bundle the tap-a-name profile card renders, for ANY user by
 * alias (case-insensitive): rank, power, avatar, equipped title, boss kills,
 * ultra-rare drops, verified streak, avg steps/day (latest week ÷ 7), and
 * best Ascent floor. All already-public or cosmetic — exact rank_points (XP)
 * is deliberately NOT selected, matching the friends-read privacy line.
 *
 * Data is client-authoritative (same trust model as the leaderboard/titles).
 * 404 when no user owns that alias. Sim bots have no row here — the client
 * synthesizes their card from bot personality instead of calling this.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

interface ProfileRow {
  alias: string;
  rank_label: string | null;
  rank_tier: string | null;
  prestige: number | null;   // W453 — Prestige star count (S+ endgame)
  power: number | null;
  avatar_id: string | null;
  founder_seq: number | null;   // W656 — free Founder marker number (null = none)
  arena_title: string | null;
  bosses_slain_total: number | null;
  ultra_rare_drops_total: number | null;
  verified_streak_label: string | null;
  step_week: number | null;
  avg_steps_per_day: number | null;
  best_floor: number | null;
  club_100k_repeat: number | null;
  club_100k_best: number | null;
  combatant_json: string | null;
  arena_elo: number | null;
  arena_pg: number | null;          // placement_games this season (placed once >= 5)
  arena_above: number | null;       // # of placed hunters above this ELO → global rank = +1
}

const PVP_PLACEMENT_GAMES = 5;      // a hunter is "placed" (shows a rank) once placement_games hits this

export async function handlePublicProfileGet(
  request: Request,
  env: Env,
  session: SessionPayload,
  alias: string,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  }

  const decoded = (() => { try { return decodeURIComponent(alias); } catch (_) { return alias; } })();
  if (!decoded || decoded.length > 40) {
    return jsonError(400, 'INVALID_ALIAS', 'alias missing or too long.');
  }

  const row = await env.DB.prepare(
    `SELECT u.alias AS alias,
            pps.rank_label AS rank_label, pps.rank_tier AS rank_tier,
            pps.prestige_level AS prestige,
            pps.power AS power, pps.avatar_id AS avatar_id, pps.arena_title AS arena_title,
            pps.founder_seq AS founder_seq,
            pps.bosses_slain_total AS bosses_slain_total,
            pps.ultra_rare_drops_total AS ultra_rare_drops_total,
            pps.verified_streak_label AS verified_streak_label,
            pps.avg_steps_per_day AS avg_steps_per_day,
            pps.combatant_json AS combatant_json,
            (SELECT current_value FROM leaderboard_snapshots
              WHERE user_id = u.id AND metric = 'step_total'
              ORDER BY week_start DESC LIMIT 1) AS step_week,
            (SELECT best_value FROM leaderboard_snapshots
              WHERE user_id = u.id AND metric = 'floor_best' LIMIT 1) AS best_floor,
            (SELECT repeat_count FROM user_accolades
              WHERE user_id = u.id AND accolade_type = 'step_100k_club' LIMIT 1) AS club_100k_repeat,
            (SELECT best_value FROM user_accolades
              WHERE user_id = u.id AND accolade_type = 'step_100k_club' LIMIT 1) AS club_100k_best,
            pr.elo AS arena_elo,
            pr.placement_games AS arena_pg,
            (SELECT COUNT(*) FROM pvp_ratings r2
              WHERE r2.elo > pr.elo AND r2.placement_games >= ${PVP_PLACEMENT_GAMES}) AS arena_above
     FROM users u
     LEFT JOIN public_profile_summary pps ON pps.user_id = u.id
     LEFT JOIN pvp_ratings pr ON pr.user_id = u.id
     WHERE LOWER(u.alias) = LOWER(?)
     LIMIT 1`,
  )
    .bind(decoded)
    .first<ProfileRow>();

  if (!row) {
    return jsonError(404, 'NOT_FOUND', 'No hunter with that alias.');
  }

  const stepWeek = Number(row.step_week || 0);
  // W440 — the published loadout snapshot powers "Duel a Friend's Echo". Null when unpublished
  // (older client / not yet synced) → the profile card hides the Spar-Echo button.
  let combatant: unknown = null;
  try { if (row.combatant_json) combatant = JSON.parse(row.combatant_json); } catch (_) { /* corrupt → no echo */ }
  // W444 — Arena Rating row (ClaudeDesign Hunter Profile refresh). Server-authoritative from
  // pvp_ratings (no client publish). Only surfaced once the hunter is PLACED this season, so an
  // unplaced/never-dueled hunter shows no rank line. Client derives tier/progress/to-next from elo.
  const arenaElo = row.arena_elo != null ? Number(row.arena_elo) : null;
  const arenaPlaced = arenaElo != null && Number(row.arena_pg || 0) >= PVP_PLACEMENT_GAMES;
  const arena = arenaPlaced
    ? { elo: arenaElo, global: Number(row.arena_above || 0) + 1, season: 1 }
    : null;
  return jsonOk({
    alias: row.alias,
    combatant,
    canEcho: !!combatant,
    arena,
    rankLabel: row.rank_label,
    rankTier: row.rank_tier,
    prestige: row.prestige ?? 0,
    power: row.power ?? 0,
    avatarId: row.avatar_id,                       // null → client falls back to class default
    founderSeq: row.founder_seq ?? null,           // W656 — Founder # (prestige badge)
    arenaTitle: row.arena_title,
    bossesSlain: row.bosses_slain_total ?? 0,
    ultraRareDrops: row.ultra_rare_drops_total ?? 0,
    verifiedStreakLabel: row.verified_streak_label,
    avgStepsPerDay: row.avg_steps_per_day || Math.round(stepWeek / 7),
    bestFloor: row.best_floor ?? 0,
    club100k: row.club_100k_repeat != null
      ? { repeatCount: Number(row.club_100k_repeat) || 1, best: Number(row.club_100k_best) || 0 }
      : null,
  });
}
