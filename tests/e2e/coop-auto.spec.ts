/**
 * Awakened — automatic friend hunts (W1094), client side.
 *
 * The server makes one hunt a day per friend pair and settles it. These specs drive the real
 * co-op loop (_coopBackgroundSync, the dashboard, Pact Flames) against a stubbed hunt list and
 * pin what changes for an automatic hunt:
 *   - a loss is quiet (no defeat screen), a manual loss still shows one;
 *   - a free hunter pays the entrance fee FROM the win; one who cannot cover it earns nothing;
 *     a member pays nothing;
 *   - the local pact flame waits until both hunters posted (`committed`);
 *   - the phone never resolves an automatic hunt (the server does);
 *   - the dashboard marks it DAILY and its sheet has no LEAVE;
 *   - Pact Flames carries the per-friend switch and the everything switch.
 *
 * Auth is stubbed through a setter trap on window.Auth (auth.js assigns it once), so the app's
 * own boot sees the fixture from the first call.
 */
import { test, expect, Page } from '@playwright/test';

interface Fx {
  member?: boolean;
  souls?: number;
  instances: Record<string, unknown>[];
  autoOff?: string[];
}

const H = 3_600_000;

function inst(o: {
  id: string; status: string; result?: string | null; auto?: boolean; committed?: boolean;
  boss?: string; rank?: string; goal?: number; mine?: number; theirs?: number;
  award?: { owed: boolean; claimed: boolean };
}): Record<string, unknown> {
  const now = Date.now();
  const live = o.status === 'active';
  const mine = o.mine ?? 3000;
  const theirs = o.theirs ?? 9000;
  return {
    id: o.id,
    boss_id: o.boss ?? 'the_twin_maw',
    boss_rank: o.rank ?? 'E',
    metric: 'steps',
    status: o.status,
    result: o.result ?? null,
    role: 'challenger',
    auto: !!o.auto,
    ...(o.auto ? { hunt_day: '2026-10-25', committed: !!o.committed } : {}),
    ...(o.award ? { award: o.award } : {}),
    goal_steps: o.goal ?? 14000,
    reward_souls: 25,
    party_size: 2,
    party: [
      { user_id: 'me', alias: 'richie', role: 'challenger', steps: mine, joined: true },
      { user_id: 'f1', alias: 'anthony', role: 'ally', steps: theirs, joined: true },
    ],
    combined_steps: mine + theirs,
    challenger: { user_id: 'me', alias: 'richie', steps: mine },
    partner: { user_id: 'f1', alias: 'anthony', steps: theirs },
    starts_at: new Date(now - 6 * H).toISOString(),
    ends_at: new Date(now + (live ? 18 : -1) * H).toISOString(),
    time_remaining_ms: live ? 18 * H : null,
    resolved_at: live ? null : new Date(now - 0.5 * H).toISOString(),
    created_at: '2026-10-25 07:00:00',
    updated_at: '2026-10-25 07:00:00',
  };
}

async function boot(page: Page, fx: Fx) {
  await page.addInitScript((f: Fx) => {
    // the suite's overlay neutralizer
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) {
        const s = document.createElement('style'); s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s);
      }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
    (window as any).__shadowDice = () => 1;
    (window as any).__weekJackpotDice = () => 1;
    try {
      ['hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_cloud_restore_dismissed', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_coop_ever'].forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('hb_habits', '[]');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
      localStorage.setItem('hb_souls', JSON.stringify({ balance: f.souls ?? 0, totalEarned: f.souls ?? 0, totalSpent: 0 }));
    } catch (_) { /* noop */ }
    const calls = { list: 0, resolve: [] as string[], claim: [] as string[], optOut: [] as string[], optIn: [] as string[] };
    (window as any).__coopCalls = calls;
    (window as any).__coopFx = f;
    const patch = (a: any) => {
      if (!a || a.__w1094Patched) return;
      a.__w1094Patched = true;
      a.getBackendUserId = () => 'me';
      a.isMember = () => !!f.member;
      a.coopBossList = async () => { calls.list++; return { ok: true, instances: f.instances, auto_off: f.autoOff || [] }; };
      a.coopBossResolve = async (id: string) => {
        calls.resolve.push(id);
        return { ok: true, resolved: false, instance: f.instances.find((i: any) => i.id === id) };
      };
      a.coopBossClaim = async (id: string) => { calls.claim.push(id); return { ok: true, first: true }; };
      a.submitVerifiedEvents = async () => ({ ok: true });
      a.coopPacts = async () => ({ ok: true, day: '', pacts: {} });
      a.coopAutoOptOut = async (id: string) => {
        calls.optOut.push(id);
        f.autoOff = Array.from(new Set([...(f.autoOff || []), id]));
        return { ok: true, auto_off: f.autoOff };
      };
      a.coopAutoOptIn = async (id: string) => {
        calls.optIn.push(id);
        f.autoOff = (f.autoOff || []).filter((x) => x !== id);
        return { ok: true, auto_off: f.autoOff };
      };
    };
    let real: any;
    Object.defineProperty(window, 'Auth', {
      configurable: true,
      get() { return real; },
      set(v) { real = v; try { patch(v); } catch (_) { /* noop */ } },
    });
  }, fx);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
}

