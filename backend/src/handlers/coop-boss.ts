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
// W692 — the single "does this user have a running hunt?" predicate, shared as a
// SQL fragment by countRunningHunts (the fast-path) and the create atomic-insert
// cap guard so the two can NEVER drift (the W677 review flagged the duplication as
// the failure mode). ?U is the user placeholder; the caller binds it.
//
// A hunt counts when the user is: the challenger; OR a participant on an ACTIVE
// hunt; OR a participant who has ANSWERED (joined_at set) on a still-pending hunt.
// The answered-pending arm is the W677 paywall-integrity guard: without it a free
// user could answer unlimited N-hunter summons cap-free and have them all flip
// active later (deterministic bypass). A hunter stuck waiting on the last ally can
// free the slot via /decline. Lapsed active hunts (past ends_at) don't count (W649).
const RUNNING_HUNT_SQL = `status IN ('pending','active')
        AND (challenger_user_id = ?U
          OR EXISTS (SELECT 1 FROM coop_boss_participants p
                      WHERE p.instance_id = coop_boss_instances.id AND p.user_id = ?U
                        AND (coop_boss_instances.status = 'active'
                             OR (coop_boss_instances.status = 'pending' AND p.joined_at IS NOT NULL))))
        AND (status = 'pending' OR ends_at IS NULL OR strftime('%s', ends_at) > strftime('%s', 'now'))`;

async function countRunningHunts(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM coop_boss_instances WHERE ${RUNNING_HUNT_SQL.replace(/\?U/g, '?1')}`,
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
// W686 — metric 'steps_sleep' is the S-rank raid dual: a combined STEPS goal
// (goalSteps) AND a combined SLEEP goal must both be met. The sleep goal rides
// the metric-generic goalFlights column as MINUTES asleep (2520 = 42h) — the
// header already blesses column reuse; no migration.
const COOP_BOSS_CFG: Record<
  string,
  { rank: string; goalSteps: number; goalFlights?: number; rewardSouls: number; windowHours: number; metric: 'steps' | 'flights' | 'both' | 'steps_sleep'; partySize?: number; minParty?: number; maxParty?: number; memberOnly?: boolean; matchmaking?: boolean }
> = {
  the_twin_maw:         { rank: 'E', goalSteps: 14000, rewardSouls: 25,  windowHours: 24, metric: 'steps' },   // W765 — owner tuned 16k→14k (entry-rank hunt was too steep for two casual hunters' day)
  // W682 — first D-rank co-op + first 48-HOUR window (endurance duo: a goal
  // deliberately beyond one day's walking, humane across two). Reward = half
  // the solo D kill (100 → 50/hunter, the W648 split model).
  the_unresting_march:  { rank: 'D', goalSteps: 28000, rewardSouls: 50,  windowHours: 48, metric: 'steps' },
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
  // W686 — the S-rank endgame raid: first 72-HOUR window + first steps+SLEEP dual.
  // Owner spec: duo, 60,000 combined steps AND 42h combined sleep across 3 days
  // (exactly 7h/night/hunter — the discipline the Crown refused). goalFlights
  // holds SLEEP MINUTES (2520 = 42h). Reward = half the solo S kill (1600 → 800).
  the_sleepless_crown:  { rank: 'S', goalSteps: 60000, goalFlights: 2520, rewardSouls: 800, windowHours: 72, metric: 'steps_sleep' },
  // W693 — THE GRINNING GOD: the members-only apex raid (homage to Solo Leveling's
  // Monarch/"state of god"). First N-hunter hunt (party 2–5; brutal below 5, but the
  // goal is FIXED regardless of party size — owner spec). 150,000 COMBINED steps AND
  // 75 COMBINED flights across an 80h window (W783 — owner widened it from 72h;
  // unlike the Sleepless Crown this goal has no per-NIGHT coupling, so more clock is
  // a clean difficulty easing rather than a silent rebalance). memberOnly gates BOTH the summoner and
  // every ally at create + join. Drops (client-side): the mythic-only table (Nightfall
  // + Reverie + Vigil, ~1% each), UNCAPPED + trophy-only. rewardSouls 800/hunter.
  the_grinning_god:     { rank: 'S', goalSteps: 150000, goalFlights: 75, rewardSouls: 800, windowHours: 80, metric: 'both', minParty: 2, maxParty: 5, memberOnly: true, matchmaking: true },
};
// W761 — display names for push copy ("2/5 have answered The Grinning God…").
// The client owns full boss presentation; this is JUST the name string, so a
// summons nudge can say which beast the party is waiting on. Fallback: 'the hunt'.
const COOP_BOSS_NAMES: Record<string, string> = {
  the_twin_maw: 'The Twin Maw',
  the_unresting_march: 'The Unresting March',
  the_coursing_dread: 'The Coursing Dread',
  the_hollow_monarch: 'The Hollow Monarch',
  the_gaunt_wardens: 'The Gaunt Wardens',
  the_sundered_choir: 'The Sundered Choir',
  the_threefold_court: 'The Threefold Court',
  the_sleepless_crown: 'The Sleepless Crown',
  the_grinning_god: 'The Grinning God',
};
function bossMetric(bossId: string): 'steps' | 'flights' | 'both' | 'steps_sleep' {
  return COOP_BOSS_CFG[bossId]?.metric ?? 'steps';
}

const STEPS_EVENT_TYPE = 'steps_total';
const FLIGHTS_EVENT_TYPE = 'flights_total';
// W686 — cumulative minutes asleep inside the hunt window (The Sleepless Crown).
// Follows the steps_total convention exactly: the client resubmits a GROWING
// window total, so MAX(value) per user = that hunter's true total.
const SLEEP_EVENT_TYPE = 'sleep_minutes_total';
// W686 — how long after ends_at a steps_sleep hunt still accepts SLEEP submits
// and defers its expiry verdict: the final night ends at the deadline and only
// reaches HealthKit after the hunter wakes + syncs. 8h covers a post-deadline
// wake with margin; the submitted value is window-clamped client-side.
const SLEEP_SUBMIT_GRACE_MS = 8 * 3600 * 1000;
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
// W686 — a 'steps_sleep' boss accepts steps_total and sleep_minutes_total.
function metricAllowedForBoss(bossId: string, eventType: string): boolean {
  const metric = bossMetric(bossId);
  if (metric === 'both') return eventType === STEPS_EVENT_TYPE || eventType === FLIGHTS_EVENT_TYPE;
  if (metric === 'steps_sleep') return eventType === STEPS_EVENT_TYPE || eventType === SLEEP_EVENT_TYPE;
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
  // W695 — "Summon & Fill": intended party size for an OPEN hunt whose empty seats the
  // raid finder fills (NULL = normal closed hunt). While pending + all invited answered,
  // the hunt is READY: matchmaking pours solos in / merges open hunts; activates at
  // fill_target or on the leader's explicit start.
  fill_target: number | null;
  status: string;
  result: string | null;
  starts_at: string | null;
  ends_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  // W692 — N-hunter model: every hunter EXCEPT the challenger, from
  // coop_boss_participants. Attached by loadInstance / the list query. The legacy
  // partner* columns above are retained for one release (old-client serialize).
  participants?: CoopParticipant[];
}

interface CoopParticipant {
  user_id: string;
  joined_at: string | null;   // NULL = invited/unanswered; set = joined (clock-eligible)
}

/** W677→W692 — every hunter on this instance (challenger + all participants).
 *  The single seam the progress/serialize/notify/pact paths fan out over. Reads
 *  the N-participant array when present; falls back to the legacy partner columns
 *  for a row loaded without it (defensive — loadInstance/list always attach it). */
function participantIds(
  row: Pick<CoopBossRow, 'challenger_user_id' | 'partner_user_id' | 'partner2_user_id' | 'participants'>,
): string[] {
  if (Array.isArray(row.participants)) {
    return [row.challenger_user_id, ...row.participants.map((p) => p.user_id)];
  }
  const ids = [row.challenger_user_id, row.partner_user_id];
  if (row.partner2_user_id) ids.push(row.partner2_user_id);
  return ids;
}

/** W692 — load the participant rows for a set of instance ids, grouped by
 *  instance. One query; used to attach `participants` on loadInstance + list. */
async function loadParticipants(env: Env, instanceIds: string[]): Promise<Map<string, CoopParticipant[]>> {
  const out = new Map<string, CoopParticipant[]>();
  if (!instanceIds.length) return out;
  const ph = instanceIds.map(() => '?').join(', ');
  const rows = await env.DB.prepare(
    `SELECT instance_id, user_id, joined_at FROM coop_boss_participants
       WHERE instance_id IN (${ph}) ORDER BY created_at, user_id`,
  )
    .bind(...instanceIds)
    .all<{ instance_id: string; user_id: string; joined_at: string | null }>();
  for (const r of rows.results ?? []) {
    const list = out.get(r.instance_id) ?? [];
    list.push({ user_id: r.user_id, joined_at: r.joined_at ?? null });
    out.set(r.instance_id, list);
  }
  return out;
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
interface CoopProgress { steps: Map<string, number>; flights: Map<string, number>; sleep: Map<string, number>; }
function emptyProgress(): CoopProgress { return { steps: new Map(), flights: new Map(), sleep: new Map() }; }
function progressStream(p: CoopProgress, eventType: string): Map<string, number> {
  if (eventType === FLIGHTS_EVENT_TYPE) return p.flights;
  if (eventType === SLEEP_EVENT_TYPE) return p.sleep;   // W686 — minutes asleep
  return p.steps;
}

/** Per-user MAX(value) for ONE instance, split by metric stream. */
async function getCoopProgress(env: Env, instanceId: string): Promise<CoopProgress> {
  const rows = await env.DB.prepare(
    `SELECT user_id, event_type, COALESCE(MAX(value), 0) AS s
       FROM verified_events
      WHERE boss_instance_id = ? AND event_type IN (?, ?, ?)
      GROUP BY user_id, event_type`,
  )
    .bind(instanceId, STEPS_EVENT_TYPE, FLIGHTS_EVENT_TYPE, SLEEP_EVENT_TYPE)
    .all<{ user_id: string; event_type: string; s: number }>();
  const p = emptyProgress();
  for (const r of rows.results ?? []) {
    progressStream(p, r.event_type).set(r.user_id, Number(r.s) || 0);
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
      WHERE boss_instance_id IN (${placeholders}) AND event_type IN (?, ?, ?)
      GROUP BY boss_instance_id, user_id, event_type`,
  )
    .bind(...ids, STEPS_EVENT_TYPE, FLIGHTS_EVENT_TYPE, SLEEP_EVENT_TYPE)
    .all<{ bid: string; user_id: string; event_type: string; s: number }>();
  for (const r of rows.results ?? []) {
    if (!out.has(r.bid)) out.set(r.bid, emptyProgress());
    progressStream(out.get(r.bid)!, r.event_type).set(r.user_id, Number(r.s) || 0);
  }
  return out;
}

