/**
 * skins-earn.test.ts — W1098 earned top-tier skins.
 *
 * The pure pieces (runs of opened days, the iOS 27 crash grace, build parsing) and the endpoint:
 * client claims grant every skin but The Verdant Oracle, which only the server's app_opens can
 * earn; Emberforged is also granted from the server's own pacts; nothing owned is written twice.
 */
import { describe, expect, it } from 'vitest';
import {
  EARNABLE_SKINS,
  EARN_EMBER,
  EARN_VERDANT,
  buildVersion,
  crashGraceDays,
  handleSkinsEarn,
  openRuns,
} from './skins-earn';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

const days = (from: string, n: number): string[] => {
  const out: string[] = [];
  const t0 = Date.parse(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push(new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
  return out;
};

describe('openRuns — consecutive UTC days', () => {
  it('finds the longest run and the one still alive', () => {
    const d = [...days('2026-09-01', 31), ...days('2026-10-20', 7)];
    expect(openRuns(d, '2026-10-26')).toEqual({ best: 31, current: 7 });
  });
  it('a run that ended yesterday is still current; two days ago is not', () => {
    expect(openRuns(days('2026-10-20', 5), '2026-10-25').current).toBe(5);
    expect(openRuns(days('2026-10-20', 5), '2026-10-26').current).toBe(0);
  });
  it('duplicates and junk are ignored; nothing gives zeros', () => {
    expect(openRuns(['2026-10-01', '2026-10-01', 'nope', '2026-10-02'], '2026-10-02')).toEqual({ best: 2, current: 2 });
    expect(openRuns([], '2026-10-26')).toEqual({ best: 0, current: 0 });
  });
});

describe('buildVersion', () => {
  it('reads the marketing version out of a build tag', () => {
    expect(buildVersion('3.0.14-w1074')).toEqual([3, 0, 14]);
    expect(buildVersion('3.0.16')).toEqual([3, 0, 16]);
    expect(buildVersion(null)).toBeNull();
  });
});

describe('crashGraceDays — the iOS 27 lockout (owner 2026-10-26)', () => {
  it('Galilea: on 3.0.14 on 10/22, never on 3.0.15, back on 3.0.16 on 10/26 → 10/23, 10/24, 10/25', () => {
    const rows = [{ date_utc: '2026-10-22', build: '3.0.14-w1074' }, { date_utc: '2026-10-26', build: '3.0.16-w1096' }];
    expect(crashGraceDays(rows, '2026-10-27')).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
  });
  it('not back yet: the grace keeps running through today', () => {
    const rows = [{ date_utc: '2026-10-24', build: '3.0.14-w1074' }];
    expect(crashGraceDays(rows, '2026-10-28')).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
  });
  it('anyone who opened 3.0.15 was never locked out', () => {
    const rows = [{ date_utc: '2026-10-22', build: '3.0.14-w1074' }, { date_utc: '2026-10-24', build: '3.0.15-w1083' }];
    expect(crashGraceDays(rows, '2026-10-27')).toEqual([]);
  });
  it('a hunter who had already stopped before 3.0.15 gets nothing', () => {
    const rows = [{ date_utc: '2026-10-16', build: '3.0.12-w1041' }];
    expect(crashGraceDays(rows, '2026-10-27')).toEqual([]);
  });
  it('the grace bridges a real run: 20 days before + 3 grace + 7 after = 30', () => {
    const rows = [
      ...days('2026-10-03', 20).map((d) => ({ date_utc: d, build: '3.0.14-w1074' })),
      ...days('2026-10-26', 7).map((d) => ({ date_utc: d, build: '3.0.16-w1096' })),
    ];
    const all = rows.map((r) => r.date_utc).concat(crashGraceDays(rows, '2026-11-01'));
    expect(openRuns(all, '2026-11-01')).toEqual({ best: 30, current: 30 });
  });
});

// ── the endpoint, on a routed D1 mock ─────────────────────────────────────────
interface Fx { owned?: string[]; opens?: { date_utc: string; build: string | null }[]; pactRows?: Record<string, unknown>[] }
function makeEnv(fx: Fx, writes: string[][]) {
  const all = (sql: string): unknown[] => {
    if (sql.includes('FROM skin_entitlements')) return (fx.owned ?? []).map((skin_id) => ({ skin_id }));
    if (sql.includes('FROM app_opens')) return fx.opens ?? [];
    if (sql.includes('FROM coop_boss_instances')) return fx.pactRows ?? [];
    if (sql.includes('SELECT instance_id, user_id FROM coop_boss_participants')) {
      return (fx.pactRows ?? []).map((r) => ({ instance_id: r.id, user_id: r.partner_user_id }));
    }
    return [];
  };
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => ({ results: all(sql), success: true, meta: {} }),
        first: async () => null,
        run: async () => ({ success: true, meta: { changes: 1 } }),
        _sql: sql, _args: args,
      }),
      all: async () => ({ results: all(sql), success: true, meta: {} }),
      first: async () => null,
    }),
    batch: async (stmts: Array<{ _sql: string; _args: unknown[] }>) => stmts.map((s) => {
      const id = s._args[1] as string;
      const dup = (fx.owned ?? []).includes(id);
      if (!dup) writes.push(s._args as string[]);
      return { success: true, meta: { changes: dup ? 0 : 1 } };
    }),
  } as unknown as D1Database;
  return { DB: db, RL_USER_ACCOLADES_READ: { limit: async () => ({ success: true }) } } as unknown as Env;
}
const session = { userId: 'u1', alias: 'tester' } as unknown as SessionPayload;
const req = (body: unknown) => new Request('https://x/v1/users/me/skins/earn', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const today = new Date().toISOString().slice(0, 10);

describe('POST /v1/users/me/skins/earn', () => {
  it('grants claimed skins, writes an earned row, and reports progress', async () => {
    const writes: string[][] = [];
    const res = await handleSkinsEarn(req({ claims: ['avatar-skin-stardust.png', 'avatar-skin-nullprotocol.png'] }), makeEnv({}, writes), session);
    expect(res.status).toBe(200);
    const body = await res.json() as { granted: string[]; skins: string[]; progress: { opened: { best: number }; flame: { best: number } } };
    expect(body.granted.sort()).toEqual(['avatar-skin-nullprotocol.png', 'avatar-skin-stardust.png']);
    expect(body.skins).toContain('avatar-skin-stardust.png');
    expect(writes.map((w) => w[1]).sort()).toEqual(['avatar-skin-nullprotocol.png', 'avatar-skin-stardust.png']);
    expect(writes[0][0]).toBe('u1');
    expect(body.progress.opened.best).toBe(0);
  });

  it('The Verdant Oracle cannot be claimed; 30 days in a row on the server grants it', async () => {
    const w1: string[][] = [];
    const r1 = await (await handleSkinsEarn(req({ claims: [EARN_VERDANT] }), makeEnv({}, w1), session)).json() as { granted: string[] };
    expect(r1.granted).toEqual([]);
    const w2: string[][] = [];
    const opens = days(new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10), 30).map((d) => ({ date_utc: d, build: '3.0.17-w1098' }));
    const r2 = await (await handleSkinsEarn(req({}), makeEnv({ opens }, w2), session)).json() as { granted: string[]; progress: { opened: { best: number; current: number } } };
    expect(r2.granted).toEqual([EARN_VERDANT]);
    expect(r2.progress.opened).toEqual({ best: 30, current: 30 });
    expect(opens[opens.length - 1].date_utc).toBe(today);
  });

  it('Emberforged comes from the server\'s own pacts too, without a claim', async () => {
    const w: string[][] = [];
    const pactRows = days('2026-09-01', 30).map((d, i) => ({
      id: 'i' + i, challenger_user_id: 'u1', partner_user_id: 'f1', partner2_user_id: null, boss_id: 'the_twin_maw',
      starts_at: d + 'T08:00:00.000Z', resolved_at: null, is_win: 1,
    }));
    const r = await (await handleSkinsEarn(req({}), makeEnv({ pactRows }, w), session)).json() as { granted: string[]; progress: { flame: { best: number } } };
    expect(r.progress.flame.best).toBe(30);
    expect(r.granted).toEqual([EARN_EMBER]);
  });

  it('a skin already owned (bought or earned) is never written again; unknown ids are ignored', async () => {
    const w: string[][] = [];
    const r = await (await handleSkinsEarn(
      req({ claims: ['avatar-skin-stardust.png', 'avatar-skin-hax.png', 42] }),
      makeEnv({ owned: ['avatar-skin-stardust.png'] }, w), session)).json() as { granted: string[]; skins: string[] };
    expect(r.granted).toEqual([]);
    expect(w).toEqual([]);
    expect(r.skins).toEqual(['avatar-skin-stardust.png']);
  });

  it('a garbage body is treated as no claims', async () => {
    const w: string[][] = [];
    const res = await handleSkinsEarn(new Request('https://x', { method: 'POST', body: 'not json' }), makeEnv({}, w), session);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { granted: string[] }).granted).toEqual([]);
  });

  it('every earnable id is a real skin file name', () => {
    expect(EARNABLE_SKINS.length).toBe(7);
    for (const id of EARNABLE_SKINS) expect(id).toMatch(/^avatar-skin-[a-z0-9-]+\.png$/);
  });
});
