/**
 * worldgate.ts — W871 (Wave 2 Train B) THE WORLDGATE.
 *
 * The entire server as one raid party. The week IS the fight: the gate's
 * HP is created lazily on the week's first read — scaled to the living
 * population (14d actives), minus the 5% carry-over damage a survived
 * gate keeps — and the damage bar is the LIVE sum of every hunter's
 * weekly verified step_total (leaderboard_snapshots). No new submission
 * paths; every Health sync in the fleet already strikes the gate.
 *
 * Slain when the pool crosses HP before Sunday's reset — the first read
 * that observes it stamps the kill and credits the reader's own last
 * submit as the breaking blow when theirs crossed the line. Every hunter
 * with >= CLAIM_FLOOR weekly steps may claim the bounty once (souls are
 * granted client-side from the claim response — the co-op award model).
 * Pushes and throne-break events phase in later; v1 is bar + boss +
 * receipts, per the judge's scope discipline.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { MERGED_FOR_WEEK } from '../lib/week-board';   // W892 — the erosion-proof per-week pool read
import { notifyUser } from '../lib/apns';   // W916 — the rally horn

export const WORLDGATE_CLAIM_FLOOR = 15000;   // weekly verified steps to share the kill
export const WORLDGATE_SOULS = 200;
// W916 — v2 read-side knobs (handoff 28: "more interactive and involving the users").
export const WORLDGATE_TOP = 5;          // top strikers shown in the sheet
export const WORLDGATE_WALL_MAX = 60;    // Kill Wall names returned (≥ claim floor)
export const WORLDGATE_RECENT = 6;       // latest strikers (by last verified sync)
// W975 — WORLDGATE MVPs (owner 2026-09-22, Claude Design handoff 29). The top
// three by steps at the MOMENT the gate falls are its MVPs: frozen into
// world_gates.kill_json (0062) when the kill is stamped, so the podium never
// moves afterwards even though the week's list keeps climbing until Sunday.
// They are paid this bonus on top of the bounty, through the same claim.
export const WORLDGATE_MVP_BONUS = [150, 100, 50];
const CARRY_RATE = 0.05;

// W892 (3.0.1 C11) — HP FROM WHAT THE FLEET ACTUALLY WALKS.
//
// The original formula was max(400_000, actives14d * 55_000). At 22 actives
// that is 1.31M against real weekly pools of 250-400k, so the gate was roughly
// 4x unwinnable — and production agreed: every gate ever created SURVIVED, zero
// claims were ever paid, and "THE GATE BREAKS" has never fired for anyone. A
// capstone event that cannot be won is a weekly reminder of futility.
//
// 55_000 assumed a week of honest steps per ACTIVE, but "active" counted anyone
// who opened the app, while only 10-16 hunters actually submit steps in a given
// week. The headcount and the step-producing population were never the same set.
//
// So: derive HP from the trailing median of real weekly pools instead of from a
// headcount, and let it self-correct — a slump lowers the next median, a strong
// run raises it. Backtested over 11 real weeks (see worldgate.test.ts): the old
// formula breaks 0/7, this one breaks 4/7 (57%), inside the 50-80% target band,
// with one week missing by 2,009 steps.
const HP_MIN = 120_000;
const HP_MEDIAN_FACTOR = 0.80;      // the fleet's median week should usually win
// W962 (owner call 2026-09-18) — the escalator is OFF. It was +15% per
// consecutive win so "victory must not become routine", but with ~7 weekly
// actives a routine victory is the whole point: the fleet is not big enough
// for the gate to get harder on them. The arm stays in the formula at zero so
// it can be switched back on when the hunter count justifies it.
const HP_STREAK_ESCALATOR = 0;
const HP_MEDIAN_WEEKS = 4;
// W984 (owner call 2026-09-23) — THE GATE LASTS UNTIL SATURDAY. The 2026-09-20
// gate fell on Wednesday 3:38 PM PST: HP was 0.80 x the 4-week median, and a
// fleet that grew from 5-9 walkers to 14 in three weeks outran a median that
// lags by a month. The owner wants the fight to last the week. So the gate is
// sized to LAST WEEK'S whole pool: the same hunters walking the same amount
// break it on the last day. A bigger week breaks it earlier; a quieter one lets
// it survive (the 5% carry softens the next). The old 0.80 x median stays as a
// floor only, so one quiet week cannot make the next gate trivial.
const HP_LAST_WEEK_FACTOR = 1.0;
// W988 (owner call 2026-09-24) — SURGE. The 3.0.7 launch and the App Store
// In-App Event (Oct 4–31) are expected to bring new hunters, and a joining
// hunter's Health sync lands their whole week at once. Gates in this window ask
// this much MORE than last week's pool, so the fleet that arrives has something
// to hit. One number per week; delete a week to fall back to 1.0.
export const HP_SURGE_WEEKS: Record<string, number> = {
  '2026-09-27': 1.3, '2026-10-04': 1.3, '2026-10-11': 1.3, '2026-10-18': 1.3, '2026-10-25': 1.3,
};

/** Pure HP math — exported so it can be tested without a database.
 *  `pools` are completed weekly pools, NEWEST FIRST (recentPools' order). */
