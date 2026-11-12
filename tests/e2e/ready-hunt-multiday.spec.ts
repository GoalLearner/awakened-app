/**
 * Awakened — the Ready Hunt judges the multi-day bosses from Apple Health (W1039 "days already finished count").
 *
 * Owner 2026-11-07: "make sure the automated system is working correctly for these multiple day conditions" (The
 * Patient Flame: 10,000 steps two days back-to-back; The Tideless Marcher: 10,000 steps + 5 flights two days
 * back-to-back). Apple Health is replaced by a fixture on window.Health (the same object app.js reads), the
 * hunter is S+ so every gate is open, and window.__readyHunt.scan() is the real scan. Pinned here:
 *   - two qualifying days in a row → the Patient Flame and the Marcher are offered; the 3-day Erebus is not;
 *   - the Marcher needs BOTH numbers on BOTH days: three flights on one of them and it stays quiet (W1182: the bar is 4);
 *   - today still short → nothing yet (today is pending, never run-breaking);
 *   - a day is spent once per boss: the day of the last kill never counts again;
 *   - three qualifying days → Erebus the Shadow Sovereign is offered; one short day breaks the run;
 *   - two 7-hour nights → the Vow Keeper is offered; one short night and it is not.
 */
import { test, expect, Page } from '@playwright/test';

type Fix = { steps?: Record<string, number>; flights?: Record<string, number>; sleep?: Record<string, number>; workouts?: Record<string, number> };

// W1176 — every multi-day boss is automated now; the judge tests below switch them all off unless `auto` is set.
const AUTO = ['the_patient_flame', 'the_vow_keeper', 'the_tideless_marcher', 'the_forge_of_ten_thousand_days', 'the_sleepless_ascent',
  'erebus_the_shadow_sovereign', 'the_starved_sentinel', 'the_gray_pilgrim', 'the_worldspine'];   // W1182 — the Worldspine is a 9k × 3 run now

async function boot(page: Page, bosses?: Record<string, unknown>, points = '40000') {
  await page.addInitScript(([b, pts]: string[]) => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) { const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s); }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1',
        'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_ascent_opening_seen_v1'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_points', pts);   // S+ (40000): every gate open
      localStorage.setItem('hb_souls', JSON.stringify({ balance: 999999, totalEarned: 999999 }));   // the souls store is an object; a hunt's fee is a door on the phone list
      localStorage.setItem('hb_bosses', b);
    } catch (_) { /* noop */ }
  }, [JSON.stringify(bosses || {}), points]);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__readyHunt && !!(window as any).Health && !!document.querySelector('[data-tab="profile"]'));
}

// Replace Apple Health with the fixture (keys = local dates), then run the real scan and return the offered boss ids.
// W1167 — the Flame fell by itself first; W1176 — every multi-day boss does. These judge tests switch them off unless `auto` is set.
async function scan(page: Page, fix: Fix, auto: boolean | string = false): Promise<string[]> {   // W1187 — a boss id: that boss alone falls by itself
  return page.evaluate(async ([f, au, ids]: [Fix, boolean | string, string[]]) => {
    ids.forEach((id) => { (window as any).Bosses.BOSSES[id].autoKill = au === true || au === id; });
    const H = (window as any).Health;
    const key = (iso: string) => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const today = key(new Date().toISOString());
    // W1176 — flights add up over the days a query spans (the Gray Pilgrim asks for seven days at once); a one-day
    // query reads that day alone, as before.
    const flightsBetween = (a: string, b: string) => {
      const from = new Date(a); from.setHours(0, 0, 0, 0);
      const to = new Date(b).getTime();
      let sum = 0;
      for (const d = new Date(from); d.getTime() < to; d.setDate(d.getDate() + 1)) sum += (f.flights || {})[key(d.toISOString())] || 0;
      return sum;
    };
    H.isAvailable = () => true;
    H.permissionStatus = () => 'granted';
    H.getStepsBetween = async (a: string) => (f.steps || {})[key(a)] || 0;
    H.getFlightsClimbedBetween = async (a: string, b: string) => flightsBetween(a, b);
    H.getStepsToday = async () => (f.steps || {})[today] || 0;
    H.getFlightsClimbedToday = async () => (f.flights || {})[today] || 0;
    H.getSleepBetween = async () => { const byDate: Record<string, { totalAsleepHours: number }> = {}; Object.keys(f.sleep || {}).forEach((k) => { byDate[k] = { totalAsleepHours: (f.sleep as any)[k] }; }); return { samples: [], byDate }; };
    H.getAnyWorkoutsBetween = async (a: string) => { const m = (f.workouts || {})[key(a)] || 0; return m > 0 ? [{ duration_min: m }] : []; };
    H.getStrengthWorkoutsBetween = async () => [];
    H.getActiveEnergyBetween = async () => 0;
    const r = await (window as any).__readyHunt.scan();
    return (r.offers || []).map((o: any) => o.bossId);
  }, [fix, auto, AUTO] as [Fix, boolean | string, string[]]);
}

