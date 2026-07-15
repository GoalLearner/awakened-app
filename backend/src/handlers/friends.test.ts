/**
 * friends.test.ts — GET /v1/friends batch/serialization (W673).
 *
 * The list read was N+1 (one users+public_profile_summary query per friend row);
 * W673 batched it into ONE IN(...) query + an in-memory mapper. These tests pin
 * the behavior the refactor must preserve: accepted/incoming/outgoing bucketing,
 * skipping a friend whose users row is absent, alias-only rows for a friend with
 * no profile summary, the rank-field gate — and that the profile read now fires
 * exactly ONCE regardless of roster size (the N+1 is gone). Same substring-routed
 * D1 mock shape as the other handler tests.
 */
import { describe, expect, it } from 'vitest';
import { handleFriendsList } from './friends';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

interface FriendRow {
  id: string;
  requester_user_id: string;
  recipient_user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}
interface ProfileRow {
  __joinId: string;
  alias: string;
  rank_tier: string | null;
  rank_division: string | null;
  rank_label: string | null;
  rank_sort_value: number | null;
  prestige: number | null;
  server_updated_at: number | null;
  bosses_slain_total: number | null;
  ultra_rare_drops_total: number | null;
  verified_streak_label: string | null;
  achievements_updated_at: number | null;
}

interface Capture { sql: string; binds: unknown[]; }

function makeDb(friendRows: FriendRow[], profileRows: ProfileRow[], calls: Capture[]) {
  return {
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => {
        calls.push({ sql, binds });
        const isProfile = /LEFT JOIN public_profile_summary/.test(sql);
        return {
          all: async () => ({ results: isProfile ? profileRows : friendRows, success: true, meta: {} }),
          first: async () => (isProfile ? profileRows[0] ?? null : friendRows[0] ?? null),
        };
      },
    }),
  } as unknown as D1Database;
}

function makeEnv(db: D1Database, rlOk = true): Env {
  return { DB: db, RL_FRIENDS_READ: { limit: async () => ({ success: rlOk }) } } as unknown as Env;
}
const session = (userId: string): SessionPayload => ({ userId, alias: 'me' } as unknown as SessionPayload);
const req = () => new Request('http://test/v1/friends', { method: 'GET' });

function fullProfile(id: string, alias: string): ProfileRow {
  return {
    __joinId: id, alias, rank_tier: 'A', rank_division: 'II', rank_label: 'A II',
    rank_sort_value: 4200, prestige: 0, server_updated_at: 1_700_000_000_000,
    bosses_slain_total: 12, ultra_rare_drops_total: 1, verified_streak_label: '30d',
    achievements_updated_at: 1_700_000_000_000,
  };
}
function aliasOnly(id: string, alias: string): ProfileRow {
  return {
    __joinId: id, alias, rank_tier: null, rank_division: null, rank_label: null,
    rank_sort_value: null, prestige: null, server_updated_at: null,
    bosses_slain_total: null, ultra_rare_drops_total: null, verified_streak_label: null,
    achievements_updated_at: null,
  };
}

describe('GET /v1/friends (batched serialization)', () => {
  const rows: FriendRow[] = [
    { id: 'f1', requester_user_id: 'me', recipient_user_id: 'A', status: 'accepted', created_at: 't', updated_at: 't' },
    { id: 'f2', requester_user_id: 'B', recipient_user_id: 'me', status: 'pending', created_at: 't', updated_at: 't' },
    { id: 'f3', requester_user_id: 'me', recipient_user_id: 'C', status: 'pending', created_at: 't', updated_at: 't' },
    { id: 'f4', requester_user_id: 'me', recipient_user_id: 'D', status: 'accepted', created_at: 't', updated_at: 't' },
  ];
  // A full, B alias-only, C full; D deliberately ABSENT (no users row).
  const profiles: ProfileRow[] = [fullProfile('A', 'ally'), aliasOnly('B', 'bravo'), fullProfile('C', 'charlie')];

  it('buckets accepted/incoming/outgoing and skips a friend with no users row', async () => {
    const calls: Capture[] = [];
    const res = await handleFriendsList(req(), makeEnv(makeDb(rows, profiles, calls)), session('me'));
    const body = (await res.json()) as {
      ok: boolean;
      friends: Array<{ user_id: string; rankTier?: string }>;
      incoming: Array<{ user_id: string; rankTier?: string; alias: string }>;
      outgoing: Array<{ user_id: string }>;
    };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // accepted → friends; D skipped (absent users row → mapFriendRow null)
    expect(body.friends.map((f) => f.user_id)).toEqual(['A']);
    expect(body.incoming.map((f) => f.user_id)).toEqual(['B']);
    expect(body.outgoing.map((f) => f.user_id)).toEqual(['C']);
    // rank gate: A (full) exposes rankTier; B (alias-only) does NOT
    expect(body.friends[0].rankTier).toBe('A');
    expect(body.incoming[0].rankTier).toBeUndefined();
    expect(body.incoming[0].alias).toBe('bravo');
  });

  it('fires the profile read exactly ONCE (N+1 removed) with an IN() over distinct ids', async () => {
    const calls: Capture[] = [];
    await handleFriendsList(req(), makeEnv(makeDb(rows, profiles, calls)), session('me'));
    const profileCalls = calls.filter((c) => /LEFT JOIN public_profile_summary/.test(c.sql));
    expect(profileCalls.length).toBe(1); // was 1-per-row before W673
    expect(profileCalls[0].sql).toMatch(/IN \(/);
    // all four distinct "other" ids bound in one query
    expect(new Set(profileCalls[0].binds)).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('429s when the read rate-limit rejects', async () => {
    const res = await handleFriendsList(req(), makeEnv(makeDb(rows, profiles, []), false), session('me'));
    expect(res.status).toBe(429);
  });

  it('returns empty buckets for a user with no friend rows', async () => {
    const res = await handleFriendsList(req(), makeEnv(makeDb([], [], [])), session('me'));
    const body = (await res.json()) as { friends: unknown[]; incoming: unknown[]; outgoing: unknown[] };
    expect(body.friends).toEqual([]);
    expect(body.incoming).toEqual([]);
    expect(body.outgoing).toEqual([]);
  });
});
