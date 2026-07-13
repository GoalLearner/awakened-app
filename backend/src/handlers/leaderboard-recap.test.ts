/**
 * leaderboard-recap.test.ts — W657 Week Recap handler logic.
 *
 * Mock-based (substring-routed D1) coverage of the handler's decisions:
 * eligibility, seen flag, week-key math, zero-activity, and the seen POST's
 * validation. The SQL-level guarantees (double-grant idempotency, seen
 * high-water) are proven against REAL SQLite in weekly-champion.itest.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleLeaderboardRecapGet, handleLeaderboardRecapSeenPost } from './leaderboard-recap';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

// Frozen clock: Wednesday 2026-07-15 12:00 UTC → currentWeek 2026-07-12,
// finished week 2026-07-05, movement baseline 2026-06-28 (Pacific anchor).
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const CUR_WEEK = '2026-07-12';
const WEEK = '2026-07-05';
const PREV_WEEK = '2026-06-28';

const SESSION: SessionPayload = { userId: 'u-me' } as SessionPayload;

interface MockOpts {
  createdAt?: number;                 // users.created_at (default: long ago)
  recapSeenWeek?: string | null;
  boards?: Record<string, { rows: Array<{ alias: string; steps: number; user_id: string }>; mySteps: number | null }>;
  history?: { ordinal: number; totalWeeks: number };
  seenUpdates?: Array<{ week: string; user: string }>;   // captures POST writes
}

function makeEnv(opts: MockOpts): Env {
  const boards = opts.boards ?? {};
  const seenUpdates = opts.seenUpdates ?? [];
  let seenValue: string | null = opts.recapSeenWeek ?? null;
  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => ({
        first: async () => {
          if (/SELECT created_at, recap_seen_week FROM users/.test(sql)) {
            return { created_at: opts.createdAt ?? Date.UTC(2026, 0, 1), recap_seen_week: seenValue };
          }
          if (/AS my_steps/.test(sql)) {
            const wk = String(binds[0]);
            const b = boards[wk] ?? { rows: [], mySteps: null };
            const above = b.mySteps == null ? 0
              : b.rows.filter((r) => r.steps > (b.mySteps as number)).length;
            return { my_steps: b.mySteps, total: b.rows.length + (b.mySteps != null && !b.rows.some(r => r.user_id === 'u-me') ? 1 : 0), above };
          }
          if (/my_rows/.test(sql)) {
            return opts.history ?? { ordinal: 1, totalWeeks: 1 };
          }
          if (/FROM user_accolades/.test(sql)) return null;   // champion path: no prior crown
          if (/SELECT recap_seen_week FROM users/.test(sql)) {
            return { recap_seen_week: seenValue };
          }
          return null;
        },
        all: async () => {
          if (/ORDER BY m\.steps DESC/.test(sql)) {
            const wk = String(binds[0]);
            const b = boards[wk] ?? { rows: [], mySteps: null };
            return { results: b.rows, success: true, meta: {} };
          }
          return { results: [], success: true, meta: {} };
        },
        run: async () => {
          if (/UPDATE users SET recap_seen_week/.test(sql)) {
            const wk = String(binds[0]);
            seenUpdates.push({ week: wk, user: String(binds[1]) });
            // emulate the high-water MAX for the read-back
            if (!seenValue || wk > seenValue) seenValue = wk;
          }
          return { success: true, meta: { changes: 1 } };
        },
      }),
    }),
  };
  return {
    DB: db,
    RL_LEADERBOARD_HOF: { limit: async () => ({ success: true }) },
  } as unknown as Env;
}

async function getJson(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('GET /v1/leaderboard/recap', () => {
  it('returns the finished week + movement baseline off the durable merged view', async () => {
    const env = makeEnv({
      boards: {
        [WEEK]: {
          rows: [
            { alias: 'rendiesel', steps: 125563, user_id: 'u-r' },
            { alias: 'me', steps: 68400, user_id: 'u-me' },
            { alias: 'anthony', steps: 61000, user_id: 'u-a' },
          ],
          mySteps: 68400,
        },
        [PREV_WEEK]: {
          rows: [
            { alias: 'rendiesel', steps: 110000, user_id: 'u-r' },
            { alias: 'anthony', steps: 70000, user_id: 'u-a' },
            { alias: 'me', steps: 50000, user_id: 'u-me' },
          ],
          mySteps: 50000,
        },
      },
      history: { ordinal: 2, totalWeeks: 9 },
    });
    const res = await handleLeaderboardRecapGet(new Request('https://x/v1/leaderboard/recap'), env, SESSION);
    expect(res.status).toBe(200);
    const j = await getJson(res);
    expect(j.eligible).toBe(true);
    expect(j.seen).toBe(false);
    expect(j.week).toBe(WEEK);
    expect(j.weekEnd).toBe('2026-07-11');
    expect(j.records[0].alias).toBe('rendiesel');
    expect(j.records[0].rank).toBe(1);
    expect(j.me).toEqual({ rank: 2, steps: 68400 });
    expect(j.prev.week).toBe(PREV_WEEK);
    expect(j.prev.me).toEqual({ rank: 3, steps: 50000 });
    expect(j.myHistory).toEqual({ ordinal: 2, totalWeeks: 9 });
    expect(j.myTitle).toBe(null);        // rank 2 — no crown
  });

  it('brand-new-this-week account → eligible:false (no recap, straight to live board)', async () => {
    // Created Tuesday of the CURRENT week.
    const env = makeEnv({ createdAt: Date.UTC(2026, 6, 14, 18, 0, 0) });
    const j = await getJson(await handleLeaderboardRecapGet(new Request('https://x'), env, SESSION));
    expect(j.eligible).toBe(false);
    expect(j.seen).toBe(true);
  });

  it('already-dismissed recap → seen:true (client shows nothing)', async () => {
    const env = makeEnv({ recapSeenWeek: WEEK, boards: {} });
    const j = await getJson(await handleLeaderboardRecapGet(new Request('https://x'), env, SESSION));
    expect(j.eligible).toBe(true);
    expect(j.seen).toBe(true);
  });

  it('an OLDER seen mark does not suppress the newest week (missed-weeks rule)', async () => {
    const env = makeEnv({ recapSeenWeek: '2026-06-21', boards: {} });
    const j = await getJson(await handleLeaderboardRecapGet(new Request('https://x'), env, SESSION));
    expect(j.seen).toBe(false);          // 2026-07-05 recap still owed — most recent only
    expect(j.week).toBe(WEEK);
  });

  it('zero-activity week → eligible with me:null (the forward-framed variant)', async () => {
    const env = makeEnv({
      boards: { [WEEK]: { rows: [{ alias: 'rendiesel', steps: 125563, user_id: 'u-r' }], mySteps: null } },
    });
    const j = await getJson(await handleLeaderboardRecapGet(new Request('https://x'), env, SESSION));
    expect(j.eligible).toBe(true);
    expect(j.me).toBe(null);
    expect(j.records.length).toBe(1);    // the podium still shows the world's ceremony
  });

  it('rank-1 caller gets the crown via the shared idempotent path', async () => {
    const env = makeEnv({
      boards: { [WEEK]: { rows: [{ alias: 'me', steps: 90000, user_id: 'u-me' }], mySteps: 90000 } },
    });
    const j = await getJson(await handleLeaderboardRecapGet(new Request('https://x'), env, SESSION));
    expect(j.me.rank).toBe(1);
    expect(j.myTitle).toEqual({ count: 1, isNew: true });
  });
});

describe('POST /v1/leaderboard/recap/seen', () => {
  function post(body: unknown): Request {
    return new Request('https://x/v1/leaderboard/recap/seen', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  it('marks a finished week and echoes the stored high-water', async () => {
    const seenUpdates: Array<{ week: string; user: string }> = [];
    const env = makeEnv({ seenUpdates });
    const res = await handleLeaderboardRecapSeenPost(post({ week: WEEK }), env, SESSION);
    expect(res.status).toBe(200);
    const j = await getJson(res);
    expect(seenUpdates).toEqual([{ week: WEEK, user: 'u-me' }]);
    expect(j.recap_seen_week).toBe(WEEK);
  });

  it('rejects an unfinished (current/future) week — clock-ahead clients cannot pre-mark', async () => {
    const env = makeEnv({});
    expect((await handleLeaderboardRecapSeenPost(post({ week: CUR_WEEK }), env, SESSION)).status).toBe(400);
    expect((await handleLeaderboardRecapSeenPost(post({ week: '2027-01-03' }), env, SESSION)).status).toBe(400);
  });

  it('rejects malformed weeks and bodies', async () => {
    const env = makeEnv({});
    expect((await handleLeaderboardRecapSeenPost(post({ week: 'nope' }), env, SESSION)).status).toBe(400);
    expect((await handleLeaderboardRecapSeenPost(post({}), env, SESSION)).status).toBe(400);
    const bad = new Request('https://x', { method: 'POST', body: '{not json' });
    expect((await handleLeaderboardRecapSeenPost(bad, env, SESSION)).status).toBe(400);
  });
});
