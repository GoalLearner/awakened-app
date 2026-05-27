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
import { areAcceptedFriends, findUserByAlias, validateAliasInput } from './friends';

const DEFAULT_STAKE = 25;
const DEFAULT_REWARD = 40;
const DEFAULT_BURN = 10;
const DEFAULT_DURATION_DAYS = 3;
const MAX_DURATION_DAYS = 14;
const MIN_DURATION_DAYS = 1;

// v3 Phase 1z.147 — sub-day duel duration support. The existing
// `duration_days INTEGER NOT NULL DEFAULT 3` column stays for
// backward compatibility (legacy clients keep submitting it). New
// clients send `duration_seconds` instead — accept handler prefers
// the seconds value when set, otherwise falls back to days*86400.
//
// 1 minute floor protects against accidental zero-second duels
// (would resolve immediately on accept). 14-day ceiling matches
// the existing days max so the overall range can't widen via the
// seconds path.
const DEFAULT_DURATION_SECONDS = 86400;       // 24 hours — production target
const MIN_DURATION_SECONDS     = 60;          // 1 minute — sanity floor
const MAX_DURATION_SECONDS     = 14 * 86400;  // 14 days — matches existing max
const MAX_STAKE = 500;

// Verified-Only Duel Types (v3 Phase 1x.6). Metadata only in this pass —
// scoring engine ships in a later pass and will branch on this value to
// pick the verified data source. Add new types here AND in the
// DUEL_TYPES constant in app.js together.
const ALLOWED_DUEL_TYPES = new Set([
  'steps',
  'sleep',
  'bedtime',
  'strength',
  'verified_objectives',
  'boss_race',
]);
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

// Legacy alias — preserved so existing call sites and any unforeseen
// import paths keep working without churn. Points at the same
// implementation. Future cleanup can remove this once direct callers
// are migrated.
const settleDuelReward = settleDuelEconomy;

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

