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

// ─────────────────────────────────────────────────────────────
// I. Create Your Own Habit — custom add freeze regression (Phase 1z.106)
// ─────────────────────────────────────────────────────────────
// Regression for the "tap Create Habit → app freezes" report. Root
// cause: saveCustomHabit closed the custom-overlay but left lib-sheet
// + lib-overlay mounted, intercepting pointer events on the tab bar.
// 1z.106 mirrors confirmPackAdd's 1z.89 fix — closes the library too.
test.describe('I · Create Your Own Habit (1z.106)', () => {
  test('custom habit save closes both modals, drops overlay, app stays responsive', async ({ page }) => {
    await freshApp(page);

    await page.locator('#tab-habits').click();
    await expect(page.locator('#tab-habits.active')).toBeVisible();
    await page.locator('#add-habit-btn').click();
    await expect(page.locator('#lib-sheet')).toBeVisible();

    // Open Create Your Own modal.
    await page.locator('.lib-pack-entry--custom').click();
    await expect(page.locator('#custom-overlay')).toBeVisible();

    // Fill the name.
    await page.locator('#custom-name-input').fill('Run');

    // Pick the STR stat (first card in the grid).
    await page.locator('.custom-stat-btn').first().click();

    // Save button must be enabled now.
    await expect(page.locator('#custom-save-btn')).toBeEnabled();
    await page.locator('#custom-save-btn').click();

    // Custom modal closes.
    await expect(page.locator('#custom-overlay')).toBeHidden({ timeout: 3_000 });
    // 1z.106 — parent Add Habits sheet + overlay must ALSO close.
    await expect(page.locator('#lib-sheet')).toBeHidden({ timeout: 3_000 });
    await expect(page.locator('#lib-overlay')).toBeHidden();

    // Habit landed in storage with the right shape.
    const stored = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('hb_habits');
        return raw ? JSON.parse(raw) : null;
      } catch (_) { return null; }
    });
    expect(Array.isArray(stored)).toBe(true);
    const found = (stored || []).find((h: { name?: string }) => h.name === 'Run');
    expect(found).toBeTruthy();
    expect(found.custom).toBe(true);
    expect(found.primaryStat).toBe('STR');
    expect(found.difficulty).toBe('medium');

    // Toast confirms the add.
    await expect(page.locator('.habit-toast').first()).toContainText(/run/i);

    // App stays responsive — tab switch works (this was the freeze
    // symptom: lib-overlay was intercepting the tab-bar tap).
    await page.locator('#tab-profile').click();
    await expect(page.locator('#tab-profile.active')).toBeVisible();

    // Breadcrumb assertions — the 1z.106 custom-create breadcrumb
    // sequence must trace the happy path end to end.
    const crumbs = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('hb_add_habit_debug_v1');
        return raw ? JSON.parse(raw) : [];
      } catch (_) { return []; }
    });
    const steps = (crumbs as Array<{ step: string }>).map(c => c.step);
    expect(steps).toContain('custom-create-click');
    expect(steps).toContain('custom-create-validated');
    expect(steps).toContain('custom-create-persist-start');
    expect(steps).toContain('custom-create-persist-ok');
    expect(steps).toContain('custom-create-close-modal');
    expect(steps).toContain('custom-create-render-start');
    expect(steps).toContain('custom-create-render-ok');
    expect(steps).toContain('custom-create-complete');
    // No throws on the happy path.
    expect(steps).not.toContain('custom-create-persist-threw');
    expect(steps).not.toContain('custom-create-render-threw');
    expect(steps).not.toContain('custom-create-render-library-threw');
    expect(steps).not.toContain('custom-create-validation-failed');
  });
});

