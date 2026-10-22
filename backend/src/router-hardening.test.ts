/**
 * router-hardening.test.ts — W1040, through the REAL worker entry (not a handler on its own):
 * the request-size ceiling sits in front of every route, the session gate's 401 says nothing
 * about why, and a signed-in body still reaches its handler intact.
 */
import { describe, expect, it } from 'vitest';
import worker from './index';
import type { Env } from './env';

const ctx = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const env = {
  JWT_SIGNING_KEY: 'test-signing-key-test-signing-key-0123456789',
  RL_AUTH_VERIFY: { limit: async () => ({ success: true }) },
  DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }) }) },
} as unknown as Env;

const call = (path: string, init: RequestInit) => worker.fetch(new Request('https://api.test' + path, init), env, ctx);

describe('W1040 — the router', () => {
  it('refuses an oversized body on a public route before anything reads it (413, with CORS)', async () => {
    const res = await call('/v1/auth/verify', { method: 'POST', body: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe('PAYLOAD_TOO_LARGE');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('refuses an oversized body on a session route too, before the token is even looked at', async () => {
    const res = await call('/v1/verified-events', { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: JSON.stringify({ events: [{ metadata_json: 'y'.repeat(2_000_000) }] }) });
    expect(res.status).toBe(413);
  });

  it('the cloud save keeps its own larger ceiling: 400 KB is not refused for size', async () => {
    const res = await call('/v1/users/me/state', { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: 'z'.repeat(400_000) });
    expect(res.status).toBe(401);                       // it got as far as the session gate
    const big = await call('/v1/users/me/state', { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: 'z'.repeat(1_400_000) });   // W1076 — the ceiling is 1,280 KB now
    expect(big.status).toBe(413);
  });

  it('an ordinary body passes through to its handler intact', async () => {
    const res = await call('/v1/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityToken: '' }) });
    expect(res.status).not.toBe(413);
    expect(res.status).toBeGreaterThanOrEqual(400);     // refused by the handler for its content, i.e. it was read
    expect(res.status).toBeLessThan(500);
  });

  it('a bad session token gets a 401 that says nothing about why', async () => {
    const res = await call('/v1/friends', { method: 'GET', headers: { Authorization: 'Bearer not.a.jwt' } });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; detail?: string; message?: string };
    expect(body.error).toBe('INVALID_SESSION');
    expect(JSON.stringify(body)).not.toMatch(/JWS|JWT|signature|compact|KEY|jose/i);
  });

  it('preflight advertises DELETE (leave the raid finder, unregister a push token)', async () => {
    const res = await call('/v1/raid-queue', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });
});
