/**
 * coop-boss.test.ts — W648 concurrent-hunt cap (the co-op membership paywall).
 *
 * Free hunters may run at most FREE_CONCURRENT_HUNT_CAP (3) simultaneous
 * hunts; Premium members are unlimited. The cap is enforced server-side in BOTH
 * create and join, so a modded client cannot bypass it. Same hand-rolled
 * substring-routed D1 mock as the other handler tests.
 */
import { describe, expect, it } from 'vitest';
import { handleCoopBossCreate, handleCoopBossJoin } from './coop-boss';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

const PENDING_ROW = {
  id: 'inst-1',
  boss_id: 'the_twin_maw',
  boss_rank: 'E',
  challenger_user_id: 'u1',
  partner_user_id: 'u2',
  goal_steps: 16000,
  goal_flights: null,
  reward_souls: 25,
  status: 'pending',
  result: null,
  starts_at: null,
  ends_at: null,
  resolved_at: null,
  created_at: '2026-07-12 00:00:00',
  updated_at: '2026-07-12 00:00:00',
};

/** Substring-routed D1 mock. `sqlLog` captures every prepared statement so
 *  tests can assert on the cap query's semantics, not just its result. */
function makeDb(opts: { running?: number; premiumExpiresAt?: number; instance?: Record<string, unknown> | null }, sqlLog?: string[]) {
  return {
    prepare: (sql: string) => {
      sqlLog?.push(sql);
      return {
        bind: () => ({
          all: async () => {
            if (sql.includes('FROM users WHERE id IN')) {
              return { results: [{ id: 'u1', alias: 'challenger' }, { id: 'u2', alias: 'partner' }], success: true, meta: {} };
            }
            return { results: [], success: true, meta: {} };
          },
          first: async () => {
            if (sql.includes('FROM premium_subscriptions')) {
              return opts.premiumExpiresAt != null ? { expires_at_ms: opts.premiumExpiresAt } : null;
            }
            if (sql.includes('FROM friends')) return { id: 'friend-row' };
            if (sql.includes('FROM public_profile_summary')) return { rank_tier: 'S' };
            if (sql.includes('COUNT(*) AS n FROM coop_boss_instances')) return { n: opts.running ?? 0 };
            if (sql.includes('SELECT id FROM coop_boss_instances')) return null; // pair+boss dedupe: none
            if (sql.includes('SELECT * FROM coop_boss_instances')) {
              return opts.instance === undefined ? { ...PENDING_ROW } : opts.instance;
            }
            return null;
          },
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }),
      };
    },
  } as unknown as D1Database;
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    RL_COOP_WRITE: { limit: async () => ({ success: true }) },
  } as unknown as Env;
}

function session(userId: string): SessionPayload {
  return { userId, alias: 'tester' } as unknown as SessionPayload;
}

function createReq(): Request {
  return new Request('http://test/v1/coop-boss', {
    method: 'POST',
    body: JSON.stringify({ partner_user_id: 'u2', boss_id: 'the_twin_maw' }),
  });
}

describe('W648 — concurrent-hunt cap on CREATE', () => {
  it('allows a free hunter under the cap (2 running)', async () => {
    const res = await handleCoopBossCreate(createReq(), makeEnv(makeDb({ running: 2 })), session('u1'));
    const body = (await res.json()) as { ok?: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('rejects a free hunter AT the cap with 409 CAP_REACHED (+cap in payload)', async () => {
    const res = await handleCoopBossCreate(createReq(), makeEnv(makeDb({ running: 3 })), session('u1'));
    const body = (await res.json()) as { error?: string; cap?: number };
    expect(res.status).toBe(409);
    expect(body.error).toBe('CAP_REACHED');
    expect(body.cap).toBe(3);
  });

  it('W650 — lets an active premium SUBSCRIBER create past the cap', async () => {
    const res = await handleCoopBossCreate(
      createReq(),
      makeEnv(makeDb({ running: 50, premiumExpiresAt: Date.now() + 86_400_000 })),
      session('u1'),
    );
    const body = (await res.json()) as { ok?: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('W650 — a LAPSED subscriber is capped like a free hunter', async () => {
    const res = await handleCoopBossCreate(
      createReq(),
      makeEnv(makeDb({ running: 3, premiumExpiresAt: Date.now() - 1000 })),
      session('u1'),
    );
    const body = (await res.json()) as { error?: string };
    expect(res.status).toBe(409);
    expect(body.error).toBe('CAP_REACHED');
  });

  it('counts hunts via the received-invites-excluded formula (griefing guard)', async () => {
    const log: string[] = [];
    await handleCoopBossCreate(createReq(), makeEnv(makeDb({ running: 0 }, log)), session('u1'));
    const capSql = log.find((s) => s.includes('COUNT(*) AS n FROM coop_boss_instances'));
    expect(capSql).toBeTruthy();
    // A received-but-unanswered invite must NOT count against the invitee:
    // partner-side rows only count once ACTIVE (i.e., the user accepted).
    expect(capSql).toMatch(/partner_user_id = \? AND status = 'active'/);
    // W649 — an active hunt whose window already lapsed must not count either
    // (unresolved-expired rows would otherwise wall the user forever).
    expect(capSql).toMatch(/strftime\('%s', ends_at\) > strftime\('%s', 'now'\)/);
  });
});

describe('W648 — concurrent-hunt cap on JOIN', () => {
  it('rejects a free joiner AT the cap with 409 CAP_REACHED', async () => {
    const res = await handleCoopBossJoin(createReq(), makeEnv(makeDb({ running: 3 })), session('u2'), 'inst-1');
    const body = (await res.json()) as { error?: string };
    expect(res.status).toBe(409);
    expect(body.error).toBe('CAP_REACHED');
  });

  it('allows a free joiner under the cap', async () => {
    const res = await handleCoopBossJoin(createReq(), makeEnv(makeDb({ running: 2 })), session('u2'), 'inst-1');
    const body = (await res.json()) as { ok?: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('W650 — lets an active premium SUBSCRIBER join past the cap (unlimited)', async () => {
    const res = await handleCoopBossJoin(createReq(), makeEnv(makeDb({ running: 50, premiumExpiresAt: Date.now() + 86_400_000 })), session('u2'), 'inst-1');
    const body = (await res.json()) as { ok?: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
