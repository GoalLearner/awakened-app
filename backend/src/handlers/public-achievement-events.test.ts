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

// v3 Phase 1z.223A — fixed canonical ultra-rare drop payload.
// Every field except clientEventId/clientCreatedAt is hard-pinned.
// Note: clientEventId intentionally does NOT contain a card slug
// or card name. The real client builds it from a sanitized hash
// or timestamp, never the item identity, so a card_id slug never
// reaches the backend even via the idempotency key.
const VALID_ULTRA_RARE_DROP = {
  eventType:       'ultra_rare_drop',
  eventKey:        'ultra_rare',
  eventLabel:      'looted an ultra-rare item',
  eventValue:      null,
  rarity:          null,
  clientEventId:   'ultra_rare:2026-05-31T19-28-00:n1',
  clientCreatedAt: NOW_ISO,
};

// v3 Phase 1z.226A — fixed canonical rare-tier drop payload.
const VALID_RARE_ITEM_DROP = {
  eventType:       'rare_item_drop',
  eventKey:        'rare',
  eventLabel:      'found a rare item',
  eventValue:      null,
  rarity:          null,
  clientEventId:   'rare:2026-05-31T19-30-00:n1',
  clientCreatedAt: NOW_ISO,
};

// v3 Phase 1z.226A — 100K Step Club accolade unlock payload.
const VALID_STEP_100K_CLUB = {
  eventType:       'step_100k_club_unlocked',
  eventKey:        'step_100k_club',
  eventLabel:      'joined the 100K Step Club',
  eventValue:      100000,
  rarity:          null,
  clientEventId:   'step_100k_club:2026-W22',
  clientCreatedAt: NOW_ISO,
};

// v3 Phase 1z.226A — verified streak 30-day band payload.
const VALID_VERIFIED_STREAK_30 = {
  eventType:       'verified_streak',
  eventKey:        'verified_streak:30',
  eventLabel:      'reached a 30-day verified streak',
  eventValue:      30,
  rarity:          null,
  clientEventId:   'verified_streak:30:2026-05-31',
  clientCreatedAt: NOW_ISO,
};

// v3 Phase 1z.256 — canonical verified workout payload. Label is
// the single fixed string, key is date-scoped. Carries no
// HealthKit detail (no type, no duration, no calories, no HR).
const VALID_VERIFIED_WORKOUT = {
  eventType:       'verified_workout',
  eventKey:        'verified_workout:2026-05-31',
  eventLabel:      'completed a verified workout',
  eventValue:      null,
  rarity:          null,
  clientEventId:   'verified_workout:2026-05-31',
  clientCreatedAt: NOW_ISO,
};

// v3 Phase 1z.256 — canonical verified sleep ≥ 7h payload. Label
// uses the threshold word ("over 7 hours"); the value is null so
// exact sleep duration cannot ride along.
const VALID_VERIFIED_SLEEP_7H = {
  eventType:       'verified_sleep_7h',
  eventKey:        'verified_sleep_7h:2026-05-31',
  eventLabel:      'slept over 7 hours last night',
  eventValue:      null,
  rarity:          null,
  clientEventId:   'verified_sleep_7h:2026-05-31',
  clientCreatedAt: NOW_ISO,
};

