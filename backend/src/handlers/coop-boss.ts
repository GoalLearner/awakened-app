/**
 * Co-op Dungeon Bosses v1 (W370) — coop-boss handler.
 *
 *   POST   /v1/coop-boss              — challenger invites a friend (pending)
 *   GET    /v1/coop-boss              — list caller's instances (both roles)
 *   GET    /v1/coop-boss/:id          — single instance detail (participants)
 *   POST   /v1/coop-boss/:id/join     — partner accepts → active, 24h clock starts
 *   POST   /v1/coop-boss/:id/decline  — partner declines a pending invite
 *   POST   /v1/coop-boss/:id/cancel   — challenger withdraws a pending invite
 *   POST   /v1/coop-boss/:id/resolve  — evaluate combined steps → success/defeat
 *
 * Auth required on every endpoint; user_id is derived from the verified
 * session JWT only. The boss roster (goal/reward/window) is defined
 * SERVER-SIDE in COOP_BOSS_CFG so clients cannot dictate the difficulty
 * or payout.
 *
 * The shared step total is computed live from verified_events as
 *   SUM over participants of MAX(value) per user
 * for event_type='steps_total' tagged with this instance id. MAX because
 * each client resubmits its growing in-window step count repeatedly, so
 * MAX = that user's window total (same 'max' aggregate the retired steps
 * duels used).
 *
 * Economy: souls + the relic drop are granted CLIENT-SIDE on the kill
 * (hb_souls + card/pity inventory are client-authoritative in this game),
 * exactly like a solo boss. The backend only owns the authoritative
 * win/loss DECISION — it writes no souls ledger row for co-op in v1.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

// ── Server-authoritative co-op boss roster ──────────────────────────
// One E-rank boss for v1. goalSteps is the COMBINED target across both
// hunters; rewardSouls is the per-hunter payout the client grants on the
// kill; windowHours is the hunt length, stamped on join.
const COOP_BOSS_CFG: Record<
  string,
  { rank: string; goalSteps: number; rewardSouls: number; windowHours: number }
> = {
  the_twin_maw: { rank: 'E', goalSteps: 16000, rewardSouls: 50, windowHours: 24 },
};

const STEPS_EVENT_TYPE = 'steps_total';
const MAX_LIST = 20;

interface CoopBossRow {
  id: string;
  boss_id: string;
  boss_rank: string;
  challenger_user_id: string;
  partner_user_id: string;
  goal_steps: number;
  reward_souls: number;
  status: string;
  result: string | null;
  starts_at: string | null;
  ends_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Small shared helpers ────────────────────────────────────────────

/** True iff the two users have an accepted friendship (either direction). */
async function areAcceptedFriends(env: Env, a: string, b: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM friends
      WHERE status = 'accepted'
        AND ( (requester_user_id = ? AND recipient_user_id = ?)
           OR (requester_user_id = ? AND recipient_user_id = ?) )
      LIMIT 1`,
  )
    .bind(a, b, b, a)
    .first<{ ok: number }>();
  return !!row;
}

/** Alias lookup for a small id set. Missing ids simply don't appear. */
async function getAliasMap(env: Env, userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, alias FROM users WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<{ id: string; alias: string }>();
  for (const row of rows.results ?? []) map.set(row.id, row.alias);
  return map;
}

/** Per-user step contribution for ONE instance: MAX(value) per user. */
async function getCoopStepsByUser(env: Env, instanceId: string): Promise<Map<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT user_id, COALESCE(MAX(value), 0) AS s
       FROM verified_events
      WHERE boss_instance_id = ? AND event_type = ?
      GROUP BY user_id`,
  )
    .bind(instanceId, STEPS_EVENT_TYPE)
    .all<{ user_id: string; s: number }>();
  const m = new Map<string, number>();
  for (const r of rows.results ?? []) m.set(r.user_id, Number(r.s) || 0);
  return m;
}

