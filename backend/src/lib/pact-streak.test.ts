/**
 * pact-streak.test.ts — canonical co-op daily-streak computation (W664 Phase 2).
 *
 * The critical property: a WIN is bucketed by its **Pacific** calendar day, from
 * a UTC `resolved_at`. These tests pin the UTC→PT boundary behaviour (the exact
 * thing that diverged when each client parsed timestamps in its own timezone).
 */
import { describe, expect, it } from 'vitest';
import { computePacts, ptDayKey, prevDay, sqliteUtcToMs, type WinRow } from './pact-streak';

const U = 'viewer';
function win(other: string, resolved_at: string, boss_id = 'the_twin_maw', viewerIsChallenger = true): WinRow {
  return viewerIsChallenger
    ? { challenger_user_id: U, partner_user_id: other, boss_id, resolved_at }
    : { challenger_user_id: other, partner_user_id: U, boss_id, resolved_at };
}

describe('sqliteUtcToMs', () => {
  it('parses SQLite space-form as UTC (not local)', () => {
    expect(sqliteUtcToMs('2026-07-14 07:30:00')).toBe(Date.UTC(2026, 6, 14, 7, 30, 0));
  });
  it('accepts ISO with Z and with offset', () => {
    expect(sqliteUtcToMs('2026-07-14T07:30:00Z')).toBe(Date.UTC(2026, 6, 14, 7, 30, 0));
    expect(sqliteUtcToMs('2026-07-14T00:30:00-07:00')).toBe(Date.UTC(2026, 6, 14, 7, 30, 0));
  });
  it('returns 0 for null/empty/garbage', () => {
    expect(sqliteUtcToMs(null)).toBe(0);
    expect(sqliteUtcToMs('')).toBe(0);
    expect(sqliteUtcToMs('not-a-date')).toBe(0);
  });
});

describe('ptDayKey + prevDay', () => {
  it('buckets a UTC instant into the correct Pacific day (PDT, summer)', () => {
    // 06:00Z on the 14th is 23:00 PDT on the 13th → PT day is the 13th.
    expect(ptDayKey(Date.UTC(2026, 6, 14, 6, 0, 0))).toBe('2026-07-13');
    // 07:30Z on the 14th is 00:30 PDT on the 14th → PT day is the 14th.
    expect(ptDayKey(Date.UTC(2026, 6, 14, 7, 30, 0))).toBe('2026-07-14');
  });
  it('buckets correctly in winter (PST, UTC-8)', () => {
    expect(ptDayKey(Date.UTC(2026, 0, 15, 6, 0, 0))).toBe('2026-01-14'); // 22:00 PST prev day
  });
  it('prevDay is DST-safe date-math', () => {
    expect(prevDay('2026-07-14')).toBe('2026-07-13');
    expect(prevDay('2026-03-01')).toBe('2026-02-28');
    expect(prevDay('2026-01-01')).toBe('2025-12-31');
    expect(prevDay('garbage')).toBe('');
  });
});