function combinedSteps(row: CoopBossRow, p: CoopProgress): number {
  return participantIds(row).reduce((sum, uid) => sum + (p.steps.get(uid) || 0), 0);
}
function combinedFlights(row: CoopBossRow, p: CoopProgress): number {
  return participantIds(row).reduce((sum, uid) => sum + (p.flights.get(uid) || 0), 0);
}
// W686 — combined minutes asleep across the party.
function combinedSleep(row: CoopBossRow, p: CoopProgress): number {
  return participantIds(row).reduce((sum, uid) => sum + (p.sleep.get(uid) || 0), 0);
}
/** Authoritative win test across all boss metrics. A 'both' boss requires BOTH goals;
 *  a flights boss compares its (metric-generic) goal_steps against the flight total.
 *  W686 — a 'steps_sleep' boss requires steps >= goal_steps AND sleep minutes >=
 *  goal_flights (the metric-generic second-goal column). */
function isGoalMet(row: CoopBossRow): (p: CoopProgress) => boolean {
  const metric = bossMetric(row.boss_id);
  return (p: CoopProgress) => {
    if (metric === 'both') return combinedSteps(row, p) >= row.goal_steps && combinedFlights(row, p) >= (row.goal_flights || 0);
    if (metric === 'steps_sleep') return combinedSteps(row, p) >= row.goal_steps && combinedSleep(row, p) >= (row.goal_flights || 0);
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
  // W677/W692 — partner2 = the trio's second invited ally; 'ally' covers the 4th/5th
  // raid seats (no legacy column). Client role checks are all "am I the challenger,
  // else an invited ally", so every non-challenger/non-observer value reads the same.
  const role: 'challenger' | 'partner' | 'partner2' | 'ally' | 'observer' =
    row.challenger_user_id === viewerUserId
      ? 'challenger'
      : row.partner_user_id === viewerUserId
        ? 'partner'
        : row.partner2_user_id === viewerUserId
          ? 'partner2'
          : (row.participants ?? []).some((pt) => pt.user_id === viewerUserId)
            ? 'ally'
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
  // W686 — steps+sleep raid: surface the sleep stream under sleep-named fields
  // (minutes) so the client contract is explicit rather than overloading flights.
  const isSleep = metric === 'steps_sleep';

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
    // W695 — open ("Summon & Fill") hunts carry their intended size so the client can
    // render filled seats vs open seats + the leader's START NOW affordance.
    ...(row.fill_target ? { fill_target: row.fill_target } : {}),
    // W677 — party size rides along so the client renders the right roster without
    // sniffing for a partner2 key.
    party_size: participantIds(row).length,
    // W692 — the N-hunter roster: challenger first, then every ally (in seat order),
    // each with per-hunter progress + answered state. New clients render from this;
    // the legacy challenger/partner/partner2 keys below stay one release for old ones.
    party: participantIds(row).map((uid) => {
      const answered = uid === row.challenger_user_id
        ? true
        : !!(row.participants ?? []).find((pt) => pt.user_id === uid)?.joined_at;
      return {
        user_id: uid,
        alias: aliasMap.get(uid) ?? null,
        role: uid === row.challenger_user_id ? 'challenger' : 'ally',
        steps: cPrimary(uid),
        ...(isBoth ? { flights: p.flights.get(uid) || 0 } : {}),
        ...(isSleep ? { sleep_minutes: p.sleep.get(uid) || 0 } : {}),
        joined: answered,
      };
    }),
    combined_steps: participantIds(row).reduce((s, uid) => s + cPrimary(uid), 0),
    // W447 — dual-metric bosses also surface the SECOND (flights) stream + goal so the
    // client can render two progress bars; omitted for single-metric bosses.
    ...(isBoth ? { goal_flights: row.goal_flights ?? 0, combined_flights: combinedFlights(row, p) } : {}),
    // W686 — steps+sleep raid: sleep goal + combined total, in MINUTES.
    ...(isSleep ? { goal_sleep_minutes: row.goal_flights ?? 0, combined_sleep_minutes: combinedSleep(row, p) } : {}),
    challenger: {
      user_id: row.challenger_user_id,
      alias: aliasMap.get(row.challenger_user_id) ?? null,
      steps: cPrimary(row.challenger_user_id),
      ...(isBoth ? { flights: p.flights.get(row.challenger_user_id) || 0 } : {}),
      ...(isSleep ? { sleep_minutes: p.sleep.get(row.challenger_user_id) || 0 } : {}),
    },
    partner: {
      user_id: row.partner_user_id,
      alias: aliasMap.get(row.partner_user_id) ?? null,
      steps: cPrimary(row.partner_user_id),
      ...(isBoth ? { flights: p.flights.get(row.partner_user_id) || 0 } : {}),
      ...(isSleep ? { sleep_minutes: p.sleep.get(row.partner_user_id) || 0 } : {}),
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
        ...(isSleep ? { sleep_minutes: p.sleep.get(row.partner2_user_id) || 0 } : {}),
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
  if (!row) return null;
  row.participants = (await loadParticipants(env, [id])).get(id) ?? [];   // W692
  return row;
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
  // W677/W692 — every invited hunter is a full participant whose verified steps must
  // count toward the combined goal. This lean SELECT doesn't attach participants, so
  // check membership directly: challenger column, participant table (raid seats 4/5),
  // or the legacy partner columns (migration→deploy window fallback).
  if (row.challenger_user_id !== userId && row.partner_user_id !== userId && row.partner2_user_id !== userId) {
    const part = await env.DB.prepare(
      `SELECT 1 FROM coop_boss_participants WHERE instance_id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(instanceId, userId)
      .first();
    if (!part) return { ok: false, reason: 'NOT_PARTICIPANT' };
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
  // W686 — SLEEP submits get a long post-window grace: the third night can END
  // at (or after) the 72h mark, and HealthKit only syncs it after the hunter
  // wakes. The submitted VALUE is still window-clamped client-side (per-sample
  // overlap vs ends_at), so the grace widens delivery, never credit. Steps keep
  // the tight 60s bound (they submit in real time).
  const lateBound = (bossMetric(row.boss_id) === 'steps_sleep' && eventType === SLEEP_EVENT_TYPE)
    ? SLEEP_SUBMIT_GRACE_MS : 60000;
  if (Number.isFinite(endMs) && now > endMs + lateBound) return { ok: false, reason: 'AFTER_WINDOW' };
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

  let body: {
    partner_user_id?: unknown;
    partner2_user_id?: unknown;
    ally_user_ids?: unknown;
    boss_id?: unknown;
    fill_from_finder?: unknown;   // W695 — open the remaining seats to the raid finder
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const bossId = typeof body.boss_id === 'string' ? body.boss_id : '';
  const cfg = COOP_BOSS_CFG[bossId];
  if (!cfg) return jsonError(400, 'UNKNOWN_BOSS', 'Unknown co-op boss id.');

  // W692 — N-hunter party bounds. A boss can specify a RANGE (minParty..maxParty,
  // e.g. the Grinning God raid: attemptable at 2, fills toward 5); the legacy fixed
  // `partySize` (duo=2 / trio=3) is the fallback for both ends. The summoner is one
  // seat, so ally counts are party-minus-one.
  const fixedParty = cfg.partySize ?? 2;
  const minParty = cfg.minParty ?? fixedParty;
  const maxParty = cfg.maxParty ?? fixedParty;
  const minAllies = Math.max(1, minParty - 1);
  const maxAllies = Math.max(1, maxParty - 1);

  // Accept the N-hunter ally ARRAY; fall back to the legacy partner/partner2 fields
  // so an old client (which sends partner_user_id[/partner2_user_id]) still summons.
  let allies: string[];
  if (Array.isArray(body.ally_user_ids)) {
    allies = body.ally_user_ids.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } else {
    allies = [body.partner_user_id, body.partner2_user_id].filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    );
  }

  if (allies.length < minAllies) {
    return jsonError(
      400,
      'MISSING_PARTNER',
      minAllies === 1
        ? 'Pick an ally to summon this hunt.'
        : `This hunt needs at least ${minParty} hunters — pick ${minAllies} allies.`,
    );
  }
  if (allies.length > maxAllies) {
    return jsonError(
      400,
      'PARTY_SIZE',
      maxAllies === 1
        ? 'This boss is a duo hunt — only one ally can be invited.'
        : `This hunt takes at most ${maxParty} hunters — pick up to ${maxAllies} allies.`,
    );
  }
  if (allies.includes(session.userId)) {
    return jsonError(400, 'SELF_PARTNER', 'You cannot co-op with yourself.');
  }
  if (new Set(allies).size !== allies.length) {
    return jsonError(400, 'DUPLICATE_ALLY', 'Pick different allies — no duplicates.');
  }

  // W695 — "Summon & Fill": open the remaining seats to the raid finder. Only a
  // matchmaking boss can fill, and only an UNDER-full party has seats to open (a
  // full party summons closed; a lone hunter uses the solo finder instead).
  const fillFromFinder = body.fill_from_finder === true;
  if (fillFromFinder) {
    if (!cfg.matchmaking) return jsonError(400, 'NO_MATCHMAKING', 'This hunt has no raid finder.');
    if (allies.length >= maxAllies) {
      return jsonError(400, 'PARTY_FULL', 'Your party is already full — summon it directly.');
    }
  }
  const fillTarget = fillFromFinder ? maxParty : null;

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
  // W699 — a members-only raid (The Grinning God) gates on MEMBERSHIP alone (enforced
  // below), NOT rank: any member may summon it at any rank, per owner. Rank still gates
  // the ordinary rank bosses.
  if (!cfg.memberOnly && myRank < bossRank) {
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
    // W699 — members raid: allies are gated on MEMBERSHIP (checked just below), not rank.
    if (!cfg.memberOnly && partnerRank < bossRank) {
      return jsonError(403, 'ALLY_RANK', `Your ally must reach ${cfg.rank} rank to join this hunt.`);
    }
  }

  // W693 — members-only raid (The Grinning God). The summoner AND every invited ally
  // must hold an active membership; a non-member ally is refused here (they can't be
  // matched or invited into the mythic raid). The gate is re-checked at JOIN too, so a
  // membership that lapses between invite and answer can't slip a free hunter in.
  if (cfg.memberOnly) {
    const { member: summonerMember } = await readEntitlements(env, session.userId);
    if (!summonerMember) {
      return jsonError(403, 'MEMBERS_ONLY', 'The Grinning God answers only to members.');
    }
    for (const ally of allies) {
      const { member: allyMember } = await readEntitlements(env, ally);
      if (!allyMember) {
        return jsonError(403, 'ALLY_NOT_MEMBER', 'Every hunter in this raid must be a member.');
      }
    }
  }

  // W692 — the seat-agnostic dup predicate as a reusable SELECT: "a live instance of
  // this boss already CONTAINS the summoner together with ANY invited ally". Sourced
  // from the challenger column + the participant table + the legacy partner columns
  // (belt-and-suspenders across the migration→deploy window, when an instance an old
  // worker created may have partner columns but no participant rows yet). `P` pushes a
  // bind and returns '?'; passing the SAME closure to the fast-path check, the atomic
  // insert guard, and the post-insert re-derive keeps all three from ever drifting.
  const allyInList = (P: (v: unknown) => string) => allies.map((a) => P(a)).join(',');
  const dupSelect = (P: (v: unknown) => string) =>
    `SELECT 1 FROM coop_boss_instances i
      WHERE i.boss_id = ${P(bossId)} AND i.status IN ('pending','active')
        AND ( i.challenger_user_id = ${P(session.userId)}
              OR i.partner_user_id = ${P(session.userId)} OR i.partner2_user_id = ${P(session.userId)}
              OR EXISTS (SELECT 1 FROM coop_boss_participants p
                          WHERE p.instance_id = i.id AND p.user_id = ${P(session.userId)}) )
        AND ( i.challenger_user_id IN (${allyInList(P)})
              OR i.partner_user_id IN (${allyInList(P)}) OR i.partner2_user_id IN (${allyInList(P)})
              OR EXISTS (SELECT 1 FROM coop_boss_participants p2
                          WHERE p2.instance_id = i.id AND p2.user_id IN (${allyInList(P)})) )`;

  {
    const fp: unknown[] = [];
    const existing = await env.DB.prepare(`${dupSelect((v) => (fp.push(v), '?'))} LIMIT 1`)
      .bind(...fp)
      .first();
    if (existing) {
      return jsonError(409, 'ALREADY_ACTIVE', 'A co-op hunt for this boss already exists with that hunter.');
    }
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
  const partner1 = allies[0];
  const partner2 = allies[1] ?? null; // dual-write legacy columns for old clients

  // W674/W692 — atomic guarded insert (the race backstop). Re-checks BOTH guards —
  // no live instance for this boss containing the summoner + any invited ally, AND,
  // for non-members, the concurrent-hunt cap — inside ONE INSERT … SELECT … WHERE, so
  // two creates that both passed the fast-path checks cannot both land a row. SQLite
  // serializes writers, so the cap COUNT re-reads after any raced create commits →
  // the paywall can't be bypassed by a double-summon. The participant rows are written
  // in the SAME env.DB.batch (below), each guarded on the instance existing, so a lost
  // race writes neither the instance nor its participants. Anonymous `?` placeholders
  // are bound in build order via the `bind`/push helper.
  const insBinds: unknown[] = [];
  const IP = (v: unknown) => (insBinds.push(v), '?');
  const insertSql =
    `INSERT INTO coop_boss_instances
       (id, boss_id, boss_rank, challenger_user_id, partner_user_id, partner2_user_id,
        goal_steps, goal_flights, reward_souls, fill_target, status)
     SELECT ${IP(id)}, ${IP(bossId)}, ${IP(cfg.rank)}, ${IP(session.userId)}, ${IP(partner1)}, ${IP(partner2)},
            ${IP(cfg.goalSteps)}, ${IP(cfg.goalFlights ?? null)}, ${IP(cfg.rewardSouls)}, ${IP(fillTarget)}, 'pending'
      WHERE NOT EXISTS ( ${dupSelect(IP)} )
        AND ( ${IP(member ? 1 : 0)} = 1 OR (
              SELECT COUNT(*) FROM coop_boss_instances
               WHERE ${RUNNING_HUNT_SQL.replace(/\?U/g, () => IP(session.userId))}
            ) < ${IP(FREE_CONCURRENT_HUNT_CAP)} )`;

  // Batch: instance insert (statement 0) + one participant row per ally, each guarded
  // on the instance existing so a lost cap/dup race writes no orphan participant rows.
  const batchStmts = [env.DB.prepare(insertSql).bind(...insBinds)];
  for (const ally of allies) {
    batchStmts.push(
      env.DB
        .prepare(
          `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
             SELECT ?1, ?2, NULL WHERE EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1)`,
        )
        .bind(id, ally),
    );
  }
  const batchRes = await env.DB.batch(batchStmts);
  const insMeta = batchRes[0]?.meta;

  if (!(insMeta && Number(insMeta.changes) >= 1)) {
    // A concurrent create won the race between the fast-path checks and the insert.
    // Re-derive which guard blocked us so the client keeps its specific 409.
    const dp: unknown[] = [];
    const dup = await env.DB.prepare(`${dupSelect((v) => (dp.push(v), '?'))} LIMIT 1`)
      .bind(...dp)
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
  // W694 review — a hand-picked summons commits these hunters to a hunt of this boss;
  // drop any stale raid-finder rows they hold for it (best-effort: the inverse of the
  // finder's "already on a live hunt" gate, so queued-AND-hunting can't coexist).
  try {
    await env.DB.batch(
      [session.userId, ...allies].map((uid) =>
        env.DB.prepare('DELETE FROM raid_queue WHERE user_id = ? AND boss_id = ?').bind(uid, bossId),
      ),
    );
  } catch (_) { /* cleanup only — never fail the create */ }
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
    // W788 — LIVE hunts sort FIRST, resolved ones after. The old plain
    // `ORDER BY updated_at DESC LIMIT 20` silently DROPPED a live hunt: resolving a
    // hunt bumps its updated_at, so completed/expired rows float to the top and
    // crowd out active ones. The owner's Grinning God raid (active, ~24h left) sat
    // at position 21 behind 12 dead duo hunts and vanished from The Pacts entirely —
    // it read as "cancelled" when the row was perfectly healthy. With 224 resolved
    // rows against 9 live ones on that account, this was going to keep happening.
    // Sorting by liveness first means a live hunt can never be evicted by a finished
    // one; recency still orders within each group.
    `SELECT * FROM coop_boss_instances
      WHERE challenger_user_id = ?1
         OR partner_user_id = ?1
         OR partner2_user_id = ?1
         OR id IN (SELECT instance_id FROM coop_boss_participants WHERE user_id = ?1)
      ORDER BY CASE WHEN status IN ('pending', 'active') THEN 0 ELSE 1 END,
               updated_at DESC
      LIMIT ?2`,
  )
    .bind(session.userId, MAX_LIST)
    .all<CoopBossRow>();

  const list = rows.results ?? [];
  const ids = list.map((r) => r.id);
  // W692 — attach participant rows (one batch query) so participantIds() + serialize
  // see the full N-hunter party, not just the legacy partner columns.
  const partsByInstance = await loadParticipants(env, ids);
  for (const r of list) r.participants = partsByInstance.get(r.id) ?? [];
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
  // W801 — the recent battle-cry tail rides the detail so every partner's log
  // can replay it (ascending, capped at 6; senders are always participants so
  // the aliasMap already covers them).
  let recentEmotes: { user_id: string; alias: string | null; emote: string; created_at: string }[] = [];
  try {
    const em = await env.DB.prepare(
      'SELECT user_id, emote, created_at FROM coop_emotes WHERE instance_id = ? ORDER BY id DESC LIMIT 6',
    )
      .bind(row.id)
      .all<{ user_id: string; emote: string; created_at: string }>();
    recentEmotes = (em.results ?? []).reverse().map((r) => ({
      user_id: r.user_id,
      alias: aliasMap.get(r.user_id) ?? null,
      emote: r.emote,
      created_at: r.created_at,
    }));
  } catch {
    // Pre-0045 database or transient read failure — the detail must still serve.
  }
  const payload = serializeCoop(row, aliasMap, session.userId, prog, award);
  payload.recent_emotes = recentEmotes;
  return jsonOk({ ok: true, instance: payload });
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
  // W692 — the invited seats now live in coop_boss_participants (attached to `row`
  // by loadInstance). The joiner must be one of them, and not the challenger.
  const parts = row.participants ?? [];
  const mySeat = parts.find((p) => p.user_id === session.userId);
  if (!mySeat) {
    return jsonError(403, 'FORBIDDEN', 'Only the invited hunter can join this hunt.');
  }
  if (row.status !== 'pending') {
    return jsonError(400, 'BAD_STATE', `Cannot join from status "${row.status}".`);
  }
  // A seat answers only once; the hunt stays 'pending' until EVERY seat has answered
  // (the clock must not run against a half-formed party).
  if (mySeat.joined_at) {
    return jsonError(400, 'ALREADY_JOINED', 'You already answered this summons — waiting on the rest of the party.');
  }

  // W693 — members-only raid: the JOINER must be a member too (re-checked here so a
  // membership lapse between invite/match and answer can't slip a free hunter in).
  const joinCfg = COOP_BOSS_CFG[row.boss_id];
  if (joinCfg?.memberOnly) {
    const { member } = await readEntitlements(env, session.userId);
    if (!member) {
      return jsonError(403, 'MEMBERS_ONLY', 'The Grinning God answers only to members.');
    }
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

  // W692 — stamp THIS seat's participant row (guarded — only if unanswered), then
  // activate IFF NO seat is still unanswered. All statements run in ONE env.DB.batch
  // (an implicit transaction — W677 #4): a failure between them can't strand a fully-
  // answered row still 'pending' (nothing could re-activate it, since ALREADY_JOINED
  // blocks re-joins). Concurrency: two simultaneous joins each stamp their OWN row and
  // at most one batch's activation UPDATE matches (status='pending' + zero NULL seats),
  // so the clock starts exactly once, when the party is full. The legacy partner_joined
  // columns are dual-written for old clients (allies[0]→partner, allies[1]→partner2).
  const legacyCol =
    row.partner_user_id === session.userId
      ? 'partner_joined_at'
      : row.partner2_user_id === session.userId
        ? 'partner2_joined_at'
        : null;
  const joinStmts = [
    env.DB
      .prepare(
        `UPDATE coop_boss_participants SET joined_at = CURRENT_TIMESTAMP
          WHERE instance_id = ? AND user_id = ? AND joined_at IS NULL`,
      )
      .bind(id, session.userId),
  ];
  if (legacyCol) {
    joinStmts.push(
      env.DB
        .prepare(
          `UPDATE coop_boss_instances SET ${legacyCol} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending' AND ${legacyCol} IS NULL`,
        )
        .bind(id),
    );
  }
  // W695 — an OPEN ("Summon & Fill") hunt does NOT activate when the invited friends
  // have all answered: it becomes READY and the raid finder fills its remaining seats
  // (activation happens at fill_target, or on the leader's explicit /start).
  joinStmts.push(
    env.DB
      .prepare(
        `UPDATE coop_boss_instances
            SET status = 'active', starts_at = ?, ends_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'pending'
            AND NOT EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ? AND joined_at IS NULL)
            AND (fill_target IS NULL
                 OR (SELECT COUNT(*) + 1 FROM coop_boss_participants WHERE instance_id = ?) >= fill_target)`,
      )
      .bind(startsAt, endsAt, id, id, id),
  );
  await env.DB.batch(joinStmts);
  // W694 review — joining a hunt of this boss ends any raid-finder search for it
  // (inverse of the finder's "already on a live hunt" gate). Best-effort, OUTSIDE the
  // join batch: queue cleanup must never be able to fail the join itself.
  try {
    await env.DB.prepare('DELETE FROM raid_queue WHERE user_id = ? AND boss_id = ?').bind(session.userId, row.boss_id).run();
  } catch (_) { /* cleanup only */ }

  const refreshed = await loadInstance(env, id);
  if (!refreshed) return jsonError(500, 'INTERNAL', 'Failed to read back joined instance.');
  const aliasMap = await getAliasMap(env, participantIds(refreshed));
  // W603 — push the moment the hunt goes LIVE to every participant except the joiner.
  // W692 — an EARLIER answer (seats still open) instead tells the summoner how many
  // hunters are still awaited.
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
      const stillOut = (refreshed.participants ?? []).filter((p) => !p.joined_at).length;
      ctx.waitUntil(
        notifyUser(env, refreshed.challenger_user_id, {
          title: 'Ally Answered',
          body:
            stillOut === 1
              ? `${session.alias} answered your summons — waiting on one more ally.`
              : `${session.alias} answered your summons — waiting on ${stillOut} more allies.`,
          type: 'coop_joined',
          data: { bossId: refreshed.boss_id },
        }),
      );
      // W761 — nudge the OTHER still-pending seats too (the "James fix"). The
      // original summons push fires exactly once at create, so a seat whose
      // device registered for push AFTER that moment never hears about the hunt
      // again. Every answer now re-pings the holdouts with the filling count —
      // social proof + a fresh deep-link. Naturally bounded: a seat can receive
      // at most (party−2) of these across the whole pending life, and only
      // while the hunt is still pending. type 'coop_invite' rides the same
      // client deep-link path as the original summons.
      const partyTotal = (refreshed.participants ?? []).length + 1;   // + challenger
      const answered = partyTotal - stillOut;
      const bossName = COOP_BOSS_NAMES[refreshed.boss_id] ?? 'the hunt';
      for (const p of refreshed.participants ?? []) {
        if (p.joined_at || p.user_id === session.userId) continue;
        ctx.waitUntil(
          notifyUser(env, p.user_id, {
            title: 'The Party Waits',
            body: `${answered}/${partyTotal} have answered ${bossName} — your seat is still open.`,
            type: 'coop_invite',
            data: { bossId: refreshed.boss_id },
          }),
        );
      }
    }
  }
  return jsonOk({ ok: true, instance: serializeCoop(refreshed, aliasMap, session.userId, emptyProgress()) });
}

