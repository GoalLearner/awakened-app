/**
 * week-board.ts — W658: the ONE durable per-week Steps board read.
 *
 * Extracted from leaderboard-recap.ts (W657) so the Week Recap and the
 * Leaderboard Archive share the same query. THE EROSION TRAP this exists to
 * avoid: leaderboard_snapshots holds ONE row per (user, metric) and is
 * overwritten in place as users resubmit in the new week — any past-week
 * read against it silently decays. weekly_step_records (migration 0009) is
 * the append-only, never-pruned per-week truth; the snapshot arm below is
 * only a fallback for rows not yet superseded (same family as /last-week
 * and the Hall of Fame). Real users only — sims are merged client-side.
 */
import type { Env } from '../env';

interface RecordRow {
  user_id: string;
  alias: string;
  steps: number;
  // W704 — avatar crest filename off public_profile_summary (null = never synced).
  avatar_id: string | null;
  // W706 — member card background
  card_bg: string | null;
  // W875 — rank chrome (tier ring / prestige ✦ / Founder mark), same live-pps
  // join the Hall of Fame uses; without these every archived row wears E.
  rank_tier: string | null;
  prestige: number | null;
  founder_seq: number | null;
}

interface MeRow {
  my_steps: number | null;
  total: number | null;
  above: number | null;
}

const TOP_LIMIT = 100;

// merged = weekly_step_records ∪ eligible leaderboard_snapshots, for ONE week,
// real users only, steps > 0. ?1 = the target week_start (reused).
export const MERGED_FOR_WEEK = `
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

/** Top rows + the caller's placement for ONE week, off the merged view. */
export async function readWeekBoard(env: Env, weekKey: string, userId: string): Promise<{
  records: Array<{ rank: number; alias: string; steps: number; avatar_id: string | null; card_bg: string | null;
    rankTier: string | null; prestige: number; founderSeq: number }>;
  me: { rank: number; steps: number } | null;
  total: number;
}> {
  const topResult = await env.DB.prepare(
    `${MERGED_FOR_WEEK}
     SELECT u.alias AS alias, m.steps AS steps, m.user_id AS user_id,
            pps.avatar_id AS avatar_id, pps.card_bg AS card_bg,
            pps.rank_tier AS rank_tier, pps.prestige_level AS prestige, pps.founder_seq AS founder_seq
       FROM merged m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN public_profile_summary pps ON pps.user_id = m.user_id
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
    avatar_id: r.avatar_id ?? null,   // W704 — row crest
    card_bg: r.card_bg ?? null,   // W706 — member card background
    rankTier: r.rank_tier ?? null,   // W875 — tier ring (hall-of-fame parity)
    prestige: r.prestige ?? 0,
    founderSeq: r.founder_seq ?? 0,
  }));
  const mySteps = meResult && typeof meResult.my_steps === 'number' ? meResult.my_steps : null;
  const me = (mySteps && mySteps > 0)
    ? { rank: (meResult && typeof meResult.above === 'number' ? meResult.above : 0) + 1, steps: mySteps }
    : null;
  const total = meResult && typeof meResult.total === 'number' ? meResult.total : records.length;
  return { records, me, total };
}
