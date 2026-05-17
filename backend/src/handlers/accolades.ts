/**
 * GET /v1/users/me/accolades
 *
 * Authenticated endpoint. Returns the authenticated user's accolade
 * rows (currently only `step_100k_club`, but the response shape is
 * generic for future types).
 *
 * v3 Phase 1z.27 -- 100K Step Club prestige feature.
 *
 * Response shape (project convention is no `ok: true` field on
 * success; absence of `error` plus HTTP 200 implies success):
 *   {
 *     accolades: [
 *       {
 *         type: 'step_100k_club',
 *         unlock_week_start: '2026-05-17',
 *         unlock_value: 104821,
 *         best_value: 118712,
 *         repeat_count: 3,
 *         last_qualified_week_start: '2026-06-07',
 *         unlocked_at: 1760000000000,
 *         updated_at: 1760000000000
 *       }
 *     ]
 *   }
 *
 * If no accolades: { accolades: [] }.
 *
 * Read-only. Awards happen elsewhere (leaderboard-submit.ts for the
 * step_100k_club type). This endpoint is consumed by the frontend
 * Hunter Profile rank-badge prestige frame + the 100K Step Club
 * detail sheet.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

interface AccoladeRow {
  accolade_type: string;
  unlock_week_start: string;
  unlock_value: number;
  best_value: number;
  repeat_count: number;
  last_qualified_week_start: string;
  unlocked_at: number;
  updated_at: number;
  metadata_json: string | null;
}

export async function handleUserAccoladesGet(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_USER_ACCOLADES_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many accolade requests. Try again in a minute.');
  }

  const result = await env.DB.prepare(
    `SELECT accolade_type, unlock_week_start, unlock_value, best_value,
            repeat_count, last_qualified_week_start, unlocked_at, updated_at,
            metadata_json
       FROM user_accolades
      WHERE user_id = ?
      ORDER BY unlocked_at ASC`,
  ).bind(session.userId).all<AccoladeRow>();

  const accolades = (result.results ?? []).map(r => {
    let metadata: unknown = null;
    if (r.metadata_json) {
      try { metadata = JSON.parse(r.metadata_json); } catch { /* tolerate corrupt JSON */ }
    }
    return {
      type:                      r.accolade_type,
      unlock_week_start:         r.unlock_week_start,
      unlock_value:              r.unlock_value,
      best_value:                r.best_value,
      repeat_count:              r.repeat_count,
      last_qualified_week_start: r.last_qualified_week_start,
      unlocked_at:               r.unlocked_at,
      updated_at:                r.updated_at,
      ...(metadata != null && typeof metadata === 'object' ? { metadata } : {}),
    };
  });

  return jsonOk({ accolades });
}