// ── W761 — 24h summons-reminder sweep (cron) ────────────────────────
// One-time re-push for every seat that has sat unanswered on a still-pending
// hunt for 24+ hours. Catches the seat that was token-less when the original
// create-time push fired (fresh install / push-less build): by a day later the
// invitee has usually opened the app once, so a token exists NOW even though
// none did at summons time. reminded_at (0043) marks the seat BEFORE the push
// so the every-2-minute cron can never double-send — a lost push is not
// retried, mirroring the create-time best-effort semantics. LIMIT bounds a
// worst-case backlog; the cron's cadence drains any remainder within minutes.
export async function sweepPendingSummonsReminders(env: Env, ctx?: ExecutionContext): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT p.instance_id, p.user_id, i.boss_id, u.alias AS challenger_alias
       FROM coop_boss_participants p
       JOIN coop_boss_instances i ON i.id = p.instance_id
       JOIN users u ON u.id = i.challenger_user_id
      WHERE i.status = 'pending'
        AND p.joined_at IS NULL
        AND p.reminded_at IS NULL
        AND i.created_at < datetime('now', '-24 hours')
      LIMIT 20`,
  ).all<{ instance_id: string; user_id: string; boss_id: string; challenger_alias: string }>();

  for (const row of due.results ?? []) {
    // Mark FIRST, push second — the guarded UPDATE is the idempotency lock, so
    // an overlapping cron tick that loses the race sends nothing.
    const marked = await env.DB.prepare(
      `UPDATE coop_boss_participants SET reminded_at = CURRENT_TIMESTAMP
        WHERE instance_id = ? AND user_id = ? AND reminded_at IS NULL AND joined_at IS NULL`,
    )
      .bind(row.instance_id, row.user_id)
      .run();
    if (!(marked.meta && Number(marked.meta.changes) >= 1)) continue;
    const bossName = COOP_BOSS_NAMES[row.boss_id] ?? 'a co-op hunt';
    const push = notifyUser(env, row.user_id, {
      title: 'The Summons Still Stands',
      body: `${row.challenger_alias} summoned you to ${bossName} a day ago — your seat is still open.`,
      type: 'coop_invite',
      data: { bossId: row.boss_id },
    });
    if (ctx) ctx.waitUntil(push);
    else await push;
  }
}

// ── W798 — crunch-time reminder sweep (cron) ────────────────────────
// One-time push to EVERY seat of an active hunt that is ≤30 minutes from its
// window closing AND ≥80% of the way to the kill — "so close, land it" (owner:
// a hunt died at 94% because a partner didn't know their steps were unsynced).
// crunch_reminded_at (0044) stamps the INSTANCE before the pushes fire — the
// guarded UPDATE is the idempotency lock, so an overlapping tick sends nothing.
// A hunt under 80% when it enters the window is re-checked every tick until
// ends_at (the stamp only lands with the send), so a late surge still alerts.
export async function sweepCrunchTimeReminders(env: Env, ctx?: ExecutionContext): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT * FROM coop_boss_instances
      WHERE status = 'active'
        AND crunch_reminded_at IS NULL
        AND ends_at > datetime('now')
        AND ends_at <= datetime('now', '+30 minutes')
      ORDER BY ends_at ASC
      LIMIT 25`,
  ).all<CoopBossRow>();
  const rows = due.results ?? [];
  if (!rows.length) return;
  const partsByInstance = await loadParticipants(env, rows.map((r) => r.id));
  const progByInstance = await getCoopProgressForInstances(env, rows.map((r) => r.id));
  for (const row of rows) {
    row.participants = partsByInstance.get(row.id) ?? [];
    const p = progByInstance.get(row.id) ?? emptyProgress();
    // Progress fraction mirrors isGoalMet: min across every REQUIRED stream.
    const metric = bossMetric(row.boss_id);
    const frac = (v: number, g: number) => (g > 0 ? v / g : 0);
    let pct: number;
    if (metric === 'both') pct = Math.min(frac(combinedSteps(row, p), row.goal_steps), frac(combinedFlights(row, p), row.goal_flights || 0));
    else if (metric === 'steps_sleep') pct = Math.min(frac(combinedSteps(row, p), row.goal_steps), frac(combinedSleep(row, p), row.goal_flights || 0));
    else if (metric === 'flights') pct = frac(combinedFlights(row, p), row.goal_steps);
    else pct = frac(combinedSteps(row, p), row.goal_steps);
    if (pct < 0.8 || pct >= 1) continue;   // not close enough yet / already a win awaiting resolve
    const marked = await env.DB.prepare(
      `UPDATE coop_boss_instances SET crunch_reminded_at = CURRENT_TIMESTAMP
        WHERE id = ? AND crunch_reminded_at IS NULL AND status = 'active'`,
    ).bind(row.id).run();
    if (!(marked.meta && Number(marked.meta.changes) >= 1)) continue;
    const bossName = COOP_BOSS_NAMES[row.boss_id] ?? 'Your co-op hunt';
    const pctShown = Math.min(99, Math.floor(pct * 100));
    // W808 (review F6) — metric-aware copy: "steps" on a flights-only boss read wrong.
    const driveWord = metric === 'flights' ? 'flights' : 'steps';
    for (const uid of participantIds(row)) {
      const push = notifyUser(env, uid, {
        title: 'The Hunt Nears Its End',
        body: `${bossName} is at ${pctShown}% with under 30 minutes left — open the hunt and drive your ${driveWord} home.`,
        type: 'coop_invite',
        data: { bossId: row.boss_id },
      });
      if (ctx) ctx.waitUntil(push);
      else await push;
    }
  }
}

