/**
 * steps-rank.ts — GET /v1/steps/rank (W1178). Read-only, no migration.
 *
 * Today's Briefing ranks the caller's 14-day average steps against every hunter who walked with
 * the app in those 14 days. The days come from each hunter's cloud save (hb_leaderboard →
 * steps_daily, Apple Health only — W799), the same source the boss audits read.
 *
 * Response: { ok, days: [first, last], others: number[] } — every OTHER hunter's average,
 * highest first, anonymous. The phone places its own (fresher) average among them.
 *
 * The scan reads every recent save, so one result is kept per isolate for CACHE_MS.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { parseDaily, stepAverage, stepRankWindow } from '../lib/step-rank';

const CACHE_MS = 15 * 60 * 1000;
let cache: { at: number; first: string; rows: Array<{ u: string; a: number }> } | null = null;

export function _resetStepRankCache(): void { cache = null; }

export async function handleStepsRank(_request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_TOP.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const now = Date.now();
  const days = stepRankWindow(now);
  if (!cache || now - cache.at > CACHE_MS || cache.first !== days[0]) {
    // A save last written before the window began can't hold a day inside it.
    const since = now - (days.length + 2) * 86_400_000;
    const res = await env.DB.prepare(
      `SELECT s.user_id AS u,
              json_extract(json_extract(s.state_json, '$.keys.hb_leaderboard'), '$.steps_daily') AS d
         FROM user_state_snapshots s JOIN users u ON u.id = s.user_id
        WHERE s.server_updated_at >= ?
          AND COALESCE(u.apple_sub, '') NOT LIKE 'sim_test_%'`,
    ).bind(since).all<{ u: string; d: string | null }>();
    const rows: Array<{ u: string; a: number }> = [];
    for (const r of res.results || []) {
      let a: number | null = null;
      try { a = stepAverage(parseDaily(r.d), days); } catch { a = null; }
      if (a != null) rows.push({ u: r.u, a });
    }
    rows.sort((x, y) => y.a - x.a);
    cache = { at: now, first: days[0], rows };
  }
  const others = cache.rows.filter((r) => r.u !== session.userId).map((r) => r.a);
  return jsonOk({ ok: true, days: [days[0], days[days.length - 1]], others });
}
