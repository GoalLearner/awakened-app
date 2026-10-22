/**
 * auth-refresh.ts — W815: silent session renewal.
 *
 * POST /v1/auth/refresh
 *
 * The client presents its CURRENT session JWT (Authorization: Bearer).
 * Accepted when the signature/issuer/audience verify and exp is either
 * still valid or within REFRESH_GRACE_SECONDS past (30 days) — see
 * session-jwt.ts. On success a fresh 90-day JWT is issued for the same
 * user, with the alias re-read from the users table (alias changes and
 * account deletion are both honored: a deleted account has no row and
 * gets a 401, preserving the W740 invalidate-on-delete guarantee).
 *
 * This route lives BEFORE the strict Bearer gate in index.ts because the
 * strict verifier would reject the very tokens this endpoint exists to
 * rescue. It self-authenticates via the graced verifier instead — an
 * unauthenticated caller cannot mint anything (the signature check is
 * unchanged), so the endpoint grants nothing a stolen valid JWT wouldn't
 * already grant, and it EXTENDS nothing beyond what re-running Sign in
 * with Apple would produce.
 */
import type { Env } from '../env';
import { issueSessionJwt, verifySessionJwtForRefresh } from '../session-jwt';
import { jsonError, jsonOk } from '../lib/responses';

export async function handleAuthRefresh(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonError(401, 'AUTH_REQUIRED', 'Authorization header missing or malformed (expected "Bearer <jwt>").');
  }

  let session;
  try {
    session = await verifySessionJwtForRefresh(authHeader.slice(7), env);
  } catch {
    // Bad signature, wrong iss/aud, or expired beyond the grace window —
    // the client should clear local state and re-run Sign in with Apple.
    return jsonError(401, 'NOT_REFRESHABLE', 'Session is not refreshable. Sign in again.');
  }

  // W1075 — its own bucket (was the 30/min friends-read bucket, which a chatty boot could
  // drain first and 429 the one call that keeps a hunter signed in). Refresh fires about
  // once a day per device; the client keeps its session on a 429 and tries again later.
  const rl = await (env.RL_AUTH_REFRESH ?? env.RL_FRIENDS_READ).limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await env.DB.prepare('SELECT id, alias, token_version FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ id: string; alias: string; token_version: number | null }>();
  if (!row || typeof row.alias !== 'string' || row.alias.length === 0) {
    // W740 — account deleted (or never existed): refresh must not resurrect it.
    return jsonError(401, 'ACCOUNT_GONE', 'Account no longer exists. Sign in again.');
  }
  // W1075 — a token from before the hunter's last sign-out can never be exchanged for a
  // fresh one: that was the hole a stolen token lived in (90 days, renewed for ever).
  const current = Number(row.token_version ?? 0) || 0;
  if (current !== (session.tokenVersion ?? 0)) {
    return jsonError(401, 'SESSION_REVOKED', 'You signed out of this account. Sign in again.');
  }

  const jwt = await issueSessionJwt(row.id, row.alias, env, current);
  return jsonOk({ ok: true, jwt, alias: row.alias });
}
