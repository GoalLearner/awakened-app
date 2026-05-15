/**
 * Discipline Duels v1 (v3 Phase 1x) — duels handler.
 *
 *   GET    /v1/duels           — list (incoming/outgoing/active/recent)
 *   POST   /v1/duels           — create a pending challenge to a friend
 *   POST   /v1/duels/:id/accept   — opponent accepts → status becomes 'active'
 *   POST   /v1/duels/:id/decline  — opponent declines → status 'declined'
 *   GET    /v1/duels/:id          — single duel detail (participants only)
 *
 * Auth required on every endpoint. user_id is derived from JWT only.
 *
 * SOULS are METADATA ONLY in v1 — stake/reward/burn values live on the
 * row for display but no spend/award logic runs. localStorage souls
 * remain client-side authoritative until scoring lands in a later pass.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { areAcceptedFriends, findUserByAlias, validateAliasInput } from './friends';

const DEFAULT_STAKE = 25;
const DEFAULT_REWARD = 40;
const DEFAULT_BURN = 10;
const DEFAULT_DURATION_DAYS = 3;
const MAX_DURATION_DAYS = 14;
const MIN_DURATION_DAYS = 1;
const MAX_STAKE = 500;

// Verified-Only Duel Types (v3 Phase 1x.6). Metadata only in this pass —
// scoring engine ships in a later pass and will branch on this value to
// pick the verified data source. Add new types here AND in the
// DUEL_TYPES constant in app.js together.
const ALLOWED_DUEL_TYPES = new Set([
  'steps',
  'sleep',
  'bedtime',
  'strength',
  'verified_objectives',
  'boss_race',
]);
const DEFAULT_DUEL_TYPE = 'verified_objectives';

interface DuelRow {
  id: string;
  challenger_user_id: string;
  opponent_user_id: string;
  status: string;
  stake_souls: number;
  reward_souls: number;
  burn_souls: number;
  duration_days: number;
  duel_type: string;
  starts_at: string | null;
  ends_at: string | null;
  winner_user_id: string | null;
  challenger_score: number;
  opponent_score: number;
  challenger_verified_score: number;
  opponent_verified_score: number;
  challenger_xp_score: number;
  opponent_xp_score: number;
  created_at: string;
  updated_at: string;
  // Steps Duel Scoring v1 (v3 Phase 1y).
  resolved_at?: string | null;
  result?: string | null;
}

async function getDuelProgress(
  env: Env,
  duelId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await env.DB.prepare(
    `SELECT user_id, value FROM duel_progress_snapshots
       WHERE duel_id = ? AND metric = 'steps'`,
  )
    .bind(duelId)
    .all<{ user_id: string; value: number }>();
  for (const r of rows.results ?? []) {
    out.set(r.user_id, Number(r.value) || 0);
  }
  return out;
}

async function getAliasMap(
  env: Env,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const placeholders = userIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, alias FROM users WHERE id IN (${placeholders})`,
  )
    .bind(...userIds)
    .all<{ id: string; alias: string }>();
  for (const row of rows.results ?? []) {
    map.set(row.id, row.alias);
  }
  return map;
}

function serializeDuel(
  row: DuelRow,
  aliasMap: Map<string, string>,
  viewerUserId: string,
  progressByUserId?: Map<string, number>,
): Record<string, unknown> {
  const isChallenger = row.challenger_user_id === viewerUserId;
  const opponentId = isChallenger ? row.opponent_user_id : row.challenger_user_id;
  const role: 'challenger' | 'opponent' = isChallenger ? 'challenger' : 'opponent';

  let timeRemainingMs: number | null = null;
  if (row.status === 'active' && row.ends_at) {
    const endsMs = Date.parse(row.ends_at);
    if (Number.isFinite(endsMs)) {
      timeRemainingMs = Math.max(0, endsMs - Date.now());
    }
  }

  // Steps Duel Scoring v1 (v3 Phase 1y). Latest snapshot values per
  // participant. null when the participant hasn't submitted yet.
  const challengerProgress = progressByUserId && progressByUserId.has(row.challenger_user_id)
    ? progressByUserId.get(row.challenger_user_id) ?? null
    : null;
  const opponentProgress = progressByUserId && progressByUserId.has(row.opponent_user_id)
    ? progressByUserId.get(row.opponent_user_id) ?? null
    : null;

  return {
    id: row.id,
    status: row.status,
    role,
    challenger: {
      user_id: row.challenger_user_id,
      alias: aliasMap.get(row.challenger_user_id) ?? null,
    },
    opponent: {
      user_id: row.opponent_user_id,
      alias: aliasMap.get(row.opponent_user_id) ?? null,
    },
    opponent_alias: aliasMap.get(opponentId) ?? null,
    stake_souls: row.stake_souls,
    reward_souls: row.reward_souls,
    burn_souls: row.burn_souls,
    duration_days: row.duration_days,
    duel_type: row.duel_type || DEFAULT_DUEL_TYPE,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    time_remaining_ms: timeRemainingMs,
    winner_user_id: row.winner_user_id,
    challenger_score: row.challenger_score,
    opponent_score: row.opponent_score,
    challenger_verified_score: row.challenger_verified_score,
    opponent_verified_score: row.opponent_verified_score,
    challenger_xp_score: row.challenger_xp_score,
    opponent_xp_score: row.opponent_xp_score,
    // Steps Duel Scoring v1 (v3 Phase 1y).
    challenger_progress_value: challengerProgress,
    opponent_progress_value: opponentProgress,
    resolved_at: row.resolved_at ?? null,
    result: row.result ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────
// GET /v1/duels
// ─────────────────────────────────────────────────────────────
export async function handleDuelsList(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_DUELS_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const rows = await env.DB.prepare(
    `SELECT * FROM duels
      WHERE challenger_user_id = ? OR opponent_user_id = ?
      ORDER BY updated_at DESC`,
  )
    .bind(session.userId, session.userId)
    .all<DuelRow>();

  const allRows = rows.results ?? [];
  const userIds = new Set<string>();
  for (const r of allRows) {
    userIds.add(r.challenger_user_id);
    userIds.add(r.opponent_user_id);
  }
  const aliasMap = await getAliasMap(env, Array.from(userIds));

  // Steps Duel Scoring v1 (v3 Phase 1y). Pull progress snapshots for
  // every duel returned. Single query joined client-side — keeps the
  // shape consumer-friendly even with multiple duels per user.
  const duelIds = allRows.map(r => r.id);
  const progressByDuelId = new Map<string, Map<string, number>>();
  if (duelIds.length > 0) {
    const placeholders = duelIds.map(() => '?').join(',');
    const progressRows = await env.DB.prepare(
      `SELECT duel_id, user_id, value FROM duel_progress_snapshots
        WHERE metric = 'steps' AND duel_id IN (${placeholders})`,
    )
      .bind(...duelIds)
      .all<{ duel_id: string; user_id: string; value: number }>();
    for (const p of progressRows.results ?? []) {
      let m = progressByDuelId.get(p.duel_id);
      if (!m) { m = new Map<string, number>(); progressByDuelId.set(p.duel_id, m); }
      m.set(p.user_id, Number(p.value) || 0);
    }
  }

  const incoming: Record<string, unknown>[] = [];
  const outgoing: Record<string, unknown>[] = [];
  const active: Record<string, unknown>[] = [];
  const recent: Record<string, unknown>[] = [];

  for (const row of allRows) {
    const serialized = serializeDuel(row, aliasMap, session.userId, progressByDuelId.get(row.id));
    if (row.status === 'pending') {
      if (row.opponent_user_id === session.userId) incoming.push(serialized);
      else outgoing.push(serialized);
    } else if (row.status === 'active') {
      active.push(serialized);
    } else {
      // completed / declined / expired / cancelled
      if (recent.length < 20) recent.push(serialized);
    }
  }

  return jsonOk({ ok: true, incoming, outgoing, active, recent });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels   body: { opponent_alias, duration_days?, stake_souls? }
// ─────────────────────────────────────────────────────────────
export async function handleDuelsCreate(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  let body: {
    opponent_alias?: unknown;
    duration_days?: unknown;
    stake_souls?: unknown;
    duel_type?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const aliasCheck = validateAliasInput(body?.opponent_alias);
  if (!aliasCheck.ok) {
    return jsonError(400, 'ALIAS_INVALID', aliasCheck.reason);
  }

  // Optional duration_days. Default 3.
  let durationDays = DEFAULT_DURATION_DAYS;
  if (body?.duration_days !== undefined && body?.duration_days !== null) {
    if (!Number.isInteger(body.duration_days)) {
      return jsonError(400, 'INVALID_DURATION', 'duration_days must be an integer.');
    }
    const d = body.duration_days as number;
    if (d < MIN_DURATION_DAYS || d > MAX_DURATION_DAYS) {
      return jsonError(
        400,
        'INVALID_DURATION',
        `duration_days must be between ${MIN_DURATION_DAYS} and ${MAX_DURATION_DAYS}.`,
      );
    }
    durationDays = d;
  }

  // Optional stake_souls override. Default 25.
  let stakeSouls = DEFAULT_STAKE;
  if (body?.stake_souls !== undefined && body?.stake_souls !== null) {
    if (!Number.isInteger(body.stake_souls)) {
      return jsonError(400, 'INVALID_STAKE', 'stake_souls must be an integer.');
    }
    const s = body.stake_souls as number;
    if (s < 0 || s > MAX_STAKE) {
      return jsonError(400, 'INVALID_STAKE', `stake_souls must be 0–${MAX_STAKE}.`);
    }
    stakeSouls = s;
  }

  // Optional duel_type. Default 'verified_objectives'.
  let duelType = DEFAULT_DUEL_TYPE;
  if (body?.duel_type !== undefined && body?.duel_type !== null) {
    if (typeof body.duel_type !== 'string' || !ALLOWED_DUEL_TYPES.has(body.duel_type)) {
      return jsonError(
        400,
        'INVALID_DUEL_TYPE',
        `duel_type must be one of: ${Array.from(ALLOWED_DUEL_TYPES).join(', ')}.`,
      );
    }
    duelType = body.duel_type;
  }

  const opponent = await findUserByAlias(env, aliasCheck.trimmed);
  if (!opponent) {
    return jsonError(404, 'USER_NOT_FOUND', `No hunter found with alias "${aliasCheck.trimmed}".`);
  }
  if (opponent.id === session.userId) {
    return jsonError(400, 'SELF_DUEL', 'You cannot duel yourself.');
  }

  // Must be accepted friends.
  const friends = await areAcceptedFriends(env, session.userId, opponent.id);
  if (!friends) {
    return jsonError(
      403,
      'NOT_FRIENDS',
      'You can only duel an accepted friend. Send a friend request first.',
    );
  }

  // Reject if any pending/active duel between this pair already exists.
  const existing = await env.DB.prepare(
    `SELECT id, status FROM duels
      WHERE status IN ('pending', 'active')
        AND ((challenger_user_id = ? AND opponent_user_id = ?)
          OR (challenger_user_id = ? AND opponent_user_id = ?))
      LIMIT 1`,
  )
    .bind(session.userId, opponent.id, opponent.id, session.userId)
    .first<{ id: string; status: string }>();
  if (existing) {
    return jsonError(
      409,
      'DUEL_EXISTS',
      `A ${existing.status} duel between you already exists.`,
      { duel_id: existing.id },
    );
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO duels (
       id, challenger_user_id, opponent_user_id, status,
       stake_souls, reward_souls, burn_souls, duration_days, duel_type
     ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      session.userId,
      opponent.id,
      stakeSouls,
      DEFAULT_REWARD,
      DEFAULT_BURN,
      durationDays,
      duelType,
    )
    .run();

  const created = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(id)
    .first<DuelRow>();
  if (!created) {
    return jsonError(500, 'INTERNAL', 'Failed to read back created duel.');
  }
  const aliasMap = await getAliasMap(env, [
    created.challenger_user_id,
    created.opponent_user_id,
  ]);
  return jsonOk({ ok: true, duel: serializeDuel(created, aliasMap, session.userId) });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels/:id/accept
// ─────────────────────────────────────────────────────────────
export async function handleDuelsAccept(
  _request: Request,
  env: Env,
  session: SessionPayload,
  duelId: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const row = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!row) {
    return jsonError(404, 'NOT_FOUND', 'Duel not found.');
  }
  if (row.opponent_user_id !== session.userId) {
    return jsonError(403, 'FORBIDDEN', 'Only the opponent can accept this duel.');
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot accept from status "${row.status}".`);
  }

  const now = new Date();
  const startsAt = now.toISOString();
  const ends = new Date(now.getTime() + row.duration_days * 24 * 60 * 60 * 1000);
  const endsAt = ends.toISOString();

  await env.DB.prepare(
    `UPDATE duels
        SET status = 'active', starts_at = ?, ends_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(startsAt, endsAt, duelId)
    .run();

  const refreshed = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!refreshed) {
    return jsonError(500, 'INTERNAL', 'Failed to read back accepted duel.');
  }
  const aliasMap = await getAliasMap(env, [
    refreshed.challenger_user_id,
    refreshed.opponent_user_id,
  ]);
  return jsonOk({ ok: true, duel: serializeDuel(refreshed, aliasMap, session.userId) });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels/:id/decline
// ─────────────────────────────────────────────────────────────
export async function handleDuelsDecline(
  _request: Request,
  env: Env,
  session: SessionPayload,
  duelId: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const row = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!row) {
    return jsonError(404, 'NOT_FOUND', 'Duel not found.');
  }
  if (row.opponent_user_id !== session.userId) {
    return jsonError(403, 'FORBIDDEN', 'Only the opponent can decline this duel.');
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot decline from status "${row.status}".`);
  }
  await env.DB.prepare(
    "UPDATE duels SET status = 'declined', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(duelId)
    .run();
  return jsonOk({ ok: true, declined: true });
}

// ─────────────────────────────────────────────────────────────
// GET /v1/duels/:id
// ─────────────────────────────────────────────────────────────
export async function handleDuelsDetail(
  _request: Request,
  env: Env,
  session: SessionPayload,
  duelId: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const row = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!row) {
    return jsonError(404, 'NOT_FOUND', 'Duel not found.');
  }
  if (
    row.challenger_user_id !== session.userId &&
    row.opponent_user_id !== session.userId
  ) {
    return jsonError(403, 'FORBIDDEN', 'You are not a participant in this duel.');
  }
  const aliasMap = await getAliasMap(env, [
    row.challenger_user_id,
    row.opponent_user_id,
  ]);
  const progress = await getDuelProgress(env, duelId);
  return jsonOk({ ok: true, duel: serializeDuel(row, aliasMap, session.userId, progress) });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels/:id/progress   body: { duel_type, metric, value,
//   window_start, window_end, client_updated_at }
//
// Steps Duel Scoring v1 (v3 Phase 1y). Client (Apple Health) submits
// the current step total for the duel window. Server upserts via the
// UNIQUE(duel_id, user_id, metric) index — re-submits overwrite the
// same row. v1 trusts the client value; future hardening (signed
// device snapshots) is out of scope.
//
// Rejects:
//   - non-participant                    → 403 FORBIDDEN
//   - duel.duel_type !== 'steps'         → 400 DUEL_TYPE_NOT_SCORED_YET
//   - duel.status !== 'active'           → 400 DUEL_NOT_ACTIVE
//   - metric !== 'steps'                 → 400 INVALID_METRIC
//   - non-integer / negative value       → 400 INVALID_VALUE
// ─────────────────────────────────────────────────────────────
export async function handleDuelsSubmitProgress(
  request: Request,
  env: Env,
  session: SessionPayload,
  duelId: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  let body: {
    duel_type?: unknown;
    metric?: unknown;
    value?: unknown;
    window_start?: unknown;
    window_end?: unknown;
    client_updated_at?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const row = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!row) {
    return jsonError(404, 'NOT_FOUND', 'Duel not found.');
  }
  if (
    row.challenger_user_id !== session.userId &&
    row.opponent_user_id !== session.userId
  ) {
    return jsonError(403, 'FORBIDDEN', 'You are not a participant in this duel.');
  }
  if (row.duel_type !== 'steps') {
    return jsonError(
      400,
      'DUEL_TYPE_NOT_SCORED_YET',
      'Only steps duels are scored in this version.',
    );
  }
  if (row.status !== 'active') {
    return jsonError(400, 'DUEL_NOT_ACTIVE', `Cannot submit progress to a ${row.status} duel.`);
  }

  const metric = typeof body?.metric === 'string' ? body.metric : '';
  if (metric !== 'steps') {
    return jsonError(400, 'INVALID_METRIC', 'metric must be "steps" for v1.');
  }
  const rawValue = body?.value;
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue < 0) {
    return jsonError(400, 'INVALID_VALUE', 'value must be a non-negative number.');
  }
  const value = Math.round(rawValue);

  const windowStart = typeof body?.window_start === 'string' ? body.window_start : null;
  const windowEnd = typeof body?.window_end === 'string' ? body.window_end : null;
  if (!windowStart || !windowEnd) {
    return jsonError(400, 'INVALID_WINDOW', 'window_start and window_end are required.');
  }
  const clientUpdatedAt = typeof body?.client_updated_at === 'string'
    ? body.client_updated_at
    : new Date().toISOString();

  // Deterministic id so re-submits update the same row via PRIMARY KEY
  // collision (and the UNIQUE constraint is belt-and-suspenders).
  const snapshotId = `${duelId}_${session.userId}_${metric}`;

  // source is server-set — ignore anything in the body.
  await env.DB.prepare(
    `INSERT INTO duel_progress_snapshots (
       id, duel_id, user_id, duel_type, metric, value, source,
       window_start, window_end, client_updated_at, server_updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'apple_health', ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(duel_id, user_id, metric) DO UPDATE SET
       value = excluded.value,
       window_start = excluded.window_start,
       window_end = excluded.window_end,
       client_updated_at = excluded.client_updated_at,
       server_updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      snapshotId,
      duelId,
      session.userId,
      row.duel_type,
      metric,
      value,
      windowStart,
      windowEnd,
      clientUpdatedAt,
    )
    .run();

  const progress = await getDuelProgress(env, duelId);
  const isChallenger = row.challenger_user_id === session.userId;
  const myUserId = session.userId;
  const rivalUserId = isChallenger ? row.opponent_user_id : row.challenger_user_id;
  const youValue = progress.has(myUserId) ? (progress.get(myUserId) ?? 0) : 0;
  const rivalValue = progress.has(rivalUserId) ? (progress.get(rivalUserId) ?? null) : null;
  return jsonOk({ ok: true, you: youValue, rival: rivalValue });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels/:id/resolve
//
// Steps Duel Scoring v1 (v3 Phase 1y). Server-authoritative
// resolution. Reads both participants' latest steps snapshots
// (missing = 0), compares, writes the winner / result, marks the
// duel completed. Idempotent — re-calling after completion returns
// the existing result row.
//
// Rejects:
//   - non-participant   → 403 FORBIDDEN
//   - now < ends_at     → 400 DUEL_NOT_ENDED
//   - non-steps duel    → 400 DUEL_TYPE_NOT_SCORED_YET
// ─────────────────────────────────────────────────────────────
export async function handleDuelsResolve(
  _request: Request,
  env: Env,
  session: SessionPayload,
  duelId: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const row = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!row) {
    return jsonError(404, 'NOT_FOUND', 'Duel not found.');
  }
  if (
    row.challenger_user_id !== session.userId &&
    row.opponent_user_id !== session.userId
  ) {
    return jsonError(403, 'FORBIDDEN', 'You are not a participant in this duel.');
  }

  // Idempotent return path.
  if (row.status === 'completed') {
    const aliasMap = await getAliasMap(env, [row.challenger_user_id, row.opponent_user_id]);
    const progress = await getDuelProgress(env, duelId);
    return jsonOk({
      ok: true,
      duel: serializeDuel(row, aliasMap, session.userId, progress),
      already_resolved: true,
    });
  }

  if (row.duel_type !== 'steps') {
    return jsonError(
      400,
      'DUEL_TYPE_NOT_SCORED_YET',
      'Only steps duels are scored in this version.',
    );
  }
  if (row.status !== 'active') {
    return jsonError(400, 'BAD_STATE', `Cannot resolve from status "${row.status}".`);
  }
  if (!row.ends_at) {
    return jsonError(400, 'BAD_STATE', 'Duel has no ends_at timestamp.');
  }
  const endsMs = Date.parse(row.ends_at);
  if (Number.isFinite(endsMs) && Date.now() < endsMs) {
    return jsonError(400, 'DUEL_NOT_ENDED', 'Duel has not yet ended.');
  }

  // Resolve. Missing snapshot = 0.
  const progress = await getDuelProgress(env, duelId);
  const challengerScore = progress.has(row.challenger_user_id)
    ? (progress.get(row.challenger_user_id) ?? 0)
    : 0;
  const opponentScore = progress.has(row.opponent_user_id)
    ? (progress.get(row.opponent_user_id) ?? 0)
    : 0;

  let winnerUserId: string | null;
  let result: 'challenger_win' | 'opponent_win' | 'draw';
  if (challengerScore > opponentScore) {
    winnerUserId = row.challenger_user_id;
    result = 'challenger_win';
  } else if (opponentScore > challengerScore) {
    winnerUserId = row.opponent_user_id;
    result = 'opponent_win';
  } else {
    winnerUserId = null;
    result = 'draw';
  }

  await env.DB.prepare(
    `UPDATE duels
        SET status = 'completed',
            winner_user_id = ?,
            result = ?,
            challenger_score = ?,
            opponent_score = ?,
            challenger_verified_score = ?,
            opponent_verified_score = ?,
            resolved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(
      winnerUserId,
      result,
      challengerScore,
      opponentScore,
      challengerScore,
      opponentScore,
      duelId,
    )
    .run();

  const refreshed = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!refreshed) {
    return jsonError(500, 'INTERNAL', 'Failed to read back resolved duel.');
  }
  const aliasMap = await getAliasMap(env, [
    refreshed.challenger_user_id,
    refreshed.opponent_user_id,
  ]);
  return jsonOk({
    ok: true,
    duel: serializeDuel(refreshed, aliasMap, session.userId, progress),
    resolved: true,
  });
}