// v3 Phase 1z.149 — A2 freshness signal. Returns the per-user
// server_updated_at ISO string from duel_progress_snapshots so the
// frontend can render "· just now" / "· N min ago" / "· syncing…"
// next to each score on the active hero card. Steps metric only
// (matches getDuelProgress scope). Missing user → no entry in the
// map → frontend renders "· not synced yet".
async function getDuelProgressTimestamps(
  env: Env,
  duelId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rows = await env.DB.prepare(
    `SELECT user_id, server_updated_at FROM duel_progress_snapshots
       WHERE duel_id = ? AND metric = 'steps'`,
  )
    .bind(duelId)
    .all<{ user_id: string; server_updated_at: string }>();
  for (const r of rows.results ?? []) {
    if (r && typeof r.server_updated_at === 'string') {
      out.set(r.user_id, r.server_updated_at);
    }
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

// ─────────────────────────────────────────────────────────────
// GET /v1/duels
// ─────────────────────────────────────────────────────────────
export async function handleDuelsList(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_DUELS_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const rows = await env.DB.prepare(
    `SELECT * FROM duels
      WHERE challenger_user_id = ? OR opponent_user_id = ?
      ORDER BY updated_at DESC`,
  )
    .bind(session.userId, session.userId)
    .all<DuelRow>();

  const allRows = rows.results ?? [];
  const userIds = new Set<string>();
  for (const r of allRows) {
    userIds.add(r.challenger_user_id);
    userIds.add(r.opponent_user_id);
  }
  const aliasMap = await getAliasMap(env, Array.from(userIds));

  // Verified Duel Scoring Engine v1 (v3 Phase 1z). For each duel that
  // needs a live score readout (active or completed), pull the
  // effective per-user score map (verified_events first, legacy
  // snapshots fallback). Per-duel queries — v1 acceptable load, can
  // batch later via a single JOIN if it ever matters.
  const progressByDuelId = new Map<string, Map<string, number>>();
  // v3 Phase 1z.149 — per-user snapshot timestamps for the A2
  // freshness chip on the active hero card. Only fetched for
  // active/completed duels (where a chip might render). Pending /
  // declined / cancelled duels have no scores to label.
  const progressUpdatedByDuelId = new Map<string, Map<string, string>>();
  for (const r of allRows) {
    if (r.status !== 'active' && r.status !== 'completed') continue;
    try {
      const m = await getDuelEffectiveScores(env, r);
      progressByDuelId.set(r.id, m);
    } catch (_) {
      // Defensive — one bad row shouldn't kill the list.
    }
    try {
      const tm = await getDuelProgressTimestamps(env, r.id);
      progressUpdatedByDuelId.set(r.id, tm);
    } catch (_) {
      // Defensive — freshness chip is decorative; never break the
      // list if the timestamp lookup fails.
    }
  }

  const incoming: Record<string, unknown>[] = [];
  const outgoing: Record<string, unknown>[] = [];
  const active: Record<string, unknown>[] = [];
  const recent: Record<string, unknown>[] = [];

  for (const row of allRows) {
    const serialized = serializeDuel(
      row,
      aliasMap,
      session.userId,
      progressByDuelId.get(row.id),
      progressUpdatedByDuelId.get(row.id),
    );
    if (row.status === 'pending') {
      if (row.opponent_user_id === session.userId) incoming.push(serialized);
      else outgoing.push(serialized);
    } else if (row.status === 'active') {
      active.push(serialized);
    } else {
      // completed / declined / expired / cancelled
      if (recent.length < 20) recent.push(serialized);
    }
  }

  return jsonOk({ ok: true, incoming, outgoing, active, recent });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels   body: { opponent_alias, duration_days?, stake_souls? }
// ─────────────────────────────────────────────────────────────
export async function handleDuelsCreate(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  let body: {
    opponent_alias?: unknown;
    duration_days?: unknown;
    duration_seconds?: unknown;
    stake_souls?: unknown;
    duel_type?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const aliasCheck = validateAliasInput(body?.opponent_alias);
  if (!aliasCheck.ok) {
    return jsonError(400, 'ALIAS_INVALID', aliasCheck.reason);
  }

  // v3 Phase 1z.147 — dual duration parsing. Both fields are
  // optional but mutually exclusive (rejecting both removes any
  // ambiguity about which one the accept handler should use).
  // - If neither: default to DEFAULT_DURATION_SECONDS (24h).
  //   duration_days is derived for legacy NOT NULL constraint.
  // - If only duration_days: legacy path. duration_seconds = NULL.
  // - If only duration_seconds: new path. duration_days derived
  //   via Math.max(1, Math.ceil(seconds/86400)) so the NOT NULL
  //   constraint is satisfied with a sensible-looking value.
  // - If both: 400 CONFLICTING_DURATION.
  const hasDays    = body?.duration_days !== undefined && body?.duration_days !== null;
  const hasSeconds = body?.duration_seconds !== undefined && body?.duration_seconds !== null;
  if (hasDays && hasSeconds) {
    return jsonError(
      400,
      'CONFLICTING_DURATION',
      'Provide either duration_days or duration_seconds, not both.',
    );
  }

  let durationDays = DEFAULT_DURATION_DAYS;
  let durationSeconds: number | null = null;
  if (hasSeconds) {
    if (!Number.isInteger(body.duration_seconds)) {
      return jsonError(400, 'INVALID_DURATION', 'duration_seconds must be an integer.');
    }
    const s = body.duration_seconds as number;
    if (s < MIN_DURATION_SECONDS || s > MAX_DURATION_SECONDS) {
      return jsonError(
        400,
        'INVALID_DURATION',
        `duration_seconds must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS}.`,
      );
    }
    durationSeconds = s;
    durationDays = Math.max(1, Math.ceil(s / 86400));
  } else if (hasDays) {
    if (!Number.isInteger(body.duration_days)) {
      return jsonError(400, 'INVALID_DURATION', 'duration_days must be an integer.');
    }
    const d = body.duration_days as number;
    if (d < MIN_DURATION_DAYS || d > MAX_DURATION_DAYS) {
      return jsonError(
        400,
        'INVALID_DURATION',
        `duration_days must be between ${MIN_DURATION_DAYS} and ${MAX_DURATION_DAYS}.`,
      );
    }
    durationDays = d;
    durationSeconds = null;
  } else {
    // Neither — fall to new default (24h). Days derived for legacy
    // NOT NULL constraint.
    durationSeconds = DEFAULT_DURATION_SECONDS;
    durationDays = Math.max(1, Math.ceil(DEFAULT_DURATION_SECONDS / 86400));
  }

  // Optional stake_souls override. Default 25.
  let stakeSouls = DEFAULT_STAKE;
  if (body?.stake_souls !== undefined && body?.stake_souls !== null) {
    if (!Number.isInteger(body.stake_souls)) {
      return jsonError(400, 'INVALID_STAKE', 'stake_souls must be an integer.');
    }
    const s = body.stake_souls as number;
    if (s < 0 || s > MAX_STAKE) {
      return jsonError(400, 'INVALID_STAKE', `stake_souls must be 0–${MAX_STAKE}.`);
    }
    stakeSouls = s;
  }

  // Optional duel_type. Default 'verified_objectives'.
  let duelType = DEFAULT_DUEL_TYPE;
  if (body?.duel_type !== undefined && body?.duel_type !== null) {
    if (typeof body.duel_type !== 'string' || !ALLOWED_DUEL_TYPES.has(body.duel_type)) {
      return jsonError(
        400,
        'INVALID_DUEL_TYPE',
        `duel_type must be one of: ${Array.from(ALLOWED_DUEL_TYPES).join(', ')}.`,
      );
    }
    duelType = body.duel_type;
  }

  const opponent = await findUserByAlias(env, aliasCheck.trimmed);
  if (!opponent) {
    return jsonError(404, 'USER_NOT_FOUND', `No hunter found with alias "${aliasCheck.trimmed}".`);
  }
  if (opponent.id === session.userId) {
    return jsonError(400, 'SELF_DUEL', 'You cannot duel yourself.');
  }

  // Must be accepted friends.
  const friends = await areAcceptedFriends(env, session.userId, opponent.id);
  if (!friends) {
    return jsonError(
      403,
      'NOT_FRIENDS',
      'You can only duel an accepted friend. Send a friend request first.',
    );
  }

  // Reject if any pending/active duel between this pair already exists.
  const existing = await env.DB.prepare(
    `SELECT id, status FROM duels
      WHERE status IN ('pending', 'active')
        AND ((challenger_user_id = ? AND opponent_user_id = ?)
          OR (challenger_user_id = ? AND opponent_user_id = ?))
      LIMIT 1`,
  )
    .bind(session.userId, opponent.id, opponent.id, session.userId)
    .first<{ id: string; status: string }>();
  if (existing) {
    return jsonError(
      409,
      'DUEL_EXISTS',
      `A ${existing.status} duel between you already exists.`,
      { duel_id: existing.id },
    );
  }

  const id = crypto.randomUUID();
  // v3 Phase 1z.147 — also persists duration_seconds (nullable).
  // Legacy clients sending duration_days alone get NULL here, which
  // the accept handler treats as "fall back to days*86400".
  await env.DB.prepare(
    `INSERT INTO duels (
       id, challenger_user_id, opponent_user_id, status,
       stake_souls, reward_souls, burn_souls, duration_days,
       duration_seconds, duel_type
     ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      session.userId,
      opponent.id,
      stakeSouls,
      DEFAULT_REWARD,
      DEFAULT_BURN,
      durationDays,
      durationSeconds,
      duelType,
    )
    .run();

  const created = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(id)
    .first<DuelRow>();
  if (!created) {
    return jsonError(500, 'INTERNAL', 'Failed to read back created duel.');
  }
  const aliasMap = await getAliasMap(env, [
    created.challenger_user_id,
    created.opponent_user_id,
  ]);
  return jsonOk({ ok: true, duel: serializeDuel(created, aliasMap, session.userId) });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels/:id/accept
// ─────────────────────────────────────────────────────────────
export async function handleDuelsAccept(
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
  if (row.opponent_user_id !== session.userId) {
    return jsonError(403, 'FORBIDDEN', 'Only the opponent can accept this duel.');
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot accept from status "${row.status}".`);
  }

  const now = new Date();
  const startsAt = now.toISOString();
  // v3 Phase 1z.147 — prefer duration_seconds when set; otherwise
  // fall back to the legacy days field. Multiplication by 1000
  // gives milliseconds for Date arithmetic.
  const durationMs = ((row.duration_seconds ?? row.duration_days * 86400) as number) * 1000;
  const ends = new Date(now.getTime() + durationMs);
  const endsAt = ends.toISOString();

  await env.DB.prepare(
    `UPDATE duels
        SET status = 'active', starts_at = ?, ends_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(startsAt, endsAt, duelId)
    .run();

  const refreshed = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!refreshed) {
    return jsonError(500, 'INTERNAL', 'Failed to read back accepted duel.');
  }
  const aliasMap = await getAliasMap(env, [
    refreshed.challenger_user_id,
    refreshed.opponent_user_id,
  ]);
  return jsonOk({ ok: true, duel: serializeDuel(refreshed, aliasMap, session.userId) });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels/:id/decline
// ─────────────────────────────────────────────────────────────
export async function handleDuelsDecline(
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
  if (row.opponent_user_id !== session.userId) {
    return jsonError(403, 'FORBIDDEN', 'Only the opponent can decline this duel.');
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot decline from status "${row.status}".`);
  }
  await env.DB.prepare(
    "UPDATE duels SET status = 'declined', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(duelId)
    .run();
  return jsonOk({ ok: true, declined: true });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels/:id/cancel — challenger-only, pending-only
// (v3 Phase 1z.1). Idempotent: returns ok+alreadyCancelled when
// the duel is already cancelled. No souls movement, no ledger
// writes — pending duels never debited stake.
// ─────────────────────────────────────────────────────────────
export async function handleDuelsCancel(
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
  if (row.challenger_user_id !== session.userId) {
    return jsonError(403, 'FORBIDDEN', 'Only the challenger can cancel this duel.');
  }
  if (row.status === 'cancelled') {
    const aliasMap = await getAliasMap(env, [row.challenger_user_id, row.opponent_user_id]);
    return jsonOk({
      ok: true,
      alreadyCancelled: true,
      duel: serializeDuel(row, aliasMap, session.userId),
    });
  }
  if (row.status !== 'pending') {
    return jsonError(
      400,
      'DUEL_NOT_CANCELLABLE',
      `Cannot cancel a ${row.status} duel. Only pending invites can be cancelled.`,
    );
  }
  await env.DB.prepare(
    "UPDATE duels SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(duelId)
    .run();
  const updated = await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(duelId)
    .first<DuelRow>();
  if (!updated) {
    return jsonError(500, 'INTERNAL', 'Failed to read back cancelled duel.');
  }
  const aliasMap = await getAliasMap(env, [updated.challenger_user_id, updated.opponent_user_id]);
  return jsonOk({ ok: true, duel: serializeDuel(updated, aliasMap, session.userId) });
}

// ─────────────────────────────────────────────────────────────
// GET /v1/duels/:id
// ─────────────────────────────────────────────────────────────
export async function handleDuelsDetail(
  _request: Request,
  env: Env,
  session: SessionPayload,
  duelId: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_READ.limit({ key: session.userId });
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
  const aliasMap = await getAliasMap(env, [
    row.challenger_user_id,
    row.opponent_user_id,
  ]);
  const progress = await getDuelEffectiveScores(env, row);
  // v3 Phase 1z.149 — enrich detail GET with snapshot timestamps so
  // a direct-open of the duel detail sheet also shows the A2
  // freshness chip. List endpoint already enriches; this keeps the
  // two surfaces consistent.
  let progressUpdated: Map<string, string> | undefined;
  try { progressUpdated = await getDuelProgressTimestamps(env, row.id); }
  catch (_) { progressUpdated = undefined; }
  return jsonOk({
    ok: true,
    duel: serializeDuel(row, aliasMap, session.userId, progress, progressUpdated),
  });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels/:id/progress   body: { duel_type, metric, value,
//   window_start, window_end, client_updated_at }
//
// Steps Duel Scoring v1 (v3 Phase 1y). Client (Apple Health) submits
// the current step total for the duel window. Server upserts via the
// UNIQUE(duel_id, user_id, metric) index — re-submits overwrite the
// same row. v1 trusts the client value; future hardening (signed
// device snapshots) is out of scope.
//
// Rejects:
//   - non-participant                    → 403 FORBIDDEN
//   - duel.duel_type !== 'steps'         → 400 DUEL_TYPE_NOT_SCORED_YET
//   - duel.status !== 'active'           → 400 DUEL_NOT_ACTIVE
//   - metric !== 'steps'                 → 400 INVALID_METRIC
//   - non-integer / negative value       → 400 INVALID_VALUE
// ─────────────────────────────────────────────────────────────
export async function handleDuelsSubmitProgress(
  request: Request,
  env: Env,
  session: SessionPayload,
  duelId: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  let body: {
    duel_type?: unknown;
    metric?: unknown;
    value?: unknown;
    window_start?: unknown;
    window_end?: unknown;
    client_updated_at?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
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
  if (row.duel_type !== 'steps') {
    return jsonError(
      400,
      'DUEL_TYPE_NOT_SCORED_YET',
      'Only steps duels are scored in this version.',
    );
  }
  if (row.status !== 'active') {
    return jsonError(400, 'DUEL_NOT_ACTIVE', `Cannot submit progress to a ${row.status} duel.`);
  }

  const metric = typeof body?.metric === 'string' ? body.metric : '';
  if (metric !== 'steps') {
    return jsonError(400, 'INVALID_METRIC', 'metric must be "steps" for v1.');
  }
  const rawValue = body?.value;
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue < 0) {
    return jsonError(400, 'INVALID_VALUE', 'value must be a non-negative number.');
  }
  const value = Math.round(rawValue);

  const windowStart = typeof body?.window_start === 'string' ? body.window_start : null;
  const windowEnd = typeof body?.window_end === 'string' ? body.window_end : null;
  if (!windowStart || !windowEnd) {
    return jsonError(400, 'INVALID_WINDOW', 'window_start and window_end are required.');
  }
  const clientUpdatedAt = typeof body?.client_updated_at === 'string'
    ? body.client_updated_at
    : new Date().toISOString();

  // Deterministic id so re-submits update the same row via PRIMARY KEY
  // collision (and the UNIQUE constraint is belt-and-suspenders).
  const snapshotId = `${duelId}_${session.userId}_${metric}`;

  // source is server-set — ignore anything in the body.
  await env.DB.prepare(
    `INSERT INTO duel_progress_snapshots (
       id, duel_id, user_id, duel_type, metric, value, source,
       window_start, window_end, client_updated_at, server_updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'apple_health', ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(duel_id, user_id, metric) DO UPDATE SET
       value = excluded.value,
       window_start = excluded.window_start,
       window_end = excluded.window_end,
       client_updated_at = excluded.client_updated_at,
       server_updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      snapshotId,
      duelId,
      session.userId,
      row.duel_type,
      metric,
      value,
      windowStart,
      windowEnd,
      clientUpdatedAt,
    )
    .run();

  const progress = await getDuelProgress(env, duelId);
  const isChallenger = row.challenger_user_id === session.userId;
  const myUserId = session.userId;
  const rivalUserId = isChallenger ? row.opponent_user_id : row.challenger_user_id;
  const youValue = progress.has(myUserId) ? (progress.get(myUserId) ?? 0) : 0;
  const rivalValue = progress.has(rivalUserId) ? (progress.get(rivalUserId) ?? null) : null;
  return jsonOk({ ok: true, you: youValue, rival: rivalValue });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/duels/:id/resolve
//
// Steps Duel Scoring v1 (v3 Phase 1y). Server-authoritative
// resolution. Reads both participants' latest steps snapshots
// (missing = 0), compares, writes the winner / result, marks the
// duel completed. Idempotent — re-calling after completion returns
// the existing result row.
//
// Rejects:
//   - non-participant   → 403 FORBIDDEN
//   - now < ends_at     → 400 DUEL_NOT_ENDED
//   - non-steps duel    → 400 DUEL_TYPE_NOT_SCORED_YET
// ─────────────────────────────────────────────────────────────
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

  // Idempotent return path.
  if (row.status === 'completed') {
    const aliasMap = await getAliasMap(env, [row.challenger_user_id, row.opponent_user_id]);
    const progress = await getDuelEffectiveScores(env, row);
    return jsonOk({
      ok: true,
      duel: serializeDuel(row, aliasMap, session.userId, progress),
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
  return jsonOk({
    ok: true,
    duel: serializeDuel(finalRow || refreshed, aliasMap, session.userId, progress),
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

  for (let i = 0; i < events.length; i++) {
    const e = events[i] || {};
    const clientEventId = typeof e.client_event_id === 'string' ? e.client_event_id : '';
    const eventType     = typeof e.event_type      === 'string' ? e.event_type      : '';
    const metric        = typeof e.metric          === 'string' ? e.metric          : '';
    const source        = typeof e.source          === 'string' ? e.source          : '';
    const occurredAt    = typeof e.occurred_at     === 'string' ? e.occurred_at     : '';
    const duelId        = typeof e.duel_id         === 'string' ? e.duel_id         : null;
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
    if (!metric) { errors.push({ index: i, reason: 'MISSING_METRIC' }); continue; }
    if (!ALLOWED_EVENT_SOURCES.has(source)) {
      errors.push({ index: i, reason: 'INVALID_SOURCE' }); continue;
    }
    if (!occurredAt) { errors.push({ index: i, reason: 'MISSING_OCCURRED_AT' }); continue; }

    try {
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO verified_events (
           id, user_id, duel_id, event_type, metric, value, source,
           occurred_at, metric_date, window_start, window_end,
           client_event_id, client_created_at, server_created_at,
           metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          session.userId,
          duelId,
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
      errors.push({ index: i, reason: err instanceof Error ? err.message : 'INSERT_FAILED' });
    }
  }

  return jsonOk({ ok: true, inserted, duplicates, errors });
}

// ─────────────────────────────────────────────────────────────
// GET /v1/duels/:id/score
//
// Verified Duel Scoring Engine v1 (v3 Phase 1z). Returns a labelled
// score readout for both participants — used by the client to format
// per-type score strings without duplicating the aggregator. Returns
// 'Awaiting boss-event logging' label for boss_race.
// ─────────────────────────────────────────────────────────────
function formatScoreLabel(duelType: string, value: number): string {
  if (duelType === 'boss_race') return 'Awaiting boss-event logging';
  if (duelType === 'steps') {
    const n = Math.max(0, Math.round(value || 0));
    try { return n.toLocaleString('en-US') + ' steps'; } catch (_) { return n + ' steps'; }
  }
  if (duelType === 'sleep') {
    const n = Math.max(0, Math.round(value || 0));
    return n + (n === 1 ? ' night' : ' nights');
  }
  if (duelType === 'bedtime') {
    const n = Math.max(0, Math.round(value || 0));
    return n + (n === 1 ? ' bedtime' : ' bedtimes');
  }
  if (duelType === 'strength') {
    const n = Math.max(0, Math.round(value || 0));
    return n + (n === 1 ? ' workout' : ' workouts');
  }
  if (duelType === 'verified_objectives') {
    const n = Math.max(0, Math.round(value || 0));
    return n + ' verified';
  }
  return String(value || 0);
}

export async function handleDuelScoreGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
  duelId: string,
): Promise<Response> {
  const rl = await env.RL_DUELS_READ.limit({ key: session.userId });
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
  const aliasMap = await getAliasMap(env, [row.challenger_user_id, row.opponent_user_id]);
  const progress = await getDuelEffectiveScores(env, row);
  const cScore = progress.get(row.challenger_user_id) ?? 0;
  const oScore = progress.get(row.opponent_user_id) ?? 0;
  return jsonOk({
    ok: true,
    duel: serializeDuel(row, aliasMap, session.userId, progress),
    score: {
      duel_type: row.duel_type,
      challenger: {
        user_id: row.challenger_user_id,
        alias:   aliasMap.get(row.challenger_user_id) ?? null,
        score:   cScore,
        label:   formatScoreLabel(row.duel_type, cScore),
      },
      opponent: {
        user_id: row.opponent_user_id,
        alias:   aliasMap.get(row.opponent_user_id) ?? null,
        score:   oScore,
        label:   formatScoreLabel(row.duel_type, oScore),
      },
    },
  });
}
