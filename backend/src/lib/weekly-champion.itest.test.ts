/**
 * weekly-champion.itest.test.ts — W657: PROOF that viewing the Week Recap
 * cannot double-grant a weekly-champion accolade (the Step Crown).
 *
 * This is NOT a mock test. It executes the EXACT SQL the production code
 * runs (imported from lib/weekly-champion.ts — the single shared write path
 * used by BOTH /v1/leaderboard/recap and /v1/leaderboard/last-week) against
 * a real in-memory SQLite database created from the real migration schema
 * (0007_user_accolades.sql). If the CASE idempotency in the upsert ever
 * regresses, this fails on the actual semantics — a mock can't prove that.
 *
 * Owner requirement (2026-07-13): "Write a test that proves viewing the
 * recap cannot double-grant a weekly-champion accolade. I don't want to
 * find out months later that someone has three crowns for one week."
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import {
  WEEKLY_CHAMPION_UPSERT_SQL,
  WEEKLY_CHAMPION_ACCOLADE_TYPE,
} from './weekly-champion';
import { RECAP_SEEN_UPDATE_SQL, RECAP_MY_HISTORY_SQL } from '../handlers/leaderboard-recap';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_0007 = readFileSync(join(HERE, '..', '..', 'migrations', '0007_user_accolades.sql'), 'utf8');

const USER = 'user-richie';
const WEEK_A = '2026-07-05';
const WEEK_B = '2026-07-12';

/** Run the exact production upsert once, the way grantWeeklyChampionIfEarned
 *  binds it: id, user_id, unlock_week_start, unlock_value, best_value,
 *  last_qualified_week_start, unlocked_at, updated_at. */
function grantOnce(db: Database.Database, week: string, steps: number, nowMs: number): void {
  db.prepare(WEEKLY_CHAMPION_UPSERT_SQL).run(
    'id-' + Math.abs(Math.sin(nowMs) * 1e9 | 0) + '-' + nowMs, // unique id per call, like crypto.randomUUID()
    USER, week, steps, steps, week, nowMs, nowMs,
  );
}

function readRow(db: Database.Database): { repeat_count: number; best_value: number; last_qualified_week_start: string } | undefined {
  return db.prepare(
    'SELECT repeat_count, best_value, last_qualified_week_start FROM user_accolades WHERE user_id = ? AND accolade_type = ?',
  ).get(USER, WEEKLY_CHAMPION_ACCOLADE_TYPE) as any;
}

describe('weekly_step_champion — real-SQL idempotency (the double-grant proof)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // better-sqlite3 enforces foreign keys by default; satisfy the
    // user_accolades(user_id) → users(id) reference like production does.
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO users (id) VALUES (?)').run(USER);
    db.exec(MIGRATION_0007);   // the real production schema, UNIQUE(user_id, accolade_type) included
  });

  it('one week viewed many times = exactly ONE crown (recap, recap again, last-week strip)', () => {
    grantOnce(db, WEEK_A, 125563, 1000);   // recap view #1
    grantOnce(db, WEEK_A, 125563, 2000);   // recap view #2 (re-opened)
    grantOnce(db, WEEK_A, 125563, 3000);   // last-week strip view (same shared SQL)
    grantOnce(db, WEEK_A, 125563, 4000);   // recap view #3, days later

    const row = readRow(db);
    expect(row).toBeDefined();
    expect(row!.repeat_count).toBe(1);     // ← the whole point
    expect(row!.last_qualified_week_start).toBe(WEEK_A);
    // And exactly one row exists (UNIQUE constraint held, no id-keyed dupes).
    const n = db.prepare(
      'SELECT COUNT(*) AS n FROM user_accolades WHERE user_id = ? AND accolade_type = ?',
    ).get(USER, WEEKLY_CHAMPION_ACCOLADE_TYPE) as any;
    expect(n.n).toBe(1);
  });

  it('a NEW winning week increments the crown count exactly once — then re-views hold', () => {
    grantOnce(db, WEEK_A, 100000, 1000);
    grantOnce(db, WEEK_A, 100000, 2000);   // re-view week A
    grantOnce(db, WEEK_B, 130000, 3000);   // genuinely new championship week
    grantOnce(db, WEEK_B, 130000, 4000);   // re-view week B
    grantOnce(db, WEEK_B, 130000, 5000);   // and again

    const row = readRow(db);
    expect(row!.repeat_count).toBe(2);     // two distinct weeks, two crowns
    expect(row!.last_qualified_week_start).toBe(WEEK_B);
    expect(row!.best_value).toBe(130000);  // MAX-sticky best
  });

  it('ORDER-PROOF: a stale older week replayed after a newer one is a no-op', () => {
    grantOnce(db, WEEK_A, 100000, 1000);
    grantOnce(db, WEEK_B, 130000, 2000);
    // The Sunday-midnight race: an in-flight request stamped with the OLD week
    // commits AFTER one stamped with the new week (two devices, boundary
    // straddle — W657 makes 00:00 Pacific the peak recap moment). The count
    // must NOT bump and the stored week must NOT move backwards; otherwise the
    // next view re-detects a "new" week and mints phantom crowns.
    grantOnce(db, WEEK_A, 100000, 3000);
    let row = readRow(db);
    expect(row!.repeat_count).toBe(2);
    expect(row!.last_qualified_week_start).toBe(WEEK_B);
    // And the follow-up view during the next week stays settled too.
    grantOnce(db, WEEK_B, 130000, 4000);
    row = readRow(db);
    expect(row!.repeat_count).toBe(2);
    expect(row!.last_qualified_week_start).toBe(WEEK_B);
  });

  it('the count survives a realistic season: 4 weeks, each viewed 5 times', () => {
    const weeks = ['2026-06-14', '2026-06-21', '2026-06-28', '2026-07-05'];
    let t = 1000;
    for (const wk of weeks) {
      for (let view = 0; view < 5; view++) grantOnce(db, wk, 90000 + t, t++);
    }
    const row = readRow(db);
    expect(row!.repeat_count).toBe(4);     // one per championship week, ever
  });
});

