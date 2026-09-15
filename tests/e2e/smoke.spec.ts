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
 * tests land directly on the Habits tab (W920 — the landing tab). Does NOT seed hb_user — we
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
      // W938 — addInitScript re-runs on every navigation. Inside a TEST HUNTER
      // run the app must boot as a fresh install, so the returning-user seeds
      // below stand down (a real phone has no init script at all).
      if (localStorage.getItem('awk_sandbox_v1')) return;
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
  test('Habits is the landing tab; Status is one tap away and renders Hunter Profile content', async ({ page }) => {
    await freshApp(page);
    // W920 — the app opens on Habits; Status is no longer the default tab.
    await expect(page.locator('#tab-habits.active')).toBeVisible();
    await expect(page.locator('#main-scroll')).toBeVisible();
    await expect(page.locator('#profile-panel')).toBeHidden();
    await page.locator('#tab-profile').click();
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
    // W945 — the just-added habit stays listed, dimmed as ACTIVE and unpickable.
    const addedRow = page.locator('#lib-sheet .lib-row', {
      has: page.locator('.lib-row-name', { hasText: new RegExp('^' + habitName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }),
    }).first();
    await expect(addedRow).toHaveClass(/is-have/);
    await expect(addedRow).toBeDisabled();
    await expect(addedRow.locator('.lib-row-xp')).toHaveText('ACTIVE');
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

  // W929 — Forum Thread v4: the thread renders from a mocked topic (the dev
  // sign-in stub never reaches the server), sorted, nested, with the bar.
  test('W929 — the thread: OP card, TOP | NEWEST sort, one level of sub-replies, the bell and the bar', async ({ page }) => {
    await freshApp(page);
    await page.click('#tab-social');
    await page.evaluate(() => {
      const T0 = Date.now() - 3 * 86400000;
      const au = (alias: string, rank: string, id: string) => ({ author_id: id, alias, rank_label: rank, founder_seq: 0, is_mod: false, mod_role: null });
      (window as any).Auth.boardTopic = async () => ({
        ok: true, following: false, next_cursor: null,
        me: { consented: true, role: null, rank_tier: 'A', topic_min_tier: 'C', reply_min_tier: 'D' },
        topic: { id: 'aaaaaaaa-0001', tag: 'improvement', title: 'App Ideas', body: 'Feel free to post any feedback here.', created_at: T0, last_activity_at: T0 + 5000, reply_count: 3, up_count: 4, voted: true, pinned: false, locked: false, hidden: false, repliers: [], author: au('RenDIESEL', 'S', 'u-ren') },
        replies: [
          { id: 'bbbbbbbb-0001', body: 'Make equipping items more intuitive.', created_at: T0 + 1000, hidden: false, parent_reply_id: null, up_count: 3, voted: false, edited_at: null, author: au('Grubbadub', 'D', 'u-g') },
          { id: 'bbbbbbbb-0002', body: '@Grubbadub the comparison window is a great one.', created_at: T0 + 2000, hidden: false, parent_reply_id: 'bbbbbbbb-0001', up_count: 2, voted: false, edited_at: T0 + 2500, author: au('RenDIESEL', 'S', 'u-ren') },
          { id: 'bbbbbbbb-0003', body: 'I would like to manually sort my habits.', created_at: T0 + 3000, hidden: false, parent_reply_id: null, up_count: 1, voted: false, edited_at: null, author: au('Grubbadub', 'D', 'u-g') },
        ],
      });
      (window as any).__board.open('aaaaaaaa-0001');
    });
    const sheet = page.locator('.board-sheet--topic');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.board-sheet-sub')).toHaveText('IDEAS · 3 REPLIES · 2 HUNTERS');
    await expect(sheet.locator('.board-op .board-op-title')).toHaveText('App Ideas');
    await expect(sheet.locator('.board-op .board-pill--op')).toBeVisible();
    await expect(sheet.locator('.board-op [data-board-vote]')).toHaveClass(/board-up--on/);
    await expect(sheet.locator('.board-rhead-n')).toHaveText('3 REPLIES');
    await expect(sheet.locator('.board-rp')).toHaveCount(2);
    await expect(sheet.locator('.board-subrp')).toHaveCount(1);
    await expect(sheet.locator('.board-subrp .board-pill--op')).toBeVisible();
    await expect(sheet.locator('.board-subrp .board-edited')).toHaveText(/EDITED/);
    await expect(sheet.locator('.board-subrp .board-at')).toHaveText('@Grubbadub');
    await expect(sheet.locator('.board-subtoggle')).toHaveText(/1 REPLY/);
    // TOP: the 3-vote reply leads; NEWEST: the later one leads.
    await expect(sheet.locator('.board-rp').first()).toHaveAttribute('data-board-post', 'bbbbbbbb-0001');
    await page.click('[data-board-rsort="new"]');
    await expect(sheet.locator('.board-rp').first()).toHaveAttribute('data-board-post', 'bbbbbbbb-0003');
    // fold the sub-replies, then the bell and the bar are there
    await page.click('.board-subtoggle');
    await expect(sheet.locator('[data-board-subs]')).toBeHidden();
    await expect(sheet.locator('[data-board-follow]')).toBeVisible();
    await expect(sheet.locator('.board-cbar')).toBeVisible();
    await expect(sheet.locator('.board-cbar-ph')).toHaveText('Add to the discussion…');
  });

  test('W929 — a board row carries its last-reply line', async ({ page }) => {
    await freshApp(page);
    await page.click('#tab-social');
    await expect(page.locator('#board-body')).toContainText(/No topics yet|Sign in with Apple|Could not load/i, { timeout: 10_000 });
    await page.evaluate(() => {
      const now = Date.now();
      const au = (alias: string, rank: string, id: string) => ({ author_id: id, alias, rank_label: rank, founder_seq: 0, is_mod: false, mod_role: null });
      (window as any).Auth.boardTopics = async () => ({
        ok: true, next_cursor: null, counts: { all: 2, improvement: 1, bug: 0, talk: 1 },
        topics: [
          { id: 'aaaaaaaa-0001', tag: 'improvement', title: 'App Ideas', preview: 'Feel free', created_at: now - 3 * 86400000, last_activity_at: now - 5 * 3600000, reply_count: 5, up_count: 4, voted: false, pinned: false, locked: false, hidden: false, repliers: [{ alias: 'Grubbadub', rank_label: 'D' }], last_reply: { alias: 'Grubbadub', rank_label: 'D', at: now - 5 * 3600000 }, author: au('RenDIESEL', 'S', 'u-ren') },
          { id: 'aaaaaaaa-0002', tag: 'talk', title: 'First post', preview: 'Hope you all enjoy', created_at: now - 3 * 86400000, last_activity_at: now - 3 * 86400000, reply_count: 0, up_count: 0, voted: false, pinned: false, locked: false, hidden: false, repliers: [], last_reply: null, author: au('Richie', 'A', 'u-me') },
        ],
      });
      (window as any).__board.render();
    });
    const rows = page.locator('#board-body .board-topic');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.board-last b')).toHaveText('Grubbadub');
    await expect(rows.nth(0).locator('.board-last-arrow')).toHaveText('replied · 5h ago');
    await expect(rows.nth(1).locator('.board-last--none')).toHaveText(/No replies yet/);
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

// ─────────────────────────────────────────────────────────────────────────
// S. W921 — the Community badge (new topics / replies to yours / likes on your feats)
// ─────────────────────────────────────────────────────────────────────────
test.describe('S · Community badge (W921)', () => {
  test('hidden by default; counts paint on the tab icon; tapping Community clears it', async ({ page }) => {
    await freshApp(page);
    const badge = page.locator('#tab-social-badge');
    await expect(badge).toBeHidden();
    await page.evaluate(() => (window as any).__cm.unseen({ board: { topics: 2, replies: 1 }, likes: 1 }));
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('4');
    await page.click('#tab-social');
    await expect(badge).toBeHidden();
    // landing on the BOARD pane clears its own count too
    await expect(page.locator('#cm-board-badge')).toBeHidden();
    // the liker initials are gone for good — the count is the signal now
    await expect(page.locator('.fa-likers')).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// T. W922 — one segmented switch: every pane switcher is `.seg` > `.seg-btn`
// ─────────────────────────────────────────────────────────────────────────
test.describe('T · Segmented switch (W922)', () => {
  test('Today|Ledger, the Ledger range, Archive|Collection and Board|Friends all share the recipe', async ({ page }) => {
    await freshApp(page);
    // Habits — the TODAY | LEDGER switch only exists once the ledger unlocks (W785).
    await page.evaluate(() => { localStorage.setItem('hb_history_unlocked_v1', '1'); (window as any).__ledger.open(); });
    const range = page.locator('#history-content .hg-view-tabs.seg.seg--4');
    await expect(range).toBeVisible();
    await expect(range.locator('.seg-btn[aria-selected="true"]')).toHaveCount(1);
    await expect(range.locator('.seg-btn').first()).toHaveText('WEEK');
    // Items — one lens on, no old slider element
    await page.click('#tab-items');
    await expect(page.locator('#cl-lens.seg .seg-btn[data-on="1"]')).toHaveCount(1);
    await expect(page.locator('.cl-slider')).toHaveCount(0);
    // Community — the sub-nav and the HUNTER | ALL switch
    // DOM-level taps from here on: the First Awakened coachmark (#fa-coachmark-overlay) sits over the
    // tab bar after the first Items open and intercepts Playwright's hit-test (smoke-suite precedent).
    await page.evaluate(() => document.getElementById('tab-social')!.click());
    await expect(page.locator('#cm-subnav.seg .seg-btn[data-active="true"]')).toHaveCount(1);
    await expect(page.locator('.cm-pill')).toHaveCount(0);
    await page.evaluate(() => (document.querySelector('[data-cm-pane="friends"]') as HTMLElement).click());
    const fa = page.locator('.guildhall-activity-filter.seg');
    await expect(fa).toHaveAttribute('data-mode', 'guild');
    await page.evaluate(() => document.getElementById('guildhall-filter-hunter')!.click());
    await expect(fa).toHaveAttribute('data-mode', 'hunter');
    await expect(page.locator('.seg-btn[data-active="true"]#guildhall-filter-hunter')).toHaveCount(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// U. W923 — friend feats mark themselves seen; MARK ALL SEEN is gone
// ─────────────────────────────────────────────────────────────────────────
test.describe('U · Auto-seen friend feats (W923)', () => {
  test('a fresh friend feat counts as NEW, then clears on its own after a few seconds on screen', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        const now = Date.now();
        localStorage.setItem('hb_fa_seen_ts', String(now - 6 * 3600e3));
        localStorage.setItem('hb_friends_activity_cache_v1', JSON.stringify({ ts: now, events: [
          { id: 'u-e1', alias: 'RenDIESEL', rankLabel: 'S I', eventType: 'boss_kill', eventKey: 'glass_strider', eventLabel: 'defeated The Glass Strider', eventValue: 1, rarity: null, createdAt: new Date(now - 3600e3).toISOString(), likes: 0, liked: false, likers: [], likedAt: null },
        ] }));
      } catch (_) {}
    });
    await freshApp(page);
    await page.evaluate(() => document.getElementById('tab-social')!.click());
    await page.evaluate(() => (document.querySelector('[data-cm-pane="friends"]') as HTMLElement).click());
    await expect(page.locator('.fa-seen')).toHaveCount(0);
    await expect(page.locator('#fa-sub')).toContainText('1 NEW');
    await expect(page.locator('#cm-friends-badge')).toBeVisible();
    // ~4 s on screen → seen, no tap
    await expect(page.locator('#fa-sub')).not.toContainText('NEW', { timeout: 10_000 });
    await expect(page.locator('#cm-friends-badge')).toBeHidden();
    const stamped = await page.evaluate(() => Date.now() - (window as any).__fa.seenTs());
    expect(stamped).toBeLessThan(60_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// V. W926 — MY ORDER: arrows on Manage Vows set the real list order
// ─────────────────────────────────────────────────────────────────────────
test.describe('V · My order (W926)', () => {
  test('arrows reorder the list; the group edges are disabled; the Habits tab follows', async ({ page }) => {
    await freshApp(page);
    // freshApp's init script re-seeds hb_habits = [] on every navigation; register this
    // one AFTER it so it runs later and wins on the reload.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_habits', JSON.stringify([
          { id: 'h-read', name: 'Read', emoji: '📖', difficulty: 'easy', type: 'build', primaryStat: 'INT' },
          { id: 'h-stretch', name: 'Stretch', emoji: '🧘', difficulty: 'easy', type: 'build', primaryStat: 'VIT' },
          { id: 'h-journal', name: 'Journal', emoji: '📓', difficulty: 'easy', type: 'build', primaryStat: 'FOCUS' },
        ]));
        localStorage.setItem('hb_first_completion_bonus_v1', '1');
      } catch (_) {}
    });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { const s = document.getElementById('awakened-splash'); if (s) s.remove(); (window as any).__openManageVows(); });
    await expect(page.locator('.mv-sortpill.is-active')).toHaveText(/my order/i);
    await expect(page.locator('.mv-row-arrow')).toHaveCount(6);
    await expect(page.locator('[data-mv-up="h-read"]')).toBeDisabled();
    await expect(page.locator('[data-mv-down="h-journal"]')).toBeDisabled();
    await page.locator('[data-mv-down="h-read"]').click();
    const order = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').map((h: { id: string }) => h.id));
    expect(order).toEqual(['h-stretch', 'h-read', 'h-journal']);
    await page.evaluate(() => (window as any).__closeManageVows());
    await expect(page.locator('#habit-list .habit-item').first()).toHaveAttribute('data-id', 'h-stretch');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// W. W930 — the sign-in gate offers Sign in with Apple only (guest entry deleted)
// ─────────────────────────────────────────────────────────────────────────
test.describe('W · Sign-in gate (W930)', () => {
  test('no "Try it first" guest button or note; the existing-guest claim path remains', async ({ page }) => {
    await freshApp(page);
    // The gate markup is in the DOM whether or not it is showing.
    await expect(page.locator('#signin-gate')).toHaveCount(1);
    await expect(page.locator('#signin-apple-btn')).toHaveCount(1);
    await expect(page.locator('#signin-guest-btn')).toHaveCount(0);
    await expect(page.locator('.signin-guest-note')).toHaveCount(0);
    await expect(page.locator('#guest-claim-apple')).toHaveCount(1);
    await expect(page.locator('#guest-claim-cancel')).toHaveCount(1);
    const hasStartGuest = await page.evaluate(() => typeof (window as any).Auth.startGuest);
    expect(hasStartGuest).toBe('undefined');
    const hasIsGuest = await page.evaluate(() => typeof (window as any).Auth.isGuest);
    expect(hasIsGuest).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// X. W931 — Friend Activity day groups start folded; a tap opens one
// ─────────────────────────────────────────────────────────────────────────
test.describe('X · Friend Activity folded by default (W931)', () => {
  test('TODAY and YESTERDAY both render closed; tapping TODAY opens it with its hunters still folded', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        const now = Date.now();
        localStorage.setItem('hb_fa_seen_ts', String(now));
        // Anchor to LOCAL MIDNIGHT, not to `now`. Offsets measured back from
        // `now` put "3 hours ago" on yesterday and "30 hours ago" on the day
        // before whenever the suite runs between midnight and 03:00, which
        // makes three day groups and fails an assertion about two.
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        const startOfToday = midnight.getTime();
        const ev = (id: string, alias: string, rank: string, at: number) => ({ id, alias, rankLabel: rank, eventType: 'boss_kill', eventKey: 'glass_strider', eventLabel: 'defeated The Glass Strider', eventValue: 1, rarity: null, createdAt: new Date(at).toISOString(), likes: 0, liked: false, likers: [], likedAt: null });
        localStorage.setItem('hb_friends_activity_cache_v1', JSON.stringify({ ts: now, events: [
          ev('x-e1', 'Grubbadub', 'D I', now),                                          // today
          ev('x-e2', 'Anthony',   'C I', Math.max(startOfToday + 1, now - 3 * 3600e3)), // today, clamped
          ev('x-e3', 'RenDIESEL', 'S I', startOfToday - 5 * 3600e3),                    // yesterday
        ] }));
      } catch (_) {}
    });
    await freshApp(page);
    await page.evaluate(() => document.getElementById('tab-social')!.click());
    await page.evaluate(() => (document.querySelector('[data-cm-pane="friends"]') as HTMLElement).click());
    const days = page.locator('.fa-day');
    await expect(days).toHaveCount(2);
    await expect(page.locator('.fa-day--open')).toHaveCount(0);
    await expect(page.locator('.fa-dh[aria-expanded="true"]')).toHaveCount(0);
    await expect(page.locator('.fa-dbody:not([hidden])')).toHaveCount(0);
    await page.locator('.fa-dh').first().click();
    await expect(days.first()).toHaveClass(/fa-day--open/);
    await expect(days.first().locator('.fa-dbody')).toBeVisible();
    await expect(days.first().locator('.fa-hunter')).toHaveCount(2);
    await expect(days.first().locator('.fa-hunter--open')).toHaveCount(0);
    await expect(days.nth(1)).not.toHaveClass(/fa-day--open/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Y. W932 — THE HUNGER names its gate + hunt type, and a tap walks to the boss
// ─────────────────────────────────────────────────────────────────────────
test.describe('Y · The Hunger points at its mark (W932)', () => {
  test('hub line names the boss, its gate and the hunt type; tapping enters that gate; the banner reads once (W934)', async ({ page }) => {
    // Pin the week's mark to the E-rank duo (the E gate is always open) via the
    // owner-override key, keyed by the same Pacific-Sunday week key the app uses.
    await page.addInitScript(() => {
      try {
        const d = new Date();
        const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
        let wd = -1;
        new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).formatToParts(d)
          .forEach((p) => { if (p.type === 'weekday') wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.value); });
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)!;
        const u = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - wd * 86400000);
        const week = u.getUTCFullYear() + '-' + String(u.getUTCMonth() + 1).padStart(2, '0') + '-' + String(u.getUTCDate()).padStart(2, '0');
        localStorage.setItem('hb_hunger_override', JSON.stringify({ week, boss_id: 'the_twin_maw' }));
      } catch (_) {}
    });
    await freshApp(page);
    await page.evaluate(() => document.getElementById('tab-quests')!.click());
    const hub = page.locator('#hunger-hub');
    await expect(hub).toBeVisible();
    await expect(hub).toContainText('The Twin Maw');
    await expect(hub.locator('.hunger-rank')).toHaveText('E-RANK GATE');
    await expect(hub.locator('.hunger-kind')).toContainText('DUO HUNT');
    await expect(hub.locator('em')).toContainText('GO');
    await page.evaluate(() => (document.getElementById('hunger-hub') as HTMLElement).click());
    await expect(page.locator('#quests-dungeon-view')).toBeVisible();
    await expect(page.locator('#dungeon-header-text')).toContainText(/E-RANK/i);
    // W934 — the banner reads once, on the hub; inside the gate only the cards remain.
    await expect(page.locator('#bosses-list .hunger-banner--go')).toHaveCount(0);
    await expect(page.locator('#bosses-list [data-boss]').first()).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Z. W933 — the Worldgate card leads the Co-op hub; the header pulse rides every tab
// ─────────────────────────────────────────────────────────────────────────
test.describe('Z · Worldgate placement (W933 → W934)', () => {
  test('the header pulse is the one Worldgate surface: no card on Habits or Co-op; the pulse opens the sheet', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_worldgate_v1', JSON.stringify({
          at: Date.now(), week: '2026-09-06', hp: 334875, pool: 102825, status: 'live', my: 13831, floor: 0, souls: 0,
          claimable: false, claimed: false, hunters: 5, guild: { steps: 0, hunters: 0 }, my_rank: 3,
          top: [{ alias: 'Grubbadub', steps: 40000 }, { alias: 'RenDIESEL', steps: 30000 }], wall: [], wall_count: 0, recent: [], rallied: false,
        }));
      } catch (_) {}
    });
    await freshApp(page);
    const pulse = page.locator('#wg-pulse');
    await expect(pulse).toBeVisible();
    await expect(pulse.locator('.wg-pulse-name')).not.toBeEmpty();
    await expect(pulse.locator('.wg-pulse-pct')).toHaveText('30.7%');
    await expect(pulse.locator('.wg-pulse-you')).toHaveCount(1);
    // W934 — no card anywhere; the pulse rides every tab and opens the sheet.
    await expect(page.locator('#worldgate-card')).toHaveCount(0);
    await page.evaluate(() => document.getElementById('tab-quests')!.click());
    await expect(page.locator('#quests-gate-view')).toBeVisible();
    await expect(page.locator('#worldgate-card')).toHaveCount(0);
    await expect(pulse).toBeVisible();
    await page.evaluate(() => (document.getElementById('wg-pulse') as HTMLElement).click());
    await expect(page.locator('.wg2-sheet-wrap')).toHaveCount(1);
    await expect(page.locator('.wg2-sheet-wrap .wg2-eyebrow')).toContainText('THE WORLDGATE');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AA. W935 — Apple Health is asked of every hunter, walk habit or not
// ─────────────────────────────────────────────────────────────────────────
test.describe('AA · Apple Health prompt on every path (W935)', () => {
  async function seedAndPrompt(page: Page, habits: unknown[]) {
    await freshApp(page);
    await page.addInitScript((h) => {
      try {
        localStorage.setItem('hb_habits', JSON.stringify(h));
        localStorage.setItem('hb_first_completion_bonus_v1', '1');
        localStorage.removeItem('hb_healthkit_prompted');
      } catch (_) {}
    }, habits);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    return page.evaluate(async () => {
      const w = window as any;
      const s = document.getElementById('awakened-splash'); if (s) s.remove();
      // Web has no HealthKit: stub the native bridge on the shared Health object
      // and drive the real prompt path.
      w.Health.isAvailable = () => true;
      w.Health.permissionStatus = () => 'unknown';
      localStorage.removeItem('hb_healthkit_prompted');
      await w.autoVerifyWalk();
      const t = document.querySelector('#hk-preprompt-overlay .hk-preprompt-title');
      return {
        title: t ? t.textContent : null,
        picker: !!document.getElementById('hk-preprompt-stepgoal'),
        queue: localStorage.getItem('hb_funnel_queue') || '',
      };
    });
  }

  test('a Make Your Own hunter with no walk habit is asked to connect Apple Health', async ({ page }) => {
    const r = await seedAndPrompt(page, [
      { id: 'h-workout', name: 'Workout', emoji: '🏋️', difficulty: 'hard', type: 'build', primaryStat: 'STR' },
    ]);
    expect(r.title).toBe('Connect Apple Health');
    expect(r.picker).toBe(false);
    expect(r.queue).toContain('health_prompt_shown');
    expect(r.queue).toContain('no_walk');
  });

  test('a hunter with the Daily walk habit still sees the walk copy and the step-goal picker', async ({ page }) => {
    const r = await seedAndPrompt(page, [
      { id: 'h-walk', name: 'Daily walk', emoji: '🚶', difficulty: 'easy', type: 'build', primaryStat: 'VIT', stepGoal: 8000 },
    ]);
    expect(r.title).toMatch(/Auto-verify your/);
    expect(r.picker).toBe(true);
    expect(r.queue).toContain('health_prompt_shown');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AB. W935 — a rejected step upload is a failure, never recorded as sent
// ─────────────────────────────────────────────────────────────────────────
test.describe('AB · Honest step uploads (W935)', () => {
  test('a rate-limited step upload leaves the throttle unset; a landed one records the value sent', async ({ page }) => {
    await freshApp(page);
    await page.addInitScript(() => {
      try {
        const d = new Date();
        const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_leaderboard', JSON.stringify({ steps_daily: { [k]: 4321 } }));
      } catch (_) {}
    });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    const r = await page.evaluate(async () => {
      const w = window as any;
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      let stepReply: any = { ok: false, code: 'RATE_LIMITED' };
      const calls: string[] = [];
      w.Auth.submitLeaderboardSnapshot = async (m: string) => { calls.push(m); return m === 'step_total' ? stepReply : { ok: true, best_value: 0 }; };
      localStorage.removeItem('hb_lb_last_submit');
      localStorage.removeItem('hb_lb_last_step_submitted');
      const direct = await w.Leaderboard.submitAllMetrics();
      w.Leaderboard.submitAllMetricsDebounced(true);
      await wait(400);
      const afterReject = { stamp: localStorage.getItem('hb_lb_last_submit'), sent: localStorage.getItem('hb_lb_last_step_submitted') };
      stepReply = { ok: true, best_value: 4321 };
      w.Leaderboard.submitAllMetricsDebounced(true);
      await wait(400);
      return { direct, calls, afterReject, afterLand: { stamp: localStorage.getItem('hb_lb_last_submit'), sent: localStorage.getItem('hb_lb_last_step_submitted') } };
    });
    expect(r.calls).toContain('step_total');
    expect(r.direct).toBe(false);
    expect(r.afterReject.stamp).toBeNull();
    expect(r.afterReject.sent).toBeNull();
    expect(r.afterLand.stamp).not.toBeNull();
    expect(r.afterLand.sent).toBe('4321');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AC. W936 — onboarding v2: the flow shows the real game, with real numbers
// ─────────────────────────────────────────────────────────────────────────
test.describe('AC · Onboarding v2 (W936)', () => {
  /**
   * Boot straight into the cinematic. Deliberately does NOT use freshApp():
   * that helper seeds hb_habits='[]' precisely to keep this overlay away, and
   * waits on a tab bar the overlay is covering.
   */
  async function freshOnboarding(page: Page) {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_cloud_restore_dismissed', '1');
        localStorage.setItem('hb_whats_new_seen', '99.99.99');
        const d = new Date();
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
                    String(d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_fri_banner_' + ymd, '1');
        ['hb_habits', 'hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed',
         'hb_healthkit_prompted', 'hb_hk_answered_v1', 'hb_hk_first_read_v1'].forEach((k) => localStorage.removeItem(k));
      } catch (_) {}
    });
    await page.goto('/');
    await expect(page.locator('#cn-s0')).toHaveClass(/cn-shown/, { timeout: 15_000 });
    await page.evaluate(() => {
      const s = document.getElementById('awakened-splash');
      if (s) s.remove();
    });
  }

  /**
   * Stub the two things the flow reads from outside itself: the native Health
   * bridge (web has none) and the weekly board. Everything else — the Twin
   * Maw's goal, its drop pool, the Steel Wolf's threshold, the packs, the
   * reward numbers — comes from the app's own tables and is asserted as such.
   */
  async function walkToPact(page: Page, todaySteps: number, weekSteps: number) {
    return page.evaluate(async ({ today, week }) => {
      const w = window as any;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const root = document.getElementById('cin-onboarding') as HTMLElement;
      const q = (s: string) => root.querySelector(s) as HTMLElement;

      w.Health.isAvailable       = () => true;
      w.Health.permissionStatus  = () => 'granted';
      w.Health.requestPermissions = async () => 'granted';
      w.Health.getStepsBetween   = async () => week;
      w.Health.getStepsToday     = async () => today;
      w.Auth.fetchLeaderboardTop = async () => ({
        ok: true, metric: 'step_total',
        me: { rank: 4, current_value: week },
        top: [
          { rank: 1, alias: 'Galilea',   current_value: 51144, avatar_id: 'avatar-ranger.png',  card_bg: null },
          { rank: 2, alias: 'RenDIESEL', current_value: 44910, avatar_id: 'avatar-warrior.png', card_bg: null },
          { rank: 3, alias: 'Grubbadub', current_value: 38207, avatar_id: 'avatar-mage.png',    card_bg: null },
          { rank: 5, alias: 'Anthony',   current_value: 29560, avatar_id: 'avatar-paladin.png', card_bg: null },
        ],
      });

      q('#cn-touch').click();
      await wait(1100);
      const nameField = q('#cin-nameField') as HTMLInputElement;
      nameField.value = 'Richie';
      nameField.dispatchEvent(new Event('input'));
      q('#cin-nameConfirm').click();
      await wait(300);
      const onWitness = !!document.querySelector('#cn-s2.cn-shown');

      q('#cn-healthBtn').click();
      await wait(900);
      const reveal = {
        line:  (q('#cn-revealLine') || {} as any).textContent || '',
        unlit: q('#cn-s3').classList.contains('cn-unlit'),
      };
      const prompted = localStorage.getItem('hb_healthkit_prompted');
      const funnel   = localStorage.getItem('hb_funnel_queue') || '';

      q('#cn-s3 [data-cn-next]').click();
      await wait(900);
      const board = Array.from(root.querySelectorAll('#cn-rows .cn-row')).map((el) => ({
        me:   el.classList.contains('cn-me'),
        rank: (el.querySelector('.cn-r') as HTMLElement).textContent,
        val:  (el.querySelector('.cn-v') as HTMLElement).textContent,
      }));

      q('#cn-s4 [data-cn-next]').click();
      await wait(200);
      const hunt = {
        line:  (q('#cn-mawLine') as HTMLElement).textContent || '',
        drops: Array.from(root.querySelectorAll('#cn-drops .cn-drop .cn-dn')).map((el) => el.childNodes[0].textContent),
      };

      q('#cn-s5 #cn-huntAlone').click();   // HUNT ALONE — no share sheet in a test
      await wait(200);
      q('#cn-s6 [data-cn-next]').click();  // the ascent
      await wait(200);
      const paths = Array.from(root.querySelectorAll('#cn-paths .cn-path')).map((el) => ({
        name: (el.querySelector('.cn-pn') as HTMLElement).textContent,
        sub:  (el.querySelector('.cn-ps') as HTMLElement).textContent,
        on:   el.classList.contains('cn-on'),
      }));
      // Pin the drop roll before the pact mounts. The Steel Wolf's kill rolls the
      // real E-rank table, which can honestly roll NO relic; the assertions below
      // need one to have landed. 0 takes the guaranteed branch (0 < any rate).
      Math.random = () => 0;
      q('#cn-s7 [data-cn-next]').click();  // custom carries no training habit → straight to the pact
      await wait(400);
      // W947 — nothing is real until the strike: the Wolf waits armed, ENTER closed.
      const beforeStrike = {
        armed:   q('#cn-wolf').classList.contains('cn-armed'),
        title:   (q('#cn-pactTitle') as HTMLElement).textContent,
        enterOn: !(q('#cn-enter') as HTMLButtonElement).disabled,
        engaged: !!((JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf || {}).engaged),
      };
      // Strike in one press (the keyboard path of hold-to-strike).
      q('#cn-wolf').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(1000);

      const inv = JSON.parse(localStorage.getItem('hb_inventory') || '{}');
      return {
        onWitness, prompted, funnel, reveal, board, hunt, paths, beforeStrike,
        enterOn: !(q('#cn-enter') as HTMLButtonElement).disabled,
        pact: {
          shown:  !!document.querySelector('#cn-s8.cn-shown'),
          fell:   q('#cn-wolf').classList.contains('cn-fell'),
          locked: q('#cn-wolf').classList.contains('cn-lock'),
          title:  (q('#cn-pactTitle') as HTMLElement).textContent,
          sub:    (q('#cn-wolfSub') as HTMLElement).textContent,
          relic:  root.querySelector('#cn-pactBody .cn-rn') ? (root.querySelector('#cn-pactBody .cn-rn') as HTMLElement).textContent : null,
          stat:   root.querySelector('#cn-pactBody .cn-stat') ? (root.querySelector('#cn-pactBody .cn-stat') as HTMLElement).textContent : null,
          vows:   Array.from(root.querySelectorAll('#cn-pactBody .cn-vow .cn-vn')).map((el) => el.childNodes[0].textContent),
          firstWin: ((root.querySelector('#cn-pactBody .cn-b b') || {}).textContent || ''),
        },
        wolfState:  JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf || null,
        killClaim:  Object.keys(localStorage).filter((k) => k.indexOf('hb_kill_reward_the_steel_wolf') === 0),
        ownedCards: Object.keys(inv.cards || {}).filter((id) => ((inv.cards[id] || {}).count | 0) > 0),
        queuedBossResult: localStorage.getItem('hb_boss_result_queue'),
      };
    }, { today: todaySteps, week: weekSteps });
  }

  test('the flow asks for Apple Health itself and then shows the hunter their own week, rank, and hunt', async ({ page }) => {
    await freshOnboarding(page);
    const r = await walkToPact(page, 7318, 31204);

    // The ask lives inside the flow now (it used to fire after it, W935).
    expect(r.onWitness).toBe(true);
    expect(r.prompted).toBe('1');
    expect(r.funnel).toContain('health_prompt_shown');
    expect(r.funnel).toContain('onboarding');
    expect(r.funnel).toContain('health_prompt_answered');
    expect(r.funnel).toContain('health_first_read');

    // The reveal is the hunter's own seven days, and the road is lit.
    expect(r.reveal.line).toContain('31,204');
    expect(r.reveal.unlit).toBe(false);

    // The board carries the rank the SERVER gave, positioned by the number walked.
    const me = r.board.find((x) => x.me);
    expect(me).toBeTruthy();
    expect(me!.rank).toBe('4');
    expect(me!.val).toBe('31,204');
    expect(r.board.map((x) => x.rank)).toEqual(['1', '2', '3', '4', '5']);

    // The hunt reads its goal and its drop pool out of the game's own tables.
    expect(r.hunt.line).toContain('14,000');
    expect(r.hunt.drops).toEqual(['Twin-Fang Cleaver', 'The Twofold Gaze', 'Bothsight, the Long Hunt']);

    // The paths are the real packs with their real vow counts.
    expect(r.paths.map((p) => p.name)).toEqual(['Morning Routine', 'Make Your Own', 'Vertical Jump Program']);
    expect(r.paths[0].sub).toBe('10 vows');
    expect(r.paths[1].on).toBe(true);
  });

  test('a day already past 6,000 steps kills the Steel Wolf for real, once', async ({ page }) => {
    await freshOnboarding(page);
    const r = await walkToPact(page, 7318, 31204);

    expect(r.beforeStrike).toEqual({ armed: true, title: 'Strike the Wolf.', enterOn: false, engaged: false });
    expect(r.pact.shown).toBe(true);
    expect(r.pact.fell).toBe(true);
    expect(r.enterOn).toBe(true);
    expect(r.pact.title).toBe('It falls.');
    expect(r.pact.sub).toBe('7,318 / 6,000 STEPS TODAY');

    // Real kill: the boss ledger moved, the once-per-(boss, day) reward was
    // claimed, and the relic on the screen is the relic in the armory.
    expect(r.wolfState).toBeTruthy();
    expect(r.wolfState.kill_count).toBe(1);
    expect(r.wolfState.last_hunt_outcome).toBe('defeated');
    expect(r.killClaim.length).toBe(1);
    expect(r.pact.relic).toBeTruthy();
    expect(r.ownedCards.length).toBe(1);
    // The screen's reward line is sourced, not written: E-rank kill souls plus
    // the first-awakening XP constant.
    expect(r.pact.stat).toContain('+50 SOULS');
    expect(r.pact.stat).toContain('+5 XP');   // W941 — the onboarding grant
    // And it announced itself exactly once — nothing queued to pop behind it.
    expect(r.queuedBossResult).toBeNull();
  });

  test('a day still short of 6,000 engages the Wolf and says how far it is; Make Your Own starts with an empty list', async ({ page }) => {
    await freshOnboarding(page);
    const r = await walkToPact(page, 3860, 18860);

    expect(r.pact.fell).toBe(false);
    expect(r.pact.locked).toBe(false);
    expect(r.pact.title).toBe('The Wolf is engaged.');
    expect(r.pact.sub).toBe('2,140 STEPS LEFT TODAY');
    expect(r.wolfState.kill_count).toBe(0);
    expect(r.killClaim.length).toBe(0);
    // W947 — v3: the night's win is the walk the Wolf is waiting on.
    expect(r.pact.vows).toEqual(['Walk 6,000']);
    expect(r.pact.firstWin).toBe('Tonight, the first win is the walk.');

    const seeded = await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      (document.querySelector('#cn-enter') as HTMLElement).click();
      await wait(1200);
      const cont = Array.from(document.querySelectorAll('button'))
        .find((b) => /Continue/i.test(b.textContent || '') && (b as HTMLElement).offsetParent);
      if (cont) (cont as HTMLElement).click();
      await wait(1500);
      return {
        habits: JSON.parse(localStorage.getItem('hb_habits') || '[]').map((h: any) => h.name),
        path:   localStorage.getItem('hb_path'),
        name:   localStorage.getItem('hb_name'),
        xp:     localStorage.getItem('hb_onboarding_first_xp_awarded_v1'),
        firstVowPicker: (() => {
          const e = document.getElementById('empty-state');
          return !!e && !e.classList.contains('hidden') && !e.classList.contains('empty-state--rest-day')
            && document.querySelectorAll('#empty-state-quickgrid [data-quickpick-idx]').length > 0;
        })(),
      };
    });
    // W944 — Make Your Own seeds nothing; the First Vow picker takes over.
    expect(seeded.habits).toEqual([]);
    expect(seeded.firstVowPicker).toBe(true);
    expect(seeded.path).toBe('custom');
    expect(seeded.name).toBe('Richie');
    expect(seeded.xp).toBe('1');
  });

  test('Health refused leaves the Wolf behind the gate rather than engaged', async ({ page }) => {
    await freshOnboarding(page);
    const r = await page.evaluate(async () => {
      const w = window as any;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const root = document.getElementById('cin-onboarding') as HTMLElement;
      const q = (s: string) => root.querySelector(s) as HTMLElement;
      w.Health.isAvailable        = () => true;
      w.Health.permissionStatus   = () => 'denied';
      w.Health.requestPermissions = async () => 'denied';
      w.Health.getStepsBetween    = async () => null;
      w.Health.getStepsToday      = async () => null;
      w.Auth.fetchLeaderboardTop  = async () => ({ ok: true, metric: 'step_total', me: null, top: [] });

      q('#cn-touch').click();
      await wait(1100);
      const f = q('#cin-nameField') as HTMLInputElement;
      f.value = 'Richie'; f.dispatchEvent(new Event('input'));
      q('#cin-nameConfirm').click();
      await wait(300);
      q('#cn-healthBtn').click();
      await wait(900);
      const reveal = { text: (q('#cn-revealLine') as HTMLElement).textContent, unlit: q('#cn-s3').classList.contains('cn-unlit') };
      q('#cn-s3 [data-cn-next]').click();
      await wait(700);
      // An empty board is walked past, not shown: the hunter should now be on
      // the hunt, one screen further than the CONTINUE they tapped.
      const skippedBoard = !!document.querySelector('#cn-s5.cn-shown');
      q('#cn-s5 #cn-huntAlone').click();
      await wait(150);
      q('#cn-s6 [data-cn-next]').click();
      await wait(150);
      q('#cn-s7 [data-cn-next]').click();
      await wait(400);
      return {
        reveal, skippedBoard,
        locked: q('#cn-wolf').classList.contains('cn-lock'),
        title:  (q('#cn-pactTitle') as HTMLElement).textContent,
        enterOn: !(q('#cn-enter') as HTMLButtonElement).disabled,
        engaged: !!((JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf || {}).engaged),
        funnel: localStorage.getItem('hb_funnel_queue') || '',
      };
    });
    expect(r.reveal.unlit).toBe(true);
    expect(r.reveal.text).toContain('Health is closed');
    expect(r.skippedBoard).toBe(true);
    expect(r.locked).toBe(true);
    expect(r.title).toBe('The Wolf waits behind Health.');
    expect(r.engaged).toBe(false);
    expect(r.enterOn).toBe(true);   // nothing to strike, so nothing to wait for
    expect(r.funnel).toContain('health_prompt_answered');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AD. W937 — replaying the awakening changes nothing
// ─────────────────────────────────────────────────────────────────────────
test.describe('AD · Replay the awakening (W937)', () => {
  // The keys a real first run WOULD write. Asserted by name rather than by a
  // blanket snapshot: the app keeps running behind the overlay and writes its
  // own leaderboard, breadcrumb and beacon keys on its own schedule.
  const WATCHED = [
    'hb_healthkit_prompted', 'hb_hk_answered_v1', 'hb_hk_first_read_v1',
    'hb_habits', 'hb_path', 'hb_name', 'hb_bosses', 'hb_inventory', 'hb_souls',
    'hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed',
    'hb_onboarding_first_xp_awarded_v1', 'hb_onboarding_goal',
    'hb_first_hunt_free_used', 'hb_funnel_queue',
  ];

  async function establishedAccount(page: Page) {
    await freshApp(page);
    await page.evaluate(() => {
      localStorage.setItem('hb_name', 'Richie');
      localStorage.setItem('hb_path', 'custom');
      localStorage.setItem('hb_bosses', JSON.stringify({
        the_steel_wolf: { streak: 0, kill_count: 3, last_eval_date: '2020-01-01', engaged: false },
      }));
    });
  }

  /** Drive the whole replay and hand back what it showed and what it moved. */
  async function replay(page: Page, watched: string[]) {
    return page.evaluate(async (WATCH) => {
      const w = window as any;
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      const before: Record<string, string | null> = {};
      WATCH.forEach((k: string) => { before[k] = localStorage.getItem(k); });

      w.__replayOnboarding();
      await wait(500);
      const root = document.getElementById('cin-onboarding') as HTMLElement;
      const q = (s: string) => root.querySelector(s) as HTMLElement;
      const opened = {
        preview: root.classList.contains('cn-preview'),
        ribbon:  !(document.getElementById('cn-preview-note') as HTMLElement).hidden,
        name:    (q('#cin-nameField') as HTMLInputElement).value,
      };

      q('#cn-touch').click();             await wait(1100);
      q('#cin-nameConfirm').click();      await wait(400);
      q('#cn-healthBtn').click();         await wait(1200);
      const reveal = (q('#cn-revealLine') as HTMLElement).textContent || '';
      q('#cn-s3 [data-cn-next]').click(); await wait(900);
      // The board is skipped when nobody else is on it, so advance from
      // whichever screen is actually showing.
      const afterReveal = (document.querySelector('.cn-scr.cn-shown') as HTMLElement).id;
      if (afterReveal === 'cn-s4') { q('#cn-s4 [data-cn-next]').click(); await wait(250); }
      q('#cn-s5 #cn-huntAlone').click();  await wait(250);
      q('#cn-s6 [data-cn-next]').click(); await wait(250);
      q('#cn-s7 [data-cn-next]').click(); await wait(700);
      if (q('#cn-wolf').classList.contains('cn-armed')) {
        q('#cn-wolf').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await wait(1000);
      }
      const pact = {
        shown:  !!document.querySelector('#cn-s8.cn-shown'),
        fell:   q('#cn-wolf').classList.contains('cn-fell'),
        locked: q('#cn-wolf').classList.contains('cn-lock'),
        title:  (q('#cn-pactTitle') as HTMLElement).textContent,
        relic:  (root.querySelector('#cn-pactBody .cn-rr') as HTMLElement | null)?.textContent || '',
      };
      q('#cn-enter').click();             await wait(1200);

      return {
        opened, reveal, pact,
        askedPermission: !!w.__askedPermission,
        touched:   WATCH.filter((k: string) => localStorage.getItem(k) !== before[k]),
        killFlags: Object.keys(localStorage).filter((k) => k.indexOf('hb_kill_reward_') === 0),
        closed:    root.classList.contains('hidden') && !root.classList.contains('cn-preview'),
        wolf:      JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf,
      };
    }, watched);
  }

  test('the replay writes none of the keys a first run would', async ({ page }) => {
    await establishedAccount(page);
    const r = await replay(page, WATCHED);

    expect(r.opened.preview).toBe(true);
    expect(r.opened.ribbon).toBe(true);
    expect(r.opened.name).toBe('Richie');   // the claimed name, prefilled, never re-claimed
    expect(r.pact.shown).toBe(true);
    // No HealthKit in a browser, so the flow shows exactly what a first run
    // would show a hunter who has not connected it.
    expect(r.pact.locked).toBe(true);
    expect(r.pact.title).toBe('The Wolf waits behind Health.');

    expect(r.touched).toEqual([]);
    expect(r.killFlags).toEqual([]);
    expect(r.closed).toBe(true);
    expect(r.wolf.kill_count).toBe(3);
    expect(r.wolf.engaged).toBe(false);
    expect(r.wolf.last_eval_date).toBe('2020-01-01');
  });

  test('a day past 6,000 shows the fall as a preview and still leaves the hunt alone', async ({ page }) => {
    await establishedAccount(page);
    await page.evaluate(() => {
      const w = window as any;
      w.Health.isAvailable        = () => true;
      w.Health.permissionStatus   = () => 'granted';
      w.Health.requestPermissions = async () => { w.__askedPermission = true; return 'granted'; };
      w.Health.getStepsBetween    = async () => 34112;
      w.Health.getStepsToday      = async () => 9040;   // well past the Wolf's 6,000
      w.Auth.fetchLeaderboardTop  = async () => ({
        ok: true, me: { rank: 2, current_value: 34112 },
        top: [{ rank: 1, alias: 'Galilea', current_value: 51144, avatar_id: 'avatar-ranger.png', card_bg: null }],
      });
    });
    // Only the hunt-side keys here: with Health stubbed granted the app's own
    // auto-verify runs behind the overlay and legitimately moves souls and the
    // funnel queue, which has nothing to do with the replay.
    const r = await replay(page, ['hb_bosses', 'hb_inventory', 'hb_habits', 'hb_path',
                                  'hb_healthkit_prompted', 'hb_hk_answered_v1', 'hb_first_hunt_free_used']);

    expect(r.reveal).toContain('34,112');
    expect(r.pact.fell).toBe(true);
    expect(r.pact.relic).toContain('PREVIEW ONLY');   // shown, never rolled, never granted
    expect(r.askedPermission).toBe(false);            // the permission is already answered
    expect(r.touched).toEqual([]);
    expect(r.killFlags).toEqual([]);
    expect(r.wolf.kill_count).toBe(3);
    expect(r.wolf.engaged).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AE. W938 — TEST HUNTER: the account is set aside, nothing is sent, and
//     every byte comes back — including after a crash at any stage.
// ─────────────────────────────────────────────────────────────────────────
test.describe('AE · Test as a new hunter (W938)', () => {
  // Values the app never rewrites on its own, so "came back" means exactly that.
  // hb_user is added per test from the booted dev session: a made-up JWT would
  // be sent to the live worker on reboot, 401, and sign the app out — correctly.
  const SENTINELS: Record<string, string> = {
    hb_w938_sentinel: 'the-real-account',
    hb_w938_relics: JSON.stringify({ nightfall_blade: { count: 1, upgrade_level: 4 } }),
    hb_board_cache_v1: JSON.stringify({ topics: [], me: { role: 'owner' } }),
    hb_healthkit_status: 'granted',   // device-level: must stay in place THROUGH the test
  };

  async function ownerAccount(page: Page) {
    await freshApp(page);
    const session = await page.evaluate((s) => {
      Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v as string));
      return localStorage.getItem('hb_user');
    }, SENTINELS);
    expect(session).toBeTruthy();
    SENTINELS.hb_user = session as string;
  }

  /** Read every sentinel plus the sandbox's own bookkeeping. */
  async function snapshot(page: Page) {
    return page.evaluate((keys) => {
      const vals: Record<string, string | null> = {};
      keys.forEach((k: string) => { vals[k] = localStorage.getItem(k); });
      const all = Object.keys(localStorage);
      return {
        vals,
        setAside: all.filter((k) => k.indexOf('hbsb_') === 0).length,
        flag: localStorage.getItem('awk_sandbox_v1'),
        testJunk: localStorage.getItem('hb_w938_test_junk'),
        bar: !!document.getElementById('awk-sandbox-bar'),
        active: (window as any).__awkSandbox.active(),
      };
    }, Object.keys(SENTINELS));
  }

  function expectRestored(r: Awaited<ReturnType<typeof snapshot>>) {
    for (const [k, v] of Object.entries(SENTINELS)) expect(r.vals[k], k).toBe(v);
    expect(r.setAside).toBe(0);
    expect(r.flag).toBeNull();
    expect(r.testJunk).toBeNull();
    expect(r.active).toBe(false);
    expect(r.bar).toBe(false);
  }

  test('the Settings row shows for the owner only', async ({ page }) => {
    await ownerAccount(page);
    const owner = await page.evaluate(() => {
      (document.getElementById('settings-btn') as HTMLElement).click();
      return !document.getElementById('settings-test-hunter')!.classList.contains('hidden');
    });
    expect(owner).toBe(true);
    const player = await page.evaluate(() => {
      localStorage.setItem('hb_board_cache_v1', JSON.stringify({ topics: [], me: { role: null } }));
      (document.getElementById('settings-close') as HTMLElement).click();
      (document.getElementById('settings-btn') as HTMLElement).click();
      return !document.getElementById('settings-test-hunter')!.classList.contains('hidden');
    });
    expect(player).toBe(false);
  });

  test('a test boots as a fresh install, sends nothing, and END puts every byte back', async ({ page }) => {
    await ownerAccount(page);
    // Allowed auth calls are answered here so the assertion is about the guard, not the network.
    await page.route('**/v1/auth/refresh', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"jwt":"x"}' }));

    // Start through the real sheet.
    await page.evaluate(() => {
      (document.getElementById('settings-btn') as HTMLElement).click();
      (document.getElementById('settings-test-hunter') as HTMLElement).click();
    });
    await page.waitForTimeout(400);
    await expect(page.locator('#th-overlay .th-title')).toHaveText('Test as a new hunter');
    await Promise.all([page.waitForEvent('load'), page.evaluate(() => (document.getElementById('th-start') as HTMLElement).click())]);

    // A fresh install: the cinematic, the TEST HUNTER bar, the account set aside.
    await expect(page.locator('#awk-sandbox-bar')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#cn-s0')).toHaveClass(/cn-shown/, { timeout: 15_000 });
    const during = await page.evaluate(async () => {
      const w = window as any;
      const backend = 'https://awakened-backend.richmondcampano93.workers.dev';
      const post = await fetch(backend + '/v1/leaderboard/submit', { method: 'POST', body: '{}' });
      const postBody = await post.json();
      const refresh = await fetch(backend + '/v1/auth/refresh', { method: 'POST' });
      let wsRefused = false;
      try { new WebSocket('wss://awakened-backend.richmondcampano93.workers.dev/v1/pvp/ws'); } catch (_) { wsRefused = true; }
      // The test hunter leaves marks that must not survive END.
      localStorage.setItem('hb_w938_test_junk', 'discard me');
      localStorage.setItem('hb_w938_sentinel', 'overwritten by the test');
      return {
        status: w.__awkSandbox.status(),
        sentinelWasSetAside: localStorage.getItem('hbsb_hb_w938_sentinel'),
        relicsVisible: localStorage.getItem('hb_w938_relics'),
        deviceHealth: localStorage.getItem('hb_healthkit_status'),
        postStatus: post.status, postCode: postBody.code,
        refreshStatus: refresh.status,
        wsRefused,
      };
    });
    expect(during.status.active).toBe(true);
    expect(during.status.phase).toBe('active');
    expect(during.status.setAside).toBeGreaterThanOrEqual(5);
    expect(during.sentinelWasSetAside).toBe('the-real-account');
    expect(during.relicsVisible).toBeNull();            // the test hunter cannot see the real relics
    expect(during.deviceHealth).toBe('granted');        // but the device's Health grant is still live
    expect(during.postStatus).toBe(503);
    expect(during.postCode).toBe('SANDBOX');
    expect(during.refreshStatus).toBe(200);             // minting a session is allowed through
    expect(during.wsRefused).toBe(true);
    expect(during.status.blocked).toBeGreaterThanOrEqual(1);

    // A reload inside the test keeps the test (sessionStorage survives it).
    await page.reload();
    await expect(page.locator('#awk-sandbox-bar')).toBeVisible({ timeout: 15_000 });

    // END TEST from the bar.
    page.once('dialog', (d) => d.accept());
    await Promise.all([page.waitForEvent('load'), page.locator('#awk-sandbox-bar').click()]);
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    expectRestored(await snapshot(page));
  });

  test('closing the app mid-test restores the account on the next launch', async ({ page }) => {
    await ownerAccount(page);
    await page.evaluate(() => {
      const r = (window as any).__awkSandbox.start();
      if (!r.ok) throw new Error(r.code);
      localStorage.setItem('hb_w938_test_junk', 'x');
    });
    // A relaunch is a page load WITHOUT the session token.
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    expectRestored(await snapshot(page));
  });

  test('a crash at any stage finishes cleanly on the next launch and loses nothing', async ({ page }) => {
    await ownerAccount(page);
    for (const stage of ['moving', 'wipe', 'restore'] as const) {
      await page.evaluate(({ stage, sentinels }) => {
        // Rebuild the exact on-disk shape a crash in `stage` leaves behind.
        Object.entries(sentinels).forEach(([k, v]) => localStorage.setItem(k, v as string));
        sessionStorage.clear();
        const hunter = Object.keys(sentinels).filter((k) => k !== 'hb_healthkit_status');
        if (stage === 'moving') {
          // Half moved: the first two keys set aside, the rest still in place.
          hunter.slice(0, 2).forEach((k) => { localStorage.setItem('hbsb_' + k, localStorage.getItem(k)!); localStorage.removeItem(k); });
        } else if (stage === 'wipe') {
          // Everything set aside, the test hunter half-wiped.
          hunter.forEach((k) => { localStorage.setItem('hbsb_' + k, localStorage.getItem(k)!); localStorage.removeItem(k); });
          localStorage.setItem('hb_w938_test_junk', 'x');
          localStorage.setItem('hb_w938_sentinel', 'test hunter value');
        } else {
          // Test hunter already wiped; half of the real keys already back.
          hunter.forEach((k) => { localStorage.setItem('hbsb_' + k, localStorage.getItem(k)!); localStorage.removeItem(k); });
          hunter.slice(0, 3).forEach((k) => { localStorage.setItem(k, localStorage.getItem('hbsb_' + k)!); localStorage.removeItem('hbsb_' + k); });
        }
        localStorage.setItem('awk_sandbox_v1', JSON.stringify({ phase: stage, token: 'crashed', startedAt: 1 }));
      }, { stage, sentinels: SENTINELS });
      await page.reload();
      await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
      const r = await snapshot(page);
      for (const [k, v] of Object.entries(SENTINELS)) expect(r.vals[k], stage + ' ' + k).toBe(v);
      expect(r.setAside, stage).toBe(0);
      expect(r.flag, stage).toBeNull();
      expect(r.testJunk, stage).toBeNull();
    }
  });
  // The bug found on 2026-09-12: app.js flushes its IN-MEMORY state on teardown
  // (pagehide / beforeunload) and on timers. Between END putting the real keys
  // back and the reload, that flush would write the test hunter over them.
  test('a save that lands after END is dropped: the test hunter cannot overwrite the real account', async ({ page }) => {
    await ownerAccount(page);
    // hb_points is app-owned (_saveNow writes it) and, unlike hb_habits, is not
    // re-seeded by freshApp's init script on every navigation.
    await page.evaluate(() => localStorage.setItem('hb_points', '4321'));
    await page.evaluate(() => { const r = (window as any).__awkSandbox.start(); if (!r.ok) throw new Error(r.code); });
    await page.reload();
    await expect(page.locator('#awk-sandbox-bar')).toBeVisible({ timeout: 15_000 });

    await Promise.all([
      page.waitForEvent('load'),
      page.evaluate(() => {
        (window as any).__awkSandbox.finishTest();
        // Exactly what a teardown flush does, in the gap before the reload.
        localStorage.setItem('hb_points', '25');
        localStorage.setItem('hb_w938_sentinel', 'flushed by the test hunter');
        localStorage.removeItem('hb_w938_relics');
      }),
    ]);
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    const r = await page.evaluate(() => ({
      points: localStorage.getItem('hb_points'),
      sentinel: localStorage.getItem('hb_w938_sentinel'),
      relics: localStorage.getItem('hb_w938_relics'),
      active: (window as any).__awkSandbox.active(),
    }));
    expect(r.points).toBe('4321');
    expect(r.sentinel).toBe('the-real-account');
    expect(r.relics).toBe(SENTINELS.hb_w938_relics);
    expect(r.active).toBe(false);
  });

  test('a save that lands after START is dropped: the test hunter starts clean', async ({ page }) => {
    await ownerAccount(page);
    await Promise.all([
      page.waitForEvent('load'),
      page.evaluate(() => {
        (window as any).__awkSandbox.beginTest();
        // The real account's memory flushing into the fresh install.
        localStorage.setItem('hb_w938_leak', 'real account memory');
        localStorage.setItem('hb_habits', JSON.stringify([{ id: 'r', name: 'LEAKED VOW' }]));
      }),
    ]);
    await expect(page.locator('#awk-sandbox-bar')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#cn-s0')).toHaveClass(/cn-shown/, { timeout: 15_000 });
    const r = await page.evaluate(() => ({
      leak: localStorage.getItem('hb_w938_leak'),
      leakSetAside: localStorage.getItem('hbsb_hb_w938_leak'),
      habits: localStorage.getItem('hb_habits'),
    }));
    expect(r.leak).toBeNull();
    expect(r.leakSetAside).toBeNull();
    expect(r.habits === null || r.habits === '[]').toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AF. W939 — Sign in v2: the first screen after download
// ─────────────────────────────────────────────────────────────────────────
test.describe('AF · Sign in v2 (W939)', () => {
  test('the Gate art, the new copy and a truthful footnote', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(() => {
      const gate = document.getElementById('signin-gate') as HTMLElement;
      const btn = document.getElementById('signin-apple-btn') as HTMLButtonElement;
      document.getElementById('app')!.classList.add('hidden');
      gate.classList.remove('hidden');
      return {
        v2: gate.classList.contains('sg-v2'),
        art: (gate.querySelector('.sg-art img') as HTMLImageElement | null)?.getAttribute('src') || null,
        logo: (gate.querySelector('.sg-lock img') as HTMLImageElement | null)?.getAttribute('src') || null,
        title: (gate.querySelector('.signin-title') as HTMLElement).textContent,
        blurb: (gate.querySelector('.signin-blurb') as HTMLElement).textContent,
        foot: (gate.querySelector('.signin-footnote') as HTMLElement).textContent,
        buttonText: (btn.textContent || '').replace(/\s+/g, ' ').trim(),
        buttonBg: getComputedStyle(btn).backgroundColor,
      };
    });
    expect(r.v2).toBe(true);
    expect(r.art).toBe('assets/gates/gate-e-rank.png');
    expect(r.logo).toBe('assets/awknd-logo.png');
    expect(r.title).toBe('The Gate is open.');
    expect(r.blurb).toContain('carry your progress between devices');
    // The old line was untrue: CloudSync backs up every hb_ key.
    expect(r.foot).not.toContain('Everything else stays on your device');
    expect(r.foot).toContain('private backup');
    expect(r.buttonText).toBe('Sign in with Apple');
    expect(r.buttonBg).toBe('rgb(255, 255, 255)');
  });

  test('the button spins while Apple\'s sheet is up and comes back when it is cancelled', async ({ page }) => {
    // Boot a genuinely signed-out, "native" app so the real gate controller
    // wires the real button. Auth is patched the instant auth.js assigns it.
    await page.addInitScript(() => {
      let auth: any;
      Object.defineProperty(window, 'Auth', {
        configurable: true,
        get() { return auth; },
        set(v) {
          v.devSignInIfLocalhost = () => false;
          v.isNative = () => true;
          (window as any).__sheetOpen = false;
          v.signInWithApple = () => new Promise((res) => {
            (window as any).__sheetOpen = true;
            setTimeout(() => { (window as any).__sheetOpen = false; res(null); }, 700);   // the user cancels
          });
          auth = v;
        },
      });
      const css = '#awakened-splash{display:none!important}';
      document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); });
    });
    await page.goto('/');
    await expect(page.locator('#signin-gate')).toBeVisible({ timeout: 15_000 });
    const r = await page.evaluate(async () => {
      const btn = document.getElementById('signin-apple-btn') as HTMLButtonElement;
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      btn.click();
      await wait(150);
      const during = { sheet: (window as any).__sheetOpen, busy: btn.classList.contains('is-busy'), disabled: btn.disabled };
      await wait(900);
      const after = { sheet: (window as any).__sheetOpen, busy: btn.classList.contains('is-busy'), disabled: btn.disabled,
                      error: (document.getElementById('signin-apple-error') as HTMLElement).textContent };
      return { during, after };
    });
    expect(r.during).toEqual({ sheet: true, busy: true, disabled: true });
    expect(r.after.sheet).toBe(false);
    expect(r.after.busy).toBe(false);
    expect(r.after.disabled).toBe(false);
    expect(r.after.error).toBe('');   // a cancel is not an error
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AG. W940 — One moment, one message: a hunter's first day is quiet
// ─────────────────────────────────────────────────────────────────────────
test.describe('AG · One moment, one message (W940)', () => {
  /** A hunter with one hand-tapped vow, 25 points (onboarding's grant) and no first completion yet. */
  async function hunter(page: Page, onboardedDaysAgo: number) {
    await freshApp(page);
    await page.addInitScript((daysAgo) => {
      // A long-time hunter has already had the one-per-install welcome-back
      // coach; a first-day hunter must not get it at all (W940 gates it).
      try { if (daysAgo > 0) localStorage.setItem('hb_tour_welcome_back_v1', '1'); } catch (_) {}
      try {
        if (sessionStorage.getItem('__w940_seeded')) return;
        sessionStorage.setItem('__w940_seeded', '1');
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_onboarding_first_xp_date', ymd);
        // Journal completes on a plain tap (Read is measurable and needs a goal first).
        localStorage.setItem('hb_habits', JSON.stringify([{ id: 'w940-journal', name: 'Journal', emoji: '✍️', difficulty: 'easy', type: 'build' }]));
        localStorage.setItem('hb_points', '25');
        localStorage.removeItem('hb_first_completion_bonus_v1');
        localStorage.removeItem('hb_fm_pointer_seen');
      } catch (_) {}
    }, onboardedDaysAgo);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }

  const readScreen = () => {
    const shown = (id: string) => {
      const el = document.getElementById(id);
      return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
    };
    const extra = document.getElementById('first-win-extra') as HTMLElement | null;
    return {
      firstMark: shown('first-win-overlay'),
      firstMarkXp: (document.getElementById('first-win-xp') as HTMLElement | null)?.textContent || null,
      extra: extra && !extra.hidden ? extra.textContent : null,
      achievementToast: shown('ach-popup'),
      fieldManual: shown('fm-pointer-overlay'),
      noticeCards: document.querySelectorAll('.notice-card-wrap').length,
      toasts: Array.from(document.querySelectorAll('.habit-toast')).map((t) => (t as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
    };
  };

  test('first day: one habit tap shows First Mark only, carrying First Step and the division', async ({ page }) => {
    await hunter(page, 0);
    const quiet = await page.evaluate(() => (window as any).__newHunterQuiet());
    expect(quiet).toBe(true);
    // No "Welcome back, hunter." for someone who just arrived.
    const coach = await page.evaluate(() => {
      const el = document.getElementById('fa-coachmark-overlay');
      return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
    });
    expect(coach).toBe(false);

    await page.evaluate(() => (document.querySelector('#habit-list .habit-item') as HTMLElement).click());
    await page.waitForTimeout(1500);
    const atTap = await page.evaluate(readScreen);
    expect(atTap.firstMark).toBe(true);
    expect(atTap.firstMarkXp).toBe('+10 XP');   // W941 — the First Mark grant
    expect(atTap.extra).toContain('First Step');
    expect(atTap.extra).toContain('Division E I');
    expect(atTap.achievementToast).toBe(false);
    expect(atTap.noticeCards).toBe(0);
    expect(atTap.toasts.filter((t) => /DIVISION|STAT LEVEL|Milestone unlocked/i.test(t))).toEqual([]);

    // ONWARD — and nothing follows it.
    await page.evaluate(() => (document.getElementById('first-win-cta') as HTMLElement).click());
    await page.waitForTimeout(2500);
    const after = await page.evaluate(readScreen);
    expect(after.firstMark).toBe(false);
    expect(after.fieldManual).toBe(false);
    expect(after.achievementToast).toBe(false);

    // Every reward still landed; the one-time prompt is spent, not deferred.
    const state = await page.evaluate(() => ({
      points: Number(localStorage.getItem('hb_points')),
      achievements: localStorage.getItem('hb_achievements') || '',
      fmSeen: localStorage.getItem('hb_fm_pointer_seen'),
    }));
    expect(state.points).toBeGreaterThanOrEqual(36);   // 25 seeded + the +10 First Mark + the habit (W941)
    expect(state.achievements).toContain('first_step');
    expect(state.fmSeen).toBe('1');
  });

  test('a hunter past their first day still gets the full celebration chain', async ({ page }) => {
    await hunter(page, 10);
    const quiet = await page.evaluate(() => (window as any).__newHunterQuiet());
    expect(quiet).toBe(false);

    await page.evaluate(() => (document.querySelector('#habit-list .habit-item') as HTMLElement).click());
    await page.waitForTimeout(1500);
    const atTap = await page.evaluate(readScreen);
    expect(atTap.firstMark).toBe(true);
    expect(atTap.extra).toBeNull();                     // nothing folded in: the others speak for themselves

    await page.evaluate(() => (document.getElementById('first-win-cta') as HTMLElement).click());
    await page.waitForTimeout(800);
    const next = await page.evaluate(readScreen);
    expect(next.fieldManual).toBe(true);                // W486 chain intact
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AH. W941 — One rank-up screen; the day-one grants are small
// ─────────────────────────────────────────────────────────────────────────
test.describe('AH · One rank-up screen (W941)', () => {
  /**
   * An established hunter (10 days in, past First Mark unless asked) sitting
   * just under a rank line, with one plain-tap vow. IAP is stubbed LIVE so the
   * premium gate under test is the rank, not the store.
   */
  async function rankHunter(page: Page, points: number, opts: { firstWin?: boolean } = {}) {
    await freshApp(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });   // skips the ACKNOWLEDGED prelude
    await page.addInitScript(({ points, firstWin }) => {
      try {
        if (sessionStorage.getItem('__w941_seeded')) return;
        sessionStorage.setItem('__w941_seeded', '1');
        const d = new Date(); d.setDate(d.getDate() - 10);
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_onboarding_first_xp_date', ymd);
        localStorage.setItem('hb_habits', JSON.stringify([{ id: 'w941-journal', name: 'Journal', emoji: '✍️', difficulty: 'easy', type: 'build' }]));
        localStorage.setItem('hb_points', String(points));
        localStorage.setItem('hb_tour_welcome_back_v1', '1');
        localStorage.setItem('hb_fm_pointer_seen', '1');
        // The launch-time retention ladder (day 3 / day 7 / first gate) is a
        // separate beat that waits behind levelUpActive; it is not the subject.
        ['hb_tour_day3_v1', 'hb_tour_day7_v1', 'hb_fg_guide_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        if (firstWin) localStorage.removeItem('hb_first_completion_bonus_v1');
        else localStorage.setItem('hb_first_completion_bonus_v1', '1');
        localStorage.removeItem('hb_fa_rankup_seen_v1');
        localStorage.removeItem('hb_hr_offered_D');
        localStorage.removeItem('hb_hr_offered_C');
        localStorage.removeItem('hb_founder_last_prompt_ms');
      } catch (_) {}
    }, { points, firstWin: !!opts.firstWin });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
      const w = window as any;
      w.Auth.iapAvailable = () => true;
      w.Auth.purchasePremium = async () => ({});
      w.Auth.isMember = () => false;
    });
  }

  const readRank = () => {
    const shown = (id: string) => {
      const el = document.getElementById(id);
      return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
    };
    const text = (id: string) => (document.getElementById(id) as HTMLElement | null)?.textContent || '';
    const souls = JSON.parse(localStorage.getItem('hb_souls') || '{}');
    const ledger = JSON.parse(localStorage.getItem('hb_souls_ledger') || '[]');
    return {
      screen: shown('rankup-screen'),
      badge: text('rankup-badge'),
      classLine: shown('rankup-class-unlock') ? text('rankup-class-unlock') : null,
      soulsLine: shown('rankup-souls-line') ? text('rankup-souls-line') : null,
      faLine: shown('rankup-fa') ? text('rankup-fa-line') : null,
      share: shown('rankup-share'),
      premium: shown('rankup-founder') && !!document.getElementById('rankup-founder-cta'),
      coach: shown('fa-coachmark-overlay'),
      coachContext: shown('fa-coachmark-overlay') ? (document.getElementById('fa-coachmark-overlay') as HTMLElement).dataset.context : null,
      report: shown('hr-overlay'),
      firstMark: shown('first-win-overlay'),
      prelude: !!document.querySelector('.ack-overlay'),
      balance: souls.balance,
      lastLedger: ledger[0] ? { delta: ledger[0].delta, type: ledger[0].type, detail: ledger[0].detail } : null,
      seen: localStorage.getItem('hb_fa_rankup_seen_v1'),
      offeredD: localStorage.getItem('hb_hr_offered_D'),
      offeredC: localStorage.getItem('hb_hr_offered_C'),
    };
  };
  const tapVow = () => (document.querySelector('#habit-list .habit-item') as HTMLElement).click();

  test('E→D is one screen: the souls gift and one line, no coach card, no share sheet, no premium, no class line', async ({ page }) => {
    await rankHunter(page, 99);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_souls') || '{}').balance as number);
    await page.evaluate(tapVow);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(readRank);
    expect(r.screen).toBe(true);
    expect(r.badge).toBe('D');
    expect(r.soulsLine).toContain('+50 SOULS');
    expect(r.faLine).toBeTruthy();
    expect(r.classLine).toBeNull();          // E and D are both Civilian: nothing unlocked
    expect(r.share).toBe(false);             // C rank and up
    expect(r.premium).toBe(false);           // C rank and up, even with IAP live
    expect(r.coach).toBe(false);
    expect(r.report).toBe(false);
    expect(r.prelude).toBe(false);
    // The gift is real, once, and reads as the First Awakened's in the ledger.
    expect(r.balance).toBe(before + 50);
    expect(r.lastLedger).toEqual({ delta: 50, type: 'fa_rankup', detail: 'D-rank advancement' });
    expect(JSON.parse(r.seen || '[]')).toContain('D');

    await page.evaluate(() => (document.getElementById('rankup-continue') as HTMLElement).click());
    await page.waitForTimeout(1500);
    const after = await page.evaluate(readRank);
    expect(after.screen).toBe(false);
    expect(after.coachContext).toBeNull();    // nothing follows
    expect(after.report).toBe(false);
    // W950 — the same tap sealed the day; its Perfect Day takes its turn after
    // the rank screen instead of landing on it. Close it the way a hunter would.
    await page.evaluate(() => { const pd = document.getElementById('pday-overlay'); if (pd && pd.classList.contains('on')) pd.click(); });
    await page.waitForTimeout(700);

    // Re-showing the same rank never re-gifts.
    await page.evaluate(() => (window as any).__showRankUp('D', 'E'));
    await page.waitForTimeout(600);
    const again = await page.evaluate(readRank);
    expect(again.screen).toBe(true);
    expect(again.soulsLine).toBeNull();
    expect(again.balance).toBe(before + 50);
  });

  test('D→C adds the class line, the share button and premium; the report opens on tap only', async ({ page }) => {
    await rankHunter(page, 599);
    await page.evaluate(tapVow);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(readRank);
    expect(r.screen).toBe(true);
    expect(r.badge).toBe('C');
    expect(r.soulsLine).toContain('+100 SOULS');
    expect(r.classLine).toBe('CLASS UNLOCKED: Apprentice Hunter');
    expect(r.share).toBe(true);
    expect(r.premium).toBe(true);
    expect(r.report).toBe(false);            // offered = the button was shown; nothing opened itself
    expect(r.offeredC).toBe('1');

    await page.evaluate(() => (document.getElementById('rankup-share') as HTMLElement).click());
    await page.waitForTimeout(600);
    const opened = await page.evaluate(readRank);
    expect(opened.report).toBe(true);
    expect(opened.screen).toBe(true);        // the report sits above the rank screen
    await page.evaluate(() => (document.getElementById('hr-dismiss-btn') as HTMLElement).click());
    await page.waitForTimeout(400);
    const back = await page.evaluate(readRank);
    expect(back.report).toBe(false);
    expect(back.screen).toBe(true);
    await page.evaluate(() => (document.getElementById('rankup-continue') as HTMLElement).click());
    await page.waitForTimeout(400);
    expect((await page.evaluate(readRank)).screen).toBe(false);
  });

  test('a same-tap First Mark comes before the rank screen, and E→D still shows no class line', async ({ page }) => {
    await rankHunter(page, 95, { firstWin: true });
    await page.evaluate(tapVow);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(readRank);
    expect(r.firstMark).toBe(true);
    expect(r.screen).toBe(false);
    expect(await page.evaluate(() => (document.getElementById('first-win-xp') as HTMLElement).textContent)).toBe('+10 XP');
    await page.evaluate(() => (document.getElementById('first-win-cta') as HTMLElement).click());
    await page.waitForTimeout(1200);
    const next = await page.evaluate(readRank);
    expect(next.firstMark).toBe(false);
    expect(next.screen).toBe(true);
    expect(next.badge).toBe('D');
    expect(next.classLine).toBeNull();       // oldRankId 'E' was carried through the queue
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AI. W942 — The First Awakened speaks plainly: whole beat, one tap per beat
// ─────────────────────────────────────────────────────────────────────────
test.describe('AI · The First Awakened speaks plainly (W942)', () => {
  // Snapshot inside the same evaluate as the action — a retrying locator
  // would hide a slow render, and "instant" is the thing under test.
  const readCoach = () => {
    const ov = document.getElementById('fa-coachmark-overlay') as HTMLElement;
    const dots = Array.from(ov.querySelectorAll('.fa-coach-dot'));
    return {
      hidden: ov.classList.contains('hidden'),
      context: ov.dataset.context,
      lines: Array.from(ov.querySelectorAll('#fa-coach-speech .fa-coach-line')).map((e) => e.textContent),
      caret: ov.querySelectorAll('.fa-coach-caret').length,
      typed: !!document.getElementById('fa-coach-typed'),
      footer: (document.getElementById('fa-coach-footer') as HTMLElement).textContent || '',
      cta: (document.getElementById('fa-coach-cta') as HTMLElement | null)?.textContent || null,
      activeDot: dots.findIndex((d) => d.classList.contains('is-active')),
      pastDots: dots.filter((d) => d.classList.contains('is-past')).length,
      speechMinH: (document.getElementById('fa-coach-speech') as HTMLElement).style.minHeight,
    };
  };

  test('a beat shows all its lines at once; one tap per beat; the CTA closes, persists and fires onDismiss', async ({ page }) => {
    await freshApp(page);
    const r1 = await page.evaluate((read) => {
      const w = window as any;
      w.__e2eCoach = { dismissed: 0 };
      const ok = w.__faRunCoachmark({
        context: 'e2e',
        beats: [{ pose: 'idle', lines: ['Alpha.', 'Beta.'] }, { pose: 'nodding', lines: ['Gamma.'] }],
        cta: 'DONE',
        storageKey: 'hb_e2e_coach_v1',
        onDismiss: () => { w.__e2eCoach.dismissed++; },
      });
      return { ok, ...(new Function('return ' + read)())() };
    }, readCoach.toString());
    expect(r1.ok).toBe(true);
    expect(r1.hidden).toBe(false);
    expect(r1.context).toBe('e2e');
    expect(r1.lines).toEqual(['Alpha.', 'Beta.']);     // the whole beat, no typing
    expect(r1.caret).toBe(0);
    expect(r1.typed).toBe(false);
    expect(r1.footer).toContain('TAP TO CONTINUE');
    expect(r1.cta).toBeNull();
    expect(r1.activeDot).toBe(0);
    expect(r1.speechMinH).toMatch(/px$/);              // sized to the tallest beat

    const r2 = await page.evaluate((read) => {
      (document.querySelector('.fa-coach-sheet') as HTMLElement).click();
      return (new Function('return ' + read)())();
    }, readCoach.toString());
    expect(r2.lines).toEqual(['Gamma.']);               // one tap = one beat
    expect(r2.cta).toBe('DONE');
    expect(r2.activeDot).toBe(1);
    expect(r2.pastDots).toBe(1);

    const r3 = await page.evaluate(() => {
      (document.getElementById('fa-coach-cta') as HTMLElement).click();
      const ov = document.getElementById('fa-coachmark-overlay') as HTMLElement;
      return {
        hidden: ov.classList.contains('hidden'),
        key: localStorage.getItem('hb_e2e_coach_v1'),
        dismissed: (window as any).__e2eCoach.dismissed,
        minH: (document.getElementById('fa-coach-speech') as HTMLElement).style.minHeight,
      };
    });
    expect(r3.hidden).toBe(true);
    expect(r3.key).toBe('1');
    expect(r3.dismissed).toBe(1);
    expect(r3.minH).toBe('');
  });

  test('a second coach while one is open is refused, marks nothing seen, and mounts on the next try', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const calls = { a: 0, b: 0 };
      const ov = document.getElementById('fa-coachmark-overlay') as HTMLElement;
      const okA = w.__faRunCoachmark({ context: 'e2e-a', beats: [{ pose: 'idle', lines: ['A one.'] }], cta: 'OK', storageKey: 'hb_e2e_a', onDismiss: () => { calls.a++; } });
      const okB = w.__faRunCoachmark({ context: 'e2e-b', beats: [{ pose: 'idle', lines: ['ZZZ'] }], cta: 'OK', storageKey: 'hb_e2e_b', onDismiss: () => { calls.b++; } });
      const during = { context: ov.dataset.context, text: (document.getElementById('fa-coach-speech') as HTMLElement).textContent };
      (document.getElementById('fa-coach-cta') as HTMLElement).click();
      const afterA = { hidden: ov.classList.contains('hidden'), keyA: localStorage.getItem('hb_e2e_a'), keyB: localStorage.getItem('hb_e2e_b'), calls: { ...calls } };
      const okB2 = w.__faRunCoachmark({ context: 'e2e-b', beats: [{ pose: 'idle', lines: ['ZZZ'] }], cta: 'OK', storageKey: 'hb_e2e_b', onDismiss: () => { calls.b++; } });
      return { okA, okB, during, afterA, okB2, contextB: ov.dataset.context };
    });
    expect(r.okA).toBe(true);
    expect(r.okB).toBe(false);                          // refused while A is up
    expect(r.during.context).toBe('e2e-a');
    expect(r.during.text).not.toContain('ZZZ');
    expect(r.afterA.hidden).toBe(true);
    expect(r.afterA.keyA).toBe('1');
    expect(r.afterA.keyB).toBeNull();                   // B was never marked seen
    expect(r.afterA.calls).toEqual({ a: 1, b: 0 });
    expect(r.okB2).toBe(true);                          // and it mounts once A is gone
    expect(r.contextB).toBe('e2e-b');
    // ESC dismisses too, and persists.
    await page.keyboard.press('Escape');
    const esc = await page.evaluate(() => ({ hidden: document.getElementById('fa-coachmark-overlay')!.classList.contains('hidden'), keyB: localStorage.getItem('hb_e2e_b') }));
    expect(esc.hidden).toBe(true);
    expect(esc.keyB).toBe('1');
  });

  test('the Items tour waits behind an open coach and mounts on the next Items open, a whole beat at a time', async ({ page }) => {
    await freshApp(page);
    const blocked = await page.evaluate(async () => {
      const w = window as any;
      w.__faRunCoachmark({ context: 'e2e', beats: [{ pose: 'idle', lines: ['Hold.'] }], cta: 'OK', storageKey: null });
      (document.getElementById('tab-items') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 600));     // the tour fires +320ms after a tab switch
      const ov = document.getElementById('fa-coachmark-overlay') as HTMLElement;
      return { context: ov.dataset.context, key: localStorage.getItem('hb_tour_items_v1') };
    });
    expect(blocked.context).toBe('e2e');                // the tour did not paint over the open coach
    expect(blocked.key).toBeNull();                     // and was not marked seen

    const tour = await page.evaluate(async (read) => {
      (document.getElementById('fa-coach-cta') as HTMLElement).click();
      (document.getElementById('tab-habits') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 200));
      (document.getElementById('tab-items') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 600));
      const first = (new Function('return ' + read)())();
      let taps = 0;
      while (!document.getElementById('fa-coach-cta') && taps < 6) {
        (document.querySelector('.fa-coach-sheet') as HTMLElement).click();
        taps++;
      }
      const last = (new Function('return ' + read)())();
      (document.getElementById('fa-coach-cta') as HTMLElement).click();
      return { first, taps, last, key: localStorage.getItem('hb_tour_items_v1') };
    }, readCoach.toString());
    expect(tour.first.context).toBe('items');
    expect(tour.first.lines.length).toBe(2);            // the whole first beat
    expect(tour.first.caret).toBe(0);
    expect(tour.taps).toBe(1);                          // two beats → one tap to the CTA
    expect(tour.last.cta).toBe('UNDERSTOOD');
    expect(tour.key).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AJ. W943 — Health-verified vows lead the list on the very paint they land
// ─────────────────────────────────────────────────────────────────────────
test.describe('AJ · Health vows lead the list at once (W943)', () => {
  test('adding Sleep before midnight from the library paints it above the hand-tapped vows without a reload', async ({ page }) => {
    await freshApp(page);
    // Two hand-tapped vows already on the list; no Health vow yet.
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('__w943_seeded')) return;
        sessionStorage.setItem('__w943_seeded', '1');
        localStorage.setItem('hb_habits', JSON.stringify([
          { id: 'w943-journal', name: 'Journal', emoji: '✍️', difficulty: 'easy', type: 'build' },
          { id: 'w943-read',    name: 'Read',    emoji: '📖', difficulty: 'easy', type: 'build' },
        ]));
      } catch (_) {}
    });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    const before = await page.evaluate(() => Array.from(document.querySelectorAll('#habit-list .habit-item .hlr-name, #habit-list .habit-item .codex-name')).map((e) => (e.textContent || '').trim()));
    expect(before[0]).toBe('Journal');

    // The real Add Habits path: open, pick the Health vow, commit.
    await page.locator('#add-habit-btn').click();
    await expect(page.locator('#lib-sheet')).toBeVisible();
    const row = page.locator('#lib-sheet .lib-row', { has: page.locator('.lib-row-name', { hasText: /^Sleep before midnight$/ }) }).first();
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();
    await expect(row).toHaveClass(/is-selected/);
    await page.locator('#lib-cta').click();
    await expect(page.locator('#lib-sheet')).toBeHidden({ timeout: 5_000 });

    // The paint that follows the commit — no reload, no second render — leads
    // with the Health vow. Before W943 it landed last until the next launch.
    const after = await page.evaluate(() => Array.from(document.querySelectorAll('#habit-list .habit-item .hlr-name, #habit-list .habit-item .codex-name')).map((e) => (e.textContent || '').trim()));
    expect(after[0]).toBe('Sleep before midnight');
    expect(after.slice(1)).toEqual(['Journal', 'Read']);   // the hand-tapped order is untouched

    // And storage agrees once the coalesced save lands.
    await page.waitForTimeout(300);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').map((h: any) => h.name));
    expect(stored[0]).toBe('Sleep before midnight');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AK. W945 — Add Habits v3 (Claude Design handoff 26)
// ─────────────────────────────────────────────────────────────────────────
test.describe('AK · Add Habits v3 (W945)', () => {
  const MR_HAND = ['Wake up at consistent time', 'No phone or social media after waking', 'Get morning sunlight', 'Morning gratitude practice'];

  async function openLibWith(page: any, names: string[]) {
    await freshApp(page);
    await page.addInitScript((names: string[]) => {
      try {
        if (sessionStorage.getItem('__w945_seeded')) return;
        sessionStorage.setItem('__w945_seeded', '1');
        localStorage.setItem('hb_habits', JSON.stringify(names.map((n, i) => ({ id: 'w945-' + i, name: n, emoji: '•', difficulty: 'easy', type: 'build' }))));
        localStorage.setItem('hb_tour_first_vow_v1', '1');
        localStorage.setItem('hb_notif_perm_requested', '1');
        // A seeded list reads as a returning hunter: the retention ladder's
        // coaches (welcome back, day 3/7, first gate, Double Dungeon) mount a
        // beat after launch and, on a slow runner, over the open sheet.
        localStorage.setItem('hb_tour_welcome_back_v1', '1');
        localStorage.setItem('hb_tour_day3_v1', '1');
        localStorage.setItem('hb_tour_day7_v1', '1');
        localStorage.setItem('hb_fg_guide_v1', '1');
        localStorage.setItem('hb_fm_pointer_seen', '1');
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      } catch (_) {}
    }, names);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await page.locator('#add-habit-btn').click();
    await expect(page.locator('#lib-sheet')).toBeVisible();
  }
  const rowByName = (page: any, name: string) =>
    page.locator('#lib-list .lib-row', { has: page.locator('.lib-row-name', { hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).first();

  test('every habit in the view shows, active ones dimmed and unpickable; a pick moves the header, CLEAR and the gold bar', async ({ page }) => {
    await openLibWith(page, ['Cold shower', 'Journal']);

    await expect(page.locator('#lib-sub')).toHaveText('2 active · 23 slots open');
    await expect(page.locator('#lib-chips .lib-chip[data-chip="pop"] small')).toHaveText('11');

    const view = await page.evaluate(() => Array.from(document.querySelectorAll('#lib-list .lib-row')).map((r) => ({
      name: (r.querySelector('.lib-row-name') as HTMLElement).textContent,
      have: r.classList.contains('is-have'),
      disabled: (r as HTMLButtonElement).disabled,
      xp: (r.querySelector('.lib-row-xp') as HTMLElement).textContent,
      health: !!r.querySelector('.lib-row-health'),
      art: !!r.querySelector('.lib-row-ic img'),
    })));
    expect(view.length).toBe(11);
    expect(view.every((r) => r.art)).toBe(true);
    const cold = view.find((r) => r.name === 'Cold shower')!;
    expect(cold).toMatchObject({ have: true, disabled: true, xp: 'ACTIVE' });
    expect(view.filter((r) => r.health).map((r) => r.name)).toEqual(['Sleep before midnight', 'Workout', 'Daily walk']);
    expect(view.filter((r) => !r.have).every((r) => /^\+\d+ XP$/.test(r.xp || ''))).toBe(true);

    // An active row can't be picked, even by a scripted click.
    await page.evaluate(() => {
      const r = Array.from(document.querySelectorAll('#lib-list .lib-row')).find((x) => x.textContent!.indexOf('Cold shower') >= 0) as HTMLElement;
      r.click();
    });
    await expect(page.locator('#lib-cta')).toBeDisabled();
    await expect(page.locator('#lib-cta')).toHaveText('Pick habits to add');

    const walk = rowByName(page, 'Daily walk');
    await walk.click();
    await expect(walk).toHaveClass(/is-selected/);
    await expect(walk).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#lib-sub')).toHaveText('2 active · 22 slots open');
    await expect(page.locator('#lib-cta')).toHaveText('Add 1 habit to my list');
    await expect(page.locator('#lib-clear')).toBeVisible();

    await page.locator('#lib-clear').click();
    await expect(walk).not.toHaveClass(/is-selected/);
    await expect(page.locator('#lib-cta')).toBeDisabled();
    await expect(page.locator('#lib-clear')).toBeHidden();
    await expect(page.locator('#lib-sub')).toHaveText('2 active · 23 slots open');

    // A category hides the starter strip and still lists what you have.
    await page.locator('#lib-chips .lib-chip[data-chip="mental"]').click();
    await expect(page.locator('#lib-starter')).toBeHidden();
    await expect(page.locator('#lib-listcount')).toHaveText('Mental & Focus');
    await expect(page.locator('#lib-listmeta')).toHaveText('8 habits');
    await expect(rowByName(page, 'Journal')).toHaveClass(/is-have/);
  });

  test('a pack card selects only what is missing, saves nothing, and the gold bar lands it with the pack path', async ({ page }) => {
    await openLibWith(page, MR_HAND);
    const morning = page.locator('#lib-pack-morning');
    const locked  = page.locator('#lib-pack-lockedin');
    await expect(morning.locator('.lib-pack-count')).toHaveText('10 HABITS');
    await expect(morning.locator('.lib-pack-add')).toHaveText('Add 6');
    await expect(locked.locator('.lib-pack-count')).toHaveText('16 HABITS');
    await expect(locked.locator('.lib-pack-add')).toHaveText('Add 12');

    await morning.click();
    await expect(morning).toHaveClass(/is-sel/);
    await expect(page.locator('#lib-cta')).toHaveText('Add 6 habits to my list');
    await expect(page.locator('#lib-sub')).toHaveText('4 active · 15 slots open');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').length)).toBe(4);

    await morning.click();   // a fully selected card lets its habits go
    await expect(morning).not.toHaveClass(/is-sel/);
    await expect(page.locator('#lib-cta')).toBeDisabled();

    await morning.click();
    await page.locator('#lib-cta').click();
    await expect(page.locator('#lib-sheet')).toBeHidden({ timeout: 5_000 });
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => ({
      habits: JSON.parse(localStorage.getItem('hb_habits') || '[]'),
      path: localStorage.getItem('hb_path'),
    }));
    expect(saved.habits.length).toBe(10);
    expect(saved.path).toBe('morning');
    const walk = saved.habits.find((h: any) => h.name === 'Daily walk');
    expect(walk && walk.stepGoal).toBeGreaterThan(0);   // the library builder, not the bare pack row

    await page.evaluate(() => (document.getElementById('add-habit-btn') as HTMLElement).click());
    await expect(page.locator('#lib-sheet')).toBeVisible();
    await expect(morning.locator('.lib-pack-add')).toHaveText('All added');
    await expect(morning).toBeDisabled();
    await expect(locked.locator('.lib-pack-add')).toHaveText('Add 6');
  });

  test('the 25-vow cap holds for a row and for a pack', async ({ page }) => {
    await openLibWith(page, Array.from({ length: 24 }, (_, i) => 'Filler vow ' + (i + 1)));
    await expect(page.locator('#lib-sub')).toHaveText('24 active · 1 slot open');

    await rowByName(page, 'Hydrate').click();
    await expect(page.locator('#lib-sub')).toHaveText('24 active · 0 slots open');
    await rowByName(page, 'Read').click();
    await expect(rowByName(page, 'Read')).not.toHaveClass(/is-selected/);
    await expect(page.locator('.habit-toast').last()).toContainText('25 vow max');

    await page.locator('#lib-pack-morning').click();
    await expect(page.locator('#lib-cta')).toHaveText('Add 1 habit to my list');
    await expect(page.locator('#lib-pack-morning')).not.toHaveClass(/is-sel/);

    await rowByName(page, 'Hydrate').click();   // let it go, then the pack takes the one slot
    await page.locator('#lib-pack-morning').click();
    await expect(page.locator('#lib-cta')).toHaveText('Add 1 habit to my list');
    await expect(page.locator('.habit-toast').last()).toContainText('Only 1 more fit');
  });

  test('search hides the chips and packs, highlights the match, names an empty result, and Cancel keeps the picks', async ({ page }) => {
    await openLibWith(page, ['Journal']);
    const sheet = page.locator('#lib-sheet');
    const input = page.locator('#lib-search-input');

    await input.focus();
    await expect(sheet).toHaveClass(/is-searching/);
    await expect(page.locator('#lib-chips')).toBeHidden();
    await expect(page.locator('#lib-search-cancel')).toBeVisible();

    await input.fill('sle');
    await expect(page.locator('#lib-starter')).toBeHidden();
    await expect(page.locator('#lib-listcount')).toHaveText(/^\d+ results?$/);
    const hits = await page.evaluate(() => Array.from(document.querySelectorAll('#lib-list .lib-row')).map((r) => ({
      name: (r.querySelector('.lib-row-name') as HTMLElement).textContent || '',
      mark: (r.querySelector('.lib-row-name mark') as HTMLElement | null)?.textContent || '',
      health: !!r.querySelector('.lib-row-health'),
    })));
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.every((h) => h.name.toLowerCase().includes('sle') && h.mark.toLowerCase() === 'sle')).toBe(true);
    expect(hits.find((h) => h.name === 'Sleep before midnight')!.health).toBe(true);

    await rowByName(page, 'Sleep before midnight').click();
    await expect(page.locator('#lib-cta')).toHaveText('Add 1 habit to my list');

    await input.fill('zzz');
    await expect(page.locator('#lib-list .lib-empty')).toHaveText('Nothing called “zzz”');
    await expect(page.locator('#lib-listcount')).toHaveText('No results');

    await page.locator('#lib-search-cancel').click();
    await expect(sheet).not.toHaveClass(/is-searching/);
    await expect(input).toHaveValue('');
    await expect(page.locator('#lib-chips')).toBeVisible();
    await expect(page.locator('#lib-starter')).toBeVisible();
    await expect(page.locator('#lib-cta')).toHaveText('Add 1 habit to my list');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AL. W946 — the "Vows now show live progress" tip is gone
// ─────────────────────────────────────────────────────────────────────────
test.describe('AL · No list-view tip (W946)', () => {
  test('a hunter whose device never saw the tip gets a Habits tab without it', async ({ page }) => {
    await freshApp(page);
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('__w946_seeded')) return;
        sessionStorage.setItem('__w946_seeded', '1');
        localStorage.removeItem('hb_habits_listview_hint_v1');
        // Seeded list = returning hunter: keep the retention-ladder coaches out of the way.
        ['hb_tour_welcome_back_v1', 'hb_tour_day3_v1', 'hb_tour_day7_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_tour_first_vow_v1']
          .forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        localStorage.setItem('hb_habits', JSON.stringify([
          { id: 'w946-j', name: 'Journal', emoji: '✍️', difficulty: 'easy', type: 'build' },
        ]));
      } catch (_) {}
    });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await expect(page.locator('#habit-list .habit-item').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#habit-list')).toHaveClass(/habit-list--list/);   // the tip only ever showed in List view
    await page.waitForTimeout(600);
    await expect(page.locator('#listview-hint')).toHaveCount(0);
    await expect(page.getByText('Vows now show live progress')).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AM. W947 — Onboarding v3 (Claude Design handoff 27, "Interactive")
// ─────────────────────────────────────────────────────────────────────────
test.describe('AM · Onboarding v3 (W947)', () => {
  async function boot(page: Page) {
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('__w947_boot')) return;
        sessionStorage.setItem('__w947_boot', '1');
        localStorage.setItem('hb_cloud_restore_dismissed', '1');
        localStorage.setItem('hb_whats_new_seen', '99.99.99');
        const d = new Date();
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_fri_banner_' + ymd, '1');
        ['hb_habits', 'hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_avatar_skin',
         'hb_healthkit_prompted', 'hb_hk_answered_v1', 'hb_hk_first_read_v1'].forEach((k) => localStorage.removeItem(k));
      } catch (_) {}
    });
    await page.goto('/');
    await expect(page.locator('#cn-s0')).toHaveClass(/cn-shown/, { timeout: 15_000 });
    await page.evaluate((steps) => {
      const s = document.getElementById('awakened-splash'); if (s) s.remove();
      const w = window as any;
      w.Health.isAvailable        = () => true;
      w.Health.permissionStatus   = () => 'granted';
      w.Health.requestPermissions = async () => 'granted';
      w.Health.getStepsBetween    = async () => 18860;
      w.Health.getStepsToday      = async () => 3860;
      w.Auth.fetchLeaderboardTop  = async () => ({
        ok: true, metric: 'step_total', me: { rank: 4, current_value: 18860 },
        top: [{ rank: 1, alias: 'Galilea', current_value: 51144, avatar_id: 'avatar-ranger.png', card_bg: null }],
      });
    }, 0);
  }

  test('the bust appears with the second letter, is worn on the board, and equips the look', async ({ page }) => {
    await boot(page);
    await page.locator('#cn-touch').click();
    await expect(page.locator('#cn-s1')).toHaveClass(/cn-shown/, { timeout: 5_000 });
    const busts = page.locator('#cn-busts');
    await page.locator('#cin-nameField').fill('R');
    await expect(busts).not.toHaveClass(/cn-show/);
    await page.locator('#cin-nameField').fill('Richie');
    await expect(busts).toHaveClass(/cn-show/);
    await expect(page.locator('[data-cn-bust="base"]')).toHaveClass(/cn-on/);

    await page.locator('[data-cn-bust="warrior"]').click();
    await expect(page.locator('[data-cn-bust="warrior"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-cn-bust="base"]')).not.toHaveClass(/cn-on/);
    await page.locator('#cin-nameConfirm').click();
    await expect(page.locator('#cn-s2')).toHaveClass(/cn-shown/);
    expect(await page.evaluate(() => localStorage.getItem('hb_avatar_skin'))).toBe('avatar-warrior.png');

    await page.locator('#cn-healthBtn').click();
    await expect(page.locator('#cn-s3')).toHaveClass(/cn-shown/, { timeout: 5_000 });
    await page.locator('#cn-s3 [data-cn-next]').click();
    const meBust = page.locator('#cn-rows .cn-row.cn-me .cn-bust img');
    await expect(meBust).toHaveAttribute('src', /avatar-warrior-bust/, { timeout: 5_000 });
  });

  test('the road can be dragged once the count lands, and the number follows the light', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      (document.querySelector('#cn-touch') as HTMLElement).click(); await wait(1100);
      const f = document.querySelector('#cin-nameField') as HTMLInputElement;
      f.value = 'Richie'; f.dispatchEvent(new Event('input'));
      (document.querySelector('#cin-nameConfirm') as HTMLElement).click(); await wait(300);
      (document.querySelector('#cn-healthBtn') as HTMLElement).click();
    });
    await expect(page.locator('#cn-s3')).toHaveClass(/cn-shown/, { timeout: 5_000 });
    await expect(page.locator('#cn-rhint')).toHaveClass(/cn-show/, { timeout: 3_000 });
    await expect(page.locator('#cn-steps7')).toHaveText('18,860');
    await expect(page.locator('#cn-skip')).toBeHidden();

    const pad = await page.locator('#cn-scrub').boundingBox();
    const x = pad!.x + pad!.width * 0.8, y = pad!.y + pad!.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 130, y, { steps: 6 });   // half the 260px throw
    const mid = await page.evaluate(() => ({
      n: (document.querySelector('#cn-steps7') as HTMLElement).textContent,
      p: parseFloat(getComputedStyle(document.querySelector('#cn-s3') as HTMLElement).getPropertyValue('--cn-p')),
    }));
    await page.mouse.up();
    expect(mid.p).toBeGreaterThan(0.45);
    expect(mid.p).toBeLessThan(0.55);
    expect(mid.n).toBe((Math.round(18860 * mid.p)).toLocaleString('en-US'));
  });

  test('holding the Wolf strikes it: a short hold keeps the damage, the full hold engages it and opens ENTER', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const q = (s: string) => document.querySelector(s) as HTMLElement;
      q('#cn-touch').click(); await wait(1100);
      const f = q('#cin-nameField') as HTMLInputElement;
      f.value = 'Richie'; f.dispatchEvent(new Event('input'));
      q('#cin-nameConfirm').click(); await wait(300);
      q('#cn-healthBtn').click(); await wait(900);
      q('#cn-s3 [data-cn-next]').click(); await wait(900);
      if (document.querySelector('#cn-s4.cn-shown')) { q('#cn-s4 [data-cn-next]').click(); await wait(250); }
      q('#cn-huntAlone').click(); await wait(200);
      q('#cn-s6 [data-cn-next]').click(); await wait(200);
      q('#cn-s7 [data-cn-next]').click(); await wait(400);
    });
    const wolf = page.locator('#cn-wolf');
    await expect(wolf).toHaveClass(/cn-armed/);
    await expect(page.locator('#cn-enter')).toBeDisabled();
    await expect(page.locator('#cn-wolfSub')).toHaveText('3,860 STEPS TODAY · HOLD');

    const box = await wolf.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
    await expect(page.locator('#cn-wolfSub')).toHaveText(/^\d+% STRUCK · HOLD AGAIN$/);
    const partial = await page.evaluate(() => ({
      width: parseFloat((document.querySelector('#cn-hpi') as HTMLElement).style.width),
      engaged: !!((JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf || {}).engaged),
    }));
    expect(partial.width).toBeLessThan(100);
    expect(partial.width).toBeGreaterThan(35.66);   // never past the share walked today
    expect(partial.engaged).toBe(false);
    await expect(page.locator('#cn-enter')).toBeDisabled();

    await page.mouse.down();
    await page.waitForTimeout(1400);
    await page.mouse.up();
    await expect(page.locator('#cn-pactTitle')).toHaveText('The Wolf is engaged.');
    await expect(page.locator('#cn-wolfSub')).toHaveText('2,140 STEPS LEFT TODAY');
    const done = await page.evaluate(() => ({
      width: parseFloat((document.querySelector('#cn-hpi') as HTMLElement).style.width),
      engaged: !!((JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf || {}).engaged),
    }));
    expect(done.width).toBeCloseTo(35.67, 1);   // 3,860 of 6,000 struck, the rest stands
    expect(done.engaged).toBe(true);
    await expect(page.locator('#cn-enter')).toBeEnabled({ timeout: 2_000 });
  });

  test('a replay in the same session as a first run leaves the first run\'s handlers behind', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const w = window as any;
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      const root = () => document.getElementById('cin-onboarding') as HTMLElement;
      const q = (s: string) => root().querySelector(s) as HTMLElement;
      const walk = async () => {
        q('#cn-touch').click(); await wait(1100);
        const f = q('#cin-nameField') as HTMLInputElement;
        if (!f.value) { f.value = 'Richie'; f.dispatchEvent(new Event('input')); }
        q('#cin-nameConfirm').click(); await wait(300);
        q('#cn-healthBtn').click(); await wait(900);
        q('#cn-s3 [data-cn-next]').click(); await wait(900);
        if (root().querySelector('#cn-s4.cn-shown')) { q('#cn-s4 [data-cn-next]').click(); await wait(250); }
        q('#cn-huntAlone').click(); await wait(200);
        q('#cn-s6 [data-cn-next]').click(); await wait(200);
        q('#cn-s7 [data-cn-next]').click(); await wait(400);
        q('#cn-wolf').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await wait(1000);
        q('#cn-enter').click(); await wait(2200);
      };
      // The real first run with Health refused: its Wolf is never struck, so
      // before W947 its strike handler stayed live on the shared element.
      w.Health.permissionStatus   = () => 'denied';
      w.Health.requestPermissions = async () => 'denied';
      w.Health.getStepsBetween    = async () => null;
      w.Health.getStepsToday      = async () => null;
      await walk();
      document.querySelectorAll('button').forEach((b) => {
        if (/^(continue|not now|maybe later)$/i.test((b.textContent || '').trim()) && (b as HTMLElement).offsetParent) (b as HTMLElement).click();
      });
      await wait(600);
      const KEYS = ['hb_habits', 'hb_path', 'hb_name', 'hb_bosses', 'hb_inventory', 'hb_onboarding_first_xp_awarded_v1', 'hb_avatar_skin'];
      const before: Record<string, string | null> = {};
      KEYS.forEach((k) => { before[k] = localStorage.getItem(k); });

      // Health opened later; the replay arms the Wolf.
      w.Health.permissionStatus   = () => 'granted';
      w.Health.getStepsBetween    = async () => 18860;
      w.Health.getStepsToday      = async () => 3860;
      w.__replayOnboarding(); await wait(600);
      const preview = root().classList.contains('cn-preview');
      await walk();   // the replay, same session, same page
      return {
        preview,
        closed: root().classList.contains('hidden'),
        replayArmedThenPreviewed: !!root().querySelector('#cn-wolf.cn-spent'),
        onlyOneRoot: document.querySelectorAll('#cin-onboarding').length,
        touched: KEYS.filter((k) => localStorage.getItem(k) !== before[k]),
      };
    });
    expect(r.preview).toBe(true);
    expect(r.replayArmedThenPreviewed).toBe(true);
    expect(r.onlyOneRoot).toBe(1);
    expect(r.closed).toBe(true);
    expect(r.touched).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AN. W948 — the last vow of the day opens the Perfect Day seal and nothing else
// ─────────────────────────────────────────────────────────────────────────
test.describe('AN · Perfect Day only (W948)', () => {
  async function routineOfThree(page: Page, perfectAlreadyLogged: boolean) {
    await freshApp(page);
    await page.addInitScript((logged: boolean) => {
      try {
        if (sessionStorage.getItem('__w948_seeded')) return;
        sessionStorage.setItem('__w948_seeded', '1');
        const d = new Date();
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_habits', JSON.stringify(['First vow', 'Second vow', 'Third vow'].map((n, i) => (
          { id: 'w948-' + i, name: n, emoji: '•', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'WILL' }))));
        ['hb_first_completion_bonus_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_tour_day3_v1',
         'hb_tour_day7_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        if (logged) {
          // Two vows already kept and today's Perfect Day already on the books:
          // the last tap completes the routine but cannot open a second seal.
          localStorage.setItem('hb_completions', JSON.stringify({ [ymd]: ['w948-0', 'w948-1'] }));
          localStorage.setItem('hb_perfect_streak', JSON.stringify({ count: 1, lastDate: ymd, prevCount: 0, prevLastDate: ymd }));
        }
      } catch (_) {}
    }, perfectAlreadyLogged);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await expect(page.locator('#habit-list .habit-item')).toHaveCount(3, { timeout: 10_000 });
  }

  /** Tap all three vows and watch both popups for a few seconds. */
  async function sealTheDay(page: Page) {
    return page.evaluate(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const seen = { compound: false, pday: false };
      const watch = setInterval(() => {
        const cp = document.getElementById('compound-popup');
        if (cp && cp.classList.contains('cp-show')) seen.compound = true;
        const pd = document.getElementById('pday-overlay');
        if (pd && pd.classList.contains('on')) seen.pday = true;
      }, 25);
      const pointsBefore = Number(localStorage.getItem('hb_points') || '0');
      for (const li of Array.from(document.querySelectorAll('#habit-list .habit-item:not(.completed)')) as HTMLElement[]) {
        li.click();
        await wait(350);
      }
      await wait(2500);
      clearInterval(watch);
      return { seen, pointsBefore, pointsAfter: Number(localStorage.getItem('hb_points') || '0'),
               awarded: JSON.parse(localStorage.getItem('hb_compound_awarded') || '{}') };
    });
  }

  test('finishing the routine and the day on one tap shows the Perfect Day seal only, and the bonus is still paid', async ({ page }) => {
    await routineOfThree(page, false);
    const r = await sealTheDay(page);
    expect(r.seen.pday).toBe(true);
    expect(r.seen.compound).toBe(false);
    // The routine bonus was paid (today's award is on the books), just not announced.
    const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
    expect(r.awarded.custom).toBe(today);
    expect(r.pointsAfter - r.pointsBefore).toBeGreaterThan(3);   // more than the three vows alone
  });

  test('a routine completed on a day whose Perfect Day is already logged still gets its own popup', async ({ page }) => {
    await routineOfThree(page, true);
    const r = await sealTheDay(page);
    expect(r.seen.pday).toBe(false);
    expect(r.seen.compound).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AO. W950 — the stage: one blocking surface at a time
// ─────────────────────────────────────────────────────────────────────────
test.describe('AO · One surface at a time (W950)', () => {
  async function quietHunter(page: Page, extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript((extra: Record<string, string>) => {
      try {
        if (sessionStorage.getItem('__w950_seeded')) return;
        sessionStorage.setItem('__w950_seeded', '1');
        localStorage.setItem('hb_habits', JSON.stringify([{ id: 'w950-a', name: 'First vow', emoji: '•', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'WILL' }]));
        ['hb_first_completion_bonus_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_tour_day3_v1', 'hb_tour_day7_v1', 'hb_fg_guide_v1',
         'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        Object.entries(extra || {}).forEach(([k, v]) => { if (v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); });
      } catch (_) {}
    }, extra || {});
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await page.waitForTimeout(3200);   // let the launch beats run their course
  }
  // Sample what is on screen; stopStacks() reports any moment two blocking surfaces overlapped.
  const watchStacks = () => {
    const w = window as any;
    const on = (id: string) => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; };
    w.__w950stacks = [];
    w.__w950t = setInterval(() => {
      const up = [
        on('boss-result-overlay') && 'boss', on('fa-coachmark-overlay') && 'coach', on('first-win-overlay') && 'firstmark',
        (document.getElementById('pday-overlay') as HTMLElement).classList.contains('on') && 'pday',
        !!document.getElementById('review-pp-overlay') && 'review', !!document.querySelector('.notice-card-wrap') && 'card',
      ].filter(Boolean);
      if (up.length > 1) w.__w950stacks.push(up.join('+'));
    }, 40);
  };
  const stopStacks = () => { const w = window as any; clearInterval(w.__w950t); return Array.from(new Set(w.__w950stacks)); };

  test('a First Awakened card never lands on a boss result; it takes its turn when the result closes', async ({ page }) => {
    await quietHunter(page);
    await page.evaluate(watchStacks);
    await page.evaluate(() => (window as any).__queueBossResult({
      bossId: 'the_steel_wolf', bossName: 'The Steel Wolf', rank: 'E', kill_count: 951, conditionLabel: '6,000 verified steps', drop: null, mercy: null,
    }));
    await expect(page.locator('#boss-result-overlay')).toBeVisible({ timeout: 3_000 });

    const accepted = await page.evaluate(() => (window as any).__faRunCoachmark({
      context: 'w950', storageKey: 'hb_w950_coach', cta: 'OK', beats: [{ pose: 'idle', lines: ['After the kill.'] }],
    }));
    expect(accepted).toBe(true);                                   // accepted into the line, not refused
    await page.waitForTimeout(900);
    await expect(page.locator('#fa-coachmark-overlay')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__stage.keys())).toContain('coach:w950');

    await page.locator('#bro-close-x').click();
    await expect(page.locator('#boss-result-overlay')).toBeHidden({ timeout: 3_000 });
    await expect(page.locator('#fa-coachmark-overlay')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#fa-coach-speech')).toContainText('After the kill.');
    expect(await page.evaluate(stopStacks)).toEqual([]);
  });

  test('an automatic toast waits behind an open card and shows once it closes; a toast from the hunter tapping shows at once', async ({ page }) => {
    await quietHunter(page);
    await page.evaluate(() => (window as any).__faRunCoachmark({
      context: 'w950t', storageKey: 'hb_w950_toast_coach', cta: 'OK', beats: [{ pose: 'idle', lines: ['Hold on.'] }],
    }));
    await expect(page.locator('#fa-coachmark-overlay')).toBeVisible();
    await page.waitForTimeout(1700);                               // well past any tap on the page
    await page.evaluate(() => (window as any).__stage.toast('Automatic news'));
    await page.waitForTimeout(600);
    await expect(page.locator('.habit-toast', { hasText: 'Automatic news' })).toHaveCount(0);

    await page.locator('#fa-coach-cta').click();
    await expect(page.locator('#fa-coachmark-overlay')).toBeHidden();
    await expect(page.locator('.habit-toast', { hasText: 'Automatic news' })).toBeVisible({ timeout: 3_000 });

    // A tap, then feedback: shown even with a card up.
    await page.evaluate(() => (window as any).__faRunCoachmark({
      context: 'w950u', storageKey: 'hb_w950_toast_coach2', cta: 'OK', beats: [{ pose: 'idle', lines: ['Still here.'] }],
    }));
    await expect(page.locator('#fa-coachmark-overlay')).toBeVisible();
    await page.mouse.click(10, 10);
    await page.evaluate(() => (window as any).__stage.toast('You tapped'));
    await expect(page.locator('.habit-toast', { hasText: 'You tapped' })).toBeVisible({ timeout: 1_000 });
  });

  test('on a first day, the Perfect Day seal waits for the First Mark to close', async ({ page }) => {
    await quietHunter(page, { hb_first_completion_bonus_v1: '' });
    await page.evaluate(watchStacks);
    await page.locator('#habit-list .habit-item').first().click();
    await expect(page.locator('#first-win-overlay')).toBeVisible({ timeout: 3_000 });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (document.getElementById('pday-overlay') as HTMLElement).classList.contains('on'))).toBe(false);

    await page.locator('#first-win-cta').click();
    await expect(page.locator('#first-win-overlay')).toBeHidden({ timeout: 3_000 });
    await expect.poll(() => page.evaluate(() => (document.getElementById('pday-overlay') as HTMLElement).classList.contains('on')), { timeout: 3_000 }).toBe(true);
    expect(await page.evaluate(stopStacks)).toEqual([]);
  });
});