// ── POST /v1/coop-boss/:id/decline — partner declines ───────────────
export async function handleCoopBossDecline(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
): Promise<Response> {
  // W695 — on an OPEN ("Summon & Fill") pending hunt, a non-leader decline/leave
  // removes ONLY that seat (the party shrinks and the seat reopens to the finder) —
  // one hunter must not kill a forming party of four. A CLOSED hunt keeps the
  // original rule: one decline ends the whole summons (a hand-picked half-party
  // must never silently become a smaller hunt than was goaled).
  // W695 review — rate-limit BEFORE any DB read (all paths burn the same token).
  const rlDecline = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rlDecline.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const row = await loadInstance(env, id);
  if (row && row.fill_target && row.status === 'pending' && row.challenger_user_id !== session.userId) {
    const mine = (row.participants ?? []).find((p) => p.user_id === session.userId);
    if (!mine) return jsonError(403, 'FORBIDDEN', 'You are not part of this co-op hunt.');
    const leaveRes = await env.DB.batch([
      // Guarded on the hunt STILL being pending (W695 review: an unguarded DELETE
      // raced the activation and ripped a hunter out of a live raid).
      env.DB
        .prepare(
          `DELETE FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?2
             AND EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1 AND status = 'pending')`,
        )
        .bind(id, session.userId),
      // Clear a matching legacy partner column so the departed hunter can't be ghost-
      // matched later (the dup/cap predicates probe these columns; partner_user_id is
      // NOT NULL so it blanks to '' — no real user id ever equals ''). All CASE
      // expressions read the PRE-update row (SQLite semantics), so the tests are safe.
      // Guarded on pending like the DELETE (same race).
      env.DB
        .prepare(
          `UPDATE coop_boss_instances
              SET partner_user_id   = CASE WHEN partner_user_id  = ?2 THEN '' ELSE partner_user_id END,
                  partner_joined_at = CASE WHEN partner_user_id  = ?2 THEN NULL ELSE partner_joined_at END,
                  partner2_user_id   = CASE WHEN partner2_user_id = ?2 THEN NULL ELSE partner2_user_id END,
                  partner2_joined_at = CASE WHEN partner2_user_id = ?2 THEN NULL ELSE partner2_joined_at END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?1 AND status = 'pending'`,
        )
        .bind(id, session.userId),
    ]);
    // If the guarded DELETE lost the race (the hunt went ACTIVE mid-leave), the
    // hunter is still IN the live raid — return the real state, not left_seat.
    const leftSeat = Number(leaveRes[0]?.meta?.changes ?? 0) > 0;
    const refreshed = await loadInstance(env, id);
    if (!refreshed) return jsonError(500, 'INTERNAL', 'Failed to read back instance.');
    const aliasMap = await getAliasMap(env, participantIds(refreshed));
    return jsonOk({
      ok: true,
      ...(leftSeat ? { left_seat: true } : {}),
      instance: serializeCoop(refreshed, aliasMap, session.userId, emptyProgress()),
    });
  }
  return setTerminalStatus(env, session, id, 'declined', 'partner', true /* W695 — RL already burned above */);
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

/** Shared pending→terminal transition for decline/cancel. skipRl: the caller already
 *  burned the RL_COOP_WRITE token (W695 — decline rate-limits before its branch). */
async function setTerminalStatus(
  env: Env,
  session: SessionPayload,
  id: string,
  nextStatus: 'declined' | 'cancelled',
  who: 'partner' | 'challenger',
  skipRl?: boolean,
): Promise<Response> {
  if (!skipRl) {
    const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
    if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  }

  const row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  // W677/W692 — 'partner' means "an invited ally": ANY invited seat (participant row)
  // may decline, and one decline ends the whole summons (the challenger re-summons with
  // someone else — a half-party must never silently become a smaller hunt than was
  // priced/goaled). Sourced from the participant table so raid seats 4/5 (which have no
  // legacy partner column) can decline too.
  const allowed = who === 'partner'
    ? (row.participants ?? []).some((pt) => pt.user_id === session.userId)
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
  // W686 — a steps_sleep raid defers its DEFEAT verdict by the sleep grace: the
  // final night's (window-clamped) minutes arrive only after wake + HealthKit
  // sync. A WIN still lands the moment the goal is met; only expiry waits.
  const expiryGraceMs = bossMetric(row.boss_id) === 'steps_sleep' ? SLEEP_SUBMIT_GRACE_MS : 0;
  const expired = Number.isFinite(endsMs) && Date.now() >= endsMs + expiryGraceMs;

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
          title: 'Hunt Complete', body: `You and ${others} brought down your ${row.boss_rank}-rank quarry.`, type: 'coop_complete', data,
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

// ── W694 — Raid-finder MATCHMAKING (the members raid) ───────────────────────
// A member who can't field a full party queues here; a matchmaking pass forms queued
// seekers into a party and spins up a LIVE (active) hunt with them all auto-joined
// (queuing IS the consent to start). Rides the W692 participant model.
//
// Liveness model. The TTL runs on the last_seen_at HEARTBEAT (COALESCE to created_at),
// NOT on created_at alone (which is the FIFO position).
//
// W702 — the queue is now PERSISTENT / ASYNC: a member queues, LEAVES the screen (even
// closes the app), and is paired in the BACKGROUND — either instantly by the next
// member's join, or by the matchmaking cron (runRaidMatchmakeSweep). Every formed raid
// pushes its hunters via notifyHuntLive, so a walk-away member is told the moment their
// raid goes live and nothing is ever matched silently. The TTL is therefore a long "still
// up for this?" horizon (24h), not the old 90s babysit timer — W694's short heartbeat-TTL
// deliberately aged out anyone off the lobby screen, which the auto-start push makes moot.
// The client no longer needs to heartbeat to hold its spot; a still-open lobby that keeps
// polling simply refreshes last_seen_at and rides the same 24h window.
const RAID_QUEUE_TTL_SEC = 24 * 3600;
// The heartbeat-TTL WHERE fragment (?T binds RAID_QUEUE_TTL_SEC). COALESCE tolerates a
// pre-heartbeat row shape.
const RAID_QUEUE_FRESH_SQL = `(strftime('%s','now') - strftime('%s', COALESCE(q.last_seen_at, q.created_at))) < ?T`;
const RANK_ORDER: Record<string, number> = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5, 'S+': 6 };

// Re-queue claimed seekers, PRESERVING their original created_at (FIFO position — the
// review's fairness finding: a raced-out hunter must not drop to the back of the line).
// last_seen_at defaults fresh so they don't instantly age out.
async function requeueSeekers(env: Env, bossId: string, rows: { user_id: string; created_at?: string | null }[]): Promise<void> {
  if (!rows.length) return;
  await env.DB.batch(
    rows.map((r) =>
      env.DB
        .prepare('INSERT OR IGNORE INTO raid_queue (user_id, boss_id, created_at) VALUES (?, ?, COALESCE(?, CURRENT_TIMESTAMP))')
        .bind(r.user_id, bossId, r.created_at ?? null),
    ),
  );
}

// Create a LIVE hunt from a set of matchmade hunters (challenger = first, rest are
// auto-joined participants). starts/ends stamped now; legacy partner columns dual-written.
async function formRaidInstance(
  env: Env,
  bossId: string,
  hunterIds: string[],
  ctx?: ExecutionContext,
): Promise<CoopBossRow | null> {
  const cfg = COOP_BOSS_CFG[bossId];
  if (!cfg || hunterIds.length < 2) return null;
  const id = crypto.randomUUID();
  const challenger = hunterIds[0];
  const allies = hunterIds.slice(1);
  const nowMs = Date.now();
  const startsAt = new Date(nowMs).toISOString();
  const endsAt = new Date(nowMs + cfg.windowHours * 3600 * 1000).toISOString();
  const stmts = [
    env.DB
      .prepare(
        `INSERT INTO coop_boss_instances
           (id, boss_id, boss_rank, challenger_user_id, partner_user_id, partner2_user_id,
            partner_joined_at, partner2_joined_at, goal_steps, goal_flights, reward_souls,
            status, starts_at, ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .bind(
        id, bossId, cfg.rank, challenger, allies[0] ?? null, allies[1] ?? null,
        allies[0] ? startsAt : null, allies[1] ? startsAt : null,
        cfg.goalSteps, cfg.goalFlights ?? null, cfg.rewardSouls, startsAt, endsAt,
      ),
  ];
  for (const ally of allies) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
             SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1)`,
        )
        .bind(id, ally, startsAt),
    );
  }
  await env.DB.batch(stmts);
  const row = await loadInstance(env, id);
  if (row && ctx) {
    for (const uid of hunterIds) {
      ctx.waitUntil(
        notifyUser(env, uid, {
          title: 'Party Found',
          body: 'Your raid party is assembled — the hunt is on.',
          type: 'coop_joined',
          data: { bossId },
        }),
      );
    }
  }
  return row;
}

