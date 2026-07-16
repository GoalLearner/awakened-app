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

// W677 — a pending TRIO instance (summoner u1 + allies u2/u3, neither answered yet).
const TRIO_PENDING_ROW = {
  ...PENDING_ROW,
  id: 'inst-3',
  boss_id: 'the_threefold_court',
  boss_rank: 'C',
  partner2_user_id: 'u3',
  partner_joined_at: null,
  partner2_joined_at: null,
  goal_steps: 27000,
  reward_souls: 66,
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
              return { results: [{ id: 'u1', alias: 'challenger' }, { id: 'u2', alias: 'partner' }, { id: 'u3', alias: 'partner2' }], success: true, meta: {} };
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
    // W677 — the trio join stamps+activates via env.DB.batch (atomic pair). The
    // mock just runs each bound statement; prepare() above already logged its SQL.
    batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => Promise.all(stmts.map((s) => s.run())),
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
    // ally-side rows (either seat — W677 trio) only count once ACTIVE (accepted).
    expect(capSql).toMatch(/\(partner_user_id = \?1 OR partner2_user_id = \?1\) AND status = 'active'/);
    // W677 review #1 — an ANSWERED trio seat counts even while the instance is
    // still pending on the other ally (else: deterministic cap/paywall bypass).
    expect(capSql).toMatch(/partner_joined_at IS NOT NULL/);
    expect(capSql).toMatch(/partner2_joined_at IS NOT NULL/);
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

// ── W674 — atomic guarded create backstop (the race the fast-path checks miss) ──
describe('W674 — atomic guarded create insert', () => {
  function racedDb(dupExists: boolean) {
    return {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () =>
            sql.includes('FROM users WHERE id IN')
              ? { results: [{ id: 'u1', alias: 'challenger' }, { id: 'u2', alias: 'partner' }], success: true, meta: {} }
              : { results: [], success: true, meta: {} },
          first: async () => {
            if (sql.includes('FROM premium_subscriptions')) return null; // free hunter
            if (sql.includes('FROM friends')) return { id: 'friend-row' };
            if (sql.includes('FROM public_profile_summary')) return { rank_tier: 'S' };
            if (sql.includes('COUNT(*) AS n FROM coop_boss_instances')) return { n: 0 }; // fast-path cap passes
            if (sql.includes('SELECT id FROM coop_boss_instances')) return null; // pre-check dup: none
            if (sql.includes('SELECT 1 AS x FROM coop_boss_instances')) return dupExists ? { x: 1 } : null; // re-check
            return null;
          },
          run: async () => ({ success: true, meta: { changes: 0 } }), // atomic insert LOST the race
        }),
      }),
    } as unknown as D1Database;
  }

  it('409 ALREADY_ACTIVE when the guarded insert loses to a raced duplicate', async () => {
    const res = await handleCoopBossCreate(createReq(), makeEnv(racedDb(true)), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(409);
    expect(body.error).toBe('ALREADY_ACTIVE');
  });

  it('409 CAP_REACHED when the guarded insert is blocked by the cap in the race', async () => {
    const res = await handleCoopBossCreate(createReq(), makeEnv(racedDb(false)), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(409);
    expect(body.error).toBe('CAP_REACHED');
  });
});

