/**
 * hall-of-awakened.test.ts — handler-shape tests for the Hall (W270).
 *
 * Covers POST (ordinal assignment SQL shape + binds + response) and GET
 * (total/top/me/near shape, the `you` flag, the near-only-when-outside-top
 * rule). Real ordinal-assignment SQL behaviour (MAX+1 atomicity, once-ever
 * via WHERE NOT EXISTS) is a D1 guarantee, validated against the live DB —
 * here we assert the handler EMITS that SQL and shapes the response.
 */
import { describe, expect, it } from 'vitest';
import { handleHallFinishPost, handleHallGet } from './hall-of-awakened';
import type { Env } from '../env';

const okRl = { limit: async () => ({ success: true }) };
const blockedRl = { limit: async () => ({ success: false }) };

interface CapturedCall { sql: string; binds: unknown[]; }

function makeDb(opts: {
  topRows?: Array<{ ordinal: number; alias: string; finished_at_ms: number; user_id: string }>;
  nearRows?: Array<{ ordinal: number; alias: string; finished_at_ms: number; user_id: string }>;
  me?: { ordinal: number; finished_at_ms: number } | null;
  total?: number;
} = {}) {
  const calls: CapturedCall[] = [];
  const topRows = opts.topRows ?? [];
  const nearRows = opts.nearRows ?? [];
  const me = opts.me === undefined ? null : opts.me;
  const total = opts.total ?? 0;
  // A statement carries its SQL; execution methods live on BOTH the
  // prepared statement and the bound one (mirrors real D1 — no-bind
  // queries like COUNT(*) call .first() straight off .prepare()).
  const exec = (sql: string) => ({
    all: async () => ({
      // ORDER BY ordinal ASC ... LIMIT = top; the BETWEEN range = near.
      results: sql.includes('BETWEEN') ? nearRows : topRows,
      success: true,
      meta: {},
    }),
    first: async () => {
      if (sql.includes('COUNT(*)')) return { total };
      if (sql.includes('WHERE user_id = ?')) return me;
      return null;
    },
    run: async () => ({ success: true, meta: { changes: 1 } }),
  });
  return {
    prepare: (sql: string) => ({
      ...exec(sql),
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return exec(sql);
      },
    }),
    _calls: () => calls,
  } as unknown as D1Database & { _calls: () => CapturedCall[] };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    RL_HALL_WRITE: okRl,
    RL_HALL_READ: okRl,
  } as unknown as Env;
}

const session = { userId: 'user-me', alias: 'You' } as never;

