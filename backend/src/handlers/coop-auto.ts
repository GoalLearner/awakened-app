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
 * "Keep 135k + 150", "Back to back", and "you can only be in one raid at a time"; W1234 raised the goal to 200k + 200).
 * W1239 (owner 2026-11-18: "automated at 6 hunters ... completely random with active hunters", active = "opened the
 * app at least 5x this week since sunday"; W1240, the owner's definition of active: "opened the app at least 5x in
 * the last 7 days"): every pass, the hunters with AUTO_RAID_MIN_OPENS (5) app opens in the last 7 days who were
 * in the app today or yesterday, are on the automatic client, have not switched automatic hunts off
 * and are in no live raid are shuffled afresh and put into The Grinning God in parties of exactly six (fewer wait),
 * nobody with someone they blocked. The raid runs from now for its 80 hours with its own goal
 * (200,000 steps + 200 flights), every seat joined, auto = 1. When it ends, its hunters go into the
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
  HALF_EACH_MIN_W,
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
/** W1340 — the four half-each duos lead (S, then A): picked only when EACH hunter's own average covers their half and
 *  both phones have the app that knows them (PickPrefs.half). */
export const AUTO_BOSSES: readonly string[] = ['the_bound_kings', 'the_halved_seraph', 'the_yoked_wanderers', 'the_chained_ascendants',
  'the_sundered_choir', 'the_hollow_monarch', 'the_gaunt_wardens', 'the_coursing_dread', 'the_twin_maw'];
/** W1278 — owner 2026-11-22: "Aren't there more duo bosses though?" … "I don't mind multiple days to appear in here too as
 *  well." The multi-day duos are TARGETS only: never an Auto pick (Auto stays one day), made only when a member of the
 *  pair chases one, and then for the boss's whole window (2 or 3 days) with its goal sized to the pair's walking over it. */
export const AUTO_MULTI_BOSSES: readonly string[] = ['the_cloven_titan', 'the_sleepless_crown', 'the_unresting_march'];
/** W1209 — every drop of each automatic boss (rare + ultra rare; co-op pools have no commons), from
 *  the client catalog: the items whose source_boss is the boss, or the boss's own pool (W1104). A
 *  test reads app.js so the two cannot drift. */
export const AUTO_BOSS_DROPS: Readonly<Record<string, readonly string[]>> = {
  // W1340 — the half-each duos drop their rank's hard-to-get pieces (the S pair also a mythic, not listed: a mythic is never a target)
  the_bound_kings: ['watchkeepers_carapace', 'grips_of_the_third_night', 'striders_of_the_waking_march'],
  the_halved_seraph: ['circlet_of_lucid_sleep', 'shroud_of_the_dreaming_court', 'pendant_of_the_seventh_hour'],
  the_yoked_wanderers: ['striders_of_the_tideless_road', 'mantle_of_the_long_vigil', 'wraithwind_bow', 'band_of_the_roadkeeper', 'restplate_of_the_wanderer'],
  the_chained_ascendants: ['amulet_of_the_endless_stair', 'skyward_vigil_ring', 'aetherspire_staff', 'nightcrown_of_the_climb', 'ascent_worn_cloak'],
  the_sundered_choir: ['the_choirmasters_vestment', 'the_discordant_crown', 'the_sundered_grips', 'the_antiphon_striders'],
  the_hollow_monarch: ['the_hollow_crown', 'the_monarchs_writ', 'crownpiercer'],
  the_gaunt_wardens: ['the_wardens_vigil', 'the_stairwalkers_treads', 'the_famished_circlet', 'the_gaunt_mantle'],
  the_coursing_dread: ['the_long_pursuit', 'houndsfang_recurve', 'coursing_houndcall'],
  // W1278 — the multi-day duos (targets only)
  the_cloven_titan: [
    'striders_of_the_tideless_road', 'mantle_of_the_long_vigil', 'amulet_of_the_endless_stair', 'skyward_vigil_ring',
    'duskforge_greatblade', 'aetherspire_staff', 'wraithwind_bow', 'forgewarden_gauntlets',
    'band_of_the_roadkeeper', 'restplate_of_the_wanderer', 'nightcrown_of_the_climb', 'ascent_worn_cloak',
    'anvilrest_cuirass', 'charm_of_the_emberkeeper',
  ],
  the_sleepless_crown: ['watchkeepers_carapace', 'grips_of_the_third_night', 'striders_of_the_waking_march', 'circlet_of_lucid_sleep',
    'shroud_of_the_dreaming_court', 'pendant_of_the_seventh_hour'],
  the_unresting_march: ['roadwardens_harness', 'milestone_cowl', 'longroad_grips'],
  // W1274 — owner 2026-11-22: the Twin Maw also drops every common relic (client poolAllCommons; 36 on 2026-11-22)
  the_twin_maw: ['bothsight_longbow', 'twin_fang_cleaver', 'twofold_gaze',
    'dream_woven_hood', 'vow_ring', 'pack_leaders_greaves', 'tossing_bedroll', 'drowsy_signet', 'sobriety_token',
    'steady_steps', 'pups_hood', 'trackers_wrap', 'iron_grip_wraps', 'warden_chain_belt', 'rusted_training_blade',
    'striders_laces', 'glassstep_band', 'shardwalker_wrap', 'quiet_thread', 'moonlit_lens', 'hushed_night_cloak',
    'summit_treads', 'stairbound_greaves', 'upper_gate_band', 'roadworn_mantle', 'phantom_mile_wraps', 'wayfarers_signet',
    'embergrip_gauntlets', 'furnacewalk_legplates', 'cinderplate_harness', 'forge_blackened_handwraps', 'ember_anvil_circlet', 'coalstep_band',
    'candlekeepers_charm', 'nightwatchers_gloves', 'mantle_of_kept_hours', 'emberstep_boots', 'waiting_flame_signet', 'pilgrims_coal_wraps'],
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

export interface AutoPick {
  bossId: string; goalSteps: number; goalFlights?: number;
  /** W1268 — the hunters whose Auto Hunts target picked it (the card's reason tag); absent = Auto */
  reason?: string[];
}

/** W1209 — what the pick weighs beyond fit, for one group. The defaults (every boss useful, nobody
 *  on anything today, nothing hunted before) give the best boss that fits, as before W1207. */
export interface PickPrefs {
  /** someone in the group still lacks one of the boss's drops */
  useful?: (bossId: string) => boolean;
  /** how many of the group are already on this boss in today's automatic hunts */
  today?: (bossId: string) => number;
  /** the group's last automatic hunt day on this boss, 'YYYY-MM-DD' ('' = never) */
  last?: (bossId: string) => string;
  /** W1267 — one live (pending or active) hunt on this boss, hand-made or automatic, already holds the whole
   *  group (a duo: the pair; a trio: all three). Owner 2026-11-21, on two identical Twin Maw hunts with Ricin: one live hunt per pair per
   *  boss. Ricin's hand-made invite was answered at 11:34 PM PST and the midnight pass made the same boss
   *  for the same pair 26 minutes later; the pick now passes over it, and a pair whose only option is
   *  live gets no automatic hunt that day (the caller checks). */
  live?: (bossId: string) => boolean;
  /** W1268 — someone in the group has never beaten this boss: a first kill still to discover (the Bosses
   *  Slain log shows it dimmed). Owner 2026-11-21: gear the automation to "anything not discovered yet". */
  fresh?: (bossId: string) => boolean;
  /** W1268 — each member's Auto Hunts targets (Targets mode), best first. Members on Auto are left out. */
  wants?: ReadonlyArray<{ uid: string; bosses: readonly string[] }>;
  /** W1268 — the hunt day ('YYYY-MM-DD'): whose turn it is when members chase different bosses */
  day?: string;
  /** W1339 — what the pair can give a half-each boss (halfFitOf): AUTO_FIT × the weaker hunter's steps and flights a day,
   *  and whether both phones have the app that knows these bosses. Absent → no half-each boss is picked. */
  half?: { fit: number; fl: number | null; ok: boolean };
}

/** W1339 — owner 2026-11-26: Auto may pick a half-each boss "if both can do half". Each hunter walks their own half, so the
 *  pair's sum says nothing: the WEAKER hunter's steps (and flights, null when either phone sent none) decide, at AUTO_FIT. */
export function halfFitOf(pa: number | null, pb: number | null, flights: Map<string, number>, builds: Map<string, string>, a: string, b: string): NonNullable<PickPrefs['half']> {
  const fa = flights.get(a), fb = flights.get(b);
  return {
    fit: AUTO_FIT * Math.max(0, Math.min(Number(pa) || 0, Number(pb) || 0)),
    fl: fa === undefined || fb === undefined ? null : AUTO_FIT * Math.max(0, Math.min(fa, fb)),
    ok: buildW(builds.get(a)) >= HALF_EACH_MIN_W && buildW(builds.get(b)) >= HALF_EACH_MIN_W,
  };
}

/** W1209 — which of the bosses that fit (best first) to hunt: one someone in the group still needs a
 *  drop from, when there is one; then the one fewest of the group are already on today; then the one
 *  the group hunted longest ago; then the best. */
export function choosePick<T extends { bossId: string }>(fits: T[], prefs: PickPrefs = {}): T | null {
  if (!fits.length) return null;
  const useful = prefs.useful ?? (() => true);
  const today = prefs.today ?? (() => 0);
  const last = prefs.last ?? (() => '');
  const fresh = prefs.fresh ?? (() => false);
  const firsts = fits.filter((p) => fresh(p.bossId));   // W1268 — a boss someone has never beaten comes first
  const need = fits.filter((p) => useful(p.bossId));
  const pool = firsts.length ? firsts : need.length ? need : fits;
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
  if (!prefs.useful) return null;
  const wanted = (b: string) => prefs.useful!(b) || !!prefs.fresh?.(b);   // W1268 — a first kill is wanted too
  if (!fits.length || fits.some((p) => wanted(p.bossId))) return null;
  const fitIds = new Set(fits.map((p) => p.bossId));
  const goal = Math.round(fit / 100) * 100;
  for (let i = list.length - 1; i >= 0; i--) {   // weakest first, upward
    const bossId = list[i];
    if (fitIds.has(bossId)) continue;
    const cfg = COOP_BOSS_CFG[bossId];
    if (!cfg || (RANK_ORDER[cfg.rank] ?? 0) > rank) continue;
    if (cfg.windowHours !== 24 || (cfg.partySize ?? 2) !== partySize || cfg.metric !== 'steps') continue;
    if (cfg.halfEach) continue;   // W1339 — a half-each goal is never lowered to the pair's sum
    if (goal >= cfg.goalSteps) continue;   // would fit as printed (it would be in `fits`)
    if (goal < STRETCH_MIN_SHARE * cfg.goalSteps) return null;   // out of reach, and every boss above more so
    if (!wanted(bossId)) continue;
    if (prefs.live?.(bossId)) continue;   // W1267
    return { bossId, goalSteps: goal };
  }
  return null;
}

/** W1268 — the goal a pair (lowest rank `r`, AUTO_FIT × its walking `fit`, AUTO_FIT × its flights `fl` or null) is given
 *  for a TARGET boss; the Auto Hunts manager's "Eligible with" uses the same rule.
 *  W1280 — owner 2026-11-22, on "No current partner can run this yet" for a pair a little short of the Cloven Titan:
 *  "Allow to at least attempt". A target the ranks allow is always made. Steps: as printed when the pair's walking covers
 *  them over the window (2 or 3 days for a multi-day duo, W1278), else lowered toward their walking but never under
 *  STRETCH_MIN_SHARE of the printed goal, so it stays a real attempt (it can be lost). Flights and sleep: as printed.
 *  The Twin Maw stays sized to the walking (every pair's fallback). Null only for a rank, party or window mismatch. Pure. */
export function runDuo(bossId: string, r: number, fit: number, fl: number | null, halfOk = false): AutoPick | null {
  void fl;   // W1280 — flights are asked as printed now; the parameter stays for the callers
  const multi = AUTO_MULTI_BOSSES.includes(bossId);   // W1278
  if (!AUTO_BOSSES.includes(bossId) && !multi) return null;
  const cfg = COOP_BOSS_CFG[bossId];
  if (!cfg || (RANK_ORDER[cfg.rank] ?? 0) > r || (cfg.partySize ?? 2) !== 2) return null;
  if (!multi && cfg.windowHours !== 24) return null;
  if (cfg.halfEach) return halfOk ? { bossId, goalSteps: cfg.goalSteps } : null;   // W1339 — a target: as printed (an attempt, W1280)
  const days = multi ? Math.max(1, Math.round(cfg.windowHours / 24)) : 1;
  const fitW = fit * days;
  const walked = Math.round(fitW / 100) * 100;
  const attempt = (goal: number) => (goal <= fitW ? goal : Math.max(Math.round((STRETCH_MIN_SHARE * goal) / 100) * 100, walked));
  if (cfg.metric === 'steps') {
    if (bossId === AUTO_SIZED_BOSS && cfg.goalSteps > fitW) return { bossId, goalSteps: Math.max(AUTO_MIN_GOAL, walked) };
    return { bossId, goalSteps: attempt(cfg.goalSteps) };
  }
  if (cfg.metric === 'flights') return { bossId, goalSteps: cfg.goalSteps };
  if (cfg.metric === 'both' || cfg.metric === 'steps_sleep') return { bossId, goalSteps: attempt(cfg.goalSteps), goalFlights: cfg.goalFlights ?? 0 };
  return null;
}

/** W1268 — the same for a one-day steps trio (the sized one is The Crossroads Hound). W1280: always an attempt, never under
 *  STRETCH_MIN_SHARE of the printed goal. Pure. */
export function runTrio(bossId: string, r: number, fit: number): AutoPick | null {
  if (!AUTO_TRIO_BOSSES.includes(bossId)) return null;
  const cfg = COOP_BOSS_CFG[bossId];
  if (!cfg || (RANK_ORDER[cfg.rank] ?? 0) > r || cfg.windowHours !== 24 || cfg.partySize !== 3 || cfg.metric !== 'steps') return null;
  if (cfg.goalSteps <= fit) return { bossId, goalSteps: cfg.goalSteps };
  const g = Math.round(fit / 100) * 100;
  if (bossId === AUTO_TRIO_SIZED_BOSS) return { bossId, goalSteps: Math.max(AUTO_TRIO_MIN_GOAL, g) };
  return { bossId, goalSteps: Math.max(Math.round((STRETCH_MIN_SHARE * cfg.goalSteps) / 100) * 100, g) };
}

/** W1268 — a Pacific day as a day number, for whose turn it is. */
export function dayIndex(day?: string | null): number {
  const t = Date.parse(String(day || '') + 'T00:00:00Z');
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : 0;
}

/** W1268 — the boss a group's Auto Hunts targets pick (owner 2026-11-21, the Claude Design "Auto Hunts" handoff):
 *  1. a boss two or more members want;
 *  2. otherwise, when members want different bosses, the member whose turn it is: members in id order, the
 *     day number picks one, so a pair alternates day by day;
 *  3. otherwise the one member who has a target that can run.
 *  Each member's list is best first; a boss the group cannot run (`run` null) or already has live is passed
 *  over; among equals the one the group is on least today, so one hunter's targets spread across partners.
 *  reason = the members whose target it is. Null when no member has a target that can run: Auto picks. Pure. */
export function targetChoice(wants: PickPrefs['wants'], run: (bossId: string) => AutoPick | null, prefs: PickPrefs = {}): AutoPick | null {
  if (!wants || !wants.length) return null;
  const live = prefs.live ?? (() => false);
  const today = prefs.today ?? (() => 0);
  const ok = new Map<string, AutoPick | null>();
  const can = (b: string): AutoPick | null => {
    if (!ok.has(b)) ok.set(b, live(b) ? null : run(b));
    return ok.get(b) ?? null;
  };
  const per = wants
    .map((w) => ({ uid: w.uid, list: w.bosses.filter((b) => !!can(b)) }))
    .filter((w) => w.list.length)
    .sort((x, y) => (x.uid < y.uid ? -1 : x.uid > y.uid ? 1 : 0));
  if (!per.length) return null;
  const least = (list: readonly string[]) => {
    let best = list[0];
    for (const b of list.slice(1)) if (today(b) < today(best)) best = b;
    return best;
  };
  const by = new Map<string, string[]>();
  for (const w of per) for (const b of w.list) by.set(b, [...(by.get(b) ?? []), w.uid]);
  const shared = [...by.entries()].filter(([, u]) => u.length > 1).map(([b]) => b);
  if (shared.length) {
    const b = least(shared);
    return { ...can(b)!, reason: by.get(b)! };
  }
  const turn = per[dayIndex(prefs.day) % per.length];
  const b = least(turn.list);
  return { ...can(b)!, reason: [turn.uid] };
}

/** The boss and goal for a pair: among the bosses both ranks allow whose printed goals all fit
 *  AUTO_FIT × the pair's averages (steps a day; flights a day, null when either phone has not sent
 *  one), the one choosePick takes (W1209); none fits → The Twin Maw sized to the pair's walking.
 *  For a flights boss goalSteps holds the flights, as the catalog and isGoalMet do. */
export function pickAutoBoss(rankA: string, rankB: string, pairPattern: number, pairFlights: number | null = null, prefs: PickPrefs = {}): AutoPick {
  const r = Math.min(RANK_ORDER[rankA] ?? 0, RANK_ORDER[rankB] ?? 0);
  const fit = AUTO_FIT * Math.max(0, Number(pairPattern) || 0);
  const fl = pairFlights == null || !Number.isFinite(Number(pairFlights)) ? null : AUTO_FIT * Math.max(0, Number(pairFlights));
  const targeted = targetChoice(prefs.wants, (b) => runDuo(b, r, fit, fl, !!prefs.half?.ok), prefs);   // W1268 — the pair's targets first
  if (targeted) return targeted;
  const fits: AutoPick[] = [];
  for (const bossId of AUTO_BOSSES) {
    const cfg = COOP_BOSS_CFG[bossId];
    if (!cfg || (RANK_ORDER[cfg.rank] ?? 0) > r) continue;
    if (cfg.windowHours !== 24 || (cfg.partySize ?? 2) !== 2) continue;
    if (cfg.halfEach) {   // W1339 — each hunter must do their own half: the weaker hunter alone decides
      const h = prefs.half;
      if (!h || !h.ok) continue;
      const share = Math.ceil(cfg.goalSteps / 2);
      if (cfg.metric === 'steps' ? share <= h.fit : cfg.metric === 'flights' && h.fl !== null && share <= h.fl) fits.push({ bossId, goalSteps: cfg.goalSteps });
      continue;
    }
    if (cfg.metric === 'steps') {
      if (cfg.goalSteps <= fit) fits.push({ bossId, goalSteps: cfg.goalSteps });
    } else if (cfg.metric === 'flights') {
      if (fl !== null && cfg.goalSteps <= fl) fits.push({ bossId, goalSteps: cfg.goalSteps });
    } else if (cfg.metric === 'both') {
      const gf = cfg.goalFlights ?? 0;
      if (fl !== null && cfg.goalSteps <= fit && gf <= fl) fits.push({ bossId, goalSteps: cfg.goalSteps, goalFlights: gf });
    }
  }
  const free = prefs.live ? fits.filter((p) => !prefs.live!(p.bossId)) : fits;   // W1267
  const stretched = stretchPick(AUTO_BOSSES, free, r, fit, prefs, 2);   // W1215
  if (stretched) return stretched;
  const chosen = choosePick(free, prefs);
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
  const targeted = targetChoice(prefs.wants, (b) => runTrio(b, r, fit), prefs);   // W1268 — the trio's targets first
  if (targeted) return targeted;
  const fits: AutoPick[] = [];
  let open = false;
  for (const bossId of AUTO_TRIO_BOSSES) {
    const cfg = COOP_BOSS_CFG[bossId];
    if (!cfg || (RANK_ORDER[cfg.rank] ?? 0) > r) continue;
    if (cfg.windowHours !== 24 || cfg.partySize !== 3 || cfg.metric !== 'steps') continue;
    open = true;
    if (cfg.goalSteps <= fit) fits.push({ bossId, goalSteps: cfg.goalSteps });
  }
  const free = prefs.live ? fits.filter((p) => !prefs.live!(p.bossId)) : fits;   // W1267
  const stretched = stretchPick(AUTO_TRIO_BOSSES, free, r, fit, prefs, 3);   // W1215
  if (stretched) return stretched;
  const chosen = choosePick(free, prefs);
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
/** you + 5. W1239 — owner 2026-11-18: "automated at 6 hunters": a raid forms only when six are free (was 4-6). */
export const AUTO_RAID_PARTY = 6;
/** "Active" — W1240, the owner's definition (2026-11-18): "We will call a person active if they've opened the app
 *  at least 5x in the last 7 days": AUTO_RAID_MIN_OPENS app opens over ACTIVE_OPEN_DAYS Pacific days, today
 *  included (a rolling window; W1239 counted from Sunday, which left nobody active early on a Sunday). Replaced
 *  W1211's "a boss kill on 4 of the last 7 days", which left only four hunters (all friends) for the raid of
 *  2026-11-18. */
export const AUTO_RAID_MIN_OPENS = 5;
export const ACTIVE_OPEN_DAYS = 7;
/** W1240 — the first PT day of the rolling ACTIVE_OPEN_DAYS window that ends today. */
export function activeWindowStart(today: string): string {
  let d = today;
  for (let i = 1; i < ACTIVE_OPEN_DAYS; i++) d = prevDay(d) || d;
  return d;
}

/** W1239 — "completely random": a fresh shuffle every pass (Fisher-Yates). W1211 used one order for the whole
 *  Pacific day, so the same hunters kept landing together. `rnd` is injectable for tests. */
export function raidShuffle(ids: readonly string[], rnd: () => number = Math.random): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** W1239 — each hunter's app opens since `since` (a PT day key): the raid's "active" bar (W1240: the last 7 days). */
async function opensSince(env: Env, since: string): Promise<Map<string, number>> {
  const rows = (await env.DB.prepare(
    `SELECT a.user_id AS user_id, SUM(a.opens) AS week_opens
       FROM app_open_counts a JOIN users u ON u.id = a.user_id
      WHERE a.day_pt >= ?1 AND a.opens > 0 AND COALESCE(u.apple_sub, '') NOT LIKE 'sim_test_%'
      GROUP BY a.user_id`,
  ).bind(since).all<{ user_id: string; week_opens: number }>()).results ?? [];
  return new Map(rows.filter((r) => r.user_id).map((r) => [r.user_id, Number(r.week_opens) || 0]));
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
  // W1267 — every live hunt as (boss → the hunters on it); a group "already has" a boss when one live hunt on
  // it holds the whole group: a duo = the pair, a trio = all three (a trio sharing two hunters with another trio
  // on the same boss is a different hunt, and W1210 still gives up to three trios a day).
  // W1268 — every hunter's Auto Hunts settings (one small table), read once per sweep.
  let prefsP: Promise<Map<string, AutoPrefs>> | null = null;
  const allPrefs = () => (prefsP ??= readAllAutoPrefs(env));
  let sleepP: Promise<Set<string>> | null = null;   // W1281
  const sleepers = () => (sleepP ??= sleepersSince(env, Date.now()));
  let liveP: Promise<Map<string, Set<string>[]>> | null = null;
  let liveMap: Map<string, Set<string>[]> | null = null;
  const markLive = (m: Map<string, Set<string>[]>, ids: readonly string[], bossId: string) => {
    if (!m.has(bossId)) m.set(bossId, []);
    m.get(bossId)!.push(new Set(ids.filter(Boolean)));
  };
  const lives = () => (liveP ??= (async () => {
    const out = new Map<string, Set<string>[]>();
    try {
      const rows = (await env.DB.prepare(
        `SELECT i.id AS id, i.boss_id AS boss_id, i.challenger_user_id AS a, i.partner_user_id AS b,
                i.partner2_user_id AS c, p.user_id AS d, i.ends_at AS e
           FROM coop_boss_instances i LEFT JOIN coop_boss_participants p ON p.instance_id = i.id
          WHERE i.status IN ('pending', 'active')`,
      ).all<{ id: string; boss_id: string; a: string | null; b: string | null; c: string | null; d: string | null; e?: string | null }>()).results ?? [];
      // W1279 — a hunt whose window has closed (yesterday's, waiting for the settle pass) is not live: at midnight it
      // would otherwise hold back the new day's target
      const nowIso = new Date().toISOString();
      rows.splice(0, rows.length, ...rows.filter((r) => !r.e || String(r.e) > nowIso));
      const hunts = new Map<string, { boss: string; ids: Set<string> }>();
      for (const r of rows) {
        if (!r.id || !r.boss_id) continue;
        if (!hunts.has(r.id)) hunts.set(r.id, { boss: r.boss_id, ids: new Set() });
        const h = hunts.get(r.id)!;
        for (const u of [r.a, r.b, r.c, r.d]) if (u) h.ids.add(u);
      }
      for (const h of hunts.values()) markLive(out, [...h.ids], h.boss);
    } catch (err) {
      console.error('[coop-auto] live hunts read failed', err);
    }
    liveMap = out;
    return out;
  })());
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
      const [hist, tod, owned, live, prefsAll, kills, sleep] = await Promise.all([history(), todays(), ownedAutoDrops(env, ids), lives(), allPrefs(), coopKillsOf(env, ids), sleepers()]);
      const mine = hist.get([...ids].sort().join('|')) ?? new Map<string, string>();
      return {
        useful: (bossId) => stillNeeded(owned, ids, bossId),
        today: (bossId) => ids.reduce((n, u) => n + (tod.get(u)?.get(bossId) ?? 0), 0),
        last: (bossId) => mine.get(bossId) ?? '',
        live: (bossId) => (live.get(bossId) ?? []).some((on) => ids.every((u) => on.has(u))),   // W1267
        // W1268 — a first kill to discover; a failed read discovers nothing (the W1209 order stands)
        fresh: (bossId) => !!kills && ids.some((u) => !kills.get(u)?.has(bossId)),
        // W1279 — owner 2026-11-22, one target (the Twin Maw) put on six partners at once: "I would want the rest of the hunts to
        // be on auto so it just doesn't send a bunch of twin maw out". A target makes ONE hunt at a time: a boss someone in the
        // group is already hunting (a live hunt, made earlier in this sweep or by hand) is not a target for this group, so the
        // rest of the day's hunts go to the other targets, then Auto.
        wants: ids
          .map((u) => { const p = prefsAll.get(u); return { uid: u, bosses: p && p.mode === 'targets' ? p.targets.map((t) => t.b) : [] }; })
          .map((w) => ({ uid: w.uid, bosses: w.bosses.filter((b) => !(live.get(b) ?? []).some((on) => ids.some((x) => on.has(x)))) }))
          // W1281 — a sleep boss only for a group that all tracked sleep in the last 7 nights
          .map((w) => ({ uid: w.uid, bosses: w.bosses.filter((b) => !needsSleep(b) || ids.every((x) => sleep.has(x))) }))
          .filter((w) => w.bosses.length),
        day: today,
      };
    },
    add(ids, bossId) {
      if (todayMap) for (const uid of ids) bump(todayMap, uid, bossId);
      if (liveMap) markLive(liveMap, ids, bossId);   // W1267 — a hunt this sweep made is live too
    },
  };
}

/** W1195 — the pair's flights a day, or null when either phone has not sent an average. */
export function pairFlightsOf(flights: Map<string, number>, a: string, b: string): number | null {
  const fa = flights.get(a), fb = flights.get(b);
  return fa === undefined || fb === undefined ? null : fa + fb;
}

/** W1281 — the hunters whose phone saw sleep on at least one of its last 7 nights (app_opens.sleep_nights, newest row of
 *  the last 7 days). A sleep co-op boss needs both hunters in here. A failed read (before migration 0081) is nobody. */
export async function sleepersSince(env: Env, nowMs: number): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const since = Math.floor(nowMs / 1000) - 7 * 86_400;
    const sinceDay = new Date(nowMs - 8 * 86_400_000).toISOString().slice(0, 10);
    const rows = await env.DB.prepare(
      `SELECT user_id, sleep_nights, MAX(opened_at) AS last FROM app_opens INDEXED BY idx_app_opens_date
        WHERE date_utc >= ?2 AND opened_at >= ?1 AND sleep_nights IS NOT NULL
        GROUP BY user_id`,
    ).bind(since, sinceDay).all<{ user_id: string; sleep_nights: number | null }>();
    for (const r of rows.results ?? []) if (r.user_id && Number(r.sleep_nights) >= 1) out.add(r.user_id);
  } catch (err) {
    console.error('[coop-auto] sleepers read failed', err);
  }
  return out;
}
/** W1281 — a sleep co-op boss (steps + sleep) asks every hunter for a sleep device. */
export function needsSleep(bossId: string): boolean {
  return COOP_BOSS_CFG[bossId]?.metric === 'steps_sleep';
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
  // W1268 — the Auto Hunts switches: "uid>#match" = never matched with a new hunter, "uid>#raid" = never drawn
  try {
    const p = await env.DB.prepare('SELECT user_id, match_on, raid_on FROM coop_auto_prefs WHERE match_on = 0 OR raid_on = 0')
      .all<{ user_id: string; match_on: number; raid_on: number }>();
    for (const r of p.results ?? []) {
      if (!r.user_id) continue;
      if (Number(r.match_on) === 0) out.add(r.user_id + '>#match');
      if (Number(r.raid_on) === 0) out.add(r.user_id + '>#raid');
    }
  } catch (_) { /* before migration 0080: nobody has switched either off */ }
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
  // W1278 — a multi-day duo runs its whole window (2 or 3 Pacific days); every other automatic hunt is one day
  let endDay = nextDay(dayKey);
  for (let i = 1; i < Math.max(1, Math.round((cfg.windowHours || 24) / 24)); i++) endDay = nextDay(endDay);
  const endsAt = ptMidnightIso(endDay);
  if (!startsAt || !endsAt) return false;
  const res = await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO coop_boss_instances
           (id, boss_id, boss_rank, challenger_user_id, partner_user_id, partner2_user_id,
            partner_joined_at, partner2_joined_at, goal_steps, goal_flights, reward_souls,
            status, starts_at, ends_at, auto, hunt_day, pair_key, matched, auto_reason)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?, ?)`,
      )
      .bind(id, pick.bossId, cfg.rank, challenger, partner, startsAt, pick.goalSteps,
        cfg.metric === 'both' || cfg.metric === 'steps_sleep' ? (pick.goalFlights ?? cfg.goalFlights ?? null) : null,   // W1195 — a steps + flights boss carries both goals; W1278 — the sleep goal too
        cfg.rewardSouls, startsAt, endsAt, dayKey, pairKey(a, b), matched ? 1 : 0,
        pick.reason?.length ? pick.reason.join(',') : null),   // W1268
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
            status, starts_at, ends_at, auto, hunt_day, pair_key, matched, auto_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active', ?, ?, 1, ?, ?, 0, ?)`,
      )
      .bind(id, pick.bossId, cfg.rank, challenger, partner, partner2, startsAt, startsAt, pick.goalSteps,
        cfg.rewardSouls, startsAt, endsAt, dayKey, [challenger, partner, partner2].join('|'),
        pick.reason?.length ? pick.reason.join(',') : null),   // W1268
    seat(partner),
    seat(partner2),
  ]);
  return Number(res[0]?.meta?.changes ?? 0) > 0;
}

