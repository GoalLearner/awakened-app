/**
 * Co-op Dungeon Bosses v1 (W370) — coop-boss handler.
 *
 *   POST   /v1/coop-boss              — challenger invites a friend (pending)
 *   GET    /v1/coop-boss              — list caller's instances (both roles)
 *   GET    /v1/coop-boss/:id          — single instance detail (participants)
 *   POST   /v1/coop-boss/:id/join     — partner accepts → active, 24h clock starts
 *   POST   /v1/coop-boss/:id/decline  — partner declines a pending invite
 *   POST   /v1/coop-boss/:id/cancel   — challenger withdraws a pending invite
 *   POST   /v1/coop-boss/:id/resolve  — evaluate combined steps → success/defeat
 *
 * Auth required on every endpoint; user_id is derived from the verified
 * session JWT only. The boss roster (goal/reward/window) is defined
 * SERVER-SIDE in COOP_BOSS_CFG so clients cannot dictate the difficulty
 * or payout.
 *
 * The shared step total is computed live from verified_events as
 *   SUM over participants of MAX(value) per user
 * for event_type='steps_total' tagged with this instance id. MAX because
 * each client resubmits its growing in-window step count repeatedly, so
 * MAX = that user's window total (same 'max' aggregate the retired steps
 * duels used).
 *
 * Economy: souls + the relic drop are granted CLIENT-SIDE on the kill
 * (hb_souls + card/pity inventory are client-authoritative in this game),
 * exactly like a solo boss. The backend only owns the authoritative
 * win/loss DECISION — it writes no souls ledger row for co-op in v1.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { notifyUser } from '../lib/apns';
import { readEntitlements } from './iap-entitlements';

// ── W648 — concurrent-hunt cap (the co-op membership paywall) ───────
// Free hunters may run at most this many simultaneous hunts; Premium members
// (readEntitlements().member) are unlimited. Enforced server-side in BOTH
// create and join — the client mirror
// is UX only. The entrance fee itself is client-side souls (same trust model
// as solo engage costs; see the header note above).
const FREE_CONCURRENT_HUNT_CAP = 3;

/** Hunts that count against a user's cap: ones they INITIATED (pending or
 *  active) plus ones they ACCEPTED (active). A received-but-unanswered invite
 *  deliberately does NOT count — otherwise any friend could fill a free
 *  player's cap just by spamming summons at them.
 *  W649 — an 'active' hunt whose 24h window already LAPSED doesn't count
 *  either: rows only flip to expired when a participant's client resolves
 *  them, so without the ends_at guard three abandoned hunts would wall a free
 *  player behind CAP_REACHED (and a Founder upsell) indefinitely. ends_at is
 *  an ISO-8601 string, which SQLite's strftime parses natively.
 *  Known, accepted: the cap is check-then-insert without a transaction — two
 *  perfectly-raced creates can briefly land 4 hunts. Impact is one extra
 *  hunt, self-corrects as hunts finish; not worth a compensating delete. */