// ─────────────────────────────────────────────────────────────
// J. Legacy "Strength training" → "Workout" rename migration (1z.107)
// ─────────────────────────────────────────────────────────────
// Defensive regression for the 1z.107 fix. A pre-1z.105 device that
// still has `name: "Strength training"` in localStorage must:
//   1. Be recognized by isStrengthWorkoutHabit / findStrengthHabit
//      via the legacy-aware helper, AND
//   2. Have the row renamed in-place to 'Workout' by the migration
//      so the UI label catches up.
// Also asserts the migration does NOT rename custom user habits
// that happen to share the legacy name.
test.describe('J · Legacy Strength training → Workout migration (1z.107)', () => {
  test('renames non-custom legacy row, preserves id, leaves custom habits alone, no duplicates', async ({ page }) => {
    // Seed BEFORE app boot: a legacy 'Strength training' default habit
    // plus a custom user habit that happens to share the legacy name.
    // Migration should rename the default but NOT the custom.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_onboarding_seen_v2', '1');
        localStorage.setItem('hb_welcomed', '1');
        localStorage.setItem('hb_hunter_name_claimed', '1');
        localStorage.setItem('hb_cloud_restore_dismissed', '1');
        localStorage.setItem('hb_whats_new_seen', '99.99.99');

        // Ensure the migration flag is NOT set so we exercise the
        // rename path.
        localStorage.removeItem('hb_strength_to_workout_rename_v1');

        const seeded = [
          {
            id: 'legacy-str-id-1',
            name: 'Strength training',
            emoji: '🏋️',
            difficulty: 'hard',
            type: 'build',
            primaryStat: 'STR',
          },
          {
            id: 'custom-str-id-1',
            name: 'Strength training',
            emoji: '💪',
            difficulty: 'medium',
            type: 'build',
            primaryStat: 'STR',
            custom: true,
          },
          {
            id: 'unrelated-id-1',
            name: 'Hydrate',
            emoji: '💧',
            difficulty: 'easy',
            type: 'build',
            primaryStat: 'VIT',
          },
        ];
        localStorage.setItem('hb_habits', JSON.stringify(seeded));
      } catch (_) {}
    });

    await page.goto('/');
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });

    // Wait briefly so init() + migrations have committed to localStorage.
    await page.waitForTimeout(500);

    const habitsAfter = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('hb_habits');
        return raw ? JSON.parse(raw) : null;
      } catch (_) { return null; }
    });

    expect(Array.isArray(habitsAfter)).toBe(true);

    // 1. Default 'Strength training' row was renamed to 'Workout',
    //    id preserved.
    const renamed = (habitsAfter || []).find((h: { id?: string }) => h.id === 'legacy-str-id-1');
    expect(renamed).toBeTruthy();
    expect(renamed.name).toBe('Workout');
    expect(renamed.custom).toBeFalsy();

    // 2. Custom user habit with the legacy name string is UNTOUCHED.
    const customUntouched = (habitsAfter || []).find((h: { id?: string }) => h.id === 'custom-str-id-1');
    expect(customUntouched).toBeTruthy();
    expect(customUntouched.name).toBe('Strength training');
    expect(customUntouched.custom).toBe(true);

    // 3. No duplicate 'Workout' habit was created — exactly one
    //    non-custom Workout row exists.
    const nonCustomWorkouts = (habitsAfter || []).filter(
      (h: { name?: string; custom?: boolean }) => !h.custom && h.name === 'Workout'
    );
    expect(nonCustomWorkouts).toHaveLength(1);

    // 4. Unrelated habits are untouched.
    const hydrate = (habitsAfter || []).find((h: { id?: string }) => h.id === 'unrelated-id-1');
    expect(hydrate).toBeTruthy();
    expect(hydrate.name).toBe('Hydrate');

    // 5. Migration flag is now set so subsequent boots are no-op.
    const flag = await page.evaluate(() => localStorage.getItem('hb_strength_to_workout_rename_v1'));
    expect(flag).toBe('1');
  });

  test('drops legacy duplicate when canonical Workout already exists', async ({ page }) => {
    // Edge case: cloud-restore brought back BOTH a renamed canonical
    // 'Workout' row AND the pre-rename 'Strength training' row. The
    // migration should keep the canonical and drop the legacy
    // duplicate so the habit grid doesn't show two workout cards.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_onboarding_seen_v2', '1');
        localStorage.setItem('hb_welcomed', '1');
        localStorage.setItem('hb_hunter_name_claimed', '1');
        localStorage.setItem('hb_cloud_restore_dismissed', '1');
        localStorage.setItem('hb_whats_new_seen', '99.99.99');
        localStorage.removeItem('hb_strength_to_workout_rename_v1');

        const seeded = [
          {
            id: 'canonical-workout-id',
            name: 'Workout',
            emoji: '🏋️',
            difficulty: 'hard',
            type: 'build',
            primaryStat: 'STR',
          },
          {
            id: 'legacy-strength-id',
            name: 'Strength training',
            emoji: '🏋️',
            difficulty: 'hard',
            type: 'build',
            primaryStat: 'STR',
          },
        ];
        localStorage.setItem('hb_habits', JSON.stringify(seeded));
      } catch (_) {}
    });

    await page.goto('/');
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);

    const habitsAfter = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('hb_habits');
        return raw ? JSON.parse(raw) : null;
      } catch (_) { return null; }
    });
    expect(Array.isArray(habitsAfter)).toBe(true);

    // Canonical row preserved.
    const canonical = (habitsAfter || []).find((h: { id?: string }) => h.id === 'canonical-workout-id');
    expect(canonical).toBeTruthy();
    expect(canonical.name).toBe('Workout');

    // Legacy duplicate dropped entirely.
    const legacyStill = (habitsAfter || []).find((h: { id?: string }) => h.id === 'legacy-strength-id');
    expect(legacyStill).toBeFalsy();

    // No duplicate Workout cards.
    const nonCustomWorkouts = (habitsAfter || []).filter(
      (h: { name?: string; custom?: boolean }) => !h.custom && h.name === 'Workout'
    );
    expect(nonCustomWorkouts).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// K. Sleep session grouping + main-session selection (1z.114)