export function computeGateHp(pools: number[], slainStreak: number, carry: number, surge = 1): number {
  const lastWeek = (pools && typeof pools[0] === 'number' && pools[0] > 0) ? pools[0] : 0;
  const usable = (pools || []).filter((p) => typeof p === 'number' && p > 0).sort((a, b) => a - b);
  let median = 0;
  if (usable.length) {
    const m = usable.length >> 1;
    median = usable.length % 2 ? usable[m] : Math.round((usable[m - 1] + usable[m]) / 2);
  }
  const base = Math.max(HP_MIN, Math.round(HP_LAST_WEEK_FACTOR * lastWeek * Math.max(1, surge || 1)), Math.round(HP_MEDIAN_FACTOR * median));
  const escalated = Math.round(base * (1 + HP_STREAK_ESCALATOR * Math.max(0, slainStreak)));
  return Math.max(1, escalated - Math.max(0, carry));
}

function ptWeekStartNow(): string {
  const now = new Date();
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
  let weekday = 0;
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).formatToParts(now)) {
    if (p.type === 'weekday') weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.value);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m || weekday < 0) return dayKey;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - weekday * 86400000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

interface GateRow { week_start: string; hp: number; status: string; slain_at: number | null; slain_by: string | null; kill_json?: string | null; }
type Standing = { user_id: string; alias: string; rank_tier: string | null; steps: number };
type Strike = { alias: string; steps: number; at: number };
/** W975 — the kill, frozen. user_id never leaves the server.
 *  W983 — plus EVERY hunter's damage at the kill (standings) and the latest
 *  strikes before it (recent). A slain gate reads only these: steps walked
 *  after the kill still count on the weekly Steps board, never on the gate —
 *  not in the sheet, not toward the bounty floor. */
interface KillSnap { pool: number; hunters: number; mvps: Standing[]; standings?: Standing[]; recent?: Strike[] }

const WG_STANDINGS_MAX = 1000;
async function standingsOf(env: Env, week: string): Promise<Standing[]> {
  const rows = await env.DB.prepare(
    `${MERGED_FOR_WEEK}
     SELECT m.user_id AS user_id, u.alias AS alias, m.steps AS steps, pps.rank_tier AS rank_tier
       FROM merged m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN public_profile_summary pps ON pps.user_id = m.user_id
      ORDER BY m.steps DESC, u.alias ASC
      LIMIT ?2`,
  ).bind(week, WG_STANDINGS_MAX).all<{ user_id: string; alias: string; steps: number; rank_tier: string | null }>();
  return (rows.results ?? []).map((r) => ({ user_id: r.user_id, alias: r.alias, rank_tier: r.rank_tier ?? null, steps: Number(r.steps) || 0 }));
}
/** The latest strikers (by last verified sync), optionally only those at or before `until`. */
async function recentStrikes(env: Env, week: string, until: number | null): Promise<Strike[]> {
  const rows = await env.DB.prepare(
    `SELECT u.alias AS alias, ls.current_value AS steps, ls.updated_at AS at
       FROM leaderboard_snapshots ls
       JOIN users u ON u.id = ls.user_id
      WHERE ls.metric = 'step_total' AND ls.week_start = ?1 AND ls.current_value > 0
        AND u.apple_sub NOT LIKE 'sim_test_%'
        AND (?3 IS NULL OR ls.updated_at <= ?3)
      ORDER BY ls.updated_at DESC
      LIMIT ?2`,
  ).bind(week, WORLDGATE_RECENT, until).all<{ alias: string; steps: number; at: number }>();
  return (rows.results ?? []).map((r) => ({ alias: r.alias, steps: Number(r.steps) || 0, at: Number(r.at) || 0 }));
}
const byDamage = (a: Standing, b: Standing) => b.steps - a.steps || a.alias.localeCompare(b.alias);

