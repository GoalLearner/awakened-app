/**
 * accolade-week.test.ts -- Boundary tests for getAccoladeWeekStart().
 * Pure function, no DB. Covers every day of the week + edge cases at
 * UTC midnight + year/month/day rollover.
 */
import { describe, expect, it } from 'vitest';
import { getAccoladeWeekStart } from './accolade-week';

// Helper: ms timestamp for a specific UTC moment.
function utcMs(y: number, m: number, d: number, h = 0, min = 0, s = 0): number {
  return Date.UTC(y, m - 1, d, h, min, s);
}

describe('getAccoladeWeekStart', () => {
  it('returns the Sunday of the same week for each day Sun..Sat', () => {
    // 2026-05-17 is a Sunday in UTC.
    const expectedSunday = '2026-05-17';
    // Sunday 00:00:00Z
    expect(getAccoladeWeekStart(utcMs(2026, 5, 17,  0,  0,  0))).toBe(expectedSunday);
    // Sunday 13:00:00Z
    expect(getAccoladeWeekStart(utcMs(2026, 5, 17, 13,  0,  0))).toBe(expectedSunday);
    // Sunday 23:59:59Z
    expect(getAccoladeWeekStart(utcMs(2026, 5, 17, 23, 59, 59))).toBe(expectedSunday);
    // Monday
    expect(getAccoladeWeekStart(utcMs(2026, 5, 18, 12,  0,  0))).toBe(expectedSunday);
    // Tuesday
    expect(getAccoladeWeekStart(utcMs(2026, 5, 19, 12,  0,  0))).toBe(expectedSunday);
    // Wednesday
    expect(getAccoladeWeekStart(utcMs(2026, 5, 20, 12,  0,  0))).toBe(expectedSunday);
    // Thursday
    expect(getAccoladeWeekStart(utcMs(2026, 5, 21, 12,  0,  0))).toBe(expectedSunday);
    // Friday
    expect(getAccoladeWeekStart(utcMs(2026, 5, 22, 12,  0,  0))).toBe(expectedSunday);
    // Saturday 23:59:59Z (last second of the week)
    expect(getAccoladeWeekStart(utcMs(2026, 5, 23, 23, 59, 59))).toBe(expectedSunday);
  });

  it('rolls to the next Sunday at exactly 00:00:00Z Sunday morning', () => {
    // 2026-05-23 23:59:59Z (Saturday) -> 2026-05-17
    expect(getAccoladeWeekStart(utcMs(2026, 5, 23, 23, 59, 59))).toBe('2026-05-17');
    // 2026-05-24 00:00:00Z (Sunday)  -> 2026-05-24
    expect(getAccoladeWeekStart(utcMs(2026, 5, 24,  0,  0,  0))).toBe('2026-05-24');
  });

  it('handles month boundary correctly', () => {
    // 2026-05-31 is Sunday. 2026-06-01 is Monday -> same week 2026-05-31.
    expect(getAccoladeWeekStart(utcMs(2026, 5, 31, 12, 0, 0))).toBe('2026-05-31');
    expect(getAccoladeWeekStart(utcMs(2026, 6,  1, 12, 0, 0))).toBe('2026-05-31');
    expect(getAccoladeWeekStart(utcMs(2026, 6,  6, 23, 0, 0))).toBe('2026-05-31');
    expect(getAccoladeWeekStart(utcMs(2026, 6,  7,  0, 0, 0))).toBe('2026-06-07');
  });

  it('handles year boundary correctly', () => {
    // 2025-12-28 is a Sunday. 2026-01-03 is Saturday of the same week.
    expect(getAccoladeWeekStart(utcMs(2025, 12, 28, 12, 0, 0))).toBe('2025-12-28');
    expect(getAccoladeWeekStart(utcMs(2025, 12, 31, 23, 0, 0))).toBe('2025-12-28');
    expect(getAccoladeWeekStart(utcMs(2026,  1,  1, 12, 0, 0))).toBe('2025-12-28');
    expect(getAccoladeWeekStart(utcMs(2026,  1,  3, 23, 0, 0))).toBe('2025-12-28');
    // 2026-01-04 is the next Sunday.
    expect(getAccoladeWeekStart(utcMs(2026,  1,  4,  0, 0, 0))).toBe('2026-01-04');
  });

  it('produces ISO YYYY-MM-DD format with zero padding', () => {
    expect(getAccoladeWeekStart(utcMs(2026, 1, 4, 12, 0, 0))).toBe('2026-01-04');
    expect(getAccoladeWeekStart(utcMs(2026, 3, 1, 12, 0, 0))).toBe('2026-03-01');
    expect(getAccoladeWeekStart(utcMs(2026, 11, 8, 12, 0, 0))).toBe('2026-11-08');
  });

  it('defaults to Date.now() when no arg is passed', () => {
    const out = getAccoladeWeekStart();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
