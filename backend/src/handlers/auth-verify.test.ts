/**
 * auth-verify.test.ts — W740 Sign-in-with-Apple nonce binding.
 *
 * verifyAppleIdentityToken does a live JWKS fetch, so it's mocked here to drive
 * the token's `nonce` claim directly. The DB mock always resolves the apple_sub
 * lookup to an existing user, so a passing sign-in takes the returning-user path
 * (200 + jwt) — letting each test isolate the nonce gate that runs before it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../apple-jwks', () => ({ verifyAppleIdentityToken: vi.fn() }));
import { verifyAppleIdentityToken } from '../apple-jwks';
import { handleAuthVerify } from './auth-verify';
import type { Env } from '../env';

const mockVerify = vi.mocked(verifyAppleIdentityToken);

/** Same lowercase-hex SHA-256 the handler + client use, to build matching pairs. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const noopRl = { limit: async () => ({ success: true }) };

function makeEnv(opts: { enforce?: string } = {}): Env {
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () =>
          /FROM users WHERE apple_sub/.test(sql) ? { id: 'u1', alias: 'Richie' } : null,
        run: async () => ({ success: true, meta: { changes: 1 } }),
        all: async () => ({ results: [], success: true, meta: {} }),
      }),
    }),
  } as unknown as D1Database;
  return {
    DB: db,
    JWT_SIGNING_KEY: 'test-signing-key-32-bytes-or-more-for-hs256',
    APPLE_BUNDLE_ID: 'com.goallearner.awakened',
    RL_AUTH_VERIFY: noopRl,
    ...(opts.enforce !== undefined ? { SIWA_NONCE_ENFORCE: opts.enforce } : {}),
  } as unknown as Env;
}

function makeReq(body: unknown): Request {
  return new Request('https://x/v1/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => mockVerify.mockReset());

describe('W740 — Sign-in-with-Apple nonce binding', () => {
  it('token nonce matches SHA256(rawNonce) → sign-in proceeds (200)', async () => {
    const raw = 'random-raw-nonce-abc123';
    mockVerify.mockResolvedValue({ sub: 'apple-123', nonce: await sha256Hex(raw) });
    const res = await handleAuthVerify(
      makeReq({ identityToken: 't', alias: 'Richie', nonce: raw }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
  });

  it('mismatch with enforcement OFF → allowed (log-only, 200)', async () => {
    mockVerify.mockResolvedValue({ sub: 'apple-123', nonce: await sha256Hex('the-real-one') });
    const res = await handleAuthVerify(
      makeReq({ identityToken: 't', alias: 'Richie', nonce: 'WRONG' }),
      makeEnv(), // SIWA_NONCE_ENFORCE unset
    );
    expect(res.status).toBe(200);
  });

  it('mismatch with enforcement ON → 401 APPLE_NONCE_MISMATCH', async () => {
    mockVerify.mockResolvedValue({ sub: 'apple-123', nonce: await sha256Hex('the-real-one') });
    const res = await handleAuthVerify(
      makeReq({ identityToken: 't', alias: 'Richie', nonce: 'WRONG' }),
      makeEnv({ enforce: 'true' }),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe('APPLE_NONCE_MISMATCH');
  });

  it('token has a nonce but the body omits rawNonce, enforcement ON → 401', async () => {
    mockVerify.mockResolvedValue({ sub: 'apple-123', nonce: await sha256Hex('the-real-one') });
    const res = await handleAuthVerify(
      makeReq({ identityToken: 't', alias: 'Richie' }),
      makeEnv({ enforce: 'true' }),
    );
    expect(res.status).toBe(401);
  });

  it('token has NO nonce claim (pre-W740 client) → check skipped, 200 even when enforcing', async () => {
    mockVerify.mockResolvedValue({ sub: 'apple-123' });
    const res = await handleAuthVerify(
      makeReq({ identityToken: 't', alias: 'Richie' }),
      makeEnv({ enforce: 'true' }),
    );
    expect(res.status).toBe(200);
  });
});
