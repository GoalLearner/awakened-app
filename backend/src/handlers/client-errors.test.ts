/**
 * client-errors.test.ts — W746 client error ingestion. Hand-rolled
 * substring-routed D1 mock (same pattern as the other handler tests).
 */
import { describe, expect, it } from 'vitest';
import { handleClientErrorsPost } from './client-errors';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

interface Captured { sql: string; binds: unknown[] }

function makeEnv(opts?: { rateLimited?: boolean }) {
  const calls: Captured[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return {
          run: async () => ({ success: true, meta: { changes: 1 } }),
          first: async () => null,
          all: async () => ({ results: [], success: true, meta: {} }),
        };
      },
    }),
  } as unknown as D1Database;
  const env = {
    DB: db,
    RL_CLIENT_ERRORS: { limit: async () => ({ success: !opts?.rateLimited }) },
  } as unknown as Env;
  return { env, calls };
}

const session: SessionPayload = { userId: 'user-abc', alias: 'Richie' };

function makeReq(body: unknown): Request {
  return new Request('https://x/v1/users/me/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /v1/users/me/client-errors', () => {
  it('inserts a report and runs the retention prune', async () => {
    const { env, calls } = makeEnv();
    const res = await handleClientErrorsPost(
      makeReq({ message: 'TypeError: x is undefined', stack: 'at foo()', build: '2.4.5-w746', path: '#armory' }),
      env, session,
    );
    expect(res.status).toBe(200);
    const insert = calls.find((c) => /INSERT INTO client_errors/.test(c.sql));
    expect(insert).toBeTruthy();
    expect(insert!.binds[0]).toBe('user-abc');            // user from SESSION, not body
    expect(insert!.binds[2]).toBe('2.4.5-w746');
    expect(insert!.binds[4]).toBe('TypeError: x is undefined');
    const prune = calls.find((c) => /DELETE FROM client_errors WHERE created_at </.test(c.sql));
    expect(prune).toBeTruthy();
  });

  it('clamps oversized fields (message 500 / stack 2000)', async () => {
    const { env, calls } = makeEnv();
    const res = await handleClientErrorsPost(
      makeReq({ message: 'M'.repeat(9000), stack: 'S'.repeat(9000) }), env, session,
    );
    expect(res.status).toBe(200);
    const insert = calls.find((c) => /INSERT INTO client_errors/.test(c.sql))!;
    expect((insert.binds[4] as string).length).toBe(500);
    expect((insert.binds[5] as string).length).toBe(2000);
  });

  it('400s without a message', async () => {
    const { env } = makeEnv();
    const res = await handleClientErrorsPost(makeReq({ stack: 'no message' }), env, session);
    expect(res.status).toBe(400);
  });

  it('400s on malformed JSON', async () => {
    const { env } = makeEnv();
    const res = await handleClientErrorsPost(makeReq('not-json'), env, session);
    expect(res.status).toBe(400);
  });

  it('429s when rate-limited, without touching D1', async () => {
    const { env, calls } = makeEnv({ rateLimited: true });
    const res = await handleClientErrorsPost(makeReq({ message: 'x' }), env, session);
    expect(res.status).toBe(429);
    expect(calls.length).toBe(0);
  });
});