/** Batched variant for the list endpoint: instanceId → (userId → steps). */
async function getCoopStepsForInstances(
  env: Env,
  ids: string[],
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT boss_instance_id AS bid, user_id, COALESCE(MAX(value), 0) AS s
       FROM verified_events
      WHERE boss_instance_id IN (${placeholders}) AND event_type = ?
      GROUP BY boss_instance_id, user_id`,
  )
    .bind(...ids, STEPS_EVENT_TYPE)
    .all<{ bid: string; user_id: string; s: number }>();
  for (const r of rows.results ?? []) {
    if (!out.has(r.bid)) out.set(r.bid, new Map());
    out.get(r.bid)!.set(r.user_id, Number(r.s) || 0);
  }
  return out;
}

function combinedFrom(row: CoopBossRow, byUser: Map<string, number>): number {
  return (byUser.get(row.challenger_user_id) || 0) + (byUser.get(row.partner_user_id) || 0);
}

function serializeCoop(
  row: CoopBossRow,
  aliasMap: Map<string, string>,
  viewerUserId: string,
  byUser: Map<string, number>,
): Record<string, unknown> {
  const role: 'challenger' | 'partner' | 'observer' =
    row.challenger_user_id === viewerUserId
      ? 'challenger'
      : row.partner_user_id === viewerUserId
        ? 'partner'
        : 'observer';

  let timeRemainingMs: number | null = null;
  if (row.status === 'active' && row.ends_at) {
    const endsMs = Date.parse(row.ends_at);
    if (Number.isFinite(endsMs)) timeRemainingMs = Math.max(0, endsMs - Date.now());
  }

  const challengerSteps = byUser.get(row.challenger_user_id) || 0;
  const partnerSteps = byUser.get(row.partner_user_id) || 0;

  return {
    id: row.id,
    boss_id: row.boss_id,
    boss_rank: row.boss_rank,
    status: row.status,
    result: row.result ?? null,
    role,
    goal_steps: row.goal_steps,
    reward_souls: row.reward_souls,
    combined_steps: challengerSteps + partnerSteps,
    challenger: {
      user_id: row.challenger_user_id,
      alias: aliasMap.get(row.challenger_user_id) ?? null,
      steps: challengerSteps,
    },
    partner: {
      user_id: row.partner_user_id,
      alias: aliasMap.get(row.partner_user_id) ?? null,
      steps: partnerSteps,
    },
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    time_remaining_ms: timeRemainingMs,
    resolved_at: row.resolved_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadInstance(env: Env, id: string): Promise<CoopBossRow | null> {
  const row = await env.DB.prepare('SELECT * FROM coop_boss_instances WHERE id = ?')
    .bind(id)
    .first<CoopBossRow>();
  return row ?? null;
}

function isParticipant(row: CoopBossRow, userId: string): boolean {
  return row.challenger_user_id === userId || row.partner_user_id === userId;
}

// W371 — validate a verified-event step submission that is tagged with a
// co-op boss_instance_id. The submit endpoint (handleVerifiedEventsSubmit,
// duels.ts) calls this before inserting any boss-tagged row. Rejects
// anything but a REAL PARTICIPANT submitting to an ACTIVE instance INSIDE
// its [starts_at, ends_at] window. This is what makes the server-side win
// decision trustworthy: without it any client could POST a fabricated
// value for any instance, or bank post-deadline steps to win after the
// 24h window. (v1 still trusts the step VALUE itself per duels.ts; this
// caps abuse to in-window participant submissions — the cheap, high-value
// guard.) A 60s grace on each bound tolerates device/server clock skew.
export async function validateBossInstanceForUser(
  env: Env,
  userId: string,
  instanceId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const row = await env.DB.prepare(
    `SELECT challenger_user_id, partner_user_id, status, starts_at, ends_at
       FROM coop_boss_instances WHERE id = ?`,
  )
    .bind(instanceId)
    .first<{
      challenger_user_id: string;
      partner_user_id: string;
      status: string;
      starts_at: string | null;
      ends_at: string | null;
    }>();
  if (!row) return { ok: false, reason: 'BOSS_INSTANCE_NOT_FOUND' };
  if (row.challenger_user_id !== userId && row.partner_user_id !== userId) {
    return { ok: false, reason: 'NOT_PARTICIPANT' };
  }
  if (row.status !== 'active') return { ok: false, reason: 'BOSS_NOT_ACTIVE' };
  const now = Date.now();
  const startMs = row.starts_at ? Date.parse(row.starts_at) : NaN;
  const endMs = row.ends_at ? Date.parse(row.ends_at) : NaN;
  if (Number.isFinite(startMs) && now < startMs - 60000) return { ok: false, reason: 'BEFORE_WINDOW' };
  if (Number.isFinite(endMs) && now > endMs + 60000) return { ok: false, reason: 'AFTER_WINDOW' };
  return { ok: true };
}

// ── POST /v1/coop-boss — create (invite a friend) ───────────────────
export async function handleCoopBossCreate(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  let body: { partner_user_id?: unknown; boss_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const bossId = typeof body.boss_id === 'string' ? body.boss_id : '';
  const partnerUserId = typeof body.partner_user_id === 'string' ? body.partner_user_id : '';
  const cfg = COOP_BOSS_CFG[bossId];
  if (!cfg) return jsonError(400, 'UNKNOWN_BOSS', 'Unknown co-op boss id.');
  if (!partnerUserId) return jsonError(400, 'MISSING_PARTNER', 'partner_user_id is required.');
  if (partnerUserId === session.userId) {
    return jsonError(400, 'SELF_PARTNER', 'You cannot co-op with yourself.');
  }

  if (!(await areAcceptedFriends(env, session.userId, partnerUserId))) {
    return jsonError(403, 'NOT_FRIENDS', 'You can only co-op with an accepted friend.');
  }

  // One live (pending/active) instance per pair+boss, either direction.
  const existing = await env.DB.prepare(
    `SELECT id FROM coop_boss_instances
      WHERE boss_id = ? AND status IN ('pending','active')
        AND ( (challenger_user_id = ? AND partner_user_id = ?)
           OR (challenger_user_id = ? AND partner_user_id = ?) )
      LIMIT 1`,
  )
    .bind(bossId, session.userId, partnerUserId, partnerUserId, session.userId)
    .first<{ id: string }>();
  if (existing) {
    return jsonError(409, 'ALREADY_ACTIVE', 'A co-op hunt for this boss already exists with that hunter.');
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO coop_boss_instances
       (id, boss_id, boss_rank, challenger_user_id, partner_user_id,
        goal_steps, reward_souls, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(id, bossId, cfg.rank, session.userId, partnerUserId, cfg.goalSteps, cfg.rewardSouls)
    .run();

  const row = await loadInstance(env, id);
  if (!row) return jsonError(500, 'INTERNAL', 'Failed to read back created instance.');
  const aliasMap = await getAliasMap(env, [row.challenger_user_id, row.partner_user_id]);
  return jsonOk({ ok: true, instance: serializeCoop(row, aliasMap, session.userId, new Map()) });
}

// ── GET /v1/coop-boss — list caller's instances ─────────────────────
export async function handleCoopBossList(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const rows = await env.DB.prepare(
    `SELECT * FROM coop_boss_instances
      WHERE challenger_user_id = ? OR partner_user_id = ?
      ORDER BY updated_at DESC
      LIMIT ?`,
  )
    .bind(session.userId, session.userId, MAX_LIST)
    .all<CoopBossRow>();

  const list = rows.results ?? [];
  const ids = list.map((r) => r.id);
  const userIds = new Set<string>();
  for (const r of list) {
    userIds.add(r.challenger_user_id);
    userIds.add(r.partner_user_id);
  }
  const [stepsByInstance, aliasMap] = await Promise.all([
    getCoopStepsForInstances(env, ids),
    getAliasMap(env, Array.from(userIds)),
  ]);

  const instances = list.map((r) =>
    serializeCoop(r, aliasMap, session.userId, stepsByInstance.get(r.id) ?? new Map()),
  );
  return jsonOk({ ok: true, instances });
}

// ── GET /v1/coop-boss/:id — detail ──────────────────────────────────
export async function handleCoopBossGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  if (!isParticipant(row, session.userId)) {
    return jsonError(403, 'FORBIDDEN', 'You are not part of this co-op hunt.');
  }
  const byUser = await getCoopStepsByUser(env, row.id);
  const aliasMap = await getAliasMap(env, [row.challenger_user_id, row.partner_user_id]);
  return jsonOk({ ok: true, instance: serializeCoop(row, aliasMap, session.userId, byUser) });
}

// ── POST /v1/coop-boss/:id/join — partner accepts ───────────────────
export async function handleCoopBossJoin(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  if (row.partner_user_id !== session.userId) {
    return jsonError(403, 'FORBIDDEN', 'Only the invited hunter can join this hunt.');
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot join from status "${row.status}".`);
  }

  const cfg = COOP_BOSS_CFG[row.boss_id];
  const windowHours = cfg ? cfg.windowHours : 24;
  const nowMs = Date.now();
  const startsAt = new Date(nowMs).toISOString();
  const endsAt = new Date(nowMs + windowHours * 3600 * 1000).toISOString();

  await env.DB.prepare(
    `UPDATE coop_boss_instances
        SET status = 'active', starts_at = ?, ends_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`,
  )
    .bind(startsAt, endsAt, id)
    .run();

  const refreshed = await loadInstance(env, id);
  if (!refreshed) return jsonError(500, 'INTERNAL', 'Failed to read back joined instance.');
  const aliasMap = await getAliasMap(env, [refreshed.challenger_user_id, refreshed.partner_user_id]);
  return jsonOk({ ok: true, instance: serializeCoop(refreshed, aliasMap, session.userId, new Map()) });
}

