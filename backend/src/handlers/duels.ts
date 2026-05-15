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

  const incoming: Record<string, unknown>[] = [];
  const outgoing: Record<string, unknown>[] = [];
  const active: Record<string, unknown>[] = [];
  const recent: Record<string, unknown>[] = [];

  for (const row of allRows) {
    const serialized = serializeDuel(row, aliasMap, session.userId);
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
  return jsonOk({ ok: true, duel: serializeDuel(row, aliasMap, session.userId) });
}
