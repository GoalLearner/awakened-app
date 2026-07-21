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

/** Encodes the HMAC signing key from env as bytes for jose. */
function getKey(env: Env): Uint8Array {
  if (typeof env.JWT_SIGNING_KEY !== 'string' || env.JWT_SIGNING_KEY.length === 0) {
    throw new Error('JWT_SIGNING_KEY_MISSING_OR_EMPTY');
  }
  return new TextEncoder().encode(env.JWT_SIGNING_KEY);
}

/**
 * Issues a session JWT for a verified user. Subject is the internal
 * user UUID (not Apple sub) so non-Apple auth providers can produce
 * tokens with the same shape in v2.x+.
 */
export async function issueSessionJwt(
  userId: string,
  alias: string,
  env: Env,
): Promise<string> {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('USER_ID_REQUIRED');
  }
  if (typeof alias !== 'string' || alias.length === 0) {
    throw new Error('ALIAS_REQUIRED');
  }
  const now = Math.floor(Date.now() / 1000);
  const key = getKey(env);
  return await new SignJWT({ alias })
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

  return { userId: sub, alias };
}
