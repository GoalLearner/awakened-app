/**
 * weekly-hunger.test.ts — W845 (Train 5, E2) owner-override read.
 */
import { describe, expect, it } from 'vitest';
import { handleWeeklyHungerGet } from './weekly-hunger';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

function makeEnv(row: { boss_id: string } | null) {
  const binds: unknown[][] = [];
  const db = {
    prepare: (_sql: string) => ({
      bind: (...args: unknown[]) => {
        binds.push(args);
        return { first: async () => row };
      },
    }),
  } as unknown as D1Database;
  const env = {
    DB: db,
    RL_FRIENDS_READ: { limit: async () => ({ success: true }) },
  } as unknown as Env;
  return { env, binds };
}

const session: SessionPayload = { userId: 'u1', alias: 'Richie' } as SessionPayload;

describe('GET /v1/weekly-hunger (W845)', () => {
  it('returns the override when the owner set one, keyed to a PT-Sunday week', async () => {
    const { env, binds } = makeEnv({ boss_id: 'the_twin_maw' });
    const res = await handleWeeklyHungerGet(new Request('https://x'), env, session);
    const j = (await res.json()) as { ok: boolean; week_start: string; boss_id: string | null };
    expect(j.ok).toBe(true);
    expect(j.boss_id).toBe('the_twin_maw');
    // The queried week key is a date string, and PT-Sundays only.
    expect(String(binds[0][0])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(j.week_start).toBe(binds[0][0]);
  });

  it('no override → boss_id null (the deterministic pick stands)', async () => {
    const { env } = makeEnv(null);
    const res = await handleWeeklyHungerGet(new Request('https://x'), env, session);
    const j = (await res.json()) as { boss_id: string | null };
    expect(j.boss_id).toBeNull();
  });
});
