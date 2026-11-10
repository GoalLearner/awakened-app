/**
 * coop-auto.ts — W1094 automatic friend hunts.
 *
 * Owner (2026-10-25): "Is there an easier way to do the friend's co-op dungeon to automate
 * that as well?" … "Being friends is enough" … "the two hunters [must be] capable of
 * completing a task together" … "The more passive this app can be, the more users will
 * enjoy it."
 *
 * Every Pacific day, every accepted friend pair gets ONE duo hunt, made here by the cron with
 * both seats already joined (friendship is the consent, the way queueing is the consent for
 * the raid finder). Nobody summons, nobody answers. The goal is sized to what the two of them
 * actually walk, so a strong walker carries a light one and the hunt is something they can
 * finish on a normal day:
 *
 *   pattern(hunter)  = (last completed PT week's steps + this week's so far)
 *                      ÷ (7 + days elapsed this week)            — from the weekly board
 *   pair pattern     = the sum
 *   boss             = the strongest steps-only duo boss both ranks allow whose printed goal
 *                      fits 0.9 × pair pattern (The Coursing Dread 18k, then The Twin Maw 14k);
 *                      if none fits, The Twin Maw with its goal sized to 0.9 × pair pattern
 *                      (nearest 100, floor 2,000). The instance row carries the goal, and
 *                      both isGoalMet and every client view read the row, not the catalog.
 *
 * A pair is skipped for the day when either side switched the other off (coop_auto_optouts,
 * '*' = everything off), when either blocked the other, when either has no steps on the
 * server in the last two weeks (no pattern — nothing is shown to the partner, W1091), or when
 * either hunter's last app open is on a build older than AUTO_HUNT_MIN_W (older clients would
 * play a defeat screen for every quiet day and stamp the flame before both hunters posted).
 *
 * The hunt runs from that day's Pacific midnight to the next, so the steps already walked
 * when a hunter first opens the app count. Progress arrives through the client's existing
 * _coopBackgroundSync; the settle sweep below decides win or loss for EVERY active hunt
 * (manual ones too — before W1094 a hunt nobody's phone resolved stayed 'active' for ever).
 *
 * W1164 — MATCHED PARTNERS. Owner (2026-11-07), on Orfhlaith and Sharr: "two active hunters
 * with no friends" is how the pairing should be. A hunter with NO accepted friend who killed a
 * boss on at least MATCH_MIN_KILL_DAYS of the last 7 days (active = "actually get some bosses
 * completed", owner 2026-11-07), joined before today, is on a build that carries the automatic
 * client, has steps on the server and has not switched automatic hunts off ('*') is paired with
 * another such hunter, and the pair gets the same sized daily hunt (auto = 1, matched = 1).
 * Pairing is by how often each shows up (kill days, then kills, then walking), so two committed
 * hunters meet and a hunter who drifts is paired with one who drifts — never a ghost on a
 * regular. The leftovers are re-paired each day. Making a friend ends matching for that hunter;
 * their friend hunts take over.
 *
 * W1179 (owner 2026-11-10: "match someone up with someone who doesn't have a friend to have a pact
 * with"): a matched pair forms a Pact Flame like friends do (coop-pacts.ts and pact-flame-risk.ts
 * no longer skip matched rows), and a pair stays together for as long as both stay eligible —
 * each hunter's latest partner in the last MATCH_KEEP_DAYS is kept — so the flame can grow.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { chunks } from '../lib/chunk';
import { MERGED_FOR_WEEK } from '../lib/week-board';
import { getAccoladeWeekStart, priorWeekStart } from '../lib/accolade-week';
import { ptDayKey, nextDay, prevDay, ptMidnightIso } from '../lib/pact-streak';
import {
  COOP_BOSS_CFG,
  emptyProgress,
  getAliasMap,
  getCoopProgressForInstances,
  loadParticipants,
  participantIds,
  resolveCoopInstance,
  type CoopBossRow,
  type CoopProgress,
} from './coop-boss';

/** The first client build whose co-op loop carries the W1094 guards (silent auto losses, the
 *  fee from the win, the flame stamped only once committed). Pairs where either hunter last
 *  opened an older build get no automatic hunt until they update.
 *  W1096 — raised from 1094: the iOS 27 hotfix (build 599, tag 3.0.16-w1096) ships WITHOUT the
 *  W1094 client, so the client half lands at w1097 or later. Never let a build number below the
 *  real client half through. */
