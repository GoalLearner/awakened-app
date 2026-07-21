/**
 * Discipline Duels v1 (v3 Phase 1x) — duels handler.
 *
 *   GET    /v1/duels           — list (incoming/outgoing/active/recent)
 *   POST   /v1/duels           — create a pending challenge to a friend
 *   POST   /v1/duels/:id/accept   — opponent accepts → status becomes 'active'
 *   POST   /v1/duels/:id/decline  — opponent declines → status 'declined'
 *   GET    /v1/duels/:id          — single duel detail (participants only)
 *
 * Auth required on every endpoint. user_id is derived from JWT only.
 *
 * SOULS are METADATA ONLY in v1 — stake/reward/burn values live on the
 * row for display but no spend/award logic runs. localStorage souls
 * remain client-side authoritative until scoring lands in a later pass.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
// Co-op Dungeon Bosses v1 (W371) — a boss_instance_id-tagged step event is
// validated (participant + active + in-window) before insert so the
// server-authoritative co-op win can't be forged or won past the window.
import { validateBossInstanceForUser } from './coop-boss';
// v3 Phase 1z.279 — Duels permanently retired. This file is now
// the residual carrier for two endpoints only:
//   - POST /v1/verified-events     (handleVerifiedEventsSubmit)
//   - POST /v1/duels/:id/resolve   (handleDuelsResolve)
// All other handlers (list/create/accept/decline/cancel/detail/
// progress/score), the friend-lookup imports, and the
// create-handler constants (stakes, durations, ALLOWED_DUEL_TYPES)
// were removed. DEFAULT_DUEL_TYPE stays because serializeDuel
// still falls back to it for legacy rows missing duel_type.
const DEFAULT_DUEL_TYPE = 'verified_objectives';

// ─────────────────────────────────────────────────────────────
// Verified Duel Scoring Engine v1 (v3 Phase 1z).
//
// 5 scorable duel types + boss_race deferred. The aggregator branches
// on duel_type to pick the matching event_type set and aggregation
// strategy:
//
//   steps                 → MAX(value) over 'steps_total' events.
//   sleep                 → COUNT DISTINCT metric_date over
//                           'sleep_7h_night' events.
//   bedtime               → COUNT DISTINCT metric_date over
//                           'bedtime_before_midnight' events.
//   strength              → COUNT(*) over 'strength_workout' events
//                           (one row per workout; client uses uuid in
//                           client_event_id to dedupe).
//   verified_objectives   → COUNT DISTINCT (event_type, metric_date)
//                           pairs across the 4 verified_objective_*
//                           event types. So a daily-walk + sleep on
//                           the same day = 2 objectives.
//   boss_race             → NOT SCORED in v1. resolve returns winner=
//                           null + result='draw' (no reward settle).
// ─────────────────────────────────────────────────────────────
const ALLOWED_EVENT_TYPES = new Set([
  'steps_total',
  'flights_total', // W397 — stairs-climbed co-op (The Hollow Monarch, B-rank)
  'sleep_minutes_total', // W686 — cumulative minutes asleep in a co-op hunt window (The Sleepless Crown, S-rank steps+sleep raid). Same resubmit-growing-total + MAX-per-user convention as steps_total.
  'sleep_7h_night',
  'bedtime_before_midnight',
  'strength_workout',
  'verified_objective_daily_walk',
  'verified_objective_sleep',
  'verified_objective_bedtime',
  'verified_objective_strength',
  'boss_defeat_verified', // accepted for future, never scored in v1
]);
const ALLOWED_EVENT_SOURCES = new Set([
  'apple_health',
  'system_verified',
  'verified_boss',
]);
const MAX_EVENTS_PER_BATCH = 25;
// W686 — per-type flat sanity caps at ingest (physical impossibility bounds).
const EVENT_VALUE_CAPS: Record<string, number> = { sleep_minutes_total: 10080 };
const DUEL_REWARD_REASON = 'duel_win';
// v3 Phase 1z.155 — loser stake deduction reason. Pairs with the
// winner-side DUEL_REWARD_REASON above; both inserts share the
// UNIQUE(user_id, ref_type, ref_id, reason) index on
// user_souls_ledger, so re-resolve of the same duel can never
// double-award or double-deduct. Draws insert NEITHER row.
const DUEL_LOSS_REASON = 'duel_loss';

type Aggregate =
  | 'max'
  | 'count_distinct_date'
  | 'count_events'
  | 'count_distinct_type_date'
  | 'unsupported';

const DUEL_SCORING_CFG: Record<string, { eventTypes: string[]; aggregate: Aggregate }> = {
  steps: {
    eventTypes: ['steps_total'],
    aggregate: 'max',
  },
  sleep: {
    eventTypes: ['sleep_7h_night'],
    aggregate: 'count_distinct_date',
  },
  bedtime: {
    eventTypes: ['bedtime_before_midnight'],
    aggregate: 'count_distinct_date',
  },
  strength: {
    eventTypes: ['strength_workout'],
    aggregate: 'count_events',
  },
  verified_objectives: {
    eventTypes: [
      'verified_objective_daily_walk',
      'verified_objective_sleep',
      'verified_objective_bedtime',
      'verified_objective_strength',
    ],
    aggregate: 'count_distinct_type_date',
  },
  boss_race: {
    eventTypes: [],
    aggregate: 'unsupported',
  },
};

async function computeUserScoreForDuel(
  env: Env,
  duel: DuelRow,
  userId: string,
): Promise<number> {
  const cfg = DUEL_SCORING_CFG[duel.duel_type];
  if (!cfg || cfg.aggregate === 'unsupported' || cfg.eventTypes.length === 0) return 0;
  const placeholders = cfg.eventTypes.map(() => '?').join(',');
  if (cfg.aggregate === 'max') {
    const row = await env.DB.prepare(
      `SELECT COALESCE(MAX(value), 0) AS s FROM verified_events
        WHERE duel_id = ? AND user_id = ? AND event_type IN (${placeholders})`,
    )
      .bind(duel.id, userId, ...cfg.eventTypes)
      .first<{ s: number }>();
    return Number(row?.s ?? 0);
  }
  if (cfg.aggregate === 'count_distinct_date') {
    const row = await env.DB.prepare(
      `SELECT COUNT(DISTINCT metric_date) AS s FROM verified_events
        WHERE duel_id = ? AND user_id = ? AND event_type IN (${placeholders})
          AND metric_date IS NOT NULL`,
    )
      .bind(duel.id, userId, ...cfg.eventTypes)
      .first<{ s: number }>();
    return Number(row?.s ?? 0);
  }
  if (cfg.aggregate === 'count_events') {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS s FROM verified_events
        WHERE duel_id = ? AND user_id = ? AND event_type IN (${placeholders})`,
    )
      .bind(duel.id, userId, ...cfg.eventTypes)
      .first<{ s: number }>();
    return Number(row?.s ?? 0);
  }
  if (cfg.aggregate === 'count_distinct_type_date') {
    const row = await env.DB.prepare(
      `SELECT COUNT(DISTINCT event_type || ':' || COALESCE(metric_date, client_event_id, id)) AS s
         FROM verified_events
        WHERE duel_id = ? AND user_id = ? AND event_type IN (${placeholders})`,
    )
      .bind(duel.id, userId, ...cfg.eventTypes)
      .first<{ s: number }>();
    return Number(row?.s ?? 0);
  }
  return 0;
}

/**
 * Pull verified scores for both participants of a duel. Returns a
 * Map<userId, score>. For boss_race (unsupported), returns zeros so
 * resolve always renders a draw without throwing.
 */