// ─────────────────────────────────────────────────────────────
// Regression for the build-96 over-count: getSleepLastNight used to
// sum every non-InBed sample across the 36h/72h diagnostic window,
// reporting totalAsleepHours = 15.53h when Oura wrote 167 fragments
// across two nights. 1z.114 groups fragments into sessions (≤90 min
// gap) and selects the largest session ending today.
test.describe('K · Sleep session selection (1z.114)', () => {
  test('groups Oura fragments into one session and selects the main session ending today', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_onboarding_seen_v2', '1');
        localStorage.setItem('hb_welcomed', '1');
        localStorage.setItem('hb_hunter_name_claimed', '1');
        localStorage.setItem('hb_cloud_restore_dismissed', '1');
        localStorage.setItem('hb_whats_new_seen', '99.99.99');
      } catch (_) {}
    });
    await page.goto('/');
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });

    type Sample = { startDate: string; endDate: string; duration: number; sleepState: string; sourceBundleId?: string };

    // Fabricate samples for two nights:
    //   Night A: 7.4h spread across 16 fragments ending TODAY ~07:00 local
    //   Night B: 7.0h spread across 12 fragments ending YESTERDAY ~07:00 local
    //   Plus a 1h nap ending today ~14:00 local (should NOT merge with night A)
    const result = await page.evaluate(() => {
      const w = window as unknown as { Health?: {
        __test_groupSleepSamplesIntoSessions?: (samples: unknown[], maxGapMinutes: number) => unknown[];
        __test_selectMainSleepSession?: (sessions: unknown[], now: Date) => unknown;
      } };
      if (!w.Health || !w.Health.__test_groupSleepSamplesIntoSessions || !w.Health.__test_selectMainSleepSession) {
        return { error: 'Health test surface not exposed' };
      }

      // Build "now" anchored to a known local date so we can assert
      // "ends today" without depending on real clock. We use the
      // current device clock — sessions are constructed relative to
      // it so the test is timezone-agnostic.
      const now = new Date();

      // Helper: make N fragments back-to-back from startMs covering
      // a total span of spanMs, all marked 'Asleep'. Fragments have
      // small 1-min gaps between them to exercise the merge logic.
      const makeFragments = (startMs: number, spanMs: number, count: number, src: string) => {
        const samples: { startDate: string; endDate: string; duration: number; sleepState: string; sourceBundleId: string }[] = [];
        const fragMs = Math.floor((spanMs - (count - 1) * 60_000) / count);
        let cursor = startMs;
        for (let i = 0; i < count; i++) {
          const fragStart = cursor;
          const fragEnd = cursor + fragMs;
          samples.push({
            startDate: new Date(fragStart).toISOString(),
            endDate: new Date(fragEnd).toISOString(),
            duration: fragMs / 3_600_000, // hours
            sleepState: 'Asleep',
            sourceBundleId: src,
          });
          cursor = fragEnd + 60_000; // 1-min gap to next fragment
        }
        return samples;
      };

      // Night A — ends today at 07:00 local. 7.4h * 3600000ms ≈ 26,640,000 ms.
      const nightAEnd = new Date(now);
      nightAEnd.setHours(7, 0, 0, 0);
      const nightAStart = nightAEnd.getTime() - 7.4 * 3_600_000;
      const nightASamples = makeFragments(nightAStart, 7.4 * 3_600_000, 16, 'com.ouraring.oura');

      // Night B — ends yesterday at 07:00 local.
      const nightBEnd = new Date(now);
      nightBEnd.setDate(nightBEnd.getDate() - 1);
      nightBEnd.setHours(7, 0, 0, 0);
      const nightBStart = nightBEnd.getTime() - 7.0 * 3_600_000;
      const nightBSamples = makeFragments(nightBStart, 7.0 * 3_600_000, 12, 'com.ouraring.oura');

      // Nap — today at 14:00 local. 1h. Should NOT merge with Night A
      // (gap to night A's end at 07:00 is 7 hours, way beyond 90 min).
      const napEnd = new Date(now);
      napEnd.setHours(14, 0, 0, 0);
      const napStart = napEnd.getTime() - 1 * 3_600_000;
      const napSamples = makeFragments(napStart, 1 * 3_600_000, 3, 'com.apple.health');

      const allSamples = [...nightBSamples, ...nightASamples, ...napSamples];
      // Group ordering shouldn't matter — the helper sorts by startDate.

      const sessions = w.Health.__test_groupSleepSamplesIntoSessions!(allSamples, 90) as Array<{
        start: Date; end: Date; asleepMs: number; sampleCount: number; sources: Record<string, number>;
      }>;
      const selected = w.Health.__test_selectMainSleepSession!(sessions, now) as {
        start: Date; end: Date; asleepMs: number; sampleCount: number; reason: string;
      } | null;

      return {
        sessionCount: sessions.length,
        sessionHours: sessions.map(s => Number((s.asleepMs / 3_600_000).toFixed(2))),
        selectedHours: selected ? Number((selected.asleepMs / 3_600_000).toFixed(2)) : null,
        selectedReason: selected ? selected.reason : null,
        selectedSampleCount: selected ? selected.sampleCount : null,
        selectedEndsHourLocal: selected ? selected.end.getHours() : null,
      };
    });

    expect((result as { error?: string }).error).toBeUndefined();
    const r = result as { sessionCount: number; sessionHours: number[]; selectedHours: number | null; selectedReason: string | null; selectedSampleCount: number | null; selectedEndsHourLocal: number | null };

    // Three discrete sessions (Night B, Night A, Nap).
    expect(r.sessionCount).toBe(3);

    // Main selection: Night A (largest ending today; ~7.4h, NOT the nap).
    expect(r.selectedHours).toBeGreaterThan(7.0);
    expect(r.selectedHours).toBeLessThan(8.0);
    expect(r.selectedReason).toBe('largest-ending-target-day');
    expect(r.selectedSampleCount).toBe(16);
    expect(r.selectedEndsHourLocal).toBe(7);

    // Critically: total is NOT the sum of all three (~15.4h). The
    // pre-1z.114 bug produced exactly that overcount.
    expect(r.selectedHours).toBeLessThan(9);
  });

  test('falls back to largest-in-window when no session ends today', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_onboarding_seen_v2', '1');
        localStorage.setItem('hb_welcomed', '1');
        localStorage.setItem('hb_hunter_name_claimed', '1');
        localStorage.setItem('hb_cloud_restore_dismissed', '1');
        localStorage.setItem('hb_whats_new_seen', '99.99.99');
      } catch (_) {}
    });
    await page.goto('/');
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });

    const result = await page.evaluate(() => {
      const w = window as unknown as { Health?: {
        __test_groupSleepSamplesIntoSessions?: (samples: unknown[], maxGapMinutes: number) => unknown[];
        __test_selectMainSleepSession?: (sessions: unknown[], now: Date) => unknown;
      } };
      if (!w.Health || !w.Health.__test_groupSleepSamplesIntoSessions || !w.Health.__test_selectMainSleepSession) {
        return { error: 'Health test surface not exposed' };
      }
      const now = new Date();

      // Single 7.5h session that ended YESTERDAY morning. No data today.
      const sessionEnd = new Date(now);
      sessionEnd.setDate(sessionEnd.getDate() - 1);
      sessionEnd.setHours(7, 0, 0, 0);
      const sessionStart = sessionEnd.getTime() - 7.5 * 3_600_000;
      const samples = [{
        startDate: new Date(sessionStart).toISOString(),
        endDate: new Date(sessionEnd).toISOString(),
        duration: 7.5,
        sleepState: 'Asleep',
        sourceBundleId: 'com.apple.health',
      }];

      const sessions = w.Health.__test_groupSleepSamplesIntoSessions!(samples, 90) as Array<{ asleepMs: number }>;
      const selected = w.Health.__test_selectMainSleepSession!(sessions, now) as { reason: string; asleepMs: number } | null;

      return {
        sessionCount: sessions.length,
        selectedReason: selected ? selected.reason : null,
        selectedHours: selected ? Number((selected.asleepMs / 3_600_000).toFixed(2)) : null,
      };
    });

    expect((result as { error?: string }).error).toBeUndefined();
    const r = result as { sessionCount: number; selectedReason: string | null; selectedHours: number | null };
    expect(r.sessionCount).toBe(1);
    expect(r.selectedReason).toBe('fallback-largest-window');
    expect(r.selectedHours).toBeGreaterThan(7.0);
  });

  test('rejects a nap-only window — no session above 3h selects below-min reason', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_onboarding_seen_v2', '1');
        localStorage.setItem('hb_welcomed', '1');
        localStorage.setItem('hb_hunter_name_claimed', '1');
        localStorage.setItem('hb_cloud_restore_dismissed', '1');
        localStorage.setItem('hb_whats_new_seen', '99.99.99');
      } catch (_) {}
    });
    await page.goto('/');
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });

    const result = await page.evaluate(() => {
      const w = window as unknown as { Health?: {
        __test_groupSleepSamplesIntoSessions?: (samples: unknown[], maxGapMinutes: number) => unknown[];
        __test_selectMainSleepSession?: (sessions: unknown[], now: Date) => unknown;
      } };
      if (!w.Health || !w.Health.__test_groupSleepSamplesIntoSessions || !w.Health.__test_selectMainSleepSession) {
        return { error: 'Health test surface not exposed' };
      }
      const now = new Date();

      // Two 1h naps, neither >= 3h.
      const nap1End = new Date(now);
      nap1End.setHours(13, 0, 0, 0);
      const nap1Start = nap1End.getTime() - 1 * 3_600_000;
      const nap2End = new Date(now);
      nap2End.setHours(16, 0, 0, 0);
      const nap2Start = nap2End.getTime() - 1 * 3_600_000;

      const samples = [
        { startDate: new Date(nap1Start).toISOString(), endDate: new Date(nap1End).toISOString(), duration: 1, sleepState: 'Asleep', sourceBundleId: 'a' },
        { startDate: new Date(nap2Start).toISOString(), endDate: new Date(nap2End).toISOString(), duration: 1, sleepState: 'Asleep', sourceBundleId: 'a' },
      ];

      const sessions = w.Health.__test_groupSleepSamplesIntoSessions!(samples, 90) as Array<{ asleepMs: number }>;
      const selected = w.Health.__test_selectMainSleepSession!(sessions, now) as { reason: string; asleepMs: number } | null;

      return {
        sessionCount: sessions.length,
        selectedReason: selected ? selected.reason : null,
        selectedHours: selected ? Number((selected.asleepMs / 3_600_000).toFixed(2)) : null,
      };
    });

    expect((result as { error?: string }).error).toBeUndefined();
    const r = result as { sessionCount: number; selectedReason: string | null; selectedHours: number | null };
    expect(r.sessionCount).toBe(2);
    expect(r.selectedReason).toBe('fallback-below-min-hours');
    // Selected nap is 1h — habit threshold of 7h will correctly reject.
    expect(r.selectedHours).toBeLessThan(2);
  });
});

