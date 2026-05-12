/**
 * apple-jwks.ts — Apple identity-token verifier.
 *
 * Given an identity token returned by SignInWithApple.authorize() on
 * the client, verify the signature against Apple's published JWKS,
 * validate the issuer / audience / expiration / issued-at claims, and
 * return the user's stable Apple `sub` (subject) identifier.
 *
 * Cryptography is handled by the `jose` library — we never hand-roll
 * JWT verification. jose parses the JWS, fetches the public key by
 * matching the token's `kid` (key ID) header against Apple's JWKS,
 * and rejects with named exceptions for every failure mode.
 *
 * JWKS caching: Apple's published keys at
 *   https://appleid.apple.com/auth/keys
 * rotate occasionally but are stable for days at a time. We cache via
 * (a) per-Worker-instance in-memory map (instant hit on warm worker)
 * and (b) Cloudflare's Cache API for cross-instance reuse. TTL is 24h.
 *
 * BACKEND.md §4 (auth flow) is the design contract.
 */
import { jwtVerify, importJWK, type JWK } from 'jose';
import type { Env } from './env';

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';
const JWKS_TTL_SECONDS = 24 * 60 * 60; // 24 hours

interface AppleJwksResponse {
  keys: JWK[];
}

/** Per-Worker-instance memory cache. Cleared on cold start. */
let _memCache: { keys: JWK[]; expiresAt: number } | null = null;

/**
 * Decodes a base64url-encoded string to a UTF-8 string. Works in
 * the Workers runtime where `Buffer` is unavailable.
 */
function base64UrlDecode(input: string): string {
  // Convert base64url → base64 (replace -_ with +/, pad with =)
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return atob(b64);
}

/**
 * Reads the JWT header to extract the kid (key ID). Used to find the
 * right JWK in Apple's set without decoding the entire token.
 */
function readKidFromToken(token: string): { kid: string; alg: string } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('MALFORMED_TOKEN');
  }
  let header: { kid?: unknown; alg?: unknown };
  try {
    header = JSON.parse(base64UrlDecode(parts[0]));
  } catch {
    throw new Error('MALFORMED_TOKEN_HEADER');
  }
  if (typeof header.kid !== 'string' || typeof header.alg !== 'string') {
    throw new Error('INVALID_TOKEN_HEADER');
  }
  return { kid: header.kid, alg: header.alg };
}

/**
 * Fetches Apple's JWKS, caching the result for JWKS_TTL_SECONDS via
 * Cloudflare's Cache API + a per-instance memory map.
 */
async function fetchJwks(): Promise<JWK[]> {
  const nowMs = Date.now();
  if (_memCache && _memCache.expiresAt > nowMs) {
    return _memCache.keys;
  }

  // Cloudflare's `cf.cacheTtl` directive instructs the edge to cache
  // the response itself for the given TTL. This makes the JWKS fetch
  // essentially free across Worker instances within the same edge.
  const res = await fetch(APPLE_JWKS_URL, {
    cf: {
      cacheTtl: JWKS_TTL_SECONDS,
      cacheEverything: true,
    },
  });
  if (!res.ok) {
    throw new Error(`APPLE_JWKS_FETCH_FAILED: status ${res.status}`);
  }
  const data = (await res.json()) as AppleJwksResponse;
  if (!data || !Array.isArray(data.keys)) {
    throw new Error('APPLE_JWKS_MALFORMED');
  }

  _memCache = {
    keys: data.keys,
    expiresAt: nowMs + JWKS_TTL_SECONDS * 1000,
  };
  return data.keys;
}

export interface AppleIdentityPayload {
  /** Stable per-(app, user) identifier issued by Apple. Used as the
   * apple_sub column in the users table. */
  sub: string;
  /** Email address if user opted to share it on first authorization.
   * Apple shields the real email behind a relay address by default. */
  email?: string;
}

/**
 * Verifies an Apple identity token end-to-end.
 *
 * Steps:
 *   1. Extract kid from token header
 *   2. Fetch JWKS (cached)
 *   3. Find matching JWK by kid
 *   4. Import the JWK as a verifying public key
 *   5. jwtVerify with iss + aud claims pinned
 *   6. Return the subject + email
 *
 * Throws on any failure (jose's named exceptions or our own).
 */
export async function verifyAppleIdentityToken(
  token: string,
  env: Env,
): Promise<AppleIdentityPayload> {
  const { kid, alg } = readKidFromToken(token);
  if (alg !== 'RS256') {
    throw new Error(`UNSUPPORTED_TOKEN_ALG: ${alg}`);
  }

  const keys = await fetchJwks();
  const jwk = keys.find((k) => (k as { kid?: string }).kid === kid);
  if (!jwk) {
    throw new Error(`NO_MATCHING_JWK_FOR_KID: ${kid}`);
  }

  const publicKey = await importJWK(jwk, 'RS256');

  const { payload } = await jwtVerify(token, publicKey, {
    issuer: APPLE_ISSUER,
    audience: env.APPLE_BUNDLE_ID,
  });

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('APPLE_TOKEN_MISSING_SUB');
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}
