/**
 * win-back.test.ts — W836 (Train 3, R2) server-side win-back push: hour gate,
 * claim-before-send idempotency, and the not-configured no-op. Hand-rolled
 * substring-routed D1 mock (same pattern as update-push.test.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sweepWinBackPushes, WIN_BACK_NOTIF } from './win-back';
import type { Env } from '../env';

interface MockState {
  candidates: { user_id: string; last_open: string }[];
  claimed: Set<string>; // 'user|date' keys already in win_back_pushes
  inserts: string[];    // claim attempts that WON
  tokenReads: string[]; // notifyUser per-user token lookups
}

function makeEnv(state: MockState): Env {
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (/INSERT OR IGNORE INTO win_back_pushes/.test(sql)) {
            const key = `${args[0]}|${args[1]}`;
            if (state.claimed.has(key)) return { success: true, meta: { changes: 0 } };
            state.claimed.add(key);
            state.inserts.push(key);
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 1 } };
        },
        all: async () => {
          if (/FROM device_tokens/.test(sql)) {
            state.tokenReads.push(args[0] as string);
            return { results: [], success: true, meta: {} }; // no tokens → notifyUser no-ops
          }
          return { results: [], success: true, meta: {} };
        },
        first: async () => null,
      }),
      // The candidates query is bound with no args (LIMIT inlined).
      all: async () => ({ results: state.candidates, success: true, meta: {} }),
      run: async () => ({ success: true, meta: { changes: 0 } }),
      first: async () => null,
    }),
  } as unknown as D1Database;
  return {
    DB: db,
    APNS_AUTH_KEY: 'invalid-pem',
    APNS_KEY_ID: 'KEYID12345',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_BUNDLE_ID: 'com.goallearner.awakened',
  } as unknown as Env;
}

afterEach(() => vi.restoreAllMocks());

describe('sweepWinBackPushes (W836)', () => {
  it('off-hour → no-op without touching the DB', async () => {
    const st: MockState = { candidates: [{ user_id: 'u1', last_open: '2026-08-10' }], claimed: new Set(), inserts: [], tokenReads: [] };
    const r = await sweepWinBackPushes(makeEnv(st), 9);
    expect(r).toEqual({ ok: true, sent: 0, reason: 'OFF_HOUR' });
    expect(st.inserts.length).toBe(0);
  });

  it('push not configured → PUSH_NOT_CONFIGURED', async () => {
    const env = { DB: {} } as unknown as Env;
    const r = await sweepWinBackPushes(env, 10);
    expect(r.reason).toBe('PUSH_NOT_CONFIGURED');
  });

  it('claims each (user, lapse) before sending; already-claimed rows are skipped', async () => {
    const st: MockState = {
      candidates: [
        { user_id: 'u1', last_open: '2026-08-12' },
        { user_id: 'u2', last_open: '2026-08-10' },
      ],
      claimed: new Set(['u2|2026-08-10']), // a concurrent run already nudged u2's lapse
      inserts: [], tokenReads: [],
    };
    const r = await sweepWinBackPushes(makeEnv(st), 10);
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(1);
    expect(st.inserts).toEqual(['u1|2026-08-12']);
    expect(st.tokenReads).toEqual(['u1']); // only the claim winner reaches notifyUser
  });

  it('no candidates → clean zero', async () => {
    const st: MockState = { candidates: [], claimed: new Set(), inserts: [], tokenReads: [] };
    const r = await sweepWinBackPushes(makeEnv(st), 10);
    expect(r).toEqual({ ok: true, sent: 0 });
  });

  it('copy carries no banned words and the win_back type', () => {
    expect(/\bfell(ed)?\b/i.test(WIN_BACK_NOTIF.title + ' ' + WIN_BACK_NOTIF.body)).toBe(false);
    expect(WIN_BACK_NOTIF.type).toBe('win_back');
  });
});
