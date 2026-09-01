/**
 * update-push.ts — W680 Monday "update available" push broadcast.
 *
 * Pairs with the client's W679 in-app banner: the push pulls hunters who
 * DIDN'T open the app back in; the banner catches everyone who did. Driven by
 * the Worker's scheduled() handler on EVERY cron trigger since W904 — the
 * dedicated every-5-minutes 16-17 UTC Monday trigger (weekday NAMED "MON":
 * Cloudflare's "1" is Sunday, and that mistake silenced this job for seven
 * weeks) plus the 2-minute
 * sweep; runUpdatePushCron self-gates so only runs where it is 9 AM
 * America/Los_Angeles on a Monday proceed, which is DST-proof (16 UTC = 9 AM
 * PDT summers; 17 UTC = 9 AM PST winters). Every in-window decision is
 * journaled to cron_runs (0054); the other hour's dedicated runs leave one
 * SKIP_GATE heartbeat row so "did not fire" is distinguishable from "skipped".
 *
 * Fanout is PAGED: each eligible run sends to at most PAGE_USERS distinct users
 * (keyset pagination over device_tokens.user_id), advancing
 * push_broadcast_log.cursor until completed. With both triggers inside the
 * window that is up to ~42 eligible runs/Monday (12 dedicated + ~30 sweep);
 * runs that end a page short mark the day completed, and later runs stop at
 * the completed flag before touching the App Store lookup.
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
// comfortably under 1000 with the log I/O. Weekly capacity: 12 dedicated cron
// runs × 50 = 600 users/Monday (was 144) — and since W904 the 2-minute sweep
// carries the job too, so the practical ceiling is ~42 runs × 50.
const PAGE_USERS = 50;

export const UPDATE_PUSH_NOTIF = {
  title: 'System Update',
  body: 'A new version has awakened — the App Store won’t update on its own.',
  type: 'update_reminder',
} as const;

/** PT clock parts for "now" (W904: exported for the admin status route; the
 *  clock is injectable for tests). */