// ── POST /v1/coop-boss/:id/decline — partner declines ───────────────
export async function handleCoopBossDecline(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
): Promise<Response> {
  return setTerminalStatus(env, session, id, 'declined', 'partner');
}

// ── POST /v1/coop-boss/:id/cancel — withdraw a PENDING invite (challenger
//    only) OR leave an ACTIVE hunt (either participant). W384.
//    Co-op has no economy/penalty stake (nothing is wagered; rewards land only
//    on a win), so leaving an active hunt simply forfeits both hunters' in-window
//    progress — there is nothing to refund and nothing to exploit.
export async function handleCoopBossCancel(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');

  const isChallenger = row.challenger_user_id === session.userId;
  const isPartner = row.partner_user_id === session.userId;

  if (row.status === 'pending') {
    // Withdraw an invite the partner hasn't accepted yet — challenger only
    // (the partner uses /decline instead).
    if (!isChallenger) {
      return jsonError(403, 'FORBIDDEN', 'Only the challenger can withdraw a pending invite.');
    }
  } else if (row.status === 'active') {
    // Leave an in-progress hunt — EITHER participant may.
    if (!isChallenger && !isPartner) {
      return jsonError(403, 'FORBIDDEN', 'Only a hunter in this hunt can leave it.');
    }
    // Don't let a leave throw away an already-earned win: if the combined goal
    // is met it must resolve as a WIN, not vanish. (The client also auto-resolves
    // on goal-met; this guards the small race where a leave races the resolve.)
    const byUser = await getCoopStepsByUser(env, row.id);
    if (combinedFrom(row, byUser) >= row.goal_steps) {
      return jsonError(409, 'ALREADY_WON', 'This hunt already hit its goal — claim the win instead.');
    }
  } else {
    return jsonError(400, 'BAD_STATE', `Cannot cancel from status "${row.status}".`);
  }

  await env.DB.prepare(
    `UPDATE coop_boss_instances
        SET status = 'cancelled', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('pending','active')`,
  )
    .bind(id)
    .run();

  const refreshed = await loadInstance(env, id);
  if (!refreshed) return jsonError(500, 'INTERNAL', 'Failed to read back instance.');
  const aliasMap = await getAliasMap(env, [refreshed.challenger_user_id, refreshed.partner_user_id]);
  return jsonOk({ ok: true, instance: serializeCoop(refreshed, aliasMap, session.userId, new Map()) });
}