/** Cron, every 2 minutes: today's hunt for every walking friend pair that has none yet, then
 *  (W1164) today's hunt for every matched pair of active hunters who have no friends, then
 *  (W1208) today's automatic trios. */
export async function sweepCoopAutoHunts(env: Env, _ctx?: ExecutionContext): Promise<{ created: number; pairs: number; skipped: number; matched: number; trios: number; raids: number; swaps: number; moves: number; waiting: number }> {
  const out = { created: 0, pairs: 0, skipped: 0, matched: 0, trios: 0, raids: 0, swaps: 0, moves: 0, waiting: 0 };
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
          const pick = pickAutoBoss(ranks.get(a) ?? 'E', ranks.get(b) ?? 'E', pa + pb, pairFlightsOf(flights, a, b),
            { ...prefs, half: halfFitOf(pa, pb, flights, builds, a, b) });   // W1339
          if (prefs.live?.(pick.bossId)) { out.skipped++; continue; }   // W1267 — the pair already has this hunt live
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

    // W1248 — when each hunter was last in the app, read once per pass and only when a raid pass needs it.
    let seenP: Promise<Map<string, number>> | null = null;
    const lastSeen = () => (seenP ??= lastSeenByUser(env, nowMs));

    // ── W1248 — stand-ins for raiders away 24 hours, BEFORE new raids form, so a free hunter fills a seat first ──
    try {
      out.swaps = await sweepRaidStandIns(env, nowMs, today, shared, lastSeen, _ctx);
    } catch (err) {
      console.error('[coop-auto] raid stand-in sweep failed', err);
    }
    // ── W1251 — short teams' active walkers move to the raid closest to winning that has room for them ──
    try {
      out.moves = await sweepRaidMoves(env, nowMs, shared, lastSeen, _ctx);
    } catch (err) {
      console.error('[coop-auto] raid move sweep failed', err);
    }

    // ── W1262 — a short team waits with its clock stopped and fills its seats; it runs again at four with a walker ──
    try {
      out.waiting = await sweepRaidWaiting(env, nowMs, today, shared, lastSeen, _ctx);
    } catch (err) {
      console.error('[coop-auto] raid waiting sweep failed', err);
    }

    // ── W1211 — the automatic raid ──
    try {
      out.raids = await sweepAutoRaids(env, nowMs, today, activeWindowStart(today), shared, _ctx, out.created + out.matched + out.trios, inApp, lastSeen);   // W1240
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
    if (optouts.has(r.user_id + '>#match')) continue;               // W1268 — "Match me with new hunters" off
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
    const pa = byId.get(a)?.pattern ?? 0, pb = byId.get(b)?.pattern ?? 0;
    const pick = pickAutoBoss(ranks.get(a) ?? 'E', ranks.get(b) ?? 'E', pa + pb, pairFlightsOf(flights, a, b),
      { ...prefs, half: halfFitOf(pa, pb, flights, builds, a, b) });   // W1339
    if (prefs.live?.(pick.bossId)) continue;   // W1267
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
    if (!pick || prefs.live?.(pick.bossId)) continue;   // W1267
    if (await createAutoTrio(env, trio, today, pick)) { made++; picks.add(trio, pick.bossId); }
  }
  return made;
}

