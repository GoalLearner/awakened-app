/**
 * w1075-hardening.test.ts — the 2026-10-21 security + scale pass (W1075/W1076), pinned
 * through the real worker entry where the behaviour lives in the router, and through the
 * handlers with a small routed D1 mock elsewhere.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
vi.mock('./lib/apns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/apns')>()),
  notifyUser: vi.fn(async () => {}),
}));
import { notifyUser } from './lib/apns';
import worker from './index';
import type { Env } from './env';
import { issueSessionJwt, verifySessionJwt, type SessionPayload } from './session-jwt';
import { readJsonObject } from './lib/responses';
import { isStaffAlias, isReservedAlias } from './profanity';
import { sanitizeCombatant } from './pvp/match-room';
import { handleAuthRefresh } from './handlers/auth-refresh';
import { handleVerifiedEventsSubmit, _eventsSample } from './handlers/duels';
import { handleTowerAvengePost } from './handlers/tower';
import { handleClientErrorsPost, _sample as errorsSample } from './handlers/client-errors';
import { handleUserStatePost } from './handlers/user-state';
import { handleFriendsRequest } from './handlers/friends';
import { handleRevenueCatWebhook } from './handlers/iap-revenuecat-webhook';
import { handlePublicAchievementEventsPost } from './handlers/public-achievement-events';
import { runUpdatePushPage } from './lib/update-push';
import { verifyAppleIdentityToken, _resetJwksCacheForTests } from './apple-jwks';

const mockNotify = vi.mocked(notifyUser);
const KEY = 'test-signing-key-32-bytes-or-more-for-hs256';
const ctx = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const rl = { limit: async () => ({ success: true }) };

interface Call { sql: string; binds: unknown[] }
interface Route {
  re: RegExp;
  first?: (binds: unknown[]) => unknown;
  all?: (binds: unknown[]) => unknown[];
  run?: (binds: unknown[]) => number;   // returns meta.changes; may throw
}
/** A routed D1: the first route whose regex matches the SQL answers; anything else is empty. */
function makeDb(routes: Route[], calls: Call[]) {
  const stmt = (sql: string, binds: unknown[]) => {
    calls.push({ sql, binds });
    const r = routes.find((x) => x.re.test(sql));
    return {
      first: async () => (r && r.first ? r.first(binds) : null),
      all: async () => ({ results: r && r.all ? r.all(binds) : [], success: true, meta: {} }),
      run: async () => ({ success: true, meta: { changes: r && r.run ? r.run(binds) : 1 } }),
    };
  };
  return {
    // bind-less statements (a bare prune) record only when they run.
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => stmt(sql, binds),
      first: () => stmt(sql, []).first(),
      all: () => stmt(sql, []).all(),
      run: () => stmt(sql, []).run(),
    }),
    batch: async (stmts: unknown[]) => stmts.map(() => ({ success: true, meta: { changes: 1 } })),
  } as unknown as D1Database;
}
/** Every RL_* binding answers "allowed" unless given. */
function makeEnv(db: D1Database, extra: Record<string, unknown> = {}): Env {
  const base: Record<string, unknown> = { DB: db, JWT_SIGNING_KEY: KEY, APPLE_BUNDLE_ID: 'com.goallearner.awakened', ...extra };
  return new Proxy(base, {
    get: (t, p) => (typeof p === 'string' && p.startsWith('RL_') && !(p in t) ? rl : t[p as string]),
  }) as unknown as Env;
}
const session = (userId: string, tokenVersion = 0): SessionPayload => ({ userId, alias: 'Hunter', tokenVersion });
const jsonReq = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://api.test' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

beforeEach(() => { mockNotify.mockClear(); });

