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
 *   flights(hunter)  = the phone's own 14-day flights-a-day average (W1195, app_opens.flights_avg,
 *                      newest in the last 7 days; null on builds before w1195)
 *   pair pattern     = the sum of each
 *   boss             = the best one-day duo boss both ranks allow whose printed goals all fit
 *                      AUTO_FIT × the pair's averages, best first: The Sundered Choir (B, steps +
 *                      flights), The Hollow Monarch (B, flights), The Gaunt Wardens (C, steps +
 *                      flights), The Coursing Dread (C, steps), The Twin Maw (E, steps). A boss
 *                      that asks for flights needs both hunters' flights averages.
 *                      If none fits, The Twin Maw with its goal sized to AUTO_FIT × pair pattern
 *                      (nearest 100, floor 2,000). The instance row carries the goal, and
 *                      both isGoalMet and every client view read the row, not the catalog.
 *
 * W1195 (owner 2026-11-13: "get the averages of the users and then pick the closest duo boss for
 * the automated so it isn't just twin maw or coursing dread all the time ... even automate steps +
 * flights if a user averages flights per day ... choose the best boss to automate that is within
 * 80% of the averages of the two users"): AUTO_FIT 0.75 → 0.8, the three flights bosses join the
 * list, and the phones send their flights average. The two-day duos (The Unresting March, The
 * Cloven Titan) stay out: an automatic hunt is one Pacific day.
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
 *
 * W1207 (owner 2026-11-14: "if both hunters already own all the ultra rares from this duo boss,
 * move onto another step boss that can be completed together .. lesser or better boss on
 * automation"): a boss whose every ultra rare BOTH hunters already own (cloud save hb_inventory,
 * count > 0 — a sold last copy counts as not owned) is passed over for the next boss in the list
 * that still fits. A better boss is already the pick whenever it fits, so the move is down the
 * list. When every boss that fits is spent for both, the best of them still runs: the day's hunt
 * keeps the Pact Flame and pays its souls and rares.
 *
 * W1208 — AUTOMATIC TRIOS (owner 2026-11-14: "Throw in some trio bosses in the automatic list as
 * well"). On top of the duos, each hunter can be in ONE automatic trio a day, on one of the four
 * one-day steps trios (The Trinity Colossus A, The Triune Sentinel B, The Threefold Court C, The
 * Crossroads Hound D), picked by the same rules: every hunter's rank allows it, the goal fits
 * AUTO_FIT × the three's combined daily pattern, a boss whose ultra rares all three already own
 * is passed over (W1207). Nothing fits → The Crossroads Hound sized to the three's walking
 * (floor AUTO_TRIO_MIN_GOAL). An E-rank hunter is never put in one (no trio boss is open to E).
 * Who: three eligible hunters (the duo gates) where one is friends with both others — the same
 * consent as a summoned trio (W677: a summoner and two of their friends) — with no block or
 * switch-off between any two of them. Yesterday's trios are kept while all three stay eligible
 * (their Pact Flames can grow), then trios of three mutual friends, then the strongest walkers.
 *
 * W1209 — MIXED AND COLLECTED (owner 2026-11-14: "I just want to mix up the automations ...
 * everyday the twin maw was just getting beat by everyone and just getting the same reward every
 * time. If we can mix it up and make sure users maximize by getting all the drops"). Among the
 * bosses a group can finish (the fit and rank rules above, unchanged), choosePick takes: a boss
 * someone in the group still lacks a drop from (rare or ultra rare, AUTO_BOSS_DROPS), when there
 * is one; then the one fewest of the group are already on in today's automatic hunts (one hunter's
 * friends don't all land on the same boss); then the one the group hunted longest ago (its own last
 * AUTO_HISTORY_DAYS); then the best. W1207's ultra-only rule is folded in: a boss is passed over
 * only when every hunter in the group owns ALL its drops.
 *
 * W1210 — MORE TRIOS FOR MORE FRIENDS (owner 2026-11-14: "Allow for 2-3 different trio bosses for
 * people with multiple friends like me or anthony ... reward people with a lot of friends"). A
 * hunter can now be in up to AUTO_TRIOS_PER_HUNTER (3) automatic trios a day, never the same three
 * twice in a day. After kept and mutual-friend trios, the next trio is the one that groups the
 * fewest pairs already grouped today, so a hunter's trios bring in different friends; W1209's today
 * rule then spreads their bosses.
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
/** One-day duo bosses, best first (W1195: the flights bosses join; sleep duos still wait). */
export const AUTO_BOSSES: readonly string[] = ['the_sundered_choir', 'the_hollow_monarch', 'the_gaunt_wardens', 'the_coursing_dread', 'the_twin_maw'];
/** W1209 — every drop of each automatic boss (rare + ultra rare; co-op pools have no commons), from
 *  the client catalog: the items whose source_boss is the boss, or the boss's own pool (W1104). A
 *  test reads app.js so the two cannot drift. */
export const AUTO_BOSS_DROPS: Readonly<Record<string, readonly string[]>> = {
  the_sundered_choir: ['the_choirmasters_vestment', 'the_discordant_crown', 'the_sundered_grips', 'the_antiphon_striders'],
  the_hollow_monarch: ['the_hollow_crown', 'the_monarchs_writ', 'crownpiercer'],
  the_gaunt_wardens: ['the_wardens_vigil', 'the_stairwalkers_treads', 'the_famished_circlet', 'the_gaunt_mantle'],
  the_coursing_dread: ['the_long_pursuit', 'houndsfang_recurve', 'coursing_houndcall'],
  the_twin_maw: ['bothsight_longbow', 'twin_fang_cleaver', 'twofold_gaze'],
  // the trios: the Court has its own relics; the other three pool their rank's spoils (W1104)
  the_trinity_colossus: [
    'striders_of_the_tideless_road', 'mantle_of_the_long_vigil', 'amulet_of_the_endless_stair', 'skyward_vigil_ring',
    'duskforge_greatblade', 'aetherspire_staff', 'wraithwind_bow', 'forgewarden_gauntlets',
    'band_of_the_roadkeeper', 'restplate_of_the_wanderer', 'nightcrown_of_the_climb', 'ascent_worn_cloak',
    'anvilrest_cuirass', 'charm_of_the_emberkeeper',
  ],
  the_triune_sentinel: [
    'the_hollow_crown', 'the_choirmasters_vestment', 'gauntlets_of_ten_thousand_days', 'amulet_of_the_kept_word',
    'ember_ledger_of_the_patient_flame',
    'the_monarchs_writ', 'crownpiercer', 'the_discordant_crown', 'the_sundered_grips', 'the_antiphon_striders',
    'hammerfall_warmaul', 'ring_of_the_unbroken_vow', 'boots_of_the_long_road',
  ],
  the_threefold_court: ['vestments_of_the_final_verdict', 'courthunters_grips', 'seal_of_the_threefold_court'],
  the_crossroads_hound: [
    'roadwardens_harness', 'titan_oathblade', 'horizon_step_ring', 'crown_of_deep_rest',
    'milestone_cowl', 'longroad_grips', 'wardens_plate', 'glass_path_boots', 'tyrants_sleep_mask',
  ],
};
/** W1208 — the one-day steps trios, best first. */
export const AUTO_TRIO_BOSSES: readonly string[] = ['the_trinity_colossus', 'the_triune_sentinel', 'the_threefold_court', 'the_crossroads_hound'];
export const AUTO_TRIO_SIZED_BOSS = 'the_crossroads_hound';
/** W1208 — a sized trio never asks less than 1,000 steps a hunter. */
export const AUTO_TRIO_MIN_GOAL = 3000;
/** W1182 — 0.9 → 0.75: at 90% of a pair's usual walking, any slow day lost the hunt (39% lost).
 *  W1195 — 0.75 → 0.8: the owner's "within 80% of the averages of the two users". */
export const AUTO_FIT = 0.8;
/** W1195 — a phone's flights average counts for this long after its last app-open ping. */
export const FLIGHTS_AVG_MAX_AGE_S = 7 * 86_400;
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

export interface AutoPick { bossId: string; goalSteps: number; goalFlights?: number }

/** W1209 — what the pick weighs beyond fit, for one group. The defaults (every boss useful, nobody
 *  on anything today, nothing hunted before) give the best boss that fits, as before W1207. */
export interface PickPrefs {
  /** someone in the group still lacks one of the boss's drops */
  useful?: (bossId: string) => boolean;
  /** how many of the group are already on this boss in today's automatic hunts */
  today?: (bossId: string) => number;
  /** the group's last automatic hunt day on this boss, 'YYYY-MM-DD' ('' = never) */
  last?: (bossId: string) => string;
}

/** W1209 — which of the bosses that fit (best first) to hunt: one someone in the group still needs a
 *  drop from, when there is one; then the one fewest of the group are already on today; then the one
 *  the group hunted longest ago; then the best. */
export function choosePick<T extends { bossId: string }>(fits: T[], prefs: PickPrefs = {}): T | null {
  if (!fits.length) return null;
  const useful = prefs.useful ?? (() => true);
  const today = prefs.today ?? (() => 0);
  const last = prefs.last ?? (() => '');
  const need = fits.filter((p) => useful(p.bossId));
  const pool = need.length ? need : fits;
  let best = pool[0];
  for (const p of pool.slice(1)) {
    const d = today(p.bossId) - today(best.bossId);
    if (d < 0 || (d === 0 && last(p.bossId) < last(best.bossId))) best = p;
  }
  return best;
}

/** The boss and goal for a pair: among the bosses both ranks allow whose printed goals all fit
 *  AUTO_FIT × the pair's averages (steps a day; flights a day, null when either phone has not sent
 *  one), the one choosePick takes (W1209); none fits → The Twin Maw sized to the pair's walking.
 *  For a flights boss goalSteps holds the flights, as the catalog and isGoalMet do. */
export function pickAutoBoss(rankA: string, rankB: string, pairPattern: number, pairFlights: number | null = null, prefs: PickPrefs = {}): AutoPick {
  const r = Math.min(RANK_ORDER[rankA] ?? 0, RANK_ORDER[rankB] ?? 0);
  const fit = AUTO_FIT * Math.max(0, Number(pairPattern) || 0);
  const fl = pairFlights == null || !Number.isFinite(Number(pairFlights)) ? null : AUTO_FIT * Math.max(0, Number(pairFlights));
  const fits: AutoPick[] = [];
  for (const bossId of AUTO_BOSSES) {
    const cfg = COOP_BOSS_CFG[bossId];
    if (!cfg || (RANK_ORDER[cfg.rank] ?? 0) > r) continue;
    if (cfg.windowHours !== 24 || (cfg.partySize ?? 2) !== 2) continue;
    if (cfg.metric === 'steps') {
      if (cfg.goalSteps <= fit) fits.push({ bossId, goalSteps: cfg.goalSteps });
    } else if (cfg.metric === 'flights') {
      if (fl !== null && cfg.goalSteps <= fl) fits.push({ bossId, goalSteps: cfg.goalSteps });
    } else if (cfg.metric === 'both') {
      const gf = cfg.goalFlights ?? 0;
      if (fl !== null && cfg.goalSteps <= fit && gf <= fl) fits.push({ bossId, goalSteps: cfg.goalSteps, goalFlights: gf });
    }
  }
  const chosen = choosePick(fits, prefs);
  if (chosen) return chosen;
  const sized = Math.max(AUTO_MIN_GOAL, Math.round(fit / 100) * 100);
  return { bossId: AUTO_SIZED_BOSS, goalSteps: sized };
}

/** W1208 — a trio's boss: among the steps trios every rank allows whose goal fits AUTO_FIT × the
 *  three's combined pattern, the one choosePick takes (W1209); none fits → The Crossroads Hound
 *  sized to the walking; null when no trio boss is open to the lowest rank (E). */
export function pickAutoTrioBoss(ranks: string[], trioPattern: number, prefs: PickPrefs = {}): AutoPick | null {
  const r = Math.min(...ranks.map((k) => RANK_ORDER[k] ?? 0));
  const fit = AUTO_FIT * Math.max(0, Number(trioPattern) || 0);
  const fits: AutoPick[] = [];
  let open = false;
  for (const bossId of AUTO_TRIO_BOSSES) {
    const cfg = COOP_BOSS_CFG[bossId];
    if (!cfg || (RANK_ORDER[cfg.rank] ?? 0) > r) continue;
    if (cfg.windowHours !== 24 || cfg.partySize !== 3 || cfg.metric !== 'steps') continue;
    open = true;
    if (cfg.goalSteps <= fit) fits.push({ bossId, goalSteps: cfg.goalSteps });
  }
  const chosen = choosePick(fits, prefs);
  if (chosen) return chosen;
  if (!open) return null;
  return { bossId: AUTO_TRIO_SIZED_BOSS, goalSteps: Math.max(AUTO_TRIO_MIN_GOAL, Math.round(fit / 100) * 100) };
}

/** W1210 — how many automatic trios one hunter can be in a day (owner 2026-11-14: "give me and
 *  anthony 2-3 automated trio bosses per day ... reward people with a lot of friends"). */
export const AUTO_TRIOS_PER_HUNTER = 3;

/** W1208/W1210 — the day's automatic trios (each sorted a < b < c). A hunter is in at most `cap` a
 *  day, counting `todayTrios` (already made), and a trio made today is never made twice. Kept trios
 *  first (yesterday's: all three still in the pool, one still friends with both others, nothing
 *  blocked), then, one at a time, the trio where one hunter is friends with both others that is:
 *  three mutual friends; then fewest pairs already grouped today (new faces before the same two
 *  again); then the highest combined `weight`; then the key. Pure. */
export function pickAutoTrios(
  pool: ReadonlySet<string>,
  friendsOf: ReadonlyMap<string, ReadonlySet<string>>,
  keep: ReadonlyArray<readonly string[]>,
  todayTrios: ReadonlyArray<readonly string[]>,
  isBlocked: (a: string, b: string) => boolean,
  weight: (id: string) => number,
  cap: number = AUTO_TRIOS_PER_HUNTER,
): Array<[string, string, string]> {
  const fr = (a: string, b: string) => !!friendsOf.get(a)?.has(b);
  const ok = (t: readonly string[]) =>
    t.length === 3 && new Set(t).size === 3 && t.every((x) => pool.has(x)) &&
    !isBlocked(t[0], t[1]) && !isBlocked(t[0], t[2]) && !isBlocked(t[1], t[2]) &&
    ((fr(t[0], t[1]) && fr(t[0], t[2])) || (fr(t[1], t[0]) && fr(t[1], t[2])) || (fr(t[2], t[0]) && fr(t[2], t[1])));
  const sorted = (t: readonly string[]) => [...t].sort() as [string, string, string];
  const count = new Map<string, number>();
  const together = new Map<string, number>();
  const done = new Set<string>();
  const pairsOf = (t: [string, string, string]) => [t[0] + '|' + t[1], t[0] + '|' + t[2], t[1] + '|' + t[2]];
  const note = (t: [string, string, string]) => {
    done.add(t.join('|'));
    for (const x of t) count.set(x, (count.get(x) ?? 0) + 1);
    for (const p of pairsOf(t)) together.set(p, (together.get(p) ?? 0) + 1);
  };
  for (const k of todayTrios) {
    const t = sorted(k);
    if (new Set(t).size === 3) note(t);
  }
  const room = (t: readonly string[]) => t.every((x) => (count.get(x) ?? 0) < cap);
  const out: Array<[string, string, string]> = [];
  const take = (t: [string, string, string]) => { out.push(t); note(t); };
  for (const k of keep) {
    const t = sorted(k);
    if (ok(t) && !done.has(t.join('|')) && room(t)) take(t);
  }
  const cands = new Map<string, { t: [string, string, string]; mutual: boolean; w: number }>();
  for (const hub of [...pool].sort()) {
    const fs = [...(friendsOf.get(hub) ?? [])].filter((f) => f !== hub && pool.has(f)).sort();
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const t = sorted([hub, fs[i], fs[j]]);
        const key = t.join('|');
        if (cands.has(key) || !ok(t)) continue;
        cands.set(key, { t, mutual: fr(t[0], t[1]) && fr(t[0], t[2]) && fr(t[1], t[2]), w: t.reduce((s, x) => s + (Number(weight(x)) || 0), 0) });
      }
    }
  }
  const overlap = (t: [string, string, string]) => pairsOf(t).reduce((s, p) => s + (together.get(p) ?? 0), 0);
  for (;;) {
    let best: { key: string; t: [string, string, string]; mutual: boolean; w: number; o: number } | null = null;
    for (const [key, c] of cands) {
      if (done.has(key) || !room(c.t)) continue;
      const o = overlap(c.t);
      const better = !best ||
        (c.mutual !== best.mutual ? c.mutual
          : o !== best.o ? o < best.o
          : c.w !== best.w ? c.w > best.w
          : key < best.key);
      if (better) best = { key, t: c.t, mutual: c.mutual, w: c.w, o };
    }
    if (!best) break;
    take(best.t);
  }
  return out;
}

/** The lookups both sweeps share: opt-outs, blocks, builds, ranks, steps this week and last, and
 *  (W1195) flights averages. */
type Shared = [Set<string>, Set<string>, Map<string, string>, Map<string, string>, Map<string, number>, Map<string, number>, Map<string, number>];

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

/** W1195 — each hunter's newest flights average from the last FLIGHTS_AVG_MAX_AGE_S (app_opens). */
async function flightsAvgByUser(env: Env, nowMs: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const since = Math.floor(nowMs / 1000) - FLIGHTS_AVG_MAX_AGE_S;
  const rows = await env.DB.prepare(
    `SELECT a.user_id, a.flights_avg FROM app_opens a
      WHERE a.flights_avg IS NOT NULL AND a.opened_at >= ?1
        AND a.opened_at = (SELECT MAX(b.opened_at) FROM app_opens b
                            WHERE b.user_id = a.user_id AND b.flights_avg IS NOT NULL AND b.opened_at >= ?1)`,
  ).bind(since).all<{ user_id: string; flights_avg: number | null }>();
  for (const r of rows.results ?? []) {
    const v = Number(r.flights_avg);
    if (r.user_id && Number.isFinite(v) && v >= 0) out.set(r.user_id, v);
  }
  return out;
}

/** W1209 — which automatic-boss drops each hunter owns now (cloud save hb_inventory → cards[id].count
 *  > 0; a sold last copy is not owned). A hunter with no save, or a failed read, owns none, so every
 *  boss still counts as useful to them. */
export async function ownedAutoDrops(env: Env, userIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return out;
  // the item ids are this file's own constants ([a-z_]), never input
  const items = Array.from(new Set(Object.values(AUTO_BOSS_DROPS).flat())).map((it) => `'${it}'`).join(', ');
  try {
    const rows = (await env.DB.prepare(
      `SELECT s.user_id AS user_id, j.key AS item
         FROM user_state_snapshots s, json_each(json_extract(s.state_json, '$.keys.hb_inventory'), '$.cards') j
        WHERE s.user_id IN (${ids.map(() => '?').join(', ')})
          AND j.key IN (${items})
          AND COALESCE(json_extract(j.value, '$.count'), 0) > 0`,
    ).bind(...ids).all<{ user_id: string; item: string }>()).results ?? [];
    for (const r of rows) {
      if (!r.user_id || !r.item) continue;
      if (!out.has(r.user_id)) out.set(r.user_id, new Set());
      out.get(r.user_id)!.add(r.item);
    }
  } catch (err) {
    console.error('[coop-auto] drop ownership read failed', err);
  }
  return out;
}

/** W1209 — someone in the group still lacks one of the boss's drops. */
export function stillNeeded(owned: Map<string, Set<string>>, ids: readonly string[], bossId: string): boolean {
  const drops = AUTO_BOSS_DROPS[bossId] ?? [];
  return drops.length > 0 && ids.some((u) => drops.some((it) => !owned.get(u)?.has(it)));
}

/** W1209 — how far back a group's own automatic bosses are remembered for the rotation. */
export const AUTO_HISTORY_DAYS = 14;

/** W1209 — what one sweep's picks read: each group's recent bosses, today's automatic hunts per
 *  hunter (kept current as the sweep makes rows), and the group's drops. Loaded once per sweep. */
export interface PickContext {
  prefsFor(ids: readonly string[]): Promise<PickPrefs>;
  /** count a hunt this sweep just made into today's tally */
  add(ids: readonly string[], bossId: string): void;
}

export function makePickContext(env: Env, today: string): PickContext {
  let histP: Promise<Map<string, Map<string, string>>> | null = null;
  let todayP: Promise<Map<string, Map<string, number>>> | null = null;
  let todayMap: Map<string, Map<string, number>> | null = null;
  const bump = (m: Map<string, Map<string, number>>, uid: string, bossId: string) => {
    if (!m.has(uid)) m.set(uid, new Map());
    const per = m.get(uid)!;
    per.set(bossId, (per.get(bossId) ?? 0) + 1);
  };
  const history = () => (histP ??= (async () => {
    const out = new Map<string, Map<string, string>>();
    let since = today;
    for (let i = 0; i < AUTO_HISTORY_DAYS; i++) since = prevDay(since) || since;
    try {
      const rows = (await env.DB.prepare(
        `SELECT pair_key, boss_id, MAX(hunt_day) AS d FROM coop_boss_instances
          WHERE hunt_day >= ? AND hunt_day < ? AND auto = 1 AND pair_key IS NOT NULL
          GROUP BY pair_key, boss_id`,
      ).bind(since, today).all<{ pair_key: string; boss_id: string; d: string | null }>()).results ?? [];
      for (const r of rows) {
        if (!r.pair_key || !r.boss_id) continue;
        if (!out.has(r.pair_key)) out.set(r.pair_key, new Map());
        out.get(r.pair_key)!.set(r.boss_id, String(r.d || ''));
      }
    } catch (err) {
      console.error('[coop-auto] hunt history read failed', err);
    }
    return out;
  })());
  const todays = () => (todayP ??= (async () => {
    const out = new Map<string, Map<string, number>>();
    try {
      const rows = (await env.DB.prepare(
        `SELECT boss_id, challenger_user_id AS a, partner_user_id AS b, partner2_user_id AS c
           FROM coop_boss_instances WHERE hunt_day = ? AND auto = 1`,
      ).bind(today).all<{ boss_id: string; a: string | null; b: string | null; c: string | null }>()).results ?? [];
      for (const r of rows) for (const uid of [r.a, r.b, r.c]) if (uid && r.boss_id) bump(out, uid, r.boss_id);
    } catch (err) {
      console.error('[coop-auto] today\'s hunts read failed', err);
    }
    todayMap = out;
    return out;
  })());
  return {
    async prefsFor(ids) {
      const [hist, tod, owned] = await Promise.all([history(), todays(), ownedAutoDrops(env, ids)]);
      const mine = hist.get([...ids].sort().join('|')) ?? new Map<string, string>();
      return {
        useful: (bossId) => stillNeeded(owned, ids, bossId),
        today: (bossId) => ids.reduce((n, u) => n + (tod.get(u)?.get(bossId) ?? 0), 0),
        last: (bossId) => mine.get(bossId) ?? '',
      };
    },
    add(ids, bossId) {
      if (todayMap) for (const uid of ids) bump(todayMap, uid, bossId);
    },
  };
}

/** W1195 — the pair's flights a day, or null when either phone has not sent an average. */
export function pairFlightsOf(flights: Map<string, number>, a: string, b: string): number | null {
  const fa = flights.get(a), fb = flights.get(b);
  return fa === undefined || fb === undefined ? null : fa + fb;
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
  pick: AutoPick,
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
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?)`,
      )
      .bind(id, pick.bossId, cfg.rank, challenger, partner, startsAt, pick.goalSteps,
        cfg.metric === 'both' ? (pick.goalFlights ?? cfg.goalFlights ?? null) : null,   // W1195 — a steps + flights boss carries both goals
        cfg.rewardSouls, startsAt, endsAt, dayKey, pairKey(a, b), matched ? 1 : 0),
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
           SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1)`,
      )
      .bind(id, partner, startsAt),
  ]);
  return Number(res[0]?.meta?.changes ?? 0) > 0;
}