// W695 — a solo-only pool holds out for a FULL party this long before settling for a
// smaller one (owner: "fill toward 5"). Open party-hunts are unaffected (their leader
// decides via START NOW).
const RAID_SOLO_PATIENCE_SEC = 180;

// W695 — a READY open ("Summon & Fill") hunt: pending, fill_target set, every invited
// friend answered, seats still open. Oldest first (FIFO across hunts too).
interface OpenHunt { id: string; challenger_user_id: string; created_at: string; size: number; fill_target: number }
async function loadReadyOpenHunts(env: Env, bossId: string): Promise<OpenHunt[]> {
  const rows = await env.DB
    .prepare(
      `SELECT i.id, i.challenger_user_id, i.created_at, i.fill_target,
              (SELECT COUNT(*) + 1 FROM coop_boss_participants p WHERE p.instance_id = i.id) AS size
         FROM coop_boss_instances i
        WHERE i.boss_id = ?1 AND i.status = 'pending' AND i.fill_target IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM coop_boss_participants p2 WHERE p2.instance_id = i.id AND p2.joined_at IS NULL)
          AND (SELECT COUNT(*) + 1 FROM coop_boss_participants p3 WHERE p3.instance_id = i.id) < i.fill_target
        ORDER BY i.created_at`,
    )
    .bind(bossId)
    .all<OpenHunt>();
  return rows.results ?? [];
}

// Activate an open hunt IFF it reached its fill target (guarded — races safely with a
// leader /start or a second matchmaking pass). Returns true when THIS call activated.
async function activateIfFull(env: Env, huntId: string, windowHours: number): Promise<boolean> {
  const nowMs = Date.now();
  const startsAt = new Date(nowMs).toISOString();
  const endsAt = new Date(nowMs + windowHours * 3600 * 1000).toISOString();
  const upd = await env.DB
    .prepare(
      `UPDATE coop_boss_instances
          SET status = 'active', starts_at = ?, ends_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending' AND fill_target IS NOT NULL
          AND (SELECT COUNT(*) + 1 FROM coop_boss_participants WHERE instance_id = ?) >= fill_target`,
    )
    .bind(startsAt, endsAt, huntId, huntId)
    .run();
  return Number(upd?.meta?.changes ?? 0) > 0;
}

