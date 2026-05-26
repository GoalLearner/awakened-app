/**
 * duels.test.ts — handler-shape tests for v3 Phase 1z.147 sub-day
 * duel duration support. Same conventions as
 * leaderboard-submit.test.ts: deterministic handler logic that
 * doesn't require a real SQL engine.
 *
 * Covers:
 *   - duration_seconds round-trips through INSERT binds
 *   - duration_seconds out-of-range / non-integer rejection
 *   - duration_days legacy path still works
 *   - CONFLICTING_DURATION when both fields present
 *   - Accept handler uses duration_seconds * 1000 ms when present
 *     and falls back to duration_days * 86400 * 1000 ms otherwise
 *   - Serializer exposes both duration_days and duration_seconds
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import {
  handleDuelsCreate,
  handleDuelsAccept,
} from './duels';
import type { Env } from '../env';

const okRl = { limit: async () => ({ success: true }) };

interface CapturedCall {
  sql: string;
  binds: unknown[];
}

interface MakeDbOptions {
  /** Row returned from SELECT * FROM duels WHERE id = ? (accept reads this). */
  duelRow?: Partial<{
    id: string;
    challenger_user_id: string;
    opponent_user_id: string;
    status: string;
    duration_days: number;
    duration_seconds: number | null;
    duel_type: string;
    stake_souls: number;
    reward_souls: number;
    burn_souls: number;
    starts_at: string | null;
    ends_at: string | null;
  }> | null;
  /** Whether to claim the opponent alias exists (handleDuelsCreate looks it up). */
  opponentExists?: boolean;
  /** Whether to claim the challenger ↔ opponent friendship is accepted. */
  areFriends?: boolean;
  /** Whether to claim a pending/active duel already exists between the pair. */
  hasExistingDuel?: boolean;
}

function makeDb(opts: MakeDbOptions = {}) {
  const calls: CapturedCall[] = [];
  const duelRow = opts.duelRow === undefined
    ? null
    : opts.duelRow;
  const opponentExists = opts.opponentExists !== false;
  const areFriends     = opts.areFriends !== false;
  const hasExistingDuel = !!opts.hasExistingDuel;

  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        return {
          all:   async () => ({ results: [], success: true, meta: {} }),
          first: async () => {
            // findUserByAlias → SELECT id, alias FROM users WHERE LOWER(REPLACE(alias, ' ', '')) = ?
            if (sql.includes("LOWER(REPLACE(alias")) {
              return opponentExists
                ? { id: 'opp-xyz', alias: 'rendiesel' }
                : null;
            }
            // areAcceptedFriends → SELECT 1 FROM friends ... status='accepted'
            if (sql.includes('FROM friends')) {
              return areFriends ? { ok: 1 } : null;
            }
            // existing-duel guard → SELECT id, status FROM duels WHERE status IN ('pending','active')
            if (sql.includes("status IN ('pending', 'active')")) {
              return hasExistingDuel ? { id: 'duel-existing', status: 'pending' } : null;
            }
            // Read-back / accept SELECT * FROM duels WHERE id = ?
            if (sql.includes('SELECT * FROM duels')) {
              return duelRow;
            }
            // getAliasMap is read via .all() — not .first() — but keep
            // a defensive fallback here for any other user lookups.
            if (sql.includes('FROM users WHERE id IN')) {
              return null;
            }
            return null;
          },
          run:   async () => ({ success: true, meta: { changes: 1 } }),
        };
      },
    }),
    _calls: () => calls,
  } as unknown as D1Database & { _calls: () => CapturedCall[] };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    JWT_SIGNING_KEY: 'unused',
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
    RL_USER_ACCOLADES_READ: okRl,
  } as unknown as Env;
}

const session = { userId: 'challenger-abc', alias: 'Richie' };

