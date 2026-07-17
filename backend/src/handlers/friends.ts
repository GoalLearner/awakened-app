/**
 * Friends handler (v3 Phase 1x, retitled by 1z.279 Duels retirement).
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
import { notifyUser } from '../lib/apns';

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

interface PublicProfileFriendRow {
  rank_tier: string | null;
  rank_division: string | null;
  rank_label: string | null;
  rank_sort_value: number | null;
  prestige: number | null;   // W453 — Prestige star count (S+ endgame)
  founder_seq: number | null; // W656/W700 — Founder mark # (non-null ⇒ lifetime member)
  server_updated_at: number | null;
  // v3 Phase 1z.195 — Global Friend Achievements MVP-A.
  // Cumulative count aggregates + a public-safe streak label.
  // rank_points + metadata_json are still intentionally withheld
  // from friend responses.
  bosses_slain_total: number | null;
  ultra_rare_drops_total: number | null;
  verified_streak_label: string | null;
  achievements_updated_at: number | null;
}

interface SerializedFriendRow {
  id: string;
  user_id: string;
  alias: string;
  status: string;
  direction: 'incoming' | 'outgoing' | 'mutual';
  created_at: string;
  updated_at: string;
  // v3 Phase 1z.190 — optional friend rank badge fields, present
  // only when the friend has submitted a public_profile_summary.
  // rank_points is intentionally OMITTED here (privacy: hides
  // exact XP magnitude). metadata_json is reserved for future
  // achievement payloads and is also intentionally withheld.
  rankTier?: string;
  rankDivision?: string | null;
  rankLabel?: string;
  rankSortValue?: number;
  prestige?: number;   // W453 — Prestige star count, present with the rank badge
  // W700 — membership flag for the members-raid ally picker: true when the friend
  // holds a Founder mark (lifetime) OR an active premium subscription. Always present
  // on the LIST path (handleFriendsList); the client greys out non-members for the raid.
  member?: boolean;
  rankUpdatedAt?: string;
  // v3 Phase 1z.195 — Global Friend Achievements MVP-A. Cumulative
  // count aggregates + a public-safe verified streak label. Only
  // present when the friend has submitted achievements.
  // verifiedStreakLabel uses streak TYPE + LENGTH only ("30-day MR
  // streak"); the user's private habit name is NEVER part of it.
  bossesSlainTotal?: number;
  ultraRareDropsTotal?: number;
  verifiedStreakLabel?: string | null;
  achievementsUpdatedAt?: string;
}

/** Build the response shape for a single friend row from the perspective
 *  of `viewerUserId`. The "other" party's alias is fetched from users
 *  and optional rank fields are LEFT-JOINed from
 *  public_profile_summary (v3 Phase 1z.190). */
// Shared projection for the "other" party's users + public_profile_summary
// join (LEFT JOIN so a friend with no summary still resolves on alias alone).
// __joinId carries u.id so the BATCH path (handleFriendsList) can key a Map.
const FRIEND_PROFILE_COLS = `u.id                    AS __joinId,
            u.alias                  AS alias,
            p.rank_tier              AS rank_tier,
            p.rank_division          AS rank_division,
            p.rank_label             AS rank_label,
            p.rank_sort_value        AS rank_sort_value,
            p.prestige_level         AS prestige,
            p.founder_seq            AS founder_seq,
            p.server_updated_at      AS server_updated_at,
            p.bosses_slain_total     AS bosses_slain_total,
            p.ultra_rare_drops_total AS ultra_rare_drops_total,
            p.verified_streak_label  AS verified_streak_label,
            p.achievements_updated_at AS achievements_updated_at`;

type JoinedFriendProfile = { __joinId: string; alias: string } & PublicProfileFriendRow;

