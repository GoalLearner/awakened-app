/**
 * public-achievement-events.test.ts — v3 Phase 1z.200.
 *
 * Covers POST validation matrix + UPSERT-style insert semantics,
 * plus GET friend-feed shape + privacy guarantees. Same hand-
 * rolled D1 mock pattern as the other handler tests.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  handlePublicAchievementEventsPost,
  handleFriendsActivityGet,
} from './public-achievement-events';
import type { Env } from '../env';

interface CapturedCall { sql: string; binds: unknown[] }

const okRl   = { limit: async () => ({ success: true  }) };
const denyRl = { limit: async () => ({ success: false }) };

interface MakeDbOptions {
  /** Per-prepare changes flag — duplicate events return changes=0,
   * fresh events return changes=1. Falls back to all-inserts. */
  perInsertChanges?: number[];
  /** Rows returned by the friend-feed SELECT. */
  feedRows?: Array<Record<string, unknown>>;
}

function makeDb(opts: MakeDbOptions = {}) {
  const calls: CapturedCall[] = [];
  let insertIdx = 0;
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, binds: args });
        const isInsert = /INSERT INTO public_achievement_events/.test(sql);
        const isFeed   = /FROM public_achievement_events/.test(sql) && !isInsert;
        return {
          all:   async () => ({
            results: isFeed ? (opts.feedRows ?? []) : [],
            success: true,
            meta: {},
          }),
          first: async () => null,
          run:   async () => {
            if (isInsert) {
              const changes = opts.perInsertChanges
                ? (opts.perInsertChanges[insertIdx] ?? 1)
                : 1;
              insertIdx++;
              return { success: true, meta: { changes } };
            }
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
    }),
    _calls: () => calls,
  } as unknown as D1Database & { _calls: () => CapturedCall[] };
  return db;
}

function makeEnv(db: D1Database, opts: { rlWrite?: typeof okRl; rlRead?: typeof okRl } = {}): Env {
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
    RL_PUBLIC_PROFILE_WRITE: okRl,
    RL_PUBLIC_EVENTS_WRITE: opts.rlWrite ?? okRl,
    RL_PUBLIC_EVENTS_READ:  opts.rlRead  ?? okRl,
  } as unknown as Env;
}

const session = { userId: 'user-abc', alias: 'Richie' };

