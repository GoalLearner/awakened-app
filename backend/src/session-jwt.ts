/**
 * session-jwt.ts — Backend session JWT issuer + verifier.
 *
 * After /v1/auth/verify validates an Apple identity token, this module
 * issues an HS256-signed session JWT that the client stores and sends
 * back as `Authorization: Bearer <jwt>` on subsequent requests.
 *
 * 90-day session lifetime per BACKEND.md §4. Long because re-auth via
 * Apple is friction; the client uses isJwtNearExpiry() to silently
 * re-authorize against Apple when <14 days remain.
 *
 * LOCALHOST_DEV_STUB rejection: the client's localhost dev bypass
 * (auth.js) writes a stub user with sub="localhost-dev-user" and
 * alias="DevUser". If anything ever tries to verify a JWT matching
 * that pattern, we reject — production must never accept localhost
 * dev state. Defense-in-depth; the dev stub is a literal string, not
 * a real JWT, so jose would reject it anyway, but we're explicit.
 */
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from './env';

const ISSUER = 'awakened-backend';
const AUDIENCE = 'awakened-app';
const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

// W1075 SECURITY — an HMAC key shorter than this is forgeable offline from one captured token
// (jose enforces no minimum for HS256). The documented key is 32 random bytes as hex (64 chars).
// Below 16 bytes the key is unusable and every request fails closed; between 16 and 32 it is
// logged once per isolate and allowed, so a merely short key never becomes an outage.
const KEY_MIN_BYTES = 32;
const KEY_HARD_MIN_BYTES = 16;
let _shortKeyWarned = false;

/** Encodes the HMAC signing key from env as bytes for jose. */
function getKey(env: Env): Uint8Array {
  if (typeof env.JWT_SIGNING_KEY !== 'string' || env.JWT_SIGNING_KEY.length === 0) {
    throw new Error('JWT_SIGNING_KEY_MISSING_OR_EMPTY');
  }
  const bytes = new TextEncoder().encode(env.JWT_SIGNING_KEY);
  if (bytes.byteLength < KEY_HARD_MIN_BYTES) throw new Error('JWT_SIGNING_KEY_TOO_SHORT');
  if (bytes.byteLength < KEY_MIN_BYTES && !_shortKeyWarned) {
    _shortKeyWarned = true;
    console.error(`JWT_SIGNING_KEY is ${bytes.byteLength} bytes; HS256 wants at least ${KEY_MIN_BYTES}. Rotate it.`);
  }
  return bytes;
}

/** W1075 — the `tv` claim: the users.token_version the token was minted against. */
function tokenVersionOf(payload: { tv?: unknown }): number {
  const tv = payload.tv;
  return typeof tv === 'number' && Number.isInteger(tv) && tv >= 0 ? tv : 0;
}

/**
 * Issues a session JWT for a verified user. Subject is the internal
 * user UUID (not Apple sub) so non-Apple auth providers can produce
 * tokens with the same shape in v2.x+.
 *
 * W1075 — `tokenVersion` is the user's current users.token_version. The gate compares the
 * claim to the column on every request, so a sign-out (which bumps the column) revokes
 * every token minted before it. Tokens from before W1075 carry no claim and read as 0,
 * which matches the column until the hunter signs out once.
 */
