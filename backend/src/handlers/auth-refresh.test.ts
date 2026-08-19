/**
 * auth-refresh.test.ts — W815: silent session renewal.
 *
 * The launch cohort's 90-day JWTs all expired ~mid-Aug 2026 with no refresh
 * path, gating every early tester. These tests pin the rescue contract:
 * valid + in-grace tokens exchange for a fresh 90-day JWT; beyond-grace,
 * bad-signature, and deleted-account tokens do not.
 */
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { handleAuthRefresh } from './auth-refresh';
import { verifySessionJwt, REFRESH_GRACE_SECONDS } from '../session-jwt';
import type { Env } from '../env';

const KEY = 'test-signing-key-32-bytes-or-more-for-hs256';
const noopRl = { limit: async () => ({ success: true }) };

/** Signs a session-shaped JWT whose exp is `expOffsetSec` from now. */
async function tokenWithExp(expOffsetSec: number, sub = 'user-uuid-123', alias = 'TopDog'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ alias })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('awakened-backend')
    .setAudience('awakened-app')
    .setIssuedAt(now - 90 * 24 * 3600)
    .setExpirationTime(now + expOffsetSec)
    .sign(new TextEncoder().encode(KEY));
}

/** Env whose DB returns `row` for the users lookup. */
function makeEnv(row: { id: string; alias: string } | null): Env {
  return {
    JWT_SIGNING_KEY: KEY,
    RL_FRIENDS_READ: noopRl,
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => row }),
      }),
    },
  } as unknown as Env;
}

function req(token: string | null): Request {
  return new Request('https://x/v1/auth/refresh', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe('handleAuthRefresh (W815)', () => {
  it('a still-valid token exchanges for a fresh 90-day JWT', async () => {
    const env = makeEnv({ id: 'user-uuid-123', alias: 'TopDog' });
    const res = await handleAuthRefresh(req(await tokenWithExp(3600)), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; jwt: string; alias: string };
    expect(body.ok).toBe(true);
    const decoded = await verifySessionJwt(body.jwt, env);   // strict verifier accepts the new token
    expect(decoded.userId).toBe('user-uuid-123');
    expect(decoded.alias).toBe('TopDog');
  });

  it('an EXPIRED token inside the 30-day grace window is rescued', async () => {
    const env = makeEnv({ id: 'user-uuid-123', alias: 'TopDog' });
    const fiveDaysPast = -5 * 24 * 3600;
    const res = await handleAuthRefresh(req(await tokenWithExp(fiveDaysPast)), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; jwt: string };
    const decoded = await verifySessionJwt(body.jwt, env);
    expect(decoded.userId).toBe('user-uuid-123');
  });

  it('a token expired BEYOND the grace window is rejected 401 NOT_REFRESHABLE', async () => {
    const env = makeEnv({ id: 'user-uuid-123', alias: 'TopDog' });
    const beyond = -(REFRESH_GRACE_SECONDS + 24 * 3600);
    const res = await handleAuthRefresh(req(await tokenWithExp(beyond)), env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('NOT_REFRESHABLE');
  });

  it('refresh re-reads the CURRENT alias from the users table', async () => {
    const env = makeEnv({ id: 'user-uuid-123', alias: 'RenamedHunter' });
    const res = await handleAuthRefresh(req(await tokenWithExp(3600, 'user-uuid-123', 'OldName')), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jwt: string; alias: string };
    expect(body.alias).toBe('RenamedHunter');
    const decoded = await verifySessionJwt(body.jwt, env);
    expect(decoded.alias).toBe('RenamedHunter');
  });

  it('a deleted account cannot refresh (W740 invalidate-on-delete holds)', async () => {
    const env = makeEnv(null);   // no users row
    const res = await handleAuthRefresh(req(await tokenWithExp(3600)), env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ACCOUNT_GONE');
  });

  it('a token signed with the wrong key is rejected 401', async () => {
    const env = makeEnv({ id: 'user-uuid-123', alias: 'TopDog' });
    const now = Math.floor(Date.now() / 1000);
    const forged = await new SignJWT({ alias: 'TopDog' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-uuid-123')
      .setIssuer('awakened-backend')
      .setAudience('awakened-app')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(new TextEncoder().encode('a-different-signing-key-entirely-32b'));
    const res = await handleAuthRefresh(req(forged), env);
    expect(res.status).toBe(401);
  });

  it('a missing Authorization header is rejected 401 AUTH_REQUIRED', async () => {
    const res = await handleAuthRefresh(req(null), makeEnv({ id: 'u', alias: 'A' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('AUTH_REQUIRED');
  });
});
