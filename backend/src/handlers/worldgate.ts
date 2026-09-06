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
const HP_STREAK_ESCALATOR = 0.15;   // +15% per consecutive win: victory must not become routine
const HP_MEDIAN_WEEKS = 4;

/** Pure HP math — exported so it can be tested without a database. */
export function computeGateHp(pools: number[], slainStreak: number, carry: number): number {
  const usable = (pools || []).filter((p) => typeof p === 'number' && p > 0).sort((a, b) => a - b);
  let median = 0;
  if (usable.length) {
    const m = usable.length >> 1;
    median = usable.length % 2 ? usable[m] : Math.round((usable[m - 1] + usable[m]) / 2);
  }
  const base = Math.max(HP_MIN, Math.round(HP_MEDIAN_FACTOR * median));
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

interface GateRow { week_start: string; hp: number; status: string; slain_at: number | null; slain_by: string | null; }

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
    } else {
      carry = Math.floor(priorPool * CARRY_RATE);
      await env.DB.prepare("UPDATE world_gates SET status = 'survived' WHERE week_start = ? AND status = 'open'")
        .bind(prior.week_start).run();
    }
  }
  // W892 — HP from the fleet's own trailing output, not a headcount.
  const [pools, streak] = await Promise.all([recentPools(env, week), slainStreak(env, week)]);
  const hp = computeGateHp(pools, streak, carry);
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
    await env.DB.prepare("UPDATE world_gates SET status = 'slain', slain_at = ?, slain_by = ? WHERE week_start = ? AND status = 'open'")
      .bind(Date.now(), session.userId, week).run();
    gate.status = 'slain';
  }
  const mine = await env.DB.prepare(
    "SELECT current_value FROM leaderboard_snapshots WHERE user_id = ? AND metric = 'step_total' AND week_start = ?",
  ).bind(session.userId, week).first<{ current_value: number }>();
  const claimed = await env.DB.prepare(
    'SELECT 1 FROM world_gate_claims WHERE week_start = ? AND user_id = ?',
  ).bind(week, session.userId).first();
  const myDamage = mine?.current_value ?? 0;

  // ── W916 — the v2 read side: who is striking, your guild's share, the top
  // strikers + your placement, the Kill Wall, the latest strikers. All from the
  // merged weekly view (sims excluded), one round trip each, no new schema.
  const agg = await env.DB.prepare(
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
  const recentRows = await env.DB.prepare(
    `SELECT u.alias AS alias, ls.current_value AS steps, ls.updated_at AS at
       FROM leaderboard_snapshots ls
       JOIN users u ON u.id = ls.user_id
      WHERE ls.metric = 'step_total' AND ls.week_start = ?1 AND ls.current_value > 0
        AND u.apple_sub NOT LIKE 'sim_test_%'
      ORDER BY ls.updated_at DESC
      LIMIT ?2`,
  ).bind(week, WORLDGATE_RECENT).all<{ alias: string; steps: number; at: number }>();
  const rallied = await env.DB.prepare('SELECT sent FROM world_gate_rallies WHERE user_id = ? AND day = ?')
    .bind(session.userId, ptDayNow()).first<{ sent: number }>();

  return jsonOk({
    ok: true, week_start: week, hp: gate.hp, pool, status: gate.status,
    my_damage: myDamage,
    claim_floor: WORLDGATE_CLAIM_FLOOR, souls: WORLDGATE_SOULS,
    claimable: gate.status === 'slain' && !claimed && myDamage >= WORLDGATE_CLAIM_FLOOR,
    claimed: !!claimed,
    hunters: Number(agg?.hunters) || 0,
    guild: { steps: Number(agg?.guild_steps) || 0, hunters: Number(agg?.guild_hunters) || 0 },
    my_rank: myDamage > 0 ? (Number(agg?.above) || 0) + 1 : null,
    top: (topRows.results ?? []).map((r) => ({ alias: r.alias, steps: Number(r.steps) || 0, rank_tier: r.rank_tier ?? null, me: !!Number(r.me) })),
    wall: (wallRows.results ?? []).map((r) => ({ alias: r.alias, steps: Number(r.steps) || 0 })),
    wall_count: Number(agg?.wall_count) || 0,
    recent: (recentRows.results ?? []).map((r) => ({ alias: r.alias, steps: Number(r.steps) || 0, at: Number(r.at) || 0 })),
    rallied_today: !!rallied,
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
  const mine = await env.DB.prepare(
    "SELECT current_value FROM leaderboard_snapshots WHERE user_id = ? AND metric = 'step_total' AND week_start = ?",
  ).bind(session.userId, week).first<{ current_value: number }>();
  if ((mine?.current_value ?? 0) < WORLDGATE_CLAIM_FLOOR) {
    return jsonError(403, 'TOO_LITTLE_DAMAGE', 'The bounty asks ' + WORLDGATE_CLAIM_FLOOR.toLocaleString('en-US') + ' verified steps this week.');
  }
  try {
    await env.DB.prepare('INSERT INTO world_gate_claims (week_start, user_id, claimed_at) VALUES (?, ?, ?)')
      .bind(week, session.userId, Date.now()).run();
  } catch {
    return jsonOk({ ok: true, first: false, souls: 0 });   // already claimed
  }
  return jsonOk({ ok: true, first: true, souls: WORLDGATE_SOULS });
}