// ── W1075 — server-side session revocation ───────────────────────────────────────────────
describe('W1075 · sessions die on sign-out', () => {
  const usersRow = (tv: number): Route => ({ re: /SELECT token_version FROM users WHERE id/, first: () => ({ token_version: tv }) });

  it('a token minted before the sign-out is refused on every route; the current one passes', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([usersRow(1)], calls));
    const old = await issueSessionJwt('u1', 'Hunter', env, 0);
    const res = await worker.fetch(new Request('https://api.test/v1/weekly-hunger', { headers: { Authorization: 'Bearer ' + old } }), env, ctx);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('SESSION_REVOKED');

    const fresh = await issueSessionJwt('u1', 'Hunter', env, 1);
    const ok = await worker.fetch(new Request('https://api.test/v1/weekly-hunger', { headers: { Authorization: 'Bearer ' + fresh } }), env, ctx);
    expect(ok.status).not.toBe(401);
  });

  it('a token from before W1075 (no tv claim) reads as version 0: still good until the first sign-out', async () => {
    const legacy = await new SignJWT({ alias: 'Hunter' }).setProtectedHeader({ alg: 'HS256' }).setSubject('u1')
      .setIssuer('awakened-backend').setAudience('awakened-app').setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(KEY));
    expect((await verifySessionJwt(legacy, makeEnv(makeDb([], [])))).tokenVersion).toBe(0);
    const before = await worker.fetch(new Request('https://api.test/v1/weekly-hunger', { headers: { Authorization: 'Bearer ' + legacy } }), makeEnv(makeDb([usersRow(0)], [])), ctx);
    expect(before.status).not.toBe(401);
    const after = await worker.fetch(new Request('https://api.test/v1/weekly-hunger', { headers: { Authorization: 'Bearer ' + legacy } }), makeEnv(makeDb([usersRow(1)], [])), ctx);
    expect(after.status).toBe(401);
  });

  it('a D1 error on the check fails OPEN, as the account-exists check always has', async () => {
    const env = makeEnv(makeDb([{ re: /SELECT token_version FROM users/, first: () => { throw new Error('D1_ERROR'); } }], []));
    const jwt = await issueSessionJwt('u1', 'Hunter', env, 0);
    const res = await worker.fetch(new Request('https://api.test/v1/weekly-hunger', { headers: { Authorization: 'Bearer ' + jwt } }), env, ctx);
    expect(res.status).not.toBe(401);
  });

  it('POST /v1/auth/sign-out bumps users.token_version and drops the device tokens', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([usersRow(0)], calls));
    const jwt = await issueSessionJwt('u1', 'Hunter', env, 0);
    const res = await worker.fetch(new Request('https://api.test/v1/auth/sign-out', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt } }), env, ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { signed_out: boolean }).signed_out).toBe(true);
    expect(calls.some((c) => /UPDATE users SET token_version = token_version \+ 1 WHERE id = \?/.test(c.sql) && c.binds[0] === 'u1')).toBe(true);
    expect(calls.some((c) => /DELETE FROM device_tokens WHERE user_id = \?/.test(c.sql))).toBe(true);
  });

  it('refresh: a token from before the sign-out cannot be exchanged; the current one is renewed at the current version', async () => {
    const row = (tv: number) => makeEnv(makeDb([{ re: /SELECT id, alias, token_version FROM users/, first: () => ({ id: 'u1', alias: 'Hunter', token_version: tv }) }], []));
    const env = row(2);
    const stale = await issueSessionJwt('u1', 'Hunter', env, 0);
    const refused = await handleAuthRefresh(new Request('https://x/v1/auth/refresh', { method: 'POST', headers: { Authorization: 'Bearer ' + stale } }), env);
    expect(refused.status).toBe(401);
    expect(((await refused.json()) as { error: string }).error).toBe('SESSION_REVOKED');

    const current = await issueSessionJwt('u1', 'Hunter', env, 2);
    const ok = await handleAuthRefresh(new Request('https://x/v1/auth/refresh', { method: 'POST', headers: { Authorization: 'Bearer ' + current } }), env);
    expect(ok.status).toBe(200);
    const renewed = (await ok.json()) as { jwt: string };
    expect((await verifySessionJwt(renewed.jwt, env)).tokenVersion).toBe(2);
  });
});

