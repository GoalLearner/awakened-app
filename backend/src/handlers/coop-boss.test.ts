/**
 * coop-boss.test.ts — W648 concurrent-hunt cap (the co-op membership paywall).
 *
 * Free hunters may run at most FREE_CONCURRENT_HUNT_CAP (3) simultaneous
 * hunts; Premium members are unlimited. The cap is enforced server-side in BOTH
 * create and join, so a modded client cannot bypass it. Same hand-rolled
 * substring-routed D1 mock as the other handler tests.
 */
import { describe, expect, it } from 'vitest';
import {
  handleCoopBossCreate,
  handleCoopBossGet,
  handleCoopBossJoin,
  handleRaidQueueJoin,
  handleRaidQueueLeave,
  handleRaidStart,
} from './coop-boss';
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
function makeDb(opts: { running?: number; premiumExpiresAt?: number; instance?: Record<string, unknown> | null; rankTier?: string }, sqlLog?: string[]) {
  // W692 — the instance the read-path (loadInstance / loadParticipants) resolves to.
  const inst = () => (opts.instance === undefined ? PENDING_ROW : opts.instance) as Record<string, unknown> | null;
  return {
    prepare: (sql: string) => {
      sqlLog?.push(sql);
      return {
        bind: (...args: unknown[]) => ({
          all: async () => {
            if (sql.includes('FROM users WHERE id IN')) {
              return { results: [{ id: 'u1', alias: 'challenger' }, { id: 'u2', alias: 'partner' }, { id: 'u3', alias: 'partner2' }], success: true, meta: {} };
            }
            // W692 — the participant roster (loadParticipants), derived from the mock
            // instance's legacy partner columns; joined_at mirrors the *_joined_at cols
            // so the join/ALREADY_JOINED paths see the right per-seat answered state.
            // The rows echo the QUERIED instance_id (bind arg 0) so loadInstance's
            // map.get(newUUID) resolves on a just-created hunt (its id is a fresh UUID).
            if (sql.includes('FROM coop_boss_participants')) {
              const i = inst();
              if (!i) return { results: [], success: true, meta: {} };
              const iid = (args[0] as string) ?? i.id;
              const rows: Record<string, unknown>[] = [];
              if (i.partner_user_id) rows.push({ instance_id: iid, user_id: i.partner_user_id, joined_at: i.partner_joined_at ?? null });
              if (i.partner2_user_id) rows.push({ instance_id: iid, user_id: i.partner2_user_id, joined_at: i.partner2_joined_at ?? null });
              return { results: rows, success: true, meta: {} };
            }
            // W686 — per-user MAX(value) progress rows for the steps+sleep raid tests.
            if (sql.includes('FROM verified_events')) {
              return {
                results: [
                  { user_id: 'u1', event_type: 'steps_total', s: 12000 },
                  { user_id: 'u1', event_type: 'sleep_minutes_total', s: 410 },
                  { user_id: 'u2', event_type: 'sleep_minutes_total', s: 190 },
                ],
                success: true, meta: {},
              };
            }
            return { results: [], success: true, meta: {} };
          },
          first: async () => {
            if (sql.includes('FROM premium_subscriptions')) {
              return opts.premiumExpiresAt != null ? { expires_at_ms: opts.premiumExpiresAt } : null;
            }
            if (sql.includes('FROM friends')) return { id: 'friend-row' };
            if (sql.includes('FROM public_profile_summary')) return { rank_tier: opts.rankTier ?? 'S' };
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
    // W686 — handleCoopBossGet shares the friends-read bucket.
    RL_FRIENDS_READ: { limit: async () => ({ success: true }) },
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
    // W692 — a received-but-unanswered invite must NOT count against the invitee.
    // Ally seats now live in coop_boss_participants; the cap counts a participant only
    // once the hunt is ACTIVE, or (the W677 answered-pending guard) once THAT seat has
    // been stamped joined_at while still pending — else a free user answers unlimited
    // summons cap-free and they all flip active later (deterministic paywall bypass).
    expect(capSql).toMatch(/EXISTS \(SELECT 1 FROM coop_boss_participants p\s+WHERE p\.instance_id = coop_boss_instances\.id AND p\.user_id = \?1/);
    expect(capSql).toMatch(/p\.joined_at IS NOT NULL/);
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
            // W692 — the dup check (fast-path AND post-insert re-derive share dupSelect:
            // `SELECT 1 FROM coop_boss_instances i …`). dupExists=false → the fast-path
            // passes and the CAP (lost batch) is what blocks → CAP_REACHED.
            if (sql.includes('SELECT 1 FROM coop_boss_instances i')) return dupExists ? { x: 1 } : null;
            if (sql.includes('SELECT * FROM coop_boss_instances')) return { ...PENDING_ROW };
            return null;
          },
          run: async () => ({ success: true, meta: { changes: 0 } }), // atomic insert LOST the race
        }),
      }),
      // W692 — the create's atomic insert + participant rows go through env.DB.batch;
      // each bound statement's run() reports changes:0, so the instance insert (result
      // [0]) shows the race was lost.
      batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => Promise.all(stmts.map((s) => s.run())),
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

  it('400 MISSING_PARTNER when a trio boss gets only one ally', async () => {
    const res = await handleCoopBossCreate(
      trioReq({ partner_user_id: 'u2', boss_id: 'the_threefold_court' }),
      makeEnv(makeDb({})), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    // W692 — the under-min-party guard is a single MISSING_PARTNER code across all sizes.
    expect(body.error).toBe('MISSING_PARTNER');
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
    // W692 — the participant seat is stamped (guarded, only-if-unanswered) …
    const partStamp = log.find((s) => s.includes('UPDATE coop_boss_participants SET joined_at = CURRENT_TIMESTAMP'));
    expect(partStamp).toBeTruthy();
    expect(partStamp).toMatch(/user_id = \? AND joined_at IS NULL/);
    // … the legacy partner column is dual-written for old clients (guarded) …
    const stamp = log.find((s) => s.includes('SET partner_joined_at = CURRENT_TIMESTAMP'));
    expect(stamp).toBeTruthy();
    expect(stamp).toMatch(/partner_joined_at IS NULL/);
    // … and activation demands NO seat is still unanswered (mock has u2+u3 both NULL →
    // one join leaves the other NULL → stays pending).
    const activate = log.find((s) => s.includes("SET status = 'active'"));
    expect(activate).toMatch(/NOT EXISTS \(SELECT 1 FROM coop_boss_participants WHERE instance_id = \? AND joined_at IS NULL\)/);
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

// ── W693 — The Grinning God: members-only N-hunter raid gate ──────────────
describe('W693 — Grinning God members-only gate + N-hunter party bounds', () => {
  const raidReq = (body: Record<string, unknown>) =>
    new Request('http://test/v1/coop-boss', { method: 'POST', body: JSON.stringify(body) });

  it('403 MEMBERS_ONLY when a non-member tries to summon the raid', async () => {
    const res = await handleCoopBossCreate(
      raidReq({ ally_user_ids: ['u2'], boss_id: 'the_grinning_god' }),
      makeEnv(makeDb({})), session('u1')); // no premiumExpiresAt → free hunter
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(403);
    expect(body.error).toBe('MEMBERS_ONLY');
  });

  it('a member summons the raid with an ally array (2-of-5 party allowed)', async () => {
    const res = await handleCoopBossCreate(
      raidReq({ ally_user_ids: ['u2'], boss_id: 'the_grinning_god' }),
      makeEnv(makeDb({ premiumExpiresAt: Date.now() + 86_400_000 })), session('u1'));
    const body = (await res.json()) as { ok?: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('400 PARTY_SIZE when a raid gets more than four allies (party > 5)', async () => {
    const res = await handleCoopBossCreate(
      raidReq({ ally_user_ids: ['u2', 'u3', 'u4', 'u5', 'u6'], boss_id: 'the_grinning_god' }),
      makeEnv(makeDb({ premiumExpiresAt: Date.now() + 86_400_000 })), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('PARTY_SIZE');
  });
});

// ── W699 — members raid gates on MEMBERSHIP, not rank (owner) ──────────────
// The Grinning God (memberOnly) drops its rank gate: any member may summon/join it
// at ANY rank. Ordinary rank bosses keep their rank gate. makeDb's default rank is
// 'S', so these tests set a SUB-S rank to prove the exemption actually fires.
describe('W699 — members-only raid: rank gate lifted for members', () => {
  const raidReq = (body: Record<string, unknown>) =>
    new Request('http://test/v1/coop-boss', { method: 'POST', body: JSON.stringify(body) });
  const qReq = (body: Record<string, unknown>) =>
    new Request('http://test/v1/raid-queue', { method: 'POST', body: JSON.stringify(body) });
  const member = Date.now() + 86_400_000;

  it('a SUB-S member (rank A) summons the Grinning God — no INSUFFICIENT_RANK', async () => {
    const res = await handleCoopBossCreate(
      raidReq({ ally_user_ids: ['u2'], boss_id: 'the_grinning_god' }),
      makeEnv(makeDb({ premiumExpiresAt: member, rankTier: 'A' })), session('u1'));
    const body = (await res.json()) as { ok?: boolean; error?: string };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('a member well below the raid rank (E) queues the raid finder — no INSUFFICIENT_RANK', async () => {
    const res = await handleRaidQueueJoin(
      qReq({ boss_id: 'the_grinning_god' }),
      makeEnv(makeDb({ premiumExpiresAt: member, rankTier: 'E' })), session('u1'));
    const body = (await res.json()) as { ok: boolean; queued: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.queued).toBe(true);
  });

  it('membership is STILL required — a sub-S non-member is refused MEMBERS_ONLY, not rank', async () => {
    const res = await handleCoopBossCreate(
      raidReq({ ally_user_ids: ['u2'], boss_id: 'the_grinning_god' }),
      makeEnv(makeDb({ rankTier: 'A' })), session('u1')); // rank A but no premium
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(403);
    expect(body.error).toBe('MEMBERS_ONLY');
  });

  it('regression: an ORDINARY rank boss STILL blocks a sub-rank summoner (INSUFFICIENT_RANK)', async () => {
    const res = await handleCoopBossCreate(
      raidReq({ ally_user_ids: ['u2'], boss_id: 'the_coursing_dread' }), // C-rank, not memberOnly
      makeEnv(makeDb({ premiumExpiresAt: member, rankTier: 'E' })), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(403);
    expect(body.error).toBe('INSUFFICIENT_RANK');
  });
});

// ── W694 — Raid-finder matchmaking (the members raid) ──────────────────────
describe('W694 — raid-queue matchmaking gates', () => {
  const qReq = (body: Record<string, unknown>) =>
    new Request('http://test/v1/raid-queue', { method: 'POST', body: JSON.stringify(body) });

  it('400 UNKNOWN_BOSS for an unknown boss id', async () => {
    const res = await handleRaidQueueJoin(qReq({ boss_id: 'nope' }), makeEnv(makeDb({})), session('u1'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('UNKNOWN_BOSS');
  });

  it('400 NO_MATCHMAKING for a boss without a raid finder (the duo Twin Maw)', async () => {
    const res = await handleRaidQueueJoin(qReq({ boss_id: 'the_twin_maw' }), makeEnv(makeDb({})), session('u1'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('NO_MATCHMAKING');
  });

  it('403 MEMBERS_ONLY when a non-member tries to queue for the raid', async () => {
    const res = await handleRaidQueueJoin(qReq({ boss_id: 'the_grinning_god' }), makeEnv(makeDb({})), session('u1'));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('MEMBERS_ONLY');
  });

  it('a member with no other seekers is QUEUED (matched:false)', async () => {
    const res = await handleRaidQueueJoin(
      qReq({ boss_id: 'the_grinning_god' }),
      makeEnv(makeDb({ premiumExpiresAt: Date.now() + 86_400_000 })),
      session('u1'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; matched: boolean; queued: boolean };
    expect(body.ok).toBe(true);
    expect(body.matched).toBe(false);
    expect(body.queued).toBe(true);
  });

  it('leave the queue returns ok', async () => {
    const res = await handleRaidQueueLeave(qReq({}), makeEnv(makeDb({})), session('u1'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});

// ── W695 — "Summon & Fill" open party-hunts ────────────────────────────────
describe('W695 — Summon & Fill gates', () => {
  const raidReq = (body: Record<string, unknown>) =>
    new Request('http://test/v1/coop-boss', { method: 'POST', body: JSON.stringify(body) });

  it('400 NO_MATCHMAKING when fill_from_finder is sent for a non-finder boss', async () => {
    const res = await handleCoopBossCreate(
      raidReq({ ally_user_ids: ['u2'], boss_id: 'the_twin_maw', fill_from_finder: true }),
      makeEnv(makeDb({})), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('NO_MATCHMAKING');
  });

  it('400 PARTY_FULL when a full pick also asks to fill', async () => {
    const res = await handleCoopBossCreate(
      raidReq({ ally_user_ids: ['u2', 'u3', 'u4', 'u5'], boss_id: 'the_grinning_god', fill_from_finder: true }),
      makeEnv(makeDb({ premiumExpiresAt: Date.now() + 86_400_000 })), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('PARTY_FULL');
  });

  it('a member summons an under-full party WITH fill (fill_target rides the INSERT)', async () => {
    const log: string[] = [];
    const res = await handleCoopBossCreate(
      raidReq({ ally_user_ids: ['u2'], boss_id: 'the_grinning_god', fill_from_finder: true }),
      makeEnv(makeDb({ premiumExpiresAt: Date.now() + 86_400_000 }, log)), session('u1'));
    expect(res.status).toBe(200);
    const insert = log.find((s) => s.includes('INSERT INTO coop_boss_instances'));
    expect(insert).toBeTruthy();
    expect(insert).toMatch(/fill_target/);
  });

  it('start: 403 when a non-leader tries to start the open hunt', async () => {
    const res = await handleRaidStart(
      raidReq({}), makeEnv(makeDb({ instance: { ...PENDING_ROW, fill_target: 5 } })), session('u2'), 'inst-1');
    expect(res.status).toBe(403);
  });

  it('start: 400 BAD_STATE on a normal (closed) pending hunt', async () => {
    const res = await handleRaidStart(
      raidReq({}), makeEnv(makeDb({ instance: { ...PENDING_ROW } })), session('u1'), 'inst-1');
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('BAD_STATE');
  });

  it('start: 400 NOT_READY while an invited ally is still unanswered', async () => {
    const res = await handleRaidStart(
      raidReq({}),
      makeEnv(makeDb({ instance: { ...TRIO_PENDING_ROW, fill_target: 5 } })),   // u2/u3 unanswered
      session('u1'), 'inst-3');
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('NOT_READY');
  });
});

// ── W686 — The Sleepless Crown: first steps+SLEEP dual metric (S-rank, 72h) ──
const SLEEP_ACTIVE_ROW = {
  ...PENDING_ROW,
  id: 'inst-s',
  boss_id: 'the_sleepless_crown',
  boss_rank: 'S',
  status: 'active',
  goal_steps: 60000,
  goal_flights: 2520, // metric-generic second goal: SLEEP MINUTES (42h)
  reward_souls: 800,
  starts_at: '2026-07-15 00:00:00',
  ends_at: '2026-07-18 00:00:00',
};

describe('W686 — steps+sleep dual metric (The Sleepless Crown)', () => {
  it('GET surfaces sleep-named fields and aggregates all three streams', async () => {
    const log: string[] = [];
    const res = await handleCoopBossGet(
      createReq(),
      makeEnv(makeDb({ instance: { ...SLEEP_ACTIVE_ROW } }, log)),
      session('u1'), 'inst-s');
    const body = (await res.json()) as { instance: Record<string, unknown> };
    expect(res.status).toBe(200);
    const inst = body.instance;
    expect(inst.metric).toBe('steps_sleep');
    expect(inst.goal_sleep_minutes).toBe(2520);
    // u1 slept 410m + u2 slept 190m (mock verified_events rows) = 600 combined.
    expect(inst.combined_sleep_minutes).toBe(600);
    expect(inst.combined_steps).toBe(12000);
    expect((inst.challenger as Record<string, unknown>).sleep_minutes).toBe(410);
    expect((inst.partner as Record<string, unknown>).sleep_minutes).toBe(190);
    // The progress query must fetch THREE event types (steps, flights, sleep).
    const progressSql = log.find((s) => s.includes('FROM verified_events'));
    expect(progressSql).toBeTruthy();
    expect(progressSql).toContain('IN (?, ?, ?)');
  });

  it('create accepts the S-rank duo raid (no PARTY_SIZE/UNKNOWN_BOSS trip)', async () => {
    const res = await handleCoopBossCreate(
      new Request('http://test/v1/coop-boss', {
        method: 'POST',
        body: JSON.stringify({ partner_user_id: 'u2', boss_id: 'the_sleepless_crown' }),
      }),
      makeEnv(makeDb({ instance: { ...SLEEP_ACTIVE_ROW, status: 'pending', starts_at: null, ends_at: null } })),
      session('u1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { instance: Record<string, unknown> };
    expect(body.instance.metric).toBe('steps_sleep');
  });
});