// W673 — pure in-memory mapper: build a serialized friend row from an already-
// fetched joined profile (or null → skip, mirroring the old `if (!joined) return
// null`). Extracted so the list path can batch the reads (see handleFriendsList)
// instead of one DB round-trip per friend (N+1). Behavior byte-identical to the
// prior serializeFriendRow body — only the DB fetch moved out.
function mapFriendRow(
  row: FriendRow,
  viewerUserId: string,
  joined: JoinedFriendProfile | null | undefined,
): SerializedFriendRow | null {
  if (!joined) return null;
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
  const out: SerializedFriendRow = {
    id: row.id,
    user_id: otherId,
    alias: joined.alias,
    status: row.status,
    direction,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  // Merge optional rank fields only when the friend has a summary.
  // rankLabel + rank_tier are NOT NULL on the summary row, so their
  // presence is the gate. rank_points is NEVER returned to friends in v1.
  if (joined.rank_label && joined.rank_tier) {
    out.rankTier      = joined.rank_tier;
    out.rankDivision  = joined.rank_division; // may be null for S+
    out.rankLabel     = joined.rank_label;
    out.rankSortValue = joined.rank_sort_value ?? 0;
    out.prestige      = joined.prestige ?? 0; // W453 — 0 unless S+

    if (typeof joined.server_updated_at === 'number' && Number.isFinite(joined.server_updated_at)) {
      out.rankUpdatedAt = new Date(joined.server_updated_at).toISOString();
    }
    // v3 Phase 1z.195 — achievement summary fields. Only surface them once the
    // friend has actually submitted achievements (gated on achievements_updated_at
    // being non-null): distinguishes "never submitted" (omit all) from "submitted
    // zero bosses" (return 0 honestly). Streak label may be null (deliberate clear).
    if (typeof joined.achievements_updated_at === 'number'
        && Number.isFinite(joined.achievements_updated_at)) {
      out.bossesSlainTotal     = joined.bosses_slain_total ?? 0;
      out.ultraRareDropsTotal  = joined.ultra_rare_drops_total ?? 0;
      out.verifiedStreakLabel  = joined.verified_streak_label; // may be null
      out.achievementsUpdatedAt = new Date(joined.achievements_updated_at).toISOString();
    }
  }
  return out;
}

// Single-row serialize (used by the six write-path callers — accept/decline/
// remove/request responses — where it's one row, not N+1). Fetches then maps.
async function serializeFriendRow(
  env: Env,
  row: FriendRow,
  viewerUserId: string,
): Promise<SerializedFriendRow | null> {
  const otherId =
    row.requester_user_id === viewerUserId
      ? row.recipient_user_id
      : row.requester_user_id;
  const joined = await env.DB.prepare(
    `SELECT ${FRIEND_PROFILE_COLS}
       FROM users u
       LEFT JOIN public_profile_summary p ON p.user_id = u.id
      WHERE u.id = ?`,
  )
    .bind(otherId)
    .first<JoinedFriendProfile>();
  return mapFriendRow(row, viewerUserId, joined);
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

  const rowList = rows.results ?? [];
  // W673 — batch the per-friend profile read (was 1 DB round-trip per row = N+1).
  // Collect every distinct "other" user id, fetch them in one IN(...) query
  // (chunked to stay under SQLite's ~999 bound-param cap), then map each friend
  // row from an in-memory Map. Turns 1+F sequential queries into ~2.
  const otherIdOf = (r: FriendRow) =>
    r.requester_user_id === session.userId ? r.recipient_user_id : r.requester_user_id;
  const otherIds = [...new Set(rowList.map(otherIdOf))];
  const joinedMap = new Map<string, JoinedFriendProfile>();
  const CHUNK = 400;
  for (let i = 0; i < otherIds.length; i += CHUNK) {
    const slice = otherIds.slice(i, i + CHUNK);
    const ph = slice.map(() => '?').join(',');
    const jr = await env.DB.prepare(
      `SELECT ${FRIEND_PROFILE_COLS}
         FROM users u
         LEFT JOIN public_profile_summary p ON p.user_id = u.id
        WHERE u.id IN (${ph})`,
    )
      .bind(...slice)
      .all<JoinedFriendProfile>();
    for (const j of jr.results ?? []) joinedMap.set(j.__joinId, j);
  }

  // W700 — per-friend membership (drives the members-raid ally picker's grey-out).
  // member = a Founder mark (comes free off the join above, founder_seq) OR an active
  // premium subscription (batched over the same ids). Guarded for the un-migrated case
  // (premium_subscriptions absent) exactly like readEntitlements — a friends read must
  // never 500 on a missing table; those friends simply read as non-premium.
  const now = Date.now();
  const premiumSet = new Set<string>();
  try {
    for (let i = 0; i < otherIds.length; i += CHUNK) {
      const slice = otherIds.slice(i, i + CHUNK);
      if (!slice.length) continue;
      const ph = slice.map(() => '?').join(',');
      const pr = await env.DB.prepare(
        `SELECT user_id FROM premium_subscriptions WHERE user_id IN (${ph}) AND expires_at_ms > ?`,
      )
        .bind(...slice, now)
        .all<{ user_id: string }>();
      for (const p of pr.results ?? []) premiumSet.add(p.user_id);
    }
  } catch (e) {
    const msg = String((e && (e as Error).message) || e);
    if (!/no such table/i.test(msg)) throw e;
  }

  for (const row of rowList) {
    const oid = otherIdOf(row);
    const joined = joinedMap.get(oid) ?? null;
    const serialized = mapFriendRow(row, session.userId, joined);
    if (!serialized) continue;
    serialized.member = (joined?.founder_seq != null) || premiumSet.has(oid);   // W700
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
  ctx?: ExecutionContext,
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
    // W603 — the ORIGINAL requester (target.id) is now friends → tell them.
    if (ctx)
      ctx.waitUntil(
        notifyUser(env, target.id, {
          title: 'Guild Request Accepted',
          body: `${session.alias} accepted your request — you're now in the same guild.`,
          type: 'friend_accepted',
        }),
      );
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
    // A uniqueness constraint fired — either the legacy directional
    // UNIQUE(requester, recipient) (a stale same-direction row) OR the W674
    // partial live-pair index idx_friends_live_pair (a concurrent request for the
    // same pair won the race between our pre-checks and this INSERT). Re-derive the
    // pair's live state and converge to the SAME outcome the pre-checks would have,
    // so a raced request never dead-ends at a spurious conflict.
    if (msg.includes('UNIQUE') || msg.includes('constraint')) {
      // (a) THE MUTUAL-ADD RACE: an inverse pending (target -> me) now exists →
      // AUTO-ACCEPT it, exactly like the inversePending pre-check above. This is
      // the case the old handler mishandled (it fell through to FRIEND_CONFLICT,
      // and — pre-W674 — often let a second directional row be created instead).
      const invPending = await env.DB.prepare(
        `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at
           FROM friends
          WHERE requester_user_id = ? AND recipient_user_id = ? AND status = 'pending'
          LIMIT 1`,
      )
        .bind(target.id, session.userId)
        .first<FriendRow>();
      if (invPending) {
        await env.DB.prepare(
          "UPDATE friends SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
          .bind(invPending.id)
          .run();
        const friend = await serializeFriendRow(env, { ...invPending, status: 'accepted' }, session.userId);
        if (ctx)
          ctx.waitUntil(
            notifyUser(env, target.id, {
              title: 'Guild Request Accepted',
              body: `${session.alias} accepted your request — you're now in the same guild.`,
              type: 'friend_accepted',
            }),
          );
        return jsonOk({ ok: true, friend, autoAccepted: true });
      }
      // (b) same-direction row (me -> target): a stale DECLINED row is revived to
      // pending; an existing pending/accepted one is simply returned idempotently.
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
        // W603 — revived pending request → push the recipient like a fresh one.
        if (ctx)
          ctx.waitUntil(
            notifyUser(env, target.id, {
              title: 'Guild Request',
              body: `${session.alias} wants to join your guild.`,
              type: 'friend_request',
            }),
          );
        return jsonOk({ ok: true, friend, revived: true });
      }
      if (stale && (stale.status === 'pending' || stale.status === 'accepted')) {
        const friend = await serializeFriendRow(env, stale, session.userId);
        return jsonOk({ ok: true, friend, ...(stale.status === 'accepted' ? { alreadyFriends: true } : { alreadyPending: true }) });
      }
      // (c) inverse ACCEPTED (target -> me) → already friends.
      const invAccepted = await env.DB.prepare(
        `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at
           FROM friends
          WHERE requester_user_id = ? AND recipient_user_id = ? AND status = 'accepted'
          LIMIT 1`,
      )
        .bind(target.id, session.userId)
        .first<FriendRow>();
      if (invAccepted) {
        const friend = await serializeFriendRow(env, invAccepted, session.userId);
        return jsonOk({ ok: true, friend, alreadyFriends: true });
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
  // W603 — the whole point: push the recipient NOW, even if their app is
  // closed, so a friend request is a live event, not a next-open discovery.
  if (ctx)
    ctx.waitUntil(
      notifyUser(env, target.id, {
        title: 'Guild Request',
        body: `${session.alias} wants to join your guild.`,
        type: 'friend_request',
      }),
    );
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
  ctx?: ExecutionContext,
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
  // W603 — tell the ORIGINAL requester their request was accepted.
  if (ctx)
    ctx.waitUntil(
      notifyUser(env, row.requester_user_id, {
        title: 'Guild Request Accepted',
        body: `${session.alias} accepted your request — you're now in the same guild.`,
        type: 'friend_accepted',
      }),
    );
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
  // W674 — delete BOTH directions of the accepted friendship, not just this id.
  // A pre-W674 mutual-add race could leave two accepted rows for the pair, so a
  // remove-by-id left the reciprocal row intact and areAcceptedFriends still
  // returned true ("remove" silently failed). The new partial unique index means
  // only one live row exists going forward, but deleting both directions is the
  // correct, damage-proof teardown.
  await env.DB.prepare(
    `DELETE FROM friends
      WHERE status = 'accepted'
        AND ( (requester_user_id = ? AND recipient_user_id = ?)
           OR (requester_user_id = ? AND recipient_user_id = ?) )`,
  )
    .bind(row.requester_user_id, row.recipient_user_id, row.recipient_user_id, row.requester_user_id)
    .run();
  return jsonOk({ ok: true, removed: true });
}

// v3 Phase 1z.279 — Duels permanently retired. The areAcceptedFriends
// helper and the findUserByAlias/validateAliasInput/normalizeAlias
// re-exports both used to be consumed by duels.ts (gone in Phase 3),
// and nothing else imports them — removed. Internal callers within
// this file (the existing /v1/friends/request handler) still use
// validateAliasInput and findUserByAlias directly.