/** W1208 — one automatic trio row, all three seats joined, idempotent on (pair_key "a|b|c",
 *  hunt_day) like a duo. True when this call created the row. */
export async function createAutoTrio(env: Env, trio: readonly string[], dayKey: string, pick: AutoPick): Promise<boolean> {
  const cfg = COOP_BOSS_CFG[pick.bossId];
  if (!cfg || cfg.partySize !== 3) return false;
  const [challenger, partner, partner2] = [...trio].sort();
  if (!challenger || !partner || !partner2 || new Set([challenger, partner, partner2]).size !== 3) return false;
  const id = crypto.randomUUID();
  const startsAt = ptMidnightIso(dayKey);
  const endsAt = ptMidnightIso(nextDay(dayKey));
  if (!startsAt || !endsAt) return false;
  const seat = (uid: string) => env.DB
    .prepare(
      `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
         SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1)`,
    )
    .bind(id, uid, startsAt);
  const res = await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO coop_boss_instances
           (id, boss_id, boss_rank, challenger_user_id, partner_user_id, partner2_user_id,
            partner_joined_at, partner2_joined_at, goal_steps, goal_flights, reward_souls,
            status, starts_at, ends_at, auto, hunt_day, pair_key, matched)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active', ?, ?, 1, ?, ?, 0)`,
      )
      .bind(id, pick.bossId, cfg.rank, challenger, partner, partner2, startsAt, startsAt, pick.goalSteps,
        cfg.rewardSouls, startsAt, endsAt, dayKey, [challenger, partner, partner2].join('|')),
    seat(partner),
    seat(partner2),
  ]);
  return Number(res[0]?.meta?.changes ?? 0) > 0;
}