/** W1211 — the automatic raid pass (see AUTO_RAID_BOSS). W1239: the hunters with AUTO_RAID_MIN_OPENS app opens
 *  since Sunday who were in the app today or yesterday (W1217), are on the automatic client, have not switched
 *  automatic hunts off and are in no live raid are shuffled afresh and put in parties of exactly six; fewer wait
 *  for the next pass. A raid that ends frees its hunters for the next pass (back to back). Each hunter of a new
 *  raid is told once. Returns how many raids it made. */
async function sweepAutoRaids(
  env: Env,
  nowMs: number,
  today: string,
  activeSince: string,
  shared: () => Promise<Shared>,
  ctx: ExecutionContext | undefined,
  madeSoFar: number,
  inApp: () => Promise<Set<string>>,
  lastSeen: () => Promise<Map<string, number>> = async () => new Map(),
  rnd: () => number = Math.random,
): Promise<number> {
  const cfg = COOP_BOSS_CFG[AUTO_RAID_BOSS];
  if (!cfg) return 0;
  void today;
  const min = AUTO_RAID_PARTY;   // W1239 — exactly six
  const opens = await opensSince(env, activeSince);   // W1240 — 5+ opens in the last 7 days
  const active = Array.from(opens.entries()).filter(([, n]) => n >= AUTO_RAID_MIN_OPENS).map(([uid]) => uid).sort();
  if (active.length < min) return 0;

  const [optouts, blocks, builds] = await shared();
  const busy = await huntersInLiveRaid(env, AUTO_RAID_BOSS);   // one raid at a time
  const opened = await inApp();   // W1217
  const seen = await lastSeen();   // W1248
  const pool: string[] = [];
  for (const uid of active) {
    if (busy.has(uid)) continue;
    if (!opened.has(uid)) continue;                            // W1217/W1218 — not in the app today or yesterday
    if (!seenWithin(seen, uid, nowMs)) continue;               // W1248 — away 24 hours: a stand-in rule's mirror, never drawn
    if (buildW(builds.get(uid)) < AUTO_HUNT_MIN_W) continue;   // the automatic client is not on their phone
    if (optouts.has(uid + '>*')) continue;                     // switched automatic hunts off
    if (optouts.has(uid + '>#raid')) continue;                 // W1268 — "Join the raid draw" off
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
  for (const party of formRaidParties(raidShuffle(pool, rnd), isBlocked, AUTO_RAID_PARTY, min)) {
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

/** W1248 — RAID STAND-INS (owner 2026-11-20: "If a player on a raid is currently inactive for 24 hours straight,
 *  replace them with a person that is waiting to be on a raid or that is active and qualifies to be raiding").
 *  W1249: only while under RAID_LOCK_STEPS raid steps (W1311: 3,000); that many locks the seat in for the rest of the raid.
 *  Every pass, before new raids form: a member of a live automatic raid who has not REALLY opened the app (W1250: a
 *  background wake is not an open) for RAID_IDLE_HOURS, counted from the later of their last open and the moment they took the
 *  seat (so someone just drawn always gets a full day), gives the seat to a stand-in: a hunter waiting in the
 *  raid finder first, else a random hunter who qualifies for a raid today (5+ opens in the last 7 days, in the
 *  app in the last 24 hours, in no live raid, on a current build, automatic hunts on, nobody on the team blocked
 *  or switched off). What the departed hunter walked stays with the team (banked on the row, migration 0077);
 *  they leave quietly and get nothing from the raid. The stand-in's phone counts from the raid's start like
 *  everyone else's (the client reads the hunt window), and gets the "Raid Party Found" push. */
export const RAID_IDLE_HOURS = 24;
export const MAX_SWAPS_PER_RUN = 12;
/** W1249 — owner 2026-11-20: "if they've already registered steps into the raid...they get locked in...only steps
 *  less than 1000 ... get replaced" (chose: away 24h AND under 1,000). A raider whose raid steps reached this is
 *  locked in for the rest of the raid, however long they are away.
 *  W1311 — owner 2026-11-24: "maybe the steps needs to be a better number than 1000 steps" -> 3,000 (chosen over 5,000
 *  and 10,000): a short walk, about 9% of a hunter's share of the 200,000-step raid. */
export const RAID_LOCK_STEPS = 3000;
const RAID_IDLE_MS = RAID_IDLE_HOURS * 3_600_000;

/** W1248 — true when this hunter was in the app within the last RAID_IDLE_HOURS. */
export function seenWithin(seen: Map<string, number>, uid: string, nowMs: number): boolean {
  return nowMs - (seen.get(uid) ?? 0) < RAID_IDLE_MS;
}

/** W1248 — pure: the members away RAID_IDLE_HOURS or more, from the later of their last visit and their seat. */
export function idleRaiders(
  members: readonly { uid: string; joinedMs: number }[],
  seen: Map<string, number>,
  nowMs: number,
): string[] {
  return members
    .filter((m) => m.uid && nowMs - Math.max(seen.get(m.uid) ?? 0, Number.isFinite(m.joinedMs) ? m.joinedMs : 0) >= RAID_IDLE_MS)
    .map((m) => m.uid);
}

/** W1248 — pure: the stand-in for one seat: the raid finder's queue in order first, then a random hunter from the
 *  pool; never someone already on the team, and never someone blocked with (or switched off by) a teammate. */
export function pickStandIn(
  waiting: readonly string[],
  pool: readonly string[],
  team: readonly string[],
  isBlocked: (a: string, b: string) => boolean,
  rnd: () => number = Math.random,
  left: readonly string[] = [],
): string | null {
  // W1311 — never someone who already left this raid: their steps from before they left are banked on the team, and
  // their phone counts from the raid's start again, so they would count twice (Renaldo, 2026-11-24: 625 steps).
  const ok = (uid: string) => !!uid && !team.includes(uid) && !left.includes(uid) && !team.some((t) => isBlocked(t, uid));
  for (const uid of waiting) if (ok(uid)) return uid;
  const free = pool.filter(ok);
  if (!free.length) return null;
  return free[Math.min(free.length - 1, Math.floor(rnd() * free.length))] ?? null;
}

/** W1248 → W1250 — when each hunter last REALLY opened the app, over the last 14 Pacific days (ms). Owner 2026-11-20:
 *  "I am pretty sure it just is a background thing but they don't actually open the app": an Apple Health background
 *  wake pings the server too (open:false), which moved app_opens.opened_at, and cloud saves can follow such a wake,
 *  so neither counts. Only real opens do (app_open_counts, opens > 0): last_open_at (migration 0078), or, for an open
 *  counted before that column existed, the end of that Pacific day (the latest it could have been, never early). */
async function lastSeenByUser(env: Env, nowMs: number): Promise<Map<string, number>> {
  let since = ptDayKey(nowMs) || '';
  for (let i = 1; i < 14; i++) since = prevDay(since) || since;
  const rows = (await env.DB.prepare(
    `SELECT user_id, day_pt, last_open_at AS last_seen FROM app_open_counts WHERE day_pt >= ?1 AND opens > 0`,
  ).bind(since).all<{ user_id: string; day_pt?: string; last_seen: number | null }>()).results ?? [];
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.user_id) continue;
    let t = Number(r.last_seen) || 0;
    if (!t && r.day_pt) {
      const next = nextDay(r.day_pt);
      const end = next ? Date.parse(ptMidnightIso(next) || '') : NaN;
      if (Number.isFinite(end)) t = end - 1;
    }
    if (t > (out.get(r.user_id) ?? 0)) out.set(r.user_id, t);
  }
  return out;
}

/** W1311 — who has left each of these raids (swapped out, or an open seat a moved walker took): never drawn back in. */
export async function leaversByInstance(env: Env, ids: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const slice of chunks(Array.from(ids))) {
    if (!slice.length) continue;
    const ph = slice.map(() => '?').join(',');
    const rs = (await env.DB.prepare(`SELECT instance_id, out_user_id FROM coop_raid_swaps WHERE instance_id IN (${ph})`)
      .bind(...slice).all<{ instance_id: string; out_user_id?: string }>()).results ?? [];
    for (const r of rs) {
      if (!r.instance_id || !r.out_user_id) continue;
      const list = out.get(r.instance_id) ?? [];
      if (!list.includes(r.out_user_id)) list.push(r.out_user_id);
      out.set(r.instance_id, list);
    }
  }
  return out;
}