export const AUTO_HUNT_MIN_W = 1097;
/** Steps-only 24h duo bosses, strongest first. Flights and sleep duos wait for a pattern the
 *  phones do not send yet. */
export const AUTO_BOSSES: readonly string[] = ['the_coursing_dread', 'the_twin_maw'];
export const AUTO_FIT = 0.9;
export const AUTO_MIN_GOAL = 2000;
export const AUTO_SIZED_BOSS = 'the_twin_maw';
const MAX_CREATE_PER_RUN = 40;
const MAX_RESOLVE_PER_RUN = 200;
/** W1164 — "active" for matching: a boss killed on at least this many of the last 7 days. */
export const MATCH_MIN_KILL_DAYS = 2;
const MATCH_WINDOW_MS = 7 * 86_400_000;
/** W1179 — how far back a hunter's latest matched partner is kept (was: this PT week only). */
export const MATCH_KEEP_DAYS = 14;
const RANK_ORDER: Record<string, number> = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5, 'S+': 6 };

/** "3.0.16-w1094" → 1094; anything else → 0. */
export function buildW(build: string | null | undefined): number {
  const m = /-w(\d+)/i.exec(String(build || ''));
  return m ? Number(m[1]) || 0 : 0;
}

/** A hunter's daily steps pattern from the board's weekly totals; null when the server has
 *  no steps for them in either week (no pattern → no automatic hunts). */
export function dailyPattern(lastWeek: number, thisWeek: number, elapsedDays: number): number | null {
  const last = Math.max(0, Number(lastWeek) || 0);
  const cur = Math.max(0, Number(thisWeek) || 0);
  if (last <= 0 && cur <= 0) return null;
  const days = 7 + Math.min(7, Math.max(1, Math.floor(Number(elapsedDays) || 1)));
  return (last + cur) / days;
}

/** Days elapsed in the PT week that starts on `weekStart`, as of `dayKey` (1 on Sunday, 7 on
 *  Saturday). Pure date math on date-only keys, so it is DST-safe. */
export function elapsedDaysPt(weekStart: string, dayKey: string): number {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart || '');
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey || '');
  if (!a || !b) return 7;
  const diff = Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86_400_000);
  return Math.min(7, Math.max(1, diff + 1));
}

export function pairKey(a: string, b: string): string {
  return a < b ? a + '|' + b : b + '|' + a;
}

/** The boss and goal for a pair: the strongest boss both ranks allow whose printed goal fits
 *  the pair's pattern, else The Twin Maw sized to the pair. */
export function pickAutoBoss(rankA: string, rankB: string, pairPattern: number): { bossId: string; goalSteps: number } {
  const r = Math.min(RANK_ORDER[rankA] ?? 0, RANK_ORDER[rankB] ?? 0);
  const fit = AUTO_FIT * Math.max(0, Number(pairPattern) || 0);
  for (const bossId of AUTO_BOSSES) {
    const cfg = COOP_BOSS_CFG[bossId];
    if (!cfg || (RANK_ORDER[cfg.rank] ?? 0) > r) continue;
    if (cfg.goalSteps <= fit) return { bossId, goalSteps: cfg.goalSteps };
  }
  const sized = Math.max(AUTO_MIN_GOAL, Math.round(fit / 100) * 100);
  return { bossId: AUTO_SIZED_BOSS, goalSteps: sized };
}

/** W1164 — one hunter in the matching pool. */
export interface MatchCandidate { id: string; killDays: number; kills: number; pattern: number }

/** W1164 — the day's matched pairs. Pairs kept from earlier this PT week come first (both still
 *  in the pool, not blocked); a hunter already in a matched hunt today is never given a second;
 *  the rest are paired in order of how often they show up (kill days, kills, walking, then id
 *  so the result is deterministic), skipping a partner either side blocked or switched off.
 *  An odd hunter out waits for tomorrow. Pure: the sweep supplies the pool and the history. */
