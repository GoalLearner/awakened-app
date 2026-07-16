/**
 * coop-pacts.test.ts — GET /v1/coop-boss/pacts (W664 Phase 2).
 *
 * Read-only handler over coop_boss_instances. Same hand-rolled substring-routed
 * D1 mock shape as the other handler tests; the streak MATH is covered
 * exhaustively in lib/pact-streak.test.ts, so these assert the handler wiring:
 * auth rate-limit, the wins-only query, and the response envelope.
 */
import { describe, expect, it } from 'vitest';
import { handleCoopPacts } from './coop-pacts';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

type Row = { challenger_user_id: string; partner_user_id: string; partner2_user_id?: string | null; boss_id: string; resolved_at: string };

function makeDb(rows: Row[], sqlLog?: string[]) {
  return {
    prepare: (sql: string) => {
      sqlLog?.push(sql);
      return {
        bind: () => ({
          all: async () => ({ results: rows, success: true, meta: {} }),
          first: async () => null,
          run: async () => ({ success: true, meta: { changes: 0 } }),
        }),
      };
    },
  } as unknown as D1Database;
}

function makeEnv(db: D1Database, rlOk = true): Env {
  return {
    DB: db,
    RL_FRIENDS_READ: { limit: async () => ({ success: rlOk }) },
  } as unknown as Env;
}

function session(userId: string): SessionPayload {
  return { userId, alias: 'tester' } as unknown as SessionPayload;
}

const req = () => new Request('http://test/v1/coop-boss/pacts', { method: 'GET' });

describe('GET /v1/coop-boss/pacts', () => {
  it('returns ok + a per-friend pact map + the server Pacific day', async () => {
    const rows: Row[] = [
      { challenger_user_id: 'u1', partner_user_id: 'friendA', boss_id: 'the_twin_maw', resolved_at: '2026-07-13 20:00:00' },
      { challenger_user_id: 'friendA', partner_user_id: 'u1', boss_id: 'the_twin_maw', resolved_at: '2026-07-14 20:00:00' },
    ];
    const res = await handleCoopPacts(req(), makeEnv(makeDb(rows)), session('u1'));
    const body = (await res.json()) as { ok: boolean; day: string; pacts: Record<string, { streak: number; total: number }> };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.day).toBe('string');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(body.day)).toBe(true);
    // symmetric pair collapses to one bond; two consecutive PT days → streak 2
    expect(Object.keys(body.pacts)).toEqual(['friendA']);
    expect(body.pacts['friendA']).toMatchObject({ streak: 2, total: 2 });
  });

  it('returns an empty pact map when the user has no co-op wins', async () => {
    const res = await handleCoopPacts(req(), makeEnv(makeDb([])), session('u1'));
    const body = (await res.json()) as { ok: boolean; pacts: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.pacts).toEqual({});
  });

  it('429s when the read rate-limit rejects', async () => {
    const res = await handleCoopPacts(req(), makeEnv(makeDb([]), false), session('u1'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(429);
    expect(body.error).toBe('RATE_LIMITED');
  });

  it('queries only WINS the caller participated in (any seat, incl. trio partner2)', async () => {
    const log: string[] = [];
    await handleCoopPacts(req(), makeEnv(makeDb([], log)), session('u1'));
    const sql = log.find((s) => s.includes('FROM coop_boss_instances'));
    expect(sql).toBeTruthy();
    expect(sql).toMatch(/status = 'completed' AND result = 'success'/);
    // W677 — one positional param probes all three participant seats.
    expect(sql).toMatch(/challenger_user_id = \?1 OR partner_user_id = \?1 OR partner2_user_id = \?1/);
    expect(sql).toMatch(/SELECT challenger_user_id, partner_user_id, partner2_user_id/);
  });

  // W677 — a TRIO win is one row but must credit the viewer's pact with BOTH
  // other hunters (each pair's flame advances off the same instance).
  it('credits a trio win to both of the viewer’s pacts', async () => {
    const rows: Row[] = [
      { challenger_user_id: 'u1', partner_user_id: 'friendA', partner2_user_id: 'friendB', boss_id: 'the_threefold_court', resolved_at: '2026-07-14 20:00:00' },
    ];
    const res = await handleCoopPacts(req(), makeEnv(makeDb(rows)), session('u1'));
    const body = (await res.json()) as { ok: boolean; pacts: Record<string, { streak: number; total: number }> };
    expect(body.ok).toBe(true);
    expect(Object.keys(body.pacts).sort()).toEqual(['friendA', 'friendB']);
    expect(body.pacts['friendA']).toMatchObject({ streak: 1, total: 1 });
    expect(body.pacts['friendB']).toMatchObject({ streak: 1, total: 1 });
  });

  // W677 — an invited ally (partner2 seat) sees the summoner AND the other ally.
  it('a partner2 viewer gets pacts with both other hunters', async () => {
    const rows: Row[] = [
      { challenger_user_id: 'friendA', partner_user_id: 'friendB', partner2_user_id: 'u1', boss_id: 'the_threefold_court', resolved_at: '2026-07-14 20:00:00' },
      { challenger_user_id: 'friendA', partner_user_id: 'u1', boss_id: 'the_twin_maw', resolved_at: '2026-07-13 20:00:00' },
    ];
    const res = await handleCoopPacts(req(), makeEnv(makeDb(rows)), session('u1'));
    const body = (await res.json()) as { ok: boolean; pacts: Record<string, { streak: number; total: number; daysBonded: number }> };
    expect(Object.keys(body.pacts).sort()).toEqual(['friendA', 'friendB']);
    // duo win on 7/13 + trio win on 7/14 with friendA → consecutive-day streak 2
    expect(body.pacts['friendA']).toMatchObject({ streak: 2, total: 2, daysBonded: 2 });
    expect(body.pacts['friendB']).toMatchObject({ streak: 1, total: 1, daysBonded: 1 });
  });
});
