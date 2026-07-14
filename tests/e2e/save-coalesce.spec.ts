/**
 * Awakened — W659 save() coalescing: the flush-before-kill proof.
 *
 * save() now collapses the 3-9 redundant persists per user action into ONE
 * disk write that lands within the SAME event-loop turn (a microtask), plus a
 * synchronous saveFlush() on every graceful teardown (pagehide / beforeunload /
 * visibilitychange-hidden). The non-negotiable requirement: a habit completion
 * can NEVER be lost — not to backgrounding, force-quit, reload, or crash.
 *
 * These tests exercise the REAL app.js save path (not a model): the mechanism
 * via the window.__saveTest surface, and end-to-end via real habit completions
 * driven through toggleHabit's UI checkbox.
 */
import { test, expect, Page } from '@playwright/test';

// Hide the boot splash + Friday banner so clicks land (same as smoke.spec).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) {
        const s = document.createElement('style');
        s.id = 'e2e-splash-kill'; s.textContent = css; root.appendChild(s);
      }
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
  });
});

/** Boot as a returning user with `seedHabits` already in storage. */
async function bootWith(page: Page, seedHabits: Array<Record<string, unknown>>) {
  await page.addInitScript((habits) => {
    try {
      localStorage.setItem('hb_onboarding_seen_v2', '1');
      localStorage.setItem('hb_welcomed', '1');
      localStorage.setItem('hb_hunter_name_claimed', '1');
      localStorage.setItem('hb_cloud_restore_dismissed', '1');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      const d = new Date();
      const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_fri_banner_' + ymd, '1');
      localStorage.setItem('hb_habits', JSON.stringify(habits));
    } catch (_) {}
  }, seedHabits);
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
  await page.locator('#awakened-splash').waitFor({ state: 'detached', timeout: 6_000 }).catch(() => {});
  // Force-hide any transient overlay that would intercept tab/checkbox clicks
  // (same belt-and-suspenders as smoke.spec's freshApp).
  await page.evaluate(() => {
    const splash = document.getElementById('awakened-splash');
    if (splash) splash.remove();
    ['wn-overlay', 'wn-modal', 'modal-overlay', 'welcome-overlay', 'fri-challenge-modal', 'cin-onboarding', 'fa-coachmark-overlay'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.classList.add('hidden'); (el as HTMLElement).style.display = 'none'; (el as HTMLElement).style.pointerEvents = 'none'; }
    });
  });
  // The save surface must be exposed before any test drives it.
  await page.waitForFunction(() => !!(window as unknown as { __saveTest?: unknown }).__saveTest, { timeout: 10_000 });
}

type SaveTest = {
  nowCalls: () => number;
  dirty: () => boolean;
  poke: (n?: number) => void;
  flush: () => void;
};
const H = [{ id: 'h1', name: 'A', emoji: '🅰️', difficulty: 'easy', type: 'build', primaryStat: 'STR' }];