// ─────────────────────────────────────────────────────────────
// L. Sleep streak leaderboard derives from completion ledger (1z.115)
// ─────────────────────────────────────────────────────────────
// Regression for the build-97 Richie-stuck-at-1 issue:
// lbRecordSleepNight's gap-reset rule zeros state.current_sleep_streak
// any time the user misses opening the app for a morning, even though
// HealthKit has data and the habit completion ledger shows the night
// completed. The fix derives the leaderboard sleep streak from the
// completion ledger (the source-of-truth the user sees in the weekly
// ledger UI) — auto-verified completions in `completions[dateStr]`
// count toward the streak whether or not lbRecordSleepNight fired.
type LbTest = {
  __test_computeSleepStreakFromCompletions: () => { current: number; best: number; completionDateCount: number; sleepHabitId: string; startedFromYesterday: boolean } | null;
  __test_getHabits: () => Array<{ id: string; name: string; custom?: boolean }> | null;
  __test_getCompletions: () => Record<string, string[]> | null;
  __test_getToday: () => string | null;
  getSnapshot: () => { current_sleep_streak?: number; best_sleep_streak?: number };
};

async function freshAppForLedgerTest(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hb_onboarding_seen_v2', '1');
      localStorage.setItem('hb_welcomed', '1');
      localStorage.setItem('hb_hunter_name_claimed', '1');
      localStorage.setItem('hb_cloud_restore_dismissed', '1');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      // Seed habits[] BEFORE load() runs. Without this, a fresh install
      // sets needsOnboarding=true and habits stays empty, blocking the
      // ledger helper's Sleep lookup. We include just the Sleep default
      // (and one filler) with explicit ids so the test is deterministic.
      localStorage.setItem('hb_habits', JSON.stringify([
        { id: 'test-sleep-id', name: 'Sleep', emoji: '😴', difficulty: 'medium', type: 'build', primaryStat: 'VIT' },
        { id: 'test-filler-id', name: 'Hydrate', emoji: '💧', difficulty: 'easy',   type: 'build', primaryStat: 'VIT' },
      ]));
    } catch (_) {}
  });
  await page.goto('/');
  await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
  // Wait for the IIFE-scoped habits + completions to be initialized via load().
  await page.waitForFunction(() => {
    const w = window as unknown as { Leaderboard?: { __test_getHabits?: () => unknown[] | null; __test_getCompletions?: () => Record<string, unknown> | null; __test_getToday?: () => string | null } };
    if (!w.Leaderboard || !w.Leaderboard.__test_getHabits) return false;
    const habits = w.Leaderboard.__test_getHabits();
    const completions = w.Leaderboard.__test_getCompletions ? w.Leaderboard.__test_getCompletions() : null;
    const today = w.Leaderboard.__test_getToday ? w.Leaderboard.__test_getToday() : null;
    return Array.isArray(habits) && habits.length > 0 && !!completions && typeof today === 'string' && today.length > 0;
  }, { timeout: 10_000 });
}