/** Shared pending→terminal transition for decline/cancel. */
async function setTerminalStatus(
  env: Env,
  session: SessionPayload,
  id: string,
  nextStatus: 'declined' | 'cancelled',
  who: 'partner' | 'challenger',
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  const requiredUser = who === 'partner' ? row.partner_user_id : row.challenger_user_id;
  if (requiredUser !== session.userId) {
    return jsonError(403, 'FORBIDDEN', `Only the ${who} can ${nextStatus === 'declined' ? 'decline' : 'cancel'} this hunt.`);
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot ${nextStatus} from status "${row.status}".`);
  }

  await env.DB.prepare(
    `UPDATE coop_boss_instances
        SET status = ?, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`,
  )
    .bind(nextStatus, id)
    .run();

  const refreshed = await loadInstance(env, id);
  if (!refreshed) return jsonError(500, 'INTERNAL', 'Failed to read back instance.');
  const aliasMap = await getAliasMap(env, [refreshed.challenger_user_id, refreshed.partner_user_id]);
  return jsonOk({ ok: true, instance: serializeCoop(refreshed, aliasMap, session.userId, new Map()) });
}

// ── POST /v1/coop-boss/:id/resolve — evaluate the hunt ──────────────
export async function handleCoopBossResolve(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  if (!isParticipant(row, session.userId)) {
    return jsonError(403, 'FORBIDDEN', 'You are not part of this co-op hunt.');
  }

  const byUser = await getCoopStepsByUser(env, row.id);
  const combined = combinedFrom(row, byUser);
  const aliasMap = await getAliasMap(env, [row.challenger_user_id, row.partner_user_id]);

  // Idempotent: already resolved → return the stored verdict + live steps.
  if (row.status === 'completed' || row.status === 'expired') {
    return jsonOk({
      ok: true,
      resolved: true,
      already_resolved: true,
      instance: serializeCoop(row, aliasMap, session.userId, byUser),
    });
  }
  if (row.status !== 'active') {
    return jsonError(400, 'BAD_STATE', `Cannot resolve from status "${row.status}".`);
  }

  const goalMet = combined >= row.goal_steps;
  const endsMs = row.ends_at ? Date.parse(row.ends_at) : NaN;
  const expired = Number.isFinite(endsMs) && Date.now() >= endsMs;

  // Win can land mid-window the instant the combined goal is reached.
  if (goalMet) {
    await env.DB.prepare(
      `UPDATE coop_boss_instances
          SET status = 'completed', result = 'success',
              resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'active'`,
    )
      .bind(id)
      .run();
  } else if (expired) {
    await env.DB.prepare(
      `UPDATE coop_boss_instances
          SET status = 'expired', result = 'defeat',
              resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'active'`,
    )
      .bind(id)
      .run();
  } else {
    // Still in progress — not an error, just not resolved yet.
    return jsonOk({
      ok: true,
      resolved: false,
      instance: serializeCoop(row, aliasMap, session.userId, byUser),
    });
  }

  const refreshed = (await loadInstance(env, id)) ?? row;
  return jsonOk({
    ok: true,
    resolved: true,
    instance: serializeCoop(refreshed, aliasMap, session.userId, byUser),
  });
}
