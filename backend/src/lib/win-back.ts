/**
 * win-back.ts — W836 (Train 3, R2) server-side win-back push.
 *
 * The client has local comeback notifications, but they die on reinstall and
 * on notification-permission churn — the exact population most likely to
 * lapse. This is the server-side replacement: a hunter who has a registered
 * device token but hasn't opened the app in WIN_BACK_MIN_DAYS..MAX_DAYS gets
 * ONE push per lapse. Riding the existing every-2-minute cron sweep, gated to
 * the 10 AM America/Los_Angeles hour (clear of the Monday-9AM update broadcast),
 * with the win_back_pushes PK as the claim — the INSERT OR IGNORE happens
 * BEFORE the send, so 30 runs/hour (or overlapping runs) can never
 * double-send. A returned-then-lapsed hunter gets a NEW lapse anchor
 * (their fresh last-open date) and becomes eligible exactly once more.
 *
 * W881 — the anchor used to come from an app_opens GROUP BY, which silently
 * excluded anyone with ZERO open rows. That is not a rare edge: the client's
 * launch ping fires ~1.5s after boot and no-ops when not yet signed in, so a
 * hunter who signed up and never came back recorded no opens at all — and
 * reaching exactly that person is the whole point of a win-back. The anchor
 * now falls back to the account's creation date (epoch-ms; date() on a raw
 * integer returns NULL in SQLite, hence /1000 + 'unixepoch'), so the signup
 * itself counts as the last touch. The device-token EXISTS check still
 * applies — W881 registers a token at onboarding completion, so these
 * hunters now have one; anyone predating that fix stays unreachable until
 * they open the app again, which no server change can alter.
 *
 * Window rationale: <4 days is normal life, not a lapse; >30 days is cold —
 * a push into a month of silence reads as spam and risks the opt-out that
 * the whole Train-1/3 push discipline exists to avoid.
 */
import type { Env } from '../env';
import { notifyUser, pushConfigured } from './apns';

const WIN_BACK_MIN_DAYS = 4;
const WIN_BACK_MAX_DAYS = 30;
const WIN_BACK_PT_HOUR = 10; // 10 AM Pacific
const PAGE = 25; // per eligible run; idempotency makes the cap safe, the log makes it visible

export const WIN_BACK_NOTIF = {
  title: 'The Gate remembers',
  body: 'Your vows still stand, Hunter. One mark tonight rekindles the climb.',
  type: 'win_back',
} as const;

function ptHourNow(): number {
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    hour: '2-digit',
  }).formatToParts(new Date())) {
    if (p.type === 'hour') return Number(p.value) % 24;
  }
  return -1;
}

/** Cron sweep entry. `ptHourOverride` exists for tests/admin only. */
export async function sweepWinBackPushes(
  env: Env,
  ptHourOverride?: number,
): Promise<{ ok: boolean; sent: number; reason?: string }> {
  try {
    const hour = typeof ptHourOverride === 'number' ? ptHourOverride : ptHourNow();
    if (hour !== WIN_BACK_PT_HOUR) return { ok: true, sent: 0, reason: 'OFF_HOUR' };
    if (!pushConfigured(env)) return { ok: false, sent: 0, reason: 'PUSH_NOT_CONFIGURED' };

    // Lapsed hunters: latest open 4..30 days ago, has a device token, not a
    // sim, and THIS lapse anchor not already nudged. date_utc and date('now')
    // are both UTC 'YYYY-MM-DD', so string compares are day-exact.
    const rows = await env.DB.prepare(
      `SELECT c.user_id AS user_id, c.last_open AS last_open
         FROM (SELECT u2.id AS user_id,
                      COALESCE(
                        (SELECT MAX(ao.date_utc) FROM app_opens ao WHERE ao.user_id = u2.id),
                        date(u2.created_at / 1000, 'unixepoch')
                      ) AS last_open
                 FROM users u2) c
         JOIN users u ON u.id = c.user_id AND u.apple_sub NOT LIKE 'sim_test_%'
        WHERE c.last_open <= date('now', '-${WIN_BACK_MIN_DAYS} days')
          AND c.last_open >= date('now', '-${WIN_BACK_MAX_DAYS} days')
          AND EXISTS (SELECT 1 FROM device_tokens dt WHERE dt.user_id = c.user_id)
          AND NOT EXISTS (SELECT 1 FROM win_back_pushes wb
                           WHERE wb.user_id = c.user_id AND wb.lapse_open_date = c.last_open)
        ORDER BY c.last_open ASC
        LIMIT ${PAGE}`,
    ).all<{ user_id: string; last_open: string }>();
    const candidates = rows.results ?? [];
    if (candidates.length === 0) return { ok: true, sent: 0 };

    let sent = 0;
    for (const c of candidates) {
      // CLAIM before send — the PK makes concurrent runs mutually exclusive
      // per (user, lapse); the loser's insert changes 0 rows and skips.
      const claim = await env.DB.prepare(
        'INSERT OR IGNORE INTO win_back_pushes (user_id, lapse_open_date, sent_at) VALUES (?, ?, ?)',
      )
        .bind(c.user_id, c.last_open, Date.now())
        .run();
      if (!(claim.meta && Number(claim.meta.changes) >= 1)) continue;
      await notifyUser(env, c.user_id, { ...WIN_BACK_NOTIF, data: {} });
      sent++;
    }
    if (candidates.length === PAGE) {
      // No silent caps: the next eligible run (2 min later, same hour) takes the rest.
      console.log(`[win-back] page full (${PAGE}) — more lapsed hunters remain`);
    }
    if (sent > 0) console.log(`[win-back] sent ${sent} win-back pushes`);
    return { ok: true, sent };
  } catch (e) {
    console.error('[win-back] sweep failed', JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    return { ok: false, sent: 0, reason: 'INTERNAL' };
  }
}