async function countRunningHunts(env: Env, userId: string): Promise<number> {
  // W677 — an accepted TRIO seat (partner2) counts exactly like a partner seat.
  // A trio seat also counts the moment it is ANSWERED (stamped joined_at) even while
  // the instance is still 'pending' on the other ally — otherwise a free user could
  // answer unlimited trio summons cap-free and have them all flip active later
  // (review W677 #1: deterministic paywall bypass). Duo-inert: the duo join path
  // never stamps joined_at (join == activate). A hunter stuck waiting on a third
  // ally can free the slot via /decline (either invited seat may decline pending).
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM coop_boss_instances
      WHERE status IN ('pending','active')
        AND (challenger_user_id = ?1
          OR ((partner_user_id = ?1 OR partner2_user_id = ?1) AND status = 'active')
          OR (partner_user_id = ?1 AND status = 'pending' AND partner_joined_at IS NOT NULL)
          OR (partner2_user_id = ?1 AND status = 'pending' AND partner2_joined_at IS NOT NULL))
        AND (status = 'pending' OR ends_at IS NULL OR strftime('%s', ends_at) > strftime('%s', 'now'))`,
  )
    .bind(userId)
    .first<{ n: number }>();
  return row ? Number(row.n) : 0;
}

/** 409 CAP_REACHED gate shared by create + join. Returns null when allowed. */
async function checkHuntCap(env: Env, userId: string): Promise<Response | null> {
  // W650 — `member` = Founder (lifetime) OR active premium subscription; both
  // tiers of the same membership get unlimited concurrent hunts.
  const { member } = await readEntitlements(env, userId);
  if (member) return null;
  const running = await countRunningHunts(env, userId);
  if (running < FREE_CONCURRENT_HUNT_CAP) return null;
  return jsonError(
    409,
    'CAP_REACHED',
    `You already have ${FREE_CONCURRENT_HUNT_CAP} hunts running. Finish one first — or go Premium for unlimited hunts.`,
    { cap: FREE_CONCURRENT_HUNT_CAP },
  );
}

// ── Server-authoritative co-op boss roster ──────────────────────────
// goalSteps is the COMBINED target across both hunters (for flights bosses it
// is a flight count, not a step count — the column is metric-generic);
// rewardSouls is the per-hunter payout the client grants on the kill;
// windowHours is the hunt length, stamped on join. metric selects which
// verified-event stream the hunt aggregates: 'steps' (steps_total) or
// 'flights' (flights_total, W397 — stairs-climbed co-op).
// W447 — metric 'both' is a DUAL hunt: BOTH a steps goal (goalSteps) AND a flights goal
// (goalFlights) must be met (combined across the two hunters) to fell the boss.
// W648 — rewardSouls normalized to EXACTLY half the solo kill table for the
// boss's rank (owner's split model: two hunters split a solo dungeon's payout).
// Solo kill rewards: E50 D100 C200 B400 A800 S1600 → per-hunter co-op: E25 C100 B200.
// Was inconsistent (E paid 100% of solo, the W447 duals 60-65%) which made co-op
// strictly better souls/effort than solo at E — one leg of the co-op-runs-hot
// problem (the other leg, dupe-sell income, was cut in W646).
const COOP_BOSS_CFG: Record<
  string,
  { rank: string; goalSteps: number; goalFlights?: number; rewardSouls: number; windowHours: number; metric: 'steps' | 'flights' | 'both'; partySize?: number }
> = {
  the_twin_maw:         { rank: 'E', goalSteps: 16000, rewardSouls: 25,  windowHours: 24, metric: 'steps' },
  // W682 — first D-rank co-op + first 48-HOUR window (endurance duo: a goal
  // deliberately beyond one day's walking, humane across two). Reward = half
  // the solo D kill (100 → 50/hunter, the W648 split model).
  the_unresting_march:  { rank: 'D', goalSteps: 34000, rewardSouls: 50,  windowHours: 48, metric: 'steps' },
  the_coursing_dread:   { rank: 'C', goalSteps: 18000, rewardSouls: 100, windowHours: 24, metric: 'steps' },
  the_hollow_monarch:   { rank: 'B', goalSteps: 20,    rewardSouls: 200, windowHours: 24, metric: 'flights' },
  // W447 — dual-condition (steps AND flights) co-op duo bosses.
  the_gaunt_wardens:    { rank: 'C', goalSteps: 10000, goalFlights: 6,  rewardSouls: 100, windowHours: 24, metric: 'both' },
  the_sundered_choir:   { rank: 'B', goalSteps: 12000, goalFlights: 10, rewardSouls: 200, windowHours: 24, metric: 'both' },
  // W677 — first TRIO hunt (partySize 3: summoner + 2 hand-picked friends).
  // Owner spec: C-rank, 27,000 COMBINED steps. rewardSouls = floor(solo C 200 / 3)
  // = 66 per hunter (thirds split — the trio analog of the W648 duo half-split).
  // NAME/ART ARE PLACEHOLDERS pending the owner's boss design; id is stable.
  the_threefold_court:  { rank: 'C', goalSteps: 27000, rewardSouls: 66, windowHours: 24, metric: 'steps', partySize: 3 },
};
function bossMetric(bossId: string): 'steps' | 'flights' | 'both' {
  return COOP_BOSS_CFG[bossId]?.metric ?? 'steps';
}

const STEPS_EVENT_TYPE = 'steps_total';
const FLIGHTS_EVENT_TYPE = 'flights_total';
// Each co-op instance is HOMOGENEOUS: only its boss's metric is ever tagged to
// it (enforced at submit by validateBossInstanceForUser), so a per-instance
// MAX(value) over the matching event_type is that hunter's true window total.
function eventTypeForMetric(metric: string): string {
  return metric === 'flights' ? FLIGHTS_EVENT_TYPE : STEPS_EVENT_TYPE;
}
function eventTypeForBoss(bossId: string): string {
  const cfg = COOP_BOSS_CFG[bossId];
  return eventTypeForMetric(cfg ? cfg.metric : 'steps');
}
// W447 — which verified-event types this boss accepts. A 'both' boss accepts BOTH
// steps_total and flights_total (the instance is no longer homogeneous); single-metric
// bosses accept only their one type.
function metricAllowedForBoss(bossId: string, eventType: string): boolean {
  if (bossMetric(bossId) === 'both') return eventType === STEPS_EVENT_TYPE || eventType === FLIGHTS_EVENT_TYPE;
  return eventType === eventTypeForBoss(bossId);
}
const MAX_LIST = 20;

interface CoopBossRow {
  id: string;
  boss_id: string;
  boss_rank: string;
  challenger_user_id: string;
  partner_user_id: string;
  // W677 — TRIO hunts: a second invited ally. NULL = duo (the v1 shape, unchanged).
  partner2_user_id: string | null;
  // W677 — trio-only join stamps: a trio activates (clock starts) only once BOTH
  // allies have joined; these track who answered while status is still 'pending'.
  // Duo hunts leave both NULL (join → instantly active, v1 behavior).
  partner_joined_at: string | null;
  partner2_joined_at: string | null;
  goal_steps: number;
  goal_flights: number | null;   // W447 — dual-metric ('both') bosses; null for single-metric
  reward_souls: number;
  status: string;
  result: string | null;
  starts_at: string | null;
  ends_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** W677 — every hunter on this instance (2 for a duo, 3 for a trio). The single
 *  seam the progress/serialize/notify/pact paths fan out over. */
function participantIds(
  row: Pick<CoopBossRow, 'challenger_user_id' | 'partner_user_id' | 'partner2_user_id'>,
): string[] {
  const ids = [row.challenger_user_id, row.partner_user_id];
  if (row.partner2_user_id) ids.push(row.partner2_user_id);
  return ids;
}

// ── Small shared helpers ────────────────────────────────────────────

/** True iff the two users have an accepted friendship (either direction). */
async function areAcceptedFriends(env: Env, a: string, b: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM friends
      WHERE status = 'accepted'
        AND ( (requester_user_id = ? AND recipient_user_id = ?)
           OR (requester_user_id = ? AND recipient_user_id = ?) )
      LIMIT 1`,
  )
    .bind(a, b, b, a)
    .first<{ ok: number }>();
  return !!row;
}

/** Alias lookup for a small id set. Missing ids simply don't appear. */
async function getAliasMap(env: Env, userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, alias FROM users WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<{ id: string; alias: string }>();
  for (const row of rows.results ?? []) map.set(row.id, row.alias);
  return map;
}

// W447 — per-instance progress is now DUAL: MAX(value) per user for steps_total AND
// flights_total. A single-metric boss simply has an empty map for the other stream;
// a 'both' boss uses both. The "primary" stream (what the metric-generic combined_steps/
// goal_steps fields carry) is flights for a flights boss, steps otherwise.
interface CoopProgress { steps: Map<string, number>; flights: Map<string, number>; }
function emptyProgress(): CoopProgress { return { steps: new Map(), flights: new Map() }; }

