/**
 * leaderboard-archive.test.ts — W658 week-flipper endpoint.
 *
 * Validation (the one membership check enforcing Sunday key + past-only +
 * the 8-week cap), the min_week clamp, and the board passthrough off the
 * durable merged view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleLeaderboardArchiveGet, archiveWeekKeys, ARCHIVE_WEEKS_CAP } from './leaderboard-archive';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

// Frozen clock: Wednesday 2026-07-15 12:00 UTC → currentWeek 2026-07-12.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const CUR_WEEK = '2026-07-12';
const WEEK = '2026-07-05';          // newest archivable
const OLDEST = '2026-05-17';        // prior^8 of 2026-07-12

const SESSION: SessionPayload = { userId: 'u-me' } as SessionPayload;

function makeEnv(opts: {
  minWeek?: string | null;
  rows?: Array<{ alias: string; steps: number; user_id: string }>;
  mySteps?: number | null;
}): Env {
  const db = {
    prepare: (sql: string) => {
      const stmt = (binds: unknown[]) => ({
        first: async () => {
          if (/MIN\(week_start\)/.test(sql)) return { min_week: opts.minWeek ?? null };
          if (/AS my_steps/.test(sql)) {
            const mySteps = opts.mySteps ?? null;
            const rows = opts.rows ?? [];
            const above = mySteps == null ? 0 : rows.filter((r) => r.steps > mySteps).length;
            return { my_steps: mySteps, total: rows.length, above };
          }
          return null;
        },
        all: async () => {
          if (/ORDER BY m\.steps DESC/.test(sql)) return { results: opts.rows ?? [], success: true, meta: {} };
          return { results: [], success: true, meta: {} };
        },
        run: async () => ({ success: true, meta: { changes: 0 } }),
      });
      return {
        bind: (...binds: unknown[]) => stmt(binds),
        // MIN(week_start) has no binds — D1 allows first() straight off prepare.
        first: async () => (/MIN\(week_start\)/.test(sql) ? { min_week: opts.minWeek ?? null } : null),
      };
    },
  };
  return { DB: db, RL_LEADERBOARD_HOF: { limit: async () => ({ success: true }) } } as unknown as Env;
}

function req(week: string | null): Request {
  const q = week === null ? '' : '?week=' + encodeURIComponent(week);
  return new Request('https://x/v1/leaderboard/archive' + q);
}

async function getJson(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('archiveWeekKeys', () => {
  it('yields exactly the last 8 finished Sunday keys, newest first', () => {
    const keys = archiveWeekKeys(CUR_WEEK);
    expect(keys.length).toBe(ARCHIVE_WEEKS_CAP);
    expect(keys[0]).toBe(WEEK);
    expect(keys[7]).toBe(OLDEST);
    expect(keys).not.toContain(CUR_WEEK);
  });
});

describe('GET /v1/leaderboard/archive', () => {
  it('returns the finished week board with FINAL + weeks_available', async () => {
    const env = makeEnv({
      minWeek: '2026-06-07',
      rows: [
        { alias: 'RenDIESEL', steps: 125563, user_id: 'u-r' },
        { alias: 'me', steps: 48535, user_id: 'u-me' },
      ],
      mySteps: 48535,
    });
    const j = await getJson(await handleLeaderboardArchiveGet(req(WEEK), env, SESSION));
    expect(j.week).toBe(WEEK);
    expect(j.weekEnd).toBe('2026-07-11');
    expect(j.final).toBe(true);
    expect(j.records[0]).toEqual({ rank: 1, alias: 'RenDIESEL', steps: 125563, avatar_id: null, card_bg: null });   // W704 crest + W706 card_bg ride the archive rows
    expect(j.me).toEqual({ rank: 2, steps: 48535 });
    expect(j.min_week).toBe('2026-06-07');
    // weeks_available bounded below by min_week, newest first.
    expect(j.weeks_available[0]).toBe(WEEK);
    expect(j.weeks_available.every((k: string) => k >= '2026-06-07')).toBe(true);
  });

  it('rejects the CURRENT (live) week — the flipper never fakes a FINAL badge on a live race', async () => {
    const res = await handleLeaderboardArchiveGet(req(CUR_WEEK), makeEnv({}), SESSION);
    expect(res.status).toBe(400);
  });

  it('rejects weeks beyond the 8-week cap', async () => {
    const res = await handleLeaderboardArchiveGet(req('2026-05-10'), makeEnv({}), SESSION);   // prior^9
    expect(res.status).toBe(400);
  });

  it('rejects non-Sunday keys, malformed strings, and a missing param', async () => {
    expect((await handleLeaderboardArchiveGet(req('2026-07-07'), makeEnv({}), SESSION)).status).toBe(400); // a Tuesday
    expect((await handleLeaderboardArchiveGet(req('garbage'), makeEnv({}), SESSION)).status).toBe(400);
    expect((await handleLeaderboardArchiveGet(req(null), makeEnv({}), SESSION)).status).toBe(400);
  });

  it('clamps min_week to the cap window when records are older than the cap', async () => {
    const env = makeEnv({ minWeek: '2026-01-04', rows: [], mySteps: null });
    const j = await getJson(await handleLeaderboardArchiveGet(req(WEEK), env, SESSION));
    expect(j.min_week).toBe(OLDEST);                 // clamped up to prior^8
    expect(j.weeks_available.length).toBe(ARCHIVE_WEEKS_CAP);
  });

  it('empty table → min_week = the oldest allowed key (no fake history)', async () => {
    const j = await getJson(await handleLeaderboardArchiveGet(req(WEEK), makeEnv({ minWeek: null }), SESSION));
    expect(j.min_week).toBe(OLDEST);
  });

  it('SERVER-ENFORCED floor: a cap-window week BELOW min_week is rejected, never a sims-only 200', async () => {
    // Earliest real record 2026-06-07; 2026-05-24 is inside the 8-week cap
    // but pre-launch — must 400 so the client sim merge can't fabricate it.
    const env = makeEnv({ minWeek: '2026-06-07' });
    expect((await handleLeaderboardArchiveGet(req('2026-05-24'), env, SESSION)).status).toBe(400);
    // And the floor week itself is fine.
    expect((await handleLeaderboardArchiveGet(req('2026-06-07'), env, SESSION)).status).toBe(200);
  });
});
