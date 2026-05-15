/**
 * Discipline Duels v1 (v3 Phase 1x) — friends handler.
 *
 *   GET    /v1/friends                 — list (friends + incoming + outgoing)
 *   POST   /v1/friends/request         — send a friend request by alias
 *   POST   /v1/friends/:id/accept      — recipient accepts a pending request
 *   POST   /v1/friends/:id/decline     — recipient declines
 *   POST   /v1/friends/:id/remove      — either accepted friend can remove
 *
 * Auth required on every endpoint. user_id is always derived from the
 * verified session JWT; clients cannot pass user_id in the body.
 *
 * Inverse-pending policy: if A has a pending request to B and B tries to
 * send one to A, B's attempt AUTO-ACCEPTS the existing row instead of
 * creating a duplicate inverse. The friendship becomes accepted with the
 * original requester preserved. Returns the (now accepted) row.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

interface FriendRow {
  id: string;
  requester_user_id: string;
  recipient_user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface UserAliasRow {
  id: string;
  alias: string;
}

/** Normalize alias for case/space-insensitive lookup. Matches the
 *  client-side display normalization in app.js' lbNormalizeAliasForDisplay. */
function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '');
}

function validateAliasInput(
  alias: unknown,
): { ok: true; trimmed: string } | { ok: false; reason: string } {
  if (typeof alias !== 'string') {
    return { ok: false, reason: 'alias must be a string.' };
  }
  const trimmed = alias.trim();
  if (trimmed.length < 3 || trimmed.length > 20) {
    return { ok: false, reason: 'alias must be 3–20 characters.' };
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(trimmed)) {
    return {
      ok: false,
      reason: 'alias may only contain letters, numbers, spaces, underscores, and hyphens.',
    };
  }
  return { ok: true, trimmed };
}

/** Look up a user by alias case-insensitive + space-insensitive. */
async function findUserByAlias(
  env: Env,
  rawAlias: string,
): Promise<UserAliasRow | null> {
  const norm = normalizeAlias(rawAlias);
  // SQLite has REPLACE() built-in; build the same normalized form on
  // the stored alias side and compare.
  const row = await env.DB.prepare(
    "SELECT id, alias FROM users WHERE LOWER(REPLACE(alias, ' ', '')) = ? LIMIT 1",
  )
    .bind(norm)
    .first<UserAliasRow>();
  return row ?? null;
}

/** Build the response shape for a single friend row from the perspective
 *  of `viewerUserId`. The "other" party's alias is fetched from users. */