/** Per-user MAX(value) for ONE instance, split by metric stream. */
async function getCoopProgress(env: Env, instanceId: string): Promise<CoopProgress> {
  const rows = await env.DB.prepare(
    `SELECT user_id, event_type, COALESCE(MAX(value), 0) AS s
       FROM verified_events
      WHERE boss_instance_id = ? AND event_type IN (?, ?)
      GROUP BY user_id, event_type`,
  )
    .bind(instanceId, STEPS_EVENT_TYPE, FLIGHTS_EVENT_TYPE)
    .all<{ user_id: string; event_type: string; s: number }>();
  const p = emptyProgress();
  for (const r of rows.results ?? []) {
    (r.event_type === FLIGHTS_EVENT_TYPE ? p.flights : p.steps).set(r.user_id, Number(r.s) || 0);
  }
  return p;
}

/** Batched variant for the list endpoint: instanceId → CoopProgress. */
async function getCoopProgressForInstances(env: Env, ids: string[]): Promise<Map<string, CoopProgress>> {
  const out = new Map<string, CoopProgress>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT boss_instance_id AS bid, user_id, event_type, COALESCE(MAX(value), 0) AS s
       FROM verified_events
      WHERE boss_instance_id IN (${placeholders}) AND event_type IN (?, ?)
      GROUP BY boss_instance_id, user_id, event_type`,
  )
    .bind(...ids, STEPS_EVENT_TYPE, FLIGHTS_EVENT_TYPE)
    .all<{ bid: string; user_id: string; event_type: string; s: number }>();
  for (const r of rows.results ?? []) {
    if (!out.has(r.bid)) out.set(r.bid, emptyProgress());
    const p = out.get(r.bid)!;
    (r.event_type === FLIGHTS_EVENT_TYPE ? p.flights : p.steps).set(r.user_id, Number(r.s) || 0);
  }
  return out;
}

function combinedSteps(row: CoopBossRow, p: CoopProgress): number {
  return participantIds(row).reduce((sum, uid) => sum + (p.steps.get(uid) || 0), 0);
}
function combinedFlights(row: CoopBossRow, p: CoopProgress): number {
  return participantIds(row).reduce((sum, uid) => sum + (p.flights.get(uid) || 0), 0);
}
/** Authoritative win test across all boss metrics. A 'both' boss requires BOTH goals;
 *  a flights boss compares its (metric-generic) goal_steps against the flight total. */
function isGoalMet(row: CoopBossRow): (p: CoopProgress) => boolean {
  const metric = bossMetric(row.boss_id);
  return (p: CoopProgress) => {
    if (metric === 'both') return combinedSteps(row, p) >= row.goal_steps && combinedFlights(row, p) >= (row.goal_flights || 0);
    if (metric === 'flights') return combinedFlights(row, p) >= row.goal_steps;
    return combinedSteps(row, p) >= row.goal_steps;
  };
}

// ── W463.1 — durable per-participant drop credit ───────────────────
/** The caller's drop credit for ONE instance, or null if no award row exists
 *  (a pre-feature hunt, or one not yet won). owed = a row exists. */
async function getViewerAward(
  env: Env,
  instanceId: string,
  userId: string,
): Promise<{ owed: boolean; claimed: boolean } | null> {
  const r = await env.DB.prepare(
    'SELECT claimed FROM coop_boss_awards WHERE instance_id = ? AND user_id = ?',
  )
    .bind(instanceId, userId)
    .first<{ claimed: number }>();
  return r ? { owed: true, claimed: Number(r.claimed) === 1 } : null;
}

/** Batched award lookup for the list endpoint: instanceId → {owed, claimed}. */
async function getViewerAwardsForInstances(
  env: Env,
  ids: string[],
  userId: string,
): Promise<Map<string, { owed: boolean; claimed: boolean }>> {
  const out = new Map<string, { owed: boolean; claimed: boolean }>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT instance_id AS iid, claimed FROM coop_boss_awards
      WHERE user_id = ? AND instance_id IN (${placeholders})`,
  )
    .bind(userId, ...ids)
    .all<{ iid: string; claimed: number }>();
  for (const r of rows.results ?? []) out.set(r.iid, { owed: true, claimed: Number(r.claimed) === 1 });
  return out;
}

