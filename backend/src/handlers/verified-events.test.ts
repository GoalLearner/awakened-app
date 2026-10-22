/**
 * verified-events.test.ts — W1040, the 2026-10-11 security review's one HIGH finding.
 *
 * POST /v1/verified-events stored nine client strings with no length check, accepted events
 * tied to nothing, and had no body ceiling: one signed-in account could fill the database.
 * It also took any step or flight count for a co-op hunt. These tests pin the three guards:
 * field ceilings, unattached events acknowledged but not stored, and per-day value ceilings
 * scaled by the hunt's window.
 */
import { describe, expect, it } from 'vitest';
import { handleVerifiedEventsSubmit } from './duels';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

interface Captured { sql: string; binds: unknown[] }
const HOUR = 3_600_000;

/** `windowHours` = the co-op instance's length; the caller is its challenger. */
function makeEnv(windowHours = 24, opts: { status?: string; member?: boolean } = {}) {
  const inserts: Captured[] = [];
  const now = Date.now();
  const instance = {
    boss_id: 'the_twin_maw',
    challenger_user_id: opts.member === false ? 'someone-else' : 'u1',
    partner_user_id: 'u2',
    partner2_user_id: null,
    status: opts.status || 'active',
    starts_at: new Date(now - (windowHours - 1) * HOUR).toISOString(),   // W1075 — an hour from the end: the time-based ceiling has room
    ends_at: new Date(now + HOUR).toISOString(),
  };
  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => ({
        first: async () => (/FROM coop_boss_instances WHERE id = \?/.test(sql) && binds[0] === 'inst-1' ? instance : null),
        all: async () => ({ results: [], success: true, meta: {} }),
        run: async () => {
          if (/INSERT OR IGNORE INTO verified_events/.test(sql)) inserts.push({ sql, binds });
          return { success: true, meta: { changes: 1 } };
        },
      }),
    }),
  } as unknown as D1Database;
  const env = { DB: db, RL_DUELS_WRITE: { limit: async () => ({ success: true }) } } as unknown as Env;
  return { env, inserts };
}

const session = { userId: 'u1', alias: 'tester' } as unknown as SessionPayload;
const post = (events: unknown[]) => new Request('https://x/v1/verified-events', { method: 'POST', body: JSON.stringify({ events }) });
const ev = (over: Record<string, unknown> = {}) => ({
  client_event_id: 'coop_inst-1_steps_1760000000000', event_type: 'steps_total', metric: 'steps', value: 8000,
  source: 'apple_health', occurred_at: new Date().toISOString(), boss_instance_id: 'inst-1', ...over,
});
type Out = { inserted: number; duplicates: number; errors: Array<{ index: number; reason: string }> };
const send = async (env: Env, events: unknown[]) => (await (await handleVerifiedEventsSubmit(post(events), env, session)).json()) as Out;

describe('POST /v1/verified-events (W1040)', () => {
  it('an ordinary co-op step event from a participant is stored, with the value it carried', async () => {
    const { env, inserts } = makeEnv();
    const out = await send(env, [ev()]);
    expect([out.inserted, out.duplicates, out.errors.length]).toEqual([1, 0, 0]);
    expect(inserts.length).toBe(1);
    expect(inserts[0].binds).toContain(8000);
    expect(inserts[0].binds).toContain('inst-1');
  });

  it('every string has a ceiling: an oversized field is refused and nothing is stored', async () => {
    const big = 'x'.repeat(200_000);
    for (const over of [
      { metadata_json: big }, { client_event_id: 'c' + big }, { metric: big }, { occurred_at: big },
      { window_start: big }, { window_end: big }, { metric_date: big }, { client_created_at: big },
      { boss_instance_id: big }, { duel_id: big },
    ]) {
      const { env, inserts } = makeEnv();
      const out = await send(env, [ev(over)]);
      expect(out.errors[0]?.reason, Object.keys(over)[0]).toBe('FIELD_TOO_LONG');
      expect(inserts.length).toBe(0);
    }
    // a modest metadata string is fine
    const ok = makeEnv();
    expect((await send(ok.env, [ev({ metadata_json: '{"note":"fine"}' })])).inserted).toBe(1);
  });

  it('an event tied to no co-op hunt is acknowledged (an old queue drains) and NOT stored', async () => {
    const { env, inserts } = makeEnv();
    const out = await send(env, [
      ev({ boss_instance_id: undefined, client_event_id: 'legacy-1', event_type: 'boss_defeat_verified' }),
      ev({ boss_instance_id: undefined, duel_id: 'duel-9', client_event_id: 'legacy-2' }),
    ]);
    expect([out.inserted, out.duplicates, out.errors.length]).toEqual([0, 2, 0]);
    expect(inserts.length).toBe(0);
  });

  it('a co-op value is capped per day of the hunt window: 50,000 steps and 300 flights a day', async () => {
    const day = makeEnv(24);
    expect((await send(day.env, [ev({ value: 50_000 })])).inserted).toBe(1);
    const over = await send(day.env, [ev({ value: 50_001, client_event_id: 'b' }), ev({ value: 150_000, client_event_id: 'c' })]);
    expect(over.errors.map((e) => e.reason)).toEqual(['INVALID_VALUE', 'INVALID_VALUE']);
    expect(day.inserts.length).toBe(1);
    // an 80-hour raid is four days: 200,000 is the line
    const raid = makeEnv(80);
    expect((await send(raid.env, [ev({ value: 150_000 })])).inserted).toBe(1);
    expect((await send(raid.env, [ev({ value: 200_001, client_event_id: 'd' })])).errors[0].reason).toBe('INVALID_VALUE');
  });

  it('the hunt-membership checks still stand: a stranger, or a hunt that is not live, stores nothing', async () => {
    const stranger = makeEnv(24, { member: false });
    expect((await send(stranger.env, [ev()])).errors[0].reason).toBe('NOT_PARTICIPANT');
    const done = makeEnv(24, { status: 'completed' });
    expect((await send(done.env, [ev()])).errors[0].reason).toBe('BOSS_NOT_ACTIVE');
    expect(stranger.inserts.length + done.inserts.length).toBe(0);
  });

  it('the batch ceiling is unchanged: 25 events a call', async () => {
    const { env } = makeEnv();
    const res = await handleVerifiedEventsSubmit(post(Array.from({ length: 26 }, (_, i) => ev({ client_event_id: 'e' + i }))), env, session);
    expect(res.status).toBe(400);
  });
});
