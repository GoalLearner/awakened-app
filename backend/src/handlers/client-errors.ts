/**
 * POST /v1/users/me/client-errors
 *
 * W746 (item 4 of the vibe-code audit) — client error ingestion. The iOS app
 * reports uncaught JS errors (window.onerror / unhandledrejection) here so the
 * owner can SEE production breakage instead of learning about it from churn.
 * Read via `wrangler d1 execute` (see migrations/0041_client_errors.sql).
 *
 * Abuse posture:
 *   - Authenticated (session JWT) — no anonymous ingestion surface.
 *   - RL_CLIENT_ERRORS rate limit per user (6/min) on top of the client's own
 *     per-session cap, so a crash-looping client can't flood D1.
 *   - Every text field length-clamped server-side; extra fields ignored.
 *   - 30-day retention prune runs on each insert (cheap, indexed) so the table
 *     is self-bounding.
 *
 * Body: { message: string, stack?: string, build?: string, path?: string }
 * Returns 200 { ok: true } — ALWAYS soft-succeeds on valid input; an error
 * reporter that throws its own errors helps nobody.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Clamp a possibly-absent string field to a max length; null when unusable. */
function clamp(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > max ? t.slice(0, max) : t;
}

export async function handleClientErrorsPost(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_CLIENT_ERRORS.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many error reports. Slow down.');
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object') {
    return jsonError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }

  const message = clamp(body.message, 500);
  if (!message) {
    return jsonError(400, 'MESSAGE_REQUIRED', 'message field is required.');
  }
  const stack = clamp(body.stack, 2000);
  const build = clamp(body.build, 40);
  const path = clamp(body.path, 120);

  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO client_errors (user_id, created_at, build, path, message, stack) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(session.userId, now, build, path, message, stack)
    .run();

  // Self-bounding retention: drop anything past the 30-day window. Indexed on
  // created_at so this is a cheap range delete; running it inline (rather than
  // on a cron) means the table can never outgrow the window even if crons stall.
  await env.DB.prepare('DELETE FROM client_errors WHERE created_at < ?')
    .bind(now - RETENTION_MS)
    .run();

  return jsonOk({ ok: true });
}