/** W1248 — one swap, guarded statement by statement: `out` leaves this live raid and `inn` takes the seat. What
 *  `out` walked here is banked on the row (the team's bars never drop), the seat changes hands (the challenger
 *  column, or a participant row with the legacy partner columns following), and the swap is logged. A raid that
 *  just settled, or a pass racing this one, writes nothing. True when the seat changed hands. */
export async function swapRaider(
  env: Env,
  row: CoopBossRow,
  out: string,
  inn: string,
  banked: { steps: number; flights: number },
  nowMs: number,
): Promise<boolean> {
  const at = new Date(nowMs).toISOString();
  const steps = Math.max(0, Math.round(Number(banked.steps) || 0));
  const flights = Math.max(0, Math.round(Number(banked.flights) || 0));
  const log = (holds: string) => env.DB
    .prepare(
      `INSERT OR IGNORE INTO coop_raid_swaps (instance_id, out_user_id, in_user_id, out_steps, out_flights, swapped_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE ${holds}`,
    )
    .bind(row.id, out, inn, steps, flights, at);
  if (row.challenger_user_id === out) {
    const res = await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE coop_boss_instances
              SET challenger_user_id = ?3, banked_steps = banked_steps + ?4, banked_flights = banked_flights + ?5, updated_at = ?6
            WHERE id = ?1 AND status = 'active' AND challenger_user_id = ?2`,
        )
        .bind(row.id, out, inn, steps, flights, at),
      log('EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1 AND challenger_user_id = ?3)'),
    ]);
    return Number(res[0]?.meta?.changes ?? 0) > 0;
  }
  const res = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE coop_boss_instances
            SET banked_steps = banked_steps + ?4, banked_flights = banked_flights + ?5,
                partner_user_id = CASE WHEN partner_user_id = ?2 THEN ?3 ELSE partner_user_id END,
                partner2_user_id = CASE WHEN partner2_user_id = ?2 THEN ?3 ELSE partner2_user_id END,
                updated_at = ?6
          WHERE id = ?1 AND status = 'active'
            AND EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?2)`,
      )
      .bind(row.id, out, inn, steps, flights, at),
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
           SELECT ?1, ?3, ?4
            WHERE EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?2)
              AND EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1 AND status = 'active')`,
      )
      .bind(row.id, out, inn, at),
    env.DB
      .prepare(
        `DELETE FROM coop_boss_participants
          WHERE instance_id = ?1 AND user_id = ?2
            AND EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?3)`,
      )
      .bind(row.id, out, inn),
    log(`EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?3)
            AND NOT EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?2)`),
  ]);
  return Number(res[0]?.meta?.changes ?? 0) > 0;
}

async function sweepRaidStandIns(
  env: Env,
  nowMs: number,
  today: string,
  shared: () => Promise<Shared>,
  lastSeen: () => Promise<Map<string, number>>,
  ctx: ExecutionContext | undefined,
  rnd: () => number = Math.random,
): Promise<number> {
  const cfg = COOP_BOSS_CFG[AUTO_RAID_BOSS];
  if (!cfg) return 0;
  const rows = (await env.DB.prepare(
    `SELECT * FROM coop_boss_instances
      WHERE status = 'active' AND auto = 1 AND boss_id = ?1 AND ends_at > ?2 AND paused_remaining_ms IS NULL
      ORDER BY ends_at ASC LIMIT 50`,
  ).bind(AUTO_RAID_BOSS, new Date(nowMs).toISOString()).all<CoopBossRow>()).results ?? [];
  if (!rows.length) return 0;
  const parts = await loadParticipants(env, rows.map((r) => r.id));
  const seen = await lastSeen();
  const idleBy = new Map<string, string[]>();
  for (const r of rows) {
    r.participants = parts.get(r.id) ?? [];
    const startMs = Date.parse(r.starts_at || '');
    const members = [
      { uid: r.challenger_user_id, joinedMs: startMs },
      ...r.participants.map((p) => ({ uid: p.user_id, joinedMs: Date.parse(p.joined_at || r.starts_at || '') })),
    ];
    const idle = idleRaiders(members, seen, nowMs);
    if (idle.length) idleBy.set(r.id, idle);
  }
  if (!idleBy.size) return 0;
  // W1249 — locked in: 1,000+ raid steps keeps the seat, however long the hunter is away.
  const prog = await getCoopProgressForInstances(env, Array.from(idleBy.keys()));
  for (const [iid, idle] of Array.from(idleBy.entries())) {
    const p = prog.get(iid) ?? emptyProgress();
    const open = idle.filter((uid) => (p.steps.get(uid) || 0) < RAID_LOCK_STEPS);
    if (open.length) idleBy.set(iid, open);
    else idleBy.delete(iid);
  }
  // W1252 — owner 2026-11-20 ("...that'll leave mercury on the sideline waiting for a team"): a stand-in only joins a raid
  // that can still use them: more than SHORT_TEAM_ACTIVE members in the app in the last 24 hours (a shorter one gives its
  // walkers away instead, W1251), and the raid closest to winning is filled first.
  const pct = (r: CoopBossRow) => {
    const p = prog.get(r.id) ?? emptyProgress();
    const ids = participantIds(r);
    const s = ids.reduce((n, u) => n + (p.steps.get(u) || 0), 0) + (Number(r.banked_steps) || 0);
    const f = ids.reduce((n, u) => n + (p.flights.get(u) || 0), 0) + (Number(r.banked_flights) || 0);
    return Math.min(r.goal_steps ? s / r.goal_steps : 1, r.goal_flights ? f / r.goal_flights : 1);
  };
  for (const r of rows) {
    if (!idleBy.has(r.id)) continue;
    if (participantIds(r).filter((u) => seenWithin(seen, u, nowMs)).length < STANDIN_MIN_ACTIVE) idleBy.delete(r.id);
  }
  if (!idleBy.size) return 0;
  rows.sort((a, b) => pct(b) - pct(a));

  const [optouts, blocks, builds] = await shared();
  const busy = await huntersInLiveRaid(env, AUTO_RAID_BOSS);
  const opens = await opensSince(env, activeWindowStart(today));
  const qualifies = async (uid: string): Promise<boolean> => {
    if (!uid || busy.has(uid) || !seenWithin(seen, uid, nowMs)) return false;
    if (buildW(builds.get(uid)) < AUTO_HUNT_MIN_W) return false;   // the automatic client is not on their phone
    if (optouts.has(uid + '>*')) return false;                     // switched automatic hunts off
    if (optouts.has(uid + '>#raid')) return false;                 // W1268 — "Join the raid draw" off
    if (cfg.memberOnly && !MEMBERSHIP_OPEN) {
      try { if (!(await readEntitlements(env, uid)).member) return false; } catch { return false; }
    }
    return true;
  };
  const queued = (await env.DB.prepare('SELECT user_id FROM raid_queue WHERE boss_id = ?1 ORDER BY created_at ASC')
    .bind(AUTO_RAID_BOSS)
    .all<{ user_id: string }>()).results ?? [];
  const waiting: string[] = [];
  for (const q of queued) if (!waiting.includes(q.user_id) && (await qualifies(q.user_id))) waiting.push(q.user_id);
  const pool: string[] = [];
  for (const [uid, n] of Array.from(opens.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (n >= AUTO_RAID_MIN_OPENS && !waiting.includes(uid) && (await qualifies(uid))) pool.push(uid);
  }
  if (!waiting.length && !pool.length) return 0;

  const isBlocked = (a: string, b: string) =>
    blocks.has(pairKey(a, b)) || optouts.has(a + '>' + b) || optouts.has(b + '>' + a);
  const goal = thousands(cfg.goalSteps) + ' steps' + (cfg.goalFlights ? ' and ' + thousands(cfg.goalFlights) + ' flights' : '');
  let swaps = 0;
  const leavers = await leaversByInstance(env, Array.from(idleBy.keys()));   // W1311
  for (const r of rows) {
    const idle = idleBy.get(r.id);
    if (!idle) continue;
    let team = participantIds(r);
    const left = leavers.get(r.id) ?? [];
    for (const out of idle) {
      if (swaps >= MAX_SWAPS_PER_RUN) return swaps;
      const inn = pickStandIn(waiting, pool, team.filter((u) => u !== out), isBlocked, rnd, left.concat([out]));
      if (!inn) break;   // nobody free for this team: the seat stays as it is until someone is
      const p = prog.get(r.id) ?? emptyProgress();
      const banked = { steps: p.steps.get(out) || 0, flights: p.flights.get(out) || 0 };
      if (!(await swapRaider(env, r, out, inn, banked, nowMs))) continue;
      swaps++;
      busy.add(inn);
      for (const list of [waiting, pool]) { const i = list.indexOf(inn); if (i >= 0) list.splice(i, 1); }
      team = team.map((u) => (u === out ? inn : u));
      if (r.challenger_user_id === out) r.challenger_user_id = inn;
      else r.participants = (r.participants ?? []).map((pt) => (pt.user_id === out ? { user_id: inn, joined_at: new Date(nowMs).toISOString() } : pt));
      try {
        await env.DB.prepare('DELETE FROM raid_queue WHERE user_id = ?1 AND boss_id = ?2').bind(inn, AUTO_RAID_BOSS).run();
      } catch { /* a stale finder row is harmless: they are busy now */ }
      if (!ctx) continue;
      const hoursLeft = Math.max(1, Math.round((Date.parse(r.ends_at || '') - nowMs) / 3_600_000));
      ctx.waitUntil(notifyUser(env, inn, {
        title: 'Raid Party Found',
        body: `${COOP_BOSS_NAMES[AUTO_RAID_BOSS] ?? 'The raid'}: a raid under way needs you. ${hoursLeft} hours left for ${goal}, and your steps since it began count.`,
        type: 'coop_joined',
        data: { bossId: AUTO_RAID_BOSS },
      }));
    }
  }
  return swaps;
}

/** W1251 → W1253 — RAID MOVES. Owner 2026-11-20: "You can also send players from other teams to teams that need players
 *  for example zynfandel and zeruthless can be put on my team", then "Let's do teams of 3 can be broken up automatically
 *  like we just did" (RenDIESEL and Burak to Angelo's team, Mercury "on the sideline waiting for a team").
 *  After the stand-ins, every pass: a raid at least a day old, BEHIND PACE (progress under the share of its window
 *  used), with SHORT_TEAM_ACTIVE (3) or fewer members who really opened the app in the last 24 hours is broken up.
 *  Its active walkers, most raid steps first, each take an open seat (away 24h AND under 1,000 raid steps, the
 *  stand-in rule) on the raid closest to winning that has more active members than theirs had, started no later
 *  (so every step they walked still counts there) and holds nobody they blocked; their raid steps come with them.
 *  Whoever finds no seat leaves the raid too and waits on the sideline, free for the next stand-in seat or new raid.
 *  A raid where nobody can go anywhere stays as it is; a raid that took walkers in never gives them away. */
export const SHORT_TEAM_ACTIVE = 3;
export const MOVE_MIN_AGE_HOURS = 24;
/** W1252 — a stand-in only joins a raid with at least this many members in the app in the last 24 hours. */
export const STANDIN_MIN_ACTIVE = 3;

/** W1251 — one live raid as the move planner sees it. `active`: members in the app in the last 24 hours, most raid
 *  steps first; `open`: seats a stand-in may take; `progress`: the lower of steps and flights against the goal;
 *  `canGive`: a day old and behind pace (W1253). */
export interface RaidView {
  id: string;
  startsMs: number;
  progress: number;
  canGive: boolean;
  members: string[];
  active: string[];
  open: string[];
  /** W1311 — hunters who already left this raid: never moved back into it */
  left?: string[];
}
export interface RaidMovePlan { from: string; moves: { m: string; x: string; to: string }[]; sideline: string[] }

/** W1253 — pure: the break-ups, fewest active first. Each walker goes to the best raid with a seat for them; the
 *  rest are sidelined; nothing happens to a raid none of whose walkers has anywhere to go. */
export function planRaidMoves(
  views: readonly RaidView[],
  isBlocked: (a: string, b: string) => boolean,
): RaidMovePlan[] {
  const live = new Map(views.map((v) => [v.id, { ...v, members: [...v.members], active: [...v.active], open: [...v.open] }]));
  const took = new Set<string>();
  const plans: RaidMovePlan[] = [];
  const givers = Array.from(live.values())
    .filter((v) => v.canGive && v.active.length > 0 && v.active.length <= SHORT_TEAM_ACTIVE)
    .sort((a, b) => a.active.length - b.active.length || a.progress - b.progress || (a.id < b.id ? -1 : 1));
  for (const g of givers) {
    if (took.has(g.id)) continue;   // took walkers in on an earlier break-up: it stays
    const from = live.get(g.id)!;
    const team = [...from.active];
    const size = team.length;
    const moves: { m: string; x: string; to: string }[] = [];
    for (const m of team) {
      const to = Array.from(live.values())
        .filter((r) => r.id !== from.id && r.active.length > size && r.open.length > 0 && r.startsMs <= from.startsMs &&
          !(r.left ?? []).includes(m) &&   // W1311 — never back into a raid they left
          !r.members.some((x) => !r.open.includes(x) && (isBlocked(x, m) || isBlocked(m, x))))
        .sort((a, b) => b.progress - a.progress || b.active.length - a.active.length || (a.id < b.id ? -1 : 1))[0];
      if (!to) continue;
      const x = to.open[0];
      moves.push({ m, x, to: to.id });
      to.open = to.open.slice(1);
      to.members = to.members.filter((u) => u !== x).concat([m]);
      to.active = to.active.concat([m]);
      took.add(to.id);
    }
    if (!moves.length) continue;
    plans.push({ from: from.id, moves, sideline: team.filter((m) => !moves.some((mv) => mv.m === m)) });
    from.members = from.members.filter((u) => !team.includes(u));
    from.active = [];
  }
  return plans;
}

/** W1253 — a sidelined walker leaves a broken-up raid (guarded; a departing challenger hands the seat to `heir`, a
 *  member who stays). True when they left. */
export async function sidelineRaider(env: Env, from: CoopBossRow, s: string, heir: string | null, nowMs: number): Promise<boolean> {
  const at = new Date(nowMs).toISOString();
  if (from.challenger_user_id === s) {
    if (!heir) return false;
    const res = await env.DB.batch([
      env.DB.prepare(
        `UPDATE coop_boss_instances
            SET challenger_user_id = ?3,
                partner_user_id = CASE WHEN partner_user_id IN (?2, ?3) THEN ?3 ELSE partner_user_id END,
                partner2_user_id = CASE WHEN partner2_user_id IN (?2, ?3) THEN NULL ELSE partner2_user_id END,
                updated_at = ?4
          WHERE id = ?1 AND status = 'active' AND challenger_user_id = ?2
            AND EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?3)`,
      ).bind(from.id, s, heir, at),
      env.DB.prepare(
        `DELETE FROM coop_boss_participants
          WHERE instance_id = ?1 AND user_id = ?2
            AND EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1 AND challenger_user_id = ?2)`,
      ).bind(from.id, heir),
    ]);
    return Number(res[0]?.meta?.changes ?? 0) > 0;
  }
  const res = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM coop_boss_participants
        WHERE instance_id = ?1 AND user_id = ?2
          AND EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1 AND status = 'active')`,
    ).bind(from.id, s),
    env.DB.prepare(
      `UPDATE coop_boss_instances
          SET partner_user_id = CASE WHEN partner_user_id = ?2 THEN challenger_user_id ELSE partner_user_id END,
              partner2_user_id = CASE WHEN partner2_user_id = ?2 THEN NULL ELSE partner2_user_id END,
              updated_at = ?3
        WHERE id = ?1 AND (partner_user_id = ?2 OR partner2_user_id = ?2)`,
    ).bind(from.id, s, at),
  ]);
  return Number(res[0]?.meta?.changes ?? 0) > 0;
}