describe('recap_seen_week — real-SQL high-water semantics', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // Minimal users table matching what migration 0032 leaves in place.
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, recap_seen_week TEXT)');
    db.prepare('INSERT INTO users (id) VALUES (?)').run(USER);
  });

  function seen(week: string): void {
    db.prepare(RECAP_SEEN_UPDATE_SQL).run(week, USER);
  }
  function readSeen(): string | null {
    const r = db.prepare('SELECT recap_seen_week FROM users WHERE id = ?').get(USER) as any;
    return r ? r.recap_seen_week : null;
  }

  it('first mark sets the week; duplicate marks are no-ops', () => {
    seen(WEEK_A);
    expect(readSeen()).toBe(WEEK_A);
    seen(WEEK_A);
    expect(readSeen()).toBe(WEEK_A);
  });

  it('a NEWER week advances the mark; a STALE week can never lower it', () => {
    seen(WEEK_A);
    seen(WEEK_B);                    // newer — advances
    expect(readSeen()).toBe(WEEK_B);
    seen(WEEK_A);                    // stale replay — must NOT go backwards
    expect(readSeen()).toBe(WEEK_B);
    seen('2025-01-05');              // ancient replay
    expect(readSeen()).toBe(WEEK_B);
  });
});

describe('recap myHistory — real-SQL week-close bounds', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE weekly_step_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, week_start TEXT NOT NULL,
      steps INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER,
      weekly_sum_source TEXT, UNIQUE (user_id, week_start)
    )`);
    db.exec(`CREATE TABLE leaderboard_snapshots (
      user_id TEXT NOT NULL, metric TEXT NOT NULL, current_value INTEGER NOT NULL,
      best_value INTEGER NOT NULL, updated_at INTEGER, week_start TEXT,
      weekly_sum_source TEXT, PRIMARY KEY (user_id, metric)
    )`);
  });

  function wsr(week: string, steps: number): void {
    db.prepare('INSERT INTO weekly_step_records (id, user_id, week_start, steps) VALUES (?, ?, ?, ?)')
      .run('r-' + week, USER, week, steps);
  }
  function hist(finishedWeek: string, mySteps: number): { ordinal: number; totalWeeks: number } {
    // better-sqlite3 binds REUSED numbered params (?1/?3) via an object keyed
    // by number; D1 in production accepts the positional .bind(a, b, c) form.
    return db.prepare(RECAP_MY_HISTORY_SQL).get({ 1: USER, 2: mySteps, 3: finishedWeek }) as any;
  }

  it('the in-progress CURRENT week cannot demote "your best week yet."', () => {
    wsr('2026-06-28', 60000);
    wsr(WEEK_A, 90000);          // the finished week being celebrated — all-time best AT CLOSE
    wsr(WEEK_B, 95000);          // the LIVE week's running total, synced before the recap GET
    const h = hist(WEEK_A, 90000);
    expect(h.ordinal).toBe(1);   // still the best week yet
    expect(h.totalWeeks).toBe(2); // 2026-06-28 + WEEK_A; the live week doesn't count
  });

  it('zero-step weeks do not inflate totalWeeks past the vacuous-claim gate', () => {
    wsr(WEEK_A, 70000);
    wsr('2026-06-28', 0);        // a synced-but-empty week
    const h = hist(WEEK_A, 70000);
    expect(h.totalWeeks).toBe(1);
    expect(h.ordinal).toBe(1);
  });

  it('the snapshot fallback obeys the same bounds', () => {
    db.prepare(`INSERT INTO leaderboard_snapshots (user_id, metric, current_value, best_value, week_start)
                VALUES (?, 'step_total', ?, ?, ?)`).run(USER, 95000, 95000, WEEK_B); // live-week snapshot
    wsr(WEEK_A, 90000);
    const h = hist(WEEK_A, 90000);
    expect(h.ordinal).toBe(1);
    expect(h.totalWeeks).toBe(1);
  });
});
