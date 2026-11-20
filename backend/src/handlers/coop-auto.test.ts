/**
 * coop-auto.test.ts — W1094 automatic friend hunts.
 *
 * The pure pieces (the boss pick, the daily pattern, the build gate), the creation sweep
 * (which pairs get a hunt, which are skipped, one row per pair per day), and the settle sweep
 * through the shared resolveCoopInstance (win → awards + ONE push a day for automatic hunts,
 * automatic defeat silent, manual defeat pushed as before). Same substring-routed D1 mock as
 * the other handler tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
vi.mock('../lib/apns', () => ({ notifyUser: vi.fn(async () => {}) }));
import { notifyUser } from '../lib/apns';
import {
  AUTO_HUNT_MIN_W,
  buildW,
  createAutoHunt,
  dailyPattern,
  elapsedDaysPt,
  handleCoopAutoOptOut,
  MATCH_MIN_KILL_DAYS,
  MATCH_NEW_DAYS,
  MATCH_NEW_MIN_KILL_DAYS,
  MATCH_OPEN_DAYS,
  MATCH_KEEP_DAYS,
  pairKey,
  pickAutoBoss,
  pickMatchedPairs,
  sweepCoopAutoHunts,
  sweepCoopResolve,
  AUTO_FIT,
  AUTO_BOSSES,
  AUTO_BOSS_DROPS,
  AUTO_TRIO_BOSSES,
  AUTO_TRIOS_PER_HUNTER,
  STRETCH_MIN_SHARE,
  AUTO_RAID_MIN_OPENS,
  ACTIVE_OPEN_DAYS,
  activeWindowStart,
  AUTO_RAID_PARTY,
  choosePick,
  formRaidParties,
  raidShuffle,
  ownedAutoDrops,
  pickAutoTrioBoss,
  pickAutoTrios,
  stillNeeded,
  pairFlightsOf,
  idleRaiders,
  pickStandIn,
  RAID_IDLE_HOURS,
  RAID_LOCK_STEPS,
  planRaidMoves,
  SHORT_TEAM_ACTIVE,
  type RaidView,
} from './coop-auto';
import { getAccoladeWeekStart, priorWeekStart } from '../lib/accolade-week';
import { ptDayKey, ptMidnightIso, nextDay, prevDay } from '../lib/pact-streak';
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';

const mockNotify = vi.mocked(notifyUser);

beforeEach(() => {
  vi.clearAllMocks();
});

// W1182 — AUTO_FIT 0.9 → 0.75 and the goals came down (Coursing Dread 14k, Twin Maw 10k). W1186 — the Dread 13k.
// W1189 — the ladder's E 2,000 / C 4,000 a hunter: the Twin Maw 4,000, the Dread 8,000.
// W1195 (owner 2026-11-13) — "within 80% of the averages of the two users": AUTO_FIT 0.8, and the
// flights bosses join when both phones send a flights average.
describe('pickAutoBoss — the best one-day duo both ranks allow whose printed goals all fit AUTO_FIT (0.8) × the pair\'s averages', () => {
  it('a C pair walking 20,000 a day (no flights figure) faces The Coursing Dread at its real goal', () => {
    expect(AUTO_FIT).toBe(0.8);
    expect(pickAutoBoss('C', 'B', 20000)).toEqual({ bossId: 'the_coursing_dread', goalSteps: 8000 });
  });
  it('the boundary: 8,000 fits at 10,000; a step less drops to the Twin Maw at 4,000', () => {
    expect(pickAutoBoss('C', 'C', 10000).bossId).toBe('the_coursing_dread');
    expect(pickAutoBoss('C', 'C', 9999)).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });
  });
  it('an E hunter caps the pair at the Twin Maw however far they walk or climb', () => {
    expect(pickAutoBoss('E', 'S', 40000)).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });
    expect(pickAutoBoss('E', 'S', 40000, 60)).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });
  });
  it('a pair under the Twin Maw gets it sized to them: 0.8 × pattern to the nearest 100, floor 2,000', () => {
    expect(pickAutoBoss('E', 'E', 4000)).toEqual({ bossId: 'the_twin_maw', goalSteps: 3200 });
    expect(pickAutoBoss('E', 'E', 4999)).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });   // 3,999.2 → sized 4,000; the real goal does not fit
    expect(pickAutoBoss('E', 'E', 5000).goalSteps).toBe(4000);                                     // 4,000 fits the real boss
    expect(pickAutoBoss('E', 'E', 1000)).toEqual({ bossId: 'the_twin_maw', goalSteps: 2000 });
    expect(pickAutoBoss('E', 'E', 0).goalSteps).toBe(2000);
  });
  it('the list, best first: the Choir, the Monarch, the Gaunt Wardens, the Dread, the Twin Maw', () => {
    expect(AUTO_BOSSES).toEqual(['the_sundered_choir', 'the_hollow_monarch', 'the_gaunt_wardens', 'the_coursing_dread', 'the_twin_maw']);
  });
  it('a B pair that walks and climbs faces The Sundered Choir: 10,000 steps and 8 flights', () => {
    expect(pickAutoBoss('B', 'A', 20000, 12)).toEqual({ bossId: 'the_sundered_choir', goalSteps: 10000, goalFlights: 8 });
    expect(pickAutoBoss('B', 'B', 12500, 10)).toEqual({ bossId: 'the_sundered_choir', goalSteps: 10000, goalFlights: 8 });   // exactly 80% of both
  });
  it('a B pair that climbs more than it walks faces The Hollow Monarch: 12 flights', () => {
    expect(pickAutoBoss('B', 'B', 11000, 16)).toEqual({ bossId: 'the_hollow_monarch', goalSteps: 12 });
    expect(pickAutoBoss('B', 'B', 11000, 14.9)).toEqual({ bossId: 'the_gaunt_wardens', goalSteps: 8000, goalFlights: 6 });   // 11.9 flights: under the Monarch's 12, so the Wardens
  });
  it('a C pair with some stairs faces The Gaunt Wardens: 8,000 steps and 6 flights', () => {
    expect(pickAutoBoss('C', 'C', 11000, 8)).toEqual({ bossId: 'the_gaunt_wardens', goalSteps: 8000, goalFlights: 6 });
    expect(pickAutoBoss('C', 'S', 11000, 30)).toEqual({ bossId: 'the_gaunt_wardens', goalSteps: 8000, goalFlights: 6 });   // a C hunter keeps the B bosses out
    expect(pickAutoBoss('C', 'C', 11000, 7)).toEqual({ bossId: 'the_coursing_dread', goalSteps: 8000 });   // 5.6 flights: under 6
  });
  it('with no flights figure from either phone, the flights bosses never come up', () => {
    expect(pickAutoBoss('B', 'B', 30000, null)).toEqual({ bossId: 'the_coursing_dread', goalSteps: 8000 });
    expect(pickAutoBoss('B', 'B', 30000)).toEqual({ bossId: 'the_coursing_dread', goalSteps: 8000 });
  });
  // W1207 — owner: "if both hunters already own all the ultra rares from this duo boss, move onto
  // another step boss that can be completed together". W1209 — every drop counts, not only ultras.
  const need = (...spent: string[]) => ({ useful: (b: string) => !spent.includes(b) });
  it('W1207/W1209: a boss nobody in the pair still needs a drop from is passed over for the next that fits', () => {
    expect(pickAutoBoss('C', 'C', 20000, null, need('the_coursing_dread'))).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });
    expect(pickAutoBoss('B', 'B', 11000, 16, need('the_hollow_monarch'))).toEqual({ bossId: 'the_gaunt_wardens', goalSteps: 8000, goalFlights: 6 });
    expect(pickAutoBoss('B', 'B', 11000, 16, need('the_hollow_monarch', 'the_gaunt_wardens'))).toEqual({ bossId: 'the_coursing_dread', goalSteps: 8000 });
    // a spent boss that does not fit changes nothing
    expect(pickAutoBoss('C', 'C', 20000, null, need('the_sundered_choir'))).toEqual({ bossId: 'the_coursing_dread', goalSteps: 8000 });
  });
  it('W1207/W1209: every boss that fits spent → they all stay in play (best first); nothing fits → the sized Twin Maw as before', () => {
    expect(pickAutoBoss('C', 'C', 20000, null, need('the_coursing_dread', 'the_twin_maw'))).toEqual({ bossId: 'the_coursing_dread', goalSteps: 8000 });
    expect(pickAutoBoss('C', 'C', 9999, null, need('the_twin_maw'))).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });
    expect(pickAutoBoss('C', 'C', 4000, null, need('the_twin_maw'))).toEqual({ bossId: 'the_twin_maw', goalSteps: 3200 });
  });
  // W1209 — owner: "I just want to mix up the automations ... everyday the twin maw was just getting
  // beat by everyone and just getting the same reward every time"
  it('W1209: a boss the pair\'s hunters are already on today gives way to one they are not', () => {
    expect(pickAutoBoss('C', 'C', 20000, null, { today: (b) => (b === 'the_coursing_dread' ? 1 : 0) })).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });
    expect(pickAutoBoss('C', 'C', 20000, null, { today: (b) => (b === 'the_coursing_dread' ? 1 : 2) })).toEqual({ bossId: 'the_coursing_dread', goalSteps: 8000 });
  });
  it('W1209: the pair rotates — yesterday\'s boss gives way to the one they hunted longest ago (never = first)', () => {
    const last = (m: Record<string, string>) => ({ last: (b: string) => m[b] ?? '' });
    expect(pickAutoBoss('C', 'C', 20000, null, last({ the_coursing_dread: '2026-11-13' })).bossId).toBe('the_twin_maw');
    expect(pickAutoBoss('C', 'C', 20000, null, last({ the_coursing_dread: '2026-11-10', the_twin_maw: '2026-11-13' })).bossId).toBe('the_coursing_dread');
    expect(pickAutoBoss('B', 'B', 11000, 16, last({ the_hollow_monarch: '2026-11-13', the_gaunt_wardens: '2026-11-12', the_coursing_dread: '2026-11-11' })).bossId).toBe('the_twin_maw');
  });
  // W1215 — owner 2026-11-15: "yes do both fixes"
  it('W1215: everything that fits is collected → the next boss up, its goal lowered to the walking', () => {
    const onlyDread = { useful: (b: string) => b === 'the_coursing_dread' };
    // Richie + Anthony: ~9,550 a day → 7,640 fits only the Twin Maw, which both own → the Dread at 7,600
    expect(pickAutoBoss('C', 'S', 9551, null, onlyDread)).toEqual({ bossId: 'the_coursing_dread', goalSteps: 7600 });
    // nobody needs the Dread either → the Twin Maw as before
    expect(pickAutoBoss('C', 'S', 9551, null, { useful: () => false })).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });
    // never under 75% of the boss's goal: 7,000 a day → 5,600 < 6,000 → the Twin Maw
    expect(STRETCH_MIN_SHARE).toBe(0.75);
    expect(pickAutoBoss('C', 'C', 7000, null, onlyDread)).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });
    // the rank still rules: an E hunter keeps the Twin Maw
    expect(pickAutoBoss('E', 'S', 9551, null, onlyDread)).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });
    // a fitting boss someone still needs → no stretch
    expect(pickAutoBoss('C', 'S', 9551, null, { useful: () => true })).toEqual({ bossId: 'the_twin_maw', goalSteps: 4000 });
  });
  it('W1215: trios stretch the same way', () => {
    // three C hunters at 14,000 a day → 11,200 fits only the Hound; all own it → the Court at 11,200
    expect(pickAutoTrioBoss(['C', 'C', 'C'], 14000, { useful: (b) => b !== 'the_crossroads_hound' })).toEqual({ bossId: 'the_threefold_court', goalSteps: 11200 });
    expect(pickAutoTrioBoss(['C', 'C', 'C'], 14000, { useful: () => false })).toEqual({ bossId: 'the_crossroads_hound', goalSteps: 9000 });
  });
  it('W1209: drops come first, then today, then the rotation', () => {
    // the Dread is the only boss with a drop still needed: it runs even though they are on it today
    expect(pickAutoBoss('C', 'C', 20000, null, { useful: (b) => b === 'the_coursing_dread', today: (b) => (b === 'the_coursing_dread' ? 2 : 0) }).bossId).toBe('the_coursing_dread');
    // today beats yesterday
    expect(pickAutoBoss('C', 'C', 20000, null, { today: (b) => (b === 'the_coursing_dread' ? 1 : 0), last: (b) => (b === 'the_twin_maw' ? '2026-11-13' : '') }).bossId).toBe('the_twin_maw');
    expect(choosePick([], {})).toBeNull();
  });
  // W1208 — owner: "Throw in some trio bosses in the automatic list as well"
  it('W1208: a trio gets the best steps trio every rank allows that fits 0.8 × the three\'s walking', () => {
    expect(pickAutoTrioBoss(['A', 'S', 'A'], 23000)).toEqual({ bossId: 'the_trinity_colossus', goalSteps: 18000 });
    expect(pickAutoTrioBoss(['S', 'S+', 'B'], 20000)).toEqual({ bossId: 'the_triune_sentinel', goalSteps: 15000 });   // the B hunter keeps the A out
    expect(pickAutoTrioBoss(['C', 'C', 'B'], 16000)).toEqual({ bossId: 'the_threefold_court', goalSteps: 12000 });
    expect(pickAutoTrioBoss(['D', 'S', 'S'], 40000)).toEqual({ bossId: 'the_crossroads_hound', goalSteps: 9000 });
  });
  it('W1208: spent trios are passed over; nothing fits → the Hound sized; an E hunter → no trio', () => {
    expect(pickAutoTrioBoss(['C', 'C', 'C'], 16000, need('the_threefold_court'))).toEqual({ bossId: 'the_crossroads_hound', goalSteps: 9000 });
    expect(pickAutoTrioBoss(['C', 'C', 'C'], 16000, need('the_threefold_court', 'the_crossroads_hound'))).toEqual({ bossId: 'the_threefold_court', goalSteps: 12000 });
    expect(pickAutoTrioBoss(['C', 'C', 'C'], 16000, { today: (b) => (b === 'the_threefold_court' ? 2 : 0) })).toEqual({ bossId: 'the_crossroads_hound', goalSteps: 9000 });   // W1209
    expect(pickAutoTrioBoss(['C', 'C', 'C'], 10000)).toEqual({ bossId: 'the_crossroads_hound', goalSteps: 8000 });
    expect(pickAutoTrioBoss(['C', 'C', 'C'], 2000)).toEqual({ bossId: 'the_crossroads_hound', goalSteps: 3000 });
    expect(pickAutoTrioBoss(['E', 'S', 'S'], 40000)).toBeNull();
  });
  it('W1208/W1210: trios — one hunter friends with both others; mutual friends first; new faces next; up to 3 a hunter a day', () => {
    const f = (edges: string[]) => {
      const m = new Map<string, Set<string>>();
      for (const e of edges) { const [a, b] = e.split('-'); (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b); (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a); }
      return m;
    };
    const none = () => false;
    const w = (id: string) => ({ a: 5, b: 4, c: 3, d: 2, e: 1, x: 9, y: 9 } as Record<string, number>)[id] ?? 0;
    const g = f(['a-b', 'a-c', 'a-d', 'c-d', 'x-a', 'y-a']);
    const all = new Set(['a', 'b', 'c', 'd', 'x', 'y']);
    expect(AUTO_TRIOS_PER_HUNTER).toBe(3);
    // three mutual friends first; then a|x|y (no pair grouped yet, the strongest); a's third repeats
    // one pair whichever it is, so the strongest of those
    expect(pickAutoTrios(all, g, [], [], none, w)).toEqual([['a', 'c', 'd'], ['a', 'x', 'y'], ['a', 'b', 'x']]);
    // a cap of one is the W1208 rule
    expect(pickAutoTrios(all, g, [], [], none, w, 1)).toEqual([['a', 'c', 'd']]);
    // a star is enough: b and d are both a's friends
    expect(pickAutoTrios(new Set(['a', 'b', 'd']), f(['a-b', 'a-d']), [], [], none, w)).toEqual([['a', 'b', 'd']]);
    // a block between the two leaves stops it; no common friend = no trio
    expect(pickAutoTrios(new Set(['a', 'b', 'd']), f(['a-b', 'a-d']), [], [], (p, q) => (p === 'b' && q === 'd') || (p === 'd' && q === 'b'), w)).toEqual([]);
    expect(pickAutoTrios(new Set(['a', 'b', 'd']), f(['a-b']), [], [], none, w)).toEqual([]);
    // yesterday's trio is kept first
    expect(pickAutoTrios(all, g, [['y', 'a', 'x']], [], none, w)).toEqual([['a', 'x', 'y'], ['a', 'c', 'd'], ['a', 'b', 'x']]);
    // today's trios count toward the cap and are never made twice
    expect(pickAutoTrios(all, g, [], [['a', 'c', 'd'], ['a', 'b', 'c']], none, w)).toEqual([['a', 'x', 'y']]);
    expect(pickAutoTrios(new Set(['a', 'b', 'd']), f(['a-b', 'a-d']), [], [['d', 'b', 'a']], none, w)).toEqual([]);
    // two hubs, two trios
    const two = pickAutoTrios(new Set(['a', 'b', 'c', 'd', 'e', 'x']), f(['a-b', 'a-c', 'd-e', 'd-x']), [], [], none, w);
    expect(two).toEqual([['a', 'b', 'c'], ['d', 'e', 'x']]);   // equal walking: by key
  });
  it('W1209: a boss is still needed while anyone in the group lacks any of its drops', () => {
    const dread = ['the_long_pursuit', 'houndsfang_recurve', 'coursing_houndcall'];
    const owned = new Map([
      ['a', new Set([...dread, 'bothsight_longbow'])],
      ['b', new Set(dread)],
      ['c', new Set(['the_long_pursuit'])],
    ]);
    expect(stillNeeded(owned, ['a', 'b'], 'the_coursing_dread')).toBe(false);
    expect(stillNeeded(owned, ['a', 'b'], 'the_twin_maw')).toBe(true);        // b lacks the Longbow
    expect(stillNeeded(owned, ['a', 'c'], 'the_coursing_dread')).toBe(true);  // c owns the ultra, not the rares
    expect(stillNeeded(owned, ['a', 'nobody'], 'the_coursing_dread')).toBe(true);
    expect(stillNeeded(owned, ['a', 'b'], 'not_a_boss')).toBe(false);
  });
  it('W1209: the drops match the client catalog (app.js) for every automatic boss', () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const app = readFileSync(join(HERE, '..', '..', '..', 'app.js'), 'utf8');
    const all = [...AUTO_BOSSES, ...AUTO_TRIO_BOSSES];
    const re = /\n {4}([a-z0-9_]+): \{\r?\n {6}id: '([a-z0-9_]+)',[\s\S]*?source_boss: '([a-z0-9_]+)',\r?\n {6}rarity: '([a-z_]+)'/g;
    const drops: Record<string, string[]> = {};
    let m: RegExpExecArray | null;
    while ((m = re.exec(app))) if (m[4] === 'ultra_rare' || m[4] === 'rare') (drops[m[3]] ??= []).push(m[2]);
    // a drop source with a pool (the D, B and A trios) drops its pool instead (W1104)
    const card = /\n {4}([a-z0-9_]+): \{\r?\n {6}id: +'([a-z0-9_]+)',[\s\S]*?\r?\n {4}\},/g;
    while ((m = card.exec(app))) {
      const pool = /pool: \{\s*ultra_rare: \[([^\]]*)\],\s*rare: +\[([^\]]*)\]/.exec(m[0]);
      if (pool && all.includes(m[2])) drops[m[2]] = [...pool[1].split(','), ...pool[2].split(',')].map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
    }
    for (const bossId of all) {
      expect(drops[bossId] ?? [], bossId).not.toEqual([]);
      expect([...(AUTO_BOSS_DROPS[bossId] ?? [])].sort(), bossId).toEqual([...(drops[bossId] ?? [])].sort());
    }
  });
  it('the pair\'s flights: the sum, or nothing when either phone has not sent one', () => {
    const m = new Map([['a', 4.5], ['b', 3]]);
    expect(pairFlightsOf(m, 'a', 'b')).toBe(7.5);
    expect(pairFlightsOf(m, 'a', 'c')).toBeNull();
  });
});

describe('dailyPattern / elapsedDaysPt / buildW', () => {
  it('averages last week and this week over the FINISHED days (W1215: today, at midnight, has none yet)', () => {
    expect(dailyPattern(70000, 0, 1)).toBe(10000);        // Sunday: last week ÷ 7 (was ÷ 8)
    expect(dailyPattern(70000, 30000, 4)).toBe(10000);    // Wednesday: 7 + 3 finished days
    expect(dailyPattern(0, 6500, 7)).toBe(500);           // Saturday: 7 + 6
    expect(dailyPattern(0, 0, 3)).toBeNull();
    expect(dailyPattern(-5, 0, 3)).toBeNull();
  });
  it('elapsed days are 1 on the week start and 7 on its last day (date-only math)', () => {
    expect(elapsedDaysPt('2026-10-25', '2026-10-25')).toBe(1);
    expect(elapsedDaysPt('2026-10-25', '2026-10-31')).toBe(7);
    expect(elapsedDaysPt('2026-10-25', '2026-11-30')).toBe(7);
    expect(elapsedDaysPt('bad', '2026-10-25')).toBe(7);
  });
  it('reads the W number out of a build tag', () => {
    expect(buildW('3.0.16-w1094')).toBe(1094);
    expect(buildW('3.0.15-w1083')).toBe(1083);
    expect(buildW(null)).toBe(0);
    expect(buildW('garbage')).toBe(0);
    expect(AUTO_HUNT_MIN_W).toBe(1097);
  });
  it('pairKey sorts the two ids', () => {
    expect(pairKey('b', 'a')).toBe('a|b');
    expect(pairKey('a', 'b')).toBe('a|b');
  });
});

// ── a routed D1 mock for the sweeps ────────────────────────────────────────
interface SweepFixture {
  friends?: { a: string; b: string }[];
  done?: string[];
  optouts?: { user_id: string; friend_user_id: string }[];
  blocks?: { blocker_id: string; blocked_id: string }[];
  builds?: Record<string, string>;
  ranks?: Record<string, string>;
  stepsThisWeek?: Record<string, number>;
  stepsLastWeek?: Record<string, number>;
  flights?: Record<string, number>;   // W1195 — each phone's flights a day
  active?: Record<string, unknown>[];
  progress?: { bid: string; user_id: string; event_type: string; s: number }[];
  participants?: { instance_id: string; user_id: string; joined_at: string | null }[];
  stampChanges?: number;
  // W1164 — matching: each hunter's boss-kill days / kills in the last 7 days + join time, and
  // this PT week's matched rows (newest first, as the sweep's query orders them)
  kills?: { user_id: string; kill_days: number; kills: number; created_at: number }[];
  matchedWeek?: { a: string; b: string; d: string }[];
  owned?: Record<string, string[]>;    // W1209 — the boss drops each hunter's cloud save holds
  history?: { pair_key: string; boss_id: string; d: string }[];                       // W1209 — each group's last day on each boss
  todayRows?: { boss_id: string; a: string | null; b: string | null; c: string | null }[];   // W1209 — today's automatic hunts
  trioRows?: { a: string; b: string; c: string; d: string }[];   // W1208 — today's / yesterday's automatic trios
  raidLive?: string[];   // W1211 — hunters already in a live raid
  weekOpens?: Record<string, number>;   // W1239 — each hunter's app opens since Sunday (the raid's "active" bar)
  savedWins?: { user_id: string; created_at: number }[];   // W1216 — new hunters' wins from the save / funnel
  opened?: string[];   // W1217-W1219 — in the app today or yesterday (default: every hunter in kills / savedWins / friends)
  lastSeen?: Record<string, number>;   // W1248 — each hunter's last app ping / save, ms (default: every weekOpens hunter, now)
  raidRows?: Record<string, unknown>[];   // W1248 — the live automatic raids the stand-in pass reads
  queue?: string[];   // W1248 — the raid finder, oldest first
}
interface Call { sql: string; args: unknown[] }

function sweepDb(f: SweepFixture, calls: Call[]) {
  const thisWeek = getAccoladeWeekStart(Date.now());
  const lastWeek = priorWeekStart(thisWeek);
  const results = (sql: string, args: unknown[]): unknown[] => {
    if (sql.includes('AS last_seen')) {   // W1248 — lastSeenByUser
      const m = f.lastSeen ?? Object.fromEntries(Object.keys(f.weekOpens ?? {}).map((u) => [u, Date.now()]));
      return Object.entries(m).map(([user_id, last_seen]) => ({ user_id, last_seen }));
    }
    if (sql.includes('AND auto = 1 AND boss_id')) return f.raidRows ?? [];   // W1248 — live automatic raids
    if (sql.includes('FROM raid_queue')) return (f.queue ?? []).map((user_id) => ({ user_id }));   // W1248
    if (sql.includes('FROM friends')) return f.friends ?? [];
    if (sql.includes('partner2_user_id IS NOT NULL AND hunt_day')) return f.trioRows ?? [];   // W1208
    if (sql.includes('AS uid')) return (f.raidLive ?? []).map((uid) => ({ uid }));   // W1211 — huntersInLiveRaid
    if (sql.includes('AS week_opens')) return Object.entries(f.weekOpens ?? {}).map(([user_id, week_opens]) => ({ user_id, week_opens }));   // W1239
    if (sql.includes("'first_boss_kill'")) return f.savedWins ?? [];   // W1216 — newHunterSavedWins (before json_each)
    if (sql.includes('AS seen_by')) {   // W1217-W1219 — openedRecently
      const ids = f.opened ?? [...(f.kills ?? []).map((k) => k.user_id), ...(f.savedWins ?? []).map((w) => w.user_id),
        ...(f.friends ?? []).flatMap((p) => [p.a, p.b])];
      return ids.map((user_id) => ({ user_id }));
    }
    if (sql.includes('json_each(')) {   // W1209 — one row per (hunter, owned drop)
      return args.flatMap((id) => (f.owned?.[id as string] ?? []).map((item) => ({ user_id: id, item })));
    }
    if (sql.includes('GROUP BY pair_key, boss_id')) return f.history ?? [];               // W1209
    if (sql.includes('SELECT boss_id, challenger_user_id AS a')) return f.todayRows ?? [];   // W1209
    if (sql.includes('auto = 1 AND hunt_day')) return (f.done ?? []).map((pair_key) => ({ pair_key }));
    if (sql.includes('FROM public_achievement_events')) return f.kills ?? [];      // W1164
    if (sql.includes('WHERE matched = 1 AND hunt_day')) return f.matchedWeek ?? []; // W1164
    if (sql.includes('FROM coop_auto_optouts')) return f.optouts ?? [];
    if (sql.includes('FROM board_blocks')) return f.blocks ?? [];
    if (sql.includes('flights_avg IS NOT NULL')) return Object.entries(f.flights ?? {}).map(([user_id, flights_avg]) => ({ user_id, flights_avg }));   // W1195
    if (sql.includes('FROM app_opens')) return Object.entries(f.builds ?? {}).map(([user_id, build]) => ({ user_id, build }));
    if (sql.includes('FROM public_profile_summary')) return Object.entries(f.ranks ?? {}).map(([user_id, rank_tier]) => ({ user_id, rank_tier }));
    if (sql.includes('FROM merged')) {
      const src = args[0] === thisWeek ? f.stepsThisWeek : args[0] === lastWeek ? f.stepsLastWeek : {};
      return Object.entries(src ?? {}).map(([user_id, steps]) => ({ user_id, steps }));
    }
    if (sql.includes("WHERE status = 'active' ORDER BY ends_at")) return f.active ?? [];
    if (sql.includes('FROM coop_boss_participants')) return f.participants ?? [];
    if (sql.includes('FROM verified_events')) return f.progress ?? [];
    if (sql.includes('FROM users WHERE id IN')) return [{ id: 'u1', alias: 'richie' }, { id: 'u2', alias: 'anthony' }, { id: 'u3', alias: 'ren' }, { id: 'u4', alias: 'gali' }];
    return [];
  };
  const stmt = (sql: string, args: unknown[]) => ({
    all: async () => ({ results: results(sql, args), success: true, meta: {} }),
    first: async () => results(sql, args)[0] ?? null,
    run: async () => {
      if (sql.includes('SET coop_auto_push_day')) return { success: true, meta: { changes: f.stampChanges ?? 1 } };
      return { success: true, meta: { changes: 1 } };
    },
  });
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => { calls.push({ sql, args }); return stmt(sql, args); },
      ...stmt(sql, []),
    }),
    batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => Promise.all(stmts.map((s) => s.run())),
  } as unknown as D1Database;
}
function makeEnv(db: D1Database): Env {
  return { DB: db, RL_COOP_WRITE: { limit: async () => ({ success: true }) } } as unknown as Env;
}
const ctx = { waitUntil: (_p: Promise<unknown>) => undefined } as unknown as ExecutionContext;
// A pair is sized on this week's steps so far over the days elapsed (1 on Sunday), so the
// fixture's numbers hold on one weekday only: the clock sits at Monday 2026-10-26, noon PST
// (it broke on the Tuesday after it was written).
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-26T19:00:00Z'));
const today = ptDayKey(Date.now());
const NEW = '3.0.17-w1097';

describe('sweepCoopAutoHunts — one sized hunt per walking friend pair per day', () => {
  const base: SweepFixture = {
    friends: [{ a: 'u1', b: 'u2' }, { a: 'u3', b: 'u1' }, { a: 'u2', b: 'u4' }],
    builds: { u1: NEW, u2: '3.0.17-w1098', u3: NEW, u4: NEW },
    ranks: { u1: 'C', u2: 'E', u3: 'C', u4: 'C' },
    stepsThisWeek: { u1: 30000, u2: 15000, u3: 40000, u4: 20000 },
    stepsLastWeek: { u1: 70000, u2: 35000, u3: 80000, u4: 50000 },
  };

  it('creates today\'s hunt for every eligible pair, with the boss and goal sized to the pair', async () => {
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(base, calls)), ctx);
    expect(res.pairs).toBe(3);
    expect(res.created).toBe(3);
    const inserts = calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances'));
    expect(inserts.length).toBe(3);
    // every insert: active, auto, today's day, the pair's key, PT midnight to PT midnight
    for (const ins of inserts) {
      expect(ins.sql).toContain("'active'");
      expect(ins.args[9]).toBe(ptMidnightIso(today));          // starts_at
      expect(ins.args[10]).toBe(ptMidnightIso(nextDay(today))); // ends_at
      expect(ins.args[11]).toBe(today);                         // hunt_day
    }
    const byPair = new Map(inserts.map((c) => [c.args[12], c]));
    // u1 (C) + u2 (E): the E hunter caps it at the Twin Maw; pattern ≈ 100k/9 + 50k/9 = 16.7k, × 0.75 = 12.5k → the real 4,000 (W1189)
    expect(byPair.get('u1|u2')!.args[1]).toBe('the_twin_maw');
    expect(byPair.get('u1|u2')!.args[6]).toBe(4000);
    // u1 (C) + u3 (C): pattern ≈ 24.4k, × 0.75 = 18.3k → The Coursing Dread at 8,000 (W1189)
    expect(byPair.get('u1|u3')!.args[1]).toBe('the_coursing_dread');
    expect(byPair.get('u1|u3')!.args[6]).toBe(8000);
    // the participant row is guarded on the instance existing
    const parts = calls.filter((c) => c.sql.includes('INTO coop_boss_participants'));
    expect(parts.length).toBe(3);
    expect(parts[0].sql).toContain('WHERE EXISTS');
    // no phone sent a flights average: no steps-only row carries a flights goal
    for (const ins of inserts) expect(ins.args[7]).toBeNull();
  });

  const DREAD = ['the_long_pursuit', 'houndsfang_recurve', 'coursing_houndcall'];
  it('W1207/W1209 — a friend pair who both own every Dread drop hunt the Twin Maw instead; one still missing a drop keeps the Dread', async () => {
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb({ ...base, owned: { u1: DREAD, u3: [...DREAD, 'bothsight_longbow'], u4: DREAD } }, calls)), ctx);
    expect(res.created).toBe(3);
    const byPair = new Map(calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances')).map((c) => [c.args[12], c]));
    expect(byPair.get('u1|u3')!.args[1]).toBe('the_twin_maw');
    expect(byPair.get('u1|u3')!.args[6]).toBe(4000);
    const q = calls.find((c) => c.sql.includes('json_each(') && c.args.includes('u3'))!;
    expect(q.sql).toContain("'the_long_pursuit'");
    expect(q.sql).toContain("'houndsfang_recurve'");
    // u3 lacks one rare → the Dread stays
    const one: Call[] = [];
    await sweepCoopAutoHunts(makeEnv(sweepDb({ ...base, owned: { u1: DREAD, u3: DREAD.slice(0, 2) } }, one)), ctx);
    const onePairs = new Map(one.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances')).map((c) => [c.args[12], c]));
    expect(onePairs.get('u1|u3')!.args[1]).toBe('the_coursing_dread');
  });

  it('W1209 — one hunter\'s friends do not all land on the same boss the same day', async () => {
    const fix: SweepFixture = {
      friends: [{ a: 'u1', b: 'u3' }, { a: 'u1', b: 'u5' }, { a: 'u1', b: 'u6' }],
      builds: { u1: NEW, u3: NEW, u5: NEW, u6: NEW },
      ranks: { u1: 'C', u3: 'C', u5: 'C', u6: 'C' },
      stepsThisWeek: { u1: 30000, u3: 40000, u5: 30000, u6: 30000 },
      stepsLastWeek: { u1: 70000, u3: 80000, u5: 60000, u6: 60000 },
    };
    const calls: Call[] = [];
    await sweepCoopAutoHunts(makeEnv(sweepDb(fix, calls)), ctx);
    const boss = new Map(calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances') && String(c.args[12]).split('|').length === 2).map((c) => [c.args[12], c.args[1]]));
    // Dread, then the Twin Maw (u1 is on the Dread), then a tie on today → the best again
    expect([boss.get('u1|u3'), boss.get('u1|u5'), boss.get('u1|u6')]).toEqual(['the_coursing_dread', 'the_twin_maw', 'the_coursing_dread']);
    // a hunt made earlier today counts too
    const later: Call[] = [];
    await sweepCoopAutoHunts(makeEnv(sweepDb({ ...fix, friends: [{ a: 'u1', b: 'u3' }], todayRows: [{ boss_id: 'the_coursing_dread', a: 'u1', b: 'u9', c: null }] }, later)), ctx);
    expect(later.find((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances'))!.args[1]).toBe('the_twin_maw');
  });

  it('W1209 — a pair rotates off yesterday\'s boss, reading its own last 14 days', async () => {
    const calls: Call[] = [];
    const y = prevDay(today)!;
    await sweepCoopAutoHunts(makeEnv(sweepDb({ ...base, done: ['u1|u2', 'u2|u4'], history: [{ pair_key: 'u1|u3', boss_id: 'the_coursing_dread', d: y }, { pair_key: 'u2|u9', boss_id: 'the_twin_maw', d: y }] }, calls)), ctx);
    const ins = calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances'));
    expect(ins.length).toBe(1);
    expect(ins[0].args[12]).toBe('u1|u3');
    expect(ins[0].args[1]).toBe('the_twin_maw');
    const h = calls.find((c) => c.sql.includes('GROUP BY pair_key, boss_id'))!;
    let since = today;
    for (let i = 0; i < 14; i++) since = prevDay(since)!;
    expect(h.args).toEqual([since, today]);
  });

  it('W1208 — three friends get one automatic trio, all seats joined; the duos are made as before', async () => {
    const trioFix: SweepFixture = {
      friends: [{ a: 'u1', b: 'u3' }, { a: 'u3', b: 'u5' }, { a: 'u5', b: 'u1' }, { a: 'u1', b: 'u2' }],
      builds: { u1: NEW, u2: NEW, u3: NEW, u5: NEW },
      ranks: { u1: 'C', u2: 'E', u3: 'C', u5: 'B' },
      stepsThisWeek: { u1: 30000, u2: 15000, u3: 40000, u5: 30000 },
      stepsLastWeek: { u1: 70000, u2: 35000, u3: 80000, u5: 60000 },
    };
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(trioFix, calls)), ctx);
    expect(res.created).toBe(4);   // the four friend pairs
    expect(res.trios).toBe(1);     // u2 is E-rank: only u1, u3, u5
    const trio = calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances') && c.args[13] === 'u1|u3|u5');
    expect(trio.length).toBe(1);
    const t = trio[0];
    // pattern ≈ 11.1k + 13.3k + 10k = 34.4k, × 0.8 = 27.6k; the C hunters cap it at the Threefold Court
    expect(t.args.slice(1, 6)).toEqual(['the_threefold_court', 'C', 'u1', 'u3', 'u5']);
    expect(t.args[8]).toBe(12000);
    expect(t.args[12]).toBe(today);
    const seats = calls.filter((c) => c.sql.includes('INTO coop_boss_participants') && c.args[0] === t.args[0]);
    expect(seats.map((c) => c.args[1])).toEqual(['u3', 'u5']);
    // all three own every Court drop → the Crossroads Hound
    const COURT = ['vestments_of_the_final_verdict', 'courthunters_grips', 'seal_of_the_threefold_court'];
    const spentCalls: Call[] = [];
    await sweepCoopAutoHunts(makeEnv(sweepDb({ ...trioFix, owned: { u1: COURT, u3: COURT, u5: COURT } }, spentCalls)), ctx);
    const t2 = spentCalls.find((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances') && c.args[13] === 'u1|u3|u5')!;
    expect(t2.args[1]).toBe('the_crossroads_hound');
    // today's trio already stands → no second
    const again: Call[] = [];
    const res2 = await sweepCoopAutoHunts(makeEnv(sweepDb({ ...trioFix, trioRows: [{ a: 'u1', b: 'u3', c: 'u5', d: today }] }, again)), ctx);
    expect(res2.trios).toBe(0);
  });

  // W1219 — owner 2026-11-16: "Justin and Anthony weren't on yesterday and it still gave me automatic hunts with them"
  it('W1219 — a friend not in the app today or yesterday gets no automatic duo or trio; back in the app, they do', async () => {
    const fix: SweepFixture = {
      friends: [{ a: 'u1', b: 'u3' }, { a: 'u3', b: 'u5' }, { a: 'u5', b: 'u1' }, { a: 'u1', b: 'u2' }],
      builds: { u1: NEW, u2: NEW, u3: NEW, u5: NEW },
      ranks: { u1: 'C', u2: 'E', u3: 'C', u5: 'B' },
      stepsThisWeek: { u1: 30000, u2: 15000, u3: 40000, u5: 30000 },
      stepsLastWeek: { u1: 70000, u2: 35000, u3: 80000, u5: 60000 },
    };
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb({ ...fix, opened: ['u1', 'u2', 'u3'] }, calls)), ctx);   // u5 quiet
    expect(res.created).toBe(2);
    expect(res.skipped).toBe(2);   // u1|u5, u3|u5
    expect(res.trios).toBe(0);     // u5 out, u2 E-rank: no three left
    const keys = calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances')).map((c) => c.args[12]).sort();
    expect(keys).toEqual(['u1|u2', 'u1|u3']);
    expect(calls.filter((c) => c.sql.includes('AS seen_by')).length).toBe(1);   // one read per pass
    // u5 opens the app → the next pass makes their duos and the trio
    const back: Call[] = [];
    const res2 = await sweepCoopAutoHunts(makeEnv(sweepDb({ ...fix, opened: ['u1', 'u2', 'u3', 'u5'] }, back)), ctx);
    expect(res2.created).toBe(4);
    expect(res2.trios).toBe(1);
  });

  it('W1210 — a hunter with several friends gets up to three trios a day, with different friends and bosses', async () => {
    const fix: SweepFixture = {
      friends: [{ a: 'u1', b: 'u3' }, { a: 'u1', b: 'u5' }, { a: 'u1', b: 'u6' }, { a: 'u3', b: 'u5' }],
      builds: { u1: NEW, u3: NEW, u5: NEW, u6: NEW },
      ranks: { u1: 'C', u3: 'C', u5: 'C', u6: 'C' },
      stepsThisWeek: { u1: 30000, u3: 40000, u5: 30000, u6: 30000 },
      stepsLastWeek: { u1: 70000, u3: 80000, u5: 60000, u6: 60000 },
    };
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(fix, calls)), ctx);
    expect(res.trios).toBe(3);
    const trios = calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances') && String(c.args[13]).split('|').length === 3);
    // the mutual three first; then new faces (u6), the stronger walkers first
    expect(trios.map((c) => c.args[13])).toEqual(['u1|u3|u5', 'u1|u3|u6', 'u1|u5|u6']);
    // u1 is on the Court after the first, so the second goes to the Hound; the third ties, so the best
    expect(trios.map((c) => c.args[1])).toEqual(['the_threefold_court', 'the_crossroads_hound', 'the_threefold_court']);
    // with two already made today, u1 has room for one more, and those two are not made again
    const later: Call[] = [];
    const res2 = await sweepCoopAutoHunts(makeEnv(sweepDb({ ...fix, trioRows: [{ a: 'u1', b: 'u3', c: 'u5', d: today }, { a: 'u1', b: 'u3', c: 'u6', d: today }] }, later)), ctx);
    expect(res2.trios).toBe(1);
    expect(later.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances') && String(c.args[13]).split('|').length === 3).map((c) => c.args[13])).toEqual(['u1|u5|u6']);
  });

  it('W1209 — ownedAutoDrops reads the owned drops (count > 0); a failed read owns nothing', async () => {
    const calls: Call[] = [];
    const owned = await ownedAutoDrops(makeEnv(sweepDb({ owned: { u1: ['the_hollow_crown', 'crownpiercer'] } }, calls)), ['u1', 'u2']);
    expect(Array.from(owned.get('u1') ?? []).sort()).toEqual(['crownpiercer', 'the_hollow_crown']);
    expect(owned.has('u2')).toBe(false);
    const q = calls.find((c) => c.sql.includes('json_each('))!;
    expect(q.sql).toContain("'$.count'), 0) > 0");
    expect(q.args).toEqual(['u1', 'u2']);
    const broken = { prepare: () => { throw new Error('boom'); } } as unknown as D1Database;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await ownedAutoDrops(makeEnv(broken), ['u1'])).size).toBe(0);
    errSpy.mockRestore();
  });

  it('W1195 — a pair whose phones both send flights averages gets a steps + flights boss with both goals on the row', async () => {
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb({ ...base, flights: { u1: 5, u3: 4, u4: 0.5 } }, calls)), ctx);
    expect(res.created).toBe(3);
    const inserts = calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances'));
    const byPair = new Map(inserts.map((c) => [c.args[12], c]));
    // u1 (C) + u3 (C): 24.4k steps and 9 flights a day; × 0.8 = 19.6k and 7.2 → The Gaunt Wardens, 8,000 + 6
    expect(byPair.get('u1|u3')!.args[1]).toBe('the_gaunt_wardens');
    expect(byPair.get('u1|u3')!.args[6]).toBe(8000);
    expect(byPair.get('u1|u3')!.args[7]).toBe(6);
    // u1 (C) + u2 (E): u2 sent no average, and the E hunter caps it anyway → the Twin Maw, no flights goal
    expect(byPair.get('u1|u2')!.args[1]).toBe('the_twin_maw');
    expect(byPair.get('u1|u2')!.args[7]).toBeNull();
  });

  it('skips a pair already holding today\'s row, an opted-out side, a blocked pair, an old build, and a hunter with no pattern', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      ...base,
      friends: [{ a: 'u1', b: 'u2' }, { a: 'u1', b: 'u3' }, { a: 'u2', b: 'u4' }, { a: 'u3', b: 'u4' }, { a: 'u1', b: 'u4' }],
      done: ['u1|u2'],
      optouts: [{ user_id: 'u3', friend_user_id: 'u1' }],
      blocks: [{ blocker_id: 'u4', blocked_id: 'u2' }],
      builds: { ...base.builds, u3: NEW, u4: '3.0.16-w1096' },   // the iOS 27 hotfix build: no W1094 client yet
    };
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.pairs).toBe(5);
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(4);   // u1|u3 opted out, u2|u4 blocked, u3|u4 + u1|u4 old build
    expect(calls.some((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances'))).toBe(false);
  });

  it('a global switch-off (\'*\') and a missing pattern both stop the pair', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      ...base,
      friends: [{ a: 'u1', b: 'u2' }, { a: 'u1', b: 'u3' }],
      optouts: [{ user_id: 'u2', friend_user_id: '*' }],
      stepsThisWeek: { u1: 30000, u2: 15000 },
      stepsLastWeek: { u1: 70000, u2: 35000 },   // u3 has no steps in either week
    };
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(2);
  });

  it('a lost race on the unique index creates nothing twice', async () => {
    const calls: Call[] = [];
    const db = sweepDb(base, calls) as unknown as { batch: (s: unknown[]) => Promise<unknown[]> };
    db.batch = async () => [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
    const ok = await createAutoHunt(makeEnv(db as unknown as D1Database), 'u2', 'u1', today, { bossId: 'the_twin_maw', goalSteps: 9000 });
    expect(ok).toBe(false);
    const ins = calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances'))!;
    expect(ins.args[3]).toBe('u1');   // the smaller id leads
    expect(ins.args[4]).toBe('u2');
    expect(ins.args[6]).toBe(9000);
  });
});

describe('sweepCoopAutoHunts — the automatic raid (W1211)', () => {
  // owner 2026-11-14: "automate the raid with 5 active randoms ... active-active"; "Keep 135k + 150";
  // "Back to back"; "you can only be in one raid at a time". W1239 (2026-11-18): "automated at 6 hunters and
  // ... completely random with active hunters", active = "opened the app at least 5x this week since sunday".
  const kills = (n: Record<string, number>) => Object.entries(n).map(([user_id, kill_days]) => ({ user_id, kill_days, kills: kill_days * 2, created_at: 0 }));
  const fix: SweepFixture = {
    kills: kills({ u1: 7, u2: 6, u3: 5, u4: 4, u5: 4, u6: 5, u7: 3, u8: 6, u9: 6, u10: 1 }),
    weekOpens: { u1: 30, u2: 12, u3: 9, u4: 5, u5: 7, u6: 20, u7: 4, u8: 15, u9: 10 },
    builds: { u1: NEW, u2: NEW, u3: NEW, u4: NEW, u5: NEW, u6: NEW, u7: NEW, u8: '3.0.16-w1096', u9: NEW, u10: NEW },
    optouts: [{ user_id: 'u9', friend_user_id: '*' }],
  };
  const raids = (calls: Call[]) => calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances') && c.args[1] === 'the_grinning_god');

  it('W1239/W1240 — six active hunters (5+ opens in the last 7 days) on the automatic client get one live raid: every seat joined, the full goal, 80 hours', async () => {
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(fix, calls)), ctx);
    expect(res.raids).toBe(1);
    const r = raids(calls);
    expect(r.length).toBe(1);
    const a = r[0].args;
    expect(a[14]).toBe('u1|u2|u3|u4|u5|u6');   // u7 has 4 opens, u8 an old build, u9 switched automatic hunts off, u10 no opens
    expect(calls.find((c) => c.sql.includes('AS week_opens'))!.args).toEqual([activeWindowStart(today)]);   // W1240 — the last 7 days
    expect(a.slice(1, 6)).toEqual(['the_grinning_god', 'S', 'u1', 'u2', 'u3']);
    expect([a[8], a[9], a[10]]).toEqual([200000, 200, 800]);   // W1234
    expect(Date.parse(a[12] as string) - Date.parse(a[11] as string)).toBe(80 * 3_600_000);
    expect(a[13]).toBe(today);
    expect(r[0].sql).toContain("'active'");
    expect(r[0].sql).toMatch(/, 1, \?, \?, 0\)/);   // auto = 1, matched = 0
    const seats = calls.filter((c) => c.sql.includes('INTO coop_boss_participants') && c.args[0] === a[0]);
    expect(seats.map((c) => c.args[1])).toEqual(['u2', 'u3', 'u4', 'u5', 'u6']);
    expect(seats.every((c) => c.args[2] === a[11])).toBe(true);
    expect(calls.filter((c) => c.sql.includes('DELETE FROM raid_queue')).length).toBe(6);
    expect(mockNotify).toHaveBeenCalledTimes(6);
    expect(mockNotify.mock.calls[0][2]).toMatchObject({
      title: 'Raid Party Found',
      body: 'The Grinning God: you and 5 hunters have 80 hours for 200,000 steps and 200 flights together.',
    });
  });

  it('one raid at a time, and W1239 exactly six: with a hunter in a live raid the other five wait; a sixth makes the raid', async () => {
    const five: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb({ ...fix, raidLive: ['u1'] }, five)), ctx);
    expect(res.raids).toBe(0);   // W1239 — five never make a raid (W1211 made one of 4-5)
    expect(raids(five).length).toBe(0);
    expect(five.find((c) => c.sql.includes('AS uid'))!.args).toEqual(['the_grinning_god', '']);
    const calls: Call[] = [];
    await sweepCoopAutoHunts(makeEnv(sweepDb({ ...fix, raidLive: ['u1'], weekOpens: { ...fix.weekOpens, u10: 8 } }, calls)), ctx);
    expect(raids(calls).map((c) => c.args[14])).toEqual(['u10|u2|u3|u4|u5|u6']);
  });

  it('W1239 — twelve eligible make two raids of six; thirteen leave one waiting', async () => {
    const ids = Array.from({ length: 13 }, (_, i) => 'r' + String(i + 1).padStart(2, '0'));
    const many: SweepFixture = {
      kills: kills(Object.fromEntries(ids.map((id) => [id, 1]))),
      weekOpens: Object.fromEntries(ids.map((id) => [id, 6])),
      builds: Object.fromEntries(ids.map((id) => [id, NEW])),
    };
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(many, calls)), ctx);
    expect(res.raids).toBe(2);
    const parties = raids(calls).map((c) => String(c.args[14]).split('|'));
    expect(parties.map((p) => p.length)).toEqual([6, 6]);
    expect(new Set(parties.flat()).size).toBe(12);
  });

  // W1217 — owner 2026-11-15: "make sure those people are active that get paired"
  it('W1217/W1218 — a hunter not in the app today or yesterday is never put in a raid party', async () => {
    const calls: Call[] = [];
    await sweepCoopAutoHunts(makeEnv(sweepDb({ ...fix, weekOpens: { ...fix.weekOpens, u10: 8 }, opened: ['u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u10'] }, calls)), ctx);
    expect(raids(calls).map((c) => c.args[14])).toEqual(['u10|u2|u3|u4|u5|u6']);   // u1 (30 opens this week) went quiet
  });

  it('formRaidParties: sixes first, a remainder of 4-5 makes one more, fewer wait; nobody with someone they blocked', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => 'h' + (i + 1));
    const none = () => false;
    expect(AUTO_RAID_PARTY).toBe(6);
    expect(AUTO_RAID_MIN_OPENS).toBe(5);   // W1239
    expect(formRaidParties(ids(10), none, 6, 6)).toEqual([ids(6)]);   // W1239 — the sweep asks for exactly six
    expect(formRaidParties(ids(5), none, 6, 6)).toEqual([]);
    expect(formRaidParties(ids(6), none)).toEqual([ids(6)]);
    expect(formRaidParties(ids(7), none)).toEqual([ids(6)]);
    expect(formRaidParties(ids(10), none).map((p) => p.length)).toEqual([6, 4]);
    expect(formRaidParties(ids(9), none).map((p) => p.length)).toEqual([6]);
    expect(formRaidParties(ids(5), none)).toEqual([ids(5)]);
    expect(formRaidParties(ids(3), none)).toEqual([]);
    const blk = (a: string, b: string) => (a === 'h1' && b === 'h2') || (a === 'h2' && b === 'h1');
    expect(formRaidParties(ids(6), blk)).toEqual([['h1', 'h3', 'h4', 'h5', 'h6']]);   // h2 waits
  });

  it('W1240 — "active" is 5+ opens over a rolling 7 Pacific days, today included', () => {
    expect(AUTO_RAID_MIN_OPENS).toBe(5);
    expect(ACTIVE_OPEN_DAYS).toBe(7);
    expect(activeWindowStart('2026-11-18')).toBe('2026-11-12');
    expect(activeWindowStart('2026-11-15')).toBe('2026-11-09');   // a Sunday still sees the week before
    expect(activeWindowStart('2026-03-03')).toBe('2026-02-25');
  });

  it('W1239 — raidShuffle: a fresh random order every pass, always the same hunters', () => {
    const six = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
    const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
    const a = raidShuffle(six, seq([0.9, 0.1, 0.5, 0.3, 0.7]));
    const b = raidShuffle(six, seq([0.1, 0.9, 0.2, 0.8, 0.4]));
    expect([...a].sort()).toEqual(six);
    expect([...b].sort()).toEqual(six);
    expect(a).not.toEqual(b);
    expect(six).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);   // never shuffles its input
    expect([...raidShuffle(six)].sort()).toEqual(six);
  });

  it('a raid row is never read as a trio: the trio pass reads only the trio bosses', async () => {
    const calls: Call[] = [];
    await sweepCoopAutoHunts(makeEnv(sweepDb({ friends: [{ a: 'u1', b: 'u2' }, { a: 'u1', b: 'u3' }] }, calls)), ctx);
    const q = calls.find((c) => c.sql.includes('partner2_user_id IS NOT NULL AND hunt_day'))!;
    expect(q.sql).toContain("boss_id IN ('the_trinity_colossus', 'the_triune_sentinel', 'the_threefold_court', 'the_crossroads_hound')");
  });

  // W1212 — the build lookup was a correlated MAX over every app_opens row ever (88% of the
  // database's reads); both lookups now read only the recent window through the date index.
  it('W1212 — the build and flights lookups read only the recent window, never each row\'s history', async () => {
    const calls: Call[] = [];
    await sweepCoopAutoHunts(makeEnv(sweepDb(fix, calls)), ctx);
    const b = calls.find((c) => c.sql.includes('FROM app_opens') && !c.sql.includes('flights_avg IS NOT NULL'))!;
    expect(b.sql).toContain('INDEXED BY idx_app_opens_date');
    expect(b.sql).not.toContain('MAX(b.opened_at)');
    expect(b.args).toEqual([new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10)]);
    const f = calls.find((c) => c.sql.includes('flights_avg IS NOT NULL'))!;
    expect(f.sql).toContain('INDEXED BY idx_app_opens_date');
    expect(f.sql).not.toContain('MAX(b.opened_at)');
    expect(f.args.length).toBe(2);
  });
});

describe('sweepCoopResolve — the server settles every active hunt', () => {
  const past = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const future = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const row = (id: string, extra: Record<string, unknown>) => ({
    id, boss_id: 'the_twin_maw', boss_rank: 'E', challenger_user_id: 'u1', partner_user_id: 'u2', partner2_user_id: null,
    partner_joined_at: past, partner2_joined_at: null, goal_steps: 14000, goal_flights: null, reward_souls: 25,
    fill_target: null, status: 'active', result: null, starts_at: past, ends_at: future, resolved_at: null,
    created_at: '2026-10-25 07:00:00', updated_at: '2026-10-25 07:00:00', ...extra,
  });

  it('an automatic win: completed + committed, awards for both, ONE push per hunter per day', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      active: [row('a1', { auto: 1, hunt_day: today, pair_key: 'u1|u2' })],
      participants: [{ instance_id: 'a1', user_id: 'u2', joined_at: past }],
      progress: [{ bid: 'a1', user_id: 'u1', event_type: 'steps_total', s: 9000 }, { bid: 'a1', user_id: 'u2', event_type: 'steps_total', s: 6000 }],
    };
    const res = await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(res).toEqual({ won: 1, expired: 0 });
    const upd = calls.find((c) => c.sql.includes("SET status = 'completed'"))!;
    expect(upd.args).toEqual([1, 'a1']);   // committed = 1: both posted
    expect(calls.filter((c) => c.sql.includes('INTO coop_boss_awards')).length).toBe(2);
    expect(calls.filter((c) => c.sql.includes('SET coop_auto_push_day')).length).toBe(2);
    expect(mockNotify).toHaveBeenCalledTimes(2);
    const first = mockNotify.mock.calls[0];
    expect(first[1]).toBe('u1');
    expect((first[2] as { body: string }).body).toBe('You and anthony brought down The Twin Maw.');
    expect((first[2] as { type: string }).type).toBe('coop_complete');
  });

  it('W1211 — an automatic raid win tells every hunter, outside the once-a-day claim', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      active: [row('r1', {
        boss_id: 'the_grinning_god', boss_rank: 'S', goal_steps: 135000, goal_flights: 150, reward_souls: 800,
        partner2_user_id: 'u3', partner2_joined_at: past, auto: 1, hunt_day: today, pair_key: 'u1|u2|u3|u4',
      })],
      participants: ['u2', 'u3', 'u4'].map((u) => ({ instance_id: 'r1', user_id: u, joined_at: past })),
      progress: [
        { bid: 'r1', user_id: 'u1', event_type: 'steps_total', s: 70000 },
        { bid: 'r1', user_id: 'u2', event_type: 'steps_total', s: 65000 },
        { bid: 'r1', user_id: 'u3', event_type: 'flights_total', s: 100 },
        { bid: 'r1', user_id: 'u4', event_type: 'flights_total', s: 50 },
      ],
    };
    const res = await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(res).toEqual({ won: 1, expired: 0 });
    expect(calls.filter((c) => c.sql.includes('INTO coop_boss_awards')).length).toBe(4);
    expect(calls.filter((c) => c.sql.includes('SET coop_auto_push_day')).length).toBe(0);
    expect(mockNotify).toHaveBeenCalledTimes(4);
    expect(mockNotify.mock.calls[0][2]).toMatchObject({ title: 'Raid Complete', body: 'Your raid party brought down The Grinning God.', type: 'coop_complete' });
    // W1241 — one post for every hunter's feed, under the MVP (u1, the most steps), naming the rest of the party
    const posts = calls.filter((c) => c.sql.includes('INSERT INTO public_achievement_events') && c.sql.includes("'raid_won'"));
    expect(posts.length).toBe(1);
    const p = posts[0].args;
    expect(p[1]).toBe('u1');
    expect(p[2]).toBe('the_grinning_god');
    expect(p[3]).toBe('defeated The Grinning God with anthony, ren and gali');
    expect([p[4], p[5], p[6]]).toEqual([4, 'S', 'official:raid:r1']);
    expect(posts[0].sql).toContain('ON CONFLICT(user_id, client_event_id) DO NOTHING');
  });

  it('W1241 — a won duo or trio hunt posts nothing to everyone; only a raid does', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      active: [row('a9', { auto: 1 })],
      participants: [{ instance_id: 'a9', user_id: 'u2', joined_at: past }],
      progress: [{ bid: 'a9', user_id: 'u1', event_type: 'steps_total', s: 14000 }, { bid: 'a9', user_id: 'u2', event_type: 'steps_total', s: 1 }],
    };
    await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(calls.filter((c) => c.sql.includes("'raid_won'")).length).toBe(0);
  });

  it('a second automatic win the same day is quiet (the day stamp is already taken)', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      active: [row('a2', { auto: 1 })],
      participants: [{ instance_id: 'a2', user_id: 'u2', joined_at: past }],
      progress: [{ bid: 'a2', user_id: 'u1', event_type: 'steps_total', s: 14000 }, { bid: 'a2', user_id: 'u2', event_type: 'steps_total', s: 1 }],
      stampChanges: 0,
    };
    await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.sql.includes('INTO coop_boss_awards')).length).toBe(2);   // the reward still lands
  });

  it('an automatic defeat is silent and stamps committed = 0 when one hunter never posted', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      active: [row('a3', { auto: 1, ends_at: past })],
      participants: [{ instance_id: 'a3', user_id: 'u2', joined_at: past }],
      progress: [{ bid: 'a3', user_id: 'u1', event_type: 'steps_total', s: 3000 }],
    };
    const res = await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(res).toEqual({ won: 0, expired: 1 });
    const upd = calls.find((c) => c.sql.includes("SET status = 'expired'"))!;
    expect(upd.args).toEqual([0, 'a3']);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('a manual hunt still pushes its defeat to every hunter, and an unfinished one is left alone', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      active: [row('m1', { auto: 0, ends_at: past }), row('m2', { auto: 0 })],
      participants: [{ instance_id: 'm1', user_id: 'u2', joined_at: past }, { instance_id: 'm2', user_id: 'u2', joined_at: past }],
      progress: [{ bid: 'm1', user_id: 'u1', event_type: 'steps_total', s: 100 }, { bid: 'm2', user_id: 'u1', event_type: 'steps_total', s: 100 }],
    };
    const res = await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(res).toEqual({ won: 0, expired: 1 });
    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect((mockNotify.mock.calls[0][2] as { type: string }).type).toBe('coop_lost');
    expect(calls.some((c) => c.sql.includes("SET status = 'expired'") && c.args[1] === 'm2')).toBe(false);
  });
});

describe('sweepCoopResolve — the backlog settles quietly', () => {
  it('a hunt that closed days ago still gets its verdict and awards, but no push', async () => {
    const calls: Call[] = [];
    const longAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const base = {
      id: 'old1', boss_id: 'the_twin_maw', boss_rank: 'E', challenger_user_id: 'u1', partner_user_id: 'u2', partner2_user_id: null,
      partner_joined_at: longAgo, partner2_joined_at: null, goal_steps: 14000, goal_flights: null, reward_souls: 25, fill_target: null,
      status: 'active', result: null, starts_at: longAgo, ends_at: longAgo, resolved_at: null, created_at: longAgo, updated_at: longAgo, auto: 0,
    };
    const f: SweepFixture = {
      active: [base, { ...base, id: 'old2' }],
      participants: [{ instance_id: 'old1', user_id: 'u2', joined_at: longAgo }, { instance_id: 'old2', user_id: 'u2', joined_at: longAgo }],
      progress: [
        { bid: 'old1', user_id: 'u1', event_type: 'steps_total', s: 14000 },   // a win nobody resolved
        { bid: 'old2', user_id: 'u1', event_type: 'steps_total', s: 100 },     // a loss nobody resolved
      ],
    };
    const res = await sweepCoopResolve(makeEnv(sweepDb(f, calls)), ctx);
    expect(res).toEqual({ won: 1, expired: 1 });
    expect(calls.filter((c) => c.sql.includes('INTO coop_boss_awards')).length).toBe(2);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('POST/DELETE /v1/coop-boss/auto/optout', () => {
  const session = (userId: string) => ({ userId, alias: 'tester' } as unknown as SessionPayload);
  const req = (body: unknown) => new Request('https://x/v1/coop-boss/auto/optout', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  it('switches one friend off, then back on', async () => {
    const calls: Call[] = [];
    const env = makeEnv(sweepDb({}, calls));
    const off = await handleCoopAutoOptOut(req({ friend_user_id: 'deadbeef-1' }), env, session('u1'), false);
    expect(off.status).toBe(200);
    expect(calls.some((c) => c.sql.includes('INSERT OR IGNORE INTO coop_auto_optouts') && c.args[1] === 'deadbeef-1')).toBe(true);
    const on = await handleCoopAutoOptOut(req({ friend_user_id: 'deadbeef-1' }), env, session('u1'), true);
    expect(on.status).toBe(200);
    expect(calls.some((c) => c.sql.includes('DELETE FROM coop_auto_optouts') && c.args[1] === 'deadbeef-1')).toBe(true);
  });
  it("accepts '*' and refuses garbage or yourself", async () => {
    const env = makeEnv(sweepDb({}, []));
    expect((await handleCoopAutoOptOut(req({ friend_user_id: '*' }), env, session('u1'), false)).status).toBe(200);
    expect((await handleCoopAutoOptOut(req({ friend_user_id: 'u1' }), env, session('u1'), false)).status).toBe(400);
    expect((await handleCoopAutoOptOut(req({ friend_user_id: 'no spaces allowed' }), env, session('u1'), false)).status).toBe(400);
    expect((await handleCoopAutoOptOut(req({}), env, session('u1'), false)).status).toBe(400);
  });
});

// ── W1164 — matched partners: active hunters with no friends, paired with each other ──
describe('pickMatchedPairs — who meets whom', () => {
  const c = (id: string, killDays: number, kills: number, pattern = 3000) => ({ id, killDays, kills, pattern });
  const never = () => false;

  it('pairs by how often each shows up, so two regulars meet and the occasional ones meet each other', () => {
    // owner, 2026-11-07: Orfhlaith (5 kill days) and Sharr (4) "would be a perfect pairing"
    const pool = [c('rip', 2, 2, 3000), c('orf', 5, 10, 2600), c('gio', 2, 3, 9000), c('sha', 4, 8, 3100)];
    expect(pickMatchedPairs(pool, [], new Set(), never)).toEqual([['orf', 'sha'], ['gio', 'rip']]);
  });
  it('a pair kept from earlier this week stays together ahead of the sort', () => {
    const pool = [c('orf', 5, 10), c('sha', 4, 8), c('gio', 2, 3), c('rip', 2, 2)];
    expect(pickMatchedPairs(pool, [['orf', 'gio']], new Set(), never)).toEqual([['gio', 'orf'], ['rip', 'sha']]);
  });
  it('a kept pair breaks when one side left the pool; nobody in a matched hunt today gets a second', () => {
    const pool = [c('orf', 5, 10), c('sha', 4, 8), c('rip', 2, 2)];
    // gio left the pool (made a friend); orf already hunted with gio today → orf waits for tomorrow
    expect(pickMatchedPairs(pool, [['orf', 'gio']], new Set(['orf', 'gio']), never)).toEqual([['rip', 'sha']]);
  });
  it('a block or a switched-off partner is skipped for the next one; the odd hunter out waits', () => {
    const pool = [c('orf', 5, 10), c('sha', 4, 8), c('gio', 2, 3)];
    const blocked = (a: string, b: string) => [a, b].sort().join('|') === 'orf|sha';
    expect(pickMatchedPairs(pool, [], new Set(), blocked)).toEqual([['gio', 'orf']]);
  });
});

describe('sweepCoopAutoHunts — matched partners (W1164)', () => {
  const OLD_JOIN = Date.parse('2026-09-21T12:00:00Z');
  const friendsBase: SweepFixture = {
    friends: [{ a: 'u1', b: 'u2' }],
    builds: { u1: NEW, u2: NEW, u5: '3.0.22-w1132', u6: '3.0.20-w1120', u7: NEW, u8: NEW },
    ranks: { u1: 'C', u2: 'C', u5: 'D', u6: 'E', u7: 'E', u8: 'E' },
    stepsThisWeek: { u1: 30000, u2: 30000, u5: 6000, u6: 7000, u7: 4000, u8: 3000 },
    stepsLastWeek: { u1: 70000, u2: 70000, u5: 35000, u6: 40000, u7: 20000, u8: 15000 },
  };
  const kill = (user_id: string, kill_days: number, kills: number, created_at = OLD_JOIN) => ({ user_id, kill_days, kills, created_at });
  const matchedInserts = (calls: Call[]) => calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances') && c.args[13] === 1);

  it('two active hunters with no friends get a sized daily hunt together; friends still get theirs', async () => {
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb({ ...friendsBase, kills: [kill('u5', 5, 10), kill('u6', 4, 8)] }, calls)), ctx);
    expect(res.created).toBe(1);   // the friend pair
    expect(res.matched).toBe(1);   // the matched pair
    const m = matchedInserts(calls);
    expect(m.length).toBe(1);
    expect(m[0].args[12]).toBe('u5|u6');
    expect(m[0].args[11]).toBe(today);
    expect(m[0].args[1]).toBe('the_twin_maw');   // an E hunter caps it, sized to the pair's walking
    const friend = calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances') && c.args[12] === 'u1|u2')!;
    expect(friend.args[13]).toBe(0);
    expect(MATCH_MIN_KILL_DAYS).toBe(2);
  });

  it('never matches a hunter with a friend, one kill day, a first day, an old build, automatic hunts off, or no steps', async () => {
    const calls: Call[] = [];
    const f: SweepFixture = {
      ...friendsBase,
      builds: { ...friendsBase.builds, u9: '3.0.16-w1096' },
      stepsThisWeek: { ...friendsBase.stepsThisWeek, u9: 5000, u10: 5000, u11: 5000 },
      optouts: [{ user_id: 'u10', friend_user_id: '*' }],
      kills: [
        kill('u1', 6, 12),                 // has a friend (u2)
        kill('u5', 5, 10),                 // the only eligible hunter
        kill('u6', 1, 3),                  // one kill day
        kill('u7', 3, 6, Date.now() - 60_000),   // joined today
        kill('u9', 4, 8),                  // the iOS 27 hotfix build: no automatic client
        kill('u10', 4, 8),                 // switched automatic hunts off
        kill('u12', 4, 8),                 // no steps on the server
      ],
    };
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.matched).toBe(0);
    expect(matchedInserts(calls).length).toBe(0);
  });

  // W1214 — owner 2026-11-15: "let them match after their first day of kills instead of two"
  it('W1214 — a hunter who joined in the last week needs one day with a kill; never on their first day; older hunters still need two', async () => {
    expect([MATCH_NEW_DAYS, MATCH_NEW_MIN_KILL_DAYS, MATCH_MIN_KILL_DAYS]).toEqual([7, 1, 2]);
    const calls: Call[] = [];
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    const f: SweepFixture = {
      ...friendsBase,
      kills: [
        kill('u5', 1, 2, twoDaysAgo),            // new, one kill day → in
        kill('u6', 1, 1, twoDaysAgo),            // new, one kill day → in
        kill('u7', 1, 3, Date.now() - 60_000),   // joined today → the first day stays quiet
        kill('u8', 1, 2),                        // joined in September, one kill day → still needs two
      ],
    };
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.matched).toBe(1);
    expect(matchedInserts(calls).map((c) => c.args[12])).toEqual(['u5|u6']);
  });

  // W1216 — owner 2026-11-15: "You make the call"
  it('W1216 — a new hunter whose win is only in the save (or the first-kill ping) counts one kill day; an old hunter does not; the first day stays quiet', async () => {
    const calls: Call[] = [];
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    const f: SweepFixture = {
      ...friendsBase,
      kills: [kill('u5', 1, 1, twoDaysAgo)],      // on the public list
      savedWins: [
        { user_id: 'u6', created_at: twoDaysAgo },             // save only → in
        { user_id: 'u5', created_at: twoDaysAgo },             // on both → counted once
        { user_id: 'u7', created_at: Date.now() - 60_000 },    // joined today → waits
      ],
    };
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.matched).toBe(1);
    expect(matchedInserts(calls).map((c) => c.args[12])).toEqual(['u5|u6']);
    const q = calls.find((c) => c.sql.includes("'first_boss_kill'"))!;
    expect(q.sql).toContain('json_valid');
    expect(q.args[0]).toBe(Date.now() - MATCH_NEW_DAYS * 86_400_000);
  });
  // W1217 — owner 2026-11-15: "make sure those people are active that get paired"
  it('W1217/W1218 — a hunter not in the app today or yesterday is never matched; the reader looks back to yesterday', async () => {
    expect(MATCH_OPEN_DAYS).toBe(2);
    const calls: Call[] = [];
    const f: SweepFixture = { ...friendsBase, kills: [kill('u5', 5, 10), kill('u6', 4, 8), kill('u7', 3, 6)], opened: ['u5', 'u7'] };
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.matched).toBe(1);
    expect(matchedInserts(calls).map((c) => c.args[12])).toEqual(['u5|u7']);   // u6 (most kill days, never opened) left out
    const q = calls.find((c) => c.sql.includes('AS seen_by'))!;
    // W1218 — a counted open or a cloud save; never a bare app_opens ping (a Health background sync)
    expect(q.sql).toContain('FROM app_open_counts WHERE day_pt >= ?1 AND opens > 0');
    expect(q.sql).toContain('FROM user_state_snapshots WHERE server_updated_at >= ?2');
    expect(q.sql).not.toContain('FROM app_opens');
    expect(q.args).toEqual([prevDay(today), Date.parse(ptMidnightIso(prevDay(today)!)!)]);
    // nobody opened → nobody matched
    const calls2: Call[] = [];
    const res2 = await sweepCoopAutoHunts(makeEnv(sweepDb({ ...f, opened: [] }, calls2)), ctx);
    expect(res2.matched).toBe(0);
  });
  it('W1216 — the saved-win read failing leaves the old rule in place', async () => {
    const calls: Call[] = [];
    const db = sweepDb({ ...friendsBase, kills: [kill('u5', 5, 10), kill('u6', 4, 8)] }, calls);
    const prep = db.prepare.bind(db);
    (db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      if (sql.includes("'first_boss_kill'")) return { bind: () => ({ all: async () => { throw new Error('malformed JSON'); } }) };
      return prep(sql);
    };
    const res = await sweepCoopAutoHunts(makeEnv(db), ctx);
    expect(res.matched).toBe(1);
  });

  it('keeps this week\'s partner, re-pairs the rest, and leaves today\'s standing row alone', async () => {
    const calls: Call[] = [];
    const yesterday = '2026-10-25';
    const f: SweepFixture = {
      ...friendsBase,
      kills: [kill('u5', 5, 10), kill('u6', 4, 8), kill('u7', 3, 6), kill('u8', 2, 4)],
      matchedWeek: [{ a: 'u5', b: 'u8', d: yesterday }],   // the sort alone would pair u5 with u6
    };
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.matched).toBe(2);
    expect(matchedInserts(calls).map((c) => c.args[12]).sort()).toEqual(['u5|u8', 'u6|u7']);

    const calls2: Call[] = [];
    const f2: SweepFixture = { ...f, matchedWeek: [{ a: 'u5', b: 'u8', d: today }, { a: 'u6', b: 'u7', d: today }] };
    const res2 = await sweepCoopAutoHunts(makeEnv(sweepDb(f2, calls2)), ctx);
    expect(res2.matched).toBe(0);
    expect(matchedInserts(calls2).length).toBe(0);
  });

  // W1179 — a matched pair forms a Pact Flame, so it is kept across weeks (14 days back), not reset each Sunday
  it('looks back MATCH_KEEP_DAYS for each hunter\'s latest partner, across the week line', async () => {
    const calls: Call[] = [];
    await sweepCoopAutoHunts(makeEnv(sweepDb({ ...friendsBase, kills: [kill('u5', 5, 10), kill('u6', 4, 8)] }, calls)), ctx);
    const q = calls.find((c) => c.sql.includes('WHERE matched = 1 AND hunt_day'))!;
    let want = today; for (let i = 0; i < MATCH_KEEP_DAYS; i++) want = prevDay(want);
    expect(q.args[0]).toBe(want);
    expect(MATCH_KEEP_DAYS).toBe(14);
  });
});

// W1248 — owner 2026-11-20: "If a player on a raid is currently inactive for 24 hours straight, replace them with a
// person that is waiting to be on a raid or that is active and qualifies to be raiding."
describe('W1248 — raid stand-ins: a raider away 24 hours gives the seat to someone free', () => {
  const H = 3_600_000;
  const now = () => Date.now();
  const raidRow = (over: Record<string, unknown> = {}) => ({
    id: 'R1', boss_id: 'the_grinning_god', boss_rank: 'S', status: 'active', auto: 1,
    challenger_user_id: 'c1', partner_user_id: 'p1', partner2_user_id: 'p2',
    starts_at: new Date(now() - 40 * H).toISOString(), ends_at: new Date(now() + 40 * H).toISOString(),
    goal_steps: 200000, goal_flights: 200, reward_souls: 800, ...over,
  });
  const seats = (joinedAt: string) => ['p1', 'p2', 'p3', 'p4', 'p5'].map((user_id) => ({ instance_id: 'R1', user_id, joined_at: joinedAt }));
  const team = ['c1', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const base = (): SweepFixture => ({
    raidRows: [raidRow()],
    participants: seats(new Date(now() - 40 * H).toISOString()),
    lastSeen: { ...Object.fromEntries(team.map((u) => [u, now() - H])), p5: now() - 30 * H, x1: now() - 2 * H, x2: now() - 2 * H, x3: now() - 2 * H, x4: now() - 30 * H },
    weekOpens: { c1: 9, p1: 9, p2: 9, p3: 9, p4: 9, p5: 9, x1: 6, x2: 6, x3: 4, x4: 7 },
    builds: { x1: NEW, x2: NEW, x3: NEW, x4: NEW, q1: NEW },
    raidLive: [...team, 'x2'],   // x2 already in another live raid
    progress: [
      { bid: 'R1', user_id: 'p5', event_type: 'steps_total', s: 640 },
      { bid: 'R1', user_id: 'p5', event_type: 'flights_total', s: 7 },
      { bid: 'R1', user_id: 'p1', event_type: 'steps_total', s: 9000 },
    ],
  });
  const batchSql = (calls: Call[], frag: string) => calls.filter((c) => c.sql.includes(frag));

  it('idleRaiders: away 24h counts from the later of the last visit and the seat (a fresh draw gets a full day)', () => {
    const t0 = now();
    const seen = new Map([['a', t0 - 25 * H], ['b', t0 - 2 * H], ['d', t0 - 24 * H + 60_000]]);
    expect(RAID_IDLE_HOURS).toBe(24);
    expect(idleRaiders([
      { uid: 'a', joinedMs: t0 - 40 * H },   // away 25h → out
      { uid: 'b', joinedMs: t0 - 40 * H },   // seen 2h ago → stays
      { uid: 'c', joinedMs: t0 - 3 * H },    // never seen, but drawn 3h ago → stays
      { uid: 'd', joinedMs: t0 - 40 * H },   // 23h59m → stays
      { uid: 'e', joinedMs: t0 - 30 * H },   // never seen, drawn 30h ago → out
    ], seen, t0)).toEqual(['a', 'e']);
  });

  it('pickStandIn: the raid finder first, then the pool at random; never a teammate or someone a teammate blocked', () => {
    const none = () => false;
    expect(pickStandIn(['q1'], ['x1'], ['c1'], none)).toBe('q1');
    expect(pickStandIn([], ['x1', 'x2', 'x3'], ['c1'], none, () => 0.99)).toBe('x3');
    expect(pickStandIn([], ['x1', 'x2'], ['x1'], none, () => 0)).toBe('x2');
    const blk = (a: string, b: string) => a === 'c1' && b === 'q1';
    expect(pickStandIn(['q1'], ['x1'], ['c1'], blk, () => 0)).toBe('x1');
    expect(pickStandIn([], [], ['c1'], none)).toBeNull();
  });

  it('a member away 30h is swapped for an active free hunter: their steps banked, the seat handed over, the stand-in told', async () => {
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(base(), calls)), ctx);
    expect(res.swaps).toBe(1);
    const up = batchSql(calls, 'SET banked_steps = banked_steps + ?4');
    expect(up.length).toBe(1);
    expect(up[0].args.slice(0, 5)).toEqual(['R1', 'p5', 'x1', 640, 7]);   // x2 is busy, x3 has 4 opens, x4 is away too
    expect(batchSql(calls, 'INSERT OR IGNORE INTO coop_boss_participants')[0].args.slice(0, 3)).toEqual(['R1', 'p5', 'x1']);
    expect(batchSql(calls, 'DELETE FROM coop_boss_participants')[0].args).toEqual(['R1', 'p5', 'x1']);
    expect(batchSql(calls, 'INTO coop_raid_swaps')[0].args.slice(0, 5)).toEqual(['R1', 'p5', 'x1', 640, 7]);
    expect(batchSql(calls, 'DELETE FROM raid_queue WHERE user_id = ?1')[0].args).toEqual(['x1', 'the_grinning_god']);
    const push = mockNotify.mock.calls.find((c) => c[1] === 'x1')!;
    expect(push[2]).toMatchObject({ title: 'Raid Party Found', type: 'coop_joined' });
    expect(String((push[2] as { body: string }).body)).toBe('The Grinning God: a raid under way needs you. 40 hours left for 200,000 steps and 200 flights, and your steps since it began count.');
  });

  it('the raid finder comes first; an away challenger hands over the challenger seat', async () => {
    const f = base();
    f.queue = ['q1'];
    f.lastSeen = { ...f.lastSeen, q1: now() - H, c1: now() - 26 * H, p5: now() - H };
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.swaps).toBe(1);
    const up = batchSql(calls, 'SET challenger_user_id = ?3');
    expect(up[0].args.slice(0, 5)).toEqual(['R1', 'c1', 'q1', 0, 0]);
    expect(batchSql(calls, 'INSERT OR IGNORE INTO coop_boss_participants').length).toBe(0);
  });

  it('nobody is swapped when everyone was in the app within 24h, when a seat was taken under a day ago, or when nobody is free', async () => {
    const fresh = base();
    fresh.lastSeen = { ...fresh.lastSeen, p5: now() - 23 * H };
    const a: Call[] = [];
    expect((await sweepCoopAutoHunts(makeEnv(sweepDb(fresh, a)), ctx)).swaps).toBe(0);
    const newSeat = base();
    newSeat.participants = seats(new Date(now() - 3 * H).toISOString());
    newSeat.raidRows = [raidRow({ starts_at: new Date(now() - 3 * H).toISOString() })];
    newSeat.lastSeen = { ...newSeat.lastSeen, c1: 0, p5: 0 };
    const b: Call[] = [];
    expect((await sweepCoopAutoHunts(makeEnv(sweepDb(newSeat, b)), ctx)).swaps).toBe(0);
    const noOne = base();
    noOne.raidLive = [...team, 'x1', 'x2'];
    const c: Call[] = [];
    expect((await sweepCoopAutoHunts(makeEnv(sweepDb(noOne, c)), ctx)).swaps).toBe(0);
    expect(batchSql(c, 'SET banked_steps').length).toBe(0);
  });

  it('W1249 — locked in: a raider away 30h with 1,000+ raid steps keeps the seat; 999 does not', async () => {
    expect(RAID_LOCK_STEPS).toBe(1000);
    const locked = base();
    locked.progress = [{ bid: 'R1', user_id: 'p5', event_type: 'steps_total', s: 1000 }];
    const a: Call[] = [];
    expect((await sweepCoopAutoHunts(makeEnv(sweepDb(locked, a)), ctx)).swaps).toBe(0);
    expect(batchSql(a, 'SET banked_steps').length).toBe(0);
    const open = base();
    open.progress = [{ bid: 'R1', user_id: 'p5', event_type: 'steps_total', s: 999 }];
    const b: Call[] = [];
    expect((await sweepCoopAutoHunts(makeEnv(sweepDb(open, b)), ctx)).swaps).toBe(1);
    expect(batchSql(b, 'SET banked_steps = banked_steps + ?4')[0].args.slice(0, 4)).toEqual(['R1', 'p5', 'x1', 999]);
  });

  it('W1250 — seen = REAL opens only: the query reads app_open_counts, and an open counted before 0078 lasts to the end of its Pacific day', async () => {
    const f = base();
    const calls: Call[] = [];
    await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    const q = calls.find((c) => c.sql.includes('AS last_seen'))!;
    expect(q.sql).toContain('FROM app_open_counts');
    expect(q.sql).toContain('opens > 0');
    expect(q.sql).not.toContain('app_opens ');
    expect(q.sql).not.toContain('user_state_snapshots');
    // p5's only open was yesterday (Pacific), time unknown → seen until yesterday's end: not 24h away yet at noon today
    const g = base();
    g.lastSeen = undefined;
    const rows = [...team.filter((u) => u !== 'p5').map((u) => ({ user_id: u, day_pt: today, last_seen: now() - H })),
      { user_id: 'p5', day_pt: prevDay(today), last_seen: null }, { user_id: 'x1', day_pt: today, last_seen: now() - H }];
    const db = sweepDb(g, []);
    const orig = db.prepare.bind(db);
    (db as unknown as { prepare: (s: string) => unknown }).prepare = (sql: string) => {
      if (!sql.includes('AS last_seen')) return orig(sql);
      const st = { all: async () => ({ results: rows, success: true, meta: {} }) };
      return { ...st, bind: () => st };
    };
    expect((await sweepCoopAutoHunts(makeEnv(db), ctx)).swaps).toBe(0);
    rows[rows.length - 2] = { user_id: 'p5', day_pt: prevDay(prevDay(today)), last_seen: null };   // two days ago → away
    expect((await sweepCoopAutoHunts(makeEnv(db), ctx)).swaps).toBe(1);
  });

  it('a hunter away 24 hours is never drawn into a new raid either', async () => {
    const ids = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'];
    const f: SweepFixture = {
      weekOpens: Object.fromEntries(ids.map((id) => [id, 8])),
      builds: Object.fromEntries(ids.map((id) => [id, NEW])),
      opened: ids,
      lastSeen: { ...Object.fromEntries(ids.map((id) => [id, now() - H])), h1: now() - 25 * H },
    };
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.raids).toBe(1);
    const made = calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_instances') && c.args[1] === 'the_grinning_god')!;
    expect(made.args[14]).toBe('h2|h3|h4|h5|h6|h7');
  });
});

// W1251 — owner 2026-11-20: "You can also send players from other teams to teams that need players for example
// zynfandel and zeruthless can be put on my team"
describe('W1251 — raid moves: a short team\'s active walkers go, together, to the raid closest to winning with room', () => {
  const H = 3_600_000;
  const now = () => Date.now();
  const none = () => false;
  const v = (id: string, over: Partial<RaidView>): RaidView => ({
    id, startsMs: now() - 40 * H, progress: 0.1, canGive: true, members: [], active: [], open: [], ...over,
  });
  // the live picture of 2026-11-20: yours 4 active (2 away seats), Zynfandel's 2 active, Burak's 3 active (3 away seats)
  const yours = v('yours', { progress: 0.14, members: ['ri', 'ni', 'sh', 'da', 'ju', 'ez'], active: ['ri', 'ni', 'sh', 'da'], open: ['ju', 'ez'] });
  const zyn = v('zyn', { progress: 0.03, members: ['rz', 'zy', 'ze', 'ki', 'hx', 'av'], active: ['zy', 'ze'], open: ['rz', 'ki', 'hx', 'av'] });
  const burak = v('burak', { progress: 0.06, members: ['pr', 'bu', 're', 'me', 'se', 'ka'], active: ['bu', 're', 'me'], open: ['pr', 'se', 'ka'] });
  const angelo = v('angelo', { progress: 0.32, members: ['te', 'an', 'ad', 'ga', 'po', 'rn'], active: ['an', 'ad', 'te', 'ga'], open: ['rn'] });

  it('the owner\'s example: Zynfandel and ZeRuthless take the two away seats on the owner\'s team', () => {
    expect(SHORT_TEAM_ACTIVE).toBe(2);
    expect(planRaidMoves([yours, zyn, burak, angelo], none)).toEqual([
      { from: 'zyn', to: 'yours', moves: [['zy', 'ju'], ['ze', 'ez']] },   // Angelo's has one open seat; Burak's is further behind
    ]);
  });

  it('a team with 3 active never gives; a raid under a day old never gives; nobody moves to a team no bigger than theirs', () => {
    expect(planRaidMoves([yours, burak], none)).toEqual([]);
    expect(planRaidMoves([yours, { ...zyn, canGive: false }], none)).toEqual([]);
    const two = v('two', { progress: 0.5, members: ['a', 'b', 'c', 'd', 'e', 'f'], active: ['a', 'b'], open: ['c', 'd', 'e', 'f'] });
    expect(planRaidMoves([two, zyn], none).filter((p) => p.to === 'two')).toEqual([]);
  });

  it('the group moves whole or not at all, never to a raid that started later, never next to someone they blocked', () => {
    expect(planRaidMoves([zyn, angelo], none)).toEqual([]);   // one open seat for two walkers
    expect(planRaidMoves([zyn, { ...yours, startsMs: now() - 10 * H }], none)).toEqual([]);
    const blk = (x: string, y: string) => (x === 'ni' && y === 'ze') || (x === 'ze' && y === 'ni');
    expect(planRaidMoves([zyn, yours, burak], blk)).toEqual([{ from: 'zyn', to: 'burak', moves: [['zy', 'pr'], ['ze', 'se']] }]);
  });

  it('fewest active gives first, and a team that just took walkers in does not give them away again', () => {
    const solo = v('solo', { progress: 0.01, members: ['s1', 'x1', 'x2', 'x3', 'x4', 'x5'], active: ['s1'], open: ['x1', 'x2', 'x3', 'x4', 'x5'] });
    // 1 active goes first, to the raid closest to winning; then Zynfandel's two no longer fit anywhere whole: they wait
    expect(planRaidMoves([zyn, solo, yours], none)).toEqual([{ from: 'solo', to: 'yours', moves: [['s1', 'ju']] }]);
    // with only Zynfandel's to take them, the solo walker goes there, and Zynfandel's (now 3 active) stays put
    expect(planRaidMoves([zyn, solo], none)).toEqual([{ from: 'solo', to: 'zyn', moves: [['s1', 'rz']] }]);
  });

  it('the sweep moves them: seats handed over in one guarded batch, steps carried, the movers told', async () => {
    const start = new Date(now() - 40 * H).toISOString();
    const end = new Date(now() + 38 * H).toISOString();
    const row = (id: string, challenger: string, over: Record<string, unknown> = {}) => ({
      id, boss_id: 'the_grinning_god', boss_rank: 'S', status: 'active', auto: 1, challenger_user_id: challenger,
      partner_user_id: null, partner2_user_id: null, starts_at: start, ends_at: end, goal_steps: 200000, goal_flights: 200,
      reward_souls: 800, banked_steps: 0, banked_flights: 0, ...over,
    });
    const seat = (instance_id: string, ids: string[]) => ids.map((user_id) => ({ instance_id, user_id, joined_at: start }));
    const away = now() - 40 * H;
    const f: SweepFixture = {
      raidRows: [row('Y', 'ri', { partner_user_id: 'ni', partner2_user_id: 'sh' }), row('Z', 'rz', { partner_user_id: 'zy', partner2_user_id: 'ze' })],
      participants: [...seat('Y', ['ni', 'sh', 'da', 'ju', 'ez']), ...seat('Z', ['zy', 'ze', 'ki', 'hx', 'av'])],
      lastSeen: { ri: now() - H, ni: now() - H, sh: now() - H, da: now() - H, zy: now() - H, ze: now() - H, ju: away, ez: away, rz: away, ki: away, hx: away, av: away },
      weekOpens: {},
      raidLive: ['ri', 'ni', 'sh', 'da', 'ju', 'ez', 'rz', 'zy', 'ze', 'ki', 'hx', 'av'],
      progress: [
        { bid: 'Y', user_id: 'ri', event_type: 'steps_total', s: 10394 },
        { bid: 'Z', user_id: 'zy', event_type: 'steps_total', s: 3924 },
        { bid: 'Z', user_id: 'zy', event_type: 'flights_total', s: 5 },
        { bid: 'Z', user_id: 'ze', event_type: 'steps_total', s: 1669 },
      ],
    };
    const calls: Call[] = [];
    const res = await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx);
    expect(res.swaps).toBe(0);   // nobody free
    expect(res.moves).toBe(2);
    const seated = calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO coop_boss_participants'));
    expect(seated.map((c) => [c.args[0], c.args[1], c.args[2]])).toEqual([['Y', 'ju', 'zy'], ['Y', 'ez', 'ze']]);
    const left = calls.filter((c) => c.sql.includes('DELETE FROM coop_boss_participants') && c.args[0] === 'Z');
    expect(left.map((c) => c.args[1])).toEqual(['zy', 'ze']);
    const legacy = calls.filter((c) => c.sql.includes('THEN challenger_user_id ELSE partner_user_id'));
    expect(legacy.map((c) => c.args.slice(0, 2))).toEqual([['Z', 'zy'], ['Z', 'ze']]);
    const carried = calls.filter((c) => c.sql.includes('INSERT OR IGNORE INTO verified_events'));
    expect(carried.map((c) => [c.args[1], c.args[2], c.args[3], c.args[5], c.args[9]])).toEqual([
      ['zy', 'Y', 'steps_total', 3924, 'raid_move:Y:steps'],
      ['zy', 'Y', 'flights_total', 5, 'raid_move:Y:flights'],
      ['ze', 'Y', 'steps_total', 1669, 'raid_move:Y:steps'],
    ]);
    expect(calls.filter((c) => c.sql.includes('INTO coop_raid_swaps')).map((c) => c.args.slice(0, 3))).toEqual([['Y', 'ju', 'zy'], ['Y', 'ez', 'ze']]);
    const push = mockNotify.mock.calls.find((c) => c[1] === 'zy')!;
    expect(push[2]).toMatchObject({ title: 'New Raid Team', type: 'coop_joined' });
    expect(String((push[2] as { body: string }).body)).toBe('The Grinning God: you joined a team that needed walkers. 38 hours left for 200,000 steps and 200 flights, and your steps came with you.');
  });

  it('a departing challenger hands the seat to a member who stays', async () => {
    const start = new Date(now() - 40 * H).toISOString();
    const end = new Date(now() + 38 * H).toISOString();
    const row = (id: string, challenger: string) => ({
      id, boss_id: 'the_grinning_god', boss_rank: 'S', status: 'active', auto: 1, challenger_user_id: challenger,
      partner_user_id: null, partner2_user_id: null, starts_at: start, ends_at: end, goal_steps: 200000, goal_flights: 200,
      reward_souls: 800, banked_steps: 0, banked_flights: 0,
    });
    const seat = (instance_id: string, ids: string[]) => ids.map((user_id) => ({ instance_id, user_id, joined_at: start }));
    const away = now() - 40 * H;
    const f: SweepFixture = {
      raidRows: [row('Y', 'ri'), row('Z', 'zy')],
      participants: [...seat('Y', ['ni', 'sh', 'da', 'ju', 'ez']), ...seat('Z', ['rz', 'ze', 'ki', 'hx', 'av'])],
      lastSeen: { ri: now() - H, ni: now() - H, sh: now() - H, da: now() - H, zy: now() - H, ze: now() - H, ju: away, ez: away, rz: away, ki: away, hx: away, av: away },
      weekOpens: {},
      raidLive: ['ri', 'ni', 'sh', 'da', 'ju', 'ez', 'rz', 'zy', 'ze', 'ki', 'hx', 'av'],
      progress: [{ bid: 'Z', user_id: 'zy', event_type: 'steps_total', s: 3924 }],
    };
    const calls: Call[] = [];
    expect((await sweepCoopAutoHunts(makeEnv(sweepDb(f, calls)), ctx)).moves).toBe(2);
    const handOver = calls.find((c) => c.sql.includes('SET challenger_user_id = ?3,') && c.args[0] === 'Z')!;
    expect(handOver.args.slice(0, 3)).toEqual(['Z', 'zy', 'rz']);   // the first member who stays (not ZeRuthless, who moves too)
  });
});