// local date keys for today and the days before it
const dayKey = (back: number) => { const d = new Date(); d.setDate(d.getDate() - back); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const T0 = dayKey(0), T1 = dayKey(1), T2 = dayKey(2);

test.describe('The Ready Hunt and the multi-day bosses (W1039)', () => {
  test('two 10k days with 5+ flights → the Patient Flame and the Tideless Marcher; Erebus (3 days) not yet', async ({ page }) => {
    await boot(page);
    const ids = await scan(page, { steps: { [T1]: 12000, [T0]: 10500 }, flights: { [T1]: 6, [T0]: 5 } });
    expect(ids).toContain('the_patient_flame');
    expect(ids).toContain('the_tideless_marcher');
    expect(ids).not.toContain('erebus_the_shadow_sovereign');
  });

  test('the Marcher needs both numbers on both days: three flights yesterday and it stays quiet (the Flame still comes)', async ({ page }) => {
    await boot(page);
    const ids = await scan(page, { steps: { [T1]: 12000, [T0]: 10500 }, flights: { [T1]: 3, [T0]: 9 } });   // W1182 — the Marcher's bar is 4 flights
    expect(ids).toContain('the_patient_flame');
    expect(ids).not.toContain('the_tideless_marcher');
  });

  test('today still short → nothing yet (today is pending, never run-breaking)', async ({ page }) => {
    await boot(page);
    const ids = await scan(page, { steps: { [T1]: 12000, [T0]: 3000 }, flights: { [T1]: 6, [T0]: 6 } });
    expect(ids).not.toContain('the_patient_flame');
    expect(ids).not.toContain('the_tideless_marcher');
  });

  test('a day is spent once: a Flame beaten yesterday does not come back on yesterday + today', async ({ page }) => {
    const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(18, 0, 0, 0);
    await boot(page, { the_patient_flame: { streak: 0, kill_count: 1, engaged: false, last_defeated_at: y.toISOString(), last_hunt_outcome: 'defeated' } });
    const ids = await scan(page, { steps: { [T2]: 12000, [T1]: 12000, [T0]: 12000 }, flights: { [T2]: 6, [T1]: 6, [T0]: 6 } });
    expect(ids).not.toContain('the_patient_flame');
    expect(ids).toContain('the_tideless_marcher');   // never beaten: its two days are untouched
  });

  test('three 9k + 4-flight days → Erebus the Shadow Sovereign; three flights on the middle day breaks the run (W1182)', async ({ page }) => {
    await boot(page);
    let ids = await scan(page, { steps: { [T2]: 12000, [T1]: 12000, [T0]: 12000 }, flights: { [T2]: 10, [T1]: 10, [T0]: 10 } });
    expect(ids).toContain('erebus_the_shadow_sovereign');
    ids = await scan(page, { steps: { [T2]: 12000, [T1]: 12000, [T0]: 12000 }, flights: { [T2]: 10, [T1]: 3, [T0]: 10 } });
    expect(ids).not.toContain('erebus_the_shadow_sovereign');
  });

  // W1148 — the window's day list stepped by 24 h, so on Nov 2 (the day after the clocks fell back) a three-day
  // window read [Oct 31, Nov 1, Nov 1]: Nov 1 twice, Nov 2 missing. Two qualifying days then passed for three.
  test('across the Nov 1 clock change, a three-day window still needs three real days', async ({ page }) => {
    await boot(page);
    await page.clock.install({ time: new Date('2026-11-02T20:00:00Z') });   // Nov 2, 12:00 PM PST
    const two = { steps: { '2026-10-31': 12000, '2026-11-01': 12000 }, flights: { '2026-10-31': 10, '2026-11-01': 10 } };
    expect(await scan(page, two)).not.toContain('erebus_the_shadow_sovereign');
    const three = { steps: { ...two.steps, '2026-11-02': 12000 }, flights: { ...two.flights, '2026-11-02': 10 } };
    expect(await scan(page, three)).toContain('erebus_the_shadow_sovereign');
    // one qualifying Nov 1 must never pass for the Flame's two days (the old 24 h step read it twice). W1176: Oct 31 +
    // Nov 1 is a real finished run now, and it does count.
    expect(await scan(page, { steps: { '2026-11-01': 12000 } })).not.toContain('the_patient_flame');
    expect(await scan(page, two)).toContain('the_patient_flame');
  });

  // W1149 — what the phone watcher is handed for the multi-day bosses (window.__readyHunt.watch() after a scan)
  const watchOf = (page: Page) => page.evaluate(() => (window as any).__readyHunt.watch().hunts.filter((h: any) => h.day).map((h: any) => ({ id: h.id, metric: h.metric, bar: h.bar, day: h.day, also: h.also })));
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

  test('the phone list: yesterday qualified → the Flame on steps today; the Marcher once per metric, each naming the other', async ({ page }) => {
    await boot(page);
    await scan(page, { steps: { [T1]: 12000, [T0]: 3000 }, flights: { [T1]: 6, [T0]: 1 } });
    const w = await watchOf(page);
    expect(w).toContainEqual({ id: 'the_patient_flame', metric: 'steps', bar: 5000, day: T0, also: [] });   // W1189 ladder (B 5,000)
    expect(w).toContainEqual({ id: 'the_tideless_marcher', metric: 'steps', bar: 6000, day: T0, also: [{ metric: 'flights', bar: 4 }] });
    expect(w).toContainEqual({ id: 'the_tideless_marcher', metric: 'flights', bar: 4, day: T0, also: [{ metric: 'steps', bar: 6000 }] });
    expect(w.filter((h: any) => h.id === 'erebus_the_shadow_sovereign')).toHaveLength(0);   // needs two earlier days
    expect(w.filter((h: any) => h.day === tomorrow)).toHaveLength(0);                       // today is not done yet
  });

  test('the phone list: today already qualifies → an entry for tomorrow; a Flame beaten yesterday gets none for today', async ({ page }) => {
    const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(18, 0, 0, 0);
    await boot(page, { the_patient_flame: { streak: 0, kill_count: 1, engaged: false, last_defeated_at: y.toISOString(), last_hunt_outcome: 'defeated' } });
    await scan(page, { steps: { [T2]: 12000, [T1]: 12000, [T0]: 12000 }, flights: { [T2]: 10, [T1]: 10, [T0]: 10 } });
    const w = await watchOf(page);
    const flame = w.filter((h: any) => h.id === 'the_patient_flame');
    expect(flame).toEqual([{ id: 'the_patient_flame', metric: 'steps', bar: 5000, day: tomorrow, also: [] }]);
    expect(w).toContainEqual({ id: 'erebus_the_shadow_sovereign', metric: 'steps', bar: 7000, day: tomorrow, also: [{ metric: 'flights', bar: 4 }] });
  });

  test('the phone list: last night qualified → the Vow Keeper on sleep today; only tonight qualified → tomorrow', async ({ page }) => {
    await boot(page);
    await scan(page, { sleep: { [T1]: 7.47, [T0]: 5 } });
    expect(await watchOf(page)).toContainEqual({ id: 'the_vow_keeper', metric: 'sleep', bar: 7, day: T0, also: [] });
    await scan(page, { sleep: { [T1]: 5, [T0]: 7.47 } });
    const w = await watchOf(page).then((l) => l.filter((h: any) => h.id === 'the_vow_keeper'));
    expect(w).toEqual([{ id: 'the_vow_keeper', metric: 'sleep', bar: 7, day: tomorrow, also: [] }]);
  });

  test('two 7-hour nights → the Vow Keeper; one short night and it is not offered', async ({ page }) => {
    await boot(page);
    let ids = await scan(page, { sleep: { [T1]: 7.47, [T0]: 7.47 } });
    expect(ids).toContain('the_vow_keeper');
    expect(ids).toContain('the_dream_tyrant');       // W1182 — the Dream Tyrant's bar is 7 h now too (was 7.5)
    ids = await scan(page, { sleep: { [T1]: 7.47, [T0]: 6.5 } });
    expect(ids).not.toContain('the_vow_keeper');
  });

  // W1167 — owner 2026-11-08: "I want to make sure that this boss is automated for all B hunters."
  // Two 10,000-step days in a row and the Patient Flame falls on its own: no sheet, no tap, its own
  // result screen, and the 200-soul entrance fee taken out of the 400-soul win once it is confirmed.
  const flame = (page: Page) => page.evaluate(() => (window as any).Bosses.getBossState('the_patient_flame'));
  test('W1167: two 10k days in a row → the Patient Flame falls by itself, the fee comes out of the win', async ({ page }) => {
    await boot(page);
    await scan(page, { steps: { [T1]: 12000, [T0]: 10500 } }, true);
    await expect.poll(() => flame(page).then((s: any) => s.kill_count || 0), { timeout: 8000 }).toBe(1);
    const st = await flame(page);
    expect(st.engaged).toBe(false);
    expect(await page.evaluate(() => (window as any).__readyHunt.offers())).not.toContain('the_patient_flame');   // never offered for a tap
    const fee = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_souls_ledger') || '[]').filter((e: any) => e.delta === -200).length);
    expect(fee).toBe(1);
    await expect(page.locator('#boss-result-overlay .hr-boss')).toHaveText('The Patient Flame', { timeout: 8000 });
    // the same two days never pay twice
    await scan(page, { steps: { [T1]: 12000, [T0]: 10500 } }, true);
    await page.waitForTimeout(800);
    expect((await flame(page)).kill_count).toBe(1);
  });

  test('W1167: today still short, or a hunter below B → the Flame stands', async ({ page }) => {
    await boot(page);
    await scan(page, { steps: { [T1]: 12000, [T0]: 4900 } }, true);   // W1189 — the Flame's bar is 5,000
    await page.waitForTimeout(800);
    expect((await flame(page)).kill_count || 0).toBe(0);
    await page.evaluate(() => { localStorage.setItem('hb_points', '0'); });
    await boot(page, {}, '0');   // E rank: the B gate is shut
    await scan(page, { steps: { [T1]: 12000, [T0]: 10500 } }, true);
    await page.waitForTimeout(800);
    expect((await flame(page)).kill_count || 0).toBe(0);
  });

  // W1176 — owner 2026-11-09: "the multiple day automatic hunts ... whether it be 2-days or 3-days+, if they fulfill
  // the condition then they get the reward ... whether be sleep, walking, or flights". Every multi-day boss is
  // automatic now, and a run that finished on an earlier day still pays when the app is opened later.
  const kills = (page: Page, ids: string[]) => page.evaluate((l: string[]) => l.map((id) => (window as any).Bosses.getBossState(id).kill_count || 0), ids);
  const days = (n: number, v: number) => { const o: Record<string, number> = {}; for (let i = 0; i < n; i++) o[dayKey(i)] = v; return o; };
  const fees = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hb_souls_ledger') || '[]').filter((e: any) => typeof e.delta === 'number' && e.delta < 0).length);

  test('W1176: every multi-day boss falls by itself — steps, sleep, stairs and workouts; two days, three, and seven', async ({ page }) => {
    await boot(page);
    const fix = { steps: days(3, 12000), flights: days(7, 10), sleep: days(3, 7.5), workouts: days(3, 45) };
    const offered = await scan(page, fix, true);
    expect(offered).toEqual(expect.arrayContaining(AUTO));   // the judge saw every one of them...
    await expect.poll(() => kills(page, AUTO), { timeout: 30_000 }).toEqual(AUTO.map(() => 1));   // ...and nobody had to tap
    expect((await page.evaluate(() => (window as any).__readyHunt.offers())).filter((id: string) => AUTO.indexOf(id) >= 0)).toEqual([]);
    // one entrance fee each, out of the win; the same days never pay twice
    expect(await fees(page)).toBe(AUTO.length);
    await scan(page, fix, true);
    await page.waitForTimeout(1500);
    expect(await kills(page, AUTO)).toEqual(AUTO.map(() => 1));
  });

  test('W1176: a run finished days ago still pays when the app opens later — once, credited to the run’s own day', async ({ page }) => {
    await boot(page);
    const T3 = dayKey(3), T4 = dayKey(4);
    const fix = { steps: { [T4]: 12000, [T3]: 11000 }, sleep: { [T4]: 7.2, [T3]: 7.9 } };   // nothing since: the app stayed shut
    await scan(page, fix, true);
    await expect.poll(() => kills(page, ['the_patient_flame', 'the_vow_keeper']), { timeout: 15_000 }).toEqual([1, 1]);
    const claimed = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^hb_kill_reward_(the_patient_flame|the_vow_keeper)_/.test(k)).sort());
    expect(claimed).toEqual(['hb_kill_reward_the_patient_flame_' + T3, 'hb_kill_reward_the_vow_keeper_' + T3]);
    expect(await fees(page)).toBe(2);
    await scan(page, fix, true);
    await page.waitForTimeout(1500);
    expect(await kills(page, ['the_patient_flame', 'the_vow_keeper'])).toEqual([1, 1]);
  });

  test('W1176: the look-back has limits — a run older than a week, or one before the last kill, does not pay', async ({ page }) => {
    await boot(page);
    await scan(page, { steps: { [dayKey(8)]: 12000, [dayKey(7)]: 12000 } }, true);   // its first day is past the look-back
    await page.waitForTimeout(1500);
    expect((await flame(page)).kill_count || 0).toBe(0);
    const k = new Date(); k.setDate(k.getDate() - 2); k.setHours(18, 0, 0, 0);
    await boot(page, { the_patient_flame: { streak: 0, kill_count: 1, engaged: false, last_defeated_at: k.toISOString(), last_hunt_outcome: 'defeated' } });
    await scan(page, { steps: { [dayKey(4)]: 12000, [dayKey(3)]: 12000 } }, true);   // spent: before the last kill
    await page.waitForTimeout(1500);
    expect((await flame(page)).kill_count).toBe(1);
  });

  test('W1176: the Gray Pilgrim counts seven days of stairs — 41 and it stands, 42 and it falls (W1182)', async ({ page }) => {
    await boot(page);
    await scan(page, { flights: { ...days(6, 6), [dayKey(6)]: 5 } }, true);   // 6 × 6 + 5 = 41
    await page.waitForTimeout(1500);
    expect(await kills(page, ['the_gray_pilgrim'])).toEqual([0]);
    await scan(page, { flights: { ...days(6, 6), [dayKey(6)]: 6 } }, true);   // 42
    await expect.poll(() => kills(page, ['the_gray_pilgrim']), { timeout: 10_000 }).toEqual([1]);
  });
});