/** W1251 — one move, one guarded batch: `m` leaves raid `from` and takes `x`'s seat in raid `to`. What `x` walked is
 *  banked on `to` (as a stand-in swap banks it); `m`'s raid steps and flights are copied onto `to` when `carry`; on
 *  `from`, a departing challenger hands that seat to `heir` (a member who stays). Every statement re-checks that both
 *  raids are live and the seats are as planned, so a raid that just settled writes nothing. True when `m` moved. */
export async function moveRaider(
  env: Env,
  from: CoopBossRow,
  to: CoopBossRow,
  m: string,
  x: string,
  heir: string | null,
  bankX: { steps: number; flights: number },
  carry: { steps: number; flights: number } | null,
  nowMs: number,
): Promise<boolean> {
  const at = new Date(nowMs).toISOString();
  const bs = Math.max(0, Math.round(Number(bankX.steps) || 0));
  const bf = Math.max(0, Math.round(Number(bankX.flights) || 0));
  const inFrom = `(EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?7 AND status = 'active' AND challenger_user_id = ?3)
       OR (EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?7 AND user_id = ?3)
           AND EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?7 AND status = 'active')))`;
  const inTo = (n: number, uid: number) => `(EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?${n} AND challenger_user_id = ?${uid})
       OR EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?${n} AND user_id = ?${uid}))`;
  const stmts: D1PreparedStatement[] = [];
  // 1 · the seat in `to`: x out (banked), m in — only while m is still in `from`
  if (to.challenger_user_id === x) {
    stmts.push(env.DB.prepare(
      `UPDATE coop_boss_instances
          SET challenger_user_id = ?3, banked_steps = banked_steps + ?4, banked_flights = banked_flights + ?5, updated_at = ?6
        WHERE id = ?1 AND status = 'active' AND challenger_user_id = ?2 AND ${inFrom}`,
    ).bind(to.id, x, m, bs, bf, at, from.id));
  } else {
    stmts.push(env.DB.prepare(
      `UPDATE coop_boss_instances
          SET banked_steps = banked_steps + ?4, banked_flights = banked_flights + ?5,
              partner_user_id = CASE WHEN partner_user_id = ?2 THEN ?3 ELSE partner_user_id END,
              partner2_user_id = CASE WHEN partner2_user_id = ?2 THEN ?3 ELSE partner2_user_id END,
              updated_at = ?6
        WHERE id = ?1 AND status = 'active'
          AND EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?2) AND ${inFrom}`,
    ).bind(to.id, x, m, bs, bf, at, from.id));
    stmts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
         SELECT ?1, ?3, ?6
          WHERE EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?2)
            AND EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1 AND status = 'active')
            AND (?4 + ?5) >= 0 AND ${inFrom}`,
    ).bind(to.id, x, m, bs, bf, at, from.id));
    stmts.push(env.DB.prepare(
      `DELETE FROM coop_boss_participants
        WHERE instance_id = ?1 AND user_id = ?2
          AND EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?3)`,
    ).bind(to.id, x, m));
  }
  // 2 · m leaves `from` — only once m holds the seat in `to`
  if (from.challenger_user_id === m) {
    if (!heir) return false;
    stmts.push(env.DB.prepare(
      `UPDATE coop_boss_instances
          SET challenger_user_id = ?3,
              partner_user_id = CASE WHEN partner_user_id IN (?2, ?3) THEN ?3 ELSE partner_user_id END,
              partner2_user_id = CASE WHEN partner2_user_id IN (?2, ?3) THEN NULL ELSE partner2_user_id END,
              updated_at = ?4
        WHERE id = ?1 AND challenger_user_id = ?2
          AND EXISTS (SELECT 1 FROM coop_boss_participants WHERE instance_id = ?1 AND user_id = ?3) AND ${inTo(5, 2)}`,
    ).bind(from.id, m, heir, at, to.id));
    stmts.push(env.DB.prepare(
      `DELETE FROM coop_boss_participants
        WHERE instance_id = ?1 AND user_id = ?2
          AND EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1 AND challenger_user_id = ?2)`,
    ).bind(from.id, heir));
  } else {
    stmts.push(env.DB.prepare(
      `UPDATE coop_boss_instances
          SET partner_user_id = CASE WHEN partner_user_id = ?2 THEN challenger_user_id ELSE partner_user_id END,
              partner2_user_id = CASE WHEN partner2_user_id = ?2 THEN NULL ELSE partner2_user_id END,
              updated_at = ?3
        WHERE id = ?1 AND (partner_user_id = ?2 OR partner2_user_id = ?2) AND ${inTo(4, 2)}`,
    ).bind(from.id, m, at, to.id));
    stmts.push(env.DB.prepare(
      `DELETE FROM coop_boss_participants
        WHERE instance_id = ?1 AND user_id = ?2 AND ${inTo(3, 2)}`,
    ).bind(from.id, m, to.id));
  }
  // 3 · m's raid steps and flights come along (a lower bound: their phone posts the live number next open)
  if (carry) {
    for (const [type, metric, value] of [['steps_total', 'steps', carry.steps], ['flights_total', 'flights', carry.flights]] as const) {
      const v = Math.max(0, Math.round(Number(value) || 0));
      if (!v) continue;
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO verified_events
           (id, user_id, boss_instance_id, event_type, metric, value, source, occurred_at, window_start, window_end, client_event_id, client_created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'raid_move', ?7, ?8, ?9, ?10, ?7
          WHERE ${inTo(3, 2)}`,
      ).bind(crypto.randomUUID(), m, to.id, type, metric, v, at, to.starts_at ?? null, to.ends_at ?? null,
        'raid_move:' + to.id + ':' + metric));
    }
  }
  // 4 · the log: x left `to` for m
  stmts.push(env.DB.prepare(
    `INSERT OR IGNORE INTO coop_raid_swaps (instance_id, out_user_id, in_user_id, out_steps, out_flights, swapped_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE ${inTo(1, 3)}`,
  ).bind(to.id, x, m, bs, bf, at));
  const res = await env.DB.batch(stmts);
  return Number(res[0]?.meta?.changes ?? 0) > 0;
}

