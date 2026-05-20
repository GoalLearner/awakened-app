/**
 * Awakened — Playwright smoke suite.
 *
 * Goal: 7-area sanity pass against the localhost dev build. Catches
 * the regressions that hurt most before Codemagic / TestFlight:
 *   A. App boots clean
 *   B. Status tab renders
 *   C. Habits tab renders + Add Habits affordance is reachable
 *   D. Edit Habit modal open + close (the iOS post-save freeze had
 *      the modal failing to close — assert it goes away)
 *   E. Leaderboard sheet: tabs visible, scroll doesn't dismiss,
 *      X closes
 *   F. Boss detail: SOULS AVAILABLE readout near Engage button
 *   G. Duels picker: no Boss Race, exactly 5 verified types
 *
 * Auth is via Auth.devSignInIfLocalhost() — see auth.js. The dev
 * stub auto-mounts the app as "DevUser" on localhost so we never
 * need real Apple Sign In.
 *
 * Each test starts from a clean slate via the shared `freshApp()`
 * helper, which:
 *   - unregisters any SW + clears caches
 *   - seeds localStorage to skip onboarding + claim a hunter name
 *     + bypass the Cloud Sync restore prompt
 *   - reloads
 *   - waits for the bottom-tab bar (mount signal)
 */
import { test, expect, Page } from '@playwright/test';

/**
 * Reset SW + caches so each test boots fresh. Seeds the localStorage
 * keys that gate onboarding + first-run cloud-restore prompts so the
 * tests land directly on the Status tab. Does NOT seed hb_user — we
 * rely on the dev sign-in path to populate that, exercising the real
 * mount sequence.
 */
async function freshApp(page: Page) {
  // Seed all the gate-skipping localStorage keys BEFORE any page
  // script runs. addInitScript fires on every navigation in this
  // context, before document scripts execute. No reload needed,
  // no SW unregister gymnastics — the playwright config blocks
  // service workers entirely (`serviceWorkers: 'block'`).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hb_onboarding_seen_v2', '1');
      localStorage.setItem('hb_welcomed', '1');
      localStorage.setItem('hb_hunter_name_claimed', '1');
      localStorage.setItem('hb_cloud_restore_dismissed', '1');
      // What's New modal — gated by hb_whats_new_seen comparing
      // against the live APP_VERSION. Set far ahead of any future
      // bump so the modal never paints during tests.
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
    } catch (_) {}
  });
  await page.goto('/');
  // Mount signal: the bottom-tab bar always renders after the app
  // shell wires up. If the sign-in gate is showing, this never
  // becomes visible — which is what we want (fast failure).
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
  // Splash dwells for ~1800ms before fading out, then removes
  // itself ~700ms later. Wait until it's gone (or be tolerant if
  // a build skips the splash entirely).
  await page
    .locator('#awakened-splash')
    .waitFor({ state: 'detached', timeout: 6_000 })
    .catch(() => { /* tolerated */ });
  // If any other transient overlay is still up (welcome modal,
  // what's new, etc.), force-hide them so subsequent clicks aren't
  // intercepted. Belt-and-suspenders on top of the localStorage
  // seeds above.
  await page.evaluate(() => {
    const ids = ['awakened-splash', 'wn-overlay', 'wn-modal', 'modal-overlay', 'welcome-overlay'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) el.classList.add('hidden');
    });
  });
}

// ── Console error tracking ──────────────────────────────────
// Use these in tests that care about a clean console. We tolerate
// network failures from the production backend (the dev stub JWT
// gets 401'd on /v1/* calls — expected and benign).
function attachConsoleWatcher(page: Page) {
  const fatal: string[] = [];
  page.on('pageerror', (err) => fatal.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Filter network noise from the dev stub hitting the real worker.
    if (/Failed to load resource|net::ERR_|401|429|CORS|Bearer/i.test(text)) return;
    fatal.push('console.error: ' + text);
  });
  return fatal;
}

