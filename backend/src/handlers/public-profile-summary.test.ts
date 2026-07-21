/**
 * public-profile-summary.test.ts — handler-shape tests for
 * v3 Phase 1z.190 friend rank badges MVP.
 *
 * Covers the PUT /v1/users/me/public-profile-summary validation
 * matrix and the upsert bind shape. Hand-rolled D1 mock, no real
 * SQL engine — same pattern used elsewhere in this suite.
 *
 *   - rejects invalid tier
 *   - rejects invalid division (or division mismatched with tier)
 *   - rejects invalid label (regex + cross-check vs tier/division)
 *   - rejects unsafe sort value / negative points / non-integer
 *   - rejects bad timestamp
 *   - upserts valid summary with server-derived timestamp
 *   - rate limit short-circuits before validation
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { handlePublicProfileSummaryPut } from './public-profile-summary';
import type { Env } from '../env';

interface CapturedCall { sql: string; binds: unknown[] }

const okRl  = { limit: async () => ({ success: true  }) };
const denyRl = { limit: async () => ({ success: false }) };

function makeDb() {
  const calls: CapturedCall[] = [];
  const db = {
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
  return db;
}

function makeEnv(db: D1Database, rl = okRl): Env {
  return {
    DB: db,
    JWT_SIGNING_KEY: 'unused',
    APPLE_BUNDLE_ID: 'com.goallearner.awakened',
    APPLE_TEAM_ID:   'LK8FVGBQPL',
    RL_AUTH_VERIFY: okRl,
    RL_LEADERBOARD_SUBMIT: okRl,
    RL_LEADERBOARD_TOP: okRl,
    RL_ACCOUNT_DELETE: okRl,
    RL_USER_STATE_GET: okRl,
    RL_USER_STATE_POST: okRl,
    RL_FRIENDS_READ: okRl,
    RL_FRIENDS_WRITE: okRl,
    RL_DUELS_WRITE: okRl,
    RL_USER_ACCOLADES_READ: okRl,
    RL_LEADERBOARD_HOF: okRl,
    RL_LEADERBOARD_STEP_100K_CLUB: okRl,
    RL_PUBLIC_PROFILE_WRITE: rl,
  } as unknown as Env;
}

const session = { userId: 'user-abc', alias: 'Richie' };

function makeReq(body: unknown): Request {
  return new Request('https://example.com/v1/users/me/public-profile-summary', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  rankTier:        'D',
  rankDivision:    'II',
  rankLabel:       'D II',
  rankSortValue:   1_001_001_500,
  rankPoints:      1500,
  clientUpdatedAt: '2026-05-29T00:00:00.000Z',
};

describe('PUT /v1/users/me/public-profile-summary — validation (1z.190)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 29, 12, 0, 0)));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('rate-limits before touching DB', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(makeReq(validPayload), makeEnv(db, denyRl), session);
    expect(res.status).toBe(429);
    expect(db._calls().length).toBe(0);
  });

  it('rejects malformed JSON body', async () => {
    const db = makeDb();
    const req = new Request('https://example.com/v1/users/me/public-profile-summary', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await handlePublicProfileSummaryPut(req, makeEnv(db), session);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_BODY');
  });

  it('rejects invalid tier', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, rankTier: 'Z', rankLabel: 'Z II' }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_TIER');
  });

  it('rejects non-null division when tier is S+', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, rankTier: 'S+', rankDivision: 'I', rankLabel: 'S+ I' }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_DIVISION');
  });

  it('rejects null division for non-S+ tier', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, rankDivision: null }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_DIVISION');
  });

  it('rejects label mismatched with tier/division', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, rankLabel: 'C I' }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_LABEL');
  });

  it('rejects bare label string that does not match regex', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, rankLabel: 'D Two' }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_LABEL');
  });

  it('rejects non-integer sort value', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, rankSortValue: 1_001_001_500.5 }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_SORT_VALUE');
  });

  it('rejects negative sort value', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, rankSortValue: -1 }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_SORT_VALUE');
  });

  it('rejects sort value above safe ceiling', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, rankSortValue: 7_000_000_000 }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_SORT_VALUE');
  });

  it('rejects negative rank points', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, rankPoints: -5 }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_POINTS');
  });

  it('rejects bad timestamp', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, clientUpdatedAt: 'not-a-date' }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_TIMESTAMP');
  });

  it('upserts a valid D II summary with the server-derived timestamp', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(makeReq(validPayload), makeEnv(db), session);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean;
      rankLabel: string;
      rankSortValue: number;
      rankUpdatedAt: string;
      achievementsUpdatedAt: string | null;
    };
    expect(json.ok).toBe(true);
    expect(json.rankLabel).toBe('D II');
    expect(json.rankSortValue).toBe(1_001_001_500);
    expect(json.rankUpdatedAt).toBe(new Date(Date.UTC(2026, 4, 29, 12, 0, 0)).toISOString());
    // v3 Phase 1z.195 — rank-only submit must NOT churn the
    // achievements timestamp; rank-only daily heartbeats stay
    // invisible to the friend-achievements surface.
    expect(json.achievementsUpdatedAt).toBeNull();

    const calls = db._calls();
    // W656 — the Founder-marker grant runs read-only follow-ups after the
    // upsert (founder_marks fast-path + eligibility probe); the profile
    // upsert itself must still be the FIRST and ONLY write.
    expect(calls.filter((c) => /INSERT INTO public_profile_summary/.test(c.sql)).length).toBe(1);
    expect(calls[0]?.sql).toMatch(/INSERT INTO public_profile_summary/);
    // INSERT binds 0-7: user_id, tier, division, label, sort,
    // points, clientUpdatedAt, serverUpdatedAt.
    expect(calls[0]?.binds[0]).toBe('user-abc');
    expect(calls[0]?.binds[1]).toBe('D');
    expect(calls[0]?.binds[2]).toBe('II');
    expect(calls[0]?.binds[3]).toBe('D II');
    expect(calls[0]?.binds[4]).toBe(1_001_001_500);
    expect(calls[0]?.binds[5]).toBe(1500);
    expect(calls[0]?.binds[6]).toBe('2026-05-29T00:00:00.000Z');
    expect(calls[0]?.binds[7]).toBe(Date.UTC(2026, 4, 29, 12, 0, 0));
    // v3 Phase 1z.195 — achievement INSERT binds (8-11) are all
    // null when no achievements are submitted, so the COALESCE on
    // the int columns falls back to DEFAULT 0 and the streak label
    // stores as NULL. achievements_updated_at stays NULL.
    expect(calls[0]?.binds[8]).toBeNull();
    expect(calls[0]?.binds[9]).toBeNull();
    expect(calls[0]?.binds[10]).toBeNull();
    expect(calls[0]?.binds[11]).toBeNull();
    // W453 — prestige INSERT bind (index 17); 0 for a non-S+ tier (coerced)
    // and for pre-W453 clients (omitted).
    expect(calls[0]?.binds[17]).toBe(0);
    // W706 — card_bg is now the LAST INSERT bind (index 18); null when unset.
    expect(calls[0]?.binds[18]).toBeNull();
    // ON CONFLICT CASE WHEN sentinels shifted +1 again by the W706 card_bg
    // INSERT bind (now 19, 21, 23, 25) — all 0 because no achievement fields
    // were set.
    expect(calls[0]?.binds[19]).toBe(0);
    expect(calls[0]?.binds[21]).toBe(0);
    expect(calls[0]?.binds[23]).toBe(0);
    expect(calls[0]?.binds[25]).toBe(0);
  });

  it('upserts a valid S+ summary with null division', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({
        rankTier:        'S+',
        rankDivision:    null,
        rankLabel:       'S+',
        rankSortValue:   6_003_000_000,
        rankPoints:      200_000,
        prestige:        13,   // W453 — Prestige ✦13
        clientUpdatedAt: '2026-05-29T00:00:00.000Z',
      }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { rankLabel: string };
    expect(json.rankLabel).toBe('S+');
    const calls = db._calls();
    expect(calls[0]?.binds[1]).toBe('S+');
    expect(calls[0]?.binds[2]).toBe(null);
    expect(calls[0]?.binds[3]).toBe('S+');
    expect(calls[0]?.binds[17]).toBe(13);   // W453 — prestige stored verbatim for S+
  });

  it('W453 — coerces prestige to 0 for a non-S+ tier even if the client sends one', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({
        rankTier:        'A',
        rankDivision:    'I',
        rankLabel:       'A I',
        rankSortValue:   4_002_500_000,
        rankPoints:      11_000,
        prestige:        7,   // bogus for an A-tier — must be coerced to 0
        clientUpdatedAt: '2026-05-29T00:00:00.000Z',
      }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    expect(db._calls()[0]?.binds[17]).toBe(0);
  });

  it('W453 — rejects an out-of-range prestige', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, prestige: 100_001 }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('INVALID_PRESTIGE');
    expect(db._calls().length).toBe(0);
  });
});

// v3 Phase 1z.195 — Global Friend Achievements MVP-A validation
// + write semantics. The achievements block is optional; missing
// achievements must preserve existing column values verbatim and
// must NOT churn achievements_updated_at.
describe('PUT /v1/users/me/public-profile-summary — achievements (1z.195)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 29, 12, 0, 0)));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('rejects non-object achievements field', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, achievements: 'not-an-object' }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_ACHIEVEMENTS');
  });

  it('rejects array achievements field', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, achievements: [1, 2, 3] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_ACHIEVEMENTS');
  });

  it('rejects bossesSlainTotal out of range', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, achievements: { bossesSlainTotal: 1_000_000 } }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_BOSSES_SLAIN_TOTAL');
  });

  it('rejects non-integer bossesSlainTotal', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, achievements: { bossesSlainTotal: 28.5 } }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_BOSSES_SLAIN_TOTAL');
  });

  it('rejects ultraRareDropsTotal out of range', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, achievements: { ultraRareDropsTotal: 10_000 } }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_ULTRA_RARE_DROPS_TOTAL');
  });

  it('rejects malformed verifiedStreakLabel', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, achievements: { verifiedStreakLabel: '30-day Quit-Smoking streak' } }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_VERIFIED_STREAK_LABEL');
  });

  it('rejects verifiedStreakLabel with disallowed type', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, achievements: { verifiedStreakLabel: '30-day sleep streak' } }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('INVALID_VERIFIED_STREAK_LABEL');
  });

  it('accepts all four streak types via regex (MR / LI / stat / habit)', async () => {
    const labels = ['7-day MR streak', '14-day LI streak', '30-day stat streak', '100-day habit streak'];
    for (const label of labels) {
      const db = makeDb();
      const res = await handlePublicProfileSummaryPut(
        makeReq({ ...validPayload, achievements: { verifiedStreakLabel: label } }),
        makeEnv(db),
        session,
      );
      expect(res.status).toBe(200);
    }
  });

  it('upserts a full achievement payload and stamps achievementsUpdatedAt', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({
        ...validPayload,
        achievements: {
          bossesSlainTotal:    28,
          ultraRareDropsTotal: 1,
          verifiedStreakLabel: '30-day MR streak',
        },
      }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as {
      rankLabel: string;
      achievementsUpdatedAt: string | null;
    };
    expect(json.rankLabel).toBe('D II');
    expect(json.achievementsUpdatedAt).toBe(
      new Date(Date.UTC(2026, 4, 29, 12, 0, 0)).toISOString(),
    );

    const calls = db._calls();
    expect(calls[0]?.sql).toMatch(/INSERT INTO public_profile_summary/);
    // INSERT binds 8-11: bosses, drops, streak label, ach ts.
    expect(calls[0]?.binds[8]).toBe(28);
    expect(calls[0]?.binds[9]).toBe(1);
    expect(calls[0]?.binds[10]).toBe('30-day MR streak');
    expect(calls[0]?.binds[11]).toBe(Date.UTC(2026, 4, 29, 12, 0, 0));
    // Sentinels shifted +2 by the appended prestige + W706 card_bg binds
    // (now 19, 21, 23, 25) — all 1 since all fields set.
    expect(calls[0]?.binds[19]).toBe(1);
    expect(calls[0]?.binds[21]).toBe(1);
    expect(calls[0]?.binds[23]).toBe(1);
    expect(calls[0]?.binds[25]).toBe(1);
  });

  it('partial achievement payload only marks present fields for update', async () => {
    const db = makeDb();
    await handlePublicProfileSummaryPut(
      makeReq({
        ...validPayload,
        achievements: { bossesSlainTotal: 28 },
      }),
      makeEnv(db),
      session,
    );
    const calls = db._calls();
    // bossesSlainTotal set → sentinel 1, value 28 (all +2 from the prestige
    // + W706 card_bg binds)
    expect(calls[0]?.binds[19]).toBe(1);
    expect(calls[0]?.binds[20]).toBe(28);
    // ultraRareDropsTotal NOT set → sentinel 0
    expect(calls[0]?.binds[21]).toBe(0);
    // verifiedStreakLabel NOT set → sentinel 0
    expect(calls[0]?.binds[23]).toBe(0);
    // achievements_updated_at: hasAny=true → sentinel 1 + stamped ts
    expect(calls[0]?.binds[25]).toBe(1);
    expect(calls[0]?.binds[26]).toBe(Date.UTC(2026, 4, 29, 12, 0, 0));
  });

  it('empty achievements object is treated as a no-op for the achievement surface', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, achievements: {} }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { achievementsUpdatedAt: string | null };
    expect(json.achievementsUpdatedAt).toBeNull();

    const calls = db._calls();
    // Every sentinel (shifted +2 by prestige + W706 card_bg → 19, 21, 23, 25)
    // must be 0.
    expect(calls[0]?.binds[19]).toBe(0);
    expect(calls[0]?.binds[21]).toBe(0);
    expect(calls[0]?.binds[23]).toBe(0);
    expect(calls[0]?.binds[25]).toBe(0);
  });

  it('explicit null verifiedStreakLabel marks the field for clear', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({
        ...validPayload,
        achievements: { verifiedStreakLabel: null },
      }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const calls = db._calls();
    // verifiedStreakLabel set (explicit null) → sentinel 1 + null value
    // (+2 shift: prestige + W706 card_bg)
    expect(calls[0]?.binds[23]).toBe(1);
    expect(calls[0]?.binds[24]).toBeNull();
    // Other counts NOT set → sentinel 0
    expect(calls[0]?.binds[19]).toBe(0);
    expect(calls[0]?.binds[21]).toBe(0);
    // hasAny=true → ach timestamp stamped
    expect(calls[0]?.binds[25]).toBe(1);
  });

  it('accepts zero bossesSlainTotal as a real submitted value (not a clear)', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({
        ...validPayload,
        achievements: { bossesSlainTotal: 0 },
      }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const calls = db._calls();
    expect(calls[0]?.binds[19]).toBe(1);
    expect(calls[0]?.binds[20]).toBe(0);
  });

  it('rank-only submit leaves CASE WHEN sentinels all zero (preserve existing achievement columns)', async () => {
    const db = makeDb();
    await handlePublicProfileSummaryPut(makeReq(validPayload), makeEnv(db), session);
    const calls = db._calls();
    expect(calls[0]?.binds[19]).toBe(0);
    expect(calls[0]?.binds[21]).toBe(0);
    expect(calls[0]?.binds[23]).toBe(0);
    expect(calls[0]?.binds[25]).toBe(0);
  });
});


describe('PUT /v1/users/me/public-profile-summary — arena title (W257)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 11, 12, 0, 0)));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('accepts a W266 rating-ladder id (rt_grandmaster) through the same whitelist', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, arenaTitle: 'rt_grandmaster' }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => { sql: string; binds: unknown[] }[] })._calls();
    expect(calls[0].binds[12]).toBe('rt_grandmaster');
  });

  it('accepts a whitelisted arena title id and binds it (insert + sentinel)', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, arenaTitle: 'asc_brawler' }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => { sql: string; binds: unknown[] }[] })._calls();
    // W656 — Founder-marker follow-up reads run after the upsert; the
    // profile INSERT is still calls[0] and the only profile write.
    expect(calls.filter((c) => /INSERT INTO public_profile_summary/.test(c.sql)).length).toBe(1);
    expect(calls[0].sql).toContain('arena_title');
    expect(calls[0].binds[12]).toBe('asc_brawler');   // INSERT value
    expect(calls[0].binds[27]).toBe(1);               // titleSet sentinel (+2: prestige + card_bg)
    expect(calls[0].binds[28]).toBe('asc_brawler');   // CASE WHEN value
  });

  it('accepts null as a deliberate "unequipped" clear', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, arenaTitle: null }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => { sql: string; binds: unknown[] }[] })._calls();
    expect(calls[0].binds[12]).toBe(null);
    expect(calls[0].binds[27]).toBe(1);               // set → clears the column (+2: prestige + card_bg)
    expect(calls[0].binds[28]).toBe(null);
  });

  it('preserves the existing title when the key is omitted (sentinel 0)', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq(validPayload), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => { sql: string; binds: unknown[] }[] })._calls();
    expect(calls[0].binds[27]).toBe(0);               // not set → CASE preserves (+2: prestige + card_bg)
  });

  it('rejects a non-whitelisted title id', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, arenaTitle: 'asc_totally_fake' }), makeEnv(db), session);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_ARENA_TITLE');
    expect((db as unknown as { _calls: () => unknown[] })._calls().length).toBe(0);
  });

  it('rejects a non-string, non-null title', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, arenaTitle: 42 }), makeEnv(db), session);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_ARENA_TITLE');
  });
});

// W440 — combatant loadout snapshot for "Duel a Friend's Echo". The PUT validates it to the
// sanitizeCombatant shape (6 stats clamped [0,200], weapon/name/avatar bounded) and stores it as
// an opaque JSON string in combatant_json. INSERT value = bind[16]; ON CONFLICT set/value = 35/36
// (after the W453 prestige + W706 card_bg INSERT binds).
describe('PUT /v1/users/me/public-profile-summary — combatant / Echo (W440)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 20, 12, 0, 0)));
  });
  afterEach(() => { vi.useRealTimers(); });

  const goodCombatant = {
    name: 'Richie', weaponId: 'aetherspire_staff', weaponName: 'Aetherspire Staff',
    avatar: 'avatar-sage.png', stats: { STR: 40, VIT: 55, INT: 120, FOCUS: 70, WILL: 60, WLT: 30 },
  };

  it('rejects a non-object, non-null combatant', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, combatant: 'not-an-object' }), makeEnv(db), session);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_COMBATANT');
    expect((db as unknown as { _calls: () => unknown[] })._calls().length).toBe(0);
  });

  it('omitting combatant preserves the existing snapshot (sentinel 0)', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(makeReq(validPayload), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => { binds: unknown[] }[] })._calls();
    expect(calls[0].binds[16]).toBeNull();   // INSERT value null when unset
    expect(calls[0].binds[35]).toBe(0);      // combatantSet sentinel → CASE preserves (+2: prestige + card_bg)
  });

  it('null combatant is a deliberate clear (sentinel 1, value null)', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, combatant: null }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => { binds: unknown[] }[] })._calls();
    expect(calls[0].binds[16]).toBeNull();
    expect(calls[0].binds[35]).toBe(1);
    expect(calls[0].binds[36]).toBeNull();
  });

  it('accepts a valid combatant and stores a sanitized JSON snapshot', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, combatant: goodCombatant }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => { binds: unknown[] }[] })._calls();
    expect(calls[0].binds[35]).toBe(1);                      // set (+2: prestige + card_bg)
    const stored = JSON.parse(String(calls[0].binds[16]));   // INSERT value
    expect(stored).toEqual(JSON.parse(String(calls[0].binds[36])));   // INSERT == CASE value
    expect(stored.weaponId).toBe('aetherspire_staff');
    expect(stored.stats).toEqual({ STR: 40, VIT: 55, INT: 120, FOCUS: 70, WILL: 60, WLT: 30 });
    expect(stored.avatar).toBe('avatar-sage.png');
  });

  it('clamps over-max stats, floors negatives, and drops an unsafe avatar', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, combatant: {
        name: 'X'.repeat(80), weaponId: 'w', weaponName: 'W',
        avatar: '../../etc/passwd', stats: { STR: 9999, VIT: -10, INT: 50, FOCUS: 'x', WILL: 60, WLT: 30 },
      } }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: () => { binds: unknown[] }[] })._calls();
    const stored = JSON.parse(String(calls[0].binds[16]));
    expect(stored.stats.STR).toBe(200);    // clamped to MAX
    expect(stored.stats.VIT).toBe(0);      // negative floored
    expect(stored.stats.FOCUS).toBe(0);    // non-numeric → 0
    expect(stored.avatar).toBe('');        // path-traversal avatar rejected
    expect(stored.name.length).toBe(40);   // name bounded
  });
});

// W706 — member card backgrounds. cardBg is validated against the server-side
// CARD_BG_IDS whitelist (unknown id → 400 INVALID_CARD_BG) and MEMBERSHIP-gated
// at write time: a non-member's non-null cardBg is coerced to a clear (still a
// 200 — the rank heartbeat must survive a lapsed subscription / stale client).
// Membership = premium OR Founder via readEntitlements, which probes
// skin_entitlements (.all) + premium_subscriptions (.first) + founder_marks
// (.first) BEFORE the upsert. Layout after W706: cardBg INSERT value = bind[18]
// (the new LAST INSERT bind); ON CONFLICT set/value = 37/38.
describe('PUT /v1/users/me/public-profile-summary — card background (W706)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 17, 12, 0, 0)));
  });
  afterEach(() => { vi.useRealTimers(); });

  // Like makeDb(), but founder_marks lookups resolve to the given row so
  // readEntitlements derives member = premium OR founder. { seq: 2 } →
  // lifetime member; premium_subscriptions still returns no row.
  function makeFounderDb(founderRow: { seq: number } | null) {
    const calls: CapturedCall[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          calls.push({ sql, binds: args });
          return {
            all:   async () => ({ results: [], success: true, meta: {} }),
            first: async () => (/FROM founder_marks/.test(sql) ? founderRow : null),
            run:   async () => ({ success: true, meta: { changes: 1 } }),
          };
        },
      }),
      _calls: () => calls,
    } as unknown as D1Database & { _calls: () => CapturedCall[] };
    return db;
  }

  // The entitlements probes run BEFORE the upsert for a non-null cardBg, so the
  // profile INSERT is no longer guaranteed to be calls[0] — locate it by SQL.
  const upsertOf = (calls: CapturedCall[]) =>
    calls.find((c) => /INSERT INTO public_profile_summary/.test(c.sql));

  it('member equips bg-founder → stored verbatim (insert + sentinel + value)', async () => {
    const db = makeFounderDb({ seq: 2 });   // Founder mark → member = true
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, cardBg: 'bg-founder' }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = db._calls();
    // The membership check ran (readEntitlements' premium probe fired).
    expect(calls.some((c) => /premium_subscriptions/.test(c.sql))).toBe(true);
    const upsert = upsertOf(calls);
    expect(upsert).toBeDefined();
    expect(upsert?.binds.length).toBe(39);        // 19 INSERT + 10 CASE pairs
    expect(upsert?.binds[18]).toBe('bg-founder'); // INSERT value (last INSERT bind)
    expect(upsert?.binds[37]).toBe(1);            // cardBgSet sentinel
    expect(upsert?.binds[38]).toBe('bg-founder'); // CASE WHEN value
  });

  it('non-member equipping bg-100k is coerced to a clear — 200, never a 4xx', async () => {
    const db = makeDb();   // no founder_marks row, no premium row → member = false
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, cardBg: 'bg-100k' }), makeEnv(db), session);
    expect(res.status).toBe(200);           // heartbeat survives a lapsed membership
    const upsert = upsertOf(db._calls());
    expect(upsert).toBeDefined();
    expect(upsert?.binds[18]).toBeNull();   // INSERT value coerced to the clear
    expect(upsert?.binds[37]).toBe(1);      // still set → clears the column
    expect(upsert?.binds[38]).toBeNull();   // CASE WHEN value coerced
  });

  it('null cardBg clears without an entitlements check', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, cardBg: null }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = db._calls();
    const upsert = upsertOf(calls);
    expect(upsert?.binds[18]).toBeNull();
    expect(upsert?.binds[37]).toBe(1);      // set → deliberate clear
    expect(upsert?.binds[38]).toBeNull();
    // readEntitlements must NOT have run for a null cardBg: none of its probes
    // (skin_entitlements / premium_subscriptions) appear anywhere, and the
    // upsert is the FIRST DB call. The single founder_marks SELECT that remains
    // is the W656 maybeGrantFounderMark fast-path AFTER the upsert — not an
    // entitlements read (readEntitlements would have added a second one, plus
    // the skin/premium probes, all BEFORE the upsert).
    expect(calls.some((c) => /skin_entitlements|premium_subscriptions/.test(c.sql))).toBe(false);
    expect(calls[0]?.sql).toMatch(/INSERT INTO public_profile_summary/);
    expect(calls.filter((c) => /FROM founder_marks/.test(c.sql)).length).toBe(1);
  });

  it('rejects an unknown background id with 400 INVALID_CARD_BG', async () => {
    const db = makeDb();
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, cardBg: 'bg-hax' }), makeEnv(db), session);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_CARD_BG');
    expect(db._calls().length).toBe(0);
  });
});

// W739 SECURITY — a PREMIUM skin (avatar-skin-*) shown on the PUBLIC card must be OWNED
// (skin_entitlements). A non-owner's paid-skin flex is coerced away at write time.
describe('PUT /v1/users/me/public-profile-summary — premium-skin ownership (W739)', () => {
  function makeSkinDb(ownedSkins: string[]) {
    const calls: CapturedCall[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          calls.push({ sql, binds: args });
          return {
            all: async () => ({
              results: /skin_entitlements/.test(sql) ? ownedSkins.map((s) => ({ skin_id: s })) : [],
              success: true, meta: {},
            }),
            first: async () => null,
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
        },
      }),
      _calls: () => calls,
    } as unknown as D1Database & { _calls: () => CapturedCall[] };
    return db;
  }
  const upsertOf = (calls: CapturedCall[]) =>
    calls.find((c) => /INSERT INTO public_profile_summary/.test(c.sql));

  it('unowned premium skin avatar_id is stripped', async () => {
    const db = makeSkinDb([]);
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, cardBg: null, avatarId: 'avatar-skin-bloodmoon.png' }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = db._calls();
    expect(calls.some((c) => /skin_entitlements/.test(c.sql))).toBe(true);
    expect(upsertOf(calls)?.binds.includes('avatar-skin-bloodmoon.png')).toBe(false);
  });

  it('owned premium skin avatar_id is kept verbatim', async () => {
    const db = makeSkinDb(['avatar-skin-bloodmoon.png']);
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, cardBg: null, avatarId: 'avatar-skin-bloodmoon.png' }), makeEnv(db), session);
    expect(res.status).toBe(200);
    expect(upsertOf(db._calls())?.binds.includes('avatar-skin-bloodmoon.png')).toBe(true);
  });

  it('a free class avatar is kept with no ownership probe', async () => {
    const db = makeSkinDb([]);
    const res = await handlePublicProfileSummaryPut(
      makeReq({ ...validPayload, cardBg: null, avatarId: 'avatar-mage.png' }), makeEnv(db), session);
    expect(res.status).toBe(200);
    const calls = db._calls();
    expect(calls.some((c) => /skin_entitlements/.test(c.sql))).toBe(false);
    expect(upsertOf(calls)?.binds.includes('avatar-mage.png')).toBe(true);
  });
});
