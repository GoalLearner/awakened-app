/**
 * Awakened — the Ready Hunt judges the multi-day bosses from Apple Health (W1039 "days already finished count").
 *
 * Owner 2026-11-07: "make sure the automated system is working correctly for these multiple day conditions" (The
 * Patient Flame: 10,000 steps two days back-to-back; The Tideless Marcher: 10,000 steps + 5 flights two days
 * back-to-back). Apple Health is replaced by a fixture on window.Health (the same object app.js reads), the
 * hunter is S+ so every gate is open, and window.__readyHunt.scan() is the real scan. Pinned here:
 *   - two qualifying days in a row → the Patient Flame and the Marcher are offered; the 3-day Erebus is not;
 *   - the Marcher needs BOTH numbers on BOTH days: four flights on one of them and it stays quiet;
 *   - today still short → nothing yet (today is pending, never run-breaking);
 *   - a day is spent once per boss: the day of the last kill never counts again;
 *   - three qualifying days → Erebus the Shadow Sovereign is offered; one short day breaks the run;
 *   - two 7-hour nights → the Vow Keeper is offered; one short night and it is not.
 */
import { test, expect, Page } from '@playwright/test';

type Fix = { steps?: Record<string, number>; flights?: Record<string, number>; sleep?: Record<string, number> };

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
// W1167 — the Flame now falls by itself (autoKill); these judge tests switch that off unless `auto` is set.
async function scan(page: Page, fix: Fix, auto = false): Promise<string[]> {
  return page.evaluate(async ([f, au]: [Fix, boolean]) => {
    (window as any).Bosses.BOSSES.the_patient_flame.autoKill = au;
    const H = (window as any).Health;
    const key = (iso: string) => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const today = key(new Date().toISOString());
    H.isAvailable = () => true;
    H.permissionStatus = () => 'granted';
    H.getStepsBetween = async (a: string) => (f.steps || {})[key(a)] || 0;
    H.getFlightsClimbedBetween = async (a: string) => (f.flights || {})[key(a)] || 0;
    H.getStepsToday = async () => (f.steps || {})[today] || 0;
    H.getFlightsClimbedToday = async () => (f.flights || {})[today] || 0;
    H.getSleepBetween = async () => { const byDate: Record<string, { totalAsleepHours: number }> = {}; Object.keys(f.sleep || {}).forEach((k) => { byDate[k] = { totalAsleepHours: (f.sleep as any)[k] }; }); return { samples: [], byDate }; };
    H.getAnyWorkoutsBetween = async () => [];
    H.getStrengthWorkoutsBetween = async () => [];
    H.getActiveEnergyBetween = async () => 0;
    const r = await (window as any).__readyHunt.scan();
    return (r.offers || []).map((o: any) => o.bossId);
  }, [fix, auto] as [Fix, boolean]);
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

  test('the Marcher needs both numbers on both days: four flights yesterday and it stays quiet (the Flame still comes)', async ({ page }) => {
    await boot(page);
    const ids = await scan(page, { steps: { [T1]: 12000, [T0]: 10500 }, flights: { [T1]: 4, [T0]: 9 } });
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

  test('three 10k + 10-flight days → Erebus the Shadow Sovereign; nine flights on the middle day breaks the run', async ({ page }) => {
    await boot(page);
    let ids = await scan(page, { steps: { [T2]: 12000, [T1]: 12000, [T0]: 12000 }, flights: { [T2]: 10, [T1]: 10, [T0]: 10 } });
    expect(ids).toContain('erebus_the_shadow_sovereign');
    ids = await scan(page, { steps: { [T2]: 12000, [T1]: 12000, [T0]: 12000 }, flights: { [T2]: 10, [T1]: 9, [T0]: 10 } });
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
    // the Flame's two days are Nov 1 + Nov 2: Oct 31 + Nov 1 alone must not pass for them
    expect(await scan(page, two)).not.toContain('the_patient_flame');
  });

  // W1149 — what the phone watcher is handed for the multi-day bosses (window.__readyHunt.watch() after a scan)
  const watchOf = (page: Page) => page.evaluate(() => (window as any).__readyHunt.watch().hunts.filter((h: any) => h.day).map((h: any) => ({ id: h.id, metric: h.metric, bar: h.bar, day: h.day, also: h.also })));
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

  test('the phone list: yesterday qualified → the Flame on steps today; the Marcher once per metric, each naming the other', async ({ page }) => {
    await boot(page);
    await scan(page, { steps: { [T1]: 12000, [T0]: 3000 }, flights: { [T1]: 6, [T0]: 1 } });
    const w = await watchOf(page);
    expect(w).toContainEqual({ id: 'the_patient_flame', metric: 'steps', bar: 10000, day: T0, also: [] });
    expect(w).toContainEqual({ id: 'the_tideless_marcher', metric: 'steps', bar: 10000, day: T0, also: [{ metric: 'flights', bar: 5 }] });
    expect(w).toContainEqual({ id: 'the_tideless_marcher', metric: 'flights', bar: 5, day: T0, also: [{ metric: 'steps', bar: 10000 }] });
    expect(w.filter((h: any) => h.id === 'erebus_the_shadow_sovereign')).toHaveLength(0);   // needs two earlier days
    expect(w.filter((h: any) => h.day === tomorrow)).toHaveLength(0);                       // today is not done yet
  });

  test('the phone list: today already qualifies → an entry for tomorrow; a Flame beaten yesterday gets none for today', async ({ page }) => {
    const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(18, 0, 0, 0);
    await boot(page, { the_patient_flame: { streak: 0, kill_count: 1, engaged: false, last_defeated_at: y.toISOString(), last_hunt_outcome: 'defeated' } });
    await scan(page, { steps: { [T2]: 12000, [T1]: 12000, [T0]: 12000 }, flights: { [T2]: 10, [T1]: 10, [T0]: 10 } });
    const w = await watchOf(page);
    const flame = w.filter((h: any) => h.id === 'the_patient_flame');
    expect(flame).toEqual([{ id: 'the_patient_flame', metric: 'steps', bar: 10000, day: tomorrow, also: [] }]);
    expect(w).toContainEqual({ id: 'erebus_the_shadow_sovereign', metric: 'steps', bar: 10000, day: tomorrow, also: [{ metric: 'flights', bar: 10 }] });
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
    expect(ids).not.toContain('the_dream_tyrant');   // 7.5 last night: 7.47 is short
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
    await scan(page, { steps: { [T1]: 12000, [T0]: 9900 } }, true);
    await page.waitForTimeout(800);
    expect((await flame(page)).kill_count || 0).toBe(0);
    await page.evaluate(() => { localStorage.setItem('hb_points', '0'); });
    await boot(page, {}, '0');   // E rank: the B gate is shut
    await scan(page, { steps: { [T1]: 12000, [T0]: 10500 } }, true);
    await page.waitForTimeout(800);
    expect((await flame(page)).kill_count || 0).toBe(0);
  });
});
