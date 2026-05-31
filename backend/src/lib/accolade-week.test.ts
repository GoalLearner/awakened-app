/**
 * accolade-week.test.ts — Boundary tests for getAccoladeWeekStart().
 *
 * v3 Phase 1z.218 — Anchor changed from Sunday-UTC to Sunday in
 * America/Los_Angeles (Pacific Time). These tests cover:
 *   - Day-of-week mapping (Sun..Sat in PT terms).
 *   - The Pacific midnight boundary (Sat 23:59 PT vs Sun 00:00 PT).
 *   - Cross-UTC-midnight cases where the Pacific clock is still on
 *     the prior day (e.g. UTC Sunday morning is still PT Saturday).
 *   - Month / year rollover under Pacific Time.
 *   - DST transitions (March spring-forward + November fall-back)
 *     where the UTC offset shifts by an hour but the Pacific local
 *     day boundary is unchanged.
 *
 * Pure function, no DB. All inputs constructed via Date.UTC() so
 * the test reads UTC-explicit moments and asserts the Pacific
 * Sunday key.
 */
import { describe, expect, it } from 'vitest';
import { getAccoladeWeekStart } from './accolade-week';

// Helper: ms timestamp for a specific UTC moment.
function utcMs(y: number, m: number, d: number, h = 0, min = 0, s = 0): number {
  return Date.UTC(y, m - 1, d, h, min, s);
}

