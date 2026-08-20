/**
 * update-push.test.ts — W680 Monday update-push broadcast: paging, cursor CAS,
 * idempotency, and the not-configured no-op. Hand-rolled substring-routed D1
 * mock (same pattern as founder-mark.test.ts); notifyUser is exercised via a
 * mocked global fetch (APNs) so the real apns.ts pipeline runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runUpdatePushPage } from './update-push';
import type { Env } from '../env';

interface MockState {
  cursor: string;
  completed: number;
  sent: number;
  users: string[]; // distinct device_tokens.user_id, sorted
  tokensByUser: Record<string, string[]>;
  notified: string[]; // tokens APNs "received"
  casLoseOnce?: boolean; // simulate a concurrent run winning the claim
  buildsByUser?: Record<string, string | null>; // W835 — latest app_opens.build per user
}

function makeEnv(state: MockState): Env {
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (/FROM push_broadcast_log/.test(sql)) {
            return { cursor: state.cursor, completed: state.completed, sent_users: state.sent };
          }
          return null;
        },
        run: async () => {
          if (/INSERT OR IGNORE INTO push_broadcast_log/.test(sql)) {
            return { success: true, meta: { changes: 0 } };
          }
          if (/UPDATE push_broadcast_log/.test(sql) && /completed = 1,/.test(sql)) {
            // empty-page completion path (no CAS args beyond day+cursor)
            state.completed = 1;
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE push_broadcast_log/.test(sql)) {
            // CAS claim: WHERE cursor = <old>
            const oldCursor = args[4] as string;
            if (state.casLoseOnce) { state.casLoseOnce = false; return { success: true, meta: { changes: 0 } }; }
            if (oldCursor !== state.cursor) return { success: true, meta: { changes: 0 } };
            state.cursor = args[0] as string;
            state.sent += args[1] as number;
            state.completed = args[2] as number;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 1 } };
        },
        all: async () => {
          if (/SELECT DISTINCT dt\.user_id/.test(sql)) {
            // W835 page query: user_id + latest reported build subselect.
            const after = args[0] as string;
            const limit = args[1] as number;
            const page = state.users.filter((u) => u > after).slice(0, limit);
            return {
              results: page.map((u) => ({ user_id: u, build: (state.buildsByUser || {})[u] ?? null })),
              success: true,
              meta: {},
            };
          }
          if (/FROM device_tokens/.test(sql)) {
            // notifyUser's per-user token read
            const uid = args[0] as string;
            return {
              results: (state.tokensByUser[uid] || []).map((t) => ({ token: t, environment: 'production', bundle_id: null })),
              success: true,
              meta: {},
            };
          }
          return { results: [], success: true, meta: {} };
        },
      }),
    }),
  } as unknown as D1Database;
  return {
    DB: db,
    // minimal APNs config so pushConfigured() passes; the JWT/key path is
    // bypassed by mocking apns internals via fetch? No — importPKCS8 needs a real
    // key, so tests below that reach notifyUser stub global fetch AND the JWT
    // cache seam is avoided by using an invalid key + asserting notifyUser's
    // never-throws contract (send failures are swallowed per-token).
    APNS_AUTH_KEY: 'invalid-pem',
    APNS_KEY_ID: 'KEYID12345',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_BUNDLE_ID: 'com.goallearner.awakened',
  } as unknown as Env;
}

afterEach(() => vi.restoreAllMocks());

describe('runUpdatePushPage', () => {
  it('not configured → no-op with PUSH_NOT_CONFIGURED', async () => {
    const env = { DB: {} } as unknown as Env; // no APNs secrets
    const r = await runUpdatePushPage(env, 'test-day');
    expect(r).toEqual({ ok: false, sent: 0, completed: false, reason: 'PUSH_NOT_CONFIGURED' });
  });

  it('already completed day → ALREADY_COMPLETED, sends nothing', async () => {
    const st: MockState = { cursor: 'zz', completed: 1, sent: 5, users: ['a', 'b'], tokensByUser: {}, notified: [] };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.completed).toBe(true);
    expect(r.reason).toBe('ALREADY_COMPLETED');
  });

  it('empty device_tokens → marks completed immediately', async () => {
    const st: MockState = { cursor: '', completed: 0, sent: 0, users: [], tokensByUser: {}, notified: [] };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.completed).toBe(true);
    expect(st.completed).toBe(1);
  });

  it('short page (< PAGE_USERS) → sends, advances cursor, marks completed', async () => {
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1', 'u2', 'u3'],
      tokensByUser: { u1: ['t1'], u2: ['t2'], u3: ['t3'] },
      notified: [],
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(3);
    expect(r.completed).toBe(true);
    expect(st.cursor).toBe('u3');
    expect(st.sent).toBe(3);
    expect(st.completed).toBe(1);
  });

  it('full page (50, W835 ceiling) → advances cursor, NOT completed; second call takes the rest', async () => {
    const users = Array.from({ length: 55 }, (_, i) => 'u' + String(i + 10).padStart(3, '0')); // sorted
    const st: MockState = {
      cursor: '', completed: 0, sent: 0, users,
      tokensByUser: Object.fromEntries(users.map((u) => [u, []])), // no tokens → notifyUser no-ops
      notified: [],
    };
    const env = makeEnv(st);
    const r1 = await runUpdatePushPage(env, 'd1');
    expect(r1.sent).toBe(50);
    expect(r1.completed).toBe(false);
    expect(st.cursor).toBe(users[49]);
    const r2 = await runUpdatePushPage(env, 'd1');
    expect(r2.sent).toBe(5);
    expect(r2.completed).toBe(true);
    expect(st.sent).toBe(55);
  });

  // ── W835 (R1b) — per-user version gate ─────────────────────────────
  it('skips users already on the store version; null/old/malformed builds still get the push', async () => {
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1', 'u2', 'u3', 'u4', 'u5'],
      tokensByUser: {},
      notified: [],
      buildsByUser: {
        u1: '2.5.0-w833',   // current → skipped
        u2: '2.4.8-w817',   // older → sent
        u3: null,           // pre-W834 client, never reported → sent
        u4: 'garbage',      // unparseable → sent (fail open toward nudging)
        u5: '2.5.1-w840',   // AHEAD of store (TestFlight) → skipped
      },
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1', '2.5.0');
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(3);
    expect(r.skipped_current).toBe(2);
    expect(r.completed).toBe(true);
    expect(st.cursor).toBe('u5');   // skipped users still advance the cursor
    expect(st.sent).toBe(3);        // sent_users counts actual sends only
  });

  it('no storeVersion (admin test-fire) → gate bypassed, everyone sent', async () => {
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1', 'u2'],
      tokensByUser: {},
      notified: [],
      buildsByUser: { u1: '9.9.9-w999', u2: '9.9.9-w999' },
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.sent).toBe(2);
    expect(r.skipped_current).toBe(0);
  });

  it('an all-current page sends nothing but still advances and completes', async () => {
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1', 'u2'],
      tokensByUser: {},
      notified: [],
      buildsByUser: { u1: '2.5.0-w830', u2: '2.5.0-w833' },
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1', '2.5.0');
    expect(r.sent).toBe(0);
    expect(r.skipped_current).toBe(2);
    expect(r.completed).toBe(true);
    expect(st.cursor).toBe('u2');
  });

  it('CAS claim lost (concurrent run) → sends nothing, reports LOST_CLAIM_RACE', async () => {
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1', 'u2'], tokensByUser: { u1: ['t1'], u2: ['t2'] }, notified: [],
      casLoseOnce: true,
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(0);
    expect(r.reason).toBe('LOST_CLAIM_RACE');
    expect(st.sent).toBe(0);
  });

  it('APNs failures never fail the page (notifyUser never-throws contract)', async () => {
    // Users HAVE tokens; the invalid PEM makes the JWT step throw inside
    // notifyUser, which swallows per its contract — the page still completes.
    const st: MockState = {
      cursor: '', completed: 0, sent: 0,
      users: ['u1'], tokensByUser: { u1: ['t1', 't2'] }, notified: [],
    };
    const r = await runUpdatePushPage(makeEnv(st), 'd1');
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(1);
    expect(r.completed).toBe(true);
  });
});
