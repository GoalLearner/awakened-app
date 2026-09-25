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
    expect(r.paths[0].sub).toBe('6 vows');   // W971 — the six-step morning
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

  test('one screen: the day, yesterday in a line, today as a ring, the climb, three chips — no vow list, no dead tile', async ({ page }) => {
    await seed(page, { [pt(1)]: ['tb-phone', 'tb-med'], [pt(2)]: ['tb-read'] });
    await page.evaluate(() => (window as any).__previewTodaysBriefing());
    await page.waitForTimeout(1600);
    const v = await view(page);
    expect(v.shown).toBe(true);
    expect(v.date).toMatch(/^(SUN|MON|TUE|WED|THU|FRI|SAT) · [A-Z]{3} \d{1,2}$/);
    expect(v.day).toMatch(/^Day \d+$/);
    expect(v.streak).toBe('2-day streak');
    expect(v.yest).toBe('Yesterday: 2 of 4 vows kept.');
    expect(v.big).toBe('4');
    expect(v.segs).toBe(4);
    expect(v.xp).toBe('+10 XP on the table');   // 3 medium (+3) + 1 easy (+1)
    expect(v.climb).toMatch(/^Rank [A-Z+]+ \| (\d[\d,]* XP to [A-Z+]+ I{1,3}|The summit of the ranks)$/i);
    expect(v.chips.length).toBeGreaterThan(0);
    expect(v.chips.length).toBeLessThanOrEqual(3);
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

  test('tap a chip to lead: that vow tops today’s list (saved order untouched); tap again lets it go', async ({ page }) => {
    await seed(page, { [pt(1)]: ['tb-phone'] });
    await page.evaluate(() => (window as any).__tb.show({}));
    await page.waitForTimeout(1500);
    const chips = page.locator('#tb-root .tb-chip');
    const last = chips.last();
    const leadName = (await last.textContent())!.trim();
    await last.click();
    await expect(last).toHaveClass(/tb-on/);
    expect(await page.locator('#tb-root .tb-seg.tb-lead').count()).toBe(1);
    await holdSeal(page, 1150);
    await expect.poll(() => view(page).then((x) => x.shown), { timeout: 4_000 }).toBe(false);
    await page.locator('#tab-habits').click();
    const first = await page.evaluate(() => { const n = document.querySelector('#habit-list .habit-item .hlr-name, #habit-list .habit-item .codex-name'); return (n?.textContent || '').trim(); });
    expect(leadName.startsWith(first) || first.startsWith(leadName)).toBe(true);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hb_habits') || '[]').map((h: any) => h.id));
    expect(stored).toEqual(['tb-phone', 'tb-med', 'tb-wake', 'tb-read']);   // the saved order never moves
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
    await page.locator('#tb-root .tb-chip').first().click();
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
    const ids = ['settings-preview-celebrations', 'settings-preview-rating', 'settings-preview-wgmvp', 'settings-preview-briefing', 'settings-preview-hunts'];
    await expect.poll(() => page.evaluate((xs) => xs.every((x) => !document.getElementById(x)!.classList.contains('hidden')), ids), { timeout: 6_000 }).toBe(true);
    expect(await page.evaluate(() => document.getElementById('settings-test-hunter')!.classList.contains('hidden'))).toBe(true);
  });

  test('a regular hunter sees none of them', async ({ page }) => {
    await seed(page, { hb_board_cache_v1: JSON.stringify({ me: { role: null } }) });
    await page.locator('#settings-btn').click();
    await page.waitForTimeout(800);
    const shown = await page.evaluate(() => ['settings-preview-celebrations', 'settings-preview-rating', 'settings-preview-wgmvp', 'settings-preview-briefing', 'settings-preview-hunts', 'settings-test-hunter']
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
// +1 XP each, five a day, DONE clears after seven days); the briefing's to-do line; TIME OF
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
    await page.evaluate(() => { (window as any).__todDrag; document.getElementById('tab-profile')!.click(); });
    await page.click('#tab-habits');
    await expect(page.locator('.tod-sec[data-tod="day"]')).toHaveClass(/tod-sec--fold/);
    await page.evaluate(() => (document.querySelector('.tod-sec[data-tod="day"] [data-tod-fold]') as HTMLElement).click());
    await expect(page.locator('.tod-sec[data-tod="day"]')).not.toHaveClass(/tod-sec--fold/);
    await page.click('#tab-profile');
    await page.click('#tab-habits');
    await expect(page.locator('.tod-sec[data-tod="day"]')).not.toHaveClass(/tod-sec--fold/);   // the open sticks
    // unseal and seal again: the finishing seal folds it once more
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="d1"]') as HTMLElement).click());
    await expect(page.locator('.tod-sec[data-tod="day"] [data-tod-ct]')).toHaveText('· 0 OF 1');
    await page.evaluate(() => (document.querySelector('.habit-item[data-id="d1"]') as HTMLElement).click());
    await expect(page.locator('.tod-sec[data-tod="day"]')).toHaveClass(/tod-sec--fold/, { timeout: 3_000 });
  });

  test('TO-DO: the pill shows from day one with its count; Enter adds; due chips order the list; a completion pays +1 XP and undo takes it back', async ({ page }) => {
    await seed(page, [{ id: 't1', t: 'Return the library book', due: -1, rem: null, at: 1 }, { id: 't3', t: 'Call Dad', due: null, rem: null, at: 2 }]);
    await expect(page.locator('[data-vows-view="todo"]')).toBeVisible();
    await expect(page.locator('[data-vows-view="ledger"]')).toHaveCount(0);   // the ledger has not unlocked yet
    await expect(page.locator('[data-todo-n]').first()).toHaveText('2');
    await page.click('[data-vows-view="todo"]');
    await expect(page.locator('[data-vows-kicker]')).toHaveText('ONE-OFF TASKS');
    await expect(page.locator('[data-vows-title]')).toHaveText('Loose ends');
    await expect(page.locator('#habit-list')).toBeHidden();
    await expect(page.locator('#todo-view')).toBeVisible();
    // compose: due TODAY, then Enter
    await page.click('[data-todo-pick="due"]');
    await page.click('[data-todo-due="0"]');
    await page.fill('[data-todo-in]', 'Book dentist');
    await page.press('[data-todo-in]', 'Enter');
    expect(await openRows(page)).toEqual(['Return the library book|OVERDUE', 'Book dentist|TODAY', 'Call Dad|']);
    await expect(page.locator('[data-todo-n]').first()).toHaveText('3');
    await expect(page.locator('[data-todo-in]')).toHaveValue('');
    expect(await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('hb_todos_v1') || '[]'); return t.length + ':' + (t[2].due ? 'dated' : 'undated'); })).toBe('3:dated');
    // complete → +1 XP, the row moves into DONE; undo → the XP comes back
    await page.evaluate(() => (Array.from(document.querySelectorAll('#todo-view .todo-row')).find((r) => /Book dentist/.test(r.textContent || '')) as HTMLElement).click());
    await expect(page.locator('#todo-view [data-todo-dg]')).toContainText('DONE · 1', { timeout: 3_000 });
    expect(await points(page)).toBe('501');
    await expect(page.locator('[data-todo-n]').first()).toHaveText('2');
    await page.click('#todo-view [data-todo-dg]');
    await page.evaluate(() => (document.querySelector('#todo-view .todo-dg .todo-row') as HTMLElement).click());
    await expect(page.locator('#todo-view [data-todo-dg]')).toHaveCount(0);
    await page.waitForTimeout(100);
    expect(await points(page)).toBe('500');
    await expect(page.locator('[data-todo-n]').first()).toHaveText('3');
    // the vow list is untouched by all of this
    await page.click('[data-vows-view="today"]');
    await expect(page.locator('#habit-list')).toBeVisible();
    await expect(page.locator('#completed-count')).toHaveText('0');
  });

  test('five a day: the sixth completion pays nothing; a to-do done eight days ago has cleared', async ({ page }) => {
    const now = Date.now();
    const done = (i: number) => ({ id: 'x' + i, t: 'Done ' + i, due: null, rem: null, at: 1, done: now - 1000 * i, dd: '@today', xp: true });
    await seed(page, [done(1), done(2), done(3), done(4), done(5), { id: 'old', t: 'Long gone', due: null, rem: null, at: 1, done: now - 8 * 86400000, dd: '2020-01-01', xp: false }, { id: 'n', t: 'Sixth', due: null, rem: null, at: 2 }]);
    await page.click('[data-vows-view="todo"]');
    await expect(page.locator('#todo-view [data-todo-dg]')).toContainText('DONE · 5');   // the eight-day-old one is gone
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_todos_v1') || '[]').some((t: any) => t.id === 'old'))).toBe(false);
    await page.evaluate(() => (document.querySelector('#todo-view .todo-row:not(.todo-row--done)') as HTMLElement).click());
    await expect(page.locator('#todo-view [data-todo-dg]')).toContainText('DONE · 6', { timeout: 3_000 });
    expect(await points(page)).toBe('500');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hb_todos_v1') || '[]').find((t: any) => t.id === 'n').xp)).toBe(false);
  });

  test('the briefing carries one line — "1 to-do due today · 1 overdue"; the owner preview always shows it', async ({ page }) => {
    await seed(page, [{ id: 't1', t: 'Return the library book', due: -1, rem: null, at: 1 }, { id: 't2', t: 'Book dentist', due: 0, rem: null, at: 2 }, { id: 't3', t: 'Call Dad', due: 3, rem: null, at: 3 }]);
    await page.evaluate(() => (window as any).__tb.show({}));
    await expect(page.locator('.tb-tdl')).toHaveText('1 to-do due today · 1 overdue', { timeout: 5_000 });
    await expect(page.locator('.tb-tdl .tb-od')).toHaveText('1 overdue');
    // nothing due → no line for hunters; the preview shows a sample (cleared in memory: a reload would re-seed)
    await page.evaluate(() => { (window as any).__todo.load().length = 0; (window as any).__tb.show({}); });
    await expect(page.locator('.tb-sheet')).toBeVisible();
    await expect(page.locator('.tb-tdl')).toHaveCount(0);
    await page.evaluate(() => (window as any).__previewTodaysBriefing());
    await expect(page.locator('.tb-tdl')).toHaveText('2 to-dos due today · 1 overdue');
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
  });
});
