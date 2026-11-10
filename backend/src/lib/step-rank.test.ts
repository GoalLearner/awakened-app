/** step-rank.test.ts — W1178: the 14-day window and the per-hunter average behind GET /v1/steps/rank. */
import { describe, expect, it } from 'vitest';
import { parseDaily, stepAverage, stepRankWindow, STEP_RANK_DAYS } from './step-rank';

describe('stepRankWindow', () => {
  it('is the 14 finished Pacific days before today, oldest first', () => {
    // 2026-11-10 10:00 PST = 18:00 UTC
    const w = stepRankWindow(Date.UTC(2026, 10, 10, 18, 0, 0));
    expect(w.length).toBe(STEP_RANK_DAYS);
    expect(w[0]).toBe('2026-10-27');
    expect(w[13]).toBe('2026-11-09');
  });
  it('uses the Pacific day, not UTC, near midnight', () => {
    // 2026-11-11 03:00 UTC = 2026-11-10 19:00 PST: today is still the 10th
    expect(stepRankWindow(Date.UTC(2026, 10, 11, 3, 0, 0))[13]).toBe('2026-11-09');
  });
});

describe('stepAverage', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
  it('averages only the days with steps', () => {
    expect(stepAverage({ '2026-11-01': 9000, '2026-11-02': 0, '2026-11-03': 11000, '2026-11-04': 10000 }, days)).toBe(10000);
  });
  it('needs three days with steps', () => {
    expect(stepAverage({ '2026-11-01': 9000, '2026-11-03': 11000 }, days)).toBeNull();
  });
  it('ignores days outside the window, junk and impossible readings', () => {
    expect(stepAverage({ '2026-10-01': 50000, '2026-11-01': 'x', '2026-11-02': 300000, '2026-11-03': 6000, '2026-11-04': 6000, '2026-11-05': 6000 }, days)).toBeNull();
    expect(stepAverage({ '2026-11-01': '7000', '2026-11-02': 8000, '2026-11-03': 9000 }, days)).toBe(8000);
  });
  it('handles a missing map', () => {
    expect(stepAverage(null, days)).toBeNull();
    expect(stepAverage(parseDaily('not json'), days)).toBeNull();
    expect(stepAverage(parseDaily('{"2026-11-01":1,"2026-11-02":2,"2026-11-03":3}'), days)).toBe(2);
  });
});