function serializeCoop(
  row: CoopBossRow,
  aliasMap: Map<string, string>,
  viewerUserId: string,
  p: CoopProgress,
  award?: { owed: boolean; claimed: boolean } | null,
): Record<string, unknown> {
  // W677 — partner2 = the trio's second invited ally. Client role checks are all
  // "am I the challenger, else an invited ally"; 'partner2' keeps that shape.
  const role: 'challenger' | 'partner' | 'partner2' | 'observer' =
    row.challenger_user_id === viewerUserId
      ? 'challenger'
      : row.partner_user_id === viewerUserId
        ? 'partner'
        : row.partner2_user_id === viewerUserId
          ? 'partner2'
          : 'observer';

  let timeRemainingMs: number | null = null;
  if (row.status === 'active' && row.ends_at) {
    const endsMs = Date.parse(row.ends_at);
    if (Number.isFinite(endsMs)) timeRemainingMs = Math.max(0, endsMs - Date.now());
  }

  const metric = bossMetric(row.boss_id);
  // The metric-generic "primary" stream: flights for a flights boss, steps otherwise.
  const primary = metric === 'flights' ? p.flights : p.steps;
  const cPrimary = (uid: string) => primary.get(uid) || 0;
  const isBoth = metric === 'both';

  return {
    id: row.id,
    boss_id: row.boss_id,
    boss_rank: row.boss_rank,
    metric,
    status: row.status,
    result: row.result ?? null,
    role,
    // W463.1 — the viewer's durable drop credit (present only when an award row
    // exists, i.e. a won hunt). owed+!claimed → the client claims then grants.
    ...(award ? { award } : {}),
    goal_steps: row.goal_steps,
    reward_souls: row.reward_souls,
    // W677 — party size rides along so the client renders the right roster without
    // sniffing for a partner2 key.
    party_size: participantIds(row).length,
    combined_steps: participantIds(row).reduce((s, uid) => s + cPrimary(uid), 0),
    // W447 — dual-metric bosses also surface the SECOND (flights) stream + goal so the
    // client can render two progress bars; omitted for single-metric bosses.
    ...(isBoth ? { goal_flights: row.goal_flights ?? 0, combined_flights: combinedFlights(row, p) } : {}),
    challenger: {
      user_id: row.challenger_user_id,
      alias: aliasMap.get(row.challenger_user_id) ?? null,
      steps: cPrimary(row.challenger_user_id),
      ...(isBoth ? { flights: p.flights.get(row.challenger_user_id) || 0 } : {}),
    },
    partner: {
      user_id: row.partner_user_id,
      alias: aliasMap.get(row.partner_user_id) ?? null,
      steps: cPrimary(row.partner_user_id),
      ...(isBoth ? { flights: p.flights.get(row.partner_user_id) || 0 } : {}),
      // W677 — trio-only: has this ally answered the summons yet? (pending UI)
      ...(row.partner2_user_id ? { joined: !!row.partner_joined_at } : {}),
    },
    // W677 — the trio's second ally (absent on duo instances).
    ...(row.partner2_user_id ? {
      partner2: {
        user_id: row.partner2_user_id,
        alias: aliasMap.get(row.partner2_user_id) ?? null,
        steps: cPrimary(row.partner2_user_id),
        ...(isBoth ? { flights: p.flights.get(row.partner2_user_id) || 0 } : {}),
        joined: !!row.partner2_joined_at,
      },
    } : {}),
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    time_remaining_ms: timeRemainingMs,
    resolved_at: row.resolved_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadInstance(env: Env, id: string): Promise<CoopBossRow | null> {
  const row = await env.DB.prepare('SELECT * FROM coop_boss_instances WHERE id = ?')
    .bind(id)
    .first<CoopBossRow>();
  return row ?? null;
}

function isParticipant(row: CoopBossRow, userId: string): boolean {
  return participantIds(row).includes(userId);
}

// W371 — validate a verified-event step submission that is tagged with a
// co-op boss_instance_id. The submit endpoint (handleVerifiedEventsSubmit,
// duels.ts) calls this before inserting any boss-tagged row. Rejects
// anything but a REAL PARTICIPANT submitting to an ACTIVE instance INSIDE
// its [starts_at, ends_at] window. This is what makes the server-side win
// decision trustworthy: without it any client could POST a fabricated
// value for any instance, or bank post-deadline steps to win after the
// 24h window. (v1 still trusts the step VALUE itself per duels.ts; this
// caps abuse to in-window participant submissions — the cheap, high-value
// guard.) A 60s grace on each bound tolerates device/server clock skew.
export async function validateBossInstanceForUser(
  env: Env,
  userId: string,
  instanceId: string,
  eventType?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const row = await env.DB.prepare(
    `SELECT boss_id, challenger_user_id, partner_user_id, partner2_user_id, status, starts_at, ends_at
       FROM coop_boss_instances WHERE id = ?`,
  )
    .bind(instanceId)
    .first<{
      boss_id: string;
      challenger_user_id: string;
      partner_user_id: string;
      partner2_user_id: string | null;
      status: string;
      starts_at: string | null;
      ends_at: string | null;
    }>();
  if (!row) return { ok: false, reason: 'BOSS_INSTANCE_NOT_FOUND' };
  // W677 — a trio's third hunter is a full participant; without this their verified
  // steps would be rejected at submit and never count toward the combined goal.
  if (!participantIds(row).includes(userId)) {
    return { ok: false, reason: 'NOT_PARTICIPANT' };
  }
  if (row.status !== 'active') return { ok: false, reason: 'BOSS_NOT_ACTIVE' };
  // W397 — the event must carry a metric THIS boss counts (a flights boss only counts
  // flights_total; a steps boss only steps_total). W447 — a 'both' boss accepts EITHER
  // steps_total or flights_total (the dual hunt aggregates each stream separately).
  if (eventType && !metricAllowedForBoss(row.boss_id, eventType)) {
    return { ok: false, reason: 'WRONG_METRIC' };
  }
  const now = Date.now();
  const startMs = row.starts_at ? Date.parse(row.starts_at) : NaN;
  const endMs = row.ends_at ? Date.parse(row.ends_at) : NaN;
  if (Number.isFinite(startMs) && now < startMs - 60000) return { ok: false, reason: 'BEFORE_WINDOW' };
  if (Number.isFinite(endMs) && now > endMs + 60000) return { ok: false, reason: 'AFTER_WINDOW' };
  return { ok: true };
}

// ── POST /v1/coop-boss — create (invite a friend) ───────────────────
export async function handleCoopBossCreate(
  request: Request,
  env: Env,
  session: SessionPayload,
  ctx?: ExecutionContext,
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  let body: { partner_user_id?: unknown; partner2_user_id?: unknown; boss_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const bossId = typeof body.boss_id === 'string' ? body.boss_id : '';
  const partnerUserId = typeof body.partner_user_id === 'string' ? body.partner_user_id : '';
  const partner2UserId = typeof body.partner2_user_id === 'string' ? body.partner2_user_id : '';
  const cfg = COOP_BOSS_CFG[bossId];
  if (!cfg) return jsonError(400, 'UNKNOWN_BOSS', 'Unknown co-op boss id.');
  // W677 — party size comes from the BOSS (a trio boss requires exactly 2 allies;
  // a duo boss exactly 1). The summoner hand-picks accepted friends for every seat.
  const partySize = cfg.partySize ?? 2;
  if (!partnerUserId) return jsonError(400, 'MISSING_PARTNER', 'partner_user_id is required.');
  if (partySize === 3 && !partner2UserId) {
    return jsonError(400, 'MISSING_PARTNER2', 'This hunt takes three hunters — pick a second ally.');
  }
  if (partySize === 2 && partner2UserId) {
    return jsonError(400, 'PARTY_SIZE', 'This boss is a duo hunt — only one ally can be invited.');
  }
  const allies = partySize === 3 ? [partnerUserId, partner2UserId] : [partnerUserId];
  if (allies.includes(session.userId)) {
    return jsonError(400, 'SELF_PARTNER', 'You cannot co-op with yourself.');
  }
  if (partySize === 3 && partnerUserId === partner2UserId) {
    return jsonError(400, 'DUPLICATE_ALLY', 'Pick two different allies.');
  }

  for (const ally of allies) {
    if (!(await areAcceptedFriends(env, session.userId, ally))) {
      return jsonError(403, 'NOT_FRIENDS', 'You can only co-op with an accepted friend.');
    }
  }

  // W463 — summoner rank gate. A hunter may only INITIATE a hunt for a boss at
  // or below their OWN rank (the invited partner can be any rank — they're just
  // helping). Rank lives in the client-reported public_profile_summary (the app
  // is client-authoritative for rank), so this blocks the honest/casual over-rank
  // summon that was reported (a C-rank hunter sending a B-rank hunt). A missing
  // profile row defaults to E; a deliberately spoofing client is out of scope,
  // same trust model as the rest of the rank surface.
  const RANK_ORDER: Record<string, number> = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5, 'S+': 6 };
  const prof = await env.DB.prepare(
    'SELECT rank_tier FROM public_profile_summary WHERE user_id = ?',
  )
    .bind(session.userId)
    .first<{ rank_tier: string }>();
  const myRank = RANK_ORDER[prof?.rank_tier ?? 'E'] ?? 0;
  const bossRank = RANK_ORDER[cfg.rank] ?? 0;
  if (myRank < bossRank) {
    return jsonError(403, 'INSUFFICIENT_RANK', `You must reach ${cfg.rank} rank to summon this hunt.`);
  }

  // W483 — ALLY rank gate (owner design change). Previously the invited partner could be
  // ANY rank ("they're just helping"); per owner, you may now only pair hunters who BOTH
  // meet the boss's prerequisite — a C-rank ally can no longer be invited to a B-rank hunt.
  // Same trust model + source as the summoner gate above (client-authoritative rank in
  // public_profile_summary; a missing row defaults to E, which matches the client's display).
  // W677 — applies to EVERY invited seat of a trio.
  for (const ally of allies) {
    const partnerProf = await env.DB.prepare(
      'SELECT rank_tier FROM public_profile_summary WHERE user_id = ?',
    )
      .bind(ally)
      .first<{ rank_tier: string }>();
    const partnerRank = RANK_ORDER[partnerProf?.rank_tier ?? 'E'] ?? 0;
    if (partnerRank < bossRank) {
      return jsonError(403, 'ALLY_RANK', `Your ally must reach ${cfg.rank} rank to join this hunt.`);
    }
  }

  // One live (pending/active) instance per pair+boss. W677 generalization: block when
  // a live instance of this boss already CONTAINS the summoner together with ANY of
  // the invited allies (in any seat) — the duo either-direction rule, seat-agnostic.
  const existing = await env.DB.prepare(
    `SELECT id FROM coop_boss_instances
      WHERE boss_id = ?1 AND status IN ('pending','active')
        AND (challenger_user_id = ?2 OR partner_user_id = ?2 OR partner2_user_id = ?2)
        AND ( (challenger_user_id = ?3 OR partner_user_id = ?3 OR partner2_user_id = ?3)
           OR (?4 IS NOT NULL AND (challenger_user_id = ?4 OR partner_user_id = ?4 OR partner2_user_id = ?4)) )
      LIMIT 1`,
  )
    .bind(bossId, session.userId, partnerUserId, partner2UserId || null)
    .first<{ id: string }>();
  if (existing) {
    return jsonError(409, 'ALREADY_ACTIVE', 'A co-op hunt for this boss already exists with that hunter.');
  }

  // W648 — free hunters: at most 3 running hunts; Founders unlimited. Checked
  // AFTER the cheap validation gates so the entitlement lookup only runs on
  // otherwise-valid summons. The invitee is deliberately NOT capped here —
  // their cap is enforced when they JOIN (a pending invite costs them nothing).
  // W674 — the dup check above + this cap are FAST-PATH specific errors for the
  // common (unraced) case; `member` is read here and reused by the atomic insert's
  // cap guard below so entitlements are read once.
  const { member } = await readEntitlements(env, session.userId);
  if (!member) {
    const running = await countRunningHunts(env, session.userId);
    if (running >= FREE_CONCURRENT_HUNT_CAP) {
      return jsonError(
        409,
        'CAP_REACHED',
        `You already have ${FREE_CONCURRENT_HUNT_CAP} hunts running. Finish one first — or go Premium for unlimited hunts.`,
        { cap: FREE_CONCURRENT_HUNT_CAP },
      );
    }
  }

  const id = crypto.randomUUID();
  // W674 — atomic guarded insert (the race backstop). Re-checks BOTH guards — no
  // live instance for this boss containing the summoner + any invited ally, AND,
  // for non-members, the concurrent-hunt cap — inside ONE INSERT ... SELECT ...
  // WHERE statement, so two creates that both passed the fast-path checks above
  // cannot both land a row (duplicate winnable hunts / cap+paywall bypass).
  // Inserts 0 rows when a raced create already took the slot. Mirrors
  // founder-mark.ts's pattern. W677 — ?11 is the trio's second ally (NULL for a
  // duo: every `= NULL` comparison is never-true, so the extra clauses vanish).
  const ins = await env.DB.prepare(
    `INSERT INTO coop_boss_instances
       (id, boss_id, boss_rank, challenger_user_id, partner_user_id, partner2_user_id,
        goal_steps, goal_flights, reward_souls, status)
     SELECT ?1, ?2, ?3, ?4, ?5, ?11, ?6, ?7, ?8, 'pending'
      WHERE NOT EXISTS (
              SELECT 1 FROM coop_boss_instances
               WHERE boss_id = ?2 AND status IN ('pending','active')
                 AND (challenger_user_id = ?4 OR partner_user_id = ?4 OR partner2_user_id = ?4)
                 AND ( (challenger_user_id = ?5 OR partner_user_id = ?5 OR partner2_user_id = ?5)
                    OR (?11 IS NOT NULL AND (challenger_user_id = ?11 OR partner_user_id = ?11 OR partner2_user_id = ?11)) )
            )
        AND ( ?9 = 1 OR (
              SELECT COUNT(*) FROM coop_boss_instances
               WHERE status IN ('pending','active')
                 AND (challenger_user_id = ?4
                   OR ((partner_user_id = ?4 OR partner2_user_id = ?4) AND status = 'active')
                   OR (partner_user_id = ?4 AND status = 'pending' AND partner_joined_at IS NOT NULL)
                   OR (partner2_user_id = ?4 AND status = 'pending' AND partner2_joined_at IS NOT NULL))
                 AND (status = 'pending' OR ends_at IS NULL OR strftime('%s', ends_at) > strftime('%s', 'now'))
            ) < ?10 )`,
  )
    .bind(
      id, bossId, cfg.rank, session.userId, partnerUserId,
      cfg.goalSteps, cfg.goalFlights ?? null, cfg.rewardSouls,
      member ? 1 : 0, FREE_CONCURRENT_HUNT_CAP,
      partner2UserId || null,
    )
    .run();

  if (!(ins.meta && Number(ins.meta.changes) >= 1)) {
    // A concurrent create won the race between the fast-path checks and the insert.
    // Re-derive which guard blocked us so the client keeps its specific 409.
    const dup = await env.DB.prepare(
      `SELECT 1 AS x FROM coop_boss_instances
        WHERE boss_id = ?1 AND status IN ('pending','active')
          AND (challenger_user_id = ?2 OR partner_user_id = ?2 OR partner2_user_id = ?2)
          AND ( (challenger_user_id = ?3 OR partner_user_id = ?3 OR partner2_user_id = ?3)
             OR (?4 IS NOT NULL AND (challenger_user_id = ?4 OR partner_user_id = ?4 OR partner2_user_id = ?4)) )
        LIMIT 1`,
    )
      .bind(bossId, session.userId, partnerUserId, partner2UserId || null)
      .first();
    if (dup) return jsonError(409, 'ALREADY_ACTIVE', 'A co-op hunt for this boss already exists with that hunter.');
    return jsonError(
      409,
      'CAP_REACHED',
      `You already have ${FREE_CONCURRENT_HUNT_CAP} hunts running. Finish one first — or go Premium for unlimited hunts.`,
      { cap: FREE_CONCURRENT_HUNT_CAP },
    );
  }

  const row = await loadInstance(env, id);
  if (!row) return jsonError(500, 'INTERNAL', 'Failed to read back created instance.');
  const aliasMap = await getAliasMap(env, participantIds(row));
  // W603 — push the invited partner NOW (the co-op badge only surfaced this on
  // their next app-open; this makes the summons a live event). bossId rides in
  // the payload so a tapped push can deep-link straight to the hunt.
  // W677 — every invited seat gets the summons.
  if (ctx)
    for (const ally of allies)
      ctx.waitUntil(
        notifyUser(env, ally, {
          title: 'Co-op Summons',
          body: `${session.alias} summoned you to a co-op hunt.`,
          type: 'coop_invite',
          data: { bossId },
        }),
      );
  return jsonOk({ ok: true, instance: serializeCoop(row, aliasMap, session.userId, emptyProgress()) });
}

// ── GET /v1/coop-boss — list caller's instances ─────────────────────
export async function handleCoopBossList(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const rows = await env.DB.prepare(
    `SELECT * FROM coop_boss_instances
      WHERE challenger_user_id = ?1 OR partner_user_id = ?1 OR partner2_user_id = ?1
      ORDER BY updated_at DESC
      LIMIT ?2`,
  )
    .bind(session.userId, MAX_LIST)
    .all<CoopBossRow>();

  const list = rows.results ?? [];
  const ids = list.map((r) => r.id);
  const userIds = new Set<string>();
  for (const r of list) for (const uid of participantIds(r)) userIds.add(uid);
  const [progByInstance, aliasMap, awardByInstance] = await Promise.all([
    getCoopProgressForInstances(env, ids),
    getAliasMap(env, Array.from(userIds)),
    getViewerAwardsForInstances(env, ids, session.userId),   // W463.1 — caller's drop credits
  ]);

  const instances = list.map((r) =>
    serializeCoop(r, aliasMap, session.userId, progByInstance.get(r.id) ?? emptyProgress(), awardByInstance.get(r.id) ?? null),
  );
  return jsonOk({ ok: true, instances });
}

// ── GET /v1/coop-boss/:id — detail ──────────────────────────────────
export async function handleCoopBossGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  if (!isParticipant(row, session.userId)) {
    return jsonError(403, 'FORBIDDEN', 'You are not part of this co-op hunt.');
  }
  const prog = await getCoopProgress(env, row.id);
  const aliasMap = await getAliasMap(env, participantIds(row));
  const award = await getViewerAward(env, row.id, session.userId);   // W463.1
  return jsonOk({ ok: true, instance: serializeCoop(row, aliasMap, session.userId, prog, award) });
}

// ── POST /v1/coop-boss/:id/join — partner accepts ───────────────────
export async function handleCoopBossJoin(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  const isP1 = row.partner_user_id === session.userId;
  const isP2 = !!row.partner2_user_id && row.partner2_user_id === session.userId;
  if (!isP1 && !isP2) {
    return jsonError(403, 'FORBIDDEN', 'Only the invited hunter can join this hunt.');
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot join from status "${row.status}".`);
  }
  const isTrio = !!row.partner2_user_id;
  // W677 — a trio seat can only answer once; the hunt stays 'pending' until BOTH
  // allies have answered (the 24h clock must not run against a half-formed party).
  if (isTrio && ((isP1 && row.partner_joined_at) || (isP2 && row.partner2_joined_at))) {
    return jsonError(400, 'ALREADY_JOINED', 'You already answered this summons — waiting on your other ally.');
  }

  // W648 — the joiner's cap. THIS instance is their received-pending row, which
  // countRunningHunts already excludes, so at the cap the join is refused
  // without off-by-one gymnastics. Founders bypass inside checkHuntCap.
  const capHit = await checkHuntCap(env, session.userId);
  if (capHit) return capHit;

  const cfg = COOP_BOSS_CFG[row.boss_id];
  const windowHours = cfg ? cfg.windowHours : 24;
  const nowMs = Date.now();
  const startsAt = new Date(nowMs).toISOString();
  const endsAt = new Date(nowMs + windowHours * 3600 * 1000).toISOString();

  if (!isTrio) {
    // Duo (v1 behavior, unchanged): the single ally's join activates the hunt.
    await env.DB.prepare(
      `UPDATE coop_boss_instances
          SET status = 'active', starts_at = ?, ends_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'`,
    )
      .bind(startsAt, endsAt, id)
      .run();
  } else {
    // W677 trio: stamp THIS seat's answer (guarded — only if unanswered), then
    // activate IFF both seats have answered. The two statements run in ONE
    // env.DB.batch (an implicit transaction — review W677 #4): a failure between
    // them can't strand a row with both stamps set but status still 'pending'
    // (which nothing could ever activate, since ALREADY_JOINED blocks re-joins).
    // Concurrency: two simultaneous joins each stamp their own column and at most
    // ONE batch's activation UPDATE matches (status='pending' + both stamps), so
    // the clock starts exactly once, when the party is full.
    const col = isP1 ? 'partner_joined_at' : 'partner2_joined_at';
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE coop_boss_instances
            SET ${col} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'pending' AND ${col} IS NULL`,
      ).bind(id),
      env.DB.prepare(
        `UPDATE coop_boss_instances
            SET status = 'active', starts_at = ?, ends_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'pending'
            AND partner_joined_at IS NOT NULL AND partner2_joined_at IS NOT NULL`,
      ).bind(startsAt, endsAt, id),
    ]);
  }

  const refreshed = await loadInstance(env, id);
  if (!refreshed) return jsonError(500, 'INTERNAL', 'Failed to read back joined instance.');
  const aliasMap = await getAliasMap(env, participantIds(refreshed));
  // W603 — push the moment the hunt goes LIVE (duo: this join; trio: the second
  // answer) to every participant except the joiner. W677 — a trio's FIRST answer
  // instead tells the summoner one seat is still open.
  if (ctx) {
    if (refreshed.status === 'active') {
      for (const uid of participantIds(refreshed)) {
        if (uid === session.userId) continue;
        ctx.waitUntil(
          notifyUser(env, uid, {
            title: 'The Hunt Begins',
            body: `${session.alias} answered the summons — the hunt is on.`,
            type: 'coop_joined',
            data: { bossId: refreshed.boss_id },
          }),
        );
      }
    } else {
      ctx.waitUntil(
        notifyUser(env, refreshed.challenger_user_id, {
          title: 'Ally Answered',
          body: `${session.alias} answered your summons — waiting on one more ally.`,
          type: 'coop_joined',
          data: { bossId: refreshed.boss_id },
        }),
      );
    }
  }
  return jsonOk({ ok: true, instance: serializeCoop(refreshed, aliasMap, session.userId, emptyProgress()) });
}

// ── POST /v1/coop-boss/:id/decline — partner declines ───────────────
export async function handleCoopBossDecline(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
): Promise<Response> {
  return setTerminalStatus(env, session, id, 'declined', 'partner');
}

// ── POST /v1/coop-boss/:id/cancel — withdraw a PENDING invite (challenger
//    only) OR leave an ACTIVE hunt (either participant). W384.
//    Co-op has no economy/penalty stake (nothing is wagered; rewards land only
//    on a win), so leaving an active hunt simply forfeits both hunters' in-window
//    progress — there is nothing to refund and nothing to exploit.
export async function handleCoopBossCancel(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');

  // W384.1 — participant gate FIRST (matches handleCoopBossGet/Resolve), so a
  // non-participant gets a uniform 403 for ANY status (no terminal-vs-active
  // state enumeration via 400-vs-403).
  if (!isParticipant(row, session.userId)) {
    return jsonError(403, 'FORBIDDEN', 'You are not part of this co-op hunt.');
  }
  const isChallenger = row.challenger_user_id === session.userId;

  if (row.status === 'pending') {
    // Withdraw an invite the partner hasn't accepted yet — challenger only
    // (the partner uses /decline instead).
    if (!isChallenger) {
      return jsonError(403, 'FORBIDDEN', 'Only the challenger can withdraw a pending invite.');
    }
  } else if (row.status === 'active') {
    // Leave an in-progress hunt — EITHER participant may (verified above).
    // Don't let a leave throw away an already-earned win: if the combined goal
    // is met it must resolve as a WIN, not vanish. (The client also auto-resolves
    // on goal-met; this guards the small race where a leave races the resolve.)
    const prog = await getCoopProgress(env, row.id);
    if (isGoalMet(row)(prog)) {
      return jsonError(409, 'ALREADY_WON', 'This hunt already hit its goal — claim the win instead.');
    }
  } else {
    return jsonError(400, 'BAD_STATE', `Cannot cancel from status "${row.status}".`);
  }

  const upd = await env.DB.prepare(
    `UPDATE coop_boss_instances
        SET status = 'cancelled', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('pending','active')`,
  )
    .bind(id)
    .run();
  const cancelled = Number(upd?.meta?.changes ?? 0) > 0;

  const refreshed = await loadInstance(env, id);
  if (!refreshed) return jsonError(500, 'INTERNAL', 'Failed to read back instance.');
  const aliasMap = await getAliasMap(env, participantIds(refreshed));
  // W384.1 — if the cancel did NOT apply (it raced a /resolve or expiry that
  // committed a terminal status first), return the REAL current row with REAL
  // steps so the client can still award a won hunt and show correct totals.
  // When it DID cancel, the steps are irrelevant (empty map is fine).
  const prog = cancelled
    ? emptyProgress()
    : await getCoopProgress(env, refreshed.id);
  // W464.1 — if the cancel RACED a win (refreshed is completed/success), surface
  // the viewer's drop credit so the raced win flows through the same atomic claim
  // path as every other endpoint instead of the per-device fallback. A real
  // cancel (or any non-won state) has no credit.
  const award = cancelled ? null : await getViewerAward(env, refreshed.id, session.userId);
  return jsonOk({ ok: true, instance: serializeCoop(refreshed, aliasMap, session.userId, prog, award) });
}

/** Shared pending→terminal transition for decline/cancel. */
async function setTerminalStatus(
  env: Env,
  session: SessionPayload,
  id: string,
  nextStatus: 'declined' | 'cancelled',
  who: 'partner' | 'challenger',
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  // W677 — 'partner' means "an invited ally": either trio seat may decline, and one
  // decline ends the whole summons (the challenger re-summons with someone else —
  // a half-party must never silently become a smaller hunt than was priced/goaled).
  const allowed = who === 'partner'
    ? (row.partner_user_id === session.userId || (!!row.partner2_user_id && row.partner2_user_id === session.userId))
    : row.challenger_user_id === session.userId;
  if (!allowed) {
    return jsonError(403, 'FORBIDDEN', `Only the ${who} can ${nextStatus === 'declined' ? 'decline' : 'cancel'} this hunt.`);
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot ${nextStatus} from status "${row.status}".`);
  }

  await env.DB.prepare(
    `UPDATE coop_boss_instances
        SET status = ?, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`,
  )
    .bind(nextStatus, id)
    .run();

  const refreshed = await loadInstance(env, id);
  if (!refreshed) return jsonError(500, 'INTERNAL', 'Failed to read back instance.');
  const aliasMap = await getAliasMap(env, participantIds(refreshed));
  return jsonOk({ ok: true, instance: serializeCoop(refreshed, aliasMap, session.userId, emptyProgress()) });
}