// Push "the hunt is on" to every hunter on a just-activated instance.
async function notifyHuntLive(env: Env, huntId: string, bossId: string, ctx?: ExecutionContext): Promise<void> {
  if (!ctx) return;
  const row = await loadInstance(env, huntId);
  if (!row || row.status !== 'active') return;
  for (const uid of participantIds(row)) {
    ctx.waitUntil(
      notifyUser(env, uid, {
        title: 'The Raid Begins',
        body: 'Your party is assembled — the hunt is on.',
        type: 'coop_joined',
        data: { bossId },
      }),
    );
  }
}

// W695 — merge open hunt B (younger) into open hunt A (older). ONE atomic env.DB.batch
// (a single D1 transaction — W695 review: a separate cancel-then-copy stranded B's
// party when A left 'pending' in the gap):
//   stmt 1 cancels B, guarded on B pending + A pending + the COMBINED size fitting A's
//          fill_target (capacity is checked atomically, not from a snapshot), stamping
//          result='merged' so a raced leader-cancel (no marker) is distinguishable;
//   stmts 2-3 copy B's roster + leader into A, guarded on B carrying the 'merged'
//          marker — inside the same transaction they run IFF stmt 1 applied.
// If stmt 1 lost (0 changes), NOTHING happened — B stands untouched. bossId is the
// BOSS id for the push deep-link (review: b.id broke it).
async function mergeOpenHunts(env: Env, bossId: string, a: OpenHunt, b: OpenHunt, ctx?: ExecutionContext): Promise<boolean> {
  const res = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE coop_boss_instances
            SET status = 'cancelled', result = 'merged', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1 AND status = 'pending' AND fill_target IS NOT NULL
            AND EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?2 AND status = 'pending' AND fill_target IS NOT NULL)
            AND ( (SELECT COUNT(*) + 1 FROM coop_boss_participants WHERE instance_id = ?2)
                + (SELECT COUNT(*) + 1 FROM coop_boss_participants WHERE instance_id = ?1) )
                <= (SELECT fill_target FROM coop_boss_instances WHERE id = ?2)`,
      )
      .bind(b.id, a.id),
    // B's answered allies … (never A's own challenger — belt-and-suspenders vs overlap)
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
           SELECT ?1, user_id, CURRENT_TIMESTAMP FROM coop_boss_participants
            WHERE instance_id = ?2
              AND user_id <> (SELECT challenger_user_id FROM coop_boss_instances WHERE id = ?1)
              AND EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?2 AND status = 'cancelled' AND result = 'merged')`,
      )
      .bind(a.id, b.id),
    // … and B's leader all become answered participants of A.
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
           SELECT ?1, ?2, CURRENT_TIMESTAMP
            WHERE EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?3 AND status = 'cancelled' AND result = 'merged')`,
      )
      .bind(a.id, b.challenger_user_id, b.id),
  ]);
  if (!(Number(res[0]?.meta?.changes ?? 0) > 0)) return false;   // raced a start/cancel/fill — B stands
  if (ctx) {
    const merged = await loadInstance(env, b.id);
    const names = merged ? participantIds(merged) : [b.challenger_user_id];
    for (const uid of names) {
      ctx.waitUntil(
        notifyUser(env, uid, {
          title: 'Parties United',
          body: 'Your party joined forces with another — the raid fills.',
          type: 'coop_joined',
          data: { bossId },
        }),
      );
    }
  }
  return true;
}

// Try to fill/form parties for a boss. Order of operations (each step FIFO-fair):
//   1. MERGE ready open party-hunts (3+2, 2+2 …) — the owner's "party matchmakes with
//      another party" case; the older hunt absorbs the younger.
//   2. POUR fresh solo seekers into the oldest ready open hunt's seats.
//   3. SOLO POOL — form a party from the remaining solos: a FULL party immediately, a
//      smaller one only after the oldest solo has waited out RAID_SOLO_PATIENCE_SEC.
// Any step that fills a hunt to target activates it. Returns the instance the CALLER
// ended up on (join tick checks membership), else null. Concurrency-safe: the solo
// claim is DELETE … RETURNING; hunt mutations are guarded UPDATEs.
async function matchmakeRaid(env: Env, bossId: string, ctx?: ExecutionContext): Promise<CoopBossRow | null> {
  const cfg = COOP_BOSS_CFG[bossId];
  if (!cfg) return null;
  const minParty = cfg.minParty ?? cfg.partySize ?? 2;
  const maxParty = cfg.maxParty ?? cfg.partySize ?? 2;

  // ── 1. Merge ready open hunts (greedy, oldest absorbs the largest that fits) ──
  let openHunts = await loadReadyOpenHunts(env, bossId);
  let mergedAny = false;
  // W695 review — members-only re-check for the ABSORBED party too: a roster with a
  // lapsed membership is skipped (left standing, never copied into the members raid).
  const rosterAllMembers = async (huntId: string, leaderId: string): Promise<boolean> => {
    if (!cfg.memberOnly) return true;
    const row = await loadInstance(env, huntId);
    const ids = row ? participantIds(row) : [leaderId];
    for (const uid of ids) {
      const { member } = await readEntitlements(env, uid);
      if (!member) return false;
    }
    return true;
  };
  for (let i = 0; i < openHunts.length; i++) {
    const a = openHunts[i];
    if (!a || a.size >= a.fill_target) continue;
    // largest younger partner that fits A's open seats
    let bestJ = -1;
    for (let j = i + 1; j < openHunts.length; j++) {
      const b = openHunts[j];
      if (!b) continue;
      if (a.size + b.size <= a.fill_target && (bestJ === -1 || b.size > (openHunts[bestJ] as OpenHunt).size)) bestJ = j;
    }
    if (bestJ !== -1) {
      const b = openHunts[bestJ] as OpenHunt;
      if (!(await rosterAllMembers(b.id, b.challenger_user_id))) { openHunts[bestJ] = null as unknown as OpenHunt; continue; }
      if (await mergeOpenHunts(env, bossId, a, b, ctx)) {
        a.size += b.size;
        openHunts[bestJ] = null as unknown as OpenHunt;
        mergedAny = true;
        if (await activateIfFull(env, a.id, cfg.windowHours)) await notifyHuntLive(env, a.id, bossId, ctx);
      }
    }
  }
  if (mergedAny) openHunts = await loadReadyOpenHunts(env, bossId);

  // ── Fresh, eligible solo seekers (oldest first, with their wait age) ──
  const avail = await env.DB
    .prepare(
      `SELECT q.user_id, q.created_at,
              (strftime('%s','now') - strftime('%s', q.created_at)) AS waited_sec
         FROM raid_queue q
        WHERE q.boss_id = ?1
          AND ${RAID_QUEUE_FRESH_SQL.replace('?T', '?2')}
          AND NOT EXISTS (
            SELECT 1 FROM coop_boss_instances i
             WHERE i.boss_id = ?1 AND i.status IN ('pending','active')
               AND ( i.challenger_user_id = q.user_id
                     OR EXISTS (SELECT 1 FROM coop_boss_participants p WHERE p.instance_id = i.id AND p.user_id = q.user_id) )
          )
        ORDER BY q.created_at`,
    )
    .bind(bossId, RAID_QUEUE_TTL_SEC)
    .all<{ user_id: string; created_at: string; waited_sec: number }>();
  let seekers = (avail.results ?? []).map((r) => ({ user_id: r.user_id, created_at: r.created_at, waited_sec: Number(r.waited_sec) }));

  if (!seekers.length && !openHunts.length) return null;

  // W694 review (HIGH) — members-only re-check at FORM time, not just enqueue time: a
  // membership that lapsed/refunded while queued must not ride into the members raid
  // (mirrors the create-path per-ally check + the join-path re-check). Lapsed seekers
  // are dropped from the queue outright — their next poll re-gates them with the 403.
  if (cfg.memberOnly && seekers.length) {
    const kept: typeof seekers = [];
    const lapsed: string[] = [];
    for (const s of seekers.slice(0, maxParty + 2)) {
      const { member } = await readEntitlements(env, s.user_id);
      if (member) kept.push(s);
      else lapsed.push(s.user_id);
      if (kept.length >= maxParty) break;
    }
    if (lapsed.length) {
      await env.DB.batch(
        lapsed.map((uid) => env.DB.prepare('DELETE FROM raid_queue WHERE user_id = ?').bind(uid)),
      );
    }
    seekers = kept;
  }

  // Claim solos WITH created_at so any re-queue preserves FIFO, then re-verify in-hunt
  // (W694 review MEDIUM: the avail read is a snapshot — never double-book a hunter who
  // got hand-summoned between the read and the claim; busy claims are simply dropped).
  const claimSolos = async (want: number): Promise<{ user_id: string; created_at: string | null }[]> => {
    const pick = seekers.slice(0, want);
    if (!pick.length) return [];
    seekers = seekers.slice(pick.length);
    const ph = pick.map(() => '?').join(', ');
    const claimed = await env.DB
      .prepare(`DELETE FROM raid_queue WHERE boss_id = ? AND user_id IN (${ph}) RETURNING user_id, created_at`)
      .bind(bossId, ...pick.map((s) => s.user_id))
      .all<{ user_id: string; created_at: string | null }>();
    const free: { user_id: string; created_at: string | null }[] = [];
    for (const r of claimed.results ?? []) {
      const inHunt = await env.DB
        .prepare(
          `SELECT 1 FROM coop_boss_instances i WHERE i.boss_id = ?1 AND i.status IN ('pending','active')
             AND ( i.challenger_user_id = ?2 OR EXISTS (SELECT 1 FROM coop_boss_participants p WHERE p.instance_id = i.id AND p.user_id = ?2) )
           LIMIT 1`,
        )
        .bind(bossId, r.user_id)
        .first();
      if (!inHunt) free.push(r);
    }
    return free;
  };

  // ── 2. POUR solos into the oldest ready open hunts' seats ──
  for (const hunt of openHunts) {
    if (!hunt || !seekers.length) break;
    const openSeats = hunt.fill_target - hunt.size;
    if (openSeats <= 0) continue;
    const poured = await claimSolos(openSeats);
    if (!poured.length) continue;
    const landed: typeof poured = [];
    for (const s of poured) {
      // Guarded on the hunt still being a pending open hunt AND on live capacity —
      // the COUNT predicate is evaluated inside this single statement, so concurrent
      // passes can never over-fill past fill_target (W695 review: the in-memory
      // hunt.size snapshot alone allowed a 7-hunter 5-cap raid). A lost race
      // re-queues the solo below.
      const ins = await env.DB
        .prepare(
          `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
             SELECT ?1, ?2, CURRENT_TIMESTAMP
              WHERE EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1 AND status = 'pending' AND fill_target IS NOT NULL)
                AND (SELECT COUNT(*) + 1 FROM coop_boss_participants WHERE instance_id = ?1)
                    < (SELECT fill_target FROM coop_boss_instances WHERE id = ?1)`,
        )
        .bind(hunt.id, s.user_id)
        .run();
      if (Number(ins?.meta?.changes ?? 0) > 0) {
        landed.push(s);
        hunt.size++;
        if (ctx) {
          ctx.waitUntil(
            notifyUser(env, s.user_id, {
              title: 'Party Found',
              body: 'You joined a forming raid party.',
              type: 'coop_joined',
              data: { bossId },
            }),
          );
          ctx.waitUntil(
            notifyUser(env, hunt.challenger_user_id, {
              title: 'A Hunter Answers',
              body: 'The raid finder filled a seat in your party.',
              type: 'coop_joined',
              data: { bossId },
            }),
          );
        }
      } else {
        await requeueSeekers(env, bossId, [s]);   // hunt closed mid-pour — keep them seeking
      }
    }
    if (landed.length && (await activateIfFull(env, hunt.id, cfg.windowHours))) {
      await notifyHuntLive(env, hunt.id, bossId, ctx);
    }
  }

  // ── 3. SOLO POOL — form a party from the remaining solos ──
  // A FULL party forms immediately; a smaller one only once the oldest solo has waited
  // out the patience window ("fill toward 5" — don't lock two hunters into a brutal
  // sub-party in the first minute when three more might be seconds away).
  if (seekers.length >= minParty) {
    const oldestWaited = seekers[0] ? seekers[0].waited_sec : 0;
    if (seekers.length >= maxParty || oldestWaited >= RAID_SOLO_PATIENCE_SEC) {
      const free = await claimSolos(Math.min(seekers.length, maxParty));
      if (free.length < minParty) {
        await requeueSeekers(env, bossId, free);   // raced below the minimum — keep seeking
      } else {
        // W694 review (LOW) — the claim auto-committed; a transient form failure must
        // re-queue the claimed hunters, not silently drop them.
        try {
          return await formRaidInstance(env, bossId, free.map((r) => r.user_id), ctx);
        } catch (e) {
          await requeueSeekers(env, bossId, free);
          throw e;
        }
      }
    }
  }
  return null;
}

// ── W702 — background matchmaking SWEEP (cron-driven) ───────────────────────
// The async half of the raid finder. With the queue now PERSISTENT (24h TTL), two members
// can queue minutes apart, both close the app, and still need pairing once the oldest
// clears RAID_SOLO_PATIENCE_SEC — but with nobody polling, nothing triggers matchmakeRaid.
// This sweep runs it for every matchmaking boss on a short cron (see scheduled() in
// index.ts), draining the queue into parties (and merging under-full open parties) with no
// client watching. Every party it forms pushes its hunters via notifyHuntLive (inside
// matchmakeRaid → formRaidInstance), so a walk-away member is told the instant their raid
// goes live. Idempotent + bounded; never throws (a cron must not crash on one bad boss).
// ── W747 — battle emotes (ClaudeDesign handoff 24) ──────────────────────────
// The redesigned hunt screen has three canned battle cries (Rally / Push on /
// Finish it). ENUM-ONLY by design: the client sends a key, the SERVER owns the
// display text, so there is no free-text abuse surface at all. Delivery is an
// APNs push to every OTHER participant (the app may be closed mid-hunt); the
// sender sees a local fly-in. Rate limit: the shared RL_COOP_WRITE bucket
// (20/min) PLUS the client's own 30s cooldown per button.
const COOP_EMOTES: Record<string, string> = {
  rally: 'Rally to me',
  push: 'Push on',
  finish: 'Finish it',
  // W802 — three more canned cries (owner request). Same enum-only contract.
  update: 'Update your app',
  gg: 'Good game',
  luck: 'Good luck',
};
// W750 — one battle cry per hour per user (all keys share the budget). W802:
// owner relaxed the original 4h window to 1h alongside the new cries.
// Server-authoritative via coop_emote_cooldowns (0042); the client mirrors it
// with greyed buttons but is never the enforcement.
export const COOP_EMOTE_COOLDOWN_MS = 60 * 60 * 1000;

export async function handleCoopBossEmote(
  request: Request,
  env: Env,
  session: SessionPayload,
  ctx?: ExecutionContext,
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  let body: { instanceId?: unknown; emote?: unknown };
  try {
    body = (await request.json()) as { instanceId?: unknown; emote?: unknown };
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const instanceId = typeof body.instanceId === 'string' ? body.instanceId : '';
  const emoteKey = typeof body.emote === 'string' ? body.emote : '';
  const text = COOP_EMOTES[emoteKey];
  if (!instanceId || !text) {
    return jsonError(400, 'INVALID_EMOTE', 'instanceId and a known emote key are required.');
  }

  const inst = await loadInstance(env, instanceId);
  if (!inst) return jsonError(404, 'NOT_FOUND', 'No such hunt.');
  if (inst.status !== 'active') {
    return jsonError(409, 'NOT_ACTIVE', 'That hunt is not live.');
  }
  const ids = participantIds(inst);
  if (!ids.includes(session.userId)) {
    // Same authz posture as every other instance route: you can only act on a
    // hunt you are IN (no spectator shouting into someone else's raid).
    return jsonError(403, 'NOT_IN_HUNT', 'You are not part of this hunt.');
  }

  // W750 — one battle cry per 4h per user (shared across all keys + all hunts).
  // Checked server-side so a modded client can't spam pushes at a party. The
  // 429 carries retry_after_ms so the client can mirror the true remaining time.
  const now = Date.now();
  const cool = await env.DB.prepare('SELECT sent_at FROM coop_emote_cooldowns WHERE user_id = ?')
    .bind(session.userId)
    .first<{ sent_at: number | null }>();
  const lastAt = Number(cool?.sent_at ?? 0);
  if (lastAt && now - lastAt < COOP_EMOTE_COOLDOWN_MS) {
    return jsonError(429, 'EMOTE_COOLDOWN', 'Your next battle cry is not ready yet.', {
      retry_after_ms: COOP_EMOTE_COOLDOWN_MS - (now - lastAt),
    });
  }
  await env.DB.prepare(
    'INSERT INTO coop_emote_cooldowns (user_id, sent_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET sent_at = excluded.sent_at',
  )
    .bind(session.userId, now)
    .run();

  // W801 — persist the cry so every partner's battle log can show it (the push
  // alone evaporated; owner: "popped up on push but not in the message center").
  // ISO timestamp (not CURRENT_TIMESTAMP) — iOS Safari can't Date.parse SQLite's
  // space-separated datetime. Tail-pruned per instance so the table stays tiny.
  await env.DB.prepare('INSERT INTO coop_emotes (instance_id, user_id, emote, created_at) VALUES (?, ?, ?, ?)')
    .bind(instanceId, session.userId, emoteKey, new Date(now).toISOString())
    .run();
  await env.DB.prepare(
    'DELETE FROM coop_emotes WHERE instance_id = ? AND id NOT IN (SELECT id FROM coop_emotes WHERE instance_id = ? ORDER BY id DESC LIMIT 12)',
  )
    .bind(instanceId, instanceId)
    .run();

  if (ctx) {
    for (const uid of ids) {
      if (uid === session.userId) continue;
      ctx.waitUntil(
        notifyUser(env, uid, {
          title: 'Battle Cry',
          body: `${session.alias}: 「${text}」`,
          type: 'coop_emote',
          data: { bossId: inst.boss_id },
        }),
      );
    }
  }
  return jsonOk({ ok: true });
}

export async function runRaidMatchmakeSweep(env: Env, ctx?: ExecutionContext): Promise<number> {
  let formed = 0;
  for (const bossId of Object.keys(COOP_BOSS_CFG)) {
    if (!COOP_BOSS_CFG[bossId].matchmaking) continue;
    // Bounded drain: at most a few parties per boss per tick (the member pool is tiny; the
    // cap also guards against a non-progressing matchmakeRaid looping).
    for (let i = 0; i < 5; i++) {
      let inst: CoopBossRow | null = null;
      try {
        inst = await matchmakeRaid(env, bossId, ctx);
      } catch (e) {
        console.error('[raid-sweep] matchmake failed', bossId, e instanceof Error ? e.message : String(e));
        break;
      }
      if (!inst) break;
      formed++;
    }
  }
  return formed;
}

// ── POST /v1/raid-queue — enter the raid finder (idempotent; also the poll tick) ──
export async function handleRaidQueueJoin(
  request: Request,
  env: Env,
  session: SessionPayload,
  ctx?: ExecutionContext,
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  let body: { boss_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const bossId = typeof body.boss_id === 'string' ? body.boss_id : '';
  const cfg = COOP_BOSS_CFG[bossId];
  if (!cfg) return jsonError(400, 'UNKNOWN_BOSS', 'Unknown co-op boss id.');
  if (!cfg.matchmaking) return jsonError(400, 'NO_MATCHMAKING', 'This hunt has no raid finder.');

  // Members-only + rank gates (mirror the summon path so a matchmade party is as
  // eligible as a hand-picked one — every seeker cleared these when they queued).
  if (cfg.memberOnly) {
    const { member } = await readEntitlements(env, session.userId);
    if (!member) return jsonError(403, 'MEMBERS_ONLY', 'The Grinning God answers only to members.');
  }
  const prof = await env.DB.prepare('SELECT rank_tier FROM public_profile_summary WHERE user_id = ?')
    .bind(session.userId)
    .first<{ rank_tier: string }>();
  // W699 — members raid: no rank gate on the finder either (membership checked above).
  if (!cfg.memberOnly && (RANK_ORDER[prof?.rank_tier ?? 'E'] ?? 0) < (RANK_ORDER[cfg.rank] ?? 0)) {
    return jsonError(403, 'INSUFFICIENT_RANK', `You must reach ${cfg.rank} rank to join this raid.`);
  }
  // Already on a live hunt for this boss → nothing to queue (avoid double-committing).
  const inHunt = await env.DB
    .prepare(
      `SELECT 1 FROM coop_boss_instances i WHERE i.boss_id = ?1 AND i.status IN ('pending','active')
         AND ( i.challenger_user_id = ?2 OR EXISTS (SELECT 1 FROM coop_boss_participants p WHERE p.instance_id = i.id AND p.user_id = ?2) )
       LIMIT 1`,
    )
    .bind(bossId, session.userId)
    .first();
  if (inHunt) return jsonError(409, 'ALREADY_ACTIVE', 'You are already on a hunt for this boss.');

  // Enqueue (idempotent poll tick): keep the original created_at (FIFO position) but
  // REFRESH the last_seen_at heartbeat — the TTL runs on liveness, not queue age
  // (W694 review: a created_at TTL deadlocked any queue slower than 15min to fill).
  // Clear any stale queue row for a different boss first (one queue per hunter), and
  // reap aged rows (best-effort — bounds the table + keeps the waiting count honest).
  await env.DB.batch([
    env.DB.prepare('DELETE FROM raid_queue WHERE user_id = ? AND boss_id <> ?').bind(session.userId, bossId),
    env.DB
      .prepare(
        `INSERT INTO raid_queue (user_id, boss_id) VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`,
      )
      .bind(session.userId, bossId),
    env.DB
      .prepare(
        `DELETE FROM raid_queue
          WHERE (strftime('%s','now') - strftime('%s', COALESCE(last_seen_at, created_at))) >= ?`,
      )
      .bind(RAID_QUEUE_TTL_SEC),
  ]);

  const inst = await matchmakeRaid(env, bossId, ctx);
  if (inst && participantIds(inst).includes(session.userId)) {
    const aliasMap = await getAliasMap(env, participantIds(inst));
    return jsonOk({ ok: true, matched: true, instance: serializeCoop(inst, aliasMap, session.userId, emptyProgress()) });
  }
  // W695 — the POUR path may have landed the CALLER on an open party-hunt without
  // returning it (matchmakeRaid returns only a solo-pool instance). Detect it and
  // report the match, or the client's next tick would 409 into an error state.
  const mineNow = await env.DB
    .prepare(
      `SELECT i.id FROM coop_boss_instances i WHERE i.boss_id = ?1 AND i.status IN ('pending','active')
         AND ( i.challenger_user_id = ?2 OR EXISTS (SELECT 1 FROM coop_boss_participants p WHERE p.instance_id = i.id AND p.user_id = ?2) )
       LIMIT 1`,
    )
    .bind(bossId, session.userId)
    .first<{ id: string }>();
  if (mineNow) {
    const row = await loadInstance(env, mineNow.id);
    if (row) {
      const aliasMap = await getAliasMap(env, participantIds(row));
      return jsonOk({ ok: true, matched: true, instance: serializeCoop(row, aliasMap, session.userId, emptyProgress()) });
    }
  }
  // Waiting count = heartbeat-FRESH seekers only (an aged ghost row must not inflate
  // the lobby's "N searching" line into a promise matchmaking can't keep).
  const cnt = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM raid_queue q WHERE q.boss_id = ?1 AND ${RAID_QUEUE_FRESH_SQL.replace('?T', '?2')}`)
    .bind(bossId, RAID_QUEUE_TTL_SEC)
    .first<{ n: number }>();
  const minParty = cfg.minParty ?? cfg.partySize ?? 2;
  return jsonOk({ ok: true, matched: false, queued: true, waiting: cnt ? Number(cnt.n) : 1, need: minParty });
}