// ── W1075 — small sharp edges ────────────────────────────────────────────────────────────
describe('W1075 · request bodies, aliases, builds', () => {
  it('readJsonObject: null, arrays and junk are "no body", never a thrown TypeError later', async () => {
    const mk = (b: string) => new Request('https://x/', { method: 'POST', body: b });
    expect(await readJsonObject(mk('null'))).toBeNull();
    expect(await readJsonObject(mk('[]'))).toBeNull();
    expect(await readJsonObject(mk('not json'))).toBeNull();
    expect(await readJsonObject(mk('{"a":1}'))).toEqual({ a: 1 });
  });

  it('a `null` body on an authenticated POST is a 400, not a 500', async () => {
    const env = makeEnv(makeDb([{ re: /SELECT token_version FROM users/, first: () => ({ token_version: 0 }) }], []));
    const jwt = await issueSessionJwt('u1', 'Hunter', env, 0);
    for (const path of ['/v1/users/me/device-token', '/v1/tower/events', '/v1/pvp/join']) {
      const res = await worker.fetch(new Request('https://api.test' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' }, body: 'null' }), env, ctx);
      expect(res.status, path).toBeLessThan(500);
    }
  });

  it('staff and system words are reserved; real names are not', () => {
    for (const a of ['Awakened Support', 'AwakenedOfficial', 'Moderator', 'mod_squad', 'The Admin', 'System', 'Staff-Richie', 'Developer']) {
      expect(isStaffAlias(a), a).toBe(true);
      expect(isReservedAlias(a), a).toBe(true);
    }
    for (const a of ['Dev Patel', 'Richie', 'RenDIESEL', 'Immortal Shadow', 'Team Rocket', 'Modest']) {
      expect(isStaffAlias(a), a).toBe(false);
    }
  });

  it('a PvP build is capped per stat and in total; an honest S-rank build is untouched; a prototype weapon key is unarmed', () => {
    const forged = sanitizeCombatant({ stats: { STR: 200, VIT: 200, INT: 200, FOCUS: 200, WILL: 200, WLT: 200 }, weaponId: 'titan_oathblade' });
    const total = Object.values(forged.stats).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(480);
    expect(Math.max(...Object.values(forged.stats))).toBeLessThanOrEqual(120);
    const honest = { STR: 83, VIT: 88, INT: 49, FOCUS: 78, WILL: 70, WLT: 12 };
    expect(sanitizeCombatant({ stats: honest, weaponId: 'unarmed' }).stats).toEqual(honest);
    expect(sanitizeCombatant({ stats: honest, weaponId: 'constructor' }).weaponId).toBe('unarmed');
    expect(sanitizeCombatant({ stats: honest, weaponId: '__proto__' }).weaponId).toBe('unarmed');
    expect(sanitizeCombatant({ stats: { STR: 'abc', VIT: -5 } }).stats.STR).toBe(0);
  });
});

// ── W1075 — Apple key rotation ───────────────────────────────────────────────────────────
describe('W1075 · an unknown Apple signing key triggers one fresh JWKS fetch', () => {
  beforeEach(() => _resetJwksCacheForTests());

  it('a token signed with a key the cache has not seen verifies after a single refetch; junk kids do not refetch again', async () => {
    const a = await generateKeyPair('RS256');
    const b = await generateKeyPair('RS256');
    const jwkA = { ...(await exportJWK(a.publicKey)), kid: 'kid-a', alg: 'RS256', use: 'sig' };
    const jwkB = { ...(await exportJWK(b.publicKey)), kid: 'kid-b', alg: 'RS256', use: 'sig' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [jwkA] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [jwkA, jwkB] }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ keys: [jwkA, jwkB] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const env = makeEnv(makeDb([], []));
      const token = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'kid-b' }).setSubject('apple-1')
        .setIssuer('https://appleid.apple.com').setAudience('com.goallearner.awakened').setIssuedAt().setExpirationTime('10m').sign(b.privateKey);
      const out = await verifyAppleIdentityToken(token, env);
      expect(out.sub).toBe('apple-1');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const junk = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'kid-zzz' }).setSubject('apple-2')
        .setIssuer('https://appleid.apple.com').setAudience('com.goallearner.awakened').setIssuedAt().setExpirationTime('10m').sign(b.privateKey);
      await expect(verifyAppleIdentityToken(junk, env)).rejects.toThrow(/NO_MATCHING_JWK_FOR_KID/);
      expect(fetchMock).toHaveBeenCalledTimes(2);   // throttled: no refetch inside the window
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── W1075/W1076 — co-op step events ──────────────────────────────────────────────────────
describe('W1075/W1076 · verified events follow the clock and keep one row per stream', () => {
  const HOUR = 3_600_000;
  const instance = () => ({
    boss_id: 'the_twin_maw', challenger_user_id: 'u1', partner_user_id: 'u2', partner2_user_id: null, status: 'active',
    starts_at: new Date(Date.now() - HOUR).toISOString(), ends_at: new Date(Date.now() + 23 * HOUR).toISOString(),
  });
  const ev = (over: Record<string, unknown> = {}) => ({
    client_event_id: 'coop_inst-1_steps_' + Math.random(), event_type: 'steps_total', metric: 'steps', value: 8000,
    source: 'apple_health', occurred_at: new Date().toISOString(), boss_instance_id: 'inst-1', ...over,
  });
  type Out = { inserted: number; duplicates: number; errors: Array<{ reason: string }> };
  const send = async (env: Env, events: unknown[]) =>
    (await (await handleVerifiedEventsSubmit(jsonReq('/v1/verified-events', { events }), env, session('u1'))).json()) as Out;
  const instRoute: Route = { re: /FROM coop_boss_instances WHERE id = \?/, first: () => instance() };

  it('an hour into the hunt, 50,000 steps is refused and 14,000 is stored', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([instRoute], calls));
    expect((await send(env, [ev({ value: 50_000 })])).errors[0].reason).toBe('INVALID_VALUE');
    const ok = await send(env, [ev({ value: 14_000 })]);
    expect(ok.inserted).toBe(1);
    expect(calls.some((c) => /INSERT OR IGNORE INTO verified_events/.test(c.sql))).toBe(true);
  });

  it('a higher value updates the stream row in place; an equal or lower one is a duplicate; no second row', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([instRoute, { re: /SELECT id, value FROM verified_events/, first: () => ({ id: 'row1', value: 10_000 }) }], calls));
    const up = await send(env, [ev({ value: 12_000 })]);
    expect(up.inserted).toBe(1);
    expect(calls.some((c) => /UPDATE verified_events SET value = \?/.test(c.sql) && c.binds[0] === 12_000)).toBe(true);
    expect(calls.some((c) => /INSERT OR IGNORE INTO verified_events/.test(c.sql))).toBe(false);
    const same = await send(env, [ev({ value: 10_000 })]);
    expect([same.inserted, same.duplicates]).toEqual([0, 1]);
  });

  it('old rows are pruned on a sample of submits', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([instRoute], calls));
    const was = _eventsSample.roll;
    _eventsSample.roll = () => 0;
    try { await send(env, [ev({ value: 9_000 })]); } finally { _eventsSample.roll = was; }
    expect(calls.some((c) => /DELETE FROM verified_events WHERE occurred_at < datetime\('now', '-45 days'\)/.test(c.sql))).toBe(true);
  });
});