// ── W677 — TRIO hunts (partySize 3: summoner + 2 hand-picked friends) ──────
describe('W677 — trio create validation', () => {
  function trioReq(body: Record<string, unknown>): Request {
    return new Request('http://test/v1/coop-boss', { method: 'POST', body: JSON.stringify(body) });
  }

  it('400 MISSING_PARTNER2 when a trio boss gets only one ally', async () => {
    const res = await handleCoopBossCreate(
      trioReq({ partner_user_id: 'u2', boss_id: 'the_threefold_court' }),
      makeEnv(makeDb({})), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('MISSING_PARTNER2');
  });

  it('400 PARTY_SIZE when a duo boss gets a second ally', async () => {
    const res = await handleCoopBossCreate(
      trioReq({ partner_user_id: 'u2', partner2_user_id: 'u3', boss_id: 'the_twin_maw' }),
      makeEnv(makeDb({})), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('PARTY_SIZE');
  });

  it('400 DUPLICATE_ALLY when both trio seats name the same friend', async () => {
    const res = await handleCoopBossCreate(
      trioReq({ partner_user_id: 'u2', partner2_user_id: 'u2', boss_id: 'the_threefold_court' }),
      makeEnv(makeDb({})), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('DUPLICATE_ALLY');
  });

  it('400 SELF_PARTNER when the summoner invites themself into a trio seat', async () => {
    const res = await handleCoopBossCreate(
      trioReq({ partner_user_id: 'u2', partner2_user_id: 'u1', boss_id: 'the_threefold_court' }),
      makeEnv(makeDb({})), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('SELF_PARTNER');
  });

  it('a valid trio create INSERTs partner2 and reads back a trio instance', async () => {
    const log: string[] = [];
    const res = await handleCoopBossCreate(
      trioReq({ partner_user_id: 'u2', partner2_user_id: 'u3', boss_id: 'the_threefold_court' }),
      makeEnv(makeDb({ instance: { ...TRIO_PENDING_ROW } }, log)), session('u1'));
    const body = (await res.json()) as { ok?: boolean; instance?: { party_size?: number; partner2?: { user_id: string } } };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const insert = log.find((s) => s.includes('INSERT INTO coop_boss_instances'));
    expect(insert).toBeTruthy();
    expect(insert).toMatch(/partner2_user_id/);
    expect(body.instance?.party_size).toBe(3);
    expect(body.instance?.partner2?.user_id).toBe('u3');
  });
});

describe('W677 — trio join (activate only when BOTH allies answered)', () => {
  it("the first ally's join stamps their seat and leaves the hunt pending", async () => {
    const log: string[] = [];
    const res = await handleCoopBossJoin(
      createReq(), makeEnv(makeDb({ instance: { ...TRIO_PENDING_ROW } }, log)), session('u2'), 'inst-3');
    const body = (await res.json()) as { ok?: boolean; instance?: { status?: string } };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // seat stamp is guarded (only-if-unanswered) …
    const stamp = log.find((s) => s.includes('SET partner_joined_at = CURRENT_TIMESTAMP'));
    expect(stamp).toBeTruthy();
    expect(stamp).toMatch(/partner_joined_at IS NULL/);
    // … and activation demands BOTH stamps (the mock row has neither → still pending).
    const activate = log.find((s) => s.includes("SET status = 'active'"));
    expect(activate).toMatch(/partner_joined_at IS NOT NULL AND partner2_joined_at IS NOT NULL/);
    expect(body.instance?.status).toBe('pending');
  });

  it('the second seat (partner2) stamps ITS column', async () => {
    const log: string[] = [];
    await handleCoopBossJoin(
      createReq(), makeEnv(makeDb({ instance: { ...TRIO_PENDING_ROW } }, log)), session('u3'), 'inst-3');
    expect(log.find((s) => s.includes('SET partner2_joined_at = CURRENT_TIMESTAMP'))).toBeTruthy();
  });

  it('400 ALREADY_JOINED when a trio seat answers twice', async () => {
    const res = await handleCoopBossJoin(
      createReq(),
      makeEnv(makeDb({ instance: { ...TRIO_PENDING_ROW, partner_joined_at: '2026-07-15 00:00:00' } })),
      session('u2'), 'inst-3');
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('ALREADY_JOINED');
  });

  it('403 when a non-invited hunter tries to join a trio', async () => {
    const res = await handleCoopBossJoin(
      createReq(), makeEnv(makeDb({ instance: { ...TRIO_PENDING_ROW } })), session('u9'), 'inst-3');
    expect(res.status).toBe(403);
  });
});