function postReq(body?: unknown): Request {
  return new Request('https://x/v1/users/me/hall-of-awakened', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function getReq(qs = ''): Request {
  return new Request('https://x/v1/hall-of-awakened' + qs, { method: 'GET' });
}

describe('POST /v1/users/me/hall-of-awakened', () => {
  it('assigns the ordinal via MAX+1 / WHERE NOT EXISTS and echoes it', async () => {
    const db = makeDb({ me: { ordinal: 47, finished_at_ms: 1750000000000 }, total: 47 });
    const res = await handleHallFinishPost(postReq({ clientFinishedAt: '2026-06-12T00:00:00Z' }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const body = await res.json() as { ordinal: number; total: number; finishedAtMs: number };
    expect(body.ordinal).toBe(47);
    expect(body.total).toBe(47);
    expect(body.finishedAtMs).toBe(1750000000000);

    const insert = db._calls().find((c) => c.sql.includes('INSERT INTO hall_of_awakened'));
    expect(insert).toBeTruthy();
    expect(insert!.sql).toContain('MAX(ordinal)');
    expect(insert!.sql).toContain('WHERE NOT EXISTS');
    // binds: user_id, nowMs, clientFinishedAt
    expect(insert!.binds[0]).toBe('user-me');
    expect(typeof insert!.binds[1]).toBe('number');
    expect(insert!.binds[2]).toBe('2026-06-12T00:00:00Z');
  });

  it('tolerates a missing body (the finish needs no payload)', async () => {
    const db = makeDb({ me: { ordinal: 1, finished_at_ms: 1 }, total: 1 });
    const res = await handleHallFinishPost(postReq(), makeEnv(db), session);
    expect(res.status).toBe(200);
    const insert = db._calls().find((c) => c.sql.includes('INSERT INTO'));
    expect(insert!.binds[2]).toBeNull(); // clientFinishedAt → null
  });

  it('rate-limits', async () => {
    const env = { DB: makeDb(), RL_HALL_WRITE: blockedRl, RL_HALL_READ: okRl } as unknown as Env;
    const res = await handleHallFinishPost(postReq(), env, session);
    expect(res.status).toBe(429);
  });
});

describe('GET /v1/hall-of-awakened', () => {
  it('returns total/top/me/near with the `you` flag on the caller', async () => {
    const db = makeDb({
      total: 47,
      topRows: [
        { ordinal: 1, alias: 'rendiesel', finished_at_ms: 1, user_id: 'u1' },
        { ordinal: 2, alias: 'kazuha', finished_at_ms: 2, user_id: 'u2' },
      ],
      me: { ordinal: 47, finished_at_ms: 1750000000000 },
      nearRows: [
        { ordinal: 46, alias: 'ascendantnova', finished_at_ms: 45, user_id: 'u46' },
        { ordinal: 47, alias: 'You', finished_at_ms: 1750000000000, user_id: 'user-me' },
        { ordinal: 48, alias: 'ghostlift', finished_at_ms: 48, user_id: 'u48' },
      ],
    });
    const res = await handleHallGet(getReq('?limit=2'), makeEnv(db), session);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      total: number;
      me: { ordinal: number } | null;
      top: Array<{ ordinal: number; you: boolean }>;
      near: Array<{ ordinal: number; alias: string; you: boolean }>;
    };
    expect(body.total).toBe(47);
    expect(body.me!.ordinal).toBe(47);
    expect(body.top.map((r) => r.ordinal)).toEqual([1, 2]);
    expect(body.top.every((r) => r.you === false)).toBe(true);
    // near present (me.ordinal 47 > top limit 2); the caller's row flagged
    const youRow = body.near.find((r) => r.you);
    expect(youRow!.ordinal).toBe(47);
    expect(youRow!.alias).toBe('You');
    expect(body.near.filter((r) => r.you).length).toBe(1);
  });

  it('me is null and near is empty when the caller has not finished', async () => {
    const db = makeDb({ total: 5, topRows: [{ ordinal: 1, alias: 'a', finished_at_ms: 1, user_id: 'u1' }], me: null });
    const res = await handleHallGet(getReq(), makeEnv(db), session);
    const body = await res.json() as { me: null; near: unknown[] };
    expect(body.me).toBeNull();
    expect(body.near).toEqual([]);
    // the near BETWEEN query must not run when there is no caller row
    expect(db._calls().some((c) => c.sql.includes('BETWEEN'))).toBe(false);
  });

  it('skips the near query when the caller is inside the top block', async () => {
    const db = makeDb({
      total: 3,
      topRows: [
        { ordinal: 1, alias: 'a', finished_at_ms: 1, user_id: 'u1' },
        { ordinal: 2, alias: 'You', finished_at_ms: 2, user_id: 'user-me' },
      ],
      me: { ordinal: 2, finished_at_ms: 2 },
    });
    const res = await handleHallGet(getReq('?limit=4'), makeEnv(db), session);
    const body = await res.json() as { near: unknown[]; top: Array<{ ordinal: number; you: boolean }> };
    expect(body.near).toEqual([]);
    expect(db._calls().some((c) => c.sql.includes('BETWEEN'))).toBe(false);
    // the caller is flagged inside top instead
    expect(body.top.find((r) => r.ordinal === 2)!.you).toBe(true);
  });

  it('rate-limits', async () => {
    const env = { DB: makeDb(), RL_HALL_WRITE: okRl, RL_HALL_READ: blockedRl } as unknown as Env;
    const res = await handleHallGet(getReq(), env, session);
    expect(res.status).toBe(429);
  });
});
