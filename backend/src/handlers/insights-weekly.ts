/**
 * GET /v1/insights/weekly
 *
 * MEMBERS-ONLY. Returns the caller's weekly-step PERCENTILE standing — the one
 * thing the client can't compute for itself (it has no view of other hunters).
 * Everything else on the "Your Weekly Awakening" members screen is assembled
 * client-side from local data; this endpoint fills only the Standing card.
 *
 * Two percentiles for the CURRENT Sunday-UTC week:
 *   - global : where you rank among ALL real hunters who've moved this week
 *   - cohort : where you rank among hunters of your OWN rank tier
 *
 * Sparse-pool guard: percentiles over a tiny field are misleading ("top 50%
 * of 2 hunters"), so each carries a `lowConfidence` flag when the pool is
 * under a floor — the client softens the copy ("Among the Awakened") rather
 * than print a fake number. Sim/test users (apple_sub LIKE 'sim_test_%') are
 * excluded from every count.
 *
 * Response:
 *   {
 *     week: "2026-07-13",
 *     me: {
 *       weekTotal: 142837,
 *       rankTier: "B",
 *       global: { topPct: 8, beatPct: 92, size: 431, lowConfidence: false },
 *       cohort: { beatPct: 88, size: 96, lowConfidence: false } | null
 *     } | null   // null = caller hasn't submitted steps this week (client renders local-only)
 *   }
 *
 * Rate limit: RL_INSIGHTS_READ (wrangler.toml namespace_id 1024), 30/min.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { getAccoladeWeekStart } from '../lib/accolade-week';
import { readEntitlements } from './iap-entitlements';

const METRIC = 'step_total';
// Percentile confidence floors. Below these the pool is too small for a
// percentile to mean anything, so the client shows soft copy instead.
const MIN_GLOBAL_POOL = 30;
const MIN_COHORT_POOL = 8;

interface ValRow { current_value: number; }
interface TierRow { rank_tier: string | null; }
interface CountRow { total: number; below: number; }

/**
 * beatPct = share of OTHER hunters you outpaced (0–100).
 * topPct  = your bracket from the top (1–100), i.e. 100 − beatPct, floored at 1.
 * A pool of 1 (just you) is trivially "top 1%".
 */
function pctify(below: number, total: number): { topPct: number; beatPct: number } {
  if (total <= 1) return { topPct: 1, beatPct: 100 };
  const beatPct = Math.round((below / (total - 1)) * 100);
  const clampedBeat = Math.max(0, Math.min(100, beatPct));
  return { topPct: Math.max(1, 100 - clampedBeat), beatPct: clampedBeat };
}

export async function handleInsightsWeekly(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_INSIGHTS_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many insights requests. Slow down.');
  }

  // Members-only. Non-members get a clean 403 the client maps to the paywall.
  const { member } = await readEntitlements(env, session.userId);
  if (!member) {
    return jsonError(403, 'MEMBERS_ONLY', 'Weekly Insights is a members-only feature.');
  }

  const week = getAccoladeWeekStart();

  // Caller's step total for this week. No row → not yet ranked; the client
  // still renders the screen from local data, just without the percentile.
  const myRow = await env.DB.prepare(
    `SELECT current_value FROM leaderboard_snapshots
     WHERE user_id = ? AND metric = ? AND week_start = ?`,
  )
    .bind(session.userId, METRIC, week)
    .first<ValRow>();

  if (!myRow) {
    return jsonOk({ week, me: null });
  }
  const mySteps = myRow.current_value;

  const tierRow = await env.DB.prepare(
    'SELECT rank_tier FROM public_profile_summary WHERE user_id = ?',
  )
    .bind(session.userId)
    .first<TierRow>();
  const rankTier = tierRow?.rank_tier ?? null;

  // Global pool: every real hunter with a step row this week.
  const g = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN ls.current_value < ? THEN 1 ELSE 0 END) AS below
     FROM leaderboard_snapshots ls
     JOIN users u ON u.id = ls.user_id
     WHERE ls.metric = ? AND ls.week_start = ?
       AND u.apple_sub NOT LIKE 'sim_test_%'`,
  )
    .bind(mySteps, METRIC, week)
    .first<CountRow>();

  const gTotal = g?.total ?? 0;
  const gBelow = g?.below ?? 0;
  const gp = pctify(gBelow, gTotal);
  const global = {
    topPct: gp.topPct,
    beatPct: gp.beatPct,
    size: gTotal,
    lowConfidence: gTotal < MIN_GLOBAL_POOL,
  };

  // Rank-cohort pool: hunters sharing the caller's rank tier.
  let cohort: { beatPct: number; size: number; lowConfidence: boolean } | null = null;
  if (rankTier) {
    const c = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ls.current_value < ? THEN 1 ELSE 0 END) AS below
       FROM leaderboard_snapshots ls
       JOIN users u ON u.id = ls.user_id
       JOIN public_profile_summary pps ON pps.user_id = ls.user_id
       WHERE ls.metric = ? AND ls.week_start = ?
         AND pps.rank_tier = ?
         AND u.apple_sub NOT LIKE 'sim_test_%'`,
    )
      .bind(mySteps, METRIC, week, rankTier)
      .first<CountRow>();
    const cTotal = c?.total ?? 0;
    const cBelow = c?.below ?? 0;
    const cp = pctify(cBelow, cTotal);
    cohort = { beatPct: cp.beatPct, size: cTotal, lowConfidence: cTotal < MIN_COHORT_POOL };
  }

  return jsonOk({
    week,
    me: { weekTotal: mySteps, rankTier, global, cohort },
  });
}
