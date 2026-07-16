/**
 * update-push.ts — W680 Monday "update available" push broadcast.
 *
 * Pairs with the client's W679 in-app banner: the push pulls hunters who
 * DIDN'T open the app back in; the banner catches everyone who did. Fired by
 * the Worker cron (wrangler.toml: every 5 min across 16:00–17:59 UTC Mondays);
 * only the runs where it is 9 AM America/Los_Angeles proceed, which is
 * DST-proof (16 UTC = 9 AM PDT summers; 17 UTC = 9 AM PST winters — the other
 * hour's runs no-op on the gate).
 *
 * Fanout is PAGED to respect the free-plan subrequest budget: each eligible
 * cron run sends to at most PAGE_USERS distinct users (keyset pagination over
 * device_tokens.user_id), advancing push_broadcast_log.cursor until completed.
 * At 5-min spacing that is 12 eligible runs/Monday → 12 × PAGE_USERS users of
 * weekly capacity; runs that end a page short mark the day completed.
 *
 * Overlap-safe: the cursor advance is a compare-and-swap (WHERE cursor = old),
 * and the CLAIM happens BEFORE the sends — two overlapping runs can never send
 * the same page twice (the loser just re-reads the fresher row).
 */
import type { Env } from '../env';
import { notifyUser, pushConfigured } from './apns';

const PAGE_USERS = 12; // ≈1 token-read + 1-3 APNs posts (+rare prune) per user — comfortably under the 50-subrequest cap with room for the log I/O.

export const UPDATE_PUSH_NOTIF = {
  title: 'System Update',
  body: 'A new version has awakened — the App Store won’t update on its own.',
  type: 'update_reminder',
} as const;

/** PT clock parts for "now". */
function ptParts(): { dayKey: string; hour: number; weekday: number } {
  const now = new Date();
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
  let hour = -1;
  let weekday = -1;
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    hour: '2-digit',
    weekday: 'short',
  }).formatToParts(now)) {
    if (p.type === 'hour') hour = Number(p.value) % 24;
    if (p.type === 'weekday') weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.value);
  }
  return { dayKey, hour, weekday };
}

interface LogRow {
  cursor: string;
  completed: number;
  sent_users: number;
}

/** Run ONE bounded page of the broadcast for `dayKey`. Returns what happened
 *  (for the admin test-fire response + cron logs). Never throws. */
export async function runUpdatePushPage(
  env: Env,
  dayKey: string,
): Promise<{ ok: boolean; sent: number; completed: boolean; reason?: string }> {
  try {
    if (!pushConfigured(env)) return { ok: false, sent: 0, completed: false, reason: 'PUSH_NOT_CONFIGURED' };

    await env.DB.prepare('INSERT OR IGNORE INTO push_broadcast_log (day_key) VALUES (?)').bind(dayKey).run();
    const row = await env.DB.prepare(
      'SELECT cursor, completed, sent_users FROM push_broadcast_log WHERE day_key = ?',
    )
      .bind(dayKey)
      .first<LogRow>();
    if (!row) return { ok: false, sent: 0, completed: false, reason: 'LOG_ROW_MISSING' };
    if (row.completed) return { ok: true, sent: 0, completed: true, reason: 'ALREADY_COMPLETED' };

    const page = await env.DB.prepare(
      `SELECT DISTINCT user_id FROM device_tokens
        WHERE user_id > ?
        ORDER BY user_id
        LIMIT ?`,
    )
      .bind(row.cursor, PAGE_USERS)
      .all<{ user_id: string }>();
    const users = (page.results ?? []).map((r) => r.user_id);

    if (users.length === 0) {
      await env.DB.prepare(
        `UPDATE push_broadcast_log SET completed = 1, updated_at = CURRENT_TIMESTAMP
          WHERE day_key = ? AND cursor = ?`,
      )
        .bind(dayKey, row.cursor)
        .run();
      return { ok: true, sent: 0, completed: true };
    }

    // CLAIM the page before sending (CAS on cursor) — an overlapping run that
    // read the same cursor loses the swap and sends nothing.
    const nextCursor = users[users.length - 1];
    const isLastPage = users.length < PAGE_USERS;
    const claim = await env.DB.prepare(
      `UPDATE push_broadcast_log
          SET cursor = ?, sent_users = sent_users + ?, completed = ?, updated_at = CURRENT_TIMESTAMP
        WHERE day_key = ? AND cursor = ? AND completed = 0`,
    )
      .bind(nextCursor, users.length, isLastPage ? 1 : 0, dayKey, row.cursor)
      .run();
    if (!(claim.meta && Number(claim.meta.changes) >= 1)) {
      return { ok: true, sent: 0, completed: false, reason: 'LOST_CLAIM_RACE' };
    }

    // notifyUser never throws; dead tokens are pruned inside apns.ts.
    for (const uid of users) {
      await notifyUser(env, uid, { ...UPDATE_PUSH_NOTIF, data: {} });
    }
    if (!isLastPage) {
      // No silent caps: surface that more pages remain (the next cron run continues).
      console.log(`[update-push] ${dayKey}: page sent (${users.length}), cursor=${nextCursor} — more remain`);
    }
    return { ok: true, sent: users.length, completed: isLastPage };
  } catch (e) {
    console.error('[update-push] page failed', JSON.stringify({ dayKey, error: e instanceof Error ? e.message : String(e) }));
    return { ok: false, sent: 0, completed: false, reason: 'INTERNAL' };
  }
}

/** Cron entry: gate to Monday 9 AM Pacific, then run one page. */
export async function runUpdatePushCron(env: Env): Promise<void> {
  const { dayKey, hour, weekday } = ptParts();
  if (weekday !== 1 || hour !== 9) return; // only the 9 AM PT runs proceed (DST handled by the 2h UTC cron window)
  await runUpdatePushPage(env, dayKey);
}