/** Cron, every 2 minutes: today's hunt for every walking friend pair that has none yet, then
 *  (W1164) today's hunt for every matched pair of active hunters who have no friends, then
 *  (W1208) today's automatic trios. */
export async function sweepCoopAutoHunts(env: Env, _ctx?: ExecutionContext): Promise<{ created: number; pairs: number; skipped: number; matched: number; trios: number }> {
  const out = { created: 0, pairs: 0, skipped: 0, matched: 0, trios: 0 };
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
    const picks = makePickContext(env, today);   // W1209 — drops, today's bosses, each group's rotation
    // The lookups both passes share, read once and only when a pass needs them.
    let sharedP: Promise<Shared> | null = null;
    const shared = () => (sharedP ??= Promise.all([
      optOutSet(env),
      blockSet(env),
      latestBuildByUser(env),
      rankByUser(env),
      stepsByUser(env, thisWeek),
      stepsByUser(env, lastWeek),
      flightsAvgByUser(env, nowMs),
    ]));

    if (pairs.size) {
      const doneRows = await env.DB.prepare('SELECT pair_key FROM coop_boss_instances WHERE auto = 1 AND hunt_day = ?')
        .bind(today)
        .all<{ pair_key: string }>();
      const done = new Set((doneRows.results ?? []).map((r) => r.pair_key));
      const todo = Array.from(pairs.entries()).filter(([k]) => !done.has(k));
      if (todo.length) {
        const [optouts, blocks, builds, ranks, stepsNow, stepsLast, flights] = await shared();
        const pattern = (uid: string) => dailyPattern(stepsLast.get(uid) ?? 0, stepsNow.get(uid) ?? 0, elapsed);
        for (const [key, [a, b]] of todo) {
          if (out.created >= MAX_CREATE_PER_RUN) break;
          if (optouts.has(a + '>*') || optouts.has(b + '>*') || optouts.has(a + '>' + b) || optouts.has(b + '>' + a)) { out.skipped++; continue; }
          if (blocks.has(key)) { out.skipped++; continue; }
          if (buildW(builds.get(a)) < AUTO_HUNT_MIN_W || buildW(builds.get(b)) < AUTO_HUNT_MIN_W) { out.skipped++; continue; }
          const pa = pattern(a);
          const pb = pattern(b);
          if (pa === null || pb === null) { out.skipped++; continue; }
          const prefs = await picks.prefsFor([a, b]);   // W1209
          const pick = pickAutoBoss(ranks.get(a) ?? 'E', ranks.get(b) ?? 'E', pa + pb, pairFlightsOf(flights, a, b), prefs);
          if (await createAutoHunt(env, a, b, today, pick)) { out.created++; picks.add([a, b], pick.bossId); }
        }
      }
    }

    // ── W1164 — matched partners: active hunters with no friends, paired with each other ──
    try {
      out.matched = await sweepMatchedPairs(env, nowMs, today, thisWeek, elapsed, hasFriend, shared, picks);
    } catch (err) {
      console.error('[coop-auto] matched sweep failed', err);
    }

    // ── W1208 — automatic trios ──
    try {
      if (pairs.size >= 2) out.trios = await sweepAutoTrios(env, today, elapsed, pairs, shared, out.created + out.matched, picks);
    } catch (err) {
      console.error('[coop-auto] trio sweep failed', err);
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
  shared: () => Promise<Shared>,
  picks: PickContext,
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

  const [optouts, blocks, builds, ranks, stepsNow, stepsLast, flights] = await shared();
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
    const prefs = await picks.prefsFor([a, b]);   // W1209
    const pick = pickAutoBoss(ranks.get(a) ?? 'E', ranks.get(b) ?? 'E', (byId.get(a)?.pattern ?? 0) + (byId.get(b)?.pattern ?? 0), pairFlightsOf(flights, a, b), prefs);
    if (await createAutoHunt(env, a, b, today, pick, true)) { made++; picks.add([a, b], pick.bossId); }
  }
  return made;
}

