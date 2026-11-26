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
// W1134 — TWO DAYS IN THE APP OR NOTHING COUNTS (owner 2026-11-06). Giorgio opened the app on 3 days
// ever; each time his whole week of Apple Health steps landed at once and took the #1 MVP spot
// (weeks of 10-18 and 11-01; the 11-01 gate fell 4 minutes after he opened). Owner: "they need to use
// the app at least 2/7 days" and, under that, "nothing counts". So a hunter's weekly steps strike the
// gate only once they have opened the app on WORLDGATE_MIN_DAYS Pacific days of the gate's week
// (app_open_counts, migration 0071, opens > 0). Below that: no damage, no place on the podium or the
// live MVP badges, no bounty, no MVP bonus, no Gatebreaker. Weeks before WORLDGATE_DAYS_FROM keep the
// old rule (the counter only began 2026-11-05). The weekly Steps board is a different surface and
// still counts every step.
export const WORLDGATE_MIN_DAYS = 2;
export const WORLDGATE_DAYS_FROM = '2026-11-08';
/** SQL: true when the hunter in `uidCol` has opened the app on enough days of the week in ?1. */
const wgCounts = (uidCol: string) =>
  `(?1 < '${WORLDGATE_DAYS_FROM}' OR (SELECT COUNT(*) FROM app_open_counts c
      WHERE c.user_id = ${uidCol} AND c.day_pt >= ?1 AND c.day_pt <= date(?1, '+6 days') AND c.opens > 0) >= ${WORLDGATE_MIN_DAYS})`;

// W1283 — THE THREE BARS (owner 2026-11-22): "I want to have the world gate do the steps + flights HP bar + Sleep total ...
// So this worldgate will have all of these to complete to kill it. Make this realistic but challenging", "MVP will be
// contributions to the boss kill so all three combined in a percentage damage", "the kill wall has to be % damage", and
// "everyone on the kill wall gets 200 souls each + 1% chance at any S-tier item drop + 0.5% on the mythic drop".
// From the gate of WG3_FROM on, a gate has three HPs: steps (`hp`, sized as before), flights and minutes asleep
// (migration 0082). It falls when all three are spent. A hunter's DAMAGE is their share of each bar, averaged over the
// three: (steps / steps bar + flights / flights bar + sleep / sleep bar) / 3, each bar the larger of its HP and what the
// fleet put in, so the shares of everyone add up to the gate's damage and never past 100%. The MVPs are the top three by
// damage, the Kill Wall is every hunter at WG3_WALL_PCT or more, and the bounty (souls + the two relic rolls) is theirs.
// The first gate's flights and sleep HPs come from the fleet of 2026-11-15 (40 active hunters: about 1,660 flights a
// week; 17 tracked sleep, about 5 nights each at about 7 hours). Every later gate sizes each bar the way steps are sized
// (W1031): a beaten gate grows by how early it fell, a gate that stood eases each unfinished bar to 90% of what was done.
// The phone sends flights and sleep per day of the week (POST /v1/worldgate/effort); the server caps each day.
// W1284 — owner 2026-11-22 (after "don't start it until next week" and my advice to wait): "No I want to start it this
// week". So the three bars begin with THIS week's gate, at HALF size (750 flights, 300 hours of sleep: build 674, the
// first that sends them, was only just uploaded and hunters update over days; a phone sends its whole week once updated).
// The gate already existed, steps only, so ensureGate adds the two bars to an open gate of WG3_FROM or later that has none.
// The full-size figures (1,500 / 600h) stay as the reference; later gates size themselves from how this one goes.
export const WG3_FROM = '2026-11-22';
export const WG3_START_FLIGHTS = 750;
export const WG3_START_SLEEP = 18000;        // minutes (300 hours)
/** W1284 — the first build that sends flights and sleep and grants the bounty's relic rolls (APP_BUILD_TAG ...-w1283). */
export const WG3_MIN_BUILD = 1283;
export const WG3_MIN_FLIGHTS = 300;
export const WG3_MIN_SLEEP = 6000;           // minutes (100 hours)
export const WG3_FLIGHTS_DAY_CAP = 50;       // flights a day that count
export const WG3_SLEEP_NIGHT_CAP = 540;      // minutes a night that count (9 hours)
// W1294 — owner 2026-11-23: "I think the kill wall damage should be bigger than 0.5%"; after the examples at full-size
// bars (1,500 flights, 600 hours): "2% and deploy". 2% = about 76,000 steps in the week for a hunter who only walks,
// or 4 nights of sleep + 10,000 steps + 8 flights. An even share of a ~40-hunter kill is about 2.5%.
export const WG3_WALL_PCT = 2;               // damage (% of the kill) that names a hunter on the Kill Wall (W1283: 0.5)
export const WG3_DROP_S = 0.01;              // the bounty's roll at an S-rank relic
export const WG3_DROP_MYTHIC = 0.005;        // ... and at a mythic weapon
/** The dice for the bounty's relic rolls, [0, 1). Tests replace `next`. */
export const wgDice = { next: (): number => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 };
export interface Bars { steps: number; flights: number; sleep: number }
const barShare = (v: number, hp: number, pool: number) => (v > 0 ? v / Math.max(1, hp, pool) : 0);
/** The gate's damage, 0-100: each bar's fill (capped at 100%) averaged over the three. */
export function overallPct(hp: Bars, pool: Bars): number {
  const f = (p: number, h: number) => Math.min(1, Math.max(0, p) / Math.max(1, h));
  return ((f(pool.steps, hp.steps) + f(pool.flights, hp.flights) + f(pool.sleep, hp.sleep)) / 3) * 100;
}
/** One hunter's damage, 0-100: their share of each bar averaged over the three. */
export function damagePct(mine: Bars, hp: Bars, pool: Bars): number {
  return ((barShare(mine.steps, hp.steps, pool.steps) + barShare(mine.flights, hp.flights, pool.flights)
    + barShare(mine.sleep, hp.sleep, pool.sleep)) / 3) * 100;
}
const pct2 = (v: number) => Math.round(v * 100) / 100;
/** A gate's three bars are all spent. */
export function barsDown(hp: Bars, pool: Bars): boolean {
  return pool.steps >= hp.steps && pool.flights >= hp.flights && pool.sleep >= hp.sleep;
}
// W1323 — owner 2026-11-25: "Make sure that the weekly worldgate boss adapts and starts making predictions to the data whether
// to increase or decrease the goals." Each bar is now sized on its own from a forecast of what the fleet will put into it
// next week, instead of all three moving together by the day the gate fell (one lagging bar held the others back, and a
// bar filled by Wednesday never grew). The forecast is the week's RAW total (everything logged, the part past a filled bar
// included: the locks of 0084 stop the counting, not the recording), nudged by its trend against the week before when
// there is one (-15% .. +20%). The next HP is WG_AIM of the forecast, so the same fleet doing the same again fills it
// with a little room, around Saturday; a bar moves at most WG_MAX_UP / WG_MAX_DOWN in one week; after two or more lost
// gates in a row the aim drops a little more each loss (never under 75%), and no bar goes under its floor.
export const WG_AIM = 0.92;
export const WG_MAX_UP = 1.5;
export const WG_MAX_DOWN = 0.7;
/** W1323 — what the fleet will likely put into a bar next week: `done` (this week's raw total) times its trend
 *  against `prev` (the week before), the trend clamped to 0.85 .. 1.20; no earlier week = no trend. */