function makeReq(body: unknown): Request {
  return new Request('https://example.com/v1/users/me/public-achievement-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const NOW_UTC = Date.UTC(2026, 4, 29, 17, 42, 0);
const NOW_ISO = new Date(NOW_UTC).toISOString();

const VALID_BOSS_KILL = {
  eventType:       'boss_kill',
  eventKey:        'glass_strider',
  eventLabel:      'defeated The Glass Strider',
  eventValue:      4,
  rarity:          'D',
  clientEventId:   'boss_kill:glass_strider:4',
  clientCreatedAt: NOW_ISO,
};

const VALID_RANK_UP = {
  eventType:       'rank_up',
  eventKey:        'D_II',
  eventLabel:      'reached D II',
  eventValue:      1_001_001_500,
  rarity:          null,
  clientEventId:   'rank_up:D_II',
  clientCreatedAt: NOW_ISO,
};

const VALID_STEP_BUCKET = {
  eventType:       'step_milestone_bucket',
  eventKey:        '10k',
  eventLabel:      'crossed 10,000 steps today',
  eventValue:      10000,
  rarity:          null,
  clientEventId:   'step_milestone_bucket:2026-05-29:10k',
  clientCreatedAt: NOW_ISO,
};

describe('POST /v1/users/me/public-achievement-events — validation (1z.200)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_UTC));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('rate-limits before touching DB', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [VALID_BOSS_KILL] }),
      makeEnv(db, { rlWrite: denyRl }),
      session,
    );
    expect(res.status).toBe(429);
    expect(db._calls().length).toBe(0);
  });

  it('rejects malformed JSON body', async () => {
    const db = makeDb();
    const req = new Request('https://example.com/v1/users/me/public-achievement-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await handlePublicAchievementEventsPost(req, makeEnv(db), session);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_BODY');
  });

  it('rejects missing events array', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(makeReq({}), makeEnv(db), session);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_BODY');
  });

  it('rejects empty batch', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(makeReq({ events: [] }), makeEnv(db), session);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_BATCH_SIZE');
  });

  it('rejects batch larger than 10', async () => {
    const db = makeDb();
    const events = Array.from({ length: 11 }, () => VALID_BOSS_KILL);
    const res = await handlePublicAchievementEventsPost(makeReq({ events }), makeEnv(db), session);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_BATCH_SIZE');
  });

  it('rejects ultra_rare_drop event type', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, eventType: 'ultra_rare_drop' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_TYPE');
  });

  it('rejects card_drop event type', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, eventType: 'card_drop' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_TYPE');
  });

  it('rejects sleep_quality_7h event type', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, eventType: 'sleep_quality_7h' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_TYPE');
  });

  it('rejects habit_streak event type', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, eventType: 'habit_streak' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_TYPE');
  });

  it('rejects friend_added event type', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, eventType: 'friend_added' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_TYPE');
  });

  it('rejects exact step label "crossed 15,319 steps today"', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{
        ...VALID_STEP_BUCKET,
        eventLabel: 'crossed 15,319 steps today',
        eventValue: 15319,
      }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects step bucket with non-allowlisted value', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_STEP_BUCKET, eventLabel: 'crossed 10,000 steps today', eventValue: 12345 }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
  });

  it('rejects boss_kill with free-text label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, eventLabel: 'definitely defeated something' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects boss_kill with invalid rarity', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, rarity: 'Z' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_RARITY');
  });

  it('rejects rank_up with rarity set', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_RANK_UP, rarity: 'D' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_RARITY');
  });

  it('rejects rank_up with bad label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_RANK_UP, eventLabel: 'reached SS+' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects clientCreatedAt older than 7 days', async () => {
    const db = makeDb();
    const oldIso = new Date(NOW_UTC - 8 * 24 * 60 * 60 * 1000).toISOString();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, clientCreatedAt: oldIso }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('EVENT_STALE');
  });

  it('rejects clientCreatedAt more than 5 minutes in future', async () => {
    const db = makeDb();
    const futureIso = new Date(NOW_UTC + 10 * 60 * 1000).toISOString();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, clientCreatedAt: futureIso }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('EVENT_FUTURE');
  });

  it('rejects bad clientEventId character set', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, clientEventId: 'has spaces!' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_CLIENT_EVENT_ID');
  });

  it('rejects bad eventKey character set', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, eventKey: 'has spaces' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_KEY');
  });

  it('ignores arbitrary client metadata (no metadata stored)', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_BOSS_KILL, metadata: { secret: 'leak' } }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const calls = db._calls();
    // SQL hardcodes metadata_json = NULL in the INSERT; no client
    // metadata is ever bound. The bind list has 10 positions; the
    // INSERT uses 10 ? placeholders for non-metadata fields.
    expect(calls[0]?.binds.length).toBe(10);
  });

  it('inserts a valid boss_kill and returns insertedCount=1', async () => {
    const db = makeDb({ perInsertChanges: [1] });
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [VALID_BOSS_KILL] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; insertedCount: number; duplicateCount: number };
    expect(json.ok).toBe(true);
    expect(json.insertedCount).toBe(1);
    expect(json.duplicateCount).toBe(0);
    const calls = db._calls();
    expect(calls[0]?.sql).toMatch(/INSERT INTO public_achievement_events/);
    expect(calls[0]?.sql).toMatch(/ON CONFLICT\(user_id, client_event_id\) DO NOTHING/);
    // Binds: id, user_id, type, key, label, value, rarity, cliId,
    // cliAt, serverAt.
    expect(calls[0]?.binds[1]).toBe('user-abc');
    expect(calls[0]?.binds[2]).toBe('boss_kill');
    expect(calls[0]?.binds[3]).toBe('glass_strider');
    expect(calls[0]?.binds[4]).toBe('defeated The Glass Strider');
    expect(calls[0]?.binds[5]).toBe(4);
    expect(calls[0]?.binds[6]).toBe('D');
    expect(calls[0]?.binds[7]).toBe('boss_kill:glass_strider:4');
    expect(calls[0]?.binds[8]).toBe(NOW_ISO);
    expect(calls[0]?.binds[9]).toBe(NOW_UTC);
  });

  it('inserts a valid rank_up', async () => {
    const db = makeDb({ perInsertChanges: [1] });
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [VALID_RANK_UP] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { insertedCount: number };
    expect(json.insertedCount).toBe(1);
  });

  it('inserts a valid step_milestone_bucket', async () => {
    const db = makeDb({ perInsertChanges: [1] });
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [VALID_STEP_BUCKET] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { insertedCount: number };
    expect(json.insertedCount).toBe(1);
  });

  it('duplicate insert returns duplicateCount=1, insertedCount=0', async () => {
    // Two events; the second is a duplicate (changes=0 on the
    // second insert).
    const db = makeDb({ perInsertChanges: [1, 0] });
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [VALID_BOSS_KILL, VALID_BOSS_KILL] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { insertedCount: number; duplicateCount: number };
    expect(json.insertedCount).toBe(1);
    expect(json.duplicateCount).toBe(1);
  });

  it('one invalid event in batch rejects the whole batch', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [VALID_BOSS_KILL, { ...VALID_BOSS_KILL, eventType: 'sleep_quality_7h' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_TYPE');
    // No inserts should have run.
    expect(db._calls().length).toBe(0);
  });
});

