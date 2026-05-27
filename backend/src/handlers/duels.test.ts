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
  settleDuelEconomy,
  getDuelSoulsDeltaForUser,
  getUserSoulsBalance,
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

// ─────────────────────────────────────────────────────────────
// v3 Phase 1z.155 — duel economy settlement (settleDuelEconomy)
//
// Verifies the upgraded settle function:
//   - decisive duel: winner +reward / duel_win  AND  loser -stake / duel_loss
//   - draw:          no ledger inserts, but reward_settled_at still set
//   - idempotency:   re-call writes nothing new (UNIQUE index)
// ─────────────────────────────────────────────────────────────
describe('settleDuelEconomy — duel souls ledger (1z.155)', () => {
  // Capture-only DB: every prepare().bind().run() records the SQL +
  // binds, no row state changes. The UNIQUE index that protects
  // re-resolve idempotency lives in D1 — at the application layer
  // we just emit INSERT OR IGNORE statements, and SQLite handles the
  // rest. So the unit test asserts SHAPE (correct INSERTs emitted)
  // rather than D1 behaviour (which is its own integration concern).
  function makeCaptureDb() {
    const calls: CapturedCall[] = [];
    return {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          calls.push({ sql, binds: args });
          return {
            all:   async () => ({ results: [], success: true, meta: {} }),
            first: async () => null,
            run:   async () => ({ success: true, meta: { changes: 1 } }),
          };
        },
      }),
      _calls: () => calls,
    } as unknown as D1Database & { _calls: () => CapturedCall[] };
  }

  function makeDuel(overrides: Partial<{
    id: string;
    challenger_user_id: string;
    opponent_user_id: string;
    winner_user_id: string | null;
    stake_souls: number;
    reward_souls: number;
    duel_type: string;
    result: string | null;
  }> = {}) {
    return {
      id: 'duel-test-1',
      challenger_user_id: 'user-chall',
      opponent_user_id: 'user-opp',
      status: 'completed',
      stake_souls: 25,
      reward_souls: 40,
      burn_souls: 10,
      duration_days: 1,
      duration_seconds: 3600,
      duel_type: 'steps',
      starts_at: '2026-05-26T18:00:00.000Z',
      ends_at: '2026-05-26T19:00:00.000Z',
      winner_user_id: 'user-chall',
      challenger_score: 5000,
      opponent_score: 3000,
      challenger_verified_score: 0,
      opponent_verified_score: 0,
      challenger_xp_score: 0,
      opponent_xp_score: 0,
      created_at: '2026-05-26T17:00:00Z',
      updated_at: '2026-05-26T19:00:00Z',
      resolved_at: '2026-05-26T19:00:01Z',
      result: 'challenger_win',
      reward_settled_at: null,
      ...overrides,
    } as Parameters<typeof settleDuelEconomy>[1];
  }

  it('challenger win: inserts +reward/duel_win for winner AND -stake/duel_loss for loser', async () => {
    const db = makeCaptureDb();
    const env = makeEnv(db);
    await settleDuelEconomy(env, makeDuel({ winner_user_id: 'user-chall', result: 'challenger_win' }));

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const ledgerInserts = calls.filter(c => c.sql.includes('INSERT OR IGNORE INTO user_souls_ledger'));
    expect(ledgerInserts).toHaveLength(2);

    // Bind layout: (id, user_id, delta, reason, ref_id, metadata_json)
    const winnerRow = ledgerInserts.find(c => c.binds[3] === 'duel_win');
    const loserRow  = ledgerInserts.find(c => c.binds[3] === 'duel_loss');
    expect(winnerRow).toBeDefined();
    expect(loserRow).toBeDefined();
    expect(winnerRow!.binds[1]).toBe('user-chall');
    expect(winnerRow!.binds[2]).toBe(40);
    expect(winnerRow!.binds[4]).toBe('duel-test-1');
    expect(loserRow!.binds[1]).toBe('user-opp');
    expect(loserRow!.binds[2]).toBe(-25);   // negative — loser stake deduction
    expect(loserRow!.binds[4]).toBe('duel-test-1');

    // reward_settled_at marked.
    const settleUpdate = calls.find(c => c.sql.includes('UPDATE duels SET reward_settled_at'));
    expect(settleUpdate).toBeDefined();
    expect(settleUpdate!.sql).toMatch(/WHERE id = \? AND reward_settled_at IS NULL/);
  });

  it('opponent win: loser is challenger (correct direction)', async () => {
    const db = makeCaptureDb();
    const env = makeEnv(db);
    await settleDuelEconomy(env, makeDuel({ winner_user_id: 'user-opp', result: 'opponent_win' }));

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const ledgerInserts = calls.filter(c => c.sql.includes('INSERT OR IGNORE INTO user_souls_ledger'));
    expect(ledgerInserts).toHaveLength(2);

    const winnerRow = ledgerInserts.find(c => c.binds[3] === 'duel_win');
    const loserRow  = ledgerInserts.find(c => c.binds[3] === 'duel_loss');
    expect(winnerRow!.binds[1]).toBe('user-opp');
    expect(winnerRow!.binds[2]).toBe(40);
    expect(loserRow!.binds[1]).toBe('user-chall');
    expect(loserRow!.binds[2]).toBe(-25);
  });

  it('draw: zero ledger inserts, but reward_settled_at IS marked', async () => {
    const db = makeCaptureDb();
    const env = makeEnv(db);
    await settleDuelEconomy(env, makeDuel({ winner_user_id: null, result: 'draw' }));

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const ledgerInserts = calls.filter(c => c.sql.includes('INSERT OR IGNORE INTO user_souls_ledger'));
    expect(ledgerInserts).toHaveLength(0);

    const settleUpdate = calls.find(c => c.sql.includes('UPDATE duels SET reward_settled_at'));
    expect(settleUpdate).toBeDefined();
  });

  it('idempotency: emits INSERT OR IGNORE so D1 UNIQUE index can dedupe re-resolves', async () => {
    const db = makeCaptureDb();
    const env = makeEnv(db);
    await settleDuelEconomy(env, makeDuel({ winner_user_id: 'user-chall', result: 'challenger_win' }));

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const ledgerInserts = calls.filter(c => c.sql.includes('INSERT OR IGNORE INTO user_souls_ledger'));
    expect(ledgerInserts).toHaveLength(2);
    // Both inserts MUST be INSERT OR IGNORE — if a future refactor
    // drops the `OR IGNORE`, re-resolve would 500 on the UNIQUE
    // constraint and the whole resolve handler would fail.
    for (const c of ledgerInserts) {
      expect(c.sql).toMatch(/INSERT OR IGNORE/i);
    }
    // reward_settled_at update must also guard with `IS NULL` so a
    // second settle pass doesn't bump the timestamp.
    const settleUpdate = calls.find(c => c.sql.includes('UPDATE duels SET reward_settled_at'));
    expect(settleUpdate!.sql).toMatch(/reward_settled_at IS NULL/);
  });

  it('reward=0 skips winner insert (defensive against misconfigured duels)', async () => {
    const db = makeCaptureDb();
    const env = makeEnv(db);
    await settleDuelEconomy(env, makeDuel({ reward_souls: 0, winner_user_id: 'user-chall', result: 'challenger_win' }));

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const inserts = calls.filter(c => c.sql.includes('INSERT OR IGNORE INTO user_souls_ledger'));
    const winnerRow = inserts.find(c => c.binds[3] === 'duel_win');
    const loserRow  = inserts.find(c => c.binds[3] === 'duel_loss');
    expect(winnerRow).toBeUndefined();   // skipped
    expect(loserRow).toBeDefined();      // still deducts
  });

  it('stake=0 skips loser insert (defensive against misconfigured duels)', async () => {
    const db = makeCaptureDb();
    const env = makeEnv(db);
    await settleDuelEconomy(env, makeDuel({ stake_souls: 0, winner_user_id: 'user-chall', result: 'challenger_win' }));

    const calls = (db as unknown as { _calls(): CapturedCall[] })._calls();
    const inserts = calls.filter(c => c.sql.includes('INSERT OR IGNORE INTO user_souls_ledger'));
    const winnerRow = inserts.find(c => c.binds[3] === 'duel_win');
    const loserRow  = inserts.find(c => c.binds[3] === 'duel_loss');
    expect(winnerRow).toBeDefined();
    expect(loserRow).toBeUndefined();    // skipped
  });
});