// ── W1075 — the tower, friends, reports, errors ──────────────────────────────────────────
describe('W1075 · one avenge per fallen friend per day', () => {
  const base = (avengedToday: boolean): Route[] => [
    { re: /SELECT \* FROM tower_events WHERE id = \? AND kind = 'defeat'/, first: () => ({ id: 'e1', user_id: 'friend', floor: 1, created_at: Date.now() - 1000, avenged_by: null }) },
    { re: /FROM friends/, all: () => [{ a: 'me', b: 'friend' }] },
    { re: /kind = 'clear' AND floor = \? AND week_start = \?/, first: () => ({ 1: 1 }) },
    { re: /avenged_by = \? AND avenged_at >= \?/, first: () => (avengedToday ? { 1: 1 } : null) },
    { re: /SELECT alias FROM users/, first: () => ({ alias: 'Me' }) },
  ];
  it('the second avenge of the same friend today is refused; the first pays', async () => {
    const again = await handleTowerAvengePost(jsonReq('/v1/tower/avenge', { event_id: 'e1' }), makeEnv(makeDb(base(true), [])), session('me'));
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe('AVENGED_TODAY');
    const first = await handleTowerAvengePost(jsonReq('/v1/tower/avenge', { event_id: 'e1' }), makeEnv(makeDb(base(false), [])), session('me'));
    expect(first.status).toBe(200);
    expect(((await first.json()) as { souls: number }).souls).toBe(40);
  });
});