export function pickMatchedPairs(
  pool: MatchCandidate[],
  keep: Array<[string, string]>,
  busyToday: Set<string>,
  isBlocked: (a: string, b: string) => boolean,
): Array<[string, string]> {
  const inPool = new Set(pool.map((c) => c.id));
  const used = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const [a, b] of keep) {
    if (a === b || !inPool.has(a) || !inPool.has(b) || used.has(a) || used.has(b) || isBlocked(a, b)) continue;
    out.push(a < b ? [a, b] : [b, a]);
    used.add(a); used.add(b);
  }
  for (const id of busyToday) used.add(id);
  const rest = pool
    .filter((c) => !used.has(c.id))
    .sort((x, y) => (y.killDays - x.killDays) || (y.kills - x.kills) || (y.pattern - x.pattern) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  while (rest.length >= 2) {
    const a = rest.shift()!;
    const j = rest.findIndex((b) => !isBlocked(a.id, b.id));
    if (j < 0) continue;
    const b = rest.splice(j, 1)[0];
    out.push(a.id < b.id ? [a.id, b.id] : [b.id, a.id]);
  }
  return out;
}

// ── data the sweep reads (each a small table at this fleet's size) ──────────

async function stepsByUser(env: Env, weekKey: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await env.DB.prepare(`${MERGED_FOR_WEEK} SELECT user_id, steps FROM merged`)
    .bind(weekKey)
    .all<{ user_id: string; steps: number }>();
  for (const r of rows.results ?? []) out.set(r.user_id, Math.max(out.get(r.user_id) ?? 0, Number(r.steps) || 0));
  return out;
}

async function latestBuildByUser(env: Env): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rows = await env.DB.prepare(
    `SELECT a.user_id, a.build FROM app_opens a
      WHERE a.opened_at = (SELECT MAX(b.opened_at) FROM app_opens b WHERE b.user_id = a.user_id)`,
  ).all<{ user_id: string; build: string | null }>();
  for (const r of rows.results ?? []) out.set(r.user_id, r.build ?? '');
  return out;
}

async function rankByUser(env: Env): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rows = await env.DB.prepare('SELECT user_id, rank_tier FROM public_profile_summary').all<{ user_id: string; rank_tier: string | null }>();
  for (const r of rows.results ?? []) out.set(r.user_id, r.rank_tier || 'E');
  return out;
}

async function optOutSet(env: Env): Promise<Set<string>> {
  const out = new Set<string>();
  const rows = await env.DB.prepare('SELECT user_id, friend_user_id FROM coop_auto_optouts').all<{ user_id: string; friend_user_id: string }>();
  for (const r of rows.results ?? []) out.add(r.user_id + '>' + r.friend_user_id);
  return out;
}

async function blockSet(env: Env): Promise<Set<string>> {
  const out = new Set<string>();
  const rows = await env.DB.prepare('SELECT blocker_id, blocked_id FROM board_blocks').all<{ blocker_id: string; blocked_id: string }>();
  for (const r of rows.results ?? []) out.add(pairKey(r.blocker_id, r.blocked_id));
  return out;
}

/** One automatic hunt row, both seats joined, idempotent on (pair_key, hunt_day) through the
 *  partial unique index (INSERT OR IGNORE; the participant row is guarded on the instance
 *  existing, so a second tick writes nothing). True when this call created the row. */
export async function createAutoHunt(
  env: Env,
  a: string,
  b: string,
  dayKey: string,
  pick: { bossId: string; goalSteps: number },
  matched = false,   // W1164 — a pair of friendless hunters the cron matched, not friends
): Promise<boolean> {
  const cfg = COOP_BOSS_CFG[pick.bossId];
  if (!cfg) return false;
  const [challenger, partner] = a < b ? [a, b] : [b, a];
  const id = crypto.randomUUID();
  const startsAt = ptMidnightIso(dayKey);
  const endsAt = ptMidnightIso(nextDay(dayKey));
  if (!startsAt || !endsAt) return false;
  const res = await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO coop_boss_instances
           (id, boss_id, boss_rank, challenger_user_id, partner_user_id, partner2_user_id,
            partner_joined_at, partner2_joined_at, goal_steps, goal_flights, reward_souls,
            status, starts_at, ends_at, auto, hunt_day, pair_key, matched)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, ?, 'active', ?, ?, 1, ?, ?, ?)`,
      )
      .bind(id, pick.bossId, cfg.rank, challenger, partner, startsAt, pick.goalSteps, cfg.rewardSouls, startsAt, endsAt, dayKey, pairKey(a, b), matched ? 1 : 0),
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
           SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1)`,
      )
      .bind(id, partner, startsAt),
  ]);
  return Number(res[0]?.meta?.changes ?? 0) > 0;
}