// W1187 — owner 2026-11-11: "I want to make sure that the automations works for all the multi day bosses from S-tier
// down... Test and make sure that all automations work over the 2-3 day long bosses". Each boss ALONE (the others wait
// for a tap), at its exact W1186 bar, so a pass proves the numbers the hunter reads are the numbers that pay:
//   - the bar on every day of the run → it falls by itself, its own result screen, its reward claimed once, one
//     entrance fee out of the win, and the same days never pay twice;
//   - one day short anywhere in the run, on either condition, by the smallest step (1 step, 1 flight, 1 minute of
//     workout, 6 minutes of sleep) → it stands;
//   - a run that ends today falls the moment today reaches the bar;
//   - a run that ended two days ago still pays on the next open, credited to its own last day;
//   - the rank lock: an A hunter's runs drop the A and B bosses but no S one; a B hunter only the B ones.
type Bar = { steps?: number; flights?: number; sleep?: number; workouts?: number };
type MD = { id: string; name: string; rank: string; n: number; bar: Bar };
const MD_BOSSES: MD[] = [
  { id: 'erebus_the_shadow_sovereign', name: 'Erebus, the Shadow Sovereign', rank: 'S', n: 3, bar: { steps: 7000, flights: 4 } },   // W1189
  { id: 'the_worldspine', name: 'The Worldspine', rank: 'S', n: 3, bar: { steps: 7000 } },
  { id: 'the_starved_sentinel', name: 'The Starved Sentinel', rank: 'S', n: 3, bar: { steps: 2000, sleep: 6.5 } },
  { id: 'the_tideless_marcher', name: 'The Tideless Marcher', rank: 'A', n: 2, bar: { steps: 6000, flights: 4 } },
  { id: 'the_sleepless_ascent', name: 'The Sleepless Ascent', rank: 'A', n: 2, bar: { workouts: 20, sleep: 7 } },
  { id: 'the_patient_flame', name: 'The Patient Flame', rank: 'B', n: 2, bar: { steps: 5000 } },
  { id: 'the_vow_keeper', name: 'The Vow Keeper', rank: 'B', n: 2, bar: { sleep: 7 } },
  { id: 'the_forge_of_ten_thousand_days', name: 'The Forge of Ten Thousand Days', rank: 'B', n: 2, bar: { workouts: 20 } },
];
const UNDER: Required<Bar> = { steps: 1, flights: 1, sleep: 0.1, workouts: 1 };
// the bar on each of the run's n days, ending `end` days ago; `short` takes one condition down on one day
function runOf(b: MD, end = 0, short?: { metric: keyof Bar; back: number }): Fix {
  const f: any = {};
  (Object.keys(b.bar) as (keyof Bar)[]).forEach((m) => {
    f[m] = {};
    for (let i = end; i < end + b.n; i++) f[m][dayKey(i)] = (b.bar[m] as number) - (short && short.metric === m && short.back === i ? UNDER[m] : 0);
  });
  return f;
}
const killOf = (page: Page, id: string) => page.evaluate((i: string) => (window as any).Bosses.getBossState(i).kill_count || 0, id);
const rewardKeysOf = (page: Page, id: string) => page.evaluate((i: string) => Object.keys(localStorage).filter((k) => k.indexOf('hb_kill_reward_' + i + '_') === 0).sort(), id);
const feesPaid = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hb_souls_ledger') || '[]').filter((e: any) => typeof e.delta === 'number' && e.delta < 0).length);
const barText = (b: MD) => (Object.keys(b.bar) as (keyof Bar)[]).map((m) => m + ' ' + b.bar[m]).join(' + ');