/** Freeze every hunter's damage, the latest strikes, the pool and the headcount of `week` into its gate row. */
async function snapshotKill(env: Env, week: string): Promise<KillSnap> {
  const [standings, recent] = await Promise.all([standingsOf(env, week), recentStrikes(env, week, null)]);
  const agg = await env.DB.prepare(
    `${MERGED_FOR_WEEK} SELECT COUNT(*) AS kill_hunters, COALESCE(SUM(steps), 0) AS kill_pool FROM merged`,
  ).bind(week).first<{ kill_hunters: number; kill_pool: number }>();
  const snap: KillSnap = {
    pool: Number(agg?.kill_pool) || 0,
    hunters: Number(agg?.kill_hunters) || 0,
    mvps: standings.slice(0, 3),
    standings,
    recent,
  };
  await env.DB.prepare('UPDATE world_gates SET kill_json = ? WHERE week_start = ?').bind(JSON.stringify(snap), week).run();
  return snap;
}
/** The frozen kill of a slain gate. A gate slain before 0062 (or whose stamping
 *  request raced) is frozen on first read — its week's final standings.
 *  W983 — a kill frozen before standings existed gets them on first read: the
 *  podium keeps its frozen numbers, every hunter who has not synced since the
 *  kill is exact, and the recent strikes stop at the kill. Hunters who synced
 *  AFTER it give back the overshoot — live total minus the frozen pool — shared
 *  in proportion to their steps and rounded against them, so the standings sum
 *  to the kill again and a late sync can never lift anyone over the floor. */
