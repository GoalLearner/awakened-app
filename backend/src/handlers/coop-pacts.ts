/**
 * coop-pacts.ts — GET /v1/coop-boss/pacts (W664 Phase 2).
 *
 * Read-only. Returns the CANONICAL co-op daily-streak "pact" per friend for the
 * calling user, computed server-side from the durable `coop_boss_instances`
 * history. This is the source of truth that makes BOTH friends see identical
 * numbers (v1 = each device computed its own view). No migration, no writes.
 *
 * Response: { ok, day, pacts: { [otherUserId]: PactAgg } } where `day` is the
 * server's current Pacific day (the client applies the alive/lit check locally).
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { computePacts, ptDayKey, type WinRow } from '../lib/pact-streak';

// A single user's lifetime co-op WINS is tiny (needs a partner, a 24h fee-gated
// hunt, and at most one streak-day/pair/day). This cap is a pure safety ceiling
// far above any real total; if it were ever hit, the OLDEST wins would drop —
// but reaching it is not physically plausible, so streak accuracy is unaffected.
const MAX_WIN_ROWS = 5000;

export async function handleCoopPacts(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  // ORDER BY DESC so that IF the (unhittable) cap were reached, it keeps the NEWEST
  // wins — the ones the current streak/lastDay depend on — rather than the oldest.
  // computePacts sorts internally, so direction doesn't affect the math otherwise.
  // W677 — trio wins ride the same rows (partner2_user_id NULL on duo hunts);
  // computePacts credits the viewer's pact with EVERY other hunter on the row.
  const rows = await env.DB.prepare(
    `SELECT challenger_user_id, partner_user_id, partner2_user_id, boss_id, resolved_at
       FROM coop_boss_instances
      WHERE status = 'completed' AND result = 'success'
        AND resolved_at IS NOT NULL
        AND (challenger_user_id = ?1 OR partner_user_id = ?1 OR partner2_user_id = ?1)
      ORDER BY resolved_at DESC
      LIMIT ?2`,
  )
    .bind(session.userId, MAX_WIN_ROWS)
    .all<WinRow>();

  const pacts = computePacts(rows.results ?? [], session.userId);
  return jsonOk({ ok: true, day: ptDayKey(Date.now()), pacts });
}