describe('W1075 · guild requests respect blocks and declines', () => {
  const target: Route = { re: /LEFT JOIN public_profile_summary/, first: () => ({ __joinId: 'target', alias: 'Target' }) };
  const lookup: Route = { re: /FROM users/, first: () => ({ id: 'target', alias: 'Target' }) };

  it('a blocked pair is "no such hunter" — no row, no push', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([target, lookup, { re: /FROM board_blocks/, first: () => ({ 1: 1 }) }], calls));
    const res = await handleFriendsRequest(jsonReq('/v1/friends/request', { alias: 'Target' }), env, session('me'), ctx);
    expect(res.status).toBe(404);
    expect(calls.some((c) => /INSERT INTO friends/.test(c.sql))).toBe(false);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('asking again within a week of a decline says "pending", changes nothing and rings nobody; after the week it revives and pushes', async () => {
    const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
    const routesFor = (declinedAgoMs: number, calls: Call[]) => makeDb([
      target, lookup,
      { re: /SELECT COUNT\(\*\) AS n FROM friends WHERE status = 'pending'/, first: () => ({ n: 0 }) },
      { re: /INSERT INTO friends/, run: () => { throw new Error('UNIQUE constraint failed: friends.requester_user_id, friends.recipient_user_id'); } },
      { re: /FROM friends\s+WHERE requester_user_id = \? AND recipient_user_id = \?\s+LIMIT 1/, first: (b) => (b[0] === 'me'
        ? { id: 'f1', requester_user_id: 'me', recipient_user_id: 'target', status: 'declined', created_at: stamp(declinedAgoMs + 1000), updated_at: stamp(declinedAgoMs) }
        : null) },
    ], calls);
    const recent: Call[] = [];
    const r1 = await handleFriendsRequest(jsonReq('/v1/friends/request', { alias: 'Target' }), makeEnv(routesFor(60 * 60 * 1000, recent)), session('me'), ctx);
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { alreadyPending?: boolean }).alreadyPending).toBe(true);
    expect(recent.some((c) => /UPDATE friends SET status = 'pending'/.test(c.sql))).toBe(false);
    expect(mockNotify).not.toHaveBeenCalled();

    const old: Call[] = [];
    const r2 = await handleFriendsRequest(jsonReq('/v1/friends/request', { alias: 'Target' }), makeEnv(routesFor(8 * 86_400_000, old)), session('me'), ctx);
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { revived?: boolean }).revived).toBe(true);
    expect(old.some((c) => /UPDATE friends SET status = 'pending'/.test(c.sql))).toBe(true);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });
});