async function killSnap(env: Env, gate: GateRow): Promise<KillSnap | null> {
  if (!gate || gate.status !== 'slain') return null;
  if (gate.kill_json) {
    let s: KillSnap | null = null;
    try { s = JSON.parse(gate.kill_json) as KillSnap; } catch { s = null; }
    if (s && Array.isArray(s.mvps)) {
      if (Array.isArray(s.standings)) return s;
      const frozen = new Map(s.mvps.map((m) => [m.user_id, m.steps]));
      const live = await standingsOf(env, gate.week_start);
      let rows = live.map((r) => (frozen.has(r.user_id) ? { ...r, steps: frozen.get(r.user_id) as number } : r));
      const slainAt = Number(gate.slain_at) || 0;
      const excess = rows.reduce((a, r) => a + r.steps, 0) - (Number(s.pool) || 0);
      if (slainAt && excess > 0) {
        const lateRows = await env.DB.prepare(
          "SELECT user_id FROM leaderboard_snapshots WHERE metric = 'step_total' AND week_start = ? AND updated_at > ?",
        ).bind(gate.week_start, slainAt).all<{ user_id: string }>();
        const late = new Set((lateRows.results ?? []).map((r) => r.user_id).filter((id) => !frozen.has(id)));
        const lateSum = rows.filter((r) => late.has(r.user_id)).reduce((a, r) => a + r.steps, 0);
        if (lateSum > 0) {
          rows = rows.map((r) => (late.has(r.user_id) ? { ...r, steps: Math.max(0, r.steps - Math.ceil((excess * r.steps) / lateSum)) } : r));
        }
      }
      s.standings = rows.sort(byDamage);
      s.recent = await recentStrikes(env, gate.week_start, Number(gate.slain_at) || null);
      const json = JSON.stringify(s);
      await env.DB.prepare('UPDATE world_gates SET kill_json = ? WHERE week_start = ?').bind(json, gate.week_start).run();
      gate.kill_json = json;
      return s;
    }
  }
  const snap = await snapshotKill(env, gate.week_start);
  gate.kill_json = JSON.stringify(snap);
  return snap;
}
/** A hunter's damage on a frozen kill (0 when they had struck nothing by then). */
function frozenDamage(snap: KillSnap, userId: string): number {
  const r = (snap.standings || []).find((s) => s.user_id === userId);
  return r ? r.steps : 0;
}
function prevWeekOf(week: string): string {
  const d = new Date(week + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

// W892 — was a raw SUM over leaderboard_snapshots. That table holds ONE row per
// (user, metric) and is OVERWRITTEN IN PLACE as hunters submit in the new week,
// so any read of a PAST week silently decays — the erosion trap week-board.ts
// exists to document. ensureGate settles the PRIOR week with this function, so a
// gate the fleet actually broke could be recorded as survived simply because a
// few hunters had already synced into the new week before anyone opened the app.
// MERGED_FOR_WEEK is the proven read: append-only weekly_step_records unioned
// with not-yet-superseded snapshots, sims excluded.
async function weeklyPool(env: Env, week: string): Promise<number> {
  const row = await env.DB.prepare(
    `${MERGED_FOR_WEEK} SELECT COALESCE(SUM(steps), 0) AS pool FROM merged`,
  ).bind(week).first<{ pool: number }>();
  return row?.pool ?? 0;
}

/** Pools of the most recent COMPLETED weeks, newest first (durable table). */
async function recentPools(env: Env, beforeWeek: string): Promise<number[]> {
  const rows = await env.DB.prepare(
    `SELECT week_start, SUM(steps) AS pool
       FROM weekly_step_records
      WHERE week_start < ?
      GROUP BY week_start
      ORDER BY week_start DESC
      LIMIT ?`,
  ).bind(beforeWeek, HP_MEDIAN_WEEKS).all<{ week_start: string; pool: number }>();
  return (rows.results ?? []).map((r) => r.pool ?? 0);
}

/** How many gates in a row the fleet has broken (drives the escalator). */
async function slainStreak(env: Env, beforeWeek: string): Promise<number> {
  const rows = await env.DB.prepare(
    'SELECT status FROM world_gates WHERE week_start < ? ORDER BY week_start DESC LIMIT 8',
  ).bind(beforeWeek).all<{ status: string }>();
  let n = 0;
  for (const r of rows.results ?? []) {
    if (r.status === 'slain') n++;
    else break;
  }
  return n;
}

/** Get-or-create this week's gate; settle LAST week's gate on first sight. */
async function ensureGate(env: Env, week: string): Promise<GateRow> {
  let gate = await env.DB.prepare('SELECT * FROM world_gates WHERE week_start = ?').bind(week).first<GateRow>();
  if (gate) return gate;
  // Settle the most recent prior open gate (survived = keep 5% carry).
  let carry = 0;
  const prior = await env.DB.prepare(
    "SELECT * FROM world_gates WHERE status = 'open' AND week_start < ? ORDER BY week_start DESC LIMIT 1",
  ).bind(week).first<GateRow>();
  if (prior) {
    const priorPool = await weeklyPool(env, prior.week_start);
    if (priorPool >= prior.hp) {
      await env.DB.prepare("UPDATE world_gates SET status = 'slain', slain_at = ? WHERE week_start = ? AND status = 'open'")
        .bind(Date.now(), prior.week_start).run();
      await snapshotKill(env, prior.week_start);   // W975 — its final standings are the podium
    } else {
      carry = Math.floor(priorPool * CARRY_RATE);
      await env.DB.prepare("UPDATE world_gates SET status = 'survived' WHERE week_start = ? AND status = 'open'")
        .bind(prior.week_start).run();
    }
  }
  // W892 — HP from the fleet's own trailing output, not a headcount.
  const [pools, streak] = await Promise.all([recentPools(env, week), slainStreak(env, week)]);
  const hp = computeGateHp(pools, streak, carry, HP_SURGE_WEEKS[week] || 1);   // W988
  try {
    await env.DB.prepare('INSERT INTO world_gates (week_start, hp, status, created_at) VALUES (?, ?, ?, ?)')
      .bind(week, hp, 'open', Date.now()).run();
  } catch { /* raced — another reader created it */ }
  gate = await env.DB.prepare('SELECT * FROM world_gates WHERE week_start = ?').bind(week).first<GateRow>();
  return gate as GateRow;
}

/** Accepted friends of the caller — the caller's "guild" for the Worldgate. */
const FRIENDS_OF = `SELECT CASE WHEN f.requester_user_id = ?2 THEN f.recipient_user_id ELSE f.requester_user_id END
                      FROM friends f
                     WHERE f.status = 'accepted' AND (f.requester_user_id = ?2 OR f.recipient_user_id = ?2)`;

function ptDayNow(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

export async function handleWorldgateGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const week = ptWeekStartNow();
  const gate = await ensureGate(env, week);
  const pool = await weeklyPool(env, week);
  // First read past the line stamps the kill.
  if (gate.status === 'open' && pool >= gate.hp) {
    const now = Date.now();
    const stamp = await env.DB.prepare("UPDATE world_gates SET status = 'slain', slain_at = ?, slain_by = ? WHERE week_start = ? AND status = 'open'")
      .bind(now, session.userId, week).run();
    gate.status = 'slain';
    if (!gate.slain_at) gate.slain_at = now;
    // W975 — the request that stamps the kill freezes the podium. A raced
    // stamp leaves it to killSnap's first-read freeze a moment later.
    if (stamp && stamp.meta && Number(stamp.meta.changes) >= 1) {
      try { gate.kill_json = JSON.stringify(await snapshotKill(env, week)); } catch { /* frozen on next read */ }
    }
  }
  // W983 — once the gate falls, the gate is done counting: every number below
  // comes from the kill's frozen record, never from steps walked after it.
  const frozenKill = gate.status === 'slain' ? await killSnap(env, gate) : null;
  const fz = frozenKill && Array.isArray(frozenKill.standings) ? frozenKill : null;
  const claimed = await env.DB.prepare(
    'SELECT 1 FROM world_gate_claims WHERE week_start = ? AND user_id = ?',
  ).bind(week, session.userId).first();
  let myDamage: number;
  if (fz) myDamage = frozenDamage(fz, session.userId);
  else {
    const mine = await env.DB.prepare(
      "SELECT current_value FROM leaderboard_snapshots WHERE user_id = ? AND metric = 'step_total' AND week_start = ?",
    ).bind(session.userId, week).first<{ current_value: number }>();
    myDamage = mine?.current_value ?? 0;
  }

  // ── W916 — the v2 read side: who is striking, your guild's share, the top
  // strikers + your placement, the Kill Wall, the latest strikers. All from the
  // merged weekly view (sims excluded), one round trip each, no new schema.
  let agg: { hunters: number; guild_steps: number; guild_hunters: number; above: number; wall_count: number } | null;
  let top: Array<{ alias: string; steps: number; rank_tier: string | null; me: boolean }>;
  let wall: Array<{ alias: string; steps: number }>;
  let recent: Strike[];
  if (fz) {
    const st = fz.standings as Standing[];
    const friends = await env.DB.prepare(`SELECT id FROM (${FRIENDS_OF.replace(/\?2/g, '?1')}) AS f(id)`)
      .bind(session.userId).all<{ id: string }>();
    const ids = new Set((friends.results ?? []).map((r) => r.id));
    const g = st.filter((s) => ids.has(s.user_id));
    agg = {
      hunters: fz.hunters, guild_steps: g.reduce((a, s) => a + s.steps, 0), guild_hunters: g.length,
      above: st.filter((s) => s.steps > myDamage).length, wall_count: st.filter((s) => s.steps >= WORLDGATE_CLAIM_FLOOR).length,
    };
    top = st.slice(0, WORLDGATE_TOP).map((s) => ({ alias: s.alias, steps: s.steps, rank_tier: s.rank_tier, me: s.user_id === session.userId }));
    wall = st.filter((s) => s.steps >= WORLDGATE_CLAIM_FLOOR).slice(0, WORLDGATE_WALL_MAX).map((s) => ({ alias: s.alias, steps: s.steps }));
    recent = fz.recent || [];
  } else {
  agg = await env.DB.prepare(
    `${MERGED_FOR_WEEK}
     SELECT (SELECT COUNT(*) FROM merged) AS hunters,
            (SELECT COALESCE(SUM(steps), 0) FROM merged WHERE user_id IN (${FRIENDS_OF})) AS guild_steps,
            (SELECT COUNT(*) FROM merged WHERE user_id IN (${FRIENDS_OF})) AS guild_hunters,
            (SELECT COUNT(*) FROM merged WHERE steps > ?3) AS above,
            (SELECT COUNT(*) FROM merged WHERE steps >= ?4) AS wall_count`,
  ).bind(week, session.userId, myDamage, WORLDGATE_CLAIM_FLOOR)
    .first<{ hunters: number; guild_steps: number; guild_hunters: number; above: number; wall_count: number }>();
  const topRows = await env.DB.prepare(
    `${MERGED_FOR_WEEK}
     SELECT u.alias AS alias, m.steps AS steps, pps.rank_tier AS rank_tier, (m.user_id = ?2) AS me
       FROM merged m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN public_profile_summary pps ON pps.user_id = m.user_id
      ORDER BY m.steps DESC, u.alias ASC
      LIMIT ?3`,
  ).bind(week, session.userId, WORLDGATE_TOP).all<{ alias: string; steps: number; rank_tier: string | null; me: number }>();
  const wallRows = await env.DB.prepare(
    `${MERGED_FOR_WEEK}
     SELECT u.alias AS alias, m.steps AS steps
       FROM merged m
       JOIN users u ON u.id = m.user_id
      WHERE m.steps >= ?2
      ORDER BY m.steps DESC, u.alias ASC
      LIMIT ?3`,
  ).bind(week, WORLDGATE_CLAIM_FLOOR, WORLDGATE_WALL_MAX).all<{ alias: string; steps: number }>();
  top = (topRows.results ?? []).map((r) => ({ alias: r.alias, steps: Number(r.steps) || 0, rank_tier: r.rank_tier ?? null, me: !!Number(r.me) }));
  wall = (wallRows.results ?? []).map((r) => ({ alias: r.alias, steps: Number(r.steps) || 0 }));
  recent = await recentStrikes(env, week, null);
  }
  const rallied = await env.DB.prepare('SELECT sent FROM world_gate_rallies WHERE user_id = ? AND day = ?')
    .bind(session.userId, ptDayNow()).first<{ sent: number }>();

  // W975 — the kill to announce: this week's gate if it fell, else last week's
  // (a gate stamped at the Sunday rollover is only ever seen from the new week).
  let killGate: GateRow | null = gate.status === 'slain' ? gate : null;   // (its record is frozenKill above)
  if (!killGate) {
    const prev = await env.DB.prepare("SELECT * FROM world_gates WHERE week_start = ? AND status = 'slain'")
      .bind(prevWeekOf(week)).first<GateRow>();
    killGate = prev || null;
  }
  let kill: Record<string, unknown> | null = null;
  let myPlace = 0;
  if (killGate) {
    const snap = killGate === gate && frozenKill ? frozenKill : await killSnap(env, killGate);
    if (snap) {
      const place = snap.mvps.findIndex((m) => m.user_id === session.userId) + 1;
      let kMine = 0, kAbove = 0;
      if (Array.isArray(snap.standings)) {   // W983 — your steps AT the kill
        kMine = frozenDamage(snap, session.userId);
        kAbove = snap.standings.filter((s) => s.steps > kMine).length;
      } else {
        const kw = await env.DB.prepare(
          `${MERGED_FOR_WEEK}
           SELECT (SELECT steps FROM merged WHERE user_id = ?2) AS mine,
                  (SELECT COUNT(*) FROM merged WHERE steps > COALESCE((SELECT steps FROM merged WHERE user_id = ?2), 0)) AS above_kill`,
        ).bind(killGate.week_start, session.userId).first<{ mine: number | null; above_kill: number }>();
        kMine = Number(kw?.mine) || 0; kAbove = Number(kw?.above_kill) || 0;
      }
      if (killGate.week_start === week) myPlace = place;
      kill = {
        week: killGate.week_start,
        slain_at: Number(killGate.slain_at) || 0,
        pool: snap.pool,
        hunters: snap.hunters,
        mvps: snap.mvps.map((m) => ({ alias: m.alias, rank_tier: m.rank_tier, steps: m.steps })),
        my_place: place,
        my_steps: kMine,
        my_pos: kMine > 0 ? kAbove + 1 : null,
        mvp_bonus: WORLDGATE_MVP_BONUS,
      };
    }
  }

  return jsonOk({
    ok: true, week_start: week, hp: gate.hp, pool: fz ? fz.pool : pool, status: gate.status,
    my_damage: myDamage,
    claim_floor: WORLDGATE_CLAIM_FLOOR, souls: WORLDGATE_SOULS,
    // W975 — an MVP may claim the bonus even below the bounty floor.
    claimable: gate.status === 'slain' && !claimed && (myDamage >= WORLDGATE_CLAIM_FLOOR || myPlace > 0),
    claimed: !!claimed,
    hunters: Number(agg?.hunters) || 0,
    guild: { steps: Number(agg?.guild_steps) || 0, hunters: Number(agg?.guild_hunters) || 0 },
    my_rank: myDamage > 0 ? (Number(agg?.above) || 0) + 1 : null,
    top,
    wall,
    wall_count: Number(agg?.wall_count) || 0,
    recent,
    rallied_today: !!rallied,
    kill,   // W975 — null unless this or last week's gate fell
  });
}

/**
 * W916 — POST /v1/worldgate/rally: the rally horn. Once a day, every accepted
 * friend gets a push saying how far the gate is down. notifyUser never throws.
 */
export async function handleWorldgateRally(
  _request: Request,
  env: Env,
  session: SessionPayload,
  ctx?: ExecutionContext,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const day = ptDayNow();
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO world_gate_rallies (user_id, day, sent, created_at) VALUES (?, ?, 0, ?)')
    .bind(session.userId, day, Date.now()).run();
  if (!(ins.meta && Number(ins.meta.changes) >= 1)) return jsonOk({ ok: true, already: true, sent: 0 });
  const week = ptWeekStartNow();
  const gate = await ensureGate(env, week);
  const pool = await weeklyPool(env, week);
  const pct = Math.max(0, Math.min(100, Math.round((pool / Math.max(1, gate.hp)) * 100)));
  const friends = await env.DB.prepare(`SELECT id FROM (${FRIENDS_OF.replace(/\?2/g, '?1')}) AS f(id)`)
    .bind(session.userId).all<{ id: string }>();
  const ids = (friends.results ?? []).map((r) => r.id);
  await env.DB.prepare('UPDATE world_gate_rallies SET sent = ? WHERE user_id = ? AND day = ?').bind(ids.length, session.userId, day).run();
  const body = gate.status === 'slain'
    ? `${session.alias} sounds the horn: the Worldgate is DOWN this week. Come collect your share.`
    : `${session.alias} rallies you: the Worldgate is ${pct}% down. Every verified step you walk is a strike.`;
  const push = async () => {
    for (const id of ids) {
      await notifyUser(env, id, { title: 'The Worldgate', body, type: 'worldgate_rally', data: { week } });
    }
  };
  if (ctx) ctx.waitUntil(push()); else await push();
  return jsonOk({ ok: true, already: false, sent: ids.length });
}

export async function handleWorldgateClaim(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const week = ptWeekStartNow();
  const gate = await env.DB.prepare('SELECT * FROM world_gates WHERE week_start = ?').bind(week).first<GateRow>();
  if (!gate || gate.status !== 'slain') return jsonError(409, 'GATE_STANDS', 'The gate still stands.');
  // W975 — the bounty asks the floor; the MVP bonus asks a place on the frozen podium.
  // W983 — the floor reads your damage AT the kill: steps after it never pay the bounty.
  const snap = await killSnap(env, gate);
  const place = snap ? snap.mvps.findIndex((m) => m.user_id === session.userId) + 1 : 0;
  const atKill = snap ? frozenDamage(snap, session.userId) : 0;
  const bounty = atKill >= WORLDGATE_CLAIM_FLOOR ? WORLDGATE_SOULS : 0;
  const bonus = place > 0 ? (WORLDGATE_MVP_BONUS[place - 1] ?? 0) : 0;
  if (!bounty && !bonus) {
    return jsonError(403, 'TOO_LITTLE_DAMAGE', 'The bounty asks ' + WORLDGATE_CLAIM_FLOOR.toLocaleString('en-US') + ' verified steps this week.');
  }
  try {
    await env.DB.prepare('INSERT INTO world_gate_claims (week_start, user_id, claimed_at) VALUES (?, ?, ?)')
      .bind(week, session.userId, Date.now()).run();
  } catch {
    return jsonOk({ ok: true, first: false, souls: 0, bounty: 0, mvp_bonus: 0, mvp_place: place });   // already claimed
  }
  return jsonOk({ ok: true, first: true, souls: bounty + bonus, bounty, mvp_bonus: bonus, mvp_place: place });
}
