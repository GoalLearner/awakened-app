/**
 * app-open.test.ts — W834 (Train 3, G2) build + funnel reporting via the
 * app-open body. Hand-rolled substring-routed D1 mock (same pattern as the
 * other handler tests), extended with a batch() capture.
 */
import { describe, expect, it } from 'vitest';
import { handleAppOpenPost, _sample } from './app-open';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

interface Captured { sql: string; binds: unknown[] }

function makeEnv(opts?: { rateLimited?: boolean; todayCount?: number }) {
  const calls: Captured[] = [];
  const batches: Captured[][] = [];
  const mkStmt = (sql: string) => ({
    bind: (...args: unknown[]) => {
      const captured = { sql, binds: args };
      calls.push(captured);
      return {
        __captured: captured,
        run: async () => ({ success: true, meta: { changes: 1 } }),
        first: async () => (/COUNT\(\*\) AS n FROM funnel_events WHERE user_id = \?/.test(sql) ? { n: opts?.todayCount ?? 0 } : null),
        all: async () => ({ results: [], success: true, meta: {} }),
      };
    },
  });
  const db = {
    prepare: mkStmt,
    batch: async (stmts: Array<{ __captured: Captured }>) => {
      batches.push(stmts.map((s) => s.__captured));
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  } as unknown as D1Database;
  const env = {
    DB: db,
    RL_APP_OPEN: { limit: async () => ({ success: !opts?.rateLimited }) },
  } as unknown as Env;
  return { env, calls, batches };
}

const session: SessionPayload = { userId: 'user-abc', alias: 'Richie' };

function makeReq(body?: unknown): Request {
  return new Request('https://x/v1/users/me/app-open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /v1/users/me/app-open (W834)', () => {
  it('still works as a bare lifecycle ping (no body — the pre-W834 client)', async () => {
    const { env, calls, batches } = makeEnv();
    const res = await handleAppOpenPost(makeReq(), env, session);
    expect(res.status).toBe(200);
    const upsert = calls.find((c) => /INSERT INTO app_opens/.test(c.sql));
    expect(upsert).toBeTruthy();
    expect(upsert!.binds[0]).toBe('user-abc');   // user from SESSION, not body
    expect(upsert!.binds[3]).toBeNull();         // no build reported
    expect(batches.length).toBe(0);              // no funnel writes
  });

  it('records the build on the day row', async () => {
    const { env, calls } = makeEnv();
    const res = await handleAppOpenPost(makeReq({ build: '2.5.1-w834' }), env, session);
    expect(res.status).toBe(200);
    const upsert = calls.find((c) => /INSERT INTO app_opens/.test(c.sql))!;
    expect(upsert.binds[3]).toBe('2.5.1-w834');
    expect(/COALESCE\(excluded\.build, app_opens\.build\)/.test(upsert.sql)).toBe(true);
  });

  it('accepts batched funnel events and reports the accepted count', async () => {
    _sample.roll = () => 0;   // this ping is one of the sampled prunes
    const { env, batches } = makeEnv();
    const res = await handleAppOpenPost(
      makeReq({
        build: '2.5.1-w834',
        events: [
          { e: 'paywall_impression', d: 'weekly_insights' },
          { e: 'BAD NAME WITH SPACES' },        // rejected: fails the name regex
          { e: 'purchase_completed', d: 'founder' },
        ],
      }),
      env, session,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { events_accepted: number };
    expect(json.events_accepted).toBe(2);
    expect(batches.length).toBe(1);
    const inserts = batches[0].filter((c) => /INSERT INTO funnel_events/.test(c.sql));
    expect(inserts.length).toBe(2);
    expect(inserts[0].binds[0]).toBe('user-abc');
    expect(inserts[0].binds[2]).toBe('paywall_impression');
    expect(inserts[0].binds[3]).toBe('weekly_insights');
    // Inline retention prune rides the same batch.
    expect(batches[0].some((c) => /DELETE FROM funnel_events WHERE created_at </.test(c.sql))).toBe(true);
  });

  // W1040 — the 2026-10-11 review: the prune was a full scan on every ping, and one account
  // could add rows without limit.
  it('W1040: most pings do not prune (it is sampled), and the events still land', async () => {
    _sample.roll = () => 0.99;
    const { env, batches } = makeEnv();
    const res = await handleAppOpenPost(makeReq({ events: [{ e: 'paywall_impression' }] }), env, session);
    expect(((await res.json()) as { events_accepted: number }).events_accepted).toBe(1);
    expect(batches[0].length).toBe(1);
    expect(batches[0].some((c) => /DELETE FROM funnel_events/.test(c.sql))).toBe(false);
  });

  it('W1040: a hunter at the daily allowance is acknowledged but nothing more is stored', async () => {
    _sample.roll = () => 0;
    const { env, batches, calls } = makeEnv({ todayCount: 300 });
    const res = await handleAppOpenPost(makeReq({ events: [{ e: 'a_one' }, { e: 'a_two' }] }), env, session);
    expect(((await res.json()) as { events_accepted: number }).events_accepted).toBe(2);   // so the client clears its queue
    expect(batches.length).toBe(0);
    expect(calls.some((c) => /INSERT INTO funnel_events/.test(c.sql))).toBe(false);
    // two short of the allowance: two are stored, the third is dropped
    const near = makeEnv({ todayCount: 298 });
    await handleAppOpenPost(makeReq({ events: [{ e: 'a_one' }, { e: 'a_two' }, { e: 'a_three' }] }), near.env, session);
    expect(near.batches[0].filter((c) => /INSERT INTO funnel_events/.test(c.sql)).length).toBe(2);
  });

  it('caps events at 10 per call', async () => {
    const { env, batches } = makeEnv();
    const events = Array.from({ length: 25 }, (_, i) => ({ e: 'evt_' + i }));
    const res = await handleAppOpenPost(makeReq({ events }), env, session);
    const json = (await res.json()) as { events_accepted: number };
    expect(json.events_accepted).toBe(10);
    expect(batches[0].filter((c) => /INSERT INTO funnel_events/.test(c.sql)).length).toBe(10);
  });

  // W1123 — 50 shadows had risen and none had reached Hunter Activity: every one came from a build
  // whose queue dropped shadow_drop. The arise signal comes from every build, so it announces them.
  it('W1123: a risen shadow from any build is announced in Hunter Activity, once', async () => {
    const { env, batches } = makeEnv();
    await handleAppOpenPost(makeReq({ build: '3.0.19-w1113', events: [{ e: 'arise_extracted', d: 'the_forge_of_ten_thousand_days' }] }), env, session);
    const pae = batches[0].filter((c) => /INSERT INTO public_achievement_events/.test(c.sql));
    expect(pae.length).toBe(1);
    expect(pae[0].sql).toMatch(/'shadow_drop'/);
    expect(pae[0].sql).toMatch(/ON CONFLICT\(user_id, client_event_id\) DO NOTHING/);
    // the same pinned row the client's own POST writes, so the second one to land is a no-op
    expect(pae[0].binds.slice(1)).toEqual([
      'user-abc', 'the_forge_of_ten_thousand_days', 'claimed the Shadow of The Forge of Ten Thousand Days',
      'shadow:the_forge_of_ten_thousand_days', expect.stringMatching(/^\d{4}-\d\d-\d\dT/), expect.any(Number),
    ]);
    expect(batches[0].filter((c) => /INSERT INTO funnel_events/.test(c.sql)).length).toBe(1);
  });

  it('W1123: only a listed solo boss is announced, and never past the daily allowance', async () => {
    const { env, batches } = makeEnv();
    await handleAppOpenPost(makeReq({ events: [
      { e: 'arise_extracted', d: 'claimed the throne' },   // not a boss id
      { e: 'arise_extracted', d: 'the_twin_maw' },         // a co-op boss has no shadow
      { e: 'arise_extracted' },                            // no detail
      { e: 'boss_kill', d: 'the_carouser' },               // another event naming a boss
    ] }), env, session);
    expect(batches[0].some((c) => /INSERT INTO public_achievement_events/.test(c.sql))).toBe(false);
    expect(batches[0].filter((c) => /INSERT INTO funnel_events/.test(c.sql)).length).toBe(4);
    const full = makeEnv({ todayCount: 300 });
    await handleAppOpenPost(makeReq({ events: [{ e: 'arise_extracted', d: 'the_carouser' }] }), full.env, session);
    expect(full.calls.some((c) => /INSERT INTO public_achievement_events/.test(c.sql))).toBe(false);
  });

  // W1127 — the owner asked for every open to be counted, per hunter per Pacific day.
  describe('W1127: opens per Pacific day', () => {
    const counter = (calls: Captured[]) => calls.filter((c) => /INSERT INTO app_open_counts/.test(c.sql));

    it('an open from 3.0.22+ adds one to today\'s Pacific row', async () => {
      const { env, calls } = makeEnv();
      await handleAppOpenPost(makeReq({ build: '3.0.22-w1127', open: true }), env, session);
      const c = counter(calls);
      expect(c.length).toBe(1);
      expect(c[0].binds[0]).toBe('user-abc');                       // user from SESSION
      expect(c[0].binds[1]).toMatch(/^\d{4}-\d\d-\d\d$/);           // day derived on the server
      expect(c[0].binds[2]).toBe(1);
      expect(c[0].sql).toMatch(/opens = app_open_counts\.opens \+ excluded\.opens/);
    });

    it('a 3.0.22+ ping that is not an open (a funnel flush) counts nothing', async () => {
      const { env, calls } = makeEnv();
      await handleAppOpenPost(makeReq({ build: '3.0.22-w1127', open: false, events: [{ e: 'health_first_read' }] }), env, session);
      expect(counter(calls).length).toBe(0);
      expect(calls.some((c) => /INSERT INTO app_opens/.test(c.sql))).toBe(true);   // the day row still lands
    });

    it('older builds (no open key, or no body at all) count each ping as one open', async () => {
      const a = makeEnv();
      await handleAppOpenPost(makeReq({ build: '3.0.21-w1126' }), a.env, session);
      expect(counter(a.calls)[0].binds[2]).toBe(1);
      const b = makeEnv();
      await handleAppOpenPost(makeReq(), b.env, session);
      expect(counter(b.calls)[0].binds[2]).toBe(1);
    });

    it('the Pacific day, not the UTC day: 11 PM PST on Nov 5 is Nov 5', async () => {
      const real = Date.now;
      Date.now = () => Date.UTC(2026, 10, 6, 7, 0, 0);   // 2026-11-06 07:00 UTC = Nov 5, 11 PM PST
      try {
        const { env, calls } = makeEnv();
        await handleAppOpenPost(makeReq({ open: true }), env, session);
        expect(counter(calls)[0].binds[1]).toBe('2026-11-05');
        expect(calls.find((c) => /INSERT INTO app_opens/.test(c.sql))!.binds[2]).toBe('2026-11-06');   // app_opens stays UTC
      } finally { Date.now = real; }
    });

    it('a rate-limited ping counts nothing', async () => {
      const { env, calls } = makeEnv({ rateLimited: true });
      await handleAppOpenPost(makeReq({ open: true }), env, session);
      expect(counter(calls).length).toBe(0);
    });
  });

  it('rate-limited calls accept no events so the client retries them later', async () => {
    const { env, calls, batches } = makeEnv({ rateLimited: true });
    const res = await handleAppOpenPost(
      makeReq({ events: [{ e: 'paywall_impression' }] }), env, session,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { events_accepted: number; deduped: boolean };
    expect(json.deduped).toBe(true);
    expect(json.events_accepted).toBe(0);
    expect(calls.length).toBe(0);
    expect(batches.length).toBe(0);
  });
});