function makeReq(body: unknown): Request {
  return new Request('https://example.com/v1/duels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/duels — duration_seconds support (1z.147)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 26, 18, 0, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists duration_seconds when supplied alone (1-hour duel)', async () => {
    const db = makeDb({
      duelRow: {
        id: 'duel-1', challenger_user_id: 'challenger-abc',
        opponent_user_id: 'opp-xyz', status: 'pending',
        duration_days: 1, duration_seconds: 3600, duel_type: 'verified_objectives',
        stake_souls: 25, reward_souls: 40, burn_souls: 10,
        starts_at: null, ends_at: null,
      },
    });
    const env = makeEnv(db);
    const res = await handleDuelsCreate(
      makeReq({ opponent_alias: 'rendiesel', duration_seconds: 3600 }),
      env, session,
    );
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO duels'))!;
    expect(insert).toBeDefined();
    // Column list includes duration_seconds.
    expect(insert.sql).toMatch(/duration_seconds/);
    // Bind order: id, challenger, opp, stake, reward, burn, days, seconds, duel_type
    // (status is the literal 'pending' in VALUES, not bound).
    expect(insert.binds[6]).toBe(1);     // derived duration_days = ceil(3600/86400) = 1
    expect(insert.binds[7]).toBe(3600);  // duration_seconds
  });

  it('legacy duration_days path persists duration_seconds = NULL', async () => {
    const db = makeDb({
      duelRow: {
        id: 'duel-2', challenger_user_id: 'challenger-abc',
        opponent_user_id: 'opp-xyz', status: 'pending',
        duration_days: 3, duration_seconds: null, duel_type: 'verified_objectives',
        stake_souls: 25, reward_souls: 40, burn_souls: 10,
        starts_at: null, ends_at: null,
      },
    });
    const env = makeEnv(db);
    const res = await handleDuelsCreate(
      makeReq({ opponent_alias: 'rendiesel', duration_days: 3 }),
      env, session,
    );
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO duels'))!;
    expect(insert.binds[6]).toBe(3);     // duration_days = 3
    expect(insert.binds[7]).toBe(null);  // duration_seconds = NULL
  });

  it('rejects CONFLICTING_DURATION when both duration_days and duration_seconds are provided', async () => {
    const db = makeDb({ duelRow: null });
    const env = makeEnv(db);
    const res = await handleDuelsCreate(
      makeReq({ opponent_alias: 'rendiesel', duration_days: 3, duration_seconds: 3600 }),
      env, session,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('CONFLICTING_DURATION');
  });

  it('rejects duration_seconds below the 60-second floor', async () => {
    const db = makeDb({ duelRow: null });
    const env = makeEnv(db);
    const res = await handleDuelsCreate(
      makeReq({ opponent_alias: 'rendiesel', duration_seconds: 30 }),
      env, session,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('INVALID_DURATION');
  });

  it('rejects duration_seconds above the 14-day ceiling', async () => {
    const db = makeDb({ duelRow: null });
    const env = makeEnv(db);
    const res = await handleDuelsCreate(
      makeReq({ opponent_alias: 'rendiesel', duration_seconds: 14 * 86400 + 1 }),
      env, session,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('INVALID_DURATION');
  });

  it('rejects non-integer duration_seconds', async () => {
    const db = makeDb({ duelRow: null });
    const env = makeEnv(db);
    const res = await handleDuelsCreate(
      makeReq({ opponent_alias: 'rendiesel', duration_seconds: 3600.5 }),
      env, session,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('INVALID_DURATION');
  });

  it('defaults to DEFAULT_DURATION_SECONDS (86400) when neither field is provided', async () => {
    const db = makeDb({
      duelRow: {
        id: 'duel-3', challenger_user_id: 'challenger-abc',
        opponent_user_id: 'opp-xyz', status: 'pending',
        duration_days: 1, duration_seconds: 86400, duel_type: 'verified_objectives',
        stake_souls: 25, reward_souls: 40, burn_souls: 10,
        starts_at: null, ends_at: null,
      },
    });
    const env = makeEnv(db);
    const res = await handleDuelsCreate(
      makeReq({ opponent_alias: 'rendiesel' }),
      env, session,
    );
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    const insert = calls.find(c => c.sql.includes('INSERT INTO duels'))!;
    expect(insert.binds[6]).toBe(1);      // ceil(86400/86400) = 1
    expect(insert.binds[7]).toBe(86400);  // 24h default
  });

  it('serializer exposes both duration_days and duration_seconds', async () => {
    const db = makeDb({
      duelRow: {
        id: 'duel-4', challenger_user_id: 'challenger-abc',
        opponent_user_id: 'opp-xyz', status: 'pending',
        duration_days: 1, duration_seconds: 3600, duel_type: 'verified_objectives',
        stake_souls: 25, reward_souls: 40, burn_souls: 10,
        starts_at: null, ends_at: null,
      },
    });
    const env = makeEnv(db);
    const res = await handleDuelsCreate(
      makeReq({ opponent_alias: 'rendiesel', duration_seconds: 3600 }),
      env, session,
    );
    const body = await res.json() as { duel?: { duration_days?: number; duration_seconds?: number | null } };
    expect(body.duel?.duration_days).toBe(1);
    expect(body.duel?.duration_seconds).toBe(3600);
  });
});

describe('POST /v1/duels/:id/accept — duration_seconds end-time math (1z.147)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin to 2026-05-26 18:00:00 UTC. Accept handler uses Date.now()
    // for starts_at and adds the duration to it.
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 26, 18, 0, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets ends_at = starts_at + 3600s for a 1-hour duel', async () => {
    // Opponent (session) accepts; duelRow simulates the row read both
    // before AND after the UPDATE. The duration_seconds field is 3600.
    const opponentSession = { userId: 'opp-xyz', alias: 'rendiesel' };
    const db = makeDb({
      duelRow: {
        id: 'duel-5', challenger_user_id: 'challenger-abc',
        opponent_user_id: 'opp-xyz', status: 'pending',
        duration_days: 1, duration_seconds: 3600, duel_type: 'verified_objectives',
        stake_souls: 25, reward_souls: 40, burn_souls: 10,
        starts_at: null, ends_at: null,
      },
    });
    const env = makeEnv(db);
    await handleDuelsAccept(
      new Request('https://example.com/v1/duels/duel-5/accept', { method: 'POST' }),
      env, opponentSession, 'duel-5',
    );
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    const update = calls.find(c => c.sql.includes('UPDATE duels') && c.sql.includes("status = 'active'"))!;
    expect(update).toBeDefined();
    // binds[0] = starts_at, binds[1] = ends_at, binds[2] = duelId
    const startsAt = update.binds[0] as string;
    const endsAt   = update.binds[1] as string;
    const deltaMs = Date.parse(endsAt) - Date.parse(startsAt);
    expect(deltaMs).toBe(3600 * 1000);
  });

  it('falls back to duration_days * 86400 when duration_seconds is NULL (legacy row)', async () => {
    const opponentSession = { userId: 'opp-xyz', alias: 'rendiesel' };
    const db = makeDb({
      duelRow: {
        id: 'duel-6', challenger_user_id: 'challenger-abc',
        opponent_user_id: 'opp-xyz', status: 'pending',
        duration_days: 3, duration_seconds: null, duel_type: 'verified_objectives',
        stake_souls: 25, reward_souls: 40, burn_souls: 10,
        starts_at: null, ends_at: null,
      },
    });
    const env = makeEnv(db);
    await handleDuelsAccept(
      new Request('https://example.com/v1/duels/duel-6/accept', { method: 'POST' }),
      env, opponentSession, 'duel-6',
    );
    const calls = (db as unknown as { _calls: () => CapturedCall[] })._calls();
    const update = calls.find(c => c.sql.includes('UPDATE duels') && c.sql.includes("status = 'active'"))!;
    const startsAt = update.binds[0] as string;
    const endsAt   = update.binds[1] as string;
    const deltaMs = Date.parse(endsAt) - Date.parse(startsAt);
    expect(deltaMs).toBe(3 * 86400 * 1000);
  });
});