/** Cron, every 2 minutes: today's hunt for every walking friend pair that has none yet, then
 *  (W1164) today's hunt for every matched pair of active hunters who have no friends. */
export async function sweepCoopAutoHunts(env: Env, _ctx?: ExecutionContext): Promise<{ created: number; pairs: number; skipped: number; matched: number }> {
  const out = { created: 0, pairs: 0, skipped: 0, matched: 0 };
  try {
    const nowMs = Date.now();
    const today = ptDayKey(nowMs);
    if (!today) return out;

    const friendRows = await env.DB.prepare(
      "SELECT requester_user_id AS a, recipient_user_id AS b FROM friends WHERE status = 'accepted'",
    ).all<{ a: string; b: string }>();
    const pairs = new Map<string, [string, string]>();
    const hasFriend = new Set<string>();   // W1164 — anyone with an accepted friend is never matched
    for (const r of friendRows.results ?? []) {
      if (!r.a || !r.b || r.a === r.b) continue;
      pairs.set(pairKey(r.a, r.b), r.a < r.b ? [r.a, r.b] : [r.b, r.a]);
      hasFriend.add(r.a); hasFriend.add(r.b);
    }
    out.pairs = pairs.size;

    const thisWeek = getAccoladeWeekStart(nowMs);
    const lastWeek = priorWeekStart(thisWeek);
    const elapsed = elapsedDaysPt(thisWeek, today);
    // The lookups both passes share, read once and only when a pass needs them.
    let sharedP: Promise<[Set<string>, Set<string>, Map<string, string>, Map<string, string>, Map<string, number>, Map<string, number>]> | null = null;
    const shared = () => (sharedP ??= Promise.all([
      optOutSet(env),
      blockSet(env),
      latestBuildByUser(env),
      rankByUser(env),
      stepsByUser(env, thisWeek),
      stepsByUser(env, lastWeek),
    ]));

    if (pairs.size) {
      const doneRows = await env.DB.prepare('SELECT pair_key FROM coop_boss_instances WHERE auto = 1 AND hunt_day = ?')
        .bind(today)
        .all<{ pair_key: string }>();
      const done = new Set((doneRows.results ?? []).map((r) => r.pair_key));
      const todo = Array.from(pairs.entries()).filter(([k]) => !done.has(k));
      if (todo.length) {
        const [optouts, blocks, builds, ranks, stepsNow, stepsLast] = await shared();
        const pattern = (uid: string) => dailyPattern(stepsLast.get(uid) ?? 0, stepsNow.get(uid) ?? 0, elapsed);
        for (const [key, [a, b]] of todo) {
          if (out.created >= MAX_CREATE_PER_RUN) break;
          if (optouts.has(a + '>*') || optouts.has(b + '>*') || optouts.has(a + '>' + b) || optouts.has(b + '>' + a)) { out.skipped++; continue; }
          if (blocks.has(key)) { out.skipped++; continue; }
          if (buildW(builds.get(a)) < AUTO_HUNT_MIN_W || buildW(builds.get(b)) < AUTO_HUNT_MIN_W) { out.skipped++; continue; }
          const pa = pattern(a);
          const pb = pattern(b);
          if (pa === null || pb === null) { out.skipped++; continue; }
          const pick = pickAutoBoss(ranks.get(a) ?? 'E', ranks.get(b) ?? 'E', pa + pb);
          if (await createAutoHunt(env, a, b, today, pick)) out.created++;
        }
      }
    }

    // ── W1164 — matched partners: active hunters with no friends, paired with each other ──
    try {
      out.matched = await sweepMatchedPairs(env, nowMs, today, thisWeek, elapsed, hasFriend, shared);
    } catch (err) {
      console.error('[coop-auto] matched sweep failed', err);
    }
  } catch (err) {
    console.error('[coop-auto] hunt sweep failed', err);
  }
  return out;
}