async function getDuelVerifiedScores(
  env: Env,
  duel: DuelRow,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const cfg = DUEL_SCORING_CFG[duel.duel_type];
  if (!cfg || cfg.aggregate === 'unsupported') {
    out.set(duel.challenger_user_id, 0);
    out.set(duel.opponent_user_id, 0);
    return out;
  }
  const [c, o] = await Promise.all([
    computeUserScoreForDuel(env, duel, duel.challenger_user_id),
    computeUserScoreForDuel(env, duel, duel.opponent_user_id),
  ]);
  out.set(duel.challenger_user_id, c);
  out.set(duel.opponent_user_id, o);
  return out;
}

/**
 * Fall back to legacy duel_progress_snapshots when no verified_events
 * have been recorded for the duel (back-compat for steps duels that
 * were already active when 1z shipped).
 */
async function hasAnyVerifiedEventForDuel(env: Env, duelId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS exists_flag FROM verified_events WHERE duel_id = ? LIMIT 1`,
  )
    .bind(duelId)
    .first<{ exists_flag: number }>();
  return !!row;
}

/**
 * v3 Phase 1z.155 — full duel economy settlement (winner reward +
 * loser stake deduction).
 *
 * On a non-draw resolved duel, INSERT (idempotent) TWO rows into
 * user_souls_ledger:
 *   - winner: delta = +reward_souls, reason = 'duel_win'
 *   - loser:  delta = -stake_souls,  reason = 'duel_loss'
 *
 * Draws (winner_user_id IS NULL) insert NEITHER row — neither side
 * was charged a stake at challenge/accept time (no escrow yet in
 * MVP), so there's nothing to refund and no reward to issue. Draw
 * duels still set reward_settled_at so subsequent reads can
 * distinguish "settled-as-draw" from "settled-pending".
 *
 * Idempotency is guaranteed by the UNIQUE(user_id, ref_type, ref_id,
 * reason) index on user_souls_ledger. Re-resolve hits both INSERTs
 * but both fail silently via INSERT OR IGNORE. The reward_settled_at
 * UPDATE has its own `WHERE reward_settled_at IS NULL` guard.
 *
 * Local hb_souls is STILL not modified by this phase — Phase β will
 * add a response payload exposing the per-user delta + running
 * balance, and Phase γ will sync that into the frontend display.
 * This phase is backend-only: ledger rows accumulate correctly so
 * future reconciliation has the right data to draw from.
 *
 * Failures here are swallowed by the resolve handler (try/catch
 * around the call site) so a flaky ledger insert can't 500 the
 * core resolve. Same isolation pattern as the 1z.38 Hall of Fame
 * write isolation.
 */
export async function settleDuelEconomy(env: Env, duel: DuelRow): Promise<void> {
  const reward = Number(duel.reward_souls) || 0;
  const stake  = Number(duel.stake_souls)  || 0;
  const isDraw = !duel.winner_user_id;

  if (!isDraw && reward > 0) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_souls_ledger (id, user_id, delta, reason, ref_type, ref_id, metadata_json)
       VALUES (?, ?, ?, ?, 'duel', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        duel.winner_user_id,
        reward,
        DUEL_REWARD_REASON,
        duel.id,
        JSON.stringify({ duel_type: duel.duel_type, result: duel.result }),
      )
      .run();
  }

  if (!isDraw && stake > 0) {
    // Derive the loser id from the winner id + the two participants.
    // Defensive: if winner_user_id matches neither participant (should
    // be impossible after a successful resolve), bail without writing
    // a loser row — better to skip than to debit the wrong person.
    const loserUserId =
      duel.winner_user_id === duel.challenger_user_id ? duel.opponent_user_id :
      duel.winner_user_id === duel.opponent_user_id   ? duel.challenger_user_id :
      null;
    if (loserUserId) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO user_souls_ledger (id, user_id, delta, reason, ref_type, ref_id, metadata_json)
         VALUES (?, ?, ?, ?, 'duel', ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          loserUserId,
          -stake,
          DUEL_LOSS_REASON,
          duel.id,
          JSON.stringify({ duel_type: duel.duel_type, result: duel.result }),
        )
        .run();
    }
  }

  // Mark settled regardless of draw vs decisive — this guards a future
  // cron/sweeper from re-processing the same duel forever. The UPDATE
  // is self-idempotent via the `IS NULL` guard.
  await env.DB.prepare(
    `UPDATE duels SET reward_settled_at = CURRENT_TIMESTAMP WHERE id = ? AND reward_settled_at IS NULL`,
  )
    .bind(duel.id)
    .run();
}

/**
 * v3 Phase 1z.156 — Phase β helpers for the resolve response payload.
 *
 * `getUserSoulsBalance` is backend-authoritative: it sums every row in
 * user_souls_ledger for the caller and returns the result. Frontend
 * Phase γ will replace its local `hb_souls` with this value instead
 * of trying to delta-apply, so drift is impossible — backend is truth.
 *
 * `getDuelSoulsDeltaForUser` is a pure function that derives the
 * viewer-perspective delta from a resolved duel row + the caller's
 * user id. Returns:
 *   - +reward_souls when caller is the winner
 *   - -stake_souls  when caller is the loser
 *   -  0            when draw, or when caller is not a participant
 *
 * Both helpers are read-only; they emit no INSERTs/UPDATEs and never
 * touch the duels table. Idempotent by construction — calling either
 * a second time returns the same value as long as the underlying rows
 * haven't changed.
 */
export async function getUserSoulsBalance(env: Env, userId: string): Promise<number> {
  if (!userId) return 0;
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(delta), 0) AS balance
       FROM user_souls_ledger
      WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

export function getDuelSoulsDeltaForUser(duel: DuelRow, userId: string): number {
  if (!userId) return 0;
  if (!duel.winner_user_id) return 0;        // draw
  if (duel.winner_user_id === userId) {
    return Number(duel.reward_souls) || 0;
  }
  // Caller is the loser only if they are the OTHER participant.
  const isLoser =
    (duel.winner_user_id === duel.challenger_user_id && userId === duel.opponent_user_id) ||
    (duel.winner_user_id === duel.opponent_user_id   && userId === duel.challenger_user_id);
  if (isLoser) {
    return -(Number(duel.stake_souls) || 0);
  }
  return 0;                                  // caller is not a participant
}

interface DuelRow {
  id: string;
  challenger_user_id: string;
  opponent_user_id: string;
  status: string;
  stake_souls: number;
  reward_souls: number;
  burn_souls: number;
  duration_days: number;
  // v3 Phase 1z.147 — optional sub-day duration override. NULL on
  // legacy rows + on submissions that didn't pass duration_seconds.
  duration_seconds?: number | null;
  duel_type: string;
  starts_at: string | null;
  ends_at: string | null;
  winner_user_id: string | null;
  challenger_score: number;
  opponent_score: number;
  challenger_verified_score: number;
  opponent_verified_score: number;
  challenger_xp_score: number;
  opponent_xp_score: number;
  created_at: string;
  updated_at: string;
  // Steps Duel Scoring v1 (v3 Phase 1y).
  resolved_at?: string | null;
  result?: string | null;
  // Verified Duel Scoring Engine v1 (v3 Phase 1z).
  reward_settled_at?: string | null;
}

async function getDuelProgress(
  env: Env,
  duelId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await env.DB.prepare(
    `SELECT user_id, value FROM duel_progress_snapshots
       WHERE duel_id = ? AND metric = 'steps'`,
  )
    .bind(duelId)
    .all<{ user_id: string; value: number }>();
  for (const r of rows.results ?? []) {
    out.set(r.user_id, Number(r.value) || 0);
  }
  return out;
}


/**
 * Verified Duel Scoring Engine v1 (v3 Phase 1z). Resolve the
 * authoritative score map for a duel:
 *   1. If any verified_events rows exist for this duel, aggregate per
 *      the duel_type's strategy and return those.
 *   2. Otherwise fall back to legacy duel_progress_snapshots (covers
 *      duels that were already active when 1z shipped).
 *
 * Always returns a Map with both participant ids — missing = 0. Never
 * throws.
 */
async function getDuelEffectiveScores(
  env: Env,
  duel: DuelRow,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  out.set(duel.challenger_user_id, 0);
  out.set(duel.opponent_user_id, 0);

  // v3 Phase 1z.153 — for steps duels, the canonical live store is
  // `duel_progress_snapshots`. The /v1/duels/:id/progress endpoint
  // writes there directly with the w30 day-anchored delta value
  // (correct), and the /progress endpoint returns from there too —
  // so submits and reads agree at the snapshot layer.
  //
  // `verified_events` is ALSO written for steps duels (by
  // submitVerifiedEventsForDuels on the client) but for legacy
  // reasons that path used the pre-w30 narrow-window step query,
  // which silently returns 0. A stale verified_events row would
  // win the MAX() aggregation and overwrite the fresh snapshot,
  // producing the submit-vs-list inconsistency observed on w31:
  // submit returned {you: 285, rival: 97} while the list refetch
  // returned 146/0.
  //
  // Fix: read snapshots first for steps duels. Verified events
  // remain the source of truth for the OTHER scorable duel types
  // (sleep, bedtime, strength, verified_objectives) where the
  // snapshot table is not used.
  if (duel.duel_type === 'steps') {
    const legacy = await getDuelProgress(env, duel.id);
    legacy.forEach((v, k) => out.set(k, v));
    return out;
  }

  const cfg = DUEL_SCORING_CFG[duel.duel_type];
  if (cfg && cfg.aggregate !== 'unsupported') {
    const hasEvents = await hasAnyVerifiedEventForDuel(env, duel.id);
    if (hasEvents) {
      const m = await getDuelVerifiedScores(env, duel);
      m.forEach((v, k) => out.set(k, v));
      return out;
    }
  }
  return out;
}

async function getAliasMap(
  env: Env,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const placeholders = userIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, alias FROM users WHERE id IN (${placeholders})`,
  )
    .bind(...userIds)
    .all<{ id: string; alias: string }>();
  for (const row of rows.results ?? []) {
    map.set(row.id, row.alias);
  }
  return map;
}