test.describe('W659 · save() coalescing + flush-before-kill', () => {
  test('T1 — 9 redundant saves in one action collapse to ONE disk write', async ({ page }) => {
    await bootWith(page, H);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __saveTest: SaveTest }).__saveTest;
      const before = s.nowCalls();
      s.poke(9);                       // 9 save() calls in ONE synchronous turn
      const midDirty = s.dirty();      // still pending — not yet written
      const afterSyncCalls = s.nowCalls();
      await Promise.resolve();         // drain the microtask queue
      await Promise.resolve();
      return { before, midDirty, afterSyncCalls, afterMicro: s.nowCalls(), dirtyAfter: s.dirty() };
    });
    expect(r.midDirty).toBe(true);              // dirty between the calls and the microtask
    expect(r.afterSyncCalls).toBe(r.before);    // NO write happened synchronously
    expect(r.afterMicro).toBe(r.before + 1);    // exactly ONE write after the microtask
    expect(r.dirtyAfter).toBe(false);           // cleared
  });

  test('T2 — five separate actions = five writes, not 45', async ({ page }) => {
    await bootWith(page, H);
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __saveTest: SaveTest }).__saveTest;
      const before = s.nowCalls();
      for (let action = 0; action < 5; action++) {
        s.poke(9);                     // each "tap" fires 9 redundant saves
        await Promise.resolve();       // ...and its own turn ends → one flush
        await Promise.resolve();
      }
      return { before, after: s.nowCalls() };
    });
    expect(r.after).toBe(r.before + 5);   // 5 writes total (was 45 pre-W659)
  });

  test('T3 — backgrounding mid-window flushes the pending write synchronously', async ({ page }) => {
    await bootWith(page, H);
    const r = await page.evaluate(() => {
      const s = (window as unknown as { __saveTest: SaveTest }).__saveTest;
      s.poke(1);                       // a pending, un-drained write
      const before = s.nowCalls();
      const wasDirty = s.dirty();
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));   // app backgrounded
      return { wasDirty, before, after: s.nowCalls(), dirtyAfter: s.dirty() };
    });
    expect(r.wasDirty).toBe(true);
    expect(r.after).toBe(r.before + 1);   // flushed the instant we backgrounded
    expect(r.dirtyAfter).toBe(false);
  });

  test('T4 — force-quit (pagehide) flushes the pending write', async ({ page }) => {
    await bootWith(page, H);
    const r = await page.evaluate(() => {
      const s = (window as unknown as { __saveTest: SaveTest }).__saveTest;
      s.poke(1);
      const before = s.nowCalls();
      window.dispatchEvent(new Event('pagehide'));   // iOS kill / reload begins
      return { before, after: s.nowCalls(), dirtyAfter: s.dirty() };
    });
    expect(r.after).toBe(r.before + 1);
    expect(r.dirtyAfter).toBe(false);
  });

  test('T5 — five rapid REAL habit completions all persist to hb_completions', async ({ page }) => {
    const five = ['h1', 'h2', 'h3', 'h4', 'h5'].map((id, i) => ({
      id, name: 'Vow ' + i, emoji: '✅', difficulty: 'easy', type: 'build', primaryStat: 'STR',
    }));
    await bootWith(page, five);
    // Fire five REAL completions (toggleHabit → save) as fast as possible in a
    // SINGLE turn — the "5 habits in 2 seconds" burst — then simulate an
    // immediate force-quit (pagehide) before the microtask would even drain.
    // Nothing may be lost: the pagehide flush persists the accumulated state.
    const persisted = await page.evaluate(() => {
      const s = (window as unknown as { __saveTest: { complete: (id: string) => void; nowCalls: () => number } }).__saveTest;
      const writesBefore = s.nowCalls();
      ['h1', 'h2', 'h3', 'h4', 'h5'].forEach((id) => s.complete(id));   // 5 rapid real taps
      window.dispatchEvent(new Event('pagehide'));                       // force-quit NOW
      const writesAfter = s.nowCalls();
      const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
      let comp: Record<string, string[]> = {};
      try { comp = JSON.parse(localStorage.getItem('hb_completions') || '{}'); } catch (_) {}
      return { ids: comp[today] || [], writesDuringBurst: writesAfter - writesBefore };
    });
    // All five survived the force-quit (the primary invariant)...
    for (const id of ['h1', 'h2', 'h3', 'h4', 'h5']) expect(persisted.ids).toContain(id);
    // ...and coalescing still cut the writes hard: each completion now flushes
    // ONCE synchronously (durability parity — the W659-review fix) with its own
    // 3-9 redundant tail saves collapsed, so 5 completions cost ~6 writes, NOT
    // the 15-45 of the un-coalesced path. Bound generously to stay robust to the
    // exact render-tail save count.
    expect(persisted.writesDuringBurst).toBeLessThanOrEqual(10);
  });

  test('T6 — a completion survives a REAL page reload with NO microtask drain (crash-parity)', async ({ page }) => {
    await bootWith(page, [{ id: 'h1', name: 'Solo', emoji: '✅', difficulty: 'easy', type: 'build', primaryStat: 'STR' }]);
    // Complete via the real path, then reload IMMEDIATELY — do not await, do not
    // drain the microtask. End-to-end proof that a completion survives a REAL
    // teardown (belt: the completion-path saveFlush already wrote it; suspenders:
    // reload also fires the pagehide/beforeunload flush). The no-event OOM-kill
    // case that ONLY the completion-path saveFlush covers isn't reproducible in
    // Chromium — that one is guaranteed by inspection (synchronous write before
    // the render tail), not this test.
    await page.evaluate(() => {
      (window as unknown as { __saveTest: { complete: (id: string) => void } }).__saveTest.complete('h1');
    });
    await page.reload();
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    // After a genuine reboot of the document, the completion must be on disk.
    const persistedAfterReload = await page.evaluate(() => {
      const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
      let comp: Record<string, string[]> = {};
      try { comp = JSON.parse(localStorage.getItem('hb_completions') || '{}'); } catch (_) {}
      return comp[today] || [];
    });
    expect(persistedAfterReload).toContain('h1');
  });
});