// ─────────────────────────────────────────────────────────────
// v3 Phase 1z.156 — Phase β helpers (resolve response payload)
//
// Verifies the two pure helpers that build the new `souls` payload
// on the resolve response: getDuelSoulsDeltaForUser (no I/O, pure
// function) and getUserSoulsBalance (single SUM read).
// ─────────────────────────────────────────────────────────────
describe('getDuelSoulsDeltaForUser — viewer-perspective duel delta (1z.156)', () => {
  function makeResolvedDuel(winner: 'challenger' | 'opponent' | 'draw') {
    return {
      id: 'duel-abc',
      challenger_user_id: 'user-chall',
      opponent_user_id: 'user-opp',
      stake_souls: 25,
      reward_souls: 40,
      winner_user_id:
        winner === 'challenger' ? 'user-chall' :
        winner === 'opponent'   ? 'user-opp'   :
        null,
    } as Parameters<typeof getDuelSoulsDeltaForUser>[0];
  }

  it('returns +reward_souls for the winner', () => {
    const duel = makeResolvedDuel('challenger');
    expect(getDuelSoulsDeltaForUser(duel, 'user-chall')).toBe(40);
  });

  it('returns -stake_souls for the loser', () => {
    const duel = makeResolvedDuel('challenger');
    expect(getDuelSoulsDeltaForUser(duel, 'user-opp')).toBe(-25);
  });

  it('returns +reward when opponent wins (for opponent)', () => {
    const duel = makeResolvedDuel('opponent');
    expect(getDuelSoulsDeltaForUser(duel, 'user-opp')).toBe(40);
  });

  it('returns -stake when opponent wins (for challenger as loser)', () => {
    const duel = makeResolvedDuel('opponent');
    expect(getDuelSoulsDeltaForUser(duel, 'user-chall')).toBe(-25);
  });

  it('returns 0 on draw', () => {
    const duel = makeResolvedDuel('draw');
    expect(getDuelSoulsDeltaForUser(duel, 'user-chall')).toBe(0);
    expect(getDuelSoulsDeltaForUser(duel, 'user-opp')).toBe(0);
  });

  it('returns 0 for a third-party (non-participant) caller', () => {
    const duel = makeResolvedDuel('challenger');
    expect(getDuelSoulsDeltaForUser(duel, 'user-bystander')).toBe(0);
  });

  it('returns 0 when userId is empty/falsy', () => {
    const duel = makeResolvedDuel('challenger');
    expect(getDuelSoulsDeltaForUser(duel, '')).toBe(0);
  });
});

