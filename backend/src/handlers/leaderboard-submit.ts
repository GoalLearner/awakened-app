/**
 * POST /v1/leaderboard/submit
 *
 * Authenticated endpoint. Upserts the calling user's snapshot for
 * a single metric:
 *
 *   - current_value:
 *       * For WEEKLY CUMULATIVE metrics (step_total, flights_climbed)
 *         within the SAME week_start, monotonic non-decreasing:
 *         MAX(existing, new). Once a user has earned a higher
 *         cumulative weekly value, later partial / stale-cache /
 *         HealthKit-corrected resubmits cannot downgrade the
 *         leaderboard within that week. Cross-week (new week_start
 *         vs the stored one) always REPLACES, so Sunday rollover
 *         starts the counter from the new week's value (could be
 *         lower than last week, that's intended).
 *       * For NON-WEEKLY metrics (streaks) and when week_start is
 *         NULL (cross-week / no-week path), current_value is
 *         overwritten with the new value — streaks can legitimately
 *         decrease when a streak breaks.
 *   - best_value is MAX(existing_best, new_current) — best is sticky
 *     and never decreases. Powers "personal record" surfaces in client.
 *
 * v3 Phase 1z.131 — adds the weekly-monotonic clause for current_value.
 * Bug fix: rendiesel earlier submitted step_total=101,259 (qualifying
 * for the 100K Club accolade + Hall of Fame record), then a later
 * partial submit of 73,840 overwrote current_value back below the
 * earlier peak, producing the screenshot mismatch where the 100K Club
 * + Hall of Fame views still showed 101K while This Week showed 73,840.
 * Streaks intentionally not affected (NULL week_start short-circuits).
 *
 * Body: { metric, current_value }
 * Response: { current_value, best_value } reflecting actual DB state
 *
 * BACKEND.md §8.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { isValidMetric, isWeeklyMetric, METRIC_CAPS, type Metric } from '../lib/metrics';
import { getAccoladeWeekStart } from '../lib/accolade-week';

// v3 Phase 1z.27 -- 100K Step Club accolade. Awarded inline during
// leaderboard submit when `metric === 'step_total'` and the submitted
// value crosses 100,000 in the current Sunday-UTC week. Type kept
// generic so future accolade types ('sleep_perfect_month', etc.) can
// be awarded from their own write paths without schema changes.
const STEP_100K_THRESHOLD = 100000;
const STEP_100K_ACCOLADE_TYPE = 'step_100k_club';
// Sim test users (sims/scripts seed worker) must not earn real
// accolades. Their apple_sub values are 'sim_test_alpha' /
// 'sim_test_bravo' (see backend/scripts/seed-sim-users.ts).
const SIM_APPLE_SUB_PREFIX = 'sim_test_';

// v3 Phase 1z.140 — trusted weekly-sum sources. Submits tagged with
// one of these source identifiers come from a client whose weekly
// sum is anchored to Sunday-UTC (the same boundary the backend uses
// for week_start). The 1z.131 same-week monotonic MAX clause has a
// targeted exception: the FIRST trusted submit for a (user, metric)
// row can override MAX and bring a contaminated pre-w18 value down
// to the trusted reality. After that, MAX resumes (the trust marker
// is sticky, so arbitrary lower submits can never downgrade it).
//
// Bumping the list requires adding the new identifier here AND in
// the client (see auth.js submitLeaderboardSnapshot caller in app.js
// lbSubmitAllMetrics). Unknown / empty / unrecognised values are
// treated as untrusted (NULL persisted) for safety.
// v3 Phase 1z.218 — dual-tag transition allowlist.
//   'client_sunday_utc_v2'   — w19+ clients that sum the week
//                              against Sunday-UTC. Legacy from
//                              before the Pacific reset switch.
//                              Will be retired in 1z.221 (~2-3
//                              weeks after the Pacific deploy)
//                              once TestFlight w83+ rollout
//                              completes and breadcrumb telemetry
//                              shows no residual UTC-tagged
//                              traffic.
//   'client_pacific_week_v1' — w83+ clients that sum the week
//                              against Sunday in
//                              America/Los_Angeles. Matches the
//                              new backend Pacific anchor in
//                              getAccoladeWeekStart (1z.218).
// Both are accepted as trusted during the transition window so a
// mixed-build user base can keep the 1z.140 self-heal CASE firing
// correctly. After 1z.221 drops the UTC tag, an older client's
// submit becomes untrusted (sourcePersisted = NULL) and the
// 1z.216 cross-week guard zeroes any cross-period contamination.
const TRUSTED_WEEKLY_SUM_SOURCES: ReadonlySet<string> = new Set([
  'client_sunday_utc_v2',
  'client_pacific_week_v1',
]);

interface SubmitBody {
  metric?: unknown;
  current_value?: unknown;
  /** v3 Phase 1z.140 — optional client tag identifying the algorithm
   *  used to compute weekly cumulative sums. See TRUSTED_WEEKLY_SUM_SOURCES. */
  weekly_sum_source?: unknown;
}