async function serializeFriendRow(
  env: Env,
  row: FriendRow,
  viewerUserId: string,
): Promise<{
  id: string;
  user_id: string;
  alias: string;
  status: string;
  direction: 'incoming' | 'outgoing' | 'mutual';
  created_at: string;
  updated_at: string;
} | null> {
  const otherId =
    row.requester_user_id === viewerUserId
      ? row.recipient_user_id
      : row.requester_user_id;
  const direction: 'incoming' | 'outgoing' | 'mutual' =
    row.status === 'accepted'
      ? 'mutual'
      : row.requester_user_id === viewerUserId
        ? 'outgoing'
        : 'incoming';
  const other = await env.DB.prepare('SELECT alias FROM users WHERE id = ?')
    .bind(otherId)
    .first<{ alias: string }>();
  if (!other) return null;
  return {
    id: row.id,
    user_id: otherId,
    alias: other.alias,
    status: row.status,
    direction,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────
// GET /v1/friends
// ─────────────────────────────────────────────────────────────
export async function handleFriendsList(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many friend reads. Try again in a minute.');
  }

  const rows = await env.DB.prepare(
    `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at
       FROM friends
      WHERE (requester_user_id = ? OR recipient_user_id = ?)
        AND status IN ('pending', 'accepted')
      ORDER BY updated_at DESC`,
  )
    .bind(session.userId, session.userId)
    .all<FriendRow>();

  const friends: ReturnType<typeof JSON.parse>[] = [];
  const incoming: ReturnType<typeof JSON.parse>[] = [];
  const outgoing: ReturnType<typeof JSON.parse>[] = [];

  for (const row of rows.results ?? []) {
    const serialized = await serializeFriendRow(env, row, session.userId);
    if (!serialized) continue;
    if (serialized.status === 'accepted') friends.push(serialized);
    else if (serialized.direction === 'incoming') incoming.push(serialized);
    else outgoing.push(serialized);
  }

  return jsonOk({ ok: true, friends, incoming, outgoing });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/friends/request   body: { alias }
// ─────────────────────────────────────────────────────────────
export async function handleFriendsRequest(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many friend requests. Try again in a minute.');
  }

  let body: { alias?: unknown };
  try {
    body = (await request.json()) as { alias?: unknown };
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const check = validateAliasInput(body?.alias);
  if (!check.ok) {
    return jsonError(400, 'ALIAS_INVALID', check.reason);
  }

  // Look up target user by normalized alias.
  const target = await findUserByAlias(env, check.trimmed);
  if (!target) {
    return jsonError(404, 'USER_NOT_FOUND', `No hunter found with alias "${check.trimmed}".`);
  }
  if (target.id === session.userId) {
    return jsonError(400, 'SELF_FRIEND', 'You cannot friend yourself.');
  }

  // Already-accepted check (either direction).
  const existingAccepted = await env.DB.prepare(
    `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at
       FROM friends
      WHERE status = 'accepted'
        AND ((requester_user_id = ? AND recipient_user_id = ?)
          OR (requester_user_id = ? AND recipient_user_id = ?))
      LIMIT 1`,
  )
    .bind(session.userId, target.id, target.id, session.userId)
    .first<FriendRow>();
  if (existingAccepted) {
    const friend = await serializeFriendRow(env, existingAccepted, session.userId);
    return jsonOk({ ok: true, friend, alreadyFriends: true });
  }

  // Caller already sent a pending request → return the existing row.
  const outgoingPending = await env.DB.prepare(
    `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at
       FROM friends
      WHERE status = 'pending'
        AND requester_user_id = ?
        AND recipient_user_id = ?
      LIMIT 1`,
  )
    .bind(session.userId, target.id)
    .first<FriendRow>();
  if (outgoingPending) {
    const friend = await serializeFriendRow(env, outgoingPending, session.userId);
    return jsonOk({ ok: true, friend, alreadyPending: true });
  }

  // Inverse-pending → AUTO-ACCEPT (decision 1). Don't create a duplicate
  // inverse row; flip the original to 'accepted' and return it.
  const inversePending = await env.DB.prepare(
    `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at
       FROM friends
      WHERE status = 'pending'
        AND requester_user_id = ?
        AND recipient_user_id = ?
      LIMIT 1`,
  )
    .bind(target.id, session.userId)
    .first<FriendRow>();
  if (inversePending) {
    await env.DB.prepare(
      "UPDATE friends SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
      .bind(inversePending.id)
      .run();
    const refreshed = { ...inversePending, status: 'accepted' };
    const friend = await serializeFriendRow(env, refreshed, session.userId);
    return jsonOk({ ok: true, friend, autoAccepted: true });
  }

  // Otherwise — create a fresh pending row.
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO friends (id, requester_user_id, recipient_user_id, status)
       VALUES (?, ?, ?, 'pending')`,
    )
      .bind(id, session.userId, target.id)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    // UNIQUE(requester, recipient) — race condition w/ a prior pending or
    // declined row that was logically replaced by a fresh request.
    if (msg.includes('UNIQUE') || msg.includes('constraint')) {
      // Could be a stale declined row blocking. Find + flip to pending.
      const stale = await env.DB.prepare(
        `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at
           FROM friends
          WHERE requester_user_id = ? AND recipient_user_id = ?
          LIMIT 1`,
      )
        .bind(session.userId, target.id)
        .first<FriendRow>();
      if (stale && stale.status === 'declined') {
        await env.DB.prepare(
          "UPDATE friends SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
          .bind(stale.id)
          .run();
        const refreshed = { ...stale, status: 'pending' };
        const friend = await serializeFriendRow(env, refreshed, session.userId);
        return jsonOk({ ok: true, friend, revived: true });
      }
      return jsonError(409, 'FRIEND_CONFLICT', 'A friend request between you already exists.');
    }
    throw err;
  }

  const created = await env.DB.prepare(
    `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at
       FROM friends WHERE id = ?`,
  )
    .bind(id)
    .first<FriendRow>();
  if (!created) {
    return jsonError(500, 'INTERNAL', 'Failed to read back created friend row.');
  }
  const friend = await serializeFriendRow(env, created, session.userId);
  return jsonOk({ ok: true, friend });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/friends/:id/accept
// ─────────────────────────────────────────────────────────────
export async function handleFriendsAccept(
  _request: Request,
  env: Env,
  session: SessionPayload,
  friendshipId: string,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const row = await env.DB.prepare(
    `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at
       FROM friends WHERE id = ?`,
  )
    .bind(friendshipId)
    .first<FriendRow>();
  if (!row) {
    return jsonError(404, 'NOT_FOUND', 'Friend request not found.');
  }
  if (row.recipient_user_id !== session.userId) {
    return jsonError(403, 'FORBIDDEN', 'Only the recipient can accept this request.');
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot accept from status "${row.status}".`);
  }
  await env.DB.prepare(
    "UPDATE friends SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(friendshipId)
    .run();
  const refreshed = { ...row, status: 'accepted' };
  const friend = await serializeFriendRow(env, refreshed, session.userId);
  return jsonOk({ ok: true, friend });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/friends/:id/decline
// ─────────────────────────────────────────────────────────────
export async function handleFriendsDecline(
  _request: Request,
  env: Env,
  session: SessionPayload,
  friendshipId: string,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const row = await env.DB.prepare(
    `SELECT id, requester_user_id, recipient_user_id, status
       FROM friends WHERE id = ?`,
  )
    .bind(friendshipId)
    .first<FriendRow>();
  if (!row) {
    return jsonError(404, 'NOT_FOUND', 'Friend request not found.');
  }
  if (row.recipient_user_id !== session.userId) {
    return jsonError(403, 'FORBIDDEN', 'Only the recipient can decline this request.');
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot decline from status "${row.status}".`);
  }
  await env.DB.prepare(
    "UPDATE friends SET status = 'declined', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(friendshipId)
    .run();
  return jsonOk({ ok: true, declined: true });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/friends/:id/remove
// ─────────────────────────────────────────────────────────────
export async function handleFriendsRemove(
  _request: Request,
  env: Env,
  session: SessionPayload,
  friendshipId: string,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const row = await env.DB.prepare(
    `SELECT id, requester_user_id, recipient_user_id, status
       FROM friends WHERE id = ?`,
  )
    .bind(friendshipId)
    .first<FriendRow>();
  if (!row) {
    return jsonError(404, 'NOT_FOUND', 'Friend not found.');
  }
  if (row.requester_user_id !== session.userId && row.recipient_user_id !== session.userId) {
    return jsonError(403, 'FORBIDDEN', 'You are not part of this friendship.');
  }
  if (row.status !== 'accepted') {
    return jsonError(400, 'BAD_STATE', 'Only accepted friendships can be removed.');
  }
  await env.DB.prepare('DELETE FROM friends WHERE id = ?').bind(friendshipId).run();
  return jsonOk({ ok: true, removed: true });
}

// Shared helper used by duels.ts to verify two users are accepted friends.
export async function areAcceptedFriends(
  env: Env,
  userIdA: string,
  userIdB: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM friends
      WHERE status = 'accepted'
        AND ((requester_user_id = ? AND recipient_user_id = ?)
          OR (requester_user_id = ? AND recipient_user_id = ?))
      LIMIT 1`,
  )
    .bind(userIdA, userIdB, userIdB, userIdA)
    .first();
  return !!row;
}

// Shared helper exported for duels.ts (alias resolution).
export { findUserByAlias, validateAliasInput, normalizeAlias };
