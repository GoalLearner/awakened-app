/**
 * accolades.test.ts -- Handler-shape tests for the 100K Step Club
 * accolade endpoints.
 *
 * This project does NOT ship miniflare-D1 / better-sqlite3 test
 * infrastructure. Full SQL-behavior validation lives in
 * sims/scripts/*.ps1 against the production backend. These tests
 * cover the deterministic handler logic that's testable without
 * a real SQL engine:
 *
 *   - GET /v1/users/me/accolades response shape (empty + populated)
 *   - JSON serialization of accolade rows
 *   - metadata_json parsing tolerance (null + malformed)
 *
 * The leaderboard-submit award branch (SQL UPSERT with ON CONFLICT
 * + sim-user filtering) is exercised end-to-end via the production
 * sim harness once Phase B is deployed.
 */
import { describe, expect, it } from 'vitest';
import { handleUserAccoladesGet } from './accolades';
import type { Env } from '../env';

const okRl = { limit: async () => ({ success: true }) };
const blockRl = { limit: async () => ({ success: false }) };

interface StubRow {
  accolade_type: string;
  unlock_week_start: string;
  unlock_value: number;
  best_value: number;
  repeat_count: number;
  last_qualified_week_start: string;
  unlocked_at: number;
  updated_at: number;
  metadata_json: string | null;
}

function makeDb(rows: StubRow[]) {
  let lastBinds: unknown[] = [];
  return {
    prepare: (_sql: string) => ({
      bind: (...args: unknown[]) => {
        lastBinds = args;
        return {
          all: async () => ({ results: rows, success: true, meta: {} }),
          first: async () => rows[0] ?? null,
          run: async () => ({ success: true, meta: { changes: 0 } }),
        };
      },
    }),
    _lastBinds: () => lastBinds,
  } as unknown as D1Database & { _lastBinds: () => unknown[] };
}

function makeEnv(db: D1Database, rl = okRl): Env {
  return {
    DB: db,
    JWT_SIGNING_KEY: 'unused-in-this-test',
    APPLE_BUNDLE_ID: 'com.goallearner.awakened',
    APPLE_TEAM_ID: 'LK8FVGBQPL',
    RL_AUTH_VERIFY: okRl,
    RL_LEADERBOARD_SUBMIT: okRl,
    RL_LEADERBOARD_TOP: okRl,
    RL_ACCOUNT_DELETE: okRl,
    RL_USER_STATE_GET: okRl,
    RL_USER_STATE_POST: okRl,
    RL_FRIENDS_READ: okRl,
    RL_FRIENDS_WRITE: okRl,
    RL_DUELS_READ: okRl,
    RL_DUELS_WRITE: okRl,
    RL_USER_ACCOLADES_READ: rl,
  } as unknown as Env;
}

const session = { userId: 'user-abc', alias: 'TestHunter' };

describe('GET /v1/users/me/accolades', () => {
  it('returns empty accolades array when user has none', async () => {
    const env = makeEnv(makeDb([]));
    const req = new Request('https://example.com/v1/users/me/accolades');
    const res = await handleUserAccoladesGet(req, env, session);
    expect(res.status).toBe(200);
    // Project convention: no `ok` field; success implied by HTTP 200.
    const body = (await res.json()) as { accolades: unknown[] };
    expect(Array.isArray(body.accolades)).toBe(true);
    expect(body.accolades.length).toBe(0);
  });

  it('returns mapped accolade row with all canonical fields', async () => {
    const env = makeEnv(makeDb([{
      accolade_type: 'step_100k_club',
      unlock_week_start: '2026-05-17',
      unlock_value: 104821,
      best_value: 118712,
      repeat_count: 3,
      last_qualified_week_start: '2026-06-07',
      unlocked_at: 1760000000000,
      updated_at: 1761000000000,
      metadata_json: null,
    }]));
    const req = new Request('https://example.com/v1/users/me/accolades');
    const res = await handleUserAccoladesGet(req, env, session);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accolades: Array<{
      type: string; unlock_week_start: string; unlock_value: number;
      best_value: number; repeat_count: number;
      last_qualified_week_start: string;
      unlocked_at: number; updated_at: number;
    }> };
    expect(body.accolades.length).toBe(1);
    const a = body.accolades[0];
    expect(a.type).toBe('step_100k_club');
    expect(a.unlock_week_start).toBe('2026-05-17');
    expect(a.unlock_value).toBe(104821);
    expect(a.best_value).toBe(118712);
    expect(a.repeat_count).toBe(3);
    expect(a.last_qualified_week_start).toBe('2026-06-07');
    expect(a.unlocked_at).toBe(1760000000000);
    expect(a.updated_at).toBe(1761000000000);
  });

  it('parses metadata_json when present', async () => {
    const env = makeEnv(makeDb([{
      accolade_type: 'step_100k_club',
      unlock_week_start: '2026-05-17',
      unlock_value: 104821,
      best_value: 118712,
      repeat_count: 1,
      last_qualified_week_start: '2026-05-17',
      unlocked_at: 1760000000000,
      updated_at: 1760000000000,
      metadata_json: '{"weeks_history":[104821]}',
    }]));
    const req = new Request('https://example.com/v1/users/me/accolades');
    const res = await handleUserAccoladesGet(req, env, session);
    const body = (await res.json()) as { accolades: Array<{ metadata?: unknown }> };
    expect(body.accolades[0].metadata).toEqual({ weeks_history: [104821] });
  });

  it('tolerates malformed metadata_json (does not crash)', async () => {
    const env = makeEnv(makeDb([{
      accolade_type: 'step_100k_club',
      unlock_week_start: '2026-05-17',
      unlock_value: 104821,
      best_value: 118712,
      repeat_count: 1,
      last_qualified_week_start: '2026-05-17',
      unlocked_at: 1760000000000,
      updated_at: 1760000000000,
      metadata_json: '{not valid json',
    }]));
    const req = new Request('https://example.com/v1/users/me/accolades');
    const res = await handleUserAccoladesGet(req, env, session);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accolades: Array<{ metadata?: unknown }> };
    // Malformed metadata is silently dropped, NOT a 500.
    expect(body.accolades[0].metadata).toBeUndefined();
  });

  it('returns 429 when the read rate limiter blocks', async () => {
    const env = makeEnv(makeDb([]), blockRl);
    const req = new Request('https://example.com/v1/users/me/accolades');
    const res = await handleUserAccoladesGet(req, env, session);
    expect(res.status).toBe(429);
  });

  it('queries by the authenticated user_id', async () => {
    const db = makeDb([]);
    const env = makeEnv(db);
    const req = new Request('https://example.com/v1/users/me/accolades');
    await handleUserAccoladesGet(req, env, session);
    // The handler's first .bind() arg is session.userId.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((db as any)._lastBinds()[0]).toBe('user-abc');
  });
});