// ── DELETE /v1/raid-queue — leave the raid finder ──
export async function handleRaidQueueLeave(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  await env.DB.prepare('DELETE FROM raid_queue WHERE user_id = ?').bind(session.userId).run();
  return jsonOk({ ok: true });
}

// ── POST /v1/coop-boss/:id/start — leader starts an under-full OPEN hunt (W695) ──
// "Brutal below 5" is the leader's call: once every invited friend has answered and
// the party meets the boss minimum, the leader may start rather than keep filling.
export async function handleRaidStart(
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
  if (row.challenger_user_id !== session.userId) {
    return jsonError(403, 'FORBIDDEN', 'Only the party leader can start the hunt.');
  }
  if (row.status !== 'pending' || !row.fill_target) {
    return jsonError(400, 'BAD_STATE', 'Only a forming open hunt can be started.');
  }
  if ((row.participants ?? []).some((p) => !p.joined_at)) {
    return jsonError(400, 'NOT_READY', "Your invited allies haven't all answered yet.");
  }
  const cfg = COOP_BOSS_CFG[row.boss_id];
  const minParty = cfg ? (cfg.minParty ?? cfg.partySize ?? 2) : 2;
  const size = participantIds(row).length;
  if (size < minParty) {
    return jsonError(400, 'TOO_SMALL', `The hunt needs at least ${minParty} hunters to begin.`);
  }
  // W695 review — the leader's membership is re-verified at START (mirrors the join
  // path's re-check: a lapse between summon and start can't launch the members raid).
  if (cfg?.memberOnly) {
    const { member } = await readEntitlements(env, session.userId);
    if (!member) return jsonError(403, 'MEMBERS_ONLY', 'The Grinning God answers only to members.');
  }
  const windowHours = cfg ? cfg.windowHours : 24;
  const nowMs = Date.now();
  const startsAt = new Date(nowMs).toISOString();
  const endsAt = new Date(nowMs + windowHours * 3600 * 1000).toISOString();
  // W695 review — the size/answered checks above ran on a SNAPSHOT; re-assert them
  // INSIDE the activation UPDATE so a racing leave-seat can't start an under-minimum
  // hunt and a racing unanswered state can't start the clock early.
  const upd = await env.DB
    .prepare(
      `UPDATE coop_boss_instances
          SET status = 'active', starts_at = ?1, ends_at = ?2, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?3 AND status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?3 AND joined_at IS NULL)
          AND (SELECT COUNT(*) + 1 FROM coop_boss_participants WHERE instance_id = ?3) >= ?4`,
    )
    .bind(startsAt, endsAt, id, minParty)
    .run();
  const started = Number(upd?.meta?.changes ?? 0) > 0;
  if (started) await notifyHuntLive(env, id, row.boss_id, ctx);
  const refreshed = await loadInstance(env, id);
  if (!refreshed) return jsonError(500, 'INTERNAL', 'Failed to read back instance.');
  if (!started && refreshed.status === 'pending') {
    // The guarded UPDATE refused (a seat left / a seat unanswered mid-flight).
    return jsonError(400, 'NOT_READY', 'The party changed while starting — check the seats and try again.');
  }
  const aliasMap = await getAliasMap(env, participantIds(refreshed));
  return jsonOk({ ok: true, instance: serializeCoop(refreshed, aliasMap, session.userId, emptyProgress()) });
}