export function predictBar(done: number, prev: number | null | undefined): number {
  const d = Math.max(0, Number(done) || 0);
  if (!d) return 0;
  const p = Number(prev) || 0;
  const trend = p > 0 ? Math.min(1.2, Math.max(0.85, d / p)) : 1;
  return Math.round(d * trend);
}
/** W1323 — one bar's next HP from its HP this week, its raw total, the week before's and the loss streak. */
export function nextBarHp(hp: number, done: number, prev: number | null | undefined, floor: number, lossStreak: number): number {
  const aim = (lossStreak || 0) >= 2 ? Math.max(0.75, WG_AIM - 0.06 * ((lossStreak || 0) - 1)) : WG_AIM;
  const want = Math.round(predictBar(done, prev) * aim);
  const h = Math.max(1, Number(hp) || 1);
  return Math.max(floor, Math.min(Math.round(h * WG_MAX_UP), Math.max(Math.round(h * WG_MAX_DOWN), want)));
}
/** W1323 — the next gate's three HPs (sleep in minutes) from the last three-bar gate's HPs, the raw totals of its week
 *  and of the week before (null where there is none), and the loss streak. */
export function computeNextBarsForecast(hp: Bars, done: Bars, prev: { steps: number | null; flights: number | null; sleep: number | null }, lossStreak: number): Bars {
  return {
    steps: nextBarHp(hp.steps, done.steps, prev.steps, HP_MIN, lossStreak),
    flights: nextBarHp(hp.flights, done.flights, prev.flights, WG3_MIN_FLIGHTS, lossStreak),
    sleep: nextBarHp(hp.sleep, done.sleep, prev.sleep, WG3_MIN_SLEEP, lossStreak),
  };
}
/** A gate row carries three bars. */
const isThree = (g: { week_start: string; hp_flights?: number | null; hp_sleep?: number | null } | null | undefined): boolean =>
  !!g && g.week_start >= WG3_FROM && g.hp_flights != null && g.hp_sleep != null;
/** The week's flights and sleep, one row per hunter whose week counts (the two days), sims excluded. ?1 = the week. */
const WG_EFFORT = `SELECT e.user_id AS user_id, e.flights AS flights, e.sleep_min AS sleep_min, u.alias AS alias
    FROM world_gate_effort e JOIN users u ON u.id = e.user_id
   WHERE e.week_start = ?1 AND u.apple_sub NOT LIKE 'sim_test_%' AND ${wgCounts('e.user_id')}`;
/** The week's merged steps (week-board.ts), keeping only hunters whose steps count on the gate. */
export const WG_MERGED = MERGED_FOR_WEEK.replace('WITH merged AS (', 'WITH merged_all AS (').trimEnd() + `,
  merged AS (SELECT ma.user_id, ma.steps FROM merged_all ma WHERE ${wgCounts('ma.user_id')})`;
// (W1031 — the 5% carry after a survived gate is gone: a lost gate now eases the next by 10%.)

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
// W988's launch SURGE (x1.3 through October) is retired by W1031: the gate of
// 2026-09-27 asked 640,528 of a fleet that walked 366,068, and the next one
// still asked 30% more than that.

// W1031 (owner call 2026-10-06) — THE GATE ANSWERS TO HOW THE LAST ONE WENT.
// "I want it to auto adjust according to past or failed weekly gates." Sizing by
// last week's steps alone ignored the result: a lost gate was followed by one
// just as far out of reach. Now the outcome sets the next size.
//   LOST (survived): the next gate asks 90% of what the fleet walked last week,
//     so the same hunters walking the same amount win with a little room. Each
//     further loss in a row takes another 10% off (80%, 70%, floor 60%): it
//     keeps easing until the fleet wins. The old 5% carry and the median floor
//     are not applied here — both would fight the easing.
//   WON (slain): the next gate is the BEATEN gate's size, grown by how early it
//     went down — Saturday x1.0, Friday x1.1, Thursday x1.2, Wednesday or
//     earlier x1.3. It grows only as fast as the fleet proves it can handle.
//   NO PRIOR GATE: computeGateHp below (last week's steps / the median floor).
// Never below HP_MIN.
const HP_LOSS_STEP = 0.10;
const HP_LOSS_FLOOR = 0.60;
const HP_WIN_BY_DAY = [1.3, 1.3, 1.3, 1.3, 1.2, 1.1, 1.0];   // Sun..Sat (Pacific) the gate went down

/** Pacific weekday (0 Sun .. 6 Sat) on which a gate was beaten, or 6 when the kill was
 *  only recorded after its week had ended (settled at the next week's first read). */
export function gateKillDay(weekStart: string, slainAt: number | null | undefined): number {
  if (!slainAt || !Number.isFinite(slainAt)) return 6;
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(slainAt));
  const a = Date.parse(weekStart + 'T00:00:00Z'), b = Date.parse(dayKey + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 6;
  const d = Math.round((b - a) / 86400000);
  return d >= 0 && d <= 6 ? d : 6;
}

/** Pure sizing of the NEXT gate from how the last one went (W1031).
 *  `pools` are completed weekly pools, newest first; `prior` is the most recent earlier
 *  gate AFTER it has been settled; `lossStreak` counts survived gates in a row ending at it. */