async function sweepRaidMoves(
  env: Env,
  nowMs: number,
  shared: () => Promise<Shared>,
  lastSeen: () => Promise<Map<string, number>>,
  ctx: ExecutionContext | undefined,
): Promise<number> {
  const cfg = COOP_BOSS_CFG[AUTO_RAID_BOSS];
  if (!cfg) return 0;
  const rows = (await env.DB.prepare(
    `SELECT * FROM coop_boss_instances
      WHERE status = 'active' AND auto = 1 AND boss_id = ?1 AND ends_at > ?2 AND paused_remaining_ms IS NULL
      ORDER BY ends_at ASC LIMIT 50`,
  ).bind(AUTO_RAID_BOSS, new Date(nowMs).toISOString()).all<CoopBossRow>()).results ?? [];
  if (rows.length < 2) return 0;
  const ids = rows.map((r) => r.id);
  const [parts, prog, seen, leavers] = await Promise.all([loadParticipants(env, ids), getCoopProgressForInstances(env, ids), lastSeen(), leaversByInstance(env, ids)]);
  const byId = new Map<string, CoopBossRow>();
  const views: RaidView[] = [];
  for (const r of rows) {
    r.participants = parts.get(r.id) ?? [];
    byId.set(r.id, r);
    const p = prog.get(r.id) ?? emptyProgress();
    const startsMs = Date.parse(r.starts_at || '');
    const members = participantIds(r);
    const joined = new Map<string, number>([[r.challenger_user_id, startsMs]]);
    for (const pt of r.participants) joined.set(pt.user_id, Date.parse(pt.joined_at || r.starts_at || ''));
    const steps = (u: string) => p.steps.get(u) || 0;
    const idle = new Set(idleRaiders(members.map((u) => ({ uid: u, joinedMs: joined.get(u) ?? startsMs })), seen, nowMs));
    const sumS = members.reduce((s, u) => s + steps(u), 0) + (Number(r.banked_steps) || 0);
    const sumF = members.reduce((s, u) => s + (p.flights.get(u) || 0), 0) + (Number(r.banked_flights) || 0);
    const progress = Math.min(r.goal_steps ? sumS / r.goal_steps : 1, r.goal_flights ? sumF / r.goal_flights : 1);
    views.push({
      id: r.id,
      startsMs,
      progress,
      // W1253 — a day old and behind pace: progress under the share of its window already used
      canGive: Number.isFinite(startsMs) && nowMs - startsMs >= MOVE_MIN_AGE_HOURS * 3_600_000 &&
        progress < (nowMs - startsMs) / Math.max(1, Date.parse(r.ends_at || '') - startsMs),
      members,
      active: members.filter((u) => seenWithin(seen, u, nowMs)).sort((a, b) => steps(b) - steps(a)),
      open: members.filter((u) => idle.has(u) && steps(u) < RAID_LOCK_STEPS),
      left: leavers.get(r.id) ?? [],   // W1311
    });
  }
  const [optouts, blocks] = await shared();
  const isBlocked = (a: string, b: string) =>
    blocks.has(pairKey(a, b)) || optouts.has(a + '>' + b) || optouts.has(b + '>' + a);
  const plans = planRaidMoves(views, isBlocked);
  if (!plans.length) return 0;
  const goal = thousands(cfg.goalSteps) + ' steps' + (cfg.goalFlights ? ' and ' + thousands(cfg.goalFlights) + ' flights' : '');
  let moved = 0;
  for (const plan of plans) {
    const from = byId.get(plan.from)!;
    const pf = prog.get(from.id) ?? emptyProgress();
    const team = new Set([...plan.moves.map((mv) => mv.m), ...plan.sideline]);
    const heirFor = (m: string) => from.challenger_user_id === m
      ? ((from.participants ?? []).map((q) => q.user_id).find((u) => u !== m && !team.has(u)) ?? null)
      : null;
    const handOver = (m: string, heir: string | null) => {   // keep `from` true to the database
      if (from.challenger_user_id === m && heir) {
        from.challenger_user_id = heir;
        from.participants = (from.participants ?? []).filter((q) => q.user_id !== heir && q.user_id !== m);
      } else {
        from.participants = (from.participants ?? []).filter((q) => q.user_id !== m);
      }
    };
    for (const { m, x, to: toId } of plan.moves) {
      if (moved >= MAX_SWAPS_PER_RUN) return moved;
      const to = byId.get(toId)!;
      const pt = prog.get(to.id) ?? emptyProgress();
      const carryOk = Date.parse(to.starts_at || '') <= Date.parse(from.starts_at || '');
      const heir = heirFor(m);
      const ok = await moveRaider(env, from, to, m, x, heir,
        { steps: pt.steps.get(x) || 0, flights: pt.flights.get(x) || 0 },
        carryOk ? { steps: pf.steps.get(m) || 0, flights: pf.flights.get(m) || 0 } : null, nowMs);
      if (!ok) continue;
      moved++;
      if (to.challenger_user_id === x) to.challenger_user_id = m;
      else to.participants = (to.participants ?? []).filter((q) => q.user_id !== x).concat([{ user_id: m, joined_at: new Date(nowMs).toISOString() }]);
      handOver(m, heir);
      if (!ctx) continue;
      const hoursLeft = Math.max(1, Math.round((Date.parse(to.ends_at || '') - nowMs) / 3_600_000));
      ctx.waitUntil(notifyUser(env, m, {
        title: 'New Raid Team',
        body: `${COOP_BOSS_NAMES[AUTO_RAID_BOSS] ?? 'The raid'}: you joined a team that needed walkers. ${hoursLeft} hours left for ${goal}, and your steps came with you.`,
        type: 'coop_joined',
        data: { bossId: AUTO_RAID_BOSS },
      }));
    }
    // W1253 — whoever found no seat waits on the sideline (only once a walker of theirs has moved)
    if (!plan.moves.length) continue;
    for (const s of plan.sideline) {
      const heir = heirFor(s);
      if (!(await sidelineRaider(env, from, s, heir, nowMs))) continue;
      moved++;
      handOver(s, heir);
      if (!ctx) continue;
      ctx.waitUntil(notifyUser(env, s, {
        title: 'Raid Team Change',
        body: `${COOP_BOSS_NAMES[AUTO_RAID_BOSS] ?? 'The raid'}: your team was too short to finish, so it was broken up. You're free for the next team that needs a walker, or the next raid that forms.`,
        type: 'coop_joined',
        data: { bossId: AUTO_RAID_BOSS },
      }));
    }
  }
  return moved;
}

/** W1260 → W1262 — SHORT TEAMS WAIT. Owner 2026-11-20, on PR44's team (two hunters, both away, 0 steps): "If it's both
 *  away like this .. don't start it until they have a full team of six"; then "Raids should have a minimum of 4"; then,
 *  after W1260/W1261 closed such teams: "Maybe not close them but don't start them until more players join their team".
 *  A raid forms with six (W1239), but a break-up (W1253) moves its walkers away and leaves the rest behind. A live
 *  automatic raid that NEEDS HUNTERS (fewer than RAID_MIN_TEAM members, or fewer than six with nobody in the app in the
 *  last 24 hours) waits: its clock stops (paused_remaining_ms holds the time it had left; every pass keeps ends_at at
 *  now + that), and its empty seats fill, up to six, from the raid finder first, then hunters who qualify for a raid today
 *  (the stand-in pool). Once it no longer needs hunters (four or more with someone walking), the clock runs again from
 *  where it stopped. Nothing is lost; steps walked meanwhile still count. Pure. */
export const RAID_MIN_TEAM = 4;
export function raidNeedsHunters(memberCount: number, activeCount: number): boolean {
  if (memberCount <= 0) return false;
  if (memberCount < RAID_MIN_TEAM) return true;
  return memberCount < AUTO_RAID_PARTY && activeCount === 0;
}
/** W1262 — pure: the frozen clock's end while a raid waits. */
export function waitingEndsAt(nowMs: number, remainingMs: number): string {
  return new Date(nowMs + Math.max(60_000, Math.round(Number(remainingMs) || 0))).toISOString();
}

async function sweepRaidWaiting(
  env: Env,
  nowMs: number,
  today: string,
  shared: () => Promise<Shared>,
  lastSeen: () => Promise<Map<string, number>>,
  ctx: ExecutionContext | undefined,
  rnd: () => number = Math.random,
): Promise<number> {
  const cfg = COOP_BOSS_CFG[AUTO_RAID_BOSS];
  if (!cfg) return 0;
  const rows = (await env.DB.prepare(
    `SELECT * FROM coop_boss_instances
      WHERE status = 'active' AND auto = 1 AND boss_id = ?1 AND ends_at > ?2
      ORDER BY ends_at ASC LIMIT 50`,
  ).bind(AUTO_RAID_BOSS, new Date(nowMs).toISOString()).all<CoopBossRow>()).results ?? [];
  if (!rows.length) return 0;
  const [parts, seen] = await Promise.all([loadParticipants(env, rows.map((r) => r.id)), lastSeen()]);
  const nowIso = new Date(nowMs).toISOString();
  const name = COOP_BOSS_NAMES[AUTO_RAID_BOSS] ?? 'The raid';
  const goal = thousands(cfg.goalSteps) + ' steps' + (cfg.goalFlights ? ' and ' + thousands(cfg.goalFlights) + ' flights' : '');
  const look = (r: CoopBossRow) => {
    const members = Array.from(new Set(participantIds(r).filter(Boolean)));
    const startsMs = Date.parse(r.starts_at || '');
    const joined = new Map<string, number>([[r.challenger_user_id, startsMs]]);
    for (const pt of r.participants ?? []) joined.set(pt.user_id, Date.parse(pt.joined_at || r.starts_at || ''));
    const idle = new Set(idleRaiders(members.map((u) => ({ uid: u, joinedMs: joined.get(u) ?? startsMs })), seen, nowMs));
    return { members, active: members.filter((u) => !idle.has(u)).length };
  };
  // the fill pool, built only when a waiting team has an empty seat
  let poolP: Promise<{ waiting: string[]; pool: string[]; isBlocked: (a: string, b: string) => boolean }> | null = null;
  const fillPool = () => (poolP ??= (async () => {
    const [optouts, blocks, builds] = await shared();
    const busy = await huntersInLiveRaid(env, AUTO_RAID_BOSS);
    const opens = await opensSince(env, activeWindowStart(today));
    const qualifies = async (uid: string): Promise<boolean> => {
      if (!uid || busy.has(uid) || !seenWithin(seen, uid, nowMs)) return false;
      if (buildW(builds.get(uid)) < AUTO_HUNT_MIN_W) return false;
      if (optouts.has(uid + '>*')) return false;
      if (optouts.has(uid + '>#raid')) return false;   // W1268
      if (cfg.memberOnly && !MEMBERSHIP_OPEN) {
        try { if (!(await readEntitlements(env, uid)).member) return false; } catch { return false; }
      }
      return true;
    };
    const queued = (await env.DB.prepare('SELECT user_id FROM raid_queue WHERE boss_id = ?1 ORDER BY created_at ASC')
      .bind(AUTO_RAID_BOSS).all<{ user_id: string }>()).results ?? [];
    const waiting: string[] = [];
    for (const q of queued) if (!waiting.includes(q.user_id) && (await qualifies(q.user_id))) waiting.push(q.user_id);
    const pool: string[] = [];
    for (const [uid, n] of Array.from(opens.entries()).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
      if (n >= AUTO_RAID_MIN_OPENS && !waiting.includes(uid) && (await qualifies(uid))) pool.push(uid);
    }
    const isBlocked = (a: string, b: string) =>
      blocks.has(pairKey(a, b)) || optouts.has(a + '>' + b) || optouts.has(b + '>' + a);
    return { waiting, pool, isBlocked };
  })());

  let changed = 0;
  for (const r of rows) {
    r.participants = parts.get(r.id) ?? [];
    const paused = r.paused_remaining_ms != null;
    let { members, active } = look(r);
    if (!paused && !raidNeedsHunters(members.length, active)) continue;
    let remaining = paused ? Number(r.paused_remaining_ms) || 0 : Math.max(0, Date.parse(r.ends_at || '') - nowMs);
    if (!paused) {
      // the clock stops: the time left is kept, ends_at stays that far ahead while the team waits
      const res = await env.DB.prepare(
        `UPDATE coop_boss_instances SET paused_remaining_ms = ?2, ends_at = ?3, updated_at = ?4
          WHERE id = ?1 AND status = 'active' AND paused_remaining_ms IS NULL`,
      ).bind(r.id, remaining, waitingEndsAt(nowMs, remaining), nowIso).run();
      if (!Number(res?.meta?.changes ?? 0)) continue;
      changed++;
    }
    // fill the empty seats, up to six
    const joinedNow: string[] = [];
    if (members.length < AUTO_RAID_PARTY) {
      const fp = await fillPool();
      const left = (await leaversByInstance(env, [r.id])).get(r.id) ?? [];   // W1311
      while (members.length < AUTO_RAID_PARTY) {
        const inn = pickStandIn(fp.waiting, fp.pool, members, fp.isBlocked, rnd, left);
        if (!inn) break;
        for (const list of [fp.waiting, fp.pool]) { const i = list.indexOf(inn); if (i >= 0) list.splice(i, 1); }
        const res = await env.DB.prepare(
          `INSERT OR IGNORE INTO coop_boss_participants (instance_id, user_id, joined_at)
             SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM coop_boss_instances WHERE id = ?1 AND status = 'active')`,
        ).bind(r.id, inn, nowIso).run();
        if (!Number(res?.meta?.changes ?? 0)) continue;
        try { await env.DB.prepare('DELETE FROM raid_queue WHERE user_id = ?1 AND boss_id = ?2').bind(inn, AUTO_RAID_BOSS).run(); } catch { /* harmless */ }
        r.participants = (r.participants ?? []).concat([{ user_id: inn, joined_at: nowIso }]);
        members = members.concat([inn]);
        active++;   // drawn from hunters in the app in the last 24 hours
        joinedNow.push(inn);
        changed++;
      }
    }
    const hoursLeft = Math.max(1, Math.round(remaining / 3_600_000));
    if (raidNeedsHunters(members.length, active)) {
      // still waiting: hold the clock where it stopped
      await env.DB.prepare(
        `UPDATE coop_boss_instances SET ends_at = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'active' AND paused_remaining_ms IS NOT NULL`,
      ).bind(r.id, waitingEndsAt(nowMs, remaining), nowIso).run();
      if (ctx) for (const uid of joinedNow) {
        ctx.waitUntil(notifyUser(env, uid, {
          title: 'Raid Party Found',
          body: `${name}: you joined a team waiting for hunters. Its clock starts again once there are four of you walking, with ${hoursLeft} hours for ${goal}.`,
          type: 'coop_joined',
          data: { bossId: AUTO_RAID_BOSS },
        }));
      }
      continue;
    }
    // enough hunters: the clock runs again from where it stopped
    const res = await env.DB.prepare(
      `UPDATE coop_boss_instances SET ends_at = ?2, paused_remaining_ms = NULL, updated_at = ?3
        WHERE id = ?1 AND status = 'active' AND paused_remaining_ms IS NOT NULL`,
    ).bind(r.id, waitingEndsAt(nowMs, remaining), nowIso).run();
    if (!Number(res?.meta?.changes ?? 0)) continue;
    changed++;
    if (!ctx) continue;
    for (const uid of members) {
      ctx.waitUntil(notifyUser(env, uid, {
        title: joinedNow.includes(uid) ? 'Raid Party Found' : 'Raid Team Change',
        body: `${name}: your team has ${members.length} hunters now, so the clock is running again. ${hoursLeft} hours left for ${goal}.`,
        type: 'coop_joined',
        data: { bossId: AUTO_RAID_BOSS },
      }));
    }
  }
  return changed;
}