async function sync(page: Page) {
  await page.evaluate(() => { try { (window as any)._coopBackgroundSync(); } catch (_) { /* noop */ } });
}
const awarded = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hb_coop_awarded') || '{}'));
const ledger = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hb_souls_ledger') || '[]'));
const resultOpen = (page: Page) => page.evaluate(() => {
  const o = document.getElementById('boss-result-overlay');
  return !!o && !o.classList.contains('hidden');
});

test.describe('Automatic friend hunts (W1094)', () => {
  test('an automatic loss is quiet: recorded, no defeat screen', async ({ page }) => {
    await boot(page, { instances: [inst({ id: 'a-loss', status: 'expired', result: 'defeat', auto: true })] });
    await sync(page);
    await expect.poll(async () => (await awarded(page))['a-loss'], { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(2500);
    expect(await resultOpen(page)).toBe(false);
  });

  test('a manual loss still shows its defeat screen', async ({ page }) => {
    await boot(page, { instances: [inst({ id: 'm-loss', status: 'expired', result: 'defeat', auto: false })] });
    await sync(page);
    await expect.poll(async () => (await awarded(page))['m-loss'], { timeout: 15_000 }).toBe(true);
    await expect.poll(() => resultOpen(page), { timeout: 10_000 }).toBe(true);
  });

  test('a free hunter pays the entrance fee from the automatic win', async ({ page }) => {
    await boot(page, {
      souls: 300,
      instances: [inst({ id: 'a-win', status: 'completed', result: 'success', auto: true, committed: true, boss: 'the_coursing_dread', rank: 'C', goal: 18000, award: { owed: true, claimed: false } })],
    });
    await sync(page);
    await expect.poll(async () => (await awarded(page))['a-win'], { timeout: 15_000 }).toBe(true);
    const log = await ledger(page);
    const fee = log.find((e: any) => e.label === 'Co-op entry fee');
    expect(fee).toBeTruthy();
    expect(fee.delta).toBe(-50);   // C-rank: half the solo engage cost
    expect(fee.detail).toBe('The Coursing Dread');
    const win = log.find((e: any) => e.type === 'coop_kill' && e.ref_id === 'the_coursing_dread');
    expect(win).toBeTruthy();
    expect([100, 200]).toContain(win.delta);   // 200 only if the Coursing Dread hungers this week
    expect(await page.evaluate(() => (window as any).__coopCalls.claim)).toEqual(['a-win']);
  });

  test('a free hunter who cannot cover the fee still counts but earns nothing', async ({ page }) => {
    await boot(page, {
      souls: 0,
      instances: [inst({ id: 'a-broke', status: 'completed', result: 'success', auto: true, committed: true, boss: 'the_coursing_dread', rank: 'C', goal: 18000, award: { owed: true, claimed: false } })],
    });
    await sync(page);
    await expect.poll(async () => (await awarded(page))['a-broke'], { timeout: 15_000 }).toBe(true);
    const log = await ledger(page);
    expect(log.some((e: any) => e.type === 'coop_kill')).toBe(false);
    expect(log.some((e: any) => e.label === 'Co-op entry fee')).toBe(false);
    // the kill still counts toward the Kill Log
    const kills = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_coop_kills') || '{}'));
    expect(kills.the_coursing_dread && kills.the_coursing_dread.count).toBe(1);
    await page.waitForTimeout(1500);
    expect(await resultOpen(page)).toBe(false);
  });

  test('a member pays nothing', async ({ page }) => {
    await boot(page, {
      member: true,
      souls: 0,
      instances: [inst({ id: 'a-member', status: 'completed', result: 'success', auto: true, committed: true, award: { owed: true, claimed: false } })],
    });
    await sync(page);
    await expect.poll(async () => (await awarded(page))['a-member'], { timeout: 15_000 }).toBe(true);
    const log = await ledger(page);
    expect(log.some((e: any) => e.label === 'Co-op entry fee')).toBe(false);
    expect(log.some((e: any) => e.type === 'coop_kill' && e.ref_id === 'the_twin_maw')).toBe(true);
  });

  test('the phone never resolves an automatic hunt, and its flame waits until both posted', async ({ page }) => {
    await boot(page, {
      instances: [
        inst({ id: 'a-live', status: 'active', auto: true, committed: false }),
        inst({ id: 'm-live', status: 'active', auto: false, boss: 'the_coursing_dread', rank: 'C' }),
      ],
    });
    await sync(page);
    await expect.poll(() => page.evaluate(() => (window as any).__coopCalls.resolve), { timeout: 15_000 }).toContain('m-live');
    const calls = await page.evaluate(() => (window as any).__coopCalls.resolve);
    expect(calls).not.toContain('a-live');
    const started = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_coop_pact_started') || '{}'));
    expect(started['a-live']).toBeFalsy();
    expect(started['m-live']).toBe(1);
  });

  test('a committed automatic hunt lights the local flame', async ({ page }) => {
    await boot(page, {
      instances: [
        inst({ id: 'a-live2', status: 'active', auto: true, committed: true }),
        inst({ id: 'm-live2', status: 'active', auto: false, boss: 'the_coursing_dread', rank: 'C' }),
      ],
    });
    await sync(page);
    await expect.poll(() => page.evaluate(() => (window as any).__coopCalls.resolve), { timeout: 15_000 }).toContain('m-live2');
    const started = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_coop_pact_started') || '{}'));
    expect(started['a-live2']).toBe(1);
  });

  test('the dashboard marks automatic hunts DAILY', async ({ page }) => {
    await boot(page, {
      instances: [
        inst({ id: 'a-dash', status: 'active', auto: true }),
        inst({ id: 'm-dash', status: 'active', auto: false, boss: 'the_coursing_dread', rank: 'C' }),
      ],
    });
    await page.evaluate(() => (window as any).__coopOpenDashboard());
    await expect(page.locator('[data-coop-hunt="a-dash"] .cph-daily')).toHaveText('DAILY', { timeout: 10_000 });
    await expect(page.locator('[data-coop-hunt="m-dash"] .cph-daily')).toHaveCount(0);
  });

  test('Pact Flames: stop one friend, then everything', async ({ page }) => {
    await boot(page, { instances: [] });
    await page.evaluate(() => (window as any).__pfDemo());
    await page.locator('#pf-overlay [data-pf-open="d4"]').click();
    const sw = page.locator('#pf-overlay [data-pf-auto="d4"]');
    await expect(sw).toContainText('Hunting with anthony every day', { timeout: 5_000 });
    await expect(sw).toContainText('STOP');
    await sw.click();
    await expect(page.locator('#pf-overlay [data-pf-auto="d4"]')).toContainText('RESUME', { timeout: 5_000 });
    await expect(page.locator('#pf-overlay [data-pf-auto="d4"]')).toContainText('Daily hunts with anthony are off');
    expect(await page.evaluate(() => (window as any).__coopCalls.optOut)).toEqual(['d4']);
    // resume it
    await page.locator('#pf-overlay [data-pf-auto="d4"]').click();
    await expect(page.locator('#pf-overlay [data-pf-auto="d4"]')).toContainText('STOP', { timeout: 5_000 });
    expect(await page.evaluate(() => (window as any).__coopCalls.optIn)).toEqual(['d4']);
    // everything off from the header
    await page.locator('#pf-overlay .pf-sheet .pf-sclose').click();
    await expect(page.locator('#pf-overlay .pf-sheet')).not.toHaveClass(/open/, { timeout: 5_000 });
    await page.waitForTimeout(450);   // the slide-down
    const all = page.locator('#pf-overlay [data-pf-autoall]');
    await expect(all).toContainText('TURN OFF');
    await all.click();
    await expect(all).toContainText('TURN ON', { timeout: 5_000 });
    expect(await page.evaluate(() => (window as any).__coopCalls.optOut)).toEqual(['d4', '*']);
  });
});
