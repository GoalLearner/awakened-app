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
  // W1045 — the app now asks the App Store for its live version on every launch (it was Mondays
  // only). The suite answers for Apple: nothing to report, so no banner, no event and no network.
  // A spec that wants an answer routes the lookup itself (the later route wins).
  await page.route('**/itunes.apple.com/lookup**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"resultCount":0,"results":[]}' }));
  await page.addInitScript(() => {
    // W1047 — every solo kill now rolls 1 in 20 for a shadow, and a hit plays a full-screen
    // ceremony. Many specs kill bosses; the suite pins the dice to "never" so none of them can
    // meet one by chance. Suite CC rolls its own.
    (window as any).__shadowDice = () => 1;
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
/** Open the Add Habits library by whichever door the current state shows.
 *  W956/W958 — the footer bar (SEAL A NEW VOW) stands down while the First Vow
 *  picker is up; it and the picker's "Browse the full library →" both call
 *  openLibrary, and the picker screen must fit one phone screen. A hunter with
 *  no vows yet therefore reaches the library through the picker's link. */
async function openAddHabits(page: Page) {
  const footer = page.locator('#add-habit-btn');
  if (await footer.isVisible()) { await footer.click(); return; }
  await page.locator('#empty-state-browse').click();
}

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
      // Daily Insight (the morning briefing) — a full-screen bottom sheet that
      // fires once per device-local day for any welcomed user WITH ACTIVE VOWS.
      // freshApp itself seeds hb_habits='[]', so the gate has always refused it
      // here; the moment a spec seeds real vows (AN/AO/AP/AQ/AR) it becomes
      // eligible, and since W950 it is a STAGE surface — it waits behind the
      // launch beats and then pumps, so when it arrives is a race. On CI it
      // landed mid-spec and its .vn-overlay swallowed every click (13 failures,
      // 2026-09-16 UTC, all green locally). Same treatment as the Friday
      // banner: stamp the per-day flag so shouldShowDailyInsight() refuses.
      localStorage.setItem('hb_daily_insight_last_shown', ymd);
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
    // Copy may shift between "Add Habit", "+ ADD", etc. W956 — a hunter with no
    // vows yet sees the First Vow picker instead, whose own library link is the
    // door; the claim under test is that SOME way in is on screen, not its name.
    const addAffordance = page
      .getByRole('button', { name: /seal a new vow|add\s*habit|browse the full library/i })
      .first();
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
    await openAddHabits(page);
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
        // W956 — whichever door is up: the footer button, or the First Vow
        // picker's library link when this hunter has no vows yet.
        const btn = document.getElementById('add-habit-btn');
        const link = document.getElementById('empty-state-browse');
        const el = (btn && !btn.classList.contains('hidden')) ? btn : link;
        if (el) (el as HTMLElement).click();
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
    await openAddHabits(page);
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
    expect(found.difficulty).toBe('easy');   // W970: every custom vow is Easy

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
      localStorage.setItem('hb_health_seal_cutover_v1', '2999-01-01');   // W970: seeded days predate the change
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
      localStorage.setItem('hb_health_seal_cutover_v1', '2999-01-01');   // W970: seeded days predate the change
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
      localStorage.setItem('hb_health_seal_cutover_v1', '2999-01-01');   // W970: seeded days predate the change
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
      localStorage.setItem('hb_health_seal_cutover_v1', '2999-01-01');   // W970: seeded days predate the change
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
      localStorage.setItem('hb_health_seal_cutover_v1', '2999-01-01');   // W970: seeded days predate the change
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
/**
 * W1050 — boot a genuinely signed-out page so the REAL gate controller
 * (setupSignInGateIfNeeded) mounts the mark and the gate. Auth is patched the
 * instant auth.js assigns it, so the localhost dev sign-in stands down before
 * app.js asks for it. `name` leaves an hb_name behind, the way a hunter whose
 * session expired does (W816).
 */
async function signedOutGate(page: Page, opts: { name?: string } = {}) {
  await page.addInitScript((o) => {
    try { if (o.name) localStorage.setItem('hb_name', o.name); } catch (_) {}
    let auth: any;
    Object.defineProperty(window, 'Auth', {
      configurable: true,
      get() { return auth; },
      set(v) { v.devSignInIfLocalhost = () => false; auth = v; },
    });
  }, opts);
  await page.goto('/');
  // The mark goes up as the splash lifts, about a second and a half after boot.
  await expect(page.locator('#signin-gate .ob4-s-gate')).toHaveClass(/is-on/, { timeout: 15_000 });
}
/** The middle of the mark, for real pointer events. */
async function markCentre(page: Page, host = '#signin-gate') {
  const b = await page.locator(host + ' .ob4-mark').boundingBox();
  return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 };
}
/** How far the hold has charged a screen (the --ob4-c the mark and the Wolf both drive). */
function charge(page: Page, sel: string) {
  return page.evaluate((s) => parseFloat((document.querySelector(s) as HTMLElement).style.getPropertyValue('--ob4-c') || '0'), sel);
}
/**
 * Record, in the page, every state a hold screen passes through: [charge, classes]
 * each time either changes. A test can then say what happened DURING a hold
 * without racing it from out here. Read it back with chargeSeen().
 */
async function watchCharge(page: Page, sel: string) {
  await page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement;
    const seen: Array<[number, string]> = [];
    (window as any).__chargeSeen = seen;
    new MutationObserver(() => {
      seen.push([parseFloat(el.style.getPropertyValue('--ob4-c') || '0'), el.className]);
    }).observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
  }, sel);
}
function chargeSeen(page: Page) {
  return page.evaluate(() => (window as any).__chargeSeen as Array<[number, string]>);
}

test.describe('W · Sign-in gate (W930)', () => {
  test('no "Try it first" guest button or note; the existing-guest claim path remains', async ({ page }) => {
    await freshApp(page);
    // W1050 — the gate is built by app.js when it is needed, so a signed-in
    // page carries only its empty container. Exactly one, and nothing in it.
    await expect(page.locator('#signin-gate')).toHaveCount(1);
    await expect(page.locator('#signin-gate')).toBeHidden();
    await expect(page.locator('#signin-apple-btn')).toHaveCount(0);
    await expect(page.locator('#signin-guest-btn')).toHaveCount(0);
    await expect(page.locator('.signin-guest-note')).toHaveCount(0);
    await expect(page.locator('#guest-claim-apple')).toHaveCount(1);
    await expect(page.locator('#guest-claim-cancel')).toHaveCount(1);
    const hasStartGuest = await page.evaluate(() => typeof (window as any).Auth.startGuest);
    expect(hasStartGuest).toBe('undefined');
    const hasIsGuest = await page.evaluate(() => typeof (window as any).Auth.isGuest);
    expect(hasIsGuest).toBe('function');
  });

  test('signed out, the gate offers the mark and Sign in with Apple and no other way in', async ({ page }) => {
    await signedOutGate(page);
    await expect(page.locator('#signin-gate')).toHaveCount(1);
    await expect(page.locator('#signin-gate')).toBeVisible();
    await expect(page.locator('#signin-apple-btn')).toHaveCount(1);
    await expect(page.locator('#signin-guest-btn')).toHaveCount(0);
    await expect(page.locator('.signin-guest-note')).toHaveCount(0);
    const r = await page.evaluate(() => {
      const gate = document.getElementById('signin-gate') as HTMLElement;
      return {
        buttons: Array.from(gate.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || (b.textContent || '').trim()),
        text: gate.textContent || '',
        screens: (window as any).__ob.order,
      };
    });
    // Two controls on the whole screen: the mark, and Apple's button. (The Skip
    // in the list is the engine's own, shown from the board on; the gate has no board.)
    expect(r.buttons).toEqual(['Skip', 'Hold the mark', 'Sign in with Apple']);
    expect(r.screens).toEqual(['gate']);
    expect(r.text).not.toMatch(/try it first|guest|not now|maybe later/i);

    // That Skip must be out of reach, not just out of sight: a faded button is
    // still the first stop for a keyboard and still read out by VoiceOver, and
    // here it would hand off into nothing and leave a dark screen with no way
    // to sign in.
    const skip = page.locator('#signin-gate .ob4-skip');
    await expect(skip).toBeHidden();
    await expect(skip).toBeDisabled();
    await expect(skip).toHaveCSS('pointer-events', 'none');
    // What assistive tech is offered while the dark is shut: the mark, and only the mark.
    await expect(page.locator('#signin-gate').getByRole('button')).toHaveCount(1);
    await expect(page.locator('#signin-gate').getByRole('button', { name: 'Hold the mark' })).toHaveCount(1);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).className)).toBe('ob4-mark');
    await skip.evaluate((b) => (b as HTMLElement).click());   // and a click that reaches it anyway does nothing
    await page.evaluate(() => (window as any).__ob.go('gate', { open: true }));
    expect(await page.evaluate(() => (window as any).__ob.leaving)).toBe(false);
    await expect(page.locator('#signin-gate .ob4-hand')).not.toHaveClass(/is-on/);
    await expect(page.locator('#signin-apple-btn')).toBeVisible();
    await expect(skip).toBeHidden();   // the opened gate is still not a place to skip from
  });

  test('on the web, Sign in with Apple says it is an iOS feature and stays on the gate', async ({ page }) => {
    await signedOutGate(page);
    await page.evaluate(() => (window as any).__ob.go('gate', { open: true }));
    await page.locator('#signin-apple-btn').click();
    await expect(page.locator('#signin-apple-error')).toHaveText('Sign in with Apple is only available in the iOS app.');
    // The button comes back: the hunter can try again.
    await expect(page.locator('#signin-apple-btn')).toBeEnabled();
    await expect(page.locator('#signin-apple-btn')).not.toHaveClass(/is-busy/);
    await expect(page.locator('#signin-gate')).toBeVisible();
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
        const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());   // W1006 — THIS week (PT, Sunday start)
        const dw = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date(t + 'T12:00:00Z')));
        const wk = new Date(Date.parse(t + 'T00:00:00Z') - dw * 86400000).toISOString().slice(0, 10);
        localStorage.setItem('hb_worldgate_v1', JSON.stringify({
          at: Date.now(), week: wk, hp: 334875, pool: 102825, status: 'live', my: 13831, floor: 0, souls: 0,
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

  test('W970: a hunter with the Daily walk vow sees the neutral Connect Apple Health sheet, no step picker', async ({ page }) => {
    const r = await seedAndPrompt(page, [
      { id: 'h-walk', name: 'Daily walk', emoji: '🚶', difficulty: 'easy', type: 'build', primaryStat: 'VIT', stepGoal: 8000 },
    ]);
    expect(r.title).toBe('Connect Apple Health');   // Health no longer seals vows
    expect(r.picker).toBe(false);
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
// W1050 — Onboarding v4 harness (AC, AD, AM and BU drive the same flow)
//
// Every screen is built by showCinematicOnboarding in app.js, fresh on each
// run, and `window.__ob` is the live engine: __ob.cur.name is the screen that
// is up, __ob.go(name) jumps to one, __ob.D is what Apple Health answered,
// __ob.U is the hunter being made, __ob.fxLog the haptics and sounds fired.
// The flow runs on timers and animation frames, so these helpers wait on
// state and never on a guessed number of milliseconds.
// ─────────────────────────────────────────────────────────────────────────
const OB = '#cin-onboarding';

/** The onboarding screen that is up, or null once the flow has closed. */
function obScreen(page: Page) {
  return page.evaluate(() => { const ob = (window as any).__ob; return (ob && ob.cur && ob.cur.name) || null; });
}
async function obOn(page: Page, name: string, timeout = 8_000) {
  await expect.poll(() => obScreen(page), { timeout, message: 'the onboarding screen that is up' }).toBe(name);
}

/**
 * Boot straight into a first run. Deliberately does NOT use freshApp(): that
 * helper seeds hb_habits='[]' precisely to keep this overlay away, and waits
 * on a tab bar the overlay is covering. A first run opens on the NAME: the
 * mark and the gate were the sign-in screen, before the reload (suite AF).
 */
async function obFirstRun(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hb_cloud_restore_dismissed', '1');
      localStorage.setItem('hb_whats_new_seen', '99.99.99');
      const d = new Date();
      const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
                  String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_fri_banner_' + ymd, '1');
      ['hb_habits', 'hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed', 'hb_avatar_skin',
       'hb_healthkit_prompted', 'hb_hk_answered_v1', 'hb_hk_first_read_v1'].forEach((k) => localStorage.removeItem(k));
    } catch (_) {}
  });
  await page.goto('/');
  await expect(page.locator(OB + ' .ob4-s-name')).toHaveClass(/is-on/, { timeout: 15_000 });
  await page.evaluate(() => {
    const s = document.getElementById('awakened-splash');
    if (s) s.remove();
  });
}

type ObWorld = { health?: 'granted' | 'denied' | 'none'; today?: number | null; week?: number | null; board?: unknown };
/**
 * Stub the two things the flow reads from outside itself: the native Health
 * bridge (web has none) and the weekly board. Everything else — the Twin
 * Maw's goal, its drop pool, the Steel Wolf's threshold, the packs, the
 * reward numbers — comes from the app's own tables and is asserted as such.
 * `health: 'none'` is a phone with no HealthKit at all; 'denied' is the iOS
 * sheet answered Don't Allow (it still resolves, and every read comes back empty).
 */
async function obWorld(page: Page, world: ObWorld) {
  await page.evaluate((o) => {
    const w = window as any;
    const health = o.health || 'granted';
    const on = health === 'granted';
    w.Health.isAvailable        = () => health !== 'none';
    w.Health.permissionStatus   = () => (on ? 'granted' : 'denied');
    w.Health.requestPermissions = async () => { w.__askedPermission = true; return on ? 'granted' : 'denied'; };
    // The week for a span of days, today for anything shorter. The app reads single
    // days through this same call, and handing it the whole week as one day made a
    // 34,000-step day: THE LONG DAY (a hidden quest, 20,000 in a day) fired and paid
    // 30 souls into the middle of whichever test the tick landed in (CI, 2026-10-14).
    w.Health.getStepsBetween    = async (s: string, e: string) => {
      if (!on) return null;
      const days = (new Date(e).getTime() - new Date(s).getTime()) / 86400000;
      const v = days > 1.5 ? o.week : o.today;
      return typeof v === 'number' ? v : null;
    };
    w.Health.getStepsToday      = async () => (on && typeof o.today === 'number' ? o.today : null);
    w.Auth.fetchLeaderboardTop  = async () => (o.board || { ok: true, metric: 'step_total', me: null, top: [] });
  }, world);
}
/** A short weekly board with the hunter's place on it as the SERVER reports it (`me`). */
function obBoard(mine: number | null, rank = 4) {
  return {
    ok: true, metric: 'step_total',
    me: mine == null ? null : { rank, current_value: mine },
    top: [
      { rank: 1, alias: 'Galilea',   current_value: 51144, avatar_id: 'avatar-ranger.png',  card_bg: null },
      { rank: 2, alias: 'RenDIESEL', current_value: 44910, avatar_id: 'avatar-warrior.png', card_bg: null },
      { rank: 3, alias: 'Grubbadub', current_value: 38207, avatar_id: 'avatar-mage.png',    card_bg: null },
      { rank: 5, alias: 'Anthony',   current_value: 29560, avatar_id: 'avatar-paladin.png', card_bg: null },
    ],
  };
}

/** Jump to a screen through the QA hook, optionally saying what Health answered first. */
async function obGo(page: Page, name: string, health?: { health?: boolean | null; today?: number | null; steps7?: number | null }) {
  await page.evaluate(([n, d]) => {
    const ob = (window as any).__ob;
    if (d) Object.assign(ob.D, d);
    ob.go(n);
  }, [name, health || null] as [string, object | null]);
}
/** Name the hunter and confirm: the license is stamped, then the witness speaks. */
async function obName(page: Page, name = 'Richie') {
  await page.locator('#cin-nameField').fill(name);
  await page.locator('#cin-nameConfirm').click();
  await obOn(page, 'witness');
}
/** Wait for the reveal's count to land, then STRIKE ONE through to the Wolf. */
async function obRevealToWolf(page: Page) {
  await obOn(page, 'reveal');
  await expect(page.locator('#cn-strikeOne')).not.toHaveClass(/is-off/, { timeout: 8_000 });
  await page.locator('#cn-strikeOne').click();
  await obOn(page, 'wolf');
}
/** Strike in one press (the keyboard path of hold-to-strike) and wait for the verdict. */
async function obStrike(page: Page) {
  await page.locator('#cn-wolf').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#cn-wolfNext')).toBeEnabled({ timeout: 8_000 });
  return page.locator(OB + ' .ob4-s-wolf').getAttribute('data-outcome');
}
/** The Steel Wolf as the hunt ledger has it. */
function obWolfState(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf || null);
}
/**
 * After ENTER (or Skip) the Gate opens a second time and the license goes
 * through, about two seconds; then the notification ask stands between the
 * flow and the vows being made. Answer it the way a hunter does and wait for
 * the first-awakening grant, the last thing the finish pipeline stamps.
 */
async function obFinish(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const nb = document.getElementById('notif-explain-enable') as HTMLElement | null;
    if (nb && nb.offsetParent) nb.click();
    return localStorage.getItem('hb_onboarding_first_xp_awarded_v1');
  }), { timeout: 15_000, message: 'onboarding finished' }).toBe('1');
  await expect(page.locator(OB)).toBeHidden({ timeout: 5_000 });
}

/**
 * The System speaks for itself. With Health stubbed open on a live account the
 * app's own verifiers run behind a replay, and one of them can complete a
 * hidden quest and say so in a System Notice. The stage holds a notice behind
 * the onboarding overlay unless the hunter touched the screen in the last
 * second and a half (W950), and a walk is nothing but touches. It is not the
 * flow's doing: acknowledge it the way a hunter would and carry on.
 */
async function obAcknowledgeNotices(page: Page) {
  await page.addLocatorHandler(page.locator('#aw-notice .awn-ok'), async (ok) => { await ok.click(); });
}

// ─────────────────────────────────────────────────────────────────────────
// AC. W936 → W1050 — onboarding v4: the flow shows the real game, with real
//     numbers, and every beat is one touch that pays back
// ─────────────────────────────────────────────────────────────────────────
test.describe('AC · Onboarding v4 (W936 → W1050)', () => {
  const funnel = (page: Page) => page.evaluate(() => localStorage.getItem('hb_funnel_queue') || '');
  // Skip out of reach: not merely faded, but disabled and gone from the tab
  // order and from what VoiceOver reads (a faded button is neither).
  const SKIP_OFF = () => {
    const ob = (window as any).__ob;
    const b = ob.root.querySelector('.ob4-skip') as HTMLButtonElement, cs = getComputedStyle(b);
    return !ob.root.classList.contains('ob4-canskip') && b.disabled && cs.pointerEvents === 'none' && cs.visibility === 'hidden';
  };

  /**
   * Walk a first run from the name to the struck Wolf with Health granted, the
   * way a thumb does, and hand back what each screen showed and what it moved.
   */
  async function walkToStrike(page: Page, todaySteps: number, weekSteps: number) {
    await obWorld(page, { today: todaySteps, week: weekSteps, board: obBoard(weekSteps) });
    await obName(page, 'Richie');

    await page.locator('#cn-healthBtn').click();
    await obOn(page, 'reveal');
    await expect(page.locator('#cn-strikeOne')).not.toHaveClass(/is-off/, { timeout: 8_000 });
    const reveal = await page.evaluate(() => ({
      total: (document.querySelector('#cn-steps7') as HTMLElement).textContent,
      line:  (document.querySelector('#cn-revealLine') as HTMLElement).textContent,
      prompted:  localStorage.getItem('hb_healthkit_prompted'),
      answered:  localStorage.getItem('hb_hk_answered_v1'),
      firstRead: localStorage.getItem('hb_hk_first_read_v1'),
      funnel:    localStorage.getItem('hb_funnel_queue') || '',
    }));
    await page.locator('#cn-strikeOne').click();
    await obOn(page, 'wolf');

    // Nothing is real until the strike: the Wolf waits, CARRY ON is closed.
    const beforeStrike = await page.evaluate(() => ({
      sub:     (document.querySelector('#cn-wolfSub') as HTMLElement).textContent,
      today:   (document.querySelector('#cin-onboarding .ob4-today') as HTMLElement).textContent,
      outcome: (document.querySelector('#cin-onboarding .ob4-s-wolf') as HTMLElement).dataset.outcome || null,
      carryOn: !(document.querySelector('#cn-wolfNext') as HTMLButtonElement).disabled,
      engaged: !!((JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf || {}).engaged),
      souls:   (JSON.parse(localStorage.getItem('hb_souls') || '{}').balance | 0),
    }));
    // Pin the drop roll before the strike. The Steel Wolf's kill rolls the real
    // E-rank table, which can honestly roll NO relic; the assertions below need
    // one to have landed. 0 takes the guaranteed branch (0 < any rate).
    await page.evaluate(() => { Math.random = () => 0; });
    const outcome = await obStrike(page);
    const wolf = await page.evaluate(() => {
      const root = document.getElementById('cin-onboarding') as HTMLElement;
      const inv = JSON.parse(localStorage.getItem('hb_inventory') || '{}');
      const txt = (s: string) => { const e = root.querySelector(s) as HTMLElement | null; return e ? (e.textContent || '') : null; };
      return {
        stamp: txt('#cn-wolfStamp'),
        sub:   txt('#cn-wolfSub'),
        bar:   parseFloat((root.querySelector('#cn-hpi') as HTMLElement).style.width),
        body:  txt('#cn-pactBody'),
        relic: txt('#cn-pactBody .ob4-rn'),
        meta:  txt('#cn-pactBody .ob4-rr'),
        stat:  txt('#cn-pactBody .ob4-stat'),
        state:      JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf || null,
        killClaim:  Object.keys(localStorage).filter((k) => k.indexOf('hb_kill_reward_the_steel_wolf') === 0),
        ownedCards: Object.keys(inv.cards || {}).filter((id) => ((inv.cards[id] || {}).count | 0) > 0),
        souls:      (JSON.parse(localStorage.getItem('hb_souls') || '{}').balance | 0),
        queuedBossResult: localStorage.getItem('hb_boss_result_queue'),
        carriesRelic: !!(window as any).__ob.U.relic,
      };
    });
    return { reveal, beforeStrike, outcome, wolf };
  }
  /** ...and on from the struck Wolf, through the board, the hunt and the Ascent, to the vow. */
  async function walkOnToVow(page: Page) {
    await page.locator('#cn-wolfNext').click();

    // The row waits at the bottom; a tap (or three seconds) sends it up the board.
    await obOn(page, 'board');
    await expect(page.locator('#cn-rows .ob4-row.is-me')).toHaveClass(/is-wait/);
    await page.locator('#cn-rows .ob4-row.is-me').click();
    await expect(page.locator('#cn-gap')).toHaveClass(/is-on/, { timeout: 8_000 });
    const board = await page.evaluate(() => ({
      rows: Array.from(document.querySelectorAll('#cn-rows .ob4-row')).map((el) => ({
        me:   el.classList.contains('is-me'),
        rank: (el.querySelector('.ob4-r') as HTMLElement).textContent,
        val:  (el.querySelector('.ob4-v') as HTMLElement).textContent,
      })),
      gap: (document.querySelector('#cn-gap') as HTMLElement).textContent,
    }));
    await page.locator('#cn-boardNext').click();

    await obOn(page, 'hunt');
    const hunt = await page.evaluate(() => ({
      kicker: (document.querySelector('#cin-onboarding .ob4-s-hunt .ob4-kicker') as HTMLElement).textContent,
      line:   (document.querySelector('#cn-mawLine') as HTMLElement).textContent || '',
      drops:  Array.from(document.querySelectorAll('#cn-drops .ob4-relic-front div')).map((el) => el.childNodes[0].textContent),
    }));
    await page.locator('#cn-huntAlone').click();   // HUNT ALONE — no share sheet in this walk

    await obOn(page, 'ascent');
    await page.locator('#cn-ascentNext').click();

    await obOn(page, 'vow');
    const paths = await page.evaluate(() => ({
      banners: Array.from(document.querySelectorAll('#cn-paths [data-cn-pack]')).map((el) => ({
        id:   (el as HTMLElement).dataset.cnPack,
        name: (el.querySelector('.ob4-banner-n') as HTMLElement).textContent,
        sub:  (el.querySelector('.ob4-banner-c') as HTMLElement).textContent,
        on:   el.classList.contains('is-on'),
      })),
      swear:   (document.querySelector('#cn-enter') as HTMLElement).textContent,
      swearOn: !(document.querySelector('#cn-enter') as HTMLButtonElement).disabled,
    }));
    return { board, hunt, paths };
  }

  // ── 2 · the name ───────────────────────────────────────────
  test('the name is struck onto the license a letter at a time, and Confirm waits for a real one', async ({ page }) => {
    await obFirstRun(page);
    const field = page.locator('#cin-nameField'), confirm = page.locator('#cin-nameConfirm');
    const counter = page.locator(OB + ' .ob4-field-n'), err = page.locator('#cin-nameError');
    const letters = () => page.locator(OB + ' .ob4-s-name .ob4-lic-name .ob4-ch').allTextContents();
    await expect(field).toHaveAttribute('maxlength', '20');

    await field.fill('');
    expect(await letters()).toEqual([]);
    await expect(page.locator(OB + ' .ob4-s-name .ob4-lic-name .ob4-ph')).toHaveText('unnamed');
    await expect(counter).toHaveText('0 / 20');
    await expect(confirm).toBeDisabled();

    // Typed, each letter is its own strike: a span on the card, a tick in the hand.
    const before = await page.evaluate(() => (window as any).__ob.fxLog.filter((x: string) => x === 'snd:type').length);
    await field.pressSequentially('R');
    expect(await letters()).toEqual(['R']);
    await expect(counter).toHaveText('1 / 20');
    await expect(confirm).toBeDisabled();           // one letter is not a name
    await field.pressSequentially('i');
    expect(await letters()).toEqual(['R', 'i']);
    await expect(counter).toHaveText('2 / 20');
    await expect(confirm).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__ob.fxLog.filter((x: string) => x === 'snd:type').length)).toBe(before + 2);

    // Two letters pass the button but not the alias rule (3 to 20): said inline, and the flow stays here.
    await confirm.click();
    await expect(err).toHaveText('3 to 20 letters, numbers, spaces, _ or -.');
    await expect(page.locator(OB + ' .ob4-s-name .ob4-lic-name')).toHaveClass(/is-taken/);
    await expect(page.locator(OB + ' .ob4-s-name .ob4-stamp')).not.toHaveClass(/is-on/);
    expect(await obScreen(page)).toBe('name');

    // A character the boards cannot carry is refused as it is typed.
    await field.fill('Richie!');
    await expect(err).toHaveText('Letters, numbers, spaces, _ and - only.');
    await expect(confirm).toBeDisabled();

    await field.fill('Richie');
    await expect(err).toHaveText('');
    expect(await letters()).toEqual(['R', 'i', 'c', 'h', 'i', 'e']);
    await expect(counter).toHaveText('6 / 20');
    await expect(confirm).toBeEnabled();
    // The stamp lands when the name is taken, then the witness speaks.
    await confirm.click();
    await expect(page.locator(OB + ' .ob4-s-name .ob4-stamp')).toHaveClass(/is-on/);
    await obOn(page, 'witness');
    expect(await page.evaluate(() => (window as any).__ob.U.name)).toBe('Richie');
  });

  test('a pending Apple sign-in claims the name here: a taken one offers others, a free one stamps the license', async ({ page }) => {
    await obFirstRun(page);
    await page.evaluate(() => {
      const w = window as any;
      w.__claims = [];
      w.Auth.isApplePending = () => true;
      w.Auth.completeSignIn = async (name: string) => {
        w.__claims.push(name);
        await new Promise((res) => setTimeout(res, 300));   // long enough to see the screen hold
        if (name === 'Offline') throw new Error('fetch failed');
        if (name === 'Richie') return { ok: false, code: 'ALIAS_TAKEN', suggested: ['Richie7', 'Richie_X', 'RichieTheBold', 'Richie4'] };
        return { ok: true, alias: name };
      };
    });
    const field = page.locator('#cin-nameField'), confirm = page.locator('#cin-nameConfirm');
    const err = page.locator('#cin-nameError'), chips = page.locator('#cin-nameSuggestions button');
    const stamp = page.locator(OB + ' .ob4-s-name .ob4-stamp');

    await field.fill('Richie');
    await confirm.click();
    // While the server is asked, the counter says so and the button cannot be pressed twice.
    await expect(page.locator(OB + ' .ob4-field-n')).toHaveText('checking');
    await expect(confirm).toBeDisabled();
    await expect(err).toHaveText('Taken. The System knows another Richie.');
    expect(await chips.allTextContents()).toEqual(['Richie7', 'Richie_X', 'RichieTheBold']);   // three at most
    await expect(stamp).not.toHaveClass(/is-on/);
    await expect(confirm).toBeEnabled();
    expect(await obScreen(page)).toBe('name');

    // A suggestion fills the field (and the license), and clears the complaint.
    await chips.nth(1).click();
    await expect(field).toHaveValue('Richie_X');
    expect((await page.locator(OB + ' .ob4-s-name .ob4-lic-name .ob4-ch').allTextContents()).join('')).toBe('Richie_X');
    await expect(err).toHaveText('');
    await expect(chips).toHaveCount(0);

    // No connection is said plainly and nothing is stamped.
    await field.fill('Offline');
    await confirm.click();
    await expect(err).toHaveText('No connection. Try again.');
    await expect(stamp).not.toHaveClass(/is-on/);

    await field.fill('Richie_X');
    await confirm.click();
    await expect(stamp).toHaveClass(/is-on/);
    await expect(stamp).toHaveText('E');
    await obOn(page, 'witness');
    expect(await page.evaluate(() => (window as any).__claims)).toEqual(['Richie', 'Offline', 'Richie_X']);
  });

  test('the name Apple gave is already on the license when the screen opens', async ({ page }) => {
    // The pending claim has to be there before app.js builds the screen.
    await page.addInitScript(() => {
      let auth: any;
      Object.defineProperty(window, 'Auth', {
        configurable: true,
        get() { return auth; },
        set(v) { v.isApplePending = () => true; v.getPendingGivenName = () => '  Richmond  '; auth = v; },
      });
    });
    await obFirstRun(page);
    await expect(page.locator('#cin-nameField')).toHaveValue('Richmond');
    expect((await page.locator(OB + ' .ob4-s-name .ob4-lic-name .ob4-ch').allTextContents()).join('')).toBe('Richmond');
    await expect(page.locator(OB + ' .ob4-field-n')).toHaveText('8 / 20');
    await expect(page.locator('#cin-nameConfirm')).toBeEnabled();
  });

  // ── 3 · the witness ────────────────────────────────────────
  test('the witness offers ONE neutral button and no way round it; a grant is read once and recorded', async ({ page }) => {
    await obFirstRun(page);
    await obWorld(page, { today: 7318, week: 31204, board: obBoard(31204) });
    await obName(page, 'Richie');

    // App Review 5.1.1(iv): nothing beside the button that opens the iOS sheet.
    const w = await page.evaluate(() => {
      const s = document.querySelector('#cin-onboarding .ob4-s-witness') as HTMLElement;
      return {
        buttons: Array.from(s.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
        links: s.querySelectorAll('a').length,
        text: s.textContent || '',
      };
    });
    expect(w.buttons).toEqual(['Continue']);
    expect(w.links).toBe(0);
    expect(w.text).not.toMatch(/not now|maybe later|skip|no thanks/i);
    expect(await page.evaluate(SKIP_OFF)).toBe(true);
    // The same holds for a hunter using VoiceOver or a switch: of everything
    // the flow has mounted, the one button they are offered here is this one.
    await expect(page.locator(OB).getByRole('button')).toHaveText(['Continue']);
    // Nothing is asked, flagged or reported until the button is pressed.
    expect(await page.evaluate(() => [localStorage.getItem('hb_healthkit_prompted'), !!(window as any).__askedPermission])).toEqual([null, false]);
    // W1052 — what is read and where it stays is simply on the screen: nothing
    // types itself (owner, on the phone: "would rather it already be on the screen").
    await expect(page.locator(OB + ' .ob4-s-witness .ob4-l1')).toHaveText('I am the First Awakened. The System reads only what the body did. Steps. Sleep. Workouts.');
    await expect(page.locator(OB + ' .ob4-s-witness .ob4-l2')).toHaveText('It reads them from Apple Health. They stay on your phone. Awakened never sees them leave it.');
    expect(await page.evaluate(() => !!(window as any).__askedPermission)).toBe(false);

    await page.locator('#cn-healthBtn').click();
    // Granted: straight to the count. The "Reading." beat that used to sit here for
    // a second read as a screen flashing by.
    await obOn(page, 'reveal');
    await expect(page.locator(OB + ' .ob4-s-witness .ob4-l2')).not.toHaveText('Reading.');
    const r = await page.evaluate(() => ({
      asked:     !!(window as any).__askedPermission,
      prompted:  localStorage.getItem('hb_healthkit_prompted'),
      answered:  localStorage.getItem('hb_hk_answered_v1'),
      firstRead: localStorage.getItem('hb_hk_first_read_v1'),
      D:         (window as any).__ob.D,
    }));
    expect(r).toEqual({ asked: true, prompted: '1', answered: '1', firstRead: '1', D: { steps7: 31204, today: 7318, health: true } });
    // The three W935 funnel events, so grant-vs-deny stays measurable.
    const q = JSON.parse(await funnel(page)) as Array<{ e: string; d: string }>;
    const health = q.filter((x) => /^health_/.test(x.e));
    expect(health).toEqual([
      { e: 'health_prompt_shown', d: 'onboarding' },
      { e: 'health_prompt_answered', d: 'granted' },
      { e: 'health_first_read', d: 'steps' },
    ]);
  });

  test('Health refused: the guide says so, CARRY ON leads to a Wolf behind the gate, and the board keeps a dash', async ({ page }) => {
    await obFirstRun(page);
    await obWorld(page, { health: 'denied', board: obBoard(31204) });
    await obName(page, 'Richie');
    const btn = page.locator('#cn-healthBtn');
    await btn.click();

    // Declined is what the first read says after the real sheet, never a button of ours.
    await expect(page.locator(OB + ' .ob4-s-witness .ob4-l2')).toHaveText('Then it cannot see you. The door stays open.');
    await expect(btn).toHaveText('Carry on');
    expect(await obScreen(page)).toBe('witness');
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('#cin-onboarding .ob4-s-witness button')).length)).toBe(1);
    const q = await funnel(page);
    expect(q).toContain('health_prompt_shown');
    expect(q).toContain('health_prompt_answered');
    expect(q).toContain('"e":"health_first_read","d":"null"');
    expect(await page.evaluate(() => [localStorage.getItem('hb_healthkit_prompted'), localStorage.getItem('hb_hk_answered_v1'), localStorage.getItem('hb_hk_first_read_v1')])).toEqual(['1', '1', '1']);

    await btn.click();
    await obOn(page, 'wolf');   // straight past the reveal: there is nothing true to count
    const wolf = page.locator(OB + ' .ob4-s-wolf');
    await expect(wolf).toHaveAttribute('data-outcome', 'locked');
    await expect(wolf).toHaveClass(/is-locked/);
    await expect(page.locator('#cn-wolf')).toBeHidden();   // nothing to strike
    await expect(page.locator('#cn-pactBody')).toContainText('It cannot see you. Open Health, then strike.');
    // No retry button: iOS shows its sheet once, so one could only ever do nothing.
    expect(await wolf.locator('button:visible').allTextContents()).toEqual(['Carry on']);
    await expect(page.locator('#cn-wolfNext')).toBeEnabled();
    expect(((await obWolfState(page)) || {}).engaged).not.toBe(true);
    // The reveal refuses to open on a closed Health, even when asked for by name.
    await obGo(page, 'reveal');
    expect(await obScreen(page)).toBe('wolf');

    await page.locator('#cn-wolfNext').click();
    await obOn(page, 'board');
    const me = page.locator('#cn-rows .ob4-row.is-me');
    await expect(me.locator('small')).toHaveText('Open Health to take your place');
    await expect(me.locator('.ob4-r')).toHaveText('—');
    await expect(me.locator('.ob4-v')).toHaveText('—');   // the server knows a total; Health is closed, so it is not shown
    await expect(me).not.toHaveClass(/is-wait/);
    await expect(page.locator('#cn-rows .ob4-row')).toHaveCount(5);
    await expect(page.locator('#cn-gap')).toHaveText('');
    expect(((await obWolfState(page)) || {}).engaged).not.toBe(true);
  });

  test('a phone with no HealthKit goes straight to the locked Wolf, asks nothing, and walks past an empty board', async ({ page }) => {
    await obFirstRun(page);
    await obWorld(page, { health: 'none' });   // and nobody on the board
    await obName(page, 'Richie');
    await page.locator('#cn-healthBtn').click();
    await obOn(page, 'wolf');
    await expect(page.locator(OB + ' .ob4-s-wolf')).toHaveAttribute('data-outcome', 'locked');
    const r = await page.evaluate(() => ({
      asked:    !!(window as any).__askedPermission,
      prompted: localStorage.getItem('hb_healthkit_prompted'),
      answered: localStorage.getItem('hb_hk_answered_v1'),
      funnel:   localStorage.getItem('hb_funnel_queue') || '',
      engaged:  !!((JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf || {}).engaged),
    }));
    expect(r.asked).toBe(false);
    expect(r.prompted).toBeNull();
    expect(r.answered).toBeNull();
    expect(r.funnel).not.toContain('health_prompt');
    expect(r.engaged).toBe(false);

    // A board of one is not a board: CARRY ON lands on the hunt, one screen further.
    await page.locator('#cn-wolfNext').click();
    await obOn(page, 'hunt');
    await expect(page.locator('#cn-rows .ob4-row')).toHaveCount(0);
  });

  // ── 4 · the reveal ─────────────────────────────────────────
  test('the reveal runs up the real week and counts it in Steel Wolves', async ({ page }) => {
    test.slow();   // the count runs up five times over
    await obFirstRun(page);
    await obWorld(page, { today: 7318, week: 31204, board: obBoard(31204) });
    await obName(page, 'Richie');
    await page.locator('#cn-healthBtn').click();
    await obOn(page, 'reveal');
    const strikeOne = page.locator('#cn-strikeOne');
    const heads = page.locator(OB + ' .ob4-wolves .ob4-wolfhead');
    const part  = page.locator(OB + ' .ob4-wolves .ob4-wolfhead.is-part');
    const line  = page.locator('#cn-revealLine');

    // 31,204 = five whole Wolves (6,000 each) and a part of a sixth.
    await expect(strikeOne).not.toHaveClass(/is-off/, { timeout: 8_000 });
    await expect(page.locator('#cn-steps7')).toHaveText('31,204');
    await expect(line).toHaveText('That is five Steel Wolves.');
    await expect(heads).toHaveCount(6);
    await expect(part).toHaveCount(1);
    expect(await part.evaluate((e) => (e as HTMLElement).style.getPropertyValue('--ob4-f'))).toBe('20%');   // 1,204 of 6,000
    await expect(strikeOne).toHaveText('Strike one');

    // The same screen, told other weeks.
    const show = async (steps7: number, today: number) => {
      await obGo(page, 'reveal', { health: true, steps7, today });
      await expect(strikeOne).not.toHaveClass(/is-off/, { timeout: 8_000 });
    };
    await show(0, 0);
    await expect(page.locator('#cn-steps7')).toHaveText('0');
    await expect(line).toHaveText('Health holds no steps yet. Carry your phone.');
    await expect(heads).toHaveCount(0);
    await expect(strikeOne).toHaveText('Carry on');   // nothing walked today: nothing to strike with

    await show(4200, 4200);
    await expect(page.locator('#cn-steps7')).toHaveText('4,200');
    await expect(line).toHaveText('Not yet one Steel Wolf. Tonight changes that.');
    await expect(heads).toHaveCount(1);
    await expect(part).toHaveCount(1);

    await show(6000, 900);
    await expect(line).toHaveText('That is one Steel Wolf.');
    await expect(heads).toHaveCount(1);
    await expect(part).toHaveCount(0);

    // More than seven do not fit: seven heads and the count.
    await show(61000, 9000);
    await expect(line).toHaveText('That is ten Steel Wolves.');
    await expect(heads).toHaveCount(7);
    await expect(page.locator(OB + ' .ob4-wolves .ob4-num')).toHaveText('×10');
  });

  // ── the whole walk ─────────────────────────────────────────
  test('the flow asks for Apple Health itself and then shows the hunter their own week, rank, and hunt', async ({ page }) => {
    test.slow();   // nine screens of real animation
    await obFirstRun(page);
    const r = { ...(await walkToStrike(page, 7318, 31204)), ...(await walkOnToVow(page)) };

    // The ask lives inside the flow (it used to fire after it, W935).
    expect(r.reveal.prompted).toBe('1');
    expect(r.reveal.answered).toBe('1');
    expect(r.reveal.firstRead).toBe('1');
    expect(r.reveal.funnel).toContain('health_prompt_shown');
    expect(r.reveal.funnel).toContain('onboarding');
    expect(r.reveal.funnel).toContain('health_prompt_answered');
    expect(r.reveal.funnel).toContain('health_first_read');

    // The reveal is the hunter's own seven days.
    expect(r.reveal.total).toBe('31,204');
    expect(r.reveal.line).toBe('That is five Steel Wolves.');

    // The board carries the rank the SERVER gave, positioned by the number walked.
    const me = r.board.rows.find((x) => x.me);
    expect(me).toBeTruthy();
    expect(me!.rank).toBe('4');
    expect(me!.val).toBe('31,204');
    expect(r.board.rows.map((x) => x.rank)).toEqual(['1', '2', '3', '4', '5']);
    expect(r.board.gap).toBe('7,003 steps to pass Grubbadub.');

    // The hunt reads its goal and its drop pool out of the game's own tables.
    expect(r.hunt.kicker).toBe('The hunt · E-rank · Duo');
    expect(r.hunt.line).toContain('14,000');
    expect(r.hunt.drops).toEqual(['Twin-Fang Cleaver', 'The Twofold Gaze', 'Bothsight, the Long Hunt']);

    // The paths are the real packs with their real vow counts, and none is
    // chosen for the hunter: SWEAR IT waits for a banner.
    expect(r.paths.banners.map((p) => p.name)).toEqual(['Morning Routine', 'Make Your Own', 'Vertical Jump Program']);
    expect(r.paths.banners.map((p) => p.sub)).toEqual(['6 vows', 'Yours', '22 vows']);   // W971 — the six-step morning
    expect(r.paths.banners.some((p) => p.on)).toBe(false);
    expect([r.paths.swear, r.paths.swearOn]).toEqual(['Swear it', false]);
  });

  test('a day already past 6,000 steps kills the Steel Wolf for real, once', async ({ page }) => {
    await obFirstRun(page);
    const r = await walkToStrike(page, 7318, 31204);

    expect(r.beforeStrike).toMatchObject({ sub: '6,000 steps in a day', today: '7,318', outcome: null, carryOn: false, engaged: false });
    expect(r.outcome).toBe('beaten');
    expect(r.wolf.stamp).toBe('Beaten');
    expect(r.wolf.sub).toBe('7,318 of 6,000 · beaten today');
    expect(r.wolf.bar).toBe(0);

    // Real kill: the boss ledger moved, the once-per-(boss, day) reward was
    // claimed, and the relic on the screen is the relic in the armory.
    expect(r.wolf.state).toBeTruthy();
    expect(r.wolf.state.kill_count).toBe(1);
    expect(r.wolf.state.last_hunt_outcome).toBe('defeated');
    expect(r.wolf.killClaim.length).toBe(1);
    expect(r.wolf.relic).toBeTruthy();
    expect(r.wolf.meta).toMatch(/ · yours$/);
    expect(r.wolf.ownedCards.length).toBe(1);
    expect(r.wolf.carriesRelic).toBe(true);   // and the license says so on its way through the Gate
    // The screen's reward line is sourced, not written: E-rank kill souls, and
    // the same number is in the purse.
    expect(r.wolf.stat).toBe('Souls+50');
    expect(r.wolf.souls - r.beforeStrike.souls).toBe(50);
    // And it announced itself exactly once — nothing queued to pop behind it.
    expect(r.wolf.queuedBossResult).toBeNull();
  });

  test('a day still short of 6,000 engages the Wolf and says how far it is; Make Your Own starts with an empty list', async ({ page }) => {
    test.slow();   // the one walk that goes from the name all the way into the app
    await obFirstRun(page);
    const r = await walkToStrike(page, 3860, 18860);
    await walkOnToVow(page);

    expect(r.outcome).toBe('bleeds');
    expect(r.wolf.stamp).toBe('It bleeds');
    expect(r.wolf.sub).toBe('2,140 steps left today');
    expect(r.wolf.bar).toBeCloseTo(35.67, 1);   // 3,860 of 6,000 struck, the rest stands
    expect(r.wolf.body).toBe('Walk 2,140 more today and it is beaten tonight.');
    expect(r.wolf.state.engaged).toBe(true);
    expect(r.wolf.state.kill_count).toBe(0);
    expect(r.wolf.killClaim.length).toBe(0);
    expect(r.wolf.relic).toBeNull();
    expect(r.wolf.souls).toBe(r.beforeStrike.souls);

    // Swear Make Your Own and go through the Gate.
    await page.locator('[data-cn-pack="custom"]').click();
    // W1053 — the vows are chosen inside, from the whole library (W1052's six-vow
    // picker here read as all there is).
    await expect(page.locator('#cn-fan')).toHaveText('You choose your first vow inside.');
    await expect(page.locator('#cn-fan [data-ob-pick]')).toHaveCount(0);
    await page.locator('#cn-enter').click();
    await expect(page.locator('[data-cn-pack="custom"]')).toHaveClass(/is-sworn/);
    // No question is asked of this path (no start day, no training days), so once the
    // stamp has landed it goes through the Gate by itself: no second tap (W1056).
    await expect(page.locator(OB + ' .ob4-sub.is-on')).toHaveCount(0);
    // The license goes through the Gate with the name and the rank on it.
    await expect(page.locator(OB + ' .ob4-hand')).toHaveClass(/is-on/);
    expect((await page.locator(OB + ' .ob4-hand-card .ob4-ch').allTextContents()).join('')).toBe('Richie');
    await expect(page.locator(OB + ' .ob4-hand-card .ob4-stamp')).toHaveClass(/is-on/);
    await obFinish(page);

    const seeded = await page.evaluate(() => ({
      habits: JSON.parse(localStorage.getItem('hb_habits') || '[]').map((h: any) => h.name),
      path:   localStorage.getItem('hb_path'),
      name:   localStorage.getItem('hb_name'),
      xp:     localStorage.getItem('hb_onboarding_first_xp_awarded_v1'),
      welcomed: localStorage.getItem('hb_welcomed'),
      firstVowPicker: (() => {
        const e = document.getElementById('empty-state');
        return !!e && !e.classList.contains('hidden') && !e.classList.contains('empty-state--rest-day')
          && document.querySelectorAll('#empty-state-quickgrid [data-quickpick-idx]').length > 0;
      })(),
    }));
    // W944 — Make Your Own seeds nothing; the First Vow picker takes over.
    expect(seeded.habits).toEqual([]);
    expect(seeded.firstVowPicker).toBe(true);
    expect(seeded.path).toBe('custom');
    expect(seeded.name).toBe('Richie');
    expect(seeded.xp).toBe('1');
    expect(seeded.welcomed).toBe('1');
    // The Wolf engaged in the flow is still being hunted in the app.
    expect((await obWolfState(page)).engaged).toBe(true);
  });

  // ── 6 · the board ──────────────────────────────────────────
  test('the board shows the hunters either side of the row, which climbs to the place the server gave it', async ({ page }) => {
    await obFirstRun(page);
    // The live top twenty with this hunter ninth. The dev session's alias is the
    // board's name for them; the total is the SERVER's, not what Health said.
    const alias = await page.evaluate(() => (window as any).Auth.getCurrentUser().alias as string);
    const top = Array.from({ length: 20 }, (_, i) => ({
      rank: i + 1, alias: 'H' + String(i + 1).padStart(2, '0'), current_value: 62000 - 2000 * (i + 1), avatar_id: 'avatar-base.png', card_bg: null,
    }));
    top[8] = { rank: 9, alias, current_value: 43210, avatar_id: 'avatar-base.png', card_bg: null };
    await obWorld(page, { today: 2100, week: 43900, board: { ok: true, metric: 'step_total', me: null, top } });
    await obName(page, 'Richie');
    await obGo(page, 'board', { health: true, today: 2100, steps7: 43900 });
    await obOn(page, 'board');

    const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('#cn-rows .ob4-row')).map((el) =>
      [(el.querySelector('.ob4-r') as HTMLElement).textContent, (el.querySelector('.ob4-nm') as HTMLElement).childNodes[0].textContent,
       (el.querySelector('.ob4-v') as HTMLElement).textContent].join(' ') + (el.classList.contains('is-me') ? ' *' : '')));
    const me = page.locator('#cn-rows .ob4-row.is-me');
    // Three above and two below, with the row waiting underneath at zero and no rank yet.
    await expect(me).toHaveClass(/is-wait/);
    expect(await rows()).toEqual(['6 H06 50,000', '7 H07 48,000', '8 H08 46,000', '10 H10 42,000', '11 H11 40,000', '— Richie 0 *']);
    await expect(me.locator('small')).toHaveText('Take your place');
    await expect(page.locator('#cn-gap')).not.toHaveClass(/is-on/);

    await me.click();
    await expect(page.locator('#cn-gap')).toHaveClass(/is-on/, { timeout: 8_000 });
    expect(await rows()).toEqual(['6 H06 50,000', '7 H07 48,000', '8 H08 46,000', '9 Richie 43,210 *', '10 H10 42,000', '11 H11 40,000']);
    await expect(page.locator('#cn-gap')).toHaveText('2,790 steps to pass H08.');
    await expect(me.locator('small')).toHaveText('E-rank');
    await expect(me).not.toHaveClass(/is-wait/);
    expect(await page.evaluate(() => (window as any).__ob.fxLog.filter((x: string) => x === 'snd:pass').length)).toBeGreaterThanOrEqual(1);
  });

  test('a hunter the server has no row for yet carries a dash and does not climb', async ({ page }) => {
    await obFirstRun(page);
    // Health is open and has a week, but the first upload has not landed.
    await obWorld(page, { today: 2100, week: 43900, board: obBoard(null) });
    await obName(page, 'Richie');
    await obGo(page, 'board', { health: true, today: 2100, steps7: 43900 });
    await obOn(page, 'board');
    const me = page.locator('#cn-rows .ob4-row.is-me');
    await expect(me.locator('small')).toHaveText('E-rank');
    await expect(me.locator('.ob4-r')).toHaveText('—');
    await expect(me.locator('.ob4-v')).toHaveText('—');
    await expect(me).not.toHaveClass(/is-wait/);
    // A tap does nothing (there is nowhere true to climb to): still last, still a dash.
    await me.click();
    const r = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('#cn-rows .ob4-row'));
      return { last: els[els.length - 1].classList.contains('is-me'), n: els.length, gap: (document.querySelector('#cn-gap') as HTMLElement).className,
               fx: (window as any).__ob.fxLog.filter((x: string) => x === 'snd:pass' || x === 'snd:seal').length };
    });
    expect(r).toEqual({ last: true, n: 5, gap: 'ob4-say ob4-gap', fx: 0 });
    await expect(me.locator('.ob4-v')).toHaveText('—');
    // The other hunters are the real top of the board, in order.
    expect(await page.locator('#cn-rows .ob4-row:not(.is-me) .ob4-r').allTextContents()).toEqual(['1', '2', '3', '5']);
  });

  // ── 9 · the vow, and the finish ────────────────────────────
  test('Morning Routine fans out its real vows, and ENTER makes exactly those in the app', async ({ page }) => {
    await obFirstRun(page);
    await obWorld(page, { health: 'none' });
    await obName(page, 'Richie');
    await obGo(page, 'vow');
    await obOn(page, 'vow');
    const swear = page.locator('#cn-enter');
    await expect(swear).toHaveText('Swear it');
    await expect(swear).toBeDisabled();
    await expect(page.locator('#cn-paths [data-cn-pack]')).toHaveCount(3);

    const morning = page.locator('[data-cn-pack="morning"]');
    await morning.click();
    await expect(morning).toHaveClass(/is-on/);
    await expect(morning).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#cn-paths')).toHaveClass(/has-pick/);
    const fan = await page.locator('#cn-fan .ob4-vow .ob4-vn').allTextContents();
    expect(fan.length).toBe(6);                       // W971 — the six-step morning, all on one screen
    expect(fan).toContain('Hydrate');
    await expect(page.locator('#cn-fan .ob4-more')).toHaveCount(0);
    // A second thought is allowed until it is sworn.
    await page.locator('[data-cn-pack="jump_program"]').click();
    await expect(page.locator('#cn-fan .ob4-more')).toContainText('more, in order');
    await morning.click();
    await expect(page.locator('#cn-paths [data-cn-pack].is-on')).toHaveCount(1);

    await swear.click();
    await expect(morning).toHaveClass(/is-sworn/);
    // Sworn is sworn: the other banners no longer answer, this path is asked nothing more,
    // and it goes through the Gate by itself once the stamp has landed (W1056).
    await page.locator('[data-cn-pack="custom"]').click({ force: true });
    await expect(morning).toHaveClass(/is-on/);
    await expect(page.locator(OB + ' .ob4-sub.is-on')).toHaveCount(0);
    await expect(page.locator(OB + ' .ob4-hand')).toHaveClass(/is-on/, { timeout: 4_000 });

    await obFinish(page);
    // The overlay is gone and left nothing behind it.
    const cin = await page.evaluate(() => {
      const h = document.getElementById('cin-onboarding') as HTMLElement;
      return { hidden: h.classList.contains('hidden'), aria: h.getAttribute('aria-hidden'), html: h.innerHTML, ob: (window as any).__ob };
    });
    expect(cin).toEqual({ hidden: true, aria: 'true', html: '', ob: null });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').map((h: any) => h.name).sort()), { timeout: 8_000 })
      .toEqual(fan.slice().sort());
    const r = await page.evaluate(() => ({
      welcomed: localStorage.getItem('hb_welcomed'), path: localStorage.getItem('hb_path'), name: localStorage.getItem('hb_name'),
      claimed: localStorage.getItem('hb_hunter_name_claimed'), goal: localStorage.getItem('hb_onboarding_goal'),
      days: JSON.parse(localStorage.getItem('hb_habits') || '[]').filter((h: any) => h.days).length,
    }));
    expect(r).toEqual({ welcomed: '1', path: 'morning', name: 'Richie', claimed: '1', goal: 'default', days: 0 });
    // And the app underneath is the app: the tab answers and lists the six vows.
    await page.evaluate(() => { document.querySelectorAll('#statup-ov, #ach-popup').forEach((x) => x.remove()); });
    await expect(page.locator('#app')).toBeVisible();
    await page.locator('#tab-habits').click();
    await expect(page.locator('#tab-habits.active')).toBeVisible();
    await expect(page.locator('#habit-list .habit-item')).toHaveCount(6, { timeout: 10_000 });
  });

  test('W1052 — the name screen never opens the keyboard by itself', async ({ page }) => {
    await obFirstRun(page);
    await obOn(page, 'name');
    // the old flow focused the field half a second in; give it three times that
    await page.waitForTimeout(1600);
    expect(await page.evaluate(() => document.activeElement === document.getElementById('cin-nameField'))).toBe(false);
    // the hunter's own tap is what brings it up
    await page.locator('#cin-nameField').click();
    await expect(page.locator('#cin-nameField')).toBeFocused();
  });

  // W1056 — owner, on the phone: "Remove by hand ... if they click swear it then it automatically
  // enters ... I do like the sworn animation though".
  test('W1056 — the vows say Health or nothing, and SWEAR IT stamps and goes through the Gate in one tap', async ({ page }) => {
    await obFirstRun(page);
    await obWorld(page, { health: 'none' });
    await obName(page, 'Richie');
    await obGo(page, 'vow');
    await obOn(page, 'vow');
    await page.locator('[data-cn-pack="morning"]').click();
    await expect(page.locator('#cn-fan .ob4-vow')).not.toHaveCount(0);
    expect(await page.locator('#cn-fan').innerText()).not.toMatch(/by hand/i);
    // only a Health tag remains; every tag on the screen reads Health
    for (const tag of await page.locator('#cn-fan .ob4-vm').allTextContents()) expect(tag).toBe('Health');
    const swear = page.locator('#cn-enter');
    const taps: number[] = [];
    await page.exposeFunction('__tap', () => taps.push(1));
    await page.evaluate(() => document.getElementById('cn-enter')!.addEventListener('click', () => (window as any).__tap()));
    await swear.click();
    // the stamp has its moment, then the Gate opens with no second tap
    await expect(page.locator('[data-cn-pack="morning"]')).toHaveClass(/is-sworn/);
    await expect(page.locator(OB + ' .ob4-hand')).not.toHaveClass(/is-on/);
    await expect(page.locator(OB + ' .ob4-hand')).toHaveClass(/is-on/, { timeout: 4_000 });
    expect(taps.length).toBe(1);
    await obFinish(page);
    expect(await page.evaluate(() => localStorage.getItem('hb_path'))).toBe('morning');
  });

  test('a path with a training vow asks which days it counts; the last day cannot be taken away', async ({ page }) => {
    await obFirstRun(page);
    await obWorld(page, { health: 'none' });
    await obName(page, 'Richie');
    // QA hook: treat one of the Morning Routine's vows as a training vow.
    await page.evaluate(() => (window as any).__obTraining.add('Hydrate'));
    await obGo(page, 'vow');
    await obOn(page, 'vow');
    await page.locator('[data-cn-pack="morning"]').click();
    const btn = page.locator('#cn-enter');
    await btn.click();
    await expect(page.locator(OB + ' .ob4-vow-t')).toHaveText('The rhythm you train at.');
    await expect(page.locator(OB + ' .ob4-sub-rhythm')).toHaveClass(/is-on/);
    await expect(page.locator(OB + ' .ob4-sub-when')).not.toHaveClass(/is-on/);
    await expect(btn).toHaveText('Enter');

    const row = page.locator('#cin-tw-rows .ob4-tw');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.ob4-tw-n')).toHaveText('Hydrate');
    const sum = row.locator('.ob4-rhythm-sum');
    const day = (d: string) => row.locator('.ob4-day[data-d="' + d + '"]');
    // No default cadence on this vow, so all seven start lit.
    await expect(row.locator('.ob4-day.is-on')).toHaveCount(7);
    await expect(sum).toHaveText('Every day');
    for (const d of ['Tue', 'Thu', 'Sat', 'Sun']) await day(d).click();
    await expect(sum).toHaveText('Mon · Wed · Fri · 3 days a week');
    await expect(day('Tue')).toHaveAttribute('aria-pressed', 'false');
    await day('Wed').click();
    await day('Fri').click();
    await expect(sum).toHaveText('Mon · 1 day a week');
    // The last one stays, and the row says why.
    await day('Mon').click();
    await expect(sum).toHaveText('A vow needs at least one day.');
    await expect(sum).toHaveClass(/is-warn/);
    await expect(day('Mon')).toHaveAttribute('aria-pressed', 'true');
    await expect(row.locator('.ob4-day.is-on')).toHaveCount(1);
    await day('Wed').click();
    await day('Fri').click();
    await expect(row.locator('.ob4-day.is-on')).toHaveCount(3);

    await btn.click();
    await obFinish(page);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').length), { timeout: 8_000 }).toBe(6);
    const made = await page.evaluate(() => (JSON.parse(localStorage.getItem('hb_habits') || '[]') as Array<{ name: string; days?: string[] }>)
      .filter((h) => h.days).map((h) => h.name + ': ' + (h.days as string[]).join(' ')));
    expect(made).toEqual(['Hydrate: Mon Wed Fri']);   // the picked days, on that vow and no other
  });

  // ── Skip ───────────────────────────────────────────────────
  test('Skip is offered from the board on, and lands in the app on Make Your Own', async ({ page }) => {
    await obFirstRun(page);
    await obWorld(page, { today: 2100, week: 43900, board: obBoard(43900, 3) });
    const skip = page.locator(OB + ' .ob4-skip');
    await expect(skip).toHaveText('Skip');
    // The name, the witness, the reveal and the Wolf must each be met. A click
    // that reaches the button anyway (a script, a stale layout) goes nowhere.
    expect(await page.evaluate(SKIP_OFF)).toBe(true);
    await expect(skip).toBeHidden();
    await skip.evaluate((b) => (b as HTMLElement).click());
    expect(await page.evaluate(() => [(window as any).__ob.leaving, (window as any).__ob.cur.name])).toEqual([false, 'name']);
    await obName(page, 'Richie');
    expect(await page.evaluate(SKIP_OFF)).toBe(true);
    for (const scr of ['reveal', 'wolf']) {
      await obGo(page, scr, { health: true, today: 2100, steps7: 43900 });
      await obOn(page, scr);
      expect(await page.evaluate(SKIP_OFF), scr).toBe(true);
    }
    for (const scr of ['board', 'hunt', 'ascent', 'vow']) {
      await obGo(page, scr);
      await obOn(page, scr);
      expect(await page.evaluate(SKIP_OFF), scr).toBe(false);
      await expect(skip).toBeVisible();
      await expect(skip).toBeEnabled();
      await expect(skip).toHaveCSS('pointer-events', 'auto');
    }
    await expect(skip).toHaveCSS('opacity', '1');

    await skip.click();
    await obFinish(page);
    const r = await page.evaluate(() => ({
      welcomed: localStorage.getItem('hb_welcomed'), path: localStorage.getItem('hb_path'), name: localStorage.getItem('hb_name'),
      habits: JSON.parse(localStorage.getItem('hb_habits') || '[]').length,
      hidden: (document.getElementById('cin-onboarding') as HTMLElement).classList.contains('hidden'),
    }));
    expect(r).toEqual({ welcomed: '1', path: 'custom', name: 'Richie', habits: 0, hidden: true });
    await expect(page.locator('#tab-habits')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AD. W937 — replaying the awakening changes nothing
// ─────────────────────────────────────────────────────────────────────────
test.describe('AD · Replay the awakening (W937)', () => {
  // The keys a real first run WOULD write.
  const WATCHED = [
    'hb_healthkit_prompted', 'hb_hk_answered_v1', 'hb_hk_first_read_v1',
    'hb_habits', 'hb_path', 'hb_name', 'hb_bosses', 'hb_inventory', 'hb_souls',
    'hb_onboarding_seen_v2', 'hb_welcomed', 'hb_hunter_name_claimed',
    'hb_onboarding_first_xp_awarded_v1', 'hb_onboarding_goal',
    'hb_first_hunt_free_used', 'hb_funnel_queue',
    'hb_avatar_skin', 'hb_jump_program_started', 'hb_mr_version',   // W947 · W1021 · W971
  ];
  // The app keeps running behind the overlay and writes its own keys on its
  // own schedule. These are the ones an idle, signed-in page writes too
  // (measured over three minutes): the shadow and pilgrim ticks eight seconds
  // after boot, CloudSync's bookkeeping, the leaderboard cache, the breadcrumb
  // log, and the hall's once-a-day greeting on the first tap of any kind.
  // None of them is hunter state, so a leak from the replay could not hide here.
  // hb_stirs_v1 joins them for one reason: before 6 AM on the device's clock the
  // hidden-quest tick notes the dawn (_stirsTick, `dawns`). Local runs never saw it;
  // CI did, the first time this suite ran just after midnight UTC (2026-10-14).
  // A quest actually firing would still show: it pays souls, and hb_souls is WATCHED.
  const BACKGROUND = (k: string) => /^hb_(cloud_|lb_cache_)/.test(k) ||
    ['hb_shadows_v1', 'hb_pilgrim_arc_v1', 'hb_health_verify_debug_v1', 'hb_hall_greet_date', 'hb_stirs_v1'].indexOf(k) >= 0;

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
  const snapshot = (page: Page) => page.evaluate(() => {
    const all: Record<string, string | null> = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i) as string; all[k] = localStorage.getItem(k); }
    return all;
  });
  const changed = (a: Record<string, string | null>, b: Record<string, string | null>) =>
    Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).filter((k) => a[k] !== b[k]).sort();
  /**
   * The whole of localStorage, read once the boot has finished writing to it:
   * a launch runs its one-time migrations a second or two in, and a "before"
   * taken ahead of them would blame them on the replay. Settled means a full
   * second in which nothing but the background keys moved.
   */
  async function settled(page: Page) {
    let last = await snapshot(page);
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1_000);
      const now = await snapshot(page);
      if (!changed(last, now).some((k) => !BACKGROUND(k))) return now;
      last = now;
    }
    throw new Error('localStorage never settled after boot');
  }

  /**
   * Drive the whole replay, from the mark to ENTER, and hand back what it
   * showed. W1050 — a replay is already signed in, so it is the one walk that
   * plays all ten beats: the mark and the gate come first, with a plain
   * CARRY ON where Apple's button stands on the real gate.
   */
  async function replay(page: Page) {
    await page.evaluate(() => (window as any).__replayOnboarding());
    await obOn(page, 'gate');
    const opened = await page.evaluate(() => {
      const root = document.getElementById('cin-onboarding') as HTMLElement;
      const note = document.getElementById('cn-preview-note') as HTMLElement;
      return {
        preview: root.classList.contains('ob4-preview'),
        ribbon:  !!note && !!note.offsetParent && !note.hidden,
        ribbonText: note ? note.textContent : null,
        order:   (window as any).__ob.order,
        apple:   root.querySelectorAll('#signin-apple-btn').length,   // nobody signs in twice
      };
    });
    // The mark, in one press; then the gate's plain button.
    await page.locator(OB + ' .ob4-mark').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(OB + ' .ob4-s-gate')).toHaveClass(/is-open/, { timeout: 5_000 });
    await page.locator(OB + ' .ob4-gate-carry').click();

    await obOn(page, 'name');
    const name = await page.locator('#cin-nameField').inputValue();
    // The look can be turned and is shown; a replay equips nothing.
    await page.locator('[data-ob-look="warrior"]').click();
    await expect(page.locator('[data-ob-look="warrior"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#cin-nameConfirm').click();

    await obOn(page, 'witness');
    await page.locator('#cn-healthBtn').click();
    // Health already granted: the reveal. Otherwise the closed branch, exactly
    // what a first run would show this hunter, with CARRY ON to the Wolf.
    await expect.poll(async () => {
      const scr = await obScreen(page);
      return scr === 'reveal' || (scr === 'witness' && (await page.locator('#cn-healthBtn').textContent()) === 'Carry on') || scr === 'wolf';
    }, { timeout: 8_000 }).toBe(true);
    let reveal = '';
    if ((await obScreen(page)) === 'reveal') {
      await expect(page.locator('#cn-strikeOne')).not.toHaveClass(/is-off/, { timeout: 8_000 });
      reveal = (await page.locator('#cn-steps7').textContent()) || '';
      await page.locator('#cn-strikeOne').click();
    } else if ((await obScreen(page)) === 'witness') {
      await page.locator('#cn-healthBtn').click();
    }

    await obOn(page, 'wolf');
    const wolfScr = page.locator(OB + ' .ob4-s-wolf');
    if ((await wolfScr.getAttribute('data-outcome')) !== 'locked') await obStrike(page);
    await expect(page.locator('#cn-wolfNext')).toBeEnabled({ timeout: 8_000 });
    const wolf = {
      outcome: await wolfScr.getAttribute('data-outcome'),
      body:    (await page.locator('#cn-pactBody').textContent()) || '',
      relic:   (await page.locator('#cn-pactBody .ob4-rr').count()) ? ((await page.locator('#cn-pactBody .ob4-rr').textContent()) || '') : '',
    };
    await page.locator('#cn-wolfNext').click();

    // The board is skipped when nobody else is on it, so advance from
    // whichever screen is actually showing.
    await expect.poll(() => obScreen(page), { timeout: 8_000 }).toMatch(/^(board|hunt)$/);
    const sawBoard = (await obScreen(page)) === 'board';
    if (sawBoard) await page.locator('#cn-boardNext').click();
    await obOn(page, 'hunt');
    await page.locator('#cn-huntAlone').click();
    await obOn(page, 'ascent');
    await page.locator('#cn-ascentNext').click();

    // The vow opens on the path this hunter actually walks.
    await obOn(page, 'vow');
    const path = await page.evaluate(() => Array.from(document.querySelectorAll('#cn-paths [data-cn-pack].is-on')).map((b) => (b as HTMLElement).dataset.cnPack));
    const enter = page.locator('#cn-enter');
    await enter.click();                                   // SWEAR IT: the replay closes by itself (W1056)
    await expect(page.locator(OB)).toBeHidden({ timeout: 10_000 });

    const closed = await page.evaluate(() => {
      const root = document.getElementById('cin-onboarding') as HTMLElement;
      return root.classList.contains('hidden') && !root.classList.contains('ob4-preview') && root.innerHTML === '' && (window as any).__ob === null;
    });
    return {
      opened, name, reveal, wolf, sawBoard, path, closed,
      askedPermission: await page.evaluate(() => !!(window as any).__askedPermission),
      killFlags: await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('hb_kill_reward_') === 0)),
      wolfState: await obWolfState(page),
      notifAsk:  await page.locator('#notif-explain-enable').isVisible(),
    };
  }

  test('the replay opens on the mark under its ribbon and writes none of the keys a first run would', async ({ page }) => {
    test.slow();
    await establishedAccount(page);
    // Nobody else on the board, and no network: the replay walks past it.
    await page.evaluate(() => { (window as any).Auth.fetchLeaderboardTop = async () => ({ ok: true, metric: 'step_total', me: null, top: [] }); });
    const before = await settled(page);
    const r = await replay(page);
    const after = await snapshot(page);

    expect(r.opened.preview).toBe(true);
    expect(r.opened.ribbon).toBe(true);
    expect(r.opened.ribbonText).toBe('Preview · nothing is saved');
    // All ten beats, the mark first.
    expect(r.opened.order).toEqual(['gate', 'name', 'witness', 'reveal', 'wolf', 'board', 'hunt', 'ascent', 'vow']);
    expect(r.opened.apple).toBe(0);
    expect(r.name).toBe('Richie');   // the claimed name, prefilled, never re-claimed
    // No HealthKit in a browser, so the flow shows exactly what a first run
    // would show a hunter who has not connected it.
    expect(r.reveal).toBe('');
    expect(r.wolf.outcome).toBe('locked');
    expect(r.wolf.body).toContain('It cannot see you. Open Health, then strike.');
    expect(r.sawBoard).toBe(false);
    expect(r.path).toEqual(['custom']);

    const moved = changed(before, after);
    expect(moved.filter((k) => WATCHED.indexOf(k) >= 0)).toEqual([]);
    // Byte for byte: nothing else moved either, bar what the app writes on an idle page.
    expect(moved.filter((k) => !BACKGROUND(k))).toEqual([]);
    expect(r.killFlags).toEqual([]);
    expect(r.closed).toBe(true);
    expect(r.notifAsk).toBe(false);          // ENTER closes it; the finish pipeline never runs
    expect(r.wolfState.kill_count).toBe(3);
    expect(r.wolfState.engaged).toBe(false);
    expect(r.wolfState.last_eval_date).toBe('2020-01-01');
  });

  test('a day past 6,000 shows the fall as a preview and still leaves the hunt alone', async ({ page }) => {
    test.slow();
    await establishedAccount(page);
    await page.evaluate(() => {
      const w = window as any;
      w.Health.isAvailable        = () => true;
      w.Health.permissionStatus   = () => 'granted';
      w.Health.requestPermissions = async () => { w.__askedPermission = true; return 'granted'; };
      // the week for a span of days, today for a single one (see obWorld)
      w.Health.getStepsBetween    = async (s: string, e: string) =>
        ((new Date(e).getTime() - new Date(s).getTime()) / 86400000 > 1.5 ? 34112 : 9040);
      w.Health.getStepsToday      = async () => 9040;   // well past the Wolf's 6,000
      w.Auth.fetchLeaderboardTop  = async () => ({
        ok: true, me: { rank: 2, current_value: 34112 },
        top: [{ rank: 1, alias: 'Galilea', current_value: 51144, avatar_id: 'avatar-ranger.png', card_bg: null }],
      });
    });
    // Only the hunt-side keys here: with Health stubbed granted the app's own
    // auto-verify runs behind the overlay and legitimately moves souls and the
    // funnel queue, which has nothing to do with the replay.
    const HUNT = ['hb_bosses', 'hb_inventory', 'hb_habits', 'hb_path', 'hb_name', 'hb_avatar_skin',
                  'hb_healthkit_prompted', 'hb_hk_answered_v1', 'hb_first_hunt_free_used'];
    await obAcknowledgeNotices(page);
    const before = await snapshot(page);
    const r = await replay(page);
    const after = await snapshot(page);

    expect(r.reveal).toBe('34,112');
    expect(r.wolf.outcome).toBe('beaten');
    expect(r.wolf.relic).toMatch(/ · preview$/);      // shown, never rolled, never granted
    expect(r.askedPermission).toBe(false);            // the permission is already answered
    expect(r.sawBoard).toBe(true);
    expect(changed(before, after).filter((k) => HUNT.indexOf(k) >= 0)).toEqual([]);
    expect(r.killFlags).toEqual([]);
    expect(r.closed).toBe(true);
    expect(r.wolfState.kill_count).toBe(3);
    expect(r.wolfState.engaged).toBe(false);
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
    // W1050 — a first run opens on the name (the mark and the gate are the sign-in screen).
    await expect(page.locator('#cin-onboarding .ob4-s-name')).toHaveClass(/is-on/, { timeout: 15_000 });
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
    await expect(page.locator('#cin-onboarding .ob4-s-name')).toHaveClass(/is-on/, { timeout: 15_000 });
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
  // W1050 — the first screen is the mark now, and the W939 gate (art, copy,
  // Apple's button, the footnote) is what holding it opens.
  const GATE = '#signin-gate .ob4-s-gate';

  test('the Gate art, the new copy and a truthful footnote', async ({ page }) => {
    await signedOutGate(page);
    await page.evaluate(() => (window as any).__ob.go('gate', { open: true }));
    await expect(page.locator('#signin-apple-btn')).toBeVisible();
    const r = await page.evaluate(() => {
      const gate = document.getElementById('signin-gate') as HTMLElement;
      const btn = document.getElementById('signin-apple-btn') as HTMLButtonElement;
      return {
        host: gate.classList.contains('ob4-host'),
        art: (gate.querySelector('.ob4-s-gate .ob4-gate-art') as HTMLImageElement | null)?.getAttribute('src') || null,
        logo: (gate.querySelector('.ob4-wordmark img') as HTMLImageElement | null)?.getAttribute('src') || null,
        title: (gate.querySelector('.ob4-gate-t') as HTMLElement).textContent,
        blurb: (gate.querySelector('.ob4-gate-b') as HTMLElement).textContent,
        foot: (gate.querySelector('.ob4-gate-fine') as HTMLElement).textContent || '',
        buttonText: (btn.textContent || '').replace(/\s+/g, ' ').trim(),
        buttonBg: getComputedStyle(btn).backgroundColor,
        buttonInk: getComputedStyle(btn).color,
      };
    });
    expect(r.host).toBe(true);
    expect(r.art).toBe('assets/gates/gate-e-rank.png');
    expect(r.logo).toBe('assets/awknd-logo.png');
    expect(r.title).toBe('The Gate is open.');
    expect(r.blurb).toBe('Only the named may cross.');
    // The old line was untrue: CloudSync backs up every hb_ key.
    expect(r.foot).not.toContain('Everything else stays on your device');
    // W1050 — and so was the handoff's "Nothing else.": crash and usage reports leave the phone too.
    expect(r.foot).not.toMatch(/nothing else/i);
    expect(r.foot).toContain('private backup');
    expect(r.foot).toContain('hunter name');
    expect(r.buttonText).toBe('Sign in with Apple');
    expect(r.buttonBg).toBe('rgb(255, 255, 255)');
    expect(r.buttonInk).toBe('rgb(0, 0, 0)');
  });

  test('holding the mark splits the dark, then the Gate opens and Sign in with Apple rises', async ({ page }) => {
    await signedOutGate(page);
    const gate = page.locator(GATE);
    const apple = page.locator('#signin-apple-btn');
    await expect(page.locator('#signin-gate .ob4-mark-prompt')).toHaveText('Hold the mark');
    await expect(apple).toBeHidden();   // in the DOM, behind the dark, until the Gate opens
    await watchCharge(page, GATE);

    const c = await markCentre(page);
    await page.mouse.move(c.x, c.y);
    const t0 = Date.now();
    await page.mouse.down();
    await expect(gate).toHaveClass(/is-split/, { timeout: 5_000 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1300);   // 1.4 s: a hold, not a touch
    await page.mouse.up();
    await expect(gate).toHaveClass(/is-open/);
    await expect(apple).toBeVisible();

    const seen = await chargeSeen(page);
    const split = (cls: string) => /is-split/.test(cls);
    // While it is held the charge only climbs, through the middle, with the dark still shut...
    const dark = seen.filter(([, cls]) => !split(cls)).map(([v]) => v);
    expect(dark.some((v) => v > 0.2 && v < 0.8)).toBe(true);
    expect(dark.every((v, i) => i === 0 || v >= dark[i - 1])).toBe(true);
    // ...the dark splits only at full charge, and the Gate opens after the split, not with it.
    expect((seen.find(([, cls]) => split(cls)) as [number, string])[0]).toBe(1);
    const order = seen.map(([, cls]) => (split(cls) ? 'split' : 'dark') + (/is-open/.test(cls) ? '+open' : ''))
      .filter((st, i, all) => i === 0 || all[i - 1] !== st);
    expect(order.filter((st) => st !== 'dark')).toEqual(['split', 'split+open']);
    // The crack is felt and heard (the haptic carries it when the phone is muted).
    const fx = await page.evaluate(() => (window as any).__ob.fxLog as string[]);
    expect(fx).toContain('hap:HEAVY');
    expect(fx).toContain('snd:crack');
  });

  test('letting go early cools the mark; a tap opens it only once the three-second fallback is offered', async ({ page }) => {
    await signedOutGate(page);
    const gate = page.locator(GATE);
    const prompt = page.locator('#signin-gate .ob4-mark-prompt');
    const fx = () => page.evaluate(() => (window as any).__ob.fxLog.join(' '));
    const c = await markCentre(page);
    await page.mouse.move(c.x, c.y);

    // Let go early (a quarter of the hold it asks for): the charge rises, then
    // drains back to nothing, and the dark stays shut.
    await watchCharge(page, GATE);
    await page.mouse.down();
    await page.waitForTimeout(350);
    await page.mouse.up();
    await expect.poll(() => charge(page, GATE)).toBe(0);
    const peak = Math.max(...(await chargeSeen(page)).map(([v]) => v));
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(1);
    await expect(gate).not.toHaveClass(/is-split/);

    // A tap inside the first three seconds is just a very short hold. (go('gate')
    // re-enters the screen, which restarts its clock, so this cannot race it.)
    await page.evaluate(() => (window as any).__ob.go('gate'));
    await page.mouse.down();
    await page.mouse.up();
    await expect(prompt).toHaveText('Hold the mark');
    expect(await fx()).not.toContain('hap:MEDIUM');   // the tap-to-open path never started
    await expect(prompt).toHaveText('Hold the mark · or tap', { timeout: 6_000 });
    await expect(gate).not.toHaveClass(/is-split/);   // three seconds on, still shut

    // Now a tap is enough: no hold is ever a wall.
    await page.mouse.down();
    await page.mouse.up();
    await expect(gate).toHaveClass(/is-open/, { timeout: 5_000 });
    await expect(page.locator('#signin-apple-btn')).toBeVisible();
  });

  test('a keyboard, a switch or VoiceOver opens the mark in one press', async ({ page }) => {
    await signedOutGate(page);
    await page.locator('#signin-gate .ob4-mark').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(GATE)).toHaveClass(/is-open/, { timeout: 5_000 });
    await expect(page.locator('#signin-apple-btn')).toBeVisible();
  });

  test('W816: a hunter whose session expired is greeted by name and told nothing was lost', async ({ page }) => {
    await signedOutGate(page, { name: 'Richie' });
    await page.evaluate(() => (window as any).__ob.go('gate', { open: true }));
    await expect(page.locator('#signin-gate .ob4-gate-t')).toHaveText('Welcome back, Richie');
    await expect(page.locator('#signin-gate .ob4-gate-b')).toHaveText('Your session expired while you were away. Sign in to reconnect. Nothing was lost.');
    await expect(page.locator('#signin-apple-btn')).toBeVisible();
  });

  test('the gate preview hook mounts the same screen on a signed-in page', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(() => {
      const ctx = (window as any).__obGatePreview('Mira');
      ctx.go('gate', { open: true });
      const gate = document.getElementById('signin-gate') as HTMLElement;
      return {
        count: document.querySelectorAll('#signin-gate').length,
        roots: gate.querySelectorAll('.ob4-root').length,
        open: (gate.querySelector('.ob4-s-gate') as HTMLElement).classList.contains('is-open'),
        title: (gate.querySelector('.ob4-gate-t') as HTMLElement).textContent,
      };
    });
    expect(r).toEqual({ count: 1, roots: 1, open: true, title: 'Welcome back, Mira' });
    await page.locator('#signin-apple-btn').click();
    await expect(page.locator('#signin-apple-error')).toHaveText('Sign in with Apple is only available in the iOS app.');
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
    // W1050 — Apple's button stands behind the mark; open the Gate first.
    await expect(page.locator(GATE)).toHaveClass(/is-on/, { timeout: 15_000 });
    await page.evaluate(() => (window as any).__ob.go('gate', { open: true }));
    await expect(page.locator('#signin-apple-btn')).toBeVisible();
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
  test('W970: adding Sleep before midnight from the library lands it after the hand-tapped vows like any vow', async ({ page }) => {
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
    // W995 — the list is sectioned by time of day now: the two hand-tapped vows keep their
    // order in DAY; the Health vow sits in its own MORNING section, not forced to the top of DAY.
    const after = await page.evaluate(() => Array.from(document.querySelectorAll('#habit-list .tod-sec')).map((s) => (s as HTMLElement).dataset.tod + ':' + Array.from(s.querySelectorAll('.habit-item .hlr-name, .habit-item .codex-name')).map((e) => (e.textContent || '').trim()).join(',')));
    expect(after).toEqual(['morning:Sleep before midnight', 'day:Journal,Read']);   // no forced sort within a section

    // And storage agrees once the coalesced save lands.
    await page.waitForTimeout(300);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').map((h: any) => h.name));
    expect(stored).toEqual(['Journal', 'Read', 'Sleep before midnight']);
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
    expect(view.filter((r) => r.health).map((r) => r.name)).toEqual([]);   // W970: no Apple Health tags
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
    // W971 — a hunter holding 4 of the old ten is on the v2 six-step morning.
    await expect(morning.locator('.lib-pack-count')).toHaveText('6 HABITS');
    await expect(morning.locator('.lib-pack-add')).toHaveText('Add 2');
    await expect(locked.locator('.lib-pack-count')).toHaveText('17 HABITS');
    await expect(locked.locator('.lib-pack-add')).toHaveText('Add 13');

    await morning.click();
    await expect(morning).toHaveClass(/is-sel/);
    await expect(page.locator('#lib-cta')).toHaveText('Add 2 habits to my list');
    await expect(page.locator('#lib-sub')).toHaveText('4 active · 19 slots open');
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
    expect(saved.habits.length).toBe(6);
    expect(saved.path).toBe('morning');
    expect(saved.habits.map((h: any) => h.name)).toEqual(expect.arrayContaining(['Hydrate', 'Meditate & Breathwork']));

    await page.evaluate(() => (document.getElementById('add-habit-btn') as HTMLElement).click());
    await expect(page.locator('#lib-sheet')).toBeVisible();
    await expect(morning.locator('.lib-pack-add')).toHaveText('All added');
    await expect(morning).toBeDisabled();
    await expect(locked.locator('.lib-pack-add')).toHaveText('Add 11');
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
    expect(hits.find((h) => h.name === 'Sleep before midnight')!.health).toBe(false);   // W970

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
// AM. W947 → W1050 — Onboarding v4, the touches: every beat is one touch
//     that pays back (the look, the hold, the relics, the tower), in the
//     carved type the owner picked
// ─────────────────────────────────────────────────────────────────────────
test.describe('AM · Onboarding v4, the touches (W947 → W1050)', () => {
  const WOLF = OB + ' .ob4-s-wolf';
  /** A first run with Health open: 3,860 today, 18,860 this week, one hunter above on the board. */
  async function boot(page: Page, today = 3860, week = 18860) {
    await obFirstRun(page);
    await obWorld(page, {
      today, week,
      board: { ok: true, metric: 'step_total', me: { rank: 2, current_value: week },
               top: [{ rank: 1, alias: 'Galilea', current_value: 51144, avatar_id: 'avatar-ranger.png', card_bg: null }] },
    });
  }
  /** Straight to the Wolf with Health answered, as the witness would leave it. */
  async function toWolf(page: Page, today: number, week = 18860) {
    await obGo(page, 'wolf', { health: true, today, steps7: week });
    await obOn(page, 'wolf');
  }
  const engaged = async (page: Page) => !!((await obWolfState(page)) || {}).engaged;
  const fxLog = (page: Page) => page.evaluate(() => (window as any).__ob.fxLog.join(' '));

  // W1055 — owner 2026-10-14: "make 3 of the females starters free - we need female avatars".
  test('W1055 — a woman\'s look is picked here, equipped free, and worn in the app without a purchase', async ({ page }) => {
    await boot(page);
    const lic = page.locator(OB + ' .ob4-s-name .ob4-lic');
    const row = page.locator(OB + ' .ob4-looks');
    // one row that scrolls: the fourth look is cut by the edge, so there is plainly more
    const fit = await row.evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth, h: (el.querySelector('.ob4-look') as HTMLElement).getBoundingClientRect().height }));
    expect(fit.scroll).toBeGreaterThan(fit.width);
    expect(fit.h).toBeGreaterThanOrEqual(80);
    await page.locator('[data-ob-look="tempest"]').click();
    await expect(lic.locator('.ob4-lic-look')).toHaveText('Tempest');
    await expect(lic.locator('.ob4-lic-bust')).toHaveAttribute('src', /avatar-skin-tempest-bust/);
    await obName(page, 'Richie');
    expect(await page.evaluate(() => localStorage.getItem('hb_avatar_skin'))).toBe('avatar-skin-tempest.png');
    // free: it renders with no entitlement at all, where a paid skin nobody bought falls back
    const r = await page.evaluate(() => {
      const w = window as any;
      const free = ['avatar-skin-bloodmoon.png', 'avatar-skin-tempest.png', 'avatar-skin-frostweaver.png'];
      return {
        allowed: free.map((f) => w.__skinFileAllowed ? w.__skinFileAllowed(f) : null),
        verdant: w.__skinFileAllowed ? w.__skinFileAllowed('avatar-skin-verdant.png') : null,
      };
    });
    expect(r).toEqual({ allowed: [true, true, true], verdant: false });
  });

  test('the look turns the license, equips the skin, and is worn on the board', async ({ page }) => {
    await boot(page);
    const lic = page.locator(OB + ' .ob4-s-name .ob4-lic');
    const look = (k: string) => page.locator('[data-ob-look="' + k + '"]');
    // W1055 — six looks, three of them women, interleaved
    expect(await page.locator('[data-ob-look]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ob-look'))))
      .toEqual(['base', 'bloodmoon', 'ranger', 'tempest', 'warrior', 'frostweaver']);
    // HUNTER (the class default) is the look until another is picked.
    await expect(look('base')).toHaveAttribute('aria-checked', 'true');
    await expect(lic.locator('.ob4-lic-look')).toHaveText('Hunter');
    await expect(lic.locator('.ob4-lic-bust')).toHaveAttribute('src', /avatar-base-bust/);

    await look('warrior').click();
    await expect(look('warrior')).toHaveClass(/is-on/);
    await expect(look('base')).not.toHaveClass(/is-on/);
    // The card turns edge-on, the face swaps, and it turns back.
    await expect(lic.locator('.ob4-lic-look')).toHaveText('Warrior');
    await expect(lic.locator('.ob4-lic-bust')).toHaveAttribute('src', /avatar-warrior-bust/);
    await expect(look('warrior')).toHaveAttribute('aria-checked', 'true');
    await expect(look('base')).toHaveAttribute('aria-checked', 'false');
    await expect(lic).toHaveClass(/is-turnback/);
    await expect(lic).not.toHaveClass(/is-turn( |$)/);
    expect(await fxLog(page)).toContain('snd:turn');
    // Nothing is equipped until the name is confirmed.
    expect(await page.evaluate(() => localStorage.getItem('hb_avatar_skin'))).toBeNull();

    await obName(page, 'Richie');
    expect(await page.evaluate(() => localStorage.getItem('hb_avatar_skin'))).toBe('avatar-warrior.png');

    await obGo(page, 'board', { health: true, today: 3860, steps7: 18860 });
    await obOn(page, 'board');
    const me = page.locator('#cn-rows .ob4-row.is-me');
    await expect(me.locator('.ob4-bust img')).toHaveAttribute('src', /avatar-warrior-bust/, { timeout: 5_000 });
    // Left alone, the row takes its place by itself after three seconds: a tap is never a wall.
    await expect(me).toHaveClass(/is-wait/);
    await expect(page.locator('#cn-gap')).toHaveClass(/is-on/, { timeout: 10_000 });
    await expect(page.locator('#cn-gap')).toHaveText('32,284 steps to pass Galilea.');
    await expect(me.locator('.ob4-r')).toHaveText('2');
    await expect(me.locator('.ob4-v')).toHaveText('18,860');
  });

  test('holding the Wolf strikes it: letting go early cools and engages nothing, the full hold lands the real engage', async ({ page }) => {
    await boot(page);
    await toWolf(page, 3860);
    const hold = page.locator('#cn-wolf'), next = page.locator('#cn-wolfNext');
    await expect(page.locator('#cn-wolfSub')).toHaveText('6,000 steps in a day');
    await expect(page.locator(OB + ' .ob4-today')).toHaveText('3,860');
    await expect(page.locator(OB + ' .ob4-hold-l')).toHaveText('Hold to strike');
    await expect(next).toBeDisabled();

    const box = await hold.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    // A short hold (a quarter of a second of the nine tenths) charges the ring and nothing else.
    await watchCharge(page, WOLF);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
    await expect.poll(() => charge(page, WOLF)).toBe(0);
    const short = await chargeSeen(page);
    const peak = Math.max(...short.map(([v]) => v));
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(1);
    expect(short.some(([, cls]) => /is-charging/.test(cls))).toBe(true);
    await expect(page.locator(WOLF)).not.toHaveClass(/is-charging|is-hit|is-done/);
    expect(await page.locator(WOLF).getAttribute('data-outcome')).toBeNull();
    expect(await engaged(page)).toBe(false);
    await expect(next).toBeDisabled();
    expect((await page.evaluate(() => (document.querySelector('#cn-hpi') as HTMLElement).style.width))).toBe('');   // the bar has not moved

    // The full nine tenths of a second.
    const t0 = Date.now();
    await page.mouse.down();
    await expect(page.locator(WOLF)).toHaveClass(/is-hit/, { timeout: 5_000 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
    await page.mouse.up();
    await expect(page.locator(WOLF)).toHaveAttribute('data-outcome', 'bleeds', { timeout: 5_000 });
    await expect(page.locator('#cn-wolfStamp')).toHaveText('It bleeds');
    await expect(page.locator('#cn-wolfSub')).toHaveText('2,140 steps left today');
    await expect(page.locator('#cn-pactBody')).toHaveText('Walk 2,140 more today and it is beaten tonight.');
    const done = await page.evaluate(() => ({
      width: parseFloat((document.querySelector('#cn-hpi') as HTMLElement).style.width),
      engaged: !!((JSON.parse(localStorage.getItem('hb_bosses') || '{}').the_steel_wolf || {}).engaged),
      kills: Object.keys(localStorage).filter((k) => k.indexOf('hb_kill_reward_') === 0).length,
    }));
    expect(done.width).toBeCloseTo(35.67, 1);   // 3,860 of 6,000 struck, the rest stands
    expect(done.engaged).toBe(true);
    expect(done.kills).toBe(0);
    await expect(next).toBeEnabled();
    await expect(hold).toBeHidden();            // one strike: the hold is spent
    const fx = await fxLog(page);
    expect(fx).toContain('hap:HEAVY');
    expect(fx).toContain('snd:hit');
  });

  test('a tap strikes only once the fallback is offered; nothing walked leaves the Wolf unmoved', async ({ page }) => {
    await boot(page, 0, 9000);
    await toWolf(page, 0, 9000);
    const hold = page.locator('#cn-wolf');
    const box = await hold.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    // Inside the first two and a half seconds a tap is only a very short hold.
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator(OB + ' .ob4-hold-l')).toHaveText('Hold to strike');
    expect(await fxLog(page)).not.toContain('hap:MEDIUM');
    await expect(page.locator(OB + ' .ob4-hold-l small')).toHaveText('or tap', { timeout: 6_000 });
    expect(await page.locator(WOLF).getAttribute('data-outcome')).toBeNull();   // two and a half seconds on, unstruck
    expect(await engaged(page)).toBe(false);

    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator(WOLF)).toHaveAttribute('data-outcome', 'unmoved', { timeout: 5_000 });
    await expect(page.locator('#cn-wolfStamp')).toHaveText('Unmoved');
    await expect(page.locator('#cn-pactBody')).toHaveText('Nothing landed. Walk, then come back.');
    await expect(page.locator('#cn-wolfSub')).toHaveText('6,000 steps left today');
    expect(await page.evaluate(() => (document.querySelector('#cn-hpi') as HTMLElement).style.width)).toBe('100%');
    await expect(page.locator(OB + ' .ob4-dmg')).toHaveCount(0);   // no damage number for no damage
    // The hunt is on all the same: the walk still counts tonight.
    expect(await engaged(page)).toBe(true);
    await expect(page.locator('#cn-wolfNext')).toBeEnabled();
  });

  test('a kill already claimed today is not paid twice: the Wolf reads beaten and returns tomorrow', async ({ page }) => {
    // W465 pays a kill once per (boss, day). When today's claim is already
    // spent as the flow reaches the Wolf (a restored account, a second pass),
    // the strike still lands but nothing is paid, rolled or announced twice.
    await page.addInitScript(() => {
      try {
        const d = new Date();
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_kill_reward_the_steel_wolf_' + ymd, '1');
      } catch (_) {}
    });
    await boot(page, 7318, 31204);
    await toWolf(page, 7318, 31204);
    const purse = () => page.evaluate(() => {
      const inv = JSON.parse(localStorage.getItem('hb_inventory') || '{}');
      return {
        souls:  (JSON.parse(localStorage.getItem('hb_souls') || '{}').balance | 0),
        relics: Object.keys(inv.cards || {}).filter((id) => ((inv.cards[id] || {}).count | 0) > 0).length,
      };
    });
    const before = await purse();
    await page.evaluate(() => { Math.random = () => 0; });   // a roll, if one were made, would land
    expect(await obStrike(page)).toBe('claimed');
    await expect(page.locator('#cn-wolfStamp')).toHaveText('Beaten');
    await expect(page.locator('#cn-wolfSub')).toHaveText('7,318 of 6,000 · beaten today');
    await expect(page.locator('#cn-pactBody')).toHaveText('Today’s kill is already claimed. It returns tomorrow.');
    await expect(page.locator('#cn-pactBody .ob4-relic-card')).toHaveCount(0);
    expect(await purse()).toEqual(before);
    expect(await page.evaluate(() => [(window as any).__ob.U.relic, localStorage.getItem('hb_boss_result_queue')])).toEqual([false, null]);
    await expect(page.locator('#cn-wolfNext')).toBeEnabled();
  });

  test('the Twin Maw arrives; its relics turn face up; a sent invite changes the screen and a cancelled one does not', async ({ page }) => {
    await boot(page);
    await obName(page, 'Richie');
    await obGo(page, 'hunt');
    await obOn(page, 'hunt');
    expect(await fxLog(page)).toContain('snd:arrive');
    await expect(page.locator(OB + ' .ob4-s-hunt .ob4-boss')).toHaveText('The Twin Maw');
    // The real goal and the real drop pool, out of the game's own tables.
    await expect(page.locator('#cn-mawLine')).toHaveText('14,000 combined steps. The relic drops for both.');
    const relics = page.locator('#cn-drops .ob4-relic');
    await expect(relics).toHaveCount(3);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('#cn-drops .ob4-relic-front')).map((f) => ({
      name: (f.querySelector('div') as HTMLElement).childNodes[0].textContent,
      art:  /^assets\/.+\.(png|webp)$/.test((f.querySelector('img') as HTMLImageElement).getAttribute('src') || ''),
    })))).toEqual([
      { name: 'Twin-Fang Cleaver', art: true }, { name: 'The Twofold Gaze', art: true }, { name: 'Bothsight, the Long Hunt', art: true },
    ]);
    await expect(page.locator('#cn-party')).toHaveText('Turn the relics');

    // Face down until touched; each tap turns one, and the prompt goes with the last.
    await expect(page.locator('#cn-drops .ob4-relic.is-up')).toHaveCount(0);
    for (let i = 0; i < 3; i++) {
      await relics.nth(i).click();
      await expect(relics.nth(i)).toHaveClass(/is-up/);
      await expect(page.locator('#cn-drops .ob4-relic.is-up')).toHaveCount(i + 1);
      if (i < 2) await expect(page.locator('#cn-party')).toHaveText('Turn the relics');
    }
    await expect(page.locator('#cn-party')).toHaveText('');
    expect((await fxLog(page)).split('snd:flip').length - 1).toBe(3);
    await relics.nth(0).click();   // a turned relic stays turned
    await expect(relics.nth(0)).toHaveClass(/is-up/);

    const summon = page.locator('#cn-summon'), alone = page.locator('#cn-huntAlone'), maw = page.locator('#cn-mawimg');
    const share = (ok: boolean) => page.evaluate((good) => {
      (window as any).__shared = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: unknown) => { (window as any).__shared.push(data); if (!good) throw new DOMException('Share canceled', 'AbortError'); },
      });
    }, ok);
    // The sheet was opened and dismissed: nothing went out, so nothing changes.
    await share(false);
    await summon.click();
    await expect.poll(() => page.evaluate(() => (window as any).__shared.length)).toBe(1);
    await expect(summon).toHaveText('Summon a friend');
    await expect(maw).toHaveAttribute('src', 'assets/bosses/the-twin-maw.png');
    await expect(alone).toBeVisible();
    await expect(page.locator('#cn-party .ob4-chip')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__ob.U.summoned)).toBe(false);
    let q = await page.evaluate(() => localStorage.getItem('hb_funnel_queue') || '');
    expect(q).toContain('share_opened');
    expect(q).not.toContain('onboarding_summon_sent');

    // The invite goes out: the Maw answers, the chip says so, and the button moves on.
    await share(true);
    await summon.click();
    await expect(summon).toHaveText('Onward');
    await expect(summon).toHaveClass(/ob4-ghost/);
    await expect(maw).toHaveAttribute('src', 'assets/bosses/the-twin-maw-summons.png');
    await expect(page.locator('#cn-party .ob4-chip')).toHaveText('Invite sent · the hunt opens when they answer');
    await expect(alone).toBeHidden();
    const sent = await page.evaluate(() => (window as any).__shared[0] as { title: string; text: string });
    expect(sent.title).toBe('Awakened');
    expect(sent.text).toContain('Hunt The Twin Maw with me on Awakened');
    expect(sent.text).toContain('14,000 combined steps');
    q = await page.evaluate(() => localStorage.getItem('hb_funnel_queue') || '');
    expect(q).toContain('onboarding_summon_sent');
    await summon.click();
    await obOn(page, 'ascent');
  });

  test('the tower follows the drag: a hundred floors up, the Hall lights, and letting go settles back to one', async ({ page }) => {
    await boot(page);
    await obGo(page, 'ascent');
    await obOn(page, 'ascent');
    const floor = page.locator('#cn-floorN'), hall = page.locator(OB + ' .ob4-hall');
    await expect(floor).toHaveText('1');
    await expect(hall).toHaveText('Floor 100 · The Hall of the Awakened');
    await expect(hall).not.toHaveClass(/is-lit/);
    // Wait out the screen's entrance so the pointer lands on a settled tower.
    await expect(page.locator('#cn-ascentNext')).toBeVisible();
    const box = await page.locator('#cn-tower').boundingBox();
    const x = box!.x + box!.width / 2, y = 620;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 190, { steps: 6 });   // half the 380px throw
    await expect(floor).toHaveText('51');
    await expect(hall).not.toHaveClass(/is-lit/);
    expect(parseFloat(await page.locator(OB + ' .ob4-s-ascent').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--ob4-p')))).toBeCloseTo(0.5, 2);
    await page.mouse.move(x, y - 380, { steps: 6 });
    await expect(floor).toHaveText('100');
    await expect(hall).toHaveClass(/is-lit/);
    await expect(page.locator(OB + ' .ob4-floor')).toHaveClass(/is-top/);
    await page.mouse.move(x, y - 470, { steps: 3 });   // there is no floor 101
    await expect(floor).toHaveText('100');
    expect(await fxLog(page)).toContain('snd:seal');

    await page.mouse.up();
    await expect(floor).toHaveText('1', { timeout: 4_000 });
    await expect(hall).not.toHaveClass(/is-lit/);
    await page.locator('#cn-ascentNext').click();
    await obOn(page, 'vow');
  });

  test('a replay in the same session as a first run leaves the first run\'s handlers behind', async ({ page }) => {
    test.slow();
    await boot(page);
    // W952 — the Wolf's trail opens a new hunter's hunt on its own, a second or
    // so after they land in the app. This hunter has stood it down for today,
    // so the only thing that could engage the Wolf below is a strike.
    await page.evaluate(() => {
      const d = new Date();
      localStorage.setItem('hb_wolf_trail_skip', d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
    });
    await obAcknowledgeNotices(page);
    // The real first run with Health refused: its Wolf is never struck, so
    // before W947 its strike handler stayed live on the shared element.
    await obWorld(page, { health: 'denied' });
    await obName(page, 'Richie');
    await page.locator('#cn-healthBtn').click();
    await expect(page.locator('#cn-healthBtn')).toHaveText('Carry on');
    await page.locator('#cn-healthBtn').click();
    await obOn(page, 'wolf');
    await expect(page.locator(WOLF)).toHaveAttribute('data-outcome', 'locked');
    await page.locator('#cn-wolfNext').click();
    await obOn(page, 'hunt');                       // nobody on the board: walked past
    await page.locator('#cn-huntAlone').click();
    await obOn(page, 'ascent');
    await page.locator('#cn-ascentNext').click();
    await obOn(page, 'vow');
    await page.locator('[data-cn-pack="custom"]').click();
    await page.locator('#cn-enter').click();   // SWEAR IT, and the Gate opens by itself (W1056)
    await obFinish(page);
    await page.evaluate(() => { document.querySelectorAll('#statup-ov, #ach-popup').forEach((x) => x.remove()); });

    const KEYS = ['hb_habits', 'hb_path', 'hb_name', 'hb_bosses', 'hb_inventory', 'hb_onboarding_first_xp_awarded_v1', 'hb_avatar_skin'];
    const read = () => page.evaluate((keys) => keys.map((k) => localStorage.getItem(k)), KEYS);
    const before = await read();

    // Health opened later; the replay arms a Wolf of its own.
    await obWorld(page, { today: 3860, week: 18860 });
    await page.evaluate(() => (window as any).__replayOnboarding());
    await obOn(page, 'gate');
    expect(await page.evaluate(() => (document.getElementById('cin-onboarding') as HTMLElement).classList.contains('ob4-preview'))).toBe(true);
    await page.locator(OB + ' .ob4-mark').focus();
    await page.keyboard.press('Enter');
    await page.locator(OB + ' .ob4-gate-carry').click();
    await obOn(page, 'name');
    await expect(page.locator('#cin-nameField')).toHaveValue('Richie');
    await page.locator('#cin-nameConfirm').click();
    await obOn(page, 'witness');
    await page.locator('#cn-healthBtn').click();
    await obRevealToWolf(page);
    // Not the first run's locked Wolf: a fresh one, waiting to be struck.
    expect(await page.locator(WOLF).getAttribute('data-outcome')).toBeNull();
    await expect(page.locator('#cn-wolf')).toBeVisible();
    expect(await obStrike(page)).toBe('bleeds');      // shown; a replay engages nothing
    expect(await engaged(page)).toBe(false);
    const r = await page.evaluate(() => ({
      onlyOneRoot: document.querySelectorAll('#cin-onboarding').length,
      oneEngine:   document.querySelectorAll('#cin-onboarding .ob4-root').length,
      oneWolf:     document.querySelectorAll('#cn-wolf').length,
    }));
    expect(r).toEqual({ onlyOneRoot: 1, oneEngine: 1, oneWolf: 1 });
    await page.locator('#cn-wolfNext').click();
    await obOn(page, 'hunt');
    await page.locator('#cn-huntAlone').click();
    await obOn(page, 'ascent');
    await page.locator('#cn-ascentNext').click();
    await obOn(page, 'vow');
    await expect(page.locator('[data-cn-pack="custom"]')).toHaveClass(/is-on/);
    await page.locator('#cn-enter').click();   // SWEAR IT, and the Gate opens by itself (W1056)
    await expect(page.locator(OB)).toBeHidden({ timeout: 10_000 });
    expect(await read()).toEqual(before);
  });

  test('the type is the carved pairing, and the block stays inside the iOS 15 floor', async ({ page }) => {
    await obFirstRun(page);
    const r = await page.evaluate(() => {
      const fam = (sel: string) => getComputedStyle(document.querySelector(sel) as HTMLElement).fontFamily.replace(/["']/g, '');
      const btn = getComputedStyle(document.querySelector('#cin-nameConfirm') as HTMLElement);
      return {
        fonts: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => (l as HTMLLinkElement).href).filter((h) => h.indexOf('fonts.googleapis.com') >= 0).join(' '),
        title: fam('#cin-onboarding .ob4-s-name .ob4-title'),
        licence: fam('#cin-onboarding .ob4-s-name .ob4-lic-name'),
        button: btn.fontFamily.replace(/["']/g, ''),
        buttonInk: btn.color,
        buttonBg: btn.backgroundColor,
        counter: fam('#cin-onboarding .ob4-field-n'),
        body: fam('#cin-onboarding .ob4-root'),
        field: fam('#cin-nameField'),
      };
    });
    // index.html asks Google Fonts for all three.
    expect(r.fonts).toContain('Grenze+Gotisch');
    expect(r.fonts).toContain('Chakra+Petch');
    expect(r.fonts).toContain('Alegreya+Sans');
    // Display, HUD, body.
    expect(r.title).toMatch(/^Grenze Gotisch\b/);
    expect(r.licence).toMatch(/^Grenze Gotisch\b/);
    expect(r.button).toMatch(/^Chakra Petch\b/);
    expect(r.counter).toMatch(/^Chakra Petch\b/);
    expect(r.body).toMatch(/^Alegreya Sans\b/);
    expect(r.field).toMatch(/^Alegreya Sans\b/);
    // A button keeps its own face and its own ink: dark on gold. (The handoff's
    // `.ob-root button` reset outranked `.ob-btn` and took both away.)
    expect(r.buttonInk).toBe('rgb(26, 18, 0)');
    expect(r.buttonBg).toBe('rgb(245, 184, 66)');

    // color-mix() needs iOS 16.2; the app's floor is iOS 15.
    const css = await (await page.request.get('/styles.css')).text();
    const start = css.indexOf('ONBOARDING v4');
    expect(start).toBeGreaterThan(0);
    const next = css.indexOf('/* ═', start);
    const block = css.slice(start, next > start ? next : undefined);
    expect(block).toContain('.ob4-root{');
    expect(block).toContain('.ob4-hand');
    expect((block.match(/\.ob4-/g) || []).length).toBeGreaterThan(400);   // the whole block, not a sliver of it
    expect(block).not.toContain('color-mix(');
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
        // The habit day is PACIFIC, not device-local (app.js `let today =
        // getPTDate()`), so every completion / streak key must be stamped the
        // same way. Seeding the runner's own midnight put these keys a day
        // ahead for the whole UTC evening, which is a third of every CI day.
        const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
        localStorage.setItem('hb_habits', JSON.stringify(['First vow', 'Second vow', 'Third vow'].map((n, i) => (
          { id: 'w948-' + i, name: n, emoji: '•', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'WILL' }))));
        ['hb_first_completion_bonus_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_tour_day3_v1',
         'hb_tour_day7_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        // W1020 — every stat level now gets its LEVEL UP screen, and on a weekend (stat points
        // doubled) three WILL vows cross Level 2 and that screen leads the Perfect Day seal. Start
        // WILL clear of a threshold so this suite watches the same thing on every day of the week.
        localStorage.setItem('hb_stats', JSON.stringify({ STR: { pts: 0 }, VIT: { pts: 0 }, INT: { pts: 0 }, FOCUS: { pts: 0 }, WILL: { pts: 6 }, WLT: { pts: 0 } }));
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

  /** The app's habit day: Pacific, the same clock `today` is read from. */
  const ptDay = (page: Page) => page.evaluate(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()));

  /** Tap all three vows and watch both popups for a few seconds. */
  async function sealTheDay(page: Page) {
    return page.evaluate(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
      const dayBefore = day();
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
      return { seen, pointsBefore, dayBefore, dayAfter: day(),
               pointsAfter: Number(localStorage.getItem('hb_points') || '0'),
               awarded: JSON.parse(localStorage.getItem('hb_compound_awarded') || '{}') };
    });
  }

  test('finishing the routine and the day on one tap shows the Perfect Day seal only, and the bonus is still paid', async ({ page }) => {
    await routineOfThree(page, false);
    const r = await sealTheDay(page);
    expect(r.seen.pday).toBe(true);
    expect(r.seen.compound).toBe(false);
    // The routine bonus was paid (today's award is on the books), just not
    // announced. "Today" is the app's PACIFIC day — asserting against the
    // runner's own clock failed by exactly one day for the whole UTC evening
    // (CI: array ["2026-09-16","2026-09-16"], the app had correctly written
    // "2026-09-15"). Both ends are captured so a run that straddles the PT
    // rollover still accepts the day the taps actually landed on.
    expect([r.dayBefore, r.dayAfter]).toContain(r.awarded.custom);
    expect(r.pointsAfter - r.pointsBefore).toBeGreaterThan(3);   // more than the three vows alone
  });

  test('a routine completed on a day whose Perfect Day is already logged still gets its own popup', async ({ page }) => {
    await routineOfThree(page, true);
    const seedDay = await ptDay(page);              // the day the seed called "today"
    const r = await sealTheDay(page);
    // The whole premise is "today's Perfect Day is already on the books". If the
    // PT day rolls between the seed and the taps, that seed describes YESTERDAY
    // and a second seal is the correct behaviour, not a regression — there is
    // nothing left to assert.
    test.skip(seedDay !== r.dayAfter, 'the local day rolled over mid-test');
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

    // W980 — the result is tap-to-continue: the first tap skips to the end, the second leaves.
    await page.locator('#boss-result-overlay .hr-frame').click({ position: { x: 20, y: 20 } });
    await page.locator('#boss-result-overlay .hr-frame').click({ position: { x: 20, y: 20 } });
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

// ─────────────────────────────────────────────────────────────────────────
// AP. W951 — the hunt row leads the Habits tab
// ─────────────────────────────────────────────────────────────────────────
test.describe('AP · The hunt row (W951)', () => {
  const HOUR = 3600_000;
  async function hunter(page: Page, bosses: Record<string, unknown>, extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript(({ bosses, extra }: { bosses: Record<string, unknown>; extra: Record<string, string> }) => {
      try {
        if (sessionStorage.getItem('__w951_seeded')) return;
        sessionStorage.setItem('__w951_seeded', '1');
        const d = new Date();
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const old = new Date(); old.setDate(old.getDate() - 3);
        const oymd = old.getFullYear() + '-' + String(old.getMonth() + 1).padStart(2, '0') + '-' + String(old.getDate()).padStart(2, '0');
        localStorage.setItem('hb_habits', JSON.stringify([{ id: 'w951-a', name: 'First vow', emoji: '•', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'WILL' }]));
        localStorage.setItem('hb_bosses', JSON.stringify(bosses));
        localStorage.setItem('hb_bosses_engagement_migrated', '1');   // the one-time W-era migration clears engaged hunts
        localStorage.setItem('hb_leaderboard', JSON.stringify({ steps_daily: { [ymd]: 1100 }, flights_daily: { [ymd]: 4 } }));
        localStorage.setItem('hb_onboarding_first_xp_date', oymd);
        ['hb_first_completion_bonus_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_tour_day3_v1', 'hb_tour_day7_v1',
         'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        Object.entries(extra || {}).forEach(([k, v]) => localStorage.setItem(k, v));
      } catch (_) {}
    }, { bosses, extra: extra || {} });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await page.waitForTimeout(2500);
  }
  const wolf = (over?: Record<string, unknown>) => ({
    engaged: true, kill_count: 0, streak: 0, step_progress: 1100,
    hunt_started_at: Date.now() - 3 * HOUR, hunt_expires_at: Date.now() + 21 * HOUR, ...(over || {}),
  });

  // W1026 — the co-op step upload is rate-limited per minute, and the app used to post once per
  // live hunt: a hunter on eight hunts starved the oldest ones (their ally saw a frozen total).
  // Every live hunt's steps now go in ONE request.
  test('W1026: eight live hunts upload in one request; a dual hunt sends both streams; 25 events to a request', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(async () => {
      const w = window as any;
      const posts: any[][] = [];
      const hk = { sb: w.Health.getStepsBetween, fb: w.Health.getFlightsClimbedBetween, sv: w.Auth.submitVerifiedEvents };
      w.Health.getStepsBetween = async () => 4321;
      w.Health.getFlightsClimbedBetween = async () => 7;
      w.Auth.submitVerifiedEvents = async (ev: any[]) => { posts.push(ev); return { ok: true }; };
      const mk = (i: number, boss: string, status = 'active') => ({ id: 'inst-' + i, boss_id: boss, status, starts_at: new Date(Date.now() - 3600_000).toISOString(), ends_at: new Date(Date.now() + 3600_000).toISOString() });
      try {
        const eight = Array.from({ length: 8 }, (_, i) => mk(i, i === 7 ? 'the_gaunt_wardens' : 'the_twin_maw'));
        const n1 = await w.__coopSubmitMany(eight.concat([mk(99, 'the_twin_maw', 'pending') as any]));
        const first = posts.slice();
        posts.length = 0;
        const n2 = await w.__coopSubmitMany(Array.from({ length: 30 }, (_, i) => mk(100 + i, 'the_twin_maw')));
        return { n1, requests1: first.length, ids: first[0].map((e: any) => e.boss_instance_id), types: first[0].map((e: any) => e.event_type), unique: new Set(first[0].map((e: any) => e.client_event_id)).size,
          n2, sizes2: posts.map((p) => p.length) };
      } finally { w.Health.getStepsBetween = hk.sb; w.Health.getFlightsClimbedBetween = hk.fb; w.Auth.submitVerifiedEvents = hk.sv; }
    });
    expect(r.requests1).toBe(1);                                  // not eight
    expect(r.n1).toBe(9);                                         // seven steps hunts + the dual hunt's two streams; the pending hunt sends nothing
    expect(new Set(r.ids).size).toBe(8);
    expect(r.ids).not.toContain('inst-99');
    expect(r.types.filter((t: string) => t === 'flights_total').length).toBe(1);
    expect(r.unique).toBe(9);
    expect([r.n2, r.sizes2]).toEqual([30, [25, 5]]);              // the server takes 25 events a request
  });

  // W1025 — the Myrmidon King's id (the_sleepless_crown) is not its picture's name; YOUR HUNTS
  // drew a broken image. Every co-op boss must resolve to a picture that is really there.
  test('W1025: every co-op boss has a picture that loads, the Myrmidon King included', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(async () => {
      const b = (window as any).__bossArt;
      const out: Array<{ id: string; path: string; ok: boolean; type: string }> = [];
      for (const id of b.coopIds() as string[]) {
        const path = b.path(id);
        let ok = false, type = '';
        try { const res = await fetch(path, { cache: 'no-store' }); ok = res.ok; type = res.headers.get('content-type') || ''; } catch (_) {}
        out.push({ id, path, ok, type });
      }
      return { out, king: b.path('the_sleepless_crown'), wolf: b.path('the_steel_wolf') };
    });
    expect(r.king).toBe('assets/bosses/the-myrmidon-king.png');
    expect(r.wolf).toBe('assets/bosses/the-steel-wolf.png');   // a solo boss is untouched
    expect(r.out.length).toBeGreaterThanOrEqual(10);
    expect(r.out.filter((x) => !x.ok || x.type.indexOf('image') < 0).map((x) => x.id + ' → ' + x.path)).toEqual([]);
  });

  test('the hunt the hunter is on leads the tab, with live steps, and opens on tap', async ({ page }) => {
    await hunter(page, { the_steel_wolf: wolf() });
    const row = page.locator('#hunt-row');
    await expect(row).toBeVisible();
    await expect(page.locator('#dungeon-tease-pointer')).toHaveCount(0);   // the old banner is gone for good
    await expect(row.locator('.hunt-row-name')).toHaveText('The Steel Wolf');
    await expect(row.locator('.hunt-row-line')).toHaveText('1,100 / 6,000 steps');
    await expect(row.locator('.hunt-row-meta')).toContainText('E-RANK');
    await expect(row.locator('.hunt-row-more')).toHaveCount(0);            // only one hunt: no count chip
    // The bar is the share walked, not a guess.
    const pct = await row.locator('.hunt-row-bar i').evaluate((el) => parseFloat((el as HTMLElement).style.width));
    expect(pct).toBeGreaterThan(15);
    expect(pct).toBeLessThan(21);
    // It sits above the vows, where the old banner was.
    expect(await page.evaluate(() => {
      const r = document.getElementById('hunt-row'), h = document.getElementById('vows-header');
      return !!(r && h && (r.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);

    // W953 — the card opens YOUR HUNTS; the boss is one tap further in.
    await row.click();
    const sheet = page.locator('#hunt-list-overlay');
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    await sheet.locator('.hunt-row', { hasText: 'The Steel Wolf' }).click();
    await expect(page.locator('#boss-fs-overlay')).toBeVisible({ timeout: 5_000 });
  });

  test('three hunts: the one that needs today leads, the chip opens the rest, a list row opens its hunt', async ({ page }) => {
    await hunter(page, {
      the_steel_wolf:   wolf(),
      the_insomniac:    { engaged: true, kill_count: 0, streak: 0, hunt_started_at: Date.now() - 2 * HOUR, hunt_expires_at: Date.now() + 22 * HOUR },
      the_gray_pilgrim: { engaged: true, kill_count: 0, streak: 0, flight_progress: 31, hunt_started_at: Date.now() - 4 * 24 * HOUR, hunt_expires_at: Date.now() + 3 * 24 * HOUR },
    });
    const row = page.locator('#hunt-row');
    await expect(row.locator('.hunt-row-name')).toHaveText('The Steel Wolf');   // ends today, furthest along
    await expect(row.locator('.hunt-row-more')).toHaveText('+2');

    await row.locator('.hunt-row-more').click();
    const sheet = page.locator('#hunt-list-overlay');
    await expect(sheet).toBeVisible();
    expect(await sheet.locator('.hunt-row-name').allTextContents()).toEqual(['The Steel Wolf', 'The Insomniac', 'The Gray Pilgrim']);
    expect(await sheet.locator('.hunt-row-line').allTextContents()).toEqual([
      '1,100 / 6,000 steps', 'Sleep 7+ hours in a single night', '31 / 56 flights',
    ]);
    await sheet.locator('.hunt-row', { hasText: 'The Gray Pilgrim' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('#boss-fs-overlay')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#bfs-name')).toHaveText(/Gray Pilgrim/i);
  });

  test('a kill waiting to be seen turns the row gold and opens the result', async ({ page }) => {
    await hunter(page, { the_steel_wolf: { engaged: false, kill_count: 1, streak: 1 } }, {
      hb_boss_result_pending: JSON.stringify({
        bossId: 'the_steel_wolf', bossName: 'The Steel Wolf', rank: 'E', kill_count: 1,
        defeatedAt: new Date().toISOString(), conditionLabel: '6,000 verified steps', drop: null,
      }),
    });
    const row = page.locator('#hunt-row');
    await expect(row).toHaveClass(/hunt-row--won/);
    await expect(row.locator('.hunt-row-line')).toHaveText('Defeated — tap to claim');
    await row.click();
    await expect(page.locator('#boss-result-overlay')).toBeVisible({ timeout: 5_000 });
  });

  test('with no hunt running it says so and points at the Co-op tab; the ✕ puts it away until the next hunt', async ({ page }) => {
    await hunter(page, {});
    const row = page.locator('#hunt-row');
    await expect(row).toHaveClass(/hunt-row--idle/);
    await expect(row).toContainText('No hunt running');

    await row.locator('.hunt-row-x').click();
    await expect(page.locator('#hunt-row')).toHaveCount(0);
    await page.evaluate(() => (window as any).__renderHuntRow());
    await expect(page.locator('#hunt-row')).toHaveCount(0);                 // stays away

    // A hunt starts: the row is back, whatever the hunter dismissed.
    await page.evaluate((w) => {
      localStorage.setItem('hb_bosses', JSON.stringify({ the_steel_wolf: w }));
      (window as any).__renderHuntRow();
    }, wolf());
    await expect(page.locator('#hunt-row')).toBeVisible();
    await expect(page.locator('#hunt-row .hunt-row-line')).toHaveText('1,100 / 6,000 steps');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AQ. W952 — the Wolf's trail: a free daily hunt for every new hunter
// ─────────────────────────────────────────────────────────────────────────
test.describe('AQ · The Wolf\u2019s trail (W952)', () => {
  const HOUR = 3600_000;
  async function trailHunter(page: Page, extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript((extra: Record<string, string>) => {
      try {
        if (sessionStorage.getItem('__w952_seeded')) return;
        sessionStorage.setItem('__w952_seeded', '1');
        const old = new Date(); old.setDate(old.getDate() - 5);
        const oymd = old.getFullYear() + '-' + String(old.getMonth() + 1).padStart(2, '0') + '-' + String(old.getDate()).padStart(2, '0');
        localStorage.setItem('hb_habits', JSON.stringify([{ id: 'w952-a', name: 'First vow', emoji: '\u2022', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'WILL' }]));
        localStorage.setItem('hb_bosses_engagement_migrated', '1');   // the one-time migration clears engaged hunts
        localStorage.setItem('hb_souls', JSON.stringify({ balance: 500, lastDailyBonusDate: '2099-01-01', totalEarned: 0, totalSpent: 0 }));
        localStorage.setItem('hb_onboarding_first_xp_date', oymd);    // not day one: the W940 quiet rule is satisfied
        localStorage.setItem('hb_wolf_trail_v1', '1');                // this hunter came through the new onboarding
        ['hb_first_completion_bonus_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_tour_day3_v1', 'hb_tour_day7_v1',
         'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        Object.entries(extra || {}).forEach(([k, v]) => { if (v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); });
      } catch (_) {}
    }, extra || {});
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
  }
  const engagedWolf = (page: Page) => page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('hb_bosses') || '{}');
    return (b.the_steel_wolf || {}).engaged === true;
  });

  test('today\u2019s hunt opens itself, costs nothing, and spends no banked credit', async ({ page }) => {
    await trailHunter(page);
    await expect.poll(() => engagedWolf(page), { timeout: 10_000 }).toBe(true);
    const after = await page.evaluate(() => {
      const b = JSON.parse(localStorage.getItem('hb_bosses') || '{}');
      const w = b.the_steel_wolf || {};
      return {
        souls: (JSON.parse(localStorage.getItem('hb_souls') || '{}')).balance,
        spent: (JSON.parse(localStorage.getItem('hb_souls') || '{}')).totalSpent,
        freebie: localStorage.getItem('hb_first_hunt_free_used'),
        stone: localStorage.getItem('hb_stone_free_engage'),
        told: localStorage.getItem('hb_wolf_trail_told'),
        hours: Math.round(((w.hunt_expires_at || 0) - Date.now()) / 3600_000),
        trail: (window as any).__wolfTrail(),
      };
    });
    expect(after.souls).toBeGreaterThanOrEqual(500);   // the fee was never taken
    expect(after.spent).toBe(0);                       // nothing was spent at all
    expect(after.freebie).toBeNull();                  // the first-hunt freebie is still the hunter's to spend
    expect(after.stone).toBeNull();
    expect(after.hours).toBe(24);
    expect(after.trail.active).toBe(true);
    // Explained once, in the lightest surface there is.
    expect(after.told).toBe('1');
    await expect(page.locator('.habit-toast', { hasText: 'free every day' })).toBeVisible({ timeout: 5_000 });
    // And it leads the Habits tab like any other hunt.
    await expect(page.locator('#hunt-row .hunt-row-name')).toHaveText('The Steel Wolf');
  });

  test('a day that closes unclear is not a failure: no HUNT FAILED, tomorrow\u2019s hunt opens on its own', async ({ page }) => {
    await trailHunter(page, {
      hb_wolf_trail_told: '1',
      hb_bosses: JSON.stringify({
        the_steel_wolf: { engaged: true, kill_count: 0, streak: 0, step_progress: 10,
          hunt_started_at: Date.now() - 30 * HOUR, hunt_expires_at: Date.now() - 6 * HOUR },
      }),
    });
    await expect.poll(() => page.evaluate(() => {
      const b = JSON.parse(localStorage.getItem('hb_bosses') || '{}');
      return Math.round((((b.the_steel_wolf || {}).hunt_expires_at || 0) - Date.now()) / 3600_000);
    }), { timeout: 10_000 }).toBe(24);
    const after = await page.evaluate(() => {
      const b = JSON.parse(localStorage.getItem('hb_bosses') || '{}');
      const w = b.the_steel_wolf || {};
      const ov = document.getElementById('boss-result-overlay');
      return {
        engaged: w.engaged === true,
        outcome: w.last_hunt_outcome,
        failedScreen: !!(ov && !ov.classList.contains('hidden')),
        pending: localStorage.getItem('hb_boss_result_pending'),
      };
    });
    expect(after.failedScreen).toBe(false);   // nothing was lost, so nothing is announced
    expect(after.pending).toBeNull();
    expect(after.engaged).toBe(true);
    expect(after.outcome).toBeNull();
  });

  test('the trail runs beside the three hunt slots, and stopping it by hand holds for the day', async ({ page }) => {
    await trailHunter(page, {
      hb_wolf_trail_told: '1',
      hb_bosses: JSON.stringify({
        the_insomniac:       { engaged: true, kill_count: 0, streak: 0, hunt_started_at: Date.now() - HOUR, hunt_expires_at: Date.now() + 20 * HOUR },
        the_gray_pilgrim:    { engaged: true, kill_count: 0, streak: 0, hunt_started_at: Date.now() - HOUR, hunt_expires_at: Date.now() + 6 * 24 * HOUR },
        the_marathon_wraith: { engaged: true, kill_count: 0, streak: 0, hunt_started_at: Date.now() - HOUR, hunt_expires_at: Date.now() + 6 * 24 * HOUR },
      }),
    });
    // Three chosen hunts is the cap — the free one still opens, as a fourth.
    await expect.poll(() => engagedWolf(page), { timeout: 10_000 }).toBe(true);
    expect(await page.evaluate(() => {
      const b = JSON.parse(localStorage.getItem('hb_bosses') || '{}');
      return Object.keys(b).filter((k) => b[k] && b[k].engaged === true).length;
    })).toBe(4);

    // Stop it by hand: gone for the rest of today, and the tick respects that.
    await page.evaluate(() => (window as any).Bosses.disengageBoss('the_steel_wolf'));
    await expect(page.locator('.habit-toast', { hasText: 'picks up again tomorrow' })).toBeVisible({ timeout: 5_000 });
    await page.evaluate(() => (window as any).__wolfTrailTick());
    expect(await engagedWolf(page)).toBe(false);
    expect(await page.evaluate(() => (window as any).__wolfTrail().skippedToday)).toBe(true);

    // Changing your mind re-opens it, and clears the skip.
    expect(await page.evaluate(() => (window as any).Bosses.engageBoss('the_steel_wolf'))).toBe(true);
    expect(await page.evaluate(() => (window as any).__wolfTrail().skippedToday)).toBe(false);
  });

  test('the boots end the trail — the Wolf goes back to being an ordinary gate', async ({ page }) => {
    await trailHunter(page, {
      hb_inventory: JSON.stringify({ cards: { trail_worn_boots: { count: 1, discovered: true } } }),
    });
    await page.waitForTimeout(4500);
    expect(await engagedWolf(page)).toBe(false);
    expect(await page.evaluate(() => (window as any).__wolfTrail())).toEqual({ active: false, owns: true, skippedToday: false });
  });

  test('a hunter who was already playing is left alone', async ({ page }) => {
    await trailHunter(page, { hb_wolf_trail_v1: '' });
    await page.waitForTimeout(4500);
    expect(await engagedWolf(page)).toBe(false);
    expect(await page.evaluate(() => (window as any).__wolfTrail().active)).toBe(false);
    await expect(page.locator('#hunt-row')).toHaveClass(/hunt-row--idle/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AR. W953 — the card opens the list, and a lone hunt is offered a second
// ─────────────────────────────────────────────────────────────────────────
test.describe('AR \u00b7 A second hunt, one tap away (W953)', () => {
  const HOUR = 3600_000;
  async function hunter(page: Page, bosses: Record<string, unknown>, souls = 500) {
    await freshApp(page);
    await page.addInitScript(({ bosses, souls }: { bosses: Record<string, unknown>; souls: number }) => {
      try {
        if (sessionStorage.getItem('__w953_seeded')) return;
        sessionStorage.setItem('__w953_seeded', '1');
        const d = new Date();
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const old = new Date(); old.setDate(old.getDate() - 5);
        const oymd = old.getFullYear() + '-' + String(old.getMonth() + 1).padStart(2, '0') + '-' + String(old.getDate()).padStart(2, '0');
        localStorage.setItem('hb_habits', JSON.stringify([{ id: 'w953-a', name: 'First vow', emoji: '\u2022', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'WILL' }]));
        localStorage.setItem('hb_bosses', JSON.stringify(bosses));
        localStorage.setItem('hb_bosses_engagement_migrated', '1');
        localStorage.setItem('hb_leaderboard', JSON.stringify({ steps_daily: { [ymd]: 1100 }, flights_daily: { [ymd]: 2 } }));
        localStorage.setItem('hb_souls', JSON.stringify({ balance: souls, lastDailyBonusDate: ymd, totalEarned: 0, totalSpent: 0 }));
        localStorage.setItem('hb_onboarding_first_xp_date', oymd);
        localStorage.setItem('hb_first_hunt_free_used', '1');   // no banked credit: the offer must name the real price
        ['hb_first_completion_bonus_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_tour_day3_v1', 'hb_tour_day7_v1',
         'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      } catch (_) {}
    }, { bosses, souls });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await page.waitForTimeout(2500);
  }
  const wolf = () => ({
    engaged: true, kill_count: 0, streak: 0, step_progress: 1100,
    hunt_started_at: Date.now() - 3 * HOUR, hunt_expires_at: Date.now() + 21 * HOUR,
  });

  test('one hunt: the list offers the Carouser at its real price, and one tap starts it', async ({ page }) => {
    await hunter(page, { the_steel_wolf: wolf() });
    await page.locator('#hunt-row').click();
    const sheet = page.locator('#hunt-list-overlay');
    await expect(sheet).toBeVisible();
    const add = sheet.locator('.hunt-add');
    await expect(add.locator('.hunt-add-name')).toHaveText('HUNT THE CAROUSER');
    await expect(add.locator('.hunt-add-meta')).toHaveText('E-RANK');
    await expect(add.locator('.hunt-add-line')).toHaveText('Climb 5+ verified flights today \u00b7 25 SOULS');

    await add.click();
    // The hunt starts and the list rebuilds around it (same id, a new element):
    // two rows now, and the offer is gone.
    const sheet2 = page.locator('#hunt-list-overlay');
    await expect(sheet2).toBeVisible({ timeout: 5_000 });
    // Both hunts are listed; the ordering rule (furthest along first) decides
    // which leads, and today's 2 of 5 flights beats 1,100 of 6,000 steps.
    expect((await sheet2.locator('.hunt-row-name').allTextContents()).slice().sort())
      .toEqual(['The Carouser', 'The Steel Wolf']);
    await expect(sheet2.locator('.hunt-add')).toHaveCount(0);
    const after = await page.evaluate(() => {
      const b = JSON.parse(localStorage.getItem('hb_bosses') || '{}');
      return { engaged: (b.the_carouser || {}).engaged === true, souls: (JSON.parse(localStorage.getItem('hb_souls') || '{}')).balance };
    });
    expect(after.engaged).toBe(true);
    expect(after.souls).toBe(475);            // the 25-soul fee, exactly as the button said
    // And the card now leads with a count.
    await expect(page.locator('#hunt-row .hunt-row-more')).toHaveText('+1');
  });

  test('two hunts running: no offer \u2014 the app does not push a third', async ({ page }) => {
    await hunter(page, {
      the_steel_wolf: wolf(),
      the_insomniac:  { engaged: true, kill_count: 0, streak: 0, hunt_started_at: Date.now() - 2 * HOUR, hunt_expires_at: Date.now() + 22 * HOUR },
    });
    await page.locator('#hunt-row').click();
    const sheet = page.locator('#hunt-list-overlay');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.hunt-add')).toHaveCount(0);
  });

  test('a lone hunt that IS the Carouser gets no offer to hunt it again', async ({ page }) => {
    await hunter(page, {
      the_carouser: { engaged: true, kill_count: 0, streak: 0, flight_progress: 2, hunt_started_at: Date.now() - HOUR, hunt_expires_at: Date.now() + 23 * HOUR },
    });
    await page.locator('#hunt-row').click();
    const sheet = page.locator('#hunt-list-overlay');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.hunt-row-name')).toHaveText('The Carouser');
    await expect(sheet.locator('.hunt-add')).toHaveCount(0);
  });

  test('a kill waiting to be claimed still claims on the first tap', async ({ page }) => {
    await hunter(page, { the_steel_wolf: { engaged: false, kill_count: 1, streak: 1 } });
    await page.evaluate(() => {
      localStorage.setItem('hb_boss_result_pending', JSON.stringify({
        bossId: 'the_steel_wolf', bossName: 'The Steel Wolf', kill_count: 1,
        defeatedAt: new Date().toISOString(), acknowledged: false,
      }));
      (window as any).__renderHuntRow();
    });
    const row = page.locator('#hunt-row');
    await expect(row).toHaveClass(/hunt-row--won/);
    await row.click();
    await expect(page.locator('#boss-result-overlay')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#hunt-list-overlay')).toHaveCount(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// AS. W954 — a new hunter sees the hunt on day one
// ────────────────────────────────────────────────────────────────────────
test.describe('AS · Day one shows the hunt (W954)', () => {
  /** A hunter on their very first day: onboarded, nothing sealed yet. */
  async function dayOne(page: Page, extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript((extra: Record<string, string>) => {
      try {
        if (sessionStorage.getItem('__w954_seeded')) return;
        sessionStorage.setItem('__w954_seeded', '1');
        const d = new Date();
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_habits', JSON.stringify([
          { id: 'w954-a', name: 'Sleep',      emoji: '•', difficulty: 'medium', type: 'build', primaryStat: 'VIT' },
          { id: 'w954-b', name: 'Daily walk', emoji: '•', difficulty: 'easy',   type: 'build', primaryStat: 'VIT' }]));
        localStorage.setItem('hb_bosses_engagement_migrated', '1');
        localStorage.setItem('hb_onboarding_first_xp_date', ymd);   // TODAY — this is day one
        localStorage.setItem('hb_wolf_trail_v1', '1');              // came through the new onboarding
        localStorage.setItem('hb_bosses', JSON.stringify({ the_steel_wolf: {
          engaged: true, kill_count: 0, streak: 0, step_progress: 0,
          hunt_started_at: Date.now() - 3600_000, hunt_expires_at: Date.now() + 23 * 3600_000 } }));
        Object.entries(extra || {}).forEach(([k, v]) => { if (v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); });
      } catch (_) {}
    }, extra || {});
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
  }

  test('the Wolf is on the first screen a new hunter ever sees, under the vow prompt and never above it', async ({ page }) => {
    await dayOne(page);
    const row = page.locator('#hunt-row');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('.hunt-row-name')).toHaveText('The Steel Wolf');
    await expect(row.locator('.hunt-row-line')).toHaveText('0 / 6,000 steps');
    // The first vow is still the day's job, so it keeps the top slot.
    await expect(page.locator('#first-vow-pointer')).toBeVisible();
    expect(await page.evaluate(() => {
      const r = document.getElementById('hunt-row'), pt = document.getElementById('first-vow-pointer');
      return !!(r && pt) && !!(pt.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
  });

  test('a hunter who never walked the trail keeps the old day-one quiet', async ({ page }) => {
    await dayOne(page, { hb_wolf_trail_v1: '' });
    await expect(page.locator('#first-vow-pointer')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3500);
    await expect(page.locator('#hunt-row')).toHaveCount(0);
  });

  test('with the trail on but no hunt running, day one stays quiet — no idle row to explain', async ({ page }) => {
    await dayOne(page, { hb_bosses: '{}', hb_wolf_trail_v1: '' });   // no trail tick, no hunt
    await expect(page.locator('#first-vow-pointer')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3500);
    await expect(page.locator('#hunt-row')).toHaveCount(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// AT. W956 — the First Vow picker fits one screen
// ────────────────────────────────────────────────────────────────────────
test.describe('AT · The First Vow picker fits one screen (W956)', () => {
  test.use({ viewport: { width: 375, height: 812 } });   // the smallest modern iPhone

  async function firstVow(page: Page, withHunt = true) {
    await freshApp(page);
    await page.addInitScript((withHunt: boolean) => {
      try {
        if (sessionStorage.getItem('__w956_seeded')) return;
        sessionStorage.setItem('__w956_seeded', '1');
        const d = new Date();
        const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        localStorage.setItem('hb_habits', '[]');                     // no vows yet: the picker
        localStorage.setItem('hb_bosses_engagement_migrated', '1');
        localStorage.setItem('hb_onboarding_first_xp_date', ymd);    // day one
        if (withHunt) {
          localStorage.setItem('hb_wolf_trail_v1', '1');
          localStorage.setItem('hb_bosses', JSON.stringify({ the_carouser: {
            engaged: true, kill_count: 0, streak: 0, flight_progress: 2,
            hunt_started_at: Date.now() - 3600_000, hunt_expires_at: Date.now() + 23 * 3600_000 } }));
        }
      } catch (_) {}
    }, withHunt);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await expect(page.locator('#empty-state-quickgrid .ev-chip').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
  }
  const overflow = (page: Page) => page.evaluate(() => {
    const ms = document.getElementById('main-scroll');
    return ms ? ms.scrollHeight - ms.clientHeight : -1;
  });

  test('a new hunter can see and reach every vow without scrolling — hunt row included', async ({ page }) => {
    await firstVow(page);
    await expect(page.locator('#hunt-row')).toBeVisible();
    await expect(page.locator('#empty-state-quickgrid .ev-chip')).toHaveCount(6);
    // The commit CTA and the library link are the point of the screen; both
    // must be ON it, not below the fold.
    for (const sel of ['#empty-state-commit', '#empty-state-browse']) {
      expect(await page.locator(sel).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom <= window.innerHeight && r.top >= 0;
      })).toBe(true);
    }
    expect(await overflow(page)).toBe(0);
  });

  test('the First Awakened banner is gone from the picker for good', async ({ page }) => {
    await firstVow(page);
    await expect(page.locator('.ev-coach-banner')).toHaveCount(0);
  });

  test('one door, not two: the footer Add Habits stands down for the picker and comes back with the first vow', async ({ page }) => {
    await firstVow(page, false);
    await expect(page.locator('#add-habit-btn')).toBeHidden();
    await expect(page.locator('#empty-state-browse')).toBeVisible();   // the library is still one tap away

    await page.locator('#empty-state-quickgrid .ev-chip').first().click();
    await page.locator('#empty-state-commit').click();
    await expect(page.locator('#habit-list .habit-item')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('#add-habit-btn')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────
// AU. W958 — SEAL A NEW VOW: the control is the window's bottom edge
// ─────────────────────────────────────────────────────────────────────
test.describe('AU · Seal a new vow (W958)', () => {
  async function habits(page: Page, vows = 3) {
    await freshApp(page);
    await page.addInitScript((vows: number) => {
      try {
        if (sessionStorage.getItem('__w958_seeded')) return;
        sessionStorage.setItem('__w958_seeded', '1');
        const names = ['Sleep', 'Daily walk', 'No phone after waking'];
        localStorage.setItem('hb_habits', JSON.stringify(names.slice(0, vows).map((n, i) => (
          { id: 'w958-' + i, name: n, emoji: '•', difficulty: 'easy', type: 'build', primaryStat: 'VIT' }))));
        localStorage.setItem('hb_first_completion_bonus_v1', '1');
        localStorage.setItem('hb_bosses_engagement_migrated', '1');
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_tour_day3_v1', 'hb_tour_day7_v1', 'hb_fg_guide_v1',
         'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      } catch (_) {}
    }, vows);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await page.waitForTimeout(1200);
  }

  test('the bar is the bottom edge of the window, not a card on it', async ({ page }) => {
    await habits(page);
    const bar = page.locator('#add-habit-btn');
    await expect(bar).toHaveText(/SEAL A NEW VOW/);
    // Flush to the bottom, edge to edge of the app shell, 56px tall — a window
    // edge, not a button. (The shell is narrower than the viewport, so the claim
    // is "spans the shell", not a pixel count.)
    expect(await page.evaluate(() => {
      const b = document.getElementById('add-habit-btn')!.getBoundingClientRect();
      const shell = document.getElementById('app')!.getBoundingClientRect();
      return {
        h: Math.round(b.height),
        spansShell: Math.round(b.width) === Math.round(shell.width),
        flushBottom: Math.round(shell.bottom - b.bottom),
      };
    })).toEqual({ h: 56, spansShell: true, flushBottom: 0 });
    // The gold hairline is the footer's own top border.
    expect(await page.evaluate(() =>
      getComputedStyle(document.getElementById('main-footer')!).borderTopColor,
    )).toBe('rgba(245, 158, 11, 0.42)');
    // No dashed kit CTA survives anywhere.
    await expect(page.locator('.add-btn')).toHaveCount(0);
  });

  test('the press lights the whole rule, and lets go of it', async ({ page }) => {
    await habits(page);
    const footer = page.locator('#main-footer');
    await expect(footer).not.toHaveClass(/pressed/);
    await page.locator('#add-habit-btn').hover();
    await page.mouse.down();
    await expect(footer).toHaveClass(/pressed/);
    await page.mouse.up();
    await expect(footer).not.toHaveClass(/pressed/);
  });

  test('it opens the library, which now names itself and says DONE', async ({ page }) => {
    await habits(page);
    await page.locator('#add-habit-btn').click();
    await expect(page.locator('#lib-sheet')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#lib-sheet .lib-eyebrow')).toHaveText('THE LIBRARY');
    await expect(page.locator('#lib-title')).toHaveText('Seal a new vow');
    await expect(page.locator('#lib-close-btn')).toHaveText('DONE');
    // The slots line is the one the sheet already kept honest.
    await expect(page.locator('#lib-sub')).toHaveText('3 active · 22 slots open');
  });

  test('the bar stands down for the First Vow picker — hairline and all', async ({ page }) => {
    await habits(page, 0);
    await expect(page.locator('#empty-state-quickgrid .ev-chip').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#main-footer')).toBeHidden();
  });
});

// ─────────────────────────────────────────────────────────────────────
// AV. W960 — the stylesheet parses, and Manage Vows lands on screen
// ─────────────────────────────────────────────────────────────────────
test.describe('AV · The stylesheet parses (W960)', () => {
  // A stray brace in styles.css is silent: node --check never sees CSS, the app
  // still boots, and the ONLY symptom is one rule missing. W956 left an orphan
  // `}` and it ate `.mv-overlay`, which shipped Manage Vows opening a full
  // viewport below the fold in 3.0.5. This spec is the tripwire.
  // EXACT: standalone rules. A substring test is useless here — when the stray
  // brace ate `.mv-overlay`, `.mv-overlay.hidden` survived and any "contains"
  // matcher happily reported it present. That is exactly how the first version
  // of this guard passed against the real bug.
  const MUST_EXIST_EXACT = [
    '.mv-overlay',        // Manage Vows — the W956 casualty
    '.wg2-mon',           // the worldgate emblem — the W934 casualty
  ];
  // TOKEN: these are only ever written as descendants (`#main-footer .newvow`).
  const MUST_EXIST_TOKEN = ['.hunt-row', '.newvow', '.ev-grid', '.habit-item', '.tab-btn', '.bcard'];

  test('every critical selector actually made it into the CSSOM', async ({ page }) => {
    await freshApp(page);
    const seen = await page.evaluate(() => {
      const got: string[] = [];
      for (const ss of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = (ss as CSSStyleSheet).cssRules; } catch (_) { continue; }
        for (const r of Array.from(rules)) {
          const sel = (r as CSSStyleRule).selectorText;
          if (sel) sel.split(',').forEach((x) => got.push(x.trim()));
        }
      }
      return got;
    });
    expect(seen.length).toBeGreaterThan(7000);           // the sheet loaded at all
    const missingExact = MUST_EXIST_EXACT.filter((sel) => !seen.includes(sel));
    expect(missingExact).toEqual([]);
    const missingToken = MUST_EXIST_TOKEN.filter((cls) => !seen.some((sel) => {
      const i = sel.indexOf(cls);
      if (i < 0) return false;
      const after = sel.charAt(i + cls.length);
      return after === '' || '.: ,>+~['.indexOf(after) >= 0;
    }));
    expect(missingToken).toEqual([]);
  });

  test('Manage Vows opens ON the screen, bottom-anchored', async ({ page }) => {
    await freshApp(page);
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('__w960_seeded')) return;
        sessionStorage.setItem('__w960_seeded', '1');
        localStorage.setItem('hb_habits', JSON.stringify(['Sleep', 'Read', 'Hydrate'].map((n, i) => (
          { id: 'w960-' + i, name: n, emoji: '•', difficulty: 'easy', type: 'build', primaryStat: 'VIT' }))));
        localStorage.setItem('hb_first_completion_bonus_v1', '1');
      } catch (_) {}
    });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await page.waitForTimeout(1200);

    await page.evaluate(() => (window as any).__openManageVows());
    await page.waitForTimeout(700);   // past the 320ms slide-up
    const box = await page.evaluate(() => {
      const sh = document.querySelector('#mv-overlay .mv-sheet') as HTMLElement;
      const r = sh.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
    });
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeLessThan(box.vh);              // it is ON the screen
    expect(Math.abs(box.bottom - box.vh)).toBeLessThanOrEqual(1);   // anchored to the bottom edge
    await expect(page.locator('#mv-overlay .mv-sheet')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AW. W963 — the rank bar moves on the tap you just made
// ─────────────────────────────────────────────────────────────────────────
test.describe('AW · The rank bar moves on the seal (W963)', () => {
  // Seed shape matters: a vow must carry custom:true to seal by row tap in the
  // list language — library-named vows without it route elsewhere.
  async function hunterAt5(page: Page) {
    await freshApp(page);
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('__w963_seeded')) return;
        sessionStorage.setItem('__w963_seeded', '1');
        localStorage.setItem('hb_points', '5');                       // E, 28 to E II
        localStorage.setItem('hb_first_completion_bonus_v1', '1');
        localStorage.setItem('hb_bosses_engagement_migrated', '1');
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_tour_day3_v1', 'hb_tour_day7_v1', 'hb_fg_guide_v1',
         'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        localStorage.setItem('hb_habits', JSON.stringify([
          { id: 'w963-a', name: 'First vow',  emoji: '•', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'WILL' },
          { id: 'w963-b', name: 'Second vow', emoji: '•', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'INT'  }]));
      } catch (_) {}
    });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await expect(page.locator('#habit-list .habit-item')).toHaveCount(2, { timeout: 10_000 });
    await page.waitForTimeout(800);
  }
  const bar = (page: Page) => page.evaluate(() => {
    const hdr = document.querySelector('header')!;
    const card = document.querySelector('.metric-card--rank')!;
    const track = card.querySelector('.metric-card-bar') as HTMLElement;
    const fill = document.getElementById('rank-bar')!;
    const cr = card.getBoundingClientRect(), tr = track.getBoundingClientRect();
    return {
      compact: hdr.classList.contains('header--compact'),
      headerH: hdr.offsetHeight,
      trackVisible: getComputedStyle(track).display !== 'none',
      trackH: Math.round(tr.height),
      flush: Math.round(cr.bottom - tr.bottom),
      widthPct: parseFloat(fill.style.width),
      caption: document.getElementById('rank-next')!.textContent,
    };
  });

  test('in the compact header the bar is visible, 3px, on the card’s bottom edge, and costs no height', async ({ page }) => {
    await hunterAt5(page);
    const b = await bar(page);
    expect(b.compact).toBe(true);
    expect(b.trackVisible).toBe(true);
    expect(b.trackH).toBe(3);
    expect(b.flush).toBeLessThanOrEqual(1);              // the card's 1px border
    expect(b.widthPct).toBeGreaterThan(10);              // 5 of the 33-XP first division
    // Zero layout cost: hide it and the header must not move.
    const hiddenH = await page.evaluate(() => {
      const t = document.querySelector('.metric-card--rank .metric-card-bar') as HTMLElement;
      t.style.display = 'none'; const h = document.querySelector('header')!.offsetHeight; t.style.display = ''; return h;
    });
    expect(hiddenH).toBe(b.headerH);
  });

  test('the bar and the caption name the same climb, and a seal moves both', async ({ page }) => {
    await hunterAt5(page);
    const before = await bar(page);
    expect(before.caption).toMatch(/to E II$/);
    await page.evaluate(() => {
      const w = window as any; w.__pulsed = false;
      const rf = document.getElementById('rank-bar')!;
      new MutationObserver(() => { if (rf.classList.contains('rank-fill--pulse')) w.__pulsed = true; })
        .observe(rf, { attributes: true, attributeFilter: ['class'] });
    });
    await page.locator('#habit-list .habit-item').first().click();
    await expect.poll(() => bar(page).then((x) => x.widthPct), { timeout: 5_000 }).toBeGreaterThan(before.widthPct);
    const after = await bar(page);
    const num = (c: string | null) => parseInt(String(c).replace(/[^0-9]/g, ''), 10);
    expect(num(after.caption)).toBeLessThan(num(before.caption));   // "28 to E II" -> "26 to E II"
    expect(await page.evaluate(() => (window as any).__pulsed)).toBe(true);
    expect(after.headerH).toBe(before.headerH);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AY. W965 — DIVISION UP: the mark lights, and it waits for you
// ─────────────────────────────────────────────────────────────────────────
test.describe('AY · Division up (W965)', () => {
  // D spans 100-599, so its three divisions are III 100-266, II 267-433,
  // I 434-599. Seeding 266 puts a custom vow's +1 (or +2 at the weekend)
  // across the II boundary either way.
  async function hunterAt(page: Page, points: number, seen?: string[]) {
    await freshApp(page);
    await page.addInitScript(([pts, seenList]) => {
      try {
        if (sessionStorage.getItem('__w965_seeded')) return;
        sessionStorage.setItem('__w965_seeded', '1');
        localStorage.setItem('hb_points', String(pts));
        // Without this the First Mark fires instead and folds the division
        // into its own summary — the 1z.275C behaviour this spec is not about.
        localStorage.setItem('hb_first_completion_bonus_v1', '1');
        localStorage.setItem('hb_bosses_engagement_migrated', '1');
        if (seenList && seenList.length) localStorage.setItem('hb_rank_div_seen_v1', JSON.stringify(seenList));
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen',
         'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        localStorage.setItem('hb_habits', JSON.stringify([
          { id: 'w965-a', name: 'First vow', emoji: '\u2022', difficulty: 'medium', type: 'build', custom: true, primaryStat: 'WILL' }]));
      } catch (_) {}
    }, [points, seen || []] as [number, string[]]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await expect(page.locator('#habit-list .habit-item')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(700);
  }
  const shown = (page: Page) => page.evaluate(() => !document.getElementById('divup-screen')!.classList.contains('hidden'));
  const read = (page: Page) => page.evaluate(() => {
    const s = document.getElementById('divup-screen')!;
    return {
      letter: s.querySelector('.L')!.textContent,
      numeral: s.querySelector('.N')!.textContent,
      lit: [].filter.call(s.querySelectorAll('.mk'), (m: any) => m.classList.contains('lit')).length,
      sub: s.querySelector('.sub')!.textContent,
      seen: localStorage.getItem('hb_rank_div_seen_v1'),
    };
  });

  test('crossing into II lights one mark — and the screen WAITS to be tapped', async ({ page }) => {
    await hunterAt(page, 266);
    await page.locator('#habit-list .habit-item').first().click();
    await expect.poll(() => shown(page), { timeout: 8_000 }).toBe(true);
    // The mark lights at t=1200 — until then the screen correctly still reads
    // III with nothing lit, so wait for the settled state rather than sleeping.
    await expect.poll(() => read(page).then((x) => x.numeral), { timeout: 20_000 }).toBe('II');
    const b = await read(page);
    expect(b.letter).toBe('D');
    expect(b.numeral).toBe('II');          // the numeral counts DOWN
    expect(b.lit).toBe(1);                 // lit marks + numeral strokes === 3
    expect(b.sub).toBe('TWO MARKS TO C');
    expect(String(b.seen)).toContain('D:II');
    // The Claude Design mock left on its own at 3.0s. The owner asked for tap
    // to continue, so it must still be here well past that.
    await page.waitForTimeout(4_200);
    expect(await shown(page)).toBe(true);
    await page.locator('#divup-screen').click();
    await expect.poll(() => shown(page), { timeout: 3_000 }).toBe(false);
  });

  test('the same boundary never fires twice', async ({ page }) => {
    // A W479 compound clawback can drop points back under a boundary that is
    // then re-crossed. The toast could repeat harmlessly; a held screen cannot.
    await hunterAt(page, 266, ['D:II']);
    await page.locator('#habit-list .habit-item').first().click();
    await page.waitForTimeout(2_500);
    expect(await shown(page)).toBe(false);
  });

  test('a whole letter shows the rank screen, never the division screen', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });   // skips the ACK prelude
    await hunterAt(page, 599);                              // W970: custom +1 clears 600 = C
    await page.locator('#habit-list .habit-item').first().click();
    await expect.poll(
      () => page.evaluate(() => !document.getElementById('rankup-screen')!.classList.contains('hidden')),
      { timeout: 10_000 },
    ).toBe(true);
    expect(await shown(page)).toBe(false);
  });

  test('with Reduce Motion the screen still lands, and nothing covers it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await hunterAt(page, 266);
    await page.locator('#habit-list .habit-item').first().click();
    await expect.poll(() => shown(page), { timeout: 8_000 }).toBe(true);
    // Settle: the fact line is the last thing to arrive (t=1650 + 280ms).
    // Settle on the LAST beat, not the second-to-last: the tap hint arrives at
    // t=1980 + 320ms, after the fact line at 1650. Polling .fact and then
    // asserting .tapc reads it mid-fade. Generous timeout because the beats are
    // setTimeout-driven — we are waiting on a real end state, not a deadline.
    await expect.poll(
      () => page.evaluate(() => getComputedStyle(document.querySelector('#divup-screen .tapc')!).opacity),
      { timeout: 20_000 },
    ).toBe('1');
    const probe = await page.evaluate(() => {
      const hit = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { covered: !(el === top || el.contains(top) || el.parentElement === top), opacity: getComputedStyle(el).opacity };
      };
      return { title: hit('#divup-screen .title'), sub: hit('#divup-screen .sub'), tapc: hit('#divup-screen .tapc') };
    });
    // Removed, not paused — a frozen half-frame is the W964 bug.
    expect(probe.title.opacity).toBe('1');
    expect(probe.sub.opacity).toBe('1');
    expect(probe.tapc.opacity).toBe('1');
    expect(probe.title.covered).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AZ. W966 — previewing the celebrations on a real phone
// ─────────────────────────────────────────────────────────────────────────
test.describe('AZ · Preview rank celebrations (W966)', () => {
  async function asRole(page: Page, role: string) {
    await freshApp(page);
    await page.addInitScript(([r]) => {
      try {
        if (sessionStorage.getItem('__w966_seeded')) return;
        sessionStorage.setItem('__w966_seeded', '1');
        localStorage.setItem('hb_points', '3400');                       // B rank
        localStorage.setItem('hb_board_cache_v1', JSON.stringify({ me: { role: r } }));
      } catch (_) {}
    }, [role]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }
  const div = (page: Page) => page.evaluate(() => {
    const s = document.getElementById('divup-screen')!;
    return {
      shown: !s.classList.contains('hidden'),
      L: s.querySelector('.L')!.textContent,
      N: s.querySelector('.N')!.textContent,
      lit: [].filter.call(s.querySelectorAll('.mk'), (m: any) => m.classList.contains('lit')).length,
    };
  });

  // The gate controls the `hidden` class (syncTestHunterRow, run by openSettings).
  // Assert that, not paint: the row sits in a settings group that may be
  // collapsed, so toBeVisible() could fail for a reason this feature does not own.
  const rowRevealed = (page: Page) => page.evaluate(
    () => !document.getElementById('settings-preview-celebrations')!.classList.contains('hidden'));

  test('the row is the owner\u2019s alone', async ({ page }) => {
    await asRole(page, 'owner');
    await page.locator('#settings-btn').click();
    await expect.poll(() => rowRevealed(page), { timeout: 6_000 }).toBe(true);
  });

  test('a non-owner never sees it', async ({ page }) => {
    await asRole(page, 'member');
    await page.locator('#settings-btn').click();
    await page.waitForTimeout(800);
    expect(await rowRevealed(page)).toBe(false);
  });

  test('it plays both marks in your own colour, and saves nothing', async ({ page }) => {
    await asRole(page, 'owner');
    await page.evaluate(() => (window as any).__previewRankCelebrations());
    await expect.poll(() => div(page).then((x) => x.N), { timeout: 20_000 }).toBe('II');
    expect((await div(page)).L).toBe('B');          // 3,400 XP is B rank
    expect((await div(page)).lit).toBe(1);
    await page.locator('#divup-screen').click();    // chains straight into the next
    await expect.poll(() => div(page).then((x) => x.N), { timeout: 20_000 }).toBe('I');
    expect((await div(page)).lit).toBe(2);
    await page.locator('#divup-screen').click();
    await expect.poll(() => div(page).then((x) => x.shown), { timeout: 5_000 }).toBe(false);
    // "nothing is saved" is the contract this row inherits from Replay the awakening.
    expect(await page.evaluate(() => localStorage.getItem('hb_rank_div_last_v1'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('hb_rank_div_seen_v1'))).toBeNull();
  });

  test('the stage still sees it after the flag window has expired', async ({ page }) => {
    // W965 registered no DOM surface, so the screen was covered only by the
    // levelUpActive FLAG — and flag-only busy expires after 6s. Tap-to-continue
    // makes the hold indefinite, so past 6s anything could have landed on top.
    await asRole(page, 'owner');
    await page.evaluate(() => (window as any).__showDivision('B', 1, 'A'));
    await expect.poll(() => div(page).then((x) => x.shown), { timeout: 10_000 }).toBe(true);
    await page.waitForTimeout(7_000);
    expect((await div(page)).shown).toBe(true);
    expect(await page.evaluate(() => (window as any).__stage.busy())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BA. W969 — the developer / moderator crown rides the name everywhere
// ─────────────────────────────────────────────────────────────────────────
test.describe('BA · The crown is part of the name (W969)', () => {
  async function withRoster(page: Page) {
    await freshApp(page);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_crown_roster_v1', JSON.stringify({ at: Date.now(),
          list: [{ alias: 'Richie', role: 'owner' }, { alias: 'RenDIESEL', role: 'mod' }] }));
        localStorage.setItem('hb_worldgate_v1', JSON.stringify({ at: Date.now(), week: '2026-09-20', hp: 200000, pool: 91000,
          status: 'active', my: 12000, floor: 15000, souls: 200, claimable: false, claimed: false, hunters: 9,
          guild: { steps: 0, hunters: 0 }, my_rank: 3,
          top: [{ alias: 'RenDIESEL', steps: 30112, rank_tier: 'A' }, { alias: 'Zynfandel', steps: 18220, rank_tier: 'D' }],
          wall: [{ alias: 'RenDIESEL' }, { alias: 'Zynfandel' }], wall_count: 2, recent: [], rallied: false }));
      } catch (_) {}
    });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }

  test('the roster decides who wears it — case-insensitive, and nobody else', async ({ page }) => {
    await withRoster(page);
    const r = await page.evaluate(() => {
      const f = (window as any).__crownFor;
      return { owner: f('Richie'), mod: f('rendiesel'), other: f('Zynfandel'), blank: f('') };
    });
    expect(r.owner).toContain('title="Developer"');
    expect(r.mod).toContain('title="Moderator"');
    expect(r.other).toBe('');
    expect(r.blank).toBe('');
  });

  test('it sits inside the name on a list that never carried a role', async ({ page }) => {
    await withRoster(page);
    await page.evaluate(() => document.getElementById('wg-pulse')!.click());
    await page.evaluate(() => { const t = document.querySelector('[data-wg-tab="rank"]') as HTMLElement; if (t) t.click(); });
    await expect(page.locator('.wg2-pane .wg2-nmbtn').first()).toBeVisible({ timeout: 8_000 });
    const rows = await page.evaluate(() => [].map.call(document.querySelectorAll('.wg2-pane .wg2-nmbtn'),
      (n: any) => ({ name: n.textContent.trim(), crown: !!n.querySelector('.name-crown') })));
    expect(rows).toContainEqual({ name: 'RenDIESEL', crown: true });
    expect(rows).toContainEqual({ name: 'Zynfandel', crown: false });
  });

  test('it sits on the letters: bottom on the baseline, top at cap height', async ({ page }) => {
    // W969b — the owner saw it riding low. Pin it to the glyphs, not the line box.
    await withRoster(page);
    await page.evaluate(() => document.getElementById('wg-pulse')!.click());
    await page.evaluate(() => { const t = document.querySelector('[data-wg-tab="rank"]') as HTMLElement; if (t) t.click(); });
    await expect(page.locator('.wg2-pane .name-crown').first()).toBeVisible({ timeout: 8_000 });
    const m = await page.evaluate(() => {
      const btn = document.querySelector('.wg2-pane .wg2-nmbtn .name-crown')!.parentElement as HTMLElement;
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      btn.insertBefore(probe, btn.querySelector('.name-crown'));
      const base = probe.getBoundingClientRect().top; probe.remove();
      const svg = btn.querySelector('.name-crown svg')!.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(btn).fontSize);
      return { bottomVsBase: svg.bottom - base, heightEm: svg.height / fs };
    });
    expect(Math.abs(m.bottomVsBase)).toBeLessThanOrEqual(1);
    expect(m.heightEm).toBeGreaterThan(0.6);
    expect(m.heightEm).toBeLessThan(0.85);
  });

  test('the player card no longer carries a crown of its own', async ({ page }) => {
    // Owner: "no M crown on our player card … anywhere else would be redundant."
    await withRoster(page);
    const n = await page.evaluate(() => document.querySelectorAll('.pc-crown, .board-av-crown').length);
    expect(n).toBe(0);
  });

  test('W972: the Hunter Profile name on Status wears it — keyed on the signed-in account', async ({ page }) => {
    // The local stub signs in as "DevUser"; on the owner's phone that account is Richie.
    await withRoster(page);
    const crownAfter = async (list: any[]) => {
      await page.addInitScript((l) => { try { localStorage.setItem('hb_crown_roster_v1', JSON.stringify({ at: Date.now(), list: l })); } catch (_) {} }, list);   // runs after withRoster's seed
      await page.reload();
      await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
      await page.locator('#tab-profile').click();
      await expect(page.locator('#sc-name-val')).toBeVisible({ timeout: 8_000 });
      return page.evaluate(() => !!document.querySelector('#sc-name-val .name-crown'));
    };
    expect(await crownAfter([{ alias: 'devuser', role: 'owner' }])).toBe(true);
    expect(await crownAfter([{ alias: 'RenDIESEL', role: 'mod' }])).toBe(false);
  });

  test('W972: a Community post and reply author wears it; others do not', async ({ page }) => {
    await withRoster(page);
    const r = await page.evaluate(() => {
      const who = (window as any).__board.who;
      const el = document.createElement('div');
      el.innerHTML = who({ alias: 'RenDIESEL', rank_label: 'S' }, { created_at: Date.now() }, {}) +
                     who({ alias: 'Grubbadub', rank_label: 'C' }, { created_at: Date.now() }, { sub: true });
      return [].map.call(el.querySelectorAll('.board-name'), (b: any) => ({ name: b.textContent.trim(), crown: !!b.querySelector('.name-crown') }));
    });
    expect(r).toEqual([{ name: 'RenDIESEL', crown: true }, { name: 'Grubbadub', crown: false }]);
  });

  test('the cache holds names and roles only — never an account id', async ({ page }) => {
    await freshApp(page);
    await page.route('**/v1/board/moderators', (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ moderators: [{ user_id: 'u-secret-1', alias: 'Richie', role: 'owner', granted_at: 1 }] }) }));
    const stored = await page.evaluate(async () => {
      const A = (window as any).Auth;
      A.boardModerators = async () => ({ ok: true, moderators: [{ user_id: 'u-secret-1', alias: 'Richie', role: 'owner', granted_at: 1 }] });
      await (window as any).__crownRosterSync(true);
      return localStorage.getItem('hb_crown_roster_v1');
    });
    expect(stored).toContain('Richie');
    expect(stored).not.toContain('u-secret-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BB. W970 — vows are yours to tick; recognition is verified by Apple Health
// ─────────────────────────────────────────────────────────────────────────
test.describe('BB · Vows are yours, recognition is verified (W970)', () => {
  const ymd = (off: number) => {
    const d = new Date(); d.setDate(d.getDate() - off);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  async function seed(page: Page, habitsJson: any[], extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript(([hs, ex]) => {
      try {
        if (sessionStorage.getItem('__w970')) return;
        sessionStorage.setItem('__w970', '1');
        localStorage.setItem('hb_first_completion_bonus_v1', '1');
        localStorage.setItem('hb_bosses_engagement_migrated', '1');
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen',
         'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1', 'hb_healthkit_prompted'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        localStorage.setItem('hb_habits', JSON.stringify(hs));
        Object.keys(ex || {}).forEach((k) => localStorage.setItem(k, (ex as any)[k]));
      } catch (_) {}
    }, [habitsJson, extra || {}] as [any[], Record<string, string>]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }
  // Apple Health granted, with whatever numbers the test wants.
  async function health(page: Page, o: { steps?: number; workoutMin?: number; sleepH?: number }) {
    await page.evaluate((o) => {
      const H = (window as any).Health;
      H.isAvailable = () => true;
      H.permissionStatus = () => 'granted';
      H.getStepsToday = async () => o.steps || 0;
      const w = o.workoutMin ? { count: 1, totalMinutes: o.workoutMin, workouts: [] } : null;
      H.getAnyWorkoutsToday = async () => w;
      H.getStrengthWorkoutsToday = async () => w;
      H.getSleepLastNight = async () => (o.sleepH ? { totalAsleepHours: o.sleepH, bedtimeBeforeMidnight: true, sessionEndsToday: true } : null);
    }, o);
  }
  const WALK = { id: 'w970-walk', name: 'Daily walk', emoji: '\u2022', difficulty: 'easy', type: 'build', stepGoal: 8000, primaryStat: 'VIT' };
  const WORKOUT = { id: 'w970-wo', name: 'Workout', emoji: '\u2022', difficulty: 'hard', type: 'build', primaryStat: 'STR' };
  const doneToday = (page: Page, id: string) => page.evaluate((id) => {
    const c = JSON.parse(localStorage.getItem('hb_completions') || '{}');
    return Object.keys(c).some((d) => Array.isArray(c[d]) && c[d].includes(id));
  }, id);

  test('Daily walk is a tap vow: it seals on a tap, with no Apple Health chrome', async ({ page }) => {
    await seed(page, [WALK]);
    await page.locator('#tab-habits').click();
    const row = page.locator('#habit-list .habit-item').first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    const txt = await row.innerText();
    expect(txt).not.toContain('Apple Health');
    expect(txt).not.toMatch(/\/\s*8,000 steps/);
    await row.click();
    await expect.poll(() => doneToday(page, 'w970-walk'), { timeout: 6_000 }).toBe(true);
    expect(await page.evaluate(() => {
      const m = document.getElementById('note-modal'); return !!m && !m.classList.contains('hidden');
    })).toBe(false);
  });

  test('Apple Health never seals a vow \u2014 12,000 real steps leave Daily walk for the hunter', async ({ page }) => {
    await seed(page, [WALK]);
    await health(page, { steps: 12000 });
    await page.evaluate(async () => { await (window as any).autoVerifyWalk(); });
    await page.waitForTimeout(800);
    expect(await doneToday(page, 'w970-walk')).toBe(false);
  });

  test('a real Apple Health workout posts to friends; a ticked Workout vow never does', async ({ page }) => {
    // Tick the vow with NO Health workout: nothing may queue.
    await seed(page, [WORKOUT]);
    await health(page, {});
    await page.locator('#tab-habits').click();
    await page.locator('#habit-list .habit-item').first().click();
    await expect.poll(() => doneToday(page, 'w970-wo'), { timeout: 6_000 }).toBe(true);
    await page.evaluate(async () => { await (window as any).autoVerifyStrengthTraining(); });
    expect((await page.evaluate(() => (window as any).__paeQueuePeek())).join(' ')).not.toContain('verified_workout');
    // Now a genuine 45-minute Apple Health workout: it posts, once.
    await health(page, { workoutMin: 45 });
    await page.evaluate(async () => { await (window as any).autoVerifyStrengthTraining(); await (window as any).autoVerifyStrengthTraining(); });
    const q = await page.evaluate(() => (window as any).__paeQueuePeek());
    expect(q.filter((x: string) => x.indexOf('verified_workout') === 0).length).toBe(1);
  });

  test('the workout streak board counts Apple Health days, never taps', async ({ page }) => {
    // Three consecutive verified days in workout_daily, and NO Workout vow at all.
    await seed(page, [], { hb_leaderboard: JSON.stringify({ workout_daily: { [ymd(1)]: 40, [ymd(2)]: 35, [ymd(3)]: 31 } }) });
    const a = await page.evaluate(() => (window as any).__verifiedStreaks().workout);
    expect(a.current).toBe(3);
    expect(a.workoutHabitId).toBeNull();
  });

  test('Workout vow days ticked after the change never feed the board', async ({ page }) => {
    const comp = { [ymd(1)]: ['w970-wo'], [ymd(2)]: ['w970-wo'], [ymd(3)]: ['w970-wo'] };
    await seed(page, [WORKOUT], { hb_completions: JSON.stringify(comp), hb_health_seal_cutover_v1: '2000-01-01' });
    expect((await page.evaluate(() => (window as any).__verifiedStreaks().workout)).current).toBe(0);
  });

  test('Workout days from before the change stay — they were Health-sealed', async ({ page }) => {
    const comp = { [ymd(1)]: ['w970-wo'], [ymd(2)]: ['w970-wo'], [ymd(3)]: ['w970-wo'] };
    await seed(page, [WORKOUT], { hb_completions: JSON.stringify(comp), hb_health_seal_cutover_v1: '2999-01-01' });
    expect((await page.evaluate(() => (window as any).__verifiedStreaks().workout)).current).toBe(3);
  });

  test('custom vows: no 5-vow limit, no difficulty picker, always +1 XP', async ({ page }) => {
    const customs = Array.from({ length: 6 }, (_, i) => ({ id: 'c' + i, name: 'Mine ' + i, emoji: '\u2022',
      difficulty: i === 0 ? 'hard' : 'medium', type: 'build', custom: true, primaryStat: 'WILL' }));
    await seed(page, customs, { hb_points: '400' });
    const r = await page.evaluate(() => {
      const hs = JSON.parse(localStorage.getItem('hb_habits') || '[]');
      return { diffs: hs.map((h: any) => h.difficulty), xp: localStorage.getItem('hb_points'),
               picker: !!document.getElementById('custom-diff-row') };
    });
    expect(r.diffs.every((d: string) => d === 'easy')).toBe(true);   // migrated
    expect(r.xp).toBe('400');                                        // nothing taken back
    expect(r.picker).toBe(false);
    await page.evaluate(() => { try { (window as any).renderLibrary && (window as any).renderLibrary(); } catch (_) {} });
    const createTxt = await page.evaluate(() => { const el = document.getElementById('lib-create-row'); return el ? el.textContent : ''; });
    if (createTxt) { expect(createTxt).not.toMatch(/LEFT|FULL/); }
  });

  test('a Perfect Day celebrates but never posts to the friends feed', async ({ page }) => {
    await seed(page, [WALK]);
    await page.evaluate(() => { try { (window as any).__pday(7, 30); } catch (_) {} });
    await page.waitForTimeout(600);
    const q = await page.evaluate(() => (window as any).__paeQueuePeek());
    expect(q.join(' ')).not.toContain('perfect_day');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BC. W971 — a Morning Routine you can finish (new hunters only)
// ─────────────────────────────────────────────────────────────────────────
test.describe('BC · A morning you can finish (W971)', () => {
  const V1 = ['Sleep', 'Wake up at consistent time', 'No phone or social media after waking', 'Get morning sunlight',
    'Morning gratitude practice', 'Daily walk', 'Vitamins and minerals', 'Meditate & Breathwork', 'Workout', 'Whole foods diet'];
  const V2 = ['Wake up at consistent time', 'Hydrate', 'No phone or social media after waking', 'Get morning sunlight',
    'Meditate & Breathwork', 'Morning gratitude practice'];
  async function seed(page: Page, names: string[], extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript(([ns, ex]) => {
      try {
        if (sessionStorage.getItem('__w971')) return;
        sessionStorage.setItem('__w971', '1');
        localStorage.removeItem('hb_mr_version');
        localStorage.setItem('hb_habits', JSON.stringify(ns.map((n: string, i: number) =>
          ({ id: 'w971-' + i, name: n, emoji: '\u2022', difficulty: 'easy', type: 'build', primaryStat: 'VIT' }))));
        Object.keys(ex || {}).forEach((k) => localStorage.setItem(k, (ex as any)[k]));
      } catch (_) {}
    }, [names, extra || {}] as [string[], Record<string, string>]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }

  test('a hunter already on the ten keeps the ten, and Locked-In stays at sixteen', async ({ page }) => {
    await seed(page, V1, { hb_path: 'morning' });
    const r = await page.evaluate(() => (window as any).__morningPack());
    expect(r.version).toBe('v1');
    expect(r.morning).toEqual(V1);
    expect(r.lockedIn.length).toBe(16);
    expect(await page.evaluate(() => localStorage.getItem('hb_mr_version'))).toBe('v1');
  });

  test('a new hunter gets the six-step morning; the all-day habits live in Locked-In', async ({ page }) => {
    await seed(page, ['Journal']);
    const r = await page.evaluate(() => (window as any).__morningPack());
    expect(r.version).toBe('v2');
    expect(r.morning).toEqual(V2);
    expect(r.lockedIn.length).toBe(17);
    for (const n of ['Sleep', 'Daily walk', 'Workout', 'Whole foods diet', 'Vitamins and minerals']) {
      expect(r.morning).not.toContain(n);
      expect(r.lockedIn).toContain(n);
    }
  });

  test('an empty list never stamps a version, so a reinstall waits for its restore', async ({ page }) => {
    await seed(page, []);
    const r = await page.evaluate(() => ({ v: (window as any).__morningPack().version, stamp: localStorage.getItem('hb_mr_version') }));
    expect(r.v).toBe('v2');
    expect(r.stamp).toBeNull();
  });

  test('a stamped v1 survives trimming the list', async ({ page }) => {
    await seed(page, ['Sleep', 'Hydrate'], { hb_mr_version: 'v1' });
    expect((await page.evaluate(() => (window as any).__morningPack())).morning).toEqual(V1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BD. W973 — UPDATES: the developers' weekly voice on the Community board
// ─────────────────────────────────────────────────────────────────────────
test.describe('BD · Updates on the board (W973)', () => {
  async function boardWith(page: Page, role: string | null) {
    await freshApp(page);
    await page.click('#tab-social');
    await expect(page.locator('#board-body')).toContainText(/No topics yet|Sign in with Apple|Could not load/i, { timeout: 10_000 });
    await page.evaluate((r) => {
      const now = Date.now();
      const au = { author_id: 'u-me', alias: 'Richie', rank_label: 'S', founder_seq: 0, is_mod: true, mod_role: 'owner' };
      (window as any).Auth.boardTopics = async () => ({
        ok: true, next_cursor: null, counts: { all: 2, improvement: 0, bug: 0, talk: 1, update: 1 },
        me: { consented: true, muted_until: null, role: r, rules_version: 99, rank_tier: 'S', topic_min_tier: 'E', reply_min_tier: 'E' },
        topics: [
          { id: 'upd-1', tag: 'update', title: 'Week of Sep 21', preview: 'Your vows are yours now.', created_at: now - 3600000, last_activity_at: now - 3600000, reply_count: 0, up_count: 0, voted: false, pinned: true, locked: false, repliers: [], last_reply: null, author: au },
          { id: 'tlk-1', tag: 'talk', title: 'First post', preview: 'Hope you all enjoy', created_at: now - 86400000, last_activity_at: now - 86400000, reply_count: 0, up_count: 0, voted: false, pinned: false, locked: false, repliers: [], last_reply: null, author: au },
        ],
      });
      (window as any).__board.render();
    }, role);
    await expect(page.locator('#board-body .board-topic')).toHaveCount(2);
  }

  test('UPDATES sits right after ALL, and an update row wears the UPDATE tag', async ({ page }) => {
    await boardWith(page, null);
    const chips = await page.evaluate(() => [].map.call(document.querySelectorAll('[data-board-filters] .board-f'), (b: any) => b.getAttribute('data-board-tag')));
    expect(chips.slice(0, 5)).toEqual(['', 'update', 'improvement', 'bug', 'talk']);
    await expect(page.locator('#board-body .board-topic').first().locator('.board-tag--update')).toHaveText('UPDATE');
  });

  test('only the owner and moderators can pick UPDATE when opening a topic', async ({ page }) => {
    await boardWith(page, null);
    await page.evaluate(() => (window as any).__board.compose('topic'));
    await expect(page.locator('.board-compose .board-catb')).toHaveCount(3);
    await expect(page.locator('[data-board-pick="update"]')).toHaveCount(0);
  });

  test('a moderator picks UPDATE and gets a "Week of" title to start from', async ({ page }) => {
    await boardWith(page, 'mod');
    await page.evaluate(() => (window as any).__board.compose('topic'));
    await expect(page.locator('[data-board-pick="update"]')).toHaveCount(1);
    await page.locator('[data-board-pick="update"]').click();
    await expect(page.locator('.board-compose input[name="title"]')).toHaveValue(/^Week of [A-Z][a-z]{2} \d{1,2}$/);
    await page.locator('[data-board-pick="talk"]').click();
    await expect(page.locator('.board-compose input[name="title"]')).toHaveValue('');
  });

  test('a new update keeps a dot on the Community tab until that update is opened', async ({ page }) => {
    await boardWith(page, null);
    await page.click('#tab-habits');
    await page.evaluate(() => (window as any).__cm.unseen({ board: { topics: 0, replies: 0 }, likes: 0, update: { id: 'upd-1', created_at: Date.now() } }));
    const badge = page.locator('#tab-social-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveClass(/tab-badge--dot/);
    // Tapping the tab is not enough — the dot waits for the update itself.
    await page.click('#tab-social');
    await expect(badge).toBeVisible();
    await expect(page.locator('[data-board-filters] .board-f--update .board-f-new')).toHaveCount(1);
    await page.evaluate(() => (window as any).__board.open('upd-1'));
    await expect(badge).toBeHidden();
    await expect(page.locator('[data-board-filters] .board-f--update .board-f-new')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('hb_board_update_seen'))).toBe('upd-1');
    // Next week's update brings the dot back.
    await page.evaluate(() => (window as any).__cm.unseen({ board: { topics: 0, replies: 0 }, likes: 0, update: { id: 'upd-2', created_at: Date.now() } }));
    await expect(badge).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BE. W974 — RATING MOMENTS (Claude Design handoff 28): five one-time cards
// ─────────────────────────────────────────────────────────────────────────
test.describe('BE · Rating moments (W974)', () => {
  // The app's `today` is PACIFIC (getPTDate). CI runs in UTC, so between 5 PM PST
  // and midnight a local-date seed sits a day ahead and the week never closes.
  const ymd = (off: number) => new Date(Date.now() - off * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function seed(page: Page, extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript(([ex]) => {
      try {
        if (sessionStorage.getItem('__w974')) return;
        sessionStorage.setItem('__w974', '1');
        localStorage.setItem('hb_first_completion_bonus_v1', '1');
        localStorage.setItem('hb_bosses_engagement_migrated', '1');
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen',
         'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1', 'hb_healthkit_prompted'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');   // not a first-day hunter
        Object.keys(ex || {}).forEach((k) => localStorage.setItem(k, (ex as any)[k]));
      } catch (_) {}
    }, [extra || {}] as [Record<string, string>]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }
  const card = (page: Page) => page.evaluate(() => {
    const o = document.getElementById('review-pp-overlay');
    if (!o) return null;
    const q = (s: string) => (o.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
    return { eyebrow: q('.rm-eyebrow'), title: q('.rm-title'), stat: q('.rm-stat'), cta: q('.rm-cta'), later: q('.rm-later'),
             foot: q('.rm-foot'), buttons: o.querySelectorAll('button').length, text: (o.textContent || '').replace(/\s+/g, ' ') };
  });
  const WEEK = () => {
    const c: Record<string, string[]> = {};
    for (let i = 0; i < 7; i++) c[ymd(i)] = ['w974-a', 'w974-b'];
    return { hb_habits: JSON.stringify([{ id: 'w974-a', name: 'Read', emoji: '•', difficulty: 'easy', type: 'build' },
                                        { id: 'w974-b', name: 'Journal', emoji: '•', difficulty: 'easy', type: 'build' }]),
             hb_completions: JSON.stringify(c) };
  };

  test('each of the five cards: its own words, exactly two buttons, and nothing offered for a rating', async ({ page }) => {
    await seed(page);
    const expectOf: Record<string, [string, RegExp]> = {
      week: ['FIRST WEEK KEPT', /7 days kept\. ?Not one missed\./], perfect: ['THREE PERFECT DAYS', /3 perfect days\. ?Every vow sealed\./],
      boss: ['FIRST BOSS DEFEATED', /The Steel Wolf ?has fallen\./], rank: ['RANK ASCENDED', /You climbed ?to C II\./],
      coop: ['FIRST CO-OP WIN', /The Twin Maw ?is cleared\./],
    };
    for (const m of Object.keys(expectOf)) {
      await page.evaluate((mm) => (window as any).__reviewPreview(mm), m);
      const c = (await card(page))!;
      expect(c.eyebrow.toUpperCase()).toBe(expectOf[m][0]);
      expect(c.title).toMatch(expectOf[m][1]);
      expect(c.buttons).toBe(2);
      expect(c.cta).toBe('Write a review');
      expect(c.later).toBe('Not now');
      expect(c.foot).toBe('Opens the App Store');
      expect(c.text).not.toMatch(/\bsouls?\b|\bXP\b|reward|gift|free|★|stars?\b/i);   // Apple 1.1.7
      expect(c.text).not.toMatch(/\bfell(ed)?\b/i);   // banned copy word (standing rule)
    }
  });

  test('first week kept: seven sealed days bring the card once, with the real numbers', async ({ page }) => {
    await seed(page, WEEK());
    await page.evaluate(() => (window as any).__rm.checkWeek());
    await expect.poll(() => card(page).then((c) => c && c.eyebrow.toUpperCase()), { timeout: 8_000 }).toBe('FIRST WEEK KEPT');
    expect((await card(page))!.stat).toMatch(/^14 vows kept · 7-day streak$/i);
    expect(await page.evaluate(() => (window as any).__rm.shown())).toEqual(['week']);
    await page.locator('#review-pp-overlay .rm-later').click();
    await expect.poll(() => card(page), { timeout: 3_000 }).toBeNull();
    // Once, ever — even with the cooldowns cleared.
    await page.evaluate(() => { localStorage.removeItem('hb_review_notnow_at'); localStorage.removeItem('hb_review_shown_at'); (window as any).__rm.checkWeek(); });
    await page.waitForTimeout(2_000);
    expect(await card(page)).toBeNull();
  });

  test('six days is not a week', async ({ page }) => {
    const w = WEEK(); const c = JSON.parse(w.hb_completions); delete c[ymd(3)];
    await seed(page, { ...w, hb_completions: JSON.stringify(c) });
    await page.evaluate(() => (window as any).__rm.checkWeek());
    await page.waitForTimeout(2_000);
    expect(await card(page)).toBeNull();
  });

  test('Write a review opens the App Store composer and spends one ask', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => { (window as any).__opened = []; window.open = ((u: string) => { (window as any).__opened.push(u); return null; }) as any; });
    await page.evaluate(() => (window as any).__rm.maybe('boss', { bossName: 'The Insomniac', bossRank: 'C' }));
    await expect.poll(() => card(page).then((c) => c && c.title), { timeout: 5_000 }).toMatch(/The Insomniac/);
    expect((await card(page))!.stat).toMatch(/^C-rank boss · first kill$/i);
    await page.locator('#review-pp-overlay .rm-cta').click();
    await expect.poll(() => page.evaluate(() => (window as any).__opened), { timeout: 4_000 }).toEqual(['https://apps.apple.com/app/id6764727990?action=write-review']);
    await expect.poll(() => card(page), { timeout: 3_000 }).toBeNull();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_review_asks_v2') || '[]').length)).toBe(1);
    // 30 days between asks: the next moment waits.
    expect(await page.evaluate(() => (window as any).__rm.eligible('coop'))).toBe(false);
  });

  test('Not now leaves the ask budget alone and starts the 30-day cooldown', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => (window as any).__rm.maybe('coop', { dungeonName: 'The Twin Maw', partySize: 2 }));
    await expect.poll(() => card(page).then((c) => c && c.eyebrow.toUpperCase()), { timeout: 5_000 }).toBe('FIRST CO-OP WIN');
    await page.locator('#review-pp-overlay .rm-later').click();
    await expect.poll(() => card(page), { timeout: 3_000 }).toBeNull();
    const r = await page.evaluate(() => ({ asks: JSON.parse(localStorage.getItem('hb_review_asks_v2') || '[]').length,
      notNow: Number(localStorage.getItem('hb_review_notnow_at') || 0), perfect: (window as any).__rm.eligible('perfect') }));
    expect(r.asks).toBe(0);
    expect(r.notNow).toBeGreaterThan(0);
    expect(r.perfect).toBe(false);
  });

  test('never on a new hunter’s first day', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => {
      const d = new Date(); const t = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      localStorage.setItem('hb_onboarding_first_xp_date', t);
      (window as any).__rm.maybe('boss', { bossName: 'The Steel Wolf', bossRank: 'D' });
    });
    await page.waitForTimeout(1_500);
    expect(await card(page)).toBeNull();
    expect(await page.evaluate(() => (window as any).__rm.shown())).toEqual([]);   // not spent — it can come later
  });

  test('the old card and its summit / mythic moments are gone', async ({ page }) => {
    await seed(page);
    const r = await page.evaluate(() => ({ summit: (window as any).__rm.eligible('summit'), mythic: (window as any).__rm.eligible('mythic'),
      oldCss: [].some.call(document.styleSheets, (ss: any) => { try { return [].some.call(ss.cssRules, (x: any) => /\.review-pp-card/.test(x.cssText || '')); } catch (_) { return false; } }) }));
    expect(r).toEqual({ summit: false, mythic: false, oldCss: false });
  });

  test('the owner’s Settings row previews all five in order, opening and saving nothing', async ({ page }) => {
    await seed(page, { hb_board_cache_v1: JSON.stringify({ me: { role: 'owner' } }) });
    await page.locator('#settings-btn').click();
    await expect.poll(() => page.evaluate(() => !document.getElementById('settings-preview-rating')!.classList.contains('hidden')), { timeout: 6_000 }).toBe(true);
    await page.evaluate(() => { (window as any).__opened = []; window.open = ((u: string) => { (window as any).__opened.push(u); return null; }) as any; (window as any).__previewRatingMoments(); });
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await expect.poll(() => card(page).then((c) => (c ? c.eyebrow.toUpperCase() : null)), { timeout: 6_000 }).not.toBe(i ? seen[i - 1] : null);
      await expect.poll(() => card(page).then((c) => (c ? c.eyebrow.toUpperCase() : null)), { timeout: 6_000 }).not.toBeNull();
      seen.push((await card(page))!.eyebrow.toUpperCase());
      await page.locator('#review-pp-overlay ' + (i % 2 ? '.rm-later' : '.rm-cta')).click();
      await expect.poll(() => card(page).then((c) => (c ? c.eyebrow.toUpperCase() : null)), { timeout: 4_000 }).not.toBe(seen[i]);
    }
    expect(seen).toEqual(['FIRST WEEK KEPT', 'THREE PERFECT DAYS', 'FIRST BOSS DEFEATED', 'RANK ASCENDED', 'FIRST CO-OP WIN']);
    const r = await page.evaluate(() => ({ opened: (window as any).__opened, asks: localStorage.getItem('hb_review_asks_v2'), notNow: localStorage.getItem('hb_review_notnow_at'), shown: localStorage.getItem('hb_rm_shown_v1') }));
    expect(r.opened).toEqual([]);
    expect(r.notNow).toBeNull();
    expect(r.shown).toBeNull();
    expect(JSON.parse(r.asks || '[]')).toEqual([]);
  });

  test('a non-owner never sees the preview row', async ({ page }) => {
    await seed(page, { hb_board_cache_v1: JSON.stringify({ me: { role: 'member' } }) });
    await page.locator('#settings-btn').click();
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => document.getElementById('settings-preview-rating')!.classList.contains('hidden'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BF. W975 — WORLDGATE MVPs (Claude Design handoff 29): replaces the W964 ceremony
// ─────────────────────────────────────────────────────────────────────────
test.describe('BF · Worldgate MVPs (W975)', () => {
  // W985 — the sheet says the Worldgate is weekly, and when the next boss rises.
  test('the sheet tells every hunter a new boss rises each Sunday, and when', async ({ page }) => {
    await seed(page, { kill: KILL() });   // this week's gate (2026-09-20) is down
    await page.evaluate(() => document.getElementById('wg-pulse')!.click());
    await expect(page.locator('.wg2-next')).toBeVisible({ timeout: 8_000 });
    const t = await page.locator('.wg2-next').innerText();
    expect(t).toMatch(/new Worldgate boss rises every Sunday/i);
    expect(t).toMatch(/Next: Sun 27 Sep/);
    expect(t).not.toMatch(/\bfell(ed)?\b/i);
    // W1003 — a fallen gate says the number stopped on purpose (W983 freezes damage at the kill)
    await expect(page.locator('.wg2-you .wg2-frozen')).toHaveText(/Step count frozen at the kill/);
  });

  const KILL = (over?: Record<string, unknown>) => ({
    week: '2026-09-20', slain_at: Date.UTC(2026, 8, 24, 18), pool: 1284000, hunters: 41,
    mvps: [{ alias: 'Anthony', rank_tier: 'C', steps: 28018 }, { alias: 'Ryan', rank_tier: 'E', steps: 24550 }, { alias: 'Zynfandel', rank_tier: 'D', steps: 21907 }],
    my_place: 0, my_steps: 4472, my_pos: 7, mvp_bonus: [150, 100, 50], ...(over || {}),
  });
  async function seed(page: Page, gate: Record<string, unknown>, extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript(([g, ex]) => {
      try {
        if (sessionStorage.getItem('__w975')) return;
        sessionStorage.setItem('__w975', '1');
        localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_worldgate_v1', JSON.stringify(Object.assign({ at: Date.now(), week: '2026-09-20', hp: 1200000, pool: 1290000, status: 'slain', my: 4472, floor: 15000, souls: 200,
          claimable: false, claimed: false, hunters: 41, guild: { steps: 0, hunters: 0 }, my_rank: 7,
          top: [{ alias: 'Zynfandel', steps: 30100, rank_tier: 'D' }, { alias: 'Mara', steps: 29000, rank_tier: 'C' }, { alias: 'Anthony', steps: 28018, rank_tier: 'C' }, { alias: 'Ryan', steps: 24550, rank_tier: 'E' }, { alias: 'Galilea', steps: 8848, rank_tier: 'B' }],
          wall: [], wall_count: 4, recent: [], rallied: false, kill: null }, g)));
        // '@today' = the BROWSER's local day (CI runs UTC, the dev PC runs Pacific — the 5 PM PST trap).
        const d = new Date(); const td = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        Object.keys(ex || {}).forEach((k) => localStorage.setItem(k, (ex as any)[k] === '@today' ? td : (ex as any)[k]));
      } catch (_) {}
    }, [gate, extra || {}] as [Record<string, unknown>, Record<string, string>]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }
  const card = (page: Page) => page.evaluate(() => {
    const s = document.getElementById('wgmvp-screen'); if (!s) return null;
    const t = (sel: string) => (s.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
    const cols = [].map.call(s.querySelectorAll('.wgm-col'), (c: any) => ({ cls: c.className, nm: (c.querySelector('.wgm-nm')?.textContent || '').trim(),
      you: !!c.querySelector('.wgm-youtag'), bonus: (c.querySelector('.wgm-bonus')?.textContent || '').replace(/\s+/g, ' ').trim(), landed: c.classList.contains('wgm-land') }));
    return { eyebrow: t('.wgm-eyebrow'), boss: t('.wgm-boss'), coll: t('.wgm-coll'), fell: t('.wgm-fell'), cols,
      mine: [].map.call(s.querySelectorAll('.wgm-mine'), (m: any) => m.textContent.replace(/\s+/g, ' ').trim()), buttons: s.querySelectorAll('button').length };
  });

  test('the everyone card: the fallen boss, the whole server, and the podium in 2 · 1 · 3 order', async ({ page }) => {
    await seed(page, { kill: KILL() });
    await page.evaluate(() => (window as any).__wgm.maybe());
    await expect.poll(() => card(page).then((c) => c && c.eyebrow.toUpperCase()), { timeout: 6_000 }).toBe('THE WORLDGATE HAS FALLEN');
    await page.locator('#wgmvp-screen').click();   // first tap: straight to the final frame
    const c = (await card(page))!;
    expect(c.buttons).toBe(0);                      // tap to continue — no buttons, no X
    expect(c.coll.toUpperCase()).toBe('41 HUNTERS · 1,284,000 STEPS');
    expect(c.fell.toUpperCase()).toMatch(/^BROKEN (SUN|MON|TUE|WED|THU|FRI|SAT) \d{1,2} SEP$/);
    expect([c.eyebrow, c.boss, c.coll, c.fell].concat(c.mine).join(' ')).not.toMatch(/\bfell(ed)?\b/i);   // banned copy word (standing rule)
    expect(c.cols.map((x) => x.nm)).toEqual(['Ryan', 'Anthony', 'Zynfandel']);   // 2nd · 1st · 3rd
    expect(c.cols.every((x) => x.landed && !x.you)).toBe(true);
    expect(c.mine).toEqual(['Your strikes · 4,472 · #7']);
    expect(await page.evaluate(() => localStorage.getItem('hb_wgmvp_seen_v1'))).toBe('2026-09-20');
    await page.locator('#wgmvp-screen').click();   // second tap: leave
    await expect.poll(() => card(page), { timeout: 3_000 }).toBeNull();
    // Once per kill.
    await page.evaluate(() => (window as any).__wgm.maybe());
    await page.waitForTimeout(800);
    expect(await card(page)).toBeNull();
  });

  test('an MVP sees their plinth marked YOU, their bonus, and the bounty', async ({ page }) => {
    await seed(page, { kill: KILL({ my_place: 2, my_steps: 24550, my_pos: 2 }) },
      { hb_wgmvp_claim_v1: JSON.stringify({ week: '2026-09-20', bounty: 200, bonus: 100, place: 2 }) });
    await page.evaluate(() => (window as any).__wgm.maybe());
    await expect.poll(() => card(page), { timeout: 6_000 }).not.toBeNull();
    await page.locator('#wgmvp-screen').click();
    const c = (await card(page))!;
    const ryan = c.cols.find((x) => x.nm === 'Ryan')!;
    expect(ryan.you).toBe(true);
    expect(ryan.bonus).toBe('+100 souls');
    expect(c.cols.filter((x) => x.you).length).toBe(1);
    expect(c.mine).toEqual(['Your strikes · 24,550 · #2', 'Bounty · 200 souls']);
  });

  test('last week’s MVP (bonus no longer claimable) sees YOU but no souls line', async ({ page }) => {
    await seed(page, { kill: KILL({ my_place: 1, my_steps: 28018, my_pos: 1 }) });
    await page.evaluate(() => (window as any).__wgm.maybe());
    await expect.poll(() => card(page), { timeout: 6_000 }).not.toBeNull();
    await page.locator('#wgmvp-screen').click();
    const a = (await card(page))!.cols.find((x) => x.nm === 'Anthony')!;
    expect(a.you).toBe(true);
    expect(a.bonus).toBe('');
  });

  test('a hunter who never struck sees no line of their own', async ({ page }) => {
    await seed(page, { kill: KILL({ my_steps: 0, my_pos: null }) });
    await page.evaluate(() => (window as any).__wgm.maybe());
    await expect.poll(() => card(page), { timeout: 6_000 }).not.toBeNull();
    expect((await card(page))!.mine).toEqual([]);
  });

  test('never on a new hunter’s first day, and the kill waits for them', async ({ page }) => {
    await seed(page, { kill: KILL() }, { hb_onboarding_first_xp_date: '@today' });
    await page.evaluate(() => (window as any).__wgm.maybe());
    await page.waitForTimeout(800);
    expect(await card(page)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('hb_wgmvp_seen_v1'))).toBeNull();
  });

  test('the badge: the list’s live top three wear MVP / 2ND / 3RD', async ({ page }) => {
    await seed(page, { kill: KILL() });
    await page.evaluate(() => document.getElementById('wg-pulse')!.click());
    await page.evaluate(() => { const t = document.querySelector('[data-wg-tab="rank"]') as HTMLElement; if (t) t.click(); });
    await expect(page.locator('.wg2-pane .wg2-nmbtn').first()).toBeVisible({ timeout: 8_000 });
    const rows = await page.evaluate(() => [].map.call(document.querySelectorAll('.wg2-rank .wg2-ri'), (r: any) => ({
      name: (r.querySelector('.wg2-nmbtn')?.textContent || '').trim(), badge: r.querySelector('.wg-mvpb')?.getAttribute('data-p') || null,
      text: (r.querySelector('.wg-mvpb text')?.textContent || '') })));
    // Live order, not the frozen podium: Zynfandel leads the list now.
    expect(rows.slice(0, 5).map((r: any) => [r.name, r.badge, r.text])).toEqual([
      ['Zynfandel', '1', 'MVP'], ['Mara', '2', '2ND'], ['Anthony', '3', '3RD'], ['Ryan', null, ''], ['Galilea', null, '']]);
  });

  test('W977: a running MVP — the badges show all week, even while the gate still stands', async ({ page }) => {
    await seed(page, { status: 'open', kill: null });
    await page.evaluate(() => document.getElementById('wg-pulse')!.click());
    await page.evaluate(() => { const t = document.querySelector('[data-wg-tab="rank"]') as HTMLElement; if (t) t.click(); });
    await expect(page.locator('.wg2-pane .wg2-nmbtn').first()).toBeVisible({ timeout: 8_000 });
    const badges = await page.evaluate(() => [].map.call(document.querySelectorAll('.wg2-rank .wg2-ri'), (r: any) => r.querySelector('.wg-mvpb')?.getAttribute('data-p') || null));
    expect(badges.slice(0, 5)).toEqual(['1', '2', '3', null, null]);
    // Your own pinned row below the list never wears one.
    expect(await page.locator('.wg2-ri--me .wg-mvpb').count()).toBe(0);
  });

  test('the old kill ceremony is gone', async ({ page }) => {
    await seed(page, { kill: KILL() });
    const r = await page.evaluate(() => ({ screen: !!document.getElementById('wgkill-screen'), preview: typeof (window as any).__wgKillPreview }));
    expect(r).toEqual({ screen: false, preview: 'undefined' });
  });

  test('the owner’s Settings row previews both cards and saves nothing', async ({ page }) => {
    await seed(page, { kill: null }, { hb_board_cache_v1: JSON.stringify({ me: { role: 'owner' } }) });
    await page.locator('#settings-btn').click();
    await expect.poll(() => page.evaluate(() => !document.getElementById('settings-preview-wgmvp')!.classList.contains('hidden')), { timeout: 6_000 }).toBe(true);
    await page.evaluate(() => (window as any).__previewWorldgateMvps());
    await expect.poll(() => card(page), { timeout: 6_000 }).not.toBeNull();
    expect((await card(page))!.cols.some((x) => x.you)).toBe(false);
    await page.locator('#wgmvp-screen').click(); await page.locator('#wgmvp-screen').click();
    await expect.poll(() => card(page).then((c) => c && c.cols.some((x) => x.you)), { timeout: 6_000 }).toBe(true);
    await page.locator('#wgmvp-screen').click(); await page.locator('#wgmvp-screen').click();
    await expect.poll(() => card(page), { timeout: 3_000 }).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('hb_wgmvp_seen_v1'))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BG. W978 — TODAY'S BRIEFING v2 (Claude Design handoff 30): one screen + a seal
// ─────────────────────────────────────────────────────────────────────────
test.describe('BG · Today’s Briefing v2 (W978)', () => {
  // The app's `today` is Pacific (getPTDate) — seed in Pacific time (the 5 PM PST trap).
  const pt = (off: number) => new Date(Date.now() - off * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const VOWS = [
    { id: 'tb-phone', name: 'No phone or social media after waking', emoji: '•', difficulty: 'medium', type: 'quit' },
    { id: 'tb-med', name: 'Meditate & Breathwork', emoji: '•', difficulty: 'medium', type: 'build' },
    { id: 'tb-wake', name: 'Wake up at consistent time', emoji: '•', difficulty: 'medium', type: 'build' },
    { id: 'tb-read', name: 'Read', emoji: '•', difficulty: 'easy', type: 'build' },
  ];
  async function seed(page: Page, comp: Record<string, string[]>, extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript(([hs, c, ex]) => {
      try {
        if (sessionStorage.getItem('__w978')) return;
        sessionStorage.setItem('__w978', '1');
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));   // the Double Dungeon coachmark stays out of the way on any UTC day
        localStorage.setItem('hb_habits', JSON.stringify(hs));
        localStorage.setItem('hb_completions', JSON.stringify(c));
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
        Object.keys(ex || {}).forEach((k) => localStorage.setItem(k, (ex as any)[k]));
      } catch (_) {}
    }, [VOWS, comp, extra || {}] as [any[], Record<string, string[]>, Record<string, string>]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }
  const view = (page: Page) => page.evaluate(() => {
    const r = document.getElementById('tb-root')!;
    const t = (s: string) => (r.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
    return { shown: !document.getElementById('daily-insight-overlay')!.classList.contains('hidden'),
      date: t('.tb-date'), day: t('.tb-dayn'), streak: t('.tb-streak'), yest: t('.tb-yest'), big: t('.tb-big'), xp: t('.tb-xp'),
      climb: [].map.call(r.querySelectorAll('.tb-clt span'), (x: any) => x.textContent.trim()).join(' | '), chips: [].map.call(r.querySelectorAll('.tb-chip'), (c: any) => c.textContent.trim()), segs: r.querySelectorAll('.tb-seg').length,
      world: t('.tb-world'), label: ((r.querySelector('.tb-rl') as HTMLElement)?.innerText || '').trim(), stamped: r.classList.contains('tb-stamped'), text: r.textContent || '' };
  });
  async function holdSeal(page: Page, ms: number) {
    const box = (await page.locator('#tb-root .tb-seal').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
  }

  test('one screen: the day, yesterday in a line, the to-do card, the climb — no vow ring, no vow chips (W1009)', async ({ page }) => {
    await seed(page, { [pt(1)]: ['tb-phone', 'tb-med'], [pt(2)]: ['tb-read'] });
    await page.evaluate(() => (window as any).__previewTodaysBriefing());
    await page.waitForTimeout(1600);
    const v = await view(page);
    expect(v.shown).toBe(true);
    expect(v.date).toMatch(/^(SUN|MON|TUE|WED|THU|FRI|SAT) · [A-Z]{3} \d{1,2}$/);
    expect(v.day).toMatch(/^Day \d+$/);
    expect(v.streak).toBe('2-day streak');
    expect((await page.evaluate(() => (window as any).__tb.data())).yest).toBe('Yesterday: <b>2 of 4</b> vows kept.');
    await expect(page.locator('#tb-root .tb-wk')).toBeVisible();                 // W1014 — the owner preview always carries the Monday recap
    expect(v.segs).toBe(0);                     // W1009 — the vow ring left the briefing
    expect(v.big).toBe('');
    expect(v.climb).toMatch(/^Rank [A-Z+]+ \| (\d[\d,]* XP to [A-Z+]+ I{1,3}|The summit of the ranks)$/i);
    expect(v.chips.length).toBe(0);             // …and so did the lead chips
    await expect(page.locator('#tb-root .tb-todo .tb-tdh')).toContainText('Today’s to-dos');
    await expect(page.locator('#tb-root .tb-todo [data-tb-tdin]')).toBeVisible();   // W1017 — no to-dos: the preview shows the real card, the add box
    expect(v.text).not.toMatch(/VERIFIED BY SYSTEM|OBJECTIVES|LOCK IN/i);
    expect(v.label).toMatch(/^HOLD TO BEGIN/i);
  });

  test('the ritual: letting go early drains back with no message; a full hold stamps the day and the briefing leaves', async ({ page }) => {
    await seed(page, { [pt(1)]: ['tb-phone'] });
    await page.evaluate(() => { localStorage.removeItem('hb_daily_insight_last_shown'); (window as any).__tb.show({}); });
    await page.waitForTimeout(1500);
    await holdSeal(page, 350);
    await page.waitForTimeout(400);
    const early = await page.evaluate(() => ({ p: getComputedStyle(document.querySelector('#tb-root .tb-seal')!).getPropertyValue('--p').trim(), stamped: document.getElementById('tb-root')!.classList.contains('tb-stamped') }));
    expect(early.stamped).toBe(false);
    expect(Number(early.p || 0)).toBeLessThan(0.02);
    await holdSeal(page, 1150);
    await expect.poll(() => view(page).then((x) => x.stamped), { timeout: 2_000 }).toBe(true);
    expect((await view(page)).label).toBe('The day is yours.');
    await expect.poll(() => view(page).then((x) => x.shown), { timeout: 4_000 }).toBe(false);
    const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
    expect(await page.evaluate(() => localStorage.getItem('hb_daily_insight_last_shown'))).toBe(today);
  });

  test('yesterday is one line and never shaming', async ({ page }) => {
    await seed(page, { [pt(1)]: ['tb-phone', 'tb-med', 'tb-wake', 'tb-read'] });
    expect((await page.evaluate(() => (window as any).__tb.data())).yest).toBe('Yesterday: <b>a perfect day.</b> All 4 kept.');
    await page.evaluate((d) => { const c = (window as any).Leaderboard.__test_getCompletions(); Object.keys(c).forEach((k) => delete c[k]); c[d] = ['tb-read']; }, pt(2));
    expect((await page.evaluate(() => (window as any).__tb.data())).yest).toBe('The streak rests. It starts again with this seal.');
    await page.evaluate(() => { const c = (window as any).Leaderboard.__test_getCompletions(); Object.keys(c).forEach((k) => delete c[k]); });
    expect((await page.evaluate(() => (window as any).__tb.data())).yest).toMatch(/^(Yesterday went quiet\. The gate is still open\.|Your first full day\. Four vows to begin\.)$/);
  });

  test('the owner’s Settings row previews it and saves nothing', async ({ page }) => {
    await seed(page, { [pt(1)]: ['tb-phone'] }, { hb_board_cache_v1: JSON.stringify({ me: { role: 'owner' } }) });
    await page.locator('#settings-btn').click();
    await expect.poll(() => page.evaluate(() => !document.getElementById('settings-preview-briefing')!.classList.contains('hidden')), { timeout: 6_000 }).toBe(true);
    const before = await page.evaluate(() => localStorage.getItem('hb_daily_insight_last_shown'));
    await page.evaluate(() => (window as any).__previewTodaysBriefing());
    await page.waitForTimeout(1500);
    await holdSeal(page, 1150);
    await expect.poll(() => view(page).then((x) => x.shown), { timeout: 4_000 }).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('hb_daily_insight_last_shown'))).toBe(before);
    expect(await page.evaluate(() => localStorage.getItem('hb_brief_lead_v1'))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BH. W980 — HUNT RESULTS (Claude Design handoffs 31 + 32): solo + co-op, win + loss
// ─────────────────────────────────────────────────────────────────────────
// W986 — the morning briefing names a developer update the hunter has not opened.
test.describe('BI · Briefing names a new update (W986)', () => {
  const VOWS = [{ id: 'bi-read', name: 'Read', emoji: '•', difficulty: 'easy', type: 'build' }];
  async function seed(page: Page, extra: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript(([hs, ex]) => {
      try {
        if (sessionStorage.getItem('__w986')) return;
        sessionStorage.setItem('__w986', '1');
        localStorage.setItem('hb_habits', JSON.stringify(hs));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
        Object.keys(ex || {}).forEach((k) => localStorage.setItem(k, (ex as any)[k]));
      } catch (_) {}
    }, [VOWS, extra] as [any[], Record<string, string>]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }
  const news = (page: Page) => page.evaluate(() => { const el = document.querySelector('.tb-news'); return el ? (el.textContent || '').trim() : null; });

  test('an unopened update is named on the briefing', async ({ page }) => {
    await seed(page, { hb_board_update_last: JSON.stringify({ id: 'up-1', created_at: 1, title: 'Week of Sep 21' }) });
    await page.evaluate(() => (window as any).__previewTodaysBriefing());
    await expect.poll(() => news(page), { timeout: 6_000 }).toBe('New on the Community board: Week of Sep 21');
  });

  // The real briefing (not the owner's preview) is the one hunters see.
  const real = (page: Page) => page.evaluate(() => (window as any).__tb.show({}));

  test('once that update is opened, the line is gone', async ({ page }) => {
    await seed(page, { hb_board_update_last: JSON.stringify({ id: 'up-1', created_at: 1, title: 'Week of Sep 21' }), hb_board_update_seen: 'up-1' });
    await real(page);
    await expect(page.locator('.tb-frame')).toBeVisible({ timeout: 6_000 });
    await page.waitForTimeout(1500);
    expect(await news(page)).toBeNull();
  });

  test('no update at all: no line', async ({ page }) => {
    await seed(page, {});
    await real(page);
    await expect(page.locator('.tb-frame')).toBeVisible({ timeout: 6_000 });
    await page.waitForTimeout(1500);
    expect(await news(page)).toBeNull();
  });

  test('the owner preview always shows the line: the latest title even when opened, else a sample', async ({ page }) => {
    await seed(page, { hb_board_update_last: JSON.stringify({ id: 'up-1', created_at: 1, title: 'Week of Sep 21' }), hb_board_update_seen: 'up-1' });
    await page.evaluate(() => (window as any).__previewTodaysBriefing());
    await expect.poll(() => news(page), { timeout: 6_000 }).toBe('New on the Community board: Week of Sep 21');
  });
});

// W987 — awakened://worldgate (the In-App Event deep link) lands on the Worldgate sheet.
test.describe('BJ · URL scheme routes (W987)', () => {
  test('awakened://worldgate opens the Worldgate sheet; unknown paths do nothing', async ({ page }) => {
    await freshApp(page);
    await page.evaluate(() => localStorage.setItem('hb_worldgate_v1', JSON.stringify({ at: Date.now(), week: '2026-09-20', hp: 243293, pool: 120000, status: 'open', my: 4000, floor: 15000, souls: 200, hunters: 9, guild: { steps: 0, hunters: 0 }, top: [], wall: [], recent: [], kill: null })));
    expect(await page.evaluate(() => (window as any).__routeSchemeUrl('awakened://worldgate'))).toBe(true);
    await expect(page.locator('.wg2-hero')).toBeVisible({ timeout: 6_000 });
    expect(await page.evaluate(() => (window as any).__routeSchemeUrl('https://example.com/i/ABC'))).toBe(false);
    expect(await page.evaluate(() => (window as any).__routeSchemeUrl('awakened://nothing-here'))).toBe(false);
  });
});

// W990 — RESOLVED on the Community board.
test.describe('BK · Resolved topics (W990)', () => {
  test('a resolved topic wears the green tag; the RESOLVED rail asks the server for state=resolved; mods get Resolve / Reopen', async ({ page }) => {
    await freshApp(page);
    await page.evaluate(() => localStorage.setItem('hb_board_cache_v1', JSON.stringify({ topics: [], me: { role: 'owner' } })));
    await page.click('#tab-social');
    await expect(page.locator('#board-body')).toContainText(/No topics yet|Sign in with Apple|Could not load/i, { timeout: 10_000 });
    await page.evaluate(() => {
      const now = Date.now();
      const au = (alias: string, rank: string, id: string) => ({ author_id: id, alias, rank_label: rank, founder_seq: 0, is_mod: false, mod_role: null });
      const w = window as any;
      w.__seen = [];
      const row = (id: string, title: string, resolved: boolean) => ({ id, tag: 'bug', title, preview: 'p', created_at: now - 86400000, last_activity_at: now - 3600000, reply_count: 0, up_count: 0, voted: false, pinned: false, locked: false, hidden: false, resolved, repliers: [], last_reply: null, author: au('Grubbadub', 'D', 'u-g') });
      w.Auth.boardTopics = async (tag: string, cursor: string, sort: string) => {
        w.__seen.push([tag || '', sort || 'latest']);
        return tag === 'resolved'
          ? { ok: true, next_cursor: null, counts: { all: 1, improvement: 0, bug: 1, talk: 0, update: 0, resolved: 1 }, topics: [row('cccccccc-0002', 'Sleep double-counted', true)], me: { role: 'owner' } }
          : { ok: true, next_cursor: null, counts: { all: 1, improvement: 0, bug: 1, talk: 0, update: 0, resolved: 1 }, topics: [row('cccccccc-0001', 'Widget stuck at 0', false)], me: { role: 'owner' } };
      };
      w.Auth.boardTopic = async () => ({ ok: true, following: false, next_cursor: null, me: { consented: true, role: 'owner', rank_tier: 'S', topic_min_tier: 'C', reply_min_tier: 'D' },
        topic: Object.assign(row('cccccccc-0002', 'Sleep double-counted', true), { body: 'Fixed in 3.0.8.' }), replies: [] });
      w.__board.render();
    });
    // the open list: one open bug, no tag; the rail counts one resolved
    await expect(page.locator('#board-body .board-topic')).toHaveCount(1);
    await expect(page.locator('#board-body .board-tag--resolved')).toHaveCount(0);
    await expect(page.locator('[data-board-tag="resolved"] .board-f-n')).toHaveText('1');
    // the RESOLVED rail
    await page.click('[data-board-tag="resolved"]');
    await expect(page.locator('#board-body .board-topic--resolved .board-tag--resolved')).toHaveText('RESOLVED');
    expect(await page.evaluate(() => (window as any).__seen.some((s: string[]) => s[0] === 'resolved'))).toBe(true);
    // the owner's chip on the topic reads Reopen
    await page.evaluate(() => (window as any).__board.open('cccccccc-0002'));
    const sheet = page.locator('.board-sheet--topic');
    await expect(sheet.locator('.board-op .board-tag--resolved')).toBeVisible();
    await expect(sheet.locator('.board-op [data-board-mod="resolve"]')).toHaveText('Reopen');
  });
});

// W1005 — weekly-goal vows: N times a week, any days; N by Sunday is the vow's perfect week.
// A weekly vow lists every day but COUNTS toward a day only when sealed that day, or when the
// seals still needed no longer fit in the days left. Everything date-dependent is computed from
// the app's day (PT) in the browser, so the suite passes on any weekday.
test.describe('BO · Weekly-goal vows (W1005)', () => {
  async function seed(page: Page, weekly: number, extra?: { streak?: number; seals?: string[] }) {
    await freshApp(page);
    await page.addInitScript(([weekly, extra]) => {
      const ptToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
      const add = (ds: string, n: number) => { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
      const dow = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date(ptToday + 'T12:00:00Z')));
      const monday = add(ptToday, -dow), lastMonday = add(monday, -7);
      const v = (id: string, name: string, x?: Record<string, unknown>) => Object.assign({ id, name, emoji: '⚡', difficulty: 'easy', type: 'build', primaryStat: 'STR', custom: true, tod: 'day' }, x || {});
      localStorage.setItem('hb_habits', JSON.stringify([v('d1', 'Read 10 pages', { primaryStat: 'INT' }), v('w1', 'Gym session', { weekly })]));
      const comp: Record<string, string[]> = {};
      ((extra && extra.seals) || []).forEach((ds) => { comp[ds] = ['w1']; });
      localStorage.setItem('hb_completions', JSON.stringify(comp));
      if (extra && extra.streak) localStorage.setItem('hb_streaks', JSON.stringify({ w1: { count: extra.streak, lastDate: add(lastMonday, 3), wk: lastMonday, prevCount: 0, prevLastDate: null } }));
      localStorage.setItem('hb_points', '500');
      localStorage.setItem('hb_first_completion_bonus_v1', '1');
      localStorage.setItem('hb_first_vow_pointer_seen', '1');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ done: true }));
      localStorage.setItem('hb_tour_welcome_back_v1', '1');
      localStorage.setItem('hb_achievements', JSON.stringify(['first_step', 'first_blood', 'getting_started']));   // no first-ever popups over the toast
      (window as any).__t = { ptToday, dow, monday, lastMonday };
    }, [weekly, extra || {}] as [number, { streak?: number; seals?: string[] }]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { const s = document.getElementById('awakened-splash'); if (s) s.remove(); });
    await page.click('#tab-habits');
    await expect(page.locator('.habit-item[data-id="w1"]')).toBeVisible({ timeout: 10_000 });
    return page.evaluate(() => (window as any).__t) as Promise<{ ptToday: string; dow: number; monday: string; lastMonday: string }>;
  }

  test('the rule: a weekly vow counts on the days it is sealed, and on the days the week can no longer be won without it', async ({ page }) => {
    // a fixed past week, Mon 14 – Sun 20 Sep 2026: 4× a week, sealed Mon and Tue
    await seed(page, 4, { seals: ['2026-09-14', '2026-09-15'] });
    const on = (d: string) => page.evaluate((d) => (window as any).__weekly.countsOn('w1', d), d);
    expect(await on('2026-09-15')).toBe(true);    // sealed that day
    expect(await on('2026-09-16')).toBe(false);   // Wed: 2 left to find in 5 days
    expect(await on('2026-09-18')).toBe(false);   // Fri: 2 in 3 days — still room
    expect(await on('2026-09-19')).toBe(true);    // Sat: 2 in 2 days — needed now
    expect(await on('2026-09-20')).toBe(true);    // Sun: still 2 short — the week is lost, it counts (and breaks Perfect Day)
    expect(await page.evaluate(() => (window as any).__weekly.weekStart('2026-09-20'))).toBe('2026-09-14');
  });

  test('the row: listed every day, counted only when it must be; the seal that meets the goal names the perfect week and moves the week streak', async ({ page }) => {
    const t = await seed(page, 1, { streak: 2 });
    const sunday = t.dow === 6;                        // 1× a week with none yet: needed only on Sunday
    await expect(page.locator('.habit-item[data-id="w1"] [data-weekly]')).toHaveText(sunday ? '0 of 1 this week · needed today' : '0 of 1 this week');
    await expect(page.locator('#total-count')).toHaveText(sunday ? '2' : '1');   // off the hook: listed, not owed
    await expect(page.locator('.habit-item[data-id="w1"] .hlr-streak')).toHaveText('2W');   // last week was won
    // seal it (a real tap, so the toast shows at once): the goal is met — a perfect week
    await page.click('.habit-item[data-id="w1"] .hlr-seal');
    await expect(page.locator('.habit-item[data-id="w1"] [data-weekly]')).toHaveText('1 of 1 · perfect week');
    await expect(page.locator('.habit-item[data-id="w1"] [data-weekly]')).toHaveClass(/hlr-weekly--met/);
    await expect(page.locator('#total-count')).toHaveText('2');
    await expect(page.locator('#completed-count')).toHaveText('1');
    await expect(page.locator('#habit-toast, .habit-toast').filter({ hasText: /Perfect week/ }).first()).toBeVisible({ timeout: 3_000 });
    await expect.poll(() => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('hb_streaks') || '{}').w1 || {}; return s.count + '|' + s.wk; })).toBe('3|' + t.monday);
    // unseal: back to where it was
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="w1"]') as HTMLElement).click());
    await expect(page.locator('.habit-item[data-id="w1"] [data-weekly]')).toHaveText(sunday ? '0 of 1 this week · needed today' : '0 of 1 this week');
    await expect.poll(() => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('hb_streaks') || '{}').w1 || {}; return s.count + '|' + s.wk; })).toBe('2|' + t.lastMonday);
    // the daily vow alone makes a perfect day — unless it is Sunday and the week is still unwon
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="d1"]') as HTMLElement).click());
    if (sunday) await expect(page.locator('#habit-list')).not.toHaveClass(/all-complete/);
    else await expect(page.locator('#habit-list')).toHaveClass(/all-complete/);
  });

  test('the schedule sheet sets it: TIMES A WEEK with − / +, and back to fixed days', async ({ page }) => {
    await seed(page, 3);
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="d1"] [data-more]') as HTMLElement).click());
    await page.click('#ctx-schedule');
    await expect(page.locator('#sched-sheet')).toBeVisible();
    await expect(page.locator('[data-sched-mode="days"]')).toHaveClass(/active/);
    await page.click('[data-sched-mode="weekly"]');
    await expect(page.locator('#sched-days-row')).toBeHidden();
    await expect(page.locator('#sched-wk-n')).toHaveText('4× a week');   // a daily vow starts at 4
    await page.click('[data-sched-wk="1"]');
    await expect(page.locator('#sched-wk-n')).toHaveText('5× a week');
    await expect(page.locator('#sched-days-help')).toContainText('Hit 5 by Sunday for a perfect week');
    await page.click('#sched-save-btn');
    expect(await page.evaluate(() => { const h = JSON.parse(localStorage.getItem('hb_habits') || '[]').find((x: any) => x.id === 'd1'); return [h.weekly, h.days === undefined]; })).toEqual([5, true]);
    await expect(page.locator('.habit-item[data-id="d1"] [data-weekly]')).toContainText('of 5');
    // and back
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="w1"] [data-more]') as HTMLElement).click());
    await page.click('#ctx-schedule');
    await expect(page.locator('[data-sched-mode="weekly"]')).toHaveClass(/active/);
    await expect(page.locator('#sched-wk-n')).toHaveText('3× a week');
    await page.click('[data-sched-mode="days"]');
    await expect(page.locator('#sched-days-row')).toBeVisible();
    await page.click('#sched-save-btn');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').find((x: any) => x.id === 'w1').weekly)).toBeUndefined();
    await expect(page.locator('.habit-item[data-id="w1"] [data-weekly]')).toHaveCount(0);
  });
});

// W1020 — Status tab · Interactive (Claude Design), the owner's picks: the header counter opens
// the vows still open (sealable there; the Routine Progress popup is gone), a LEVEL UP screen for
// every stat level (one screen for every stat that rose), the living hunter (evening flicker
// only), the title chip, one SHARE CARD button, souls counting up.
test.describe('BT · Status tab interactive (W1020)', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  // names matter: a vow named like a goal-based one (Read, Get morning sunlight…) will not seal without a goal
  const custom = (id: string, name: string, stat: string, x?: Record<string, unknown>) => Object.assign({ id, name, emoji: '⚡', difficulty: 'easy', type: 'build', primaryStat: stat, custom: true }, x || {});
  async function seed(page: Page, habits: Array<Record<string, unknown>>, extra?: Record<string, string>, at?: Date) {
    if (at) await page.clock.setFixedTime(at);
    await freshApp(page);
    await page.addInitScript(([hs, ex]) => {
      try {
        if (sessionStorage.getItem('__w1020')) return;
        sessionStorage.setItem('__w1020', '1');
        localStorage.setItem('hb_habits', JSON.stringify(hs));
        localStorage.setItem('hb_points', '500');
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_first_vow_pointer_seen'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_achievements', JSON.stringify(['first_step', 'first_blood', 'getting_started']));
        Object.keys(ex || {}).forEach((k) => localStorage.setItem(k, (ex as any)[k]));
      } catch (_) {}
    }, [habits, extra || {}] as [any[], Record<string, string>]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { const s = document.getElementById('awakened-splash'); if (s) s.remove(); });
  }
  const rows = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('#today-vows .tv-row')).map((r) => (r.querySelector('.tv-nm') as HTMLElement).textContent + '|' + ((r.querySelector('.tv-chip') as HTMLElement | null)?.textContent || '')));

  test('the counter opens the vows still open; a tap seals one from any tab; the Routine Progress popup is gone', async ({ page }) => {
    // a Thursday: on Fri–Sun the chips honestly read +2 (weekend double)
    await seed(page, [custom('a', 'Call a friend', 'FOCUS'), custom('b', 'Tidy the desk', 'INT'), custom('c', 'Meditate', 'FOCUS', { difficulty: 'medium' })], {}, new Date('2026-10-01T10:00:00-07:00'));
    await page.click('#tab-habits');
    await expect(page.locator('#today-vows')).not.toHaveClass(/tv-drop--open/);
    await page.click('#today-strip .today-strip-left');
    await expect(page.locator('#today-vows')).toHaveClass(/tv-drop--open/);
    await expect(page.locator('#today-strip')).toHaveAttribute('aria-expanded', 'true');
    expect(await rows(page)).toEqual(['Call a friend|+1 FOCUS', 'Tidy the desk|+1 INT', 'Meditate|+1 FOCUS']);   // custom vows are locked to +1 XP (W970)
    await expect(page.locator('#today-vows .tv-count')).toHaveText('3 / 3');
    await expect(page.locator('#pack-progress-modal')).toHaveCount(0);
    // seal one from the list: the counter, the list row and the dropdown all follow
    await page.click('#today-vows [data-tv-id="b"]');
    await expect(page.locator('#completed-count')).toHaveText('1');
    await expect(page.locator('#habit-list .habit-item[data-id="b"]')).toHaveClass(/completed/);
    await expect.poll(() => rows(page)).toEqual(['Call a friend|+1 FOCUS', 'Meditate|+1 FOCUS']);
    // from another tab (no list row on screen): still seals
    await page.evaluate(() => document.getElementById('tab-profile')!.click());
    await page.click('#today-vows [data-tv-id="a"]');
    await expect(page.locator('#completed-count')).toHaveText('2');
    await page.click('#today-vows [data-tv-id="c"]');
    await expect(page.locator('#completed-count')).toHaveText('3');
    await expect(page.locator('#today-vows .tv-empty')).toHaveText('Every vow is sealed. The day is complete.', { timeout: 4_000 });
    expect(await page.evaluate(() => { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()); return (JSON.parse(localStorage.getItem('hb_completions') || '{}')[d] || []).length; })).toBe(3);
    // tap again: it closes
    await page.click('#today-strip .today-strip-left');
    await expect(page.locator('#today-vows')).not.toHaveClass(/tv-drop--open/);
  });

  test('LEVEL UP for every level: one stat gets the big screen; two stats rising on one seal share one screen', async ({ page }) => {
    const stats = JSON.stringify({ STR: { pts: 4 }, VIT: { pts: 4 }, INT: { pts: 0 }, FOCUS: { pts: 4 }, WILL: { pts: 0 }, WLT: { pts: 0 } });
    await seed(page, [custom('f', 'Deep work', 'FOCUS'), { id: 'cw', name: 'Cardio workout', emoji: '•', difficulty: 'easy', type: 'build', goal: { value: 30, unit: 'min' } }, custom('z', 'Left open', 'WILL')], { hb_stats: stats });   // one vow stays open: no Perfect Day screen ahead of the level-up
    await page.click('#tab-habits');
    await page.evaluate(() => (document.querySelector('#habit-list .habit-item[data-id="f"]') as HTMLElement).click());
    const ov = page.locator('#statup-ov');
    await expect(ov).toHaveClass(/statup-ov--on/, { timeout: 6_000 });
    await expect(ov.locator('.statup-kick')).toHaveText('LEVEL UP');
    await expect(ov.locator('.statup-stat')).toHaveText('FOCUS');
    await expect(ov.locator('.statup-lv')).toHaveText('1→2');
    await expect(ov.locator('.statup-tap')).toHaveText('TAP TO CONTINUE');
    await expect(page.locator('.habit-toast--statlvl')).toHaveCount(0);                      // the old toast is retired
    await page.waitForTimeout(500);
    await ov.click();
    await expect(ov).not.toHaveClass(/statup-ov--on/);
    // Cardio workout trains STR and VIT: both rise, one screen
    await page.evaluate(() => (document.querySelector('#habit-list .habit-item[data-id="cw"]') as HTMLElement).click());
    await expect(ov).toHaveClass(/statup-ov--on/, { timeout: 6_000 });
    await expect(ov.locator('.statup-row')).toHaveCount(2);
    expect(await ov.locator('.statup-row').allTextContents()).toEqual(['STR1→2', 'VIT1→2']);
    await expect(ov.locator('.statup-stat')).toHaveCount(0);
  });

  test('the Status tab: the hunter is steady by day, flickers after 6 PM with vows open, glows once sealed; title chip, one SHARE CARD', async ({ page }) => {
    await seed(page, [custom('a', 'Tidy the desk', 'INT')], { hb_arena_title: 'rt_duelist', hb_arena_v2: JSON.stringify({ highestCleared: 20 }) }, new Date('2026-10-01T19:30:00-07:00'));
    await page.evaluate(() => document.getElementById('tab-profile')!.click());
    await expect(page.locator('#status-content .sc-hunter')).toHaveClass(/sc-hunter--risk/, { timeout: 6_000 });
    await expect(page.locator('#status-content .sc-hunter-g')).toHaveCount(2);
    await expect(page.locator('#status-content .sc-title-chip')).toHaveText('DUELIST');
    await expect(page.locator('#status-content .sc-share-btn[data-bkshare]')).toHaveText('SHARE CARD');
    await expect(page.locator('#status-content [data-open-statuswindow], #status-content .sc-share-link')).toHaveCount(0);
    await expect(page.locator('#sc-avatar-img')).toHaveCount(1);
    // seal the day from the header: the flicker stops, the glow comes on
    await page.click('#today-strip .today-strip-left');
    await page.click('#today-vows [data-tv-id="a"]');
    await expect(page.locator('#status-content .sc-hunter')).toHaveClass(/sc-hunter--done/, { timeout: 6_000 });
    await expect(page.locator('#status-content .sc-hunter-g')).toHaveCount(0);
  });

  test('by day the hunter never flickers; with no title there is no chip; souls roll up to the true total', async ({ page }) => {
    await seed(page, [custom('a', 'Tidy the desk', 'INT')], {}, new Date('2026-10-01T10:00:00-07:00'));
    await page.evaluate(() => document.getElementById('tab-profile')!.click());
    await expect(page.locator('#status-content .sc-hunter')).toHaveCount(1, { timeout: 6_000 });
    await expect(page.locator('#status-content .sc-hunter')).not.toHaveClass(/sc-hunter--risk|sc-hunter--done/);
    await expect(page.locator('#status-content .sc-title-chip')).toHaveCount(0);
    const total = await page.evaluate(() => document.getElementById('souls-balance')!.getAttribute('data-souls'));
    expect(total).toMatch(/^\d+$/);
    await expect(page.locator('#souls-balance')).toHaveText(Number(total).toLocaleString('en-US'), { timeout: 4_000 });
  });
});

// W1021 — the Jump Program is the Jump Manual's: Days 1, 4, 8 and 11 of a 14-day cycle that
// counts from the day the hunter picked (onboarding "When do you start?", or the guide row's
// sheet). Each session lists in the manual's own order; the other ten days are rest (the three
// dailies only); an account on the prototype program is moved over and asked for its start day.
test.describe('BU · Jump Program by the manual (W1021)', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  const NOW = new Date('2026-10-05T10:00:00-07:00');   // a Monday
  const D1  = ['Depth Jumps (4x8)', 'Side to Side Box Jumps (4x8)', 'Weighted Explosions (3x8)', 'Medicine Ball Approach (4x6-8)', 'Zig Zags (3x10 + 2 back and forth)', 'Medicine Throws (3x8)', 'Rim Jumps (4 sets)', 'Speed Rope (3x30 sec)'];
  const D4  = ['Explosion Squats (5 sets)', 'Explosion Calf Raises (5 sets)', 'Dead Lifts (5 sets)', 'Ham Curls (5 sets)', 'In Place Lunges (3x6)', 'Hang Cleans (3x6)', 'Knee Drives (5 sets)'];
  const D8  = ['Sprints (4x25-50yd)', 'Lunge Jumps (4x6-10)', '1 Leg Chair Rockets (4 sets)', 'Medicine Throws (3x8)', 'Zig Zags (3x10 + 2 back and forth)', 'Rim Jumps (4 sets)', 'Weighted Explosions (3x8)', 'Finishing Sprints (4x25-50yd)'];
  const D11 = ['Explosion Squats (5 sets)', 'Hang Cleans (3x6)', 'Ham Curls (5 sets)', 'Explosion Calf Raises (5 sets)', 'In Place Lunges (3x6)', 'Dead Lifts (5 sets)', 'Knee Drives (5 sets)'];
  const DAILIES = ['Creatine', 'Sunlight', 'Daily Protein Goal'];
  const QUIET = ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_first_vow_pointer_seen'];

  // A jump hunter, seeded from the app's own templates. `start` = the date of Day 1 (null = none chosen).
  async function seedJump(page: Page, start: string | null) {
    await page.clock.setFixedTime(NOW);
    await freshApp(page);
    const rows = await page.evaluate(() => JSON.stringify((window as any).__jump.rows()));
    await page.addInitScript(([hs, st, quiet]) => {
      try {
        if (sessionStorage.getItem('__w1021')) return;
        sessionStorage.setItem('__w1021', '1');
        localStorage.setItem('hb_habits', hs as string);
        localStorage.setItem('hb_onboarding_goal', 'jump_program');
        localStorage.setItem('hb_path', 'jump_program');
        localStorage.setItem('hb_jump_v', '2');
        if (st) localStorage.setItem('hb_jump_program_started', st as string);
        localStorage.setItem('hb_points', '500');
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        (quiet as string[]).forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_achievements', JSON.stringify(['first_step', 'first_blood', 'getting_started']));
      } catch (_) {}
    }, [rows, start, QUIET] as [string, string | null, string[]]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { const s = document.getElementById('awakened-splash'); if (s) s.remove(); });
  }
  // today's list, top to bottom, by vow name
  const listed = (page: Page) => page.evaluate(() => {
    const hs = JSON.parse(localStorage.getItem('hb_habits') || '[]') as Array<{ id: string; name: string }>;
    return Array.from(document.querySelectorAll('#habit-list .habit-item')).map((el) => (hs.find((h) => h.id === (el as HTMLElement).dataset.id) || { name: '?' }).name);
  });
  const day = (n: number) => { const d = new Date(Date.UTC(2026, 9, 5, 12) - (n - 1) * 86400000); return d.toISOString().slice(0, 10); };   // the start date that makes TODAY Day n
  const guide = (page: Page) => page.evaluate(() => [(document.querySelector('#fa-program-guide .fa-guide-eyebrow') as HTMLElement).textContent, (document.querySelector('#fa-program-guide .fa-guide-line') as HTMLElement).textContent]);
  const setStart = (page: Page, ds: string) => page.evaluate((d) => (window as any).__jump.setStart(d), ds);

  test('Days 1, 4, 8 and 11 list the manual in the manual order; every other day is the dailies; Day 15 is Day 1 again', async ({ page }) => {
    await seedJump(page, '2026-10-05');
    await page.click('#tab-habits');
    const sessions: Record<number, string[]> = { 1: D1, 4: D4, 8: D8, 11: D11, 15: D1 };
    for (let n = 1; n <= 15; n++) {
      await setStart(page, day(n));
      const names = await listed(page);
      const training = names.filter((x) => DAILIES.indexOf(x) < 0);
      expect(training, 'Day ' + n).toEqual(sessions[n] || []);
      expect(names.filter((x) => DAILIES.indexOf(x) >= 0).sort(), 'dailies on Day ' + n).toEqual(DAILIES.slice().sort());
    }
    // the header's vow list (W1020) follows the same order
    await setStart(page, day(8));
    await page.evaluate(() => (window as any).__tv.open(true));
    const tv = await page.evaluate(() => Array.from(document.querySelectorAll('#today-vows .tv-nm')).map((el) => el.textContent));
    expect(tv.filter((x) => DAILIES.indexOf(x as string) < 0)).toEqual(D8);
  });

  test('the templates agree with the sessions; the pack seeds 22 vows; the prototype exercises are gone from the library', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await freshApp(page);
    const r = await page.evaluate(() => {
      const j = (window as any).__jump;
      return { t: j.templates() as Array<{ name: string; cycleDays: number[] | null }>, s: j.sessions as Record<string, { label: string; names: string[] }>, rows: j.rows().length };
    });
    expect(r.rows).toBe(22);
    expect(r.t.length).toBe(22);
    expect(Object.keys(r.s)).toEqual(['1', '4', '8', '11']);
    expect([r.s['1'].names, r.s['4'].names, r.s['8'].names, r.s['11'].names]).toEqual([D1, D4, D8, D11]);
    expect([r.s['1'].label, r.s['4'].label, r.s['8'].label, r.s['11'].label]).toEqual(['PLYOMETRICS', 'STRENGTH', 'PLYOMETRICS', 'STRENGTH']);
    for (const d of Object.keys(r.s)) for (const nm of r.s[d].names) {
      const tpl = r.t.find((x) => x.name === nm);
      expect(tpl && tpl.cycleDays, nm + ' on Day ' + d).toContain(Number(d));
    }
    for (const tpl of r.t) for (const d of tpl.cycleDays || []) expect(r.s[String(d)].names, tpl.name).toContain(tpl.name);
    expect(r.t.filter((x) => !x.cycleDays).map((x) => x.name)).toEqual(DAILIES);
    expect(r.t.some((x) => /Warmup|Max Effort|Box Squats|Power Cleans/.test(x.name))).toBe(false);
  });

  test('the guide row names the program day: a session, a rest day with the next session, the days before Day 1', async ({ page }) => {
    await seedJump(page, '2026-10-05');
    await page.click('#tab-habits');
    expect(await guide(page)).toEqual(['DAY 1 OF 14 · PLYOMETRICS', '8 exercises today, in order.']);
    await setStart(page, day(2));  expect(await guide(page)).toEqual(['DAY 2 OF 14 · REST', 'Next session Wednesday.']);
    await setStart(page, day(3));  expect(await guide(page)).toEqual(['DAY 3 OF 14 · REST', 'Next session tomorrow.']);
    await setStart(page, day(4));  expect(await guide(page)).toEqual(['DAY 4 OF 14 · STRENGTH', '7 exercises today, in order.']);
    await setStart(page, day(12)); expect(await guide(page)).toEqual(['DAY 12 OF 14 · REST', 'Next session Thursday.']);
    await setStart(page, '2026-10-07'); expect(await guide(page)).toEqual(['DAY 1 STARTS WED', 'Keep the dailies until then.']);
    await setStart(page, '2026-10-06'); expect(await guide(page)).toEqual(['DAY 1 STARTS TOMORROW', 'Keep the dailies until then.']);
    expect((await listed(page)).slice().sort()).toEqual(DAILIES.slice().sort());   // before Day 1: the dailies only
    // rest days are never owed: only the day's own session is scheduled, and nothing before the start
    await setStart(page, day(4));   // started Fri 2 Oct
    const sch = await page.evaluate(() => { const j = (window as any).__jump; return [j.scheduledOn('Explosion Squats (5 sets)', '2026-10-05'), j.scheduledOn('Explosion Squats (5 sets)', '2026-10-04'), j.scheduledOn('Depth Jumps (4x8)', '2026-10-02'), j.scheduledOn('Depth Jumps (4x8)', '2026-10-05'), j.scheduledOn('Creatine', '2026-10-03'), j.scheduledOn('Creatine', '2026-10-01')]; });
    expect(sch).toEqual([true, false, true, false, true, false]);
  });

  test('the sheet moves Day 1: seven days, the sessions it gives, SAVE restarts the cycle and the check-offs stay', async ({ page }) => {
    await seedJump(page, day(4));
    await page.click('#tab-habits');
    await page.evaluate(() => { const hs = JSON.parse(localStorage.getItem('hb_habits') || '[]'); const h = hs.find((x: any) => x.name === 'Explosion Squats (5 sets)'); (document.querySelector('#habit-list .habit-item[data-id="' + h.id + '"]') as HTMLElement).click(); });
    await expect(page.locator('#completed-count')).toHaveText('1');
    await page.evaluate(() => { document.querySelectorAll('#statup-ov, #ach-popup').forEach((x) => x.remove()); (document.getElementById('fa-program-guide') as HTMLElement).click(); });
    const sh = page.locator('#jump-sh');
    await expect(sh).toHaveClass(/jump-sh--on/);
    await expect(sh.locator('[data-jump-t]')).toHaveText('Change start day');
    await expect(sh.locator('[data-jump-save]')).toBeDisabled();                       // Day 1 (Fri 2 Oct) is behind us: nothing is preselected
    expect(await sh.locator('.jd-chip').allTextContents()).toEqual(['TODAY', 'TUE6', 'WED7', 'THU8', 'FRI9', 'SAT10', 'SUN11']);
    await page.evaluate(() => (document.querySelectorAll('#jump-sh .jd-chip')[2] as HTMLElement).click());
    await expect(sh.locator('.jd-chip--on')).toHaveText('WED7');
    await expect(sh.locator('[data-jump-note]')).toHaveText('SESSIONS · WED 7 · SAT 10 · WED 14 · SAT 17');
    await page.evaluate(() => (document.querySelector('#jump-sh [data-jump-save]') as HTMLElement).click());
    await expect(sh).not.toHaveClass(/jump-sh--on/);
    expect(await page.evaluate(() => localStorage.getItem('hb_jump_program_started'))).toBe('2026-10-07');
    expect(await guide(page)).toEqual(['DAY 1 STARTS WED', 'Keep the dailies until then.']);
    expect((await listed(page)).slice().sort()).toEqual(DAILIES.slice().sort());
    expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('hb_completions') || '{}')['2026-10-05'] || []).length)).toBe(1);   // the check-off is still in the book
    // the same row replays the walkthrough
    await page.evaluate(() => (document.getElementById('fa-program-guide') as HTMLElement).click());
    await expect(sh.locator('[data-jump-how]')).toHaveText('How the program works');
  });

  test('an account on the prototype program is moved over: old exercises archived, the manual added, and it is asked for its start day', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await freshApp(page);
    await page.addInitScript((quiet) => {
      try {
        if (sessionStorage.getItem('__w1021m')) return;
        sessionStorage.setItem('__w1021m', '1');
        const mk = (id: string, name: string, cd?: number[]) => Object.assign({ id, name, emoji: '•', difficulty: 'easy', type: 'build', library: 'jump_program', primaryStat: 'STR' }, cd ? { cycleDays: cd } : {});
        localStorage.setItem('hb_habits', JSON.stringify([
          mk('o1', 'Creatine'), mk('o2', 'Sunlight'), mk('o3', 'Daily Protein Goal'),
          mk('o4', 'Proper Sprint & CNS Warmup', [1, 8]), mk('o5', 'Depth Jumps (4x5)', [1]), mk('o6', 'Max Effort Jumps (4x3)', [1, 3, 8, 10]),
          mk('o7', 'Heavy Barbell Back Squats (5x5)', [5, 12]), { id: 'c1', name: 'Call a friend', emoji: '⚡', difficulty: 'easy', type: 'build', primaryStat: 'WILL', custom: true },
        ]));
        localStorage.setItem('hb_onboarding_goal', 'jump_program');
        localStorage.setItem('hb_jump_program_started', '2026-08-20');
        localStorage.setItem('hb_completions', JSON.stringify({ '2026-09-07': ['o5', 'o1'] }));
        localStorage.setItem('hb_points', '500');
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        (quiet as string[]).forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_achievements', JSON.stringify(['first_step', 'first_blood', 'getting_started']));
      } catch (_) {}
    }, QUIET);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { const s = document.getElementById('awakened-splash'); if (s) s.remove(); });
    const st = await page.evaluate(() => {
      const hs = JSON.parse(localStorage.getItem('hb_habits') || '[]') as Array<{ id: string; name: string; archived?: boolean; cycleDays?: number[] }>;
      return {
        archived: hs.filter((h) => h.archived).map((h) => h.id).sort(),
        active: hs.filter((h) => !h.archived).length,
        training: hs.filter((h) => !h.archived && h.cycleDays).length,
        custom: hs.some((h) => h.id === 'c1' && !h.archived),
        v: localStorage.getItem('hb_jump_v'), start: localStorage.getItem('hb_jump_program_started'),
        book: (JSON.parse(localStorage.getItem('hb_completions') || '{}')['2026-09-07'] || []).length,
      };
    });
    expect(st).toEqual({ archived: ['o4', 'o5', 'o6', 'o7'], active: 23, training: 19, custom: true, v: '2', start: null, book: 2 });
    // no start day: the dailies and the custom vow only, the row asks, and the sheet opens once
    expect((await listed(page)).slice().sort()).toEqual(DAILIES.concat(['Call a friend']).sort());
    expect(await guide(page)).toEqual(['PICK YOUR START DAY', 'Tap to choose when Day 1 begins.']);
    const sh = page.locator('#jump-sh');
    await expect(sh).toHaveClass(/jump-sh--on/, { timeout: 8_000 });
    await expect(sh.locator('[data-jump-t]')).toHaveText('When do you start?');
    await expect(sh.locator('.jd-chip--on')).toHaveText('TODAY');
    await page.evaluate(() => (document.querySelector('#jump-sh [data-jump-save]') as HTMLElement).click());
    expect(await page.evaluate(() => localStorage.getItem('hb_jump_program_started'))).toBe('2026-10-05');
    expect(await guide(page)).toEqual(['DAY 1 OF 14 · PLYOMETRICS', '8 exercises today, in order.']);
    expect((await listed(page)).filter((x) => DAILIES.indexOf(x) < 0 && x !== 'Call a friend')).toEqual(D1);
  });

  test('onboarding asks the Jump Program for its start day, and no other path', async ({ page }) => {
    test.slow();   // three first runs, the last one walked end to end
    await page.clock.setFixedTime(NOW);
    // W1050 — a sworn banner cannot be unsworn, so each path gets its own first
    // run (obFirstRun wipes the same keys on every load). The other two paths
    // go from SWEAR IT straight through the Gate with no question in between (W1056).
    for (const pack of ['custom', 'morning']) {
      await obFirstRun(page);
      await obGo(page, 'vow');
      await obOn(page, 'vow');
      await page.locator('[data-cn-pack="' + pack + '"]').click();
      await page.locator('#cn-enter').click();
      await expect(page.locator(OB + ' .ob4-hand'), pack).toHaveClass(/is-on/, { timeout: 4_000 });
      await expect(page.locator(OB + ' .ob4-sub-when'), pack).not.toHaveClass(/is-on/);
      await expect(page.locator(OB + ' .ob4-vow-t'), pack).toHaveText('Choose a path.');
      await expect(page.locator('#cn-jdays .jd-chip'), pack).toHaveCount(0);
    }

    // The Jump Program, walked the way a hunter walks it.
    await obFirstRun(page);
    await obWorld(page, { today: 7318, week: 31204, board: { ok: true, metric: 'step_total', me: { rank: 1, current_value: 31204 }, top: [] } });
    await obName(page, 'Richie');
    await page.locator('#cn-healthBtn').click();
    await obRevealToWolf(page);
    await obStrike(page);
    await page.locator('#cn-wolfNext').click();
    await obOn(page, 'hunt');   // nobody else on the board: walked past
    await page.locator('#cn-huntAlone').click();
    await obOn(page, 'ascent');
    await page.locator('#cn-ascentNext').click();
    await obOn(page, 'vow');

    const btn = page.locator('#cn-enter');
    await page.locator('[data-cn-pack="jump_program"]').click();
    await btn.click();   // SWEAR IT
    await expect(page.locator(OB + ' .ob4-vow-t')).toHaveText('When do you start?');
    await expect(page.locator(OB + ' .ob4-sub-when')).toHaveClass(/is-on/);
    await expect(btn).toHaveText('Enter');
    const chips = page.locator('#cn-jdays .jd-chip');
    expect(await chips.allTextContents()).toEqual(['TODAY', 'TUE6', 'WED7', 'THU8', 'FRI9', 'SAT10', 'SUN11']);
    await expect(page.locator('#cn-jdays .jd-chip--on')).toHaveText('TODAY');
    await expect(page.locator('#cn-jnote')).toHaveText('SESSIONS · MON 5 · THU 8 · MON 12 · THU 15');
    await chips.nth(2).click();
    await expect(page.locator('#cn-jdays .jd-chip--on')).toHaveText('WED7');
    await expect(page.locator('#cn-jnote')).toHaveText('SESSIONS · WED 7 · SAT 10 · WED 14 · SAT 17');
    // The start day is the only question this path is asked: ENTER is next.
    await btn.click();
    await obFinish(page);   // the notification ask stands between ENTER and the vows being made

    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('hb_habits') || '[]') as Array<{ archived?: boolean }>).filter((h) => !h.archived).length), { timeout: 8_000 }).toBe(22);
    const r = await page.evaluate(() => ({
      start: localStorage.getItem('hb_jump_program_started'), v: localStorage.getItem('hb_jump_v'), goal: localStorage.getItem('hb_onboarding_goal'), path: localStorage.getItem('hb_path'),
    }));
    expect(r).toEqual({ start: '2026-10-07', v: '2', goal: 'jump_program', path: 'jump_program' });
    // before Day 1 the list is the dailies, and the row says when Day 1 begins
    await expect.poll(async () => (await listed(page)).slice().sort(), { timeout: 8_000 }).toEqual(DAILIES.slice().sort());
    expect(await guide(page)).toEqual(['DAY 1 STARTS WED', 'Keep the dailies until then.']);
  });
});

// W1023 — "finish strong": one reminder at 9:45 PM device-local, only for a hunter who is nearly
// at a perfect day (82%+ of today's vows sealed, or exactly one left). Today only; a hunter's own
// quiet hours win; nothing for anyone else.
test.describe('BV · Finish strong (W1023)', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  const AT_2PM = new Date('2026-10-05T14:00:00-07:00');   // a Monday
  const QUIET = ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_first_vow_pointer_seen'];
  // `n` custom vows, the first `sealed` of them kept today (the names are not goal-based ones).
  async function seed(page: Page, n: number, sealed: number, extra?: Record<string, string>, at?: Date) {
    await page.clock.setFixedTime(at || AT_2PM);
    await freshApp(page);
    await page.addInitScript(([count, done, ex, quiet]) => {
      try {
        if (sessionStorage.getItem('__w1023')) return;
        sessionStorage.setItem('__w1023', '1');
        const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
        const hs = Array.from({ length: count as number }, (_, i) => ({ id: 'v' + i, name: 'Vow number ' + (i + 1), emoji: '•', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'WILL' }));
        localStorage.setItem('hb_habits', JSON.stringify(hs));
        localStorage.setItem('hb_completions', JSON.stringify({ '2026-10-01': ['v0'], [ymd]: hs.slice(0, done as number).map((h) => h.id) }));
        localStorage.setItem('hb_stats', JSON.stringify({ STR: { pts: 0 }, VIT: { pts: 0 }, INT: { pts: 0 }, FOCUS: { pts: 0 }, WILL: { pts: 60 }, WLT: { pts: 0 } }));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        (quiet as string[]).forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_achievements', JSON.stringify(['first_step', 'first_blood', 'getting_started']));
        Object.keys(ex as Record<string, string>).forEach((k) => localStorage.setItem(k, (ex as Record<string, string>)[k]));
      } catch (_) {}
    }, [n, sealed, extra || {}, QUIET] as [number, number, Record<string, string>, string[]]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }
  // Arm the reminder against a stand-in for the phone's notification plugin; returns what was scheduled.
  const arm = (page: Page) => page.evaluate(async () => {
    const w = window as any;
    const calls: any[] = [], cancels: number[] = [];
    const prev = w.Capacitor;
    w.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
      schedule: async (o: any) => { o.notifications.forEach((n: any) => calls.push({ id: n.id, title: n.title, body: n.body, at: new Date(n.schedule.at).getTime(), kind: n.extra && n.extra.kind })); },
      cancel: async (o: any) => { o.notifications.forEach((n: any) => cancels.push(n.id)); },
      getPending: async () => ({ notifications: [] }), checkPermissions: async () => ({ display: 'granted' }),
    } } };
    let ok = false;
    try { ok = await w.Notif.scheduleLastCall(); } finally { w.Capacitor = prev; }
    return { ok, calls, cancels };
  });

  test('who gets it: 82% or more, or exactly one vow left — never a perfect day, never an untouched one', async ({ page }) => {
    await seed(page, 6, 5);
    const r = await page.evaluate(() => { const e = (window as any).__lastCall.eligible; return [[23, 25], [21, 25], [20, 25], [4, 5], [3, 5], [1, 2], [25, 25], [0, 1], [0, 25], [0, 0]].map((p) => e(p[0], p[1])); });
    expect(r).toEqual([true, true, false, true, false, true, false, false, false, false]);
  });

  test('one vow left: 9:45 PM today, and the reminder names the vow', async ({ page }) => {
    await seed(page, 6, 5);
    const copy = await page.evaluate(() => (window as any).__lastCall.copy());
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.body).toContain('Vow number 6');
    const r = await arm(page);
    expect(r.ok).toBe(true);
    expect(r.calls.length).toBe(1);
    expect(r.calls[0].id).toBe(99991);
    expect(r.calls[0].kind).toBe('lastcall');
    expect(r.calls[0].at).toBe(new Date('2026-10-05T21:45:00-07:00').getTime());
    expect(r.calls[0].body).toContain('Vow number 6');
    expect(r.cancels).toContain(99991);   // re-arming always replaces the last one
  });

  test('two left of 25 counts them; 20 of 25 gets nothing; a perfect day gets nothing', async ({ page }) => {
    await seed(page, 25, 23);
    const r = await arm(page);
    expect(r.ok).toBe(true);
    expect(r.calls[0].title + ' ' + r.calls[0].body).toMatch(/\b2\b/);
    expect(r.calls[0].title + ' ' + r.calls[0].body).not.toMatch(/\{|\bfell(ed)?\b/i);
    // seal one more from the list: still eligible, now it names the last vow
    await page.evaluate(() => (document.querySelector('#habit-list .habit-item[data-id="v23"]') as HTMLElement).click());
    const one = await page.evaluate(() => (window as any).__lastCall.copy());
    expect(one.body).toContain('Vow number 25');
    // and the last: the day is perfect, nothing is scheduled
    await page.evaluate(() => { document.querySelectorAll('#statup-ov, #ach-popup').forEach((x) => x.remove()); (document.querySelector('#habit-list .habit-item[data-id="v24"]') as HTMLElement).click(); });
    expect(await page.evaluate(() => (window as any).__lastCall.copy())).toBeNull();
    const done = await arm(page);
    expect([done.ok, done.calls.length]).toEqual([false, 0]);
  });

  test('not eligible, too late, or told to be quiet: nothing is scheduled', async ({ page }) => {
    await seed(page, 25, 20);                                    // 80%, five left
    expect(await page.evaluate(() => (window as any).__lastCall.copy())).toBeNull();
    expect((await arm(page)).calls.length).toBe(0);
    // the clock: 9:45 PM today when it is still ahead, nothing once it has passed (never tomorrow)
    const t = await page.evaluate(() => { const f = (window as any).__lastCall.fireAt; return [f(Date.parse('2026-10-05T14:00:00-07:00')), f(Date.parse('2026-10-05T21:45:00-07:00')), f(Date.parse('2026-10-05T22:10:00-07:00'))]; });
    expect(t).toEqual([new Date('2026-10-05T21:45:00-07:00').getTime(), null, null]);
  });

  test('a hunter whose own quiet hours cover 9:45 PM, or who turned reminders off, is left alone', async ({ page }) => {
    await seed(page, 6, 5, { hb_notif_quiet_start: '21:00' });
    expect((await arm(page)).calls.length).toBe(0);
    await page.evaluate(() => { localStorage.removeItem('hb_notif_quiet_start'); });
    expect((await arm(page)).calls.length).toBe(1);              // the default 10 PM–7 AM window does not cover it
    await page.evaluate(() => { localStorage.setItem('hb_notif_disabled', '1'); });
    expect((await arm(page)).calls.length).toBe(0);
  });
});

test.describe('BV · Finish strong, west of Pacific (W1023)', () => {
  test.use({ timezoneId: 'Pacific/Honolulu' });
  test('where 9:45 PM local is already the next Pacific day, there is no reminder', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T14:00:00-10:00'));
    await freshApp(page);
    // 9:45 PM in Honolulu is 12:45 AM Pacific: the habit day has turned
    expect(await page.evaluate(() => (window as any).__lastCall.fireAt(Date.parse('2026-10-05T14:00:00-10:00')))).toBeNull();
  });
});

// W1027 — "today's steps" is the DEVICE's own day. It was the Pacific date at the device's
// midnight: right in Pacific time, and east of it a late-night read returned all of yesterday
// and filed it under today, so the week held that day twice and a new week opened already
// holding Saturday (Anthony, Central time: the board froze at Saturday's count for two days).
for (const c of [
  { tz: 'America/Chicago',     now: '2026-10-04T05:30:00Z', start: '2026-10-04T05:00:00.000Z', why: 'Sunday 12:30 AM Central is still Saturday in Pacific: the count starts at Sunday midnight Central, not Saturday' },
  { tz: 'America/Los_Angeles', now: '2026-10-04T05:30:00Z', start: '2026-10-03T07:00:00.000Z', why: 'Pacific time is unchanged: Saturday midnight Pacific' },
  { tz: 'Pacific/Honolulu',    now: '2026-10-04T08:00:00Z', start: '2026-10-03T10:00:00.000Z', why: 'Saturday 10 PM in Honolulu is already Sunday in Pacific: the count still starts at Saturday midnight Honolulu, never in the future' },
]) {
  test.describe('BW · Steps today is the device day (W1027) · ' + c.tz, () => {
    test.use({ timezoneId: c.tz });
    test(c.why, async ({ page }) => {
      await page.clock.setFixedTime(new Date(c.now));
      await freshApp(page);
      const start = await page.evaluate(() => (window as any).Health._stepsTodayStartISO());
      expect(start).toBe(c.start);
      expect(Date.parse(start)).toBeLessThanOrEqual(Date.parse(c.now));
    });
  });
}

// W1029 — the pop-up says "Achievement unlocked"; the list is Habits › LEDGER › MARKS and nothing
// joined the two (a hunter at S+ asked where the achievements are). A tap on a real achievement
// now opens that list; left alone it still goes away by itself.
test.describe('BX · The pop-up leads to the marks (W1029)', () => {
  async function hunter(page: Page, unlocked: boolean) {
    await freshApp(page);
    await page.addInitScript((open: boolean) => {
      try {
        if (sessionStorage.getItem('__w1029')) return;
        sessionStorage.setItem('__w1029', '1');
        const old = new Date(); old.setDate(old.getDate() - 5);
        const oymd = old.getFullYear() + '-' + String(old.getMonth() + 1).padStart(2, '0') + '-' + String(old.getDate()).padStart(2, '0');
        localStorage.setItem('hb_habits', JSON.stringify([{ id: 'w1029-a', name: 'First vow', emoji: '•', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'WILL' }]));
        localStorage.setItem('hb_onboarding_first_xp_date', oymd);
        if (open) localStorage.setItem('hb_history_unlocked_v1', '1');
        ['hb_first_completion_bonus_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_tour_day3_v1', 'hb_tour_day7_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
      } catch (_) {}
    }, unlocked);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { document.querySelectorAll('#awakened-splash').forEach((x) => x.remove()); (document.getElementById('tab-profile') as HTMLElement).click(); });
  }
  const show = (page: Page, ach: Record<string, string>) => page.evaluate((a) => (window as any).__ach.show(a), ach);
  const WEEK = { id: 'week_warrior', category: 'streaks', name: 'Week Warrior', desc: '7-day streak on any habit' };

  test('a tap on a real achievement opens Habits › LEDGER › MARKS, from any tab', async ({ page }) => {
    await hunter(page, true);
    await show(page, WEEK);
    const pop = page.locator('#ach-popup');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.ach-popup-hint')).toHaveText('Tap to see your marks');
    await pop.click();
    await expect(pop).toBeHidden();
    await expect(page.locator('.hg-view-tab--active')).toHaveText('MARKS');
    await expect(page.locator('#history-content .hg-ach-header')).toBeVisible();
    await expect(page.locator('#history-content .hg-ach-row').first()).toBeVisible();
  });

  test('left alone it only goes away; an ad-hoc pop-up and a locked Ledger only dismiss', async ({ page }) => {
    await hunter(page, true);
    // an ad-hoc pop-up (a stat bonus, weekend warrior) is not in the list: it only dismisses
    await show(page, { name: 'Weekend Warrior', desc: 'Double XP today', label: 'BONUS' });
    const pop = page.locator('#ach-popup');
    await expect(pop.locator('.ach-popup-hint')).toHaveText('Tap to dismiss');
    await pop.click();
    await expect(pop).toBeHidden();
    await expect(page.locator('#status-content')).toBeVisible();          // still on the Status tab
    // a real one, never tapped: gone after four seconds, and the hunter is where they were
    await page.waitForTimeout(600);
    await show(page, WEEK);
    await expect(pop).toBeVisible();
    await expect(pop).toBeHidden({ timeout: 6_000 });
    await expect(page.locator('#status-content')).toBeVisible();
    // the Ledger not open yet: there is nowhere to lead, so the hint does not promise it
    await page.evaluate(() => { localStorage.removeItem('hb_history_unlocked_v1'); });
    const locked = await page.evaluate(() => { (window as any).__ach.show({ id: 'week_warrior', name: 'Week Warrior', desc: 'x' }); return ((document.querySelector('#ach-popup .ach-popup-hint') as HTMLElement).textContent); });
    expect(locked).toBe('Tap to dismiss');
  });
});

// W1030 — the first-boss rating moment is not thrown away when the first boss comes on a hunter's
// first day (day one stays quiet, and most new hunters beat a boss on it). It stays OWED, and the
// next boss win after day one pays it, on a card that no longer says "First".
test.describe('BY · The first-boss moment survives day one (W1030)', () => {
  // A day `off` days from today, as the BROWSER counts days. ('@day:-1' is turned into a date
  // inside the page: a date made in the test process can be a day ahead of the browser's, since
  // the process runs in UTC and the browser in the machine's zone, and these specs then failed
  // every evening on a Pacific machine.)
  const ymd = (off: number) => '@day:' + off;
  const state = (page: Page, keys: Record<string, string | null>, keep = false) => page.evaluate(({ k, keep }) => {
    const day = (v: string) => { if (v.indexOf('@day:') !== 0) return v; const d = new Date(); d.setDate(d.getDate() + Number(v.slice(5))); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    if (!keep) ['hb_review_first_boss_done', 'hb_review_boss_owed', 'hb_rm_shown_v1', 'hb_onboarding_first_xp_date'].forEach((x) => localStorage.removeItem(x));
    Object.keys(k).forEach((x) => { if (k[x] != null) localStorage.setItem(x, day(k[x] as string)); });
  }, { k: keys, keep });
  const moment = (page: Page) => page.evaluate(() => { const m = (window as any).__rm.bossMoment(); return [m, localStorage.getItem('hb_review_first_boss_done'), localStorage.getItem('hb_review_boss_owed')]; });

  test('day one: no card and the moment is owed; the next win after day one pays it, once', async ({ page }) => {
    await freshApp(page);
    await state(page, { hb_onboarding_first_xp_date: ymd(0) });
    expect(await moment(page)).toEqual([null, '1', '1']);            // the first boss, on day one: quiet, but owed
    expect(await moment(page)).toEqual([null, '1', '1']);            // a second boss the same day: still quiet
    await state(page, { hb_onboarding_first_xp_date: ymd(-1) }, true);   // the same hunter, a day later
    expect(await moment(page)).toEqual(['owed', '1', '1']);          // day two: this win is the moment
    expect(await moment(page)).toEqual(['owed', '1', '1']);          // and stays so until the card is really shown
    await page.evaluate(() => localStorage.setItem('hb_rm_shown_v1', JSON.stringify(['boss'])));
    expect((await moment(page))[0]).toBeNull();                      // shown once, ever
  });

  test('off day one the true first boss is still "first"; a veteran is not handed a late card; a recent joiner from an older build is', async ({ page }) => {
    await freshApp(page);
    await state(page, { hb_onboarding_first_xp_date: ymd(-5) });
    expect(await moment(page)).toEqual(['first', '1', '1']);
    await state(page, { hb_onboarding_first_xp_date: ymd(-60), hb_review_first_boss_done: '1' });
    expect(await moment(page)).toEqual([null, '1', '0']);            // joined long ago: nothing owed
    await state(page, { hb_onboarding_first_xp_date: ymd(-1), hb_review_first_boss_done: '1' });
    expect(await moment(page)).toEqual(['owed', '1', '1']);          // Kristy's case: first boss on day one, on 3.0.9
  });

  test('the owed card does not claim a first: "Boss defeated", no "first kill"', async ({ page }) => {
    await freshApp(page);
    await page.evaluate(() => (window as any).__rm.show('boss', { bossName: 'The Glass Strider', bossRank: 'E', first: false }, { preview: true }));
    await expect(page.locator('#review-pp-overlay .rm-eyebrow')).toHaveText('Boss defeated');
    await expect(page.locator('#review-pp-overlay .rm-stat')).toHaveText('E-rank boss');
    await page.evaluate(() => (window as any).__rm.show('boss', { bossName: 'The Steel Wolf', bossRank: 'E', first: true }, { preview: true }));
    await expect(page.locator('#review-pp-overlay .rm-eyebrow')).toHaveText('First boss defeated');
    await expect(page.locator('#review-pp-overlay .rm-stat')).toHaveText('E-rank boss · first kill');
  });
});

// W1032 — a bought skin that was never worn goes on at the next launch. The purchase flow equips
// a skin when it unlocks, but a late store confirmation leaves it waiting in the wardrobe (the
// first paying hunter was still in the free Ranger look three days after buying Dawnbringer).
test.describe('BZ · A bought skin gets worn (W1032)', () => {
  // The server's answer for this hunter: `skins` oldest purchase first.
  const refresh = (page: Page, skins: string[]) => page.evaluate(async (owned) => {
    const w = window as any;
    const keep = w.Auth.fetchEntitlements;
    w.Auth.fetchEntitlements = async () => ({ ok: true, skins: owned, premium: false, member: false, founder_seq: null });
    try { await w.__skins.refresh(); } finally { w.Auth.fetchEntitlements = keep; }
    return { equipped: w.__skins.equipped(), worn: w.__skins.worn() };
  }, skins);
  const DAWN = 'avatar-skin-dawnbringer.png', STAR = 'avatar-skin-stardust.png', NULLP = 'avatar-skin-nullprotocol.png';

  test('owned, never worn, in a free look: it goes on once — and taking it off afterwards sticks', async ({ page }) => {
    await freshApp(page);
    await page.evaluate(() => { localStorage.setItem('hb_avatar_skin', 'avatar-ranger.png'); localStorage.removeItem('hb_skins_worn_v1'); });
    const first = await refresh(page, [DAWN]);
    expect(first).toEqual({ equipped: DAWN, worn: [DAWN] });
    await expect(page.locator('.habit-toast')).toContainText('Dawnbringer is on');
    // the hunter takes it off: it is never put back for them
    await page.evaluate(() => localStorage.setItem('hb_avatar_skin', 'avatar-ranger.png'));
    expect((await refresh(page, [DAWN])).equipped).toBe('avatar-ranger.png');
  });

  test('a hunter already in a paid look is left alone; a skin bought later still goes on', async ({ page }) => {
    await freshApp(page);
    await page.evaluate((n) => { localStorage.setItem('hb_avatar_skin', n); localStorage.removeItem('hb_skins_worn_v1'); }, NULLP);
    // first time the list is kept: everything owned counts as seen, nothing changes
    expect(await refresh(page, [STAR, DAWN, NULLP])).toEqual({ equipped: NULLP, worn: [STAR, DAWN, NULLP] });
    // a NEW purchase whose unlock came late: the newest one goes on at the next check
    const next = await refresh(page, [STAR, DAWN, NULLP, 'avatar-skin-emberforged.png']);
    expect(next.equipped).toBe('avatar-skin-emberforged.png');
    expect(next.worn).toContain('avatar-skin-emberforged.png');
  });

  test('nothing owned changes nothing; the wardrobe being open is left to the hunter', async ({ page }) => {
    await freshApp(page);
    await page.evaluate(() => { localStorage.setItem('hb_avatar_skin', 'avatar-ranger.png'); localStorage.removeItem('hb_skins_worn_v1'); });
    expect((await refresh(page, [])).equipped).toBe('avatar-ranger.png');
    await page.evaluate(() => (window as any).__openWardrobe());
    expect((await refresh(page, [DAWN])).equipped).toBe('avatar-ranger.png');        // choosing right now: hands off
    await page.evaluate(() => { document.getElementById('wd-sheet')!.classList.add('hidden'); document.getElementById('wd-overlay')!.classList.add('hidden'); });
    expect((await refresh(page, [DAWN])).equipped).toBe(DAWN);                        // closed without wearing it: now it goes on
  });
});

// W1014 — the Monday recap: the first briefing of a new week leads with last week (Mon–Sun PST)
// in 1-3 plain sentences. Clock pinned to Monday 5 Oct 2026, 9:00 AM PST; last week = Sep 28 – Oct 4.
test.describe('BS · Monday recap (W1014)', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  const MON = new Date('2026-10-05T09:00:00-07:00');
  const pt = (off: number) => { const d = new Date(2026, 9, 5 + off, 12); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const VOWS = ['a', 'b', 'c', 's'].map((id, i) => ({ id, name: ['Get morning sunlight', 'Read', 'Meditate', 'Sleep'][i], emoji: '•', difficulty: 'easy', type: 'build' }));
  // days: offsets -7..-1 are last week (Mon..Sun); -28..-8 the three weeks before
  async function seed(page: Page, lastWeek: (off: number) => string[], before: (off: number) => string[], at: Date = MON) {
    const comp: Record<string, string[]> = {};
    for (let off = -28; off <= -1; off++) { const ids = off >= -7 ? lastWeek(off) : before(off); if (ids.length) comp[pt(off)] = ids; }
    await page.clock.setFixedTime(at);
    await freshApp(page);
    await page.addInitScript(([hs, c]) => {
      try {
        if (sessionStorage.getItem('__w1014')) return;
        sessionStorage.setItem('__w1014', '1');
        localStorage.setItem('hb_habits', JSON.stringify(hs));
        localStorage.setItem('hb_completions', JSON.stringify(c));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
      } catch (_) {}
    }, [VOWS, comp] as [any[], Record<string, string[]>]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }
  const card = (page: Page) => page.evaluate(() => {
    const c = document.querySelector('#tb-root .tb-wk'); if (!c) return null;
    return { range: (c.querySelector('.tb-wkh span:last-child') as HTMLElement).textContent, of: (c.querySelector('.tb-wkn .tb-mono') as HTMLElement).textContent,
      lines: Array.from(c.querySelectorAll('.tb-wkt p')).map((p) => p.textContent), gold: c.classList.contains('tb-wk--gold'),
      dots: Array.from(c.querySelectorAll('.tb-wkdd')).map((d) => (d.className.match(/tb-wkdd--(\w)/) || [])[1] || '-').join('') };
  });
  const show = (page: Page) => page.evaluate(() => (window as any).__tb.show({}));
  async function holdSeal(page: Page) {
    const box = (await page.locator('#tb-root .tb-seal').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(1150); await page.mouse.up();
  }

  test('a normal week: the count, the hardest vow, and it leads today; seen once — the next briefing this week goes back to yesterday', async ({ page }) => {
    // three weeks of everything kept, then last week Sleep only Mon/Wed/Fri
    await seed(page, (off) => ['a', 'b', 'c'].concat([-7, -5, -3].includes(off) ? ['s'] : []), () => ['a', 'b', 'c', 's']);
    await show(page);
    await expect(page.locator('#tb-root .tb-wk')).toBeVisible({ timeout: 5_000 });
    expect(await card(page)).toEqual({ range: 'SEP 28 – OCT 4', of: 'of 28 vows', gold: false, dots: 'pkpkpkk',
      lines: ['Sleep was your hardest vow: 3 of 7 days.', 'It’s first on today’s list.'] });   // W1019 — never the count the card shows
    await expect(page.locator('#tb-root [data-tb-wkn]')).toHaveText('24', { timeout: 3_000 });
    await expect(page.locator('#tb-root .tb-yest')).toHaveCount(0);                          // last week replaces yesterday
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_brief_lead_v1') || 'null'))).toEqual({ date: '2026-10-05', id: 's' });
    await page.waitForTimeout(1500);
    await holdSeal(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('hb_week_recap_seen')), { timeout: 4_000 }).toBe('2026-10-05');
    await page.waitForTimeout(2000);
    await show(page);
    await expect(page.locator('#tb-root .tb-yest')).toBeVisible();
    await expect(page.locator('#tb-root .tb-wk')).toHaveCount(0);
    // the owner's preview always shows it
    await page.evaluate(() => (window as any).__previewTodaysBriefing());
    await expect(page.locator('#tb-root .tb-wk')).toBeVisible();
  });

  test('a perfect week is one gold line; a best week names itself and suggests a weekly goal for a vow kept once', async ({ page }) => {
    await seed(page, () => ['a', 'b', 'c', 's'], () => ['a', 'b', 'c', 's']);
    await show(page);
    await expect(page.locator('#tb-root .tb-wk')).toBeVisible({ timeout: 5_000 });
    expect(await card(page)).toMatchObject({ gold: true, dots: 'ppppppp', lines: ['A perfect week: every vow, all 7 days.'] });
    await expect(page.locator('#tb-root .tb-wk')).toHaveClass(/tb-wk--pop/, { timeout: 3_000 });
  });

  test('best week: more kept than any of the weeks before; the vow kept once gets the 3-a-week suggestion', async ({ page }) => {
    // the weeks before: a, b daily; c and s only on Mondays → 16 a week. Last week: a, b, c daily + s once → 22.
    const monday = (off: number) => [-28, -21, -14].includes(off);
    await seed(page, (off) => ['a', 'b', 'c'].concat(off === -4 ? ['s'] : []), (off) => ['a', 'b'].concat(monday(off) ? ['c', 's'] : []));
    await show(page);
    await expect(page.locator('#tb-root .tb-wk')).toBeVisible({ timeout: 5_000 });
    expect(await card(page)).toMatchObject({ gold: true, lines: ['Your best week yet.', 'Sleep was your hardest vow: 1 of 7 days.', 'If every day is too much, make it 3 times a week.'] });
    expect(await page.evaluate(() => localStorage.getItem('hb_brief_lead_v1'))).toBeNull();   // a suggestion, not a lead
  });

  // W1015 — DeepSeek writes the words from the phone's facts; the rules sentence is the fallback.
  const normal = (off: number) => ['a', 'b', 'c'].concat([-7, -5, -3].includes(off) ? ['s'] : []);
  const RULES = ['Sleep was your hardest vow: 3 of 7 days.', 'It’s first on today’s list.'];
  test('W1015: the words come from the server when ready — only facts are sent, never a name; stored for the week', async ({ page }) => {
    await seed(page, normal, () => ['a', 'b', 'c', 's']);
    await page.evaluate(() => {
      (window as any).__recapCalls = [];
      (window as any).Auth.fetchRecapText = async (ws: string, facts: unknown) => { (window as any).__recapCalls.push({ ws, facts }); return { ok: true, source: 'ai', text: ['You kept 24 of 28 vows, and Read held at 7 of 7.', 'Sleep came in at 3 of 7; it is first on today’s list.'] }; };
      localStorage.removeItem('hb_recap_ai');
    });
    await show(page);
    await expect.poll(() => card(page).then((c) => c && c.lines), { timeout: 4_000 }).toEqual(['You kept 24 of 28 vows, and Read held at 7 of 7.', 'Sleep came in at 3 of 7; it is first on today’s list.']);
    const calls = await page.evaluate(() => (window as any).__recapCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].ws).toBe('2026-10-05');
    expect(calls[0].facts).toEqual({ kept: 24, total: 28, best: false, perfect_week: false, perfect_days: 3, days_active: 7,
      weak: { name: 'Sleep', kept: 3, of: 7, weekly: false }, missed: null, suggestion: 'first_today' });
    expect(JSON.stringify(calls[0].facts)).not.toMatch(/alias|steps|sleep_min|user/i);
    // a second look this week: the stored words, at once, no second call
    await page.evaluate(() => (window as any).__tb.show({}));
    expect((await card(page))!.lines).toEqual(['You kept 24 of 28 vows, and Read held at 7 of 7.', 'Sleep came in at 3 of 7; it is first on today’s list.']);
    await expect(page.locator('#tb-root .tb-wkt--wait')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__recapCalls.length)).toBe(1);
  });

  test('W1015: when the server is slow or has no words, the rules sentence lands after a short wait', async ({ page }) => {
    await seed(page, normal, () => ['a', 'b', 'c', 's']);
    await page.evaluate(() => { (window as any).Auth.fetchRecapText = () => new Promise(() => {}); localStorage.removeItem('hb_recap_ai'); });
    await show(page);
    await expect(page.locator('#tb-root .tb-wkt--wait')).toHaveCount(1);
    await expect.poll(() => card(page).then((c) => c && c.lines), { timeout: 4_000 }).toEqual(RULES);
    // no key on the server (text: null) — straight to the rules sentence
    await page.evaluate(() => { (window as any).Auth.fetchRecapText = async () => ({ ok: true, text: null, source: 'none' }); (window as any).__tb.show({}); });
    await expect.poll(() => card(page).then((c) => c && c.lines), { timeout: 3_000 }).toEqual(RULES);
  });

  test('W1019: a near-perfect week names exactly what was missed and when — never the count the card already shows', async ({ page }) => {
    // everything kept except Read and Sleep on Saturday (2 misses)
    await seed(page, (off) => off === -2 ? ['a', 'c'] : ['a', 'b', 'c', 's'], () => ['a', 'b', 'c', 's']);
    const r = await page.evaluate(() => (window as any).__tb.recap());
    expect(r.lines).toEqual(['Only 2 missed all week: Read and Sleep on Saturday.']);
    expect(r.facts).toMatchObject({ kept: 26, total: 28, weak: null, missed: [{ name: 'Read', day: 'Saturday' }, { name: 'Sleep', day: 'Saturday' }], suggestion: null });
    expect(r.facts).not.toHaveProperty('streak');
    expect(r.facts).not.toHaveProperty('prev_kept');
    expect(r.dots.join('')).toBe('pppppkp');
    expect(r.lines.join(' ')).not.toMatch(/26 of 28/);
  });

  test('a quiet week is one kind line; skipped Monday, it still shows on Tuesday', async ({ page }) => {
    await seed(page, () => [], () => ['a', 'b', 'c', 's'], new Date('2026-10-06T08:00:00-07:00'));
    expect(await page.evaluate(() => (window as any).__tb.recap())).toMatchObject({ K: 0, S: 28, lines: ['Last week was quiet. This week starts fresh today.'] });
    await show(page);
    expect(await card(page)).toMatchObject({ lines: ['Last week was quiet. This week starts fresh today.'], dots: '-------' });
  });
});

// W1008 — the weekly to-do planner (handoff 29). The clock is pinned to Wednesday 30 Sep 2026,
// 10:00 AM PST, so the week is always Sun 27 Sep – Sat 3 Oct with past, today and future days.
test.describe('BR · Weekly to-do planner (W1008)', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  const WED = new Date('2026-09-30T10:00:00-07:00');
  const pt = (off: number) => { const d = new Date(2026, 8, 30 + off, 12); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  async function seed(page: Page, todos: Array<Record<string, unknown>>) {
    await page.clock.setFixedTime(WED);
    await freshApp(page);
    await page.addInitScript((todos) => {
      const pt = (off: number) => { const d = new Date(2026, 8, 30 + off, 12); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      const v = (id: string, name: string) => ({ id, name, emoji: '⚡', difficulty: 'easy', type: 'build', primaryStat: 'VIT' });
      localStorage.setItem('hb_habits', JSON.stringify([v('m1', 'Get morning sunlight'), v('e2', 'Plan tomorrow the night before')]));
      localStorage.setItem('hb_todos_v1', JSON.stringify(todos.map((t) => Object.assign({ rem: null, pri: false, note: '', rep: null, at: 1, done: null, dd: null, xp: false }, t, { due: typeof t.due === 'number' ? pt(t.due) : null, dd: t.dd === '@today' ? pt(0) : (t.dd || null) }))));
      localStorage.setItem('hb_points', '500');
      localStorage.setItem('hb_first_completion_bonus_v1', '1');
      localStorage.setItem('hb_first_vow_pointer_seen', '1');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ done: true }));
      localStorage.setItem('hb_tour_welcome_back_v1', '1');
    }, todos);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { const s = document.getElementById('awakened-splash'); if (s) s.remove(); });
    await page.click('#tab-habits');
    await page.click('[data-vows-view="todo"]');
    await expect(page.locator('#todo-view')).toBeVisible();
  }
  const days = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('#todo-view .todo-day, #todo-view .todo-un')).map((s) => (s as HTMLElement).dataset.todoK + (s.classList.contains('todo-day--fold') ? '~' : '') + ':' + Array.from(s.querySelectorAll('.todo-w')).map((w) => (w as HTMLElement).dataset.todoId).join(',')));
  const ct = (page: Page, k: string) => page.locator('#todo-view [data-todo-k="' + k + '"] .todo-dct');
  const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hb_todos_v1') || '[]'));
  const byId = async (page: Page, id: string) => (await store(page)).find((x: any) => x.id === id);
  const points = async (page: Page) => Number(await page.evaluate(() => localStorage.getItem('hb_points')));
  const toast = (page: Page) => page.evaluate(() => { const t = document.getElementById('todo-toast')!; return (t.classList.contains('todo-toast--on') ? '' : 'off:') + (t.firstElementChild as HTMLElement).textContent; });
  const swipe = (page: Page, id: string) => page.evaluate((id) => {
    const w = document.querySelector('#todo-view .todo-w[data-todo-id="' + id + '"]')!; const row = w.querySelector('.todo-row')!; const r = row.getBoundingClientRect();
    const ev = (type: string, x: number) => row.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: r.top + 28, button: 0 }));
    ev('pointerdown', r.left + 150); for (let i = 1; i <= 6; i++) ev('pointermove', r.left + 150 - 20 * i); ev('pointerup', r.left + 30);
  }, id);
  const box = (page: Page, id: string) => page.evaluate((id) => (document.querySelector('#todo-view .todo-w[data-todo-id="' + id + '"] [data-todo-bx]') as HTMLElement).click(), id);

  test('the week: header, one section per day with today open, past days read OVERDUE, last week rides in today, next week and unscheduled below', async ({ page }) => {
    await seed(page, [
      { id: 'z', t: 'Return the library book', due: -5 },                       // last Friday — carried into today
      { id: 'a', t: 'Send the invoice', due: -1 },                              // yesterday, still open
      { id: 'p', t: 'Pick up the parcel', due: -2, done: WED.getTime() - 86400000, dd: '2026-09-28' },
      { id: 'b', t: 'Buy groceries', due: 0, pri: true }, { id: 'c', t: 'Email the landlord', due: 0, rem: '18:00' },
      { id: 'g', t: 'Water the plants', due: 0, done: WED.getTime() - 1000, dd: '@today', xp: true, rep: { k: 'week' } },
      { id: 'd', t: 'Call Dad', due: 1 }, { id: 'e', t: 'Renew the passport', due: 5 }, { id: 'f', t: 'Fix the bike', due: null },
    ]);
    await expect(page.locator('[data-vows-kicker]')).toHaveText('WEEK 40 · SEP 27 – OCT 3');
    await expect(page.locator('[data-vows-title]')).toHaveText('Plan the week');
    await expect(page.locator('#vows-header .vows-manage-btn')).toBeHidden();
    await expect(page.locator('[data-todo-n]').first()).toHaveText('4');             // W1016 — today's list only: z a (overdue) + b c (today); not d (tomorrow), e, f
    await expect(page.locator('[data-todo-n]').first()).toHaveClass(/vows-sg-n--od/);
    expect(await days(page)).toEqual(['d-3~:', 'd-2~:p', 'd-1~:a', 'd0:b,z,c,g', 'd1~:d', 'd2~:', 'd3~:', 'nx~:e', 'un:f']);
    await expect(page.locator('#todo-view [data-todo-k="d0"] .todo-dtt')).toHaveText('WEDNESDAY' + 'TODAY');
    await expect(page.locator('#todo-view [data-todo-k="d0"] .todo-dnum')).toHaveText('30');
    await expect(ct(page, 'd0')).toHaveText('· 1 OF 4');
    await expect(ct(page, 'd-1')).toHaveText('· 1 LEFT');
    await expect(ct(page, 'd-1')).toHaveClass(/todo-dct--od/);
    await expect(ct(page, 'd-2')).toHaveText('· 1 OF 1');
    await expect(ct(page, 'd2')).toHaveText('· FREE');
    await expect(page.locator('#todo-view [data-todo-k="d-1"]')).toHaveClass(/todo-day--past/);
    await expect(page.locator('#todo-view .todo-w[data-todo-id="z"] .todo-due--od')).toHaveText('OVERDUE');
    await expect(page.locator('#todo-view .todo-w[data-todo-id="a"] .todo-due--od')).toHaveText('OVERDUE');
    await expect(page.locator('#todo-view .todo-w[data-todo-id="c"] .todo-due--tdy')).toHaveText('18:00');
    await expect(page.locator('#todo-view .todo-w[data-todo-id="g"] .todo-rp')).toHaveText('EVERY WED');
    await expect(page.locator('#todo-view [data-todo-k="nx"] .todo-dtt')).toHaveText('NEXT WEEK');
    await expect(page.locator('#todo-view .todo-w[data-todo-id="e"] .todo-due')).toHaveText('MON 5');
    // a header folds and unfolds
    await page.click('#todo-view [data-todo-k="d1"] [data-todo-fold]');
    await expect(page.locator('#todo-view [data-todo-k="d1"]')).not.toHaveClass(/todo-day--fold/);
    await expect(page.locator('#todo-view [data-todo-k="d1"] [data-todo-fold]')).toHaveAttribute('aria-expanded', 'true');
    await page.click('#todo-view [data-todo-k="d0"] [data-todo-fold]');
    await expect(page.locator('#todo-view [data-todo-k="d0"]')).toHaveClass(/todo-day--fold/);
  });

  test('the composer plans any day: DAY pills from today on, NEXT WEEK, NO DAY; a completion stays in its day (no XP — W1013), undo brings it back', async ({ page }) => {
    await seed(page, []);
    await expect(page.locator('#todo-view [data-todo-k="d0"] .todo-empty')).toContainText('Nothing waiting.');
    await page.click('[data-todo-pick="due"]');
    await expect(page.locator('[data-todo-picks="due"]')).toHaveClass(/todo-picks--open/);
    const pills = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-todo-dayrow] .todo-pill')).map((p) => (p.textContent || '').trim()));
    expect(await pills()).toEqual(['TODAY', 'TOMORROW', 'FRI', 'SAT', 'NEXT WEEK', 'NO DAY']);
    await page.click('[data-todo-dayrow] [data-todo-day="2"]');
    await expect(page.locator('[data-todo-duev]')).toHaveText('FRI');
    await page.fill('[data-todo-in]', 'Pay the rent');
    await page.press('[data-todo-in]', 'Enter');
    expect((await store(page))[0]).toMatchObject({ t: 'Pay the rent', due: pt(2) });
    expect((await days(page))[5]).toMatch(/^d2:[^,]+$/);                        // Friday opened to show it
    await expect(page.locator('[data-todo-duev]')).toHaveText('TODAY');             // the composer resets to today
    // NEXT WEEK: the pills turn to next week's dates; the toast names the day and the section opens
    await page.click('[data-todo-pick="due"]');
    await page.click('[data-todo-cw="1"]');
    expect(await pills()).toEqual(['SUN 4', 'MON 5', 'TUE 6', 'WED 7', 'THU 8', 'FRI 9', 'SAT 10', 'THIS WEEK', 'NO DAY']);
    await page.click('[data-todo-dayrow] [data-todo-day="5"]');
    await expect(page.locator('[data-todo-duev]')).toHaveText('MON 5');
    await page.fill('[data-todo-in]', 'Book flights');
    await page.click('[data-todo-add]');
    expect(await toast(page)).toBe('Planned for Mon, Oct 5');
    await expect(page.locator('#todo-view [data-todo-k="nx"]')).not.toHaveClass(/todo-day--fold/);
    // NO DAY: no reminder, no repeat; it lands in UNSCHEDULED
    await page.click('[data-todo-pick="due"]');
    await page.click('[data-todo-dayrow] [data-todo-day="none"]');
    await expect(page.locator('[data-todo-pick="rem"]')).toBeDisabled();
    await expect(page.locator('[data-todo-pick="rep"]')).toBeDisabled();
    await page.fill('[data-todo-in]', 'Fix the bike');
    await page.click('[data-todo-add]');
    await expect(page.locator('#todo-view .todo-un .todo-w')).toHaveCount(1);
    // today: add, complete (stays in today struck through, no XP), tap again to undo
    await page.fill('[data-todo-in]', 'Buy groceries');
    await page.click('[data-todo-add]');
    const id = (await store(page))[0].id;
    await box(page, id);
    await expect(ct(page, 'd0')).toHaveText('· 1 OF 1', { timeout: 3_000 });
    expect(await points(page)).toBe(500);
    await page.waitForTimeout(700);
    await expect(page.locator('#todo-view [data-todo-k="d0"] .todo-w[data-todo-id="' + id + '"] .todo-row--done')).toHaveCount(1);
    await box(page, id);
    await expect(ct(page, 'd0')).toHaveText('· 1');
    expect(await points(page)).toBe(500);
  });

  test('W1010: several days at once — the first tap replaces TODAY, the next ones add; ADD makes one to-do on each day, repeat and all', async ({ page }) => {
    await seed(page, []);
    await page.click('[data-todo-pick="due"]');
    await page.click('[data-todo-dayrow] [data-todo-day="2"]');
    await expect(page.locator('[data-todo-duev]')).toHaveText('FRI');                  // replaced the TODAY default
    await page.click('[data-todo-dayrow] [data-todo-day="3"]');
    await page.click('[data-todo-cw="1"]');                                            // choices carry across the weeks
    await page.click('[data-todo-dayrow] [data-todo-day="5"]');
    await expect(page.locator('[data-todo-duev]')).toHaveText('FRI · SAT · MON');
    await page.click('[data-todo-dayrow] [data-todo-day="5"]');                        // tap again to drop a day
    await expect(page.locator('[data-todo-duev]')).toHaveText('FRI · SAT');
    await page.click('[data-todo-cw="0"]');
    await expect(page.locator('[data-todo-dayrow] [aria-pressed="true"]')).toHaveCount(2);
    await page.click('[data-todo-pick="rep"]');
    await expect(page.locator('[data-todo-rep="week"]')).toHaveText('EVERY FRI · SAT');
    await page.click('[data-todo-rep="week"]');
    await page.fill('[data-todo-in]', 'Walk the dog');
    await page.click('[data-todo-add]');
    const t = await store(page);
    expect(t.map((x: any) => x.t + '|' + x.due + '|' + (x.rep && x.rep.k))).toEqual(['Walk the dog|' + pt(2) + '|week', 'Walk the dog|' + pt(3) + '|week']);
    expect(t[0].id).not.toBe(t[1].id);
    expect(await toast(page)).toBe('Added for Friday and Saturday');
    expect((await days(page)).slice(5, 7)).toEqual(['d2:' + t[0].id, 'd3:' + t[1].id]);   // both days opened
    await expect(page.locator('[data-todo-duev]')).toHaveText('TODAY');                 // and the composer is back to today
  });

  test('W1011: NOTE in the add bar — the box opens under the bar, the note rides on every copy, the bar resets', async ({ page }) => {
    await seed(page, []);
    const tops = await page.evaluate(() => Array.from(document.querySelectorAll('.todo-cbar .todo-cb')).map((b) => Math.round(b.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);                                                // five buttons, one line
    await page.fill('[data-todo-in]', 'Groceries');
    await page.click('[data-todo-pick="note"]');
    await expect(page.locator('[data-todo-picks="note"]')).toHaveClass(/todo-picks--open/);
    await expect(page.locator('[data-todo-note]')).toHaveAttribute('placeholder', 'Milk, eggs, bread…');
    await expect(page.locator('[data-todo-note]')).toBeFocused();
    await page.fill('[data-todo-note]', 'Milk, eggs, bread');
    await expect(page.locator('[data-todo-pick="note"]')).toHaveClass(/todo-cb--on/);
    await page.click('[data-todo-pick="due"]');                                        // one panel at a time
    await expect(page.locator('[data-todo-picks="note"]')).not.toHaveClass(/todo-picks--open/);
    await page.click('[data-todo-dayrow] [data-todo-day="0"]');
    await page.click('[data-todo-dayrow] [data-todo-day="2"]');
    await page.click('[data-todo-add]');
    const t = await store(page);
    expect(t.map((x: any) => x.t + '|' + x.due + '|' + x.note)).toEqual(['Groceries|' + pt(0) + '|Milk, eggs, bread', 'Groceries|' + pt(2) + '|Milk, eggs, bread']);
    await expect(page.locator('#todo-view .todo-w[data-todo-id="' + t[0].id + '"] .todo-mt')).toContainText('Milk, eggs, bread');
    await expect(page.locator('[data-todo-note]')).toHaveValue('');
    await expect(page.locator('[data-todo-pick="note"]')).not.toHaveClass(/todo-cb--on/);
  });

  test('W1012: until the first note, the toast after ADD offers ADD A NOTE — it opens the sheet on the notes box; once a note exists the offer retires', async ({ page }) => {
    await seed(page, []);
    const act = () => page.evaluate(() => { const u = document.querySelector('#todo-toast [data-todo-undo]') as HTMLElement; return u.classList.contains('hidden') ? '' : (u.textContent || ''); });
    await page.fill('[data-todo-in]', 'Groceries');
    await page.click('[data-todo-add]');
    expect(await toast(page)).toBe('Added for today');
    expect(await act()).toBe('ADD A NOTE');
    await page.click('#todo-toast [data-todo-undo]');
    await expect(page.locator('#todo-esh')).toHaveClass(/todo-esh--on/);
    await expect(page.locator('#todo-esh [data-todo-en]')).toBeFocused();
    await page.fill('#todo-esh [data-todo-en]', 'Milk, eggs');
    await page.click('#todo-esh [data-todo-save]');
    expect((await store(page))[0].note).toBe('Milk, eggs');
    expect(await page.evaluate(() => localStorage.getItem('hb_todo_noted'))).toBe('1');
    await page.waitForTimeout(4300);                                                   // let the last toast go
    await page.fill('[data-todo-in]', 'Call Dad');
    await page.click('[data-todo-add]');
    expect(await toast(page)).toMatch(/^off:/);                                        // a this-week add says nothing now
    await page.click('[data-todo-pick="due"]');
    await page.click('[data-todo-cw="1"]');
    await page.click('[data-todo-dayrow] [data-todo-day="5"]');
    await page.fill('[data-todo-in]', 'Book flights');
    await page.click('[data-todo-add]');
    expect(await toast(page)).toBe('Planned for Mon, Oct 5');
    expect(await act()).toBe('');                                                      // …and a planned one carries no offer
  });

  test('W1013: to-dos pay no XP and have no daily cap — ten in a row pay nothing; undoing one an older build paid for takes that XP back; a to-do done eight days ago has cleared', async ({ page }) => {
    const now = WED.getTime();
    const open = (i: number) => ({ id: 'n' + i, t: 'Task ' + i, due: 0 });
    await seed(page, [...Array.from({ length: 10 }, (_, i) => open(i)), { id: 'legacy', t: 'Paid before', due: 0, done: now - 5000, dd: '@today', xp: true }, { id: 'old', t: 'Long gone', due: null, done: now - 8 * 86400000, dd: '2020-01-01' }]);
    await expect(ct(page, 'd0')).toHaveText('· 1 OF 11');
    expect(await byId(page, 'old')).toBeUndefined();
    for (let i = 0; i < 10; i++) await box(page, 'n' + i);
    await expect(ct(page, 'd0')).toHaveText('· 11 OF 11', { timeout: 3_000 });
    expect(await points(page)).toBe(500);                                             // nothing paid
    expect((await store(page)).filter((x: any) => x.xp).map((x: any) => x.id)).toEqual(['legacy']);
    await expect(page.locator('#todo-view .todo-xp')).toHaveCount(0);                 // no +XP chip
    await page.waitForTimeout(700);
    await box(page, 'legacy');                                                         // undo a completion an older build paid for
    await expect.poll(() => points(page)).toBe(499);
    expect((await byId(page, 'legacy')).xp).toBe(false);
  });

  test('swipe moves a to-do to the next day (an overdue one comes to today) or deletes it with undo; the edit sheet plans any week', async ({ page }) => {
    await seed(page, [{ id: 'a', t: 'Send the invoice', due: -1 }, { id: 'd', t: 'Call Dad', due: 1 }, { id: 'c', t: 'Email the landlord', due: 0, rem: '18:00' }]);
    await page.click('#todo-view [data-todo-k="d-1"] [data-todo-fold]');
    await swipe(page, 'a');
    await expect(page.locator('#todo-view .todo-w[data-todo-id="a"]')).toHaveClass(/todo-w--open/);
    await expect(page.locator('#todo-view .todo-w[data-todo-id="a"] [data-todo-act="pp"]')).toHaveText('TODAY');
    await page.waitForTimeout(200);
    await page.click('#todo-view .todo-w[data-todo-id="a"] [data-todo-act="pp"]');
    expect((await byId(page, 'a')).due).toBe(pt(0));
    expect(await toast(page)).toBe('Moved to today');
    await page.click('#todo-view [data-todo-k="d1"] [data-todo-fold]');
    await swipe(page, 'd');
    await expect(page.locator('#todo-view .todo-w[data-todo-id="d"] [data-todo-act="pp"]')).toHaveText('FRI');
    await page.waitForTimeout(200);
    await page.click('#todo-view .todo-w[data-todo-id="d"] [data-todo-act="pp"]');
    expect((await byId(page, 'd')).due).toBe(pt(2));
    expect(await toast(page)).toBe('Moved to Friday');
    await swipe(page, 'c');
    await page.waitForTimeout(200);
    await page.click('#todo-view .todo-w[data-todo-id="c"] [data-todo-act="dl"]');
    await expect(page.locator('#todo-view .todo-w[data-todo-id="c"]')).toHaveCount(0);
    expect(await toast(page)).toBe('Deleted');
    await page.click('[data-todo-undo]');
    await expect(page.locator('#todo-view .todo-w[data-todo-id="c"]')).toHaveCount(1);
    // the edit sheet: a week strip (past days off, today gold), the arrows walk the weeks
    await page.click('#todo-view .todo-w[data-todo-id="d"] .todo-bd');
    await expect(page.locator('#todo-esh')).toHaveClass(/todo-esh--on/);
    await expect(page.locator('#todo-esh [data-todo-ewkl]')).toContainText('WK 40');
    await expect(page.locator('#todo-esh [data-todo-eday] .todo-day-past')).toHaveCount(3);
    await expect(page.locator('#todo-esh [data-todo-eday] .todo-day-tdy')).toHaveText('W30');
    await expect(page.locator('#todo-esh [data-todo-eday] .todo-tri--on')).toHaveText('F2');
    await page.click('#todo-esh [data-todo-ewk="1"]');
    await expect(page.locator('#todo-esh [data-todo-ewkl]')).toContainText('WK 41');
    await expect(page.locator('#todo-esh [data-todo-eday] .todo-day-past')).toHaveCount(0);
    await page.click('#todo-esh [data-todo-eday] [data-v="6"]');
    await page.click('#todo-esh [data-todo-save]');
    expect((await byId(page, 'd')).due).toBe(pt(6));
    expect(await toast(page)).toBe('Moved to Tue, Oct 6');
    await expect(page.locator('#todo-view [data-todo-k="nx"] .todo-w[data-todo-id="d"]')).toHaveCount(1);
    // NO DAY YET: the reminder goes with the day
    await page.click('#todo-view .todo-w[data-todo-id="c"] .todo-bd');
    await page.click('#todo-esh [data-todo-enone]');
    await expect(page.locator('#todo-esh [data-todo-erem]')).toHaveClass(/todo-tri--dis/);
    await page.click('#todo-esh [data-todo-save]');
    expect(await byId(page, 'c')).toMatchObject({ due: null, rem: null });
    await expect(page.locator('#todo-view .todo-un .todo-w[data-todo-id="c"]')).toHaveCount(1);
  });

  test('the grip carries a to-do to another day (the touched row never leaves the document); a past day never takes a drop', async ({ page }) => {
    await seed(page, [{ id: 'b', t: 'Buy groceries', due: 0 }, { id: 'c', t: 'Email the landlord', due: 0 }]);
    const drag = (id: string, toK: string) => page.evaluate(([id, toK]) => {
      const w = document.querySelector('#todo-view .todo-w[data-todo-id="' + id + '"]')!; const g = w.querySelector('[data-todo-grip]')!; const gr = g.getBoundingClientRect();
      const tr = document.querySelector('#todo-view [data-todo-k="' + toK + '"] .todo-dsh')!.getBoundingClientRect(); const y = tr.top + tr.height / 2;
      const ev = (type: string, y: number) => g.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 42, pointerType: 'touch', isPrimary: true, clientX: gr.left + 9, clientY: y, button: 0 }));
      ev('pointerdown', gr.top + 20); ev('pointermove', y);
      const mid = { slot: !!document.querySelector('#todo-view .todo-slot'), lifted: w.classList.contains('todo-w--lift'), connected: w.isConnected };
      ev('pointerup', y);
      return mid;
    }, [id, toK]);
    expect(await drag('c', 'd1')).toEqual({ slot: true, lifted: true, connected: true });
    await page.waitForTimeout(500);
    expect((await byId(page, 'c')).due).toBe(pt(1));
    expect((await days(page))[4]).toBe('d1:c');
    await drag('b', 'd-1');                                                          // a past day: nothing moves
    await page.waitForTimeout(500);
    expect((await byId(page, 'b')).due).toBe(pt(0));
  });

  test('repeats: Weekly means every same weekday — the day stays, completing spawns next week\'s, undo takes it back; after-done and monthly compute the next day', async ({ page }) => {
    await seed(page, []);
    await page.fill('[data-todo-in]', 'Water the plants');
    await page.click('[data-todo-pick="rep"]');
    await expect(page.locator('[data-todo-rep="week"]')).toHaveText('EVERY WED');
    await page.click('[data-todo-rep="week"]');
    await expect(page.locator('[data-todo-repv]')).toHaveText('EVERY WED');
    await page.click('[data-todo-add]');
    let t = await store(page);
    expect(t[0]).toMatchObject({ rep: { k: 'week' }, due: pt(0) });                  // the day did not move
    await box(page, t[0].id);
    await expect.poll(async () => (await store(page)).length).toBe(2);
    t = await store(page);
    let open = t.find((x: any) => !x.done); const done = t.find((x: any) => x.done);
    expect(open).toMatchObject({ due: pt(7), rep: { k: 'week' } });
    expect(done.nx).toBe(open.id);
    expect(await toast(page)).toBe('Repeats · next Wed, Oct 7');
    expect(await points(page)).toBe(500);
    await page.waitForTimeout(700);
    await box(page, done.id);                                                         // undo: the spawned copy goes back
    await expect.poll(async () => (await store(page)).length).toBe(1);
    expect(await points(page)).toBe(500);
    // AFTER DONE from the edit sheet: 3 → 4 days
    const id = (await store(page))[0].id;
    await page.click('#todo-view .todo-w[data-todo-id="' + id + '"] .todo-bd');
    await expect(page.locator('#todo-esh [data-todo-erep] .todo-tri--on')).toHaveAttribute('data-v', 'week');
    await expect(page.locator('#todo-esh [data-todo-erep] [data-v="week"]')).toHaveText('EVERY WED');
    await page.click('#todo-esh [data-todo-erep] [data-v="after"]');
    await expect(page.locator('#todo-esh [data-todo-erepnv]')).toHaveText('3 DAYS AFTER DONE');
    await page.click('#todo-esh [data-todo-erepn="1"]');
    await page.click('#todo-esh [data-todo-save]');
    expect((await store(page))[0].rep).toEqual({ k: 'after', n: 4 });
    await page.waitForTimeout(300);
    await box(page, id);
    await expect.poll(async () => (await store(page)).length).toBe(2);
    open = (await store(page)).find((x: any) => !x.done);
    expect(open).toMatchObject({ due: pt(4), rep: { k: 'after', n: 4 } });
    // MONTHLY: the next one is due on the last day of next month (31 Oct)
    await page.waitForTimeout(700);
    await page.evaluate((id) => (window as any).__todo.open(id), open.id);
    await page.click('#todo-esh [data-todo-erep] [data-v="month"]');
    await page.click('#todo-esh [data-todo-save]');
    await page.waitForTimeout(300);
    await page.evaluate((id) => (document.querySelector('#todo-view .todo-w[data-todo-id="' + id + '"] [data-todo-bx]') as HTMLElement).click(), open.id);
    await expect.poll(async () => (await store(page)).length).toBe(3);
    const m = (await store(page)).find((x: any) => !x.done);
    expect(m).toMatchObject({ rep: { k: 'month' }, due: pt(31) });
  });
});

// W791 · W1007 · W1045 — the update banner: shown only when the App Store's live version is
// newer than this build; checked at launch AND on resume. A version not announced yet shows on
// any day, once; after that it is the Monday reminder (or the day a hunter returns). The store
// lookup is stubbed and the date pinned, so the suite runs any day. (The suite-wide CSS hides
// #upd-banner; it still mounts.)
test.describe('BQ · Update banner (W791 · W1007 · W1036 · W1045)', () => {
  // The banner reads the DEVICE's weekday; pin the browser to Pacific so "Sunday 9 PM" is Sunday on the
  // UTC CI runner too (it is already Monday in UTC — the first CI run caught exactly that).
  test.use({ timezoneId: 'America/Los_Angeles' });
  const store = (page: Page, v: string, released?: string) => page.route('**/itunes.apple.com/lookup**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resultCount: 1, results: [released ? { version: v, currentVersionReleaseDate: released } : { version: v }] }) }));
  // "This hunter has already been shown version v" — what is left is the weekly reminder.
  const told = (page: Page, v: string) => page.addInitScript((ver) => {
    try { if (sessionStorage.getItem('__w1045')) return; sessionStorage.setItem('__w1045', '1'); localStorage.setItem('hb_update_banner_ver', ver as string); } catch (_) {}
  }, v);
  const resume = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const marks = (page: Page) => page.evaluate(() => [localStorage.getItem('hb_update_banner_ver'), localStorage.getItem('hb_update_banner_seen')]);
  const dismiss = async (page: Page) => { await page.evaluate(() => (window as any).closeUpdateBanner()); await page.waitForTimeout(600); };

  test('Monday + an older build: the strip mounts at launch, links to the store and dismisses for the day', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T09:00:00-07:00'));   // Mon 28 Sep, 9:00 AM PST
    await store(page, '99.0.0');
    await freshApp(page);
    await expect(page.locator('#upd-banner')).toHaveCount(1, { timeout: 8_000 });
    expect(await marks(page)).toEqual(['99.0.0', '2026-09-28']);
  });
  test('Monday + the current build (store not newer): no strip', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T09:00:00-07:00'));
    await store(page, '0.0.1');
    await freshApp(page);
    await page.waitForTimeout(2_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);
    expect(await marks(page)).toEqual([null, null]);
  });
  test('W1045 — the store gives no answer (the suite default): no strip, nothing marked, nothing queued', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T09:00:00-07:00'));
    await freshApp(page);
    await page.waitForTimeout(2_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);
    expect(await marks(page)).toEqual([null, null]);
    expect(await page.evaluate(() => localStorage.getItem('hb_funnel_queue') || '')).not.toContain('store_version');
  });
  test('W1007 — a version already announced: nothing on Sunday, the Monday reminder mounts on resume', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-27T21:00:00-07:00'));   // Sun night
    await store(page, '99.0.0');
    await told(page, '99.0.0');
    await freshApp(page);
    await page.waitForTimeout(1_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);                // announced, and not a Monday
    await page.clock.setFixedTime(new Date('2026-09-28T07:30:00-07:00'));   // Monday morning, same session
    await resume(page);
    await expect(page.locator('#upd-banner')).toHaveCount(1, { timeout: 8_000 });
  });

  // W1045 — a version the hunter has not been shown yet: any day, once.
  test('W1045 — a Wednesday, an older build, a version not announced yet: the strip mounts once; then it waits for Monday', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T10:00:00-07:00'));   // Wed 14 Oct
    await store(page, '99.0.0');
    await freshApp(page);
    await expect(page.locator('#upd-banner')).toHaveCount(1, { timeout: 8_000 });
    expect(await marks(page)).toEqual(['99.0.0', '2026-10-14']);
    await dismiss(page);
    await resume(page);
    await page.waitForTimeout(1_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);                // once
    await page.clock.setFixedTime(new Date('2026-10-15T10:00:00-07:00'));   // Thursday: announced, so nothing
    await resume(page);
    await page.waitForTimeout(1_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);
    await page.clock.setFixedTime(new Date('2026-10-19T09:00:00-07:00'));   // Monday, still not updated: the reminder
    await resume(page);
    await expect(page.locator('#upd-banner')).toHaveCount(1, { timeout: 8_000 });
    expect(await marks(page)).toEqual(['99.0.0', '2026-10-19']);
  });
  test('W1045 — a version newer than the one announced shows again, whatever the day', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-15T10:00:00-07:00'));   // Thu 15 Oct
    await store(page, '99.0.1');
    await told(page, '99.0.0');
    await freshApp(page);
    await expect(page.locator('#upd-banner')).toHaveCount(1, { timeout: 8_000 });
    expect(await marks(page)).toEqual(['99.0.1', '2026-10-15']);
  });
  test('W1045 — a release that lands while the app is open shows on the next return, six hours on', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T08:00:00-07:00'));   // Wed 8 AM: nothing newer
    await store(page, '0.0.1');
    await freshApp(page);
    await page.waitForTimeout(1_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);
    await page.unroute('**/itunes.apple.com/lookup**');
    await store(page, '99.0.0');                                             // the release
    await page.clock.setFixedTime(new Date('2026-10-14T11:00:00-07:00'));   // 3 h on: the 6 h answer still stands
    await resume(page);
    await page.waitForTimeout(1_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);
    await page.clock.setFixedTime(new Date('2026-10-14T14:30:00-07:00'));   // 6.5 h on: asked again
    await resume(page);
    await expect(page.locator('#upd-banner')).toHaveCount(1, { timeout: 8_000 });
  });
  test('W1045 — day one stays quiet: nothing shows and nothing is marked, so it shows the next day', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T10:00:00-07:00'));
    await store(page, '99.0.0');
    await page.addInitScript(() => { try { localStorage.setItem('hb_onboarding_first_xp_date', '2026-10-14'); } catch (_) {} });
    await freshApp(page);
    expect(await page.evaluate(() => (window as any).__newHunterQuiet())).toBe(true);
    await page.waitForTimeout(2_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);
    expect(await marks(page)).toEqual([null, null]);
    await page.clock.setFixedTime(new Date('2026-10-15T10:00:00-07:00'));
    await resume(page);
    await expect(page.locator('#upd-banner')).toHaveCount(1, { timeout: 8_000 });
  });
  test('W1045 — the phone passes the store\'s answer along: one event a day per version, with the release time', async ({ page }) => {
    const sent = () => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem('hb_funnel_queue') || '[]') as Array<{ e: string; d?: string }>).filter((x) => x.e === 'store_version').map((x) => x.d); } catch (_) { return ['unreadable']; } });
    const again = async () => { await page.evaluate(() => localStorage.removeItem('hb_store_version')); await resume(page); await page.waitForTimeout(1_500); };
    await page.clock.setFixedTime(new Date('2026-10-14T10:00:00-07:00'));
    await store(page, '0.0.1', '2026-10-12T18:02:35Z');                     // nothing newer than this build: still worth telling the server
    await freshApp(page);
    await expect.poll(sent, { timeout: 8_000 }).toEqual(['0.0.1|2026-10-12T18:02:35Z']);
    await again();
    expect(await sent()).toEqual(['0.0.1|2026-10-12T18:02:35Z']);            // same version, same day: once
    await page.unroute('**/itunes.apple.com/lookup**');
    await store(page, '0.0.2');                                              // a new version, and Apple gave no date
    await again();
    expect(await sent()).toEqual(['0.0.1|2026-10-12T18:02:35Z', '0.0.2']);
    await page.clock.setFixedTime(new Date('2026-10-15T10:00:00-07:00'));   // the next day: said once more
    await again();
    expect(await sent()).toEqual(['0.0.1|2026-10-12T18:02:35Z', '0.0.2', '0.0.2']);
    // a version that is not three numbers is never passed along
    await page.unroute('**/itunes.apple.com/lookup**');
    await store(page, '<b>9</b>');
    await page.evaluate(() => localStorage.removeItem('hb_store_version_sent'));
    await again();
    expect((await sent()).length).toBe(3);
  });

  // W1036 — back after a week or more: the strip shows that day, whatever the weekday.
  const lastSeen = (page: Page, daysAgo: number) => page.addInitScript((d) => {
    try { if (sessionStorage.getItem('__w1036')) return; sessionStorage.setItem('__w1036', '1'); localStorage.setItem('hb_update_last_seen_at', String(Date.now() - (d as number) * 86400000)); } catch (_) {}
  }, daysAgo);
  test('W1036 — a Saturday, back after 8 days on an older build already announced: the strip mounts; it is once for the day', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-10T07:32:00-07:00'));   // Sat 10 Oct
    await store(page, '99.0.0');
    await told(page, '99.0.0');
    await lastSeen(page, 8);
    await freshApp(page);
    await expect(page.locator('#upd-banner')).toHaveCount(1, { timeout: 8_000 });
    expect(await page.evaluate(() => [localStorage.getItem('hb_update_banner_seen'), localStorage.getItem('hb_update_away_day')])).toEqual(['2026-10-10', '2026-10-10']);
    await dismiss(page);
    await resume(page);
    await page.waitForTimeout(1_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);
  });
  test('W1036 — a Saturday, seen two days ago (or never before): no strip; back after 8 days on the current build: no strip', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-10T07:32:00-07:00'));
    await store(page, '99.0.0');
    await told(page, '99.0.0');
    await lastSeen(page, 2);
    await freshApp(page);
    await page.waitForTimeout(2_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);
    // never seen before (a first launch of this build): nothing to measure an absence from
    await page.evaluate(() => { localStorage.removeItem('hb_update_last_seen_at'); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1_500);
    await expect(page.locator('#upd-banner')).toHaveCount(0);
    // away long enough, but the store has nothing newer
    await page.unroute('**/itunes.apple.com/lookup**');
    await store(page, '0.0.1');
    await page.evaluate(() => { localStorage.removeItem('hb_store_version'); localStorage.setItem('hb_update_last_seen_at', String(Date.now() - 9 * 86400000)); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(2_000);
    await expect(page.locator('#upd-banner')).toHaveCount(0);
  });
});

// W1006 — a new week never reads as last week's fallen gate (the owner's 2:20 AM PST briefing, Sun 27 Sep).
test.describe('BP · A new Worldgate week (W1006)', () => {
  test('last week\'s slain cache: the briefing says a new Worldgate rises and the pulse reads NEW, never DOWN', async ({ page }) => {
    await freshApp(page);
    await page.evaluate(() => {
      const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
      const dw = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date(t + 'T12:00:00Z')));
      const last = new Date(Date.parse(t + 'T00:00:00Z') - (dw + 7) * 86400000).toISOString().slice(0, 10);
      localStorage.setItem('hb_worldgate_v1', JSON.stringify({ at: Date.now(), week: last, hp: 243293, pool: 249248, status: 'slain', my: 4000, floor: 15000, souls: 200, hunters: 13, guild: { steps: 0, hunters: 0 }, top: [], wall: [], recent: [], kill: null }));
      const v = (id: string, name: string) => ({ id, name, emoji: '⚡', difficulty: 'easy', type: 'build', primaryStat: 'VIT', custom: true });
      localStorage.setItem('hb_habits', JSON.stringify([v('a1', 'Read 10 pages')]));
    });
    await page.evaluate(() => { (window as any).__worldgate(); (window as any).__tb.show({}); });
    await expect(page.locator('.tb-sheet')).toBeVisible();
    await expect(page.locator('.tb-world').first()).toHaveText(/^A new Worldgate rises · The /);
    await expect(page.locator('.tb-world').first()).not.toContainText('fallen');
    await expect(page.locator('#wg-pulse .wg-pulse-pct')).toHaveText('NEW');
    await expect(page.locator('#wg-pulse')).not.toHaveClass(/wg-pulse--down/);
  });
});

// W1001 — a topic's author (or a moderator) edits its title + body from the ··· menu.
test.describe('BN · Edit a topic (W1001)', () => {
  test('Edit on the OP opens the composer prefilled; SAVE posts title + body to the edit endpoint; the card wears EDITED', async ({ page }) => {
    await freshApp(page);
    await page.evaluate(() => localStorage.setItem('hb_board_cache_v1', JSON.stringify({ topics: [], me: { role: 'owner' } })));
    await page.click('#tab-social');
    await expect(page.locator('#board-body')).toContainText(/No topics yet|Sign in with Apple|Could not load/i, { timeout: 10_000 });
    await page.evaluate(() => {
      const now = Date.now();
      const w = window as any;
      w.__edits = [];
      let title = 'Week of Sep 24', body = 'Hello all, the first draft.', edited: number | null = null;
      const au = { author_id: 'u-me', alias: 'Richie', rank_label: 'S', founder_seq: 0, is_mod: true, mod_role: 'owner' };
      const row = () => ({ id: 'cccccccc-0007', tag: 'update', title, preview: body.slice(0, 160), created_at: now - 86400000, last_activity_at: now - 3600000, reply_count: 0, up_count: 0, voted: false, pinned: true, locked: false, hidden: false, resolved: false, edited_at: edited, repliers: [], last_reply: null, author: au });
      w.Auth.boardTopics = async () => ({ ok: true, next_cursor: null, counts: { all: 1, improvement: 0, bug: 0, talk: 0, update: 1, resolved: 0 }, topics: [row()], me: { role: 'owner', consented: true } });
      w.Auth.boardTopic = async () => ({ ok: true, following: true, next_cursor: null, me: { consented: true, role: 'owner', rank_tier: 'S', topic_min_tier: 'C', reply_min_tier: 'D', author_id: 'u-me' }, topic: Object.assign(row(), { body }), replies: [] });
      w.Auth.boardTopicEdit = async (id: string, t: string, b: string) => { w.__edits.push([id, t, b]); title = t; body = b; edited = Date.now(); return { ok: true, edited_at: edited }; };
      w.Auth.boardMe = async () => ({ ok: true, me: { consented: true, role: 'owner', rank_tier: 'S', author_id: 'u-me' } });
      localStorage.setItem('hb_board_consent_v1', '1');
      w.__board.render();
    });
    await page.evaluate(() => (window as any).__board.open('cccccccc-0007'));
    const sheet = page.locator('.board-sheet--topic');
    await expect(sheet.locator('.board-op .board-op-title')).toHaveText('Week of Sep 24');
    await expect(sheet.locator('.board-op .board-edited')).toHaveCount(0);
    // ··· → Edit
    await sheet.locator('.board-op [data-board-menu]').click();
    await sheet.locator('.board-op [data-board-menu-panel] [data-board-edit]').first().click();
    const compose = page.locator('.board-sheet--compose form[data-board-compose="edit-topic"]');
    await expect(compose).toBeVisible();
    await expect(compose.locator('input[name="title"]')).toHaveValue('Week of Sep 24');
    await expect(compose.locator('textarea[name="body"]')).toHaveValue('Hello all, the first draft.');
    await compose.locator('input[name="title"]').fill('Week of Sep 24, revised');
    await compose.locator('textarea[name="body"]').fill('Hello all, the corrected version of this update.');
    await compose.locator('button[type="submit"]').click();
    await expect.poll(() => page.evaluate(() => (window as any).__edits.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).__edits[0])).toEqual(['cccccccc-0007', 'Week of Sep 24, revised', 'Hello all, the corrected version of this update.']);
    // the topic reopens with the new title, body and the EDITED mark
    await expect(page.locator('.board-sheet--topic .board-op .board-op-title')).toHaveText('Week of Sep 24, revised', { timeout: 5_000 });
    await expect(page.locator('.board-sheet--topic .board-op .board-ptext')).toContainText('corrected version');
    await expect(page.locator('.board-sheet--topic .board-op .board-edited')).toHaveText('· EDITED');
  });
});

// W991 — NEW means "recent and unseen"; the tier chip; one rarity palette; honest PWR sort.
test.describe('AZ · Relic NEW + tier chip (W991)', () => {
  async function seed(page: Page, extra: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript(([ex]) => {
      try {
        if (sessionStorage.getItem('__w991')) return;
        sessionStorage.setItem('__w991', '1');
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        localStorage.setItem('hb_pokedex_collapsed', '[]');   // every rarity section open (a first visit starts them collapsed)
        const d = new Date(); const ymd = (x: Date) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
        const old = new Date(); old.setDate(old.getDate() - 5);
        Object.keys(ex || {}).forEach((k) => localStorage.setItem(k, String((ex as any)[k]).replace(/@today/g, ymd(d)).replace(/@old/g, ymd(old))));
      } catch (_) {}
    }, [extra] as [Record<string, string>]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }
  const inv = (cards: Record<string, unknown>) => JSON.stringify({ cards });
  const chipCount = (page: Page, id: string, sel: string) => page.locator(`.pokedex-card[data-card-id="${id}"] ${sel}`).count();

  test('NEW shows for a relic found today, EQUIPPED wins, and leaving the Items tab clears NEW', async ({ page }) => {
    await seed(page, {
      hb_inventory: inv({ pups_hood: { count: 1, discovered: true, first_acquired_date: '@today' }, alphas_mantle: { count: 1, discovered: true, first_acquired_date: '@today' } }),
      hb_hunter_build: JSON.stringify({ slots: ['pups_hood', null, null, null, null, null, null, null] }),
    });
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    await expect(page.locator('.pokedex-card[data-card-id="alphas_mantle"]')).toBeVisible({ timeout: 10_000 });
    expect(await chipCount(page, 'alphas_mantle', '.archive-card-new-chip')).toBe(1);
    expect(await chipCount(page, 'pups_hood', '.archive-card-new-chip')).toBe(0);
    expect(await chipCount(page, 'pups_hood', '.archive-equipped-badge')).toBe(1);
    await page.evaluate(() => document.getElementById('tab-habits')!.click());
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    await expect(page.locator('.pokedex-card[data-card-id="alphas_mantle"]')).toBeVisible({ timeout: 10_000 });
    expect(await chipCount(page, 'alphas_mantle', '.archive-card-new-chip')).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_relic_seen_v2') || '{}').alphas_mantle)).toBe(1);
  });

  test('a relic found five days ago is not NEW even if never viewed', async ({ page }) => {
    await seed(page, { hb_inventory: inv({ alphas_mantle: { count: 1, discovered: true, first_acquired_date: '@old' } }) });
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    await expect(page.locator('.pokedex-card[data-card-id="alphas_mantle"]')).toBeVisible({ timeout: 10_000 });
    expect(await chipCount(page, 'alphas_mantle', '.archive-card-new-chip')).toBe(0);
  });

  test('legacy hb_relic_seen_<id> keys fold into hb_relic_seen_v2 and are removed', async ({ page }) => {
    await seed(page, { hb_inventory: inv({ alphas_mantle: { count: 1, discovered: true, first_acquired_date: '@today' } }), hb_relic_seen_alphas_mantle: '1' });
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    await expect(page.locator('.pokedex-card[data-card-id="alphas_mantle"]')).toBeVisible({ timeout: 10_000 });
    expect(await chipCount(page, 'alphas_mantle', '.archive-card-new-chip')).toBe(0);
    expect(await page.evaluate(() => [localStorage.getItem('hb_relic_seen_alphas_mantle'), JSON.parse(localStorage.getItem('hb_relic_seen_v2') || '{}').alphas_mantle])).toEqual([null, 1]);
  });

  test('the tier chip on the grid card carries the rank letter and colour', async ({ page }) => {
    await seed(page, { hb_inventory: inv({ alphas_mantle: { count: 1, discovered: true, first_acquired_date: '@old' } }) });
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    const chip = page.locator('.pokedex-card[data-card-id="alphas_mantle"] .relic-tier');
    await expect(chip).toHaveText('E', { timeout: 10_000 });
    await expect(chip).toHaveAttribute('data-rank', 'E');
  });

  test('the slot picker labels a mythic MEGA and wears its S chip', async ({ page }) => {
    await seed(page, { hb_inventory: inv({ nightfall_blade: { count: 1, discovered: true, first_acquired_date: '@old' } }) });
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    await expect(page.locator('#armory-open-btn')).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => document.getElementById('armory-open-btn')!.click());
    await expect(page.locator('.gear-card[data-slot-index="3"]')).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => (document.querySelector('.gear-card[data-slot-index="3"]') as HTMLElement).click());
    const tile = page.locator('.build-picker-tile[data-card-id="nightfall_blade"]');
    await expect(tile.locator('.build-picker-tile-rarity--m')).toHaveText('MEGA', { timeout: 10_000 });
    await expect(tile.locator('.relic-tier')).toHaveAttribute('data-rank', 'S');
  });

  test('PWR sort follows the displayed upgrade-inclusive number', async ({ page }) => {
    await seed(page, { hb_inventory: inv({
      pendant_of_the_wakeful: { count: 1, discovered: true, first_acquired_date: '@old', upgrade_level: 3 },
      sober_kings_gloves: { count: 1, discovered: true, first_acquired_date: '@old' },
    }) });
    await page.evaluate(() => document.getElementById('tab-items')!.click());
    await expect(page.locator('.pokedex-card[data-card-id="pendant_of_the_wakeful"]')).toBeVisible({ timeout: 10_000 });
    const rows = await page.evaluate(() => [].map.call(document.querySelectorAll('.pokedex-card:not(.pokedex-card--undiscovered) .pdx-pwr .pn'), (n: any) => Number(n.textContent)));
    expect(rows.length).toBe(2);
    expect(rows[0]).toBeGreaterThanOrEqual(rows[1]);
    const first = await page.evaluate(() => document.querySelector('.pokedex-card:not(.pokedex-card--undiscovered)')!.getAttribute('data-card-id'));
    expect(first).toBe('pendant_of_the_wakeful');
  });
});

// W992 — rank-keyed drop rates; the mercy panel shows only the layers a rank has.
test.describe('BL · Rank-keyed mercy (W992)', () => {
  test('mercy rows: E gate 2/5/15, A gate Rare+Ultra, S gate Ultra only, Gray Pilgrim keeps weekly', async ({ page }) => {
    await freshApp(page);
    const rows = async (id: string) => page.evaluate((bossId) => {
      (window as any).openBossFullScreen(bossId);
      const out = [].map.call(document.querySelectorAll('#bfs-mercy .bfs-mercy-val'), (el: any) => el.textContent.trim());
      document.getElementById('boss-fs-overlay')!.classList.add('hidden');
      return out;
    }, id);
    expect(await rows('the_steel_wolf')).toEqual(['0 / 2', '0 / 5', '0 / 15']);
    expect(await rows('the_unbroken_anvil')).toEqual(['0 / 8', '0 / 25']);
    expect(await rows('the_worldspine')).toEqual(['0 / 30']);
    expect(await rows('the_gray_pilgrim')).toEqual(['0 / 2', '0 / 4', '0 / 8']);
    const sim = await page.evaluate(() => ({
      wolf: (window as any).Drops.simulateDrops('the_steel_wolf', 20000),
      anvil: (window as any).Drops.simulateDrops('the_unbroken_anvil', 20000),
      erebus: (window as any).Drops.simulateDrops('erebus_the_shadow_sovereign', 20000),
    }));
    expect(sim.wolf.no_drop / 20000).toBeLessThan(0.09);
    expect(sim.wolf.ultra_rare / 20000).toBeGreaterThan(0.11);
    expect(sim.anvil.pity_drops).toBeGreaterThan(0);
    expect(sim.erebus.mythic / 20000).toBeLessThan(0.02);
  });
});

test.describe('BH · Hunt results (W980)', () => {
  const pt = (off: number) => new Date(Date.now() - off * 86400000).toLocaleDateString('en-CA');
  const ptLA = (off: number) => new Date(Date.now() - off * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  // A day's value under BOTH calendars: CI's browser runs UTC, the dev PC's runs Pacific (the 5 PM PST trap).
  const days = (m: Record<number, number>) => { const o: Record<string, number> = {}; Object.keys(m).forEach((k) => { const v = m[+k]; o[pt(+k)] = v; o[ptLA(+k)] = v; }); return o; };
  async function seed(page: Page, extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript(([ex]) => {
      try {
        if (sessionStorage.getItem('__w980')) return;
        sessionStorage.setItem('__w980', '1');
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));   // the Double Dungeon coachmark stays out of the way on any UTC day
        ['hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_healthkit_prompted', 'hb_first_completion_bonus_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_onboarding_first_xp_date', '2026-01-01');
        Object.keys(ex || {}).forEach((k) => localStorage.setItem(k, (ex as any)[k]));
      } catch (_) {}
    }, [extra || {}] as [Record<string, string>]);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
  }
  const view = (page: Page) => page.evaluate(() => {
    const o = document.getElementById('boss-result-overlay')!;
    const f = o.querySelector('.hr-frame');
    const t = (s: string) => ((f && f.querySelector(s)?.textContent) || '').replace(/\s+/g, ' ').trim();
    return { shown: !o.classList.contains('hidden'), kind: f ? (f.classList.contains('hr-victory') ? 'victory' : 'defeat') : null,
      eyebrow: t('.hr-eyebrow'), boss: t('.hr-boss'), stamp: t('.hr-stamp'), kill: t('.hr-kill'), sub: t('.hr-sub'), pct: t('.hr-pctbig'),
      rows: f ? [].map.call(f.querySelectorAll('.hr-row'), (r: any) => r.textContent.replace(/\s+/g, ' ').trim()) : [],
      rl: t('.hr-rl'), mvp: t('.hr-mvp'), souls: t('.hr-souls'), relic: t('.hr-rc:not(.hr-souls)'), chips: t('.hr-chips'), mood: t('.hr-mood'),
      call: t('.hr-call'), buttons: f ? f.querySelectorAll('button').length : 0, text: (f && f.textContent) || '' };
  });
  const tap = (page: Page) => page.locator('#boss-result-overlay .hr-frame').click({ position: { x: 20, y: 20 } });

  test('solo victory: BEATEN, FIRST KILL, the condition met, souls — tap skips, tap leaves', async ({ page }) => {
    await seed(page, { hb_leaderboard: JSON.stringify({ steps_daily: days({ 0: 8214 }) }) });
    await page.evaluate(() => (window as any).__queueBossResult({ bossId: 'the_steel_wolf', bossName: 'The Steel Wolf', rank: 'E', kill_count: 1, conditionLabel: 'Walk 6,000+ steps in a single day', souls: 120, drop: null, mercy: null }));
    await expect.poll(() => view(page).then((v) => v.kind), { timeout: 5_000 }).toBe('victory');
    await tap(page);   // skip to the end
    const v = await view(page);
    expect(v.eyebrow.toUpperCase()).toBe('SOLO HUNT · RANK E');
    expect(v.boss).toBe('The Steel Wolf');
    expect(v.stamp.toUpperCase()).toBe('BEATEN');
    expect(v.kill.toUpperCase()).toBe('FIRST KILL');
    expect(v.rows[0]).toMatch(/Walk 6,000\+ steps in a single day ?8,214 steps/);
    expect(v.souls).toMatch(/\+120/);
    expect(v.relic).toMatch(/Souls only this time/);
    expect(v.buttons).toBe(0);
    await tap(page);   // leave
    await expect.poll(() => view(page).then((x) => x.shown), { timeout: 3_000 }).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('hb_boss_result_pending'))).toBeNull();
  });

  test('a first rare stays sealed on the card — its reveal comes after', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => (window as any).__queueBossResult({ bossId: 'the_steel_wolf', bossName: 'The Steel Wolf', rank: 'E', kill_count: 3, conditionLabel: 'x', souls: 90,
      drop: { cardId: 'x', name: 'Fang of the Pack', rarity: 'rare', wasFirst: true }, mercy: null }));
    await expect.poll(() => view(page).then((v) => v.kind), { timeout: 5_000 }).toBe('victory');
    await tap(page);
    const v = await view(page);
    expect(v.sub.toUpperCase()).toBe('3RD KILL');
    expect(v.relic).toMatch(/A sealed relic/);
    expect(v.text).not.toContain('Fang of the Pack');
  });

  test('solo escape: the best day and how short, never a tap-away — Not now leaves', async ({ page }) => {
    await seed(page, { hb_leaderboard: JSON.stringify({ sleep_hours_daily: days({ 1: 6.3, 2: 5.1 }) }) });
    await page.evaluate(() => (window as any).__queueBossResult({ outcome: 'failed', bossId: 'the_insomniac', bossName: 'The Insomniac', rank: 'D', conditionLabel: 'Sleep 7+ hours', hunt_started_at: Date.now() - 3 * 86400000 }));
    await expect.poll(() => view(page).then((v) => v.kind), { timeout: 5_000 }).toBe('defeat');
    await tap(page);   // skip; a defeat never closes on a tap
    const v = await view(page);
    expect(v.stamp.toUpperCase()).toBe('ESCAPED');
    expect(v.pct).toMatch(/^90 ?%/);
    expect(v.rl.toUpperCase()).toMatch(/BEST NIGHT/);
    expect(v.rows[0]).toMatch(/6h 18m/);
    expect(v.mood).toBe('So close it hurts.');
    expect(v.call).toBe('Hunt again');
    await tap(page);
    expect((await view(page)).shown).toBe(true);
    await page.locator('#boss-result-overlay [data-hr-later]').click();
    await expect.poll(() => view(page).then((x) => x.shown), { timeout: 3_000 }).toBe(false);
  });

  test('co-op victory: beaten together, each share, the MVP band, the hunger chip', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => (window as any).__queueBossResult({ bossId: 'the_twin_maw', bossName: 'The Twin Maw', rank: 'E', kill_count: 7, souls: 360, drop: null, mercy: null,
      coop: { party: [{ n: 'Anthony', s: 14210, f: 0 }, { n: 'Richie', s: 11840, f: 0, you: true }, { n: 'Kai', s: 7900, f: 0 }], goal: 30000, fgoal: 0, unit: 'steps', mvp: 'Anthony', pact: null, fed: true, time: '19h 05m' } }));
    await expect.poll(() => view(page).then((v) => v.kind), { timeout: 5_000 }).toBe('victory');
    await tap(page);
    const v = await view(page);
    expect(v.eyebrow.toUpperCase()).toBe('CO-OP HUNT · RANK E');
    expect(v.stamp.toUpperCase()).toBe('BEATEN TOGETHER');
    expect(v.sub.toUpperCase()).toBe('DONE IN 19H 05M');
    expect(v.rows.length).toBe(3);
    expect(v.rows[1]).toMatch(/Richie ?You ?11,840 steps/i);
    expect(v.mvp).toMatch(/Anthony carried the hunt/);
    expect(v.chips).toMatch(/The hunger is fed · 2× souls/);
    expect(v.souls).toMatch(/\+360/);
  });

  test('co-op defeat: SURVIVES, the % of the goal, the shortfall, Call again', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => (window as any).__queueBossResult({ outcome: 'failed', bossId: 'the_twin_maw', bossName: 'The Twin Maw', rank: 'E', hunt_started_at: 'coop-t1',
      coop: { party: [{ n: 'Anthony', s: 11300, f: 0 }, { n: 'Richie', s: 9610, f: 0, you: true }], goal: 24000, fgoal: 0, unit: 'steps', mvp: null, pact: null, fed: false, time: '' } }));
    await expect.poll(() => view(page).then((v) => v.kind), { timeout: 5_000 }).toBe('defeat');
    await tap(page);
    const v = await view(page);
    expect(v.stamp.toUpperCase()).toBe('SURVIVES');
    expect(v.pct).toMatch(/^87 ?%/);
    expect(v.text).toMatch(/3,090 short/i);
    expect(v.call).toBe('Call again');
    expect(v.mood).toBe('So close it hurts.');
    // Once per hunt: the same hunt never queues twice.
    await page.locator('#boss-result-overlay [data-hr-later]').click();
    await expect.poll(() => view(page).then((x) => x.shown), { timeout: 3_000 }).toBe(false);
    const again = await page.evaluate(() => (window as any).__queueBossResult({ outcome: 'failed', bossId: 'the_twin_maw', bossName: 'The Twin Maw', rank: 'E', hunt_started_at: 'coop-t1', coop: null }));
    expect(again).toBe(false);
  });

  test('the co-op builder reads a real hunt: party order, goal, time, the far-off mood', async ({ page }) => {
    await seed(page);
    const d = await page.evaluate(() => (window as any).__hr.coop({ boss_id: 'the_twin_maw', goal_steps: 30000,
      party: [{ user_id: 'u-a', alias: 'anthony', steps: 6120 }, { user_id: 'u-k', alias: 'kai', steps: 2180 }],
      starts_at: new Date(Date.now() - (14 * 60 + 22) * 60000).toISOString(), resolved_at: new Date().toISOString() }, {}));
    expect(d.party.map((p: any) => p.s)).toEqual([6120, 2180]);
    expect(d.party.filter((p: any) => p.you).length).toBe(1);
    expect(d.goal).toBe(30000);
    expect(d.time).toBe('14h 22m');
  });

  // W1022 — the owner's own hunt (2026-10-02): a won Hollow Monarch read 0 fl / 0 fl, 0 of 20, "Done in
  // 24h 00m". The server carries a flights-only hunt's flights under `steps`, and stamps resolved_at
  // as SQLite UTC with no zone. These are that hunt's real rows.
  test('W1022: a flights hunt shows the flights climbed and the true time, exactly as the server sends it', async ({ page }) => {
    await seed(page);
    const inst = { id: 'dd029f4a', boss_id: 'the_hollow_monarch', status: 'completed', result: 'success', goal_steps: 20, combined_steps: 20,
      challenger: { user_id: 'u-a', alias: 'anthony', steps: 11 }, partner: { user_id: 'u-r', alias: 'richie', steps: 9 },
      starts_at: '2026-10-01T14:39:41.562Z', ends_at: '2026-10-02T14:39:41.562Z', resolved_at: '2026-10-02 13:32:22', updated_at: '2026-10-02 13:32:22' };
    const d = await page.evaluate((i) => (window as any).__hr.coop(i, {}), inst);
    expect(d.unit).toBe('flights');
    expect(d.party.map((p: any) => p.s)).toEqual([11, 9]);
    expect(d.goal).toBe(20);
    expect(d.time).toBe('22h 53m');
    // a dual hunt still reads its own two keys
    const both = await page.evaluate(() => (window as any).__hr.coop({ boss_id: 'the_gaunt_wardens', goal_steps: 20000, goal_flights: 15,
      challenger: { user_id: 'u-a', alias: 'anthony', steps: 12000, flights: 9 }, partner: { user_id: 'u-r', alias: 'richie', steps: 9000, flights: 7 },
      starts_at: '2026-10-01T14:00:00.000Z', resolved_at: '2026-10-01 20:30:00' }, {}));
    expect(both.party.map((p: any) => [p.s, p.f])).toEqual([[12000, 9], [9000, 7]]);
    expect([both.goal, both.fgoal, both.time]).toEqual([20000, 15, '6h 30m']);
  });

  test('none of the four screens ever says fell / felled', async ({ page }) => {
    await seed(page);
    const texts: string[] = [];
    await page.evaluate(() => (window as any).__previewHuntResults());
    for (let i = 0; i < 4; i++) {
      await expect.poll(() => view(page).then((v) => v.shown && v.kind), { timeout: 5_000 }).toBeTruthy();
      await tap(page);
      const v = await view(page);
      texts.push(v.text);
      if (v.kind === 'defeat') await page.locator('#boss-result-overlay [data-hr-later]').click(); else await tap(page);
      await page.waitForTimeout(700);
    }
    expect(texts.length).toBe(4);
    texts.forEach((t) => expect(t).not.toMatch(/\bfell(ed)?\b/i));
    await expect.poll(() => view(page).then((x) => x.shown), { timeout: 3_000 }).toBe(false);
  });

  test('the owner sees the preview row; others do not', async ({ page }) => {
    await seed(page, { hb_board_cache_v1: JSON.stringify({ me: { role: 'owner' } }) });
    await page.locator('#settings-btn').click();
    await expect.poll(() => page.evaluate(() => !document.getElementById('settings-preview-hunts')!.classList.contains('hidden')), { timeout: 6_000 }).toBe(true);
  });

  // W982 — a board mod gets every preview row; the new-hunter sandbox stays the owner's.
  test('a mod sees the preview rows, never Test as a new hunter', async ({ page }) => {
    await seed(page, { hb_board_cache_v1: JSON.stringify({ me: { role: 'mod' } }) });
    await page.locator('#settings-btn').click();
    const ids = ['settings-preview-celebrations', 'settings-preview-rating', 'settings-preview-wgmvp', 'settings-preview-briefing', 'settings-preview-hunts', 'settings-preview-readyhunt'];
    await expect.poll(() => page.evaluate((xs) => xs.every((x) => !document.getElementById(x)!.classList.contains('hidden')), ids), { timeout: 6_000 }).toBe(true);
    expect(await page.evaluate(() => document.getElementById('settings-test-hunter')!.classList.contains('hidden'))).toBe(true);
  });

  test('a regular hunter sees none of them', async ({ page }) => {
    await seed(page, { hb_board_cache_v1: JSON.stringify({ me: { role: null } }) });
    await page.locator('#settings-btn').click();
    await page.waitForTimeout(800);
    const shown = await page.evaluate(() => ['settings-preview-celebrations', 'settings-preview-rating', 'settings-preview-wgmvp', 'settings-preview-briefing', 'settings-preview-hunts', 'settings-preview-readyhunt', 'settings-test-hunter']
      .filter((x) => !document.getElementById(x)!.classList.contains('hidden')));
    expect(shown).toEqual([]);
  });

  // W981 — the old card is gone, not hidden: no markup, no rules, no wiring.
  test('the old Boss Defeated card no longer exists anywhere', async ({ page }) => {
    await seed(page);
    const r = await page.evaluate(() => {
      const o = document.getElementById('boss-result-overlay')!;
      let rules = 0;
      for (const sh of Array.from(document.styleSheets)) {
        let list: CSSRuleList | null = null; try { list = sh.cssRules; } catch (_) {}
        if (list) for (const rule of Array.from(list)) { const t = (rule as any).selectorText || ''; if (/\.bro-overlay|\.bro-shell|\.coopdf|\.coop-victory/.test(t)) rules++; }
      }
      return { cls: o.className, kids: o.children.length, oldIds: document.querySelectorAll('[id^="bro-"]').length,
        oldCls: document.querySelectorAll('.bro-overlay, .bro-shell, .coopdf, .coop-victory').length, rules,
        panels: typeof (window as any)._coopVictoryHtml };
    });
    expect(r.cls).toContain('hr-screen');
    expect(r.kids).toBe(0);
    expect(r.oldIds).toBe(0);
    expect(r.oldCls).toBe(0);
    expect(r.rules).toBe(0);
  });

  const ended = (over: Record<string, any>) => Object.assign({ id: 'w981-hunt', boss_id: 'the_twin_maw', status: 'completed', result: 'success', role: 'challenger', goal_steps: 30000, combined_steps: 31200,
    starts_at: new Date(Date.now() - 20 * 3600000).toISOString(), resolved_at: new Date(Date.now() - 3600000).toISOString(),
    party: [{ user_id: 'u-a', alias: 'anthony', role: 'ally', steps: 17000, joined: true }, { user_id: 'me', alias: 'Richie', role: 'challenger', steps: 14200, joined: true }] }, over);
  const sheetBody = (page: Page) => page.evaluate(() => (document.getElementById('coop-fs-body') || { innerHTML: '' }).innerHTML);

  // W994 — the "seen" count: moderators only.
  test('a moderator sees "N SEEN" on the row and "SEEN BY N" on the sheet; a hunter sees neither', async ({ page }) => {
    for (const role of ['owner', null] as Array<'owner' | null>) {
      await freshApp(page);
      await page.evaluate((r) => localStorage.setItem('hb_board_cache_v1', JSON.stringify({ topics: [], me: { role: r } })), role);
      await page.click('#tab-social');
      await expect(page.locator('#board-body')).toContainText(/No topics yet|Sign in with Apple|Could not load/i, { timeout: 10_000 });
      await page.evaluate((r) => {
        const now = Date.now(); const w = window as any;
        const au = { author_id: 'u-me', alias: 'Richie', rank_label: 'S', founder_seq: 0, is_mod: true, mod_role: r };
        const t: any = { id: 'dddddddd-0001', tag: 'update', title: 'Week of Sep 24', preview: 'Hello all', created_at: now - 3600000, last_activity_at: now - 3600000, reply_count: 0, up_count: 0, voted: false, pinned: true, locked: false, hidden: false, resolved: false, repliers: [], last_reply: null, author: au };
        if (r) t.views = 9;
        w.Auth.boardTopics = async () => ({ ok: true, next_cursor: null, counts: { all: 1, improvement: 0, bug: 0, talk: 0, update: 1, resolved: 0 }, topics: [t], me: { role: r } });
        w.Auth.boardTopic = async () => ({ ok: true, following: false, next_cursor: null, me: { consented: true, role: r, rank_tier: 'S', topic_min_tier: 'C', reply_min_tier: 'D' }, topic: Object.assign({}, t, { body: 'Hello all.' }), replies: [] });
        w.__board.render();
      }, role);
      await expect(page.locator('#board-body .board-topic')).toHaveCount(1);
      await expect(page.locator('#board-body .board-tag--seen')).toHaveCount(role ? 1 : 0);
      if (role) await expect(page.locator('#board-body .board-tag--seen')).toHaveText('9 SEEN');
      await page.evaluate(() => (window as any).__board.open('dddddddd-0001'));
      const sub = page.locator('.board-sheet--topic [data-board-sub]');
      await expect(sub).toContainText(/REPLIES/, { timeout: 6_000 });
      if (role) await expect(sub).toContainText('SEEN BY 9'); else await expect(sub).not.toContainText('SEEN');
      await page.evaluate(() => { const s = document.querySelector('.board-sheet--topic'); if (s) s.remove(); });
    }
  });

  test('co-op sheet on a won hunt: the new screen over it, never the old panel — and only once', async ({ page }) => {
    await seed(page, { hb_coop_awarded: JSON.stringify({ 'w981-hunt': true }) });
    await page.evaluate((i) => (window as any).__hr.sheet(i), ended({}));
    await expect.poll(() => view(page).then((v) => v.kind), { timeout: 6_000 }).toBe('victory');
    const body = await sheetBody(page);
    expect(body).not.toMatch(/coop-victory|coopdf|THE HUNT IS WON|THE QUARRY HOLDS/);
    await tap(page);
    const v = await view(page);
    expect(v.eyebrow.toUpperCase()).toBe('CO-OP HUNT · RANK E');
    expect(v.stamp.toUpperCase()).toBe('BEATEN TOGETHER');
    expect(v.rows.length).toBe(2);
    expect(v.relic).toBe('');   // not known on this device: no relic claim either way
    expect(v.text).not.toMatch(/Souls only this time/);
    await tap(page);
    await expect.poll(() => view(page).then((x) => x.shown), { timeout: 3_000 }).toBe(false);
    // Opened again: the sheet stays the sheet.
    await page.evaluate((i) => (window as any).__hr.sheet(i), ended({}));
    await page.waitForTimeout(2_200);
    expect((await view(page)).shown).toBe(false);
    expect(await sheetBody(page)).not.toMatch(/coop-victory|coopdf/);
  });

  test('co-op sheet on a lost hunt: the defeat screen, no crimson panel, no old hero ward', async ({ page }) => {
    await seed(page, { hb_coop_awarded: JSON.stringify({ 'w981-loss': true }) });
    await page.evaluate((i) => (window as any).__hr.sheet(i), ended({ id: 'w981-loss', status: 'expired', result: 'defeat', combined_steps: 25800, party: [{ user_id: 'u-a', alias: 'anthony', role: 'ally', steps: 14000, joined: true }, { user_id: 'me', alias: 'Richie', role: 'challenger', steps: 11800, joined: true }] }));
    await expect.poll(() => view(page).then((v) => v.kind), { timeout: 6_000 }).toBe('defeat');
    expect(await sheetBody(page)).not.toMatch(/coopdf|THE QUARRY HOLDS|Ran Out of Time/);
    expect(await page.evaluate(() => document.getElementById('coop-fs-overlay')!.classList.contains('coop-overlay--defeat'))).toBe(false);
    await tap(page);
    const v = await view(page);
    expect(v.stamp.toUpperCase()).toBe('SURVIVES');
    expect(v.pct).toMatch(/^86 ?%/);
    expect(v.call).toBe('Call again');
  });

  test('the sheet waits for the award path, and skips a hunt older than three days', async ({ page }) => {
    await seed(page);
    // Not awarded on this device yet → the award path owns the moment.
    await page.evaluate((i) => (window as any).__hr.sheet(i), ended({ id: 'w981-fresh' }));
    await page.waitForTimeout(2_200);
    expect((await view(page)).shown).toBe(false);
    // Awarded, but ended a week ago → the sheet just opens.
    await page.evaluate(() => localStorage.setItem('hb_coop_awarded', JSON.stringify({ 'w981-old': true })));
    await page.evaluate((i) => (window as any).__hr.sheet(i), ended({ id: 'w981-old', resolved_at: new Date(Date.now() - 7 * 86400000).toISOString() }));
    await page.waitForTimeout(2_200);
    expect((await view(page)).shown).toBe(false);
  });
});

// W995 — MORNING · DAY · EVENING sections on the Habits tab; the TO-DO pill (one-off tasks,
// no XP since W1013, done ones clear after seven days); the briefing's to-do line; TIME OF
// DAY on the create / edit sheets. Dates are the app's day (Pacific) — computed in-browser.
test.describe('BM · Vows by time of day + to-dos (W995)', () => {
  // freshApp's init script re-seeds hb_habits='[]' on EVERY navigation, so the vows must come
  // from a LATER init script (it runs after freshApp's). Every due day is the APP's day (PT),
  // computed in-browser, never the runner's.
  async function seed(page: Page, todos: Array<Record<string, unknown>>) {
    await freshApp(page);
    await page.addInitScript((todos) => {
      const pt = (off: number) => { const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()) + 'T12:00:00'); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      const v = (id: string, name: string, x?: Record<string, unknown>) => Object.assign({ id, name, emoji: '⚡', difficulty: 'easy', type: 'build', primaryStat: 'VIT' }, x || {});
      localStorage.setItem('hb_habits', JSON.stringify([v('m1', 'Get morning sunlight'), v('d1', 'Stretch after lunch', { custom: true }), v('e1', 'Read 20 pages', { custom: true, tod: 'evening', primaryStat: 'INT' }), v('e2', 'Plan tomorrow the night before', { primaryStat: 'FOCUS' })]));
      localStorage.setItem('hb_todos_v1', JSON.stringify(todos.map((t) => Object.assign({}, t, { due: typeof t.due === 'number' ? pt(t.due) : null, dd: t.dd === '@today' ? pt(0) : (t.dd || null) }))));
      localStorage.setItem('hb_points', '500');
      localStorage.setItem('hb_first_completion_bonus_v1', '1');   // no First Step bonus in the way
      localStorage.setItem('hb_first_vow_pointer_seen', '1');
      localStorage.setItem('hb_dd_v1', JSON.stringify({ done: true }));
      localStorage.setItem('hb_tour_welcome_back_v1', '1');   // the First Awakened's welcome-back card would sit over every tap
    }, todos);
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { const s = document.getElementById('awakened-splash'); if (s) s.remove(); });
    await page.click('#tab-habits');
    await expect(page.locator('.tod-sec').first()).toBeVisible({ timeout: 10_000 });
  }
  const secs = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('.tod-sec')).map((s) => (s as HTMLElement).dataset.tod + ':' + Array.from(s.querySelectorAll('.habit-item')).map((r) => (r as HTMLElement).dataset.id).join(',')));
  const points = (page: Page) => page.evaluate(() => localStorage.getItem('hb_points'));
  const openRows = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('#todo-view .todo-row:not(.todo-row--done)')).map((r) => (r.querySelector('.todo-tx') as HTMLElement).textContent + '|' + ((r.querySelector('.todo-due') as HTMLElement | null)?.textContent || '')));

  test('the tab reads like a day: three sections in order with counts, one lit; a seal updates the count and sinks the row; a header folds', async ({ page }) => {
    await seed(page, []);
    expect(await secs(page)).toEqual(['morning:m1', 'day:d1', 'evening:e1,e2']);
    await expect(page.locator('.tod-sec--lit')).toHaveCount(1);
    await expect(page.locator('.tod-sec[data-tod="evening"] [data-tod-ct]')).toHaveText('· 0 OF 2');
    // seal the first evening vow: the count and hairline move at once, the row sinks after the seal
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="e1"]') as HTMLElement).click());
    await expect(page.locator('.tod-sec[data-tod="evening"] [data-tod-ct]')).toHaveText('· 1 OF 2');
    expect(await page.evaluate(() => (document.querySelector('.tod-sec[data-tod="evening"] [data-tod-hair]') as HTMLElement).style.width)).toBe('50%');
    await page.waitForTimeout(700);
    expect((await secs(page))[2]).toBe('evening:e2,e1');
    // the header folds and unfolds
    await page.evaluate(() => (document.querySelector('.tod-sec[data-tod="morning"] [data-tod-fold]') as HTMLElement).click());
    await expect(page.locator('.tod-sec[data-tod="morning"]')).toHaveClass(/tod-sec--fold/);
    await expect(page.locator('.tod-sec[data-tod="morning"] [data-tod-fold]')).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => (document.querySelector('.tod-sec[data-tod="morning"] [data-tod-fold]') as HTMLElement).click());
    await expect(page.locator('.tod-sec[data-tod="morning"]')).not.toHaveClass(/tod-sec--fold/);
    // every row is still a vow row — the toggle went through toggleHabit
    await expect(page.locator('#completed-count')).toHaveText('1');
    // W998 — the seal that finishes a section folds it; a fresh render keeps it folded;
    // opening it by hand sticks for the session; the next finishing seal folds again
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="d1"]') as HTMLElement).click());
    await expect(page.locator('.tod-sec[data-tod="day"] [data-tod-ct]')).toHaveText('· 1 OF 1');
    await expect(page.locator('.tod-sec[data-tod="day"]')).toHaveClass(/tod-sec--fold/, { timeout: 3_000 });
    await expect(page.locator('.tod-sec[data-tod="morning"]')).not.toHaveClass(/tod-sec--fold/);
    // tab switches go through element.click(): a rank achievement popup can sit over the tab bar here
    const tab = (id: string) => page.evaluate((id) => document.getElementById(id)!.click(), id);
    await tab('tab-profile');
    await tab('tab-habits');
    await expect(page.locator('.tod-sec[data-tod="day"]')).toHaveClass(/tod-sec--fold/);
    await page.evaluate(() => (document.querySelector('.tod-sec[data-tod="day"] [data-tod-fold]') as HTMLElement).click());
    await expect(page.locator('.tod-sec[data-tod="day"]')).not.toHaveClass(/tod-sec--fold/);
    await tab('tab-profile');
    await tab('tab-habits');
    await expect(page.locator('.tod-sec[data-tod="day"]')).not.toHaveClass(/tod-sec--fold/);   // the open sticks
    // unseal and seal again: the finishing seal folds it once more
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="d1"]') as HTMLElement).click());
    await expect(page.locator('.tod-sec[data-tod="day"] [data-tod-ct]')).toHaveText('· 0 OF 1');
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="d1"]') as HTMLElement).click());
    await expect(page.locator('.tod-sec[data-tod="day"]')).toHaveClass(/tod-sec--fold/, { timeout: 3_000 });
  });

  test('W1009: the briefing leads with a to-do card — overdue first, then today; nothing due names the next; none yet invites a plan; the preview always shows one', async ({ page }) => {
    await seed(page, [{ id: 't1', t: 'Return the library book', due: -1, rem: null, at: 1 }, { id: 't2', t: 'Book dentist', due: 0, rem: '12:00', at: 2 }, { id: 't4', t: 'Pay rent', due: 0, rem: null, pri: true, at: 3 }, { id: 't3', t: 'Call Dad', due: 1, rem: null, at: 4 }]);
    const card = () => page.evaluate(() => { const c = document.querySelector('#tb-root .tb-todo'); if (!c) return null; return { cnt: (c.querySelector('.tb-tdc')?.textContent || ''), rows: Array.from(c.querySelectorAll('.tb-tdr')).map((r) => (r.querySelector('span')!.textContent || '') + '|' + (r.querySelector('b')?.textContent || '') + (r.querySelector('i.tb-tdpri') ? '|pri' : '')), empty: c.querySelector('.tb-tde')?.textContent || '', more: c.querySelector('.tb-tdm')?.textContent || '' }; });
    await page.evaluate(() => (window as any).__tb.show({}));
    await expect(page.locator('#tb-root .tb-todo')).toBeVisible({ timeout: 5_000 });
    expect(await card()).toEqual({ cnt: '2 due · 1 overdue', rows: ['Return the library book|OVERDUE', 'Pay rent||pri', 'Book dentist|12:00'], empty: '', more: '' });
    await expect(page.locator('#tb-root .tb-ringwrap, #tb-root .tb-chip')).toHaveCount(0);
    // nothing due today (only tomorrow's): the card names the next one
    await page.evaluate(() => { const a = (window as any).__todo.load(); for (let i = a.length - 1; i >= 0; i--) if (a[i].id !== 't3') a.splice(i, 1); (window as any).__tb.show({}); });
    expect(await card()).toEqual({ cnt: '', rows: [], empty: 'Nothing due today.', more: 'Next · TOMORROW · Call Dad' });
    // W1017 — no to-dos at all: the card asks for the first one, right there
    await page.evaluate(() => { (window as any).__todo.load().length = 0; (window as any).__tb.show({}); });
    expect(await card()).toEqual({ cnt: '', rows: [], empty: 'Have an appointment or errand this week?', more: '' });
    await expect(page.locator('#tb-root [data-tb-tdday]')).toHaveCount(7);                 // W1018 — today + the six days after
    await expect(page.locator('#tb-root .tb-tdday--on')).toHaveText('TODAY');
    await expect(page.locator('#tb-root [data-tb-tdin]')).toHaveAttribute('placeholder', 'Add it to your to-do list');
    // the owner's preview adds to the card but saves nothing
    await page.evaluate(() => (window as any).__previewTodaysBriefing());
    await page.fill('#tb-root [data-tb-tdin]', 'Preview only');
    await page.click('#tb-root [data-tb-tdgo]');
    expect((await card())!.rows).toEqual(['Preview only|']);
    expect(await page.evaluate(() => (window as any).__todo.load().length)).toBe(0);   // nothing was added
  });

  test('W1017: the first to-do from the briefing — ADD puts it on today, the card shows it, and starting the day lands on the planner', async ({ page }) => {
    await seed(page, []);
    await page.evaluate(() => (window as any).__tb.show({}));
    await expect(page.locator('#tb-root [data-tb-tdin]')).toBeVisible({ timeout: 5_000 });
    await page.fill('#tb-root [data-tb-tdin]', 'Dentist at 3');
    await page.press('#tb-root [data-tb-tdin]', 'Enter');
    await expect(page.locator('#tb-root .tb-todo .tb-tdr span')).toHaveText('Dentist at 3');
    await expect(page.locator('#tb-root .tb-todo .tb-tdc')).toHaveText('1 due');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_todos_v1') || '[]'));
    const todayPT = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()));
    expect(stored.map((t: any) => t.t + '|' + t.due + '|' + t.xp)).toEqual(['Dentist at 3|' + todayPT + '|false']);
    await expect(page.locator('[data-todo-n]').first()).toHaveText('1');
    await page.waitForTimeout(1500);
    const box = (await page.locator('#tb-root .tb-seal').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(1150); await page.mouse.up();
    await expect(page.locator('#todo-view')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-vows-view="todo"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#todo-view [data-todo-k="d0"] .todo-w')).toHaveCount(1);
  });

  test('W1018: planning ahead from the briefing — pick a day in the row and the to-do lands there; the card names it as next', async ({ page }) => {
    await seed(page, []);
    await page.evaluate(() => (window as any).__tb.show({}));
    await expect(page.locator('#tb-root [data-tb-tdin]')).toBeVisible({ timeout: 5_000 });
    const label = (await page.locator('#tb-root [data-tb-tdday="2"]').textContent())!.trim();
    await page.click('#tb-root [data-tb-tdday="2"]');
    await expect(page.locator('#tb-root .tb-tdday--on')).toHaveText(label);
    await expect(page.locator('#tb-root [data-tb-tdday="0"]')).toHaveAttribute('aria-pressed', 'false');
    await page.fill('#tb-root [data-tb-tdin]', 'Dentist at 3');
    await page.click('#tb-root [data-tb-tdgo]');
    const want = await page.evaluate(() => { const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()) + 'T12:00:00'); d.setDate(d.getDate() + 2); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
    expect((await page.evaluate(() => JSON.parse(localStorage.getItem('hb_todos_v1') || '[]'))).map((t: any) => t.t + '|' + t.due)).toEqual(['Dentist at 3|' + want]);
    await expect(page.locator('#tb-root .tb-todo .tb-tde')).toHaveText('Nothing due today.');
    await expect(page.locator('#tb-root .tb-todo .tb-tdm')).toHaveText('Next · ' + label + ' · Dentist at 3');
    await expect(page.locator('[data-todo-n]').first()).toBeHidden();                      // the badge is today's list only
  });

  test('TIME OF DAY on the sheets: a custom vow made with EVENING lands in the evening section; the edit sheet moves a library vow', async ({ page }) => {
    await seed(page, []);
    await openAddHabits(page);
    await page.locator('#lib-create-row').click();
    await expect(page.locator('#custom-overlay')).toBeVisible();
    await expect(page.locator('#custom-tod-row .tod-tri-btn--on')).toHaveAttribute('data-tod', 'day');   // default Day
    await page.locator('#custom-name-input').fill('Night stretch');
    await page.locator('.custom-stat-btn').first().click();
    await page.locator('.custom-icon-tile').first().click();
    await page.locator('#custom-tod-row [data-tod="evening"]').click();
    await page.locator('#custom-save-btn').click();
    await expect(page.locator('#custom-overlay')).toBeHidden({ timeout: 3_000 });
    await expect(page.locator('#lib-sheet')).toBeHidden({ timeout: 3_000 });
    expect((await secs(page))[2]).toMatch(/^evening:e1,e2,/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').find((h: any) => h.name === 'Night stretch').tod)).toBe('evening');
    // edit a library vow: MORNING → EVENING; the morning section disappears with its only vow
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="m1"] [data-more]') as HTMLElement).click());
    await page.click('#ctx-edit');
    await expect(page.locator('#edit-modal')).toBeVisible();
    await expect(page.locator('#edit-tod-row .tod-tri-btn--on')).toHaveAttribute('data-tod', 'morning');
    await page.click('#edit-tod-row [data-tod="evening"]');
    await page.click('#save-edit-btn');
    await expect(page.locator('#edit-modal')).toBeHidden();
    const after = await secs(page);
    expect(after[0]).toBe('day:d1');
    expect(after[1]).toMatch(/^evening:.*m1/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').find((h: any) => h.id === 'm1').tod)).toBe('evening');
  });

  // W996 — the six-dot grip: within a section it reorders; across sections it moves the vow
  // (its time of day follows). Pointer events are synthesized: the drag is pointer-driven.
  test('W996/W997: sections never overflow the screen; the grip reorders within a section and moves a vow across sections — and the touched row never leaves the document mid-drag', async ({ page }) => {
    await seed(page, []);
    // a long vow name must not push the row past the list's right edge
    const over = await page.evaluate(() => { const L = document.getElementById('habit-list')!.getBoundingClientRect(); return Array.from(document.querySelectorAll('#habit-list .habit-item')).filter((r) => r.getBoundingClientRect().right > L.right + 1).length; });
    expect(over).toBe(0);
    await expect(page.locator('#habit-list .hlr-grip')).toHaveCount(4);
    const drag = (from: string, target: string, mode: 'top' | 'below') => page.evaluate(([from, target, mode]) => {
      const ev = (type: string, x: number, y: number, el: Element) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 }));
      const g = document.querySelector('.habit-item[data-id="' + from + '"] .hlr-grip')!; const gr = g.getBoundingClientRect();
      const t = document.querySelector(target)!.getBoundingClientRect();
      const y = mode === 'top' ? t.top + 8 : t.top + t.height / 2 + 30;
      // W997 — WebKit cancels a touch whose target node is removed: the row must never be
      // re-inserted while the pointer is down. Only the slot may move.
      const row = g.closest('.habit-item')!; const moved: string[] = [];
      const P = Node.prototype; const ib = P.insertBefore, ac = P.appendChild, rc = P.removeChild;
      P.insertBefore = function (n: any, ref: any) { if (n === row) moved.push('insertBefore'); return ib.call(this, n, ref); } as any;
      P.appendChild = function (n: any) { if (n === row) moved.push('appendChild'); return ac.call(this, n); } as any;
      P.removeChild = function (n: any) { if (n === row) moved.push('removeChild'); return rc.call(this, n); } as any;
      ev('pointerdown', gr.left + 9, gr.top + 22, g); ev('pointermove', gr.left + 9, y, g);
      const mid = { moved: moved.length, slot: !!document.querySelector('.hlr-slot'), connected: row.isConnected };
      ev('pointerup', gr.left + 9, y, g);
      P.insertBefore = ib; P.appendChild = ac; P.removeChild = rc;
      (window as any).__dragMid = mid;
    }, [from, target, mode] as [string, string, string]);
    const mid = () => page.evaluate(() => (window as any).__dragMid);
    // across sections: the morning vow goes under the DAY header → first in DAY, tod = day
    await drag('m1', '.tod-sec[data-tod="day"] .tod-sh', 'below');
    expect(await mid()).toEqual({ moved: 0, slot: true, connected: true });   // the slot travelled, the row stayed put
    await page.waitForTimeout(500);
    expect(await secs(page)).toEqual(['day:m1,d1', 'evening:e1,e2']);
    await expect(page.locator('.hlr-slot')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').find((h: any) => h.id === 'm1').tod)).toBe('day');
    // within a section: the last evening vow goes above the first
    await drag('e2', '.habit-item[data-id="e1"]', 'top');
    await page.waitForTimeout(500);
    expect(await secs(page)).toEqual(['day:m1,d1', 'evening:e2,e1']);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').map((h: any) => h.id))).toEqual(['m1', 'd1', 'e2', 'e1']);
    // a tap on the grip is not a seal
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="d1"] .hlr-grip') as HTMLElement).click());
    await expect(page.locator('#completed-count')).toHaveText('0');
    // W999 — the briefing's lead pin (W978) must not undo a drag: pin e1 as today's lead, drag e2
    // above it, and the order holds through the re-render; the pin is retired
    // (the pin only applies on a full rebuild, so reload: the init script re-seeds the vows in
    // their original order — m1 back in MORNING — and the pin survives in localStorage)
    await page.evaluate(() => { const td = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()); localStorage.setItem('hb_brief_lead_v1', JSON.stringify({ date: td, id: 'e2' })); });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { const s = document.getElementById('awakened-splash'); if (s) s.remove(); });
    await page.click('#tab-habits');
    await expect(page.locator('.tod-sec').first()).toBeVisible({ timeout: 10_000 });
    expect(await secs(page)).toEqual(['morning:m1', 'day:d1', 'evening:e2,e1']);   // the pin leads
    await drag('e1', '.habit-item[data-id="e2"]', 'top');
    await page.waitForTimeout(500);
    expect(await secs(page)).toEqual(['morning:m1', 'day:d1', 'evening:e1,e2']);
    expect(await page.evaluate(() => localStorage.getItem('hb_brief_lead_v1'))).toBeNull();
    await page.click('#tab-profile'); await page.click('#tab-habits');
    expect(await secs(page)).toEqual(['morning:m1', 'day:d1', 'evening:e1,e2']);   // and it holds
  });

  // W1000 — to-dos v2 (handoff 28): grouped by day, ADD + PRIORITY, a swipe reveals POSTPONE and
  // DELETE (with UNDO), the edit sheet, CLEAR DONE with UNDO, and the grip reorders within a day.
});

// W1033 — the ready hunt, groundwork: which solo boss does one day's number beat. Nothing is
// scheduled or shown from it yet; the sheet waits on the design.
test.describe('CA · The ready hunt, groundwork (W1033)', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('the ladders are the one-day, one-metric solo bosses, easiest first', async ({ page }) => {
    await freshApp(page);
    const l = await page.evaluate(() => { const r = (window as any).__readyHunt; return ['steps', 'flights', 'sleep'].map((m) => r.ladder(m).map((x: any) => x.bossId + ':' + x.rank + ':' + x.bar)); });
    expect(l[0]).toEqual(['the_steel_wolf:E:6000', 'the_glass_strider:D:7500', 'the_marathon_wraith:C:10000']);
    expect(l[1]).toEqual(['the_carouser:E:5', 'the_ascendant_colossus:C:10', 'the_unbroken_anvil:A:15']);
    expect(l[2]).toEqual(['the_insomniac:E:7', 'the_dream_tyrant:D:7.5']);
  });

  test('a new hunter is offered only what their rank can start; nothing below the bar', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(() => { const p = (window as any).__readyHunt.pick; return [p('steps', 5999), p('steps', 6000), p('steps', 25000), p('sleep', 8), p('flights', 0), p('steps', NaN)]; });
    expect(r[0]).toBeNull();
    expect(r[1]).toMatchObject({ bossId: 'the_steel_wolf', bar: 6000, value: 6000, also: [] });
    expect(r[2].bossId).toBe('the_steel_wolf');          // E-rank hunter: the D and C gates are shut
    expect(r[3].bossId).toBe('the_insomniac');
    expect(r[4]).toBeNull();
    expect(r[5]).toBeNull();
  });

  test('a boss already beaten today is not offered again', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(() => {
      const p = (window as any).__readyHunt.pick;
      const before = p('steps', 9000);
      localStorage.setItem('hb_bosses', JSON.stringify({ the_steel_wolf: { streak: 0, kill_count: 1, last_defeated_at: new Date().toISOString(), last_eval_date: null, engaged: false, engaged_at: null } }));
      const after = p('steps', 9000);
      localStorage.removeItem('hb_bosses');
      return [before && before.bossId, after];
    });
    expect(r).toEqual(['the_steel_wolf', null]);
  });

  test('a hunt notification opens its boss; an unknown one lands on Habits', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(() => { const o = (window as any).__readyHunt.open; return [o('not_a_boss'), o(''), o('the_twin_maw'), o('the_steel_wolf')]; });
    expect(r).toEqual([false, false, false, true]);
    await expect(page.locator('#boss-fs-overlay')).toBeVisible();
  });
});

// W1034 · W1038 · W1039 — the ready hunt: a hunter whose real Apple Health data already beats a
// solo boss (any of the nineteen, at or below their rank) is told in the app, and finishes it
// with one free tap. Several at once: one STRIKE ALL, each boss paying its own reward.
test.describe('CB · The ready hunt (W1034 · W1039)', () => {
  // One day of Apple Health. `days[0]` is today, `days[1]` yesterday, and so on.
  type Day = { steps?: number; flights?: number; sleepH?: number; workoutMin?: number; kcal?: number };
  type H = Day & { granted?: boolean; days?: Record<number, Day> };
  async function hunter(page: Page, bosses: Record<string, unknown>, extra?: Record<string, string>) {
    await freshApp(page);
    await page.addInitScript(({ bosses, extra }: { bosses: Record<string, unknown>; extra: Record<string, string> }) => {
      try {
        if (sessionStorage.getItem('__w1034_seeded')) return;
        sessionStorage.setItem('__w1034_seeded', '1');
        const old = new Date(); old.setDate(old.getDate() - 3);
        const oymd = old.getFullYear() + '-' + String(old.getMonth() + 1).padStart(2, '0') + '-' + String(old.getDate()).padStart(2, '0');
        localStorage.setItem('hb_habits', JSON.stringify([{ id: 'w1034-a', name: 'First vow', emoji: '•', difficulty: 'easy', type: 'build', custom: true, primaryStat: 'WILL' }]));
        localStorage.setItem('hb_bosses', JSON.stringify(bosses));
        localStorage.setItem('hb_bosses_engagement_migrated', '1');
        localStorage.setItem('hb_souls', JSON.stringify({ balance: 500, totalEarned: 500, totalSpent: 0, lastDailyBonusDate: '2999-01-01' }));
        localStorage.setItem('hb_onboarding_first_xp_date', oymd);
        ['hb_first_completion_bonus_v1', 'hb_tour_first_vow_v1', 'hb_tour_welcome_back_v1', 'hb_tour_day3_v1', 'hb_tour_day7_v1',
         'hb_fg_guide_v1', 'hb_fm_pointer_seen', 'hb_notif_perm_requested', 'hb_tour_quests_v1', 'hb_tour_items_v1'].forEach((k) => localStorage.setItem(k, '1'));
        localStorage.setItem('hb_dd_v1', JSON.stringify({ day: 3, sealed: [true, true, true], done: true, startedAt: 1 }));
        // '@today' = the BROWSER's own date. A date made in the test process can be a day ahead of
        // the browser (the process runs in UTC, the browser in the machine's zone), which made the
        // day-one specs fail every evening on a Pacific machine.
        const now = new Date();
        const tymd = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        Object.entries(extra || {}).forEach(([k, v]) => localStorage.setItem(k, v === '@today' ? tymd : v));
      } catch (_) {}
    }, { bosses, extra: extra || {} });
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await page.waitForTimeout(2200);   // the Habits tick has run (with no Health on the web: nothing offered)
  }
  // Stand in for Apple Health, day by day, then scan. The scan and the kill resolver read the same stand-in.
  async function health(page: Page, o: H) {
    await page.evaluate(async (o) => {
      const w = window as any, Hh = w.Health;
      const days: Record<string, any> = Object.assign({}, o.days || {});
      if (!days[0]) days[0] = { steps: o.steps, flights: o.flights, sleepH: o.sleepH, workoutMin: o.workoutMin, kcal: o.kcal, runMin: (o as any).runMin };
      const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const ago = (iso: string) => { const a = new Date(iso); a.setHours(0, 0, 0, 0); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((t.getTime() - a.getTime()) / 86400000); };
      // every local day a [start, end] range touches, as days-ago
      const span = (s: string, e: string) => { const out: number[] = []; for (let n = ago(s); n >= Math.max(0, ago(e)); n--) out.push(n); return out; };
      const day = (n: number) => days[n] || {};
      Hh.isAvailable = () => true;
      Hh.permissionStatus = () => (o.granted === false ? 'denied' : 'granted');
      Hh.getStepsToday = async () => day(0).steps || 0;
      Hh.getFlightsClimbedToday = async () => day(0).flights || 0;
      Hh.getStepsBetween = async (s: string, e: string) => span(s, e).reduce((a, n) => a + (day(n).steps || 0), 0);
      Hh.getFlightsClimbedBetween = async (s: string, e: string) => span(s, e).reduce((a, n) => a + (day(n).flights || 0), 0);
      Hh.getActiveEnergyBetween = async (s: string, e: string) => span(s, e).reduce((a, n) => a + (day(n).kcal || 0), 0);
      Hh.getStrengthWorkoutsBetween = async (s: string, e: string) => span(s, e).filter((n) => day(n).workoutMin).map((n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(9, 0, 0, 0); return { duration_min: day(n).workoutMin, startDate: d.toISOString() }; });
      // W1054 — any workout type: `workoutMin` is strength training (both readers see it), `runMin` a run
      // (only the any-type reader sees it), `manualMin` one typed into the Health app (neither does).
      Hh.getAnyWorkoutsBetween = async (s: string, e: string) => span(s, e).flatMap((n) => {
        const at = new Date(); at.setDate(at.getDate() - n); at.setHours(9, 0, 0, 0);
        const out: any[] = [];
        if (day(n).workoutMin) out.push({ duration_min: day(n).workoutMin, startDate: at.toISOString(), activityName: 'Traditional Strength Training' });
        if (day(n).runMin) out.push({ duration_min: day(n).runMin, startDate: at.toISOString(), activityName: 'Running' });
        return out;
      });
      Hh.getSleepBetween = async () => { const byDate: Record<string, any> = {}; Object.keys(days).forEach((k) => { if (days[k].sleepH) { const d = new Date(); d.setDate(d.getDate() - Number(k)); byDate[ymd(d)] = { totalAsleepHours: days[k].sleepH }; } }); return { samples: [], byDate }; };
      Hh.getSleepLastNight = async () => null;
      Hh.getAnyWorkoutsToday = async () => null;
      Hh.getStrengthWorkoutsToday = async () => null;
      await w.__readyHunt.scan();
    }, o);
  }
  const souls = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hb_souls') || '{}'));
  const boss = (page: Page, id: string) => page.evaluate((id) => (JSON.parse(localStorage.getItem('hb_bosses') || '{}')[id] || {}), id);
  const offers = (page: Page) => page.evaluate(() => (window as any).__readyHunt.offers() as string[]);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
  // A kill a few days back opens that boss's rank gate (the app's own grandfather rule).
  const past = (n = 5) => ({ kill_count: 1, streak: 0, engaged: false, last_defeated_at: daysAgo(n) });
  const GATE = { D: { the_iron_warden: past() }, C: { the_furnace_knight: past() }, B: { the_forge_of_ten_thousand_days: past(9) }, A: { the_unbroken_anvil: past() }, S: { the_worldspine: past() } };
  const sheet = (page: Page) => page.locator('#rh-sheet.rh-sheet--on');
  // a purse of exactly `n` souls once the app has added today's 15-soul login bonus
  const purse = (n: number) => ({ hb_souls: JSON.stringify({ balance: n - 15, totalEarned: n - 15, totalSpent: 0 }) });

  test('the day already clears the Wolf: the sheet rises once, the row says it, a reload does not pop again', async ({ page }) => {
    await hunter(page, {});
    await health(page, { steps: 9632 });
    await expect(sheet(page)).toBeVisible({ timeout: 8000 });
    await expect(sheet(page).locator('.rh-name')).toHaveText('The Steel Wolf');
    await expect(sheet(page).locator('.rh-chip')).toHaveText(/E rank/i);
    await expect(sheet(page).locator('.rh-pl')).toHaveText(/9,632\s*\/\s*6,000 steps today/i, { timeout: 4000 });
    await expect(sheet(page).locator('.rh-call')).toHaveText(/^strike$/i);
    await expect(sheet(page).locator('.rh-quiet')).toHaveText('Your first hunt is free');
    await expect(sheet(page).locator('.rh-row')).toHaveCount(0);            // one boss: no list
    const row = page.locator('#hunt-row.hunt-row--ready');
    await expect(row).toContainText('9,632 steps today');
    await expect(row).toContainText('The Steel Wolf is ready');
    expect(await page.evaluate(() => (window as any).__stage.busy())).toBe(true);   // nothing lands on top of it
    await page.locator('#rh-sheet [data-rh-close]').click();
    await expect(sheet(page)).toHaveCount(0);
    await row.click();
    await expect(sheet(page)).toBeVisible();
    // the same day, after a reload: the row is back, the sheet stays down (already announced)
    await page.reload();
    await expect(page.locator('#tab-habits')).toBeVisible({ timeout: 15_000 });
    await page.locator('#tab-habits').click();
    await page.waitForTimeout(2200);
    await health(page, { steps: 9632 });
    await expect(page.locator('#hunt-row.hunt-row--ready')).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.locator('.rh-sheet--on')).toHaveCount(0);
    expect(await page.evaluate(() => (localStorage.getItem('hb_funnel_queue') || '').split('ready_hunt_shown').length - 1)).toBe(1);
  });

  test('STRIKE is free, wins on the spot, and hands over to the result already struck', async ({ page }) => {
    await hunter(page, {});
    await health(page, { steps: 9632 });
    await expect(sheet(page)).toBeVisible({ timeout: 8000 });
    await page.locator('#rh-sheet [data-rh-strike]').click();
    const res = page.locator('#boss-result-overlay');
    await expect(res.locator('.hr-port.hr-dead')).toBeVisible({ timeout: 5000 });   // no second strike: it opens struck
    await expect(res.locator('.hr-boss')).toHaveText('The Steel Wolf');
    await expect(res.locator('.hr-stamp.hr-on')).toHaveText(/beaten/i, { timeout: 5000 });
    await expect(page.locator('.rh-sheet--on')).toHaveCount(0);
    await expect(page.locator('.rh-fly')).toHaveCount(0);
    const s = await souls(page), b = await boss(page, 'the_steel_wolf');
    expect(s.totalSpent || 0).toBe(0);                       // a first hunt is free, as on any engage
    expect(s.balance).toBeGreaterThanOrEqual(550);           // the 50-soul kill
    expect([b.kill_count, b.engaged]).toEqual([1, false]);
    expect(await page.evaluate(() => localStorage.getItem('hb_first_hunt_free_used'))).toBe('1');   // and that credit is now spent
    expect(await page.evaluate(() => localStorage.getItem('hb_funnel_queue') || '')).toContain('ready_hunt_strike');
    expect(await offers(page)).toEqual([]);
    await expect(page.locator('#hunt-row.hunt-row--ready')).toHaveCount(0);
  });

  test('W1039 — 10,400 steps at C rank: three hunts on one sheet, STRIKE ALL, three kills each paying its own reward', async ({ page }) => {
    await hunter(page, { ...GATE.D, ...GATE.C }, purse(40));
    await health(page, { steps: 10400 });
    expect(await offers(page)).toEqual(['the_marathon_wraith', 'the_glass_strider', 'the_steel_wolf']);   // highest rank leads
    await expect(sheet(page).locator('.rh-many')).toHaveText('3 hunts are ready', { timeout: 8000 });
    await expect(sheet(page).locator('.rh-row')).toHaveCount(3);
    await expect(sheet(page).locator('.rh-row-name')).toHaveText(['The Marathon Wraith', 'The Glass Strider', 'The Steel Wolf']);
    await expect(sheet(page).locator('.rh-row-cond').first()).toContainText('10,400 steps today');
    await expect(sheet(page).locator('.rh-call')).toHaveText(/strike all/i);
    // the fees are not waived: 25 + 50 + 100 from a purse of 40, each win paying for the next
    await expect(sheet(page).locator('.rh-quiet')).toHaveText('Fees 175 souls · you have 40. Each win pays for the next.');
    await expect(page.locator('#hunt-row.hunt-row--ready')).toContainText('3 hunts are ready');
    const before = await souls(page);
    const ledgerBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_souls_ledger') || '[]').length);
    await sheet(page).locator('[data-rh-strike]').click();
    await expect(page.locator('#boss-result-overlay .hr-boss')).toHaveText('The Marathon Wraith', { timeout: 6000 });   // the lead's result first
    const r = await page.evaluate(() => {
      const b = JSON.parse(localStorage.getItem('hb_bosses') || '{}');
      const ledger = JSON.parse(localStorage.getItem('hb_souls_ledger') || '[]');
      const hist = JSON.parse(localStorage.getItem('hb_hunt_history') || '[]');
      const ids = ['the_marathon_wraith', 'the_glass_strider', 'the_steel_wolf'];
      return {
        kills: ids.map((i) => (b[i] || {}).kill_count || 0), engaged: ids.map((i) => !!(b[i] || {}).engaged),
        paid: ledger.length,
        hist: ids.map((i) => hist.filter((h: any) => JSON.stringify(h).indexOf(i) !== -1).length),
      };
    });
    expect(r.kills).toEqual([1, 1, 1]);
    expect(r.engaged).toEqual([false, false, false]);
    expect(r.paid - ledgerBefore).toBeGreaterThanOrEqual(3);  // three separate soul payouts, not one
    expect(r.hist).toEqual([1, 1, 1]);                       // three separate kills in the hunt record (each rolled its own drop)
    const after = await souls(page);
    expect(after.totalSpent).toBe(25 + 50 + 100);            // every entrance fee paid
    expect(after.balance - before.balance).toBeGreaterThanOrEqual((200 + 100 + 50) - 175);
    // the other two results follow, one after another
    const seen = new Set<string>();
    for (let i = 0; i < 40 && seen.size < 3; i++) {
      const name = await page.evaluate(() => { const o = document.getElementById('boss-result-overlay'); const n = o && !o.classList.contains('hidden') && o.querySelector('.hr-boss'); return n ? n.textContent : ''; });
      if (name) { seen.add(name); await page.evaluate(() => { const f = document.querySelector('#boss-result-overlay .hr-frame') as HTMLElement; if (f) { f.click(); f.click(); } }); }
      await page.waitForTimeout(450);
    }
    expect([...seen].sort()).toEqual(['The Glass Strider', 'The Marathon Wraith', 'The Steel Wolf']);
  });

  test('W1039 — the rank lock stays: an E-rank hunter with 10,400 steps is offered the Wolf alone', async ({ page }) => {
    await hunter(page, {});
    await health(page, { steps: 10400, flights: 22, workoutMin: 40, kcal: 500, sleepH: 6 });
    expect(await offers(page)).toEqual(['the_steel_wolf', 'the_carouser']);   // the two E bosses the day beats; nothing above
  });

  test('W1039 — workouts count: ten minutes takes the Iron Warden; a strength workout and 300 kcal the Furnace Knight', async ({ page }) => {
    await hunter(page, { the_glass_strider: past(), the_ascendant_colossus: past() });   // D and C gates open
    await health(page, { workoutMin: 20, kcal: 120 });
    expect(await offers(page)).toEqual(['the_iron_warden']);
    await expect(sheet(page).locator('.rh-name')).toHaveText('The Iron Warden', { timeout: 8000 });
    await expect(sheet(page).locator('.rh-cond')).toContainText(/workout/i);     // no single number: the condition, ticked
    await page.locator('#rh-sheet [data-rh-close]').click();
    await health(page, { workoutMin: 20, kcal: 340 });
    expect(await offers(page)).toEqual(['the_furnace_knight', 'the_iron_warden']);
    await expect(sheet(page).locator('.rh-many')).toHaveText('2 hunts are ready', { timeout: 8000 });   // rises again: the Knight is new today
    await sheet(page).locator('[data-rh-strike]').click();
    await expect(page.locator('#boss-result-overlay .hr-boss')).toHaveText('The Furnace Knight', { timeout: 6000 });
    expect([(await boss(page, 'the_furnace_knight')).kill_count, (await boss(page, 'the_iron_warden')).kill_count]).toEqual([1, 1]);
  });

  // W1054 — owner 2026-10-14: "Yes Iron Warden fix". RenDIESEL's 31-minute workout posted "verified
  // workout" and never offered the Warden: the look-back read strength training only.
  test('W1054 — any workout type takes the Iron Warden: a run counts, a few minutes do not, the Knight still wants strength', async ({ page }) => {
    await hunter(page, { the_glass_strider: past(), the_ascendant_colossus: past() });   // D and C gates open
    await health(page, { runMin: 5, kcal: 500 } as any);
    expect(await offers(page)).toEqual([]);                                  // five minutes is not ten
    await health(page, { runMin: 31, kcal: 500 } as any);
    expect(await offers(page)).toEqual(['the_iron_warden']);                 // a run is a workout; the Furnace Knight's rule says strength
    await expect(sheet(page).locator('.rh-name')).toHaveText('The Iron Warden', { timeout: 8000 });
    await sheet(page).locator('[data-rh-strike]').click();
    await expect(page.locator('#boss-result-overlay .hr-boss')).toHaveText('The Iron Warden', { timeout: 6000 });
    expect((await boss(page, 'the_iron_warden')).kill_count).toBe(1);
    expect((await boss(page, 'the_furnace_knight')).kill_count || 0).toBe(0);
  });

  test('W1039 — days already finished count: 10,000 steps yesterday and today is the Patient Flame, never started', async ({ page }) => {
    await hunter(page, { ...GATE.B });
    await health(page, { days: { 0: { steps: 10400 } } });
    expect(await offers(page)).not.toContain('the_patient_flame');                       // today alone is one day of two
    await page.evaluate(() => (window as any).closeReadyHunt && (window as any).closeReadyHunt());
    await page.locator('#rh-sheet [data-rh-close]').click({ timeout: 4000 }).catch(() => {});
    await health(page, { days: { 0: { steps: 10400 }, 1: { steps: 11020 } } });
    const o = await offers(page);
    expect(o[0]).toBe('the_patient_flame');                                               // B rank leads
    await page.evaluate(() => (window as any).__readyHunt.openSheet());
    await expect(sheet(page).locator('.rh-row-name').first()).toHaveText('The Patient Flame', { timeout: 8000 });
    await sheet(page).locator('[data-rh-strike]').click();
    await expect(page.locator('#boss-result-overlay .hr-boss')).toHaveText('The Patient Flame', { timeout: 6000 });
    const b = await boss(page, 'the_patient_flame');
    expect([b.kill_count, b.engaged]).toEqual([1, false]);
    expect((await souls(page)).totalSpent || 0).toBeGreaterThanOrEqual(200);   // the B-rank fee, with the others on the sheet
  });

  test('W1039 — a day is spent once per boss: yesterday\'s kill cannot lend its day to today', async ({ page }) => {
    const twoDays = { days: { 0: { steps: 10400 }, 1: { steps: 11020 }, 2: { steps: 10100 } } };
    await hunter(page, { ...GATE.B, the_patient_flame: { kill_count: 1, streak: 0, engaged: false, last_defeated_at: daysAgo(1) } });
    await health(page, twoDays);
    expect(await offers(page)).not.toContain('the_patient_flame');     // the window may only start today: one day of two
    await page.evaluate(() => { const b = JSON.parse(localStorage.getItem('hb_bosses') || '{}'); b.the_patient_flame.last_defeated_at = new Date(Date.now() - 2 * 86400000).toISOString(); localStorage.setItem('hb_bosses', JSON.stringify(b)); });
    await health(page, twoDays);
    expect(await offers(page)).toContain('the_patient_flame');         // killed two days ago: yesterday and today are both fresh
  });

  test('W1039 — three days and a week: Erebus on three full days, the Gray Pilgrim on 56 flights in seven', async ({ page }) => {
    const d = { steps: 10400, flights: 10 };
    await hunter(page, { ...GATE.C, ...GATE.S });
    await health(page, { days: { 0: d, 1: d, 2: d, 3: { flights: 9 }, 4: { flights: 9 }, 5: { flights: 9 }, 6: { flights: 9 } } });   // 66 flights this week
    const o = await offers(page);
    expect(o).toContain('erebus_the_shadow_sovereign');
    expect(o).toContain('the_gray_pilgrim');
    expect(o[0]).toBe('erebus_the_shadow_sovereign');                  // S rank leads
    // two full days is not three
    await page.evaluate(() => (window as any).closeReadyHunt && (window as any).closeReadyHunt());
    await health(page, { days: { 0: d, 1: d, 2: { steps: 4000, flights: 10 } } });
    expect(await offers(page)).not.toContain('erebus_the_shadow_sovereign');
  });

  test('W1039 — asking changes nothing: a scan with a dozen bosses ready leaves bosses and souls untouched', async ({ page }) => {
    const d = { steps: 15400, flights: 22, sleepH: 8, workoutMin: 45, kcal: 600 };
    await hunter(page, { ...GATE.D, ...GATE.C, ...GATE.B, ...GATE.A, ...GATE.S });
    const snap = () => page.evaluate(() => [localStorage.getItem('hb_bosses'), localStorage.getItem('hb_souls'), localStorage.getItem('hb_souls_ledger'), localStorage.getItem('hb_hunt_history')]);
    const before = await snap();
    await health(page, { days: { 0: d, 1: d, 2: d, 3: d, 4: d, 5: d, 6: d } });
    expect((await offers(page)).length).toBeGreaterThanOrEqual(12);
    expect(await snap()).toEqual(before);
    await expect(sheet(page).locator('.rh-row').first()).toBeVisible({ timeout: 8000 });
    // the list scrolls inside the sheet; the button stays on screen
    const box = await sheet(page).locator('.rh-call').boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
  });

  test('sleep reads in hours and minutes; flights in whole numbers', async ({ page }) => {
    await hunter(page, {});
    await health(page, { sleepH: 7 + 40 / 60 });
    await expect(sheet(page).locator('.rh-name')).toHaveText('The Insomniac', { timeout: 8000 });
    await expect(sheet(page).locator('.rh-pl')).toHaveText(/7 h 40 m\s*\/\s*7 h last night/i, { timeout: 4000 });
    await expect(page.locator('#hunt-row.hunt-row--ready')).toContainText('7 h 40 m last night');
    await page.locator('#rh-sheet [data-rh-close]').click();
    await health(page, { flights: 6 });
    await expect(sheet(page).locator('.rh-name')).toHaveText('The Carouser', { timeout: 8000 });      // new today: it rises by itself
    await expect(sheet(page).locator('.rh-pl')).toHaveText(/6\s*\/\s*5 flights today/i, { timeout: 4000 });
  });

  test('W1039 — it rises again for a boss that becomes ready later, and not twice for the same one', async ({ page }) => {
    await hunter(page, {});
    await health(page, { steps: 6830 });
    await expect(sheet(page).locator('.rh-name')).toHaveText('The Steel Wolf', { timeout: 8000 });
    await page.locator('#rh-sheet [data-rh-close]').click();
    await health(page, { steps: 7100 });                              // nothing new
    await page.waitForTimeout(1200);
    await expect(page.locator('.rh-sheet--on')).toHaveCount(0);
    await health(page, { steps: 7100, flights: 5 });                  // the Carouser is new
    await expect(sheet(page).locator('.rh-many')).toHaveText('2 hunts are ready', { timeout: 8000 });   // and the unstruck Wolf rides along
    await page.locator('#rh-sheet [data-rh-close]').click();
    await health(page, { steps: 7300, flights: 6 });
    await page.waitForTimeout(1200);
    await expect(page.locator('.rh-sheet--on')).toHaveCount(0);
    await expect(page.locator('#hunt-row.hunt-row--ready')).toContainText('2 hunts are ready');
  });

  test('nothing is offered: below the bar, Health not granted, beaten today, already engaged', async ({ page }) => {
    await hunter(page, {});
    await health(page, { steps: 5999, flights: 4, sleepH: 6.9 });
    expect(await offers(page)).toEqual([]);
    await health(page, { steps: 9632, granted: false });
    expect(await offers(page)).toEqual([]);
    await health(page, { steps: 9632 });
    expect(await offers(page)).toEqual(['the_steel_wolf']);
    await page.evaluate(() => localStorage.setItem('hb_bosses', JSON.stringify({ the_steel_wolf: { engaged: true, kill_count: 0, streak: 0, hunt_started_at: Date.now(), hunt_expires_at: Date.now() + 3600_000 } })));
    expect(await offers(page)).toEqual([]);                            // already engaged: it resolves on its own
    await page.evaluate(() => localStorage.setItem('hb_bosses', JSON.stringify({ the_steel_wolf: { engaged: false, kill_count: 1, streak: 0, last_defeated_at: new Date().toISOString() } })));
    expect(await offers(page)).toEqual([]);                            // beaten today
    await page.evaluate(() => (window as any).__renderHuntRow());
    await expect(page.locator('#hunt-row.hunt-row--ready')).toHaveCount(0);
  });

  test('Apple Health disagrees at the strike: no win is shown, no souls move, and no hunt is left behind', async ({ page }) => {
    await hunter(page, { ...GATE.D });
    await health(page, { steps: 9632 });
    await expect(sheet(page).locator('.rh-many')).toHaveText('2 hunts are ready', { timeout: 8000 });
    // at the strike Health now reports 7,000: the Wolf still dies, the Strider (7,500) does not
    await page.evaluate(() => { (window as any).Health.getStepsBetween = async () => 7000; });
    const before = await souls(page);
    await sheet(page).locator('[data-rh-strike]').click();
    await expect(page.locator('#boss-result-overlay .hr-boss')).toHaveText('The Steel Wolf', { timeout: 6000 });
    const st = await boss(page, 'the_glass_strider');
    expect([!!st.engaged, st.kill_count || 0]).toEqual([false, 0]);     // taken back, quietly: no hunt, no kill
    expect((await boss(page, 'the_steel_wolf')).kill_count).toBe(1);
    expect(((await souls(page)).totalSpent || 0) - (before.totalSpent || 0)).toBe(25);   // the Wolf's fee; nothing for the kill that did not happen
  });

  test('Apple Health confirms nothing at the strike: the sheet closes, nothing is engaged, nothing is paid', async ({ page }) => {
    await hunter(page, {});
    await health(page, { steps: 9632 });
    await expect(sheet(page)).toBeVisible({ timeout: 8000 });
    await page.evaluate(() => { (window as any).Health.getStepsBetween = async () => 0; });
    const before = await souls(page);
    await page.locator('#rh-sheet [data-rh-strike]').click();
    await expect(page.locator('.rh-sheet--on')).toHaveCount(0, { timeout: 5000 });
    await page.waitForTimeout(900);
    await expect(page.locator('#boss-result-overlay')).toBeHidden();
    const s = await souls(page), b = await boss(page, 'the_steel_wolf');
    expect([s.balance, s.totalSpent || 0]).toEqual([before.balance, 0]);
    expect([!!b.engaged, b.kill_count || 0]).toEqual([false, 0]);
    expect(await page.evaluate(() => localStorage.getItem('hb_first_hunt_free_used'))).toBeNull();   // the free credit is not burnt on a miss
  });

  test('W1039 — the entrance fee is not waived: a purse that cannot pay gets no boss', async ({ page }) => {
    // not a first hunt (the Wolf was beaten two days ago), 20 souls, the Wolf costs 25
    await hunter(page, { the_steel_wolf: { kill_count: 1, streak: 0, engaged: false, last_defeated_at: daysAgo(2) } }, purse(20));
    await health(page, { steps: 9632 });
    await expect(sheet(page).locator('.rh-name')).toHaveText('The Steel Wolf', { timeout: 8000 });
    await expect(sheet(page).locator('.rh-call')).toHaveText(/not enough souls/i);
    await expect(sheet(page).locator('.rh-call')).toBeDisabled();
    await expect(sheet(page).locator('.rh-quiet')).toHaveText('Costs 25 · you have 20. Seal vows to earn souls.');
    await sheet(page).locator('.rh-call').click({ force: true });
    await page.waitForTimeout(900);
    const b = await boss(page, 'the_steel_wolf');
    expect([b.kill_count, !!b.engaged]).toEqual([1, false]);
    expect((await souls(page)).balance).toBe(20);
    await expect(page.locator('#boss-result-overlay')).toBeHidden();
  });

  test('W1039 — a fee out of reach leaves that boss out: two of three are struck, the third says what is missing', async ({ page }) => {
    // E bosses cost 25 each, the A-rank Anvil 400. From 30 souls: 30 - 25 + 50 = 55, 55 - 25 + 50 = 80, and 80 is not 400.
    await hunter(page, { ...GATE.A }, purse(30));
    await health(page, { steps: 9632, flights: 15 });
    expect(await offers(page)).toEqual(['the_unbroken_anvil', 'the_steel_wolf', 'the_carouser']);
    await expect(sheet(page).locator('.rh-call')).toHaveText(/strike 2 of 3/i, { timeout: 8000 });
    await expect(sheet(page).locator('.rh-row--short .rh-row-name')).toHaveText('The Unbroken Anvil');
    await expect(sheet(page).locator('.rh-row--short .rh-row-cond')).toHaveText(/need 320 more souls/i);
    await sheet(page).locator('[data-rh-strike]').click();
    await expect(page.locator('#boss-result-overlay .hr-stamp.hr-on')).toBeVisible({ timeout: 6000 });
    const anvil = await boss(page, 'the_unbroken_anvil');
    expect([(await boss(page, 'the_steel_wolf')).kill_count, (await boss(page, 'the_carouser')).kill_count, anvil.kill_count, !!anvil.engaged]).toEqual([1, 1, 1, false]);
    const s = await souls(page);
    expect([s.totalSpent, s.balance]).toEqual([50, 80]);
    expect(await offers(page)).toEqual(['the_unbroken_anvil']);        // still his, when he can pay
  });

  test('W1041 — a free credit goes to the dearest boss on the sheet, not the first one struck', async ({ page }) => {
    // 30 souls, the stone's free hunt banked. The Wolf and the Carouser cost 25 each, the Anvil 400.
    // Spent on the Anvil, the credit opens all three (0, then 25 from 830, then 25).
    await hunter(page, { ...GATE.A }, { ...purse(30), hb_stone_free_engage: '1' });
    await health(page, { steps: 9632, flights: 15 });
    await expect(sheet(page).locator('.rh-call')).toHaveText(/strike all/i, { timeout: 8000 });
    await expect(sheet(page).locator('.rh-row--short')).toHaveCount(0);
    await expect(sheet(page).locator('.rh-quiet')).toHaveText('Fees 50 souls · you have 30. Each win pays for the next.');
    await sheet(page).locator('[data-rh-strike]').click();
    await expect(page.locator('#boss-result-overlay .hr-boss')).toHaveText('The Unbroken Anvil', { timeout: 6000 });
    const k = async (id: string) => (await boss(page, id)).kill_count;
    expect([await k('the_unbroken_anvil'), await k('the_steel_wolf'), await k('the_carouser')]).toEqual([2, 1, 1]);
    const s = await souls(page);
    expect(s.totalSpent).toBe(50);                                  // two E-rank fees; the Anvil rode the credit
    expect(await page.evaluate(() => localStorage.getItem('hb_stone_free_engage'))).toBeNull();   // and the credit is spent
  });

  test('three hunts already running: ready strikes are outside the three', async ({ page }) => {
    const run = { engaged: true, kill_count: 0, streak: 0, hunt_started_at: Date.now() - 3600_000, hunt_expires_at: Date.now() + 20 * 3600_000 };
    // (the live Dream Tyrant hunt keeps the D gate open, so 9,632 steps beats the Strider too)
    await hunter(page, { the_insomniac: run, the_carouser: run, the_dream_tyrant: run });
    await health(page, { steps: 9632 });
    await expect(sheet(page).locator('.rh-many')).toHaveText('2 hunts are ready', { timeout: 8000 });
    await sheet(page).locator('[data-rh-strike]').click();
    await expect(page.locator('#boss-result-overlay .hr-stamp.hr-on')).toBeVisible({ timeout: 6000 });
    expect([(await boss(page, 'the_glass_strider')).kill_count, (await boss(page, 'the_steel_wolf')).kill_count]).toEqual([1, 1]);
    expect((await boss(page, 'the_insomniac')).engaged).toBe(true);
  });

  test('W1039 — the Settings preview: several bosses then one, the strike plays, and nothing is saved', async ({ page }) => {
    await hunter(page, {});
    const snap = () => page.evaluate(() => [localStorage.getItem('hb_bosses'), localStorage.getItem('hb_souls'), localStorage.getItem('hb_souls_ledger'), localStorage.getItem('hb_hunt_history'), localStorage.getItem('hb_ready_hunt_seen_v1')]);
    const before = await snap();
    await page.evaluate(() => (window as any).__previewReadyHunt());
    await expect(sheet(page).locator('.rh-many')).toHaveText('4 hunts are ready', { timeout: 6000 });
    await expect(sheet(page).locator('.rh-row-name')).toHaveText(['The Marathon Wraith', 'The Glass Strider', 'The Iron Warden', 'The Insomniac']);
    await expect(sheet(page).locator('.rh-preview')).toHaveText(/preview · nothing is saved/i);   // W1041 — it says what it is
    await sheet(page).locator('[data-rh-strike]').click();
    const res = page.locator('#boss-result-overlay');
    await expect(res.locator('.hr-boss')).toHaveText('The Marathon Wraith', { timeout: 6000 });
    await expect(res.locator('.hr-stamp.hr-on')).toBeVisible({ timeout: 6000 });
    // W1041 — a victory for EVERY boss on the sheet, as the real strike plays: the lead, then
    // the rest cheapest first; each with its own souls and its own relic line (one has none).
    const shown: string[] = [];
    for (let i = 0; i < 60 && shown.length < 4; i++) {
      const cur = await page.evaluate(() => {
        const o = document.getElementById('boss-result-overlay');
        if (!o || o.classList.contains('hidden')) return null;
        const q = (s: string) => { const n = o.querySelector(s); return n ? (n.textContent || '').trim() : ''; };
        return { name: q('.hr-boss'), relic: q('.hr-reward .hr-rn') };
      });
      if (cur && cur.name && !shown.some((s) => s.startsWith(cur.name + '|'))) shown.push(cur.name + '|' + cur.relic);
      await page.evaluate(() => { const f = document.querySelector('#boss-result-overlay .hr-frame') as HTMLElement; if (f) { f.click(); f.click(); } });
      await page.waitForTimeout(350);
    }
    expect(shown).toEqual([
      'The Marathon Wraith|A sealed relic', 'The Insomniac|Drowsy Signet', 'The Glass Strider|Glassstep Band', 'The Iron Warden|Souls only this time',
    ]);
    // then the single-boss sheet
    await expect(sheet(page).locator('.rh-name')).toHaveText('The Steel Wolf', { timeout: 6000 });
    await expect(sheet(page).locator('.rh-pl')).toHaveText(/9,632\s*\/\s*6,000 steps today/i, { timeout: 4000 });
    await page.locator('#rh-sheet [data-rh-close]').click();
    await expect(page.locator('.rh-sheet--on')).toHaveCount(0);
    expect(await snap()).toEqual(before);                    // no hunt, no kill, no souls, nothing marked as announced
  });

  // W1038 — day one: the sheet rises for a FIRST kill, and only for a first kill.
  const TODAY = () => '@today';   // the browser's own date, filled in by hunter()
  test('W1038 — day one, slept seven hours: the Insomniac is offered at once and one STRIKE is the first kill', async ({ page }) => {
    const run = { engaged: true, kill_count: 0, streak: 0, hunt_started_at: Date.now() - 60_000, hunt_expires_at: Date.now() + 20 * 3600_000 };
    await hunter(page, { the_steel_wolf: run }, { hb_onboarding_first_xp_date: TODAY(), hb_first_completion_bonus_v1: '0', hb_wolf_trail_v1: '1' });
    expect(await page.evaluate(() => (window as any).__newHunterQuiet())).toBe(true);
    await health(page, { steps: 2100, sleepH: 7 + 40 / 60 });
    await expect(sheet(page).locator('.rh-name')).toHaveText('The Insomniac', { timeout: 8000 });
    await expect(page.locator('#hunt-row.hunt-row--ready')).toContainText('The Insomniac is ready');
    await sheet(page).locator('[data-rh-strike]').click();
    await expect(page.locator('#boss-result-overlay .hr-stamp.hr-on')).toBeVisible({ timeout: 6000 });
    expect((await boss(page, 'the_insomniac')).kill_count).toBe(1);
    expect((await boss(page, 'the_steel_wolf')).engaged).toBe(true);     // the trail's hunt is untouched
    expect((await souls(page)).totalSpent || 0).toBe(25);                // the Insomniac's entrance fee
  });
  test('W1038 — day one with a kill already made: nothing rises by itself, the offer waits on the row', async ({ page }) => {
    await hunter(page, { the_steel_wolf: { engaged: false, kill_count: 1, streak: 0, last_defeated_at: new Date().toISOString() } }, { hb_onboarding_first_xp_date: TODAY() });
    await health(page, { sleepH: 7 + 40 / 60 });
    expect(await offers(page)).toEqual(['the_insomniac']);
    await page.waitForTimeout(1500);
    await expect(page.locator('.rh-sheet--on')).toHaveCount(0);
    await expect(page.locator('#hunt-row.hunt-row--ready')).toContainText('The Insomniac is ready');
  });

  // W1046 — the phone notification. A native watcher posts it (it cannot run here); these pin
  // what the app hands it, and what a tap on it does.
  type Watch = { v: number; on: boolean; at: number; pausedUntil: number; quiet: { start: string; end: string } | null; hold: string; seenDay: string; seen: string[];
    hunts: Array<{ id: string; name: string; metric: string; bar: number; beaten: string; until: number }> };
  const watch = (page: Page) => page.evaluate(() => (window as any).__readyHunt.watch() as Watch);
  const today = (page: Page) => page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  const ids = (w: Watch) => w.hunts.map((h) => h.id).sort();

  test('W1046 — the watch list: the one-number bosses at or below the hunter\'s rank, each with its doors', async ({ page }) => {
    await hunter(page, {
      ...GATE.D, ...GATE.C,
      the_steel_wolf: { engaged: false, kill_count: 1, streak: 0, last_defeated_at: new Date().toISOString() },
      the_carouser: { engaged: true, kill_count: 0, streak: 0, hunt_started_at: Date.now() - 60_000, hunt_expires_at: Date.now() + 20 * 3600_000 },
    });
    await health(page, {});
    const w = await watch(page), day = await today(page);
    expect(w).toMatchObject({ v: 1, on: true, pausedUntil: 0, quiet: { start: '22:00', end: '07:00' }, hold: '', seenDay: day, seen: [] });
    expect(Math.abs(Date.now() - w.at)).toBeLessThan(60_000);
    // E, D and C are open; the A-rank Anvil is not. Compound and many-day bosses are never on it.
    // W1054 — the Iron Warden rides along as today's workout minutes, any type.
    expect(ids(w)).toEqual(['the_ascendant_colossus', 'the_carouser', 'the_dream_tyrant', 'the_glass_strider', 'the_insomniac', 'the_iron_warden', 'the_marathon_wraith', 'the_steel_wolf']);
    const by = Object.fromEntries(w.hunts.map((h) => [h.id, h]));
    expect(by.the_iron_warden).toMatchObject({ name: 'The Iron Warden', metric: 'workout', bar: 10 });
    expect(by.the_marathon_wraith).toEqual({ id: 'the_marathon_wraith', name: 'The Marathon Wraith', metric: 'steps', bar: 10000, beaten: '', until: 0 });
    expect(by.the_ascendant_colossus).toMatchObject({ metric: 'flights', bar: 10 });
    expect(by.the_insomniac).toMatchObject({ metric: 'sleep', bar: 7 });
    expect(by.the_dream_tyrant).toMatchObject({ metric: 'sleep', bar: 7.5 });
    expect(by.the_steel_wolf.beaten).toBe(day);                       // beaten today: the watcher leaves it alone
    expect(by.the_carouser.until).toBeGreaterThan(Date.now() + 19 * 3600_000);   // running: it resolves on its own
  });

  test('W1046 — the hunter\'s doors ride along: Health off, notifications off, a pause, quiet hours off, a fee out of reach', async ({ page }) => {
    await hunter(page, { ...GATE.D, ...GATE.C }, purse(30));
    await health(page, {});
    let w = await watch(page);
    expect(w.on).toBe(true);
    expect(ids(w)).toEqual(['the_carouser', 'the_insomniac', 'the_steel_wolf']);   // 30 souls: an E-rank fee (25), not a D (50) or a C (100)
    const until = Date.now() + 3 * 3600_000;
    await page.evaluate((u) => { localStorage.setItem('hb_notif_paused_until', String(u)); localStorage.setItem('hb_notif_quiet_enabled', '0'); }, until);
    w = await watch(page);
    expect([w.on, w.pausedUntil, w.quiet]).toEqual([true, until, null]);
    await page.evaluate(() => { localStorage.setItem('hb_notif_disabled', '1'); });
    expect((await watch(page)).on).toBe(false);
    await page.evaluate(() => { localStorage.removeItem('hb_notif_disabled'); localStorage.setItem('hb_notif_quiet_start', '21:30'); localStorage.setItem('hb_notif_quiet_enabled', '1'); });
    w = await watch(page);
    expect([w.on, w.quiet]).toEqual([true, { start: '21:30', end: '07:00' }]);
    await health(page, { granted: false });
    expect((await watch(page)).on).toBe(false);
  });

  test('W1046 — day one: a first kill may be announced, and after it the phone is held for the day', async ({ page }) => {
    await hunter(page, {}, { hb_onboarding_first_xp_date: TODAY(), hb_first_completion_bonus_v1: '0', hb_wolf_trail_v1: '1' });
    await health(page, {});
    expect(await page.evaluate(() => (window as any).__newHunterQuiet())).toBe(true);
    expect((await watch(page)).hold).toBe('');
    await page.evaluate(() => { localStorage.setItem('hb_bosses', JSON.stringify({ the_insomniac: { engaged: false, kill_count: 1, streak: 0, last_defeated_at: new Date().toISOString() } })); });
    expect((await watch(page)).hold).toBe(await today(page));
  });

  test('W1046 — a boss the sheet has announced is passed on as seen, so the phone stays quiet about it', async ({ page }) => {
    await hunter(page, {});
    await health(page, { steps: 9632 });
    await expect(sheet(page)).toBeVisible({ timeout: 8000 });
    const w = await watch(page);
    expect([w.seenDay, w.seen]).toEqual([await today(page), ['the_steel_wolf']]);
  });

  test('W1046 — the list is written through the Filesystem plugin when it changes, and only then', async ({ page }) => {
    await hunter(page, {});
    await health(page, {});
    const writes = await page.evaluate(() => {
      const w = window as any, real = w.Capacitor, out: any[] = [];
      w.Capacitor = { isNativePlatform: () => true, Plugins: { Filesystem: { writeFile: (o: any) => { out.push(o); return Promise.resolve(); } } } };
      try {
        w.__readyHunt.watchSync();
        w.__readyHunt.watchSync();                                  // nothing changed: not written again
        localStorage.setItem('hb_notif_disabled', '1');
        w.__readyHunt.watchSync();                                  // the hunter turned notifications off: written
      } finally { w.Capacitor = real; localStorage.removeItem('hb_notif_disabled'); }
      return out;
    });
    expect(writes.length).toBe(2);
    expect(writes.map((o) => [o.path, o.directory, o.encoding])).toEqual([['ready-hunt-watch.json', 'LIBRARY', 'utf8'], ['ready-hunt-watch.json', 'LIBRARY', 'utf8']]);
    const sent = writes.map((o) => JSON.parse(o.data) as Watch);
    expect(sent.map((x) => x.on)).toEqual([true, false]);
    expect(ids(sent[0])).toEqual(['the_carouser', 'the_insomniac', 'the_steel_wolf']);
    // on the web (no plugin) the same call is a quiet no-op
    expect(await page.evaluate(() => typeof (window as any).__readyHunt.watchSync())).toBe('object');
  });

  test('W1046 — a tap on the notification: the sheet rises for what is ready, even a boss announced earlier today', async ({ page }) => {
    await hunter(page, {});
    await health(page, { steps: 9632 });
    await expect(sheet(page)).toBeVisible({ timeout: 8000 });
    await page.locator('#rh-sheet [data-rh-close]').click();
    await expect(page.locator('.rh-sheet--on')).toHaveCount(0);
    await page.evaluate(() => (window as any).__readyHunt.scan());
    await page.waitForTimeout(1200);
    await expect(page.locator('.rh-sheet--on')).toHaveCount(0);          // announced: a plain look does not raise it again
    expect(await page.evaluate(() => (window as any).__readyHunt.open('the_steel_wolf'))).toBe(true);
    await expect(sheet(page)).toBeVisible({ timeout: 8000 });
    await expect(sheet(page).locator('.rh-name')).toHaveText('The Steel Wolf');
    await expect(sheet(page).locator('.rh-call')).toHaveText(/^strike$/i);
    await expect(page.locator('#boss-fs-overlay')).toBeHidden();
  });

  test('W1046 — a tap when nothing is ready after all opens the boss itself, never nothing', async ({ page }) => {
    await hunter(page, {});
    await health(page, { steps: 120 });
    expect(await page.evaluate(() => (window as any).__readyHunt.open('the_steel_wolf'))).toBe(true);
    await expect(page.locator('#boss-fs-overlay')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.rh-sheet--on')).toHaveCount(0);
  });

  test('W1046 — the words: the hunter\'s own number, the boss by name, and no shouting', async ({ page }) => {
    await freshApp(page);
    const t = await page.evaluate(() => { const n = (window as any).__readyHunt.noteText; return [n('steps', 10412, 1, 'The Marathon Wraith'), n('flights', 12, 2, 'x'), n('sleep', 7 + 40 / 60, 3, 'x'), n('sleep', 8, 1, 'The Insomniac')]; });
    expect(t).toEqual([
      { title: 'A hunt is ready', body: '10,412 steps today. The Marathon Wraith is yours.' },
      { title: '2 hunts are ready', body: '12 flights today. One tap takes both.' },
      { title: '3 hunts are ready', body: '7 h 40 m last night. One tap takes all 3.' },
      { title: 'A hunt is ready', body: '8 h last night. The Insomniac is yours.' },
    ]);
    expect(JSON.stringify(t)).not.toMatch(/!|\bfell/i);
  });

  test('W1046 — signing out, and a TEST HUNTER run, both leave the phone with nothing to say', async ({ page }) => {
    await hunter(page, {});
    await health(page, {});
    expect((await watch(page)).on).toBe(true);
    const r = await page.evaluate(async () => {
      const w = window as any, real = w.Capacitor, realBox = w.__awkSandbox, out: any[] = [];
      w.__awkSandbox = { active: () => true };
      const inSandbox = w.__readyHunt.watch().on;
      w.__awkSandbox = realBox;
      const web = await w.__readyHunt.watchOff();                   // no plugin on the web: nothing to write
      w.Capacitor = { isNativePlatform: () => true, Plugins: { Filesystem: { writeFile: (o: any) => { out.push(o); return Promise.resolve(); } } } };
      let phone = false;
      try { phone = await w.__readyHunt.watchOff(); } finally { w.Capacitor = real; }
      return { inSandbox, web, phone, out };
    });
    expect([r.inSandbox, r.web, r.phone, r.out.length]).toEqual([false, false, true, 1]);
    expect([r.out[0].path, r.out[0].directory]).toEqual(['ready-hunt-watch.json', 'LIBRARY']);
    expect(JSON.parse(r.out[0].data)).toMatchObject({ v: 1, on: false, hunts: [], seen: [] });
  });

  test('W1046 — the owner\'s preview posts the notification the watcher would, with today\'s real numbers when there are any', async ({ page }) => {
    await hunter(page, { ...GATE.D, ...GATE.C });
    await expect(page.locator('#settings-preview-readyhunt-note')).toHaveClass(/hidden/);   // not the owner: no row
    const preview = () => page.evaluate(() => {
      const w = window as any, real = w.Capacitor, out: any[] = [];
      w.Capacitor = { Plugins: { LocalNotifications: { schedule: (o: any) => { out.push(o); return Promise.resolve(); } } } };
      let note: any = null;
      try { note = w.__readyHunt.previewNote(); } finally { w.Capacitor = real; }
      return { note: note && { id: note.id, title: note.title, body: note.body, extra: note.extra, inMs: new Date(note.schedule.at).getTime() - Date.now() }, sent: out.length };
    });
    expect(await page.evaluate(() => (window as any).__readyHunt.previewNote())).toBeNull();   // the web has no notifications to send
    await health(page, { steps: 120 });
    let p = await preview();                    // nothing ready: the sample
    expect(p.sent).toBe(1);
    expect(p.note).toMatchObject({ id: 88146, title: 'A hunt is ready', body: '6,412 steps today. The Steel Wolf is yours.', extra: { kind: 'hunt', bossId: 'the_steel_wolf' } });
    expect(p.note.inMs).toBeGreaterThan(6000);
    expect(p.note.inMs).toBeLessThan(9000);
    await health(page, { steps: 10400 });       // three step bosses at C rank
    await expect(sheet(page)).toBeVisible({ timeout: 8000 });
    p = await preview();
    expect(p.note).toMatchObject({ title: '3 hunts are ready', body: '10,400 steps today. One tap takes all 3.', extra: { kind: 'hunt', bossId: 'the_marathon_wraith' } });
  });
});

// W1035 · W1047 — the Shadow Army. A shadow used to be earned in a 48-hour window after the kill;
// since W1047 it DROPS: every solo kill rolls 1 in 20 for that boss's shadow, pure luck.
test.describe('CC · The Shadow Army drops like a pet (W1035 · W1047)', () => {
  const HIT = 0.049, MISS = 0.05;   // the roll is `random < 1/20`
  const luck = (page: Page, v: number) => page.evaluate((v) => { const w = window as any; w.__rolls = 0; w.__shadowLuck(() => { w.__rolls++; return v; }); }, v);
  const kill = (page: Page, id: string) => page.evaluate((id) => { const s = (window as any).__shadowKill(id); return { pending: Object.keys(s.pending), owned: Object.keys(s.extracted), windows: Object.keys(s.windows), rolls: (window as any).__rolls }; }, id);
  const seal = async (page: Page) => { await expect(page.locator('.arise-does.show')).toBeVisible({ timeout: 8000 }); await page.waitForTimeout(400); await page.locator('.arise-overlay').click(); };

  test('the words: the roster and every solo boss say the odds; the ceremony says what a shadow does', async ({ page }) => {
    await freshApp(page);
    // the ceremony
    await page.evaluate(() => (window as any).__arise('the_carouser'));
    await expect(page.locator('.arise-does.show')).toHaveText('It marches with you in the Ascent. +0.75% power.', { timeout: 6000 });   // an E-rank shadow (W1057)
    await page.waitForTimeout(400);
    await page.locator('.arise-overlay').click();
    await expect(page.locator('.arise-overlay')).toHaveCount(0);
    // an E-rank hunter has one slot: a second shadow is raised but cannot march
    await page.evaluate(() => (window as any).__arise('the_steel_wolf'));
    await expect(page.locator('.arise-does.show')).toHaveText(/Your slots are full/, { timeout: 6000 });
    await page.waitForTimeout(400);
    await page.locator('.arise-overlay').click();
    // the roster
    await page.evaluate(() => (document.querySelector('[data-open-shadows]') as HTMLElement).click());
    await expect(page.locator('#shadow-roster .shr-how')).toHaveText('Every boss you beat has a 1 in 20 chance to leave its shadow.');
    await expect(page.locator('#shadow-roster .shr-row')).toHaveCount(2);
    const words = await page.evaluate(() => (document.getElementById('shadow-roster') as HTMLElement).textContent || '');
    expect(words).not.toMatch(/48 hours|extraction|half|!|\bfell(ed)?\b/i);
    await page.locator('#shadow-roster .sw-close').click();
    // the boss sheet: the one place a hunter with no shadows learns they exist. A boss whose
    // shadow is not owned says the odds.
    await page.evaluate(() => (window as any).__readyHunt.open('the_glass_strider'));
    await expect(page.locator('#boss-fs-overlay')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#bfs-shadow-line')).toHaveText('◈ Its shadow rises on 1 kill in 20, worth +1% in the Ascent.');   // a D-rank boss (W1057)
  });

  test('a miss says nothing and opens no window; a hit raises the shadow, once, and the boss never rolls again', async ({ page }) => {
    await freshApp(page);
    await luck(page, MISS);
    expect(await kill(page, 'the_carouser')).toEqual({ pending: [], owned: [], windows: [], rolls: 1 });
    await page.waitForTimeout(900);
    await expect(page.locator('.arise-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => /shadow/i.test(document.body.innerText))).toBe(false);
    await luck(page, HIT);
    const won = await kill(page, 'the_carouser');
    expect([won.pending, won.rolls]).toEqual([['the_carouser'], 1]);
    await seal(page);
    await expect(page.locator('.arise-overlay')).toHaveCount(0);
    const after = await page.evaluate(() => { const s = (window as any).__shadows(); return { owned: Object.keys(s.extracted), pending: Object.keys(s.pending), marching: s.active }; });
    expect(after).toEqual({ owned: ['the_carouser'], pending: [], marching: ['the_carouser'] });
    expect(await page.evaluate(() => (localStorage.getItem('hb_funnel_queue') || '').split('arise_extracted').length - 1)).toBe(1);
    // owned: the dice are not even picked up
    await luck(page, HIT);
    expect((await kill(page, 'the_carouser')).rolls).toBe(0);
  });

  test('1 in 20: the edge of the roll, and twenty thousand real ones', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const at = (v: number) => { w.__shadowLuck(() => v); return w.__shadowRoll(); };
      const edge = [at(0), at(0.0499), at(0.05), at(0.999)];
      w.__shadowLuck(null);                                   // the real dice
      let hits = 0; for (let i = 0; i < 20000; i++) if (w.__shadowRoll()) hits++;
      return { edge, hits };
    });
    expect(r.edge).toEqual([true, true, false, false]);
    expect(r.hits).toBeGreaterThan(800);                      // 1,000 expected; far outside chance either way
    expect(r.hits).toBeLessThan(1200);
  });

  test('no roll for a co-op boss or on a hunter\'s first day', async ({ page }) => {
    await freshApp(page);
    await luck(page, HIT);
    expect(await kill(page, 'the_twin_maw')).toMatchObject({ pending: [], rolls: 0 });
    await page.evaluate(() => { const d = new Date(); localStorage.setItem('hb_onboarding_first_xp_date', d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')); });
    expect(await page.evaluate(() => (window as any).__newHunterQuiet())).toBe(true);
    expect(await kill(page, 'the_steel_wolf')).toMatchObject({ pending: [], rolls: 0 });
    await page.evaluate(() => localStorage.removeItem('hb_onboarding_first_xp_date'));
    expect((await kill(page, 'the_steel_wolf')).pending).toEqual(['the_steel_wolf']);
  });

  test('two drops from one strike rise one after the other', async ({ page }) => {
    await freshApp(page);
    await luck(page, HIT);
    // one STRIKE ALL: both kills land in the same moment
    const both = await page.evaluate(() => { const w = window as any; w.__shadowKill('the_carouser'); return Object.keys(w.__shadowKill('the_steel_wolf').pending).sort(); });
    expect(both).toEqual(['the_carouser', 'the_steel_wolf']);
    await expect(page.locator('.arise-overlay')).toHaveCount(1, { timeout: 8000 });
    await seal(page);
    await expect(page.locator('.arise-name.show')).toHaveCount(0, { timeout: 4000 });   // the first has gone
    await expect(page.locator('.arise-overlay')).toHaveCount(1, { timeout: 8000 });    // the second, by itself
    await seal(page);
    await expect(page.locator('.arise-overlay')).toHaveCount(0, { timeout: 4000 });
    expect(await page.evaluate(() => { const s = (window as any).__shadows(); return [Object.keys(s.extracted).sort(), Object.keys(s.pending)]; })).toEqual([['the_carouser', 'the_steel_wolf'], []]);
  });

  // W1048 — late bloom: the army stays small until the top ranks, and at S every shadow marches.
  const army = (page: Page, points: number, owned: string[], marching: string[], extra?: Record<string, unknown>) => page.addInitScript(({ points, owned, marching, extra }) => {
    try {
      if (sessionStorage.getItem('__w1048')) return; sessionStorage.setItem('__w1048', '1');
      localStorage.setItem('hb_points', String(points));
      const extracted: Record<string, { at: number; name: string }> = {};
      owned.forEach((id, i) => { extracted[id] = { at: 1000 + i, name: 'Shadow of ' + id }; });
      localStorage.setItem('hb_shadows_v1', JSON.stringify(Object.assign({ extracted, active: marching, windows: {}, pending: {} }, extra || {})));
    } catch (_) {}
  }, { points, owned, marching, extra: extra || {} });
  const SOLO = ['the_insomniac', 'the_steel_wolf', 'the_carouser', 'the_iron_warden', 'the_glass_strider', 'the_dream_tyrant', 'the_marathon_wraith', 'the_furnace_knight',
    'the_ascendant_colossus', 'the_gray_pilgrim', 'the_forge_of_ten_thousand_days', 'the_vow_keeper', 'the_patient_flame', 'the_unbroken_anvil'];
  const marchingNow = (page: Page) => page.evaluate(() => { const w = window as any; return { n: w.__shadowMarching(), slots: w.__shadowSlots(), active: w.__shadows().active as string[] }; });

  // W1057 — owner 2026-10-14: "the higher boss shadows give more percentage" (curve: MIDDLE).
  test('W1057 — a shadow is worth its boss\'s rank: E 0.75, D 1, C 1.25, B 1.5, A 1.75, S 2; the army adds them up', async ({ page }) => {
    await army(page, 14000, ['the_steel_wolf', 'the_unbroken_anvil', 'the_worldspine'], ['the_steel_wolf', 'the_unbroken_anvil', 'the_worldspine']);
    await freshApp(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      return {
        each: ['the_insomniac', 'the_glass_strider', 'the_marathon_wraith', 'the_patient_flame', 'the_unbroken_anvil', 'the_worldspine'].map((id) => w.__shadowPct(id)),
        army: w.__shadowPct(),
      };
    });
    expect(r.each).toEqual([0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(r.army).toBe(4.5);                                  // 0.75 + 1.75 + 2
    await page.evaluate(() => (document.querySelector('[data-open-shadows]') as HTMLElement).click());
    await expect(page.locator('#shadow-roster .shr-sub').filter({ hasText: 'S-RANK' })).toContainText('+2%');
    await expect(page.locator('#shadow-roster .shr-sub').filter({ hasText: 'E-RANK' })).toContainText('+0.75%');
    await expect(page.locator('#shadow-roster .sw-foot')).toContainText('E 0.75% TO S 2%');
  });

  // W1058 — owner 2026-10-15: "make sure the shadows get shown on this stats page for the boosts".
  // The matchup's YOUR POWER is the number the fight uses; the boosts open what each one added.
  test('W1058 — the matchup shows the fight power; Blood, Shadows and a banner add whole points that sum, on a milestone too (W1060)', async ({ page }) => {
    await army(page, 14000, ['the_steel_wolf', 'the_unbroken_anvil', 'the_worldspine'], ['the_steel_wolf', 'the_unbroken_anvil', 'the_worldspine'], { slotsSeen: 19 });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_ascent_opening_seen_v1', '1');
        localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: 99, highestCleared: 98, wins: 0, losses: 0, streak: 0, bestStreak: 0,
          dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }));
        localStorage.setItem('hb_tower_friends_v1', JSON.stringify({ at: Date.now() + 3600e3, banners: [{ floor: 99, alias: 'Raven' }], echoes: [], my_defeat: null, souls: 0 }));
      } catch (_) {}
    });
    await freshApp(page);
    // into the tower, then the matchup for `floor` (DOM clicks: no popup can take the tap)
    const matchup = (sel: string) => page.evaluate(async (sel) => {
      const w = window as any;
      if (typeof w.openArena === 'function') w.openArena(true);
      else { (document.querySelector('[data-tab="profile"]') as HTMLElement).click(); await new Promise((r) => setTimeout(r, 400)); (document.getElementById('sc-arena-btn') as HTMLElement).click(); }
      await new Promise((r) => setTimeout(r, 400));
      (document.querySelector('#arena-body ' + sel) as HTMLElement).click();
    }, sel);
    const nums = (sel: string) => page.locator(sel).evaluateAll((els) => els.map((e) => parseInt((e.textContent || '').replace(/[^0-9-]/g, ''), 10)));

    await page.evaluate(() => (window as any).__bloodHot(true));
    await matchup('[data-ar="fight"]');
    await expect(page.locator('#arena-body .mx-marks')).toHaveText(/\+10%.*\+4\.5%.*\+1%/);
    // the panel: base + each boost = the fight power, and that is the number on the screen
    const pl = await nums('#arena-body .mx-sheet .mx-pl .v');
    const base = pl[0], fight = pl[pl.length - 1], adds = pl.slice(1, -1);
    expect(adds.length).toBe(3);
    expect(base + adds.reduce((a, b) => a + b, 0)).toBe(fight);
    expect(Math.abs(fight - base * 1.1 * 1.045 * 1.01)).toBeLessThanOrEqual(2);
    await expect(page.locator('#mx-you')).toHaveText(String(fight), { timeout: 3000 });
    // the tape: three rows that sum to the fight power, each row's lines summing to the row
    const rows = await nums('#arena-body .mx-row .y');
    expect(rows.reduce((a, b) => a + b, 0)).toBe(fight);
    const brk = await page.locator('#arena-body .mx-row').evaluateAll((els) => els.map((r) => {
      const v = (e: Element) => parseInt((e.textContent || '').replace(/[^0-9-]/g, ''), 10);
      const parts = Array.from(r.querySelectorAll('.mx-bl:not(.sum) .v')).map(v);
      return [parts.reduce((a, b) => a + b, 0), v(r.querySelector('.mx-bl.sum .v') as Element), Array.from(r.querySelectorAll('.mx-bl.army')).length];
    }));
    brk.forEach((b) => { expect(b[0]).toBe(b[1]); expect(b[2]).toBe(1); });
    // a tap on the marks opens the panel, strongest shadow first
    await page.locator('#arena-body .mx-marks').click();
    await expect(page.locator('#arena-body .mx')).toHaveClass(/mx-panel-open/);
    await expect(page.locator('#arena-body .mx-sh .pc')).toHaveText(['+2%', '+1.75%', '+0.75%']);
    await page.locator('#arena-body .mx-x').click();
    await expect(page.locator('#arena-body .mx')).not.toHaveClass(/mx-panel-open/);
    await expect(page.locator('#arena-body .mx-stakes')).toContainText('Defeat spends a life');

    // floor 90, a milestone: the boosts count there too (W1060, owner 2026-10-15: "I want boosts to
    // be allowed"); no banner was planted on 90, so Blood and the army only
    await matchup('[data-ar="rematch"][data-floor="90"]');
    await expect(page.locator('#arena-body .mx--boss .mx-marks')).toHaveText(/\+10%.*\+4\.5%/);
    const pl90 = await nums('#arena-body .mx-sheet .mx-pl .v');
    expect(pl90[0]).toBe(base);
    expect(pl90.length).toBe(4);
    expect(Math.abs(pl90[3] - base * 1.1 * 1.045)).toBeLessThanOrEqual(2);
    await expect(page.locator('#mx-you')).toHaveText(String(pl90[3]), { timeout: 3000 });
    // and the roster no longer promises a kneel
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/KNEELS AT THE THRESHOLD/);
  });

  // W1059 — owner 2026-10-15: "revamp this page to make it more inviting and aesthetic for users when
  // they go into the tower". The next fight, a rail of the whole climb, the climb behind folded by band.
  test('W1059 — the tower: the next fight, a 100-cell rail, bands folded with the current one open; the odds match the matchup', async ({ page }) => {
    await army(page, 14000, ['the_steel_wolf', 'the_unbroken_anvil', 'the_worldspine'], ['the_steel_wolf', 'the_unbroken_anvil', 'the_worldspine'], { slotsSeen: 19 });
    const arena = (o: Record<string, unknown>) => page.evaluate(async (o) => {
      const a = Object.assign({ rating: 1000, bestRating: 1000, currentFloor: 47, highestCleared: 46, wins: 0, losses: 0, streak: 0, bestStreak: 0,
        dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }, o);
      localStorage.setItem('hb_arena_v2', JSON.stringify(a));
      const w = window as any;
      if (typeof w.openArena === 'function') w.openArena(true);
      else { (document.querySelector('[data-tab="profile"]') as HTMLElement).click(); await new Promise((r) => setTimeout(r, 400)); (document.getElementById('sc-arena-btn') as HTMLElement).click(); }
      await new Promise((r) => setTimeout(r, 400));
    }, o);
    await page.addInitScript(() => { try { localStorage.setItem('hb_ascent_opening_seen_v1', '1'); } catch (_) {} });
    await freshApp(page);

    // mid-climb, floor 47: the hero, the Gilded Tier open, six of ten behind, 46 cells lit and one gold
    await arena({});
    const T = '#arena-body .tw';
    await expect(page.locator(T + ' .tw-hl')).toHaveText(/FLOOR 47.*THE GILDED TIER/);
    await expect(page.locator(T + ' .tw-fight')).toHaveText(/FIGHT/);
    await expect(page.locator(T + ' .tw-rb .c')).toHaveCount(100);
    await expect(page.locator(T + ' .tw-rb .c.on')).toHaveCount(46);
    await expect(page.locator(T + ' .tw-rb .c.now')).toHaveCount(1);
    await expect(page.locator('#tw-rail-num')).toHaveText('47');
    await expect(page.locator(T + ' .tw-band')).toHaveCount(5);
    await expect(page.locator(T + ' .tw-band.open')).toHaveCount(1);
    await expect(page.locator(T + ' .tw-band.cur.open .bm')).toHaveText(/6 OF 10/);
    await expect(page.locator(T + ' .tw-band.cur [data-ar="rematch"]')).toHaveCount(6);
    // a band on the rail opens its tile; a tile's head folds it again
    await page.evaluate(() => (document.querySelector('#arena-body .tw-rb[data-b="1"]') as HTMLElement).click());
    await expect(page.locator(T + ' .tw-band[data-b="1"]')).toHaveClass(/open/);
    await page.evaluate(() => (document.querySelector('#arena-body .tw-band[data-b="1"] .tw-bhead') as HTMLElement).click());
    await expect(page.locator(T + ' .tw-band[data-b="1"]')).not.toHaveClass(/open/);
    // the tower's odds are the matchup's odds: both count the marching army (W1058)
    const towerPct = (await page.locator(T + ' .tw-read .pct').textContent() || '').replace(/[^0-9]/g, '');
    await page.evaluate(() => (document.querySelector('#arena-body [data-ar="fight"]') as HTMLElement).click());
    await expect(page.locator('#arena-body .mx-odds')).toContainText('≈ ' + towerPct + '% WIN');

    // floor 60 (TACTICIAN): the style line unfolds the known moves
    await arena({ currentFloor: 60, highestCleared: 59 });
    await expect(page.locator(T + ' .tw-hero')).toHaveClass(/boss/);
    await page.evaluate(() => (document.querySelector('#arena-body [data-ar="twmoves"]') as HTMLElement).click());
    await expect(page.locator(T + ' .tw-hero')).toHaveClass(/unfold/);
    await expect(page.locator(T + ' .tw-moves .fav')).toHaveCount(1);

    // a free hunter with no lives left: FIGHT locks, the floors behind stay open
    const d = new Date(), day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    await arena({ dailyLosses: 2, dailyDate: day });
    await expect(page.locator(T + ' .tw-fight')).toHaveText(/THE CLIMB RESUMES TOMORROW/);
    await expect(page.locator(T + ' .tw-fight')).toBeDisabled();
    await expect(page.locator(T + ' [data-ar="rematch"]')).toHaveCount(46);

    // the first visit: nothing behind; the climbed tower: the Hall, every cell lit
    await arena({ currentFloor: 1, highestCleared: 0 });
    await expect(page.locator(T + ' .tw-band')).toHaveCount(0);
    await expect(page.locator(T + ' .tw-rb .c.on')).toHaveCount(0);
    await arena({ currentFloor: 100, highestCleared: 100 });
    await expect(page.locator(T)).toHaveClass(/climbed/);
    await expect(page.locator(T + ' [data-ar="hall"]')).toHaveText(/ENTER THE HALL/);
    await expect(page.locator(T + ' .tw-rb .c.on')).toHaveCount(100);
  });

  // W1061 — owner 2026-10-15: "yes add the test button" (the max relic set and every shadow, to feel it).
  test('W1061 — Test the max build: owner only; the Ascent fights with it, nothing counts, and leaving ends it', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('hb_ascent_opening_seen_v1', '1');
        localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: 47, highestCleared: 46, wins: 3, losses: 1, streak: 0, bestStreak: 2,
          dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }));
      } catch (_) {}
    });
    await freshApp(page);
    const progress = () => page.evaluate(() => { const a = JSON.parse(localStorage.getItem('hb_arena_v2') || '{}'); return [a.currentFloor, a.highestCleared, a.wins, a.losses, a.reclaimSouls, localStorage.getItem('hb_hunter_build'), (() => { const sh = JSON.parse(localStorage.getItem('hb_shadows_v1') || '{}'); return JSON.stringify([Object.keys(sh.extracted || {}), sh.active || []]); })()]; });
    const before = await progress();
    // not the owner: the door does nothing
    await page.evaluate(() => (window as any).__openMaxBuildTest());
    await page.waitForTimeout(500);
    await expect(page.locator('#arena-overlay')).toBeHidden();
    // the owner
    await page.evaluate(() => { const bc = JSON.parse(localStorage.getItem('hb_board_cache_v1') || '{}'); bc.me = Object.assign({}, bc.me || {}, { role: 'owner' }); localStorage.setItem('hb_board_cache_v1', JSON.stringify(bc)); });
    await page.evaluate(() => (window as any).__openMaxBuildTest());
    const T = '#arena-body .tw';
    await expect(page.locator(T + ' .tw-chip.test')).toHaveText(/TEST BUILD/, { timeout: 4000 });
    const power = parseInt(((await page.locator(T + ' .tw-power .num').textContent()) || '').replace(/[^0-9]/g, ''), 10);
    expect(power).toBeGreaterThan(5500);                                   // every stat 20, the best relic in every slot
    await page.evaluate(() => (document.querySelector('#arena-body [data-ar="fight"]') as HTMLElement).click());
    await expect(page.locator('#arena-body .mx-marks')).toHaveText(/\+26%/);    // all nineteen shadows
    await expect(page.locator('#arena-body .mx-sh')).toHaveCount(19);
    await expect(page.locator('#arena-body .mx-stakes')).toHaveText('Test build. Nothing counts.');
    await expect(page.locator('#arena-body .mx-ldt-h')).toContainText('8 RELICS');
    expect(await page.evaluate(() => (window as any).Arena.matchup(47).advances)).toBe(false);
    // the chip ends it: the real build is back, and the climb counts again
    await page.evaluate(() => (window as any).openArena(true, true));
    await page.evaluate(() => (document.querySelector('#arena-body [data-ar="twtestend"]') as HTMLElement).click());
    await expect(page.locator(T + ' .tw-chip.test')).toHaveCount(0);
    const real = parseInt(((await page.locator(T + ' .tw-power .num').textContent()) || '').replace(/[^0-9]/g, ''), 10);
    expect(real).toBeLessThan(power);
    expect(await page.evaluate(() => (window as any).Arena.matchup(47).advances)).toBe(true);
    // leaving the Arena ends it too
    await page.evaluate(() => (window as any).openArena(true, true));
    await page.evaluate(() => (document.getElementById('arena-close') as HTMLElement).click());
    await expect(page.locator('#arena-overlay')).toBeHidden();
    expect(await page.evaluate(() => (window as any).Arena.matchup(47).advances)).toBe(true);
    // nothing was written
    expect(await progress()).toEqual(before);
  });

  // W1062 — owner 2026-10-15: "I would like the ability to turn on the marching from this screen".
  const intoMatchup = async (page: Page, floor: number) => {
    await page.addInitScript((floor) => {
      try {
        localStorage.setItem('hb_ascent_opening_seen_v1', '1');
        localStorage.setItem('hb_arena_v2', JSON.stringify({ rating: 1000, bestRating: 1000, currentFloor: floor, highestCleared: floor - 1, wins: 0, losses: 0, streak: 0, bestStreak: 0,
          dailyDate: '', dailyLosses: 0, reclaimDate: '', reclaimFloors: [], reclaimSouls: 0 }));
      } catch (_) {}
    }, floor);
    await freshApp(page);
    await page.evaluate(async () => {
      (document.querySelector('[data-tab="profile"]') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 400));
      (document.getElementById('sc-arena-btn') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 400));
      (document.querySelector('#arena-body [data-ar="fight"]') as HTMLElement).click();
    });
    await expect(page.locator('#arena-body .mx')).toBeVisible();
  };
  const tap = (page: Page, sel: string) => page.evaluate((sel) => (document.querySelector('#arena-body ' + sel) as HTMLElement).click(), sel);
  const marchingIds = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('hb_shadows_v1') || '{}').active || []).slice().sort());

  test('W1062 — the matchup\'s panel marches or rests each shadow; the power follows at once and a resting army still has its mark', async ({ page }) => {
    await army(page, 14000, ['the_carouser', 'the_unbroken_anvil', 'the_worldspine'], ['the_carouser'], { slotsSeen: 19 });
    await intoMatchup(page, 99);
    const M = '#arena-body';
    await expect(page.locator(M + ' .mx-marks')).toHaveText('+0.75%');
    await tap(page, '.mx-marks');
    await expect(page.locator(M + ' .mx')).toHaveClass(/mx-panel-open/);
    await expect(page.locator(M + ' .mx-sh .st')).toHaveText(['AT REST', 'AT REST', 'MARCHING']);   // strongest first
    await expect(page.locator(M + ' .mx-pl.army small')).toHaveText(/1 OF 19 MARCHING/);
    // the Worldspine marches: saved, the panel stays open, the number on the screen is the panel's
    await tap(page, '.mx-sh[data-id="the_worldspine"]');
    await expect(page.locator(M + ' .mx')).toHaveClass(/mx-panel-open/);
    await expect(page.locator(M + ' .mx-sh[data-id="the_worldspine"] .st')).toHaveText('MARCHING');
    await expect(page.locator(M + ' .mx-marks')).toHaveText('+2.75%');
    expect(await marchingIds(page)).toEqual(['the_carouser', 'the_worldspine']);
    const fight = ((await page.locator(M + ' .mx-pl.final .v').textContent()) || '').trim();
    await expect(page.locator('#mx-you')).toHaveText(fight);
    // all at rest: the army keeps a mark, and the panel lists every shadow at +0
    await tap(page, '.mx-sh[data-id="the_worldspine"]');
    await tap(page, '.mx-sh[data-id="the_carouser"]');
    expect(await marchingIds(page)).toEqual([]);
    await expect(page.locator(M + ' .mx-marks')).toHaveText('AT REST');
    await expect(page.locator(M + ' .mx-pl.army small')).toHaveText(/0 OF 19 MARCHING/);
    await expect(page.locator(M + ' .mx-sh')).toHaveCount(3);
    // and the roster agrees
    await tap(page, '.mx-sh[data-id="the_unbroken_anvil"]');
    expect(await marchingIds(page)).toEqual(['the_unbroken_anvil']);
  });

  test('W1062 — the panel keeps the rank\'s slots: an E-rank hunter with one marching cannot march a second', async ({ page }) => {
    await army(page, 0, ['the_carouser', 'the_steel_wolf'], ['the_carouser']);
    await intoMatchup(page, 9);
    await tap(page, '.mx-marks');
    await expect(page.locator('#arena-body .mx-pl.army small')).toHaveText(/1 OF 1 MARCHING/);
    await tap(page, '.mx-sh[data-id="the_steel_wolf"]');
    await expect(page.locator('#arena-body .mx-sh[data-id="the_steel_wolf"] .st')).toHaveText('AT REST');
    expect(await marchingIds(page)).toEqual(['the_carouser']);
  });

  test('W1048 — the slots by rank: 1, 2, 4, 7, 12, and at S one for every solo boss', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(() => { const f = (window as any).__shadowSlots; return ['E', 'D', 'C', 'B', 'A', 'S', 'S+', 'nonsense'].map((k) => f(k)); });
    expect(r).toEqual([1, 2, 4, 7, 12, 19, 19, 1]);
  });

  test('W1048 — an S-rank hunter held to the old five: every shadow marches, by itself, and each is worth 1%', async ({ page }) => {
    await army(page, 14000, SOLO.slice(0, 8), SOLO.slice(0, 5));
    await freshApp(page);
    const m = await marchingNow(page);
    expect([m.n, m.slots]).toEqual([8, 19]);
    expect(m.active.slice().sort()).toEqual(SOLO.slice(0, 8).sort());
    await page.evaluate(() => (document.querySelector('[data-open-shadows]') as HTMLElement).click());
    await expect(page.locator('#shadow-roster .shr-slots')).toHaveText(/^8 MARCHING · 19 SLOTS AT YOUR RANK/);
    await expect(page.locator('#shadow-roster .shr-toggle.on')).toHaveCount(8);
  });

  test('W1048 — an A-rank hunter with fourteen: twelve march (strongest first, W1057), two wait, and a rest by hand is kept', async ({ page }) => {
    await army(page, 7000, SOLO, SOLO.slice(0, 5));
    await freshApp(page);
    let m = await marchingNow(page);
    expect([m.n, m.slots]).toEqual([12, 12]);
    // the five already marching stay; the seven that join are the strongest of the rest, oldest first among equals
    expect(m.active).toEqual(SOLO.slice(0, 5).concat(['the_unbroken_anvil', 'the_forge_of_ten_thousand_days', 'the_vow_keeper', 'the_patient_flame',
      'the_marathon_wraith', 'the_furnace_knight', 'the_ascendant_colossus']));
    // rest one by hand: the slot stays free until the hunter fills it (growth is what fills, not a free slot)
    await page.evaluate(() => (document.querySelector('[data-open-shadows]') as HTMLElement).click());
    await page.locator('#shadow-roster [data-shadow-toggle="the_insomniac"]').click();
    await expect(page.locator('#shadow-roster .shr-slots')).toHaveText(/^11 MARCHING · 12 SLOTS AT YOUR RANK/);
    await page.reload();
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    m = await marchingNow(page);
    expect([m.n, m.active.indexOf('the_insomniac')]).toEqual([11, -1]);
  });

  test('W1048 — a D-rank hunter with three: two march; the third waits for C rank, then marches without being asked', async ({ page }) => {
    await army(page, 300, SOLO.slice(0, 3), [SOLO[0]], { slotsSeen: 1 });   // D rank is 100 to 599
    await freshApp(page);
    const m = await marchingNow(page);
    expect([m.n, m.slots, m.active]).toEqual([2, 2, SOLO.slice(0, 2)]);
    // C rank: four slots
    await page.evaluate(() => { localStorage.setItem('hb_points', '700'); });   // C rank starts at 600
    await page.reload();
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    const c = await marchingNow(page);
    expect([c.n, c.slots]).toEqual([3, 4]);
  });

  test('a drop won before the app was closed rises at the next launch; a window from the old rule is still honoured', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('__w1047')) return; sessionStorage.setItem('__w1047', '1');
        localStorage.setItem('hb_shadows_v1', JSON.stringify({ extracted: {}, active: [], pending: { the_insomniac: Date.now() - 60000 },
          windows: { the_steel_wolf: { killAt: Date.now() - 3600000, until: Date.now() + 40 * 3600000, lastCheck: Date.now() } } }));
      } catch (_) {}
    });
    await freshApp(page);
    await expect(page.locator('.arise-overlay')).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('.arise-name.show')).toHaveText('Shadow of The Insomniac has joined your army.', { timeout: 6000 });
    await seal(page);
    // the open window is untouched, and its boss still says so
    expect(await page.evaluate(() => Object.keys((window as any).__shadows().windows))).toEqual(['the_steel_wolf']);
    await page.evaluate(() => (window as any).__readyHunt.open('the_steel_wolf'));
    await expect(page.locator('#bfs-shadow-line')).toHaveText(/EXTRACTION OPEN — 3,000 steps within \d+h, and it rises\./, { timeout: 8000 });
  });
});

// W1040 — signing out tells the server to stop sending this phone the account's notifications.
test.describe('CD · Sign-out forgets the push token (W1040)', () => {
  test('a known token is unregistered once, with the session still valid; no token, no call; a slow server never blocks', async ({ page }) => {
    await freshApp(page);
    const r = await page.evaluate(async () => {
      const w = window as any; const calls: string[] = [];
      const real = w.Auth.unregisterPushToken;
      w.Auth.unregisterPushToken = async (t: string) => { calls.push(t); return { ok: true }; };
      const none = await w.Push.forget();                       // APNs never handed us a token this session
      w.__push.setToken('a'.repeat(64));
      const first = await w.Push.forget();
      const again = await w.Push.forget();                      // already forgotten
      w.Auth.unregisterPushToken = async () => { throw new Error('offline'); };
      w.__push.setToken('b'.repeat(64));
      const failed = await w.Push.forget();                     // an error is swallowed
      w.Auth.unregisterPushToken = real;
      return { none, first, again, failed, calls, left: w.__push.token() };
    });
    expect(r).toEqual({ none: false, first: true, again: false, failed: false, calls: ['a'.repeat(64)], left: null });
  });
});

// W1046 — Apple Health now wakes the app in the background (the Ready Hunt watcher), and iOS
// builds the web view on that wake. A boot there would ping app-open, seal vows and sync for a
// hunter who never opened anything, so on the phone a page that is hidden at load waits.
test.describe('CE · A launch nobody can see does not start the app (W1046)', () => {
  // The first load of the spec is "the phone, in the background": native, hidden, no frame painted.
  const background = (page: Page) => page.addInitScript(() => {
    const w = window as any;
    if (sessionStorage.getItem('__w1046_boot')) return;
    sessionStorage.setItem('__w1046_boot', '1');
    w.__vis = 'hidden'; w.__native = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => w.__vis });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.__vis === 'hidden' });
    w.Capacitor = { isNativePlatform: () => w.__native, getPlatform: () => (w.__native ? 'ios' : 'web'), Plugins: {} };
    // "The phone" only from the moment the page has loaded: while the scripts are read it is still
    // the web, because the sign-in gate at the top of app.js has no local stand-in on a phone.
    // This listener is registered before app.js's own, so it runs first.
    document.addEventListener('DOMContentLoaded', () => { w.__native = true; });
    w.__frames = []; window.requestAnimationFrame = ((cb: FrameRequestCallback) => { w.__frames.push(cb); return 0; }) as typeof window.requestAnimationFrame;
  });
  const booted = (page: Page) => page.evaluate(() => (window as any).__booted());
  // from here on the page is an ordinary web page again, so the boot that follows is the one every other spec runs
  const plain = (page: Page) => page.evaluate(() => { const w = window as any; w.__native = false; w.__vis = 'visible'; });

  test('hidden at load on the phone: nothing starts, nothing is sent; it boots the moment it is seen', async ({ page }) => {
    const pings: string[] = [];
    page.on('request', (r) => { if (/app-open|\/v1\/users\/me\/state/.test(r.url())) pings.push(r.url()); });
    await background(page);
    await freshApp(page);                       // the tab bar is plain HTML: it is there with or without a boot
    await page.waitForTimeout(1500);
    expect(await booted(page)).toBe(false);
    expect(pings).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('hb_update_last_seen_at'))).toBeNull();   // init never ran
    await plain(page);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(await booted(page)).toBe(true);
    await page.locator('#tab-habits').click();
    await expect(page.locator('#habits-section, #tab-habits.active').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('hb_update_last_seen_at')), { timeout: 8_000 }).not.toBeNull();
  });

  test('a painted frame, or a touch, is enough to start it; a visible launch and the web never wait', async ({ page }) => {
    await background(page);
    await freshApp(page);
    expect(await booted(page)).toBe(false);
    // two frames: only a page someone can see paints them
    await plain(page);
    await page.evaluate(() => { const w = window as any; const run = () => { const f = w.__frames.splice(0); f.forEach((cb: FrameRequestCallback) => cb(0)); }; run(); run(); });
    expect(await booted(page)).toBe(true);
    // the same page loaded again is an ordinary visible load (the init script stands down): no wait at all
    await page.reload();
    await expect(page.locator('#tab-profile')).toBeVisible({ timeout: 15_000 });
    expect(await booted(page)).toBe(true);
  });

  test('held, then touched: the touch itself starts it', async ({ page }) => {
    await background(page);
    await freshApp(page);
    expect(await booted(page)).toBe(false);
    await plain(page);
    await page.evaluate(() => { (window as any).__vis = 'hidden'; document.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(await booted(page)).toBe(true);
  });
});

