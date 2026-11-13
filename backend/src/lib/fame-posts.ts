/**
 * fame-posts.ts — W1199: the feed announces the record books, but only once they are official.
 *
 * Owner 2026-11-13: "If a person officially hits the hall of fame or 100K club, it should be posted on the
 * friend's feed for people to see or like it". "Officially" is the two-day rule (W1197, fame-days.ts): the
 * week counts once the hunter has opened the app on 2 Pacific days of it. The SERVER writes these posts
 * (a phone used to post "joined the 100K Step Club" the moment a first Apple Health read crossed 100,000,
 * before any rule could apply), and they reach every hunter's feed like a shadow does (W1118), where the
 * W913 likes already work:
 *   - "joined the 100K Step Club": once ever, the first official 100,000-step week. Hunters who joined
 *     before the rule (a phone's post from before 2026-11-08) are not announced twice.
 *   - "entered the Steps Hall of Fame at #N": once per week, the first time an official week ranks in the
 *     Hall of Fame's top HOF_POST_TOP (the ten rows the board shows).
 * Checked after every counted app open (the second day can be what makes a week official) and every
 * steps upload (the steps can be what gets it there). Each post is pinned by its client_event_id, so
 * UNIQUE(user_id, client_event_id) keeps it to one.
 */
import type { Env } from '../env';
import { getAccoladeWeekStart } from './accolade-week';
import { FAME_DAYS_FROM, FAME_MIN_DAYS, fameWeekOk } from './fame-days';

export const CLUB_POST_STEPS = 100000;
export const HOF_POST_TOP = 10;
/** 2026-11-08 00:00 PST: a phone's own "joined the 100K Step Club" from here on waits for the official one. */
export const FAME_FROM_MS = Date.parse('2026-11-08T08:00:00Z');
export const CLUB_POST_ID = 'official:step_100k_club';
export const hofPostId = (week: string) => 'official:hof:' + week;

/** The Hall of Fame's merged weekly records (hall-of-fame.ts reads the same set), with user_id + week_start. */
export const HOF_MERGED = `
  WITH merged AS (
    SELECT user_id, week_start, steps FROM weekly_step_records
    UNION ALL
    SELECT ls.user_id, ls.week_start, ls.current_value AS steps
      FROM leaderboard_snapshots ls
      JOIN users u ON u.id = ls.user_id
     WHERE ls.metric = 'step_total'
       AND ls.week_start IS NOT NULL
       AND u.apple_sub NOT LIKE 'sim_test_%'
       AND NOT EXISTS (
         SELECT 1 FROM weekly_step_records w
          WHERE w.user_id = ls.user_id AND w.week_start = ls.week_start
       )
  )`;

const ordinal = (n: number) => '#' + n;

async function insertPost(env: Env, userId: string, type: string, key: string, label: string, value: number | null, clientId: string, nowMs: number): Promise<boolean> {
  const r = await env.DB.prepare(
    `INSERT INTO public_achievement_events (
        id, user_id, event_type, event_key, event_label, event_value, rarity,
        client_event_id, client_created_at, server_created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)
      ON CONFLICT(user_id, client_event_id) DO NOTHING`,
  ).bind(crypto.randomUUID(), userId, type, key, label, value, clientId, new Date(nowMs).toISOString(), nowMs).run();
  return Number(r?.meta?.changes ?? 0) > 0;
}

/** Post whatever this hunter's current week has officially earned and is not posted yet. Never throws. */
export async function postOfficialFame(env: Env, userId: string, nowMs: number = Date.now()): Promise<{ club: boolean; hof: number | null }> {
  const out = { club: false, hof: null as number | null };
  try {
    const week = getAccoladeWeekStart(nowMs);
    if (!week || week < FAME_DAYS_FROM) return out;
    const days = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM app_open_counts
        WHERE user_id = ?1 AND day_pt >= ?2 AND day_pt <= date(?2, '+6 days') AND opens > 0`,
    ).bind(userId, week).first<{ n: number }>();
    if ((Number(days?.n) || 0) < FAME_MIN_DAYS) return out;
    const row = await env.DB.prepare(
      `SELECT COALESCE(
          (SELECT steps FROM weekly_step_records WHERE user_id = ?1 AND week_start = ?2),
          (SELECT current_value FROM leaderboard_snapshots WHERE user_id = ?1 AND metric = 'step_total' AND week_start = ?2)
        ) AS steps,
        (SELECT apple_sub FROM users WHERE id = ?1) AS apple_sub`,
    ).bind(userId, week).first<{ steps: number | null; apple_sub: string | null }>();
    const steps = Number(row?.steps) || 0;
    if (steps <= 0 || String(row?.apple_sub || '').indexOf('sim_test_') === 0) return out;

    // the 100K Step Club: once ever, unless a phone already announced it before the rule
    if (steps >= CLUB_POST_STEPS) {
      const before = await env.DB.prepare(
        `SELECT 1 FROM public_achievement_events
          WHERE user_id = ? AND event_type = 'step_100k_club_unlocked' AND client_event_id = 'step_100k_club' AND server_created_at < ?`,
      ).bind(userId, FAME_FROM_MS).first();
      if (!before) out.club = await insertPost(env, userId, 'step_100k_club_unlocked', 'step_100k_club', 'joined the 100K Step Club', CLUB_POST_STEPS, CLUB_POST_ID, nowMs);
    }

    // the Hall of Fame: this week's place among the official records, once per week
    const posted = await env.DB.prepare('SELECT 1 FROM public_achievement_events WHERE user_id = ? AND client_event_id = ?')
      .bind(userId, hofPostId(week)).first();
    if (!posted) {
      const rank = await env.DB.prepare(
        `${HOF_MERGED}
         SELECT COUNT(*) + 1 AS rank FROM merged m
          WHERE m.steps > ?1 AND NOT (m.user_id = ?2 AND m.week_start = ?3)
            AND ${fameWeekOk('m.user_id', 'm.week_start')}`,
      ).bind(steps, userId, week).first<{ rank: number }>();
      const place = Number(rank?.rank) || 0;
      if (place >= 1 && place <= HOF_POST_TOP) {
        if (await insertPost(env, userId, 'hall_of_fame_entry', 'hof:' + week, 'entered the Steps Hall of Fame at ' + ordinal(place), place, hofPostId(week), nowMs)) out.hof = place;
      }
    }
  } catch (err) {
    console.error('[fame-posts] failed', err);
  }
  return out;
}