export function ptParts(now: Date = new Date()): { dayKey: string; hour: number; weekday: number } {
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
// W880 — 7 → 8. The cron only runs Mondays 9:00–9:55 AM PT, so a release that
// lands AFTER that window on a Monday (3.0.0 went live 10:10 AM PT on
// 2026-08-24, ~15 min past the last run) has to wait a full week — and at the
// next Monday's 9 AM it is 6d22h50m old, clearing the 7-day line by ~70
// minutes. That margin is real but needlessly thin. Widening costs nothing on
// the spam side: since W835 the PER-USER gate below already skips anyone whose
// reported build is >= the store version, so a slightly-staler broadcast can
// only ever reach hunters who genuinely have not updated — which is exactly
// the audience. The freshness check is now the belt to W835's suspenders.
const RELEASE_WINDOW_DAYS = 8;

// W904 — the dedicated trigger, weekday NAMED on purpose. Cloudflare's cron
// day-of-week field runs 1 = Sunday … 7 = Saturday (developers.cloudflare.com/
// workers/configuration/cron-triggers), unlike POSIX cron's 0-6. The original
// "*/5 16-17 * * 1" therefore fired every SUNDAY 9 AM PT from 2026-07-16 to
// 2026-08-31: the handler ran, the Monday gate below correctly refused, and
// nothing anywhere recorded it — push_broadcast_log stayed empty for the
// entire life of the feature, including the five ungated Mondays before W820.
// cron-config.test.ts pins this string against wrangler.toml and forbids bare
// numeric weekdays; scheduled() no longer keys dispatch on it (index.ts).
export const UPDATE_PUSH_CRON = '*/5 16-17 * * MON';

export interface StoreRelease {
  fresh: boolean;
  version: string | null;
  released_at: string | null;
  age_days: number | null;
  /** null when fresh; otherwise why not: STALE, HTTP_<status>, NO_RELEASE_DATE, FETCH_<message>. */
  reason: string | null;
  attempts: number;
}

// W835 — the lookup surfaces the live store VERSION so the per-user gate can
// compare against reported builds. fresh:false → no broadcast at all.
// W904 — two attempts (Apple's lookup is occasionally flaky from datacenter
// egress) and a REASON on every non-fresh result, which the cron journals.
// Exported for the admin status route. Still FAIL CLOSED.
export async function storeRelease(): Promise<StoreRelease> {
  const MAX_ATTEMPTS = 2;
  let reason = 'UNKNOWN';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${APP_STORE_ID}&t=${Date.now()}`, {
        headers: { accept: 'application/json', 'user-agent': 'awakened-backend/update-push' },
      });
      if (!res.ok) {
        reason = `HTTP_${res.status}`;
        continue;
      }
      const data = (await res.json()) as {
        results?: { currentVersionReleaseDate?: string; version?: string }[];
      };
      const r0 = data.results && data.results[0];
      const iso = r0 && r0.currentVersionReleaseDate;
      const version = (r0 && typeof r0.version === 'string' && r0.version) || null;
      if (!iso) return { fresh: false, version, released_at: null, age_days: null, reason: 'NO_RELEASE_DATE', attempts: attempt };
      const ageMs = Date.now() - Date.parse(iso);
      const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= RELEASE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      return {
        fresh,
        version,
        released_at: iso,
        age_days: Number.isFinite(ageMs) ? Math.round((ageMs / 86400000) * 100) / 100 : null,
        reason: fresh ? null : 'STALE',
        attempts: attempt,
      };
    } catch (e) {
      reason = 'FETCH_' + (e instanceof Error ? e.message : String(e)).slice(0, 80);
    }
  }
  return { fresh: false, version: null, released_at: null, age_days: null, reason, attempts: MAX_ATTEMPTS };
}

// W904 — cron_runs journal (migration 0054). `once` dedupes per (day,
// decision) — and callers fold the REASON into the decision, so a Monday whose
// lookup fails three different ways leaves three rows, not the first one only.
// A quiet Monday costs a couple of rows rather than one per invocation; PAGE
// actions are journaled individually. Never throws — the
// journal must not be able to break the job it observes.
async function journal(
  env: Env,
  cron: string | undefined,
  dayKey: string,
  decision: string,
  detail: unknown,
  once: boolean,
): Promise<void> {
  const job = 'update-push';
  const det = detail === undefined ? null : JSON.stringify(detail).slice(0, 2000);
  try {
    if (once) {
      await env.DB.prepare(
        `INSERT INTO cron_runs (job, cron, day_key, decision, detail)
         SELECT ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM cron_runs WHERE job = ? AND day_key = ? AND decision = ?)`,
      )
        .bind(job, cron ?? null, dayKey, decision, det, job, dayKey, decision)
        .run();
    } else {
      await env.DB.prepare('INSERT INTO cron_runs (job, cron, day_key, decision, detail) VALUES (?, ?, ?, ?, ?)')
        .bind(job, cron ?? null, dayKey, decision, det)
        .run();
    }
  } catch (e) {
    console.error('[update-push] journal failed', JSON.stringify({ dayKey, decision, error: e instanceof Error ? e.message : String(e) }));
  }
}

/** Cron entry — W904: called on EVERY scheduled invocation and self-gated to
 *  Monday 9 AM Pacific + a fresh App Store release, then one page with the
 *  per-user version gate (W835). `cron` is the triggering expression, kept
 *  for the journal so Monday's rows show WHICH trigger did the work. (The
 *  admin test-fire route calls runUpdatePushPage directly and bypasses all
 *  three gates: day/hour, freshness, and per-user version.) */
export async function runUpdatePushCron(env: Env, cron?: string): Promise<void> {
  const { dayKey, hour, weekday } = ptParts();
  if (weekday !== 1 || hour !== 9) {
    // Heartbeat for the dedicated trigger only (its off-hour runs, deduped to
    // one row per day): proves the trigger fires on the day we believe it
    // does. The 2-minute sweep is never journaled outside the window.
    if (cron === UPDATE_PUSH_CRON) await journal(env, cron, dayKey, 'SKIP_GATE', { hour, weekday }, true);
    return;
  }
  // Once the day is completed, the remaining in-window runs stop here — no
  // lookup, no journal row (the PAGE rows already tell the story).
  try {
    const done = await env.DB.prepare('SELECT completed FROM push_broadcast_log WHERE day_key = ?')
      .bind(dayKey)
      .first<{ completed: number }>();
    if (done && done.completed) return;
  } catch {
    /* fall through — runUpdatePushPage re-reads the ledger itself */
  }
  const release = await storeRelease();
  if (!release.fresh) {
    console.log(`[update-push] ${dayKey}: no App Store release in the last ${RELEASE_WINDOW_DAYS}d — broadcast skipped (W820)`);
    await journal(env, cron, dayKey, `SKIP_NOT_FRESH:${release.reason || 'UNKNOWN'}`, release, true);
    return;
  }
  const page = await runUpdatePushPage(env, dayKey, release.version || undefined);
  // Reasons ride in the decision so the once-per-day dedupe keeps one row PER
  // DISTINCT OUTCOME, not just the first outcome of the day.
  const decision = !page.ok ? `PAGE_FAILED:${page.reason || 'UNKNOWN'}` : page.reason ? `PAGE_${page.reason}` : 'PAGE';
  await journal(env, cron, dayKey, decision, { release, page }, decision !== 'PAGE');
}

/** W904 — read-only status for GET /v1/admin/update-push/status. Nothing here
 *  sends: the PT clock and whether the gate is open right now, the live App
 *  Store lookup (with its failure reason), the audience Monday's page would
 *  target under the W835 per-user gate, the ledger tail, and the journal. */
export async function updatePushStatus(env: Env): Promise<Record<string, unknown>> {
  const pt = ptParts();
  const release = await storeRelease();
  // The ledger's cursor is a user id (keyset pagination) — project it to a flag
  // so the payload carries no identifiers, matching the counts-only audience.
  const ledger = await env.DB.prepare(
    `SELECT day_key, cursor <> '' AS started, sent_users, completed, updated_at
       FROM push_broadcast_log ORDER BY day_key DESC LIMIT 5`,
  ).all();
  // The journal table arrives by hand-applied migration (0054); if it is
  // missing, say so by name instead of 500ing the whole readiness check.
  let runs: unknown[] = [];
  let journalTable: 'ok' | 'missing' = 'ok';
  try {
    const r = await env.DB.prepare(
      'SELECT id, cron, day_key, ran_at, decision, detail FROM cron_runs WHERE job = ? ORDER BY id DESC LIMIT 25',
    )
      .bind('update-push')
      .all();
    runs = r.results ?? [];
  } catch {
    journalTable = 'missing';
  }
  // Audience preview — the page's own build subselect over every token-holding
  // user, without cursor or sends.
  const aud = await env.DB.prepare(
    `SELECT dt.user_id AS user_id,
            (SELECT ao.build FROM app_opens ao
              WHERE ao.user_id = dt.user_id AND ao.build IS NOT NULL
              ORDER BY ao.date_utc DESC LIMIT 1) AS build
       FROM device_tokens dt
      GROUP BY dt.user_id`,
  ).all<{ user_id: string; build: string | null }>();
  const rows = aud.results ?? [];
  const wouldSend = release.version ? rows.filter((r) => !buildIsCurrent(r.build, release.version as string)).length : rows.length;
  return {
    now_utc: new Date().toISOString(),
    pt,
    gate_open_now: pt.weekday === 1 && pt.hour === 9,
    cron: UPDATE_PUSH_CRON,
    release_window_days: RELEASE_WINDOW_DAYS,
    push_configured: pushConfigured(env),
    release,
    audience: {
      token_users: rows.length,
      would_send: wouldSend,
      already_current: rows.length - wouldSend,
      never_reported_build: rows.filter((r) => !r.build).length,
    },
    ledger: ledger.results ?? [],
    journal_table: journalTable,
    runs,
  };
}