describe('getUserSoulsBalance — backend-authoritative ledger sum (1z.156)', () => {
  function makeBalanceDb(returnedBalance: number | null) {
    return {
      prepare: (sql: string) => ({
        bind: (..._args: unknown[]) => ({
          all:   async () => ({ results: [], success: true, meta: {} }),
          first: async () => {
            if (sql.includes('FROM user_souls_ledger')) {
              return returnedBalance == null ? null : { balance: returnedBalance };
            }
            return null;
          },
          run:   async () => ({ success: true, meta: { changes: 0 } }),
        }),
      }),
    } as unknown as D1Database;
  }

  it('returns the SUM(delta) from user_souls_ledger', async () => {
    const env = makeEnv(makeBalanceDb(125));
    const balance = await getUserSoulsBalance(env, 'user-chall');
    expect(balance).toBe(125);
  });

  it('returns 0 when the SUM is NULL (no rows yet for this user)', async () => {
    const env = makeEnv(makeBalanceDb(0));
    const balance = await getUserSoulsBalance(env, 'user-newbie');
    expect(balance).toBe(0);
  });

  it('returns 0 when the row is missing entirely (defensive)', async () => {
    const env = makeEnv(makeBalanceDb(null));
    const balance = await getUserSoulsBalance(env, 'user-chall');
    expect(balance).toBe(0);
  });

  it('returns 0 immediately for empty userId without hitting the DB', async () => {
    let queried = false;
    const env = makeEnv({
      prepare: () => ({
        bind: () => ({
          all:   async () => ({ results: [], success: true, meta: {} }),
          first: async () => { queried = true; return null; },
          run:   async () => ({ success: true, meta: { changes: 0 } }),
        }),
      }),
    } as unknown as D1Database);
    const balance = await getUserSoulsBalance(env, '');
    expect(balance).toBe(0);
    expect(queried).toBe(false);
  });

  it('handles negative cumulative balance (loser-heavy history)', async () => {
    const env = makeEnv(makeBalanceDb(-50));
    const balance = await getUserSoulsBalance(env, 'user-loser');
    expect(balance).toBe(-50);
  });
});