function serializeDuel(
  row: DuelRow,
  aliasMap: Map<string, string>,
  viewerUserId: string,
  progressByUserId?: Map<string, number>,
  // v3 Phase 1z.149 — A2 freshness map. Optional; when supplied,
  // exposes per-user server_updated_at ISO strings so the client
  // can compute "snapshot age" for the score-freshness chip on
  // the active duel hero. Legacy callers that omit this argument
  // get null timestamps in the serialized output — harmless.
  progressUpdatedByUserId?: Map<string, string>,
): Record<string, unknown> {
  const isChallenger = row.challenger_user_id === viewerUserId;
  const opponentId = isChallenger ? row.opponent_user_id : row.challenger_user_id;
  const role: 'challenger' | 'opponent' = isChallenger ? 'challenger' : 'opponent';

  let timeRemainingMs: number | null = null;
  if (row.status === 'active' && row.ends_at) {
    const endsMs = Date.parse(row.ends_at);
    if (Number.isFinite(endsMs)) {
      timeRemainingMs = Math.max(0, endsMs - Date.now());
    }
  }

  // Steps Duel Scoring v1 (v3 Phase 1y). Latest snapshot values per
  // participant. null when the participant hasn't submitted yet.
  const challengerProgress = progressByUserId && progressByUserId.has(row.challenger_user_id)
    ? progressByUserId.get(row.challenger_user_id) ?? null
    : null;
  const opponentProgress = progressByUserId && progressByUserId.has(row.opponent_user_id)
    ? progressByUserId.get(row.opponent_user_id) ?? null
    : null;

  return {
    id: row.id,
    status: row.status,
    role,
    challenger: {
      user_id: row.challenger_user_id,
      alias: aliasMap.get(row.challenger_user_id) ?? null,
    },
    opponent: {
      user_id: row.opponent_user_id,
      alias: aliasMap.get(row.opponent_user_id) ?? null,
    },
    opponent_alias: aliasMap.get(opponentId) ?? null,
    stake_souls: row.stake_souls,
    reward_souls: row.reward_souls,
    burn_souls: row.burn_souls,
    duration_days: row.duration_days,
    // v3 Phase 1z.147 — surface seconds alongside days. Clients
    // that understand the new field render the accurate label
    // (e.g. "1 hour"); legacy clients keep reading duration_days.
    duration_seconds: row.duration_seconds ?? null,
    duel_type: row.duel_type || DEFAULT_DUEL_TYPE,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    time_remaining_ms: timeRemainingMs,
    winner_user_id: row.winner_user_id,
    challenger_score: row.challenger_score,
    opponent_score: row.opponent_score,
    challenger_verified_score: row.challenger_verified_score,
    opponent_verified_score: row.opponent_verified_score,
    challenger_xp_score: row.challenger_xp_score,
    opponent_xp_score: row.opponent_xp_score,
    // Steps Duel Scoring v1 (v3 Phase 1y).
    challenger_progress_value: challengerProgress,
    opponent_progress_value: opponentProgress,
    // v3 Phase 1z.149 — A2 freshness signal. Null when no snapshot
    // exists for that participant yet (frontend renders "· not
    // synced yet"). Otherwise an ISO datetime string the client
    // diffs against Date.now() to render "· just now" / "· N min
    // ago" / "· syncing…".
    challenger_progress_updated_at: progressUpdatedByUserId?.get(row.challenger_user_id) ?? null,
    opponent_progress_updated_at: progressUpdatedByUserId?.get(row.opponent_user_id) ?? null,
    resolved_at: row.resolved_at ?? null,
    result: row.result ?? null,
    // Verified Duel Scoring Engine v1 (v3 Phase 1z).
    reward_settled_at: row.reward_settled_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleDuelsResolve(
  _request: Request,
  env: Env,
  session: SessionPayload,
  duelId: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const row = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!row) {
    return jsonError(404, 'NOT_FOUND', 'Duel not found.');
  }
  if (
    row.challenger_user_id !== session.userId &&
    row.opponent_user_id !== session.userId
  ) {
    return jsonError(403, 'FORBIDDEN', 'You are not a participant in this duel.');
  }

  // Idempotent return path. v3 Phase 1z.156 — also returns the
  // viewer-perspective souls payload so a stale client opening a
  // duel that was resolved by another device still gets the
  // up-to-date balance + delta without an extra round-trip.
  if (row.status === 'completed') {
    const aliasMap = await getAliasMap(env, [row.challenger_user_id, row.opponent_user_id]);
    const progress = await getDuelEffectiveScores(env, row);
    const yourDelta = getDuelSoulsDeltaForUser(row, session.userId);
    const yourBalance = await getUserSoulsBalance(env, session.userId);
    return jsonOk({
      ok: true,
      duel: serializeDuel(row, aliasMap, session.userId, progress),
      souls: {
        your_delta:   yourDelta,
        your_balance: yourBalance,
        settled_at:   row.reward_settled_at ?? null,
      },
      already_resolved: true,
    });
  }

  // Verified Duel Scoring Engine v1 (v3 Phase 1z). boss_race is the
  // only duel type still deferred — accepted for create + accept, but
  // resolve fails until the verified boss-event logging path ships.
  if (row.duel_type === 'boss_race') {
    return jsonError(
      400,
      'BOSS_RACE_SCORING_DEFERRED',
      'Boss Race scoring activates after verified boss-event logging.',
    );
  }
  if (!DUEL_SCORING_CFG[row.duel_type] || DUEL_SCORING_CFG[row.duel_type].aggregate === 'unsupported') {
    return jsonError(
      400,
      'DUEL_TYPE_NOT_SCORED_YET',
      `Duel type "${row.duel_type}" is not scored in this version.`,
    );
  }
  if (row.status !== 'active') {
    return jsonError(400, 'BAD_STATE', `Cannot resolve from status "${row.status}".`);
  }
  if (!row.ends_at) {
    return jsonError(400, 'BAD_STATE', 'Duel has no ends_at timestamp.');
  }
  const endsMs = Date.parse(row.ends_at);
  if (Number.isFinite(endsMs) && Date.now() < endsMs) {
    return jsonError(400, 'DUEL_NOT_ENDED', 'Duel has not yet ended.');
  }

  // Resolve. verified_events first (new engine), fall back to legacy
  // duel_progress_snapshots if a steps duel was active before 1z
  // shipped and never re-submitted.
  const progress = await getDuelEffectiveScores(env, row);
  const challengerScore = progress.get(row.challenger_user_id) ?? 0;
  const opponentScore   = progress.get(row.opponent_user_id) ?? 0;

  let winnerUserId: string | null;
  let result: 'challenger_win' | 'opponent_win' | 'draw';
  if (challengerScore > opponentScore) {
    winnerUserId = row.challenger_user_id;
    result = 'challenger_win';
  } else if (opponentScore > challengerScore) {
    winnerUserId = row.opponent_user_id;
    result = 'opponent_win';
  } else {
    winnerUserId = null;
    result = 'draw';
  }

  await env.DB.prepare(
    `UPDATE duels
        SET status = 'completed',
            winner_user_id = ?,
            result = ?,
            challenger_score = ?,
            opponent_score = ?,
            challenger_verified_score = ?,
            opponent_verified_score = ?,
            resolved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(
      winnerUserId,
      result,
      challengerScore,
      opponentScore,
      challengerScore,
      opponentScore,
      duelId,
    )
    .run();

  const refreshed = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!refreshed) {
    return jsonError(500, 'INTERNAL', 'Failed to read back resolved duel.');
  }

  // v3 Phase 1z.155 — auto-settle the full duel economy into
  // user_souls_ledger: winner +reward_souls (duel_win), loser
  // -stake_souls (duel_loss). UNIQUE(user_id, ref_type, ref_id,
  // reason) prevents double-pay/double-deduct if resolve fires
  // twice (network retry, etc). Draws skip both inserts but still
  // set reward_settled_at.
  try { await settleDuelEconomy(env, refreshed); } catch (_) { /* don't block resolve on settle failure */ }

  // Re-read so the response carries reward_settled_at.
  const finalRow = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  const aliasMap = await getAliasMap(env, [
    refreshed.challenger_user_id,
    refreshed.opponent_user_id,
  ]);
  // v3 Phase 1z.156 — Phase β. Settlement above already wrote the
  // ledger row(s) (or skipped on draw). Read the caller's balance
  // back as SUM(delta) so the response is backend-authoritative.
  // Phase γ frontend will replace local hb_souls with this value.
  const finalForPayload = finalRow || refreshed;
  const yourDelta = getDuelSoulsDeltaForUser(finalForPayload, session.userId);
  const yourBalance = await getUserSoulsBalance(env, session.userId);
  return jsonOk({
    ok: true,
    duel: serializeDuel(finalForPayload, aliasMap, session.userId, progress),
    souls: {
      your_delta:   yourDelta,
      your_balance: yourBalance,
      settled_at:   finalForPayload.reward_settled_at ?? null,
    },
    resolved: true,
  });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/verified-events
//
// Verified Duel Scoring Engine v1 (v3 Phase 1z). Batch ingestion of
// Apple Health / system-verified events. Up to 25 events per call.
// Body: { events: [{ client_event_id, event_type, metric, value?,
//                    source, occurred_at, duel_id?, metric_date?,
//                    window_start?, window_end?, client_created_at?,
//                    metadata_json? }, ...] }
//
// UNIQUE(user_id, client_event_id) deduplicates retries. Inserts use
// INSERT OR IGNORE so re-submits are no-ops. Counts inserted vs
// duplicates and returns both.
//
// v1 trusts client-submitted values. Not full anti-cheat — future
// hardening = signed device attestations.
// ─────────────────────────────────────────────────────────────
export async function handleVerifiedEventsSubmit(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  let body: { events?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  if (!Array.isArray(body?.events)) {
    return jsonError(400, 'INVALID_BODY', 'events must be an array.');
  }
  const events = body.events as Array<Record<string, unknown>>;
  if (events.length === 0) {
    return jsonOk({ ok: true, inserted: 0, duplicates: 0 });
  }
  if (events.length > MAX_EVENTS_PER_BATCH) {
    return jsonError(
      400,
      'BATCH_TOO_LARGE',
      `Submit at most ${MAX_EVENTS_PER_BATCH} events per call.`,
    );
  }

  let inserted = 0;
  let duplicates = 0;
  const errors: Array<{ index: number; reason: string }> = [];
  // W371 — cache co-op instance validations within the batch so a batch of
  // N step events for the same instance costs one lookup, not N.
  const bossCache = new Map<string, { ok: boolean; reason?: string }>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i] || {};
    const clientEventId = typeof e.client_event_id === 'string' ? e.client_event_id : '';
    const eventType     = typeof e.event_type      === 'string' ? e.event_type      : '';
    const metric        = typeof e.metric          === 'string' ? e.metric          : '';
    const source        = typeof e.source          === 'string' ? e.source          : '';
    const occurredAt    = typeof e.occurred_at     === 'string' ? e.occurred_at     : '';
    const duelId        = typeof e.duel_id         === 'string' ? e.duel_id         : null;
    // Co-op Dungeon Bosses v1 (W370) — a co-op step submission is just a
    // 'steps_total' event tagged with boss_instance_id instead of duel_id.
    // Same endpoint, dedupe, and rate limiter; the resolver in coop-boss.ts
    // aggregates MAX(value) per user over these rows.
    const bossInstanceId = typeof e.boss_instance_id === 'string' ? e.boss_instance_id : null;
    const metricDate    = typeof e.metric_date     === 'string' ? e.metric_date     : null;
    const windowStart   = typeof e.window_start    === 'string' ? e.window_start    : null;
    const windowEnd     = typeof e.window_end      === 'string' ? e.window_end      : null;
    const clientCreated = typeof e.client_created_at === 'string' ? e.client_created_at : null;
    const metadata      = typeof e.metadata_json   === 'string' ? e.metadata_json   : null;
    const rawValue      = e.value;
    let value = 1;
    if (rawValue !== undefined && rawValue !== null) {
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue < 0) {
        errors.push({ index: i, reason: 'INVALID_VALUE' });
        continue;
      }
      value = Math.round(rawValue);
    }

    if (!clientEventId) { errors.push({ index: i, reason: 'MISSING_CLIENT_EVENT_ID' }); continue; }
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      errors.push({ index: i, reason: 'INVALID_EVENT_TYPE' }); continue;
    }
    // W686 — flat physical-impossibility caps (mirrors leaderboard-submit's
    // METRIC_CAPS). sleep_minutes_total: 10,080 = 7 full days of minutes —
    // no legitimate hunt window can exceed it.
    if (EVENT_VALUE_CAPS[eventType] !== undefined && value > EVENT_VALUE_CAPS[eventType]) {
      errors.push({ index: i, reason: 'INVALID_VALUE' }); continue;
    }
    if (!metric) { errors.push({ index: i, reason: 'MISSING_METRIC' }); continue; }
    if (!ALLOWED_EVENT_SOURCES.has(source)) {
      errors.push({ index: i, reason: 'INVALID_SOURCE' }); continue;
    }
    if (!occurredAt) { errors.push({ index: i, reason: 'MISSING_OCCURRED_AT' }); continue; }

    // W371 — co-op step events must come from a participant of an ACTIVE
    // instance, inside its window. Legacy duel/outbox events (no
    // boss_instance_id) skip this entirely and insert as before.
    if (bossInstanceId) {
      // W397 — cache key includes eventType so a wrong-metric submission to the
      // same instance is validated (and rejected) on its own, not masked by a
      // cached steps result.
      const bossCacheKey = bossInstanceId + ':' + eventType;
      let v = bossCache.get(bossCacheKey);
      if (v === undefined) {
        v = await validateBossInstanceForUser(env, session.userId, bossInstanceId, eventType);
        bossCache.set(bossCacheKey, v);
      }
      if (!v.ok) { errors.push({ index: i, reason: v.reason || 'BOSS_INSTANCE_INVALID' }); continue; }
    }

    try {
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO verified_events (
           id, user_id, duel_id, boss_instance_id, event_type, metric, value, source,
           occurred_at, metric_date, window_start, window_end,
           client_event_id, client_created_at, server_created_at,
           metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          session.userId,
          duelId,
          bossInstanceId,
          eventType,
          metric,
          value,
          source,
          occurredAt,
          metricDate,
          windowStart,
          windowEnd,
          clientEventId,
          clientCreated,
          metadata,
        )
        .run();
      // D1's meta.changes is 1 when the row was actually inserted, 0
      // on a UNIQUE collision (the INSERT OR IGNORE path).
      const changes = Number(result?.meta?.changes ?? 0);
      if (changes > 0) inserted += 1;
      else duplicates += 1;
    } catch (err) {
      // W739 SECURITY — don't echo raw D1 error text (table/column names) to the client.
      console.error('verified-events insert failed:', err);
      errors.push({ index: i, reason: 'INSERT_FAILED' });
    }
  }

  return jsonOk({ ok: true, inserted, duplicates, errors });
}

