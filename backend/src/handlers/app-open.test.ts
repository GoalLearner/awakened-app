/**
 * app-open.test.ts — W834 (Train 3, G2) build + funnel reporting via the
 * app-open body. Hand-rolled substring-routed D1 mock (same pattern as the
 * other handler tests), extended with a batch() capture.
 */
import { describe, expect, it } from 'vitest';
import { handleAppOpenPost } from './app-open';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

interface Captured { sql: string; binds: unknown[] }

function makeEnv(opts?: { rateLimited?: boolean }) {
  const calls: Captured[] = [];
  const batches: Captured[][] = [];
  const mkStmt = (sql: string) => ({
    bind: (...args: unknown[]) => {
      const captured = { sql, binds: args };
      calls.push(captured);
      return {
        __captured: captured,
        run: async () => ({ success: true, meta: { changes: 1 } }),
        first: async () => null,
        all: async () => ({ results: [], success: true, meta: {} }),
      };
    },
  });
  const db = {
    prepare: mkStmt,
    batch: async (stmts: Array<{ __captured: Captured }>) => {
      batches.push(stmts.map((s) => s.__captured));
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  } as unknown as D1Database;
  const env = {
    DB: db,
    RL_APP_OPEN: { limit: async () => ({ success: !opts?.rateLimited }) },
  } as unknown as Env;
  return { env, calls, batches };
}

const session: SessionPayload = { userId: 'user-abc', alias: 'Richie' };

function makeReq(body?: unknown): Request {
  return new Request('https://x/v1/users/me/app-open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /v1/users/me/app-open (W834)', () => {
  it('still works as a bare lifecycle ping (no body — the pre-W834 client)', async () => {
    const { env, calls, batches } = makeEnv();
    const res = await handleAppOpenPost(makeReq(), env, session);
    expect(res.status).toBe(200);
    const upsert = calls.find((c) => /INSERT INTO app_opens/.test(c.sql));
    expect(upsert).toBeTruthy();
    expect(upsert!.binds[0]).toBe('user-abc');   // user from SESSION, not body
    expect(upsert!.binds[3]).toBeNull();         // no build reported
    expect(batches.length).toBe(0);              // no funnel writes
  });

  it('records the build on the day row', async () => {
    const { env, calls } = makeEnv();
    const res = await handleAppOpenPost(makeReq({ build: '2.5.1-w834' }), env, session);
    expect(res.status).toBe(200);
    const upsert = calls.find((c) => /INSERT INTO app_opens/.test(c.sql))!;
    expect(upsert.binds[3]).toBe('2.5.1-w834');
    expect(/COALESCE\(excluded\.build, app_opens\.build\)/.test(upsert.sql)).toBe(true);
  });

  it('accepts batched funnel events and reports the accepted count', async () => {
    const { env, batches } = makeEnv();
    const res = await handleAppOpenPost(
      makeReq({
        build: '2.5.1-w834',
        events: [
          { e: 'paywall_impression', d: 'weekly_insights' },
          { e: 'BAD NAME WITH SPACES' },        // rejected: fails the name regex
          { e: 'purchase_completed', d: 'founder' },
        ],
      }),
      env, session,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { events_accepted: number };
    expect(json.events_accepted).toBe(2);
    expect(batches.length).toBe(1);
    const inserts = batches[0].filter((c) => /INSERT INTO funnel_events/.test(c.sql));
    expect(inserts.length).toBe(2);
    expect(inserts[0].binds[0]).toBe('user-abc');
    expect(inserts[0].binds[2]).toBe('paywall_impression');
    expect(inserts[0].binds[3]).toBe('weekly_insights');
    // Inline retention prune rides the same batch.
    expect(batches[0].some((c) => /DELETE FROM funnel_events WHERE created_at </.test(c.sql))).toBe(true);
  });

  it('caps events at 10 per call', async () => {
    const { env, batches } = makeEnv();
    const events = Array.from({ length: 25 }, (_, i) => ({ e: 'evt_' + i }));
    const res = await handleAppOpenPost(makeReq({ events }), env, session);
    const json = (await res.json()) as { events_accepted: number };
    expect(json.events_accepted).toBe(10);
    expect(batches[0].filter((c) => /INSERT INTO funnel_events/.test(c.sql)).length).toBe(10);
  });

  it('rate-limited calls accept no events so the client retries them later', async () => {
    const { env, calls, batches } = makeEnv({ rateLimited: true });
    const res = await handleAppOpenPost(
      makeReq({ events: [{ e: 'paywall_impression' }] }), env, session,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { events_accepted: number; deduped: boolean };
    expect(json.deduped).toBe(true);
    expect(json.events_accepted).toBe(0);
    expect(calls.length).toBe(0);
    expect(batches.length).toBe(0);
  });
});