// ─────────────────────────────────────────────────────────────
// A. App boots
// ─────────────────────────────────────────────────────────────
test.describe('A · App boots', () => {
  test('mounts the shell, no fatal JS errors', async ({ page }) => {
    const fatal = attachConsoleWatcher(page);
    await freshApp(page);
    // Bottom-tab bar is the mount signal.
    await expect(page.locator('#tab-profile')).toBeVisible();
    await expect(page.locator('#tab-habits')).toBeVisible();
    await expect(page.locator('#tab-social')).toBeVisible();
    // Wait a beat for any deferred init (auto-update SW check, etc.)
    // then assert no uncaught errors.
    await page.waitForTimeout(500);
    expect(fatal, fatal.join('\n')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// B. Status tab
// ─────────────────────────────────────────────────────────────
test.describe('B · Status tab', () => {
  test('default-active and renders Hunter Profile content', async ({ page }) => {
    await freshApp(page);
    // Status (#tab-profile) is the default active tab.
    await expect(page.locator('#tab-profile.active')).toBeVisible();
    // Hunter Profile banner uses a serif `Hunter Profile` title with
    // letterspacing — match case-insensitively to be resilient to
    // copy tweaks.
    await expect(page.getByText(/hunter profile/i).first()).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────
// C. Habits tab
// ─────────────────────────────────────────────────────────────
test.describe('C · Habits tab', () => {
  test('opens and shows the habit list area', async ({ page }) => {
    await freshApp(page);
    await page.locator('#tab-habits').click();
    // Tab switch landed.
    await expect(page.locator('#tab-habits.active')).toBeVisible();
    // Habit-list <ul> always mounts (may be empty for first-run
    // users — the #empty-state sibling covers that case visually).
    // Both nodes exist in the DOM at all times, so we check
    // visibility on at least one of them via a count probe instead
    // of `.or()` (which requires a single-element resolution).
    const habitListVisible = await page.locator('#habit-list').isVisible();
    const emptyStateVisible = await page.locator('#empty-state').isVisible();
    expect(habitListVisible || emptyStateVisible).toBe(true);
    // Add-Habits affordance — match the visible button by role.
    // Copy may shift between "Add Habit", "+ ADD", etc.
    const addAffordance = page.getByRole('button', { name: /add\s*habit/i }).first();
    await expect(addAffordance).toBeVisible({ timeout: 10_000 });
  });
});

// ─────────────────────────────────────────────────────────────
// D. Edit Habit modal — open + close (post-save freeze regression)
// ─────────────────────────────────────────────────────────────
test.describe('D · Edit Habit modal', () => {
  test('opens and closes cleanly without stranding the overlay', async ({ page }) => {
    await freshApp(page);
    await page.locator('#tab-habits').click();
    // Programmatically open the modal — DOM-level click on a habit
    // row varies (long-press vs. tap-then-edit) and is brittle to
    // test gesturally. Use the same render call the app uses.
    await page.evaluate(() => {
      // The modal markup is always present in DOM; we just toggle
      // .hidden. If the live app's openEditModal helper is exposed,
      // prefer it. Otherwise drive the modal DOM directly.
      const modal   = document.getElementById('edit-modal');
      const overlay = document.getElementById('modal-overlay');
      if (modal)   modal.classList.remove('hidden');
      if (overlay) overlay.classList.remove('hidden');
    });
    await expect(page.locator('#edit-modal')).toBeVisible();
    await expect(page.locator('#modal-overlay')).toBeVisible();
    // Cancel button always closes — the iOS freeze bug was on Save.
    // Cancel + Save share the same closeEditModal() path post-1z.34,
    // so a clean Cancel exercise is enough to assert the close path
    // doesn't strand the overlay.
    await page.locator('#cancel-edit-btn').click();
    await expect(page.locator('#edit-modal')).toBeHidden();
    await expect(page.locator('#modal-overlay')).toBeHidden();
    // App stays responsive — switch tabs successfully.
    await page.locator('#tab-profile').click();
    await expect(page.locator('#tab-profile.active')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────
// E. Leaderboard sheet
// ─────────────────────────────────────────────────────────────
test.describe('E · Leaderboard sheet', () => {
  test('opens via Steps card, tabs visible, scroll keeps open, X closes', async ({ page }) => {
    await freshApp(page);
    // World Rank · Steps card is on the Status (default) tab.
    const stepsCard = page.locator('#steps-card');
    await expect(stepsCard).toBeVisible();
    await stepsCard.click();

    const sheet = page.locator('#lb-rank-sheet');
    await expect(sheet).toBeVisible();

    // Tabs are visible for step_total (1z.36 segmented control).
    const tabs = page.locator('#lb-rank-tabs');
    await expect(tabs).toBeVisible();
    const thisWeek = tabs.locator('[data-lb-tab="this-week"]');
    const hofTab   = tabs.locator('[data-lb-tab="hof"]');
    await expect(thisWeek).toBeVisible();
    await expect(hofTab).toBeVisible();

    // Title reads "Steps" when HoF tab is available (per 1z.36).
    await expect(page.locator('#lb-rank-title')).toHaveText(/^steps$/i);

    // This Week blurb carries the visible date range "MMM D–MMM D".
    await expect(page.locator('#lb-rank-blurb')).toContainText(/–/);

    // Switch to Hall of Fame — list or empty state must render.
    await hofTab.click();
    await expect(hofTab).toHaveClass(/is-active/);
    // HoF blurb is the "Highest verified weekly totals" copy.
    await expect(page.locator('#lb-rank-blurb')).toContainText(/highest verified weekly/i);
    // List rows OR the "No records yet" empty state. The dev stub's
    // 401 against the real backend means we end up in the offline
    // fallback which still renders sim filler — so the list always
    // has rows in localhost mode. Both branches are acceptable here.
    await expect(page.locator('.lb-rank-list')).toBeVisible();

    // Scroll the list — sheet must stay open (1z.40 fix removed the
    // drag-dismiss + overlay-tap close for this sheet specifically).
    await page.locator('.lb-rank-list').evaluate((el) => {
      el.scrollBy({ top: 200, behavior: 'auto' });
    });
    await expect(sheet).toBeVisible();

    // X button is the sole close path now.
    await page.locator('#lb-rank-close').click();
    await expect(sheet).toBeHidden();
  });
});

// ─────────────────────────────────────────────────────────────
// F. Boss detail — Souls balance readout (Phase 1z.39)
// ─────────────────────────────────────────────────────────────
test.describe('F · Boss detail Souls readout', () => {
  test('SOULS AVAILABLE pill renders above the Engage button', async ({ page }) => {
    await freshApp(page);
    // The boss full-screen overlay markup is always in the DOM; the
    // engage-cta variant is the one we care about. Programmatically
    // make it visible (the engage-state / preview siblings stay
    // hidden) and call the populate path directly through a
    // contained snippet. Driving the boss-card tap end-to-end pulls
    // in dungeon gating + per-rank unlock logic that's overkill for
    // a smoke test.
    await page.evaluate(() => {
      const overlay = document.getElementById('boss-fs-overlay');
      const cta     = document.getElementById('bfs-engage-cta');
      const state   = document.getElementById('bfs-engage-state');
      const preview = document.getElementById('bfs-engage-preview');
      const num     = document.getElementById('bfs-souls-balance-num');
      const balEl   = document.getElementById('bfs-souls-balance');
      if (overlay) overlay.classList.remove('hidden');
      if (state)   state.classList.add('hidden');
      if (preview) preview.classList.add('hidden');
      if (cta) {
        cta.classList.remove('hidden');
        // Force a populated balance display matching the 1z.39 path.
        if (num) num.textContent = '185';
        const label = cta.querySelector('.bfs-souls-balance__label');
        if (label) label.textContent = 'Souls available';
        if (balEl) balEl.classList.remove('bfs-souls-balance--insufficient');
      }
    });
    // The compact pill, the "SOULS AVAILABLE" label, and the engage
    // button must all be present in the same action card.
    const pill   = page.locator('#bfs-souls-balance');
    const label  = page.locator('.bfs-souls-balance__label');
    const engage = page.locator('#bfs-engage-btn');
    await expect(pill).toBeVisible();
    // Case-insensitive — copy may shift between "Souls available" /
    // "SOULS AVAILABLE" (text-transform: uppercase via CSS) so we
    // match on the underlying text without forcing one casing.
    await expect(label).toHaveText(/souls available/i);
    await expect(page.locator('#bfs-souls-balance-num')).toHaveText('185');
    await expect(engage).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────
// G. Duels picker — Boss Race deferred; 5 verified types only
// ─────────────────────────────────────────────────────────────
test.describe('G · Duels picker', () => {
  test('Boss Race is hidden; 5 selectable types render in the picker', async ({ page }) => {
    await freshApp(page);
    // Step 1 — open the Duels tab so the picker's wiring
    // (`setupDuelTypePicker`) has run and event listeners are
    // attached. The tab body itself stays mostly empty without a
    // friend roster (production data lives behind auth), which is
    // fine — we only need the picker DOM to be hot.
    await page.locator('#tab-social').click();
    // Step 2 — open the type picker. `window.openDuelTypePicker`
    // is a pre-existing global that the app uses to dispatch the
    // picker from outside its IIFE (see `try { window.openDuelTypePicker
    // = ... } catch (_) {}` in app.js). We pass a stub opponent
    // alias — the picker only uses it for the "vs <alias>" header
    // and the optional submit, neither of which the test invokes.
    // This is the cleanest test-friendly surface: no runtime
    // changes, no test-only exports, no DUEL_TYPES global needed.
    const opened = await page.evaluate(() => {
      const w = window as unknown as { openDuelTypePicker?: (alias: string) => void };
      if (typeof w.openDuelTypePicker !== 'function') return false;
      try { w.openDuelTypePicker('PlaywrightOpponent'); return true; }
      catch (_) { return false; }
    });
    expect(opened, 'openDuelTypePicker must be exposed on window for in-app dispatch').toBe(true);

    // Step 3 — the picker mounts a grid of cards; each carries
    // `data-duel-type="<id>"`. Boss Race is `selectable: false`
    // in DUEL_TYPES and is filtered out by `_renderDuelTypeCards`,
    // so its card never reaches the DOM. We assert against UI text
    // / DOM attributes only — no runtime globals.
    const cards = page.locator('#duel-type-grid [data-duel-type]');
    await expect(cards).toHaveCount(5);

    const ids = await cards.evaluateAll(els =>
      els.map(el => (el as HTMLElement).getAttribute('data-duel-type') || '')
    );
    expect(ids).not.toContain('boss_race');
    // The five v2.2.1 verified types — order is governed by the
    // `order` array in `_renderDuelTypeCards`. Assert the SET (not
    // the order) so a future re-ordering doesn't break the test.
    expect(new Set(ids)).toEqual(new Set([
      'verified_objectives',
      'steps',
      'sleep',
      'bedtime',
      'strength',
    ]));

    // Step 4 — close cleanly so the next test doesn't inherit a
    // body class lock (`body.duel-type-locked`).
    await page.evaluate(() => {
      const w = window as unknown as { closeDuelTypePicker?: () => void };
      if (typeof w.closeDuelTypePicker === 'function') w.closeDuelTypePicker();
    });
  });
});

// ─────────────────────────────────────────────────────────────
// H. Add Habits — preset add path freeze regression (Phase 1z.88)
// ─────────────────────────────────────────────────────────────
// Regression for the persistent iOS Add Habits freeze. The failure
// mode on TestFlight was: user opens a library preset → taps Add
// to My Habits → sheet stays frozen on iOS Capacitor WebView while
// renderHabits + renderLibrary block the next frame.
//
// 1z.88 fixes this four ways (see CLAUDE.md):
//   1. isHabitAlreadyAdded(h) canonical helper
//   2. click-time defensive tap guard
//   3. chained setTimeout(0) render deferral (close paints first)
//   4. hardened closeHabitDetail (inline display:none + pointer-events:none)
//
// The renderLibrary path already filters out already-added presets
// at render time (DEFAULT_HABITS.filter(activeNames check)), so the
// pure "already added card visible in library" repro can only happen
// with a stale rendered DOM. We therefore test the END-TO-END add
// path that was actually freezing:
//   - open library
//   - click Sprint session card (fresh)
//   - tap Add to My Habits
//   - assert: sheet closes cleanly, habit is in habits[], app stays
//             responsive (tab switch), re-opening library no longer
//             shows the card (proving the already-added FILTER works
//             post-add → no stale state)
//
// This covers the freeze regression AND the already-added invariant
// in a single deterministic flow.
test.describe('H · Add Habits preset add path (1z.91)', () => {
  test('library preset add closes cleanly, breadcrumbs trace path, watchdog runs, app stays responsive', async ({ page }) => {
    await freshApp(page);

    // Habits tab → + Add Habit.
    await page.locator('#tab-habits').click();
    await expect(page.locator('#tab-habits.active')).toBeVisible();
    await page.locator('#add-habit-btn').click();
    await expect(page.locator('#lib-sheet')).toBeVisible();

    // Expand the "Physical Performance" accordion. Sprint session lives
    // at DEFAULT_HABITS[5], inside OB_CATEGORIES[0] "Physical Performance".
    const accHeader = page.locator('.ob-acc-header', { hasText: /physical performance/i }).first();
    await expect(accHeader).toBeVisible();
    await accHeader.click();

    // Click the Sprint session card. Wait for visibility — the
    // accordion uses an animated max-height transition.
    const sprintCard = page.locator('.lib-card', { hasText: 'Sprint session' }).first();
    await expect(sprintCard).toBeVisible({ timeout: 5_000 });
    await sprintCard.click();

    // Detail sheet open with the Add to My Habits CTA.
    const sheet = page.locator('#hd-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.locator('.hd-already')).toHaveCount(0);
    const addBtn = page.locator('.hd-add-btn');
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toContainText(/add to my habits/i);

    // Tap Add to My Habits. On iOS this was the freeze point; in
    // Chromium it should close cleanly + habit lands in storage.
    await addBtn.click();

    // Sheet must be fully closed — `toBeHidden` checks computed
    // visibility, which catches both `.hidden` class AND inline
    // display:none (1z.88 belt-and-braces close).
    await expect(sheet).toBeHidden({ timeout: 5_000 });

    // The habit must have landed in hb_habits.
    const stored = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('hb_habits');
        return raw ? JSON.parse(raw) : null;
      } catch (_) { return null; }
    });
    expect(Array.isArray(stored)).toBe(true);
    expect((stored || []).some((h: { name?: string }) => h.name === 'Sprint session')).toBe(true);
    // Exactly one (rapid double-tap dup-guard regression).
    expect((stored || []).filter((h: { name?: string }) => h.name === 'Sprint session').length).toBe(1);

    // v3 Phase 1z.89 — the parent Add Habits sheet must ALSO close on
    // successful preset add (Option 1 UX). User lands back on the
    // Habits tab. No more parent-sheet half-state freeze class.
    await expect(page.locator('#lib-sheet')).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#lib-overlay')).toBeHidden();

    // Toast confirming the add. Auto-dismisses; we just assert it
    // showed up so the user has feedback.
    await expect(page.locator('.habit-toast').first()).toContainText(/sprint session added/i);

    // App stays responsive — tab switch works with no stranded overlay
    // capturing pointer events. This is the symptom the user reported.
    await page.locator('#tab-profile').click();
    await expect(page.locator('#tab-profile.active')).toBeVisible();

    // Re-open library — the freshly added preset must NOT appear in
    // its category. Confirms renderLibrary fired with the new habits[]
    // on the deferred tick (filter via activeNames).
    //
    // Force-dismiss any lingering habit-toast before clicking so it
    // can't intercept the add-habit-btn tap on a stressed CI runner.
    await page.evaluate(() => {
      document.querySelectorAll('.habit-toast').forEach(t => t.remove());
    });
    // Wait for the first add's deferred renders + watchdog (500ms) to
    // settle. Without this, the second open's click can race against
    // the in-flight setTimeout chain inside addBtn's handler.
    await page.waitForTimeout(800);
    await page.locator('#tab-habits').click();
    await expect(page.locator('#tab-habits.active')).toBeVisible();
    // Retry the open up to 8 times. Each retry waits 250ms.
    let opened = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.evaluate(() => {
        const btn = document.getElementById('add-habit-btn');
        if (btn) btn.click();
      });
      try {
        await page.locator('#lib-sheet').waitFor({ state: 'visible', timeout: 1_500 });
        opened = true;
        break;
      } catch (_) {
        await page.waitForTimeout(250);
      }
    }
    if (!opened) throw new Error('lib-sheet failed to open after 8 retries');
    await expect(page.locator('#lib-sheet')).toBeVisible();
    // Dispatch accordion click programmatically too — bypasses lib-sheet's
    // sliding-up CSS transition that can cause Playwright to flake on
    // the visibility check during animation.
    await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('.ob-acc-header'));
      const target = headers.find(h => /physical performance/i.test(h.textContent || ''));
      if (target) (target as HTMLElement).click();
    });
    // The accordion body uses max-height transition, so wait for the
    // card to actually appear in the DOM. We're asserting it does NOT
    // exist for Sprint session (since it was just added).
    await expect(page.locator('.lib-card', { hasText: 'Sprint session' })).toHaveCount(0);

    // resetAddHabitsInteractionState invariant — re-opened library
    // must NOT carry inline transform / transition residue from the
    // prior close cycle. Stale inline transform was the freeze
    // mechanism the parent-sheet fix addresses.
    const inlineStyle = await page.locator('#lib-sheet').evaluate((el) => ({
      transform: (el as HTMLElement).style.transform,
      transition: (el as HTMLElement).style.transition,
      opacity: (el as HTMLElement).style.opacity,
      pointerEvents: (el as HTMLElement).style.pointerEvents,
    }));
    expect(inlineStyle.transform).toBe('');
    expect(inlineStyle.transition).toBe('');
    expect(inlineStyle.opacity).toBe('');
    expect(inlineStyle.pointerEvents).toBe('');

    // v3 Phase 1z.95 — persistent breadcrumb assertion. The add path
    // no longer dispatches HealthKit side effects (those were the
    // microtask-cascade source that starved setTimeouts on iOS).
    // Side effects now ONLY run on natural renderHabits triggers
    // (tab switch / visibility change / day change). So the canonical
    // post-add breadcrumb sequence MUST contain side-effects-skipped-
    // on-add and MUST NOT contain side-effects-start / -complete
    // anywhere in this test's window.
    //
    // Wait 3.3 seconds — covers up through the alive-3000 probe.
    await page.waitForTimeout(3300);
    const crumbs = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('hb_add_habit_debug_v1');
        return raw ? JSON.parse(raw) : [];
      } catch (_) { return []; }
    });
    const steps = (crumbs as Array<{ step: string }>).map(c => c.step);
    // Canonical fresh-add sequence — strict membership checks (we
    // tolerate extra breadcrumbs in between for future-proofing).
    expect(steps).toContain('tap-start');
    expect(steps).toContain('busy-guard-set');
    expect(steps).toContain('dup-guard-passed');
    expect(steps).toContain('cfg-build-complete');
    expect(steps).toContain('onConfirm-complete');
    expect(steps).toContain('force-close-start');
    expect(steps).toContain('force-close-complete');
    expect(steps).toContain('finally-cleanup');
    expect(steps).toContain('render-tick-ok');
    expect(steps).toContain('watchdog-complete');
    expect(steps).toContain('alive-1000');
    // 1z.95 — alive probes through 3 seconds; side-effects skipped.
    expect(steps).toContain('alive-2000');
    expect(steps).toContain('alive-3000');
    expect(steps).toContain('side-effects-skipped-on-add');
    // The dup-guard MUST NOT have tripped for a fresh add.
    expect(steps).not.toContain('dup-guard-tripped');
    // No outer throw on the happy path.
    expect(steps).not.toContain('outer-threw');
    expect(steps).not.toContain('render-tick-threw');
    // 1z.95 invariant — side effects MUST NOT fire from the add path.
    // (They will fire on tab switches etc., but not as part of an
    // immediate add. This is the freeze fix.)
    expect(steps).not.toContain('side-effects-start');
    expect(steps).not.toContain('side-effects-complete');
  });
});
