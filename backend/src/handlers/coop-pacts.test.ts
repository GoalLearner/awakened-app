/**
 * coop-pacts.test.ts — GET /v1/coop-boss/pacts (W664 Phase 2).
 *
 * Read-only handler over coop_boss_instances. Same hand-rolled substring-routed
 * D1 mock shape as the other handler tests; the streak MATH is covered
 * exhaustively in lib/pact-streak.test.ts, so these assert the handler wiring:
 * auth rate-limit, the W813 attempts query (started hunts, win or lose), and
 * the response envelope.
 */
import { describe, expect, it } from 'vitest';
import { handleCoopPacts } from './coop-pacts';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

type Row = {
  id?: string;
  challenger_user_id: string;
  partner_user_id: string;
  partner2_user_id?: string | null;
  // W692 — an explicit N-hunter roster (non-challenger hunters). When omitted the
  // mock derives it from the legacy partner/partner2 columns (duo/trio rows).
  party?: string[];
  boss_id: string;
  resolved_at: string;
  // W813 — attempt anchor + outcome flag (rows without them exercise the legacy
  // fallback: resolved_at as the day anchor, undefined is_win treated as a win).
  starts_at?: string;
  is_win?: number;
};

// W692 — the handler now issues TWO queries: the wins over coop_boss_instances, then
// the roster over coop_boss_participants. This SQL-routed mock answers each: the
// instances query returns the win rows (with a synthesized id); the participants query
// returns {instance_id, user_id} for every non-challenger hunter of each win.
function makeDb(rows: Row[], sqlLog?: string[]) {
  const insts = rows.map((r, i) => ({ ...r, id: r.id ?? `inst${i}` }));
  return {
    prepare: (sql: string) => {
      sqlLog?.push(sql);
      // Route on the roster query's distinctive SELECT — the instances query also
      // mentions coop_boss_participants (in its EXISTS membership subquery).
      const isParticipants = sql.includes('SELECT instance_id, user_id FROM coop_boss_participants');
      return {
        bind: () => ({
          all: async () => {
            if (isParticipants) {
              const prows: { instance_id: string; user_id: string }[] = [];
              for (const r of insts) {
                const allies =
                  r.party ?? [r.partner_user_id, r.partner2_user_id].filter((x): x is string => !!x);
                for (const uid of allies) prows.push({ instance_id: r.id, user_id: uid });
              }
              return { results: prows, success: true, meta: {} };
            }
            return { results: insts, success: true, meta: {} };
          },
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

  it('queries STARTED hunts the caller participated in (W813 — win or lose), with is_win riding along', async () => {
    const log: string[] = [];
    await handleCoopPacts(req(), makeEnv(makeDb([], log)), session('u1'));
    const sql = log.find((s) => s.includes('FROM coop_boss_instances'));
    expect(sql).toBeTruthy();
    // W813 — the pact counts attempts: any instance that actually began.
    expect(sql).toMatch(/i\.starts_at IS NOT NULL/);
    expect(sql).not.toMatch(/WHERE i\.status = 'completed'/);
    // …while the Bond still needs the outcome, so is_win is computed in-query.
    expect(sql).toMatch(/CASE WHEN i\.status = 'completed' AND i\.result = 'success' THEN 1 ELSE 0 END AS is_win/);
    expect(sql).toMatch(/ORDER BY i\.starts_at DESC/);
    // W692 — membership is challenger OR a participant row (raid seats 4/5 have no
    // legacy partner column), so the filter probes the participant table.
    expect(sql).toMatch(/i\.challenger_user_id = \?1/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM coop_boss_participants p WHERE p\.instance_id = i\.id AND p\.user_id = \?1\)/);
    expect(sql).toMatch(/SELECT i\.id, i\.challenger_user_id, i\.partner_user_id, i\.partner2_user_id/);
  });

  // W813 — a LOSS keeps the flame: attempted hunts extend the streak; only wins
  // count toward the Bond (total).
  it('a lost hunt extends the streak but not the Bond', async () => {
    const rows: Row[] = [
      { challenger_user_id: 'u1', partner_user_id: 'friendA', boss_id: 'the_twin_maw', starts_at: '2026-07-13T20:00:00Z', resolved_at: '2026-07-14 20:00:00', is_win: 1 },
      { challenger_user_id: 'u1', partner_user_id: 'friendA', boss_id: 'the_twin_maw', starts_at: '2026-07-14T20:00:00Z', resolved_at: '2026-07-15 20:00:00', is_win: 0 },
    ];
    const res = await handleCoopPacts(req(), makeEnv(makeDb(rows)), session('u1'));
    const body = (await res.json()) as { ok: boolean; pacts: Record<string, { streak: number; total: number; daysBonded: number }> };
    expect(body.ok).toBe(true);
    // Start days 7/13 + 7/14 (PT) are consecutive → streak 2; only one WIN → Bond 1.
    expect(body.pacts['friendA']).toMatchObject({ streak: 2, total: 1, daysBonded: 2 });
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

  // W692 — a 5-hunter raid win credits the viewer's pact with ALL FOUR co-hunters,
  // including seats 4/5 (which have NO legacy partner column — sourced from the
  // participant roster). The challenger here is a co-hunter; the viewer is a seat-4 ally.
  it('credits a 5-hunter raid win to all four co-hunters (incl. no-legacy-column seats)', async () => {
    const rows: Row[] = [
      {
        challenger_user_id: 'friendA',
        partner_user_id: 'friendB',
        partner2_user_id: 'friendC',
        party: ['friendB', 'friendC', 'u1', 'friendD'],
        boss_id: 'the_grinning_god',
        resolved_at: '2026-07-15 20:00:00',
      },
    ];
    const res = await handleCoopPacts(req(), makeEnv(makeDb(rows)), session('u1'));
    const body = (await res.json()) as { ok: boolean; pacts: Record<string, { streak: number; total: number }> };
    expect(body.ok).toBe(true);
    expect(Object.keys(body.pacts).sort()).toEqual(['friendA', 'friendB', 'friendC', 'friendD']);
    for (const f of ['friendA', 'friendB', 'friendC', 'friendD']) {
      expect(body.pacts[f]).toMatchObject({ streak: 1, total: 1 });
    }
  });
});
