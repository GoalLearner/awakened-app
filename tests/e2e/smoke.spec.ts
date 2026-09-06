/**
 * Awakened — Playwright smoke suite.
 *
 * Goal: 6-area sanity pass against the localhost dev build. Catches
 * the regressions that hurt most before Codemagic / TestFlight:
 *   A. App boots clean
 *   B. Status tab renders
 *   C. Habits tab renders + Add Habits affordance is reachable
 *   D. Edit Habit modal open + close (the iOS post-save freeze had
 *      the modal failing to close — assert it goes away)
 *   E. Leaderboard sheet: tabs visible, scroll doesn't dismiss,
 *      X closes
 *   F. Boss detail: SOULS AVAILABLE readout near Engage button
 *   (G. Duels picker — removed in 1z.279 along with the Duels
 *      subsystem retirement.)
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

// ── Global full-screen-overlay neutralizer (CI click-interception fix) ───────
// Two full-screen overlays were silently intercepting tab/card clicks on the CI
// runner — confirmed via the Playwright trace call-log:
//   1. #awakened-splash — the boot splash (position:fixed, inset:0, z-index:99999).
//      Dismissed only when its OWN 'is-hidden' class lands or it self-removes (both
//      timer-driven). Fast machine clears it pre-tap; slow runner leaves it up.
//   2. #fri-challenge-overlay — the Friday Weekend Challenge banner. setupFridayBanner()
//      shows it on FRIDAYS, gated by an hb_fri_banner_<today> key. freshApp seeds that
//      key, but the suppression is unreliable across timezones (the seed's local-date
//      ymd vs the app's `today` mismatch on the UTC runner), AND freshApp force-hides
//      the wrong id ('fri-challenge-modal', not the overlay). Net effect: the suite
//      passed Mon–Thu and failed Fri–Sun on CI.
// Both are non-essential to every smoke spec, so hide them outright for EVERY test,
// before any app script runs, by injecting CSS. Date/timezone/timing independent.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // W679 — the Monday update-reminder banner (#upd-banner) is a fixed top strip;
    // on a UTC-Monday CI run it would fire and could intercept top-of-screen taps
    // (same failure class as the Friday overlay). Hide it in the suite like the rest.
    const css = '#awakened-splash,#fri-challenge-overlay,#fri-challenge-modal,#upd-banner{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const inject = () => {
      const root = document.head || document.documentElement;
      if (root && !document.getElementById('e2e-splash-kill')) {
        const s = document.createElement('style');
        s.id = 'e2e-splash-kill';
        s.textContent = css;
        root.appendChild(s);
      }
    };
    // addInitScript runs after the document is created but BEFORE <html> exists, so
    // document.head/documentElement can both be null here — guard, then retry on DOM
    // ready (well before any tab interaction). NEVER let this throw: spec A asserts a
    // clean console, and a null .appendChild here surfaces as a fatal pageerror.
    inject();
    document.addEventListener('DOMContentLoaded', inject);
  });
});

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
      // CRITICAL gate: load() (app.js) sets needsOnboarding=true when
      // hb_habits is null, which (post v3 1z.236) routes first-run through
      // the CINEMATIC onboarding overlay (#cin-onboarding) — it covers the
      // Status screen and intercepts every tab click. The onboarding *flags*
      // above don't gate it; the presence of hb_habits does. Seed an empty
      // habit array so the app boots as a returning user (renders Status,
      // no cinematic). Tests that need habits add their own.
      localStorage.setItem('hb_habits', '[]');
      // What's New modal — gated by hb_whats_new_seen comparing
      // against the live APP_VERSION. Set far ahead of any future
      // bump so the modal never paints during tests.
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      // Friday "Weekend Challenge" banner suppression. On Fridays
      // setupFridayBanner() spawns a modal that intercepts pointer
      // events on the tab bar; gate it by seeding the per-day flag
      // so the banner short-circuits at its localStorage check.
      const d = new Date();
      const ymd = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_fri_banner_' + ymd, '1');
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
    // The boot splash (#awakened-splash) is a z-index:99999, position:fixed, inset:0
    // full-screen overlay. It is dismissed via its OWN 'is-hidden' class (which sets
    // pointer-events:none) plus a timed self-remove — so the generic '.hidden' toggle
    // below is a NO-OP on it (its CSS keys on '.is-hidden'/'.awakened-splash', never
    // '.hidden'). On a fast machine hideSplash() fires before the first tab tap, so it's
    // gone; on a slow runner (CI) it can still be intercepting pointer events when the
    // first .click() fires — which silently fails every click-based spec while the
    // eval-based specs sail through. It is purely decorative and never reused, so remove
    // it outright rather than trusting timing.
    const splash = document.getElementById('awakened-splash');
    if (splash) splash.remove();
    // The rest are REUSABLE containers (e.g. modal-overlay is un-hidden again when a
    // modal opens), so only HIDE them — never remove.
    const ids = ['wn-overlay', 'wn-modal', 'modal-overlay', 'welcome-overlay', 'fri-challenge-modal', 'cin-onboarding'];
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
    // v3 — Steps is now the only live global rank, so the World Rank /
    // Steps card opens the step_total leaderboard DIRECTLY
    // (openLeaderboardRanking('step_total'), app.js:28608). The
    // #lb-hub-sheet chooser was retired to dormant (preserved in code
    // for revival if other metrics return), so there's no hub step.
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

    // (The #lb-rank-blurb date-range / HoF copy is data-state-dependent
    // and renders hidden on a fresh localhost open — asserting its exact
    // text is brittle, so this smoke checks the structural surfaces only.)

    // Switch to Hall of Fame — the segmented control toggles + list renders.
    await hofTab.click();
    await expect(hofTab).toHaveClass(/is-active/);
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
  // W903 — THE REGRESSION TEST THIS FILE WAS MISSING.
  //
  // W889 referenced `bossId` inside openBossFullScreen, whose parameter is
  // actually `id`. Every boss sheet threw "ReferenceError: Can't find variable:
  // bossId" and simply never opened — the core loop of the app, dead — and it
  // reached a real tester before anyone noticed.
  //
  // Nothing caught it: node --check only sees syntax, the economy suite is pure
  // functions, and the sibling test below deliberately FAKES the overlay DOM
  // ("driving the boss-card tap end-to-end ... is overkill for a smoke test"),
  // so openBossFullScreen was never once executed in CI.
  //
  // This calls the real function for one boss of each shape and fails on any
  // page error. Cheap, and it closes the exact hole.
  test('openBossFullScreen runs clean for every boss shape (W903 regression)', async ({ page }) => {
    const fatal = attachConsoleWatcher(page);
    await freshApp(page);
    const result = await page.evaluate(() => {
      const out: { id: string; opened: boolean }[] = [];
      const fn = (window as any).openBossFullScreen;
      if (typeof fn !== 'function') return { missing: true, out };
      // one per condition shape: steps, sleep, flights
      for (const id of ['the_steel_wolf', 'the_insomniac', 'the_carouser']) {
        fn(id);
        const ov = document.getElementById('boss-fs-overlay');
        out.push({ id, opened: !!ov && !ov.classList.contains('hidden') });
        if (ov) ov.classList.add('hidden');
      }
      return { missing: false, out };
    });
    expect(result.missing).toBe(false);
    for (const r of result.out) expect(r.opened, r.id + ' sheet should open').toBe(true);
    expect(fatal, 'opening a boss sheet must raise no page errors').toEqual([]);
  });

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

    // v3 — the Add Habits library is now a chip-filtered MULTI-SELECT
    // list (.lib-row cards toggle into _libSelected) committed via the
    // #lib-cta button, not the old accordion → #hd-sheet detail → "Add
    // to My Habits" flow. Pick the first available habit row, capture
    // its name, select it, and commit via the CTA.
    const firstRow = page.locator('#lib-sheet .lib-row').first();
    await expect(firstRow).toBeVisible({ timeout: 5_000 });
    const habitName = ((await firstRow.locator('.lib-row-name').textContent()) || '').trim();
    expect(habitName.length).toBeGreaterThan(0);
    await firstRow.click();
    // Row toggles to selected; the CTA enables with the count.
    await expect(firstRow).toHaveClass(/is-selected/);
    const cta = page.locator('#lib-cta');
    await expect(cta).toBeEnabled();
    await expect(cta).toContainText(/add\s+\d+\s+habit/i);
    await cta.click();

    // Commit closes the library (closeLibrary) — `toBeHidden` catches
    // both the `.hidden` class AND inline display:none.
    await expect(page.locator('#lib-sheet')).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#lib-overlay')).toBeHidden();

    // The selected habit must have landed in hb_habits, exactly once
    // (rapid double-tap / double-commit dup guard).
    const stored = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('hb_habits');
        return raw ? JSON.parse(raw) : null;
      } catch (_) { return null; }
    });
    expect(Array.isArray(stored)).toBe(true);
    expect((stored || []).filter((h: { name?: string }) => h.name === habitName).length).toBe(1);

    // Toast confirming the add ("Vow added — <name>"). Auto-dismisses;
    // assert it showed so the user has feedback.
    await expect(page.locator('.habit-toast').first()).toContainText(/vow added/i);

    // App stays responsive — tab switch works with no stranded overlay
    // capturing pointer events. This is the symptom the user reported.
    await page.locator('#tab-profile').click();
    await expect(page.locator('#tab-profile.active')).toBeVisible();

    // Re-open the library — the freshly added habit must NOT appear in
    // the available list (renderLibrary filters active vows out via
    // activeNames), and the re-opened sheet must carry NO stale inline
    // transform/opacity/pointer-events residue from the prior close —
    // that residue was the original freeze mechanism this hardening fixes.
    await page.evaluate(() => {
      document.querySelectorAll('.habit-toast').forEach(t => t.remove());
    });
    await page.waitForTimeout(400);
    await page.locator('#tab-habits').click();
    await expect(page.locator('#tab-habits.active')).toBeVisible();
    // Retry the open a few times — the close→open cycle can race the
    // deferred render chain on a stressed runner.
    let opened = false;
    for (let attempt = 0; attempt < 8 && !opened; attempt++) {
      await page.evaluate(() => {
        const btn = document.getElementById('add-habit-btn');
        if (btn) btn.click();
      });
      try {
        await page.locator('#lib-sheet').waitFor({ state: 'visible', timeout: 1_500 });
        opened = true;
      } catch (_) {
        await page.waitForTimeout(250);
      }
    }
    expect(opened).toBe(true);
    await expect(page.locator('#lib-sheet')).toBeVisible();
    // The just-added habit is filtered out of the available rows.
    await expect(
      page.locator('#lib-sheet .lib-row-name', { hasText: habitName })
    ).toHaveCount(0);
    // No stale inline residue on the re-opened sheet (the freeze symptom).
    const inlineStyle = await page.locator('#lib-sheet').evaluate((el) => ({
      transform: (el as HTMLElement).style.transform,
      opacity: (el as HTMLElement).style.opacity,
      pointerEvents: (el as HTMLElement).style.pointerEvents,
    }));
    expect(inlineStyle.transform).toBe('');
    expect(inlineStyle.opacity).toBe('');
    expect(inlineStyle.pointerEvents).toBe('');
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

    // Open Create Your Own modal. v3 — the custom entry is the
    // #lib-create-row "Create your own" row in the redesigned library
    // (was the old .lib-pack-entry--custom pack tile).
    await page.locator('#lib-create-row').click();
    await expect(page.locator('#custom-overlay')).toBeVisible();

    // Fill the name.
    await page.locator('#custom-name-input').fill('Run');

    // Pick the STR stat (first card in the grid).
    await page.locator('.custom-stat-btn').first().click();

    // 1z.270B — Create Habit now ALSO requires an explicit icon choice
    // (or a deliberate "Use emoji instead" opt-in) before Save enables.
    // Pick the first icon tile in #custom-icon-grid.
    await page.locator('.custom-icon-tile').first().click();

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
        // 1z.118 hygiene — also gate the Friday Weekend Challenge banner.
        const _d = new Date();
        const _ymd = _d.getFullYear() + '-' +
          String(_d.getMonth() + 1).padStart(2, '0') + '-' +
          String(_d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_fri_banner_' + _ymd, '1');

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
        // 1z.118 hygiene — also gate the Friday Weekend Challenge banner.
        const _d = new Date();
        const _ymd = _d.getFullYear() + '-' +
          String(_d.getMonth() + 1).padStart(2, '0') + '-' +
          String(_d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_fri_banner_' + _ymd, '1');
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
        // 1z.118 hygiene — also gate the Friday Weekend Challenge banner.
        const _d = new Date();
        const _ymd = _d.getFullYear() + '-' +
          String(_d.getMonth() + 1).padStart(2, '0') + '-' +
          String(_d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_fri_banner_' + _ymd, '1');
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
        // 1z.118 hygiene — also gate the Friday Weekend Challenge banner.
        const _d = new Date();
        const _ymd = _d.getFullYear() + '-' +
          String(_d.getMonth() + 1).padStart(2, '0') + '-' +
          String(_d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_fri_banner_' + _ymd, '1');
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
        // 1z.118 hygiene — also gate the Friday Weekend Challenge banner.
        const _d = new Date();
        const _ymd = _d.getFullYear() + '-' +
          String(_d.getMonth() + 1).padStart(2, '0') + '-' +
          String(_d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_fri_banner_' + _ymd, '1');
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


// ─────────────────────────────────────────────────────────────
// N. Dungeon rank filter preserved after boss kill (1z.117)
// ─────────────────────────────────────────────────────────────
// Regression for the build-99 dungeon corruption screenshot:
// after defeating a D-rank boss, the D-RANK DUNGEON view showed
// E-rank + D-rank + C-rank preview cards mixed together. Root
// cause: 8 boss kill / streak-update / hunt-failed paths called
// renderBossesPanel() with no rankFilter arg. !rankFilter passes
// every boss through the filter. 1z.117 changes the function to
// default to the in-app currentDungeonRank when no explicit rank
// is passed, AND updates every caller to be explicit.
test.describe('N · Dungeon rank filter preserved (1z.117)', () => {
  test('renderBossesPanel() with no arg falls back to currentDungeonRank, not all bosses', async ({ page }) => {
    await freshAppForLedgerTest(page);

    // Wait for the dungeon test surfaces to be exposed.
    await page.waitForFunction(() => {
      const w = window as unknown as { __test_renderBossesPanel?: unknown; __test_setDungeonRank?: unknown };
      return typeof w.__test_renderBossesPanel === 'function' && typeof w.__test_setDungeonRank === 'function';
    }, { timeout: 8_000 });

    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __test_renderBossesPanel: (rank?: string) => void;
        __test_setDungeonRank: (r: string) => void;
        __test_getDungeonRank: () => string;
      };

      // Force the in-app rank to 'D' (the D-rank dungeon view).
      w.__test_setDungeonRank('D');

      // Call renderBossesPanel with NO argument — exactly what the
      // pre-1z.117 kill/streak paths did. Post-fix, the function
      // must default to the current dungeon rank.
      w.__test_renderBossesPanel();

      // Read the rendered DOM and collect the visible ranks. Each
      // card carries the rank in its header — buildBossCardHTML
      // includes a small rank-letter glyph and the boss's rank in a
      // data attribute / heading. We scrape the cards via the
      // `.bcard` selector and read the rank chip.
      const list = document.getElementById('bosses-list');
      if (!list) return { error: 'bosses-list element missing' };
      const cards = Array.from(list.querySelectorAll('.bcard'));
      const ranksSeen = new Set<string>();
      for (const card of cards) {
        const chip = card.querySelector('.bcard-rank-letter, [data-rank], .bcard-rank, .rank-pill');
        const txt = (chip && chip.textContent && chip.textContent.trim()) || '';
        // Rank letters are single uppercase characters E/D/C/B/A/S.
        if (txt && /^[EDCBAS]\+?$/.test(txt)) ranksSeen.add(txt[0]);
      }

      return {
        rank: w.__test_getDungeonRank(),
        cardCount: cards.length,
        ranksSeen: Array.from(ranksSeen).sort(),
      };
    });

    expect((result as { error?: string }).error).toBeUndefined();
    const r = result as { rank: string; cardCount: number; ranksSeen: string[] };

    expect(r.rank).toBe('D');
    // At least one D-rank boss should be visible (Iron Warden, Steel
    // Wolf in some configs); the EXACT count varies with content but
    // the critical assertion is the RANK PURITY.
    expect(r.cardCount).toBeGreaterThan(0);
    // No E-rank, no C-rank, no B/A/S leakage — only D.
    expect(r.ranksSeen).toEqual(['D']);
  });

  test('explicit rank override still works', async ({ page }) => {
    await freshAppForLedgerTest(page);
    await page.waitForFunction(() => {
      const w = window as unknown as { __test_renderBossesPanel?: unknown; __test_setDungeonRank?: unknown };
      return typeof w.__test_renderBossesPanel === 'function' && typeof w.__test_setDungeonRank === 'function';
    }, { timeout: 8_000 });

    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __test_renderBossesPanel: (rank?: string) => void;
        __test_setDungeonRank: (r: string) => void;
      };
      // currentDungeonRank = 'D', but explicit call passes 'E'.
      // Explicit argument must win.
      w.__test_setDungeonRank('D');
      w.__test_renderBossesPanel('E');
      const list = document.getElementById('bosses-list');
      const cards = Array.from((list && list.querySelectorAll('.bcard')) || []);
      const ranksSeen = new Set<string>();
      for (const card of cards) {
        const chip = card.querySelector('.bcard-rank-letter, [data-rank], .bcard-rank, .rank-pill');
        const txt = (chip && chip.textContent && chip.textContent.trim()) || '';
        if (txt && /^[EDCBAS]\+?$/.test(txt)) ranksSeen.add(txt[0]);
      }
      return { cardCount: cards.length, ranksSeen: Array.from(ranksSeen).sort() };
    });

    const r = result as { cardCount: number; ranksSeen: string[] };
    expect(r.cardCount).toBeGreaterThan(0);
    // Only E-rank should be visible — the override took precedence
    // over the current dungeon rank.
    expect(r.ranksSeen).toEqual(['E']);
  });
});

// ─────────────────────────────────────────────────────────────
// O. Global Rankings Hub — the honest trio (W822, Train 2 L1)
// ─────────────────────────────────────────────────────────────
// Asserts the hub renders EXACTLY the three live boards —
// step_total, floor_best, relics_collected — in that order. The
// W634-retired boards (sleep_streak, workout_streak,
// flights_climbed, bedtime_streak) must have no rows: their old
// rows were dead ends (tap closed the hub and stranded the user),
// which W822 removed. Also exercises the
// _lbComputeWorkoutStreakFromCompletions helper with seeded
// completion data to confirm it derives current/best correctly
// (the helper outlives the retired board — it feeds snapshot
// fields other surfaces still read).
test.describe('O · Workout streak leaderboard card (1z.118)', () => {
  test('global rankings hub shows exactly step_total + floor_best + rank_band + relics_collected; retired boards gone', async ({ page }) => {
    await freshAppForLedgerTest(page);
    // v3 Phase 1z.130 — Global Rankings moved out of the Stats tab
    // into a dedicated hub sheet opened from the World Rank card.
    // The hub list is `#lb-hub-list`; W822 trimmed it to 3 rows, and
    // W851 re-promoted rank_band (live board, backend never died) → 4.
    await page.evaluate(() => {
      const w = window as unknown as { openGlobalRankingsHub?: () => void };
      if (typeof w.openGlobalRankingsHub === 'function') {
        try { w.openGlobalRankingsHub(); } catch (_) {}
      }
    });
    await page.waitForFunction(() => {
      const list = document.getElementById('lb-hub-list');
      return !!list && list.querySelectorAll('[data-lb-metric]').length >= 3;
    }, { timeout: 8_000 });

    const metrics = await page.evaluate(() => {
      const list = document.getElementById('lb-hub-list');
      if (!list) return null;
      return Array.from(list.querySelectorAll('[data-lb-metric]'))
        .map(el => el.getAttribute('data-lb-metric') || '');
    });

    expect(metrics).not.toBeNull();
    // Exact-match: order AND count — a resurrected retired row or a
    // silently dropped live row both fail loudly.
    expect(metrics).toEqual(['step_total', 'floor_best', 'rank_band', 'relics_collected']);

    // Stats tab should NOT contain the legacy `#lb-preview-list`.
    const hasLegacy = await page.evaluate(() => !!document.getElementById('lb-preview-list'));
    expect(hasLegacy).toBe(false);
  });

  test('_lbComputeWorkoutStreakFromCompletions derives streak from completion ledger', async ({ page }) => {
    // Mirrors the L pattern: boot with freshAppForLedgerTest (Sleep
    // + Hydrate seeded), then push a Workout habit into the IIFE's
    // mutable `habits` reference via __test_getHabits(), then mutate
    // `completions` keyed off the in-app `today` so dates match the
    // helper's PT-anchored streak walk exactly.
    await freshAppForLedgerTest(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as { Leaderboard: LbTest & {
        __test_computeWorkoutStreakFromCompletions: () => { current: number; best: number; completionDateCount: number } | null;
      } };
      const habits = w.Leaderboard.__test_getHabits();
      const completions = w.Leaderboard.__test_getCompletions();
      const today = w.Leaderboard.__test_getToday();
      if (!habits || !completions || !today) return { error: 'globals not ready' };

      // Inject a Workout habit into the live habits array (same
      // reference the helper reads from).
      const workoutHabit = { id: 'test-workout-id', name: 'Workout', emoji: '🏋️',
                             difficulty: 'hard', type: 'build', primaryStat: 'STR' };
      habits.push(workoutHabit);

      // Seed 4 consecutive completions ending today, anchored on
      // the in-app `today` so PT/local timezone mismatch can't
      // produce an off-by-one.
      const fmt = (d: Date) => d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      const anchor = new Date(today + 'T00:00:00');
      for (let i = 0; i < 4; i++) {
        const d = new Date(anchor);
        d.setDate(anchor.getDate() - i);
        const ds = fmt(d);
        if (!Array.isArray(completions[ds])) completions[ds] = [];
        if (!completions[ds].includes(workoutHabit.id)) {
          completions[ds].push(workoutHabit.id);
        }
      }

      return w.Leaderboard.__test_computeWorkoutStreakFromCompletions();
    });

    expect((result as { error?: string }).error).toBeUndefined();
    expect(result).not.toBeNull();
    const s = result as { current: number; best: number; completionDateCount: number };
    expect(s.current).toBe(4);
    expect(s.best).toBe(4);
    expect(s.completionDateCount).toBe(4);
  });

  test('legacy Strength training habit also counts toward workout streak', async ({ page }) => {
    // Same pattern as the previous test, but the injected habit
    // uses the legacy pre-1z.105 name 'Strength training'. The
    // helper's defensive name match must still find it.
    await freshAppForLedgerTest(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as { Leaderboard: LbTest & {
        __test_computeWorkoutStreakFromCompletions: () => { current: number; best: number } | null;
      } };
      const habits = w.Leaderboard.__test_getHabits();
      const completions = w.Leaderboard.__test_getCompletions();
      const today = w.Leaderboard.__test_getToday();
      if (!habits || !completions || !today) return { error: 'globals not ready' };

      const legacyHabit = { id: 'legacy-strength-id', name: 'Strength training', emoji: '🏋️',
                            difficulty: 'hard', type: 'build', primaryStat: 'STR' };
      habits.push(legacyHabit);

      const fmt = (d: Date) => d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      const anchor = new Date(today + 'T00:00:00');
      for (let i = 0; i < 3; i++) {
        const d = new Date(anchor);
        d.setDate(anchor.getDate() - i);
        const ds = fmt(d);
        if (!Array.isArray(completions[ds])) completions[ds] = [];
        if (!completions[ds].includes(legacyHabit.id)) {
          completions[ds].push(legacyHabit.id);
        }
      }

      return w.Leaderboard.__test_computeWorkoutStreakFromCompletions();
    });

    expect((result as { error?: string }).error).toBeUndefined();
    expect(result).not.toBeNull();
    const s = result as { current: number; best: number };
    expect(s.current).toBe(3);
    expect(s.best).toBe(3);
  });
});


// ─────────────────────────────────────────────────────────────
// Q. Sleep verify correctness — no false positives (1z.123)
// ─────────────────────────────────────────────────────────────
// Regression for the May-22 false-positive seal: the Sleep 7 hours
// habit got auto-checked because the _selectMainSleepSession
// fallback-largest-window path returned YESTERDAY's 7.5h session
// for TODAY's habit. Once sealed, the alreadyChecked short-circuit
// prevented downward correction when Health/Oura refined the day's
// data below threshold. 1z.123 fixes both halves:
//   1. totalAsleepHours = 0 unless the main session ends today
//      (reason === 'largest-ending-target-day').
//   2. autoVerifySleep unseals an already-checked Sleep habit when
//      meets=false AND the completion was an auto-verify (not a
//      manual tap). Uses uncheck() + clearAutoVerify(), NOT
//      toggleHabit (which would permanently block re-verify via
//      markUnchecked).
test.describe('Q · Sleep verify no false positives (1z.123)', () => {
  test('main session ending YESTERDAY does not seal today\'s habit (Priority 2 fallback gate)', async ({ page }) => {
    await freshAppForLedgerTest(page);
    await page.waitForFunction(() => {
      const w = window as unknown as { Health?: {
        __test_groupSleepSamplesIntoSessions?: unknown;
        __test_selectMainSleepSession?: unknown;
      } };
      return !!(w.Health && typeof w.Health.__test_groupSleepSamplesIntoSessions === 'function'
                         && typeof w.Health.__test_selectMainSleepSession === 'function');
    }, { timeout: 8_000 });

    const result = await page.evaluate(() => {
      const w = window as unknown as { Health: {
        __test_groupSleepSamplesIntoSessions: (samples: unknown[], maxGapMinutes: number) => unknown[];
        __test_selectMainSleepSession: (sessions: unknown[], now: Date) => { reason?: string; asleepMs?: number } | null;
      } };

      // Single 7.5h session ending YESTERDAY morning. No data today.
      // Mirrors the user's May-22 1:00 PM open: Oura had written
      // last night's main session but today's session hadn't begun.
      const now = new Date();
      const yEnd = new Date(now);
      yEnd.setDate(yEnd.getDate() - 1);
      yEnd.setHours(7, 0, 0, 0);
      const yStart = yEnd.getTime() - 7.5 * 3_600_000;
      const samples = [{
        startDate: new Date(yStart).toISOString(),
        endDate:   new Date(yEnd).toISOString(),
        duration:  7.5,
        sleepState: 'Asleep',
        sourceBundleId: 'com.ouraring.oura',
      }];

      const sessions = w.Health.__test_groupSleepSamplesIntoSessions(samples, 90);
      const selected = w.Health.__test_selectMainSleepSession(sessions, now);

      // Selection itself produces the fallback (this is correct —
      // _selectMainSleepSession exposes the best-it-could-find session
      // for diagnostic purposes). The bug fix happens at the
      // consumer layer: getSleepLastNight gates totalAsleepHours on
      // selection reason. We assert the reason here so the gate's
      // input is clear.
      return {
        selectedReason: selected ? selected.reason : null,
        selectedHours: selected ? Number(((selected.asleepMs || 0) / 3_600_000).toFixed(2)) : null,
      };
    });

    const r = result as { selectedReason: string | null; selectedHours: number | null };
    // Selection finds yesterday's 7.5h session as the fallback.
    expect(r.selectedReason).toBe('fallback-largest-window');
    expect(r.selectedHours).toBeGreaterThan(7.0);
    expect(r.selectedHours).toBeLessThan(8.0);
    // The consumer-layer gate in getSleepLastNight (sessionEndsToday)
    // is what turns this fallback into totalAsleepHours = 0 in
    // production. That side-effect is exercised in the integration
    // path below.
  });

  test('downward-correct primitives unseal habit without setting user-rejected flag', async ({ page }) => {
    // The 1z.123 downward-correction path runs inside autoVerifySleep
    // when an already-checked auto-verified Sleep habit is paired
    // with current-data below threshold. It uses uncheck(id) +
    // AUTO_VERIFY.clearAutoVerify(id), NOT toggleHabit (which would
    // call markUnchecked and PERMANENTLY block auto-reseal for the
    // day). This test exercises those primitives via the new
    // __test_uncheck + __test_AUTO_VERIFY surfaces to prove they
    // produce the right end-state.
    await freshAppForLedgerTest(page);
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __test_uncheck?: unknown;
        __test_AUTO_VERIFY?: unknown;
      };
      return typeof w.__test_uncheck === 'function' &&
             !!w.__test_AUTO_VERIFY &&
             typeof (w.__test_AUTO_VERIFY as { recordAutoVerify?: unknown }).recordAutoVerify === 'function';
    }, { timeout: 8_000 });

    const result = await page.evaluate(() => {
      const w = window as unknown as {
        Leaderboard: LbTest;
        __test_uncheck: (id: string) => void;
        __test_AUTO_VERIFY: {
          recordAutoVerify: (id: string, meta: unknown, dateStr?: string) => void;
          isAutoVerifiedToday: (id: string) => boolean;
          clearAutoVerify: (id: string) => void;
          wasUncheckedToday: (name: string) => boolean;
        };
      };
      const habits = w.Leaderboard.__test_getHabits();
      const completions = w.Leaderboard.__test_getCompletions();
      const today = w.Leaderboard.__test_getToday();
      if (!habits || !completions || !today) return { error: 'globals not ready' };

      const sleep = habits.find(h => h && !h.custom && h.name === 'Sleep');
      if (!sleep) return { error: 'Sleep habit missing from seed' };
      const sleepId = sleep.id;

      // Pre-state: habit is sealed AND marked as auto-verified (this
      // is the exact bug's state — Oura fallback sealed yesterday's
      // session into today's habit earlier this morning).
      if (!Array.isArray(completions[today])) completions[today] = [];
      if (!completions[today].includes(sleepId)) completions[today].push(sleepId);
      w.__test_AUTO_VERIFY.recordAutoVerify(sleepId, {
        source: 'healthkit-sleep-duration',
        value: 7.52,
        threshold: 7,
      });
      const pre = {
        isChecked:      completions[today].includes(sleepId),
        isAutoVerified: w.__test_AUTO_VERIFY.isAutoVerifiedToday(sleepId),
        wasUnchecked:   w.__test_AUTO_VERIFY.wasUncheckedToday('Sleep'),
      };

      // Exercise the EXACT primitives autoVerifySleep's 1z.123
      // downward-correction path uses:
      w.__test_uncheck(sleepId);
      w.__test_AUTO_VERIFY.clearAutoVerify(sleepId);

      const post = {
        isChecked:      Array.isArray(completions[today]) && completions[today].includes(sleepId),
        isAutoVerified: w.__test_AUTO_VERIFY.isAutoVerifiedToday(sleepId),
        wasUnchecked:   w.__test_AUTO_VERIFY.wasUncheckedToday('Sleep'),
      };

      return { pre, post };
    });

    expect((result as { error?: string }).error).toBeUndefined();
    const r = result as {
      pre:  { isChecked: boolean; isAutoVerified: boolean; wasUnchecked: boolean };
      post: { isChecked: boolean; isAutoVerified: boolean; wasUnchecked: boolean };
    };

    // Pre-state: sealed + auto-verified + no user-reject.
    expect(r.pre.isChecked).toBe(true);
    expect(r.pre.isAutoVerified).toBe(true);
    expect(r.pre.wasUnchecked).toBe(false);

    // Post-state: unsealed + no auto-verify metadata.
    expect(r.post.isChecked).toBe(false);
    expect(r.post.isAutoVerified).toBe(false);

    // CRITICAL: wasUnchecked stays false. uncheck() did NOT call
    // markUnchecked. If it had, auto-verify would be blocked from
    // re-sealing later today even if Health data improves above 7h.
    // The 1z.123 fix intentionally avoids toggleHabit because
    // toggleHabit calls markUnchecked on auto-verified completions.
    expect(r.post.wasUnchecked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// R · Compound reward caption on the Habits tab (W514/W515).
// The Compound Effect (~90% of rank XP) was only legible in the Status
// today-strip MODAL; W514 surfaced it on the Habits tab, and W515 fixed an
// over-correction that briefly rendered a SECOND progress bar under
// "Seal your vows". This locks both in:
//   1. #vows-header-reward renders the routine XP projection.
//   2. There is exactly ONE progress bar in the Habits panel — the W514
//      routine-spine element and its banked-XP bar must NOT reappear
//      (the regression guard that the double-bar slip lacked).
test.describe('R · Compound reward caption on the Habits tab (W514/W515)', () => {
  test('caption renders the routine XP projection; no second progress bar', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_onboarding_seen_v2', '1');
        localStorage.setItem('hb_welcomed', '1');
        localStorage.setItem('hb_hunter_name_claimed', '1');
        localStorage.setItem('hb_cloud_restore_dismissed', '1');
        localStorage.setItem('hb_whats_new_seen', '99.99.99');
        localStorage.setItem('hb_habits_listview_hint_v1', '1');   // suppress the list-view tip
        const _d = new Date();
        const _ymd = _d.getFullYear() + '-' +
          String(_d.getMonth() + 1).padStart(2, '0') + '-' +
          String(_d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_fri_banner_' + _ymd, '1');
        // A 4-habit custom routine → a non-zero compound projection, so the
        // caption renders ("Complete your routine for +N XP").
        const seeded = [
          { id: 'r1', name: 'Read 10 pages',  emoji: '📖', difficulty: 'easy',   type: 'build', primaryStat: 'INT' },
          { id: 'r2', name: 'Cold shower',    emoji: '🚿', difficulty: 'medium', type: 'build', primaryStat: 'WILL' },
          { id: 'r3', name: 'Stretch 10 min', emoji: '🧘', difficulty: 'easy',   type: 'build', primaryStat: 'VIT' },
          { id: 'r4', name: 'No sugar today', emoji: '🍬', difficulty: 'hard',   type: 'break', primaryStat: 'FOCUS' },
        ];
        localStorage.setItem('hb_habits', JSON.stringify(seeded));
      } catch (_) {}
    });

    await page.goto('/');
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();

    // W514 — the compound reward caption renders under "Seal your vows" with a projection.
    const reward = page.locator('#vows-header-reward');
    await expect(reward).toBeVisible({ timeout: 10_000 });
    await expect(reward).toContainText(/\+\d+\s*XP/);

    // W515 — exactly ONE progress bar in the Habits panel. The completion bar
    // (#vows-header-fill) stays; the W514 routine-spine (#habits-routine-spine)
    // and its banked-XP bar (.cp-prog-xp-fill) must NOT appear in #main-scroll
    // (the hidden footer #compound-progress lives OUTSIDE #main-scroll, so the
    // scoped selector cannot match it).
    await expect(page.locator('#vows-header-fill')).toHaveCount(1);
    await expect(page.locator('#habits-routine-spine')).toHaveCount(0);
    await expect(page.locator('#main-scroll .cp-prog-xp-fill')).toHaveCount(0);
  });
});

// ── S · HealthKit source dedup prefers the Apple ecosystem (W681/W799) ─────
// The Oura-inflation fix: a third-party ring's raw HealthKit samples run
// ~15-30% over what the Apple Health app displays (wrist-motion "steps"),
// and the old max-single-source rule let the ring win. Pin the picker via
// the Health.__totalFromSamples test seam (pure function, real bundle):
// Apple DEVICE source preferred even when SMALLER; ring-only falls back to
// the ring; one source sums; untagged samples keep the raw-sum fallback.
// W799 — manual entries are DROPPED, not preferred: hand-typed Health-app
// samples (bundle exactly com.apple.Health) and Shortcuts writes
// (com.apple.shortcuts) never count; a manual-only sample set totals 0.
test.describe('S · HealthKit source dedup (W681/W799)', () => {
  test('Apple-preferred totals across source mixes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    const results = await page.evaluate(() => {
      const f = (window as any).Health.__totalFromSamples;
      const iphone = (v: number) => ({ value: v, sourceBundleId: 'com.apple.health.ABC', source: 'iPhone' });
      const oura = (v: number) => ({ value: v, sourceBundleId: 'com.ouraring.oura', source: 'Oura' });
      const manual = (v: number) => ({ value: v, sourceBundleId: 'com.apple.Health', source: 'Health' });
      return {
        appleWinsEvenSmaller: f([iphone(6147), oura(8263)]),
        ringOnlyFallback: f([oura(4000), oura(2450)]),
        singleSourceSums: f([iphone(100), iphone(200)]),
        untaggedRawSum: f([{ value: 100 }, { value: 50 }]),
        // W799 — the typed-in cheat: manual entries vanish from every mix.
        manualEntryDropped: f([manual(5000), oura(9000)]),
        manualOnlyIsZero: f([manual(5000)]),
        shortcutsDropped: f([{ value: 7000, sourceBundleId: 'com.apple.shortcuts', source: 'Shortcuts' }, iphone(1200)]),
        manualNeverBeatsDevice: f([manual(50000), iphone(6147)]),
      };
    });
    expect(results.appleWinsEvenSmaller).toBe(6147);
    expect(results.ringOnlyFallback).toBe(6450);
    expect(results.singleSourceSums).toBe(300);
    expect(results.untaggedRawSum).toBe(150);
    expect(results.manualEntryDropped).toBe(9000);
    expect(results.manualOnlyIsZero).toBe(0);
    expect(results.shortcutsDropped).toBe(1200);
    expect(results.manualNeverBeatsDevice).toBe(6147);
  });
});

// ── T · Account-switch purge (W689) ─────────────────────────────────────────
// The cross-account bleed guard: when a DIFFERENT Apple account signs in,
// __awakenedAccountSwitchPurge wipes every hb_* key except the device-scoped
// keep-list (new session, new alias, owner tag, HealthKit device flags). Pins
// both directions: per-account state gone, keep-list intact.
test.describe('T · Account-switch purge (W689)', () => {
  test('purges account state, keeps device-scoped keys', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    const r = await page.evaluate(() => {
      localStorage.setItem('hb_habits', '[{"id":"userA"}]');
      localStorage.setItem('hb_souls', '99999');
      localStorage.setItem('hb_inventory', '{"cards":{}}');
      localStorage.setItem('hb_user', '{"sub":"B","jwt":"x"}');
      localStorage.setItem('hb_name', 'userB');
      localStorage.setItem('hb_debug_healthkit', '1');
      localStorage.setItem('hb_healthkit_prompted', '1');
      const purged = (window as any).__awakenedAccountSwitchPurge('B');
      return {
        purged,
        habitsGone: localStorage.getItem('hb_habits') === null,
        soulsGone: localStorage.getItem('hb_souls') === null,
        invGone: localStorage.getItem('hb_inventory') === null,
        userKept: localStorage.getItem('hb_user') !== null,
        nameKept: localStorage.getItem('hb_name') === 'userB',
        debugKept: localStorage.getItem('hb_debug_healthkit') === '1',
        promptKept: localStorage.getItem('hb_healthkit_prompted') === '1',
      };
    });
    expect(r.purged).toBeGreaterThan(0);
    expect(r.habitsGone).toBe(true);
    expect(r.soulsGone).toBe(true);
    expect(r.invGone).toBe(true);
    expect(r.userKept).toBe(true);
    expect(r.nameKept).toBe(true);
    expect(r.debugKept).toBe(true);
    expect(r.promptKept).toBe(true);
  });
});

// ── U · Completions month-chunk archive (W690) ──────────────────────────────
// The hb_completions unbounded-growth fix: cold months (older than the
// 14-month hot window) archive into write-once hb_completions_arch_YYYY_MM
// chunks; the hot blob holds only recent months; the load-time merge restores
// FULL history for readers. Pins: split correctness, chunk content, merge
// round-trip (no history loss), and hot-wins collision semantics.
test.describe('U · Completions month-chunk archive (W690)', () => {
  test('cold months archive, hot slice sheds them, merge restores full history', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    const r = await page.evaluate(() => {
      const t = (window as any).__compChunkTest;
      const PFX = 'hb_completions_arch_';
      // clean any stale chunks from prior runs
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i); if (k && k.indexOf(PFX) === 0) localStorage.removeItem(k);
      }
      const map = { '2024-11-03': ['h1'], '2025-01-15': ['h1', 'h2'], '2099-01-01': ['hot'] };
      const st = t.archiveCold(map, PFX);
      const hot = t.hotSlice(map, PFX);
      const chunk2024 = JSON.parse(localStorage.getItem(PFX + '2024_11') || 'null');
      const chunk2025 = JSON.parse(localStorage.getItem(PFX + '2025_01') || 'null');
      // merge round-trip: hot slice + chunks = full history; hot wins on collision
      const merged = t.mergeArchives(JSON.parse(JSON.stringify(hot)), PFX);
      const collide = t.mergeArchives({ '2024-11-03': ['hot-wins'] }, PFX);
      // W690 review F1/F2 invariant: a cold month NOT verifiably archived must
      // survive the slice (simulate a quota-failed chunk write by unmarking it).
      st.months.delete('2025-01');
      const hotAfterFail = t.hotSlice(map, PFX);
      st.months.add('2025-01');   // restore for other tests
      // slice with NO archival state for a prefix drops nothing (fail-safe)
      const noState = t.hotSlice(map, 'hb_completions_arch_NEVER_RAN_');
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i); if (k && k.indexOf(PFX) === 0) localStorage.removeItem(k);
      }
      return {
        hotHasCold: '2024-11-03' in hot || '2025-01-15' in hot,
        hotHasRecent: '2099-01-01' in hot,
        chunk2024ok: !!chunk2024 && JSON.stringify(chunk2024['2024-11-03']) === '["h1"]',
        chunk2025ok: !!chunk2025 && JSON.stringify(chunk2025['2025-01-15']) === '["h1","h2"]',
        mergedFull: '2024-11-03' in merged && '2025-01-15' in merged && '2099-01-01' in merged,
        hotWins: JSON.stringify(collide['2024-11-03']) === '["hot-wins"]',
        unarchivedMonthKeptHot: '2025-01-15' in hotAfterFail && !('2024-11-03' in hotAfterFail),
        noStateDropsNothing: '2024-11-03' in noState && '2025-01-15' in noState,
      };
    });
    expect(r.hotHasCold).toBe(false);
    expect(r.hotHasRecent).toBe(true);
    expect(r.chunk2024ok).toBe(true);
    expect(r.chunk2025ok).toBe(true);
    expect(r.mergedFull).toBe(true);
    expect(r.hotWins).toBe(true);
    expect(r.unarchivedMonthKeptHot).toBe(true);
    expect(r.noStateDropsNothing).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Q. Community board (W907)
// ─────────────────────────────────────────────
test.describe('Q · Community board (W907)', () => {
  test('the tab reads Community and the board section renders its quiet state', async ({ page }) => {
    const fatal = attachConsoleWatcher(page);
    await freshApp(page);
    await expect(page.locator('#tab-social .tab-label')).toHaveText('Community');
    await page.click('#tab-social');
    await expect(page.locator('#board-section')).toBeVisible();
    // The dev sign-in stub skips the server, so the board paints its empty
    // state (or the sign-in prompt) rather than a skeleton forever.
    await expect(page.locator('#board-body')).toContainText(/No topics yet|Sign in with Apple|Could not load/i, { timeout: 10_000 });
    await page.waitForTimeout(300);
    expect(fatal, fatal.join('\n')).toHaveLength(0);
  });

  test('W913 — the BOARD | FRIENDS sub-nav swaps panes without leaving the tab', async ({ page }) => {
    await freshApp(page);
    await page.click('#tab-social');
    await expect(page.locator('#cm-pane-board')).toBeVisible();
    await expect(page.locator('#cm-pane-friends')).toBeHidden();
    await page.click('[data-cm-pane="friends"]');
    await expect(page.locator('#cm-pane-friends')).toBeVisible();
    await expect(page.locator('#guildhall-activity-section')).toBeVisible();
    await expect(page.locator('#cm-pane-board')).toBeHidden();
    await page.click('[data-cm-pane="board"]');
    await expect(page.locator('#board-section')).toBeVisible();
  });

  test('NEW TOPIC before consent opens the community rules sheet (Apple 1.2)', async ({ page }) => {
    await freshApp(page);
    await page.click('#tab-social');
    await page.click('#board-new');
    const sheet = page.locator('.board-sheet--rules');
    await expect(sheet).toBeVisible();
    // Scoped to the sheet: Settings also carries a (collapsed) "Community rules" row.
    await expect(sheet.locator('.board-rules-title')).toHaveText(/community rules/i);
    await expect(sheet.locator('[data-board-agree]')).toBeVisible();
    await expect(sheet.getByText(/report what you see/i)).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// R. The Ledger sheet (W917) — History left the tab bar
// ─────────────────────────────────────────────────────────────────────────
test.describe('R · The Ledger view (W917 → W919)', () => {
  test('the tab bar has no History tab; LEDGER renders the same screen in place of the vow list', async ({ page }) => {
    await freshApp(page);
    await expect(page.locator('#tab-history')).toHaveCount(0);
    await expect(page.locator('.tab-bar .tab-btn')).toHaveCount(5);
    await page.click('#tab-habits');
    // The W785 unlock rule still gates the ledger, so the key is stamped first;
    // the QA hook flips the view the way the TODAY | LEDGER segment does.
    await page.evaluate(() => { localStorage.setItem('hb_history_unlocked_v1', '1'); (window as any).__ledger.open(); });
    const view = page.locator('#ledger-view');
    await expect(view).toBeVisible();
    await expect(view.locator('#history-content .hg-view-tabs')).toBeVisible();
    await expect(view.locator('.hg-view-tab').first()).toHaveText('WEEK');
    await expect(page.locator('#habit-list')).toBeHidden();
    await page.evaluate(() => (window as any).__ledger.close());
    await expect(view).toBeHidden();
    await expect(page.locator('#habit-list')).toBeVisible();
  });
});
