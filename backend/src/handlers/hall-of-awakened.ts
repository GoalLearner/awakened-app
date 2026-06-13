/**
 * The Hall of the Awakened (W270) — the eternal registry of every user
 * who has completed all 100 floors of the Ascent, in finish order.
 *
 * POST /v1/users/me/hall-of-awakened
 *   Records the caller as a finisher and assigns the next global ordinal
 *   (1 = the first finisher, forever). Once-ever per user: re-submits are
 *   idempotent and return the existing ordinal. The ordinal is assigned
 *   server-side via INSERT ... SELECT MAX(ordinal)+1 ... WHERE NOT EXISTS
 *   — D1 serialises writes, so concurrent finishes never collide; the
 *   user_id PK + UNIQUE(ordinal) are the belt-and-braces.
 *
 *   Trust model: identical to Arena titles (public-profile-summary). The
 *   backend cannot verify the climb from server data — the Arena is
 *   cosmetic and client-authoritative — and the Hall grants no rewards,
 *   so a client-asserted finish is acceptable.
 *
 * GET /v1/hall-of-awakened?limit=N
 *   Returns { total, me, top[], near[] } for the Roll: the first
 *   finishers (#1..N), the caller's neighbourhood (±2 around their
 *   ordinal), and the caller's own ordinal. Aliases are JOINed live.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

const DEFAULT_TOP = 4;
const MAX_TOP = 50;
const NEIGHBORS = 2; // ±N rows around the caller for the "your place" cluster

interface FinisherRow {
  ordinal: number;
  alias: string;
  finished_at_ms: number;
  user_id: string;
}
interface MeRow {
  ordinal: number;
  finished_at_ms: number;
}
interface CountRow {
  total: number;
}

function publicRow(r: FinisherRow, meUserId: string) {
  return {
    ordinal: r.ordinal,
    alias: r.alias,
    finishedAtMs: r.finished_at_ms,
    you: r.user_id === meUserId,
  };
}

// ── POST: record the caller's finish, assign the eternal ordinal ──────
export async function handleHallFinishPost(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_HALL_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  }

  // Optional client finish timestamp (display-only). Tolerated absent.
  let clientFinishedAt: string | null = null;
  try {
    const body = (await request.json()) as { clientFinishedAt?: unknown };
    if (typeof body?.clientFinishedAt === 'string' && body.clientFinishedAt.length <= 40) {
      clientFinishedAt = body.clientFinishedAt;
    }
  } catch (_) {
    // empty / malformed body is fine — the finish itself needs no payload
  }

  const nowMs = Date.now();
  // Once-ever insert. WHERE NOT EXISTS makes a re-submit a zero-row no-op
  // (the caller keeps their original ordinal). MAX(ordinal)+1 is safe
  // under D1's serialised writes; UNIQUE(ordinal) is the hard guard.
  await env.DB.prepare(
    `INSERT INTO hall_of_awakened (user_id, ordinal, finished_at_ms, client_finished_at)
     SELECT ?1, COALESCE((SELECT MAX(ordinal) FROM hall_of_awakened), 0) + 1, ?2, ?3
     WHERE NOT EXISTS (SELECT 1 FROM hall_of_awakened WHERE user_id = ?1)`,
  )
    .bind(session.userId, nowMs, clientFinishedAt)
    .run();

  const mine = await env.DB.prepare(
    `SELECT ordinal, finished_at_ms FROM hall_of_awakened WHERE user_id = ?`,
  )
    .bind(session.userId)
    .first<MeRow>();

  if (!mine) {
    // Should be unreachable (we just inserted-or-found), but never 500 on
    // a cosmetic path.
    return jsonError(500, 'HALL_WRITE_FAILED', 'Could not record the finish.');
  }

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM hall_of_awakened`,
  ).first<CountRow>();

  return jsonOk({
    ordinal: mine.ordinal,
    finishedAtMs: mine.finished_at_ms,
    total: countRow?.total ?? mine.ordinal,
  });
}

// ── GET: the roll (top finishers + the caller's neighbourhood) ────────
export async function handleHallGet(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_HALL_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  let topN = DEFAULT_TOP;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) topN = Math.min(parsed, MAX_TOP);
  }

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM hall_of_awakened`,
  ).first<CountRow>();
  const total = countRow?.total ?? 0;

  // The eternal first finishers (#1..topN).
  const topResult = await env.DB.prepare(
    `SELECT h.ordinal AS ordinal, u.alias AS alias,
            h.finished_at_ms AS finished_at_ms, h.user_id AS user_id
     FROM hall_of_awakened h
     JOIN users u ON u.id = h.user_id
     ORDER BY h.ordinal ASC
     LIMIT ?`,
  )
    .bind(topN)
    .all<FinisherRow>();
  const top = (topResult.results ?? []).map((r) => publicRow(r, session.userId));

  // The caller's own row (null if they haven't finished).
  const me = await env.DB.prepare(
    `SELECT ordinal, finished_at_ms FROM hall_of_awakened WHERE user_id = ?`,
  )
    .bind(session.userId)
    .first<MeRow>();

  // The caller's neighbourhood (±NEIGHBORS), only meaningful when they
  // sit outside the top block — otherwise `top` already shows them.
  let near: ReturnType<typeof publicRow>[] = [];
  if (me && me.ordinal > topN) {
    const nearResult = await env.DB.prepare(
      `SELECT h.ordinal AS ordinal, u.alias AS alias,
              h.finished_at_ms AS finished_at_ms, h.user_id AS user_id
       FROM hall_of_awakened h
       JOIN users u ON u.id = h.user_id
       WHERE h.ordinal BETWEEN ? AND ?
       ORDER BY h.ordinal ASC`,
    )
      .bind(me.ordinal - NEIGHBORS, me.ordinal + NEIGHBORS)
      .all<FinisherRow>();
    near = (nearResult.results ?? []).map((r) => publicRow(r, session.userId));
  }

  return jsonOk({
    total,
    me: me ? { ordinal: me.ordinal, finishedAtMs: me.finished_at_ms } : null,
    top,
    near,
  });
}