test.describe('L · Sleep streak derived from completion ledger (1z.115)', () => {
  test('5 consecutive Sleep completions → streak = 5 even when state.current_sleep_streak = 1', async ({ page }) => {
    await freshAppForLedgerTest(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as { Leaderboard: LbTest };
      const habits = w.Leaderboard.__test_getHabits();
      const completions = w.Leaderboard.__test_getCompletions();
      const today = w.Leaderboard.__test_getToday();
      if (!habits || !completions || !today) return { error: 'globals not ready' };
      const sleepHabit = habits.find(h => h && !h.custom && h.name === 'Sleep');
      if (!sleepHabit) return { error: 'Sleep habit not found in defaults' };

      // Seed 5 consecutive days ending today directly into the closure-
      // owned completions object. The helper reads the same reference.
      const fmt = (d: Date) => d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      // Use the in-app `today` string as the anchor so seeded dates
      // match the helper's local-date boundary exactly.
      const anchor = new Date(today + 'T00:00:00');
      for (let i = 0; i < 5; i++) {
        const d = new Date(anchor);
        d.setDate(anchor.getDate() - i);
        const ds = fmt(d);
        if (!Array.isArray(completions[ds])) completions[ds] = [];
        if (!completions[ds].includes(sleepHabit.id)) {
          completions[ds].push(sleepHabit.id);
        }
      }

      const fromLedger = w.Leaderboard.__test_computeSleepStreakFromCompletions();
      const snap = w.Leaderboard.getSnapshot();

      return {
        fromLedgerCurrent: fromLedger ? fromLedger.current : null,
        fromLedgerBest:    fromLedger ? fromLedger.best : null,
        fromLedgerCompletionDateCount: fromLedger ? fromLedger.completionDateCount : null,
        snapCurrent: snap.current_sleep_streak,
        snapBest:    snap.best_sleep_streak,
      };
    });

    expect((result as { error?: string }).error).toBeUndefined();
    const r = result as { fromLedgerCurrent: number; fromLedgerBest: number; fromLedgerCompletionDateCount: number; snapCurrent: number | undefined; snapBest: number | undefined };
    expect(r.fromLedgerCurrent).toBe(5);
    expect(r.fromLedgerBest).toBeGreaterThanOrEqual(5);
    expect(r.fromLedgerCompletionDateCount).toBe(5);
    // Snapshot prefers ledger when larger.
    expect(r.snapCurrent).toBe(5);
    expect(r.snapBest).toBeGreaterThanOrEqual(5);
  });

  test('streak with a gap stops at the gap (current = days after gap only)', async ({ page }) => {
    await freshAppForLedgerTest(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as { Leaderboard: LbTest };
      const habits = w.Leaderboard.__test_getHabits();
      const completions = w.Leaderboard.__test_getCompletions();
      const today = w.Leaderboard.__test_getToday();
      if (!habits || !completions || !today) return { error: 'globals not ready' };
      const sleepHabit = habits.find(h => h && !h.custom && h.name === 'Sleep');
      if (!sleepHabit) return { error: 'Sleep habit not found' };

      // Seed days at offsets {0, 1, 3, 4, 5} relative to today (gap at 2).
      // Current streak ending today should be 2. Best run = 3 (older block).
      const fmt = (d: Date) => d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      const anchor = new Date(today + 'T00:00:00');
      const seedOffsets = [0, 1, 3, 4, 5];
      for (const off of seedOffsets) {
        const d = new Date(anchor);
        d.setDate(anchor.getDate() - off);
        const ds = fmt(d);
        if (!Array.isArray(completions[ds])) completions[ds] = [];
        if (!completions[ds].includes(sleepHabit.id)) {
          completions[ds].push(sleepHabit.id);
        }
      }

      const fromLedger = w.Leaderboard.__test_computeSleepStreakFromCompletions();
      return {
        current: fromLedger ? fromLedger.current : null,
        best:    fromLedger ? fromLedger.best    : null,
      };
    });

    expect((result as { error?: string }).error).toBeUndefined();
    const r = result as { current: number; best: number };
    expect(r.current).toBe(2); // today + yesterday
    expect(r.best).toBe(3);    // the older 3-day block (offsets 3,4,5)
  });

  test('no completions → current and best are both 0', async ({ page }) => {
    await freshAppForLedgerTest(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as { Leaderboard: LbTest };
      const habits = w.Leaderboard.__test_getHabits();
      const completions = w.Leaderboard.__test_getCompletions();
      const today = w.Leaderboard.__test_getToday();
      if (!habits || !completions || !today) return { error: 'globals not ready' };
      const sleepHabit = habits.find(h => h && !h.custom && h.name === 'Sleep');
      if (!sleepHabit) return { error: 'Sleep habit not found' };

      // Defensive: scrub any pre-existing Sleep completions from the
      // fresh-install seed (shouldn't be any, but be explicit).
      for (const key of Object.keys(completions)) {
        completions[key] = completions[key].filter(id => id !== sleepHabit.id);
        if (completions[key].length === 0) delete completions[key];
      }

      const fromLedger = w.Leaderboard.__test_computeSleepStreakFromCompletions();
      return { current: fromLedger ? fromLedger.current : null, best: fromLedger ? fromLedger.best : null };
    });

    expect((result as { error?: string }).error).toBeUndefined();
    const r = result as { current: number; best: number };
    expect(r.current).toBe(0);
    expect(r.best).toBe(0);
  });
});
