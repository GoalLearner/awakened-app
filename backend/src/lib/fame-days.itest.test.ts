/**
 * fame-days.itest.test.ts — W1197: the two-day rule on the Hall of Fame and the 100K Club, run as REAL
 * SQL on an in-memory SQLite database (the same fameWeekOk snippet both handlers splice in).
 *
 * Owner 2026-11-13: "They must sign in two-days out of the week to make hall of fame so no random person
 * can just hit the hall of fame and delete the app after".
 */
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { FAME_DAYS_FROM, FAME_MIN_DAYS, fameWeekOk } from './fame-days';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_open_counts (user_id TEXT NOT NULL, day_pt TEXT NOT NULL, opens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day_pt));
    CREATE TABLE weekly_step_records (user_id TEXT NOT NULL, week_start TEXT NOT NULL, steps INTEGER NOT NULL);
  `);
});
const open = (u: string, day: string, n = 1) => db.prepare('INSERT INTO app_open_counts (user_id, day_pt, opens) VALUES (?, ?, ?)').run(u, day, n);
const week = (u: string, w: string, steps: number) => db.prepare('INSERT INTO weekly_step_records (user_id, week_start, steps) VALUES (?, ?, ?)').run(u, w, steps);
const famous = () => (db.prepare(`SELECT user_id, week_start FROM weekly_step_records w WHERE ${fameWeekOk('w.user_id', 'w.week_start')} ORDER BY user_id, week_start`).all() as Array<{ user_id: string; week_start: string }>)
  .map((r) => r.user_id + '@' + r.week_start);

describe('W1197 — a week makes the record books only with two days in the app', () => {
  it('the rule: two Pacific days of that week, from the week of Nov 8 on', () => {
    expect(FAME_MIN_DAYS).toBe(2);
    expect(FAME_DAYS_FROM).toBe('2026-11-08');
  });

  it('one day in the app (the 150,000-step first read) does not count; a second day that week does', () => {
    week('killua', '2026-11-08', 150000);
    open('killua', '2026-11-13');
    expect(famous()).toEqual([]);
    open('killua', '2026-11-14');                 // Saturday, still the same week
    expect(famous()).toEqual(['killua@2026-11-08']);
  });

  it('days outside the week do not help, and a ping that was not an open (opens = 0) is not a day', () => {
    week('a', '2026-11-08', 120000);
    open('a', '2026-11-07');                      // the Saturday before
    open('a', '2026-11-15');                      // the Sunday after
    open('a', '2026-11-10', 0);
    open('a', '2026-11-12');
    expect(famous()).toEqual([]);
    open('a', '2026-11-08');                      // the week's own Sunday
    expect(famous()).toEqual(['a@2026-11-08']);
  });

  it('weeks before the open counter began keep counting', () => {
    week('rendiesel', '2026-05-17', 125563);
    week('anthony', '2026-09-27', 123093);
    expect(famous()).toEqual(['anthony@2026-09-27', 'rendiesel@2026-05-17']);
  });
});