export function computeNextGateHp(
  pools: number[],
  prior: { week_start: string; hp: number; status: string; slain_at: number | null } | null,
  lossStreak: number,
): number {
  if (!prior || (prior.status !== 'slain' && prior.status !== 'survived')) return computeGateHp(pools, 0, 0);
  if (prior.status === 'survived') {
    const lastWeek = (pools && typeof pools[0] === 'number' && pools[0] > 0) ? pools[0] : 0;
    const factor = Math.max(HP_LOSS_FLOOR, 1 - HP_LOSS_STEP * Math.max(1, lossStreak || 1));
    return Math.max(HP_MIN, Math.round(lastWeek * factor));
  }
  const grow = HP_WIN_BY_DAY[gateKillDay(prior.week_start, prior.slain_at)] || 1;
  return Math.max(HP_MIN, Math.round(Math.max(0, prior.hp) * grow));
}

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

interface GateRow { week_start: string; hp: number; status: string; slain_at: number | null; slain_by: string | null; kill_json?: string | null;
  hp_flights?: number | null; hp_sleep?: number | null;   // W1283 — the flights and sleep HPs of a three-bar gate
  steps_full_at?: number | null; flights_full_at?: number | null; sleep_full_at?: number | null; }   // W1323 — when each bar filled
// W1283 — on a three-bar gate a standing also carries the hunter's flights, minutes asleep and damage (% of the kill).
type Standing = { user_id: string; alias: string; rank_tier: string | null; steps: number; flights?: number; sleep?: number; pct?: number };
// W1290 — a strike also carries the hunter's flights and minutes asleep this week (0 when none), so the feed can
// say what they hit with: "+4,186 steps and +7 flights". A kill frozen before W1290 has steps only.
type Strike = { alias: string; steps: number; at: number; flights?: number; sleep?: number; rank_tier?: string | null };
/** W975 — the kill, frozen. user_id never leaves the server.
 *  W983 — plus EVERY hunter's damage at the kill (standings) and the latest
 *  strikes before it (recent). A slain gate reads only these: steps walked
 *  after the kill still count on the weekly Steps board, never on the gate —
 *  not in the sheet, not toward the bounty floor. */
interface KillSnap { pool: number; hunters: number; mvps: Standing[]; standings?: Standing[]; recent?: Strike[];
  bars?: { hp: Bars; pool: Bars } }   // W1283 — a three-bar kill: each bar's HP and what the fleet put in at the kill

const WG_STANDINGS_MAX = 1000;
async function standingsOf(env: Env, week: string): Promise<Standing[]> {
  const rows = await env.DB.prepare(
    `${WG_MERGED}
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
    `SELECT u.alias AS alias, ls.current_value AS steps, ls.updated_at AS at,
            COALESCE(e.flights, 0) AS flights, COALESCE(e.sleep_min, 0) AS sleep, pps.rank_tier AS rank_tier
       FROM leaderboard_snapshots ls
       JOIN users u ON u.id = ls.user_id
       LEFT JOIN world_gate_effort e ON e.week_start = ?1 AND e.user_id = ls.user_id
       LEFT JOIN public_profile_summary pps ON pps.user_id = ls.user_id
      WHERE ls.metric = 'step_total' AND ls.week_start = ?1 AND ls.current_value > 0
        AND u.apple_sub NOT LIKE 'sim_test_%'
        AND (?3 IS NULL OR ls.updated_at <= ?3)
        AND ${wgCounts('ls.user_id')}
      ORDER BY ls.updated_at DESC
      LIMIT ?2`,
  ).bind(week, WORLDGATE_RECENT, until).all<{ alias: string; steps: number; at: number; flights?: number; sleep?: number; rank_tier?: string | null }>();
  return (rows.results ?? []).map((r) => ({
    alias: r.alias, steps: Number(r.steps) || 0, at: Number(r.at) || 0,
    flights: Math.max(0, Number(r.flights) || 0), sleep: Math.max(0, Number(r.sleep) || 0),   // W1290
    rank_tier: r.rank_tier ?? null,   // W1291 — the strike's circle wears the hunter's rank colour
  }));
}
const byDamage = (a: Standing, b: Standing) => b.steps - a.steps || a.alias.localeCompare(b.alias);
const byPct = (a: Standing, b: Standing) => (b.pct || 0) - (a.pct || 0) || b.steps - a.steps || a.alias.localeCompare(b.alias);

/** W1283 — the week's flights and sleep pools (hunters whose week counts). */
async function effortPools(env: Env, week: string): Promise<{ flights: number; sleep: number }> {
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(flights), 0) AS f, COALESCE(SUM(sleep_min), 0) AS s FROM (${WG_EFFORT})`)
    .bind(week).first<{ f: number; s: number }>();
  return { flights: Number(r?.f) || 0, sleep: Number(r?.s) || 0 };
}
// W1323 — the bar locks (0084). A bar that has reached its HP stops counting: the first read that finds it full writes what
// every hunter had put into it, then stamps the bar full; from then on each hunter's part of that bar is the locked value.
const WG_BARS = ['steps', 'flights', 'sleep'] as const;
type BarKey = typeof WG_BARS[number];
const barVal = (r: Standing, b: BarKey): number => (b === 'steps' ? r.steps : (r[b] || 0));
async function applyBarLocks(env: Env, week: string, hp: Bars, rows: Standing[]): Promise<void> {
  const g = await env.DB.prepare('SELECT steps_full_at, flights_full_at, sleep_full_at FROM world_gates WHERE week_start = ?')
    .bind(week).first<{ steps_full_at?: number | null; flights_full_at?: number | null; sleep_full_at?: number | null }>();
  const locked: BarKey[] = WG_BARS.filter((b) => Number(g?.[`${b}_full_at` as const]) > 0);
  for (const b of WG_BARS) {
    if (locked.includes(b) || !(hp[b] > 0)) continue;
    if (rows.reduce((a, r) => a + barVal(r, b), 0) < hp[b]) continue;
    // full: write everyone's part first (a reader that sees the stamp finds the locks), then stamp it
    const parts = rows.filter((r) => barVal(r, b) > 0);
    for (let i = 0; i < parts.length; i += 20) {
      const chunk = parts.slice(i, i + 20);
      await env.DB.prepare('INSERT OR IGNORE INTO world_gate_bar_locks (week_start, bar, user_id, value) VALUES '
        + chunk.map(() => '(?, ?, ?, ?)').join(', '))
        .bind(...chunk.flatMap((r) => [week, b, r.user_id, barVal(r, b)])).run();
    }
    await env.DB.prepare(`UPDATE world_gates SET ${b}_full_at = ? WHERE week_start = ? AND ${b}_full_at IS NULL`).bind(Date.now(), week).run();
    locked.push(b);
  }
  if (!locked.length) return;
  const lr = await env.DB.prepare('SELECT bar, user_id, value FROM world_gate_bar_locks WHERE week_start = ?')
    .bind(week).all<{ bar: string; user_id: string; value: number }>();
  const got = lr.results ?? [];
  const m = new Map<string, number>(got.map((x) => [x.bar + '|' + x.user_id, Math.max(0, Number(x.value) || 0)]));
  for (const b of locked) {
    if (!got.some((x) => x.bar === b)) continue;   // stamped but no locks to read (cannot happen; never zero a bar)
    for (const r of rows) { const v = m.get(b + '|' + r.user_id) || 0; if (b === 'steps') r.steps = v; else r[b] = v; }
  }
}
/** W1283 — every hunter of a three-bar week with their steps, flights, sleep and damage, best first, and the three pools.
 *  W1323 — a filled bar reads its locks. */