describe('computePacts', () => {
  it('returns {} for no wins', () => {
    expect(computePacts([], U)).toEqual({});
  });

  it('single win → streak/best/total/daysBonded = 1', () => {
    const p = computePacts([win('friendA', '2026-07-14 20:00:00')], U)['friendA'];
    expect(p).toMatchObject({ streak: 1, best: 1, total: 1, daysBonded: 1, lastDay: '2026-07-14' });
    expect(p.firstWonAt).toBe(Date.UTC(2026, 6, 14, 20, 0, 0));
    expect(p.lastWonAt).toBe(Date.UTC(2026, 6, 14, 20, 0, 0));
  });

  it('consecutive Pacific days build the streak', () => {
    // 20:00Z each day = 13:00 PDT same day → PT days 12,13,14 → streak 3.
    const rows = [
      win('friendA', '2026-07-12 20:00:00'),
      win('friendA', '2026-07-13 20:00:00'),
      win('friendA', '2026-07-14 20:00:00'),
    ];
    const p = computePacts(rows, U)['friendA'];
    expect(p).toMatchObject({ streak: 3, best: 3, total: 3, daysBonded: 3, lastDay: '2026-07-14' });
  });

  it('a gap resets the current streak but preserves best', () => {
    const rows = [
      win('friendA', '2026-07-10 20:00:00'),
      win('friendA', '2026-07-11 20:00:00'), // best run = 2 (10,11)
      win('friendA', '2026-07-14 20:00:00'), // gap → current streak = 1
    ];
    const p = computePacts(rows, U)['friendA'];
    expect(p).toMatchObject({ streak: 1, best: 2, total: 3, daysBonded: 3, lastDay: '2026-07-14' });
  });

  it('multiple wins on the same Pacific day count once for the streak but each for total', () => {
    const rows = [
      win('friendA', '2026-07-14 18:00:00'),
      win('friendA', '2026-07-14 20:00:00'),
      win('friendA', '2026-07-14 22:00:00'),
    ];
    const p = computePacts(rows, U)['friendA'];
    expect(p).toMatchObject({ streak: 1, best: 1, total: 3, daysBonded: 1 });
  });

  it('respects the UTC→PT boundary: 06:00Z and 07:30Z on the 14th are DIFFERENT Pacific days', () => {
    // 06:00Z → PT 07-13; 07:30Z → PT 07-14 → consecutive → streak 2, daysBonded 2.
    const rows = [win('friendA', '2026-07-14 06:00:00'), win('friendA', '2026-07-14 07:30:00')];
    const p = computePacts(rows, U)['friendA'];
    expect(p).toMatchObject({ streak: 2, best: 2, total: 2, daysBonded: 2, lastDay: '2026-07-14' });
  });

  it('treats the pair symmetrically (viewer as challenger OR partner → same bond)', () => {
    const rows = [
      win('friendA', '2026-07-13 20:00:00', 'the_twin_maw', true), // viewer = challenger
      win('friendA', '2026-07-14 20:00:00', 'the_coursing_dread', false), // viewer = partner
    ];
    const out = computePacts(rows, U);
    expect(Object.keys(out)).toEqual(['friendA']);
    expect(out['friendA']).toMatchObject({ streak: 2, total: 2, lastBossId: 'the_coursing_dread' });
  });

  it('groups distinct friends separately', () => {
    const rows = [
      win('friendA', '2026-07-14 20:00:00'),
      win('friendB', '2026-07-14 20:00:00'),
      win('friendB', '2026-07-13 20:00:00'),
    ];
    const out = computePacts(rows, U);
    expect(out['friendA'].total).toBe(1);
    expect(out['friendB']).toMatchObject({ total: 2, streak: 2 });
  });

  it('sorts unordered input and reports lastBossId + timestamps from the newest win', () => {
    const rows = [
      win('friendA', '2026-07-14 20:00:00', 'the_hollow_monarch'),
      win('friendA', '2026-07-12 20:00:00', 'the_twin_maw'),
      win('friendA', '2026-07-13 20:00:00', 'the_coursing_dread'),
    ];
    const p = computePacts(rows, U)['friendA'];
    expect(p.lastBossId).toBe('the_hollow_monarch');
    expect(p.firstWonAt).toBe(Date.UTC(2026, 6, 12, 20, 0, 0));
    expect(p.lastWonAt).toBe(Date.UTC(2026, 6, 14, 20, 0, 0));
    expect(p.streak).toBe(3);
  });

  it('skips rows with no resolved_at and rows where the viewer is not a participant', () => {
    const rows: WinRow[] = [
      win('friendA', '2026-07-14 20:00:00'),
      { challenger_user_id: 'friendA', partner_user_id: 'friendB', boss_id: 'x', resolved_at: '2026-07-14 20:00:00' }, // viewer absent
      { challenger_user_id: U, partner_user_id: 'friendA', boss_id: 'x', resolved_at: null }, // unresolved
    ];
    const out = computePacts(rows, U);
    expect(out['friendA'].total).toBe(1);
    expect(out['friendB']).toBeUndefined();
  });
});