interface SnapshotRow {
  current_value: number;
  best_value: number;
}

export async function handleLeaderboardSubmit(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_LEADERBOARD_SUBMIT.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(
      429,
      'RATE_LIMITED',
      'Too many leaderboard submissions. Try again in a minute.',
    );
  }

  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object') {
    return jsonError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }

  if (!isValidMetric(body.metric)) {
    return jsonError(
      400,
      'INVALID_METRIC',
      'metric must be one of: step_total, sleep_streak, bedtime_streak, workout_streak.',
    );
  }
  const metric: Metric = body.metric;

  const rawValue = body.current_value;
  if (!Number.isInteger(rawValue) || (rawValue as number) < 0) {
    return jsonError(400, 'INVALID_VALUE', 'current_value must be a non-negative integer.');
  }
  const value = rawValue as number;
  if (value > METRIC_CAPS[metric]) {
    return jsonError(
      400,
      'INVALID_VALUE',
      `current_value exceeds sanity cap (${METRIC_CAPS[metric]}) for metric ${metric}.`,
    );
  }

  // v3 Phase 1z.140 — trusted weekly-sum source tag. Optional. If
  // the client sends a recognised identifier we persist it; anything
  // else (missing, wrong type, unknown string) is treated as
  // untrusted and stored as NULL. The trust marker is only meaningful
  // for weekly cumulative metrics (step_total / flights_climbed); we
  // still accept and persist it on streak metrics for forward
  // compatibility but the self-heal CASE below ignores it on streaks.
  const rawSource = body.weekly_sum_source;
  const weeklySumSource: string | null =
    (typeof rawSource === 'string' && TRUSTED_WEEKLY_SUM_SOURCES.has(rawSource))
      ? rawSource
      : null;

  const now = Date.now();

  // v3 Phase 1z.33 -- weekly scoping. For weekly metrics (step_total),
  // tag the snapshot row with the current Sunday-UTC week key so the
  // top handler can filter stale prior-week rows out of the ranking.
  // Non-weekly metrics (sleep_streak, bedtime_streak) pass NULL --
  // they represent running counts that intentionally carry forward.
  const weekStart: string | null = isWeeklyMetric(metric)
    ? getAccoladeWeekStart(now)
    : null;

  // UPSERT with MAX preservation on best_value AND same-week
  // monotonic MAX on current_value for weekly cumulative metrics.
  // SQLite (D1) supports ON CONFLICT...DO UPDATE syntax;
  // excluded.<col> refers to the values we tried to insert.
  //
  // current_value CASE:
  //   - v3 Phase 1z.140 SELF-HEAL FIRST-TRUSTED-SUBMIT:
  //       excluded.weekly_sum_source is a recognised trusted tag
  //       AND existing stored source is NULL (pre-w19 client)
  //       AND same week
  //         → excluded.current_value  (trust the new corrected value;
  //           overrides MAX so pre-w18 rollover-contaminated rows
  //           heal as soon as the user's w19+ client submits)
  //   - v3 Phase 1z.216F UNTRUSTED SAME-WEEK NULL-SOURCE FREEZE:
  //       excluded.weekly_sum_source IS NULL (untrusted client)
  //       AND existing.weekly_sum_source IS NULL (existing row is
  //           also untrusted — typically a row that was either
  //           never reached by a trusted client, or was manually
  //           cleaned by ops without a trust marker being set)
  //       AND same week
  //         → leaderboard_snapshots.current_value (FREEZE — refuse
  //           to raise via the MAX branch below)
  //       Why: the 1z.216 cross-week guard sets contaminated
  //       cross-week submits to 0, but it does NOT protect against
  //       an untrusted client re-uploading a same-week contaminated
  //       value AFTER an ops cleanup. Without this guard, the
  //       sequence: (1) ops UPDATE current_value=0, (2) untrusted
  //       client submits 78684 again with same week_start →
  //       Branch 1z.131 below fires, MAX(0, 78684) restores the
  //       contamination. The freeze closes that loop: a NULL-source
  //       row can only be raised by a TRUSTED submit (handled by
  //       the self-heal branch above), never by another untrusted
  //       submit. Trusted clients are unaffected because the
  //       self-heal branch sits above this one.
  //   - 1z.131 SAME-WEEK MONOTONIC MAX:
  //       excluded.week_start NOT NULL
  //       AND existing.week_start = excluded.week_start
  //         → MAX(existing.current_value, new) — never downgrade in-week
  //   - v3 Phase 1z.216 CROSS-WEEK UNTRUSTED SUBMIT GUARD:
  //       excluded.weekly_sum_source IS NULL (untrusted client)
  //       AND existing.week_start <> excluded.week_start (boundary crossed)
  //         → 0  (the new period enters empty. The next trusted submit
  //           ratchets up via the SELF-HEAL branch above.)
  //       Why: at the UTC Sunday rollover (5 PM PDT Saturday), a
  //       pre-w19 / device-local-summing client computes its
  //       weekly sum as the FULL previous 7 days of steps, then
  //       the server stamps the submit with the NEW week_start.
  //       Without this branch the ELSE below wrote that
  //       contaminated cumulative total under the new period_key
  //       — e.g. real user 'galilea' carrying 78,684 from
  //       2026-05-24 into 2026-05-31 within minutes of rollover.
  //       Forcing 0 means a contaminated cross-week submit is
  //       neutralised; honest subsequent submits (in-week MAX or
  //       trusted self-heal) populate normally.
  //   - OTHERWISE (NULL week_start, OR same week with no other
  //     branch matched, OR trust marker already established):
  //       → excluded.current_value — overwrite (streaks can decrease,
  //         non-weekly metrics carry forward, etc.)
  //
  // weekly_sum_source persistence: COALESCE on incoming so a
  // submission without the tag (legacy client, streak metric, etc.)
  // does not wipe an existing trust marker.
  //
  // week_start is also updated on conflict so a user submitting in a
  // new week overwrites their prior-week tag. (The 1z.216 guard
  // above neutralises the *value*; the week_start pointer still
  // advances so future same-week submits use the MAX branch.)
  await env.DB.prepare(
    `INSERT INTO leaderboard_snapshots
       (user_id, metric, current_value, best_value, updated_at, week_start, weekly_sum_source)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, metric) DO UPDATE SET
       current_value = CASE
         WHEN excluded.weekly_sum_source IS NOT NULL
              AND leaderboard_snapshots.weekly_sum_source IS NULL
              AND excluded.week_start IS NOT NULL
              AND leaderboard_snapshots.week_start = excluded.week_start
           THEN excluded.current_value
         WHEN excluded.weekly_sum_source IS NULL
              AND leaderboard_snapshots.weekly_sum_source IS NULL
              AND excluded.week_start IS NOT NULL
              AND leaderboard_snapshots.week_start = excluded.week_start
           THEN leaderboard_snapshots.current_value
         WHEN excluded.week_start IS NOT NULL
              AND leaderboard_snapshots.week_start = excluded.week_start
           THEN MAX(leaderboard_snapshots.current_value, excluded.current_value)
         WHEN excluded.weekly_sum_source IS NULL
              AND excluded.week_start IS NOT NULL
              AND leaderboard_snapshots.week_start IS NOT NULL
              AND excluded.week_start <> leaderboard_snapshots.week_start
           THEN 0
         ELSE excluded.current_value
       END,
       best_value = MAX(leaderboard_snapshots.best_value, excluded.current_value),
       updated_at = excluded.updated_at,
       week_start = excluded.week_start,
       weekly_sum_source = COALESCE(excluded.weekly_sum_source, leaderboard_snapshots.weekly_sum_source)`,
  )
    .bind(session.userId, metric, value, value, now, weekStart, weeklySumSource)
    .run();

  // Read back the row to return DB-authoritative values. Cheap (PK
  // lookup, single row). Caller's client may have outdated state.
  const row = await env.DB.prepare(
    'SELECT current_value, best_value FROM leaderboard_snapshots WHERE user_id = ? AND metric = ?',
  )
    .bind(session.userId, metric)
    .first<SnapshotRow>();

  // v3 Phase 1z.36 -- Weekly Steps Hall of Fame write path. Real
  // users submitting a current-week step_total upsert a per-week
  // record into weekly_step_records. Same-week lower resubmits
  // never reduce the record; same-week higher resubmits raise it;
  // new-week submits create a new (user, week) row. Sim users
  // (apple_sub LIKE 'sim_test_%') are excluded -- they remain
  // client-only display entries.
  //
  // We share the apple_sub lookup with the 100K accolade branch
  // below by hoisting it. One SELECT per submit instead of two.
  let appleSub: string | null = null;
  let isSimUser = false;
  if (metric === 'step_total') {
    const userRow = await env.DB.prepare(
      'SELECT apple_sub FROM users WHERE id = ?',
    ).bind(session.userId).first<{ apple_sub: string }>();
    appleSub = userRow?.apple_sub ?? null;
    isSimUser = !!appleSub && appleSub.startsWith(SIM_APPLE_SUB_PREFIX);

    if (!isSimUser && weekStart !== null) {
      // v3 Phase 1z.38 -- belt-and-suspenders. The weekly_step_records
      // table is added by migration 0009. If the worker is deployed
      // ahead of (or without) that migration, this INSERT throws
      // SqliteError: no such table -- which without isolation would
      // bubble up and 500 the entire submit, taking down the current-
      // week leaderboard write AND the 100K accolade award with it.
      // Wrap ONLY this statement so a HoF write failure degrades to
      // a logged warning while the rest of the submit completes.
      //
      // We intentionally do NOT wrap the leaderboard_snapshots upsert
      // above or the user_accolades upsert below -- those are core
      // and a failure there SHOULD surface as 500 so the caller can
      // retry. HoF is best-effort historical metadata; a missed
      // record on a flaky write is recoverable via the user's next
      // submit (same-week MAX-preserve semantics handle the gap).
      try {
        const recordId = crypto.randomUUID();
        // v3 Phase 1z.140 — same self-heal CASE on Hall of Fame.
        // First trusted submit for a (user, week_start) row whose
        // stored source is NULL overrides the MAX clause and writes
        // the trusted value (which may be lower than the pre-w18
        // rollover-contaminated number). Subsequent submits use MAX.
        // Trust marker COALESCEd so streak/legacy submits never wipe
        // an established trust. The Hall of Fame table only stores
        // step_total totals, so weekly_sum_source semantics are
        // identical to the snapshot table.
        await env.DB.prepare(
          `INSERT INTO weekly_step_records
             (id, user_id, week_start, steps, created_at, updated_at, weekly_sum_source)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, week_start) DO UPDATE SET
             steps = CASE
               WHEN excluded.weekly_sum_source IS NOT NULL
                    AND weekly_step_records.weekly_sum_source IS NULL
                 THEN excluded.steps
               ELSE MAX(weekly_step_records.steps, excluded.steps)
             END,
             updated_at        = excluded.updated_at,
             weekly_sum_source = COALESCE(excluded.weekly_sum_source, weekly_step_records.weekly_sum_source)`,
        )
          .bind(recordId, session.userId, weekStart, value, now, now, weeklySumSource)
          .run();
      } catch (e) {
        const detail = e instanceof Error ? (e.message || String(e)) : String(e);
        // eslint-disable-next-line no-console
        console.warn(
          '[hall-of-fame] weekly_step_records upsert failed; submit continues.',
          'user_id=' + session.userId,
          'week_start=' + weekStart,
          'value=' + value,
          'error=' + detail,
        );
      }
    }
  }

  // v3 Phase 1z.27 -- 100K Step Club accolade award (inline).
  // Runs ONLY when:
  //   - metric is step_total
  //   - submitted value >= 100,000 (sanity cap already applied above)
  //   - the user is NOT a sim test user
  // Same-week resubmits at higher value bump best_value via MAX but
  // do NOT increment repeat_count (CASE on last_qualified_week_start).
  // Cross-week qualifying submits increment repeat_count.
  if (metric === 'step_total' && value >= STEP_100K_THRESHOLD) {
    // appleSub + isSimUser already loaded above (hoisted in 1z.36).
    if (!isSimUser) {
      const weekStart = getAccoladeWeekStart(now);
      const accoladeId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO user_accolades
           (id, user_id, accolade_type, unlock_week_start, unlock_value,
            best_value, repeat_count, last_qualified_week_start, unlocked_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(user_id, accolade_type) DO UPDATE SET
           best_value   = MAX(user_accolades.best_value, excluded.best_value),
           repeat_count = CASE
             WHEN user_accolades.last_qualified_week_start = excluded.last_qualified_week_start
               THEN user_accolades.repeat_count
               ELSE user_accolades.repeat_count + 1
           END,
           last_qualified_week_start = excluded.last_qualified_week_start,
           updated_at = excluded.updated_at`,
      )
        .bind(
          accoladeId,
          session.userId,
          STEP_100K_ACCOLADE_TYPE,
          weekStart,        // unlock_week_start (only used on INSERT)
          value,            // unlock_value      (only used on INSERT)
          value,            // best_value        (INSERT + MAX UPDATE candidate)
          weekStart,        // last_qualified_week_start
          now,              // unlocked_at       (only used on INSERT)
          now,              // updated_at
        )
        .run();
    }
  }

  return jsonOk({
    metric,
    current_value: row?.current_value ?? value,
    best_value: row?.best_value ?? value,
  });
}
