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

// A single user's lifetime STARTED co-op hunts is tiny (needs a partner and a
// fee-gated multi-hour window). This cap is a pure safety ceiling far above any
// real total; if it were ever hit, the OLDEST hunts would drop — but reaching it
// is not physically plausible, so streak accuracy is unaffected.
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
  // W677/W692 — the viewer is a hunter when they're the challenger OR hold a
  // participant row (raid seats 4/5 have no legacy partner column). We fetch the
  // instance ids, then attach the FULL roster per win so computePacts credits a
  // pact with EVERY co-hunter, not just the two legacy columns.
  // W813 — the pact is a COMMITMENT streak: every instance that actually BEGAN
  // (starts_at stamped when the last seat accepted) counts toward the flame,
  // win or lose. is_win rides along so computePacts can keep `total` (the Bond,
  // "bosses defeated together") a wins-only stat.
  const rows = await env.DB.prepare(
    `SELECT i.id, i.challenger_user_id, i.partner_user_id, i.partner2_user_id, i.boss_id,
            i.starts_at, i.resolved_at,
            CASE WHEN i.status = 'completed' AND i.result = 'success' THEN 1 ELSE 0 END AS is_win
       FROM coop_boss_instances i
      WHERE i.starts_at IS NOT NULL
        AND ( i.challenger_user_id = ?1
              OR EXISTS (SELECT 1 FROM coop_boss_participants p WHERE p.instance_id = i.id AND p.user_id = ?1) )
      ORDER BY i.starts_at DESC
      LIMIT ?2`,
  )
    .bind(session.userId, MAX_WIN_ROWS)
    .all<WinRow>();

  const list = rows.results ?? [];
  // Attach each win's full roster (challenger + participant rows) in one batch query.
  const ids = list.map((r) => r.id).filter((x): x is string => !!x);
  const rosterByInstance = new Map<string, string[]>();
  if (ids.length) {
    const ph = ids.map(() => '?').join(', ');
    const pr = await env.DB.prepare(
      `SELECT instance_id, user_id FROM coop_boss_participants WHERE instance_id IN (${ph})`,
    )
      .bind(...ids)
      .all<{ instance_id: string; user_id: string }>();
    for (const p of pr.results ?? []) {
      const a = rosterByInstance.get(p.instance_id) ?? [];
      a.push(p.user_id);
      rosterByInstance.set(p.instance_id, a);
    }
  }
  for (const r of list) {
    r.participant_ids = [r.challenger_user_id, ...(r.id ? rosterByInstance.get(r.id) ?? [] : [])];
  }

  const pacts = computePacts(list, session.userId);
  return jsonOk({ ok: true, day: ptDayKey(Date.now()), pacts });
}