/** W1254 — GET /v1/coop-boss/raids/live: The Muster's Raids tab (owner 2026-11-20: "...another tab that you can see raid
 *  performance per teams because these two are big team battles" → the Claude Design handoff "The Muster"). Any hunter
 *  may read it. Every live automatic raid of The Grinning God with each hunter by NAME only: rank letter, raid steps
 *  and flights, and two flags, never a time (the handoff's privacy rule): away = no real app open for MUSTER_AWAY_HOURS,
 *  counted from the later of their last open and their seat, and still under RAID_LOCK_STEPS (W1311: a locked-in hunter
 *  is never AWAY); stand-in = took the seat by a swap or move (W1248/W1251).
 *  Plus what swapped-out hunters left (banked), the last four finished raids (won: hours taken + MVP; time ran out:
 *  the share of the goal, steps and flights each capped at 100% and averaged) and the viewer's draw: real opens over
 *  the last 7 Pacific days against AUTO_RAID_MIN_OPENS, and whether they are in a live raid. */
export const MUSTER_AWAY_HOURS = 12;
const isoOf = (s: string | null | undefined): string => {
  const v = String(s || '');
  if (!v) return '';
  return v.includes('T') ? v : v.replace(' ', 'T') + 'Z';   // resolved_at is stored as SQLite UTC text
};
export async function handleRaidsLive(_request: Request, env: Env, session: SessionPayload): Promise<Response> {
  const rl = await env.RL_FRIENDS_READ.limit({ key: session.userId });
  if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
  const cfg = COOP_BOSS_CFG[AUTO_RAID_BOSS];
  if (!cfg) return jsonOk({ ok: true, raids: [], finished: [], draw: null });
  const nowMs = Date.now();
  const today = ptDayKey(nowMs) || '';
  const live = (await env.DB.prepare(
    `SELECT * FROM coop_boss_instances
      WHERE status = 'active' AND auto = 1 AND boss_id = ?1 AND ends_at > ?2
      ORDER BY starts_at ASC LIMIT 40`,
  ).bind(AUTO_RAID_BOSS, new Date(nowMs).toISOString()).all<CoopBossRow>()).results ?? [];
  const done = (await env.DB.prepare(
    `SELECT * FROM coop_boss_instances
      WHERE boss_id = ?1 AND status IN ('completed', 'expired') AND resolved_at IS NOT NULL
      ORDER BY resolved_at DESC LIMIT 4`,
  ).bind(AUTO_RAID_BOSS).all<CoopBossRow>()).results ?? [];
  // W1282 — owner 2026-11-22: "a grinning god raid hall of fame ... instead of how it look currently". The five fastest
  // wins, start to win, under today's goal (an older, smaller goal would not be a fair time), each with its six.
  const hallRows = (await env.DB.prepare(
    `SELECT * FROM coop_boss_instances
      WHERE boss_id = ?1 AND status = 'completed' AND result = 'success' AND resolved_at IS NOT NULL AND starts_at IS NOT NULL
        AND goal_steps >= ?2 AND COALESCE(goal_flights, 0) >= ?3
      ORDER BY (julianday(resolved_at) - julianday(starts_at)) ASC LIMIT 5`,
  ).bind(AUTO_RAID_BOSS, cfg.goalSteps, cfg.goalFlights ?? 0).all<CoopBossRow>()).results ?? [];
  const seenIds = new Set<string>();
  const rows = [...live, ...done, ...hallRows].filter((r) => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true)));
  const ids = rows.map((r) => r.id);
  const parts = new Map<string, { user_id: string; joined_at: string | null }[]>();
  const prog = new Map<string, CoopProgress>();
  for (const slice of chunks(ids)) {
    for (const [k, v] of await loadParticipants(env, slice)) parts.set(k, v);
    for (const [k, v] of await getCoopProgressForInstances(env, slice)) prog.set(k, v);
  }
  for (const r of rows) r.participants = parts.get(r.id) ?? [];
  const people = Array.from(new Set(rows.flatMap((r) => participantIds(r))));
  const aliases = new Map<string, string>();
  for (const slice of chunks(people)) for (const [k, v] of await getAliasMap(env, slice)) aliases.set(k, v);
  const subs = new Set<string>();
  for (const slice of chunks(live.map((r) => r.id))) {
    const ph = slice.map(() => '?').join(',');
    const rs = (await env.DB.prepare(`SELECT instance_id, in_user_id FROM coop_raid_swaps WHERE instance_id IN (${ph})`)
      .bind(...slice).all<{ instance_id: string; in_user_id: string }>()).results ?? [];
    for (const s of rs) subs.add(s.instance_id + '|' + s.in_user_id);
  }
  const [ranks, seen] = await Promise.all([rankByUser(env), lastSeenByUser(env, nowMs)]);
  const awayMs = MUSTER_AWAY_HOURS * 3_600_000;
  const raids = live.map((r) => {
    const p = prog.get(r.id) ?? emptyProgress();
    const startMs = Date.parse(r.starts_at || '');
    const joined = new Map<string, number>([[r.challenger_user_id, startMs]]);
    for (const pt of r.participants ?? []) joined.set(pt.user_id, Date.parse(pt.joined_at || r.starts_at || ''));
    const ids6 = participantIds(r);
    return {
      id: r.id,
      mine: ids6.includes(session.userId),
      ...(r.paused_remaining_ms != null ? { waiting: true } : {}),   // W1262 — waiting for hunters, clock stopped
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      banked_steps: Math.max(0, Number(r.banked_steps) || 0),
      banked_flights: Math.max(0, Number(r.banked_flights) || 0),
      members: ids6.map((u) => {
        const me = u === session.userId;
        const since = Math.max(seen.get(u) ?? 0, joined.get(u) ?? startMs);
        return {
          alias: aliases.get(u) ?? 'Hunter',
          rank: String(ranks.get(u) || 'E').charAt(0).toUpperCase(),
          steps: p.steps.get(u) || 0,
          flights: p.flights.get(u) || 0,
          ...(me ? { me: true } : {}),
          // W1311 — owner 2026-11-24: "only show away when not locked in": a hunter past RAID_LOCK_STEPS keeps the seat
          // however long they are away, so the tag would only say a swap is coming that never will
          ...(!me && (p.steps.get(u) || 0) < RAID_LOCK_STEPS && nowMs - since >= awayMs ? { away: true } : {}),
          ...(subs.has(r.id + '|' + u) ? { sub: true } : {}),
        };
      }),
    };
  });
  const finished = done.map((r) => {
    const p = prog.get(r.id) ?? emptyProgress();
    const ids6 = participantIds(r);
    const s = ids6.reduce((n, u) => n + (p.steps.get(u) || 0), 0) + (Number(r.banked_steps) || 0);
    const f = ids6.reduce((n, u) => n + (p.flights.get(u) || 0), 0) + (Number(r.banked_flights) || 0);
    const won = r.status === 'completed' && r.result === 'success';
    const at = isoOf(r.resolved_at);
    let mvp: string | null = null;
    if (won) {
      let best = -1;
      for (const u of ids6) { const v = p.steps.get(u) || 0; if (v > best) { best = v; mvp = aliases.get(u) ?? null; } }
    }
    const pct = Math.round(((Math.min(1, r.goal_steps ? s / r.goal_steps : 1) + Math.min(1, r.goal_flights ? f / r.goal_flights : 1)) / 2) * 100);
    const hours = won ? Math.max(1, Math.round((Date.parse(at) - Date.parse(r.starts_at || '')) / 3_600_000)) : null;
    return { won, hours, mvp, pct: won ? 100 : pct, at };
  });
  const hall = hallRows.map((r) => {
    r.participants = parts.get(r.id) ?? r.participants ?? [];
    const p = prog.get(r.id) ?? emptyProgress();
    const ids6 = participantIds(r);
    let mvp = '', best = -1;
    for (const u of ids6) { const v = p.steps.get(u) || 0; if (v > best) { best = v; mvp = u; } }
    const at = isoOf(r.resolved_at);
    return {
      ms: Math.max(0, Date.parse(at) - Date.parse(r.starts_at || '')),
      at,
      members: ids6.map((u) => ({
        alias: aliases.get(u) ?? 'Hunter',
        rank: String(ranks.get(u) || 'E').charAt(0).toUpperCase(),
        ...(u === mvp ? { mvp: true } : {}),
        ...(u === session.userId ? { me: true } : {}),
      })),
    };
  });
  // the viewer's draw: real opens over the last 7 Pacific days, oldest first
  const since = activeWindowStart(today);
  const mine = (await env.DB.prepare('SELECT day_pt, opens FROM app_open_counts WHERE user_id = ?1 AND day_pt >= ?2 AND opens > 0')
    .bind(session.userId, since).all<{ day_pt: string; opens: number }>()).results ?? [];
  const byDay = new Map(mine.map((m) => [m.day_pt, Number(m.opens) || 0]));
  const days: boolean[] = [];
  let d = since;
  for (let i = 0; i < ACTIVE_OPEN_DAYS; i++) { days.push((byDay.get(d) || 0) > 0); d = nextDay(d) || d; }
  const opens = Array.from(byDay.values()).reduce((a, b) => a + b, 0);
  return jsonOk({
    ok: true,
    boss_id: AUTO_RAID_BOSS,
    goal_steps: cfg.goalSteps,
    goal_flights: cfg.goalFlights ?? 0,
    window_hours: cfg.windowHours,
    raids,
    finished,
    hall,   // W1282
    draw: { opens, need: AUTO_RAID_MIN_OPENS, days, in_raid: raids.some((r) => r.mine) },
  });
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

// ── W1268 — GET / PUT /v1/coop-boss/auto/prefs: the Auto Hunts manager ──────────────────────────────────
// Owner 2026-11-21, the Claude Design "Auto Hunts" handoff, and "DO it all ... obviously allow users to manage how
// they please but yeah make the automation geared toward items they still want/need/achievements/backgrounds
// anything not discovered yet". Free for every hunter. Two modes: Auto (the game picks: a first kill, then a
// missing drop, W1268 + W1209) and Targets (up to 3 bosses, or one drop of a boss, chased first). Partners are the
// W1094 per-friend switch (POST/DELETE /auto/optout); "Match me" and "Join the raid draw" are stored here.

