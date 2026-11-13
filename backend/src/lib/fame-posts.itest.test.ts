/**
 * fame-posts.itest.test.ts — W1199: the official 100K Club and Hall of Fame posts, run as REAL SQL on an
 * in-memory SQLite database behind a small D1-shaped adapter.
 *
 * Owner 2026-11-13: "If a person officially hits the hall of fame or 100K club, it should be posted on the
 * friend's feed for people to see or like it".
 */
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Env } from '../env';
import { CLUB_POST_ID, FAME_FROM_MS, hofPostId, postOfficialFame } from './fame-posts';

let db: Database.Database;
// D1's prepare/bind/first/all/run over better-sqlite3 (numbered ?1 parameters bind by object)
function env(): Env {
  const prep = (sql: string) => {
    let args: unknown[] = [];
    const params = () => (/\?\d/.test(sql) ? [Object.fromEntries(args.map((v, i) => [String(i + 1), v]))] : args);
    const api = {
      bind: (...a: unknown[]) => { args = a; return api; },
      first: async () => (db.prepare(sql).get(...(params() as never[])) as unknown) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...(params() as never[])), success: true, meta: {} }),
      run: async () => { const r = db.prepare(sql).run(...(params() as never[])); return { success: true, meta: { changes: r.changes } }; },
    };
    return api;
  };
  return { DB: { prepare: prep } } as unknown as Env;
}

const NOW = Date.parse('2026-11-13T21:00:00Z');   // Friday Nov 13, 1 PM PST: the week of Nov 8
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, apple_sub TEXT NOT NULL DEFAULT 'real');
    CREATE TABLE app_open_counts (user_id TEXT NOT NULL, day_pt TEXT NOT NULL, opens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day_pt));
    CREATE TABLE weekly_step_records (user_id TEXT NOT NULL, week_start TEXT NOT NULL, steps INTEGER NOT NULL);
    CREATE TABLE leaderboard_snapshots (user_id TEXT NOT NULL, metric TEXT NOT NULL, current_value INTEGER NOT NULL, week_start TEXT);
    CREATE TABLE public_achievement_events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_type TEXT NOT NULL, event_key TEXT, event_label TEXT,
      event_value INTEGER, rarity TEXT, client_event_id TEXT NOT NULL, client_created_at TEXT, server_created_at INTEGER NOT NULL,
      metadata_json TEXT, UNIQUE (user_id, client_event_id));
  `);
});
const user = (u: string, sub = 'real') => db.prepare('INSERT INTO users (id, apple_sub) VALUES (?, ?)').run(u, sub);
const open = (u: string, day: string) => db.prepare('INSERT INTO app_open_counts (user_id, day_pt, opens) VALUES (?, ?, 1)').run(u, day);
const week = (u: string, w: string, steps: number) => db.prepare('INSERT INTO weekly_step_records (user_id, week_start, steps) VALUES (?, ?, ?)').run(u, w, steps);
const posts = (u: string) => (db.prepare('SELECT event_type, event_label, client_event_id FROM public_achievement_events WHERE user_id = ? ORDER BY client_event_id').all(u) as Array<{ event_type: string; event_label: string; client_event_id: string }>)
  .map((p) => p.event_type + ' | ' + p.event_label + ' | ' + p.client_event_id);
// the Hall of Fame today: ten official records from before the rule
function seedHall() {
  [['ren', 125563], ['anthony', 123093], ['enzo', 120313], ['james', 113647], ['james', 101560], ['ren', 101259], ['james', 99303], ['ren', 99094], ['james', 97965], ['ren', 95737]]
    .forEach(([u, s], i) => { try { user(u as string); } catch (_) { /* already there */ } week(u as string, '2026-0' + (5 + (i % 4)) + '-' + String(10 + i).padStart(2, '0'), s as number); });
}

describe('W1199 — the record books are announced once they are official', () => {
  it('one day in the app: nothing; the second day: "joined the 100K Step Club" and "entered the Steps Hall of Fame at #1", once', async () => {
    seedHall(); user('killua');
    week('killua', '2026-11-08', 150000); open('killua', '2026-11-13');
    expect(await postOfficialFame(env(), 'killua', NOW)).toEqual({ club: false, hof: null });
    expect(posts('killua')).toEqual([]);
    open('killua', '2026-11-14');
    expect(await postOfficialFame(env(), 'killua', NOW)).toEqual({ club: true, hof: 1 });
    expect(posts('killua')).toEqual([
      'hall_of_fame_entry | entered the Steps Hall of Fame at #1 | ' + hofPostId('2026-11-08'),
      'step_100k_club_unlocked | joined the 100K Step Club | ' + CLUB_POST_ID,
    ]);
    expect(await postOfficialFame(env(), 'killua', NOW)).toEqual({ club: false, hof: null });   // never twice
    expect(posts('killua')).toHaveLength(2);
  });

  it('a week that only reaches #11 is not in the Hall; 99,999 steps is not the Club', async () => {
    seedHall(); user('sam');
    week('sam', '2026-11-08', 95000); open('sam', '2026-11-09'); open('sam', '2026-11-10');   // below the tenth (95,737)
    expect(await postOfficialFame(env(), 'sam', NOW)).toEqual({ club: false, hof: null });
    db.prepare("UPDATE weekly_step_records SET steps = 99999 WHERE user_id = 'sam'").run();
    expect(await postOfficialFame(env(), 'sam', NOW)).toEqual({ club: false, hof: 7 });          // #7 of the Hall (above 99,303), not the Club
    expect(posts('sam')).toEqual(['hall_of_fame_entry | entered the Steps Hall of Fame at #7 | ' + hofPostId('2026-11-08')]);
  });

  it('a member whose phone announced the Club before the rule is not announced again', async () => {
    seedHall();
    db.prepare(`INSERT INTO public_achievement_events (id, user_id, event_type, event_key, event_label, event_value, client_event_id, server_created_at)
                VALUES ('old', 'anthony', 'step_100k_club_unlocked', 'step_100k_club', 'joined the 100K Step Club', 100000, 'step_100k_club', ?)`).run(FAME_FROM_MS - 86400000 * 40);
    week('anthony', '2026-11-08', 130000); open('anthony', '2026-11-09'); open('anthony', '2026-11-12');
    expect(await postOfficialFame(env(), 'anthony', NOW)).toEqual({ club: false, hof: 1 });
  });

  it('test hunters (sims) are never announced', async () => {
    seedHall(); user('sim', 'sim_test_1');
    week('sim', '2026-11-08', 140000); open('sim', '2026-11-09'); open('sim', '2026-11-10');
    expect(await postOfficialFame(env(), 'sim', NOW)).toEqual({ club: false, hof: null });
  });
});
