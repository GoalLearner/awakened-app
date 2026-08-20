/**
 * pact-flame-risk.test.ts — W837 (Train 3, R3). The pure at-risk math gets the
 * heavy coverage (it must agree with pact-streak.ts semantics); the sweep
 * wrapper gets gate/claim tests in the win-back.test.ts style.
 */
import { describe, expect, it } from 'vitest';
import { findAtRiskPairs, flameRiskNotif, sweepPactFlameRisk, type StartedRow } from './pact-flame-risk';
import type { Env } from '../env';

/** starts_at (SQLite UTC 'YYYY-MM-DD HH:MM:SS') that lands on the given PT day at noon. */
function ptNoon(ptDay: string): string {
  // Noon PT = 19:00Z (PDT) — August dates in these tests are all PDT.
  return ptDay + ' 19:00:00';
}

function duo(a: string, b: string, ptDay: string): StartedRow {
  return { challenger_user_id: a, partner_user_id: b, starts_at: ptNoon(ptDay) };
}

const TODAY = '2026-08-19';

describe('findAtRiskPairs (W837)', () => {
  it('flags a pair whose run ends yesterday with streak >= 2', () => {
    const rows = [duo('u1', 'u2', '2026-08-16'), duo('u1', 'u2', '2026-08-17'), duo('u1', 'u2', '2026-08-18')];
    const out = findAtRiskPairs(rows, TODAY);
    expect(out).toEqual([{ a: 'u1', b: 'u2', streak: 3 }]);
  });

  it('a pair that already hunted TODAY is safe', () => {
    const rows = [duo('u1', 'u2', '2026-08-18'), duo('u1', 'u2', TODAY)];
    expect(findAtRiskPairs(rows, TODAY)).toEqual([]);
  });

  it('a dead flame (last hunt 2+ days ago) is not warned', () => {
    const rows = [duo('u1', 'u2', '2026-08-15'), duo('u1', 'u2', '2026-08-16')];
    expect(findAtRiskPairs(rows, TODAY)).toEqual([]);
  });

  it('a 1-day flame is left to die quietly (MIN_STREAK)', () => {
    const rows = [duo('u1', 'u2', '2026-08-18')];
    expect(findAtRiskPairs(rows, TODAY)).toEqual([]);
  });

  it('trio/raid rosters credit every pair; canonical order + longest-first sort', () => {
    const raid: StartedRow = {
      challenger_user_id: 'u3',
      partner_user_id: 'u1',
      partner2_user_id: 'u2',
      starts_at: ptNoon('2026-08-18'),
    };
    const rows = [
      raid,
      // u1|u2 also hunted the 17th → streak 2; u1|u3 and u2|u3 only the 18th → streak 1, dropped
      duo('u1', 'u2', '2026-08-17'),
    ];
    const out = findAtRiskPairs(rows, TODAY);
    expect(out).toEqual([{ a: 'u1', b: 'u2', streak: 2 }]);
  });

  it('participant_ids roster supersedes the legacy columns (5-hunter raid)', () => {
    const raid: StartedRow = {
      id: 'i1',
      challenger_user_id: 'u1',
      partner_user_id: 'u2',
      participant_ids: ['u1', 'u2', 'u4', 'u5'],
      starts_at: ptNoon('2026-08-18'),
    };
    const prior = {
      id: 'i0',
      challenger_user_id: 'u4',
      partner_user_id: 'u5',
      participant_ids: ['u4', 'u5'],
      starts_at: ptNoon('2026-08-17'),
    };
    const out = findAtRiskPairs([raid, prior], TODAY);
    expect(out).toEqual([{ a: 'u4', b: 'u5', streak: 2 }]);
  });

  it('unstarted / unparseable rows are ignored', () => {
    const rows: StartedRow[] = [
      { challenger_user_id: 'u1', partner_user_id: 'u2', starts_at: null },
      { challenger_user_id: 'u1', partner_user_id: 'u2', starts_at: 'garbage' },
    ];
    expect(findAtRiskPairs(rows, TODAY)).toEqual([]);
  });
});

describe('flameRiskNotif copy', () => {
  it('carries the streak + partner alias and no banned words', () => {
    const n = flameRiskNotif('James', 5);
    expect(n.body).toContain('5 days strong with James');
    expect(/\bfell(ed)?\b/i.test(n.title + ' ' + n.body)).toBe(false);
    expect(n.type).toBe('pact_flame_risk');
  });
});

describe('sweepPactFlameRisk gates', () => {
  it('off-hour → no-op', async () => {
    const env = { DB: {} } as unknown as Env;
    const r = await sweepPactFlameRisk(env, 18);
    expect(r.reason).toBe('OFF_HOUR');
  });

  it('push not configured → PUSH_NOT_CONFIGURED', async () => {
    const env = { DB: {} } as unknown as Env;
    const r = await sweepPactFlameRisk(env, 19);
    expect(r.reason).toBe('PUSH_NOT_CONFIGURED');
  });
});
