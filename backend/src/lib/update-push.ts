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

// W835 (Train 3, R8) — ceiling lifted 12 → 50 for public launch. The 12 was
// sized for the free plan's 50-subrequest budget; the account moved to Workers
// Paid (1000/invocation) with the W80x scale work. Worst case per user is
// ~1 token-read + 3 APNs posts + a prune (~5 subrequests) → 50 users ≈ 250,
// comfortably under 1000 with the log I/O. Weekly capacity: 12 eligible cron
// runs × 50 = 600 users/Monday (was 144).
const PAGE_USERS = 50;

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

// W835 (Train 3, R1b) — per-user version gate. '2.5.0-w833' → [2,5,0]; null
// when unparseable (unparseable/missing builds are SENT — pre-W834 clients
// report no build and are exactly the update-nudge audience).
function verTriple(s: string | null | undefined): [number, number, number] | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function buildIsCurrent(build: string | null | undefined, storeVersion: string): boolean {
  const b = verTriple(build);
  const s = verTriple(storeVersion);
  if (!b || !s) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i] > s[i]) return true;
    if (b[i] < s[i]) return false;
  }
  return true; // equal = current
}

/** Run ONE bounded page of the broadcast for `dayKey`. Returns what happened
 *  (for the admin test-fire response + cron logs). Never throws.
 *  W835: pass storeVersion to skip users whose latest reported build
 *  (app_opens.build, W834) is already >= the live App Store version — they
 *  have nothing to update. Omitting it (admin test-fire) sends to everyone. */
export async function runUpdatePushPage(
  env: Env,
  dayKey: string,
  storeVersion?: string,
): Promise<{ ok: boolean; sent: number; completed: boolean; reason?: string; skipped_current?: number }> {
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

    // W835 — the page also pulls each user's latest reported build (W834:
    // app_opens.build on the newest day-row that has one) so the version gate
    // below can skip already-current hunters. Users who never reported a
    // build get NULL and are sent to (pre-W834 clients = the nudge audience).
    const page = await env.DB.prepare(
      `SELECT DISTINCT dt.user_id AS user_id,
              (SELECT ao.build FROM app_opens ao
                WHERE ao.user_id = dt.user_id AND ao.build IS NOT NULL
                ORDER BY ao.date_utc DESC LIMIT 1) AS build
         FROM device_tokens dt
        WHERE dt.user_id > ?
        ORDER BY dt.user_id
        LIMIT ?`,
    )
      .bind(row.cursor, PAGE_USERS)
      .all<{ user_id: string; build: string | null }>();
    const pageRows = page.results ?? [];
    const users = pageRows.map((r) => r.user_id);

    if (users.length === 0) {
      await env.DB.prepare(
        `UPDATE push_broadcast_log SET completed = 1, updated_at = CURRENT_TIMESTAMP
          WHERE day_key = ? AND cursor = ?`,
      )
        .bind(dayKey, row.cursor)
        .run();
      return { ok: true, sent: 0, completed: true };
    }

    // W835 (R1b) — version gate: hunters whose latest reported build is
    // already >= the store version have nothing to update. They still
    // advance the cursor (they're handled, not deferred) but get no push.
    const targets = storeVersion
      ? pageRows.filter((r) => !buildIsCurrent(r.build, storeVersion)).map((r) => r.user_id)
      : users;
    const skippedCurrent = users.length - targets.length;

    // CLAIM the page before sending (CAS on cursor) — an overlapping run that
    // read the same cursor loses the swap and sends nothing.
    const nextCursor = users[users.length - 1];
    const isLastPage = users.length < PAGE_USERS;
    const claim = await env.DB.prepare(
      `UPDATE push_broadcast_log
          SET cursor = ?, sent_users = sent_users + ?, completed = ?, updated_at = CURRENT_TIMESTAMP
        WHERE day_key = ? AND cursor = ? AND completed = 0`,
    )
      .bind(nextCursor, targets.length, isLastPage ? 1 : 0, dayKey, row.cursor)
      .run();
    if (!(claim.meta && Number(claim.meta.changes) >= 1)) {
      return { ok: true, sent: 0, completed: false, reason: 'LOST_CLAIM_RACE' };
    }

    // notifyUser never throws; dead tokens are pruned inside apns.ts.
    for (const uid of targets) {
      await notifyUser(env, uid, { ...UPDATE_PUSH_NOTIF, data: {} });
    }
    if (skippedCurrent > 0) {
      console.log(`[update-push] ${dayKey}: ${skippedCurrent} already on ${storeVersion} — skipped (W835)`);
    }
    if (!isLastPage) {
      // No silent caps: surface that more pages remain (the next cron run continues).
      console.log(`[update-push] ${dayKey}: page sent (${targets.length}/${users.length}), cursor=${nextCursor} — more remain`);
    }
    return { ok: true, sent: targets.length, completed: isLastPage, skipped_current: skippedCurrent };
  } catch (e) {
    console.error('[update-push] page failed', JSON.stringify({ dayKey, error: e instanceof Error ? e.message : String(e) }));
    return { ok: false, sent: 0, completed: false, reason: 'INTERNAL' };
  }
}

// W820 (Train 1, R1a) — the broadcast used to fire EVERY Monday regardless of
// whether an update existed (the client banner got the version check in W791;
// the push never did). A weekly false alarm to a mostly-auto-updating cohort
// is the #1 push-opt-out risk, so the cron now proceeds only when the App
// Store's live release is RECENT (released within the last RELEASE_WINDOW_DAYS)
// — i.e. only on Mondays that actually follow a release. FAIL CLOSED: lookup
// unreachable/malformed → no broadcast (a skipped nudge costs nothing; a false
// one costs the notification channel). Per-user build gating (skip hunters
// already updated) lands with the Train-3 instrumentation (R1b).
const APP_STORE_ID = '6764727990';
const RELEASE_WINDOW_DAYS = 7;
// W835 — the lookup now also surfaces the live store VERSION so the per-user
// gate can compare against reported builds. fresh:false → no broadcast at all.
async function storeRelease(): Promise<{ fresh: boolean; version: string | null }> {
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${APP_STORE_ID}&t=${Date.now()}`);
    if (!res.ok) return { fresh: false, version: null };
    const data = (await res.json()) as {
      results?: { currentVersionReleaseDate?: string; version?: string }[];
    };
    const r0 = data.results && data.results[0];
    const iso = r0 && r0.currentVersionReleaseDate;
    if (!iso) return { fresh: false, version: null };
    const ageMs = Date.now() - Date.parse(iso);
    const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= RELEASE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return { fresh, version: (r0 && typeof r0.version === 'string' && r0.version) || null };
  } catch {
    return { fresh: false, version: null };
  }
}

/** Cron entry: gate to Monday 9 AM Pacific + a fresh App Store release, then
 *  run one page with the per-user version gate (W835). (The admin test-fire
 *  route calls runUpdatePushPage directly and intentionally bypasses all
 *  three gates: day/hour, freshness, and per-user version.) */
export async function runUpdatePushCron(env: Env): Promise<void> {
  const { dayKey, hour, weekday } = ptParts();
  if (weekday !== 1 || hour !== 9) return; // only the 9 AM PT runs proceed (DST handled by the 2h UTC cron window)
  const release = await storeRelease();
  if (!release.fresh) {
    console.log(`[update-push] ${dayKey}: no App Store release in the last ${RELEASE_WINDOW_DAYS}d — broadcast skipped (W820)`);
    return;
  }
  await runUpdatePushPage(env, dayKey, release.version || undefined);
}