async function standings3(env: Env, week: string, hp: Bars): Promise<{ rows: Standing[]; pool: Bars }> {
  const steps = await standingsOf(env, week);
  const eff = (await env.DB.prepare(
    `SELECT x.user_id AS user_id, x.flights AS flights, x.sleep_min AS sleep_min, x.alias AS alias, pps.rank_tier AS rank_tier
       FROM (${WG_EFFORT}) x LEFT JOIN public_profile_summary pps ON pps.user_id = x.user_id`,
  ).bind(week).all<{ user_id: string; flights: number; sleep_min: number; alias: string; rank_tier: string | null }>()).results ?? [];
  const by = new Map<string, Standing>();
  for (const s of steps) by.set(s.user_id, { ...s, flights: 0, sleep: 0 });
  for (const e of eff) {
    const f = Math.max(0, Number(e.flights) || 0), z = Math.max(0, Number(e.sleep_min) || 0);
    if (!f && !z) continue;
    const row = by.get(e.user_id) ?? { user_id: e.user_id, alias: e.alias, rank_tier: e.rank_tier ?? null, steps: 0, flights: 0, sleep: 0 };
    row.flights = f; row.sleep = z;
    by.set(e.user_id, row);
  }
  const rows = Array.from(by.values());
  await applyBarLocks(env, week, hp, rows);   // W1323
  const pool: Bars = {
    steps: rows.reduce((a, r) => a + r.steps, 0),
    flights: rows.reduce((a, r) => a + (r.flights || 0), 0),
    sleep: rows.reduce((a, r) => a + (r.sleep || 0), 0),
  };
  for (const r of rows) r.pct = pct2(damagePct({ steps: r.steps, flights: r.flights || 0, sleep: r.sleep || 0 }, hp, pool));
  return { rows: rows.sort(byPct), pool };
}
const gateBars = (g: GateRow): Bars => ({ steps: g.hp, flights: Number(g.hp_flights) || 0, sleep: Number(g.hp_sleep) || 0 });