describe('W1076 · the error reporter sheds load and samples its prune', () => {
  const req = () => jsonReq('/v1/users/me/client-errors', { message: 'TypeError: x', build: '3.0.14', path: '#home' });
  it('past 300 reports a minute the report is acknowledged and dropped', async () => {
    const calls: Call[] = [];
    const res = await handleClientErrorsPost(req(), makeEnv(makeDb([{ re: /SELECT COUNT\(\*\) AS n FROM client_errors/, first: () => ({ n: 300 }) }], calls)), session('u1'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { shed?: boolean }).shed).toBe(true);
    expect(calls.some((c) => /INSERT INTO client_errors/.test(c.sql))).toBe(false);
  });
  it('under the ceiling it stores the report; the prune runs on a sample', async () => {
    const calls: Call[] = [];
    const was = errorsSample.roll;
    errorsSample.roll = () => 0.99;
    try {
      await handleClientErrorsPost(req(), makeEnv(makeDb([{ re: /SELECT COUNT\(\*\) AS n FROM client_errors/, first: () => ({ n: 2 }) }], calls)), session('u1'));
    } finally { errorsSample.roll = was; }
    expect(calls.some((c) => /INSERT INTO client_errors/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /DELETE FROM client_errors/.test(c.sql))).toBe(false);
  });
});

describe('W1076 · public events: a daily allowance and a bounded kill label', () => {
  const kill = (label = 'defeated The Glass Strider') => ({
    eventType: 'boss_kill', eventKey: 'glass_strider', eventLabel: label, eventValue: 4, rarity: 'D',
    clientEventId: 'boss_kill:glass_strider:4', clientCreatedAt: new Date().toISOString(),
  });
  it('the 101st event of the day is acknowledged, not stored', async () => {
    const calls: Call[] = [];
    const res = await handlePublicAchievementEventsPost(jsonReq('/v1/users/me/public-achievement-events', { events: [kill()] }),
      makeEnv(makeDb([{ re: /SELECT COUNT\(\*\) AS n FROM public_achievement_events/, first: () => ({ n: 100 }) }], calls)), session('u1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ insertedCount: 0, duplicateCount: 1 });
    expect(calls.some((c) => /INSERT INTO public_achievement_events/.test(c.sql))).toBe(false);
  });
  it('a kill label longer than a boss name is refused', async () => {
    const res = await handlePublicAchievementEventsPost(jsonReq('/v1/users/me/public-achievement-events', { events: [kill('defeated ' + 'A'.repeat(70))] }),
      makeEnv(makeDb([], [])), session('u1'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('INVALID_EVENT_LABEL');
  });
});

// ── W1076 — the cloud save ───────────────────────────────────────────────────────────────
describe('W1076 · the cloud save skips unchanged blobs and accepts gzip', () => {
  const envelope = (state: unknown, checksum = 'abc') => ({ state_version: 1, client_updated_at: new Date().toISOString(), checksum, state });
  it('an unchanged checksum only stamps the time (no blob rewrite)', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([{ re: /UPDATE user_state_snapshots SET server_updated_at = \? WHERE user_id = \? AND checksum = \?/, run: () => 1 }], calls));
    const res = await handleUserStatePost(jsonReq('/v1/users/me/state', envelope({ keys: { hb_points: '5' } })), env, session('u1'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { unchanged?: boolean }).unchanged).toBe(true);
    expect(calls.some((c) => /INSERT INTO user_state_snapshots/.test(c.sql))).toBe(false);
  });
  it('a changed checksum writes the blob', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([{ re: /UPDATE user_state_snapshots SET server_updated_at/, run: () => 0 }], calls));
    await handleUserStatePost(jsonReq('/v1/users/me/state', envelope({ keys: { hb_points: '6' } })), env, session('u1'));
    expect(calls.some((c) => /INSERT INTO user_state_snapshots/.test(c.sql))).toBe(true);
  });
  it('a gzip-encoded save is decoded and stored as the same JSON; a save that inflates past the ceiling is a 413', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([{ re: /UPDATE user_state_snapshots SET server_updated_at/, run: () => 0 }], calls));
    const state = { keys: { hb_points: '7', hb_habits: '[{"id":"a"}]' } };
    const body = gzipSync(Buffer.from(JSON.stringify(envelope(state, 'z1'))));
    const res = await handleUserStatePost(new Request('https://x/v1/users/me/state', { method: 'POST', headers: { 'X-State-Encoding': 'gzip' }, body }), env, session('u1'));
    expect(res.status).toBe(200);
    const ins = calls.find((c) => /INSERT INTO user_state_snapshots/.test(c.sql));
    expect(ins && ins.binds[1]).toBe(JSON.stringify(state));

    const bomb = gzipSync(Buffer.from(JSON.stringify(envelope({ pad: 'x'.repeat(1_400_000) }, 'z2'))));
    expect(bomb.byteLength).toBeLessThan(20_000);
    const big = await handleUserStatePost(new Request('https://x/v1/users/me/state', { method: 'POST', headers: { 'X-State-Encoding': 'gzip' }, body: bomb }), env, session('u1'));
    expect(big.status).toBe(413);
  });
});