test.describe('W1187 — every multi-day boss falls by itself at its exact bar, S down to B', () => {
  for (const b of MD_BOSSES) {
    test(`${b.rank} · ${b.name}: ${barText(b)} on ${b.n} days in a row → falls by itself, once, one fee`, async ({ page }) => {
      await boot(page);
      await scan(page, runOf(b), b.id);
      await expect.poll(() => killOf(page, b.id), { timeout: 15_000 }).toBe(1);
      await expect(page.locator('#boss-result-overlay .hr-boss')).toHaveText(b.name, { timeout: 8000 });
      expect(await rewardKeysOf(page, b.id)).toEqual(['hb_kill_reward_' + b.id + '_' + T0]);
      expect(await feesPaid(page)).toBe(1);
      expect(await page.evaluate(() => (window as any).__readyHunt.offers())).not.toContain(b.id);   // never offered for a tap
      await scan(page, runOf(b), b.id);   // the same days again
      await page.waitForTimeout(1200);
      expect(await killOf(page, b.id)).toBe(1);
      expect(await feesPaid(page)).toBe(1);
    });

    test(`${b.rank} · ${b.name}: one day short anywhere, on any condition, and it stands`, async ({ page }) => {
      await boot(page);
      for (const m of Object.keys(b.bar) as (keyof Bar)[]) {
        for (let back = 0; back < b.n; back++) {
          await scan(page, runOf(b, 0, { metric: m, back }), b.id);
          await page.waitForTimeout(900);
          expect(await killOf(page, b.id), m + ' short ' + back + ' day(s) ago').toBe(0);
        }
      }
      expect(await feesPaid(page)).toBe(0);
    });

    test(`${b.rank} · ${b.name}: a run ending today falls the moment today reaches the bar`, async ({ page }) => {
      await boot(page);
      const first = Object.keys(b.bar)[0] as keyof Bar;
      await scan(page, runOf(b, 0, { metric: first, back: 0 }), b.id);   // earlier days done, today not yet
      await page.waitForTimeout(900);
      expect(await killOf(page, b.id)).toBe(0);
      await scan(page, runOf(b), b.id);   // today gets there
      await expect.poll(() => killOf(page, b.id), { timeout: 15_000 }).toBe(1);
    });

    test(`${b.rank} · ${b.name}: a run that ended two days ago pays on the next open, credited to its own last day`, async ({ page }) => {
      await boot(page);
      await scan(page, runOf(b, 2), b.id);   // nothing since: the app stayed shut
      await expect.poll(() => killOf(page, b.id), { timeout: 15_000 }).toBe(1);
      expect(await rewardKeysOf(page, b.id)).toEqual(['hb_kill_reward_' + b.id + '_' + dayKey(2)]);
      expect(await feesPaid(page)).toBe(1);
    });
  }

  // every run at once, at the bars, three days long (the two-day bosses read the last two)
  const ALL: Fix = { steps: days3(7000), flights: days3(4), sleep: days3(7), workouts: days3(20) };
  function days3(v: number) { const o: Record<string, number> = {}; for (let i = 0; i < 3; i++) o[dayKey(i)] = v; return o; }
  const byRank = (r: string) => MD_BOSSES.filter((x) => x.rank === r).map((x) => x.id);

  test('the rank lock: an A hunter\'s runs drop every A and B boss and no S one', async ({ page }) => {
    await boot(page, {}, '7000');   // A rank
    await scan(page, ALL, true);
    const ab = byRank('A').concat(byRank('B'));
    await expect.poll(() => Promise.all(ab.map((id) => killOf(page, id))), { timeout: 30_000 }).toEqual(ab.map(() => 1));
    await page.waitForTimeout(1200);
    expect(await Promise.all(byRank('S').map((id) => killOf(page, id)))).toEqual([0, 0, 0]);
  });

  test('the rank lock: a B hunter\'s runs drop the B bosses only', async ({ page }) => {
    await boot(page, {}, '3000');   // B rank
    await scan(page, ALL, true);
    await expect.poll(() => Promise.all(byRank('B').map((id) => killOf(page, id))), { timeout: 30_000 }).toEqual([1, 1, 1]);
    await page.waitForTimeout(1200);
    expect(await Promise.all(byRank('S').concat(byRank('A')).map((id) => killOf(page, id)))).toEqual([0, 0, 0, 0, 0]);
  });

  test('an S hunter\'s runs, all at the bars at once: all eight fall by themselves, one fee each', async ({ page }) => {
    await boot(page, {}, '12000');   // S rank
    await scan(page, ALL, true);
    const ids = MD_BOSSES.map((x) => x.id);
    await expect.poll(() => Promise.all(ids.map((id) => killOf(page, id))), { timeout: 40_000 }).toEqual(ids.map(() => 1));
    expect(await feesPaid(page)).toBe(ids.length);
  });
});

