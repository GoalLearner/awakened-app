/**
 * steps-rank.test.ts — W1212: the Briefing's step ranking is computed once into steps_rank_cache
 * (by the cron) and read from there, instead of every Worker isolate scanning every cloud save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleStepsRank, refreshStepRankCache, _resetStepRankCache } from './steps-rank';
import { stepRankWindow } from '../lib/step-rank';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

const NOW = Date.UTC(2026, 10, 14, 20, 0, 0);   // Sat 2026-11-14 12:00 PST
const days = stepRankWindow(NOW);
const daily = (n: number) => JSON.stringify(Object.fromEntries(days.map((d) => [d, n])));

interface Shared { first_day: string; averages_json: string; computed_at: number }
function makeEnv(shared: Shared | null, saves: { u: string; d: string }[], log: string[]) {
  let row = shared;
  const db = {
    prepare: (sql: string) => {
      log.push(sql);
      const stmt = (args: unknown[]) => ({
        first: async () => (sql.includes('FROM steps_rank_cache') ? row : null),
        all: async () => (sql.includes('FROM user_state_snapshots') ? { results: saves } : { results: [] }),
        run: async () => {
          if (sql.includes('INSERT INTO steps_rank_cache')) row = { first_day: args[0] as string, averages_json: args[1] as string, computed_at: args[2] as number };
          return { success: true, meta: { changes: 1 } };
        },
      });
      return { bind: (...args: unknown[]) => stmt(args), ...stmt([]) };
    },
  } as unknown as D1Database;
  const env = { DB: db, RL_LEADERBOARD_TOP: { limit: async () => ({ success: true }) } } as unknown as Env;
  return { env, shared: () => row };
}
const session = (userId: string) => ({ userId } as unknown as SessionPayload);
const req = () => new Request('http://test/v1/steps/rank');
const scans = (log: string[]) => log.filter((s) => s.includes('FROM user_state_snapshots')).length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  _resetStepRankCache();
});
afterEach(() => vi.useRealTimers());

describe('GET /v1/steps/rank — one shared ranking (W1212)', () => {
  it('a fresh shared row is served without scanning a single save', async () => {
    const log: string[] = [];
    const { env } = makeEnv({ first_day: days[0], averages_json: JSON.stringify([{ u: 'a', a: 9000 }, { u: 'me', a: 7000 }, { u: 'b', a: 5000 }]), computed_at: NOW - 10 * 60_000 }, [], log);
    const res = await handleStepsRank(req(), env, session('me'));
    const body = (await res.json()) as { others: number[]; days: string[] };
    expect(body.others).toEqual([9000, 5000]);   // the caller is left out
    expect(body.days).toEqual([days[0], days[days.length - 1]]);
    expect(scans(log)).toBe(0);
  });

  it('no row (or one from another window, or one the cron left 45+ minutes old) → this isolate scans once and writes the row', async () => {
    for (const shared of [null, { first_day: '2026-01-01', averages_json: '[]', computed_at: NOW }, { first_day: days[0], averages_json: '[]', computed_at: NOW - 46 * 60_000 }]) {
      _resetStepRankCache();
      const log: string[] = [];
      const m = makeEnv(shared, [{ u: 'a', d: daily(8000) }, { u: 'me', d: daily(6000) }], log);
      const body = (await (await handleStepsRank(req(), m.env, session('me'))).json()) as { others: number[] };
      expect(body.others).toEqual([8000]);
      expect(scans(log)).toBe(1);
      expect(m.shared()!.first_day).toBe(days[0]);
      expect(JSON.parse(m.shared()!.averages_json)).toEqual([{ u: 'a', a: 8000 }, { u: 'me', a: 6000 }]);
    }
  });

  it('the isolate keeps its copy for 15 minutes: a second call reads nothing', async () => {
    const log: string[] = [];
    const { env } = makeEnv(null, [{ u: 'a', d: daily(8000) }], log);
    await handleStepsRank(req(), env, session('me'));
    const before = log.length;
    await handleStepsRank(req(), env, session('me'));
    expect(log.length).toBe(before);
  });
});

describe('refreshStepRankCache — the cron half (W1212)', () => {
  it('a row under 15 minutes old is left alone (one read, no scan)', async () => {
    const log: string[] = [];
    const { env } = makeEnv({ first_day: days[0], averages_json: '[]', computed_at: NOW - 5 * 60_000 }, [{ u: 'a', d: daily(8000) }], log);
    expect(await refreshStepRankCache(env, NOW)).toBe(false);
    expect(scans(log)).toBe(0);
  });

  it('an old row, another window, or none is recomputed and written', async () => {
    for (const shared of [null, { first_day: days[0], averages_json: '[]', computed_at: NOW - 16 * 60_000 }, { first_day: '2026-01-01', averages_json: '[]', computed_at: NOW }]) {
      const log: string[] = [];
      const m = makeEnv(shared, [{ u: 'a', d: daily(8000) }, { u: 'b', d: daily(12000) }], log);
      expect(await refreshStepRankCache(m.env, NOW)).toBe(true);
      expect(JSON.parse(m.shared()!.averages_json)).toEqual([{ u: 'b', a: 12000 }, { u: 'a', a: 8000 }]);
      expect(m.shared()!.computed_at).toBe(NOW);
    }
  });
});
