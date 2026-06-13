/**
 * public-profile-get.test.ts — GET /v1/users/:alias/profile (W-next).
 */
import { describe, expect, it } from 'vitest';
import { handlePublicProfileGet } from './public-profile-get';
import type { Env } from '../env';

const okRl = { limit: async () => ({ success: true }) };
const blockedRl = { limit: async () => ({ success: false }) };

function makeDb(row: Record<string, unknown> | null) {
  return {
    prepare: (sql: string) => ({
      bind: (..._a: unknown[]) => ({
        first: async () => row,
        all: async () => ({ results: [], success: true, meta: {} }),
        run: async () => ({ success: true, meta: {} }),
      }),
    }),
  } as unknown as D1Database;
}
function makeEnv(db: D1Database, rl = okRl): Env {
  return { DB: db, RL_FRIENDS_READ: rl } as unknown as Env;
}
const session = { userId: 'viewer-1' } as never;
const req = () => new Request('https://x/v1/users/rendiesel/profile', { method: 'GET' });

describe('GET /v1/users/:alias/profile', () => {
  it('returns the public card bundle and derives avg steps/day (÷7)', async () => {
    const db = makeDb({
      alias: 'rendiesel', rank_label: 'C I', rank_tier: 'C', power: 1782,
      avatar_id: 'avatar-warrior.png', arena_title: 'rt_reaver',
      bosses_slain_total: 60, ultra_rare_drops_total: 5,
      verified_streak_label: '27-night sleep streak',
      step_week: 94194, best_floor: 53,
    });
    const res = await handlePublicProfileGet(req(), makeEnv(db), session, 'rendiesel');
    expect(res.status).toBe(200);
    const b = await res.json() as Record<string, unknown>;
    expect(b.alias).toBe('rendiesel');
    expect(b.power).toBe(1782);
    expect(b.avatarId).toBe('avatar-warrior.png');
    expect(b.bossesSlain).toBe(60);
    expect(b.bestFloor).toBe(53);
    expect(b.avgStepsPerDay).toBe(Math.round(94194 / 7)); // 13456
    expect('rankPoints' in b).toBe(false); // exact XP never exposed
  });

  it('coalesces nulls (no profile summary yet) to safe defaults', async () => {
    const db = makeDb({
      alias: 'newbie', rank_label: null, rank_tier: null, power: null,
      avatar_id: null, arena_title: null, bosses_slain_total: null,
      ultra_rare_drops_total: null, verified_streak_label: null,
      step_week: null, best_floor: null,
    });
    const res = await handlePublicProfileGet(req(), makeEnv(db), session, 'newbie');
    const b = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(b.power).toBe(0);
    expect(b.bossesSlain).toBe(0);
    expect(b.bestFloor).toBe(0);
    expect(b.avgStepsPerDay).toBe(0);
    expect(b.avatarId).toBeNull();
  });

  it('404s an unknown alias', async () => {
    const res = await handlePublicProfileGet(req(), makeEnv(makeDb(null)), session, 'ghost');
    expect(res.status).toBe(404);
  });

  it('rate-limits', async () => {
    const res = await handlePublicProfileGet(req(), makeEnv(makeDb(null), blockedRl), session, 'x');
    expect(res.status).toBe(429);
  });
});