// ── W1075 — RevenueCat TRANSFER ──────────────────────────────────────────────────────────
describe('W1075 · a transferred subscription ends the old account\'s membership', () => {
  it('TRANSFER → the transferred_from accounts expire now', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([{ re: /UPDATE premium_subscriptions SET expires_at_ms = \?/, run: () => 1 }], calls), { REVENUECAT_WEBHOOK_AUTH: 'Bearer s' });
    const now = Date.now();
    const res = await handleRevenueCatWebhook(new Request('https://x/v1/iap/revenuecat-webhook', {
      method: 'POST', headers: { Authorization: 'Bearer s', 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: { type: 'TRANSFER', transferred_from: ['u-old'], transferred_to: ['u-new'], event_timestamp_ms: now } }),
    }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ transferred: true, ended: 1 });
    const upd = calls.find((c) => /UPDATE premium_subscriptions SET expires_at_ms = \?/.test(c.sql));
    expect(upd && upd.binds[2]).toBe('u-old');
    expect(upd && upd.binds[0]).toBe(now);
  });
});

// ── W1076 — the Monday push continues where it stopped ───────────────────────────────────
describe('W1076 · the Monday push sweep carries its cursor across weeks', () => {
  it('a new day whose previous sweep never finished starts from that cursor', async () => {
    const calls: Call[] = [];
    const env = makeEnv(makeDb([
      { re: /INSERT OR IGNORE INTO push_broadcast_log/, run: () => 1 },
      { re: /WHERE day_key < \?/, first: () => ({ cursor: 'u050', completed: 0 }) },
      { re: /SELECT cursor, completed, sent_users FROM push_broadcast_log WHERE day_key = \?/, first: () => ({ cursor: 'u050', completed: 0, sent_users: 0 }) },
      { re: /FROM device_tokens dt/, all: () => [] },
    ], calls), { APNS_AUTH_KEY: 'k', APNS_KEY_ID: 'id', APPLE_TEAM_ID: 'T' });
    const r = await runUpdatePushPage(env, '2026-10-26');
    expect(r.ok).toBe(true);
    const carry = calls.find((c) => /UPDATE push_broadcast_log SET cursor = \? WHERE day_key = \? AND cursor = '' AND sent_users = 0/.test(c.sql));
    expect(carry && carry.binds[0]).toBe('u050');
  });
});

// ── source-level guards for the SQL and constants the review found ───────────────────────
describe('W1076 · source guards', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('no derived-table column list (SQLite rejects "AS f(id)")', () => {
    for (const f of ['./handlers/worldgate.ts', './handlers/friends.ts', './handlers/board.ts', './handlers/coop-boss.ts']) {
      expect(src(f), f).not.toMatch(/\)\s+AS\s+\w+\s*\(/);
    }
  });
  it('IN-lists stay under D1\'s 100 bound parameters', () => {
    expect(src('./handlers/friends.ts')).toMatch(/const CHUNK = 90;/);
    expect(src('./handlers/tower.ts')).toMatch(/LIMIT 90`/);
  });
  it('the Founder sequence survives a deleted founder', () => {
    expect(src('./lib/founder-mark.ts')).toMatch(/COALESCE\(\(SELECT MAX\(seq\) FROM founder_marks\), 0\) \+ 1/);
  });
});