// W1190 — owner 2026-11-11: "For consecutive day challenges and other dungeons that have additional criteria, end them
// early in case the player fails one criteria ... rather than have them engaged for 3 days, wasting time." An ENGAGED
// multi-day hunt ends the moment a missed day leaves no room for a full run in its window: its HUNT FAILED screen says
// which day came up short and on what, and "Hunt again" starts a fresh run that counts today. A hunt that can still be
// won keeps going, and today (still accruing) never ends one.
test.describe('W1190 — a multi-day hunt that can no longer be won ends early', () => {
  // an engaged hunt that began `back` days ago at `hour`:00, its window = the boss's huntWindowDays
  const engagedAt = (back: number, hour: number, min = 0) => { const d = new Date(); d.setDate(d.getDate() - back); d.setHours(hour, min, 0, 0); return d.getTime(); };
  async function engage(page: Page, id: string, back: number, hour: number, min = 0) {
    const start = engagedAt(back, hour, min);
    await boot(page, {}, '40000');
    await page.evaluate(([i, s]: [string, number]) => {
      const cfg = (window as any).Bosses.BOSSES[i];
      const all = JSON.parse(localStorage.getItem('hb_bosses') || '{}');
      all[i] = { engaged: true, engaged_at: new Date(s).toISOString(), hunt_started_at: s, hunt_expires_at: s + cfg.huntWindowDays * 86400000, kill_count: 0, streak: 0 };
      localStorage.setItem('hb_bosses', JSON.stringify(all));
    }, [id, start] as [string, number]);
  }
  const resolve = async (page: Page, fix: Fix) => { await scan(page, fix, false); await page.evaluate(() => (window as any).resolveBossHuntsAcrossWindow()); };
  const st = (page: Page, id: string) => page.evaluate((i: string) => (window as any).Bosses.getBossState(i), id);
  // the test's days also make one-day bosses ready: put that sheet away so the HUNT FAILED screen can take the stage
  const clearStage = (page: Page) => page.evaluate(() => { const b = document.querySelector('#rh-sheet [data-rh-close]') as HTMLElement; if (b) b.click(); });

  test('the Worldspine, engaged 8 AM two days ago: day 1 short of 7,000 → it ends now, says so, and Hunt again counts today', async ({ page }) => {
    await engage(page, 'the_worldspine', 2, 8);   // the window ends 8 AM tomorrow: day 4 is too short to count
    await resolve(page, { steps: { [dayKey(2)]: 6999, [dayKey(1)]: 9000, [dayKey(0)]: 9000 } });
    const s = await st(page, 'the_worldspine');
    expect(s.engaged).toBe(false);
    expect(s.last_hunt_outcome).toBe('expired');
    expect(s.last_hunt_broke).toEqual({ day: 1, need: 3, miss: 'steps' });
    await clearStage(page);
    const ov = page.locator('#boss-result-overlay');
    await expect(ov.locator('.hr-sub')).toHaveText('Day 1 came up short on steps. The run ended early.', { timeout: 8000 });
    await expect(ov.locator('.hr-mood')).toHaveText('Hunt again, and today counts.');
  });

  test('a hunt that can still be won keeps going: engaged 9 PM yesterday, a short first day leaves three full days', async ({ page }) => {
    await engage(page, 'the_worldspine', 1, 21);   // the window ends 9 PM in two days: today, tomorrow and that day still fit
    await resolve(page, { steps: { [dayKey(1)]: 500, [dayKey(0)]: 1200 } });
    const s = await st(page, 'the_worldspine');
    expect(s.engaged).toBe(true);
    expect(s.last_hunt_broke == null).toBe(true);
  });

  test('today never ends a hunt: still short this afternoon, the run is alive', async ({ page }) => {
    await engage(page, 'the_patient_flame', 0, 8);
    await resolve(page, { steps: { [dayKey(0)]: 100 } });
    expect((await st(page, 'the_patient_flame')).engaged).toBe(true);
  });

  test('the Hunting row says where a multi-day run stands: "1 / 2 days · …steps"', async ({ page }) => {
    await engage(page, 'the_patient_flame', 1, 8);
    await resolve(page, { steps: { [dayKey(1)]: 5400, [dayKey(0)]: 1200 } });
    expect((await st(page, 'the_patient_flame')).engaged).toBe(true);
    expect((await page.evaluate(() => (window as any).__huntSoloProgress('the_patient_flame'))).line).toMatch(/^1 \/ 2 days · [\d,]+ \/ 5,000 steps$/);
    expect((await page.evaluate(() => (window as any).__huntSoloProgress('the_steel_wolf'))).line).toMatch(/^[\d,]+ \/ 2,000 steps$/);   // a one-day boss reads as before
  });

  test('more than one condition: Erebus with 9,000 steps but 2 flights on day 2 → it ends, naming the stairs', async ({ page }) => {
    await engage(page, 'erebus_the_shadow_sovereign', 2, 8);
    await resolve(page, { steps: { [dayKey(2)]: 9000, [dayKey(1)]: 9000, [dayKey(0)]: 9000 }, flights: { [dayKey(2)]: 5, [dayKey(1)]: 2, [dayKey(0)]: 6 } });
    const s = await st(page, 'erebus_the_shadow_sovereign');
    expect(s.engaged).toBe(false);
    expect(s.last_hunt_broke).toEqual({ day: 2, need: 3, miss: 'stairs' });
    await clearStage(page);
    await expect(page.locator('#boss-result-overlay .hr-sub')).toHaveText('Day 2 came up short on stairs. The run ended early.', { timeout: 8000 });
  });

  test('sleep: the Vow Keeper, two short nights in a row → it ends on the second morning; one short night does not', async ({ page }) => {
    await engage(page, 'the_vow_keeper', 1, 10);   // nights keyed yesterday and today, and tomorrow's still to come
    await resolve(page, { sleep: { [dayKey(1)]: 5 } });
    expect((await st(page, 'the_vow_keeper')).engaged).toBe(true);   // tonight and tomorrow morning still make two
    await engage(page, 'the_vow_keeper', 2, 23, 59);   // ends 11:59 PM today, so it is still running
    await resolve(page, { sleep: { [dayKey(2)]: 7.5, [dayKey(1)]: 5 } });
    const s = await st(page, 'the_vow_keeper');
    expect(s.engaged).toBe(false);
    expect(s.last_hunt_broke).toEqual({ day: 2, need: 2, miss: 'sleep' });
  });

  test('a run that already qualified is never ended: two good days for the Flame win it instead', async ({ page }) => {
    await engage(page, 'the_patient_flame', 1, 8);
    await resolve(page, { steps: { [dayKey(1)]: 5200, [dayKey(0)]: 5100 } });
    const s = await st(page, 'the_patient_flame');
    expect(s.kill_count).toBe(1);
    expect(s.last_hunt_broke == null).toBe(true);
  });

  test('the judge alone: every boss with a run, every window shape', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(([d0, d1, d2]: string[]) => {
      const J = (window as any).__bossRunBroken, now = Date.now();
      const at = (back: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() - back); d.setHours(hour, 0, 0, 0); return d.getTime(); };
      const mid = (back: number) => at(back, 0);
      const run = (need: number, days: string[], flags: boolean[], nights?: boolean) => ({ need, days, flags, misses: flags.map((f) => f ? null : 'steps'), nights: !!nights });
      return {
        // 3-day, engaged 8 AM two days ago, day 1 missed → broken
        a: J(run(3, [d2, d1, d0], [false, true, true]), mid(2), at(2, 8) + 3 * 86400000, now),
        // the same at 9 PM: day 4 counts, so days 2-4 still fit
        b: J(run(3, [d2, d1, d0], [false, true, true]), mid(2), at(2, 21) + 3 * 86400000, now),
        // nothing missed yet → never ended, even if the window is short
        c: J(run(3, [d0], [false]), mid(0), at(0, 8) + 3 * 86400000, now),
        // 2-day, engaged 8 AM yesterday, yesterday missed → broken (day 3 is under half a day)
        d: J(run(2, [d1, d0], [false, false]), mid(1), at(1, 8) + 2 * 86400000, now),
        // a sleep run keeps its last morning: engaged 8 AM yesterday, last night short (keyed yesterday) → still alive
        e: J(run(2, [d1, d0], [false, false], true), mid(1), at(1, 8) + 2 * 86400000, now),
      };
    }, [dayKey(0), dayKey(1), dayKey(2)]);
    expect(r.a).toEqual({ day: 1, need: 3, miss: 'steps' });
    expect(r.b).toBeNull();
    expect(r.c).toBeNull();
    expect(r.d).toEqual({ day: 1, need: 2, miss: 'steps' });
    expect(r.e).toBeNull();
  });
});