// v3 Phase 1z.256 — canonical bucketed flights milestone payload
// for the 10-flight bucket. Label, key, and value all carry the
// bucket; the validator cross-checks that the trio agrees.
function makeFlightsBucketPayload(bucket: 10 | 25 | 50 | 100) {
  return {
    eventType:       'flights_milestone_bucket',
    eventKey:        `flights_milestone_bucket:2026-05-31:${bucket}`,
    eventLabel:      `climbed ${bucket} flights today`,
    eventValue:      bucket,
    rarity:          null,
    clientEventId:   `flights_milestone_bucket:2026-05-31:${bucket}`,
    clientCreatedAt: NOW_ISO,
  };
}
const VALID_FLIGHTS_BUCKET_10 = makeFlightsBucketPayload(10);

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

  // v3 Phase 1z.223A — ultra_rare_drop is now an ALLOWED type but
  // with the strictest validation in the handler. Label, key,
  // value, and rarity are all hard-pinned; only clientEventId and
  // clientCreatedAt are free-form. The point of this event class
  // is to surface "something rare happened" to the friend feed
  // WITHOUT leaking item identity, pity counter state, or build
  // direction. The card/item name MUST stay client-side only.
  it('accepts a valid canonical ultra_rare_drop', async () => {
    const db = makeDb({ perInsertChanges: [1] });
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [VALID_ULTRA_RARE_DROP] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; insertedCount: number };
    expect(json.ok).toBe(true);
    expect(json.insertedCount).toBe(1);
    const calls = db._calls();
    expect(calls[0]?.sql).toMatch(/INSERT INTO public_achievement_events/);
    // Bind position 4 = eventLabel; must be the exact canonical
    // privacy-safe string. No card/item name leaked.
    expect(calls[0]?.binds[4]).toBe('looted an ultra-rare item');
    // Bind position 3 = eventKey; must be the fixed allowlist
    // value, not a card_id or item slug.
    expect(calls[0]?.binds[3]).toBe('ultra_rare');
    // Bind position 5 = eventValue; null for this event type.
    expect(calls[0]?.binds[5]).toBeNull();
    // Bind position 6 = rarity; null for this event type so the
    // existing boss-rank semantic on `rarity` stays clean.
    expect(calls[0]?.binds[6]).toBeNull();
  });

  it('rejects ultra_rare_drop with an exact card/item name in the label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_ULTRA_RARE_DROP, eventLabel: 'looted Crown of Deep Rest' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects ultra_rare_drop with a misspelled / unhyphenated label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_ULTRA_RARE_DROP, eventLabel: 'looted an ultra rare item' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects ultra_rare_drop with a capitalized label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_ULTRA_RARE_DROP, eventLabel: 'Looted an ultra-rare item' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects ultra_rare_drop with trailing whitespace in the label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_ULTRA_RARE_DROP, eventLabel: 'looted an ultra-rare item ' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects ultra_rare_drop with a card_id in eventKey', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_ULTRA_RARE_DROP, eventKey: 'crown_of_deep_rest' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_KEY');
  });

  it('rejects ultra_rare_drop with a non-null eventValue', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_ULTRA_RARE_DROP, eventValue: 1 }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
  });

  it('rejects ultra_rare_drop with a non-null rarity', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_ULTRA_RARE_DROP, rarity: 'S+' }] }),
      makeEnv(db),
      session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_RARITY');
  });

  it('does not bind metadata_json or card/item identity for ultra_rare_drop', async () => {
    const db = makeDb({ perInsertChanges: [1] });
    await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_ULTRA_RARE_DROP, cardId: 'crown_of_deep_rest', cardName: 'Crown of Deep Rest', metadata: { secret: 'leak' } }] }),
      makeEnv(db),
      session,
    );
    const calls = db._calls();
    const insert = calls[0]!;
    // 10 fixed binds — no slot ever holds card_id / card_name /
    // arbitrary client metadata.
    expect(insert.binds.length).toBe(10);
    const joined = insert.binds.map(b => String(b)).join('|');
    expect(joined).not.toContain('crown_of_deep_rest');
    expect(joined).not.toContain('Crown of Deep Rest');
    expect(joined).not.toContain('leak');
    expect(joined).not.toContain('secret');
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

  // ── v3 Phase 1z.226A — three new generic public event types ──
  //
  // Each new type follows the same hard-pinned validation posture
  // as ultra_rare_drop (1z.223A): label / key / value are fixed
  // canonical strings/integers; the client can only vary
  // clientEventId and clientCreatedAt. Item names, card identity,
  // habit names, and habit categories are all rejected. Existing
  // private types stay rejected.

  // — rare_item_drop —
  it('accepts a valid canonical rare_item_drop', async () => {
    const db = makeDb({ perInsertChanges: [1] });
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [VALID_RARE_ITEM_DROP] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(200);
    const calls = db._calls();
    expect(calls[0]?.binds[3]).toBe('rare');
    expect(calls[0]?.binds[4]).toBe('found a rare item');
    expect(calls[0]?.binds[5]).toBeNull();
    expect(calls[0]?.binds[6]).toBeNull();
  });

  it('rejects rare_item_drop with an exact item name in the label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_RARE_ITEM_DROP, eventLabel: 'found Dream-Woven Hood' }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects rare_item_drop with a "found a common item" label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_RARE_ITEM_DROP, eventLabel: 'found a common item' }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects rare_item_drop with a card-slug eventKey', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_RARE_ITEM_DROP, eventKey: 'dream_woven_hood' }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_KEY');
  });

  it('rejects rare_item_drop with non-null eventValue', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_RARE_ITEM_DROP, eventValue: 1 }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
  });

  it('rejects rare_item_drop with non-null rarity', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_RARE_ITEM_DROP, rarity: 'rare' }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_RARITY');
  });

  it('still rejects the local-only card_drop type (rare_item_drop is the only public drop variant for non-ultra)', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_RARE_ITEM_DROP, eventType: 'card_drop' }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_TYPE');
  });

  // — step_100k_club_unlocked —
  it('accepts a valid canonical step_100k_club_unlocked', async () => {
    const db = makeDb({ perInsertChanges: [1] });
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [VALID_STEP_100K_CLUB] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(200);
    const calls = db._calls();
    expect(calls[0]?.binds[3]).toBe('step_100k_club');
    expect(calls[0]?.binds[4]).toBe('joined the 100K Step Club');
    expect(calls[0]?.binds[5]).toBe(100000);
    expect(calls[0]?.binds[6]).toBeNull();
  });

  it('rejects step_100k_club_unlocked with a 50K Step Club label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_STEP_100K_CLUB, eventLabel: 'joined the 50K Step Club' }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects step_100k_club_unlocked with a step-milestone-style label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_STEP_100K_CLUB, eventLabel: 'crossed 100,000 steps today' }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects step_100k_club_unlocked with a different eventKey', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_STEP_100K_CLUB, eventKey: 'club' }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_KEY');
  });

  it('rejects step_100k_club_unlocked with eventValue != 100000', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_STEP_100K_CLUB, eventValue: 50000 }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
  });

  it('rejects step_100k_club_unlocked with non-null rarity', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{ ...VALID_STEP_100K_CLUB, rarity: 'S+' }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_RARITY');
  });

  // — verified_streak —
  for (const band of [7, 14, 30, 100, 365]) {
    it(`accepts verified_streak band ${band}`, async () => {
      const db = makeDb({ perInsertChanges: [1] });
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{
          eventType:       'verified_streak',
          eventKey:        'verified_streak:' + band,
          eventLabel:      `reached a ${band}-day verified streak`,
          eventValue:      band,
          rarity:          null,
          clientEventId:   'verified_streak:' + band + ':2026-05-31',
          clientCreatedAt: NOW_ISO,
        }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(200);
      const calls = db._calls();
      expect(calls[0]?.binds[3]).toBe('verified_streak:' + band);
      expect(calls[0]?.binds[4]).toBe(`reached a ${band}-day verified streak`);
      expect(calls[0]?.binds[5]).toBe(band);
      expect(calls[0]?.binds[6]).toBeNull();
    });
  }

  it('rejects verified_streak with non-allowed band 5', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{
        ...VALID_VERIFIED_STREAK_30,
        eventKey:   'verified_streak:5',
        eventLabel: 'reached a 5-day verified streak',
        eventValue: 5,
      }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
  });

  it('rejects verified_streak with non-allowed band 21', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{
        ...VALID_VERIFIED_STREAK_30,
        eventKey:   'verified_streak:21',
        eventLabel: 'reached a 21-day verified streak',
        eventValue: 21,
      }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
  });

  it('rejects verified_streak with a habit name in the label', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{
        ...VALID_VERIFIED_STREAK_30,
        eventLabel: 'reached a 30-day Meditation streak',
      }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects verified_streak with label/value band mismatch (label 30, value 7)', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{
        ...VALID_VERIFIED_STREAK_30,
        eventValue: 7,
        eventKey:   'verified_streak:7',
      }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });

  it('rejects verified_streak with key/value band mismatch (value 30, key :7)', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{
        ...VALID_VERIFIED_STREAK_30,
        eventKey: 'verified_streak:7',
      }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_KEY');
  });

  it('rejects verified_streak with non-null rarity', async () => {
    const db = makeDb();
    const res = await handlePublicAchievementEventsPost(
      makeReq({ events: [{
        ...VALID_VERIFIED_STREAK_30,
        rarity: 'S',
      }] }),
      makeEnv(db), session,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_RARITY');
  });

  // — Privacy: no smuggling across all three new types —
  it('rare_item_drop: smuggle attempt (cardId/cardName/metadata) never binds those values', async () => {
    const db = makeDb({ perInsertChanges: [1] });
    await handlePublicAchievementEventsPost(
      makeReq({ events: [{
        ...VALID_RARE_ITEM_DROP,
        cardId:   'dream_woven_hood',
        cardName: 'Dream-Woven Hood',
        metadata: { secret: 'leak' },
      }] }),
      makeEnv(db), session,
    );
    const calls = db._calls();
    const joined = calls[0]!.binds.map(b => String(b)).join('|');
    expect(joined).not.toContain('dream_woven_hood');
    expect(joined).not.toContain('Dream-Woven Hood');
    expect(joined).not.toContain('leak');
    expect(joined).not.toContain('secret');
  });

  it('verified_streak: smuggle attempt (habitName/habitCategory/metadata) never binds those values', async () => {
    const db = makeDb({ perInsertChanges: [1] });
    await handlePublicAchievementEventsPost(
      makeReq({ events: [{
        ...VALID_VERIFIED_STREAK_30,
        habitName:     'Quit smoking',
        habitCategory: 'meditation',
        metadata:      { secret: 'leak' },
      }] }),
      makeEnv(db), session,
    );
    const calls = db._calls();
    const joined = calls[0]!.binds.map(b => String(b)).join('|');
    expect(joined).not.toContain('Quit smoking');
    expect(joined).not.toContain('meditation');
    expect(joined).not.toContain('leak');
    expect(joined).not.toContain('secret');
  });

  // — Existing private types remain rejected after the 1z.226A allowlist expansion —
  for (const banned of ['card_drop', 'sleep_quality_7h', 'habit_streak', 'friend_added', 'workout', 'workout_streak']) {
    it(`still rejects ${banned}`, async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_BOSS_KILL, eventType: banned }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_TYPE');
    });
  }

  // ────────────────────────────────────────────────────────────
  // v3 Phase 1z.256 — verified_workout
  // ────────────────────────────────────────────────────────────
  describe('verified_workout (1z.256)', () => {
    it('accepts a valid verified_workout', async () => {
      const db = makeDb({ perInsertChanges: [1] });
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [VALID_VERIFIED_WORKOUT] }), makeEnv(db), session,
      );
      expect(res.status).toBe(200);
      const calls = db._calls();
      expect(calls[0]?.binds[2]).toBe('verified_workout');
      expect(calls[0]?.binds[3]).toBe('verified_workout:2026-05-31');
      expect(calls[0]?.binds[4]).toBe('completed a verified workout');
      expect(calls[0]?.binds[5]).toBeNull();   // eventValue
      expect(calls[0]?.binds[6]).toBeNull();   // rarity
    });

    it('rejects verified_workout with wrong label', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_VERIFIED_WORKOUT, eventLabel: 'completed a workout' }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
    });

    it('rejects verified_workout with wrong key shape (no date)', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_VERIFIED_WORKOUT, eventKey: 'verified_workout' }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_KEY');
    });

    it('rejects verified_workout with malformed date in key', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_VERIFIED_WORKOUT, eventKey: 'verified_workout:2026-5-31' }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_KEY');
    });

    it('rejects verified_workout with non-null eventValue', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_VERIFIED_WORKOUT, eventValue: 30 }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
    });

    it('rejects verified_workout with non-null rarity', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_VERIFIED_WORKOUT, rarity: 'rare' }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_RARITY');
    });

    it('silently drops HealthKit smuggling fields on workout (workoutType, calories, heartRate, distance, pace, location, duration)', async () => {
      const db = makeDb({ perInsertChanges: [1] });
      const smuggled = {
        ...VALID_VERIFIED_WORKOUT,
        workoutType: 'running',
        calories:    487,
        heartRate:   162,
        distance:    5300,
        pace:        '5:48',
        location:    'Central Park',
        duration:    2400,
        metadata:    { foo: 'bar' },
        metadata_json: '{"foo":"bar"}',
      };
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [smuggled] }), makeEnv(db), session,
      );
      expect(res.status).toBe(200);  // request itself succeeds
      const calls = db._calls();
      // Only the named fields are bound; smuggled values never touch the DB.
      const binds = calls[0]?.binds ?? [];
      expect(binds.length).toBe(10);          // 10 named bind positions
      expect(binds[4]).toBe('completed a verified workout');
      expect(binds[5]).toBeNull();             // eventValue stays null
      expect(binds[6]).toBeNull();             // rarity stays null
      // Belt-and-braces: confirm no smuggled value ended up in any bind slot.
      const allBindsStr = JSON.stringify(binds);
      expect(allBindsStr).not.toMatch(/running/);
      expect(allBindsStr).not.toMatch(/487/);
      expect(allBindsStr).not.toMatch(/162/);
      expect(allBindsStr).not.toMatch(/5300/);
      expect(allBindsStr).not.toMatch(/Central Park/);
    });
  });

  // ────────────────────────────────────────────────────────────
  // v3 Phase 1z.256 — verified_sleep_7h
  // ────────────────────────────────────────────────────────────
  describe('verified_sleep_7h (1z.256)', () => {
    it('accepts a valid verified_sleep_7h', async () => {
      const db = makeDb({ perInsertChanges: [1] });
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [VALID_VERIFIED_SLEEP_7H] }), makeEnv(db), session,
      );
      expect(res.status).toBe(200);
      const calls = db._calls();
      expect(calls[0]?.binds[2]).toBe('verified_sleep_7h');
      expect(calls[0]?.binds[3]).toBe('verified_sleep_7h:2026-05-31');
      expect(calls[0]?.binds[4]).toBe('slept over 7 hours last night');
      expect(calls[0]?.binds[5]).toBeNull();
      expect(calls[0]?.binds[6]).toBeNull();
    });

    it('rejects verified_sleep_7h with wrong label', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_VERIFIED_SLEEP_7H, eventLabel: 'slept 7.4 hours last night' }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
    });

    it('rejects verified_sleep_7h with wrong key shape', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_VERIFIED_SLEEP_7H, eventKey: 'verified_sleep_7h' }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_KEY');
    });

    it('rejects verified_sleep_7h with exact hours in eventValue', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_VERIFIED_SLEEP_7H, eventValue: 7.4 }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
    });

    it('rejects verified_sleep_7h with integer eventValue (even 7)', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_VERIFIED_SLEEP_7H, eventValue: 7 }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
    });

    it('rejects verified_sleep_7h with non-null rarity', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_VERIFIED_SLEEP_7H, rarity: 'rare' }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_RARITY');
    });

    it('silently drops HealthKit sleep smuggling fields (sleepHours, sleepScore, bedtime, wakeTime, sleepStages, deepSleep, remSleep)', async () => {
      const db = makeDb({ perInsertChanges: [1] });
      const smuggled = {
        ...VALID_VERIFIED_SLEEP_7H,
        sleepHours:    7.4,
        asleepHours:   7.2,
        sleepDuration: 26640,
        sleepScore:    82,
        bedtime:       '2026-05-30T23:30:00Z',
        wakeTime:      '2026-05-31T06:45:00Z',
        sleepStages:   { deep: 1200, rem: 5400, core: 18000, awake: 840 },
        deepSleep:     1200,
        remSleep:      5400,
        metadata:      { sensitive: true },
        metadata_json: '{"sensitive":true}',
      };
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [smuggled] }), makeEnv(db), session,
      );
      expect(res.status).toBe(200);
      const binds = db._calls()[0]?.binds ?? [];
      expect(binds.length).toBe(10);
      expect(binds[4]).toBe('slept over 7 hours last night');
      expect(binds[5]).toBeNull();
      expect(binds[6]).toBeNull();
      const allBindsStr = JSON.stringify(binds);
      expect(allBindsStr).not.toMatch(/7\.4/);
      expect(allBindsStr).not.toMatch(/26640/);
      expect(allBindsStr).not.toMatch(/82/);
      expect(allBindsStr).not.toMatch(/2026-05-30T23/);
      expect(allBindsStr).not.toMatch(/sensitive/);
    });
  });

  // ────────────────────────────────────────────────────────────
  // v3 Phase 1z.256 — flights_milestone_bucket
  // ────────────────────────────────────────────────────────────
  describe('flights_milestone_bucket (1z.256)', () => {
    for (const bucket of [10, 25, 50, 100] as const) {
      it(`accepts a valid flights_milestone_bucket for ${bucket}`, async () => {
        const db = makeDb({ perInsertChanges: [1] });
        const res = await handlePublicAchievementEventsPost(
          makeReq({ events: [makeFlightsBucketPayload(bucket)] }), makeEnv(db), session,
        );
        expect(res.status).toBe(200);
        const calls = db._calls();
        expect(calls[0]?.binds[2]).toBe('flights_milestone_bucket');
        expect(calls[0]?.binds[3]).toBe(`flights_milestone_bucket:2026-05-31:${bucket}`);
        expect(calls[0]?.binds[4]).toBe(`climbed ${bucket} flights today`);
        expect(calls[0]?.binds[5]).toBe(bucket);
        expect(calls[0]?.binds[6]).toBeNull();
      });
    }

    for (const badBucket of [1, 5, 11, 24, 26, 49, 51, 101, 1000]) {
      it(`rejects flights_milestone_bucket with non-bucket value ${badBucket}`, async () => {
        const db = makeDb();
        const payload = {
          ...VALID_FLIGHTS_BUCKET_10,
          eventValue: badBucket,
          // Use a key/label that the regex would accept if the bucket were valid;
          // here we keep label/key consistent with the bad value so the failure is
          // unambiguously on the value check, not on label/key shape.
          eventLabel: `climbed ${badBucket} flights today`,
          eventKey:   `flights_milestone_bucket:2026-05-31:${badBucket}`,
        };
        const res = await handlePublicAchievementEventsPost(
          makeReq({ events: [payload] }), makeEnv(db), session,
        );
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
      });
    }

    it('rejects flights_milestone_bucket when label/value bucket disagree', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{
          ...VALID_FLIGHTS_BUCKET_10,
          eventValue: 10,
          eventLabel: 'climbed 100 flights today',
          eventKey:   'flights_milestone_bucket:2026-05-31:10',
        }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      // Either INVALID_EVENT_LABEL (label fails its own regex first if the bucket
      // it carries isn't in the allowlist) or INVALID_EVENT_VALUE (cross-check).
      // In this case the bucketed label IS in the regex allowlist (100), so the
      // cross-check trips → INVALID_EVENT_VALUE.
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
    });

    it('rejects flights_milestone_bucket when key/value bucket disagree', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{
          ...VALID_FLIGHTS_BUCKET_10,
          eventValue: 25,
          eventLabel: 'climbed 25 flights today',
          eventKey:   'flights_milestone_bucket:2026-05-31:50',
        }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
    });

    it('rejects flights_milestone_bucket with null eventValue', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_FLIGHTS_BUCKET_10, eventValue: null }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_VALUE');
    });

    it('rejects flights_milestone_bucket with non-null rarity', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{ ...VALID_FLIGHTS_BUCKET_10, rarity: 'rare' }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_RARITY');
    });

    it('rejects flights_milestone_bucket with malformed date in key', async () => {
      const db = makeDb();
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [{
          ...VALID_FLIGHTS_BUCKET_10,
          eventKey: 'flights_milestone_bucket:2026/05/31:10',
        }] }),
        makeEnv(db), session,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_KEY');
    });

    it('silently drops exact-flights smuggling fields (flights, exactFlights, stairs)', async () => {
      const db = makeDb({ perInsertChanges: [1] });
      const smuggled = {
        ...VALID_FLIGHTS_BUCKET_10,
        flights:       47,
        exactFlights:  47,
        stairs:        820,
        metadata:      { exact: 47 },
        metadata_json: '{"exact":47}',
      };
      const res = await handlePublicAchievementEventsPost(
        makeReq({ events: [smuggled] }), makeEnv(db), session,
      );
      expect(res.status).toBe(200);
      const binds = db._calls()[0]?.binds ?? [];
      expect(binds.length).toBe(10);
      expect(binds[4]).toBe('climbed 10 flights today');
      expect(binds[5]).toBe(10);                  // bucket, NOT 47
      expect(binds[6]).toBeNull();
      const allBindsStr = JSON.stringify(binds);
      expect(allBindsStr).not.toMatch(/47/);     // exact flights never leaks
      expect(allBindsStr).not.toMatch(/820/);    // stairs never leaks
      expect(allBindsStr).not.toMatch(/exact/);
    });
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