// ── POST /v1/coop-boss/:id/fill-tick — an open hunt's lobby poll (W695) ──
// Members of a FORMING open hunt poll this: it drives a matchmaking pass (so two open
// parties merge even when NO solos are queued — the parties themselves are the pulse)
// and returns the freshest view. If this hunt was ABSORBED into an older party, the
// successor hunt is found and returned so the member's client follows the merge.
export async function handleRaidFillTick(
  _request: Request,
  env: Env,
  session: SessionPayload,
  id: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');

  let row = await loadInstance(env, id);
  if (!row) return jsonError(404, 'NOT_FOUND', 'Co-op hunt not found.');
  if (!isParticipant(row, session.userId)) {
    return jsonError(403, 'FORBIDDEN', 'You are not part of this co-op hunt.');
  }
  if (row.status === 'pending' && row.fill_target) {
    await matchmakeRaid(env, row.boss_id, ctx);
    row = (await loadInstance(env, id)) ?? row;
  }
  // Absorbed into an older party? Follow the merge to the successor hunt.
  if (row.status === 'cancelled' && row.fill_target) {
    const successor = await env.DB
      .prepare(
        `SELECT i.id FROM coop_boss_instances i WHERE i.boss_id = ?1 AND i.status IN ('pending','active')
           AND ( i.challenger_user_id = ?2 OR EXISTS (SELECT 1 FROM coop_boss_participants p WHERE p.instance_id = i.id AND p.user_id = ?2) )
         LIMIT 1`,
      )
      .bind(row.boss_id, session.userId)
      .first<{ id: string }>();
    if (successor) {
      const next = await loadInstance(env, successor.id);
      if (next) {
        const aliasMap2 = await getAliasMap(env, participantIds(next));
        // W695 review — the successor may already be ACTIVE (merge filled it): serve
        // real progress, not zeroed bars.
        const nextProg = next.status === 'active' ? await getCoopProgress(env, next.id) : emptyProgress();
        return jsonOk({ ok: true, merged: true, instance: serializeCoop(next, aliasMap2, session.userId, nextProg) });
      }
    }
  }
  const aliasMap = await getAliasMap(env, participantIds(row));
  const prog = row.status === 'active' ? await getCoopProgress(env, row.id) : emptyProgress();
  return jsonOk({ ok: true, instance: serializeCoop(row, aliasMap, session.userId, prog) });
}

// ── GET /v1/raid-queue?boss_id= — am I queued + how many are waiting ──
export async function handleRaidQueueStatus(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const mine = await env.DB.prepare('SELECT boss_id FROM raid_queue WHERE user_id = ?')
    .bind(session.userId)
    .first<{ boss_id: string }>();
  const url = new URL(request.url);
  const bossId = url.searchParams.get('boss_id') || (mine ? mine.boss_id : '');
  let waiting = 0;
  if (bossId) {
    // Heartbeat-fresh seekers only (mirrors the join tick's honest count).
    const cnt = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM raid_queue q WHERE q.boss_id = ?1 AND ${RAID_QUEUE_FRESH_SQL.replace('?T', '?2')}`)
      .bind(bossId, RAID_QUEUE_TTL_SEC)
      .first<{ n: number }>();
    waiting = cnt ? Number(cnt.n) : 0;
  }
  return jsonOk({ ok: true, queued: !!mine, boss_id: mine ? mine.boss_id : null, waiting });
}