/** W1208 — today's automatic trios (see the header). Returns how many rows it made. */
async function sweepAutoTrios(
  env: Env,
  today: string,
  elapsed: number,
  pairs: Map<string, [string, string]>,
  shared: () => Promise<Shared>,
  madeSoFar: number,
  picks: PickContext,
): Promise<number> {
  const friendsOf = new Map<string, Set<string>>();
  for (const [a, b] of pairs.values()) {
    if (!friendsOf.has(a)) friendsOf.set(a, new Set());
    if (!friendsOf.has(b)) friendsOf.set(b, new Set());
    friendsOf.get(a)!.add(b);
    friendsOf.get(b)!.add(a);
  }
  // Today's and yesterday's automatic trios: today's count toward each hunter's cap (W1210), yesterday's are kept.
  const yesterday = prevDay(today) || today;
  const rows = (await env.DB.prepare(
    `SELECT challenger_user_id AS a, partner_user_id AS b, partner2_user_id AS c, hunt_day AS d
       FROM coop_boss_instances
      WHERE auto = 1 AND partner2_user_id IS NOT NULL AND hunt_day >= ? ORDER BY hunt_day DESC`,
  ).bind(yesterday).all<{ a: string; b: string; c: string; d: string }>()).results ?? [];
  const todayTrios: string[][] = [];
  const keep: string[][] = [];
  for (const r of rows) {
    if (!r.a || !r.b || !r.c) continue;
    (r.d === today ? todayTrios : keep).push([r.a, r.b, r.c]);
  }

  const [optouts, blocks, builds, ranks, stepsNow, stepsLast] = await shared();
  const pattern = (uid: string) => dailyPattern(stepsLast.get(uid) ?? 0, stepsNow.get(uid) ?? 0, elapsed);
  const pool = new Set<string>();
  for (const uid of friendsOf.keys()) {
    if (pattern(uid) === null) continue;                              // no steps on the server: no goal to size
    if (buildW(builds.get(uid)) < AUTO_HUNT_MIN_W) continue;          // the automatic client is not on their phone
    if (optouts.has(uid + '>*')) continue;                            // switched automatic hunts off
    if ((RANK_ORDER[ranks.get(uid) ?? 'E'] ?? 0) < (RANK_ORDER.D ?? 1)) continue;   // no trio boss is open to E
    pool.add(uid);
  }
  if (pool.size < 3) return 0;
  const isBlocked = (a: string, b: string) =>
    blocks.has(pairKey(a, b)) || optouts.has(a + '>' + b) || optouts.has(b + '>' + a);
  let made = 0;
  for (const trio of pickAutoTrios(pool, friendsOf, keep, todayTrios, isBlocked, (id) => pattern(id) ?? 0)) {
    if (madeSoFar + made >= MAX_CREATE_PER_RUN) break;
    const prefs = await picks.prefsFor(trio);   // W1209
    const pick = pickAutoTrioBoss(trio.map((u) => ranks.get(u) ?? 'E'), trio.reduce((s, u) => s + (pattern(u) ?? 0), 0), prefs);
    if (!pick) continue;
    if (await createAutoTrio(env, trio, today, pick)) { made++; picks.add(trio, pick.bossId); }
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