/** Freeze every hunter's damage, the latest strikes, the pool and the headcount of `week` into its gate row. */
async function snapshotKill(env: Env, week: string, hp?: Bars): Promise<KillSnap> {
  if (hp) {   // W1283 — a three-bar kill: the podium and the Kill Wall by damage, each bar frozen
    const [s3, recent3] = await Promise.all([standings3(env, week, hp), recentStrikes(env, week, null)]);
    const snap3: KillSnap = {
      pool: s3.pool.steps,
      hunters: s3.rows.length,
      mvps: s3.rows.slice(0, 3),
      standings: s3.rows,
      recent: recent3,
      bars: { hp, pool: s3.pool },
    };
    await env.DB.prepare('UPDATE world_gates SET kill_json = ? WHERE week_start = ?').bind(JSON.stringify(snap3), week).run();
    return snap3;
  }
  const [standings, recent] = await Promise.all([standingsOf(env, week), recentStrikes(env, week, null)]);
  const agg = await env.DB.prepare(
    `${WG_MERGED} SELECT COUNT(*) AS kill_hunters, COALESCE(SUM(steps), 0) AS kill_pool FROM merged`,
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
  const snap = await snapshotKill(env, gate.week_start, isThree(gate) ? gateBars(gate) : undefined);
  gate.kill_json = JSON.stringify(snap);
  return snap;
}
/** A hunter's damage on a frozen kill (0 when they had struck nothing by then). */
function frozenDamage(snap: KillSnap, userId: string): number {
  const r = (snap.standings || []).find((s) => s.user_id === userId);
  return r ? r.steps : 0;
}
/** W1283 — a hunter's row on a frozen three-bar kill (null when they had put in nothing by then). */
function frozenRow(snap: KillSnap, userId: string): Standing | null {
  return (snap.standings || []).find((s) => s.user_id === userId) ?? null;
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
    `${WG_MERGED} SELECT COALESCE(SUM(steps), 0) AS pool FROM merged`,
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

/** How many gates in a row the fleet has LOST, newest first (drives the easing, W1031). */
async function lossStreak(env: Env, beforeWeek: string): Promise<number> {
  const rows = await env.DB.prepare(
    'SELECT status FROM world_gates WHERE week_start < ? ORDER BY week_start DESC LIMIT 8',
  ).bind(beforeWeek).all<{ status: string }>();
  let n = 0;
  for (const r of rows.results ?? []) { if (r.status === 'survived') n++; else break; }
  return n;
}

/** Get-or-create this week's gate; settle LAST week's gate on first sight. */
async function ensureGate(env: Env, week: string): Promise<GateRow> {
  let gate = await env.DB.prepare('SELECT * FROM world_gates WHERE week_start = ?').bind(week).first<GateRow>();
  if (gate && gate.status === 'open' && gate.week_start >= WG3_FROM && (gate.hp_flights == null || gate.hp_sleep == null)) {
    // W1284 — a gate made before the three bars began (this week's, made steps only) gets its flights and sleep bars.
    await env.DB.prepare('UPDATE world_gates SET hp_flights = ?, hp_sleep = ? WHERE week_start = ? AND hp_flights IS NULL')
      .bind(WG3_START_FLIGHTS, WG3_START_SLEEP, week).run();
    gate = { ...gate, hp_flights: WG3_START_FLIGHTS, hp_sleep: WG3_START_SLEEP };
  }
  if (gate) return gate;
  // Settle the most recent prior open gate.
  const prior = await env.DB.prepare(
    "SELECT * FROM world_gates WHERE status = 'open' AND week_start < ? ORDER BY week_start DESC LIMIT 1",
  ).bind(week).first<GateRow>();
  if (prior) {
    const priorPool = await weeklyPool(env, prior.week_start);
    // W1283 — a three-bar gate falls only when all three bars are spent.
    const priorDown = isThree(prior)
      ? barsDown(gateBars(prior), { steps: priorPool, ...(await effortPools(env, prior.week_start)) })
      : priorPool >= prior.hp;
    if (priorDown) {
      await env.DB.prepare("UPDATE world_gates SET status = 'slain', slain_at = ? WHERE week_start = ? AND status = 'open'")
        .bind(Date.now(), prior.week_start).run();
      await snapshotKill(env, prior.week_start, isThree(prior) ? gateBars(prior) : undefined);   // W975 — its final standings are the podium
    } else {
      await env.DB.prepare("UPDATE world_gates SET status = 'survived' WHERE week_start = ? AND status = 'open'")
        .bind(prior.week_start).run();
    }
  }
  // W1031 — sized by how the last gate went (it may have been beaten mid-week, so it is
  // read again here, settled, rather than taken from `prior`, which only finds an OPEN one).
  const [pools, last, losses] = await Promise.all([
    recentPools(env, week),
    env.DB.prepare('SELECT week_start, hp, hp_flights, hp_sleep, status, slain_at FROM world_gates WHERE week_start < ? ORDER BY week_start DESC LIMIT 1')
      .bind(week).first<{ week_start: string; hp: number; hp_flights: number | null; hp_sleep: number | null; status: string; slain_at: number | null }>(),
    lossStreak(env, week),
  ]);
  let hp = computeNextGateHp(pools, last ?? null, losses);
  if (week >= WG3_FROM) {
    // W1283 — a three-bar gate: flights and sleep sized from the last three-bar gate (or the start values), and after a
    // three-bar gate that stood, a spent steps bar keeps its size instead of easing.
    // W1323 — after a settled three-bar gate every bar is sized on its own from the forecast (computeNextBarsForecast):
    // its week's raw totals and the week before's.
    const lastThree = last && isThree(last) && (last.status === 'slain' || last.status === 'survived') ? last : null;
    let bars: { flights: number; sleep: number } = { flights: WG3_START_FLIGHTS, sleep: WG3_START_SLEEP };
    if (lastThree) {
      const before = prevWeekOf(lastThree.week_start);
      const [doneSteps, doneEff, prevSteps, prevEff] = await Promise.all([
        weeklyPool(env, lastThree.week_start), effortPools(env, lastThree.week_start),
        weeklyPool(env, before), before >= WG3_FROM ? effortPools(env, before) : Promise.resolve(null),
      ]);
      const next = computeNextBarsForecast(gateBars(lastThree as GateRow), { steps: doneSteps, ...doneEff },
        { steps: prevSteps || null, flights: prevEff ? prevEff.flights || null : null, sleep: prevEff ? prevEff.sleep || null : null }, losses);
      hp = next.steps; bars = { flights: next.flights, sleep: next.sleep };
    }
    try {
      await env.DB.prepare('INSERT INTO world_gates (week_start, hp, hp_flights, hp_sleep, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(week, hp, bars.flights, bars.sleep, 'open', Date.now()).run();
    } catch { /* raced — another reader created it */ }
  } else {
  try {
    await env.DB.prepare('INSERT INTO world_gates (week_start, hp, status, created_at) VALUES (?, ?, ?, ?)')
      .bind(week, hp, 'open', Date.now()).run();
  } catch { /* raced — another reader created it */ }
  }
  gate = await env.DB.prepare('SELECT * FROM world_gates WHERE week_start = ?').bind(week).first<GateRow>();
  return gate as GateRow;
}

/** Accepted friends of the caller — the caller's "guild" for the Worldgate. */
// W1076 — the CASE carries the alias `id` because the two SELECT-FROM-(subquery) readers
// below name the column: SQLite has no `AS f(id)` column list, so both of them were a
// syntax error in production (the rally horn 500'd after burning its once-a-day row, and
// the sheet 500'd for the rest of the week after every kill).
const FRIENDS_OF = `SELECT CASE WHEN f.requester_user_id = ?2 THEN f.recipient_user_id ELSE f.requester_user_id END AS id
                      FROM friends f
                     WHERE f.status = 'accepted' AND (f.requester_user_id = ?2 OR f.recipient_user_id = ?2)`;

function ptDayNow(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

/** W975 — the kill to announce: this week's gate if it fell, else last week's (a gate stamped at the Sunday rollover is
 *  only ever seen from the new week). W1283 — a three-bar kill names its MVPs by damage and carries each hunter's share. */
async function killAnnouncement(
  env: Env, gate: GateRow, week: string, frozenKill: KillSnap | null, userId: string,
): Promise<{ kill: Record<string, unknown> | null; myPlace: number }> {
  let killGate: GateRow | null = gate.status === 'slain' ? gate : null;   // (its record is frozenKill)
  if (!killGate) {
    const prev = await env.DB.prepare("SELECT * FROM world_gates WHERE week_start = ? AND status = 'slain'")
      .bind(prevWeekOf(week)).first<GateRow>();
    killGate = prev || null;
  }
  if (!killGate) return { kill: null, myPlace: 0 };
  const snap = killGate === gate && frozenKill ? frozenKill : await killSnap(env, killGate);
  if (!snap) return { kill: null, myPlace: 0 };
  const place = snap.mvps.findIndex((m) => m.user_id === userId) + 1;
  const myPlace = killGate.week_start === week ? place : 0;
  if (snap.bars) {   // W1283
    const row = frozenRow(snap, userId);
    const mine = row ? row.pct || 0 : 0;
    const above = (snap.standings || []).filter((s) => (s.pct || 0) > mine).length;
    return {
      myPlace,
      kill: {
        week: killGate.week_start,
        slain_at: Number(killGate.slain_at) || 0,
        pool: snap.pool,
        hunters: snap.hunters,
        mvps: snap.mvps.map((m) => ({ alias: m.alias, rank_tier: m.rank_tier, steps: m.steps, flights: m.flights || 0, sleep: m.sleep || 0, pct: m.pct || 0 })),
        my_place: place,
        my_steps: row ? row.steps : 0,
        my_pct: mine,
        my_pos: mine > 0 ? above + 1 : null,
        mvp_bonus: WORLDGATE_MVP_BONUS,
        bars: snap.bars,
      },
    };
  }
  let kMine = 0, kAbove = 0;
  if (Array.isArray(snap.standings)) {   // W983 — your steps AT the kill
    kMine = frozenDamage(snap, userId);
    kAbove = snap.standings.filter((s) => s.steps > kMine).length;
  } else {
    const kw = await env.DB.prepare(
      `${WG_MERGED}
       SELECT (SELECT steps FROM merged WHERE user_id = ?2) AS mine,
              (SELECT COUNT(*) FROM merged WHERE steps > COALESCE((SELECT steps FROM merged WHERE user_id = ?2), 0)) AS above_kill`,
    ).bind(killGate.week_start, userId).first<{ mine: number | null; above_kill: number }>();
    kMine = Number(kw?.mine) || 0; kAbove = Number(kw?.above_kill) || 0;
  }
  return {
    myPlace,
    kill: {
      week: killGate.week_start,
      slain_at: Number(killGate.slain_at) || 0,
      pool: snap.pool,
      hunters: snap.hunters,
      mvps: snap.mvps.map((m) => ({ alias: m.alias, rank_tier: m.rank_tier, steps: m.steps })),
      my_place: place,
      my_steps: kMine,
      my_pos: kMine > 0 ? kAbove + 1 : null,
      mvp_bonus: WORLDGATE_MVP_BONUS,
    },
  };
}

/** W1283 — the GET answer for a three-bar gate: the three bars, damage instead of steps on every list, the Kill Wall by
 *  damage. The steps-only fields stay (steps) so an older build still shows a steps bar. */
async function threeBarAnswer(
  env: Env, session: SessionPayload, week: string, gate: GateRow, frozenKill: KillSnap | null,
  claimed: boolean, myDays: number, iCount: boolean, myDamage: number, pendingSteps: number,
): Promise<Response> {
  const hpB = gateBars(gate);
  const fz = frozenKill && frozenKill.bars && Array.isArray(frozenKill.standings) ? frozenKill : null;
  let rows: Standing[], poolB: Bars, recent: Strike[];
  if (fz) { rows = fz.standings as Standing[]; poolB = (fz.bars as { pool: Bars }).pool; recent = fz.recent || []; }
  else {
    const s3 = await standings3(env, week, hpB);
    rows = s3.rows; poolB = s3.pool; recent = await recentStrikes(env, week, null);
  }
  const me = rows.find((r) => r.user_id === session.userId) ?? null;
  const myPct = me ? me.pct || 0 : 0;
  let pendF = 0, pendS = 0;   // the two-day rule: what waits to count
  if (!fz && !iCount) {
    const e = await env.DB.prepare('SELECT flights, sleep_min FROM world_gate_effort WHERE week_start = ? AND user_id = ?')
      .bind(week, session.userId).first<{ flights: number; sleep_min: number }>();
    pendF = Number(e?.flights) || 0; pendS = Number(e?.sleep_min) || 0;
  }
  const friends = await env.DB.prepare(`SELECT id FROM (${FRIENDS_OF.replace(/\?2/g, '?1')}) AS f`)
    .bind(session.userId).all<{ id: string }>();
  const fids = new Set((friends.results ?? []).map((r) => r.id));
  const g = rows.filter((r) => fids.has(r.user_id));
  const onWall = rows.filter((r) => (r.pct || 0) >= WG3_WALL_PCT);
  const rallied = await env.DB.prepare('SELECT sent FROM world_gate_rallies WHERE user_id = ? AND day = ?')
    .bind(session.userId, ptDayNow()).first<{ sent: number }>();
  const { kill, myPlace } = await killAnnouncement(env, gate, week, frozenKill, session.userId);
  const mySteps = fz ? (me ? me.steps : 0) : myDamage;
  return jsonOk({
    ok: true, week_start: week, hp: gate.hp, pool: Math.min(poolB.steps, hpB.steps), status: gate.status,   // W1323 — never past the HP
    my_damage: mySteps,
    my_days: myDays, days_needed: WORLDGATE_MIN_DAYS, pending_steps: pendingSteps,
    claim_floor: WORLDGATE_CLAIM_FLOOR, souls: WORLDGATE_SOULS,
    claimable: gate.status === 'slain' && !claimed && (myPct >= WG3_WALL_PCT || myPlace > 0),
    claimed: !!claimed,
    hunters: rows.length,
    guild: { steps: g.reduce((a, r) => a + r.steps, 0), hunters: g.length, pct: pct2(g.reduce((a, r) => a + (r.pct || 0), 0)) },
    my_rank: myPct > 0 ? rows.filter((r) => (r.pct || 0) > myPct).length + 1 : null,
    top: rows.slice(0, WORLDGATE_TOP).map((r) => ({
      alias: r.alias, steps: r.steps, flights: r.flights || 0, sleep: r.sleep || 0, pct: r.pct || 0, rank_tier: r.rank_tier, me: r.user_id === session.userId,
    })),
    wall: onWall.slice(0, WORLDGATE_WALL_MAX).map((r) => ({ alias: r.alias, steps: r.steps, pct: r.pct || 0 })),
    wall_count: onWall.length,
    recent,
    rallied_today: !!rallied,
    kill,
    // W1283 — the three bars (sleep in minutes), the gate's damage, yours, the Kill Wall line and the bounty's odds
    bars: {
      // W1323 — a bar reads at most its HP (313h of 300h read 300h of 300h)
      steps: { hp: hpB.steps, pool: Math.min(poolB.steps, hpB.steps), my: mySteps },
      flights: { hp: hpB.flights, pool: Math.min(poolB.flights, hpB.flights), my: me ? me.flights || 0 : 0 },
      sleep: { hp: hpB.sleep, pool: Math.min(poolB.sleep, hpB.sleep), my: me ? me.sleep || 0 : 0 },
    },
    pct: pct2(overallPct(hpB, poolB)),
    my_pct: pct2(myPct),
    wall_pct: WG3_WALL_PCT,
    pending_flights: pendF,
    pending_sleep: pendS,
    drop_odds: { s_tier: WG3_DROP_S, mythic: WG3_DROP_MYTHIC },
    effort: gate.status === 'open',   // the phone sends its flights and sleep while the gate stands
  });
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
  // First read past the line stamps the kill. W1283 — a three-bar gate needs all three bars spent.
  const three = isThree(gate);
  const down = gate.status === 'open' && (three
    ? pool >= gate.hp && barsDown(gateBars(gate), { steps: pool, ...(await effortPools(env, week)) })
    : pool >= gate.hp);
  if (down) {
    const now = Date.now();
    const stamp = await env.DB.prepare("UPDATE world_gates SET status = 'slain', slain_at = ?, slain_by = ? WHERE week_start = ? AND status = 'open'")
      .bind(now, session.userId, week).run();
    gate.status = 'slain';
    if (!gate.slain_at) gate.slain_at = now;
    // W975 — the request that stamps the kill freezes the podium. A raced
    // stamp leaves it to killSnap's first-read freeze a moment later.
    if (stamp && stamp.meta && Number(stamp.meta.changes) >= 1) {
      try { gate.kill_json = JSON.stringify(await snapshotKill(env, week, three ? gateBars(gate) : undefined)); } catch { /* frozen on next read */ }
    }
  }
  // W983 — once the gate falls, the gate is done counting: every number below
  // comes from the kill's frozen record, never from steps walked after it.
  const frozenKill = gate.status === 'slain' ? await killSnap(env, gate) : null;
  const fz = frozenKill && Array.isArray(frozenKill.standings) ? frozenKill : null;
  const claimed = await env.DB.prepare(
    'SELECT 1 FROM world_gate_claims WHERE week_start = ? AND user_id = ?',
  ).bind(week, session.userId).first();
  // W1134 — the days this hunter has opened the app this week; under WORLDGATE_MIN_DAYS their steps
  // wait (pending_steps) and strike nothing.
  let myDays = 0;
  try {
    const d = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM app_open_counts WHERE user_id = ?1 AND day_pt >= ?2 AND day_pt <= date(?2, '+6 days') AND opens > 0",
    ).bind(session.userId, week).first<{ n: number }>();
    myDays = Number(d?.n) || 0;
  } catch { myDays = 0; }
  const iCount = week < WORLDGATE_DAYS_FROM || myDays >= WORLDGATE_MIN_DAYS;
  let myDamage: number;
  let pendingSteps = 0;
  if (fz) myDamage = frozenDamage(fz, session.userId);
  else {
    const mine = await env.DB.prepare(
      "SELECT current_value FROM leaderboard_snapshots WHERE user_id = ? AND metric = 'step_total' AND week_start = ?",
    ).bind(session.userId, week).first<{ current_value: number }>();
    const walked = mine?.current_value ?? 0;
    myDamage = iCount ? walked : 0;
    pendingSteps = iCount ? 0 : walked;
  }
  if (three) return threeBarAnswer(env, session, week, gate, frozenKill, !!claimed, myDays, iCount, myDamage, pendingSteps);   // W1283

  // ── W916 — the v2 read side: who is striking, your guild's share, the top
  // strikers + your placement, the Kill Wall, the latest strikers. All from the
  // merged weekly view (sims excluded), one round trip each, no new schema.
  let agg: { hunters: number; guild_steps: number; guild_hunters: number; above: number; wall_count: number } | null;
  let top: Array<{ alias: string; steps: number; rank_tier: string | null; me: boolean }>;
  let wall: Array<{ alias: string; steps: number }>;
  let recent: Strike[];
  if (fz) {
    const st = fz.standings as Standing[];
    const friends = await env.DB.prepare(`SELECT id FROM (${FRIENDS_OF.replace(/\?2/g, '?1')}) AS f`)
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
    `${WG_MERGED}
     SELECT (SELECT COUNT(*) FROM merged) AS hunters,
            (SELECT COALESCE(SUM(steps), 0) FROM merged WHERE user_id IN (${FRIENDS_OF})) AS guild_steps,
            (SELECT COUNT(*) FROM merged WHERE user_id IN (${FRIENDS_OF})) AS guild_hunters,
            (SELECT COUNT(*) FROM merged WHERE steps > ?3) AS above,
            (SELECT COUNT(*) FROM merged WHERE steps >= ?4) AS wall_count`,
  ).bind(week, session.userId, myDamage, WORLDGATE_CLAIM_FLOOR)
    .first<{ hunters: number; guild_steps: number; guild_hunters: number; above: number; wall_count: number }>();
  const topRows = await env.DB.prepare(
    `${WG_MERGED}
     SELECT u.alias AS alias, m.steps AS steps, pps.rank_tier AS rank_tier, (m.user_id = ?2) AS me
       FROM merged m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN public_profile_summary pps ON pps.user_id = m.user_id
      ORDER BY m.steps DESC, u.alias ASC
      LIMIT ?3`,
  ).bind(week, session.userId, WORLDGATE_TOP).all<{ alias: string; steps: number; rank_tier: string | null; me: number }>();
  const wallRows = await env.DB.prepare(
    `${WG_MERGED}
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

  const { kill, myPlace } = await killAnnouncement(env, gate, week, frozenKill, session.userId);

  return jsonOk({
    ok: true, week_start: week, hp: gate.hp, pool: fz ? fz.pool : pool, status: gate.status,
    my_damage: myDamage,
    // W1134 — the two-day rule: days opened this week, days needed, steps waiting to count
    my_days: myDays, days_needed: week < WORLDGATE_DAYS_FROM ? 0 : WORLDGATE_MIN_DAYS, pending_steps: pendingSteps,
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
  const pct = isThree(gate)   // W1283 — the three bars' damage
    ? Math.max(0, Math.min(100, Math.round(overallPct(gateBars(gate), { steps: pool, ...(await effortPools(env, week)) }))))
    : Math.max(0, Math.min(100, Math.round((pool / Math.max(1, gate.hp)) * 100)));
  // W1076 — at most 200 friends per horn: each push is a few subrequests.
  const friends = await env.DB.prepare(`SELECT id FROM (${FRIENDS_OF.replace(/\?2/g, '?1')}) AS f LIMIT 200`)
    .bind(session.userId).all<{ id: string }>();
  const ids = (friends.results ?? []).map((r) => r.id);
  await env.DB.prepare('UPDATE world_gate_rallies SET sent = ? WHERE user_id = ? AND day = ?').bind(ids.length, session.userId, day).run();
  const body = gate.status === 'slain'
    ? `${session.alias} sounds the horn: the Worldgate is DOWN this week. Come collect your share.`
    : isThree(gate)
    ? `${session.alias} rallies you: the Worldgate is ${pct}% down. Every step, flight and hour of sleep is a strike.`
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
  // W1283 — a three-bar kill: the Kill Wall is damage (% of the kill) at the kill, not steps.
  const three = !!(snap && snap.bars);
  const pctAtKill = three && snap ? ((frozenRow(snap, session.userId) || { pct: 0 }).pct || 0) : 0;
  const onWall = three ? pctAtKill >= WG3_WALL_PCT : atKill >= WORLDGATE_CLAIM_FLOOR;
  const bounty = onWall ? WORLDGATE_SOULS : 0;
  const bonus = place > 0 ? (WORLDGATE_MVP_BONUS[place - 1] ?? 0) : 0;
  if (!bounty && !bonus) {
    return jsonError(403, 'TOO_LITTLE_DAMAGE', three
      ? 'The bounty asks ' + WG3_WALL_PCT + '% of the kill.'
      : 'The bounty asks ' + WORLDGATE_CLAIM_FLOOR.toLocaleString('en-US') + ' verified steps this week.');
  }
  // W1284 — an app older than the three bars cannot grant the bounty's relic rolls (it drops them), so a three-bar
  // bounty waits for the update: nothing is recorded, and the claim succeeds from the new app.
  if (three && !(await knowsThreeBars(env, session.userId))) {
    return jsonError(409, 'UPDATE_APP', 'Update Awakened to collect this bounty.');
  }
  // W1283 — owner: "everyone on the kill wall gets 200 souls each + 1% chance at any S-tier item drop + 0.5% on the mythic
  // drop". Two rolls, rolled here once (the claim row records them), for every hunter on the Kill Wall. The phone picks
  // the relic from its own catalog: any S-rank boss's relic, or one of the three mythic weapons.
  const drops: string[] = [];
  if (three && onWall) {
    if (wgDice.next() < WG3_DROP_S) drops.push('s_tier');
    if (wgDice.next() < WG3_DROP_MYTHIC) drops.push('mythic');
  }
  try {
    await env.DB.prepare('INSERT INTO world_gate_claims (week_start, user_id, claimed_at' + (three ? ', drops' : '') + ') VALUES (?, ?, ?' + (three ? ', ?' : '') + ')')
      .bind(...(three ? [week, session.userId, Date.now(), drops.join(',')] : [week, session.userId, Date.now()])).run();
  } catch {
    return jsonOk({ ok: true, first: false, souls: 0, bounty: 0, mvp_bonus: 0, mvp_place: place, drops: [] });   // already claimed
  }
  return jsonOk({ ok: true, first: true, souls: bounty + bonus, bounty, mvp_bonus: bonus, mvp_place: place, ...(three ? { drops } : {}) });
}

/** W1284 — the build number in an APP_BUILD_TAG ('3.0.29-w1283' → 1283), 0 when there is none. */
export function buildNumberOf(tag: string | null | undefined): number {
  const m = /-w(\d+)/i.exec(String(tag || ''));
  return m ? Number(m[1]) || 0 : 0;
}
/** W1284 — the hunter's newest app (its last app-open ping) knows the three bars. */
async function knowsThreeBars(env: Env, userId: string): Promise<boolean> {
  const r = await env.DB.prepare('SELECT build FROM app_opens WHERE user_id = ? AND build IS NOT NULL ORDER BY opened_at DESC LIMIT 1')
    .bind(userId).first<{ build: string | null }>();
  return buildNumberOf(r?.build) >= WG3_MIN_BUILD;
}

/** W1283 — the days of `week` (YYYY-MM-DD, a Sunday) that have begun by Pacific `today`: 0 before it, up to 7. */
export function wgDaysBegun(week: string, today: string): number {
  const a = Date.parse(week + 'T00:00:00Z'), b = Date.parse(today + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.min(7, Math.round((b - a) / 86400000) + 1);
}
/** W1283 — a day list from the phone, capped: at most `days` entries (plus one, for a phone east of Pacific time already
 *  on the next day), each a whole number from 0 to `cap`. */
export function wgCapDays(list: unknown, days: number, cap: number): number {
  if (!Array.isArray(list)) return 0;
  let sum = 0;
  for (let i = 0; i < Math.min(7, days + 1, list.length); i++) {
    const v = Math.floor(Number(list[i]));
    if (Number.isFinite(v) && v > 0) sum += Math.min(cap, v);
  }
  return sum;
}

/**
 * W1283 — POST /v1/worldgate/effort { week, flights: [7 days], sleep: [7 nights, minutes] }: the phone's flights and
 * minutes asleep for each day of the gate week (Sunday first; a night belongs to the day it ends). The server caps every
 * day (WG3_FLIGHTS_DAY_CAP flights, WG3_SLEEP_NIGHT_CAP minutes), counts only the days begun, and never lowers a total.
 * A phone on another week, or a week before the three bars, is answered and ignored.
 */
export async function handleWorldgateEffort(request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_FRIENDS_WRITE.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  let body: { week?: unknown; flights?: unknown; sleep?: unknown };
  try { body = await request.json() as typeof body; } catch { return jsonError(400, 'BAD_JSON', 'Bad body.'); }
  const week = ptWeekStartNow();
  if (String(body?.week || '') !== week || week < WG3_FROM) return jsonOk({ ok: true, counted: false });
  const days = wgDaysBegun(week, ptDayNow());
  const flights = wgCapDays(body.flights, days, WG3_FLIGHTS_DAY_CAP);
  const sleep = wgCapDays(body.sleep, days, WG3_SLEEP_NIGHT_CAP);
  await env.DB.prepare(
    `INSERT INTO world_gate_effort (week_start, user_id, flights, sleep_min, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(week_start, user_id) DO UPDATE SET flights = MAX(flights, excluded.flights), sleep_min = MAX(sleep_min, excluded.sleep_min),
       updated_at = excluded.updated_at`,
  ).bind(week, session.userId, flights, sleep, Date.now()).run();
  return jsonOk({ ok: true, counted: true, flights, sleep });
}