export async function issueSessionJwt(
  userId: string,
  alias: string,
  env: Env,
  tokenVersion = 0,
): Promise<string> {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('USER_ID_REQUIRED');
  }
  if (typeof alias !== 'string' || alias.length === 0) {
    throw new Error('ALIAS_REQUIRED');
  }
  const now = Math.floor(Date.now() / 1000);
  const key = getKey(env);
  return await new SignJWT({ alias, tv: tokenVersionOf({ tv: tokenVersion }) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(key);
}

export interface SessionPayload {
  userId: string;
  alias: string;
  /** W1075 — the users.token_version this token was minted against (0 for pre-W1075 tokens;
   *  optional so the handler tests' bare `{ userId, alias }` sessions still type-check). */
  tokenVersion?: number;
}

// W815 — refresh grace window. A JWT whose signature is valid but whose exp
// is within this many seconds PAST may still be exchanged for a fresh session
// via POST /v1/auth/refresh (and ONLY there — every other route keeps the
// strict verifier). Rationale: sessions are 90 days and the refresh path was
// never wired, so the entire launch cohort hit hard expiry ~mid-Aug 2026 and
// woke up to the sign-in gate. The grace window turns that cliff into a
// silent recovery while keeping revocation intact (the refresh handler still
// checks the user row exists — deleted accounts stay dead per W740).
export const REFRESH_GRACE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * W815 — verifier for the refresh endpoint only: identical to
 * verifySessionJwt but tolerates exp up to REFRESH_GRACE_SECONDS in the
 * past (jose clockTolerance). Signature, issuer, audience, and the
 * dev-stub rejection are enforced exactly as in the strict verifier.
 */
export async function verifySessionJwtForRefresh(
  token: string,
  env: Env,
): Promise<SessionPayload> {
  const key = getKey(env);
  const { payload } = await jwtVerify(token, key, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
    clockTolerance: REFRESH_GRACE_SECONDS,
  });
  const sub = payload.sub;
  const alias = payload.alias;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('SESSION_JWT_MISSING_SUB');
  }
  if (typeof alias !== 'string' || alias.length === 0) {
    throw new Error('SESSION_JWT_MISSING_ALIAS');
  }
  if (sub === 'localhost-dev-user' && alias === 'DevUser') {
    throw new Error('LOCALHOST_DEV_STUB cannot reach production backend.');
  }
  return { userId: sub, alias, tokenVersion: tokenVersionOf(payload as { tv?: unknown }) };
}

/**
 * Verifies a session JWT. Validates signature, iss, aud, exp, and
 * rejects the LOCALHOST_DEV_STUB pattern explicitly.
 */
export async function verifySessionJwt(
  token: string,
  env: Env,
): Promise<SessionPayload> {
  const key = getKey(env);
  const { payload } = await jwtVerify(token, key, {
    algorithms: ['HS256'],   // W739 — explicit alg pin (defense-in-depth vs alg confusion)
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const sub = payload.sub;
  const alias = payload.alias;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('SESSION_JWT_MISSING_SUB');
  }
  if (typeof alias !== 'string' || alias.length === 0) {
    throw new Error('SESSION_JWT_MISSING_ALIAS');
  }

  // Defense-in-depth: reject the LOCALHOST_DEV_STUB pattern. The
  // dev-stub is a literal string ("LOCALHOST_DEV_STUB"), not a real
  // JWT, so jose's parsing would reject it before we get here — but
  // if a malicious actor ever forged a real JWT mimicking this
  // pattern (would require leaking JWT_SIGNING_KEY), this hard-fails
  // production access for the dev identity.
  if (sub === 'localhost-dev-user' && alias === 'DevUser') {
    throw new Error('LOCALHOST_DEV_STUB cannot reach production backend.');
  }

  return { userId: sub, alias, tokenVersion: tokenVersionOf(payload as { tv?: unknown }) };
}

/**
 * W1075 — the per-request revocation check, shared by the Bearer gate, the refresh route and
 * the PvP WebSocket upgrade. Reads the user's current token_version and compares it to the
 * token's claim. Returns 'ok' | 'gone' (no users row: account deleted) | 'revoked' (signed out
 * since this token was minted) | 'unknown' (a D1 error: callers fail OPEN, as before, so a DB
 * blip can never lock the whole userbase out).
 */
export async function sessionLiveness(
  env: Env,
  session: SessionPayload,
): Promise<'ok' | 'gone' | 'revoked' | 'unknown'> {
  try {
    const row = await env.DB.prepare('SELECT token_version FROM users WHERE id = ? LIMIT 1')
      .bind(session.userId)
      .first<{ token_version: number | null }>();
    if (!row) return 'gone';
    const current = Number(row.token_version ?? 0) || 0;
    return current === (session.tokenVersion ?? 0) ? 'ok' : 'revoked';
  } catch (err) {
    console.error('session liveness check failed (allowing as stateless fallback):', err instanceof Error ? err.message : err);
    return 'unknown';
  }
}