// ── POST /v1/coop-boss/:id/resolve — evaluate the hunt ──────────────
export async function handleCoopBossResolve(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
  ctx?: ExecutionContext,   // W662 — for the hunt-complete push (waitUntil)
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  if (!isParticipant(row, session.userId)) {
    return jsonError(403, 'FORBIDDEN', 'You are not part of this co-op hunt.');
  }

  const prog = await getCoopProgress(env, row.id);
  const aliasMap = await getAliasMap(env, participantIds(row));

  // Idempotent: already resolved → return the stored verdict + live progress.
  if (row.status === 'completed' || row.status === 'expired') {
    const award = await getViewerAward(env, row.id, session.userId);   // W463.1
    return jsonOk({
      ok: true,
      resolved: true,
      already_resolved: true,
      instance: serializeCoop(row, aliasMap, session.userId, prog, award),
    });
  }
  if (row.status !== 'active') {
    return jsonError(400, 'BAD_STATE', `Cannot resolve from status "${row.status}".`);
  }

  const goalMet = isGoalMet(row)(prog);   // W447 — 'both' bosses require BOTH steps AND flights
  const endsMs = row.ends_at ? Date.parse(row.ends_at) : NaN;
  const expired = Number.isFinite(endsMs) && Date.now() >= endsMs;

  // Win can land mid-window the instant the combined goal is reached.
  if (goalMet) {
    const upd = await env.DB.prepare(
      `UPDATE coop_boss_instances
          SET status = 'completed', result = 'success',
              resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'active'`,
    )
      .bind(id)
      .run();
    // W463.1 — durable per-participant drop credit (idempotent). EVERY hunter
    // (W677: 2 or 3) is now OWED a drop; each claims atomically before granting
    // client-side.
    const winners = participantIds(row);
    await env.DB.batch(
      winners.map((uid) =>
        env.DB.prepare('INSERT OR IGNORE INTO coop_boss_awards (instance_id, user_id) VALUES (?, ?)').bind(id, uid),
      ),
    );
    // W662 — push EVERY hunter that the hunt is won, EXACTLY ONCE. All clients
    // poll /resolve (and re-poll), but the `WHERE status='active'` guard means
    // only the request that actually flipped the row gets changes>0 — every later
    // post-win poll is a no-op here, so the push can't re-send. notifyUser never
    // throws and no-ops if push is unconfigured or a hunter has no device token.
    if (ctx && Number(upd?.meta?.changes ?? 0) > 0) {
      const data = { bossId: row.boss_id, instanceId: id };
      for (const uid of winners) {
        const others = winners
          .filter((w) => w !== uid)
          .map((w) => aliasMap.get(w) ?? 'your ally')
          .join(' and ');
        ctx.waitUntil(notifyUser(env, uid, {
          title: 'Hunt Complete', body: `You and ${others} felled your ${row.boss_rank}-rank quarry.`, type: 'coop_complete', data,
        }));
      }
    }
  } else if (expired) {
    await env.DB.prepare(
      `UPDATE coop_boss_instances
          SET status = 'expired', result = 'defeat',
              resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'active'`,
    )
      .bind(id)
      .run();
  } else {
    // Still in progress — not an error, just not resolved yet.
    return jsonOk({
      ok: true,
      resolved: false,
      instance: serializeCoop(row, aliasMap, session.userId, prog),
    });
  }

  const refreshed = (await loadInstance(env, id)) ?? row;
  // W463.1 — on a WIN the viewer now has a fresh unclaimed award row; on a loss
  // there is no credit.
  const award = goalMet ? { owed: true, claimed: false } : null;
  return jsonOk({
    ok: true,
    resolved: true,
    instance: serializeCoop(refreshed, aliasMap, session.userId, prog, award),
  });
}

// ── POST /v1/coop-boss/:id/claim — claim the durable drop credit (W463.1) ──
// Atomic, exactly-once-per-user. Only the device that flips this user's award
// row claimed 0→1 gets first=true and grants the souls+relic client-side; other
// devices (or a re-run) see first=false and skip. owed=false means no credit
// (a pre-feature hunt or a hunt this user wasn't a winner of).
export async function handleCoopBossClaim(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  if (!isParticipant(row, session.userId)) {
    return jsonError(403, 'FORBIDDEN', 'You are not part of this co-op hunt.');
  }

  const upd = await env.DB.prepare(
    `UPDATE coop_boss_awards
        SET claimed = 1, claimed_at = datetime('now')
      WHERE instance_id = ? AND user_id = ? AND claimed = 0`,
  )
    .bind(id, session.userId)
    .run();
  const first = Number(upd?.meta?.changes ?? 0) > 0;
  const exists = await env.DB.prepare(
    'SELECT 1 AS ok FROM coop_boss_awards WHERE instance_id = ? AND user_id = ?',
  )
    .bind(id, session.userId)
    .first<{ ok: number }>();
  const owed = !!exists;
  return jsonOk({ ok: true, owed, claimed: owed, first });
}