/** W1164 — today's hunt for each matched pair (see the header). Returns how many rows it made. */
async function sweepMatchedPairs(
  env: Env,
  nowMs: number,
  today: string,
  thisWeek: string,
  elapsed: number,
  hasFriend: Set<string>,
  shared: () => Promise<[Set<string>, Set<string>, Map<string, string>, Map<string, string>, Map<string, number>, Map<string, number>]>,
): Promise<number> {
  const dayStartMs = Date.parse(ptMidnightIso(today) || '');
  if (!Number.isFinite(dayStartMs)) return 0;
  // The pool's activity: distinct Pacific days with a boss kill in the last 7 days. The '-8 hours'
  // day split is an hour off during daylight time; for counting days that is fine.
  const killRows = (await env.DB.prepare(
    `SELECT k.user_id AS user_id,
            COUNT(DISTINCT date(k.server_created_at / 1000, 'unixepoch', '-8 hours')) AS kill_days,
            COUNT(*) AS kills, MAX(u.created_at) AS created_at
       FROM public_achievement_events k JOIN users u ON u.id = k.user_id
      WHERE k.event_type = 'boss_kill' AND k.server_created_at >= ?
      GROUP BY k.user_id`,
  )
    .bind(nowMs - MATCH_WINDOW_MS)
    .all<{ user_id: string; kill_days: number; kills: number; created_at: number | null }>()).results ?? [];
  const first = killRows.filter((r) =>
    r.user_id && !hasFriend.has(r.user_id) &&
    (Number(r.kill_days) || 0) >= MATCH_MIN_KILL_DAYS &&
    (Number(r.created_at) || 0) < dayStartMs);   // the quiet first day stays quiet
  if (first.length < 2) return 0;

  const [optouts, blocks, builds, ranks, stepsNow, stepsLast] = await shared();
  const pattern = (uid: string) => dailyPattern(stepsLast.get(uid) ?? 0, stepsNow.get(uid) ?? 0, elapsed);
  const pool: MatchCandidate[] = [];
  for (const r of first) {
    const p = pattern(r.user_id);
    if (p === null) continue;                                       // no steps on the server: no goal to size
    if (buildW(builds.get(r.user_id)) < AUTO_HUNT_MIN_W) continue;  // the automatic client is not on their phone
    if (optouts.has(r.user_id + '>*')) continue;                    // switched automatic hunts off
    pool.push({ id: r.user_id, killDays: Number(r.kill_days) || 0, kills: Number(r.kills) || 0, pattern: p });
  }
  if (pool.length < 2) return 0;

  // The last MATCH_KEEP_DAYS of matched rows, newest first: each hunter's latest partner is kept
  // (W1179 — across weeks, so the pair's Pact Flame can grow), and anyone already in a matched
  // hunt today is never handed a second.
  let keepSince = today;
  for (let i = 0; i < MATCH_KEEP_DAYS; i++) keepSince = prevDay(keepSince) || keepSince;
  const weekRows = (await env.DB.prepare(
    `SELECT challenger_user_id AS a, partner_user_id AS b, hunt_day AS d FROM coop_boss_instances
      WHERE matched = 1 AND hunt_day >= ? ORDER BY hunt_day DESC`,
  )
    .bind(keepSince)
    .all<{ a: string; b: string; d: string }>()).results ?? [];
  const keep: Array<[string, string]> = [];
  const seen = new Set<string>();
  const busyToday = new Set<string>();
  const doneToday = new Set<string>();
  for (const r of weekRows) {
    if (!r.a || !r.b) continue;
    if (r.d === today) { busyToday.add(r.a); busyToday.add(r.b); doneToday.add(pairKey(r.a, r.b)); }
    if (seen.has(r.a) || seen.has(r.b)) continue;
    keep.push([r.a, r.b]);
    seen.add(r.a); seen.add(r.b);
  }
  const isBlocked = (a: string, b: string) =>
    blocks.has(pairKey(a, b)) || optouts.has(a + '>' + b) || optouts.has(b + '>' + a);
  const byId = new Map(pool.map((c) => [c.id, c]));
  let made = 0;
  for (const [a, b] of pickMatchedPairs(pool, keep, busyToday, isBlocked)) {
    if (made >= MAX_CREATE_PER_RUN) break;
    if (doneToday.has(pairKey(a, b))) continue;   // today's row already stands
    const pick = pickAutoBoss(ranks.get(a) ?? 'E', ranks.get(b) ?? 'E', (byId.get(a)?.pattern ?? 0) + (byId.get(b)?.pattern ?? 0));
    if (await createAutoHunt(env, a, b, today, pick, true)) made++;
  }
  return made;
}