describe('getAccoladeWeekStart — Pacific anchor (1z.218)', () => {
  it('Sunday 00:00 PT (PDT, UTC-7) rolls the week forward', () => {
    // May 31 2026 is a Sunday. PDT = UTC-7. Sunday 00:00 PDT = UTC
    // Sunday 07:00. Anything before that UTC moment is still PT
    // Saturday and belongs to last week (2026-05-24). At/after it
    // we land on the new Sunday-PT week (2026-05-31).
    expect(getAccoladeWeekStart(utcMs(2026, 5, 31,  6, 59, 59))).toBe('2026-05-24');
    expect(getAccoladeWeekStart(utcMs(2026, 5, 31,  7,  0,  0))).toBe('2026-05-31');
    expect(getAccoladeWeekStart(utcMs(2026, 5, 31, 12,  0,  0))).toBe('2026-05-31');
    // 5 PM PDT Saturday = UTC Sunday midnight (the old UTC anchor).
    // Under the Pacific anchor this is STILL Saturday in PT, so
    // it belongs to last week.
    expect(getAccoladeWeekStart(utcMs(2026, 5, 31,  0,  0,  0))).toBe('2026-05-24');
    expect(getAccoladeWeekStart(utcMs(2026, 5, 31,  0,  0,  1))).toBe('2026-05-24');
  });

  it('every PT day of the week maps to the right Sunday', () => {
    // Reference Sunday: 2026-05-31 in PT.
    // PDT = UTC-7 in May. Noon UTC = 5 AM PDT (within the local day).
    const expectedSunday = '2026-05-31';
    expect(getAccoladeWeekStart(utcMs(2026, 5, 31, 12, 0, 0))).toBe(expectedSunday); // Sun
    expect(getAccoladeWeekStart(utcMs(2026, 6,  1, 12, 0, 0))).toBe(expectedSunday); // Mon
    expect(getAccoladeWeekStart(utcMs(2026, 6,  2, 12, 0, 0))).toBe(expectedSunday); // Tue
    expect(getAccoladeWeekStart(utcMs(2026, 6,  3, 12, 0, 0))).toBe(expectedSunday); // Wed
    expect(getAccoladeWeekStart(utcMs(2026, 6,  4, 12, 0, 0))).toBe(expectedSunday); // Thu
    expect(getAccoladeWeekStart(utcMs(2026, 6,  5, 12, 0, 0))).toBe(expectedSunday); // Fri
    expect(getAccoladeWeekStart(utcMs(2026, 6,  6, 12, 0, 0))).toBe(expectedSunday); // Sat
    // Sat 23:59 PDT = UTC 06:59 Sunday morning. Still PT Saturday.
    expect(getAccoladeWeekStart(utcMs(2026, 6,  7,  6, 59, 59))).toBe(expectedSunday);
    // Sun 00:00 PDT = UTC 07:00 Sunday morning. New week.
    expect(getAccoladeWeekStart(utcMs(2026, 6,  7,  7,  0,  0))).toBe('2026-06-07');
  });

  it('PDT month boundary (May → June 2026)', () => {
    // PT Sun 2026-05-31 → PT Sat 2026-06-06 all map to '2026-05-31'.
    // The next Pacific Sunday is 2026-06-07 → maps to '2026-06-07'.
    expect(getAccoladeWeekStart(utcMs(2026, 5, 31, 12,  0,  0))).toBe('2026-05-31');
    expect(getAccoladeWeekStart(utcMs(2026, 6,  1, 12,  0,  0))).toBe('2026-05-31');
    expect(getAccoladeWeekStart(utcMs(2026, 6,  6, 12,  0,  0))).toBe('2026-05-31');
    // Sat 11 PM PDT (= UTC 06:00 Sun) still PT Saturday.
    expect(getAccoladeWeekStart(utcMs(2026, 6,  7,  6,  0,  0))).toBe('2026-05-31');
    // Sun 00:00 PDT → UTC 07:00 Sun → new week.
    expect(getAccoladeWeekStart(utcMs(2026, 6,  7,  7,  0,  0))).toBe('2026-06-07');
  });

  it('PT year boundary (Dec 2025 → Jan 2026)', () => {
    // 2025-12-28 is a Sunday in PT. Week runs through 2026-01-03 Sat.
    // Next Pacific Sunday: 2026-01-04.
    // January = PST (UTC-8). Sun 00:00 PST = UTC 08:00 Sun.
    expect(getAccoladeWeekStart(utcMs(2025, 12, 28, 12,  0,  0))).toBe('2025-12-28');
    expect(getAccoladeWeekStart(utcMs(2025, 12, 31, 23,  0,  0))).toBe('2025-12-28');
    expect(getAccoladeWeekStart(utcMs(2026,  1,  1, 12,  0,  0))).toBe('2025-12-28');
    expect(getAccoladeWeekStart(utcMs(2026,  1,  3, 23,  0,  0))).toBe('2025-12-28');
    // 2026-01-04 07:59 UTC = Sat 23:59 PST. Still last week.
    expect(getAccoladeWeekStart(utcMs(2026,  1,  4,  7, 59, 59))).toBe('2025-12-28');
    // 2026-01-04 08:00 UTC = Sun 00:00 PST. New week.
    expect(getAccoladeWeekStart(utcMs(2026,  1,  4,  8,  0,  0))).toBe('2026-01-04');
  });

  it('DST spring-forward (March 2026): PST → PDT mid-week', () => {
    // PST = UTC-8 (until Sun Mar 8 2026 02:00 PST jumps to 03:00 PDT).
    // PDT = UTC-7 thereafter (until November fall-back).
    //
    // Sunday 2026-03-08 starts at 00:00 PST = UTC 08:00. The week
    // starting then is '2026-03-08'. The "spring-forward" moment
    // happens 2 hours INTO that week (2 AM local jumps to 3 AM),
    // so the week_start anchor doesn't change.
    //
    // Saturday 2026-03-07 23:59 PST = UTC 07:59 Sun. Still last week.
    expect(getAccoladeWeekStart(utcMs(2026, 3, 8, 7, 59, 59))).toBe('2026-03-01');
    // Sunday 2026-03-08 00:00 PST = UTC 08:00 Sun. New week.
    expect(getAccoladeWeekStart(utcMs(2026, 3, 8, 8,  0,  0))).toBe('2026-03-08');
    // After spring-forward at 02:00 PST → 03:00 PDT (UTC 10:00 → 10:00,
    // local clock skipped 02-03). Still Sunday 2026-03-08 in PT.
    expect(getAccoladeWeekStart(utcMs(2026, 3, 8, 10, 30,  0))).toBe('2026-03-08');
    // Mid-week (Wed 2026-03-11 noon PDT = UTC 19:00). Same week.
    expect(getAccoladeWeekStart(utcMs(2026, 3, 11, 19,  0,  0))).toBe('2026-03-08');
    // Following Sat 23:59 PDT = UTC 06:59 Sun (one hour earlier in
    // UTC than the PST week's Sat 23:59).
    expect(getAccoladeWeekStart(utcMs(2026, 3, 15,  6, 59, 59))).toBe('2026-03-08');
    expect(getAccoladeWeekStart(utcMs(2026, 3, 15,  7,  0,  0))).toBe('2026-03-15');
  });

  it('DST fall-back (November 2026): PDT → PST mid-week', () => {
    // Sunday 2026-11-01 starts at 00:00 PDT = UTC 07:00. The fall-
    // back happens at 02:00 PDT → 01:00 PST (UTC 09:00). Local
    // clock repeats 01:00-02:00 LOCAL HOUR. The week_start anchor
    // is still '2026-11-01'.
    //
    // Saturday 2026-10-31 23:59 PDT = UTC 06:59 Sun. Last week.
    expect(getAccoladeWeekStart(utcMs(2026, 11,  1,  6, 59, 59))).toBe('2026-10-25');
    // Sunday 2026-11-01 00:00 PDT = UTC 07:00 Sun. New week.
    expect(getAccoladeWeekStart(utcMs(2026, 11,  1,  7,  0,  0))).toBe('2026-11-01');
    // After fall-back at 02:00 PDT → 01:00 PST. UTC 09:30 = Sun
    // 01:30 PST (local clock has repeated). Same week.
    expect(getAccoladeWeekStart(utcMs(2026, 11,  1,  9, 30,  0))).toBe('2026-11-01');
    // Mid-week Wed noon PST = UTC 20:00.
    expect(getAccoladeWeekStart(utcMs(2026, 11,  4, 20,  0,  0))).toBe('2026-11-01');
    // Following Sat 23:59 PST = UTC 07:59 Sun (one hour later in
    // UTC than the PDT week's Sat 23:59).
    expect(getAccoladeWeekStart(utcMs(2026, 11,  8,  7, 59, 59))).toBe('2026-11-01');
    expect(getAccoladeWeekStart(utcMs(2026, 11,  8,  8,  0,  0))).toBe('2026-11-08');
  });

  it('produces ISO YYYY-MM-DD format with zero padding', () => {
    expect(getAccoladeWeekStart(utcMs(2026,  1,  4, 12, 0, 0))).toBe('2026-01-04');
    expect(getAccoladeWeekStart(utcMs(2026,  3,  1, 12, 0, 0))).toBe('2026-03-01');
    expect(getAccoladeWeekStart(utcMs(2026, 11,  8, 12, 0, 0))).toBe('2026-11-08');
  });

  it('defaults to Date.now() when no arg is passed', () => {
    const out = getAccoladeWeekStart();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('output is always a Sunday', () => {
    // Spot-check various inputs and verify each output is a Sunday
    // in JS's UTC weekday semantics (we built the string from a
    // back-stepped Date.UTC, so the underlying ms is on the same
    // UTC date as the local Sunday — getUTCDay() == 0).
    const samples = [
      utcMs(2026, 5, 31, 12, 0, 0),
      utcMs(2026, 6,  3, 18, 0, 0),
      utcMs(2026, 3,  8, 10, 0, 0),  // DST spring-forward week
      utcMs(2026, 11, 1, 10, 0, 0),  // DST fall-back week
      utcMs(2026, 1,  1,  0, 0, 0),
    ];
    for (const ms of samples) {
      const out = getAccoladeWeekStart(ms);
      const [y, m, d] = out.split('-').map(Number);
      const reconstituted = new Date(Date.UTC(y, m - 1, d));
      expect(reconstituted.getUTCDay()).toBe(0);
    }
  });
});