export const AUTO_TARGET_MAX = 3;
export interface AutoTarget { b: string; d: string }
export interface AutoPrefs { mode: 'auto' | 'targets'; targets: AutoTarget[]; match: boolean; raid: boolean }
export const AUTO_PREFS_DEFAULT: AutoPrefs = { mode: 'auto', targets: [], match: true, raid: true };

/** Up to AUTO_TARGET_MAX targets, one per boss, each an automatic duo or trio boss; d is one of that boss's
 *  drops or 'any' (an unknown drop becomes 'any'). Pure. */
export function normalizeTargets(raw: unknown): AutoTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: AutoTarget[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const b = String((x as { b?: unknown }).b ?? '');
    let d = String((x as { d?: unknown }).d ?? 'any');
    if (!(AUTO_BOSSES.includes(b) || AUTO_TRIO_BOSSES.includes(b) || AUTO_MULTI_BOSSES.includes(b)) || seen.has(b)) continue;   // W1278
    if (d !== 'any' && !(AUTO_BOSS_DROPS[b] ?? []).includes(d)) d = 'any';
    seen.add(b);
    out.push({ b, d });
    if (out.length >= AUTO_TARGET_MAX) break;
  }
  return out;
}

function prefsFromRow(r: { mode?: string | null; targets_json?: string | null; match_on?: number | null; raid_on?: number | null } | null): AutoPrefs {
  if (!r) return { ...AUTO_PREFS_DEFAULT, targets: [] };
  let targets: AutoTarget[] = [];
  try { targets = normalizeTargets(JSON.parse(String(r.targets_json || '[]'))); } catch (_) { targets = []; }
  return { mode: r.mode === 'targets' ? 'targets' : 'auto', targets, match: Number(r.match_on ?? 1) !== 0, raid: Number(r.raid_on ?? 1) !== 0 };
}

/** Every stored row (no row = the defaults). A failed read (before migration 0080) is everyone on Auto. */
export async function readAllAutoPrefs(env: Env): Promise<Map<string, AutoPrefs>> {
  const out = new Map<string, AutoPrefs>();
  try {
    const rows = (await env.DB.prepare('SELECT user_id, mode, targets_json, match_on, raid_on FROM coop_auto_prefs')
      .all<{ user_id: string; mode: string; targets_json: string; match_on: number; raid_on: number }>()).results ?? [];
    for (const r of rows) if (r.user_id) out.set(r.user_id, prefsFromRow(r));
  } catch (err) {
    console.error('[coop-auto] auto prefs read failed', err);
  }
  return out;
}

/** W1268 — the automatic bosses each of these hunters has beaten in a co-op hunt (any won hunt, hand-made or
 *  automatic), for "a first kill still to discover". Null when the read failed. */
export async function coopKillsOf(env: Env, userIds: readonly string[]): Promise<Map<string, Set<string>> | null> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const out = new Map<string, Set<string>>();
  if (!ids.length) return out;
  const bosses = [...AUTO_BOSSES, ...AUTO_TRIO_BOSSES].map((b) => `'${b}'`).join(', ');   // this file's constants, never input
  const q = ids.map(() => '?').join(', ');
  try {
    const rows = (await env.DB.prepare(
      `SELECT DISTINCT boss_id, challenger_user_id AS a, partner_user_id AS b, partner2_user_id AS c
         FROM coop_boss_instances
        WHERE status = 'completed' AND result = 'success' AND boss_id IN (${bosses})
          AND (challenger_user_id IN (${q}) OR partner_user_id IN (${q}) OR partner2_user_id IN (${q}))`,
    ).bind(...ids, ...ids, ...ids).all<{ boss_id: string; a: string | null; b: string | null; c: string | null }>()).results ?? [];
    const want = new Set(ids);
    for (const r of rows) {
      for (const u of [r.a, r.b, r.c]) {
        if (!u || !want.has(u) || !r.boss_id) continue;
        if (!out.has(u)) out.set(u, new Set());
        out.get(u)!.add(r.boss_id);
      }
    }
    return out;
  } catch (err) {
    console.error('[coop-auto] co-op kills read failed', err);
    return null;
  }
}

/** What the manager draws: my settings, my friends (switch, walking, rank, their targets, whose turn tomorrow
 *  is), and which friends can run each automatic boss with me tomorrow (rank + walking, the cron's own rule).
 *  The phone builds the Tomorrow preview from this, with the same order as targetChoice. */
/** W1271 — which of these hunters had a real app open on or after `since` (a Pacific day); a failed read keeps all. */
export async function recentlyOpened(env: Env, ids: readonly string[], since: string): Promise<string[]> {
  if (!ids.length || !since) return [...ids];
  try {
    const seen = new Set<string>();
    for (const slice of chunks([...ids])) {
      const rows = (await env.DB.prepare(
        `SELECT DISTINCT user_id FROM app_open_counts WHERE day_pt >= ? AND opens > 0 AND user_id IN (${slice.map(() => '?').join(', ')})`,
      ).bind(since, ...slice).all<{ user_id: string }>()).results ?? [];
      for (const r of rows) if (r.user_id) seen.add(r.user_id);
    }
    return ids.filter((u) => seen.has(u));
  } catch (err) {
    console.error('[coop-auto] recent opens read failed', err);
    return [...ids];
  }
}

/** W1272 — owner 2026-11-21: "Make auto the default option". What the manager opens on: Targets only while at least
 *  one target is set; Targets with none (switched on, then nothing picked or all removed) opens on Auto, which is
 *  what the cron does with it anyway. A save echoes the stored mode, so tapping Targets to start picking holds. Pure. */
export function shownMode(p: AutoPrefs, echo = false): 'auto' | 'targets' {
  return p.mode === 'targets' && (echo || p.targets.length > 0) ? 'targets' : 'auto';
}

async function autoPrefsPayload(env: Env, uid: string, echo = false): Promise<Record<string, unknown>> {
  const nowMs = Date.now();
  const today = ptDayKey(nowMs) || '';
  const tomorrow = today ? nextDay(today) : '';
  const mineRow = await env.DB.prepare('SELECT mode, targets_json, match_on, raid_on FROM coop_auto_prefs WHERE user_id = ?')
    .bind(uid).first<{ mode: string; targets_json: string; match_on: number; raid_on: number }>().catch(() => null);
  const mine = prefsFromRow(mineRow ?? null);
  const fr = (await env.DB.prepare(
    `SELECT CASE WHEN requester_user_id = ?1 THEN recipient_user_id ELSE requester_user_id END AS f
       FROM friends WHERE status = 'accepted' AND (requester_user_id = ?1 OR recipient_user_id = ?1)`,
  ).bind(uid).all<{ f: string }>()).results ?? [];
  const allFriends = Array.from(new Set(fr.map((r) => r.f).filter((f) => f && f !== uid)));
  // W1271 — owner 2026-11-21, on a Partners list full of "Not walking this week": "If they haven't logged in the app a
  // while, don't put them on this list because there's not really point if they're not active to send them automated
  // hunts". A friend shows only with a real app open (app_open_counts, not a background wake) in the last
  // ACTIVE_OPEN_DAYS Pacific days, the raid draw's window; the cron already needs one today or yesterday to make a hunt.
  const friends = await recentlyOpened(env, allFriends, today ? activeWindowStart(today) : '');
  const thisWeek = getAccoladeWeekStart(nowMs);
  const lastWeek = priorWeekStart(thisWeek);
  const elapsed = elapsedDaysPt(thisWeek, today);
  const [optouts, blocks, builds, ranks, stepsNow, stepsLast, flights, sleepers, opened, aliases, all] = await Promise.all([
    optOutSet(env), blockSet(env), latestBuildByUser(env, nowMs), rankByUser(env),
    stepsByUser(env, thisWeek), stepsByUser(env, lastWeek), flightsAvgByUser(env, nowMs), sleepersSince(env, nowMs),
    today ? openedRecently(env, today) : Promise.resolve(new Set<string>()),
    getAliasMap(env, friends), readAllAutoPrefs(env),
  ]);
  const pattern = (u: string) => dailyPattern(stepsLast.get(u) ?? 0, stepsNow.get(u) ?? 0, elapsed);
  const rk = (u: string) => RANK_ORDER[ranks.get(u) ?? 'E'] ?? 0;
  const pm = pattern(uid);
  const tIdx = dayIndex(tomorrow);
  const partners = friends.map((f) => {
    const their = all.get(f);
    const lo = uid < f ? uid : f;
    return {
      id: f,
      alias: aliases.get(f) ?? 'Hunter',
      rank: ranks.get(f) ?? 'E',
      on: !optouts.has(uid + '>*') && !optouts.has(uid + '>' + f),
      their_off: optouts.has(f + '>*') || optouts.has(f + '>' + uid) || blocks.has(pairKey(uid, f)),
      walking: opened.has(f) && buildW(builds.get(f)) >= AUTO_HUNT_MIN_W && pattern(f) !== null,
      targets: their && their.mode === 'targets' ? their.targets.map((t) => t.b) : [],
      turn: (tIdx % 2 === 0) === (lo === uid) ? 'me' : 'them',   // targetChoice: members in id order, the day picks
    };
  }).sort((x, y) => x.alias.localeCompare(y.alias));
  const can = (p: { on: boolean; walking: boolean; their_off: boolean }) => p.on && p.walking && !p.their_off && pm !== null;
  const eligible: Record<string, string[]> = {};
  for (const b of [...AUTO_BOSSES, ...AUTO_MULTI_BOSSES]) {   // W1278 — the multi-day duos too
    eligible[b] = partners.filter((p) => {
      if (!can(p)) return false;
      if (needsSleep(b) && !(sleepers.has(uid) && sleepers.has(p.id))) return false;   // W1281 — both track sleep
      const pf = pairFlightsOf(flights, uid, p.id);
      return !!runDuo(b, Math.min(rk(uid), rk(p.id)), AUTO_FIT * ((pm ?? 0) + (pattern(p.id) ?? 0)), pf === null ? null : AUTO_FIT * pf,
        buildW(builds.get(uid)) >= HALF_EACH_MIN_W && buildW(builds.get(p.id)) >= HALF_EACH_MIN_W);   // W1339
    }).map((p) => p.id);
  }
  for (const b of AUTO_TRIO_BOSSES) {
    const br = RANK_ORDER[COOP_BOSS_CFG[b]?.rank ?? 'E'] ?? 0;
    const l = rk(uid) >= br ? partners.filter((p) => can(p) && rk(p.id) >= br).map((p) => p.id) : [];
    eligible[b] = l.length >= 2 ? l : [];
  }
  return {
    ok: true, mode: shownMode(mine, echo), targets: mine.targets, match: mine.match, raid: mine.raid,
    friends_total: allFriends.length,   // W1271 — friends, active or not (the list shows the active ones)
    rank: ranks.get(uid) ?? 'E', walking: pm !== null, day: tomorrow, max: AUTO_TARGET_MAX,
    sleeps: sleepers.has(uid),   // W1281 — this hunter's phone saw sleep in the last 7 nights
    partners, eligible,
  };
}

export async function handleCoopAutoPrefs(request: Request, env: Env, session: SessionPayload, method: string): Promise<Response> {
  if (method === 'PUT') {
    const rl = await env.RL_COOP_WRITE.limit({ key: session.userId });
    if (!rl.success) return jsonError(429, 'RATE_LIMITED', 'Slow down.');
    let body: Record<string, unknown> | null = null;
    try { body = (await request.json()) as Record<string, unknown>; } catch (_) { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
    const cur = prefsFromRow(await env.DB.prepare('SELECT mode, targets_json, match_on, raid_on FROM coop_auto_prefs WHERE user_id = ?')
      .bind(session.userId).first<{ mode: string; targets_json: string; match_on: number; raid_on: number }>());
    const next: AutoPrefs = {
      mode: body.mode === 'targets' ? 'targets' : body.mode === 'auto' ? 'auto' : cur.mode,
      targets: 'targets' in body ? normalizeTargets(body.targets) : cur.targets,
      match: typeof body.match === 'boolean' ? body.match : cur.match,
      raid: typeof body.raid === 'boolean' ? body.raid : cur.raid,
    };
    await env.DB.prepare(
      `INSERT INTO coop_auto_prefs (user_id, mode, targets_json, match_on, raid_on, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode, targets_json = excluded.targets_json,
         match_on = excluded.match_on, raid_on = excluded.raid_on, updated_at = excluded.updated_at`,
    ).bind(session.userId, next.mode, JSON.stringify(next.targets), next.match ? 1 : 0, next.raid ? 1 : 0, Date.now()).run();
  }
  return jsonOk(await autoPrefsPayload(env, session.userId, method === 'PUT'));
}
