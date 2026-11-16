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
 *
 * W1211 — THE AUTOMATIC RAID (owner 2026-11-14: "automate the raid with 5 active randoms .. so it
 * doesn't have to be your friend ... puts you in with 5 random users that are active-active"; then
 * "Keep 135k + 150", "Back to back", and "you can only be in one raid at a time"). Every pass, the
 * very active hunters (a boss kill on AUTO_RAID_ACTIVE_DAYS (4) of the last 7 days) on the automatic
 * client who have not switched automatic hunts off and are in no live raid are shuffled for the day
 * and put into The Grinning God in parties of six (a remainder of four or five makes one more; fewer
 * wait), nobody with someone they blocked. The raid runs from now for its 80 hours with its own goal
 * (135,000 steps + 150 flights), every seat joined, auto = 1. When it ends, its hunters go into the
 * next pass. One push when the party forms; a win tells everyone (coop-boss.ts); a loss is quiet.
 * coop-boss.ts refuses a summons or an answer that would put anyone in a second raid.
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';
import { chunks } from '../lib/chunk';
import { MERGED_FOR_WEEK } from '../lib/week-board';
import { getAccoladeWeekStart, priorWeekStart } from '../lib/accolade-week';
import { ptDayKey, nextDay, prevDay, ptMidnightIso } from '../lib/pact-streak';
import { notifyUser } from '../lib/apns';
import { MEMBERSHIP_OPEN } from '../lib/membership';
import { readEntitlements } from './iap-entitlements';
import {
  COOP_BOSS_CFG,
  COOP_BOSS_NAMES,
  emptyProgress,
  huntersInLiveRaid,
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
/** W1214 (owner 2026-11-15, the Reddit wave: "let them match after their first day of kills instead
 *  of two") — a hunter who joined in the last MATCH_NEW_DAYS needs only MATCH_NEW_MIN_KILL_DAYS day
 *  with a kill. The first day in the app still stays quiet (joined before today). */
export const MATCH_NEW_DAYS = 7;
export const MATCH_NEW_MIN_KILL_DAYS = 1;
/** W1217 (owner 2026-11-15: "make sure those people are active that get paired so a person doesn't
 *  get paired with an inactive user") — a stranger is matched (duo) or put in a raid party only when
 *  they were IN the app on one of the last MATCH_OPEN_DAYS Pacific days, today included; at the
 *  midnight run, that is yesterday. A kept partner who goes quiet leaves the pool, their pair breaks,
 *  and the active one is re-paired.
 *  W1218 (owner 2026-11-16: "Yes make the fix") — "in the app" = a counted open (app_open_counts) OR
 *  a cloud save (user_state_snapshots.server_updated_at). NOT any app_opens ping (W1217 as shipped):
 *  an Apple Health background sync pings too, and on 2026-11-15 eight phones were "active" only that
 *  way, two of them (Killua, Bryant: no visit since the day they joined) paired with each other.
 *  Background pings push no save. Neither signal alone: the counter misses a new hunter's first
 *  session and a launch before the session is restored (18 of 36 on 2026-11-15); 29 of the 30 in the
 *  app that Sunday saved.
 *  W1219 (owner 2026-11-16: "Justin and Anthony weren't on yesterday and it still gave me automatic
 *  hunts with them. This needs to be fixed") — the same check now gates FRIENDS' automatic duos and
 *  trios: a friend not in the app today or yesterday gets none (Anthony's last visit was 11/12,
 *  Justin's and Zynfandel's 11/14; their phones only synced steps in the background). The sweep runs
 *  every pass, so a friend who comes back gets the day's hunts then, and a hunt still starts at
 *  Pacific midnight, so the whole day's steps count. Hunts already made are left alone.
 *  OWNER'S STANDING RULE (2026-11-16): "if a person misses a day completely no use of the app then it
 *  won't be automated for the next day unless they get on the app then it can restart the automation
 *  .. the worse thing is pairing up with an inactive user". MATCH_OPEN_DAYS = 2 is exactly that: the
 *  midnight run only takes hunters who were in the app yesterday, and a later pass picks them up the
 *  moment they open it. Never widen this window. */
export const MATCH_OPEN_DAYS = 2;
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
 *  no steps for them in either week (no pattern → no automatic hunts).
 *  W1215 (owner 2026-11-15: "yes do both fixes") — over last week's 7 days and this week's FINISHED
 *  days. The day's hunts are made at midnight, when today has no steps yet, and counting today
 *  anyway set every goal low: by an eighth on a Sunday (last week ÷ 8), a fourteenth on a Saturday. */
export function dailyPattern(lastWeek: number, thisWeek: number, elapsedDays: number): number | null {
  const last = Math.max(0, Number(lastWeek) || 0);
  const cur = Math.max(0, Number(thisWeek) || 0);
  if (last <= 0 && cur <= 0) return null;
  const finished = Math.min(6, Math.max(0, Math.floor(Number(elapsedDays) || 1) - 1));
  return (last + cur) / (7 + finished);
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

/** W1215 — a stretched goal is never lower than this share of the boss's own goal. */
export const STRETCH_MIN_SHARE = 0.75;

/** W1215 (owner 2026-11-15: "yes do both fixes") — when every boss that fits is one the group has
 *  fully collected (W1209 useful = false for all), the next steps boss UP the list that the ranks
 *  allow and someone still needs a drop from, its goal lowered to AUTO_FIT × the group's walking
 *  (nearest 100) — never under STRETCH_MIN_SHARE of its own goal (else null: keep the usual pick).
 *  Richie + Anthony on 2026-11-15: ~9,550 a day together fits only the Twin Maw, both own all of
 *  it, so The Coursing Dread at 7,600 instead of 8,000. `list` is best first. Pure. */
export function stretchPick(list: readonly string[], fits: readonly AutoPick[], rank: number, fit: number, prefs: PickPrefs, partySize = 2): AutoPick | null {
  if (!prefs.useful || !fits.length || fits.some((p) => prefs.useful!(p.bossId))) return null;
  const fitIds = new Set(fits.map((p) => p.bossId));
  const goal = Math.round(fit / 100) * 100;
  for (let i = list.length - 1; i >= 0; i--) {   // weakest first, upward
    const bossId = list[i];
    if (fitIds.has(bossId)) continue;
    const cfg = COOP_BOSS_CFG[bossId];
    if (!cfg || (RANK_ORDER[cfg.rank] ?? 0) > rank) continue;
    if (cfg.windowHours !== 24 || (cfg.partySize ?? 2) !== partySize || cfg.metric !== 'steps') continue;
    if (goal >= cfg.goalSteps) continue;   // would fit as printed (it would be in `fits`)
    if (goal < STRETCH_MIN_SHARE * cfg.goalSteps) return null;   // out of reach, and every boss above more so
    if (!prefs.useful(bossId)) continue;
    return { bossId, goalSteps: goal };
  }
  return null;
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
  const stretched = stretchPick(AUTO_BOSSES, fits, r, fit, prefs, 2);   // W1215
  if (stretched) return stretched;
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
  const stretched = stretchPick(AUTO_TRIO_BOSSES, fits, r, fit, prefs, 3);   // W1215
  if (stretched) return stretched;
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

/** W1211 — THE AUTOMATIC RAID (owner 2026-11-14: "automate the raid with 5 active randoms .. so it
 *  doesn't have to be your friend ... puts you in with 5 random users that are active-active";
 *  goal: "Keep 135k + 150"; cadence: "Back to back"; "you can only be in one raid at a time"). */
export const AUTO_RAID_BOSS = 'the_grinning_god';
/** you + 5 */
export const AUTO_RAID_PARTY = 6;
/** "active-active": a boss killed on at least this many of the last 7 Pacific days (matching asks 2) */
export const AUTO_RAID_ACTIVE_DAYS = 4;

/** W1211 — the pool in a day's random order: a different order every Pacific day, the same order
 *  all day (FNV-1a of day|id), so a raid's party is random but a test can pin it. */
export function raidOrder(ids: readonly string[], day: string): string[] {
  const h = (s: string) => {
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return x >>> 0;
  };
  return [...ids]
    .map((id) => ({ id, k: h(day + '|' + id) }))
    .sort((a, b) => (a.k - b.k) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((x) => x.id);
}

/** W1211 — parties from the ordered pool: full parties of `size` first; what is left makes one more
 *  when it reaches `min`; fewer wait for the next pass. Nobody joins a party holding someone they
 *  blocked or switched off (or who did so to them). Pure. */
export function formRaidParties(
  order: readonly string[],
  isBlocked: (a: string, b: string) => boolean,
  size: number = AUTO_RAID_PARTY,
  min = 4,
): string[][] {
  const left = [...order];
  const out: string[][] = [];
  while (left.length >= min) {
    const party = [left.shift()!];
    for (let i = 0; i < left.length && party.length < size;) {
      if (party.some((p) => isBlocked(p, left[i]))) { i++; continue; }
      party.push(left.splice(i, 1)[0]);
    }
    if (party.length >= min) out.push(party);
    else left.push(...party.slice(1));   // blocks left the first hunter short: they wait, the rest stay in line
  }
  return out;
}

const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** W1211 — one automatic raid: every seat joined, live from now for the raid's window (80h), the
 *  raid's own goal (no sizing — owner: "Keep 135k + 150"). auto = 1 (no leave button, quiet loss),
 *  matched = 0, pair_key = every id sorted, idempotent on (pair_key, hunt_day). Drops the hunters'
 *  raid-finder rows for this boss. True when this call created the row. */
export async function createAutoRaid(env: Env, party: readonly string[], nowMs: number): Promise<boolean> {
  const cfg = COOP_BOSS_CFG[AUTO_RAID_BOSS];
  const ids = Array.from(new Set(party.filter(Boolean))).sort();
  if (!cfg || ids.length < (cfg.minParty ?? 2) || ids.length > (cfg.maxParty ?? AUTO_RAID_PARTY)) return false;
  const day = ptDayKey(nowMs);
  if (!day) return false;
  const id = crypto.randomUUID();
  const startsAt = new Date(nowMs).toISOString();
  const endsAt = new Date(nowMs + cfg.windowHours * 3_600_000).toISOString();
  const [challenger, ...allies] = ids;
  const res = await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO coop_boss_instances
           (id, boss_id, boss_rank, challenger_user_id, partner_user_id, partner2_user_id,
            partner_joined_at, partner2_joined_at, goal_steps, goal_flights, reward_souls,
            status, starts_at, ends_at, auto, hunt_day, pair_key, matched)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, 0)`,
      )
      .bind(id, AUTO_RAID_BOSS, cfg.rank, challenger, allies[0] ?? null, allies[1] ?? null,
        allies[0] ? startsAt : null, allies[1] ? startsAt : null,
        cfg.goalSteps, cfg.goalFlights ?? null, cfg.rewardSouls, startsAt, endsAt, day, ids.join('|')),
    ...allies.map((uid) => env.DB
      .prepare(
        `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
           SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1)`,
      )
      .bind(id, uid, startsAt)),
    ...ids.map((uid) => env.DB
      .prepare(
        `DELETE FROM raid_queue WHERE user_id = ?1 AND boss_id = ?2
            AND EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?3)`,
      )
      .bind(uid, AUTO_RAID_BOSS, id)),
  ]);
  return Number(res[0]?.meta?.changes ?? 0) > 0;
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

/** W1195 — each hunter's newest flights average from the last FLIGHTS_AVG_MAX_AGE_S (app_opens).
 *  W1212 — one pass over the window's rows (idx_app_opens_date); SQLite's bare-column MAX takes
 *  flights_avg from each hunter's newest row (was a correlated MAX per row). */
async function flightsAvgByUser(env: Env, nowMs: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const since = Math.floor(nowMs / 1000) - FLIGHTS_AVG_MAX_AGE_S;
  const sinceDay = new Date(nowMs - FLIGHTS_AVG_MAX_AGE_S * 1000 - 86_400_000).toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT user_id, flights_avg, MAX(opened_at) AS last FROM app_opens INDEXED BY idx_app_opens_date
      WHERE date_utc >= ?2 AND opened_at >= ?1 AND flights_avg IS NOT NULL
      GROUP BY user_id`,
  ).bind(since, sinceDay).all<{ user_id: string; flights_avg: number | null }>();
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

/** W1212 — how far back the automatic passes look for a hunter's build. Every pass also needs steps
 *  from the last two weeks or boss kills from the last one, so an older open never made a hunt. */
export const BUILD_LOOKBACK_DAYS = 21;

/** Each hunter's newest build among their opens of the last BUILD_LOOKBACK_DAYS.
 *  W1212 (owner 2026-11-14: "make sure the awakened server / app won't crash if there's a mass
 *  influx") — this was a correlated MAX over EVERY app_opens row ever: 70,000 rows a run, 46 of the
 *  database's 52 million rows read a day (88%), growing with hunters × their history, every two
 *  minutes. Now one pass over the window (idx_app_opens_date): 412 rows on 2026-11-14. SQLite's
 *  bare-column MAX takes the build from each hunter's newest row. */
async function latestBuildByUser(env: Env, nowMs: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const sinceDay = new Date(nowMs - BUILD_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT user_id, build, MAX(opened_at) AS last FROM app_opens INDEXED BY idx_app_opens_date
      WHERE date_utc >= ? GROUP BY user_id`,
  ).bind(sinceDay).all<{ user_id: string; build: string | null }>();
  for (const r of rows.results ?? []) out.set(r.user_id, r.build ?? '');
  return out;
}

/** W1217 + W1218 — hunters who were in the app since Pacific midnight MATCH_OPEN_DAYS - 1 days ago:
 *  a counted open on one of those Pacific days (idx_app_open_counts_day) or a cloud save since that
 *  moment (one row per hunter with a save: 125 rows read, ~4 ms on 2026-11-16). */
async function openedRecently(env: Env, today: string): Promise<Set<string>> {
  let since = today;
  for (let i = 1; i < MATCH_OPEN_DAYS; i++) since = prevDay(since) || since;
  const sinceMs = Date.parse(ptMidnightIso(since) || '');
  if (!Number.isFinite(sinceMs)) return new Set();
  const rows = await env.DB.prepare(
    `SELECT user_id, 'open' AS seen_by FROM app_open_counts WHERE day_pt >= ?1 AND opens > 0
     UNION
     SELECT user_id, 'save' AS seen_by FROM user_state_snapshots WHERE server_updated_at >= ?2`,
  ).bind(since, sinceMs).all<{ user_id: string }>();
  return new Set((rows.results ?? []).map((r) => r.user_id).filter(Boolean));
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
export async function sweepCoopAutoHunts(env: Env, _ctx?: ExecutionContext): Promise<{ created: number; pairs: number; skipped: number; matched: number; trios: number; raids: number }> {
  const out = { created: 0, pairs: 0, skipped: 0, matched: 0, trios: 0, raids: 0 };
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
      latestBuildByUser(env, nowMs),
      rankByUser(env),
      stepsByUser(env, thisWeek),
      stepsByUser(env, lastWeek),
      flightsAvgByUser(env, nowMs),
    ]));
    // W1217-W1219 — who was in the app today or yesterday, read once per pass and only when a gate needs it.
    let inAppP: Promise<Set<string>> | null = null;
    const inApp = () => (inAppP ??= openedRecently(env, today));

    if (pairs.size) {
      const doneRows = await env.DB.prepare('SELECT pair_key FROM coop_boss_instances WHERE auto = 1 AND hunt_day = ?')
        .bind(today)
        .all<{ pair_key: string }>();
      const done = new Set((doneRows.results ?? []).map((r) => r.pair_key));
      const todo = Array.from(pairs.entries()).filter(([k]) => !done.has(k));
      if (todo.length) {
        const [optouts, blocks, builds, ranks, stepsNow, stepsLast, flights] = await shared();
        const opened = await inApp();   // W1219
        const pattern = (uid: string) => dailyPattern(stepsLast.get(uid) ?? 0, stepsNow.get(uid) ?? 0, elapsed);
        for (const [key, [a, b]] of todo) {
          if (out.created >= MAX_CREATE_PER_RUN) break;
          if (optouts.has(a + '>*') || optouts.has(b + '>*') || optouts.has(a + '>' + b) || optouts.has(b + '>' + a)) { out.skipped++; continue; }
          if (blocks.has(key)) { out.skipped++; continue; }
          if (buildW(builds.get(a)) < AUTO_HUNT_MIN_W || buildW(builds.get(b)) < AUTO_HUNT_MIN_W) { out.skipped++; continue; }
          if (!opened.has(a) || !opened.has(b)) { out.skipped++; continue; }   // W1219 — a friend not in the app today or yesterday
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
      out.matched = await sweepMatchedPairs(env, nowMs, today, thisWeek, elapsed, hasFriend, shared, picks, inApp);
    } catch (err) {
      console.error('[coop-auto] matched sweep failed', err);
    }

    // ── W1208 — automatic trios ──
    try {
      if (pairs.size >= 2) out.trios = await sweepAutoTrios(env, today, elapsed, pairs, shared, out.created + out.matched, picks, inApp);
    } catch (err) {
      console.error('[coop-auto] trio sweep failed', err);
    }

    // ── W1211 — the automatic raid ──
    try {
      out.raids = await sweepAutoRaids(env, nowMs, today, shared, _ctx, out.created + out.matched + out.trios, inApp);
    } catch (err) {
      console.error('[coop-auto] raid sweep failed', err);
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
  inApp: () => Promise<Set<string>>,
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
  // W1216 — a new hunter's win the public kill list never got still counts as their one day.
  const listed = new Set(killRows.map((r) => r.user_id));
  for (const w of await newHunterSavedWins(env, nowMs)) {
    if (!listed.has(w.user_id)) killRows.push({ user_id: w.user_id, kill_days: 1, kills: 1, created_at: w.created_at });
  }
  const first = killRows.filter((r) => {
    const joined = Number(r.created_at) || 0;
    const need = joined >= nowMs - MATCH_NEW_DAYS * 86_400_000 ? MATCH_NEW_MIN_KILL_DAYS : MATCH_MIN_KILL_DAYS;   // W1214
    return !!r.user_id && !hasFriend.has(r.user_id) &&
      (Number(r.kill_days) || 0) >= need &&
      joined < dayStartMs;   // the quiet first day stays quiet
  });
  if (first.length < 2) return 0;

  const [optouts, blocks, builds, ranks, stepsNow, stepsLast, flights] = await shared();
  const opened = await inApp();   // W1217
  const pattern = (uid: string) => dailyPattern(stepsLast.get(uid) ?? 0, stepsNow.get(uid) ?? 0, elapsed);
  const pool: MatchCandidate[] = [];
  for (const r of first) {
    if (!opened.has(r.user_id)) continue;                           // W1217/W1218 — not in the app today or yesterday
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

/** W1216 (owner 2026-11-15: "You make the call") — hunters who joined in the last MATCH_NEW_DAYS with
 *  a win on record OUTSIDE the public kill list: a boss with kill_count > 0 in their cloud save, or the
 *  app's first_boss_kill funnel ping. The phone's public kill post can be lost (it is queued in
 *  memory only), and on 2026-11-15 10 of 16 new hunters' first Steel Wolf wins never reached the
 *  list, so the matching never saw them. Only the last week's sign-ups are read (~250 rows read,
 *  ~2 ms on 2026-11-15). Any JSON the save holds that is not an object is skipped, and a failure
 *  here returns nothing, so the old rule still stands. */
async function newHunterSavedWins(env: Env, nowMs: number): Promise<Array<{ user_id: string; created_at: number }>> {
  try {
    const since = nowMs - MATCH_NEW_DAYS * 86_400_000;
    return (await env.DB.prepare(
      `SELECT u.id AS user_id, u.created_at AS created_at
         FROM users u JOIN user_state_snapshots s ON s.user_id = u.id
        WHERE u.created_at >= ?1
          AND EXISTS (
            SELECT 1 FROM json_each(CASE WHEN json_valid(s.state_json)
                                          AND json_valid(json_extract(s.state_json, '$.keys.hb_bosses'))
                                         THEN json_extract(s.state_json, '$.keys.hb_bosses') ELSE '{}' END) b
             WHERE b.type = 'object' AND CAST(json_extract(b.value, '$.kill_count') AS INTEGER) > 0)
       UNION
       SELECT u.id, u.created_at
         FROM funnel_events f JOIN users u ON u.id = f.user_id
        WHERE f.event = 'first_boss_kill' AND f.created_at >= ?1 AND u.created_at >= ?1`,
    ).bind(since).all<{ user_id: string; created_at: number }>()).results ?? [];
  } catch (err) {
    console.error('[coop-auto] saved wins read failed', err);
    return [];
  }
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
  inApp: () => Promise<Set<string>>,
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
      WHERE auto = 1 AND partner2_user_id IS NOT NULL AND hunt_day >= ?
        AND boss_id IN (${AUTO_TRIO_BOSSES.map((x) => `'${x}'`).join(', ')}) ORDER BY hunt_day DESC`,   // W1211 — never a raid row
  ).bind(yesterday).all<{ a: string; b: string; c: string; d: string }>()).results ?? [];
  const todayTrios: string[][] = [];
  const keep: string[][] = [];
  for (const r of rows) {
    if (!r.a || !r.b || !r.c) continue;
    (r.d === today ? todayTrios : keep).push([r.a, r.b, r.c]);
  }

  const [optouts, blocks, builds, ranks, stepsNow, stepsLast] = await shared();
  const opened = await inApp();   // W1219
  const pattern = (uid: string) => dailyPattern(stepsLast.get(uid) ?? 0, stepsNow.get(uid) ?? 0, elapsed);
  const pool = new Set<string>();
  for (const uid of friendsOf.keys()) {
    if (!opened.has(uid)) continue;                                   // W1219 — not in the app today or yesterday
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

/** W1211 — the automatic raid pass (see AUTO_RAID_BOSS). The very active hunters (a boss kill on
 *  AUTO_RAID_ACTIVE_DAYS of the last 7) who are on the automatic client, have not switched automatic
 *  hunts off and are in no live raid are shuffled for the day and put in parties of six; a raid that
 *  ends frees its hunters for the next pass (back to back). Each hunter of a new raid is told once.
 *  Returns how many raids it made. */
async function sweepAutoRaids(
  env: Env,
  nowMs: number,
  today: string,
  shared: () => Promise<Shared>,
  ctx: ExecutionContext | undefined,
  madeSoFar: number,
  inApp: () => Promise<Set<string>>,
): Promise<number> {
  const cfg = COOP_BOSS_CFG[AUTO_RAID_BOSS];
  if (!cfg) return 0;
  const min = cfg.minParty ?? 4;
  const killRows = (await env.DB.prepare(
    `SELECT k.user_id AS user_id,
            COUNT(DISTINCT date(k.server_created_at / 1000, 'unixepoch', '-8 hours')) AS kill_days
       FROM public_achievement_events k JOIN users u ON u.id = k.user_id
      WHERE k.event_type = 'boss_kill' AND k.server_created_at >= ?
        AND COALESCE(u.apple_sub, '') NOT LIKE 'sim_test_%'
      GROUP BY k.user_id`,
  )
    .bind(nowMs - MATCH_WINDOW_MS)
    .all<{ user_id: string; kill_days: number }>()).results ?? [];
  const active = killRows
    .filter((r) => r.user_id && (Number(r.kill_days) || 0) >= AUTO_RAID_ACTIVE_DAYS)
    .map((r) => r.user_id);
  if (active.length < min) return 0;

  const [optouts, blocks, builds] = await shared();
  const busy = await huntersInLiveRaid(env, AUTO_RAID_BOSS);   // one raid at a time
  const opened = await inApp();   // W1217
  const pool: string[] = [];
  for (const uid of active) {
    if (busy.has(uid)) continue;
    if (!opened.has(uid)) continue;                            // W1217/W1218 — not in the app today or yesterday
    if (buildW(builds.get(uid)) < AUTO_HUNT_MIN_W) continue;   // the automatic client is not on their phone
    if (optouts.has(uid + '>*')) continue;                     // switched automatic hunts off
    if (cfg.memberOnly && !MEMBERSHIP_OPEN) {
      try { if (!(await readEntitlements(env, uid)).member) continue; } catch { continue; }
    }
    pool.push(uid);
  }
  if (pool.length < min) return 0;

  const isBlocked = (a: string, b: string) =>
    blocks.has(pairKey(a, b)) || optouts.has(a + '>' + b) || optouts.has(b + '>' + a);
  const goal = thousands(cfg.goalSteps) + ' steps' + (cfg.goalFlights ? ' and ' + thousands(cfg.goalFlights) + ' flights' : '');
  let made = 0;
  for (const party of formRaidParties(raidOrder(pool, today), isBlocked, AUTO_RAID_PARTY, min)) {
    if (madeSoFar + made >= MAX_CREATE_PER_RUN) break;
    if (!(await createAutoRaid(env, party, nowMs))) continue;
    made++;
    if (!ctx) continue;
    for (const uid of party) {
      ctx.waitUntil(notifyUser(env, uid, {
        title: 'Raid Party Found',
        body: `${COOP_BOSS_NAMES[AUTO_RAID_BOSS] ?? 'The raid'}: you and ${party.length - 1} hunters have ${cfg.windowHours} hours for ${goal} together.`,
        type: 'coop_joined',
        data: { bossId: AUTO_RAID_BOSS },
      }));
    }
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
