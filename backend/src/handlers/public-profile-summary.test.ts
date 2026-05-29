/**
 * public-profile-summary.test.ts — handler-shape tests for
 * v3 Phase 1z.190 friend rank badges MVP.
 *
 * Covers the PUT /v1/users/me/public-profile-summary validation
 * matrix and the upsert bind shape. Follows the same conventions
 * as duels.test.ts: hand-rolled D1 mock, no real SQL engine.
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
    RL_DUELS_READ: okRl,
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
    expect(calls.length).toBe(1);
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
    // ON CONFLICT CASE WHEN sentinels (12, 14, 16, 18) — all 0
    // because no achievement fields were set.
    expect(calls[0]?.binds[12]).toBe(0);
    expect(calls[0]?.binds[14]).toBe(0);
    expect(calls[0]?.binds[16]).toBe(0);
    expect(calls[0]?.binds[18]).toBe(0);
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
    // Sentinels (12, 14, 16, 18) — all 1 since all fields set.
    expect(calls[0]?.binds[12]).toBe(1);
    expect(calls[0]?.binds[14]).toBe(1);
    expect(calls[0]?.binds[16]).toBe(1);
    expect(calls[0]?.binds[18]).toBe(1);
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
    // bossesSlainTotal set → sentinel 1, value 28
    expect(calls[0]?.binds[12]).toBe(1);
    expect(calls[0]?.binds[13]).toBe(28);
    // ultraRareDropsTotal NOT set → sentinel 0
    expect(calls[0]?.binds[14]).toBe(0);
    // verifiedStreakLabel NOT set → sentinel 0
    expect(calls[0]?.binds[16]).toBe(0);
    // achievements_updated_at: hasAny=true → sentinel 1 + stamped ts
    expect(calls[0]?.binds[18]).toBe(1);
    expect(calls[0]?.binds[19]).toBe(Date.UTC(2026, 4, 29, 12, 0, 0));
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
    // Every sentinel must be 0 → preserve every existing value.
    expect(calls[0]?.binds[12]).toBe(0);
    expect(calls[0]?.binds[14]).toBe(0);
    expect(calls[0]?.binds[16]).toBe(0);
    expect(calls[0]?.binds[18]).toBe(0);
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
    expect(calls[0]?.binds[16]).toBe(1);
    expect(calls[0]?.binds[17]).toBeNull();
    // Other counts NOT set → sentinel 0
    expect(calls[0]?.binds[12]).toBe(0);
    expect(calls[0]?.binds[14]).toBe(0);
    // hasAny=true → ach timestamp stamped
    expect(calls[0]?.binds[18]).toBe(1);
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
    expect(calls[0]?.binds[12]).toBe(1);
    expect(calls[0]?.binds[13]).toBe(0);
  });

  it('rank-only submit leaves CASE WHEN sentinels all zero (preserve existing achievement columns)', async () => {
    const db = makeDb();
    await handlePublicProfileSummaryPut(makeReq(validPayload), makeEnv(db), session);
    const calls = db._calls();
    expect(calls[0]?.binds[12]).toBe(0);
    expect(calls[0]?.binds[14]).toBe(0);
    expect(calls[0]?.binds[16]).toBe(0);
    expect(calls[0]?.binds[18]).toBe(0);
  });
});