/** Cron, every 2 minutes: settle every active hunt whose goal is met or whose window has
 *  closed (manual hunts included). The decision itself is resolveCoopInstance, shared with
 *  POST /:id/resolve, so the sweep and a phone can never disagree. */
export async function sweepCoopResolve(env: Env, ctx?: ExecutionContext): Promise<{ won: number; expired: number }> {
  const out = { won: 0, expired: 0 };
  try {
    const rows = (await env.DB.prepare("SELECT * FROM coop_boss_instances WHERE status = 'active' ORDER BY ends_at ASC LIMIT ?")
      .bind(MAX_RESOLVE_PER_RUN)
      .all<CoopBossRow>()).results ?? [];
    if (!rows.length) return out;
    const ids = rows.map((r) => r.id);
    const parts = new Map<string, { user_id: string; joined_at: string | null }[]>();
    const prog = new Map<string, CoopProgress>();
    for (const slice of chunks(ids)) {
      for (const [k, v] of await loadParticipants(env, slice)) parts.set(k, v);
      for (const [k, v] of await getCoopProgressForInstances(env, slice)) prog.set(k, v);
    }
    const userIds = new Set<string>();
    for (const r of rows) {
      r.participants = parts.get(r.id) ?? [];
      for (const uid of participantIds(r)) userIds.add(uid);
    }
    const aliasMap = new Map<string, string>();
    for (const slice of chunks(Array.from(userIds))) {
      for (const [k, v] of await getAliasMap(env, slice)) aliasMap.set(k, v);
    }
    for (const row of rows) {
      const outcome = await resolveCoopInstance(env, row, prog.get(row.id) ?? emptyProgress(), aliasMap, ctx);
      if (outcome === 'won') out.won++;
      else if (outcome === 'expired') out.expired++;
    }
  } catch (err) {
    console.error('[coop-auto] settle sweep failed', err);
  }
  return out;
}

// ── POST / DELETE /v1/coop-boss/auto/optout — switch a friend (or everything) off / on ──

export async function listOptOuts(env: Env, userId: string): Promise<string[]> {
  try {
    const rows = await env.DB.prepare('SELECT friend_user_id FROM coop_auto_optouts WHERE user_id = ? ORDER BY created_at')
      .bind(userId)
      .all<{ friend_user_id: string }>();
    return (rows.results ?? []).map((r) => r.friend_user_id);
  } catch {
    return [];   // pre-0069 database: nothing is switched off
  }
}

export async function handleCoopAutoOptOut(
  request: Request,
  env: Env,
  session: SessionPayload,
  optIn: boolean,
): Promise<Response> {
  const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const friend = typeof body?.friend_user_id === 'string' ? body.friend_user_id.trim() : '';
  if (!friend || friend.length > 64 || !(friend === '*' || /^[0-9a-fA-F-]{8,}$/.test(friend))) {
    return jsonError(400, 'INVALID_FRIEND', "friend_user_id must be a user id or '*'.");
  }
  if (friend === session.userId) return jsonError(400, 'INVALID_FRIEND', 'That is you.');
  if (optIn) {
    await env.DB.prepare('DELETE FROM coop_auto_optouts WHERE user_id = ? AND friend_user_id = ?').bind(session.userId, friend).run();
  } else {
    await env.DB.prepare('INSERT OR IGNORE INTO coop_auto_optouts (user_id, friend_user_id) VALUES (?, ?)').bind(session.userId, friend).run();
  }
  return jsonOk({ ok: true, auto_off: await listOptOuts(env, session.userId) });
}