describe('GET /v1/friends/activity — feed read (1z.200)', () => {
  it('rate-limits before touching DB', async () => {
    const db = makeDb();
    const req = new Request('https://example.com/v1/friends/activity');
    const res = await handleFriendsActivityGet(req, makeEnv(db, { rlRead: denyRl }), session);
    expect(res.status).toBe(429);
    expect(db._calls().length).toBe(0);
  });

  it('rejects invalid limit', async () => {
    const db = makeDb();
    const req = new Request('https://example.com/v1/friends/activity?limit=999');
    const res = await handleFriendsActivityGet(req, makeEnv(db), session);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_LIMIT');
  });

  it('returns empty events array when no rows', async () => {
    const db = makeDb({ feedRows: [] });
    const req = new Request('https://example.com/v1/friends/activity');
    const res = await handleFriendsActivityGet(req, makeEnv(db), session);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; events: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.events).toEqual([]);
  });

  it('includes alias + rankLabel + safe fields and OMITS user_id/client_event_id/metadata/rank_points', async () => {
    const dbRow = {
      id:                'evt-xyz',
      user_id:           'rendiesel-uid',
      event_type:        'boss_kill',
      event_key:         'glass_strider',
      event_label:       'defeated The Glass Strider',
      event_value:       4,
      rarity:            'D',
      server_created_at: NOW_UTC,
      alias:             'rendiesel',
      rank_label:        'D II',
    };
    const db = makeDb({ feedRows: [dbRow] });
    const req = new Request('https://example.com/v1/friends/activity?limit=10');
    const res = await handleFriendsActivityGet(req, makeEnv(db), session);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      events: Array<Record<string, unknown>>;
    };
    expect(json.events.length).toBe(1);
    const ev = json.events[0]!;
    expect(ev.id).toBe('evt-xyz');
    expect(ev.alias).toBe('rendiesel');
    expect(ev.rankLabel).toBe('D II');
    expect(ev.eventType).toBe('boss_kill');
    expect(ev.eventLabel).toBe('defeated The Glass Strider');
    expect(ev.eventValue).toBe(4);
    expect(ev.rarity).toBe('D');
    expect(ev.createdAt).toBe(new Date(NOW_UTC).toISOString());
    // Hard privacy guarantees:
    expect(ev.user_id).toBeUndefined();
    expect(ev.userId).toBeUndefined();
    expect(ev.client_event_id).toBeUndefined();
    expect(ev.clientEventId).toBeUndefined();
    expect(ev.metadata_json).toBeUndefined();
    expect(ev.metadata).toBeUndefined();
    expect(ev.rank_points).toBeUndefined();
    expect(ev.rankPoints).toBeUndefined();
  });

  it('SQL filters to accepted friends + self and orders newest first', async () => {
    const db = makeDb({ feedRows: [] });
    const req = new Request('https://example.com/v1/friends/activity?limit=30');
    await handleFriendsActivityGet(req, makeEnv(db), session);
    const calls = db._calls();
    expect(calls[0]?.sql).toMatch(/FROM friends/);
    expect(calls[0]?.sql).toMatch(/status = 'accepted'/);
    expect(calls[0]?.sql).toMatch(/ORDER BY e\.server_created_at DESC/);
    expect(calls[0]?.sql).toMatch(/LIMIT \?/);
    // limit + 4 user-id binds = 5 positional binds total.
    expect(calls[0]?.binds.length).toBe(5);
    expect(calls[0]?.binds[4]).toBe(30);
  });

  it('exposes rankLabel as null when LEFT JOIN miss', async () => {
    const db = makeDb({ feedRows: [{
      id:                'evt-1',
      user_id:           'someone',
      event_type:        'rank_up',
      event_key:         'D_II',
      event_label:       'reached D II',
      event_value:       1_001_001_500,
      rarity:            null,
      server_created_at: NOW_UTC,
      alias:             'someone',
      rank_label:        null,
    }] });
    const req = new Request('https://example.com/v1/friends/activity');
    const res = await handleFriendsActivityGet(req, makeEnv(db), session);
    const json = await res.json() as { events: Array<{ rankLabel: unknown }> };
    expect(json.events[0]?.rankLabel).toBeNull();
  });
});
