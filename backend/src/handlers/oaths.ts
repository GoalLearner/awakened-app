/**
 * oaths.ts — W867 (Wave 2 Train B) THE OATHBOUND.
 *
 * A C-rank+ veteran swears a 14-day oath over a zero-kill friend's first
 * boss kill. When the rookie's public_profile_summary bosses_slain_total
 * first rises above zero inside the window, the oath fulfills: both sides
 * gain a claimable 50-souls reward (flat — the first kill is an E-rank
 * gate by construction) and the mentor gets a push. Idle oaths expire
 * lazily and penalty-free.
 *
 * Guards: accepted friendship required; mentor rank_tier ∈ C/B/A/S/S+;
 * rookie bosses_slain_total = 0; ≤2 pending oaths per mentor; one pending
 * oath per rookie (partial unique index backstops the handler check).
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { notifyUser } from '../lib/apns';

const OATH_WINDOW_MS = 14 * 24 * 3600 * 1000;
const OATH_MAX_PENDING_PER_MENTOR = 2;
export const OATH_SOULS = 50;
const MENTOR_TIERS = new Set(['C', 'B', 'A', 'S', 'S+']);

interface OathRow {
  id: string;
  mentor_user_id: string;
  rookie_user_id: string;
  sworn_at: number;
  expires_at: number;
  status: string;
  fulfilled_at: number | null;
  mentor_claimed: number;
  rookie_claimed: number;
}

/** Lazy expiry: flip past-window pending rows before any read/claim. */
async function expireStale(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE oaths SET status = 'expired'
      WHERE status = 'pending' AND expires_at < ?
        AND (mentor_user_id = ? OR rookie_user_id = ?)`,
  ).bind(Date.now(), userId, userId).run();
}

export async function handleOathSwear(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  let body: { rookie_user_id?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'BAD_JSON', 'Invalid JSON body.'); }
  const rookieId = typeof body.rookie_user_id === 'string' ? body.rookie_user_id.trim() : '';
  if (!rookieId) return jsonError(400, 'MISSING_ROOKIE', 'rookie_user_id required.');
  if (rookieId === session.userId) return jsonError(400, 'SELF_OATH', 'You cannot swear over yourself.');

  // Accepted friendship in either direction.
  const friend = await env.DB.prepare(
    `SELECT 1 FROM friends
      WHERE status = 'accepted'
        AND ((requester_user_id = ? AND recipient_user_id = ?)
          OR (requester_user_id = ? AND recipient_user_id = ?))
      LIMIT 1`,
  ).bind(session.userId, rookieId, rookieId, session.userId).first();
  if (!friend) return jsonError(403, 'NOT_FRIENDS', 'An oath needs an accepted friendship.');

  // Mentor rank + rookie zero-kill from the profile summaries.
  const mentor = await env.DB.prepare(
    'SELECT rank_tier FROM public_profile_summary WHERE user_id = ?',
  ).bind(session.userId).first<{ rank_tier: string }>();
  if (!mentor || !MENTOR_TIERS.has(mentor.rank_tier)) {
    return jsonError(403, 'RANK_TOO_LOW', 'C-rank or higher swears oaths.');
  }
  const rookie = await env.DB.prepare(
    'SELECT bosses_slain_total FROM public_profile_summary WHERE user_id = ?',
  ).bind(rookieId).first<{ bosses_slain_total: number }>();
  if (rookie && (rookie.bosses_slain_total | 0) > 0) {
    return jsonError(409, 'NOT_A_ROOKIE', 'That hunter has already taken a first kill.');
  }

  await expireStale(env, session.userId);
  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM oaths WHERE mentor_user_id = ? AND status = 'pending'",
  ).bind(session.userId).first<{ n: number }>();
  if ((pending?.n ?? 0) >= OATH_MAX_PENDING_PER_MENTOR) {
    return jsonError(409, 'OATH_CAP', 'Two oaths at a time. Keep the ones you have.');
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO oaths (id, mentor_user_id, rookie_user_id, sworn_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
    ).bind(id, session.userId, rookieId, now, now + OATH_WINDOW_MS).run();
  } catch {
    // Partial unique index: the rookie is already under someone's oath.
    return jsonError(409, 'ALREADY_OATHBOUND', 'Another hunter already swore over them.');
  }

  const mentorAlias = await env.DB.prepare('SELECT alias FROM users WHERE id = ?')
    .bind(session.userId).first<{ alias: string }>();
  await notifyUser(env, rookieId, {
    title: 'An oath was sworn over you',
    body: (mentorAlias?.alias ?? 'A hunter') + ' believes your first kill comes within 14 days. Prove them right.',
    type: 'oath_sworn',
    data: {},
  });

  return jsonOk({ ok: true, id, expires_at: now + OATH_WINDOW_MS });
}

export async function handleOathsMine(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  await expireStale(env, session.userId);
  const rows = await env.DB.prepare(
    `SELECT o.*, mu.alias AS mentor_alias, ru.alias AS rookie_alias
       FROM oaths o
       JOIN users mu ON mu.id = o.mentor_user_id
       JOIN users ru ON ru.id = o.rookie_user_id
      WHERE o.mentor_user_id = ? OR o.rookie_user_id = ?
      ORDER BY o.sworn_at DESC LIMIT 20`,
  ).bind(session.userId, session.userId).all<OathRow & { mentor_alias: string; rookie_alias: string }>();
  return jsonOk({ ok: true, oaths: rows.results ?? [], souls: OATH_SOULS });
}

export async function handleOathClaim(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: { oath_id?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'BAD_JSON', 'Invalid JSON body.'); }
  const oathId = typeof body.oath_id === 'string' ? body.oath_id : '';
  if (!oathId) return jsonError(400, 'MISSING_OATH', 'oath_id required.');
  const row = await env.DB.prepare('SELECT * FROM oaths WHERE id = ?').bind(oathId).first<OathRow>();
  if (!row || row.status !== 'fulfilled') return jsonError(404, 'NOT_CLAIMABLE', 'No fulfilled oath here.');
  const isMentor = row.mentor_user_id === session.userId;
  const isRookie = row.rookie_user_id === session.userId;
  if (!isMentor && !isRookie) return jsonError(403, 'NOT_YOURS', 'Not your oath.');
  const col = isMentor ? 'mentor_claimed' : 'rookie_claimed';
  const res = await env.DB.prepare(
    `UPDATE oaths SET ${col} = 1 WHERE id = ? AND ${col} = 0`,
  ).bind(oathId).run();
  const first = Number(res.meta?.changes ?? 0) >= 1;
  return jsonOk({ ok: true, first, souls: first ? OATH_SOULS : 0 });
}

/** Called from the profile-summary PUT after a submit lands with kills > 0:
 *  fulfill any live oath over this rookie + push the mentor. Fast no-op for
 *  the 99% (single indexed read). Never throws. */
export async function resolveOathsOnFirstKill(env: Env, rookieUserId: string): Promise<void> {
  try {
    const now = Date.now();
    const row = await env.DB.prepare(
      "SELECT id, mentor_user_id FROM oaths WHERE rookie_user_id = ? AND status = 'pending' LIMIT 1",
    ).bind(rookieUserId).first<{ id: string; mentor_user_id: string; expires_at?: number }>();
    if (!row) return;
    const upd = await env.DB.prepare(
      "UPDATE oaths SET status = 'fulfilled', fulfilled_at = ? WHERE id = ? AND status = 'pending' AND expires_at >= ?",
    ).bind(now, row.id, now).run();
    if (Number(upd.meta?.changes ?? 0) < 1) return;   // raced or expired — lazy expiry handles it
    const rookie = await env.DB.prepare('SELECT alias FROM users WHERE id = ?')
      .bind(rookieUserId).first<{ alias: string }>();
    await notifyUser(env, row.mentor_user_id, {
      title: 'The oath is fulfilled',
      body: (rookie?.alias ?? 'Your rookie') + ' took their first kill. The Oathkeeper reward waits in Awakened.',
      type: 'oath_fulfilled',
      data: {},
    });
  } catch (e) {
    console.warn('[oaths] resolve failed', e instanceof Error ? e.message : String(e));
  }
}
