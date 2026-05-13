/* Awakened — Daily Habit Tracker */
(function () {
  'use strict';

  // ── v2.1 PHASE A: SIGN-IN GATE GUARD ──────────────────────
  // Hard gate. If no signed-in user (or alias not yet picked), show
  // the gate and short-circuit the IIFE. The main app does not mount
  // until hb_user is fully populated. See BACKEND.md §4. auth.js loads
  // before this script and exposes window.Auth.
  //
  // Pattern: a regular function that returns true when the gate took
  // over (caller returns from the IIFE), false when no gate is needed
  // (caller continues into the main app setup).
  function setupSignInGateIfNeeded() {
    if (typeof window.Auth === 'undefined') return false; // defensive
    // Localhost dev bypass — auto-creates a DevUser on serve.ps1 so
    // the gate doesn't block local dev (Apple Sign In plugin only
    // works under Capacitor native iOS). The function is internally
    // gated against Capacitor's native WebView (which also uses
    // 'localhost' as hostname under the capacitor:// scheme), so this
    // call is a no-op on production iOS — real users still hit the
    // real gate. Also a no-op if an actual user is already signed in.
    try { window.Auth.devSignInIfLocalhost(); } catch (_) {}
    const user = window.Auth.getCurrentUser();
    if (user && user.alias) return false; // signed in + alias set → mount app
    const gate = document.getElementById('signin-gate');
    if (!gate) return false; // gate markup missing — fail open
    gate.classList.remove('hidden');

    // Determine which step to show:
    //   no user → step "apple" (sign in)
    //   user but no alias → step "alias" (alias picker)
    const stepApple = document.getElementById('signin-step-apple');
    const stepAlias = document.getElementById('signin-step-alias');
    if (user && !user.alias) {
      if (stepApple) stepApple.classList.add('hidden');
      if (stepAlias) stepAlias.classList.remove('hidden');
      const aliasInput = document.getElementById('signin-alias-input');
      if (aliasInput) {
        try { aliasInput.value = localStorage.getItem('hb_name') || ''; } catch (_) {}
        setTimeout(() => { try { aliasInput.focus(); } catch (_) {} }, 250);
      }
    } else {
      if (stepApple) stepApple.classList.remove('hidden');
      if (stepAlias) stepAlias.classList.add('hidden');
    }

    // Wire Apple-sign-in button.
    const appleBtn = document.getElementById('signin-apple-btn');
    const appleErr = document.getElementById('signin-apple-error');
    if (appleBtn) {
      appleBtn.addEventListener('click', async () => {
        if (appleErr) appleErr.textContent = '';
        appleBtn.disabled = true;
        try {
          if (!window.Auth.isNative()) {
            if (appleErr) appleErr.textContent = 'Sign in with Apple is only available in the iOS app.';
            return;
          }
          const response = await window.Auth.signInWithApple();
          if (!response) {
            // user cancelled or no response — stay on the apple step
            return;
          }
          // Transition to alias picker.
          if (stepApple) stepApple.classList.add('hidden');
          if (stepAlias) stepAlias.classList.remove('hidden');
          const aliasInput = document.getElementById('signin-alias-input');
          if (aliasInput) {
            try {
              const suggested = (response.givenName && String(response.givenName).trim()) ||
                                (localStorage.getItem('hb_name') || '');
              aliasInput.value = suggested.slice(0, 20);
            } catch (_) {}
            setTimeout(() => { try { aliasInput.focus(); } catch (_) {} }, 250);
          }
        } catch (e) {
          if (e && e.message === 'NATIVE_ONLY') {
            if (appleErr) appleErr.textContent = 'Sign in with Apple is only available in the iOS app.';
          } else {
            if (appleErr) appleErr.textContent = 'Sign in failed — please try again.';
          }
        } finally {
          appleBtn.disabled = false;
        }
      });
    }

    // Wire alias-continue button. v2.1.0 Phase B: this calls the
    // real backend at /v1/auth/verify, replacing the Phase A stub.
    const aliasBtn = document.getElementById('signin-alias-continue');
    const aliasErr = document.getElementById('signin-alias-error');
    const aliasIn  = document.getElementById('signin-alias-input');
    const suggBox  = document.getElementById('signin-alias-suggestions');

    function renderSuggestions(suggested) {
      if (!suggBox) return;
      suggBox.innerHTML = '';
      if (!Array.isArray(suggested) || suggested.length === 0) return;
      const label = document.createElement('div');
      label.className = 'signin-suggestions-label';
      label.textContent = 'Try one of these:';
      suggBox.appendChild(label);
      suggested.forEach((s) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'signin-suggestion-chip';
        chip.textContent = s;
        chip.addEventListener('click', () => {
          if (aliasIn) {
            aliasIn.value = s;
            aliasIn.focus();
          }
          if (aliasErr) aliasErr.textContent = '';
          suggBox.innerHTML = '';
        });
        suggBox.appendChild(chip);
      });
    }

    const submitAlias = async () => {
      if (!aliasIn || !aliasBtn) return;
      const value = aliasIn.value;
      if (suggBox) suggBox.innerHTML = '';
      if (!window.Auth.validateAlias(value)) {
        if (aliasErr) aliasErr.textContent = '3–20 chars, letters/numbers/space/_/- only.';
        return;
      }
      aliasBtn.disabled = true;
      if (aliasErr) aliasErr.textContent = 'Signing in…';
      let result;
      try {
        result = await window.Auth.completeSignIn(value);
      } catch (e) {
        result = { ok: false, code: 'NETWORK', reason: 'Could not reach server.' };
      }
      if (result && result.ok) {
        // Reload to mount the main app from the signed-in state.
        window.location.reload();
        return;
      }
      const code = result && result.code;
      if (code === 'ALIAS_TAKEN' && result.suggested && result.suggested.length > 0) {
        if (aliasErr) aliasErr.textContent = result.reason || 'That alias is taken.';
        renderSuggestions(result.suggested);
      } else if (code === 'ALIAS_INVALID') {
        if (aliasErr) aliasErr.textContent = result.reason || 'Alias not allowed.';
      } else if (code === 'APPLE_TOKEN_INVALID' || code === 'NO_PENDING_TOKEN') {
        // Reset to the Apple-sign-in step.
        if (stepAlias) stepAlias.classList.add('hidden');
        if (stepApple) stepApple.classList.remove('hidden');
        const appleErr2 = document.getElementById('signin-apple-error');
        if (appleErr2) appleErr2.textContent = result.reason || 'Sign in expired — please try again.';
      } else if (code === 'NETWORK') {
        if (aliasErr) aliasErr.textContent = 'Could not reach server. Check your connection.';
      } else {
        if (aliasErr) aliasErr.textContent = (result && result.reason) || 'Sign in failed. Try again.';
      }
      aliasBtn.disabled = false;
    };
    if (aliasBtn) aliasBtn.addEventListener('click', submitAlias);
    if (aliasIn) aliasIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitAlias(); }
    });

    return true; // gate took over; caller halts main app setup
  }
  if (setupSignInGateIfNeeded()) return;

  // ── CONSTANTS ─────────────────────────────────────────────
  const DIFFICULTY = {
    easy:      { label: 'Easy',      pts: 1  },
    medium:    { label: 'Medium',    pts: 3  },
    hard:      { label: 'Hard',      pts: 5  },
    legendary: { label: 'Legendary', pts: 10 },
  };

  // ── APP VERSION ──────────────────────────────────────────
  // Single source of truth for the app's marketing version. Bump this
  // when shipping a new TestFlight / App Store build (and add the
  // matching WHATS_NEW entry below).
  const APP_VERSION = '2.1.0';
  // Expose for auth.js (backup metadata + diagnostics). Stays in lockstep
  // with the constant above; bump together when shipping a new train.
  try { window.__APP_VERSION = APP_VERSION; } catch (_) {}

  // v2.1 Phase E — single point of update when Richie publishes a new
  // privacy policy URL. All references in code must go through the
  // constant so swapping the URL is a one-line change.
  const AWAKENED_PRIVACY_POLICY_URL = 'https://heartfelt-froyo-54ffa1.netlify.app/';

  // ── HealthKit auto-verification thresholds ───────────────
  // v1.1.5: Daily walk auto-verifies via Apple Health when steps
  // reach the user's chosen goal. Default 3,000 ≈ 30 min of
  // moderate-pace walking, matching the canonical "Daily walk · 30 min"
  // habit. The goal is stored PER HABIT (habit.stepGoal field) — see
  // CLAUDE.md "habit identity is the name string" + "single source of
  // truth" patterns. The Edit Habit modal hosts the configuration UI.
  // Always read via getHabitStepGoal(habit) — never reference the
  // default directly outside the helper.
  const HEALTHKIT_WALK_DEFAULT_THRESHOLD = 8000;
  // Data-layer floor — kept loose so EXISTING users who already saved
  // sub-8,000 step goals don't have their stored value silently re-
  // mapped on load. The user-facing edit floor is HEALTHKIT_WALK_EDIT_FLOOR
  // below, enforced in the Edit Habit modal's commit paths. Existing
  // sub-floor habits keep working until the user re-edits them, at
  // which point the modal forces them up to ≥ 8,000.
  const HEALTHKIT_WALK_THRESHOLD_MIN = 100;
  const HEALTHKIT_WALK_THRESHOLD_MAX = 50000;
  // UI-layer minimum — Edit Habit modal refuses to commit values below
  // this. Discipline app: 5K is too soft an entry bar; 8K is the
  // baseline for "you actually walked today."
  const HEALTHKIT_WALK_EDIT_FLOOR = 8000;
  // Preset chips offered in the Edit Habit step-goal control. "Custom"
  // outside this list reveals the inline numeric input.
  const HEALTHKIT_WALK_PRESETS = [8000, 10000];

  // ── HealthKit auth version ───────────────────────────────
  // BUMP THIS NUMBER any time you add a new HealthKit category to the
  // requestAuthorization() read array. The migration in init() compares
  // this against hb_healthkit_authversion in localStorage; if the
  // user's stored version is lower, all per-category "already-asked"
  // flags are cleared so the upgrade-path helpers will re-fire and
  // iOS shows a permission sheet for the newly-added categories. The
  // existing grants for previously-authorized categories stay intact —
  // iOS dedupes within a single requestAuthorization call.
  //
  // Version log:
  //   1 — v1.1.4: steps only
  //   2 — v1.1.5: steps + sleep + workouts (via 'activity' alias)
  //
  // When you bump, also update HEALTHKIT_AUTH_FLAGS_TO_CLEAR below
  // with any new per-category flags so the migration knows what to
  // wipe. (For v1 → v2 there's only one such flag.)
  const HEALTHKIT_AUTH_VERSION = 2;
  const HEALTHKIT_AUTH_FLAGS_TO_CLEAR = ['hb_healthkit_sleep_requested'];

  // ── HealthKit sleep auto-verification ────────────────────
  // v1.1.5: canonical 'Sleep' habit auto-verifies via Apple Health
  // when total asleep hours ≥ habit.sleepGoalHours. The canonical
  // 'Sleep before midnight' habit auto-verifies binarily when the
  // earliest qualifying asleep sample.startDate < device-local
  // midnight today. See Health.getSleepLastNight() for the full
  // sample-handling caveats. Always read goal via getSleepGoalHours().
  const HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS = 7;
  const HEALTHKIT_SLEEP_GOAL_MIN_HOURS = 3;
  const HEALTHKIT_SLEEP_GOAL_MAX_HOURS = 14;
  const HEALTHKIT_SLEEP_PRESETS = [6, 7, 8, 9];
  const HEALTHKIT_SLEEP_NAP_MIN_MINUTES = 30; // sample duration < this = nap
  const HEALTHKIT_SLEEP_LOOKBACK_HOURS = 18;  // query window backwards from now

  // Pure helper: filters HealthKit sleep samples to the strict bedtime
  // window — qualifying asleep samples (≥30 min) whose startDate is in
  // [20:00, 24:00) device-local on the prior day. Returns array sorted
  // by startDate ascending; callers use length>0 (boolean: bedtime
  // before midnight) or [0].start (earliest onset).
  //
  // STRICT WINDOW rationale: see autoVerifySleepBeforeMidnight comments
  // and CLAUDE.md "HealthKit integration → bedtime detection". Both
  // habit auto-verify (Sleep before midnight) and boss evaluators
  // (The Carouser) consume this same helper — keeps the rule in ONE
  // place so a future tightening (e.g., before-11-PM variant) can be
  // applied consistently without drift between consumers.
  function getBedtimeSamplesInWindow(samples) {
    const midnightToday = new Date();
    midnightToday.setHours(0, 0, 0, 0);
    const windowStart = new Date(midnightToday.getTime() - 4 * 3600 * 1000); // 20:00 prior day
    const napFloorHours = HEALTHKIT_SLEEP_NAP_MIN_MINUTES / 60;
    return (samples || [])
      .filter(s => Number(s.duration) >= napFloorHours)
      .map(s => ({ start: new Date(s.startDate), src: s }))
      .filter(s => s.start >= windowStart && s.start < midnightToday)
      .sort((a, b) => a.start - b.start);
  }

  // ── DUNGEON BOSSES (v1.1.7) ──────────────────────────────────
  // Foundation-only system: state model + kill detection + minimal UI.
  // No drops, no cards, no rewards — those layer on top in v1.2+.
  // Each boss has a name, rank tier, flavor copy, and a kill condition
  // evaluated against HealthKit data (or other passive signals later).
  // State lives in `hb_bosses` localStorage key.
  //
  // Independence from habit auto-verify: bosses run on a separate
  // signal — they evaluate from raw Apple Health data, not from any
  // habit's checked state. They IGNORE the Settings → Apple Health
  // pause toggle (isAutoVerifyDisabled). That pause is scoped to
  // habit auto-verify only. Bosses are background passive progress.
  //
  // First-install behavior: streak starts at 0 on install regardless
  // of prior HealthKit history. We do NOT backfill from history. v1.0
  // limitation; users start fresh. Future versions could optionally
  // backfill — out of scope for v1.1.7.
  const BOSSES = {
    the_insomniac: {
      id:           'the_insomniac',
      name:         'The Insomniac',
      rank:         'E',
      flavorShort:  'A creature born from restless nights.',
      flavorLong:   'A creature born from restless nights. It feeds on the hours you should have slept.',
      killCondShort:'Sleep 7+ hours, 2 nights in a row',
      killCondLong: 'Sleep at least 7 hours per night for 2 nights in a row. A night under 7 hours, or a night with no sleep data, breaks the streak.',
      streakTarget: 2,
      sleepHours:   7,
      cadence:      'daily',
      statDomain:   'VIT',
    },
    the_steel_wolf: {
      id:               'the_steel_wolf',
      name:             'The Steel Wolf',
      rank:             'D',
      flavorShort:      'A wolf forged from miles.',
      flavorLong:       "It paces the borderlands of every distance you've ever walked. Move enough, and you walk beside it. Stop, and you fall behind.",
      killCondShort:    'Walk 5,000+ steps, 2 days in a row',
      killCondLong:     'Walk at least 5,000 steps per day for 2 days in a row. A day under 5,000 steps, or a day with no step data, breaks the streak.',
      streakTarget:     2,
      stepThreshold:    5000, // semantic-specific, parallel to Insomniac's sleepHours
      cadence:          'daily',
      statDomain:       'VIT',
    },
    the_carouser: {
      id:               'the_carouser',
      name:             'The Carouser',
      rank:             'E',
      flavorShort:      'He keeps a long table, and his guests rarely leave.',
      flavorLong:       'Two nights a week he calls them home — Friday and Saturday — and most answer. Refuse him both nights running, and the door stays closed.',
      killCondShort:    'Sleep 7+ hours and bed before midnight, both Friday and Saturday',
      killCondLong:     'Sleep at least 7 hours AND go to bed before midnight on Friday AND Saturday of the same weekend. Miss either night, and the streak resets to start the next weekend.',
      streakTarget:     2,
      sleepHours:       7,
      cadence:          'weekly',
      statDomain:       'WILL',
      dayOfWeekScoped:  true, // only Fri + Sat nights count (2-night recalibration)
    },
  };

  function loadBosses() {
    try { return JSON.parse(localStorage.getItem('hb_bosses') || '{}'); }
    catch (_) { return {}; }
  }
  function saveBosses(state) {
    try { localStorage.setItem('hb_bosses', JSON.stringify(state)); } catch (_) {}
  }
  // Returns the per-boss state, defaulting to the initial shape if
  // unset. Always returns a valid object — callers don't need to
  // handle missing-key edge cases.
  //
  // v2.0.1 engagement-pivot: every boss state carries `engaged` +
  // `engaged_at`. Defaults are not-engaged so freshly-discovered
  // bosses stay dormant until the user explicitly opts in via the
  // ENGAGE BOSS button on the detail modal.
  function getBossState(id) {
    const all = loadBosses();
    const base = all[id] || { streak: 0, kill_count: 0, last_eval_date: null };
    // Backfill engagement fields for older state rows (defensive —
    // the init migration also sets these, but we want any callsite
    // to get a consistent shape regardless of migration timing).
    if (typeof base.engaged !== 'boolean') base.engaged = false;
    if (typeof base.engaged_at === 'undefined') base.engaged_at = null;
    return base;
  }
  function setBossState(id, state) {
    const all = loadBosses();
    all[id] = state;
    saveBosses(all);
  }

  // ── ENGAGEMENT MODEL (v2.0.1) ───────────────────────────────
  // Bosses no longer progress passively. The user must engage a
  // boss before successful habits count toward its kill condition.
  // Cap of 3 simultaneous engagements — pulled from the multi-focus
  // design principle in BOSSES.md (multi-focus, not exclusivity).
  // Disengaging mid-streak resets the streak; kill_count is sacred.
  const MAX_ENGAGED_BOSSES = 3;
  const ENGAGEMENT_MIGRATION_FLAG = 'hb_bosses_engagement_migrated';

  function countEngagedBosses() {
    const all = loadBosses();
    let n = 0;
    for (const id in all) {
      if (all[id] && all[id].engaged === true) n += 1;
    }
    return n;
  }
  function isBossEngaged(id) {
    return getBossState(id).engaged === true;
  }

  function engageBoss(bossId) {
    const cfg = BOSSES[bossId];
    if (!cfg) return false;
    const state = getBossState(bossId);
    if (state.engaged === true) return true; // already engaged, no-op
    // Defense-in-depth: preview-mode bosses (rank not yet unlocked)
    // can be viewed but not engaged. The detail modal already swaps
    // ENGAGE BOSS for a static label in this state, but a stray call
    // (e.g., console-poke) still hits this guard.
    if (!isGateUnlocked(cfg.rank)) {
      try {
        if (typeof showHabitToast === 'function') {
          showHabitToast('Reach ' + cfg.rank + ' rank to engage ' + cfg.name + '.');
        }
      } catch (_) {}
      return false;
    }
    if (countEngagedBosses() >= MAX_ENGAGED_BOSSES) {
      try {
        if (typeof showHabitToast === 'function') {
          showHabitToast('You can only hunt 3 bosses at once. Disengage one first.');
        }
      } catch (_) {}
      return false;
    }
    // v2.0.1 Souls economy — engagement is the wager. Cost is rank-
    // scaled. Refused if the user can't afford; broke-state toast
    // tells them the exact gap.
    const cost = engageCostSouls(cfg.rank);
    const balance = getSoulsBalance();
    if (balance < cost) {
      try {
        if (typeof showHabitToast === 'function') {
          showHabitToast('Need ' + cost + ' souls. You have ' + balance + '.');
        }
      } catch (_) {}
      return false;
    }
    if (cost > 0) spendSouls(cost, 'engage_' + bossId);
    state.engaged = true;
    state.engaged_at = new Date().toISOString();
    setBossState(bossId, state);
    try {
      if (typeof showHabitToast === 'function') {
        showHabitToast('Now hunting ' + cfg.name + '.' + (cost > 0 ? ' -' + cost + ' souls.' : ''));
      }
    } catch (_) {}
    // Re-render the Quests panel + the detail modal if either is open
    // so engage button → "Stop Hunting" + card visual treatment swap
    // happen instantly.
    try { if (currentTab === 'quests') renderBossesPanel(currentDungeonRank); } catch (_) {}
    try { refreshBossFullScreenIfOpen(bossId); } catch (_) {}
    return true;
  }

  function disengageBoss(bossId) {
    const cfg = BOSSES[bossId];
    if (!cfg) return false;
    const state = getBossState(bossId);
    if (state.engaged !== true) return true; // already disengaged
    state.engaged = false;
    state.engaged_at = null;
    // Streak doesn't survive disengagement — re-engaging starts fresh.
    state.streak = 0;
    state.last_eval_date = null;
    // Carouser-specific weekend fields — clear so re-engagement starts
    // a clean weekend cycle. weekend_burned + current_weekend_id are
    // orthogonal to engagement but should not carry stale state across
    // a hunt-resume that may be weeks later.
    if (bossId === 'the_carouser') {
      state.weekend_burned = false;
      state.current_weekend_id = null;
    }
    setBossState(bossId, state);
    try {
      if (typeof showHabitToast === 'function') {
        showHabitToast('Stopped hunting ' + cfg.name + '.');
      }
    } catch (_) {}
    try { if (currentTab === 'quests') renderBossesPanel(currentDungeonRank); } catch (_) {}
    try { refreshBossFullScreenIfOpen(bossId); } catch (_) {}
    return true;
  }

  // One-time migration to opt all existing-state bosses out of the
  // new model. Earned kill_count is preserved; everything else clears
  // so users start fresh under the engagement contract. Idempotent
  // via the localStorage flag — runs once and never again.
  function migrateBossesToEngagementModel() {
    if (localStorage.getItem(ENGAGEMENT_MIGRATION_FLAG) === '1') return;
    try {
      const all = loadBosses();
      let mutated = false;
      for (const id in all) {
        const b = all[id];
        if (!b || typeof b !== 'object') continue;
        // Preserve kill_count — earned history is sacred.
        b.streak = 0;
        b.last_eval_date = null;
        b.engaged = false;
        b.engaged_at = null;
        if (id === 'the_carouser') {
          b.weekend_burned = false;
          b.current_weekend_id = null;
        }
        mutated = true;
      }
      if (mutated) saveBosses(all);
    } catch (_) {}
    localStorage.setItem(ENGAGEMENT_MIGRATION_FLAG, '1');
  }

  // ── SOULS CURRENCY (v2.0.1) ─────────────────────────────────
  // Economic layer alongside XP. Spent on boss engagement, earned via
  // daily login + boss kills. Tier-scaled (E→S doubles per rank for
  // both costs and rewards) so a disciplined hunter nets +cost per
  // kill while a chronic disengager drains.
  //
  // Two-tier philosophy preserved: habits stay no-failure-state. The
  // soul economy lives entirely in the boss layer — completing
  // habits never touches souls. The wager is only made when the user
  // actively engages a boss.
  //
  // Schema:
  //   { balance, lastDailyBonusDate, totalEarned, totalSpent }
  //   totalEarned/Spent are debug-only; not surfaced in UI.
  //
  // First-install grants 35 souls. Combined with the +15 daily
  // login bonus that fires on the same first session, new users see
  // 50 souls on their first opening of the app — exactly 2× E-rank
  // engagement cost (25). Forces commitment to 2 bosses from day
  // one rather than spreading thin across all six. Tighter than the
  // original 150 grant (and the brief intermediate 50 grant, which
  // over-delivered to 65 first-session because the daily bonus
  // stacked on top); 35 nets to the design intent of "feels like 50."
  const SOULS_STORAGE_KEY = 'hb_souls';
  const SOULS_DAILY_BONUS = 15;
  const SOULS_FIRST_INSTALL_GRANT = 35;
  const SOULS_KILL_REWARDS  = { E: 50, D: 100, C: 200, B: 400, A: 800, S: 1600 };
  const SOULS_ENGAGE_COSTS  = { E: 25, D:  50, C: 100, B: 200, A: 400, S:  800 };

  // ── EQUIPMENT CARDS (v2.0.1 DROPS Phase 1) ──────────────────
  // Drops from boss kills. Each card is also an equippable item per
  // EQUIPMENT.md — stat bonuses, slot, tier all captured from day
  // one so the eventual equip UI + PvP combat (Phase 3-5) can layer
  // on without painful data migration. In v1 the UI surfaces these
  // as Pokédex collection only (no equip slots, no character avatar
  // yet). The schema is the source of truth — UI builds on top.
  //
  // Slot ownership per boss locked in EQUIPMENT.md "Slot Ownership"
  // section. Stat magnitudes follow the tier-doubling table:
  // E-tier common=2, rare=6, ultra-rare=12 // D-tier =4/12/24.
  // Don't improvise values — pull from EQUIPMENT.md verbatim.
  const CARDS = {
    // ── The Insomniac (E, VIT) — signature slot: AMULET ─────
    dream_woven_hood: {
      id: 'dream_woven_hood',
      name: 'Dream-Woven Hood',
      slot: 'helm',
      source_boss: 'the_insomniac',
      rarity: 'common',
      tier: 'E',
      flavor: 'A hood spun from undisturbed sleep.',
      art_path: 'assets/items/dream_woven_hood.png',
      bonuses: { str: 0, vit: 2, int: 0, focus: 0, will: 0, wlt: 0 },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },
    sleepwalkers_cloak: {
      id: 'sleepwalkers_cloak',
      name: "Sleepwalker's Cloak",
      slot: 'cape',
      source_boss: 'the_insomniac',
      rarity: 'rare',
      tier: 'E',
      flavor: 'Worn by those who walk the line between dreams and dawn.',
      art_path: 'assets/items/sleepwalkers_cloak.png',
      bonuses: { str: 0, vit: 6, int: 0, focus: 0, will: 0, wlt: 0 },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },
    pendant_of_the_wakeful: {
      id: 'pendant_of_the_wakeful',
      name: 'Pendant of the Wakeful',
      slot: 'amulet',
      source_boss: 'the_insomniac',
      rarity: 'ultra_rare',
      tier: 'E',
      flavor: 'Hangs heavy with the weight of restful nights. Best in slot — until something older breaks.',
      art_path: 'assets/items/pendant_of_the_wakeful.png',
      bonuses: { str: 0, vit: 8, int: 0, focus: 0, will: 4, wlt: 0 },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },

    // ── The Carouser (E, WILL) — signature slot: GLOVES ─────
    vow_ring: {
      id: 'vow_ring',
      name: 'Vow Ring',
      slot: 'ring',
      source_boss: 'the_carouser',
      rarity: 'common',
      tier: 'E',
      flavor: 'Worn by those who chose to leave before midnight.',
      art_path: 'assets/items/vow_ring.png',
      bonuses: { str: 0, vit: 0, int: 0, focus: 0, will: 2, wlt: 0 },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },
    vessel_of_refusal: {
      id: 'vessel_of_refusal',
      name: 'Vessel of Refusal',
      slot: 'weapon',
      source_boss: 'the_carouser',
      rarity: 'rare',
      tier: 'E',
      flavor: 'A chalice carried but never lifted.',
      art_path: 'assets/items/vessel_of_refusal.png',
      bonuses: { str: 0, vit: 0, int: 0, focus: 0, will: 6, wlt: 0 },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },
    sober_kings_gloves: {
      id: 'sober_kings_gloves',
      name: "Sober King's Gloves",
      slot: 'gloves',
      source_boss: 'the_carouser',
      rarity: 'ultra_rare',
      tier: 'E',
      flavor: 'Steady hands. Empty cup. Best in slot — discipline made manifest.',
      art_path: 'assets/items/sober_kings_gloves.png',
      bonuses: { str: 0, vit: 4, int: 0, focus: 0, will: 8, wlt: 0 },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },

    // ── The Steel Wolf (D, VIT) — signature slot: BOOTS ─────
    pack_leaders_greaves: {
      id: 'pack_leaders_greaves',
      name: "Pack Leader's Greaves",
      slot: 'legs',
      source_boss: 'the_steel_wolf',
      rarity: 'common',
      tier: 'D',
      flavor: 'The wolf does not stop.',
      art_path: 'assets/items/pack_leaders_greaves.png',
      bonuses: { str: 0, vit: 4, int: 0, focus: 0, will: 0, wlt: 0 },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },
    alphas_mantle: {
      id: 'alphas_mantle',
      name: "Alpha's Mantle",
      slot: 'body',
      source_boss: 'the_steel_wolf',
      rarity: 'rare',
      tier: 'D',
      flavor: 'Mantle of one who leads the hunt.',
      art_path: 'assets/items/alphas_mantle.png',
      bonuses: { str: 0, vit: 12, int: 0, focus: 0, will: 0, wlt: 0 },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },
    trail_worn_boots: {
      id: 'trail_worn_boots',
      name: 'Trail-Worn Boots',
      slot: 'boots',
      source_boss: 'the_steel_wolf',
      rarity: 'ultra_rare',
      tier: 'D',
      flavor: 'Every step counts. These have counted thousands. Best in slot — until the trail goes further.',
      art_path: 'assets/items/trail_worn_boots.png',
      bonuses: { str: 8, vit: 16, int: 0, focus: 0, will: 0, wlt: 0 },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },

    // ── v2.1 content patch — 6 new commons (2 per boss) ─────
    // Fills slots each boss didn't previously drop. Existing 3 commons
    // remain authoritative for their slots; these add entry-level
    // alternatives across the rest of the loadout. Variable stat-roll
    // ranges defined per PVP.md v1.0 — `bonus_ranges` is the source
    // of truth for v3 PvP; `bonuses` is the v2.x fixed midpoint.
    // Art files not yet on disk — assets/items/<id>.png paths are
    // placeholders. Render path falls back to emoji + rarity gradient
    // via the existing 404 handler in setModalCardArt / Pokédex tile.

    // ── The Insomniac (E, VIT) — new commons ────────────────
    tossing_bedroll: {
      id: 'tossing_bedroll',
      name: 'Tossing Bedroll',
      slot: 'body',
      source_boss: 'the_insomniac',
      rarity: 'common',
      tier: 'E',
      flavor: 'Wrapped tight by those who fear the dark hours. Thin, but it keeps you upright when sleep refuses to come.',
      art_path: 'assets/items/tossing_bedroll.png',
      bonuses:       { str: 0, vit: 2, int: 0, focus: 0, will: 0, wlt: 0 },
      bonus_ranges:  { str: [0,0], vit: [1,3], int: [0,0], focus: [0,0], will: [0,0], wlt: [0,0] },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },
    drowsy_signet: {
      id: 'drowsy_signet',
      name: 'Drowsy Signet',
      slot: 'ring',
      source_boss: 'the_insomniac',
      rarity: 'common',
      tier: 'E',
      flavor: 'A simple ring etched with the half-moon. Worn by those still learning when to rest.',
      art_path: 'assets/items/drowsy_signet.png',
      bonuses:       { str: 0, vit: 2, int: 0, focus: 0, will: 0, wlt: 0 },
      bonus_ranges:  { str: [0,0], vit: [1,3], int: [0,0], focus: [0,0], will: [0,0], wlt: [0,0] },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },

    // ── The Carouser (E, WILL) — new commons ────────────────
    sobriety_token: {
      id: 'sobriety_token',
      name: 'Sobriety Token',
      slot: 'amulet',
      source_boss: 'the_carouser',
      rarity: 'common',
      tier: 'E',
      flavor: 'A worn medallion passed down through circles of restraint. Marked with the words ONE DAY AT A TIME.',
      art_path: 'assets/items/sobriety_token.png',
      bonuses:       { str: 0, vit: 0, int: 0, focus: 0, will: 2, wlt: 0 },
      bonus_ranges:  { str: [0,0], vit: [0,0], int: [0,0], focus: [0,0], will: [1,3], wlt: [0,0] },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },
    steady_steps: {
      id: 'steady_steps',
      name: 'Steady Steps',
      slot: 'boots',
      source_boss: 'the_carouser',
      rarity: 'common',
      tier: 'E',
      flavor: 'Cracked leather walking boots, the soles softened from a thousand sober nights walking home.',
      art_path: 'assets/items/steady_steps.png',
      bonuses:       { str: 0, vit: 0, int: 0, focus: 0, will: 2, wlt: 0 },
      bonus_ranges:  { str: [0,0], vit: [0,0], int: [0,0], focus: [0,0], will: [1,3], wlt: [0,0] },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },

    // ── The Steel Wolf (D, VIT) — new commons ───────────────
    pups_hood: {
      id: 'pups_hood',
      name: "Pup's Hood",
      slot: 'helm',
      source_boss: 'the_steel_wolf',
      rarity: 'common',
      tier: 'D',
      flavor: 'A scrappy hood from a young hunter still finding their place in the pack. The fur is patchy but the spirit is fierce.',
      art_path: 'assets/items/pups_hood.png',
      bonuses:       { str: 1, vit: 3, int: 0, focus: 0, will: 0, wlt: 0 },
      bonus_ranges:  { str: [1,2], vit: [2,5], int: [0,0], focus: [0,0], will: [0,0], wlt: [0,0] },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },
    trackers_wrap: {
      id: 'trackers_wrap',
      name: "Tracker's Wrap",
      slot: 'cape',
      source_boss: 'the_steel_wolf',
      rarity: 'common',
      tier: 'D',
      flavor: "A weathered cloak earned by those who hunt the trail before joining the alpha's kill.",
      art_path: 'assets/items/trackers_wrap.png',
      bonuses:       { str: 0, vit: 3, int: 0, focus: 0, will: 0, wlt: 0 },
      bonus_ranges:  { str: [0,0], vit: [2,5], int: [0,0], focus: [0,0], will: [0,0], wlt: [0,0] },
      set_id: null, required_level: null, special_effect: null,
      on_equip: null, cooldown_seconds: null,
    },
  };

  // Slot icons for placeholder rendering (until DALL-E art lands at
  // each card's art_path). Once real PNGs ship in assets/items/, the
  // card render path can swap to <img src> with onerror fallback.
  const SLOT_ICONS = {
    helm:   '🪖',
    cape:   '🧥',
    amulet: '📿',
    weapon: '⚔️',
    body:   '🛡️',
    legs:   '👖',
    gloves: '🧤',
    boots:  '👢',
    ring:   '💍',
  };

  // Display label for rarity tier (UI surfaces).
  const RARITY_LABELS = {
    common:     'Common',
    rare:       'Rare',
    ultra_rare: 'Ultra-Rare',
  };

  // Drop rates per DROPS.md v1.4 — CADENCE-AWARE. Weekly bosses kill
  // ~once per 7 days (Carouser); daily bosses can kill every 2 days
  // when on streak. To keep per-month expected-pull volume comparable
  // across cadences, weekly rates are multiplied (5× ultra-rare,
  // 3× rare, 2× common) over the daily baseline. Roll order stays
  // mutually-exclusive: ultra-rare → rare → common.
  //
  // First-common protection (DROPS.md v1.6): MULTIPLIER form, not a
  // flat ceiling. Pre-v1.6 was a flat replacement rate — fine when
  // baseline commons were 20%/40%, broke when baselines climbed past
  // the protection ceiling (weekly 70% > old 60% ceiling would have
  // HURT new players). Multiplier form always helps: `commonRate =
  // baseline × COMMON_PROTECTION_MULTIPLIER`, capped at 0.95 so the
  // boosted rate never crowds out the rare/ultra-rare roll order.
  // Protection ends GLOBALLY after the first common from ANY boss.
  const COMMON_PROTECTION_MULTIPLIER = 1.33;
  const COMMON_PROTECTION_CAP        = 0.95;
  const DROP_RATES_BY_CADENCE = {
    daily: {
      ultra_rare: 0.05,   // 5%
      rare:       0.15,   // 15%
      common:     0.50,   // 50%
    },
    weekly: {
      ultra_rare: 0.25,   // 25%
      rare:       0.40,   // 40%
      common:     0.70,   // 70%
    },
  };
  // Resolve the protected common rate for the current baseline.
  // Always returns ≥ baseline so protection never hurts.
  function protectedCommonRate(baseline) {
    return Math.min(COMMON_PROTECTION_CAP, baseline * COMMON_PROTECTION_MULTIPLIER);
  }
  // Resolve the rate table for a boss. Falls back to daily if a boss
  // somehow lacks a cadence — defensive default since the kill-volume
  // assumption (daily ≈ frequent) is the safer error mode (over-tunes
  // toward rarity rather than under-tunes).
  function dropRatesFor(bossId) {
    const cfg = BOSSES[bossId];
    const cadence = (cfg && cfg.cadence) || 'daily';
    return DROP_RATES_BY_CADENCE[cadence] || DROP_RATES_BY_CADENCE.daily;
  }

  // Per-rarity stack caps. Drops continue to roll at standard rates
  // — but once a card has hit its cap, further pulls of that card
  // are blocked from incrementing count. The user is toasted on
  // every dupe (stacked or capped) so the drop event is visible
  // either way. Ultra-rares stack without limit (trophies).
  const STACK_CAPS = {
    common:     1,
    rare:       3,
    ultra_rare: Infinity,
  };

  let _souls = null; // lazy-loaded; loadSouls() initializes

  function loadSouls() {
    try {
      const raw = localStorage.getItem(SOULS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Backfill any missing fields defensively.
        _souls = {
          balance:            typeof parsed.balance === 'number' ? parsed.balance : 0,
          lastDailyBonusDate: parsed.lastDailyBonusDate || null,
          totalEarned:        typeof parsed.totalEarned === 'number' ? parsed.totalEarned : (parsed.balance || 0),
          totalSpent:         typeof parsed.totalSpent === 'number'  ? parsed.totalSpent  : 0,
        };
        return _souls;
      }
    } catch (_) {}
    // First install (or corrupted state) — grant starting balance.
    _souls = {
      balance: SOULS_FIRST_INSTALL_GRANT,
      lastDailyBonusDate: null,
      totalEarned: SOULS_FIRST_INSTALL_GRANT,
      totalSpent: 0,
    };
    persistSouls();
    return _souls;
  }
  function persistSouls() {
    try { localStorage.setItem(SOULS_STORAGE_KEY, JSON.stringify(_souls)); } catch (_) {}
  }
  function getSoulsBalance() {
    if (!_souls) loadSouls();
    return _souls.balance;
  }

  function refreshSoulsDisplay() {
    if (!_souls) return;
    const balanceEl = document.getElementById('souls-balance');
    if (balanceEl) {
      balanceEl.textContent = _souls.balance.toLocaleString('en-US');
    }
    // Brief pulse animation on the badge to signal a change. Re-trigger
    // by removing+forcing reflow+re-adding the class.
    const badge = document.getElementById('souls-badge');
    if (badge) {
      badge.classList.remove('souls-badge--flash');
      void badge.offsetWidth; // force reflow
      badge.classList.add('souls-badge--flash');
    }
  }

  function earnSouls(amount, source) {
    if (typeof amount !== 'number' || amount <= 0) return;
    if (!_souls) loadSouls();
    _souls.balance += amount;
    _souls.totalEarned += amount;
    persistSouls();
    refreshSoulsDisplay();
    // source param is debug-only; not logged to a transaction history
    // for MVP. Future: persist a souls_history array if needed.
  }

  function spendSouls(amount, sink) {
    if (typeof amount !== 'number' || amount <= 0) return;
    if (!_souls) loadSouls();
    _souls.balance -= amount;
    _souls.totalSpent += amount;
    persistSouls();
    refreshSoulsDisplay();
  }

  function killRewardSouls(rank) {
    return SOULS_KILL_REWARDS[rank] || 0;
  }
  function engageCostSouls(rank) {
    return SOULS_ENGAGE_COSTS[rank] || 0;
  }

  // Daily login bonus. Idempotent on the device-local calendar day.
  // No rollover — skipped days are gone.
  //
  // Welcome/onboarding gate (added v2.0.1): deferred until the user
  // is past the welcome screen + onboarding flow so the toast
  // doesn't pop up over those takeover screens. First-install users:
  // the init() call no-ops here (welcome flag not set yet); bonus
  // fires from the showBeginningReveal callback once the main app
  // is visible. Existing users: hb_welcomed === '1' and
  // needsOnboarding === false at init, bonus fires normally.
  function tryGrantDailyLoginBonus() {
    if (!_souls) loadSouls();
    if (localStorage.getItem('hb_welcomed') !== '1') return false;
    if (typeof needsOnboarding !== 'undefined' && needsOnboarding === true) return false;
    const today = getDeviceLocalDate();
    if (_souls.lastDailyBonusDate === today) return false; // already granted
    earnSouls(SOULS_DAILY_BONUS, 'daily_login');
    _souls.lastDailyBonusDate = today;
    persistSouls();
    try {
      if (typeof showHabitToast === 'function') {
        showHabitToast('+' + SOULS_DAILY_BONUS + ' souls (daily bonus)');
      }
    } catch (_) {}
    // The mid-day check-in's priority-1 condition (unclaimed bonus) no
    // longer applies — re-arm so it falls through to priority 2 or 3.
    try { if (typeof Notif !== 'undefined') Notif.reapplyMidDay(); } catch (_) {}
    return true;
  }

  try {
    window.Souls = {
      get balance()      { return getSoulsBalance(); },
      get state()        { if (!_souls) loadSouls(); return Object.assign({}, _souls); },
      earn:              earnSouls,
      spend:             spendSouls,
      killReward:        killRewardSouls,
      engageCost:        engageCostSouls,
      grantDaily:        tryGrantDailyLoginBonus,
      refresh:           refreshSoulsDisplay,
      KILL_REWARDS:      SOULS_KILL_REWARDS,
      ENGAGE_COSTS:      SOULS_ENGAGE_COSTS,
      DAILY_BONUS:       SOULS_DAILY_BONUS,
    };
  } catch (_) {}

  // Souls info modal — opens on souls-badge tap. Centered card
  // explaining earn/spend mechanics. Static info only; no live
  // stats per design call. Reuses the .modal-overlay + .modal
  // pattern; closes via backdrop tap, X button, or ESC.
  function openSoulsInfoModal() {
    const overlay = document.getElementById('souls-info-overlay');
    const modal   = document.getElementById('souls-info-modal');
    if (!overlay || !modal) return;
    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');
  }
  function closeSoulsInfoModal() {
    const overlay = document.getElementById('souls-info-overlay');
    const modal   = document.getElementById('souls-info-modal');
    if (!overlay || !modal) return;
    overlay.classList.add('hidden');
    modal.classList.add('hidden');
  }
  function setupSoulsInfoModal() {
    const badge   = document.getElementById('souls-badge');
    const overlay = document.getElementById('souls-info-overlay');
    const closeBtn = document.getElementById('souls-info-close');
    if (badge)    badge.addEventListener('click', openSoulsInfoModal);
    if (overlay)  overlay.addEventListener('click', closeSoulsInfoModal);
    if (closeBtn) closeBtn.addEventListener('click', closeSoulsInfoModal);
    // ESC key — only fires when the modal is actually open.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const m = document.getElementById('souls-info-modal');
      if (m && !m.classList.contains('hidden')) closeSoulsInfoModal();
    });
  }
  try {
    window.openSoulsInfoModal  = openSoulsInfoModal;
    window.closeSoulsInfoModal = closeSoulsInfoModal;
  } catch (_) {}

  // ── INVENTORY / DROPS ENGINE (v2.0.1 DROPS Phase 1) ─────────
  // hb_inventory shape:
  //   {
  //     cards: { card_id: { discovered, count, first_acquired_date } },
  //     first_common_pulled: bool,
  //     first_common_date: 'YYYY-MM-DD' | null,
  //     reveal_queue: ['card_id', ...]   // rare/ultra-rare pending reveal
  //   }
  //
  // Storage shape locked here so future systems (equip UI, leaderboard
  // visible inventory, etc.) can rely on it without migration.
  //
  // Migration: v1.3 renamed the bottom rarity tier from "uncommon" to
  // "common". loadInventory transparently reads either legacy
  // `first_uncommon_*` or new `first_common_*` keys, prefers new, and
  // persists in the new shape on next write. Old keys are not actively
  // deleted (forward-compat safety for any cross-device sync edge cases).
  const INVENTORY_STORAGE_KEY = 'hb_inventory';
  let _inventory = null;

  function loadInventory() {
    try {
      const raw = localStorage.getItem(INVENTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // v1.3 rename migration — prefer new keys, fall back to legacy.
        const firstCommonPulled = (parsed.first_common_pulled === true)
          || (parsed.first_uncommon_pulled === true);
        const firstCommonDate = parsed.first_common_date
          || parsed.first_uncommon_date
          || null;
        _inventory = {
          cards:                parsed.cards || {},
          first_common_pulled:  firstCommonPulled,
          first_common_date:    firstCommonDate,
          reveal_queue:         Array.isArray(parsed.reveal_queue) ? parsed.reveal_queue : [],
        };
        // Backfill stub entries for any cards in CARDS that aren't in
        // saved state — happens when new cards are added in a release
        // post-deploy. Existing card entries are preserved as-is.
        Object.keys(CARDS).forEach(id => {
          if (!_inventory.cards[id]) {
            _inventory.cards[id] = { discovered: false, count: 0, first_acquired_date: null };
          }
        });
        persistInventory();
        return _inventory;
      }
    } catch (_) {}
    // First install — stub-populate every card as undiscovered.
    _inventory = {
      cards: {},
      first_common_pulled: false,
      first_common_date: null,
      reveal_queue: [],
    };
    Object.keys(CARDS).forEach(id => {
      _inventory.cards[id] = { discovered: false, count: 0, first_acquired_date: null };
    });
    persistInventory();
    return _inventory;
  }
  function persistInventory() {
    try { localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(_inventory)); } catch (_) {}
  }
  function getInventory() {
    if (!_inventory) loadInventory();
    return _inventory;
  }

  // Roll a drop for a boss kill. Returns the dropped card object, or
  // null if no drop. Mutually-exclusive rarity rolls — ultra-rare
  // first, then rare, then common. Per DROPS.md framework principle
  // #5: pure RNG, with the one exception of first-common protection.
  //
  // Side effects on success: increments card count in inventory, sets
  // discovered if first acquisition, queues reveal for rare/ultra-rare
  // first-acquisitions, sets first_common_pulled flag if applicable.
  function rollBossDrop(bossId) {
    const inv = getInventory();
    const cfg = BOSSES[bossId];
    if (!cfg) return null;

    // Build this boss's drop table. v2.1+: per-rarity POOLS (not
    // single entries). When a rarity rolls, uniformly pick one
    // card from that rarity's pool. Common pools grew to 3 cards
    // per boss in v2.1 content patch (was 1 each). Rare + ultra-
    // rare pools remain single-entry today but the array shape is
    // future-proof for when those tiers also expand.
    const bossCards = Object.values(CARDS).filter(c => c.source_boss === bossId);
    const pools = {
      ultra_rare: bossCards.filter(c => c.rarity === 'ultra_rare'),
      rare:       bossCards.filter(c => c.rarity === 'rare'),
      common:     bossCards.filter(c => c.rarity === 'common'),
    };
    const pickFromPool = (pool) => pool.length === 0
      ? null
      : pool[Math.floor(Math.random() * pool.length)];

    // Cadence-specific rates (DROPS.md v1.6). Weekly bosses get
    // higher baselines than daily so per-month pull expectations
    // stay comparable across cadences. Common rate uses the
    // multiplier-form protection until the first common drops.
    const rates = dropRatesFor(bossId);
    const commonRate = inv.first_common_pulled
      ? rates.common
      : protectedCommonRate(rates.common);

    // Roll order. Each roll is independent; checks in order;
    // first hit wins. On hit, uniformly pick one card from that
    // rarity's pool.
    let dropped = null;
    if (Math.random() < rates.ultra_rare && pools.ultra_rare.length) {
      dropped = pickFromPool(pools.ultra_rare);
    } else if (Math.random() < rates.rare && pools.rare.length) {
      dropped = pickFromPool(pools.rare);
    } else if (Math.random() < commonRate && pools.common.length) {
      dropped = pickFromPool(pools.common);
    }

    if (!dropped) return null;

    // Award (or block) the drop based on stack cap.
    const entry = inv.cards[dropped.id] || { discovered: false, count: 0, first_acquired_date: null };
    const wasFirstAcquisition = !entry.discovered;
    const cap = STACK_CAPS[dropped.rarity] != null ? STACK_CAPS[dropped.rarity] : Infinity;
    const wasCapped = (entry.count || 0) >= cap;

    if (!wasCapped) {
      entry.discovered = true;
      entry.count = (entry.count || 0) + 1;
      if (wasFirstAcquisition) {
        entry.first_acquired_date = getDeviceLocalDate();
      }
      inv.cards[dropped.id] = entry;
    }

    // First-common protection state — fires on the FIRST common ever
    // pulled, including the case where it stacks normally. A capped
    // pull (count already at 1) shouldn't re-trigger first-common
    // logic since by definition first_common_pulled is already true.
    if (dropped.rarity === 'common' && !inv.first_common_pulled) {
      inv.first_common_pulled = true;
      inv.first_common_date = getDeviceLocalDate();
    }

    // Queue reveal modal for first-acquisition rare/ultra-rare drops
    // only. Dupes (stacked or capped) don't re-trigger reveals — the
    // toast on the kill handler conveys them instead. Commons never
    // queue — they fire combined-toast.
    if (wasFirstAcquisition && !wasCapped && (dropped.rarity === 'rare' || dropped.rarity === 'ultra_rare')) {
      if (!inv.reveal_queue.includes(dropped.id)) {
        inv.reveal_queue.push(dropped.id);
      }
    }

    persistInventory();
    return {
      card:     dropped,
      wasFirst: wasFirstAcquisition && !wasCapped,
      wasCapped,
      count:    entry.count || 0,
      cap,
    };
  }

  // Force a specific drop (debug/test path — bypass RNG). Picks the
  // matching card from CARDS by (bossId, rarity), awards via same
  // path as rollBossDrop. Useful for QA + replaying the cinematic.
  function forceDrop(bossId, rarity) {
    // Backward-compat alias: legacy 'uncommon' arg maps to 'common'.
    if (rarity === 'uncommon') rarity = 'common';
    // v2.1 content patch — common pools now have >1 entry per boss.
    // Uniformly pick one from the matching (boss, rarity) pool for
    // parity with rollBossDrop's behavior.
    const pool = Object.values(CARDS).filter(c =>
      c.source_boss === bossId && c.rarity === rarity
    );
    if (pool.length === 0) return null;
    const card = pool[Math.floor(Math.random() * pool.length)];
    const inv = getInventory();
    const entry = inv.cards[card.id] || { discovered: false, count: 0, first_acquired_date: null };
    const wasFirstAcquisition = !entry.discovered;
    const cap = STACK_CAPS[card.rarity] != null ? STACK_CAPS[card.rarity] : Infinity;
    const wasCapped = (entry.count || 0) >= cap;

    if (!wasCapped) {
      entry.discovered = true;
      entry.count = (entry.count || 0) + 1;
      if (wasFirstAcquisition) entry.first_acquired_date = getDeviceLocalDate();
      inv.cards[card.id] = entry;
    }
    if (card.rarity === 'common' && !inv.first_common_pulled) {
      inv.first_common_pulled = true;
      inv.first_common_date = getDeviceLocalDate();
    }
    if (wasFirstAcquisition && !wasCapped && (card.rarity === 'rare' || card.rarity === 'ultra_rare')) {
      if (!inv.reveal_queue.includes(card.id)) inv.reveal_queue.push(card.id);
    }
    persistInventory();
    // Trigger reveal immediately for first-acquisition rare/ultra so
    // console testing is one-line. Capped/dupe rare-ultra: no reveal.
    if (wasFirstAcquisition && !wasCapped && (card.rarity === 'rare' || card.rarity === 'ultra_rare')) {
      processRevealQueue();
    }
    return {
      card,
      wasFirst: wasFirstAcquisition && !wasCapped,
      wasCapped,
      count:    entry.count || 0,
      cap,
    };
  }

  // Wipe inventory (debug). Re-stubs all cards as undiscovered, clears
  // protection state + reveal queue. Useful for fresh-install testing.
  function resetInventory() {
    _inventory = {
      cards: {},
      first_common_pulled: false,
      first_common_date: null,
      reveal_queue: [],
    };
    Object.keys(CARDS).forEach(id => {
      _inventory.cards[id] = { discovered: false, count: 0, first_acquired_date: null };
    });
    persistInventory();
  }

  // ── Kill announcement: toast + reveal coordination ──────────
  // Composes the kill-toast text based on the drop outcome. Four
  // cases:
  //   1. No drop                — souls-only toast.
  //   2. First-acquisition common — combined toast (no modal).
  //   3. First-acquisition rare/ultra — souls toast then cinematic
  //      reveal modal (~500ms gap for breathing room).
  //   4. Duplicate (stacked or capped) — toast tells the user the
  //      drop happened and surfaces the new count or cap status.
  //      No cinematic, regardless of rarity.
  function announceKillAndDrop(cfg, soulsReward, dropInfo) {
    const soulsSuffix = soulsReward > 0 ? ' +' + soulsReward + ' souls.' : '';
    let toastMsg = cfg.name + ' defeated.' + soulsSuffix;

    if (dropInfo) {
      const { card, wasFirst, wasCapped, count, cap } = dropInfo;
      const rarityLabel = RARITY_LABELS[card.rarity] || card.rarity;
      if (wasCapped) {
        // Drop blocked — already at stack cap for this card.
        toastMsg += ' Duplicate ' + card.name + ' (' + rarityLabel +
                    '). Cap reached (' + cap + ').';
      } else if (!wasFirst) {
        // Stacked dupe (rare 2-3, ultra unlimited).
        toastMsg += ' Duplicate ' + card.name + ' (' + rarityLabel +
                    '). You have ' + count + '.';
      } else if (card.rarity === 'common') {
        // First-acquisition common — existing combined-toast behavior.
        toastMsg += ' Pulled: ' + card.name + ' (Common).';
      }
      // First-acquisition rare/ultra: no toast extension; the
      // cinematic reveal fires below.
    }

    try {
      if (typeof showHabitToast === 'function') showHabitToast(toastMsg);
    } catch (_) {}

    // Rare/Ultra-Rare first-acquisition: kick the reveal queue.
    // rollBossDrop already pushed the card_id; processRevealQueue
    // picks up on a 500ms delay so the kill toast has its moment
    // first. Dupes (stacked or capped) skip — toast carries the
    // signal alone.
    if (dropInfo && dropInfo.wasFirst &&
        (dropInfo.card.rarity === 'rare' || dropInfo.card.rarity === 'ultra_rare')) {
      setTimeout(() => { try { processRevealQueue(); } catch (_) {} }, 500);
    }
  }

  // ── Reveal modal: cinematic card-drop ceremony ──────────────
  // Processes hb_inventory.reveal_queue one-at-a-time. If queue
  // empty, no-op. If already showing, no-op (the close handler
  // calls processRevealQueue again to chain).
  let _revealActive = false;

  function processRevealQueue() {
    if (_revealActive) return;
    const inv = getInventory();
    if (!inv.reveal_queue || inv.reveal_queue.length === 0) return;
    const nextId = inv.reveal_queue[0];
    const card = CARDS[nextId];
    if (!card) {
      // Stale id (CARDS schema may have changed) — drop from queue
      // and continue.
      inv.reveal_queue.shift();
      persistInventory();
      processRevealQueue();
      return;
    }
    openCardRevealModal(card);
  }

  function openCardRevealModal(card) {
    const overlay = document.getElementById('reveal-overlay');
    if (!overlay) return;
    _revealActive = true;
    document.body.classList.add('reveal-locked');

    // Populate fields.
    const slotIcon = SLOT_ICONS[card.slot] || '✦';
    overlay.className = 'reveal-overlay reveal-overlay--' + card.rarity;
    document.getElementById('reveal-slot-icon').textContent  = slotIcon;
    setModalCardArt('reveal-card-art-img', card.art_path);
    document.getElementById('reveal-card-name').textContent  = card.name;
    document.getElementById('reveal-card-source').textContent = 'From: ' + (BOSSES[card.source_boss] ? BOSSES[card.source_boss].name : '—');
    document.getElementById('reveal-card-rarity').textContent = RARITY_LABELS[card.rarity] || card.rarity;
    document.getElementById('reveal-card-flavor').textContent = card.flavor || '';
    const revealStats = document.getElementById('reveal-card-stats');
    if (revealStats) revealStats.innerHTML = cardStatBadgesHtml(card);

    overlay.classList.remove('hidden');
    // Force reflow so the .reveal-overlay--showing class triggers
    // the keyframe animations rather than instantly snapping.
    void overlay.offsetWidth;
    overlay.classList.add('reveal-overlay--showing');
  }

  function closeCardRevealModal() {
    const overlay = document.getElementById('reveal-overlay');
    if (!overlay) return;
    overlay.classList.remove('reveal-overlay--showing');
    overlay.classList.add('reveal-overlay--closing');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('reveal-overlay--closing');
      document.body.classList.remove('reveal-locked');
      _revealActive = false;
      // Pop the head of the queue and chain to the next one if any.
      const inv = getInventory();
      if (inv.reveal_queue && inv.reveal_queue.length > 0) {
        inv.reveal_queue.shift();
        persistInventory();
      }
      // Re-render Pokédex if user is currently looking at Items tab,
      // so the new discovered card appears immediately.
      try { if (currentTab === 'items') renderPokedex(); } catch (_) {}
      // Continue queue.
      setTimeout(() => { try { processRevealQueue(); } catch (_) {} }, 250);
    }, 320); // matches CSS reveal-overlay--closing duration
  }

  function setupCardRevealModal() {
    const overlay = document.getElementById('reveal-overlay');
    if (!overlay) return;
    // Tap anywhere on the overlay (including the card) dismisses.
    overlay.addEventListener('click', () => {
      if (overlay.classList.contains('reveal-overlay--showing')) {
        closeCardRevealModal();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (overlay.classList.contains('reveal-overlay--showing')) closeCardRevealModal();
    });
  }

  // ── Pokédex (Items tab) ─────────────────────────────────────
  // Three sections grouped by rarity (Ultra-Rare → Rare → Common)
  // with discovered + undiscovered slots. Discovered card → tap to
  // open card detail. Undiscovered → toast "Not yet discovered."
  function renderPokedex() {
    const root = document.getElementById('pokedex-sections');
    const totalEl = document.getElementById('pokedex-total');
    const discEl = document.getElementById('pokedex-discovered');
    const fillEl = document.getElementById('pokedex-progress-fill');
    if (!root) return;

    const inv = getInventory();
    const allIds = Object.keys(CARDS);
    const totalCount = allIds.length;
    const discoveredCount = allIds.filter(id => inv.cards[id] && inv.cards[id].discovered).length;

    if (totalEl) totalEl.textContent = totalCount;
    if (discEl)  discEl.textContent  = discoveredCount;
    if (fillEl)  fillEl.style.width  = (totalCount > 0 ? (discoveredCount / totalCount * 100) : 0) + '%';

    const sections = [
      { key: 'ultra_rare', label: 'ULTRA-RARE' },
      { key: 'rare',       label: 'RARE' },
      { key: 'common',     label: 'COMMON' },
    ];

    const collapsed = loadPokedexCollapsed();

    root.innerHTML = sections.map(s => {
      const sectionCards = allIds
        .map(id => CARDS[id])
        .filter(c => c.rarity === s.key);
      const sectionDiscovered = sectionCards.filter(c => inv.cards[c.id] && inv.cards[c.id].discovered).length;
      const sectionTotal = sectionCards.length;
      const isCollapsed = collapsed.has(s.key);
      const visibleCards = sectionCards;
      const cardsHtml = visibleCards.map(c => {
        const entry = inv.cards[c.id] || { discovered: false, count: 0 };
        const slotIcon = SLOT_ICONS[c.slot] || '✦';
        if (entry.discovered) {
          // Real art layered ON TOP of the emoji fallback. If art_path
          // 404s (most cards still placeholder), the post-render
          // attachCardArtFallback() removes the <img>, leaving the
          // emoji + rarity gradient visible underneath. Successful
          // loads cover the fallback with object-fit: cover.
          const artImg = c.art_path
            ? '<img class="pokedex-card-art-img" src="' + esc(c.art_path) + '" alt="" data-card-art="1">'
            : '';
          return (
            '<button class="pokedex-card pokedex-card--' + c.rarity + '" type="button" data-card-id="' + esc(c.id) + '">' +
              '<div class="pokedex-card-art">' +
                '<span class="pokedex-card-slot-icon">' + slotIcon + '</span>' +
                artImg +
              '</div>' +
              '<div class="pokedex-card-name">' + esc(c.name) + '</div>' +
            '</button>'
          );
        }
        return (
          '<button class="pokedex-card pokedex-card--undiscovered pokedex-card--' + c.rarity + '" type="button" data-card-id="' + esc(c.id) + '">' +
            '<div class="pokedex-card-art pokedex-card-art--undiscovered">' +
              '<span class="pokedex-card-mystery">?</span>' +
            '</div>' +
            '<div class="pokedex-card-name pokedex-card-name--mystery"></div>' +
          '</button>'
        );
      }).join('');
      const bodyHtml = visibleCards.length === 0
        ? '<div class="pokedex-section-empty">No items in this tier yet.</div>'
        : '<div class="pokedex-grid">' + cardsHtml + '</div>';
      return (
        '<div class="pokedex-section pokedex-section--' + s.key + (isCollapsed ? ' pokedex-section--collapsed' : '') + '" data-section-key="' + s.key + '">' +
          '<button class="pokedex-section-header" type="button" data-section-toggle="' + s.key + '" aria-expanded="' + (isCollapsed ? 'false' : 'true') + '">' +
            '<span class="pokedex-section-chevron" aria-hidden="true">▾</span>' +
            '<span class="pokedex-section-label">' + s.label + '</span>' +
            '<span class="pokedex-section-count">' + sectionDiscovered + ' / ' + sectionTotal + '</span>' +
          '</button>' +
          '<div class="pokedex-section-body">' + bodyHtml + '</div>' +
        '</div>'
      );
    }).join('');

    // Attach error handlers to all card-art images so a 404 cleanly
    // falls back to the emoji + rarity gradient underneath. inline
    // onerror would work but post-attach keeps the markup CSP-clean.
    root.querySelectorAll('img[data-card-art="1"]').forEach(img => {
      img.addEventListener('error', () => { img.remove(); }, { once: true });
    });
  }

  // Builds the stat-bonus badge row for a card. Returns an empty
  // string if all bonuses are zero (defensive — current launch set
  // always has at least one non-zero, but future items might be
  // cosmetic-only). One badge per non-zero stat, tinted with the
  // stat's color (CSS handles tint per .stat-badge--<id> modifier).
  // Order matches CLAUDE.md canonical: STR, VIT, INT, FOCUS, WILL, WLT.
  function cardStatBadgesHtml(card) {
    if (!card || !card.bonuses) return '';
    const order = ['str', 'vit', 'int', 'focus', 'will', 'wlt'];
    const labels = { str: 'STR', vit: 'VIT', int: 'INT', focus: 'FOCUS', will: 'WILL', wlt: 'WLT' };
    const icons  = {
      str:   'assets/stat-icons/stat-str.png',
      vit:   'assets/stat-icons/stat-vit.png',
      int:   'assets/stat-icons/stat-int.png',
      focus: 'assets/stat-icons/stat-focus.png',
      will:  'assets/stat-icons/stat-will.png',
      wlt:   'assets/stat-icons/stat-wlt.png',
    };
    const badges = order
      .filter(k => (card.bonuses[k] || 0) > 0)
      .map(k => (
        '<span class="stat-badge stat-badge--' + k + '">' +
          '<img class="stat-badge-icon" src="' + icons[k] + '" alt="" aria-hidden="true">' +
          '<span class="stat-badge-value">+' + card.bonuses[k] + '</span>' +
          '<span class="stat-badge-label">' + labels[k] + '</span>' +
        '</span>'
      ));
    if (badges.length === 0) return '';
    return '<div class="stat-row">' + badges.join('') + '</div>';
  }

  // Sets a card-art image src on a fixed-id <img> element used by the
  // reveal + carddetail modals. Cleanly hides the img on 404 so the
  // emoji slot icon underneath remains visible.
  function setModalCardArt(imgId, artPath) {
    const img = document.getElementById(imgId);
    if (!img) return;
    img.onerror = () => { img.style.display = 'none'; };
    img.onload  = () => { img.style.display = ''; };
    img.style.display = 'none';   // start hidden; onload reveals
    if (artPath) {
      img.src = artPath;
    } else {
      img.removeAttribute('src');
    }
  }

  // Persisted set of collapsed pokedex section keys. Default: ALL collapsed.
  // First-time visitors see a tidy stacked list of dropdown headers and tap
  // open whichever tier they want to browse.
  function loadPokedexCollapsed() {
    const ALL_KEYS = ['ultra_rare', 'rare', 'common'];
    try {
      const raw = localStorage.getItem('hb_pokedex_collapsed');
      if (!raw) return new Set(ALL_KEYS);
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : ALL_KEYS);
    } catch (_) { return new Set(ALL_KEYS); }
  }
  function savePokedexCollapsed(set) {
    try { localStorage.setItem('hb_pokedex_collapsed', JSON.stringify([...set])); } catch (_) {}
  }
  function togglePokedexSection(key) {
    const set = loadPokedexCollapsed();
    if (set.has(key)) set.delete(key); else set.add(key);
    savePokedexCollapsed(set);
  }

  function setupPokedex() {
    const root = document.getElementById('pokedex-sections');
    if (!root) return;
    root.addEventListener('click', (e) => {
      // Section-header toggle (collapsible). Check first so it short-circuits
      // before the card-click path.
      const hdr = e.target.closest('[data-section-toggle]');
      if (hdr) {
        const key = hdr.getAttribute('data-section-toggle');
        togglePokedexSection(key);
        const section = hdr.closest('.pokedex-section');
        if (section) {
          const nowCollapsed = section.classList.toggle('pokedex-section--collapsed');
          hdr.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
        }
        return;
      }
      const btn = e.target.closest('.pokedex-card[data-card-id]');
      if (!btn) return;
      const id = btn.getAttribute('data-card-id');
      const card = CARDS[id];
      if (!card) return;
      const entry = getInventory().cards[id];
      if (!entry || !entry.discovered) {
        try { if (typeof showHabitToast === 'function') showHabitToast('Not yet discovered.'); } catch (_) {}
        return;
      }
      openCardDetailModal(card, entry);
    });
  }

  // ── Card detail modal (static, non-cinematic) ───────────────
  // Tap a discovered card in the Pokédex → review its details.
  // Same data as the reveal modal but without animations.
  function openCardDetailModal(card, entry) {
    const overlay = document.getElementById('carddetail-overlay');
    if (!overlay) return;
    const slotIcon = SLOT_ICONS[card.slot] || '✦';
    overlay.className = 'carddetail-overlay carddetail-overlay--' + card.rarity;
    document.getElementById('carddetail-slot-icon').textContent = slotIcon;
    setModalCardArt('carddetail-card-art-img', card.art_path);
    document.getElementById('carddetail-name').textContent = card.name;
    document.getElementById('carddetail-source').textContent =
      'Dropped from ' + (BOSSES[card.source_boss] ? BOSSES[card.source_boss].name : '—');
    document.getElementById('carddetail-rarity').textContent = RARITY_LABELS[card.rarity] || card.rarity;
    document.getElementById('carddetail-flavor').textContent = card.flavor || '';
    const cdStats = document.getElementById('carddetail-stats');
    if (cdStats) cdStats.innerHTML = cardStatBadgesHtml(card);
    const acqEl = document.getElementById('carddetail-acquired');
    if (acqEl) acqEl.textContent = entry.first_acquired_date
      ? 'First found ' + formatAcquiredDate(entry.first_acquired_date)
      : '';
    const stackEl = document.getElementById('carddetail-stack');
    if (stackEl) stackEl.textContent = (entry.count > 1 ? 'You have ' + entry.count : '');
    overlay.classList.remove('hidden');
  }
  function closeCardDetailModal() {
    const overlay = document.getElementById('carddetail-overlay');
    if (overlay) overlay.classList.add('hidden');
  }
  function setupCardDetailModal() {
    const overlay = document.getElementById('carddetail-overlay');
    const closeBtn = document.getElementById('carddetail-close');
    if (overlay) overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeCardDetailModal();
    });
    if (closeBtn) closeBtn.addEventListener('click', closeCardDetailModal);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const overlay = document.getElementById('carddetail-overlay');
      if (overlay && !overlay.classList.contains('hidden')) closeCardDetailModal();
    });
  }
  // Friendly date formatter for the card detail "first found" line.
  function formatAcquiredDate(iso) {
    if (!iso) return '';
    const today = getDeviceLocalDate();
    if (iso === today) return 'today';
    const yesterday = getDeviceLocalYesterday();
    if (iso === yesterday) return 'yesterday';
    // Calendar-day diff.
    const a = new Date(iso + 'T00:00:00');
    const b = new Date(today + 'T00:00:00');
    const days = Math.round((b - a) / (1000 * 60 * 60 * 24));
    if (days > 1 && days < 7) return days + ' days ago';
    return a.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  try {
    window.Drops = {
      get state()   { return getInventory(); },
      CARDS,
      forceRoll:    forceDrop,
      forceDrop,
      resetInventory,
      rollBossDrop,
      processRevealQueue,
      // Cadence-aware rate inspection (DROPS.md v1.4). Returns the
      // resolved rate table for a boss without forcing a roll —
      // useful for verifying daily-vs-weekly rate selection.
      getRates:     dropRatesFor,
      RATES:        DROP_RATES_BY_CADENCE,
    };
  } catch (_) {}

  // Computes "yesterday" in device-local format. Used by the missed-
  // night reset (init-time) to set last_eval_date back one day so
  // tonight's evaluation can still proceed.
  function getDeviceLocalYesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // Most recent Friday's date in device-local 'YYYY-MM-DD' format.
  // If today IS Friday, returns today. Used as the "weekendId" anchor
  // for The Carouser — Fri + Sat nights both map to the same Friday.
  function getMostRecentFridayDate() {
    const d = new Date();
    // Day index: 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
    // Days to subtract to land on the most recent Friday:
    //   Sun(0) → 2, Mon(1) → 3, Tue(2) → 4, Wed(3) → 5, Thu(4) → 6, Fri(5) → 0, Sat(6) → 1
    const daysBack = (d.getDay() - 5 + 7) % 7;
    d.setDate(d.getDate() - daysBack);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // ── Insomniac kill-detection ─────────────────────────────────
  // Called from autoVerifySleep AFTER HealthKit returns sleep data.
  // Evaluates the most recent night's hours against the kill condition.
  // Idempotent on nightDate — a second call with the same date is a
  // no-op so visibility-change refires don't double-count.
  //
  // sleepHours: total asleep hours from Health.getSleepLastNight()
  // nightDate:  device-local 'YYYY-MM-DD' representing the morning
  //             the user is in (the morning that follows the night
  //             being evaluated). See spec.
  function evaluateInsomniacForNight(sleepHours, nightDate) {
    if (typeof sleepHours !== 'number' || !nightDate) return;
    const id = 'the_insomniac';
    const cfg = BOSSES[id];
    const state = getBossState(id);

    // Already evaluated this night — idempotent.
    if (state.last_eval_date === nightDate) return;

    // v2.0.1 engagement gate — habit data still flows to leaderboard
    // and habit auto-verify, but boss progress only advances for
    // engaged bosses. User opts in via the ENGAGE BOSS button on the
    // detail modal.
    if (state.engaged !== true) return;

    if (sleepHours >= cfg.sleepHours) {
      state.streak += 1;
      state.last_eval_date = nightDate;
      if (state.streak >= cfg.streakTarget) {
        state.kill_count += 1;
        state.streak = 0;
        setBossState(id, state);
        // v2.0.1: kill grants tier-scaled souls. Earn happens here so
        // the toast message can include the actual amount awarded.
        const reward = killRewardSouls(cfg.rank);
        if (reward > 0) earnSouls(reward, 'kill_' + id);
        // v2.0.1 DROPS: roll for a card drop. May return null (~70%
        // standard rate, less during first-common protection).
        const dropped = rollBossDrop(id);
        announceKillAndDrop(cfg, reward, dropped);
        // Re-render the Quests panel so the streak progress + kill
        // count update if user is currently looking at it.
        try { if (currentTab === 'quests') renderBossesPanel(); } catch (_) {}
        return;
      }
      setBossState(id, state);
    } else {
      // Sub-threshold sleep — break the streak. Still record the date
      // so we don't double-process this night.
      state.streak = 0;
      state.last_eval_date = nightDate;
      setBossState(id, state);
    }
    // Re-render Quests panel for streak progress visibility.
    try { if (currentTab === 'quests') renderBossesPanel(); } catch (_) {}
  }

  // Init-time missed-night detection. If the user skipped opening the
  // app for a calendar day or more, we reset the streak — a missing
  // night isn't a successful one, so the streak shouldn't survive.
  // last_eval_date is set to yesterday so tonight's evaluation can
  // still proceed (an eval for "today" remains valid).
  //
  // Only fires from init() per spec — visibilitychange would
  // mis-trigger on multi-foreground days.
  function checkMissedNightForInsomniac() {
    const id = 'the_insomniac';
    const state = getBossState(id);
    // Engagement gate — no point resetting streak on a boss the
    // user isn't hunting. The streak field is already 0 for
    // disengaged bosses (disengageBoss zeroes it).
    if (state.engaged !== true) return;
    // First install — never been evaluated. Don't treat as missed.
    if (!state.last_eval_date) return;

    const yesterday = getDeviceLocalYesterday();
    // last_eval_date strictly older than yesterday = at least one
    // calendar day was skipped → reset.
    if (state.last_eval_date < yesterday) {
      state.streak = 0;
      state.last_eval_date = yesterday;
      setBossState(id, state);
    }
  }

  // ── Carouser kill-detection ──────────────────────────────────
  // Weekend-only boss. Evaluates one weekend night per call (Fri, Sat,
  // or Sun nights — identified by the morning that follows them: Sat,
  // Sun, or Mon device-local). Streak target = 3, all within the same
  // weekend (anchored by the most-recent-Friday date). Any single failed
  // night burns the weekend — `weekend_burned: true` prevents stale
  // streak progress on subsequent same-weekend nights.
  //
  // State shape (extends base):
  //   { streak, kill_count, last_eval_date, current_weekend_id, weekend_burned }
  //
  // Idempotent on nightDate. Pass condition: sleepHours ≥ 7 AND
  // bedtimeBeforeMidnight === true. The bedtime boolean comes from
  // getBedtimeSamplesInWindow(samples).length > 0 — same source-of-truth
  // as the Sleep-before-midnight habit auto-verify.
  function getCarouserState() {
    const base = getBossState('the_carouser');
    if (typeof base.current_weekend_id === 'undefined') base.current_weekend_id = null;
    if (typeof base.weekend_burned === 'undefined') base.weekend_burned = false;
    return base;
  }

  function evaluateCarouserForNight(sleepHours, bedtimeBeforeMidnight, nightDate) {
    if (typeof sleepHours !== 'number' || !nightDate) return;
    const id = 'the_carouser';
    const cfg = BOSSES[id];
    if (!cfg) return;
    const state = getCarouserState();

    // Idempotent on nightDate — visibility-change refires no-op.
    if (state.last_eval_date === nightDate) return;

    // v2.0.1 engagement gate — same rule as the other bosses.
    if (state.engaged !== true) return;

    // Classify the night by its start day-of-week. nightDate is the
    // morning the user is in; the night being evaluated STARTED the
    // prior day. Sat morning → Fri night; Sun morning → Sat night.
    // Only those two mornings count — Sunday night (Mon morning, dow=1)
    // is intentionally ignored. The 2-night recalibration dropped Sunday
    // entirely from the Carouser eval; Sunday sleep data is irrelevant
    // for this boss now.
    const todayDate = new Date(nightDate + 'T00:00:00');
    const todayDow = todayDate.getDay();
    const isWeekendMorning = (todayDow === 6 || todayDow === 0);
    if (!isWeekendMorning) return;

    const weekendId = getMostRecentFridayDate();

    // New weekend → fresh slate.
    if (state.current_weekend_id !== weekendId) {
      state.current_weekend_id = weekendId;
      state.streak = 0;
      state.weekend_burned = false;
    }

    // Weekend already burned — record the date but skip eval. A failed
    // night earlier in the weekend means the streak is dead; later
    // nights this weekend can't revive it.
    if (state.weekend_burned) {
      state.last_eval_date = nightDate;
      setBossState(id, state);
      return;
    }

    const passed = (sleepHours >= cfg.sleepHours) && (bedtimeBeforeMidnight === true);
    if (passed) {
      state.streak += 1;
      state.last_eval_date = nightDate;
      if (state.streak >= cfg.streakTarget) {
        state.kill_count += 1;
        state.streak = 0;
        state.weekend_burned = false;
        setBossState(id, state);
        const reward = killRewardSouls(cfg.rank);
        if (reward > 0) earnSouls(reward, 'kill_' + id);
        const dropped = rollBossDrop(id);
        announceKillAndDrop(cfg, reward, dropped);
        try { if (currentTab === 'quests') renderBossesPanel(); } catch (_) {}
        return;
      }
      setBossState(id, state);
    } else {
      state.streak = 0;
      state.weekend_burned = true;
      state.last_eval_date = nightDate;
      setBossState(id, state);
    }
    try { if (currentTab === 'quests') renderBossesPanel(); } catch (_) {}
  }

  // Init-time: if state references a past weekend, clear stale streak
  // progress. Without this, a user who hit streak=2 last weekend and
  // didn't open the app on Sun/Mon morning would see a stale "2/3"
  // until the next weekend's first eval. kill_count is preserved.
  function checkMissedWeekendForCarouser() {
    const id = 'the_carouser';
    const state = getCarouserState();
    // Engagement gate — disengaged bosses already have cleared
    // weekend state, no work to do.
    if (state.engaged !== true) return;
    if (!state.current_weekend_id) return;
    const todayWeekendId = getMostRecentFridayDate();
    if (state.current_weekend_id !== todayWeekendId) {
      state.streak = 0;
      state.weekend_burned = false;
      state.current_weekend_id = null;
      setBossState(id, state);
    }
  }

  // ── Steel Wolf kill-detection (v2.0.1, D-rank) ───────────────
  // Daily-cadence boss. Eval fires from autoVerifySleep's sibling
  // path — autoVerifyWalk — using the same step count fetched for
  // the Daily walk habit + leaderboard recording. No extra HealthKit
  // call. Mirrors Insomniac's structure exactly: idempotent on
  // dayDate, runtime missed-day reset, init-time missed-day reset.
  //
  // Field naming: cfg.stepThreshold (5000) — semantic-specific name
  // parallel to Insomniac's cfg.sleepHours. NOT a generic
  // `threshold` field; if a future generalization is wanted, refactor
  // all three bosses together.
  function evaluateSteelWolfForDay(stepCount, dayDate) {
    if (typeof stepCount !== 'number' || !dayDate) return;
    const id = 'the_steel_wolf';
    const cfg = BOSSES[id];
    if (!cfg) return;
    const state = getBossState(id);

    // Idempotent on dayDate — multiple calls in the same day no-op.
    if (state.last_eval_date === dayDate) return;

    // v2.0.1 engagement gate — same rule as the other bosses.
    if (state.engaged !== true) return;

    // Runtime missed-day reset: if the user opens the app after
    // skipping at least one calendar day (last_eval_date older than
    // yesterday-from-dayDate), the streak is dead before today's
    // eval. A missing day isn't a successful one. First-install
    // (null last_eval_date) skips this — fresh start.
    if (state.last_eval_date) {
      const d = new Date(dayDate + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      const yesterdayFromDay = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      if (state.last_eval_date < yesterdayFromDay) {
        state.streak = 0;
      }
    }

    if (stepCount >= cfg.stepThreshold) {
      state.streak += 1;
      state.last_eval_date = dayDate;
      if (state.streak >= cfg.streakTarget) {
        state.kill_count += 1;
        state.streak = 0;
        setBossState(id, state);
        const reward = killRewardSouls(cfg.rank);
        if (reward > 0) earnSouls(reward, 'kill_' + id);
        const dropped = rollBossDrop(id);
        announceKillAndDrop(cfg, reward, dropped);
        try { if (currentTab === 'quests') renderBossesPanel(); } catch (_) {}
        return;
      }
      setBossState(id, state);
    } else {
      // Sub-threshold steps — break the streak. Record the date so
      // we don't double-process this day.
      state.streak = 0;
      state.last_eval_date = dayDate;
      setBossState(id, state);
    }
    try { if (currentTab === 'quests') renderBossesPanel(); } catch (_) {}
  }

  // Init-time missed-day check. Mirrors checkMissedNightForInsomniac
  // — runs once per cold launch, resets streak if last_eval_date is
  // older than yesterday. Covers the case where a user opens the app
  // after a multi-day absence and the eval doesn't fire because they
  // have no walk habit configured (the runtime reset inside the
  // evaluator only triggers if the eval actually runs).
  function checkMissedDayForSteelWolf() {
    const id = 'the_steel_wolf';
    const state = getBossState(id);
    // Engagement gate — disengaged bosses are already at streak 0.
    if (state.engaged !== true) return;
    if (!state.last_eval_date) return; // first install — leave alone
    const yesterday = getDeviceLocalYesterday();
    if (state.last_eval_date < yesterday) {
      state.streak = 0;
      state.last_eval_date = yesterday;
      setBossState(id, state);
    }
  }

  try {
    window.Bosses = {
      BOSSES, getBossState,
      evaluateInsomniacForNight, checkMissedNightForInsomniac,
      evaluateCarouserForNight,  checkMissedWeekendForCarouser,
      evaluateSteelWolfForDay,   checkMissedDayForSteelWolf,
      // Engagement model (v2.0.1) — opt-in gate for boss eval.
      engageBoss, disengageBoss, isBossEngaged, countEngagedBosses,
      MAX_ENGAGED_BOSSES,
    };
  } catch (_) {}

  // ── LEADERBOARD STATS (v2.0.2 accumulator, v2.1 live) ────────
  // Local accumulator for the three Apple-Health-verifiable metrics.
  // v2.0.2 shipped the silent tracking layer; v2.1 Phase C (commit
  // 7c5ada9) wired it to the live backend — values flow to
  // /v1/leaderboard/submit on app open + visibility change, and
  // ranking sheets fetch /v1/leaderboard/top with stale-while-
  // revalidate caching.
  //
  // Three Apple-Health-verifiable metrics — chosen because they cannot
  // be self-reported / gamed, which is the only honest basis for a
  // competitive leaderboard:
  //   1. Steps totaled in the last 7 days (rolling sum)
  //   2. Best streak of consecutive nights with sleep ≥ 7 hours
  //   3. Best streak of consecutive nights with bedtime before midnight
  //
  // "Best" = all-time peak, preserved separately from the running
  // current_* counters so a streak-break doesn't erase the user's
  // historical record. The current_* counters drive future "live"
  // leaderboard slots; the best_* counters drive "lifetime" slots.
  //
  // Independence: like bosses, this runs on raw HealthKit data and
  // IGNORES the Settings → Apple Health pause toggle. The pause is
  // scoped to habit auto-verify only — bosses and leaderboard stats
  // accumulate passively. A user who pauses habit auto-verify still
  // gets leaderboard credit. (If we want a privacy-style master kill
  // switch later, it should be a SEPARATE toggle, not this one.)
  //
  // Privacy: every stored field is local-only via localStorage. When
  // the leaderboard ships, only the explicit-opt-in subset will be
  // transmitted. No network calls happen here.
  //
  // Date semantics: device-local time, same as bosses + sleep windows
  // (CLAUDE.md: notifications + sleep + leaderboard use device-local;
  // streak math for habits uses PT). 'YYYY-MM-DD' keys throughout.
  const LB_DAILY_RETENTION_DAYS = 30;
  const LB_STORAGE_KEY = 'hb_leaderboard';
  const LB_SLEEP_HOURS_THRESHOLD = 7; // matches Insomniac's kill condition

  function loadLeaderboardState() {
    try {
      const raw = JSON.parse(localStorage.getItem(LB_STORAGE_KEY) || '{}');
      return {
        steps_daily:               raw.steps_daily               || {},
        sleep_hours_daily:         raw.sleep_hours_daily         || {},
        bedtime_daily:             raw.bedtime_daily             || {},
        current_sleep_streak:      raw.current_sleep_streak      || 0,
        best_sleep_streak:         raw.best_sleep_streak         || 0,
        last_sleep_eval_date:      raw.last_sleep_eval_date      || null,
        current_bedtime_streak:    raw.current_bedtime_streak    || 0,
        best_bedtime_streak:       raw.best_bedtime_streak       || 0,
        last_bedtime_eval_date:    raw.last_bedtime_eval_date    || null,
        best_7day_step_total:      raw.best_7day_step_total      || 0,
        best_7day_step_window_end: raw.best_7day_step_window_end || null,
      };
    } catch (_) {
      return {
        steps_daily: {}, sleep_hours_daily: {}, bedtime_daily: {},
        current_sleep_streak: 0, best_sleep_streak: 0, last_sleep_eval_date: null,
        current_bedtime_streak: 0, best_bedtime_streak: 0, last_bedtime_eval_date: null,
        best_7day_step_total: 0, best_7day_step_window_end: null,
      };
    }
  }

  function saveLeaderboardState(state) {
    try { localStorage.setItem(LB_STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  // Returns the device-local date 'YYYY-MM-DD' for (dateStr - 1 day).
  // Used by gap detection — a streak only continues if today's eval
  // date follows yesterday's eval date. Skipped nights = gap = reset.
  function lbPrevDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // Sums the step_daily entries from the most-recent Sunday 00:00
  // (device-local) through today inclusive — the calendar-week
  // window for the leaderboard. Resets every Sunday automatically:
  // on Sunday, the loop runs exactly once and returns Sunday's
  // count. By Saturday, the loop runs 7 times. This replaced the
  // earlier "trailing 7 days inclusive of today" rolling window
  // — leaderboard is now a weekly competition that resets globally
  // each Sunday at midnight in each user's local time.
  function lbSumCurrentWeekSteps(stepsDaily) {
    const today = new Date();
    const todayDow = today.getDay(); // 0=Sun, 6=Sat
    let sum = 0;
    let dateStr = getDeviceLocalDate();
    // Walk back todayDow + 1 days: today + every day since Sunday.
    // todayDow=0 (Sunday) → loop once. todayDow=6 (Saturday) → loop
    // 7 times.
    for (let i = 0; i <= todayDow; i++) {
      sum += (stepsDaily[dateStr] || 0);
      dateStr = lbPrevDate(dateStr);
    }
    return sum;
  }

  // Drop entries older than retention window from a date-keyed map.
  // Keeps localStorage lean — the calendar-week step sum only needs
  // the last 7 entries, but we keep 30 for future "best week of
  // last 30 days"-style slots.
  function lbPruneDailyMap(map, retentionDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.getFullYear() + '-' +
      String(cutoff.getMonth() + 1).padStart(2, '0') + '-' +
      String(cutoff.getDate()).padStart(2, '0');
    for (const k in map) {
      if (k < cutoffStr) delete map[k];
    }
  }

  // Step recording. Idempotent in the sense that re-calling with a
  // higher number for the same day overwrites (HealthKit step counts
  // can backfill upward as the day progresses; we want the latest
  // figure). Best peak is updated whenever the current-week running
  // sum exceeds the stored historical best. The field name is kept
  // as `best_7day_step_total` to avoid a localStorage migration —
  // semantics are now "best calendar-week sum (Sun→Sat) ever."
  function lbRecordStepsToday(steps) {
    if (typeof steps !== 'number' || !Number.isFinite(steps) || steps < 0) return;
    const state = loadLeaderboardState();
    const today = getDeviceLocalDate();
    state.steps_daily[today] = Math.round(steps);
    lbPruneDailyMap(state.steps_daily, LB_DAILY_RETENTION_DAYS);

    const weekSum = lbSumCurrentWeekSteps(state.steps_daily);
    if (weekSum > state.best_7day_step_total) {
      state.best_7day_step_total = weekSum;
      state.best_7day_step_window_end = today;
    }
    saveLeaderboardState(state);
  }

  // Sleep recording — both metrics (hours + bedtime) in one call,
  // since they come from the same Health.getSleepLastNight() roundtrip.
  // Each metric tracks independently and is idempotent on nightDate.
  //
  // Streak gap rule: if last_*_eval_date is set AND not equal to
  // (nightDate - 1 day), the streak is dead before tonight's eval
  // (a missed night = no qualifying entry = break). Tonight's outcome
  // then determines whether streak starts fresh at 1 or stays at 0.
  function lbRecordSleepNight(sleepHours, bedtimeBeforeMidnight, nightDate) {
    if (!nightDate) return;
    const state = loadLeaderboardState();
    let mutated = false;

    // ── Sleep hours ─────────────────────────────────────────
    if (typeof sleepHours === 'number' && Number.isFinite(sleepHours) && sleepHours >= 0) {
      state.sleep_hours_daily[nightDate] = Number(sleepHours.toFixed(2));
      lbPruneDailyMap(state.sleep_hours_daily, LB_DAILY_RETENTION_DAYS);
      mutated = true;

      if (state.last_sleep_eval_date !== nightDate) {
        const prev = lbPrevDate(nightDate);
        if (state.last_sleep_eval_date && state.last_sleep_eval_date !== prev) {
          state.current_sleep_streak = 0;
        }
        if (sleepHours >= LB_SLEEP_HOURS_THRESHOLD) {
          state.current_sleep_streak += 1;
          if (state.current_sleep_streak > state.best_sleep_streak) {
            state.best_sleep_streak = state.current_sleep_streak;
          }
        } else {
          state.current_sleep_streak = 0;
        }
        state.last_sleep_eval_date = nightDate;
      }
    }

    // ── Bedtime before midnight ─────────────────────────────
    if (typeof bedtimeBeforeMidnight === 'boolean') {
      state.bedtime_daily[nightDate] = bedtimeBeforeMidnight;
      lbPruneDailyMap(state.bedtime_daily, LB_DAILY_RETENTION_DAYS);
      mutated = true;

      if (state.last_bedtime_eval_date !== nightDate) {
        const prev = lbPrevDate(nightDate);
        if (state.last_bedtime_eval_date && state.last_bedtime_eval_date !== prev) {
          state.current_bedtime_streak = 0;
        }
        if (bedtimeBeforeMidnight === true) {
          state.current_bedtime_streak += 1;
          if (state.current_bedtime_streak > state.best_bedtime_streak) {
            state.best_bedtime_streak = state.current_bedtime_streak;
          }
        } else {
          state.current_bedtime_streak = 0;
        }
        state.last_bedtime_eval_date = nightDate;
      }
    }

    if (mutated) saveLeaderboardState(state);
  }

  // Read-only snapshot for UI + leaderboard submit. Computes the
  // current-week step sum on demand (Sunday 00:00 → today inclusive,
  // resets every Sunday at device-local midnight). The field name
  // `steps_last_7_days` is kept for callsite compatibility — its
  // semantics are now "current calendar-week step total."
  function lbGetSnapshot() {
    const state = loadLeaderboardState();
    return {
      steps_last_7_days:         lbSumCurrentWeekSteps(state.steps_daily),
      best_7day_step_total:      state.best_7day_step_total,
      best_7day_step_window_end: state.best_7day_step_window_end,
      current_sleep_streak:      state.current_sleep_streak,
      best_sleep_streak:         state.best_sleep_streak,
      current_bedtime_streak:    state.current_bedtime_streak,
      best_bedtime_streak:       state.best_bedtime_streak,
    };
  }

  try {
    window.Leaderboard = {
      getSnapshot:      lbGetSnapshot,
      recordStepsToday: lbRecordStepsToday,
      recordSleepNight: lbRecordSleepNight,
      _state:           loadLeaderboardState, // dev-only: full raw state
    };
  } catch (_) {}

  // ── v2.1.0 Phase C — submission orchestration ───────────────
  // Pushes the user's current metric snapshot to the backend so the
  // leaderboard can rank them. Fires three POSTs in parallel:
  //   step_total      ← snap.steps_last_7_days
  //   sleep_streak    ← snap.current_sleep_streak
  //   bedtime_streak  ← snap.current_bedtime_streak
  // Each value is validated as a non-negative integer and clamped to
  // a sane client-side cap (the backend has its own validation; the
  // cap here just prevents accidental overflow from a corrupt local
  // state).
  const LB_CLIENT_CAPS = {
    step_total:     200000,  // 200k steps in 7 days — far beyond any human
    sleep_streak:   365,
    bedtime_streak: 365,
  };
  function lbSanitizeValue(metric, raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    const cap = LB_CLIENT_CAPS[metric] || 0;
    return Math.min(Math.floor(n), cap);
  }
  async function lbSubmitAllMetrics() {
    try {
      if (typeof window.Auth === 'undefined' ||
          typeof window.Auth.submitLeaderboardSnapshot !== 'function') {
        return;
      }
      const snap = lbGetSnapshot();
      const metrics = [
        ['step_total',     snap.steps_last_7_days],
        ['sleep_streak',   snap.current_sleep_streak],
        ['bedtime_streak', snap.current_bedtime_streak],
      ];
      await Promise.all(metrics.map(([m, v]) =>
        window.Auth.submitLeaderboardSnapshot(m, lbSanitizeValue(m, v))
          .catch(() => null) // never let a single failure poison the others
      ));
    } catch (_) {}
  }

  // 5-minute debounce so backgrounding and re-foregrounding the app
  // doesn't hammer the backend. The flag is written BEFORE the
  // submit fires so two near-simultaneous visibility events still
  // only result in one network roundtrip.
  const LB_SUBMIT_DEBOUNCE_MS = 5 * 60 * 1000;
  function lbSubmitAllMetricsDebounced() {
    try {
      const lastStr = localStorage.getItem('hb_lb_last_submit');
      const last    = lastStr ? parseInt(lastStr, 10) : 0;
      if (Number.isFinite(last) && (Date.now() - last) < LB_SUBMIT_DEBOUNCE_MS) {
        return;
      }
      localStorage.setItem('hb_lb_last_submit', String(Date.now()));
      lbSubmitAllMetrics();
    } catch (_) {}
  }
  try {
    window.Leaderboard.submitAllMetrics          = lbSubmitAllMetrics;
    window.Leaderboard.submitAllMetricsDebounced = lbSubmitAllMetricsDebounced;
  } catch (_) {}

  function getSleepGoalHours(habit) {
    if (!habit) return HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
    const n = parseFloat(habit.sleepGoalHours);
    if (Number.isFinite(n) && n >= HEALTHKIT_SLEEP_GOAL_MIN_HOURS && n <= HEALTHKIT_SLEEP_GOAL_MAX_HOURS) {
      return n;
    }
    return HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
  }
  function setSleepGoalHours(habit, hours) {
    if (!habit) return HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
    const parsed = parseFloat(hours);
    const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
    const n = Math.max(HEALTHKIT_SLEEP_GOAL_MIN_HOURS, Math.min(HEALTHKIT_SLEEP_GOAL_MAX_HOURS, fallback));
    habit.sleepGoalHours = n;
    save();
    return n;
  }
  // Habits whose canonical goal is hours of sleep. Replaces the time
  // stepper in Edit Habit modal with chips, like Daily walk did for
  // steps. Custom habits never qualify (foreign-key uniqueness).
  function isSleepDurationHabit(habit) {
    if (!habit) return false;
    if (habit.custom) return false;
    if (habit.name !== 'Sleep') return false;
    return true;
  }
  // Binary auto-verify habit (no goal control). Identifies the canonical
  // "Sleep before midnight" habit so its row in the Edit modal stays
  // goal-less and so meetsMinimum() can short-circuit it.
  function isSleepBedtimeHabit(habit) {
    if (!habit) return false;
    if (habit.custom) return false;
    if (habit.name !== 'Sleep before midnight') return false;
    return true;
  }
  // Single gate that aggregates all habits with HealthKit auto-verify.
  // Used by meetsMinimum() to bypass the legacy MEASURABLE_HABITS minimum
  // check — these habits source their goal (or lack thereof) from new
  // per-habit fields, not the `habit.goal` shape.
  function isHealthAutoVerifiableHabit(habit) {
    return isStepGoalHabit(habit) || isSleepDurationHabit(habit) || isSleepBedtimeHabit(habit);
  }

  // Stable partition: auto-verifiable habits to the front, everything
  // else preserves its existing relative order. Mutates the array in
  // place. v2.0 — keeps Daily walk / Sleep / Sleep before midnight at
  // the top of the Habits tab so the system-managed layer reads first
  // and the user's own discipline list reads after.
  //
  // Drag-to-reorder consequence: dragging a non-auto-verify habit
  // above the partition causes a visible "snap back" on the next
  // render. That's intended — it enforces the invariant visibly.
  // Drags within the same partition (auto-verify reorder amongst
  // themselves, custom reorder amongst themselves) work normally.
  function sortHabitsAutoVerifyFirst(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return;
    const auto = [];
    const rest = [];
    for (const h of arr) {
      if (isHealthAutoVerifiableHabit(h)) auto.push(h);
      else                                 rest.push(h);
    }
    // Reassign in place so any external references to `habits` keep
    // pointing at the same array.
    arr.length = 0;
    arr.push(...auto, ...rest);
  }
  // True only when ALL pre-conditions for live auto-verify are met:
  // the habit qualifies (canonical Daily walk / Sleep / Sleep before
  // midnight), HealthKit is available, permission granted, and the
  // user hasn't paused auto-verify in Settings. Used by the Morning
  // Briefing card to decide whether to show the "Apple Health verifies"
  // tag on a row — and by the status-line composer to count how many
  // of today's objectives are system-verified vs. on the user.
  function canAutoVerify(habit) {
    if (!isHealthAutoVerifiableHabit(habit)) return false;
    if (typeof Health === 'undefined' || !Health.isAvailable()) return false;
    if (Health.permissionStatus() !== 'granted') return false;
    if (isAutoVerifyDisabled()) return false;
    return true;
  }
  // True for habits whose name + emoji are baked into DEFAULT_HABITS
  // (the canonical library). The Edit Habit modal locks name + emoji
  // editing for these because habit.name is the foreign key for
  // HABIT_ICONS, AUTO_VERIFY mapping, HABIT_TIME_OF_DAY grouping, and
  // every per-name lookup in the app. Renaming a canonical habit
  // silently breaks all of those. Custom habits never qualify — their
  // name + emoji are user-defined by definition. (v1.1.6)
  function isCanonicalHabit(habit) {
    if (!habit) return false;
    if (habit.custom) return false;
    return DEFAULT_HABITS.some(d => d.name === habit.name);
  }

  // Read-only system-managed habits — Apple Health is the SOLE authority,
  // user cannot manually toggle. Tapping the card opens the Notes modal
  // with a system-message explainer instead of toggling check state.
  // Auto-verify still fires normally; this just locks out manual override.
  //
  // v2.0 policy shift: ALL three HealthKit-auto-verifiable habits are
  // now read-only — Daily walk, Sleep, and Sleep before midnight. The
  // earlier v1.1.5 carve-out where Daily walk and Sleep allowed manual
  // completion as fallback is gone. Reasoning: the "system is honest"
  // framing applies uniformly. Mixed manual+auto creates ambiguity:
  // did the user actually walk 3,000 steps, or just tap the box? With
  // the lock, the answer is always "the data shows yes, or it stays
  // unchecked." Cleaner discipline contract, even if it means
  // streaks become impossible without Apple Health connected.
  //
  // Implications for users without HealthKit (web/PWA, denied perm,
  // paused via Settings): these habits CANNOT be checked off. They
  // stay unchecked. The Notes modal explainer surfaces this to the
  // user when they tap the card. Add a habit you can actually
  // complete is the answer — which is on the user, not the system.
  //
  // The AUTO_VERIFY.markUnchecked path (toggleHabit's un-check guard)
  // becomes vestigial for these habits — there's no manual un-check
  // route. Keep the code; it's harmless and protects against any
  // future programmatic toggle path that might be added.
  function isReadOnlyAutoVerifyHabit(habit) {
    if (!habit) return false;
    if (habit.custom) return false;
    return habit.name === 'Daily walk'
        || habit.name === 'Sleep'
        || habit.name === 'Sleep before midnight';
  }

  // Per-habit "SYSTEM-MANAGED" body copy shown in the Notes modal
  // when a read-only auto-verify habit is tapped. Voice: tough-love,
  // declarative, anchored in the data ("the body keeps the score" /
  // "the data shows you walked"). The third paragraph is identical
  // across all three — the "no Apple Health, stays unchecked" rule.
  // Returns an HTML string with the same structure (3 <p> tags) so
  // the modal layout stays consistent regardless of which habit
  // opened it.
  function systemManagedHtmlFor(habit) {
    const lead = '<p><strong>This habit is verified by Apple Health.</strong></p>';
    const tail = "<p>If Apple Health isn't connected or has no data, the habit stays unchecked. Manual completion isn't available for this one.</p>";
    let middle;
    switch (habit && habit.name) {
      case 'Daily walk':
        middle = "<p>Awakened auto-checks Daily walk when Apple Health shows you've reached your step goal today. There's no manual override — either the steps are there, or the box stays empty. Walk the steps.</p>";
        break;
      case 'Sleep':
        middle = "<p>Awakened auto-checks Sleep when Apple Health shows you've slept your goal hours last night. There's no manual override — either you slept, or you didn't. The body keeps the score.</p>";
        break;
      case 'Sleep before midnight':
        middle = "<p>Awakened auto-checks Sleep before midnight when your sleep data shows you fell asleep before 12 AM. There's no manual override — your bedtime is what it is. The system is honest with you, even when you might not want to be honest with yourself.</p>";
        break;
      default:
        middle = '<p>Awakened auto-checks this habit when Apple Health verifies the conditions. Manual completion is not available.</p>';
    }
    return lead + middle + tail;
  }

  function getHabitStepGoal(habit) {
    if (!habit) return HEALTHKIT_WALK_DEFAULT_THRESHOLD;
    const n = parseInt(habit.stepGoal, 10);
    if (Number.isFinite(n) && n >= HEALTHKIT_WALK_THRESHOLD_MIN && n <= HEALTHKIT_WALK_THRESHOLD_MAX) {
      return n;
    }
    return HEALTHKIT_WALK_DEFAULT_THRESHOLD;
  }
  function setHabitStepGoal(habit, steps) {
    if (!habit) return HEALTHKIT_WALK_DEFAULT_THRESHOLD;
    const parsed = parseInt(steps, 10);
    const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_WALK_DEFAULT_THRESHOLD;
    const n = Math.max(HEALTHKIT_WALK_THRESHOLD_MIN, Math.min(HEALTHKIT_WALK_THRESHOLD_MAX, fallback));
    habit.stepGoal = n;
    save();
    return n;
  }
  // True for habits whose canonical goal is expressed in steps rather
  // than time/count. The step-goal control replaces the time/count
  // stepper in the Edit Habit modal for these habits — on every
  // platform. (Auto-verify only fires on iOS, but the goal itself is
  // a property of the habit, not contingent on HealthKit being
  // currently available.) Custom habits never qualify, even if a user
  // names theirs "Daily walk" — the canonical foreign key is exclusive
  // to the system-defined habit.
  function isStepGoalHabit(habit) {
    if (!habit) return false;
    if (habit.custom) return false;
    if (habit.name !== 'Daily walk') return false;
    return true;
  }
  function isAutoVerifyDisabled() {
    return localStorage.getItem('hb_healthkit_disabled') === '1';
  }
  function setAutoVerifyDisabled(disabled) {
    if (disabled) localStorage.setItem('hb_healthkit_disabled', '1');
    else          localStorage.removeItem('hb_healthkit_disabled');
  }

  // ── WHAT'S NEW ───────────────────────────────────────────
  // Version-keyed announcements. The What's New sheet always displays
  // the highest version's content; future releases just add a new key.
  const WHATS_NEW = {
    // WHATS_NEW items are ordered BY SIGNIFICANCE (most impactful first),
    // NOT chronologically by when the work shipped during the version's
    // dev cycle. Net-new behaviors and features the user encounters
    // every day rank highest; configuration polish and settings-layer
    // additions rank lowest. Future maintainers: re-sort when you add
    // items, don't just append.
    '2.1.0': {
      subtitle: 'Sign in & global rankings.',
      items: [
        { emoji: '', title: 'Sign in with Apple',         description: "Claim your hunter identity. One-tap sign-in, no passwords. Your alias appears on the global leaderboard." },
        { emoji: '', title: 'Cloud backend live',         description: "Awakened's backend is online. Your stats sync to the cloud and the leaderboard activates over the coming releases." },
        { emoji: '', title: 'Account in Settings',        description: "Settings → Account: see your hunter identity, sign out, or delete your account entirely. Local habit data stays on-device when you sign out." },
        { emoji: '', title: 'Localhost dev bypass',       description: "Developer-only: the mandatory sign-in gate auto-creates a DevUser on localhost so the local dev workflow isn't blocked. iOS users still hit the real gate as designed." },
      ],
    },
    '2.0.2': {
      subtitle: 'The dungeons open.',
      items: [
        { emoji: '', title: 'Drops!',                          description: "Defeat dungeon bosses to collect cards. Some kills drop items — rare and ultra-rare pulls trigger a cinematic reveal. Check the Items tab for your collection." },
        { emoji: '', title: 'Drop rates tuned',                description: "The bottom rarity tier is now Common — and what was once uncommon is dropping more often. Rare and Ultra-Rare remain elusive." },
        { emoji: '', title: 'Weekly bosses drop better',       description: "Weekly bosses now drop better per kill. Cadence-adjusted rates mean fewer attempts shouldn't mean fewer rewards." },
        { emoji: '', title: 'Mid-day check-in',                description: "A 1 PM nudge if you haven't claimed today's souls or have a streak at risk. Evening reminder shifted from 6 PM to 7 PM." },
        { emoji: '', title: 'Rank scaling overhauled',         description: "Reach S rank with ~6 months of daily Locked-In pack completion. Boss engagement accelerates the climb but isn't required. Existing XP balances recalibrated to the new curve — your rank is preserved." },
        { emoji: '', title: 'Sleep duration > bedtime',        description: "Morning Routine and Locked-In packs now require Sleep (7+ hours) instead of Sleep before midnight. Total sleep is what the body actually needs. If your habit list still has Sleep before midnight, add Sleep to keep your compound streak rolling." },
        { emoji: '', title: 'Souls currency introduced',       description: "Earn 15 souls daily plus tier-scaled rewards on every boss kill. Spend souls to engage bosses (E rank costs 25, doubles per tier). Hunt wisely — souls are not refunded on disengage. Tap the souls badge in the header to see how to earn and spend them." },
        { emoji: '', title: 'Bosses now require engagement',   description: "Open a boss to start hunting it — you can hunt up to 3 at once. Habits only progress bosses you've engaged. Stop hunting any time; your streak resets but your kills stay." },
        { emoji: '', title: 'Preview locked dungeons',         description: "Locked-rank dungeons are now walkable when there's content inside. Preview future bosses, engage them once you reach the rank." },
        { emoji: '', title: 'Six dungeon gates',               description: "The Quests tab is now a 3×2 grid of rank-tier dungeon gates — E, D, C, B, A, S. Tap the E-rank gate to enter and meet your bosses. The other five stay locked until you climb. Each one is its own dungeon waiting for you." },
        { emoji: '', title: 'Boss cards, redesigned',          description: "Every boss is now a portrait card with its own art, stats, kill condition, and live progress. Tap a card to open the full detail view." },
        { emoji: '', title: 'The Insomniac',                   description: "First dungeon boss. Found inside the E-rank dungeon. Sleep 7+ hours, two nights in a row, to defeat it." },
        { emoji: '', title: 'The Carouser',                    description: "Second dungeon boss. Two clean weekend nights — Friday and Saturday — sleep 7+ hours and bed before midnight on both. Miss either, and the streak resets next weekend. Designed for weekend discipline." },
        { emoji: '', title: 'The Steel Wolf',                  description: "Third dungeon boss. Sits behind the D-rank gate. Walk 5,000+ steps for 2 days in a row to defeat it once D-rank unlocks." },
        { emoji: '', title: 'E-rank bosses recalibrated',      description: "Easier entry. The Insomniac and The Carouser now require 2-night streaks instead of 3 — entry-tier bosses should welcome you in, not gatekeep. Higher ranks will scale up." },
        { emoji: '', title: 'System-verified habits',          description: "Daily walk, Sleep, and Sleep before midnight are now system-managed. Apple Health is the sole authority — no manual override. Either the data shows you did it, or the box stays empty. The discipline is honest." },
        { emoji: '', title: 'Auto-verify on top',              description: "Apple Health-verified habits sort to the top of your list automatically. The system layer reads first; your own discipline list reads after." },
        { emoji: '', title: 'Leaderboard groundwork',          description: "The Social tab now tracks three Apple Health-verifiable stats: 7-day step total, longest 7+ hour sleep streak, and longest before-midnight bedtime streak. Competitive layer ships later — but your history starts building today." },
        { emoji: '', title: 'Daily Quest retired',             description: "The Daily Legendary Mission card has been removed. The Quests tab is dungeons-only now — focused, passive, system-verified." },
        { emoji: '', title: 'Schedule, untangled',             description: "Schedule and Reminder are now visibly separate sections on the Schedule sheet. Pick days for when the habit appears in your list; pick a time for when you want a reminder. Independent." },
        { emoji: '', title: 'Reminder, where it belongs',      description: "Per-habit reminders live on the Schedule sheet (⋯ → Schedule). The Edit Habit modal shows your current reminder time as a read-only display so you always see what's set." },
        { emoji: '', title: 'Canonical habits stay canonical', description: "The 49 built-in habits now lock their name + emoji in the Edit Habit modal. Customize your own habits; leave the system's intact. (Custom habits remain fully editable.)" },
      ],
    },
    '1.1.5': {
      subtitle: 'The system is watching now.',
      items: [
        { emoji: '', title: 'Morning Briefing',        description: "Open the app each morning to your day's full slate — every habit, every objective, every XP reward. The system tells you what's on you and what it has covered." },
        { emoji: '', title: 'Walk Auto-Verifies',      description: 'Daily walk auto-verifies via Apple Health when you reach your step goal. No tap needed.' },
        { emoji: '', title: 'Sleep Auto-Verifies',     description: 'Hit your sleep goal? Apple Health verifies it. Edit your Sleep habit to choose how many hours.' },
        { emoji: '', title: 'Bedtime Auto-Verifies',   description: 'Asleep before midnight? Sleep before midnight checks itself — completing your Morning Routine streak chain on its own.' },
        { emoji: '', title: 'Customizable Step Goal',  description: 'Edit your Daily walk habit to set your step goal — 1,000, 3,000, 5,000, or any amount.' },
        { emoji: '', title: 'Apple Health Settings',   description: 'Pause auto-verify or manage your connection from Settings.' },
      ],
    },
    '1.1.4': {
      subtitle: 'The system is watching now.',
      items: [
        { emoji: '', title: 'Walk Auto-Verifies',  description: "Daily walk now auto-checks via Apple Health. 3,000+ steps and the habit completes itself — no tap needed. Manual still works on Apple Health-disabled devices." },
        { emoji: '', title: 'Auto Marker',          description: 'Auto-verified completions show a subtle AUTO pill on the habit card and a small dot in History. Earned, not celebrated.' },
        { emoji: '', title: 'Privacy First',        description: "Your steps stay on your device. Awakened reads what's already there — nothing leaves your phone, nothing gets stored." },
      ],
    },
    '1.1.3': {
      subtitle: 'One reminder. The path, illustrated.',
      items: [
        { emoji: '', title: 'Morning Reminder',      description: 'A single reminder at the time you choose. No spam. No per-habit pestering. The rest is on you.' },
        { emoji: '', title: 'Custom Habit Icons',    description: 'Morning Routine and Locked-In habits now show premium-rendered art instead of emoji. Same habits — sharper visual identity.' },
        { emoji: '', title: 'Per-Habit Reminders',   description: 'Set a reminder time on any individual habit from the Schedule sheet. View Note shows whether one is set.' },
        { emoji: '', title: 'All Streaks View',      description: 'Tap the streak fire in the header to see Perfect Day, Morning Routine, and Locked-In streaks all in one place.' },
        { emoji: '', title: 'Emoji-Free Pass',       description: 'A complete pass through every screen — class banners, achievements, celebrations, toasts. Custom DALL-E art and Cinzel typography only.' },
        { emoji: '', title: 'Daily Check-In',        description: 'A single 6 PM ping that knows where you are. Cleared every habit? It congratulates you. Halfway? It cheers you on. Just starting? It invites you back to the path.' },
        { emoji: '', title: 'Dark by Design',         description: 'Settings cleaned up. Awakened is dark-mode only by design.' },
      ],
    },
    '1.1.2': {
      subtitle: 'Build your own. Look the part.',
      items: [
        { emoji: '⚡', title: 'Create Your Own Habits',     description: "Author personal habits alongside the curated 49. Pick the stat it trains; the system handles the rest. Up to 5 customs at a time, fixed at 3 XP per completion so the rank economy stays honest." },
        { emoji: '🎨', title: 'New Tab Bar Art',             description: 'Custom-rendered icons replace the emoji set. Premium feel, every tap.' },
        { emoji: '✨', title: 'Custom Stat Icons',           description: 'STR, VIT, INT, FOCUS, WILL, WLT now have premium-rendered art. Same six stats — better aesthetic.' },
        { emoji: '🎨', title: 'New App Icon',                 description: 'A glowing eye, awakening. The new mark of the path.' },
        { emoji: '🔮', title: 'New Wordmark',                  description: 'The Awakened name now reads in Cinzel — mythic, deliberate, locked in.' },
        { emoji: '📋', title: 'Drag to Reorder',                description: 'Hold and drag any habit to reorder your list. Morning habits up top, night habits at the bottom. Your list, your order.' },
        { emoji: '🔔', title: 'Reminders',                      description: 'Set a reminder for any habit. Single notification at your chosen time. Quiet hours, pause anytime, max 3 per day default. Discipline you set, not spam.' },
      ],
    },
    '1.1.1': {
      subtitle: 'Polish & fixes.',
      items: [
        { emoji: '⚔️', title: 'Awakening Fires on Lv.5',     description: 'Hit your first Lv.5 stat and the Awakening celebration now plays as intended — Chapter 2 of your origin story is written and saved.' },
        { emoji: '👆', title: 'No More Cascade Dismissals', description: "Stacked celebrations (level up → class change → awakening) no longer collapse on a single tap. Each one waits for its own moment." },
        { emoji: '📍', title: 'Tappable Stat Labels',         description: 'On the radar chart, the stat names themselves now open the stat detail — not just the dots.' },
        { emoji: '📖', title: 'Cleaner Origin Story',         description: 'The date now lives only in the chapter header. The prose opens with you — the way it should.' },
      ],
    },
    '1.1.0': {
      subtitle: 'Welcome back, hunter.',
      items: [
        { emoji: '🦸', title: 'Custom Character Avatars',     description: 'Your status screen now shows a class-specific hero silhouette that evolves with your rank.' },
        { emoji: '🌅', title: 'Add Morning Routine Anytime',  description: 'Missed it during onboarding? Add the full 10-habit pack with one tap from the Habits tab.' },
        { emoji: '⚡', title: 'Compound Effect for Everyone', description: 'Build the Morning Routine your own way. Custom-path users now earn the daily bonus too.' },
        { emoji: '🎨', title: 'History in Color',             description: "Every completion box now reflects the stat you're building. Tap any habit to see why." },
        { emoji: '📖', title: 'Habit Detail Pages',           description: 'Long-press any habit to view full stats, streak data, and the philosophy behind it.' },
        { emoji: '🎺', title: 'Triumphant Fanfare',           description: 'Completing the full Morning Routine now plays the celebration it deserves.' },
        { emoji: '🔒', title: 'Locked-In Pack',               description: 'A new 16-habit pack covering the full discipline cycle. Master the day, earn a second compound bonus.' },
        { emoji: '🏆', title: 'Personal Records',             description: 'Track lifetime bests across 10 metrics on the Status tab. Break them. Repeat.' },
        { emoji: '🧍', title: 'Civilian Class & The Awakening', description: "Class is now earned, not assumed. Train any stat to Lv5 to awaken into your true path. Lv5 in two paths at once? You choose." },
        { emoji: '⚔️', title: 'Daily Legendary Mission', description: "A multi-component challenge appears every day. All-or-nothing bonus XP. Weekends lean toward stepping outside. Most won't attempt it — the days you do are the days that count." },
        { emoji: '🛡️', title: 'Streak Forgiveness',     description: "Earn a Streak Shield every 14 days. Take an Honest Rest once a month. Get Resilience XP when you come back. Streaks should reward consistency, not punish humanity." },
        { emoji: '📜', title: 'Origin Stories',           description: "Your start has been written. Your awakening will be written. A two-chapter narrative, yours alone, saved forever." },
      ],
    },
  };

  // Returns the highest semver key from WHATS_NEW (e.g., "1.1.0")
  function getLatestWhatsNewVersion() {
    const keys = Object.keys(WHATS_NEW);
    if (!keys.length) return null;
    keys.sort(compareSemver);
    return keys[keys.length - 1]; // highest at the end after ascending sort
  }
  // Returns negative if a < b, positive if a > b, zero if equal.
  function compareSemver(a, b) {
    const ap = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const bp = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
      const av = ap[i] || 0, bv = bp[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  // Habits that have a quantifiable goal (name → { unit, def, step, min })
  // min = minimum goal value required to check off; bodyweightMin = use stored bodyweight as min
  const MEASURABLE_HABITS = {
    'Hydrate':                            { unit: 'glasses', def: 6,   step: 1,   min: 6  },
    'Sleep':                              { unit: 'hrs',     def: 7,   step: 0.5, min: 7  },
    'Cardio workout':                     { unit: 'min',     def: 30,  step: 5,   min: 20 },
    'Strength training':                  { unit: 'min',     def: 30,  step: 5,   min: 20 },
    'Sprint session':                     { unit: 'min',     def: 15,  step: 5,   min: 10 },
    'Daily walk':                         { unit: 'min',     def: 30,  step: 5,   min: 15 },
    'Ice bath or cold plunge':            { unit: 'min',     def: 5,   step: 1,   min: 5  },
    'Cold shower':                        { unit: 'min',     def: 5,   step: 1,   min: 3  },
    'Mobility & Stretching':              { unit: 'min',     def: 15,  step: 5,   min: 10 },
    'Protein goal':                       { unit: 'g',       def: 150, step: 5,   min: 0, bodyweightMin: true },
    'Read':                               { unit: 'min',     def: 20,  step: 5,   min: 10 },
    'Meditate & Breathwork':              { unit: 'min',     def: 10,  step: 5,   min: 5  },
    'Get morning sunlight':               { unit: 'min',     def: 15,  step: 5,   min: 10 },
    'Work on a side project or business': { unit: 'min',     def: 30,  step: 5,   min: 30 },
    'Educational podcast':               { unit: 'min',     def: 20,  step: 5,   min: 15 },
    'Practice a skill':                   { unit: 'min',     def: 20,  step: 5,   min: 15 },
    'Flashcard review':                   { unit: 'min',     def: 15,  step: 5,   min: 10 },
    'Language learning':                  { unit: 'min',     def: 20,  step: 5,   min: 15 },
    'Barefoot grounding outside':         { unit: 'min',     def: 15,  step: 5,   min: 10 },
    'Visualization practice':             { unit: 'min',     def: 10,  step: 5,   min: 5  },
  };

  // Returns { base, goal } — goal is null if no goal explicitly set by user.
  //
  // HealthKit-auto-verifiable habits pre-empt the legacy MEASURABLE_HABITS
  // branch below:
  //   - Daily walk → "{N} steps" from getHabitStepGoal(habit)
  //   - Sleep      → "{N} hours" / "1 hour" from getSleepGoalHours(habit)
  //   - Sleep before midnight → no subtitle (binary habit, no goal)
  //
  // v1.1.4 users may still have habit.goal = {value: 30, unit: 'min'}
  // stored from the old time-based stepper — that field is silently
  // ignored from v1.1.5 onward; no migration. Their first save in the
  // Edit modal writes habit.stepGoal / habit.sleepGoalHours; the
  // legacy goal field can stay orphaned.
  function habitDisplayParts(habit) {
    if (isStepGoalHabit(habit)) {
      return { base: habit.name, goal: getHabitStepGoal(habit).toLocaleString() + ' steps' };
    }
    if (isSleepDurationHabit(habit)) {
      const h = getSleepGoalHours(habit);
      return { base: habit.name, goal: h + (h === 1 ? ' hour' : ' hours') };
    }
    if (isSleepBedtimeHabit(habit)) {
      // Binary auto-verify habit — no goal text. The base name alone
      // ("Sleep before midnight") already conveys the rule.
      return { base: habit.name, goal: null };
    }
    const m = MEASURABLE_HABITS[habit.name];
    if (!m) return { base: habit.name, goal: null };
    if (!habit.goal) return { base: habit.name, goal: null };
    return { base: habit.name, goal: habit.goal.value.toLocaleString() + ' ' + habit.goal.unit };
  }

  // Plain-text display name (for truncation / history labels)
  function habitDisplayName(habit) {
    const { base, goal } = habitDisplayParts(habit);
    return goal ? base + ' • ' + goal : base;
  }

  // Clean base name (no duration/quantity suffix) — used by the History tab
  // so rows read "Strength training" instead of "Strength training • 30 min".
  // Other tabs continue to use habitDisplayName for the full version.
  function habitBaseName(habit) {
    return habitDisplayParts(habit).base;
  }

  // Canonical description shown on the View Note sheet.
  // Pulled from the master library DEFAULT_HABITS by name — never from
  // user-editable storage. Returns empty string if no description exists.
  function getHabitDescription(habit) {
    if (!habit || !habit.name) return '';
    // Custom habits aren't in the master library — give them a generic
    // but on-brand description rather than falling back to "coming soon."
    if (habit.custom) {
      return 'A custom habit you chose for yourself. Build it day by day.';
    }
    const def = DEFAULT_HABITS.find(d => d.name === habit.name);
    return (def && def.description) || '';
  }

  // One-sentence description of what each stat builds — shown in the
  // History tab's per-habit info popup. (The longer multi-sentence
  // STAT_DESCRIPTIONS used by the Stats detail screen lives elsewhere.)
  const STAT_INFO_BLURB = {
    STR:   'Builds your physical strength and discipline.',
    VIT:   'Builds your vitality, recovery, and physical wellbeing.',
    INT:   'Builds your knowledge, learning, and mental sharpness.',
    FOCUS: 'Builds your concentration and resistance to distraction.',
    WILL:  'Builds your discipline, consistency, and mental toughness.',
    WLT:   'Builds your financial intelligence and long-term wealth.',
  };

  // Rich HTML for the main card — bullet is styled in muted purple
  function habitDisplayHTML(habit) {
    const { base, goal } = habitDisplayParts(habit);
    if (!goal) return esc(base);
    return esc(base) + '<span class="habit-name-sep"> • </span>' + esc(goal);
  }

  // ── DAILY QUOTES (Feature 2) ─────────────────────────────
  const QUOTES = [
    // Habit / discipline classics
    { text: 'We are what we repeatedly do. Excellence is not an act, but a habit.',                       attr: '— Aristotle' },
    { text: 'The secret of your future is hidden in your daily routine.',                                  attr: '— Mike Murdock' },
    { text: 'Small disciplines repeated with consistency every day lead to great achievements.',           attr: '— John Maxwell' },
    { text: 'You do not rise to the level of your goals. You fall to the level of your systems.',          attr: '— James Clear' },
    { text: 'Every action you take is a vote for the type of person you wish to become.',                  attr: '— James Clear' },
    { text: 'The chains of habit are too weak to be felt until they are too strong to be broken.',         attr: '— Samuel Johnson' },
    { text: 'Win the morning, win the day.',                                                               attr: '— Tim Ferriss' },
    { text: 'Motivation gets you started. Habit keeps you going.',                                         attr: '— Jim Ryun' },
    { text: 'An ounce of practice is worth more than a ton of theory.',                                    attr: '— Mahatma Gandhi' },
    { text: 'The difference between who you are and who you want to be is what you do.',                   attr: '— Anonymous' },
    { text: 'Success is the sum of small efforts repeated day in and day out.',                            attr: '— Robert Collier' },
    { text: 'Discipline is the bridge between goals and accomplishment.',                                  attr: '— Jim Rohn' },
    { text: 'It is not that we have a short time to live, but that we waste a good deal of it.',           attr: '— Seneca' },
    { text: 'A year from now you will wish you had started today.',                                        attr: '— Karen Lamb' },
    { text: 'Show up every day. That alone puts you ahead of most.',                                       attr: '— Anonymous' },

    // Stoic / philosophical
    { text: 'Waste no more time arguing what a good man should be. Be one.',                               attr: '— Marcus Aurelius' },
    { text: 'You have power over your mind — not outside events. Realize this, and you will find strength.', attr: '— Marcus Aurelius' },
    { text: 'The impediment to action advances action. What stands in the way becomes the way.',           attr: '— Marcus Aurelius' },
    { text: 'Confine yourself to the present.',                                                            attr: '— Marcus Aurelius' },
    { text: 'First say to yourself what you would be; then do what you have to do.',                       attr: '— Epictetus' },
    { text: 'It is not what happens to you, but how you react to it that matters.',                        attr: '— Epictetus' },
    { text: 'No man is free who is not master of himself.',                                                attr: '— Epictetus' },
    { text: 'While we wait for life, life passes.',                                                        attr: '— Seneca' },
    { text: 'Difficulties strengthen the mind, as labor does the body.',                                   attr: '— Seneca' },
    { text: 'Luck is what happens when preparation meets opportunity.',                                    attr: '— Seneca' },
    { text: 'Excellence is never an accident. It is the result of high intention and intelligent execution.', attr: '— Aristotle' },

    // Habit / self-improvement / discipline
    { text: 'Habits are the compound interest of self-improvement.',                                       attr: '— James Clear' },
    { text: 'You should be far more concerned with your current trajectory than with your current results.', attr: '— James Clear' },
    { text: 'Get 1% better every day.',                                                                    attr: '— James Clear' },
    { text: 'Discipline equals freedom.',                                                                  attr: '— Jocko Willink' },
    { text: "When things are going bad, don't take yourself with them.",                                   attr: '— Jocko Willink' },
    { text: 'Clarity about what matters provides clarity about what does not.',                            attr: '— Cal Newport' },
    { text: 'Human beings are at their best when immersed deeply in something challenging.',               attr: '— Cal Newport' },
    { text: 'Whatever the mind can conceive and believe, it can achieve.',                                 attr: '— Napoleon Hill' },
    { text: 'Patience, persistence, and perspiration make an unbeatable combination for success.',         attr: '— Napoleon Hill' },
    { text: "The key is not to prioritize what's on your schedule, but to schedule your priorities.",      attr: '— Stephen Covey' },
    { text: 'Begin with the end in mind.',                                                                 attr: '— Stephen Covey' },
    { text: 'Most people stop at 40% of their true capacity.',                                             attr: '— David Goggins' },
    { text: "Don't stop when you're tired. Stop when you're done.",                                        attr: '— David Goggins' },
    { text: 'Stay hard.',                                                                                  attr: '— David Goggins' },

    // Trading psychology / probabilistic thinking
    { text: 'The best traders think in probabilities.',                                                    attr: '— Mark Douglas' },
    { text: "You don't need to know what's going to happen next to make money.",                           attr: '— Mark Douglas' },
    { text: 'Play long-term games with long-term people.',                                                 attr: '— Naval Ravikant' },
    { text: 'Earn with your mind, not your time.',                                                         attr: '— Naval Ravikant' },
    { text: 'Read what you love until you love to read.',                                                  attr: '— Naval Ravikant' },
    { text: 'The most important skill for getting rich is becoming a perpetual learner.',                  attr: '— Naval Ravikant' },

    // Performance / mindset
    { text: 'Great things come from hard work and perseverance. No excuses.',                              attr: '— Kobe Bryant' },
    { text: 'Rest at the end, not in the middle.',                                                         attr: '— Kobe Bryant' },
    { text: 'I have failed over and over again in my life. That is why I succeed.',                        attr: '— Michael Jordan' },
    { text: 'Some people want it to happen, some wish it would happen, others make it happen.',            attr: '— Michael Jordan' },
    { text: 'Be water, my friend.',                                                                        attr: '— Bruce Lee' },
    { text: 'Knowing is not enough; we must apply. Willing is not enough; we must do.',                    attr: '— Bruce Lee' },
    { text: 'The supreme art of war is to subdue the enemy without fighting.',                             attr: '— Sun Tzu' },
    { text: 'In the midst of chaos, there is also opportunity.',                                           attr: '— Sun Tzu' },

    // Modern motivation
    { text: 'Effort is the only currency that creates lasting change.',                                    attr: '— Andrew Huberman' },
    { text: 'The longer the time horizon, the lower the competition.',                                     attr: '— Alex Hormozi' },
    { text: "Hard work beats talent when talent doesn't work hard.",                                       attr: '— Alex Hormozi' },
    { text: 'Focus on being productive instead of busy.',                                                  attr: '— Tim Ferriss' },
    { text: 'What we fear doing most is usually what we most need to do.',                                 attr: '— Tim Ferriss' },
    { text: 'It does not matter how slowly you go as long as you do not stop.',                            attr: '— Confucius' },
  ];

  // v2.0.1 rank-scaling overhaul: thresholds recalibrated so that
  // a user completing the Locked-In pack daily reaches S rank in
  // ~6 months and S+ in ~12-18 months. Old curve (E:500/D:1500/...)
  // produced S in ~30 days when compound bonuses stacked — way too
  // fast for a long-arc progression system. Migration in init()
  // preserves rank-fraction position for existing users; see
  // migrateXPToNewThresholds().
  const RANKS = [
    { id: 'E',  label: 'E Rank',  desc: 'Just getting started',                                      min: 0,      max: 499,      next: 500    },
    { id: 'D',  label: 'D Rank',  desc: 'Building awareness',                                        min: 500,    max: 2499,     next: 2500   },
    { id: 'C',  label: 'C Rank',  desc: 'Consistency is forming',                                    min: 2500,   max: 7499,     next: 7500   },
    { id: 'B',  label: 'B Rank',  desc: 'Above average discipline. Most people never get here.',     min: 7500,   max: 24999,    next: 25000  },
    { id: 'A',  label: 'A Rank',  desc: 'True excellence. This is rare.',                            min: 25000,  max: 69999,    next: 70000  },
    { id: 'S',  label: 'S Rank',  desc: 'Elite. You have become the habit.',                         min: 70000,  max: 149999,   next: 150000 },
    { id: 'S+', label: 'S+ Rank', desc: 'Legendary. Less than 1% of humans operate at this level.', min: 150000, max: Infinity, next: null   },
  ];

  // ── PERSONAL RECORDS (PRs) ───────────────────────────────
  // 10 lifetime-best metrics. Single source of truth — change only here.
  // tier: 1 = subtle toast, 2 = modal, 3 = full-screen takeover
  // Master switch: when false, PRs still track and display silently
  // (visible via the 🏆 chip on the Status tab) but never fire popups.
  const PR_CELEBRATIONS_ENABLED = false;
  const PR_DEFS = [
    { id: 'most_habits_day',       label: 'habits in a day',     accent: '#a855f7', icon: '🏆',
      tier: 2, motivation: "Volume reveals what's possible. Break it again.",
      description: 'Most habits completed in a single day.' },
    { id: 'most_xp_day',           label: 'XP in a day',         accent: '#a855f7', icon: '⚡',
      tier: 2, motivation: "Volume reveals what's possible. Break it again.",
      description: 'Highest XP earned in a single day.' },
    { id: 'longest_mr_streak',     label: 'longest MR streak',   accent: '#f59e0b', icon: '🌅',
      tier: 3, takeoverDays: [30, 60, 100, 200, 365],
      motivation: 'Days you owned. Keep stacking.',
      description: 'Longest Morning Routine compound streak ever.' },
    { id: 'longest_li_streak',     label: 'longest LI streak',   accent: '#7c3aed', icon: '🔒',
      tier: 3, takeoverDays: [30, 60, 100, 200, 365],
      motivation: 'Days you owned. Keep stacking.',
      description: 'Longest Locked-In compound streak ever.' },
    { id: 'longest_stat_streak',   label: 'top stat streak',     accent: 'stat',    icon: '📈',
      tier: 2, motivation: "Specialization compounds. Don't lose the focus.",
      description: 'Longest single-stat consistency streak.' },
    { id: 'longest_habit_streak',  label: 'top habit streak',    accent: '#fbbf24', icon: '🔥',
      tier: 2, motivation: "Specialization compounds. Don't lose the focus.",
      description: 'Longest streak ever held by any single habit.' },
    { id: 'total_habits_lifetime', label: 'habits lifetime',     accent: '#f59e0b', icon: '✅',
      tier: 1, milestones: [100, 500, 1000, 5000, 10000],
      motivation: 'Every rep counts. The number only goes up.',
      description: 'Total habits completed across your entire journey.' },
    { id: 'total_xp_lifetime',     label: 'XP lifetime',         accent: '#f59e0b', icon: '💎',
      tier: 1, milestones: [500, 1000, 5000, 10000, 50000],
      motivation: 'Every rep counts. The number only goes up.',
      description: 'Total XP earned including all bonuses.' },
    { id: 'total_active_days',     label: 'active days',         accent: '#f59e0b', icon: '📅',
      tier: 1, milestones: [50, 100, 365, 730],
      motivation: 'Every rep counts. The number only goes up.',
      description: 'Calendar days you completed at least one habit.' },
    { id: 'highest_rank',          label: 'highest rank',        accent: '#fbbf24', icon: '👑',
      tier: 3,
      motivation: "You've been here before. Don't forget what you're capable of.",
      description: 'Highest rank tier you have ever reached.' },
  ];


  // Achievement categories drive the section grouping in the UI.
  const ACH_CATEGORIES = [
    { id: 'streaks',  label: 'Streaks' },
    { id: 'rank',     label: 'Rank & Points' },
    { id: 'class',    label: 'Class & Awakening' },
    { id: 'packs',    label: 'Packs' },
    { id: 'habits',   label: 'Habit Mastery' },
    { id: 'lifetime', label: 'Lifetime' },
  ];

  // Each achievement: id, icon, name, desc, category, target, getProgress(ctx).
  // getProgress(ctx) returns { current: N, target: T } so the UI can show
  // a live progress bar like "12 / 30 days" on locked rows. ctx is built
  // once in checkAchievements() and reused by render code.
  const ACHIEVEMENTS = [
    // ── 🔥 STREAKS ──────────────────────────────────────────
    { id: 'week_warrior',   category: 'streaks', icon: '🗓️', name: 'Week Warrior',
      desc: '7-day streak on any habit', target: 7,
      getProgress: c => ({ current: Math.min(c.maxStreak, 7), target: 7 }) },
    { id: 'streak_hunter',  category: 'streaks', icon: '🔥', name: 'Streak Hunter',
      desc: '30-day streak on any habit', target: 30,
      getProgress: c => ({ current: Math.min(c.maxStreak, 30), target: 30 }) },
    { id: 'iron_will',      category: 'streaks', icon: '⚔️', name: 'Iron Will',
      desc: '100-day streak on any habit', target: 100,
      getProgress: c => ({ current: Math.min(c.maxStreak, 100), target: 100 }) },
    { id: 'streak_200',     category: 'streaks', icon: '🌑', name: 'The 200',
      desc: '200-day streak on any habit', target: 200,
      getProgress: c => ({ current: Math.min(c.maxStreak, 200), target: 200 }) },
    { id: 'streak_365',     category: 'streaks', icon: '🌟', name: 'The 365',
      desc: 'Full year streak on any habit', target: 365,
      getProgress: c => ({ current: Math.min(c.maxStreak, 365), target: 365 }) },
    { id: 'streak_730',     category: 'streaks', icon: '👑', name: 'Two Years In',
      desc: '730-day streak on any habit', target: 730,
      getProgress: c => ({ current: Math.min(c.maxStreak, 730), target: 730 }) },

    // ── 🛡️ RANK & POINTS ───────────────────────────────────
    { id: 'first_step',    category: 'rank', icon: '👣', name: 'First Step',
      desc: 'Complete your first habit ever',
      getProgress: c => ({ current: Math.min(c.totalCompletions, 1), target: 1 }) },
    { id: 'centurion',     category: 'rank', icon: '🛡️', name: 'Centurion',
      desc: 'Earn 500 total points', target: 500,
      getProgress: c => ({ current: Math.min(c.totalPoints, 500), target: 500 }) },
    { id: 'the_grind',     category: 'rank', icon: '⚡', name: 'The Grind',
      desc: 'Reach C Rank (2,500 pts)', target: 2500,
      getProgress: c => ({ current: Math.min(c.totalPoints, 2500), target: 2500 }) },
    { id: 'awakened',      category: 'rank', icon: '💎', name: 'Awakened',
      desc: 'Reach A Rank (25,000 pts)', target: 25000,
      getProgress: c => ({ current: Math.min(c.totalPoints, 25000), target: 25000 }) },
    { id: 'shadow_monarch',category: 'rank', icon: '🌑', name: 'Shadow Monarch',
      desc: 'Reach S Rank (70,000 pts)', target: 70000,
      getProgress: c => ({ current: Math.min(c.totalPoints, 70000), target: 70000 }) },
    { id: 'the_one',       category: 'rank', icon: '⭐', name: 'The One',
      desc: 'Reach S+ Rank (150,000 pts)', target: 150000,
      getProgress: c => ({ current: Math.min(c.totalPoints, 150000), target: 150000 }) },
    { id: 'golden_hour',   category: 'rank', icon: '🏆', name: 'Golden Hour',
      desc: 'Earn 7,500 lifetime XP', target: 7500,
      getProgress: c => ({ current: Math.min(c.totalPoints, 7500), target: 7500 }) },

    // ── 🧍 CLASS & AWAKENING ───────────────────────────────
    { id: 'first_awakening', category: 'class', icon: '✨', name: 'First Awakening',
      desc: 'Earn your first class (any of 7)', target: 1,
      getProgress: c => ({ current: c.hasClass ? 1 : 0, target: 1 }) },
    { id: 'specialist',      category: 'class', icon: '📈', name: 'Specialist',
      desc: 'Reach Lv10 in any single stat', target: 10,
      getProgress: c => ({ current: Math.min(c.maxStatLv, 10), target: 10 }) },
    { id: 'master',          category: 'class', icon: '⚜️', name: 'Master',
      desc: 'Reach Lv20 (MAX) in any single stat', target: 20,
      getProgress: c => ({ current: Math.min(c.maxStatLv, 20), target: 20 }) },
    { id: 'polymath',        category: 'class', icon: '🎴', name: 'Polymath',
      desc: 'Reach Lv5 in 3 or more stats', target: 3,
      getProgress: c => ({ current: Math.min(c.statsAtLv5, 3), target: 3 }) },
    { id: 'the_sage',        category: 'class', icon: '🌟', name: 'The Sage',
      desc: 'Achieve Sage class (all 6 stats Lv5+, balanced)', target: 1,
      getProgress: c => ({ current: c.isSage ? 1 : 0, target: 1 }) },
    { id: 'fully_awakened',  category: 'class', icon: '👑', name: 'Fully Awakened',
      desc: 'Max all 6 stats — Total Level 120 (+2,000 bonus XP)', target: 120,
      getProgress: c => ({ current: Math.min(c.totalStatLevel, 120), target: 120 }) },

    // ── 🌅 PACKS ────────────────────────────────────────────
    { id: 'compound_day',    category: 'packs', icon: '⚡', name: 'Compound Day',
      desc: 'Earn the Compound Effect Bonus once', target: 1,
      getProgress: c => ({ current: Math.min(c.mrStreak, 1), target: 1 }) },
    { id: 'compound_week',   category: 'packs', icon: '🌅', name: 'Compound Week',
      desc: '7-day Morning Routine streak', target: 7,
      getProgress: c => ({ current: Math.min(c.mrStreak, 7), target: 7 }) },
    { id: 'compound_month',  category: 'packs', icon: '🔥', name: 'Compound Month',
      desc: '30-day Morning Routine streak', target: 30,
      getProgress: c => ({ current: Math.min(c.mrStreak, 30), target: 30 }) },
    { id: 'locked_in_init',  category: 'packs', icon: '🔒', name: 'Locked-In Initiation',
      desc: 'Earn the Locked-In Bonus once', target: 1,
      getProgress: c => ({ current: Math.min(c.liStreak, 1), target: 1 }) },
    { id: 'locked_in_30',    category: 'packs', icon: '🛡️', name: 'Locked-In Disciple',
      desc: '30-day Locked-In streak', target: 30,
      getProgress: c => ({ current: Math.min(c.liStreak, 30), target: 30 }) },
    { id: 'both_crowns',     category: 'packs', icon: '👑', name: 'Both Crowns',
      desc: 'Earn both Compound + Locked-In bonuses on the same day', target: 1,
      getProgress: c => ({ current: c.bothCrownsToday ? 1 : 0, target: 1 }) },

    // ── 🎯 HABIT MASTERY ────────────────────────────────────
    { id: 'legendary_hunter', category: 'habits', icon: '👑', name: 'Legendary Hunter',
      desc: 'Complete a Legendary habit 30 days in a row', target: 30,
      getProgress: c => ({ current: Math.min(c.maxLegStreak, 30), target: 30 }) },
    { id: 'cold_soul',  category: 'habits', icon: '🧊', name: 'Cold Soul',
      desc: '30 cold plunge or cold shower completions', target: 30,
      getProgress: c => ({ current: Math.min(c.coldCount, 30), target: 30 }) },
    { id: 'bookworm',   category: 'habits', icon: '📖', name: 'Bookworm',
      desc: 'Read habit completed 100 days', target: 100,
      getProgress: c => ({ current: Math.min(c.readCount, 100), target: 100 }) },
    { id: 'iron_body',  category: 'habits', icon: '🏋️', name: 'Iron Body',
      desc: 'Strength training 100 days', target: 100,
      getProgress: c => ({ current: Math.min(c.strengthCount, 100), target: 100 }) },
    { id: 'stoic',      category: 'habits', icon: '🧠', name: 'Stoic',
      desc: 'Meditate 60 days', target: 60,
      getProgress: c => ({ current: Math.min(c.meditateCount, 60), target: 60 }) },
    { id: 'phone_off',  category: 'habits', icon: '📵', name: 'Phone-Off Champion',
      desc: '30 days of "No phone after waking"', target: 30,
      getProgress: c => ({ current: Math.min(c.phoneOffCount, 30), target: 30 }) },

    // ── 📅 LIFETIME ─────────────────────────────────────────
    { id: 'year_active',  category: 'lifetime', icon: '📅', name: 'Year of Sweat',
      desc: '365 active days lifetime', target: 365,
      getProgress: c => ({ current: Math.min(c.activeDays, 365), target: 365 }) },
    { id: 'discipline_test', category: 'lifetime', icon: '⚜️', name: 'Discipline Test',
      desc: '1,000 lifetime habit completions', target: 1000,
      getProgress: c => ({ current: Math.min(c.totalCompletions, 1000), target: 1000 }) },
    { id: 'perfect_week',  category: 'lifetime', icon: '✨', name: 'Perfect Week',
      desc: '7 perfect days in a row', target: 7,
      getProgress: c => ({ current: Math.min(c.perfectStreak, 7), target: 7 }) },
    { id: 'perfect_month', category: 'lifetime', icon: '💎', name: 'Perfect Month',
      desc: '30 perfect days in a row', target: 30,
      getProgress: c => ({ current: Math.min(c.perfectStreak, 30), target: 30 }) },
    { id: 'pr_breaker',    category: 'lifetime', icon: '🏆', name: 'Personal Best',
      desc: 'Break any Personal Record for the first time', target: 1,
      getProgress: c => ({ current: c.anyPRSet ? 1 : 0, target: 1 }) },
  ];

  const STATS = [
    { id: 'STR',   icon: '⚔️',  iconImg: 'assets/stat-icons/stat-str.png',   label: 'STR',   name: 'Strength',     color: '#ef4444',
      habits: [
        'Strength training', 'Cardio workout', 'Sprint session', 'Daily walk', 'Protein goal',
      ] },
    { id: 'VIT',   icon: '❤️',  iconImg: 'assets/stat-icons/stat-vit.png',   label: 'VIT',   name: 'Vitality',     color: '#22c55e',
      habits: [
        'Hydrate', 'Sleep', 'Sleep before midnight', 'Cardio workout', 'Daily walk',
        'Ice bath or cold plunge', 'Mobility & Stretching', 'Get morning sunlight',
        'Whole foods diet', 'No sugar/junk food', 'Barefoot grounding outside',
        'Vitamins and minerals', 'Sleep early before 11PM',
      ] },
    { id: 'INT',   icon: '🧠',  iconImg: 'assets/stat-icons/stat-int.png',   label: 'INT',   name: 'Intelligence', color: '#3b82f6',
      habits: [
        'Read', 'Journal', 'Educational podcast', 'Practice a skill',
        'Flashcard review', 'Write down lessons learned', 'Learn something new',
        'Language learning', 'Visualization practice',
        'Review your long term goals', 'Generate one new business or content idea',
      ] },
    { id: 'FOCUS', icon: '🎯',  iconImg: 'assets/stat-icons/stat-focus.png', label: 'FOCUS', name: 'Focus',        color: '#475569',
      habits: [
        'Meditate & Breathwork', 'No phone or social media after waking',
        'Review daily goals/intentions', 'No social media before noon',
        'Complete your #1 priority task', 'Plan tomorrow the night before',
        'Under 1 hour screen time', 'Digital declutter',
        'No doomscrolling until after 5PM', 'Review your long term goals',
        'Review investments or trading journal', 'Visualization practice',
      ] },
    { id: 'WILL',  icon: '🔥',  iconImg: 'assets/stat-icons/stat-will.png',  label: 'WILL',  name: 'Willpower',    color: '#f97316',
      habits: [
        'Ice bath or cold plunge', 'Cold shower', 'Meditate & Breathwork',
        'No screens 1 hour before bed', 'No sugar/junk food', 'No alcohol', 'No caffeine',
        'Wake up at consistent time', 'Complete your #1 priority task', 'Tidy/clean space',
        'Morning gratitude practice', 'Pray or set intentions',
        'Call or text a family member', 'Do something kind for someone',
      ] },
    { id: 'WLT',   icon: '💰',  iconImg: 'assets/stat-icons/stat-wlt.png',   label: 'WLT',   name: 'Wealth',       color: '#f59e0b',
      habits: [
        'Track finances & net worth', 'Work on a side project or business',
        'Review investments or trading journal', 'Generate one new business or content idea',
      ] },
  ];

  // Render helper — returns an <img> for the stat's custom art if available,
  // otherwise falls back to the raw emoji. The opts.size controls render
  // size in CSS px; opts.eager loads immediately (use for above-the-fold).
  function statIconHtml(st, opts) {
    opts = opts || {};
    const sz = opts.size || 32;
    if (st && st.iconImg) {
      const cls = 'stat-icon-img' + (opts.cls ? ' ' + opts.cls : '');
      return '<img class="' + cls + '" src="' + st.iconImg + '" alt="' +
        (st.label ? st.label.replace(/"/g, '') : '') + '" ' +
        'style="width:' + sz + 'px;height:' + sz + 'px" ' +
        'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
    }
    return st && st.icon ? st.icon : '';
  }
  // For elements that previously held a single emoji glyph via .textContent.
  function setStatIcon(el, st, sizePx) {
    if (!el) return;
    el.innerHTML = statIconHtml(st, { size: sizePx || 32, eager: true });
  }

  // ── HABIT ICON HELPERS ───────────────────────────────────
  // Mirrors the stat-icon pattern. getHabitIcon returns the PNG path if
  // the curated habit has a mapping; null otherwise. Custom user habits
  // ALWAYS return null — they keep their user-chosen emoji. habitIconHtml
  // returns the proper render markup (img tag OR escaped emoji string).
  // setHabitIcon writes the markup into an existing element via innerHTML.
  function getHabitIcon(habit) {
    if (!habit) return null;
    if (habit.custom) return null;
    return (habit.name && HABIT_ICONS[habit.name]) || null;
  }
  function habitIconHtml(habit, opts) {
    opts = opts || {};
    const sz   = opts.size || 32;
    const path = getHabitIcon(habit);
    if (path) {
      const cls = 'habit-icon-img' + (opts.cls ? ' ' + opts.cls : '');
      const alt = (habit.name || '').replace(/"/g, '');
      return '<img class="' + cls + '" src="' + path + '" alt="' + alt + '" ' +
        'style="width:' + sz + 'px;height:' + sz + 'px" ' +
        'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
    }
    return habit && habit.emoji ? habit.emoji : '';
  }
  function setHabitIcon(el, habit, sizePx) {
    if (!el) return;
    const path = getHabitIcon(habit);
    if (path) {
      el.innerHTML = habitIconHtml(habit, { size: sizePx || 32, eager: true });
    } else {
      el.textContent = habit && habit.emoji ? habit.emoji : '';
    }
  }

  const STAT_BONUS_THRESHOLDS = [
    { level:  5, pts:  25 },
    { level: 10, pts:  75 },
    { level: 15, pts: 150 },
    { level: 20, pts: 500 },
  ];

  // ── PERFECT DAY STREAK MILESTONES ────────────────────────
  const PERFECT_STREAK_MILESTONES = [
    { day:   7, bonus:  10, title: 'WEEK WARRIOR',        emoji: '🔥', subtitle: '7 Perfect Days in a row!',                                                       color: '#8b5cf6', shake: false, letterReveal: false, extended: false, chime: false },
    { day:  14, bonus:  25, title: 'FORTNIGHT HUNTER',    emoji: '⚡', subtitle: '14 Perfect Days. You are not like the others.',                                   color: '#3b82f6', shake: false, letterReveal: false, extended: false, chime: false },
    { day:  21, bonus:  50, title: 'BEAST MODE ACTIVATED',emoji: '💪', subtitle: '21 Days. A habit is now part of you.',                                            color: '#a855f7', shake: true,  letterReveal: false, extended: false, chime: false },
    { day:  30, bonus: 100, title: 'MONTHLY LEGEND',      emoji: '👑', subtitle: '30 Perfect Days. Most people quit by day 3.',                                     color: '#f97316', shake: false, letterReveal: false, extended: false, chime: true  },
    { day:  60, bonus: 250, title: 'IRON DISCIPLE',       emoji: '⚔️', subtitle: '60 Days. Your discipline is becoming legendary.',                                 color: '#ef4444', shake: true,  letterReveal: false, extended: false, chime: false },
    { day: 100, bonus: 500, title: 'CENTURY HUNTER',      emoji: '💎', subtitle: '100 Perfect Days. You have become the person most people only dream of being.',  color: '#f59e0b', shake: true,  letterReveal: true,  extended: true,  chime: true  },
  ];
  const PS_REPEAT = { bonus: 300, emoji: '🌟', color: '#f59e0b', shake: false, letterReveal: false, extended: false, chime: false,
    subtitle: 'The journey never ends. Neither do you.' };

  const ALL_DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const DAY_LABELS = ['M','T','W','T','F','S','S'];

  const RANK_EFFECTS = {
    'D':  { color: '#8b5cf6', glow: 'rgba(139,92,246,0.55)', cls: 'rank-d',    shake: false, particles: 0,  rain: false, shockwave: false, lightning: false },
    'C':  { color: '#8b5cf6', glow: 'rgba(139,92,246,0.55)', cls: 'rank-c',    shake: false, particles: 12, rain: false, shockwave: false, lightning: false },
    'B':  { color: '#3b82f6', glow: 'rgba(59,130,246,0.55)', cls: 'rank-b',    shake: false, particles: 0,  rain: false, shockwave: true,  lightning: false },
    'A':  { color: '#a855f7', glow: 'rgba(168,85,247,0.55)', cls: 'rank-a',    shake: false, particles: 0,  rain: false, shockwave: false, lightning: true  },
    'S':  { color: '#f97316', glow: 'rgba(249,115,22,0.65)', cls: 'rank-s',    shake: true,  particles: 30, rain: false, shockwave: true,  lightning: false },
    'S+': { color: '#f59e0b', glow: 'rgba(245,158,11,0.75)', cls: 'rank-splus',shake: true,  particles: 0,  rain: true,  shockwave: false, lightning: false },
  };

  const STAT_FLAVOR = {
    STR:   'Your body grows stronger.',
    VIT:   'Your endurance increases.',
    INT:   'Your mind sharpens.',
    FOCUS: 'Your concentration deepens.',
    WILL:  'Your resolve hardens.',
    WLT:   'Your wealth expands.',
  };

  const STAT_DESCRIPTIONS = {
    STR:   'Raw physical power and bodily discipline. Warriors are forged through consistent physical effort. Every workout, every cold shower, every mile run builds this stat.',
    VIT:   'Your health, recovery, and longevity. Vitality is the foundation everything else is built on. Sleep, hydration, nutrition, and mobility keep your body running at full capacity.',
    INT:   'Mental growth, knowledge, and cognitive sharpness. The mind is a muscle — read, reflect, learn, and meditate to expand your intelligence stat over time.',
    FOCUS: 'Attention, presence, and distraction resistance. In a world designed to steal your attention, focus is a superpower. Protect your mornings and guard your mind.',
    WILL:  "Discipline over comfort. Willpower is doing what you said you would do when you don't feel like doing it. The rarest and most valuable stat of all.",
    WLT:   'Financial intelligence and growth mindset. Wealth is built through daily micro decisions — tracking, building, reaching, investing. Consistency here compounds harder than any other stat.',
  };

  // ── ORIGIN STORIES — two-chapter narrative artifact ──────
  // Chapter 1 (The Beginning): generated at onboarding completion,
  //   class-agnostic. Marks the moment the user started.
  // Chapter 2 (The Awakening): generated at first Civilian → class
  //   transition, class-specific. Marks the moment they earned a path.
  // Both are PERMANENT — never regenerate, never edit. Class shifts
  // after first awakening do NOT update Chapter 2.
  const BEGINNING_TEMPLATE =
    '{NAME} was nothing yet.\n' +
    'Not a Warrior. Not a Mage. Not a Hunter — only the idea of one.\n' +
    'But on this day he made the only choice that matters: to begin.';

  const ORIGIN_TEMPLATES = {
    STR:   '{NAME} chose the path of the Warrior.\nNot because strength came naturally. Because weakness had become unbearable.\nThe Awakening had begun.',
    INT:   '{NAME} chose the path of the Mage.\nNot because the world demanded knowledge. Because ignorance had become the cage.\nThe Awakening had begun.',
    FOCUS: '{NAME} chose the path of the Assassin.\nNot because focus came easily. Because distraction had cost him too much.\nThe Awakening had begun.',
    WILL:  '{NAME} chose the path of the Paladin.\nNot because nothing tested him. Because breaking had stopped being an option.\nThe Awakening had begun.',
    VIT:   '{NAME} chose the path of the Ranger.\nNot because his body was given. Because depletion had become the default he refused.\nThe Awakening had begun.',
    WLT:   '{NAME} chose the path of the Merchant.\nNot because comfort was the goal. Because dependence had been seen for what it was.\nThe Awakening had begun.',
    SAGE:  '{NAME} walked all six paths.\nNot because he was lucky. Because he refused to specialize before knowing himself.\nThe Awakening had begun.',
  };

  const CLASSES = {
    CIVILIAN: { emoji: '🧍', name: 'Civilian', color: '#6b7280', desc: "You haven't been awakened yet. Train any stat to Lv5 to find your path." },
    STR:   { emoji: '⚔️',  name: 'Warrior',  color: '#ef4444', desc: 'You build your body like a fortress. Discipline is your weapon.' },
    VIT:   { emoji: '🏹',  name: 'Ranger',   color: '#22c55e', desc: 'Your body is your temple. Recovery and endurance are your edge.' },
    INT:   { emoji: '🧙',  name: 'Mage',     color: '#3b82f6', desc: 'Your mind is your greatest asset. Knowledge compounds like interest.' },
    FOCUS: { emoji: '🥷',  name: 'Assassin', color: '#475569', desc: 'Precise, locked in, distraction-proof. You operate in silence.' },
    WILL:  { emoji: '🛡️', name: 'Paladin',  color: '#f97316', desc: "Unbreakable. You do what others won't on the days they can't." },
    WLT:   { emoji: '👑',  name: 'Merchant', color: '#f59e0b', desc: 'Every day is an investment. You play the long financial game.' },
    SAGE:  { emoji: '🌟',  name: 'Sage',     color: '#8b5cf6', desc: 'No single path defines you. You are building a complete human.' },
  };
  const CLASS_LV5_THRESHOLD = 5;
  const CLASS_SHIFT_DOMINANCE = 1.20;  // 20%+ over current class to shift
  const CLASS_BALANCE_RATIO   = 0.85;  // within 15% across all 6 stats → Sage

  // Custom habits are user-authored. They're locked at Medium (3 XP) so they
  // can't game the rank economy. The cap keeps the curated 49 as the
  // canonical path — customs are bonus tracking, not a parallel system.
  const MAX_CUSTOM_HABITS    = 5;
  const CUSTOM_HABIT_DIFFICULTY = 'medium';

  const EMOJIS = [
    '🏃','💪','🧘','🚴','🏊','🏋️',
    '💧','🥗','🍎','😴','💊','🧠',
    '📚','✍️','💻','📝','🎯','📖',
    '🌱','⭐','🔥','✨','🌟','🏆',
    '☀️','🌙','🎵','🎨','❤️','🐶',
  ];

  // ── STATE ──────────────────────────────────────────────────
  let habits = [];
  let completions = {};
  let streaks = {};
  let totalPoints = 0;
  let habitNotes = {}; // habitId → note string
  let unlockedAchievements = new Set();
  let achievementUnlockDates = {};  // achId → 'YYYY-MM-DD' first unlock
  let today = getPTDate();
  let currentTab = 'profile';
  let editingId = null;
  let ctxHabitId = null;
  let editFormEmoji = '';
  let editFormDiff = 'easy';
  let schedHabitId = null;
  let schedFormDays = [...ALL_DAYS];
  let pickerCallback = null;
  let achQueue = [];
  let achPopupTimer = null;
  let levelUpQueue = [];
  let levelUpActive = false;
  let needsOnboarding = false;
  let needsWelcome    = false;
  let obSelected = new Set();
  let obConfig   = new Map(); // index → config for habits configured during onboarding
  let selectedPackId  = null;
  let stats = {};
  let statBonuses = new Set();
  let playerName = 'Hunter';
  let perfectStreak = { count: 0, lastDate: null, prevCount: 0, prevLastDate: null };
  let psAwarded = new Set();
  let compoundStreaks  = {}; // packId → { streak, lastDate }
  let compoundAwarded = {}; // packId → date (last award date, prevents double-award)
  let personalRecords  = {}; // prId → { value, meta, lastUpdated }

  // ── STREAK FORGIVENESS ─────────────────────────────────
  // Layer 1: Shields earned via 14-day pack streaks, max 3 per pack
  let streakShields    = {}; // packId → integer count (0..3)
  let shieldClaimedAt  = {}; // packId → highest streak count where a shield was earned (so we don't double-grant on re-roll)
  let pendingShieldNotices = []; // [{ packId, absorbedDate, streak, remaining }] — banners to show on next open
  // Layer 2: Honest Day — explicit user-chosen rest, 1/month/pack
  let honestDays       = {}; // packId → ['YYYY-MM-DD', ...] — every Honest Rest day ever
  // Layer 3: Resilience — pending comeback flag + tracking
  let pendingComeback  = null; // null | { packId, brokenStreak, breakDate } — set on real break
  let lastActiveDate   = null; // last 'YYYY-MM-DD' the user completed any habit
  let totalComebacks   = 0;    // lifetime count
  let streakBreakLog   = [];   // [{ packId, date, brokenStreak }] last 60 entries
  // Two-chapter origin: Chapter 1 at onboarding, Chapter 2 at awakening
  let originBeginning  = null; // { text, dateISO, dateDisplay, migrated? } | null
  let originAwakening  = null; // { text, classKey, dateISO, dateDisplay, migrated? } | null
  let _prCelebrationQueue = [];   // [{ prId, newValue, prevValue, meta, mode }]
  let _prCelebrationActive = false;
  let _suppressPRCelebrations = false; // true during migration backfill
  let histViewYear   = 0;
  let histViewMonth  = 0;
  let histViewMode   = 'weekly'; // 'weekly' | 'monthly' | 'yearly' | 'achievements'
  let histWeekOffset = 0;        // 0 = current week, negative = past
  let currentClass  = null; // null = unset (first run)

  // ── DATE ──────────────────────────────────────────────────
  function getPTDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  }

  // Device-local "YYYY-MM-DD" — used by features whose semantics are
  // "the user's current calendar day" rather than the PT-anchored
  // streak day. Notifications, sleep windows, and the Daily Insight
  // card all use this. Sleep window currently inlines its own
  // equivalent; that's flagged for cleanup but kept as-is for now to
  // minimize churn in the v1.1.5 release.
  function getDeviceLocalDate() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // Calendar-day count from origin → today (device-local). Returns
  // 1 on the user's first day, 2 the next day, etc. Returns null if
  // the user has no origin record (very edge-case — onboarding
  // failed to write hb_origin_beginning, or the user hand-cleared it).
  // Used by the Daily Insight header ("DAY 11").
  function getDaysSinceOrigin() {
    if (!originBeginning || !originBeginning.dateISO) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(originBeginning.dateISO);
    if (!m) return null;
    const origin = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffMs = today - origin;
    if (diffMs < 0) return null;
    return Math.round(diffMs / 86400000) + 1;
  }

  function prevDay(dateStr) {
    const ms = Date.parse(dateStr + 'T20:00:00Z');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(ms - 86_400_000));
  }

  function formatDisplayDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function getTodayDayName() {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date());
  }

  function isWeekend() {
    const day = getTodayDayName();
    return day === 'Fri' || day === 'Sat' || day === 'Sun';
  }

  function isScheduledToday(habit) {
    if (!habit.days || habit.days.length === 7) return true;
    return habit.days.includes(getTodayDayName());
  }

  function nextDay(dateStr) {
    const ms = Date.parse(dateStr + 'T12:00:00Z');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(ms + 86_400_000));
  }

  function isScheduledOn(days, dateStr) {
    if (!days || days.length === 7) return true;
    const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' })
      .format(new Date(dateStr + 'T12:00:00Z'));
    return days.includes(name);
  }

  // ── NO ALCOHOL WEEKEND CHALLENGE ─────────────────────────

  // Returns { fri, sat, sun } date strings for the weekend containing today.
  // Returns null if today is not Fri/Sat/Sun.
  function getWeekendDates() {
    const day = getTodayDayName();
    if (day === 'Fri') return { fri: today, sat: nextDay(today),             sun: nextDay(nextDay(today)) };
    if (day === 'Sat') return { fri: prevDay(today),             sat: today, sun: nextDay(today) };
    if (day === 'Sun') return { fri: prevDay(prevDay(today)), sat: prevDay(today), sun: today };
    return null;
  }

  // Returns true if the "No alcohol" habit was completed on the given date string.
  function noAlcoholDoneOn(dateStr) {
    const nah = habits.find(h => h.name === 'No alcohol');
    if (!nah) return false;
    return (completions[dateStr] || []).includes(nah.id);
  }

  // Returns badge config { text, cls } for the No Alcohol card today, or null.
  function getNoAlcoholBadge() {
    const day     = getTodayDayName();
    const weekend = getWeekendDates();
    if (!weekend) return null;
    if (day === 'Fri') {
      return { text: 'Weekend Challenge Starts', cls: 'na-badge-start' };
    }
    if (day === 'Sat') {
      // If Friday was missed, stay quiet — the streak forgiveness ethos
      // doesn't shame misses, it celebrates progress. No badge today.
      if (!noAlcoholDoneOn(weekend.fri)) return null;
      return { text: 'Day 2 of 3', cls: 'na-badge-progress' };
    }
    if (day === 'Sun') {
      const friOk = noAlcoholDoneOn(weekend.fri);
      const satOk = noAlcoholDoneOn(weekend.sat);
      if (friOk && satOk) return { text: 'Final Day — Complete for 30 XP', cls: 'na-badge-final' };
      // Challenge can no longer complete — show nothing rather than a
      // shame badge. The card still works as a normal habit.
      return null;
    }
    return null;
  }

  // Called after checking "No alcohol" on Sunday. Awards 30 XP if Fri+Sat+Sun all done.
  function checkWeekendChallenge(id) {
    if (getTodayDayName() !== 'Sun') return;
    const nah = habits.find(h => h.name === 'No alcohol');
    if (!nah || nah.id !== id) return;
    const weekend = getWeekendDates();
    if (!noAlcoholDoneOn(weekend.fri) || !noAlcoholDoneOn(weekend.sat)) return;

    const bonusKey = 'hb_wc_' + weekend.fri;
    if (localStorage.getItem(bonusKey)) return; // already awarded this weekend

    localStorage.setItem(bonusKey, '1');
    totalPoints += 30;
    save();
    renderRank();
    achQueue.push({
      label: 'WEEKEND WARRIOR',
      icon:  '🏆',
      name:  'Weekend Challenge Complete!',
      desc:  '+30 XP Bonus Awarded',
    });
    if (!levelUpActive && !achPopupTimer) drainAchQueue();
  }

  // ── WEEKEND WARRIOR BANNER + SHEET ───────────────────────
  // The Double XP banner on the Habits tab is tappable. Two states
  // depending on whether "No alcohol" is in the user's active list.

  function userHasNoAlcohol() {
    return habits.some(h => h.name === 'No alcohol');
  }

  // Returns 'complete' | 'missed' | 'pending' | 'future' for a given
  // weekend date (Fri/Sat/Sun). Used to render the State B progress rows.
  function getWeekendDayStatus(dateStr) {
    if (!dateStr) return 'future';
    if (dateStr > today) return 'future';
    const done = noAlcoholDoneOn(dateStr);
    if (done) return 'complete';
    if (dateStr === today) return 'pending';
    return 'missed';
  }

  function _wwStatusBadge(status) {
    switch (status) {
      case 'complete': return '<span class="ww-status ww-status--complete">✓ Complete</span>';
      case 'missed':   return '<span class="ww-status ww-status--missed">✗ Missed</span>';
      case 'pending':  return '<span class="ww-status ww-status--pending">○ Pending</span>';
      default:         return '<span class="ww-status ww-status--future">— Future</span>';
    }
  }

  function _wwRewardLine(friSt, satSt, sunSt) {
    const completed = [friSt, satSt, sunSt].filter(s => s === 'complete').length;
    const missed    = [friSt, satSt, sunSt].some(s => s === 'missed');
    const possible  = [friSt, satSt, sunSt].filter(s => s !== 'missed').length;

    if (completed === 3) {
      return '<div class="ww-reward ww-reward--earned">+30 XP earned — Weekend Warrior unlocked</div>';
    }
    if (missed && possible < 3) {
      return '<div class="ww-reward ww-reward--locked">Bonus locked for this weekend — try again next Friday</div>';
    }
    return '<div class="ww-reward">Finish all 3 nights to earn +30 XP</div>';
  }

  // Renders the popup body based on current state. Called on open AND
  // after a State A → State B transition (when user adds No alcohol).
  function renderWeekendWarriorBody() {
    const titleEl = document.getElementById('ww-title');
    const bodyEl  = document.getElementById('ww-body');
    if (!titleEl || !bodyEl) return;

    const hasIt = userHasNoAlcohol();

    if (!hasIt) {
      // ── State A: rules + Add CTA ────────────────────────
      titleEl.textContent = 'Weekend Warrior Challenge';
      bodyEl.innerHTML =
        '<p class="ww-rules">Complete <b>No alcohol</b> all three nights — Friday, Saturday, and Sunday — to earn <b>+30 bonus XP</b> on Sunday.</p>' +
        '<p class="ww-rules">Plus: every habit completed Fri-Sun earns <b>Double XP</b>.</p>' +
        '<button id="ww-add-btn" class="ww-add-btn">+ Add No Alcohol to my habits</button>';

      const addBtn = document.getElementById('ww-add-btn');
      if (addBtn) addBtn.addEventListener('click', addNoAlcoholFromWWBanner);
      return;
    }

    // ── State B: live Fri/Sat/Sun progress ─────────────────
    titleEl.textContent = 'Weekend Warrior Active';
    const w = getWeekendDates();
    if (!w) {
      bodyEl.innerHTML = '<p class="ww-rules">The Weekend Warrior challenge runs Friday through Sunday.</p>';
      return;
    }
    const friSt = getWeekendDayStatus(w.fri);
    const satSt = getWeekendDayStatus(w.sat);
    const sunSt = getWeekendDayStatus(w.sun);

    bodyEl.innerHTML =
      '<div class="ww-progress-list">' +
        '<div class="ww-day-row"><span class="ww-day-name">Friday</span>'   + _wwStatusBadge(friSt) + '</div>' +
        '<div class="ww-day-row"><span class="ww-day-name">Saturday</span>' + _wwStatusBadge(satSt) + '</div>' +
        '<div class="ww-day-row"><span class="ww-day-name">Sunday</span>'   + _wwStatusBadge(sunSt) + '</div>' +
      '</div>' +
      _wwRewardLine(friSt, satSt, sunSt);
  }

  function openWeekendWarriorSheet() {
    const overlay = document.getElementById('ww-overlay');
    const sheet   = document.getElementById('ww-sheet');
    console.log('[WW] openWeekendWarriorSheet', {
      overlay: !!overlay,
      sheet:   !!sheet,
      hasNoAlcohol: userHasNoAlcohol(),
    });
    if (!overlay || !sheet) {
      console.warn('[WW] Popup elements missing — index.html may be a stale cached version. Try hard refresh / reinstall.');
      return;
    }
    renderWeekendWarriorBody();
    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');
    console.log('[WW] Sheet shown');
  }

  function closeWeekendWarriorSheet() {
    document.getElementById('ww-overlay').classList.add('hidden');
    document.getElementById('ww-sheet').classList.add('hidden');
  }

  // Adds the canonical "No alcohol" habit (idempotent) and transitions
  // the popup from State A → State B with a small confirmation flash.
  function addNoAlcoholFromWWBanner() {
    if (userHasNoAlcohol()) {
      renderWeekendWarriorBody();
      updateDoubleXpBanner();
      return;
    }
    const def = DEFAULT_HABITS.find(d => d.name === 'No alcohol');
    if (!def) return;
    const newH = {
      id:          uid(),
      emoji:       def.emoji,
      name:        def.name,
      difficulty:  def.difficulty,
      type:        def.type || 'build',
      primaryStat: def.primaryStat,
    };
    habits.push(newH);
    if (def.note) habitNotes[newH.id] = def.note;
    save();
    renderHabits();
    updateDoubleXpBanner();

    // Brief "Added! ✓" flash, then transition popup body to State B
    const bodyEl = document.getElementById('ww-body');
    if (bodyEl) {
      bodyEl.innerHTML =
        '<div class="ww-added-flash">Added! ✓</div>' +
        '<p class="ww-rules" style="text-align:center">No alcohol — let the Weekend Warrior begin.</p>';
      setTimeout(renderWeekendWarriorBody, 900);
    }

    showHabitToast('No alcohol added — let the Weekend Warrior begin');
  }

  // Updates the Habits-tab Double XP banner: visibility, text, and active
  // state styling. Called on render() and after habit changes.
  function updateDoubleXpBanner() {
    const el = document.getElementById('double-xp-banner');
    if (!el) return;
    if (!isWeekend()) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    // innerHTML so the streak icon can render. streakify() escapes the
    // surrounding text, so this is safe even if upstream copy ever
    // includes user-generated content (it doesn't, but defensive).
    if (userHasNoAlcohol()) {
      el.classList.add('dxb--active');
      el.innerHTML = streakify('⚡ Weekend Warrior active — +30 XP if you finish all 3 nights 🔥', 16);
    } else {
      el.classList.remove('dxb--active');
      el.innerHTML = streakify('⚡ DOUBLE XP WEEKEND 🔥', 16);
    }
  }

  function setupDoubleXpBanner() {
    const el      = document.getElementById('double-xp-banner');
    const overlay = document.getElementById('ww-overlay');
    const sheet   = document.getElementById('ww-sheet');
    const closeBtn = document.getElementById('ww-close-btn');

    // Diagnostic logging — leave in for now per spec, user verifies in DevTools
    console.log('[WW] setupDoubleXpBanner called', {
      banner:  !!el,
      overlay: !!overlay,
      sheet:   !!sheet,
      closeBtn:!!closeBtn,
    });

    // CRITICAL FIX: previously this function early-returned if any popup
    // element was missing, silently abandoning the banner click handler.
    // Now we attach the click handler unconditionally — popup elements
    // are checked at click time inside openWeekendWarriorSheet.
    if (!el) {
      console.warn('[WW] #double-xp-banner not found — banner cannot be wired');
      return;
    }

    // Use BOTH click and pointerup. iOS Safari sometimes fails to fire
    // click after a :hover style is applied (the "first tap eats hover"
    // bug). pointerup fires reliably and we de-dupe via a flag.
    let _wwHandlingTap = false;
    function bannerActivate(e) {
      if (_wwHandlingTap) return;
      _wwHandlingTap = true;
      setTimeout(() => { _wwHandlingTap = false; }, 350);
      console.log('[WW] Banner tapped — opening Weekend Warrior sheet');
      if (e && e.preventDefault) e.preventDefault();
      openWeekendWarriorSheet();
    }
    el.addEventListener('click',     bannerActivate);
    el.addEventListener('pointerup', bannerActivate);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        bannerActivate(e);
      }
    });
    console.log('[WW] click + pointerup handlers attached to #double-xp-banner');

    if (overlay) overlay.addEventListener('click', closeWeekendWarriorSheet);
    if (closeBtn) closeBtn.addEventListener('click', closeWeekendWarriorSheet);

    // Reuse the swipe-down gesture utility
    if (sheet && overlay && typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, () => {
        sheet.classList.add('hidden');
        overlay.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.ww-drag-handle, .ww-header',
        scrollTarget:   '.ww-body',
      });
    }

    // ESC dismiss on desktop
    document.addEventListener('keydown', e => {
      if (sheet && e.key === 'Escape' && !sheet.classList.contains('hidden')) {
        closeWeekendWarriorSheet();
      }
    });
  }

  // Shows a one-time Friday challenge banner (once per Friday day, per device).
  function setupFridayBanner() {
    if (getTodayDayName() !== 'Fri') return;
    const bannerKey = 'hb_fri_banner_' + today;
    if (localStorage.getItem(bannerKey)) return;

    const nah      = habits.find(h => h.name === 'No alcohol');
    const day1Done = nah && (completions[today] || []).includes(nah.id);
    const msg      = day1Done
      ? 'Day 1 complete. Come back Saturday to continue your Weekend Challenge.'
      : 'The Weekend Challenge has begun, Hunter. No alcohol Friday, Saturday, and Sunday earns you 30 bonus XP. Your discipline this weekend defines your rank. Will you claim the reward?';

    const overlay = document.getElementById('fri-challenge-overlay');
    const modal   = document.getElementById('fri-challenge-modal');
    document.getElementById('fri-challenge-msg').textContent = msg;
    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');

    const dismiss = () => {
      localStorage.setItem(bannerKey, '1');
      overlay.classList.add('hidden');
      modal.classList.add('hidden');
    };
    document.getElementById('fri-challenge-close').addEventListener('click', dismiss);
    document.getElementById('fri-challenge-action').addEventListener('click', dismiss);
    overlay.addEventListener('click', dismiss);
  }

  // Returns true if there is at least one scheduled day strictly between fromDate and toDate
  // (meaning the user could have missed a scheduled day)
  function hasScheduledDayBetween(days, fromDate, toDate) {
    if (!days || days.length === 7) return nextDay(fromDate) < toDate;
    let d = nextDay(fromDate);
    while (d < toDate) {
      if (isScheduledOn(days, d)) return true;
      d = nextDay(d);
    }
    return false;
  }

  // ── DEFAULT HABITS (first install only) ──────────────────
  // 49 habits across 7 categories. Indices drive OB_CATEGORIES and PACKS.
  const DEFAULT_HABITS = [
    // ── 💪 Physical Performance (0–10) ──────────────────────
    { emoji: '💧', name: 'Hydrate',                                   difficulty: 'easy'                },  // 0
    { emoji: '😴', name: 'Sleep',                                     difficulty: 'medium'              },  // 1
    { emoji: '🌙', name: 'Sleep before midnight',                     difficulty: 'medium'              },  // 2
    { emoji: '🏃', name: 'Cardio workout',                            difficulty: 'medium'              },  // 3
    { emoji: '🏋️', name: 'Strength training',                        difficulty: 'hard'                },  // 4
    { emoji: '⚡', name: 'Sprint session',                            difficulty: 'hard'                },  // 5
    { emoji: '🚶', name: 'Daily walk',                                difficulty: 'easy'                },  // 6
    { emoji: '🧊', name: 'Ice bath or cold plunge',                   difficulty: 'hard'                },  // 7
    { emoji: '🚿', name: 'Cold shower',                               difficulty: 'medium'              },  // 8
    { emoji: '🤸', name: 'Mobility & Stretching',                     difficulty: 'easy'                },  // 9
    { emoji: '🥩', name: 'Protein goal',                              difficulty: 'medium'              },  // 10
    // ── 🧠 Mental & Focus (11–18) ───────────────────────────
    { emoji: '📖', name: 'Read',                                      difficulty: 'easy'                },  // 11
    { emoji: '🧠', name: 'Meditate & Breathwork',                     difficulty: 'medium'              },  // 12
    { emoji: '✍️', name: 'Journal',                                   difficulty: 'easy'                },  // 13
    { emoji: '📵', name: 'No phone or social media after waking',     difficulty: 'medium', type: 'quit'},  // 14
    { emoji: '🎯', name: 'Review daily goals/intentions',             difficulty: 'easy'                },  // 15
    { emoji: '🌞', name: 'Get morning sunlight',                      difficulty: 'easy'                },  // 16
    { emoji: '📵', name: 'No social media before noon',               difficulty: 'medium', type: 'quit'},  // 17
    { emoji: '😴', name: 'No screens 1 hour before bed',             difficulty: 'medium', type: 'quit'},  // 18
    // ── 🥗 Nutrition (19–22) ────────────────────────────────
    { emoji: '🥗', name: 'Whole foods diet',                          difficulty: 'medium'              },  // 19
    { emoji: '❌', name: 'No sugar/junk food',                        difficulty: 'hard',   type: 'quit'},  // 20
    { emoji: '🍺', name: 'No alcohol',                                difficulty: 'medium', type: 'quit',  // 21
      note: '🏆 Weekend Challenge Bonus: Complete Friday, Saturday, AND Sunday alcohol-free to earn +30 bonus XP on Sunday. The hardest nights to stay disciplined are worth the most.' },
    { emoji: '☕', name: 'No caffeine',                               difficulty: 'medium', type: 'quit'},  // 22
    // ── ⚡ Discipline & Productivity (23–30) ────────────────
    { emoji: '🌅', name: 'Wake up at consistent time',               difficulty: 'medium'              },  // 23
    { emoji: '✅', name: 'Complete your #1 priority task',           difficulty: 'hard'                },  // 24
    { emoji: '📋', name: 'Plan tomorrow the night before',           difficulty: 'easy'                },  // 25
    { emoji: '🧹', name: 'Tidy/clean space',                         difficulty: 'easy'                },  // 26
    { emoji: '📱', name: 'Under 1 hour screen time',                 difficulty: 'hard',   type: 'quit'},  // 27
    { emoji: '🧹', name: 'Digital declutter',                        difficulty: 'easy'                },  // 28
    { emoji: '🚫', name: 'No doomscrolling until after 5PM',         difficulty: 'medium', type: 'quit'},  // 29
    { emoji: '🎯', name: 'Review your long term goals',              difficulty: 'easy'                },  // 30
    // ── 💰 Financial & Growth (31–34) ───────────────────────
    { emoji: '📊', name: 'Track finances & net worth',               difficulty: 'easy'                },  // 31
    { emoji: '🌐', name: 'Work on a side project or business',       difficulty: 'hard'                },  // 32
    { emoji: '📈', name: 'Review investments or trading journal',    difficulty: 'medium'              },  // 33
    { emoji: '💡', name: 'Generate one new business or content idea',difficulty: 'easy'                },  // 34
    // ── 🎯 Learning & Skills (35–40) ────────────────────────
    { emoji: '🎧', name: 'Educational podcast',                      difficulty: 'easy'                },  // 35
    { emoji: '✏️', name: 'Practice a skill',                        difficulty: 'medium'              },  // 36
    { emoji: '🃏', name: 'Flashcard review',                         difficulty: 'easy'                },  // 37
    { emoji: '📝', name: 'Write down lessons learned',               difficulty: 'easy'                },  // 38
    { emoji: '📚', name: 'Learn something new',                      difficulty: 'medium'              },  // 39
    { emoji: '🗣️', name: 'Language learning',                       difficulty: 'medium'              },  // 40
    // ── 🌱 Wellbeing & Relationships (41–48) ────────────────
    { emoji: '🙏', name: 'Morning gratitude practice',               difficulty: 'easy'                },  // 41
    { emoji: '🙏', name: 'Pray or set intentions',                   difficulty: 'easy'                },  // 42
    { emoji: '📞', name: 'Call or text a family member',             difficulty: 'easy'                },  // 43
    { emoji: '🤲', name: 'Do something kind for someone',            difficulty: 'easy'                },  // 44
    { emoji: '🦶', name: 'Barefoot grounding outside',               difficulty: 'easy'                },  // 45
    { emoji: '💊', name: 'Vitamins and minerals',                    difficulty: 'easy'                },  // 46
    { emoji: '🧘', name: 'Visualization practice',                   difficulty: 'medium'              },  // 47
    { emoji: '🌙', name: 'Sleep early before 11PM',                  difficulty: 'medium'              },  // 48
  ];

  const OB_CATEGORIES = [
    { label: 'Physical Performance',      start: 0,  end: 11 },
    { label: 'Mental & Focus',            start: 11, end: 19 },
    { label: 'Nutrition',                 start: 19, end: 23 },
    { label: 'Discipline & Productivity', start: 23, end: 31 },
    { label: 'Financial & Growth',        start: 31, end: 35 },
    { label: 'Learning & Skills',         start: 35, end: 41 },
    { label: 'Wellbeing & Relationships', start: 41, end: 49 },
  ];

  // ── PRIMARY STAT MAP ─────────────────────────────────────
  // Single source of truth for each habit's primary stat (drives the
  // History view's cell colors). The History tab is the only place this
  // map is read for visuals — every habit's `primaryStat` field is
  // derived from this map at startup.
  const HABIT_PRIMARY_STAT = {
    // STR (red)
    'Strength training': 'STR', 'Sprint session': 'STR', 'Mobility & Stretching': 'STR',
    'Cardio workout': 'STR', 'Cold shower': 'STR', 'Ice bath or cold plunge': 'STR',
    // VIT (pink)
    'Hydrate': 'VIT', 'Sleep': 'VIT', 'Sleep before midnight': 'VIT',
    'Sleep early before 11PM': 'VIT', 'Vitamins and minerals': 'VIT', 'Daily walk': 'VIT',
    'Whole foods diet': 'VIT', 'Protein goal': 'VIT', 'No sugar/junk food': 'VIT',
    'No alcohol': 'VIT', 'No caffeine': 'VIT', 'Barefoot grounding outside': 'VIT',
    'Call or text a family member': 'VIT', 'Do something kind for someone': 'VIT',
    // INT (blue)
    'Read': 'INT', 'Educational podcast': 'INT', 'Learn something new': 'INT',
    'Language learning': 'INT', 'Flashcard review': 'INT', 'Practice a skill': 'INT',
    'Write down lessons learned': 'INT',
    // FOCUS (yellow)
    'Meditate & Breathwork': 'FOCUS', 'Get morning sunlight': 'FOCUS',
    'No phone or social media after waking': 'FOCUS', 'No social media before noon': 'FOCUS',
    'No screens 1 hour before bed': 'FOCUS', 'Under 1 hour screen time': 'FOCUS',
    'No doomscrolling until after 5PM': 'FOCUS', 'Digital declutter': 'FOCUS',
    'Complete your #1 priority task': 'FOCUS',
    // WILL (orange)
    'Wake up at consistent time': 'WILL', 'Plan tomorrow the night before': 'WILL',
    'Tidy/clean space': 'WILL', 'Review daily goals/intentions': 'WILL',
    'Review your long term goals': 'WILL', 'Journal': 'WILL',
    'Visualization practice': 'WILL', 'Morning gratitude practice': 'WILL',
    'Pray or set intentions': 'WILL',
    // WLT (gold)
    'Track finances & net worth': 'WLT', 'Work on a side project or business': 'WLT',
    'Review investments or trading journal': 'WLT',
    'Generate one new business or content idea': 'WLT',
  };
  // Enrich each habit definition with its primary stat — single source of truth
  DEFAULT_HABITS.forEach(h => { h.primaryStat = HABIT_PRIMARY_STAT[h.name] || 'FOCUS'; });

  // ── HABIT ICONS ──────────────────────────────────────────
  // Custom DALL-E PNG icons for the canonical Morning Routine + Locked-In
  // habits. Habit name is the foreign key (matches DEFAULT_HABITS exactly).
  // Habits not listed here keep their emoji. Custom user habits ALWAYS
  // keep their emoji — they're never looked up here.
  //
  // Mirrors the STATS[].iconImg pattern. Files live in assets/habit-icons/
  // and are cached by sw.js. See `getHabitIcon`, `habitIconHtml`,
  // `setHabitIcon` near `statIconHtml` for render helpers.
  const HABIT_ICONS = {
    // ── Physical Performance ──
    'Hydrate':                              'assets/habit-icons/icon-water.png',
    'Sleep':                                'assets/habit-icons/icon-sleep.png',
    'Sleep before midnight':                'assets/habit-icons/icon-sleep.png',
    'Cardio workout':                       'assets/habit-icons/icon-cardio.png',
    'Strength training':                    'assets/habit-icons/icon-strength.png',
    'Sprint session':                       'assets/habit-icons/icon-sprint.png',
    'Daily walk':                           'assets/habit-icons/icon-walk.png',
    'Ice bath or cold plunge':              'assets/habit-icons/icon-cold.png',
    'Cold shower':                          'assets/habit-icons/icon-cold.png',
    'Mobility & Stretching':                'assets/habit-icons/icon-mobility.png',
    'Protein goal':                         'assets/habit-icons/icon-protein.png',

    // ── Mental & Focus ──
    'Read':                                 'assets/habit-icons/icon-read.png',
    'Meditate & Breathwork':                'assets/habit-icons/icon-meditate.png',
    'Journal':                              'assets/habit-icons/icon-journal.png',
    'No phone or social media after waking':'assets/habit-icons/icon-nophone.png',
    'Review daily goals/intentions':        'assets/habit-icons/icon-target.png',
    'Get morning sunlight':                 'assets/habit-icons/icon-sunlight.png',
    'No social media before noon':          'assets/habit-icons/icon-nosocial.png',
    'No screens 1 hour before bed':         'assets/habit-icons/icon-noscreen-bed.png',

    // ── Nutrition ──
    'Whole foods diet':                     'assets/habit-icons/icon-nutrition.png',
    'No sugar/junk food':                   'assets/habit-icons/icon-nosugar.png',
    'No alcohol':                           'assets/habit-icons/icon-noalcohol.png',
    'No caffeine':                          'assets/habit-icons/icon-nocaffeine.png',

    // ── Discipline & Productivity ──
    'Wake up at consistent time':           'assets/habit-icons/icon-wake.png',
    'Complete your #1 priority task':       'assets/habit-icons/icon-priority.png',
    'Plan tomorrow the night before':       'assets/habit-icons/icon-plan-tomorrow.png',
    'Tidy/clean space':                     'assets/habit-icons/icon-tidy.png',
    'Under 1 hour screen time':             'assets/habit-icons/icon-screen-cap.png',
    'Digital declutter':                    'assets/habit-icons/icon-tidy.png',
    'No doomscrolling until after 5PM':     'assets/habit-icons/icon-nodoomscroll.png',
    'Review your long term goals':          'assets/habit-icons/icon-target.png',

    // ── Financial & Growth ──
    'Track finances & net worth':           'assets/habit-icons/icon-finance.png',
    'Work on a side project or business':   'assets/habit-icons/icon-business.png',
    'Review investments or trading journal':'assets/habit-icons/icon-finance.png',
    'Generate one new business or content idea': 'assets/habit-icons/icon-business.png',

    // ── Learning & Skills ──
    'Educational podcast':                  'assets/habit-icons/icon-podcast.png',
    'Practice a skill':                     'assets/habit-icons/icon-learning.png',
    'Flashcard review':                     'assets/habit-icons/icon-learning.png',
    'Write down lessons learned':           'assets/habit-icons/icon-journal.png',
    'Learn something new':                  'assets/habit-icons/icon-learning.png',
    'Language learning':                    'assets/habit-icons/icon-learning.png',

    // ── Wellbeing & Relationships ──
    'Morning gratitude practice':           'assets/habit-icons/icon-gratitude.png',
    'Pray or set intentions':               'assets/habit-icons/icon-pray.png',
    'Call or text a family member':         'assets/habit-icons/icon-connection.png',
    'Do something kind for someone':        'assets/habit-icons/icon-connection.png',
    'Barefoot grounding outside':           'assets/habit-icons/icon-grounding.png',
    'Vitamins and minerals':                'assets/habit-icons/icon-vitamins.png',
    'Visualization practice':               'assets/habit-icons/icon-visualize.png',
    'Sleep early before 11PM':              'assets/habit-icons/icon-sleep.png',
  };

  // ── CLASS ICONS ──────────────────────────────────────────
  // Custom DALL-E art for the 8 class emblems. Renders in the Status
  // hero class line, class popup, awakening celebration, class-choice
  // screen, and origin Chapter-2 badge. Falls back to nothing if the
  // class id isn't mapped (no broken image).
  const CLASS_ICONS = {
    'CIVILIAN': 'assets/habit-icons/icon-class-civilian.png',
    'STR':      'assets/habit-icons/icon-class-warrior.png',
    'VIT':      'assets/habit-icons/icon-class-ranger.png',
    'INT':      'assets/habit-icons/icon-class-mage.png',
    'FOCUS':    'assets/habit-icons/icon-class-assassin.png',
    'WILL':     'assets/habit-icons/icon-class-paladin.png',
    'WLT':      'assets/habit-icons/icon-class-merchant.png',
    'SAGE':     'assets/habit-icons/icon-class-sage.png',
  };
  function classIconHtml(classKey, opts) {
    opts = opts || {};
    const path = CLASS_ICONS[classKey];
    if (!path) return '';
    const sz  = opts.size || 24;
    const cls = 'class-icon-img' + (opts.cls ? ' ' + opts.cls : '');
    return '<img class="' + cls + '" src="' + path + '" alt="" ' +
           'style="width:' + sz + 'px;height:' + sz + 'px" ' +
           'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
  }

  // ── DAILY CHECK-IN ───────────────────────────────────────
  // Single 7 PM local-time notification (shifted from 6 PM in v2.0.1)
  // that acknowledges the user's progress on today's habits. Five progress states × 5 variations
  // each = 25 unique copy strings. Re-scheduled on every meaningful
  // state change so the body reflects current progress at fire time.
  // (Sits alongside the morning digest and per-habit reminders, but
  // has its own reserved notification ID and bypasses the per-habit
  // daily limit. Subject to: master disable, pause, quiet hours, and
  // a "Day 1" suppression so brand-new users aren't overwhelmed.)
  const CHECKIN_TIME = '19:00';
  const CHECKIN_NOTIF_ID = 99999; // reserved; out of typical djb2 hash range
  // Mid-day check-in (v2.0.1) — 1 PM nudge surfacing the highest-
  // priority signal: unclaimed souls bonus → at-risk streak → caught-up.
  // Skipped entirely if user has zero habits.
  const MIDDAY_TIME = '13:00';
  const MIDDAY_NOTIF_ID = 99998; // reserved; out of typical djb2 hash range, distinct from CHECKIN

  const CHECKIN_COPY = {
    complete: [
      'All trials cleared, Hunter. Rest well.',
      'Day complete. Every trial honored.',
      'Perfect day in motion. Well done, Hunter.',
      'All habits cleared. The night is yours.',
      'Day mastered. Rest, Hunter — you earned it.',
    ],
    high: [
      '{N} cleared, {M} remain. Finish strong.',
      'Almost there, Hunter. {M} trials left.',
      '{N}/{TOTAL} done. Close the day clean.',
      '{M} trials between you and a perfect day.',
      'So close, Hunter. {M} left.',
    ],
    mid: [
      '{N} trials honored. {M} await.',
      'Halfway, Hunter. The day is still yours.',
      '{N}/{TOTAL} cleared. Keep moving.',
      'Solid progress. {M} trials remain.',
      'The path continues. {M} left.',
    ],
    low: [
      'The day is still open, Hunter.',
      'Even one more trial counts.',
      'Pick one, Hunter. Begin.',
      'Small steps still count. The path remains.',
      "The night isn't here yet. One trial, then another.",
    ],
    none: [
      "The day isn't done. Choose one.",
      "One trial, Hunter. That's all it takes.",
      'The path is still here. Begin.',
      'Even now, you can move forward.',
      'The day waits, Hunter. Take one step.',
    ],
  };

  function getCheckinProgressState(completed, total) {
    if (total === 0) return null;
    if (completed >= total) return 'complete';
    const pct = (completed / total) * 100;
    if (pct >= 70) return 'high';
    if (pct >= 30) return 'mid';
    if (pct > 0)   return 'low';
    return 'none';
  }

  function pickCheckinCopy(state, completed, total) {
    const variations = CHECKIN_COPY[state];
    if (!variations || !variations.length) return '';
    const text = variations[Math.floor(Math.random() * variations.length)];
    const remaining = total - completed;
    return text
      .replace('{N}', completed)
      .replace('{M}', remaining)
      .replace('{TOTAL}', total);
  }

  function getTodaysHabitProgress() {
    try {
      const t = (typeof getPTDate === 'function') ? getPTDate() : today;
      const completedIds = (completions && completions[t]) || [];
      const scheduled = Array.isArray(habits) ? habits.filter(isScheduledToday) : [];
      const completed = scheduled.filter(h => completedIds.indexOf(h.id) !== -1).length;
      return { completed, total: scheduled.length };
    } catch (_) {
      return { completed: 0, total: 0 };
    }
  }

  // Day-1 suppression — skip the check-in if the user has zero
  // historical completion days (i.e., they've never tracked a habit
  // before today). Once they complete their first habit, this returns
  // false and the check-in fires from the next 6 PM forward.
  function isDayOne() {
    try {
      if (typeof completions !== 'object' || !completions) return true;
      const days = Object.keys(completions).filter(d => (completions[d] || []).length > 0);
      return days.length === 0;
    } catch (_) {
      return false; // if anything fails, don't suppress — safer to ping
    }
  }

  // Compute next 7 PM in DEVICE-LOCAL time (matches the morning digest's
  // timezone behavior — see CLAUDE.md "Notifications fire in device-local").
  // Shifted from 6 PM in v2.0.1 to give the user the full evening window
  // before nudging.
  function computeNextCheckinDate() {
    const now    = new Date();
    const target = new Date();
    target.setHours(19, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target;
  }

  // Compute next 1 PM in DEVICE-LOCAL time. Same timezone semantics as
  // the digest + check-in. The mid-day notification re-arms whenever
  // relevant state changes (daily bonus claim, habit completion, class
  // change, etc.) so the body always reflects current priority.
  function computeNextMidDayDate() {
    const now    = new Date();
    const target = new Date();
    target.setHours(13, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target;
  }

  // Body for the 1 PM mid-day check-in. Returns null to indicate the
  // notification should be SKIPPED (priority 4 — user has zero habits).
  // Priority chain:
  //   1. Daily souls bonus not yet claimed today
  //   2. At least one incomplete habit with current streak ≥ 1
  //      (longest streak wins, ties broken by XP then alpha)
  //   3. All caught up
  //   4. No habits → skip (return null)
  function computeMidDayBody() {
    // Priority 4 — no habits configured at all.
    if (!Array.isArray(habits) || habits.length === 0) return null;

    // Priority 1 — daily souls bonus pending.
    // Souls grant uses DEVICE-LOCAL date (see tryGrantDailyLoginBonus),
    // so the comparison here must mirror that, not PT.
    try {
      const localToday = getDeviceLocalDate();
      const raw = localStorage.getItem('hb_souls');
      if (!raw) {
        // No souls state yet — bonus is implicitly unclaimed.
        return '+15 souls waiting. Tap to claim today’s bonus.';
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.lastDailyBonusDate !== localToday) {
        return '+15 souls waiting. Tap to claim today’s bonus.';
      }
    } catch (_) {}

    // Priority 2 — longest at-risk streak (incomplete habit, streak ≥ 1).
    try {
      const t = (typeof getPTDate === 'function') ? getPTDate() : today;
      const completedIds = (completions && completions[t]) || [];
      const candidates = habits
        .filter(h => (typeof isScheduledToday === 'function') ? isScheduledToday(h) : true)
        .filter(h => completedIds.indexOf(h.id) === -1)
        .map(h => ({
          habit:  h,
          streak: (streaks[h.id] && streaks[h.id].count) || 0,
        }))
        .filter(c => c.streak >= 1);
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          if (b.streak !== a.streak) return b.streak - a.streak;
          const xpA = (DIFFICULTY[a.habit.difficulty] && DIFFICULTY[a.habit.difficulty].pts) || 0;
          const xpB = (DIFFICULTY[b.habit.difficulty] && DIFFICULTY[b.habit.difficulty].pts) || 0;
          if (xpB !== xpA) return xpB - xpA;
          return String(a.habit.name).localeCompare(String(b.habit.name));
        });
        const top = candidates[0];
        return top.habit.name + ' — Day ' + top.streak + '. Don’t break the chain.';
      }
    } catch (_) {}

    // Priority 3 — all caught up.
    return 'You’re caught up. Keep it going.';
  }

  // ── PACK ICONS ───────────────────────────────────────────
  // Custom DALL-E art for the three pack/path entries at the top of
  // the Add Habits library. Keys match the rendering call sites in
  // renderLibrary(). Mirrors the HABIT_ICONS / PACK_ICONS pattern.
  const PACK_ICONS = {
    'morning':  'assets/habit-icons/icon-pack-morning.png',
    'lockedin': 'assets/habit-icons/icon-pack-lockedin.png',
    'custom':   'assets/habit-icons/icon-pack-custom.png',
  };
  function packIconHtml(packKey, opts) {
    opts = opts || {};
    const path = PACK_ICONS[packKey];
    if (!path) return '';
    const sz  = opts.size || 48;
    const cls = 'pack-icon-img' + (opts.cls ? ' ' + opts.cls : '');
    return '<img class="' + cls + '" src="' + path + '" alt="" ' +
           'style="width:' + sz + 'px;height:' + sz + 'px" ' +
           'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
  }

  // ── STREAK + XP ICONS ────────────────────────────────────
  // Custom flame + lightning icons replace the 🔥 and ⚡ emoji
  // system-wide in live UI. (Notifications, descriptions, and historical
  // WHATS_NEW entries keep the emoji — they go through non-HTML paths.)
  // The iconify() helper is a generic string transformer: pass any text
  // and it returns HTML with 🔥 / ⚡ swapped for the matching img tag,
  // escaping everything else. streakify() remains as a thin alias for
  // backward compat with earlier call sites.
  const STREAK_ICON_PATH = 'assets/habit-icons/icon-streak.png';
  const XP_ICON_PATH     = 'assets/habit-icons/icon-xp.png';

  function streakIconHtml(opts) {
    opts = opts || {};
    const sz  = opts.size || 20;
    const cls = 'streak-icon-img' + (opts.cls ? ' ' + opts.cls : '');
    return '<img class="' + cls + '" src="' + STREAK_ICON_PATH + '" alt="" ' +
           'style="width:' + sz + 'px;height:' + sz + 'px" ' +
           'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
  }
  function xpIconHtml(opts) {
    opts = opts || {};
    const sz  = opts.size || 16;
    const cls = 'xp-icon-img' + (opts.cls ? ' ' + opts.cls : '');
    return '<img class="' + cls + '" src="' + XP_ICON_PATH + '" alt="" ' +
           'style="width:' + sz + 'px;height:' + sz + 'px" ' +
           'draggable="false" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">';
  }

  // Replace every 🔥 / ⚡ in `text` with the matching img tag, escaping
  // the rest. Surrogate-pair-safe: 🔥 (U+1F525) is two code units, ⚡
  // (U+26A1) is one. We scan code points to slice cleanly.
  // Returns SAFE HTML — non-icon spans pass through esc().
  function iconify(text, opts) {
    opts = opts || {};
    const sz       = opts.size || 16;
    const fireSize = opts.fireSize || sz;
    const xpSize   = opts.xpSize   || sz;
    const s = String(text == null ? '' : text);
    if (!s) return '';
    if (s.indexOf('🔥') === -1 && s.indexOf('⚡') === -1) return esc(s);
    const fireImg = streakIconHtml({ size: fireSize });
    const xpImg   = xpIconHtml({ size: xpSize });
    let out = '';
    let buf = '';
    for (let i = 0; i < s.length; ) {
      const cp = s.codePointAt(i);
      if (cp === 0x1F525) {        // 🔥
        out += esc(buf) + fireImg; buf = ''; i += 2;
      } else if (cp === 0x26A1) {  // ⚡
        out += esc(buf) + xpImg;   buf = ''; i += 1;
      } else {
        buf += s[i]; i += 1;
      }
    }
    out += esc(buf);
    return out;
  }
  // Backward-compat alias — earlier code calls streakify(). The new
  // iconify also handles ⚡, which is a strict superset of the old behavior.
  function streakify(text, sizePx) { return iconify(text, { size: sizePx }); }

  // ── HABIT DESCRIPTIONS ───────────────────────────────────
  // One curated paragraph per habit, displayed on the View Note /
  // habit-detail sheet's "About this habit" section. Read-only —
  // single source of truth for the canonical description.
  const HABIT_DESCRIPTIONS = {
    // 💪 Physical Performance
    'Hydrate':                  'Water is the most underrated performance tool. Your brain, muscles, and recovery all depend on it.',
    'Sleep':                    'Recovery happens here. Skipping sleep is borrowing energy from tomorrow with high interest.',
    'Sleep before midnight':    'It all starts the night before. Quality sleep before midnight sets the foundation for everything.',
    'Cardio workout':           'Get your heart rate up. Sustained effort — run, bike, row, swim — for 20+ minutes. Real session, not a stroll.',
    'Strength training':        'You build your body like a fortress. Muscle is metabolic armor — protect what you build.',
    'Sprint session':           'Maximum effort, minimum time. Sprints train explosiveness and remind you what 100% feels like.',
    'Daily walk':               'Background movement matters. Hit your step goal anywhere, any pace. This is the work that compounds without you noticing.',
    'Ice bath or cold plunge':  'The cold reveals who you really are. Discomfort by choice is power.',
    'Cold shower':              'Two minutes of voluntary suffering. Trains the mind to hold under pressure.',
    'Mobility & Stretching':    "The body you'll have at 60 is built today. Mobility is the difference between aging and breaking down.",
    'Protein goal':             'Muscle is built in the kitchen. Without protein, training is just damage with no rebuild.',

    // 🧠 Mental & Focus
    'Read':                                  'The cheapest mentorship in the world. Every great mind has left their playbook for you.',
    'Meditate & Breathwork':                 "The space between stimulus and response is where your power lives. Breathwork builds that space.",
    'Journal':                               "Thoughts you don't write down own you. Thoughts you write down, you own.",
    'No phone or social media after waking': "The first hour shapes the day. Don't hand it to algorithms before you've claimed it for yourself.",
    'Review daily goals/intentions':         'Direction beats motion. Five minutes of clarity saves hours of drift.',
    'Get morning sunlight':                  "Sets your circadian rhythm, your hormones, your mood. The cheapest performance tool you'll ever use.",
    'No social media before noon':           'Protect your morning brain. The deepest work happens before the noise begins.',
    'No screens 1 hour before bed':          'Your sleep quality starts an hour before bed. Screens steal it.',

    // 🥗 Nutrition
    'Whole foods diet':  'Real food builds real bodies. Eat what your great-grandparents would recognize.',
    'No sugar/junk food':'Sugar is a stimulant disguised as food. The discipline you build here transfers everywhere.',
    'No alcohol':        'Sleep, recovery, focus, mood — alcohol degrades all four. Sobriety is a performance edge most people refuse to take.',
    'No caffeine':       'Sometimes the best stimulant is no stimulant. Reset your baseline.',

    // ⚡ Discipline & Productivity
    'Wake up at consistent time':           'A consistent wake time anchors your whole day. The body trusts predictability.',
    'Complete your #1 priority task':       'One important thing done beats ten unimportant things. Move the needle that matters.',
    'Plan tomorrow the night before':       "Tomorrow's success is decided tonight. A 5-minute plan tonight saves 30 minutes of friction tomorrow.",
    'Tidy/clean space':                     'Your environment is a mirror of your mind. Order outside helps order inside.',
    'Under 1 hour screen time':             "Time you don't claim, attention economies will. Reclaim the hour.",
    'Digital declutter':                    'Notifications are interruptions disguised as importance. Cut the noise to hear the signal.',
    'No doomscrolling until after 5PM':     'The morning is for building, not consuming. Hold the line until the work is done.',
    'Review your long term goals':          "The compass needs frequent checking. Long-term goals fade if you don't look at them.",

    // 💰 Financial & Growth
    'Track finances & net worth':                'What you measure, you can manage. Unmeasured money disappears.',
    'Work on a side project or business':        "Today's small project is tomorrow's leverage. Asymmetric upside lives here.",
    'Review investments or trading journal':     'The journal is where the lessons live. Every trade reviewed is a teacher rehired.',
    'Generate one new business or content idea': 'Ideas compound. The mind that produces one today produces ten next month.',

    // 🎯 Learning & Skills
    'Educational podcast':         'Convert dead time into learning time. Walks, drives, dishes — all classrooms.',
    'Practice a skill':            'Practice is how potential becomes reality. There is no shortcut.',
    'Flashcard review':            'Spaced repetition is how memory becomes knowledge. Five minutes today, fluent in months.',
    'Write down lessons learned':  'A lesson not recorded is a lesson re-learned. Stop paying twice for the same education.',
    'Learn something new':         'A learning brain is a young brain. Curiosity is the antidote to stagnation.',
    'Language learning':           'Another language is another way of seeing the world. Daily reps build a second mind.',

    // 🌱 Wellbeing & Relationships
    'Morning gratitude practice':  "The mind that begins in gratitude doesn't easily fall into resentment. Train the lens.",
    'Pray or set intentions':      'Whether you call it prayer, meditation, or intention — the act of pausing to align matters more than the label.',
    'Call or text a family member':"Connection is the longest-running variable in human happiness research. Don't take the people who love you for granted.",
    'Do something kind for someone':'Kindness is its own reward and its own training. Strong people give without keeping score.',
    'Barefoot grounding outside':  "Direct contact with the earth is something we've forgotten we need. Try it before dismissing it.",
    'Vitamins and minerals':       "Cover the basics. The body can't perform on missing inputs.",
    'Visualization practice':      'The mind that has rehearsed the win is faster to execute it. See it before you live it.',
    'Sleep early before 11PM':     'Earlier bedtimes compound. Each hour before midnight is worth more than each hour after.',
  };

  // ── HABIT_TIME_OF_DAY — Daily Insight grouping (v1.1.5) ──────
  // Classifies each canonical habit into a time-of-day bucket so the
  // Morning Briefing card can group them as MORNING / DAY / EVENING.
  // Only habits whose canonical practice has a clear time anchor are
  // listed; everything else falls through to 'day' via
  // getHabitTimeOfDay(). Custom habits also default to 'day'.
  //
  // Bucket meanings (from the user's perspective):
  //   morning  — done within the first hours of waking
  //   day      — done sometime during waking hours; no fixed time
  //   evening  — done in the wind-down before bed (or at sleep itself)
  const HABIT_TIME_OF_DAY = {
    // Morning anchor habits
    'Sleep before midnight':                      'morning',  // verified at morning open
    'Wake up at consistent time':                 'morning',
    'Get morning sunlight':                       'morning',
    'No phone or social media after waking':      'morning',
    'Meditate & Breathwork':                      'morning',
    'Morning gratitude practice':                 'morning',
    'Pray or set intentions':                     'morning',
    'Visualization practice':                     'morning',
    'Cold shower':                                'morning',
    'Ice bath or cold plunge':                    'morning',
    'Mobility & Stretching':                      'morning',
    'Vitamins and minerals':                      'morning',
    'Review daily goals/intentions':              'morning',

    // Evening / wind-down habits
    'Sleep':                                      'evening',
    'Sleep early before 11PM':                    'evening',
    'Plan tomorrow the night before':             'evening',
    'No screens 1 hour before bed':               'evening',
    'Review investments or trading journal':      'evening',
    'Write down lessons learned':                 'evening',

    // Everything else defaults to 'day' via the accessor below.
  };

  function getHabitTimeOfDay(habit) {
    if (!habit) return 'day';
    if (habit.custom) return 'day';
    return HABIT_TIME_OF_DAY[habit.name] || 'day';
  }

  // Apply the map onto DEFAULT_HABITS at startup. Each habit definition
  // gets the canonical description text. Habits without an entry are
  // logged so coverage gaps are obvious during development.
  DEFAULT_HABITS.forEach(h => {
    if (HABIT_DESCRIPTIONS[h.name]) {
      h.description = HABIT_DESCRIPTIONS[h.name];
    } else if (typeof console !== 'undefined' && console.warn) {
      console.warn('Habit missing description:', h.name);
    }
  });

  // ── HABIT STAT-COLOR HELPERS (used by History views) ─────
  function getHabitPrimaryStat(habit) {
    if (habit && habit.primaryStat) return habit.primaryStat;
    // Backward compat: habit was saved before primaryStat existed → look up by name
    const def = DEFAULT_HABITS.find(d => d.name === (habit && habit.name));
    return (def && def.primaryStat) || 'FOCUS';
  }
  function getHabitStatColor(habit) {
    const stId = getHabitPrimaryStat(habit);
    const st   = STATS.find(s => s.id === stId);
    return st ? st.color : '#475569'; // FOCUS shadow as ultimate fallback
  }
  // Difficulty → opacity within the stat color (preserves intensity signal)
  const DIFF_OPACITY = { easy: 0.6, medium: 0.75, hard: 0.9, legendary: 1.0 };
  function colorWithAlpha(hex, alpha) {
    if (!hex || hex[0] !== '#' || hex.length !== 7) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // ── PACKS (Choose Your Path) ─────────────────────────────
  // Indices reference DEFAULT_HABITS (63 habits total, indices 0-62)
  // ── PACK COMPOSITION ───────────────────────────────────────
  // Indices into DEFAULT_HABITS. Locked-In is a SUPERSET of Morning
  // Routine — its habit list is composed from Morning's + 6 extras.
  // Single source of truth: change indices here, every UI surface follows.
  // Canonical 10 Morning Routine habits (indices into DEFAULT_HABITS):
  //  1=Sleep (7+ hrs),     23=Wake up consistent, 14=No phone after waking,
  // 16=Morning sunlight,   41=Morning gratitude,  6=Daily walk,
  // 46=Vitamins,           12=Meditate & Breathwork, 4=Strength training,
  // 19=Whole foods diet.
  // v2.0.1: swapped index 2 (Sleep before midnight) → 1 (Sleep) so the
  // pack rewards 7+ hour sleep duration rather than just bedtime timing.
  // The bedtime-only habit still exists at index 2 — users who prefer
  // it can add it from the library; it's just not in the canonical pack.
  const _MORNING_HABIT_INDICES = [1, 23, 14, 16, 41, 6, 46, 12, 4, 19];
  // Locked-In adds: priority task(24), no social before noon(17),
  // no doomscrolling 5PM(29), plan tomorrow(25), no screens before bed(18), read(11)
  const _LOCKED_IN_EXTRA_INDICES = [24, 17, 29, 25, 18, 11];

  const PACKS = [
    {
      id:      'morning',
      emoji:   '🌅',
      name:    'Morning Routine',
      tagline: 'Win the morning. Win the day.',
      sub:     'For the intentional starter',
      color:   '#f59e0b',
      bonusLabel: '⚡ COMPOUND EFFECT BONUS',
      packLabel:  'Compound Effect Bonus',
      habits: _MORNING_HABIT_INDICES.slice(),
    },
    {
      id:      'locked-in',
      emoji:   '🔒',
      name:    'Locked-In',
      tagline: 'Master the day.',
      sub:     'The full discipline cycle — morning, afternoon, and evening.',
      color:   '#7c3aed',          // violet — distinct from MR's gold
      bonusLabel: '🔒 LOCKED-IN BONUS',
      packLabel:  'Locked-In Bonus',
      // Composed: 10 MR habits + 6 LI extras = 16 total. NEVER hardcode.
      habits: [..._MORNING_HABIT_INDICES, ..._LOCKED_IN_EXTRA_INDICES],
    },
    {
      id:      'custom',
      emoji:   '⚡',
      name:    'Make Your Own',
      tagline: 'Your path, your rules',
      color:   '#a855f7',
      habits:  [],
    },
  ];

  // Bonus-eligible packs in fire-order. MR fires before Locked-In so
  // when both complete in the same tick, the Compound Effect modal
  // shows first, then the Locked-In Bonus modal queues behind it.
  const BONUS_PACK_IDS = ['morning', 'locked-in'];

  // ── PACK HELPERS — generic, work for any packId ────────────
  function getPackById(packId)         { return PACKS.find(p => p.id === packId); }
  function getPackHabitDefs(packId) {
    const p = getPackById(packId);
    return (p && p.habits) ? p.habits.map(i => DEFAULT_HABITS[i]) : [];
  }
  function isHabitInPack(habit, packId) {
    if (!habit) return false;
    const names = new Set(getPackHabitDefs(packId).map(h => h.name));
    return names.has(habit.name);
  }
  function getMissingPackHabits(packId) {
    const activeNames = new Set(habits.map(h => h.name));
    return getPackHabitDefs(packId).filter(def => !activeNames.has(def.name));
  }
  function userHasAllPackHabits(packId) {
    return getMissingPackHabits(packId).length === 0;
  }

  // ── MORNING ROUTINE — backward-compat thin wrappers ─────────
  // Existing call sites continue to work; new code should use the
  // generic helpers above so future packs (3rd, 4th, ...) drop in cleanly.
  function getMorningPack()             { return getPackById('morning'); }
  function getMorningHabitDefs()        { return getPackHabitDefs('morning'); }
  function isMorningHabit(habit)        { return isHabitInPack(habit, 'morning'); }
  function getMissingMorningHabits()    { return getMissingPackHabits('morning'); }

  // ── STREAK FORGIVENESS — helpers ─────────────────────────
  const SHIELD_THRESHOLD = 14;  // days of consecutive completion to earn one
  const SHIELD_MAX       = 3;
  const COMEBACK_TIERS = [
    { minDays: 30, xp: 200, msg: 'Long road. Same destination. Welcome home, hunter.' },
    { minDays: 8,  xp: 100, msg: "You disappeared. You came back. That's the only metric that matters." },
    { minDays: 4,  xp: 50,  msg: 'A week away. The path waited.' },
    { minDays: 1,  xp: 25,  msg: 'The hunter who returns is stronger than the one who never fell.' },
  ];

  // Honest Day: 1 per calendar month per pack. Stored as date strings.
  function getHonestDayUsesThisMonth(packId) {
    const monthKey = today.slice(0, 7); // 'YYYY-MM'
    const list = honestDays[packId] || [];
    return list.filter(d => d.startsWith(monthKey)).length;
  }
  function isHonestDay(packId, dateStr) {
    return (honestDays[packId] || []).includes(dateStr);
  }
  function canMarkHonestDayToday(packId) {
    if (isHonestDay(packId, today)) return false;
    return getHonestDayUsesThisMonth(packId) < 1;
  }
  function markTodayAsHonestDay(packId) {
    if (!canMarkHonestDayToday(packId)) return false;
    if (!honestDays[packId]) honestDays[packId] = [];
    honestDays[packId].push(today);
    save();
    return true;
  }

  // Shield earning — called from awardCompoundEffect after streak increments.
  // One shield per 14-day milestone (14, 28, 42, ...) up to SHIELD_MAX stored.
  function tryEarnShield(packId, newStreak) {
    if (newStreak < SHIELD_THRESHOLD) return false;
    if ((newStreak % SHIELD_THRESHOLD) !== 0) return false;
    const lastClaimed = shieldClaimedAt[packId] || 0;
    if (newStreak <= lastClaimed) return false; // already granted at this threshold
    const cur = streakShields[packId] || 0;
    if (cur >= SHIELD_MAX) {
      shieldClaimedAt[packId] = newStreak;  // record so we don't notify again
      save();
      return false;
    }
    streakShields[packId] = cur + 1;
    shieldClaimedAt[packId] = newStreak;
    save();
    if (typeof showHabitToast === 'function') {
      showHabitToast('Streak Shield earned. You held ' + newStreak + ' straight days.');
    }
    return true;
  }

  // Day rollover — runs on init and on day-change. For each bonus pack
  // with an active streak, walks any missed days between lastDate and
  // yesterday, absorbing each via Honest Day or Shield. If absorption
  // fails, the streak breaks and a comeback flag is queued.
  function processStreakRollover() {
    BONUS_PACK_IDS.forEach(packId => {
      const cs = compoundStreaks[packId];
      if (!cs || !cs.lastDate || cs.streak === 0) return;
      if (cs.lastDate === today)            return;
      if (cs.lastDate === prevDay(today))   return;

      let cursor = nextDay(cs.lastDate);
      let broken = false;
      const safety = 400; // bound the loop
      let i = 0;
      while (cursor < today && i++ < safety) {
        // Absorb via Honest Day
        if (isHonestDay(packId, cursor)) {
          cs.lastDate = cursor;
          cursor = nextDay(cursor);
          continue;
        }
        // Absorb via Shield
        if ((streakShields[packId] || 0) > 0) {
          streakShields[packId] -= 1;
          pendingShieldNotices.push({
            packId,
            absorbedDate: cursor,
            streak:       cs.streak,
            remaining:    streakShields[packId],
          });
          cs.lastDate = cursor;
          cursor = nextDay(cursor);
          continue;
        }
        broken = true;
        break;
      }

      if (broken) {
        streakBreakLog.push({ packId, date: today, brokenStreak: cs.streak });
        if (streakBreakLog.length > 60) streakBreakLog = streakBreakLog.slice(-60);
        // Set comeback only if not already set (don't overwrite earlier break)
        if (!pendingComeback) {
          pendingComeback = { packId, brokenStreak: cs.streak, breakDate: today };
        }
        cs.streak = 0;
        cs.lastDate = null;
      }
    });
    save();
  }

  // Comeback detection — called from check() after a habit is completed.
  // If a real break is pending and this is the first completion since
  // the user was last active, fire the Comeback celebration.
  function checkComebackOnActivity() {
    if (!pendingComeback) return;
    if (!lastActiveDate || lastActiveDate === today) return; // already active today
    // Compute days away based on lastActiveDate
    const fromMs = Date.parse(lastActiveDate + 'T12:00:00Z');
    const toMs   = Date.parse(today + 'T12:00:00Z');
    const daysAway = Math.max(1, Math.round((toMs - fromMs) / 86400000));

    const tier = COMEBACK_TIERS.find(t => daysAway >= t.minDays) || COMEBACK_TIERS[COMEBACK_TIERS.length - 1];
    totalComebacks += 1;
    totalPoints    += tier.xp;
    pendingComeback = null;
    save();
    levelUpQueue.unshift({ type: 'comeback', daysAway, xp: tier.xp, msg: tier.msg });
    if (!levelUpActive) drainLevelUpQueue();
  }

  // Show queued shield notices as toasts on app open (one per packId batch)
  function flushPendingShieldNotices() {
    if (!pendingShieldNotices.length) return;
    const byPack = {};
    pendingShieldNotices.forEach(n => {
      if (!byPack[n.packId]) byPack[n.packId] = n;
      byPack[n.packId].count = (byPack[n.packId].count || 0) + 1;
    });
    pendingShieldNotices = [];
    save();
    Object.values(byPack).forEach((n, i) => {
      const pack = getPackById(n.packId);
      const name = pack ? pack.name : n.packId;
      const msg  = 'Shield used. ' + name + ' streak protected. ' + n.remaining + ' shield' + (n.remaining === 1 ? '' : 's') + ' remaining.';
      // Stagger so multiple don't pile on each other
      setTimeout(() => { if (typeof showHabitToast === 'function') showHabitToast(msg, { duration: 4500 }); }, 400 + i * 1800);
    });
  }

  // ── STORAGE ───────────────────────────────────────────────
  function load() {
    try {
      const raw = localStorage.getItem('hb_habits');
      if (raw === null) {
        needsOnboarding = true;
        if (!localStorage.getItem('hb_welcomed')) needsWelcome = true;
      } else {
        habits = JSON.parse(raw);
      }
      completions = JSON.parse(localStorage.getItem('hb_completions') || '{}');
      streaks     = JSON.parse(localStorage.getItem('hb_streaks')     || '{}');
      totalPoints = parseInt(localStorage.getItem('hb_points') || '0', 10) || 0;
      const ach   = JSON.parse(localStorage.getItem('hb_achievements') || '[]');
      unlockedAchievements = new Set(ach);
      achievementUnlockDates = JSON.parse(localStorage.getItem('hb_ach_dates') || '{}');
      const rawStats = localStorage.getItem('hb_stats');
      stats = rawStats ? JSON.parse(rawStats) : initStats();
      const rawSB = localStorage.getItem('hb_stat_bonuses');
      statBonuses = new Set(rawSB ? JSON.parse(rawSB) : []);
      playerName  = localStorage.getItem('hb_name') || 'Hunter';
      const savedClass = localStorage.getItem('hb_class');
      const validClassKeys = [...STATS.map(st => st.id), 'SAGE'];
      currentClass = validClassKeys.includes(savedClass) ? savedClass : null;
      const rawPS  = localStorage.getItem('hb_perfect_streak');
      habitNotes      = JSON.parse(localStorage.getItem('hb_notes')             || '{}');
      compoundStreaks  = JSON.parse(localStorage.getItem('hb_compound')         || '{}');
      compoundAwarded  = JSON.parse(localStorage.getItem('hb_compound_awarded') || '{}');
      personalRecords  = JSON.parse(localStorage.getItem('hb_prs')               || '{}');
      streakShields    = JSON.parse(localStorage.getItem('hb_shields')           || '{}');
      shieldClaimedAt  = JSON.parse(localStorage.getItem('hb_shield_claimed')    || '{}');
      pendingShieldNotices = JSON.parse(localStorage.getItem('hb_shield_notices') || '[]');
      honestDays       = JSON.parse(localStorage.getItem('hb_honest_days')       || '{}');
      pendingComeback  = JSON.parse(localStorage.getItem('hb_pending_comeback')  || 'null');
      lastActiveDate   = localStorage.getItem('hb_last_active') || null;
      totalComebacks   = parseInt(localStorage.getItem('hb_total_comebacks') || '0', 10) || 0;
      streakBreakLog   = JSON.parse(localStorage.getItem('hb_streak_breaks')     || '[]');
      originBeginning  = JSON.parse(localStorage.getItem('hb_origin_beginning')  || 'null');
      originAwakening  = JSON.parse(localStorage.getItem('hb_origin_awakening')  || 'null');
      // Backward-compat: an earlier version stored a single-story key.
      // If present and we have nothing in the new awakening slot, migrate it.
      if (!originAwakening) {
        const legacy = JSON.parse(localStorage.getItem('hb_origin_story') || 'null');
        if (legacy && legacy.text) {
          originAwakening = legacy;
          localStorage.setItem('hb_origin_awakening', JSON.stringify(originAwakening));
        }
      }
      perfectStreak = rawPS ? JSON.parse(rawPS)
        : { count: 0, lastDate: null, prevCount: 0, prevLastDate: null };
      const rawPSA = localStorage.getItem('hb_ps_awarded');
      psAwarded = new Set(rawPSA ? JSON.parse(rawPSA) : []);
      selectedPackId = localStorage.getItem('hb_path') || null;
    } catch (_) {
      habits = []; completions = {}; streaks = {};
      totalPoints = 0; unlockedAchievements = new Set();
      stats = initStats(); statBonuses = new Set();
      playerName = 'Hunter';
      perfectStreak = { count: 0, lastDate: null, prevCount: 0, prevLastDate: null };
      psAwarded = new Set();
    }
  }

  function initStats() {
    const s = {};
    STATS.forEach(st => s[st.id] = { pts: 0 });
    return s;
  }

  function save() {
    try {
      // v2.0 — enforce auto-verify-first ordering on every persist
      // so the invariant always holds in storage. Cheap (O(n) on a
      // ≤49-habit array) and guarantees post-drag snap-back behavior.
      sortHabitsAutoVerifyFirst(habits);
      localStorage.setItem('hb_habits',         JSON.stringify(habits));
      localStorage.setItem('hb_completions',     JSON.stringify(completions));
      localStorage.setItem('hb_streaks',         JSON.stringify(streaks));
      localStorage.setItem('hb_points',          String(totalPoints));
      localStorage.setItem('hb_achievements',    JSON.stringify([...unlockedAchievements]));
      localStorage.setItem('hb_ach_dates',       JSON.stringify(achievementUnlockDates));
      localStorage.setItem('hb_stats',           JSON.stringify(stats));
      localStorage.setItem('hb_stat_bonuses',    JSON.stringify([...statBonuses]));
      localStorage.setItem('hb_perfect_streak',  JSON.stringify(perfectStreak));
      localStorage.setItem('hb_ps_awarded',      JSON.stringify([...psAwarded]));
      localStorage.setItem('hb_notes',             JSON.stringify(habitNotes));
      localStorage.setItem('hb_compound',          JSON.stringify(compoundStreaks));
      localStorage.setItem('hb_compound_awarded',  JSON.stringify(compoundAwarded));
      localStorage.setItem('hb_prs',               JSON.stringify(personalRecords));
      localStorage.setItem('hb_shields',           JSON.stringify(streakShields));
      localStorage.setItem('hb_shield_claimed',    JSON.stringify(shieldClaimedAt));
      localStorage.setItem('hb_shield_notices',    JSON.stringify(pendingShieldNotices));
      localStorage.setItem('hb_honest_days',       JSON.stringify(honestDays));
      localStorage.setItem('hb_pending_comeback',  JSON.stringify(pendingComeback));
      if (lastActiveDate) localStorage.setItem('hb_last_active', lastActiveDate);
      localStorage.setItem('hb_total_comebacks',   String(totalComebacks));
      localStorage.setItem('hb_streak_breaks',     JSON.stringify(streakBreakLog));
      localStorage.setItem('hb_origin_beginning',  JSON.stringify(originBeginning));
      localStorage.setItem('hb_origin_awakening',  JSON.stringify(originAwakening));
    } catch (_) {}
  }

  // ── RANK HELPERS ──────────────────────────────────────────
  function getRank(pts) {
    for (let i = RANKS.length - 1; i >= 0; i--) {
      if (pts >= RANKS[i].min) return RANKS[i];
    }
    return RANKS[0];
  }

  // ── XP MIGRATION (v2.0.1 rank-scaling overhaul) ─────────────
  // The new RANKS thresholds are ~5-7× higher than the previous
  // values. Without migration, an existing user at S rank under the
  // old curve (14,000 XP) would display as B rank under the new
  // curve. Rank-preserving fraction-based migration: place each user
  // at the SAME tier-fraction in the new system as they were in the
  // old one. A user 50% through old D-tier becomes 50% through new
  // D-tier. Idempotent via the localStorage flag.
  //
  // Important: ONLY totalPoints is migrated. Per-stat XP
  // (`stats.STR.pts`, etc.) is left alone — multiplying it would
  // cascade into uncontrolled stat-level milestone bonuses (lv 5/10/
  // 15/20 awards). This means `totalPoints` will NOT equal
  // `sum(stats.*.pts)` after migration. Stat thresholds are a
  // separate progression system; they stay where the user actually
  // earned them. Inconsistency is benign — the rank UI reads
  // totalPoints; the Stats panel reads per-stat.
  const XP_MIGRATION_FLAG = 'hb_xp_migrated_v2';
  const OLD_RANK_THRESHOLDS = [
    { id: 'E',  min: 0,     max: 499     },
    { id: 'D',  min: 500,   max: 1499    },
    { id: 'C',  min: 1500,  max: 3499    },
    { id: 'B',  min: 3500,  max: 6999    },
    { id: 'A',  min: 7000,  max: 13999   },
    { id: 'S',  min: 14000, max: 27999   },
    { id: 'S+', min: 28000, max: Infinity },
  ];
  function migrateXPToNewThresholds() {
    if (localStorage.getItem(XP_MIGRATION_FLAG) === '1') return;
    if (typeof totalPoints !== 'number' || totalPoints <= 0) {
      // Brand-new user with 0 XP — nothing to migrate. Mark done so
      // we don't re-check on every launch.
      localStorage.setItem(XP_MIGRATION_FLAG, '1');
      return;
    }

    // Find which old tier this user sits in.
    let oldIdx = 0;
    for (let i = OLD_RANK_THRESHOLDS.length - 1; i >= 0; i--) {
      if (totalPoints >= OLD_RANK_THRESHOLDS[i].min) { oldIdx = i; break; }
    }
    const oldTier = OLD_RANK_THRESHOLDS[oldIdx];
    const newTier = RANKS[oldIdx];

    let migrated;
    if (oldTier.id === 'S+') {
      // S+ has no upper bound — fraction is undefined. Scale the
      // over-floor distance by the ratio of new S→S+ size to old
      // S→S+ size, preserving "how far past legendary" the user was.
      const oldSToSPlusSize = OLD_RANK_THRESHOLDS[6].min - OLD_RANK_THRESHOLDS[5].min; // 14000
      const newSToSPlusSize = RANKS[6].min - RANKS[5].min; // 80000
      const overFloor = totalPoints - oldTier.min;
      const scale = newSToSPlusSize / oldSToSPlusSize;
      migrated = newTier.min + (overFloor * scale);
    } else {
      // Within-tier fraction: where the user sits as a 0..1 fraction
      // through the old tier. Map to the same fraction through the
      // new tier so rank + within-rank progress feel identical.
      const oldTierSize = oldTier.max - oldTier.min + 1;
      const fraction = (totalPoints - oldTier.min) / oldTierSize;
      const newTierSize = newTier.max - newTier.min + 1;
      migrated = newTier.min + (fraction * newTierSize);
    }

    totalPoints = Math.round(migrated);
    try { localStorage.setItem('hb_points', String(totalPoints)); } catch (_) {}
    localStorage.setItem(XP_MIGRATION_FLAG, '1');
  }

  // ── PERSONAL RECORDS — helpers ────────────────────────────
  function getPRDef(prId) { return PR_DEFS.find(p => p.id === prId); }
  function getPR(prId) {
    return personalRecords[prId] || { value: 0, meta: null, lastUpdated: null };
  }
  // Compares newValue against current PR. Updates if greater (numbers) or
  // higher-tier (rank). Queues the appropriate celebration unless suppressed.
  function prUpdate(prId, newValue, meta) {
    const def = getPRDef(prId);
    if (!def) return;
    const cur      = getPR(prId);
    const prevVal  = cur.value || 0;
    let isNew = false;

    if (prId === 'highest_rank') {
      // Rank PR: compare tier index, not numeric. Higher index = higher rank.
      const newIdx = RANKS.findIndex(r => r.id === newValue);
      const curIdx = cur.value ? RANKS.findIndex(r => r.id === cur.value) : -1;
      isNew = newIdx > curIdx;
    } else {
      isNew = (newValue > prevVal);
    }
    if (!isNew) return;

    personalRecords[prId] = {
      value:        newValue,
      meta:         meta || cur.meta || null,
      lastUpdated:  today,
    };
    save();

    // Celebrations disabled — PRs update silently. The user can still see
    // every value in the All-PRs sheet (🏆 chip on the Status tab). Flip
    // this constant to re-enable popups/toasts/takeovers in one line.
    if (!PR_CELEBRATIONS_ENABLED) return;
    if (_suppressPRCelebrations) return;

    // Determine celebration mode based on tier + milestone semantics
    let mode = 'tier' + def.tier; // default

    // Tier 1 PRs only celebrate on round-number milestones
    if (def.tier === 1) {
      const hit = (def.milestones || []).some(m => prevVal < m && newValue >= m);
      if (!hit) return; // increment without milestone — silent
    }
    // Tier 3 streak PRs only takeover on specific day thresholds
    if (def.tier === 3 && def.takeoverDays) {
      const hit = def.takeoverDays.some(d => prevVal < d && newValue >= d);
      if (!hit) {
        // Not a takeover day yet — fall back to tier 2 modal
        mode = 'tier2';
      }
    }
    // Highest-rank PR: takeover on every new-tier-ever
    // (already gated by isNew check above — every fire IS a new tier)

    _prCelebrationQueue.push({ prId, newValue, prevValue: prevVal, meta: personalRecords[prId].meta, mode });
    drainPRCelebrationQueue();
  }

  // Backfill from existing user data on first launch of v1.1+ (idempotent)
  function migratePRsIfNeeded() {
    if (localStorage.getItem('hb_prs_migrated') === '1') return;
    _suppressPRCelebrations = true;
    try {
      // total_habits_lifetime: count every completion logged
      let totalHabits = 0;
      let activeDays  = 0;
      let bestDayCount = 0;
      for (const d in completions) {
        const list = completions[d] || [];
        if (list.length === 0) continue;
        totalHabits += list.length;
        activeDays  += 1;
        if (list.length > bestDayCount) bestDayCount = list.length;
      }
      prUpdate('total_habits_lifetime', totalHabits);
      prUpdate('total_active_days',     activeDays);
      prUpdate('most_habits_day',       bestDayCount);
      // total_xp_lifetime: best estimate is current points (no historic XP log)
      prUpdate('total_xp_lifetime',     totalPoints);
      // pack streaks: current = lifetime best at upgrade time
      prUpdate('longest_mr_streak',     ((compoundStreaks['morning']   || {}).streak) || 0);
      prUpdate('longest_li_streak',     ((compoundStreaks['locked-in'] || {}).streak) || 0);
      // highest rank: current rank (only goes up from here)
      prUpdate('highest_rank',          getRank(totalPoints).id);
      // longest_habit_streak: scan current habit streaks
      let bestHabit = { name: null, count: 0 };
      Object.keys(streaks).forEach(hid => {
        const s = streaks[hid];
        if (s && s.count > bestHabit.count) {
          const h = habits.find(hh => hh.id === hid);
          if (h) bestHabit = { name: h.name, count: s.count };
        }
      });
      if (bestHabit.count > 0) prUpdate('longest_habit_streak', bestHabit.count, { habitName: bestHabit.name });
      // longest_stat_streak: compute current best across stats
      let bestStat = { id: null, count: 0 };
      STATS.forEach(st => {
        const c = computeCurrentStatStreak(st.id);
        if (c > bestStat.count) bestStat = { id: st.id, count: c };
      });
      if (bestStat.count > 0) prUpdate('longest_stat_streak', bestStat.count, { statId: bestStat.id });
    } finally {
      _suppressPRCelebrations = false;
      localStorage.setItem('hb_prs_migrated', '1');
    }
  }

  // Walks back from today day-by-day. Returns the current consecutive-day
  // count where at least one habit feeding `statId` was completed.
  function computeCurrentStatStreak(statId) {
    const stat = STATS.find(s => s.id === statId);
    if (!stat) return 0;
    const habitNames = new Set(stat.habits);
    const habitIdsByName = {};
    habits.forEach(h => { habitIdsByName[h.name] = h.id; });
    let d = today;
    let streak = 0;
    let safety = 0;
    while (safety++ < 1000) {
      const list = completions[d] || [];
      const dayHasStat = list.some(hid => {
        const h = habits.find(hh => hh.id === hid);
        return h && habitNames.has(h.name);
      });
      if (!dayHasStat) {
        // If today is the start (streak=0) and today not done yet, it's OK to break
        // (streak of 0 means "no current run"). Otherwise the run ends.
        break;
      }
      streak++;
      d = prevDay(d);
    }
    return streak;
  }

  // Counts XP earned today by walking today's completions (plus any compound bonuses).
  // Used to update most_xp_day at end of every check().
  function computeTodayXP() {
    const list = completions[today] || [];
    let xp = 0;
    list.forEach(hid => {
      const h = habits.find(hh => hh.id === hid);
      if (!h) return;
      const base = (DIFFICULTY[h.difficulty || 'easy'] || DIFFICULTY.easy).pts;
      xp += isWeekend() ? base * 2 : base;
    });
    // Add today's compound bonuses
    BONUS_PACK_IDS.forEach(packId => {
      if (compoundAwarded[packId] === today) {
        const cs = compoundStreaks[packId];
        const streak = (cs && cs.lastDate === today) ? cs.streak : 0;
        if (streak > 0) {
          const base = getCompoundXP(packId, streak);
          xp += isWeekend() ? base * 2 : base;
        }
      }
    });
    return xp;
  }

  function diffPts(diff) {
    const base = (DIFFICULTY[diff] || DIFFICULTY.easy).pts;
    return isWeekend() ? base * 2 : base;
  }

  // ── STREAK / CHECK HELPERS ────────────────────────────────
  function getStreak(id) {
    return (streaks[id] && streaks[id].count) || 0;
  }

  function isChecked(id) {
    const list = completions[today];
    return Array.isArray(list) && list.includes(id);
  }

  function check(id) {
    if (isChecked(id)) return;
    if (!completions[today]) completions[today] = [];
    completions[today].push(id);

    const habit = habits.find(h => h.id === id);
    const habitDays = habit?.days || ALL_DAYS;

    const s = streaks[id] || { count: 0, lastDate: null, prevCount: 0, prevLastDate: null };
    s.prevCount = s.count;
    s.prevLastDate = s.lastDate;

    if (s.lastDate === today) {
      // already counted today
    } else if (!s.lastDate) {
      s.count = 1;
    } else {
      s.count = hasScheduledDayBetween(habitDays, s.lastDate, today) ? 1 : s.count + 1;
    }
    s.lastDate = today;
    streaks[id] = s;

    const pts = diffPts(habit ? habit.difficulty : 'easy');
    totalPoints += pts;
    applyStatPts(habit, pts, 1);
    save();
    checkAchievements();
    checkStatBonuses();
    checkWeekendChallenge(id);

    // ── Personal Records hooks ─────────────────────────────
    // Lifetime totals: increment on every completion.
    prUpdate('total_habits_lifetime', getPR('total_habits_lifetime').value + 1);
    prUpdate('total_xp_lifetime',     getPR('total_xp_lifetime').value     + pts);
    // Today's PRs: recompute against current totals.
    const todayCount = (completions[today] || []).length;
    prUpdate('most_habits_day', todayCount);
    prUpdate('most_xp_day',     computeTodayXP());
    // Active days: if this is the first completion of a new day, increment.
    if (todayCount === 1) {
      prUpdate('total_active_days', getPR('total_active_days').value + 1);
    }
    // Per-habit streak PR
    if (habit && s.count > getPR('longest_habit_streak').value) {
      prUpdate('longest_habit_streak', s.count, { habitName: habit.name });
    }
    // ── Streak Forgiveness: comeback detection ────────────────
    // Fire BEFORE updating lastActiveDate so we still see the old value
    // to compute days-away accurately.
    if (typeof checkComebackOnActivity === 'function') checkComebackOnActivity();
    lastActiveDate = today;

    // Per-stat streak — find the stat this habit feeds and check its streak
    if (habit) {
      STATS.forEach(st => {
        if (!st.habits.includes(habit.name)) return;
        const cur = computeCurrentStatStreak(st.id);
        if (cur > getPR('longest_stat_streak').value) {
          prUpdate('longest_stat_streak', cur, { statId: st.id });
        }
      });
    }
  }

  function uncheck(id) {
    if (!isChecked(id)) return;
    completions[today] = completions[today].filter(x => x !== id);

    const s = streaks[id];
    if (s && s.lastDate === today) {
      s.count = s.prevCount || 0;
      s.lastDate = s.prevLastDate || null;
    }

    const habit = habits.find(h => h.id === id);
    const pts = diffPts(habit ? habit.difficulty : 'easy');
    totalPoints = Math.max(0, totalPoints - pts);
    applyStatPts(habit, pts, -1);
    save();
  }

  // ── ACHIEVEMENTS ──────────────────────────────────────────
  // Build the achievement evaluation context — used by both unlock checks
  // and the renderer for live progress bars on locked rows.
  function buildAchievementContext() {
    const allStreaks    = Object.values(streaks).map(s => s.count || 0);
    const maxStreak     = allStreaks.length ? Math.max(...allStreaks) : 0;
    const legStreaks    = habits.filter(h => h.difficulty === 'legendary')
                                .map(h => (streaks[h.id] && streaks[h.id].count) || 0);
    const maxLegStreak  = legStreaks.length ? Math.max(...legStreaks) : 0;
    const totalCompletions = Object.values(completions).reduce((n, arr) => n + arr.length, 0);
    const totalStatLevel = STATS.reduce((sum, st) => sum + statLevel(stats[st.id]?.pts || 0), 0);
    const statsAtLv5 = STATS.filter(st => statLevel(stats[st.id]?.pts || 0) >= 5).length;
    const maxStatLv  = STATS.reduce((m, st) => Math.max(m, statLevel(stats[st.id]?.pts || 0)), 0);
    const hasClass   = currentClass && currentClass !== 'CIVILIAN';
    const isSage     = currentClass === 'SAGE';
    const mrStreak   = (compoundStreaks && compoundStreaks['morning']   && compoundStreaks['morning'].streak)   || 0;
    const liStreak   = (compoundStreaks && compoundStreaks['locked-in'] && compoundStreaks['locked-in'].streak) || 0;
    const bothCrownsToday = compoundAwarded['morning'] === today && compoundAwarded['locked-in'] === today;
    const perfectStreakNow = (perfectStreak && perfectStreak.count) || 0;
    const anyPRSet = (typeof personalRecords === 'object' &&
                      Object.keys(personalRecords).some(k => (personalRecords[k] || {}).value > 0));
    // Per-habit lifetime completion counts for habit-mastery achievements
    function countCompletionsByName(name) {
      const habit = habits.find(h => h.name === name);
      if (!habit) return 0;
      let n = 0;
      for (const d in completions) {
        if (Array.isArray(completions[d]) && completions[d].includes(habit.id)) n++;
      }
      return n;
    }
    return {
      maxStreak,
      maxLegStreak,
      totalCompletions,
      totalPoints,
      totalStatLevel,
      statsAtLv5,
      maxStatLv,
      hasClass,
      isSage,
      mrStreak,
      liStreak,
      bothCrownsToday,
      perfectStreak: perfectStreakNow,
      anyPRSet,
      activeDays:    Object.keys(completions).filter(d => (completions[d] || []).length > 0).length,
      coldCount:     countCompletionsByName('Cold shower') + countCompletionsByName('Ice bath or cold plunge'),
      readCount:     countCompletionsByName('Read'),
      strengthCount: countCompletionsByName('Strength training'),
      meditateCount: countCompletionsByName('Meditate & Breathwork'),
      phoneOffCount: countCompletionsByName('No phone or social media after waking'),
    };
  }

  function checkAchievements() {
    const ctx = buildAchievementContext();
    const newlyUnlocked = [];
    ACHIEVEMENTS.forEach(ach => {
      if (unlockedAchievements.has(ach.id)) return;
      const p = (typeof ach.getProgress === 'function') ? ach.getProgress(ctx) : null;
      if (!p) return;
      if (p.current >= p.target) {
        unlockedAchievements.add(ach.id);
        achievementUnlockDates[ach.id] = today;
        newlyUnlocked.push(ach);
      }
    });

    if (newlyUnlocked.length) {
      // FULLY AWAKENED grants a one-time +2,000 rank XP bonus (preserved)
      if (newlyUnlocked.find(a => a && a.id === 'fully_awakened')) {
        totalPoints += 2000;
      }
      save();
      achQueue.push(...newlyUnlocked.filter(Boolean));
    }
  }

  // ── STATS ─────────────────────────────────────────────────
  // XP required to advance FROM level `l` TO level `l+1`
  function xpToNextLevel(l) {
    // Explicit XP required to go FROM level l TO level l+1 (max level is 20)
    const TABLE = [5, 15, 30, 50, 75, 105, 140, 180, 225, 275, 330, 390, 455, 525, 600, 680, 765, 855, 950];
    return (l >= 1 && l <= 19) ? TABLE[l - 1] : 0; // 0 at cap — Level 20 has nowhere to go
  }

  // Total cumulative XP needed to REACH level `l` (level 1 = 0 XP)
  function xpForLevel(l) {
    let total = 0;
    for (let i = 1; i < l; i++) total += xpToNextLevel(i);
    return total;
  }

  function statLevel(pts) {
    if (!pts || pts <= 0) return 1;
    let lv = 1, cumXP = 0;
    while (lv < 20) {
      const needed = xpToNextLevel(lv);
      if (pts < cumXP + needed) break;
      cumXP += needed;
      lv++;
    }
    return lv;
  }

  function applyStatPts(habit, pts, direction) {
    if (!habit) return;
    const MAX_STAT_XP = 6650; // total XP to reach Level 20 (hard cap) — sum of all 19 level thresholds

    // Custom habits don't appear in any STATS[].habits list, so the
    // name-match path below would skip them. Use getHabitPrimaryStat
    // (which honors a habit's stored primaryStat) to route their XP.
    if (habit.custom && habit.primaryStat) {
      const stId = habit.primaryStat;
      if (!stats[stId]) stats[stId] = { pts: 0 };
      const raw = (stats[stId].pts || 0) + direction * pts;
      stats[stId].pts = Math.max(0, direction > 0 ? Math.min(MAX_STAT_XP, raw) : raw);
      if (currentTab === 'profile') renderProfile();
      if (currentTab === 'stats')   renderStats();
      return;
    }

    // Curated habits — name-based routing into every STATS bucket they
    // appear in. (A few habits like "Cardio" build both STR and VIT.)
    const habitName = habit.name;
    if (!habitName) return;
    STATS.forEach(st => {
      if (st.habits.includes(habitName)) {
        if (!stats[st.id]) stats[st.id] = { pts: 0 };
        const raw = (stats[st.id].pts || 0) + direction * pts;
        stats[st.id].pts = Math.max(0, direction > 0 ? Math.min(MAX_STAT_XP, raw) : raw);
      }
    });
    if (currentTab === 'profile') renderProfile();
    if (currentTab === 'stats')   renderStats();
  }

  function checkStatBonuses() {
    let bonusAwarded = false;
    STATS.forEach(st => {
      const level = statLevel(stats[st.id]?.pts || 0);
      STAT_BONUS_THRESHOLDS.forEach(thr => {
        const key = st.id + '_' + thr.level;
        if (level >= thr.level && !statBonuses.has(key)) {
          statBonuses.add(key);
          totalPoints += thr.pts;
          bonusAwarded = true;
          achQueue.push({
            label: 'STAT BONUS',
            icon: st.icon,
            name: st.label + ' reached Level ' + thr.level,
            desc: '+' + thr.pts + ' XP bonus added to your rank!',
          });
        }
      });
    });
    if (bonusAwarded) {
      save();
      renderRank();
    }
  }

  // ── CLASS SYSTEM ──────────────────────────────────────────
  // ── CLASS ASSIGNMENT (v1.2 rules) ─────────────────────────
  // - All stats < Lv5         → CIVILIAN  (the unawakened default)
  // - 1 stat ≥ Lv5            → that stat's class (auto-assigned, fires Awakening)
  // - 2+ stats ≥ Lv5 + still Civilian → CHOICE (user picks their path)
  // - All 6 ≥ Lv5 + within 15% → SAGE
  // - Has class → shift only if a different stat exceeds current class lv by 20%+
  function _statLevels() {
    const lv = STATS.map(st => ({ id: st.id, lv: statLevel(stats[st.id]?.pts || 0) }));
    lv.sort((a, b) => b.lv - a.lv);
    return lv;
  }

  // Returns { class, choice? }. If `choice` is set, the user must pick from
  // those class ids before the new class is committed.
  function evaluateClass(currentCls) {
    const levels     = _statLevels();
    const qualifiers = levels.filter(l => l.lv >= CLASS_LV5_THRESHOLD);

    if (qualifiers.length === 0) return { class: 'CIVILIAN' };

    // Sage: all 6 qualify and balance is within 15%
    if (qualifiers.length === 6) {
      const top = levels[0].lv;
      const min = levels[5].lv;
      if (top > 0 && (min / top) >= CLASS_BALANCE_RATIO) {
        return { class: 'SAGE' };
      }
    }

    // Single qualifier — auto-assign
    if (qualifiers.length === 1) return { class: qualifiers[0].id };

    // Multiple qualifiers, user is still Civilian → must choose
    if (!currentCls || currentCls === 'CIVILIAN') {
      return { class: 'CIVILIAN', choice: qualifiers.map(q => q.id) };
    }

    // Multiple qualifiers, user already has a class → shift only on dominance
    if (currentCls === 'SAGE') return { class: 'SAGE' };  // Sage is sticky once earned

    const top       = qualifiers[0];
    const currentLv = (levels.find(l => l.id === currentCls) || { lv: 0 }).lv;
    if (top.id !== currentCls && currentLv > 0 &&
        (top.lv / currentLv) >= CLASS_SHIFT_DOMINANCE) {
      return { class: top.id };
    }
    return { class: currentCls };
  }

  // Backward-compat shim — anything still calling determineClass() gets
  // a class id the same way the old function did.
  function determineClass() {
    return evaluateClass(currentClass).class;
  }

  function isClassShifting() {
    if (!currentClass || currentClass === 'CIVILIAN' || currentClass === 'SAGE') return false;
    const levels    = _statLevels();
    const top       = levels[0];
    if (top.lv < CLASS_LV5_THRESHOLD) return false;
    const currentLv = (levels.find(l => l.id === currentClass) || { lv: 0 }).lv;
    if (top.id === currentClass || currentLv === 0) return false;
    const ratio = top.lv / currentLv;
    return ratio >= 1.10 && ratio < CLASS_SHIFT_DOMINANCE;  // 10–20% transition zone
  }

  // For Civilian users — find the stat closest to Lv5 for the progress hint.
  function getClosestStatToAwaken() {
    const levels = _statLevels();
    const top    = levels[0];
    if (!top) return null;
    if (top.lv >= CLASS_LV5_THRESHOLD) return null;
    const tied = levels.filter(l => l.lv === top.lv).map(l => l.id);
    return { ids: tied, lv: top.lv, target: CLASS_LV5_THRESHOLD };
  }

  function checkClassChange(silent) {
    const result = evaluateClass(currentClass);

    // Choice required: 2+ stats hit Lv5 simultaneously while still Civilian
    if (result.choice && currentClass === 'CIVILIAN') {
      if (silent) {
        // Migration path — don't fire popup. User stays Civilian until they
        // either next earn a single new Lv5 (auto-assign) or open the app
        // and a level-up triggers the choice naturally.
        return;
      }
      levelUpQueue.push({ type: 'classChoice', options: result.choice });
      if (!levelUpActive) drainLevelUpQueue();
      return;
    }

    if (result.class === currentClass) return;

    const wasCivilian = (currentClass === 'CIVILIAN' || currentClass === null);
    currentClass = result.class;
    localStorage.setItem('hb_class', currentClass);
    // Re-arm the morning digest so its title ("Awakened — Warrior") and
    // its body (class-flavored copy) reflect the new class. This is
    // best-effort and silent — it can no-op on web (Notif.reapplyDigest
    // checks for the native plugin). Same goes for the 7 PM check-in
    // and the 1 PM mid-day check-in (which also uses the class title).
    try { Notif.reapplyDigest(); } catch (_) {}
    try { Notif.reapplyCheckin(); } catch (_) {}
    try { Notif.reapplyMidDay(); } catch (_) {}

    if (!silent) {
      // First-time awakening (Civilian → any class) gets a special celebration.
      // Subsequent class shifts use the lighter class-change popup.
      const isAwakening = wasCivilian && currentClass !== 'CIVILIAN';
      const seenAwakeningKey = 'hb_awakened_once';
      if (isAwakening && !localStorage.getItem(seenAwakeningKey)) {
        localStorage.setItem(seenAwakeningKey, '1');
        // Generate + persist the origin story BEFORE queuing — so the
        // story is saved even if the user closes the app mid-celebration.
        saveAwakeningIfMissing(currentClass);
        levelUpQueue.push({ type: 'awakening', classData: CLASSES[currentClass] });
      } else {
        levelUpQueue.push({ type: 'class', classData: CLASSES[currentClass] });
      }
      if (!levelUpActive) drainLevelUpQueue();
    }
    if (currentTab === 'profile') renderProfile();
    if (currentTab === 'stats')   renderStats();
  }

  function showClassChangePopup(cls) {
    const popup = document.getElementById('class-popup');
    const card  = document.getElementById('class-popup-card');
    card.style.borderColor = cls.color + '60';
    card.style.boxShadow   = '0 0 48px ' + cls.color + '30';
    card.style.setProperty('--cp-color', cls.color);
    // Class emoji replaced with custom emblem icon. Falls back to empty
    // if the class id isn't mapped (no broken image).
    const _cpKey = (typeof currentClass === 'string') ? currentClass : null;
    document.getElementById('class-popup-emoji').innerHTML = classIconHtml(_cpKey, { size: 72 });
    document.getElementById('class-popup-name').textContent  = cls.name;
    document.getElementById('class-popup-desc').textContent  = cls.desc;
    popup.classList.remove('hidden');
    void card.offsetWidth;
    card.classList.add('cp-animate');
    navigator.vibrate && navigator.vibrate([40, 25, 70, 25, 40]);
    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      popup.classList.add('hidden');
      card.classList.remove('cp-animate');
      levelUpActive = false;
      drainLevelUpQueue();
    };
    // Same tap-disarm guard as the stat level-up popup — prevents one tap
    // from blowing through several queued popups in a row.
    popup.onclick = null;
    setTimeout(() => { popup.onclick = dismiss; }, 400);
    timer = setTimeout(dismiss, 3500);
  }

  // ── AWAKENING — first-ever class assignment celebration ──
  // ── ORIGIN STORY — generation + migration ───────────────
  function _formatOriginDate(dateStr) {
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US',
        { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (_) { return dateStr; }
  }
  // Short numeric form for chapter header labels — '5/1/2026'
  function _shortDate(dateStr) {
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US',
        { month: 'numeric', day: 'numeric', year: 'numeric' });
    } catch (_) { return dateStr; }
  }
  function _originWeekdayNoun(dateStr) {
    try {
      const wk = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      return WEEKDAY_NOUNS[wk] || 'soul';
    } catch (_) { return 'soul'; }
  }

  function _originName() {
    // Use the user's actual name. The default 'Hunter' is a real name
    // for narrative purposes — we only fall back to 'the hunter' when
    // the field is genuinely empty/null.
    if (playerName && playerName.trim()) return playerName.trim();
    return 'the hunter';
  }

  // Chapter 1 — class-agnostic, generated at onboarding completion.
  function generateBeginningStory(dateStr) {
    const useDate     = dateStr || today;
    const dateDisplay = _formatOriginDate(useDate);
    const text = BEGINNING_TEMPLATE
      .replace('{DATE}', dateDisplay)
      .replace('{NAME}', _originName());
    return { text, dateISO: useDate, dateDisplay };
  }

  // Chapter 2 — class-specific, generated at first awakening.
  function generateAwakeningStory(classKey, dateStr) {
    const tpl = ORIGIN_TEMPLATES[classKey];
    if (!tpl) return null;
    const useDate     = dateStr || today;
    const dateDisplay = _formatOriginDate(useDate);
    const text = tpl
      .replace('{DATE}', dateDisplay)
      .replace('{NAME}', _originName());
    return { text, classKey, dateISO: useDate, dateDisplay };
  }

  // Idempotent savers — called at generation moments. Never overwrite.
  function saveBeginningIfMissing() {
    if (originBeginning && originBeginning.text) return;
    originBeginning = generateBeginningStory();
    save();
  }
  function saveAwakeningIfMissing(classKey) {
    if (originAwakening && originAwakening.text) return;
    const story = generateAwakeningStory(classKey);
    if (!story) return;
    originAwakening = story;
    save();
  }

  // ── v3 TEMPLATE REWRITE — regenerate existing stories using the new
  // template text while preserving the ORIGINAL stored date and (for
  // Chapter 2) class. Silent migration — no animation, no toast.
  function migrateOriginTextV3IfNeeded() {
    if (localStorage.getItem('hb_origin_v3_migrated') === '1') return;
    let dirty = false;
    if (originBeginning && originBeginning.text && originBeginning.dateISO) {
      const fresh = generateBeginningStory(originBeginning.dateISO);
      if (fresh) {
        // Preserve any flags on the original entry (e.g., migrated)
        fresh.migrated = !!originBeginning.migrated;
        originBeginning = fresh;
        dirty = true;
      }
    }
    if (originAwakening && originAwakening.text &&
        originAwakening.classKey && originAwakening.dateISO) {
      const fresh = generateAwakeningStory(originAwakening.classKey, originAwakening.dateISO);
      if (fresh) {
        fresh.migrated = !!originAwakening.migrated;
        originAwakening = fresh;
        dirty = true;
      }
    }
    localStorage.setItem('hb_origin_v3_migrated', '1');
    if (dirty) save();
  }

  // ── v4 TEMPLATE REWRITE — strip leading "{DATE}. " from body so the
  // date only appears once (in the chapter header). Preserves original
  // dateISO and (for Chapter 2) classKey. Silent.
  function migrateOriginTextV4IfNeeded() {
    if (localStorage.getItem('hb_origin_v4_migrated') === '1') return;
    let dirty = false;
    if (originBeginning && originBeginning.text && originBeginning.dateISO) {
      const fresh = generateBeginningStory(originBeginning.dateISO);
      if (fresh) {
        fresh.migrated = !!originBeginning.migrated;
        originBeginning = fresh;
        dirty = true;
      }
    }
    if (originAwakening && originAwakening.text &&
        originAwakening.classKey && originAwakening.dateISO) {
      const fresh = generateAwakeningStory(originAwakening.classKey, originAwakening.dateISO);
      if (fresh) {
        fresh.migrated = !!originAwakening.migrated;
        originAwakening = fresh;
        dirty = true;
      }
    }
    localStorage.setItem('hb_origin_v4_migrated', '1');
    if (dirty) save();
  }

  // One-time migration on first launch of the two-chapter version.
  // Case A: Civilian + no Beginning → generate Beginning (silently)
  // Case B: Awakened user + no stories → generate BOTH (silently)
  // Case C: User has stories → no-op
  function migrateOriginStoriesIfNeeded() {
    if (localStorage.getItem('hb_origin_v2_migrated') === '1') return;
    // CRITICAL: skip migration entirely while the user is still in
    // pre-onboarding state. Their playerName is still 'Hunter' (default)
    // and they haven't typed their real name yet. Wait — completeOnboarding
    // calls saveBeginningIfMissing AFTER setting the real name, so the
    // story is generated authentically there instead.
    if (needsOnboarding) return;
    const isAwakened = currentClass && currentClass !== 'CIVILIAN';

    // Beginning — every user gets one
    if (!originBeginning || !originBeginning.text) {
      originBeginning = generateBeginningStory();
      originBeginning.migrated = true;
    }

    // Awakening — only awakened users get one retroactively
    if (isAwakened && (!originAwakening || !originAwakening.text)) {
      const story = generateAwakeningStory(currentClass);
      if (story) {
        story.migrated = true;
        originAwakening = story;
      }
    }
    localStorage.setItem('hb_origin_v2_migrated', '1');
    save();
  }

  function _awkAvatarSrc(classKey) {
    const map = {
      STR: 'avatar-warrior.png',  VIT: 'avatar-ranger.png',
      INT: 'avatar-mage.png',     FOCUS: 'avatar-assassin.png',
      WILL: 'avatar-paladin.png', WLT: 'avatar-merchant.png',
      SAGE: 'avatar-sage.png',
    };
    // Look up by class key — classData passed in is from CLASSES[id]
    // so resolve via reverse lookup on name/emoji.
    for (const k in CLASSES) {
      if (CLASSES[k] === classKey || CLASSES[k].name === classKey.name) return map[k] || 'avatar-base.png';
    }
    return 'avatar-base.png';
  }

  function playAwakeningFanfare() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;
      // Heroic ascent — A4 → C#5 → E5 → A5 sustained, distinct from compound/PR
      const notes = [
        { f: 440.00, s: 0.00, d: 0.30, p: 0.22 },
        { f: 554.37, s: 0.18, d: 0.32, p: 0.22 },
        { f: 659.25, s: 0.36, d: 0.36, p: 0.24 },
        { f: 880.00, s: 0.55, d: 1.40, p: 0.30 },
        { f: 659.25, s: 0.55, d: 1.40, p: 0.18 },  // E5 layered with A5 for chord body
      ];
      notes.forEach(n => {
        ['sine', 'triangle'].forEach(type => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(n.f, t0 + n.s);
          osc.connect(gain); gain.connect(ac.destination);
          const peak = type === 'sine' ? n.p : n.p * 0.55;
          gain.gain.setValueAtTime(0.0001, t0 + n.s);
          gain.gain.exponentialRampToValueAtTime(peak, t0 + n.s + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.s + n.d);
          osc.start(t0 + n.s);
          osc.stop(t0 + n.s + n.d + 0.05);
        });
      });
    } catch (_) {}
  }

  function showAwakeningScreen(classData) {
    const overlay = document.getElementById('awakening-screen');
    if (!overlay) { levelUpActive = false; drainLevelUpQueue(); return; }
    overlay.style.setProperty('--awk-color', classData.color);
    document.getElementById('awk-avatar').src = _awkAvatarSrc(classData);
    document.getElementById('awk-name').textContent = classData.name.toUpperCase();
    document.getElementById('awk-desc').textContent = classData.desc;

    // Story text — revealed with typewriter after the avatar/title animation
    const storyEl = document.getElementById('awk-story');
    const hintEl  = document.getElementById('awk-hint');
    const fullText = (originAwakening && originAwakening.text) ? originAwakening.text : '';
    if (storyEl) {
      storyEl.textContent = '';
      storyEl.classList.remove('awk-story--done');
    }
    if (hintEl) hintEl.textContent = 'Tap to skip · or wait';

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('awk-show');
    playAwakeningFanfare();
    navigator.vibrate && navigator.vibrate([60, 40, 100, 40, 200]);

    // Typewriter — start after the content fade-in finishes (~800ms)
    let typeIdx = 0;
    let typing  = true;
    let typeTimer = null;
    const TYPE_MS = 28;

    function tick() {
      if (!typing || !storyEl) return;
      typeIdx++;
      storyEl.textContent = fullText.slice(0, typeIdx);
      if (typeIdx >= fullText.length) {
        typing = false;
        if (storyEl) storyEl.classList.add('awk-story--done');
        if (hintEl) hintEl.textContent = 'Tap to continue';
        return;
      }
      typeTimer = setTimeout(tick, TYPE_MS);
    }

    function startTypewriter() {
      if (!fullText) {
        typing = false;
        if (hintEl) hintEl.textContent = 'Tap to continue';
        return;
      }
      typeTimer = setTimeout(tick, 0);
    }
    const startTimer = setTimeout(startTypewriter, 850);

    // Auto-dismiss only AFTER the story has fully revealed (typing done) +
    // a generous read time. Tap behavior: first tap skips typing, second
    // tap dismisses.
    let autoDismissTimer = null;
    function scheduleAutoDismiss() {
      autoDismissTimer = setTimeout(dismiss, 5500);
    }
    // Initial loose auto-dismiss in case story is empty
    if (!fullText) scheduleAutoDismiss();

    function dismiss() {
      typing = false;
      clearTimeout(typeTimer);
      clearTimeout(startTimer);
      clearTimeout(autoDismissTimer);
      overlay.classList.remove('awk-show');
      overlay.classList.add('awk-hide');
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('awk-hide');
        overlay.classList.add('hidden');
        levelUpActive = false;
        drainLevelUpQueue();
      }, { once: true });
      overlay.removeEventListener('click', onTap);
    }
    function onTap() {
      if (typing) {
        // Skip typewriter — show full text immediately
        typing = false;
        clearTimeout(typeTimer);
        if (storyEl) {
          storyEl.textContent = fullText;
          storyEl.classList.add('awk-story--done');
        }
        if (hintEl) hintEl.textContent = 'Tap to continue';
        scheduleAutoDismiss();
      } else {
        dismiss();
      }
    }
    overlay.addEventListener('click', onTap);
    // Watchdog — if story is so long that it might not finish within reason,
    // start an auto-dismiss timer once typing completes naturally
    const watchdog = setInterval(() => {
      if (!typing && !autoDismissTimer) {
        scheduleAutoDismiss();
        clearInterval(watchdog);
      }
    }, 200);
  }

  // ── CLASS CHOICE — modal pick when 2+ stats hit Lv5 simultaneously
  function showClassChoiceScreen(optionKeys) {
    const overlay = document.getElementById('class-choice-screen');
    const list    = document.getElementById('cc-options');
    if (!overlay || !list) { levelUpActive = false; drainLevelUpQueue(); return; }

    const cards = optionKeys.map(key => {
      const c = CLASSES[key];
      if (!c) return '';
      return '<button class="cc-card" data-cc-key="' + esc(key) + '" ' +
                  'style="--cc-color:' + c.color + '">' +
        '<img class="cc-card-avatar" src="' + _awkAvatarSrc(c) + '" alt="">' +
        '<div class="cc-card-emoji">' + c.emoji + '</div>' +
        '<div class="cc-card-name">' + esc(c.name) + '</div>' +
        '<div class="cc-card-desc">' + esc(c.desc.split('.')[1] ? c.desc.split('.')[1].trim() : c.desc) + '</div>' +
        '<div class="cc-card-cta">Choose ' + esc(c.name) + '</div>' +
      '</button>';
    }).join('');
    list.innerHTML = cards;

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('cc-show');
    navigator.vibrate && navigator.vibrate([30, 30, 30]);

    function commit(classKey) {
      const wasCivilian = (currentClass === 'CIVILIAN' || !currentClass);
      currentClass = classKey;
      localStorage.setItem('hb_class', currentClass);
      // Close the choice overlay immediately
      overlay.classList.remove('cc-show');
      overlay.classList.add('cc-hide');
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('cc-hide');
        overlay.classList.add('hidden');
        // Then queue the Awakening celebration if this was the first class
        if (wasCivilian && !localStorage.getItem('hb_awakened_once')) {
          localStorage.setItem('hb_awakened_once', '1');
          // Save Chapter 2 now — survives if user closes the app
          // before the celebration finishes. Belt-and-suspenders: also
          // ensure Chapter 1 exists in case onboarding hook didn't fire.
          saveBeginningIfMissing();
          saveAwakeningIfMissing(classKey);
          levelUpQueue.unshift({ type: 'awakening', classData: CLASSES[classKey] });
        }
        levelUpActive = false;
        if (currentTab === 'profile') renderProfile();
        if (currentTab === 'stats')   renderStats();
        drainLevelUpQueue();
      }, { once: true });
    }

    list.querySelectorAll('.cc-card').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        commit(btn.getAttribute('data-cc-key'));
      });
    });
    // No background-click dismiss — choice is mandatory.
  }

  // ── LEVEL UP SCREENS ─────────────────────────────────────

  function showRankUpScreen(rank) {
    const screen  = document.getElementById('rankup-screen');
    const fx      = RANK_EFFECTS[rank.id] || RANK_EFFECTS['D'];
    const daysActive = Object.keys(completions).filter(d => completions[d].length > 0).length;

    // Reset, set color vars, apply rank class
    screen.className = 'rankup-screen ' + fx.cls;
    screen.style.setProperty('--ru-color', fx.color);
    screen.style.setProperty('--ru-glow',  fx.glow);

    // Badge
    const badgeEl = document.getElementById('rankup-badge');
    badgeEl.textContent = rank.id;

    // Top label
    const topLabel = document.getElementById('rankup-top-label');
    if (rank.id === 'S+') {
      topLabel.textContent = 'THE AWAKENED ONE';
      topLabel.classList.add('ru-awakened');
    } else {
      topLabel.textContent = 'RANK UP';
      topLabel.classList.remove('ru-awakened');
    }

    // Rank name + class
    document.getElementById('rankup-rank-name').textContent   = rank.label;
    document.getElementById('rankup-class-unlock').textContent = 'CLASS UNLOCKED: ' + getClass(rank.id);
    document.getElementById('rankup-xp-line').textContent     = totalPoints.toLocaleString() + ' Total XP';
    document.getElementById('rankup-days-line').textContent   = daysActive + ' Days Active';

    screen.classList.remove('hidden');

    // Screen shake
    if (fx.shake) {
      setTimeout(() => {
        screen.classList.add('ru-shake');
        screen.addEventListener('animationend', () => screen.classList.remove('ru-shake'), { once: true });
      }, 420);
    }

    // Particle burst
    if (fx.particles > 0) spawnBurstParticles(fx.particles, fx.color);

    // Shockwave ring
    if (fx.shockwave) {
      const sw = document.getElementById('rankup-shockwave');
      sw.style.setProperty('--ru-color', fx.color);
      void sw.offsetWidth;
      sw.classList.add('sw-active');
      sw.addEventListener('animationend', () => sw.classList.remove('sw-active'), { once: true });
    }

    // Lightning (A rank)
    if (fx.lightning) spawnLightning(fx.color);

    // Gold rain (S+)
    if (fx.rain) spawnGoldRain();

    navigator.vibrate && navigator.vibrate(rank.id === 'S+' ? [100,50,100,50,200] : rank.id === 'S' ? [80,40,120] : [60,30,80]);

    const dismiss = () => {
      screen.classList.add('ru-shake'); // clear any running shake
      screen.classList.add('hidden');
      document.querySelectorAll('.ru-particle,.ru-lightning,.ru-rain').forEach(el => el.remove());
      levelUpActive = false;
      drainLevelUpQueue();
    };
    document.getElementById('rankup-continue').onclick = dismiss;
  }

  function spawnBurstParticles(count, color) {
    const container = document.getElementById('rankup-particles-container');
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'ru-particle';
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist  = 80 + Math.random() * 160;
      const size  = 4 + Math.random() * 7;
      p.style.cssText =
        'left:' + cx + 'px;top:' + cy + 'px;' +
        'width:' + size + 'px;height:' + size + 'px;' +
        'background:' + color + ';' +
        '--tx:' + (Math.cos(angle) * dist) + 'px;' +
        '--ty:' + (Math.sin(angle) * dist) + 'px;' +
        'animation-delay:' + (Math.random() * 0.15) + 's;';
      container.appendChild(p);
      p.addEventListener('animationend', () => p.remove(), { once: true });
    }
  }

  function spawnLightning(color) {
    const container = document.getElementById('rankup-particles-container');
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    for (let i = 0; i < 5; i++) {
      const bolt = document.createElement('div');
      bolt.className = 'ru-lightning';
      const angle = Math.random() * 360;
      const len   = 55 + Math.random() * 90;
      bolt.style.cssText =
        'left:' + cx + 'px;top:' + cy + 'px;' +
        'width:' + len + 'px;height:2px;' +
        'background:linear-gradient(90deg,' + color + ',transparent);' +
        'transform-origin:left center;' +
        'transform:rotate(' + angle + 'deg);' +
        'animation-delay:' + (0.35 + i * 0.12) + 's;';
      container.appendChild(bolt);
      bolt.addEventListener('animationend', () => bolt.remove(), { once: true });
    }
  }

  function spawnGoldRain() {
    const screen = document.getElementById('rankup-screen');
    const w = window.innerWidth;
    for (let i = 0; i < 45; i++) {
      const p = document.createElement('div');
      p.className = 'ru-rain';
      const size  = 3 + Math.random() * 6;
      const delay = Math.random() * 2.5;
      const dur   = 1.8 + Math.random() * 2;
      p.style.cssText =
        'left:' + (Math.random() * w) + 'px;top:-10px;' +
        'width:' + size + 'px;height:' + size + 'px;' +
        'background:' + (Math.random() > 0.45 ? '#f59e0b' : '#fbbf24') + ';' +
        'animation-duration:' + dur + 's;' +
        'animation-delay:' + delay + 's;';
      screen.appendChild(p);
      p.addEventListener('animationend', () => p.remove(), { once: true });
    }
    // Refill while screen is open
    setTimeout(() => {
      if (!document.getElementById('rankup-screen').classList.contains('hidden')) spawnGoldRain();
    }, 2800);
  }

  function showStatLevelUp(item) {
    const { stat, level, bonusPts } = item;
    const isMax = level >= 20;
    const popup = document.getElementById('statlvl-popup');
    const card  = document.getElementById('statlvl-card');

    card.style.setProperty('--sl-color', stat.color);
    card.style.setProperty('--sl-glow',  stat.color + '35');

    if (isMax) {
      card.classList.add('sl-maxed');
      card.style.boxShadow = '0 0 80px ' + stat.color + '60, 0 0 160px ' + stat.color + '18, 0 -6px 36px rgba(0,0,0,0.55)';
      document.querySelector('.statlvl-label-top').textContent = 'STAT MASTERED';
    } else {
      card.classList.remove('sl-maxed');
      card.style.boxShadow = '0 0 36px ' + stat.color + '40, 0 -6px 36px rgba(0,0,0,0.55)';
      document.querySelector('.statlvl-label-top').textContent = 'LEVEL UP';
    }

    setStatIcon(document.getElementById('statlvl-icon'), stat, 64); // Stat Level Up popup — large hero icon
    document.getElementById('statlvl-name').textContent   = isMax
      ? stat.label.toUpperCase() + ' MASTERED'
      : stat.label + ' — ' + stat.name.toUpperCase();
    document.getElementById('statlvl-level').textContent  = isMax ? 'LEVEL 20 — MAX' : 'LEVEL ' + level;
    document.getElementById('statlvl-flavor').textContent = STAT_FLAVOR[stat.id] || '';

    const bar = document.getElementById('statlvl-bar');
    bar.style.background = isMax ? '#f59e0b' : stat.color;
    bar.style.boxShadow  = '0 0 8px ' + (isMax ? '#f59e0b' : stat.color);
    bar.style.width      = '0%';

    const bonusEl = document.getElementById('statlvl-bonus');
    if (bonusPts) {
      bonusEl.textContent = isMax ? 'MAX BONUS +' + bonusPts + ' XP AWARDED' : 'BONUS +' + bonusPts + ' XP AWARDED';
      bonusEl.style.color = '#f59e0b';
      bonusEl.classList.remove('hidden');
      card.classList.add('sl-bonus-flash');
    } else {
      bonusEl.classList.add('hidden');
      card.classList.remove('sl-bonus-flash');
    }

    popup.classList.remove('hidden');
    void card.offsetWidth;
    card.classList.add('sl-animate');
    setTimeout(() => { bar.style.width = '100%'; }, 80);

    navigator.vibrate && navigator.vibrate(isMax
      ? [40, 20, 80, 20, 120, 20, 200]
      : bonusPts ? [40, 20, 80, 20, 120] : [40, 20, 60]);

    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      popup.classList.add('hidden');
      card.classList.remove('sl-animate', 'sl-bonus-flash', 'sl-maxed');
      document.querySelector('.statlvl-label-top').textContent = 'LEVEL UP';
      levelUpActive = false;
      drainLevelUpQueue();
    };
    // Disarm tap-to-dismiss for the first 400ms so a stray tap from the
    // PREVIOUS popup in the queue doesn't carry through and instantly close
    // this one. Without this guard, multi-popup cascades (stat lvl-up → class
    // change → awakening) all collapse on a single tap.
    popup.onclick = null;
    setTimeout(() => { popup.onclick = dismiss; }, 400);
    timer = setTimeout(dismiss, isMax ? 5000 : 3000);
  }

  function captureStatLevels() {
    const levels = {};
    STATS.forEach(st => { levels[st.id] = statLevel(stats[st.id]?.pts || 0); });
    return levels;
  }

  function drainLevelUpQueue() {
    if (levelUpActive) return;
    if (!levelUpQueue.length) {
      if (achQueue.length && !achPopupTimer) drainAchQueue();
      return;
    }
    const item = levelUpQueue.shift();
    levelUpActive = true;
    if      (item.type === 'comeback')    showComebackScreen(item);
    else if (item.type === 'rank')        showRankUpScreen(item.rank);
    else if (item.type === 'class')       showClassChangePopup(item.classData);
    else if (item.type === 'awakening')   showAwakeningScreen(item.classData);
    else if (item.type === 'classChoice') showClassChoiceScreen(item.options);
    else if (item.type === 'perfectday')  showPerfectDayScreen(item);
    else                                  showStatLevelUp(item);
  }

  function drainAchQueue() {
    if (!achQueue.length) { achPopupTimer = null; return; }
    const ach = achQueue.shift();
    showAchievementPopup(ach);
  }

  function showAchievementPopup(ach) {
    const popup = document.getElementById('ach-popup');
    document.querySelector('.ach-popup-label').textContent = ach.label || 'ACHIEVEMENT UNLOCKED';
    // Use innerHTML + streakify so 🔥-keyed achievements ("Streak Hunter",
    // "Compound Month") render the custom flame icon. Other achievement
    // emojis pass through escaped via streakify.
    // Achievement icon stripped — card identity comes from the title +
    // colored ring instead of an emoji glyph. (Emoji-free pass.)
    document.getElementById('ach-popup-icon').innerHTML = '';
    document.getElementById('ach-popup-name').textContent = ach.name;
    document.getElementById('ach-popup-desc').textContent = ach.desc;
    popup.classList.remove('hidden');
    navigator.vibrate && navigator.vibrate([60, 40, 80]);

    const dismiss = () => {
      clearTimeout(achPopupTimer);
      popup.classList.add('hidden');
      achPopupTimer = setTimeout(drainAchQueue, 400);
    };
    popup.onclick = dismiss;
    achPopupTimer = setTimeout(dismiss, 4000);
  }

  // ── HISTORY ──────────────────────────────────────────────
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const HG_DCOL = { easy: '#8b5cf6', medium: '#3b82f6', hard: '#f97316', legendary: '#f59e0b' };

  // Returns array of 7 date strings (Mon→Sun) for the week at offset
  function getWeekDates(offset) {
    const base = new Date(today + 'T12:00:00');
    const dow  = (base.getDay() + 6) % 7;   // Mon = 0
    const mon  = new Date(base);
    mon.setDate(base.getDate() - dow + offset * 7);
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function renderHistory() {
    const el = document.getElementById('history-content');
    el.innerHTML = '';

    // ── View mode tabs ────────────────────────────────────
    const tabs = document.createElement('div');
    tabs.className = 'hg-view-tabs';
    ['weekly','monthly','yearly','achievements'].forEach(mode => {
      const btn = document.createElement('button');
      btn.className = 'hg-view-tab' + (histViewMode === mode ? ' hg-view-tab--active' : '');
      btn.textContent = mode === 'achievements' ? 'Achieved' : mode.charAt(0).toUpperCase() + mode.slice(1);
      btn.addEventListener('click', () => { histViewMode = mode; renderHistory(); });
      tabs.appendChild(btn);
    });
    el.appendChild(tabs);

    // ── Mode content ──────────────────────────────────────
    if      (histViewMode === 'weekly')       hgBuildWeekly(el);
    else if (histViewMode === 'monthly')      hgBuildMonthly(el);
    else if (histViewMode === 'yearly')       hgBuildYearly(el);
    else                                      hgBuildAchievements(el);

    // ── Bottom stats bar (not shown in achievements view) ─
    if (histViewMode !== 'achievements') hgBuildStatsBar(el);
  }

  // ── HABIT INFO POPUP STATS ───────────────────────────────
  // Lifetime longest streak — walks every completion date and counts the
  // longest run of consecutive scheduled-day completions. Honours each
  // habit's day-of-week schedule via hasScheduledDayBetween.
  function computeBestStreakForHabit(habit) {
    const days = habit.days || ALL_DAYS;
    const dates = Object.keys(completions)
      .filter(d => Array.isArray(completions[d]) && completions[d].includes(habit.id))
      .sort();
    if (dates.length === 0) return 0;
    let best = 1, cur = 1;
    for (let i = 1; i < dates.length; i++) {
      // If no missed scheduled day exists between the previous completion
      // and this one, the streak continues; otherwise it resets to 1.
      if (!hasScheduledDayBetween(days, dates[i - 1], dates[i])) {
        cur += 1;
      } else {
        cur = 1;
      }
      if (cur > best) best = cur;
    }
    return best;
  }

  // Completions in the trailing 7 days (today inclusive)
  function computeWeekCompletionsForHabit(habit) {
    let n = 0;
    let d = today;
    for (let i = 0; i < 7; i++) {
      if (Array.isArray(completions[d]) && completions[d].includes(habit.id)) n++;
      d = prevDay(d);
    }
    return n;
  }

  // All-time completion count
  function computeTotalCompletionsForHabit(habit) {
    let n = 0;
    for (const d in completions) {
      if (Array.isArray(completions[d]) && completions[d].includes(habit.id)) n++;
    }
    return n;
  }

  // ── WEEKLY VIEW ───────────────────────────────────────────
  function hgBuildWeekly(el) {
    const DAY_ABBR = ['M','T','W','T','F','S','S'];
    const dates    = getWeekDates(histWeekOffset);
    const isCurr   = histWeekOffset === 0;

    function fmtD(ds) { return ds.slice(5,7) + '/' + ds.slice(8,10); }

    // Nav row
    const nav = document.createElement('div');
    nav.className = 'hg-nav';
    nav.innerHTML =
      '<button class="hist-nav-btn" id="hg-prev">&#8249;</button>' +
      '<span class="hg-nav-range">' + fmtD(dates[0]) + ' → ' + fmtD(dates[6]) + '</span>' +
      '<button class="hist-nav-btn" id="hg-next"' + (isCurr ? ' disabled' : '') + '>&#8250;</button>';
    el.appendChild(nav);
    document.getElementById('hg-prev').addEventListener('click', () => { histWeekOffset--; renderHistory(); });
    document.getElementById('hg-next').addEventListener('click', () => { if (!isCurr) { histWeekOffset++; renderHistory(); } });

    // Habits active this week
    const activeHabits = habits.filter(h =>
      dates.some(ds => isScheduledOn(h.days, ds) || (completions[ds] || []).includes(h.id))
    );

    if (activeHabits.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'hg-empty';
      empty.textContent = 'No habits scheduled for this week.';
      el.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'hg-grid-wrap';

    // Header row: label + 7 day abbrs + badge placeholder
    const hdrRow = document.createElement('div');
    hdrRow.className = 'hg-row hg-header-row';
    hdrRow.appendChild(Object.assign(document.createElement('div'), { className: 'hg-label hg-label-hdr' }));
    dates.forEach((ds, i) => {
      const c = document.createElement('div');
      c.className = 'hg-day-hdr' + (ds === today ? ' hg-day-hdr--today' : '');
      c.textContent = DAY_ABBR[i];
      hdrRow.appendChild(c);
    });
    hdrRow.appendChild(Object.assign(document.createElement('div'), { className: 'hg-badge-col' }));
    wrap.appendChild(hdrRow);

    // One row per habit
    activeHabits.forEach(habit => {
      const diff       = habit.difficulty || 'easy';
      const statColor  = getHabitStatColor(habit);
      const opacity    = DIFF_OPACITY[diff] || 0.6;
      const cellBg     = colorWithAlpha(statColor, opacity);

      // Perfect week? Every scheduled past/today day must be done
      const schedPast = dates.filter(ds => ds <= today && isScheduledOn(habit.days, ds));
      const isPerfect = schedPast.length > 0 &&
        schedPast.every(ds => (completions[ds] || []).includes(habit.id));

      const row = document.createElement('div');
      row.className = 'hg-row';

      // Label — clean base name (no duration suffix), bold, no emoji on the History tab
      const label = document.createElement('div');
      label.className = 'hg-label';
      label.innerHTML =
        '<span class="hg-label-name">' + esc(habitBaseName(habit)) + '</span>' +
        '<button class="hg-info-btn" aria-label="More info about ' + esc(habitBaseName(habit)) +
          '" data-habit-info="' + esc(habit.id) + '">ⓘ</button>';
      row.appendChild(label);

      // 7 cells
      dates.forEach(ds => {
        const cell    = document.createElement('div');
        const isFuture   = ds > today;
        const isSchedDay = isScheduledOn(habit.days, ds);
        const isDone     = (completions[ds] || []).includes(habit.id);

        if (isDone) {
          cell.className = 'hg-cell hg-cell--done' + (diff === 'legendary' ? ' hg-cell--legendary' : '');
          // Stat color with difficulty-based opacity. Legendary gets a soft outer glow.
          cell.style.cssText = 'background:' + cellBg
            + ';box-shadow:0 0 6px ' + colorWithAlpha(statColor, 0.35)
            + (diff === 'legendary' ? ',0 0 0 1px ' + colorWithAlpha(statColor, 0.9) : '');
          // Tiny corner dot when this completion was auto-verified via
          // HealthKit. v1.1.4 scope: only Daily walk; design intentionally
          // does NOT recolor the cell (stat color stays the source-of-truth
          // signal). See AUTO_VERIFY module.
          if (typeof AUTO_VERIFY !== 'undefined' && AUTO_VERIFY.isAutoVerifiedOnDate(habit.id, ds)) {
            cell.classList.add('hg-cell--auto');
          }
        } else if (isFuture) {
          cell.className = 'hg-cell hg-cell--future';
        } else if (isSchedDay) {
          cell.className = 'hg-cell hg-cell--missed';
        } else {
          cell.className = 'hg-cell hg-cell--off';
        }
        row.appendChild(cell);
      });

      // Perfect badge
      const badgeCol = document.createElement('div');
      badgeCol.className = 'hg-badge-col';
      if (isPerfect) {
        const b = document.createElement('span');
        b.className = 'hg-perfect-badge';
        b.textContent = 'PERFECT';
        badgeCol.appendChild(b);
      }
      row.appendChild(badgeCol);
      wrap.appendChild(row);
    });

    el.appendChild(wrap);
  }

  // ── MONTHLY VIEW — per-habit mini calendar cards ─────────
  function hgBuildMonthly(el) {
    const year  = histViewYear;
    const month = histViewMonth;
    const now   = new Date();
    const isCurr = year === now.getFullYear() && month === now.getMonth();

    // Nav row
    const nav = document.createElement('div');
    nav.className = 'hg-nav';
    nav.innerHTML =
      '<button class="hist-nav-btn" id="hg-prev">&#8249;</button>' +
      '<span class="hg-nav-range">' + MONTH_NAMES[month] + ' ' + year + '</span>' +
      '<button class="hist-nav-btn" id="hg-next"' + (isCurr ? ' disabled' : '') + '>&#8250;</button>';
    el.appendChild(nav);
    document.getElementById('hg-prev').addEventListener('click', () => {
      histViewMonth--; if (histViewMonth < 0) { histViewMonth = 11; histViewYear--; } renderHistory();
    });
    document.getElementById('hg-next').addEventListener('click', () => {
      if (isCurr) return; histViewMonth++; if (histViewMonth > 11) { histViewMonth = 0; histViewYear++; } renderHistory();
    });

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow    = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0

    // Only habits active at least one day this month (past/today)
    const activeHabits = habits.filter(h => {
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
        if (ds <= today && isScheduledOn(h.days, ds)) return true;
      }
      return false;
    });

    if (!activeHabits.length) {
      const empty = document.createElement('div');
      empty.className = 'hg-empty';
      empty.textContent = 'No habits active this month.';
      el.appendChild(empty);
      return;
    }

    const cardsGrid = document.createElement('div');
    cardsGrid.className = 'hg-month-cards-grid';

    activeHabits.forEach(habit => {
      const diff      = habit.difficulty || 'easy';
      const statColor = getHabitStatColor(habit);
      const opacity   = DIFF_OPACITY[diff] || 0.6;
      const cellBg    = colorWithAlpha(statColor, opacity);

      const card = document.createElement('div');
      card.className = 'hg-habit-card';

      // ── Banner ─── stat-tinted, clean base name, info icon
      const banner = document.createElement('div');
      banner.className = 'hg-habit-card-banner';
      banner.style.cssText = 'background:linear-gradient(135deg,'
        + colorWithAlpha(statColor, 0.18) + ',' + colorWithAlpha(statColor, 0.06)
        + ');border-bottom:1px solid ' + colorWithAlpha(statColor, 0.35) + ';';
      const bName = document.createElement('span');
      bName.className = 'hg-habit-card-name';
      bName.textContent = habitBaseName(habit);
      const bInfo = document.createElement('button');
      bInfo.className = 'hg-info-btn';
      bInfo.setAttribute('aria-label', 'More info about ' + habitBaseName(habit));
      bInfo.setAttribute('data-habit-info', habit.id);
      bInfo.textContent = 'ⓘ';
      banner.append(bName, bInfo);
      card.appendChild(banner);

      // ── Mini calendar ────────────────────────────────────
      const calBody = document.createElement('div');
      calBody.className = 'hg-habit-cal-body';

      // DOW headers
      const hdrRow = document.createElement('div');
      hdrRow.className = 'hg-habit-cal-hdr';
      ['M','T','W','T','F','S','S'].forEach(d => {
        const c = document.createElement('div');
        c.className = 'hg-habit-cal-hdr-cell';
        c.textContent = d;
        hdrRow.appendChild(c);
      });
      calBody.appendChild(hdrRow);

      // Grid cells
      const calGrid = document.createElement('div');
      calGrid.className = 'hg-habit-cal-grid';

      // Blank offset cells
      for (let i = 0; i < firstDow; i++) {
        const blank = document.createElement('div');
        blank.className = 'hg-habit-cal-cell hg-habit-cal-cell--empty';
        calGrid.appendChild(blank);
      }

      let schedDays = 0, doneDays = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const ds         = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
        const isFuture   = ds > today;
        const isSchedDay = isScheduledOn(habit.days, ds);
        const isDone     = (completions[ds] || []).includes(habit.id);

        if (!isFuture && isSchedDay) schedDays++;
        if (!isFuture && isDone)     doneDays++;

        const cell = document.createElement('div');
        cell.className = 'hg-habit-cal-cell';
        cell.textContent = d;

        if (isFuture) {
          cell.classList.add('hg-habit-cal-cell--future');
        } else if (isDone) {
          cell.classList.add('hg-habit-cal-cell--done' + (diff === 'legendary' ? ' hg-habit-cal-cell--legendary' : ''));
          cell.style.cssText = 'background:' + cellBg + ';color:#000;font-weight:700;'
            + (diff === 'legendary' ? 'box-shadow:0 0 0 1px ' + colorWithAlpha(statColor, 0.9) + ';' : '');
        } else if (isSchedDay) {
          cell.classList.add('hg-habit-cal-cell--missed');
        } else {
          cell.classList.add('hg-habit-cal-cell--off');
        }
        calGrid.appendChild(cell);
      }

      calBody.appendChild(calGrid);
      card.appendChild(calBody);

      // ── Footer ───────────────────────────────────────────
      const isPerfect = schedDays > 0 && doneDays >= schedDays;
      const pct       = schedDays > 0 ? (doneDays / schedDays * 100) : 0;
      const pctStr    = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);

      const footer = document.createElement('div');
      footer.className = 'hg-habit-card-footer';
      const stat = document.createElement('span');
      stat.className = 'hg-habit-card-stat';
      stat.textContent = pctStr + '% | ' + doneDays + 'd';
      footer.appendChild(stat);
      if (isPerfect) {
        const badge = document.createElement('span');
        badge.className = 'hg-perfect-badge';
        badge.textContent = 'PERFECT';
        footer.appendChild(badge);
      }
      card.appendChild(footer);

      cardsGrid.appendChild(card);
    });

    el.appendChild(cardsGrid);
  }

  // ── YEARLY VIEW — per-habit contribution rows ─────────────
  function hgBuildYearly(el) {
    const yearNum = histViewYear;
    const now     = new Date();
    const isCurr  = yearNum === now.getFullYear();

    // Nav
    const nav = document.createElement('div');
    nav.className = 'hg-nav';
    nav.innerHTML =
      '<button class="hist-nav-btn" id="hg-prev">&#8249;</button>' +
      '<span class="hg-nav-range">' + yearNum + '</span>' +
      '<button class="hist-nav-btn" id="hg-next"' + (isCurr ? ' disabled' : '') + '>&#8250;</button>';
    el.appendChild(nav);
    document.getElementById('hg-prev').addEventListener('click', () => { histViewYear--; renderHistory(); });
    document.getElementById('hg-next').addEventListener('click', () => { if (!isCurr) { histViewYear++; renderHistory(); } });

    const isLeap     = (yearNum % 4 === 0 && yearNum % 100 !== 0) || yearNum % 400 === 0;
    const totalDays  = isLeap ? 366 : 365;
    const jan1Dow    = (new Date(yearNum, 0, 1).getDay() + 6) % 7; // Mon=0
    const totalWeeks = Math.ceil((totalDays + jan1Dow) / 7);

    const wrap = document.createElement('div');
    wrap.className = 'hg-year-habits-wrap';

    habits.forEach(habit => {
      const diff      = habit.difficulty || 'easy';
      const statColor = getHabitStatColor(habit);
      const opacity   = DIFF_OPACITY[diff] || 0.6;
      const cellBg    = colorWithAlpha(statColor, opacity);

      // Tally totals for the year
      let schedDays = 0, doneDays = 0;
      for (let d = 0; d < totalDays; d++) {
        const dt = new Date(yearNum, 0, 1 + d);
        const ds = yearNum + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
        if (ds > today) break;
        if (isScheduledOn(habit.days, ds)) {
          schedDays++;
          if ((completions[ds] || []).includes(habit.id)) doneDays++;
        }
      }

      const pct    = schedDays > 0 ? (doneDays / schedDays * 100) : 0;
      const pctStr = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);

      const row = document.createElement('div');
      row.className = 'hg-year-habit-row';

      // Row header — clean base name, info icon, no emoji on History tab
      const hdr = document.createElement('div');
      hdr.className = 'hg-year-habit-hdr';
      const info = document.createElement('div');
      info.className = 'hg-year-habit-info';
      info.innerHTML =
        '<span class="hg-year-habit-name">' + esc(habitBaseName(habit)) + '</span>' +
        '<button class="hg-info-btn" aria-label="More info about ' + esc(habitBaseName(habit)) +
          '" data-habit-info="' + esc(habit.id) + '">ⓘ</button>';
      const stats = document.createElement('div');
      stats.className = 'hg-year-habit-stats';
      stats.textContent = pctStr + '% | ' + doneDays + 'D';
      hdr.append(info, stats);
      row.appendChild(hdr);

      // Grid wrap (month labels + week columns)
      const gridWrap = document.createElement('div');
      gridWrap.className = 'hg-year-habit-grid-wrap';

      const monthLabels = document.createElement('div');
      monthLabels.className = 'hg-year-habit-months';
      const weeksRow = document.createElement('div');
      weeksRow.className = 'hg-year-habit-grid';

      let prevMonth = -1;
      for (let w = 0; w < totalWeeks; w++) {
        const mlbl = document.createElement('div');
        mlbl.className = 'hg-year-habit-month-lbl';

        const col = document.createElement('div');
        col.className = 'hg-year-habit-col';

        for (let d = 0; d < 7; d++) {
          const dayIdx = w * 7 + d - jan1Dow;
          const cell   = document.createElement('div');
          cell.className = 'hg-year-habit-cell';

          if (dayIdx < 0 || dayIdx >= totalDays) {
            cell.classList.add('hg-year-habit-cell--empty');
            col.appendChild(cell);
            continue;
          }

          const dt  = new Date(yearNum, 0, 1 + dayIdx);
          const ds  = yearNum + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
          const mo  = dt.getMonth();

          if (d === 0 && mo !== prevMonth) {
            mlbl.textContent = MONTH_SHORT[mo];
            prevMonth = mo;
          }

          const isFuture   = ds > today;
          const isSchedDay = isScheduledOn(habit.days, ds);
          const isDone     = (completions[ds] || []).includes(habit.id);

          if (isFuture) {
            cell.classList.add('hg-year-habit-cell--future');
          } else if (isDone) {
            cell.classList.add('hg-year-habit-cell--done' + (diff === 'legendary' ? ' hg-year-habit-cell--legendary' : ''));
            cell.style.background = cellBg;
            if (diff === 'legendary') {
              cell.style.boxShadow = '0 0 0 1px ' + colorWithAlpha(statColor, 0.9);
            }
          } else if (isSchedDay) {
            cell.classList.add('hg-year-habit-cell--missed');
          } else {
            cell.classList.add('hg-year-habit-cell--skip');
          }

          col.appendChild(cell);
        }

        monthLabels.appendChild(mlbl);
        weeksRow.appendChild(col);
      }

      gridWrap.appendChild(monthLabels);
      gridWrap.appendChild(weeksRow);
      row.appendChild(gridWrap);
      wrap.appendChild(row);
    });

    el.appendChild(wrap);
  }

  // ── STATS BAR (all views) ─────────────────────────────────
  function hgBuildStatsBar(el) {
    // All-time totals
    let totalDone = 0, totalSched = 0;
    const dayTotals = [0,0,0,0,0,0,0];
    const dayCounts = [0,0,0,0,0,0,0];
    Object.keys(completions).forEach(ds => {
      if (ds > today) return;
      const doneIds = completions[ds] || [];
      const sched   = habits.filter(h => isScheduledOn(h.days, ds));
      if (!sched.length) return;
      const nDone = doneIds.filter(id => sched.some(h => h.id === id)).length;
      totalSched += sched.length;
      totalDone  += nDone;
      const dow = (new Date(ds + 'T12:00:00').getDay() + 6) % 7;
      dayTotals[dow] += nDone / sched.length;
      dayCounts[dow]++;
    });

    const pct = totalSched > 0 ? Math.round((totalDone / totalSched) * 100) : 0;
    const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const dayRates  = dayTotals.map((t, i) => dayCounts[i] > 0 ? t / dayCounts[i] : 0);
    const bestIdx   = dayRates.indexOf(Math.max(...dayRates));
    const bestDay   = dayRates[bestIdx] > 0 ? DAY_NAMES[bestIdx] : '—';
    const bestStreak = Object.values(streaks).reduce((m, s) => Math.max(m, s ? (s.count || 0) : 0), 0);

    const bar = document.createElement('div');
    bar.className = 'hist-stats-bar';
    bar.innerHTML =
      '<div class="hist-stat"><span class="hist-stat-val">' + pct + '%</span><span class="hist-stat-lbl">Completion</span></div>' +
      '<div class="hist-stat-divider"></div>' +
      '<div class="hist-stat"><span class="hist-stat-val">' + bestDay + '</span><span class="hist-stat-lbl">Best Day</span></div>' +
      '<div class="hist-stat-divider"></div>' +
      '<div class="hist-stat"><span class="hist-stat-val">' + totalDone.toLocaleString() + '</span><span class="hist-stat-lbl">Total Done</span></div>' +
      '<div class="hist-stat-divider"></div>' +
      '<div class="hist-stat"><span class="hist-stat-val">' + bestStreak + '</span><span class="hist-stat-lbl">Best Streak</span></div>';
    el.appendChild(bar);
  }

  // ── ACHIEVEMENTS VIEW ─────────────────────────────────────
  function hgBuildAchievements(el) {
    const unlockedCount = [...unlockedAchievements].length;
    const total         = ACHIEVEMENTS.length;

    // Header summary
    const header = document.createElement('div');
    header.className = 'hg-ach-header';
    header.innerHTML =
      '<span class="hg-ach-count">' + unlockedCount + ' / ' + total + '</span>' +
      '<span class="hg-ach-subtitle">Achievements Unlocked</span>';

    // Progress bar
    const trackWrap = document.createElement('div');
    trackWrap.className = 'hg-ach-track';
    const trackFill = document.createElement('div');
    trackFill.className = 'hg-ach-fill';
    trackFill.style.width = Math.round((unlockedCount / total) * 100) + '%';
    trackWrap.appendChild(trackFill);

    el.appendChild(header);
    el.appendChild(trackWrap);

    // Achievement list — unlocked first, then locked
    const sorted = [...ACHIEVEMENTS].sort((a, b) => {
      const au = unlockedAchievements.has(a.id);
      const bu = unlockedAchievements.has(b.id);
      if (au === bu) return 0;
      return au ? -1 : 1;
    });

    const list = document.createElement('div');
    list.className = 'hg-ach-list';

    sorted.forEach(ach => {
      const unlocked = unlockedAchievements.has(ach.id);
      const row = document.createElement('div');
      row.className = 'hg-ach-row' + (unlocked ? ' hg-ach-row--unlocked' : ' hg-ach-row--locked');
      row.innerHTML =
        // Icon column dropped from achievement rows — emoji-free pass.
        // Locked vs unlocked state is signaled by the row class only.
        '<div class="hg-ach-info">' +
          '<div class="hg-ach-name">' + esc(ach.name) + '</div>' +
          '<div class="hg-ach-desc">' + esc(ach.desc) + '</div>' +
        '</div>' +
        (unlocked ? '<div class="hg-ach-check">✓</div>' : '');
      list.appendChild(row);
    });

    el.appendChild(list);
  }

  function showDayPopup(dd) {
    const { dateStr, doneIds } = dd;
    const dateDisplay = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'long', day: 'numeric'
    });

    // Compute XP for completed habits that still exist
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' })
      .format(new Date(dateStr + 'T12:00:00Z'));
    const wasWeekend = ['Fri','Sat','Sun'].includes(dow);
    let xpTotal = 0;
    const completedHabits = (doneIds || []).map(id => habits.find(h => h.id === id)).filter(Boolean);
    completedHabits.forEach(h => {
      const base = (DIFFICULTY[h.difficulty] || DIFFICULTY.easy).pts;
      xpTotal += wasWeekend ? base * 2 : base;
    });

    document.getElementById('day-popup-date').textContent = dateDisplay;

    const listEl = document.getElementById('day-popup-habits');
    if (completedHabits.length) {
      listEl.innerHTML = completedHabits.map(h =>
        '<div class="day-popup-habit">' +
          ((getHabitIcon(h) || h.emoji) ? '<span class="day-popup-habit-emoji">' + habitIconHtml(h, { size: 22 }) + '</span>' : '') +
          '<span>' + esc(h.name) + '</span>' +
        '</div>'
      ).join('');
    } else {
      listEl.innerHTML = '<div class="day-popup-none">No habits completed</div>';
    }

    const xpEl = document.getElementById('day-popup-xp');
    xpEl.textContent = xpTotal > 0 ? '+' + xpTotal + ' XP earned' : '';

    document.getElementById('day-popup').classList.remove('hidden');
    document.getElementById('day-popup-overlay').classList.remove('hidden');
  }

  function closeDayPopup() {
    document.getElementById('day-popup').classList.add('hidden');
    document.getElementById('day-popup-overlay').classList.add('hidden');
  }

  // ── DAY CHANGE ────────────────────────────────────────────
  function checkDayChange() {
    const newDate = getPTDate();
    if (newDate !== today) {
      today = newDate;
      streakDangerDismissed = false; // reset for new day
      // Streak Forgiveness: process the missed-day window now that we
      // know yesterday is locked in. Shields/Honest Days absorb missed
      // days; otherwise the streak breaks and a comeback flag is set.
      if (typeof processStreakRollover === 'function') processStreakRollover();
      if (typeof flushPendingShieldNotices === 'function') {
        setTimeout(flushPendingShieldNotices, 800);
      }
      checkClassChange();
      render();
      // Rebuild today's notification schedule under the new date —
      // honors paused/disabled/daily-limit/quiet-hours.
      try { Notif.rescheduleAll(habits, today, completions[today] || []); } catch (_) {}
    }
  }

  // ── PERFECT DAY STREAK ───────────────────────────────────

  function checkPerfectDay() {
    const todayHabits = habits.filter(isScheduledToday);
    if (!todayHabits.length) return;
    const allDone = todayHabits.every(h => isChecked(h.id));

    if (allDone) {
      if (perfectStreak.lastDate === today) return; // already logged today
      perfectStreak.prevCount    = perfectStreak.count;
      perfectStreak.prevLastDate = perfectStreak.lastDate;
      const yesterday = prevDay(today);
      perfectStreak.count    = perfectStreak.lastDate === yesterday ? perfectStreak.count + 1 : 1;
      perfectStreak.lastDate = today;
      save();
      updatePerfectStreakDisplay();
      checkPerfectStreakMilestone();
      // Feature 5: lightweight perfect-day celebration (every perfect day, separate from milestone screen)
      // Delay slightly so compound popup (if any) can appear first
      setTimeout(triggerPerfectDayCelebration, 400);
    } else {
      if (perfectStreak.lastDate !== today) return; // wasn't a perfect day anyway
      perfectStreak.count    = perfectStreak.prevCount    || 0;
      perfectStreak.lastDate = perfectStreak.prevLastDate || null;
      save();
      updatePerfectStreakDisplay();
    }
  }

  function checkPerfectStreakMilestone() {
    const n   = perfectStreak.count;
    const key = String(n);
    if (psAwarded.has(key)) return;

    let ms = PERFECT_STREAK_MILESTONES.find(m => m.day === n);
    if (!ms && n > 100 && (n - 100) % 30 === 0) {
      ms = { ...PS_REPEAT, day: n, title: 'UNSTOPPABLE — Day ' + n };
    }
    if (!ms) return;

    psAwarded.add(key);
    totalPoints += ms.bonus;
    save();
    renderRank();
    levelUpQueue.push({ type: 'perfectday', milestone: ms, streakCount: n });
    if (!levelUpActive) drainLevelUpQueue();
  }

  function updatePerfectStreakDisplay() {
    const el = document.getElementById('perfect-streak-display');
    if (!el) return;
    const todayHabits  = habits.filter(isScheduledToday);
    const isPerfect    = todayHabits.length > 0 && todayHabits.every(h => isChecked(h.id));
    const yesterday    = prevDay(today);
    const displayCount = (perfectStreak.lastDate === today || perfectStreak.lastDate === yesterday)
      ? perfectStreak.count : 0;
    el.className = 'perfect-streak-display' + (isPerfect ? ' ps-gold' : '');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'View all streaks');
    el.innerHTML = '<span class="ps-fire">' + streakIconHtml({ size: 18 }) + '</span><span class="ps-count">' + displayCount + '</span>';
  }

  // ── ALL STREAKS SHEET ────────────────────────────────────
  // Opened by tapping the 🔥 streak pill in the header. Shows
  // perfect-day streak, Morning Routine compound streak, Locked-In
  // compound streak, and the user's chosen path — all info that
  // previously lived as cluttered rows on the Status tab.
  function openStreaksSheet() {
    const body = document.getElementById('streaks-body');
    if (!body) return;

    const yesterday = prevDay(today);
    const pdCount   = (perfectStreak.lastDate === today || perfectStreak.lastDate === yesterday)
      ? perfectStreak.count : 0;
    const pdBest    = Math.max(perfectStreak.count || 0, perfectStreak.prevCount || 0);

    // Determine the displayed path. Locked-In is a SUPERSET of Morning
    // Routine (10 MR habits + 6 extras), so if the user has an active
    // Locked-In streak, that's the path they're actually walking. Show
    // the highest-tier active pack:
    //   1. Locked-In (if streak is active today/yesterday)
    //   2. Morning Routine (if streak is active OR selectedPackId === 'morning')
    //   3. Whatever selectedPackId points at (custom path, etc.)
    let pathPackId = null;
    const liStreak = compoundStreaks['locked-in'];
    const mrStreak = compoundStreaks['morning'];
    const liActive = liStreak && liStreak.streak > 0 &&
                     (liStreak.lastDate === today || liStreak.lastDate === yesterday);
    const mrActive = mrStreak && mrStreak.streak > 0 &&
                     (mrStreak.lastDate === today || mrStreak.lastDate === yesterday);
    if (liActive)                                pathPackId = 'locked-in';
    else if (mrActive)                           pathPackId = 'morning';
    else if (selectedPackId)                     pathPackId = selectedPackId;
    const path = pathPackId && PACKS.find(p => p.id === pathPackId);

    const compoundRows = BONUS_PACK_IDS
      .filter(packId => {
        const cs = compoundStreaks[packId];
        return cs && (cs.streak > 0 || cs.lastDate);
      })
      .map(packId => {
        const pack = getPackById(packId);
        const cs   = compoundStreaks[packId] || {};
        const live = (cs.lastDate === today || cs.lastDate === yesterday) ? (cs.streak || 0) : 0;
        const accent = packId === 'locked-in' ? '#7c3aed' : '#f59e0b';
        const iconHTML = packId === 'morning'   ? packIconHtml('morning',  { size: 32 }) :
                         packId === 'locked-in' ? packIconHtml('lockedin', { size: 32 }) :
                         iconify(packId === 'locked-in' ? '🔒' : '⚡', { size: 22 });
        return (
          '<div class="streaks-row" style="--row-accent:' + accent + '">' +
            '<div class="streaks-row-icon">' + iconHTML + '</div>' +
            '<div class="streaks-row-main">' +
              '<div class="streaks-row-name">' + esc(pack.name) + '</div>' +
              '<div class="streaks-row-sub">Compound bonus pack</div>' +
            '</div>' +
            '<div class="streaks-row-count">' +
              '<span class="streaks-count-num">' + live + '</span>' +
              '<span class="streaks-count-lbl">day' + (live === 1 ? '' : 's') + '</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');

    let html = '';

    // Perfect Day streak — always visible, even at 0
    html +=
      '<div class="streaks-row streaks-row--perfect" style="--row-accent:#fbbf24">' +
        '<div class="streaks-row-icon">' + streakIconHtml({ size: 28 }) + '</div>' +
        '<div class="streaks-row-main">' +
          '<div class="streaks-row-name">Perfect Day Streak</div>' +
          '<div class="streaks-row-sub">' +
            (pdBest > pdCount ? ('Best: ' + pdBest + ' day' + (pdBest === 1 ? '' : 's')) : 'All habits, every day') +
          '</div>' +
        '</div>' +
        '<div class="streaks-row-count">' +
          '<span class="streaks-count-num">' + pdCount + '</span>' +
          '<span class="streaks-count-lbl">day' + (pdCount === 1 ? '' : 's') + '</span>' +
        '</div>' +
      '</div>';

    // Compound pack streaks (only if user has data for them)
    if (compoundRows) html += compoundRows;

    // Path indicator (subtle row at the bottom)
    if (path) {
      html +=
        '<div class="streaks-path-row">' +
          '<span class="streaks-path-dot" style="background:' + path.color + '"></span>' +
          '<span class="streaks-path-label">Path: <strong>' + esc(path.name) + '</strong></span>' +
        '</div>';
    }

    // Empty state — no streaks active and no path
    if (pdCount === 0 && !compoundRows && !path) {
      html =
        '<div class="streaks-empty">' +
          '<div class="streaks-empty-icon">' + streakIconHtml({ size: 56 }) + '</div>' +
          '<div class="streaks-empty-title">No streaks yet.</div>' +
          '<div class="streaks-empty-sub">Complete every habit scheduled for today to start a Perfect Day streak.</div>' +
        '</div>';
    }

    body.innerHTML = html;
    document.getElementById('streaks-overlay').classList.remove('hidden');
    document.getElementById('streaks-sheet').classList.remove('hidden');
  }

  function closeStreaksSheet() {
    document.getElementById('streaks-overlay').classList.add('hidden');
    document.getElementById('streaks-sheet').classList.add('hidden');
  }

  function setupStreaksSheet() {
    const overlay = document.getElementById('streaks-overlay');
    const sheet   = document.getElementById('streaks-sheet');
    const closeBtn = document.getElementById('streaks-close-btn');
    if (!overlay || !sheet) return;

    overlay.addEventListener('click', closeStreaksSheet);
    if (closeBtn) closeBtn.addEventListener('click', closeStreaksSheet);

    // Tap the 🔥 streak pill in the header to open the sheet.
    const pill = document.getElementById('perfect-streak-display');
    if (pill) {
      pill.addEventListener('click', openStreaksSheet);
      pill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStreaksSheet(); }
      });
    }

    // Swipe-down dismiss
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, closeStreaksSheet, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.streaks-drag-handle, .streaks-header',
        scrollTarget:   '.streaks-body',
      });
    }

    // ESC dismisses
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!sheet.classList.contains('hidden')) closeStreaksSheet();
    });
  }

  // ── CLASS DETAIL SHEET ───────────────────────────────────
  // Tap the class emblem on the Status tab → showcases the emblem at
  // hero size + class info + linked stats + (if awakened) Chapter 2
  // origin story excerpt. Provides the "tap to learn more" affordance
  // for the class identity feature.
  function openClassDetail(classKey) {
    const cls = (typeof CLASSES === 'object') && CLASSES[classKey];
    if (!cls) return;
    const body = document.getElementById('class-detail-body');
    if (!body) return;

    // Linked stat list — for non-Sage classes, show the primary stat;
    // for Sage, list all six. (Civilian gets a "no class yet" hint.)
    let linkedStatsHTML = '';
    if (classKey === 'CIVILIAN') {
      linkedStatsHTML =
        '<div class="cd-stats-label">UNAWAKENED</div>' +
        '<div class="cd-stats-hint">Train any stat to Lv5 to find your path.</div>';
    } else if (classKey === 'SAGE') {
      const tiles = STATS.map(st =>
        '<div class="cd-stat-tile" style="--cd-tile-color:' + st.color + '">' +
          statIconHtml(st, { size: 22 }) +
          '<span class="cd-stat-tile-label">' + esc(st.label) + '</span>' +
        '</div>'
      ).join('');
      linkedStatsHTML =
        '<div class="cd-stats-label">UNIFIES ALL SIX STATS</div>' +
        '<div class="cd-stats-grid cd-stats-grid--six">' + tiles + '</div>';
    } else {
      const st = STATS.find(s => s.id === classKey);
      if (st) {
        const lv = (typeof statLevel === 'function')
          ? statLevel((stats[st.id] && stats[st.id].pts) || 0)
          : 0;
        linkedStatsHTML =
          '<div class="cd-stats-label">PRIMARY STAT</div>' +
          '<div class="cd-stat-tile cd-stat-tile--single" style="--cd-tile-color:' + st.color + '">' +
            statIconHtml(st, { size: 28 }) +
            '<span class="cd-stat-tile-label">' + esc(st.label) + '</span>' +
            '<span class="cd-stat-tile-lv">Lv.' + lv + '</span>' +
          '</div>';
      }
    }

    // Chapter 2 excerpt — only if the user has awakened into this exact class.
    let chapterHTML = '';
    if (classKey !== 'CIVILIAN' &&
        originAwakening && originAwakening.text && originAwakening.classKey === classKey) {
      chapterHTML =
        '<div class="cd-chapter-section">' +
          '<div class="cd-chapter-label">⚔️ THE AWAKENING'.replace('⚔️ ', '') +
            (originAwakening.dateDisplay ? ' · ' + esc(originAwakening.dateDisplay) : '') +
          '</div>' +
          '<div class="cd-chapter-text">' + esc(originAwakening.text) + '</div>' +
        '</div>';
    }

    body.innerHTML =
      '<div class="cd-emblem-wrap" style="--cd-color:' + cls.color + '">' +
        classIconHtml(classKey, { size: 144, eager: true }) +
      '</div>' +
      '<div class="cd-name" style="color:' + cls.color + '">' + esc(cls.name) + '</div>' +
      '<div class="cd-desc">' + esc(cls.desc) + '</div>' +
      '<div class="cd-stats-section">' + linkedStatsHTML + '</div>' +
      chapterHTML;

    document.getElementById('class-detail-overlay').classList.remove('hidden');
    document.getElementById('class-detail-sheet').classList.remove('hidden');
  }

  function closeClassDetail() {
    document.getElementById('class-detail-overlay').classList.add('hidden');
    document.getElementById('class-detail-sheet').classList.add('hidden');
  }

  function setupClassDetail() {
    const overlay  = document.getElementById('class-detail-overlay');
    const sheet    = document.getElementById('class-detail-sheet');
    const closeBtn = document.getElementById('class-detail-close-btn');
    if (!overlay || !sheet) return;

    overlay.addEventListener('click', closeClassDetail);
    if (closeBtn) closeBtn.addEventListener('click', closeClassDetail);

    // Delegated click on the entire class line (name + emblem). Every
    // render of the Status hero rebuilds the line, so a body-level
    // listener keeps it wired without re-attaching per render. Both the
    // text and the emblem are valid tap targets.
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest && e.target.closest('.sc-hero-class[data-class-key]');
      if (!t) return;
      e.stopPropagation();
      const key = t.getAttribute('data-class-key') || currentClass;
      openClassDetail(key);
    });
    // Keyboard activation — Enter / Space on the focused class line
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = document.activeElement;
      if (!t || !t.classList || !t.classList.contains('sc-hero-class')) return;
      e.preventDefault();
      const key = t.getAttribute('data-class-key') || currentClass;
      openClassDetail(key);
    });

    // Swipe-down dismiss
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, closeClassDetail, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.class-detail-drag-handle, .class-detail-header',
        scrollTarget:   '.class-detail-body',
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!sheet.classList.contains('hidden')) closeClassDetail();
    });
  }

  // ── NOTIFICATION TAP ROUTING ─────────────────────────────
  // When the user taps any notification (digest, check-in, per-habit
  // reminder), we route them to the Habits tab. The Capacitor plugin
  // emits 'localNotificationActionPerformed' with the notification's
  // ID + payload — we listen once on init and switch tabs from there.
  function setupNotifTapRouting() {
    try {
      const cap = window.Capacitor;
      const plug = cap && cap.Plugins && cap.Plugins.LocalNotifications;
      if (!plug || !plug.addListener) return;
      plug.addListener('localNotificationActionPerformed', (event) => {
        // Always route notification taps to the Habits tab. Easy mental
        // model — tap any reminder, you land where you act on it.
        try {
          const targetTab = 'habits';
          const btn = document.getElementById('tab-' + targetTab);
          if (btn) btn.click();
        } catch (_) {}
      });
    } catch (_) { /* native plugin not present (web preview) — no-op */ }
  }

  // ── PERFECT DAY SCREEN ────────────────────────────────────

  function pdMakeParticles(W, H, color, n) {
    const isRain = n >= 100;
    return Array.from({ length: n }, (_, i) => {
      const vel = isRain ? 0 : 6 + (n / 100) * 8;
      const p = {
        x:     isRain ? Math.random() * W            : W / 2 + (Math.random() - 0.5) * 80,
        y:     isRain ? -10 - Math.random() * H * 0.5: H * 0.55 + (Math.random() - 0.5) * 60,
        vx:    isRain ? (Math.random() - 0.5) * 2    : (Math.random() - 0.5) * vel * 2,
        vy:    isRain ? Math.random() * 3 + 2         : -(Math.random() * vel + vel * 0.5),
        r:     Math.random() * 3 + (isRain ? 3 : 1.5),
        life:  0.3 + Math.random() * 0.7,
        decay: isRain ? 0.003 + Math.random() * 0.003 : 0.01 + Math.random() * 0.013,
        // Vary colour slightly: base + occasional white sparkle
        hue:   i % 5 === 0 ? '#ffffff' : color,
      };
      p.reset = function () {
        this.x    = isRain ? Math.random() * W            : W / 2 + (Math.random() - 0.5) * 80;
        this.y    = isRain ? -10                           : H * 0.55 + (Math.random() - 0.5) * 60;
        this.vx   = isRain ? (Math.random() - 0.5) * 2    : (Math.random() - 0.5) * vel * 2;
        this.vy   = isRain ? Math.random() * 3 + 2         : -(Math.random() * vel + vel * 0.5);
        this.life = 0.3 + Math.random() * 0.7;
      };
      p.tick = function () {
        this.x  += this.vx;
        this.vy += isRain ? 0.04 : 0.18;
        this.y  += this.vy;
        this.vx *= 0.99;
        this.life -= this.decay;
        if (this.life <= 0) this.reset();
      };
      p.draw = function (ctx) {
        ctx.globalAlpha = Math.max(0, this.life) * 0.85;
        ctx.fillStyle   = this.hue;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
      };
      return p;
    });
  }

  function showPerfectDayScreen({ milestone: ms, streakCount }) {
    const screen     = document.getElementById('perfect-day-screen');
    const canvas     = document.getElementById('pd-canvas');
    const emojiEl    = document.getElementById('pd-emoji');
    const titleEl    = document.getElementById('pd-title');
    const subtEl     = document.getElementById('pd-subtitle');
    const bonusEl    = document.getElementById('pd-bonus');
    const dismissBtn = document.getElementById('pd-dismiss');

    // Theme
    screen.style.setProperty('--pd-color', ms.color);
    screen.classList.remove('hidden', 'pd-shake');
    void screen.offsetWidth;

    // Milestone emoji stripped — celebration screen reads via title +
    // subtitle + bonus XP only. (Emoji-free pass.)
    emojiEl.innerHTML = '';
    subtEl.textContent  = ms.subtitle;
    bonusEl.textContent = '+' + ms.bonus + ' XP Bonus Awarded';
    bonusEl.style.color = ms.color;
    bonusEl.classList.toggle('pd-bonus-xl', ms.day >= 100);
    titleEl.textContent = ms.letterReveal ? '' : ms.title;
    titleEl.classList.toggle('pd-reveal', !!ms.letterReveal);
    dismissBtn.classList.add('hidden');
    // For letter-reveal: hide subtitle/bonus until title done
    subtEl.style.opacity  = ms.letterReveal ? '0' : '';
    bonusEl.style.opacity = ms.letterReveal ? '0' : '';

    // ── Canvas particles ──────────────────────────────────
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx  = canvas.getContext('2d');
    const pCount = ms.day >= 100 ? 130 : ms.day >= 60 ? 90 : ms.day >= 30 ? 70 : ms.day >= 21 ? 50 : ms.day >= 14 ? 35 : 20;
    const pts  = pdMakeParticles(canvas.width, canvas.height, ms.color, pCount);
    let   raf  = null;
    let   live = true;
    const loop = () => {
      if (!live) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pts.forEach(p => { p.tick(); p.draw(ctx); });
      raf = requestAnimationFrame(loop);
    };
    loop();

    // ── Screen shake ──────────────────────────────────────
    if (ms.shake) {
      screen.classList.add('pd-shake');
      setTimeout(() => screen.classList.remove('pd-shake'), 600);
    }

    // ── Audio chime ───────────────────────────────────────
    if (ms.chime) {
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const freqs = ms.day >= 100
          ? [523, 659, 784, 1047, 1319]
          : [523, 659, 784, 1047];
        freqs.forEach((freq, i) => {
          const osc = ac.createOscillator(); const g = ac.createGain();
          osc.connect(g); g.connect(ac.destination);
          osc.frequency.value = freq; osc.type = 'sine';
          const t = ac.currentTime + i * 0.13;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.25, t + 0.06);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
          osc.start(t); osc.stop(t + 0.6);
        });
      } catch (_) {}
    }

    // ── Title reveal (Day 100) ─────────────────────────────
    if (ms.letterReveal) {
      const chars = ms.title.split('');
      let i = 0;
      const next = () => {
        if (!live) return;
        if (i < chars.length) { titleEl.textContent += chars[i++]; setTimeout(next, 85); }
        else {
          setTimeout(() => {
            subtEl.style.transition  = 'opacity 0.7s ease';
            bonusEl.style.transition = 'opacity 0.7s ease';
            subtEl.style.opacity  = '1';
            bonusEl.style.opacity = '1';
          }, 300);
          setTimeout(() => { if (live) dismissBtn.classList.remove('hidden'); },
            ms.extended ? 5000 : 1200);
        }
      };
      setTimeout(next, 350);
    } else {
      setTimeout(() => { if (live) dismissBtn.classList.remove('hidden'); }, 1400);
    }

    // ── Dismiss ───────────────────────────────────────────
    const dismiss = () => {
      live = false;
      if (raf) cancelAnimationFrame(raf);
      screen.classList.add('hidden');
      levelUpActive = false;
      drainLevelUpQueue();
    };
    dismissBtn.onclick = dismiss;
  }

  // ── RENDER ────────────────────────────────────────────────
  function render() {
    document.getElementById('current-date').textContent = formatDisplayDate(today);
    updateDoubleXpBanner();
    document.getElementById('main-footer').style.display = currentTab === 'habits' ? '' : 'none';
    renderRank();
    renderHabits();
    renderDailyQuote();
    checkStreakDanger();
    checkMorningRoutineNudge();
    if (currentTab === 'profile')      renderProfile();
    if (currentTab === 'stats')        renderStats();
    if (currentTab === 'history')      renderHistory();
  }

  function renderHabits() {
    const list  = document.getElementById('habit-list');
    const empty = document.getElementById('empty-state');
    const todayHabits = habits.filter(isScheduledToday);
    updateMorningButtonVisibility();
    updateLockedInButtonVisibility();

    if (habits.length === 0) {
      list.innerHTML = '';
      empty.querySelector('p').innerHTML = 'No habits yet.<br>Tap below to add your first.';
      empty.classList.remove('hidden');
    } else if (todayHabits.length === 0) {
      list.innerHTML = '';
      empty.querySelector('p').innerHTML = 'No habits scheduled today.<br>Enjoy your rest day! 😴';
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      const frag = document.createDocumentFragment();
      todayHabits.forEach(h => frag.appendChild(buildItem(h)));
      list.innerHTML = '';
      list.appendChild(frag);
      bindDrag();
    }
    updateProgress();

    // HealthKit auto-verify hooks. Fire async; both no-op on web /
    // when permission isn't granted / when threshold not met. Each
    // re-triggers renderHabits() once after a successful auto-check.
    try { autoVerifyWalk(); } catch (_) {}
    try { autoVerifySleep(); } catch (_) {}
  }

  function renderRank() {
    const rank = getRank(totalPoints);
    // PR hook — track highest rank ever reached (only goes up)
    prUpdate('highest_rank', rank.id);
    const badge = document.getElementById('rank-badge');
    const label = document.getElementById('rank-label');
    const pts   = document.getElementById('rank-pts');
    const next  = document.getElementById('rank-next');
    const bar   = document.getElementById('rank-bar');

    badge.textContent = rank.id;
    badge.setAttribute('data-rank', rank.id); // drives per-rank color via CSS vars
    label.textContent = rank.label;
    pts.textContent   = totalPoints + ' pts';

    const isSPlus = rank.id === 'S+';
    badge.className = 'rank-badge' + (isSPlus ? ' rank-s-plus' : '');
    bar.className   = 'rank-fill'  + (isSPlus ? ' gold-fill'  : '');

    if (isSPlus) {
      next.textContent = 'MAX RANK';
      next.className = 'rank-next maxed';
      bar.style.width = '100%';
    } else {
      const progress = totalPoints - rank.min;
      const range    = rank.next - rank.min;
      bar.style.width = Math.min(100, (progress / range) * 100) + '%';
      next.textContent = (rank.next - totalPoints) + ' to ' + RANKS[RANKS.indexOf(rank) + 1].id;
      next.className = 'rank-next';
    }
    // v2.1.0 — refresh the redesigned header's dependent cards.
    try { updateHeaderMetrics(); } catch (_) {}
  }

  function _formatUnlockDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return dateStr; }
  }

  function _formatProgressNum(n) {
    return Number(n || 0).toLocaleString();
  }

  function renderAchievements() {
    const grid = document.getElementById('achievements-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const ctx = buildAchievementContext();
    const totalCount    = ACHIEVEMENTS.length;
    const unlockedCount = ACHIEVEMENTS.filter(a => unlockedAchievements.has(a.id)).length;

    // ── Top header: total + per-category breakdown ───────
    const top = document.createElement('div');
    top.className = 'ach-top';
    const catBreakdown = ACH_CATEGORIES.map(cat => {
      const inCat   = ACHIEVEMENTS.filter(a => a.category === cat.id);
      const haveCat = inCat.filter(a => unlockedAchievements.has(a.id)).length;
      // First token of cat.label is the emoji ("🔥 Streaks" → "🔥").
      // streakify swaps 🔥 for the flame icon; other category emojis
      // pass through escaped.
      return '<span class="ach-cat-pill">' + streakify(cat.label.split(' ')[0], 14) +
             ' <b>' + haveCat + '/' + inCat.length + '</b></span>';
    }).join('');
    top.innerHTML =
      '<div class="ach-top-summary">' +
        '<span class="ach-top-num">' + unlockedCount + ' / ' + totalCount + '</span>' +
        '<span class="ach-top-label">ACHIEVEMENTS UNLOCKED</span>' +
      '</div>' +
      '<div class="ach-cat-breakdown">' + catBreakdown + '</div>';
    grid.appendChild(top);

    // ── Recently unlocked (last 3) ──────────────────────
    const recent = ACHIEVEMENTS
      .filter(a => unlockedAchievements.has(a.id) && achievementUnlockDates[a.id])
      .sort((a, b) => (achievementUnlockDates[b.id] || '').localeCompare(achievementUnlockDates[a.id] || ''))
      .slice(0, 3);
    if (recent.length) {
      const recentSec = document.createElement('div');
      recentSec.className = 'ach-section';
      recentSec.innerHTML = '<div class="ach-section-label">RECENTLY UNLOCKED</div>';
      recent.forEach(ach => recentSec.appendChild(_buildAchCard(ach, ctx, true)));
      grid.appendChild(recentSec);
    }

    // ── Categorized sections, locked-by-progress-desc ───
    ACH_CATEGORIES.forEach(cat => {
      const inCat = ACHIEVEMENTS.filter(a => a.category === cat.id);
      if (!inCat.length) return;

      // Sort: unlocked first, then locked sorted by % progress descending
      const sorted = inCat.slice().sort((a, b) => {
        const aU = unlockedAchievements.has(a.id) ? 1 : 0;
        const bU = unlockedAchievements.has(b.id) ? 1 : 0;
        if (aU !== bU) return bU - aU;
        if (aU) return 0;
        const ap = a.getProgress ? a.getProgress(ctx) : { current: 0, target: 1 };
        const bp = b.getProgress ? b.getProgress(ctx) : { current: 0, target: 1 };
        return (bp.current / bp.target) - (ap.current / ap.target);
      });

      const sec = document.createElement('div');
      sec.className = 'ach-section';
      const haveCount = inCat.filter(a => unlockedAchievements.has(a.id)).length;
      sec.innerHTML =
        '<div class="ach-section-label">' + streakify(cat.label, 16) +
          '<span class="ach-section-count">' + haveCount + '/' + inCat.length + '</span>' +
        '</div>';
      sorted.forEach(ach => sec.appendChild(_buildAchCard(ach, ctx, false)));
      grid.appendChild(sec);
    });
  }

  function _buildAchCard(ach, ctx, isRecent) {
    const unlocked = unlockedAchievements.has(ach.id);
    const card = document.createElement('div');
    card.className = 'ach-card ' + (unlocked ? 'unlocked' : 'locked') + (isRecent ? ' ach-recent' : '');

    const progress = (typeof ach.getProgress === 'function') ? ach.getProgress(ctx) : null;
    let progressHTML = '';
    if (!unlocked && progress) {
      const pct = Math.min(100, Math.round((progress.current / progress.target) * 100));
      progressHTML =
        '<div class="ach-prog-bar"><div class="ach-prog-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="ach-prog-text">' +
          _formatProgressNum(progress.current) + ' / ' + _formatProgressNum(progress.target) +
        '</div>';
    } else if (unlocked) {
      const stamp = achievementUnlockDates[ach.id];
      progressHTML = stamp
        ? '<div class="ach-prog-text ach-prog-text--unlocked">Unlocked ' + _formatUnlockDate(stamp) + '</div>'
        : '';
    }

    card.innerHTML =
      // Achievement icon dropped — emoji-free pass.
      '<div class="ach-text">' +
        '<div class="ach-name">' + esc(ach.name) + '</div>' +
        '<div class="ach-desc">' + esc(ach.desc) + '</div>' +
        progressHTML +
      '</div>' +
      '<div class="ach-status">' + (unlocked ? '✓' : '🔒') + '</div>';
    return card;
  }

  function renderProfile() {
    renderStatus();
  }

  function renderStats() {
    const el = document.getElementById('stats-content');
    el.innerHTML = '';

    // ── Section label ──────────────────────────────────────
    const lbl = document.createElement('div');
    lbl.className = 'stats-section-label';
    lbl.textContent = 'CHARACTER STATS';
    el.appendChild(lbl);

    // ── OSRS-style skills panel ────────────────────────────
    const dominantStatId = currentClass !== 'SAGE' ? currentClass : null;
    const panel = document.createElement('div');
    panel.className = 'osrs-panel';

    STATS.forEach(st => {
      const stPts   = stats[st.id]?.pts || 0;
      const level   = statLevel(stPts);
      const isMaxed = level >= 20;
      const levelXP = xpForLevel(level);
      const ptsInLv = stPts - levelXP;
      const needed  = xpToNextLevel(level);
      const pct     = isMaxed ? 100 : Math.min(100, (ptsInLv / needed) * 100);
      const isDom   = st.id === dominantStatId;

      const cell = document.createElement('div');
      cell.className = 'osrs-cell' + (isDom ? ' osrs-cell--dominant' : '') + (isMaxed ? ' osrs-cell--maxed' : '');
      if (isMaxed) {
        cell.style.borderColor = '#f59e0b';
        cell.style.boxShadow   = 'inset 0 0 18px rgba(245,158,11,0.18), 0 0 16px rgba(245,158,11,0.30)';
      } else if (isDom) {
        cell.style.borderColor = st.color + '80';
        cell.style.boxShadow   = 'inset 0 0 18px ' + st.color + '18, 0 0 12px ' + st.color + '22';
      }
      cell.addEventListener('click', () => openStatDetail(st.id));

      // Accent top stripe
      const stripe = document.createElement('div');
      stripe.className = 'osrs-cell-stripe';
      stripe.style.background = st.color;

      // Icon — Stats tab tile cards. 32 CSS px, drawn from the custom art.
      const icon = document.createElement('div');
      icon.className = 'osrs-cell-icon';
      icon.innerHTML = statIconHtml(st, { size: 32, eager: true });

      // Abbrev label
      const abbr = document.createElement('div');
      abbr.className = 'osrs-cell-abbr';
      abbr.style.color = isMaxed ? '#f59e0b' : st.color;
      abbr.textContent = st.label + (isMaxed ? ' MAX' : isDom ? ' ★' : '');

      // Level number (shows MAX crown at cap)
      const lvNum = document.createElement('div');
      lvNum.className = 'osrs-cell-level' + (isMaxed ? ' osrs-cell-level--max' : '');
      lvNum.textContent = isMaxed ? '👑' : level;

      // Thin progress bar (gold when maxed)
      const track = document.createElement('div');
      track.className = 'osrs-cell-track';
      const fill = document.createElement('div');
      fill.className = 'osrs-cell-fill';
      fill.style.cssText = 'width:' + pct + '%;background:' + (isMaxed ? '#f59e0b' : st.color) + ';';
      if (isMaxed) fill.style.boxShadow = '0 0 6px rgba(245,158,11,0.6)';
      track.appendChild(fill);

      cell.append(stripe, icon, abbr, lvNum, track);
      panel.appendChild(cell);
    });

    el.appendChild(panel);

    // ── Total Level ────────────────────────────────────────
    const totalLv   = STATS.reduce((sum, st) => sum + statLevel(stats[st.id]?.pts || 0), 0);
    const isAllMaxed = totalLv >= 120;
    const totalEl   = document.createElement('div');
    totalEl.className = 'osrs-total-level' + (isAllMaxed ? ' osrs-total-level--maxed' : '');
    totalEl.innerHTML = 'Total Level: <span class="osrs-total-num">' + totalLv + '</span>'
      + ' <span class="osrs-total-max">/ 120</span>'
      + (isAllMaxed ? ' <span class="osrs-total-crown">👑 FULLY AWAKENED</span>' : '');
    el.appendChild(totalEl);

    // ── Next Stat Bonus ────────────────────────────────────
    const bonusEl = document.createElement('div');
    bonusEl.className = 'stats-next-bonus-section';

    const candidates = [];
    STATS.forEach(st => {
      const curLevel = statLevel(stats[st.id]?.pts || 0);
      STAT_BONUS_THRESHOLDS.forEach(thr => {
        const key = st.id + '_' + thr.level;
        if (!statBonuses.has(key)) {
          candidates.push({ st, thr, curLevel, levelsNeeded: Math.max(0, thr.level - curLevel) });
        }
      });
    });
    candidates.sort((a, b) => a.levelsNeeded - b.levelsNeeded);

    let bonusHTML = '<div class="stats-section-label" style="margin-top:24px">NEXT STAT BONUS</div>';
    if (candidates.length > 0) {
      const nx  = candidates[0];
      const pct = Math.min(100, Math.round((nx.curLevel / nx.thr.level) * 100));
      bonusHTML +=
        '<div class="nb-card">' +
          '<div class="nb-top">' +
            '<span class="nb-icon">' + statIconHtml(nx.st, { size: 32, eager: true }) + '</span>' +
            '<div class="nb-info">' +
              '<span class="nb-label" style="color:' + nx.st.color + '">' + nx.st.label + '</span>' +
              '<span class="nb-sublabel">Reach Level ' + nx.thr.level + '</span>' +
            '</div>' +
            '<span class="nb-reward">+' + nx.thr.pts + ' XP</span>' +
          '</div>' +
          '<div class="nb-track">' +
            '<div class="nb-fill" style="width:' + pct + '%;background:' + nx.st.color + '"></div>' +
          '</div>' +
          '<div class="nb-labels">' +
            '<span class="nb-cur">Lv.' + nx.curLevel + '</span>' +
            '<span class="nb-goal">Lv.' + nx.thr.level + '</span>' +
          '</div>' +
        '</div>';
    } else {
      bonusHTML += '<div class="nb-card nb-all-done"><span>🏆 All stat bonuses unlocked!</span></div>';
    }
    bonusEl.innerHTML = bonusHTML;
    el.appendChild(bonusEl);
  }

  // ── STATUS ────────────────────────────────────────────────
  function getClass(rankId) {
    const map = { 'E':'Civilian','D':'Civilian','C':'Apprentice Hunter','B':'Hunter','A':'Elite Hunter','S':'Shadow Monarch','S+':'The Awakened One' };
    return map[rankId] || 'Civilian';
  }

  // Avatar silhouette per class. Brand new players (0 XP) see the base
  // silhouette until they earn enough to lock into a class.
  const AVATAR_FILES = {
    STR:   'avatar-warrior.png',
    VIT:   'avatar-ranger.png',
    INT:   'avatar-mage.png',
    FOCUS: 'avatar-assassin.png',
    WILL:  'avatar-paladin.png',
    WLT:   'avatar-merchant.png',
    SAGE:  'avatar-sage.png',
  };
  function getAvatarSrc() {
    // Civilian (or pre-Lv5 in everything) always shows the base silhouette.
    if (!currentClass || currentClass === 'CIVILIAN') return 'avatar-base.png';
    if (totalPoints === 0)                            return 'avatar-base.png';
    return AVATAR_FILES[currentClass] || 'avatar-base.png';
  }
  // Tracks the last-rendered avatar so we only crossfade when class actually changes.
  let _lastAvatarSrc = null;

  function getTitle() {
    for (let i = ACHIEVEMENTS.length - 1; i >= 0; i--) {
      if (unlockedAchievements.has(ACHIEVEMENTS[i].id)) return ACHIEVEMENTS[i].name;
    }
    return '—';
  }

  function renderStatus() {
    const rank       = getRank(totalPoints);
    const isSPlus    = rank.id === 'S+';
    const daysActive = Object.keys(completions).filter(d => completions[d].length > 0).length;
    const maxStreak  = Object.values(streaks).reduce((m, s) => Math.max(m, s.count || 0), 0);
    const todayDone  = (completions[today] || []).length;
    const todaySched = habits.filter(isScheduledToday).length;
    const cls        = CLASSES[currentClass] || CLASSES.SAGE;
    const shifting   = isClassShifting();

    document.getElementById('status-content').innerHTML =
      '<div class="sc-card' + (isSPlus ? ' sc-splus' : '') + '">' +
        // Header label
        '<div class="sc-top">' +
          '<span class="sc-top-title">STATUS</span>' +
          (isWeekend() ? '<span class="stats-2x-badge">2x XP</span>' : '') +
        '</div>' +
        // Hero: rank badge + name + rank + class
        '<div class="sc-hero">' +
          '<div class="sc-rank-hero' + (isSPlus ? ' splus' : '') + '" data-rank="' + esc(rank.id) + '">' + rank.id + '</div>' +
          '<div class="sc-hero-info">' +
            '<div class="sc-hero-nameline">' +
              '<span class="sc-hero-name" id="sc-name-val">' + esc(playerName) + '</span>' +
              '<button class="sc-edit-btn" id="sc-name-edit" aria-label="Edit name">✎</button>' +
              // Compact Personal Records chip — taps open the All-PRs sheet
              buildPRStripHTML() +
            '</div>' +
            '<div class="sc-hero-rank' + (isSPlus ? ' sc-gold' : '') + '">' +
              rank.label + ' · ' + totalPoints.toLocaleString() + ' pts' +
            '</div>' +
            // Whole class line (name + emblem) is one tappable target —
            // opens the Class Detail sheet. Inner emblem still has its
            // own visual hover/press feedback, but tapping the name
            // works equivalently.
            '<div class="sc-hero-class" style="color:' + cls.color + '" data-class-key="' + esc(currentClass) + '" role="button" tabindex="0" aria-label="Class details">' +
              '<span class="sc-hero-class-name">' + esc(cls.name) + '</span>' +
              ' <span class="sc-class-emblem-btn">' +
                classIconHtml(currentClass, { size: 36 }) +
              '</span>' +
            '</div>' +
            '<div class="sc-hero-class-desc">' + esc(cls.desc) + '</div>' +
            // 'Your Origin' — visible whenever we have at least Chapter 1.
            // Counter shows "(2 chapters)" once the user has awakened.
            ((originBeginning && originBeginning.text)
              ? '<button class="sc-origin-btn" id="sc-origin-btn" type="button">📜 Your Origin' +
                  ((originAwakening && originAwakening.text) ? ' <span class="sc-origin-chapters">2 chapters</span>' : '') +
                '</button>'
              : '') +
            (shifting ? '<div class="sc-shifting" style="margin-top:4px">⚠️ Your class is shifting...</div>' : '') +
            // Path badge + compound streak badges (Morning Routine / Locked-In)
            // were removed from the Status hero in v1.1.4 — that information
            // now lives in the "All Streaks" sheet, accessible by tapping the
            // 🔥 streak pill in the app header.
          '</div>' +
        '</div>' +
        '<div class="sc-divider"></div>' +
        // Avatar portrait beside the radar chart
        (function() {
          const src         = getAvatarSrc();
          const justChanged = (_lastAvatarSrc !== null) && (_lastAvatarSrc !== src);
          _lastAvatarSrc    = src;
          return '<div class="sc-portrait-row">' +
            '<div class="sc-avatar-row">' +
              '<img class="sc-avatar' + (justChanged ? ' sc-avatar-changed' : '') + '" ' +
                   'src="' + src + '" alt="' + esc(cls.name) + ' avatar" loading="eager">' +
            '</div>' +
            '<div id="sc-radar-wrap" class="sc-radar-wrap"></div>' +
          '</div>';
        })() +
        // Metrics strip
        '<div class="sc-metrics">' +
          '<div class="sc-metric">' +
            '<span class="sc-metric-val">' + totalPoints.toLocaleString() + '</span>' +
            '<span class="sc-metric-lbl">Total XP</span>' +
          '</div>' +
          '<div class="sc-metric">' +
            '<span class="sc-metric-val">' + maxStreak + '</span>' +
            '<span class="sc-metric-lbl">Best Streak</span>' +
          '</div>' +
          '<div class="sc-metric">' +
            '<span class="sc-metric-val">' + (daysActive || 0) + '</span>' +
            '<span class="sc-metric-lbl">Days Active</span>' +
          '</div>' +
          '<div class="sc-metric">' +
            '<span class="sc-metric-val">' + todayDone + '/' + todaySched + '</span>' +
            '<span class="sc-metric-lbl">Today</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    requestAnimationFrame(() => {
      buildRadarChart();
    });

    document.getElementById('sc-name-edit').addEventListener('click', () => {
      const nameVal = document.getElementById('sc-name-val');
      const editBtn = document.getElementById('sc-name-edit');
      const input = document.createElement('input');
      input.className = 'sc-name-input';
      input.value = playerName;
      input.maxLength = 20;
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocapitalize', 'words');
      nameVal.replaceWith(input);
      editBtn.textContent = '✓';
      input.focus();
      const commit = () => {
        playerName = input.value.trim() || 'Hunter';
        localStorage.setItem('hb_name', playerName);
        // Re-arm the digest so the new name appears in tomorrow's
        // notification. The mid-day check-in uses the same title, so
        // re-arm it too — body wording doesn't include name today, but
        // the class-name title does.
        try { Notif.reapplyDigest(); } catch (_) {}
        try { Notif.reapplyMidDay(); } catch (_) {}
        renderStatus();
      };
      editBtn.onclick = commit;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') renderStatus(); });
    });
  }

  function buildRadarChart() {
    const wrap = document.getElementById('sc-radar-wrap');
    if (!wrap) return;

    // SVG viewport
    const SIZE   = 260;           // px square
    const CX     = SIZE / 2;
    const CY     = SIZE / 2;
    const RINGS  = 4;             // concentric background rings
    const N      = STATS.length; // 6 axes
    const MAX_LV = 20;            // axis maximum (Level 20 cap)

    // Stat levels, capped at MAX_LV for display; minimum 2 so the shape is always visible
    const levels = STATS.map(st => Math.max(2, Math.min(MAX_LV, statLevel(stats[st.id]?.pts || 0))));

    // Axis angles: first axis points straight up (−π/2), then clockwise
    function angle(i) { return (2 * Math.PI * i / N) - Math.PI / 2; }
    function pt(r, i)  { return [CX + r * Math.cos(angle(i)), CY + r * Math.sin(angle(i))]; }

    // Maximum usable radius (leaving room for labels). Bumped because the
    // radar now displays smaller (≤200px) so labels are larger in viewBox units.
    const LABEL_PAD = 50;
    const R_MAX     = CX - LABEL_PAD;

    // ── Build SVG string ──────────────────────────────────
    let svg = '<svg class="sc-radar-svg" viewBox="0 0 ' + SIZE + ' ' + SIZE + '" '
            + 'xmlns="http://www.w3.org/2000/svg" '
            + 'aria-label="Stat radar chart">';

    // 1. Background rings
    for (let ring = 1; ring <= RINGS; ring++) {
      const r = (ring / RINGS) * R_MAX;
      const pts = STATS.map((_, i) => pt(r, i).join(',')).join(' ');
      svg += '<polygon points="' + pts + '" '
           + 'fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>';
    }

    // 2. Axis spokes
    STATS.forEach((_, i) => {
      const [x, y] = pt(R_MAX, i);
      svg += '<line x1="' + CX + '" y1="' + CY + '" x2="' + x + '" y2="' + y + '" '
           + 'stroke="rgba(255,255,255,0.08)" stroke-width="1"/>';
    });

    // 3. Filled player shape — uses a CSS-animated clip trick via a path
    //    We give the path a data-target so JS can animate it
    const fullPts  = levels.map((lv, i) => pt((lv / MAX_LV) * R_MAX, i));
    const pathData = fullPts.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2)).join(' ') + ' Z';

    // Glow filter
    svg += '<defs>'
         + '<filter id="radar-glow" x="-30%" y="-30%" width="160%" height="160%">'
         + '<feGaussianBlur stdDeviation="4" result="blur"/>'
         + '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>'
         + '</filter>'
         + '</defs>';

    // Filled area (starts collapsed at center, animated via CSS)
    svg += '<path class="sc-radar-fill" d="' + pathData + '" '
         + 'fill="rgba(139,92,246,0.30)" stroke="#8b5cf6" stroke-width="1.8" '
         + 'stroke-linejoin="round" filter="url(#radar-glow)"/>';

    // 4. Outer axis dots in each stat's unique colour
    STATS.forEach((st, i) => {
      const r = R_MAX + 4; // slightly outside the ring
      const [x, y] = pt(r, i);
      svg += '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="4" '
           + 'fill="' + st.color + '" opacity="0.85"/>';
    });

    // 5. Tappable hit-zones + labels for each axis
    STATS.forEach((st, i) => {
      const lv      = levels[i];
      const ang     = angle(i);
      const labelR  = R_MAX + LABEL_PAD * 0.72;
      const [lx, ly] = [CX + labelR * Math.cos(ang), CY + labelR * Math.sin(ang)];

      // Invisible hit circle centred at axis tip (easier to tap)
      const [hx, hy] = pt(R_MAX + 14, i);
      svg += '<circle class="sc-radar-hit" cx="' + hx.toFixed(2) + '" cy="' + hy.toFixed(2) + '" r="18" '
           + 'fill="transparent" data-statid="' + st.id + '"/>';

      // Label: abbreviation on first line, level on second.
      // Y offsets widened to keep larger labels from overlapping each other.
      // data-statid makes the text itself clickable, not just the hit-circle.
      svg += '<text x="' + lx.toFixed(2) + '" y="' + (ly - 8).toFixed(2) + '" '
           + 'class="sc-radar-lbl" fill="' + st.color + '" text-anchor="middle" '
           + 'data-statid="' + st.id + '" style="cursor:pointer">'
           + st.label + '</text>';
      svg += '<text x="' + lx.toFixed(2) + '" y="' + (ly + 14).toFixed(2) + '" '
           + 'class="sc-radar-sublbl" fill="' + (lv >= MAX_LV ? '#f59e0b' : 'rgba(255,255,255,0.45)') + '" text-anchor="middle" '
           + 'data-statid="' + st.id + '" style="cursor:pointer">'
           + (lv >= MAX_LV ? 'MAX' : 'Lv.' + lv) + '</text>';
    });

    svg += '</svg>';

    wrap.innerHTML = svg;

    // Animate fill in from center — setTimeout(0) guarantees a new task after paint,
    // so the browser registers the initial scale(0) before we flip to scale(1).
    setTimeout(() => {
      const fillEl = wrap.querySelector('.sc-radar-fill');
      if (fillEl) fillEl.classList.add('sc-radar-fill--animate');
    }, 20);

    // Tapping an axis hit-zone OR the text label opens the stat detail sheet
    wrap.querySelectorAll('[data-statid]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => openStatDetail(el.dataset.statid));
    });
  }

  function buildSchedPills(habit) {
    if (!habit.days || habit.days.length === 7) return '';
    const pills = ALL_DAYS
      .map((d, i) => habit.days.includes(d) ? '<span class="sched-pill">' + DAY_LABELS[i] + '</span>' : '')
      .join('');
    return '<div class="sched-pills">' + pills + '</div>';
  }

  // Difficulty colour lookup for card left-border glow
  const DIFF_COLORS = { easy: '#8b5cf6', medium: '#3b82f6', hard: '#f97316', legendary: '#f59e0b' };

  function buildItem(habit) {
    const done  = isChecked(habit.id);
    const count = getStreak(habit.id);
    const diff  = habit.difficulty || 'easy';
    const xpVal = diffPts(diff);
    const wknd  = isWeekend();

    // No Alcohol weekend challenge badge
    const isNoAlcohol   = habit.name === 'No alcohol';
    const naBadge       = isNoAlcohol ? getNoAlcoholBadge() : null;
    // streakify the badge text so the "Day 2 of 3" variant uses the
    // custom flame icon. Other badges (🏆 💰 ✅) pass through escaped.
    const naBadgeHTML   = naBadge
      ? '<div class="na-challenge-badge ' + naBadge.cls + '">' + streakify(naBadge.text, 14) + '</div>'
      : '';

    // XP badge — ⚡+N XP (gold), ⚡+N XP 2× on weekends. The lightning
    // icon is sized small to sit cleanly next to the +N XP text.
    const xpBadge = wknd
      ? '<span class="habit-xp weekend">' + xpIconHtml({ size: 14 }) + '+' + xpVal + ' XP <span class="xp-2x">2×</span></span>'
      : '<span class="habit-xp">' + xpIconHtml({ size: 14 }) + '+' + xpVal + ' XP</span>';

    const li = document.createElement('li');
    li.className = 'habit-item' + (done ? ' completed' : '');
    li.dataset.id = habit.id;
    // Set difficulty colour variable for left-border glow and checkbox ring
    li.style.setProperty('--diff-color', DIFF_COLORS[diff] || DIFF_COLORS.easy);

    // Auto-verify pill: shown ONLY when the habit was auto-verified
    // today via HealthKit (currently only the canonical Daily walk).
    // Subtle by design — a marker, not a celebration. See CLAUDE.md
    // "Per-habit reminders" + "HealthKit auto-verify" sections.
    const isAutoVerified = (typeof AUTO_VERIFY !== 'undefined') && AUTO_VERIFY.isAutoVerifiedToday(habit.id);
    const autoPillHTML = isAutoVerified
      ? '<span class="auto-verify-pill" title="Auto-verified via Apple Health">AUTO</span>'
      : '';

    // Read-only system-managed habit (currently only "Sleep before
    // midnight"). Subtle visual cue — the card stays clickable, but
    // the check circle gets a lock-indicator modifier and the click
    // routes to the Notes modal instead of toggleHabit. See
    // isReadOnlyAutoVerifyHabit() for the gate.
    const isReadOnly = isReadOnlyAutoVerifyHabit(habit);
    const cbClass = 'habit-cb' + (done ? ' checked' : '') + (isReadOnly ? ' habit-cb--readonly' : '');

    li.innerHTML =
      // Top row: streak badge (left) + auto-pill (when set) + check circle (right)
      '<div class="hg-top">' +
        '<div class="streak-badge' + (count > 0 ? ' active' : '') + '">' +
          (count > 0 ? '<span class="streak-fire">' + streakIconHtml({ size: 14 }) + '</span>' + count : '') +
        '</div>' +
        autoPillHTML +
        '<div class="' + cbClass + '"' + (isReadOnly ? ' title="System-managed by Apple Health"' : '') + '>' +
          (isReadOnly ? '<span class="habit-cb-lock" aria-hidden="true">🔒</span>' : '') +
          '<span class="check-mark">✓</span>' +
        '</div>' +
      '</div>' +
      // Emoji / habit icon centered. Curated habits with mapped art
      // render as <img>; everything else (unmapped curated + custom)
      // falls back to the emoji glyph. The icon is sized larger than
      // an emoji so the DALL-E detail reads at habit-card scale.
      '<div class="hg-emoji-wrap">' +
        (getHabitIcon(habit)
          ? '<span class="habit-emoji">' + habitIconHtml(habit, { size: 72 }) + '</span>'
          : (habit.emoji ? '<span class="habit-emoji">' + habit.emoji + '</span>' : '')) +
      '</div>' +
      // Name (2-line clamp)
      '<span class="habit-name">' + habitDisplayHTML(habit) + '</span>' +
      // Bottom: diff badge + XP
      '<div class="habit-meta">' +
        '<span class="diff-badge ' + diff + '">' + DIFFICULTY[diff].label + '</span>' +
        xpBadge +
      '</div>' +
      naBadgeHTML +
      buildSchedPills(habit) +
      // Drag handle (hidden by default, shown in reorder mode)
      '<div class="drag-handle" data-drag>' +
        '<span class="drag-dot"></span><span class="drag-dot"></span>' +
        '<span class="drag-dot"></span><span class="drag-dot"></span>' +
        '<span class="drag-dot"></span><span class="drag-dot"></span>' +
      '</div>' +
      // More button (absolute bottom-right)
      '<button class="habit-more-btn" data-more aria-label="Options">' +
        (habitNotes[habit.id] ? '📝' : '···') +
      '</button>';

    li.addEventListener('pointerdown', e => { if (!e.target.closest('[data-drag]') && !e.target.closest('[data-more]')) li.classList.add('pressing'); });
    li.addEventListener('pointerup',    () => li.classList.remove('pressing'));
    li.addEventListener('pointercancel',() => li.classList.remove('pressing'));
    li.addEventListener('click', e => {
      if (e.target.closest('[data-drag]') || e.target.closest('[data-more]')) return;
      // Suppress click-through fired right after a long-press drop.
      if (Date.now() < _postDropGuardUntil) return;
      // Read-only system-managed habits route to the Notes modal
      // instead of toggling. Apple Health is the sole authority for
      // these — user can't manually check or uncheck.
      if (isReadOnlyAutoVerifyHabit(habit)) {
        openNoteModal(habit.id);
        return;
      }
      toggleHabit(habit.id, li);
    });
    li.querySelector('[data-more]').addEventListener('click', e => { e.stopPropagation(); showCtxMenu(habit.id, li); });
    return li;
  }

  // Returns true if a measurable habit's goal meets the minimum threshold.
  function meetsMinimum(habit) {
    // HealthKit-auto-verifiable habits (Daily walk step goal, Sleep
    // duration goal, Sleep before midnight binary) all bypass the
    // legacy MEASURABLE_HABITS minimum check. Their goals come from
    // dedicated per-habit fields (or no goal at all, for the binary
    // bedtime habit) and the Edit modal clamps to safe ranges — there's
    // nothing to block. Without this guard, v1.1.5 users with no
    // habit.goal field yet would hit the "Set your goal value" toast
    // and be unable to toggle these habits manually.
    if (isHealthAutoVerifiableHabit(habit)) return true;

    const m = MEASURABLE_HABITS[habit.name];
    if (!m) return true; // not measurable — always OK
    if (!habit.goal) return false; // no goal set at all
    let min = m.min;
    if (m.bodyweightMin) {
      const bw = parseInt(localStorage.getItem('hb_bodyweight') || '0', 10);
      min = bw > 0 ? bw : 1;
    }
    return habit.goal.value >= min;
  }

  // Brief floating toast anchored near the bottom of the screen.
  // showHabitToast(msg, opts?)
  // opts.onTap   — if provided, the toast becomes a tap target. Tapping
  //                it dismisses the toast and runs the callback.
  // opts.cta     — optional CTA label appended (default: '→')
  // opts.duration — ms before auto-dismiss (default: 2200; 4000 if tappable)
  // opts.sticky  — if true, NO auto-dismiss timer. Toast stays until the
  //                user taps it. Useful for important confirmations the
  //                user shouldn't miss (e.g., "✓ Reminder set for 9 AM").
  function showHabitToast(msg, opts) {
    opts = opts || {};
    document.querySelectorAll('.habit-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    const isTap   = typeof opts.onTap === 'function';
    const sticky  = !!opts.sticky;
    // Sticky toasts are always tap-dismissable, even without an onTap callback.
    const tappable = isTap || sticky;
    toast.className = 'habit-toast' + (tappable ? ' habit-toast--tappable' : '');
    if (tappable) {
      toast.setAttribute('role', 'button');
      toast.setAttribute('tabindex', '0');
      toast.innerHTML =
        '<span class="ht-msg">' + esc(msg) + '</span>' +
        '<span class="ht-cta">' + esc(opts.cta || (isTap ? '→' : '✕')) + '</span>';
    } else {
      toast.textContent = msg;
    }
    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('habit-toast--visible')));

    const dismiss = () => {
      toast.classList.remove('habit-toast--visible');
      setTimeout(() => toast.remove(), 300);
    };
    // Sticky → no timer. Tappable (with onTap) → 4s default. Plain → 2.2s.
    const dismissTimer = sticky
      ? null
      : setTimeout(dismiss, opts.duration || (isTap ? 4000 : 2200));

    if (tappable) {
      toast.addEventListener('click', () => {
        if (dismissTimer) clearTimeout(dismissTimer);
        dismiss();
        if (isTap) { try { opts.onTap(); } catch (_) {} }
      });
      toast.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (dismissTimer) clearTimeout(dismissTimer);
          dismiss();
          if (isTap) { try { opts.onTap(); } catch (_) {} }
        }
      });
    }
  }

  // ── REMINDER-CONFIRM TOAST ──────────────────────────────
  // Sticky toast with an inline-editable time chip. Tapping the time
  // opens the native iOS time picker; on change, the digest is
  // rescheduled and the chip updates in place. Tap the ✕ to dismiss.
  // Used right after the user enables the daily morning reminder so
  // they can adjust it without navigating to Settings.
  function showReminderConfirmToast(initialTime) {
    document.querySelectorAll('.habit-toast').forEach(t => t.remove());

    function fmt(t) {
      const [hStr, mStr] = (t || '09:00').split(':');
      const h  = parseInt(hStr, 10);
      const m  = parseInt(mStr, 10) || 0;
      const pm = h >= 12;
      const h12 = ((h % 12) || 12);
      return h12 + ':' + String(m).padStart(2, '0') + ' ' + (pm ? 'PM' : 'AM');
    }

    // Parse the initial time into hour (24h) and minute components.
    let curH = 9, curM = 0;
    {
      const parts = (initialTime || '09:00').split(':');
      curH = parseInt(parts[0], 10) || 0;
      curM = parseInt(parts[1], 10) || 0;
      // snap to 15-min grid if upstream value drifted
      curM = Math.round(curM / 15) * 15;
      if (curM === 60) { curH = (curH + 1) % 24; curM = 0; }
    }

    // Build hour column. The list is rotated to start at 5 AM (a sensible
    // morning anchor for a "morning reminder") and wraps through midnight
    // back to 4 AM. So the order is: 5 AM, 6 AM, ..., 11 PM, 12 AM, 1 AM,
    // 2 AM, 3 AM, 4 AM. The default 9 AM still sits a few rows down.
    // Minute column (4 entries: 00 / 15 / 30 / 45) is independent.
    const HOUR_START = 5;
    const hourLabel = (h) => {
      const pm = h >= 12;
      const h12 = ((h % 12) || 12);
      return h12 + (pm ? ' PM' : ' AM');
    };
    const hoursHTML = Array.from({ length: 24 }, (_, i) => {
      const h = (HOUR_START + i) % 24;
      return '<button type="button" class="ht-rem-slot' +
        (h === curH ? ' ht-rem-slot--active' : '') +
        '" data-h="' + h + '">' + esc(hourLabel(h)) + '</button>';
    }).join('');
    const minutesHTML = [0, 15, 30, 45].map(m =>
      '<button type="button" class="ht-rem-slot' +
        (m === curM ? ' ht-rem-slot--active' : '') +
      '" data-m="' + m + '">' + String(m).padStart(2, '0') + '</button>'
    ).join('');

    // Toast is the visible pill. Popup is a SIBLING (also position: fixed)
    // anchored above the toast — putting them in separate fixed containers
    // sidesteps any clipping/stacking issues from nested elements.
    const toast = document.createElement('div');
    toast.className = 'habit-toast habit-toast--tappable habit-toast--reminder';
    toast.setAttribute('role', 'button');
    toast.setAttribute('tabindex', '0');
    toast.setAttribute('aria-label', 'Change reminder time');
    toast.innerHTML =
      '<span class="ht-msg">' +
        '✓ Reminder set for ' +
        '<span class="ht-rem-time">' + esc(fmt(initialTime)) + '</span>' +
      '</span>' +
      '<span class="ht-cta ht-rem-dismiss" role="button" aria-label="Dismiss">✕</span>';

    const popup = document.createElement('div');
    popup.className = 'ht-rem-popup hidden';
    popup.innerHTML =
      '<div class="ht-rem-col ht-rem-col--hours" data-col="h">' + hoursHTML + '</div>' +
      '<div class="ht-rem-col-divider"></div>' +
      '<div class="ht-rem-col ht-rem-col--mins"  data-col="m">' + minutesHTML + '</div>';

    // Append both as siblings to body so they're in the root stacking
    // context — no risk of being clipped or hidden by intermediate
    // overlays (e.g. the Beginning reveal screen).
    document.body.appendChild(toast);
    document.body.appendChild(popup);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('habit-toast--visible')));

    const timeChip   = toast.querySelector('.ht-rem-time');
    const dismissBtn = toast.querySelector('.ht-rem-dismiss');

    const cleanup = () => { toast.remove(); popup.remove(); };
    const dismiss = () => {
      toast.classList.remove('habit-toast--visible');
      popup.classList.add('hidden');
      setTimeout(cleanup, 300);
    };

    const openPopup = () => {
      popup.classList.remove('hidden');
      // For each column: leave scrollTop at 0 if the active item is
      // already visible in the first viewport-worth of entries. Only
      // scroll if the active item is below the visible window. This
      // matches the spec: opening the picker shows 5 AM → 9 AM (default)
      // with no scroll needed; if the user has selected a later hour
      // and reopens, we scroll just enough to bring it into view.
      popup.querySelectorAll('.ht-rem-col').forEach(col => {
        const active = col.querySelector('.ht-rem-slot--active');
        if (!active) { col.scrollTop = 0; return; }
        const activeBottom = active.offsetTop + active.offsetHeight;
        if (activeBottom <= col.clientHeight) {
          col.scrollTop = 0;        // active is in the first viewport
        } else {
          // Place the active at the bottom of the visible area so the
          // user sees the items leading up to it (matches the
          // "9 AM at the bottom of 5/6/7/8/9" feel from the spec).
          col.scrollTop = activeBottom - col.clientHeight;
        }
      });
    };
    const closePopup = () => popup.classList.add('hidden');
    const isPopupOpen = () => !popup.classList.contains('hidden');

    // Helper: build "HH:MM" 24h string from current state, snapping minutes.
    const buildT = () => {
      const m = Math.round(curM / 15) * 15;
      const h = (m === 60) ? (curH + 1) % 24 : curH;
      const mm = (m === 60) ? 0 : m;
      return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    };

    const applyTime = async () => {
      const newT = buildT();
      timeChip.textContent = fmt(newT);
      try { await Notif.setDailyDigest(newT); } catch (_) {}
      try { if (typeof refreshRemindersPanel === 'function') refreshRemindersPanel(); } catch (_) {}
    };

    // Column click: pick a value in that column. Other column stays put.
    popup.addEventListener('click', async (e) => {
      e.stopPropagation();
      const slot = e.target.closest('.ht-rem-slot');
      if (!slot) return;
      const col = slot.closest('.ht-rem-col');
      if (!col) return;
      // Update the active highlight within the column
      col.querySelectorAll('.ht-rem-slot').forEach(s => s.classList.remove('ht-rem-slot--active'));
      slot.classList.add('ht-rem-slot--active');
      // Update the corresponding state value
      if (col.dataset.col === 'h') curH = parseInt(slot.dataset.h, 10);
      else                          curM = parseInt(slot.dataset.m, 10);
      await applyTime();
    });

    // Toast-level click: toggle the popup, except for ✕ which dismisses.
    // stopPropagation so taps don't bubble to a parent overlay (e.g. the
    // Beginning reveal listens for taps to advance).
    toast.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.ht-rem-dismiss')) {
        dismiss();
      } else {
        isPopupOpen() ? closePopup() : openPopup();
      }
    });
    toast.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('.ht-rem-dismiss')) {
        e.preventDefault();
        dismiss();
      } else if (e.target === toast) {
        e.preventDefault();
        isPopupOpen() ? closePopup() : openPopup();
      }
    });

    // Tap outside closes the popup (but doesn't dismiss the toast).
    document.addEventListener('click', (e) => {
      if (popup.classList.contains('hidden')) return;
      if (e.target.closest('.habit-toast--reminder')) return;
      if (e.target.closest('.ht-rem-popup')) return;
      closePopup();
    });
  }

  // ── DIGEST TIME PICKER (centered modal) ─────────────────
  // Same two-column UI as the post-onboarding toast picker (hour rotated
  // to 5 AM start, minutes locked to 15-min increments) but presented as
  // a centered card with a dark backdrop. Used by Settings → Daily
  // morning reminder so the platform-native time wheel is bypassed
  // entirely. Calls onPick(newTime) whenever the user picks any slot.
  function openDigestTimePickerModal(initialTime, onPick) {
    function fmt(t) {
      const [hStr, mStr] = (t || '09:00').split(':');
      const h  = parseInt(hStr, 10);
      const m  = parseInt(mStr, 10) || 0;
      const pm = h >= 12;
      const h12 = ((h % 12) || 12);
      return h12 + ':' + String(m).padStart(2, '0') + ' ' + (pm ? 'PM' : 'AM');
    }

    let curH = 9, curM = 0;
    {
      const parts = (initialTime || '09:00').split(':');
      curH = parseInt(parts[0], 10) || 0;
      curM = parseInt(parts[1], 10) || 0;
      curM = Math.round(curM / 15) * 15;
      if (curM === 60) { curH = (curH + 1) % 24; curM = 0; }
    }

    const HOUR_START = 5;
    const hourLabel = (h) => {
      const pm = h >= 12;
      const h12 = ((h % 12) || 12);
      return h12 + (pm ? ' PM' : ' AM');
    };
    const hoursHTML = Array.from({ length: 24 }, (_, i) => {
      const h = (HOUR_START + i) % 24;
      return '<button type="button" class="ht-rem-slot' +
        (h === curH ? ' ht-rem-slot--active' : '') +
        '" data-h="' + h + '">' + esc(hourLabel(h)) + '</button>';
    }).join('');
    const minutesHTML = [0, 15, 30, 45].map(m =>
      '<button type="button" class="ht-rem-slot' +
        (m === curM ? ' ht-rem-slot--active' : '') +
      '" data-m="' + m + '">' + String(m).padStart(2, '0') + '</button>'
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'digest-picker-overlay';
    overlay.innerHTML =
      '<div class="digest-picker-card" role="dialog" aria-label="Pick reminder time">' +
        '<div class="digest-picker-title">Daily Morning Reminder</div>' +
        '<div class="digest-picker-current">' + esc(fmt(initialTime || '09:00')) + '</div>' +
        '<div class="ht-rem-popup digest-picker-cols">' +
          '<div class="ht-rem-col ht-rem-col--hours" data-col="h">' + hoursHTML + '</div>' +
          '<div class="ht-rem-col-divider"></div>' +
          '<div class="ht-rem-col ht-rem-col--mins"  data-col="m">' + minutesHTML + '</div>' +
        '</div>' +
        '<div class="digest-picker-actions">' +
          '<button class="digest-picker-done" type="button">Done</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('digest-picker-overlay--visible'));

    // Auto-scroll each column the same way the toast picker does:
    // active item visible at the bottom of the first viewport.
    overlay.querySelectorAll('.ht-rem-col').forEach(col => {
      const active = col.querySelector('.ht-rem-slot--active');
      if (!active) { col.scrollTop = 0; return; }
      const activeBottom = active.offsetTop + active.offsetHeight;
      if (activeBottom <= col.clientHeight) {
        col.scrollTop = 0;
      } else {
        col.scrollTop = activeBottom - col.clientHeight;
      }
    });

    const close = () => {
      overlay.classList.remove('digest-picker-overlay--visible');
      setTimeout(() => overlay.remove(), 220);
    };

    const buildT = () => {
      const m = Math.round(curM / 15) * 15;
      const h = (m === 60) ? (curH + 1) % 24 : curH;
      const mm = (m === 60) ? 0 : m;
      return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    };

    overlay.querySelector('.digest-picker-cols').addEventListener('click', (e) => {
      const slot = e.target.closest('.ht-rem-slot');
      if (!slot) return;
      const col = slot.closest('.ht-rem-col');
      if (!col) return;
      col.querySelectorAll('.ht-rem-slot').forEach(s => s.classList.remove('ht-rem-slot--active'));
      slot.classList.add('ht-rem-slot--active');
      if (col.dataset.col === 'h') curH = parseInt(slot.dataset.h, 10);
      else                          curM = parseInt(slot.dataset.m, 10);
      // Live update the "current selection" display
      const cur = overlay.querySelector('.digest-picker-current');
      if (cur) cur.textContent = fmt(buildT());
      // Apply immediately so the digest reschedules without waiting for Done.
      try { onPick && onPick(buildT()); } catch (_) {}
    });

    // Done commits the current selection AND closes. This ensures that
    // when the user opens the picker, doesn't change anything (the default
    // is already what they want), and taps Done — the time still saves.
    // Without this, opening fresh + tapping Done would never call onPick
    // and the per-habit reminder would never be created.
    overlay.querySelector('.digest-picker-done').addEventListener('click', () => {
      try { onPick && onPick(buildT()); } catch (_) {}
      close();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();      // backdrop tap dismisses
    });

    // ESC dismisses
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  // ── SOUND PREFERENCE ─────────────────────────────────────
  let soundEnabled = localStorage.getItem('hb_sound') !== 'off';

  // ── FEATURE 1: CHECK SOUND ───────────────────────────────
  function playCheckSound() {
    if (!soundEnabled) return;
    try {
      const ac   = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ac.currentTime + 0.08);
      gain.gain.setValueAtTime(0.18, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.28);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.28);
    } catch (_) {}
  }

  // ── BIG-MOMENT FANFARE ────────────────────────────────────
  // Triumphant ascending D-major arpeggio (D4 → F#4 → A4 → D5)
  // with the final D5 sustained as a chord (D5 + A5 fifth) for warmth.
  // Reusable for compound bonus, rank-ups, major achievements.
  function playFanfare() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;

      // D major arpeggio (Hz)
      const D4  = 293.66;
      const Fs4 = 369.99;
      const A4  = 440.00;
      const D5  = 587.33;
      const A5  = 880.00;

      // Master bus — slight low-pass via a small gain dip on highs would need a filter,
      // but layered sine+triangle already gives a warm timbre without harshness.
      const master = ac.createGain();
      master.gain.value = 1.0;
      master.connect(ac.destination);

      // Each note = sine (fundamental) + triangle (warm harmonic body)
      function playNote(freq, start, dur, peak, sustain) {
        ['sine', 'triangle'].forEach(type => {
          const osc  = ac.createOscillator();
          const gain = ac.createGain();
          osc.type   = type;
          osc.frequency.setValueAtTime(freq, t0 + start);
          osc.connect(gain);
          gain.connect(master);

          // Sine carries the melody body; triangle is half-volume for warmth.
          const g = type === 'sine' ? peak : peak * 0.5;

          // Gentle attack, then either a quick release or a long sustain-decay tail
          gain.gain.setValueAtTime(0.0001, t0 + start);
          gain.gain.exponentialRampToValueAtTime(g, t0 + start + 0.025);
          if (sustain > 0) {
            gain.gain.setValueAtTime(g,            t0 + start + 0.20);
            gain.gain.exponentialRampToValueAtTime(g * 0.55, t0 + start + 0.45);
            gain.gain.exponentialRampToValueAtTime(0.0001,    t0 + start + dur);
          } else {
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
          }

          osc.start(t0 + start);
          osc.stop(t0 + start + dur + 0.05);
        });
      }

      // Ascending arpeggio — confident, not rushed (~100ms per step)
      playNote(D4,  0.00, 0.22, 0.26, 0);
      playNote(Fs4, 0.10, 0.22, 0.26, 0);
      playNote(A4,  0.20, 0.22, 0.26, 0);

      // Sustained triumphant chord on the octave: D5 + A5 (open fifth) = bright, "earned" peak
      playNote(D5,  0.30, 1.10, 0.32, 1);
      playNote(A5,  0.30, 1.10, 0.16, 1);   // softer fifth above for richness
    } catch (_) {}
  }

  // Locked-In fanfare — the standard fanfare followed by a final
  // emphatic two-note flourish (D5 → D6) to mark the bigger achievement.
  function playFanfareLockedIn() {
    if (!soundEnabled) return;
    // Reuse the standard fanfare (1.4s)…
    playFanfare();
    // …then layer a final octave punch at ~1.55s so it feels like a victory chord.
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime + 1.55;

      const D5  = 587.33;
      const D6  = 1174.66;
      const Fs5 = 739.99;

      function punch(freq, start, dur, peak) {
        ['sine', 'triangle'].forEach(type => {
          const osc  = ac.createOscillator();
          const gain = ac.createGain();
          osc.type   = type;
          osc.frequency.setValueAtTime(freq, t0 + start);
          osc.connect(gain);
          gain.connect(ac.destination);
          const g = type === 'sine' ? peak : peak * 0.45;
          gain.gain.setValueAtTime(0.0001, t0 + start);
          gain.gain.exponentialRampToValueAtTime(g, t0 + start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
          osc.start(t0 + start);
          osc.stop(t0 + start + dur + 0.05);
        });
      }

      // D5 + Fs5 grace note → D6 octave punch on top
      punch(D5,  0.00, 0.18, 0.22);
      punch(Fs5, 0.00, 0.18, 0.14);
      punch(D6,  0.18, 0.55, 0.32);
    } catch (_) {}
  }

  // ── FEATURE 1: XP PARTICLES ──────────────────────────────
  const DIFF_PARTICLE_COLOR = {
    easy:      '#a78bfa',
    medium:    '#60a5fa',
    hard:      '#fb923c',
    legendary: '#fbbf24',
  };

  function spawnXpParticles(li, diff) {
    const cb    = li.querySelector('.habit-cb');
    if (!cb) return;
    const rect  = cb.getBoundingClientRect();
    const liRect = li.getBoundingClientRect();
    const cx    = rect.left + rect.width  / 2 - liRect.left;
    const cy    = rect.top  + rect.height / 2 - liRect.top;
    const color = DIFF_PARTICLE_COLOR[diff] || '#a78bfa';
    const count = 6;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const dist  = 18 + Math.random() * 18;
      const tx    = Math.cos(angle) * dist;
      const ty    = Math.sin(angle) * dist - 8;
      const size  = 3 + Math.random() * 3;
      const dur   = 0.5 + Math.random() * 0.25;

      const dot = document.createElement('span');
      dot.className = 'xp-particle';
      dot.style.cssText =
        'width:'  + size + 'px;' +
        'height:' + size + 'px;' +
        'left:'   + (cx - size / 2) + 'px;' +
        'top:'    + (cy - size / 2) + 'px;' +
        'background:' + color + ';' +
        '--xp-tx:' + tx + 'px;' +
        '--xp-ty:' + ty + 'px;' +
        '--xp-dur:' + dur + 's;';
      li.appendChild(dot);
      dot.addEventListener('animationend', () => dot.remove(), { once: true });
    }
  }

  // ── FEATURE 2: DAILY QUOTE ───────────────────────────────
  // ── QUOTE ROTATION (Feature 2 — rotating display) ────────
  let _quoteCurrent  = null;
  let _quoteTimer    = null;
  let _quoteRotating = false;

  function _quoteApply(el, q) {
    el.innerHTML = '“' + q.text + '”' + '<span class="dq-attr">' + q.attr + '</span>';
    _quoteCurrent = q;
  }

  function _quotePickNext() {
    if (QUOTES.length <= 1) return QUOTES[0];
    let q;
    do { q = QUOTES[Math.floor(Math.random() * QUOTES.length)]; }
    while (q === _quoteCurrent);
    return q;
  }

  function _quoteDisplayMs(text) {
    const len = (text || '').length;
    if (len < 40) return 4000;   // short
    if (len < 80) return 6000;   // medium
    return 8000;                 // long
  }

  function _quoteScheduleNext() {
    if (!_quoteRotating) return;
    const el = document.getElementById('daily-quote');
    if (!el || !_quoteCurrent) return;

    const displayMs = _quoteDisplayMs(_quoteCurrent.text);

    _quoteTimer = setTimeout(() => {
      if (!_quoteRotating) return;
      // Fade out (500ms via CSS opacity transition)
      el.style.opacity = '0';
      _quoteTimer = setTimeout(() => {
        if (!_quoteRotating) return;
        // Swap content while invisible, then fade back in
        _quoteApply(el, _quotePickNext());
        el.style.opacity = '';   // back to CSS default 0.85
        _quoteScheduleNext();
      }, 500);
    }, displayMs);
  }

  function startQuoteRotation() {
    if (_quoteRotating) return;
    _quoteRotating = true;
    _quoteScheduleNext();
  }

  function stopQuoteRotation() {
    _quoteRotating = false;
    if (_quoteTimer) { clearTimeout(_quoteTimer); _quoteTimer = null; }
    // If we paused mid-fade, restore visibility so the user sees the quote on return
    const el = document.getElementById('daily-quote');
    if (el) el.style.opacity = '';
  }

  function renderDailyQuote() {
    const el = document.getElementById('daily-quote');
    if (!el) return;
    el.classList.remove('hidden');

    // First call this session: show today's deterministic daily quote.
    // Subsequent calls (e.g., after habit toggles re-render the screen) keep
    // whatever quote the rotation has currently displayed.
    //
    // Defensive: if _quoteCurrent IS set but the element somehow has empty
    // innerHTML (e.g., DOM rebuilt mid-session, header redesign re-rendered
    // header markup, etc.), re-apply the current quote so the box never
    // shows up blank.
    if (!_quoteCurrent) {
      const d   = new Date();
      const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
      _quoteApply(el, QUOTES[doy % QUOTES.length]);
    } else if (!el.innerHTML || el.innerHTML.trim() === '') {
      _quoteApply(el, _quoteCurrent);
    }

    // The quote lives in the shared header, visible on every tab —
    // start rotation unconditionally on first render.
    startQuoteRotation();
  }

  // ── FEATURE 3: STREAK DANGER WARNING ─────────────────────
  let streakDangerDismissed = false;

  function checkStreakDanger() {
    const el = document.getElementById('streak-danger');
    if (!el) return;

    // Only show on the habits tab and only if there are incomplete habits
    if (currentTab !== 'habits') { el.classList.add('hidden'); return; }

    const todayHabits = habits.filter(isScheduledToday);
    if (!todayHabits.length) { el.classList.add('hidden'); return; }
    const allDone = todayHabits.every(h => isChecked(h.id));
    if (allDone) { el.classList.add('hidden'); return; }

    // Check if it's between 11 PM and midnight PT
    const ptStr  = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date());
    const hour   = parseInt(ptStr, 10);
    const isLate = hour >= 23;

    if (isLate && !streakDangerDismissed) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function setupStreakDanger() {
    const btn = document.getElementById('streak-danger-dismiss');
    if (btn) {
      btn.addEventListener('click', () => {
        streakDangerDismissed = true;
        document.getElementById('streak-danger').classList.add('hidden');
        // Reset dismissed flag at midnight (next day change will handle it)
      });
    }
  }

  // ── PACK NUDGE BANNERS — Morning Routine + Locked-In ──────
  // Shown on the Habits tab when the user is 1–2 habits short of
  // completing a canonical bonus pack. Tap → opens the pack add modal.
  // Priority order (only one banner visible at a time):
  //   1. Streak Danger        (time-sensitive)
  //   2. Double XP Weekend    (already showing as gold banner)
  //   3. Locked-In nudge      (bigger achievement — wins over MR)
  //   4. Morning Routine nudge
  let morningNudgeDismissedDate  = null;
  let lockedInNudgeDismissedDate = null;

  function _highPriorityBannerShowing() {
    if (currentTab !== 'habits') return true; // suppress on other tabs
    const sd = document.getElementById('streak-danger');
    const dx = document.getElementById('double-xp-banner');
    if (sd && !sd.classList.contains('hidden')) return true;
    if (dx && !dx.classList.contains('hidden')) return true;
    return false;
  }

  function _isBrandNew() {
    return Object.keys(completions || {}).length === 0;
  }

  function shouldShowLockedInNudge() {
    if (_highPriorityBannerShowing()) return false;
    if (_isBrandNew()) return false;
    if (lockedInNudgeDismissedDate === today) return false;
    const missing = getMissingPackHabits('locked-in').length;
    return missing === 1 || missing === 2;
  }

  function shouldShowMorningNudge() {
    if (_highPriorityBannerShowing()) return false;
    if (_isBrandNew()) return false;
    if (morningNudgeDismissedDate === today) return false;
    // Locked-In nudge wins when both would apply
    if (shouldShowLockedInNudge()) return false;
    const missing = getMissingMorningHabits().length;
    return missing === 1 || missing === 2;
  }

  function checkLockedInNudge() {
    const el = document.getElementById('lockedin-nudge');
    if (!el) return;

    if (!shouldShowLockedInNudge()) {
      el.classList.add('hidden');
      return;
    }
    const missingDefs = getMissingPackHabits('locked-in');
    const missing     = missingDefs.length;
    const txtEl       = document.getElementById('li-text');

    if (missing === 1) {
      txtEl.innerHTML =
        "You're <b>1 habit away</b> from the Locked-In Bonus — Add <b>" +
        esc(missingDefs[0].name) + "</b>.";
    } else { // missing === 2
      const a = missingDefs[0].name;
      const b = missingDefs[1].name;
      const inlineFits = (a.length + b.length) <= 50;
      txtEl.innerHTML = inlineFits
        ? "You're <b>2 habits away</b> from the Locked-In Bonus — Add <b>" +
          esc(a) + "</b> and <b>" + esc(b) + "</b>."
        : "You're <b>2 habits away</b> from the Locked-In Bonus — Add 2 more.";
    }

    el.classList.remove('hidden');
  }

  function checkMorningRoutineNudge() {
    const el = document.getElementById('morning-nudge');
    if (!el) return;

    // Always evaluate Locked-In first so its visibility state is current
    checkLockedInNudge();

    if (!shouldShowMorningNudge()) {
      el.classList.add('hidden');
      return;
    }

    const missingDefs = getMissingMorningHabits();
    const missing     = missingDefs.length;
    const txtEl       = document.getElementById('mn-text');

    if (missing === 1) {
      txtEl.innerHTML =
        "You're <b>1 habit away</b> from the Compound Effect Bonus — Add <b>" +
        esc(missingDefs[0].name) + "</b> to unlock daily +XP.";
    } else { // missing === 2
      const a = missingDefs[0].name;
      const b = missingDefs[1].name;
      const inlineFits = (a.length + b.length) <= 50;
      txtEl.innerHTML = inlineFits
        ? "You're <b>2 habits away</b> from the Compound Effect Bonus — Add <b>" +
          esc(a) + "</b> and <b>" + esc(b) + "</b> to unlock daily +XP."
        : "You're <b>2 habits away</b> from the Compound Effect Bonus — Add 2 more morning habits to unlock daily +XP.";
    }

    el.classList.remove('hidden');
  }

  // ── HABIT INFO SHEET (History tab — quick read-only view) ────
  let _hiPrevFocus = null;
  let _hiHabitId   = null;
  function openHabitInfoSheet(habit) {
    if (!habit) return;
    const overlay = document.getElementById('hi-overlay');
    const sheet   = document.getElementById('hi-sheet');
    if (!overlay || !sheet) return;

    _hiHabitId = habit.id;

    // Populate header — full display name with duration if applicable
    document.getElementById('hi-name').textContent = habitDisplayName(habit);

    // Difficulty + XP per completion (base value, before weekend doubling)
    const diffKey = habit.difficulty || 'easy';
    const diff    = DIFFICULTY[diffKey] || DIFFICULTY.easy;
    document.getElementById('hi-difficulty').textContent =
      diff.label + ' difficulty • +' + diff.pts + ' XP per completion';

    // Shared stats block (badge + description + 4-cell grid)
    populateHabitInfoBlock('hi', habit);

    // About this habit — canonical description (read-only)
    const aboutEl = document.getElementById('hi-about-text');
    if (aboutEl) {
      const desc = (typeof getHabitDescription === 'function') ? getHabitDescription(habit) : '';
      aboutEl.textContent = desc || 'Description coming soon.';
      aboutEl.classList.toggle('hi-about-text--empty', !desc);
    }

    // Save focus + open
    _hiPrevFocus = document.activeElement;
    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');
    requestAnimationFrame(() => sheet.classList.add('hi-open'));
    // Move focus to the close button for keyboard users
    setTimeout(() => { document.getElementById('hi-close-btn').focus(); }, 30);
  }

  function closeHabitInfoSheet() {
    const overlay = document.getElementById('hi-overlay');
    const sheet   = document.getElementById('hi-sheet');
    if (!overlay || !sheet) return;
    sheet.classList.remove('hi-open');
    sheet.addEventListener('transitionend', () => {
      sheet.classList.add('hidden');
      overlay.classList.add('hidden');
    }, { once: true });
    if (_hiPrevFocus && typeof _hiPrevFocus.focus === 'function') {
      try { _hiPrevFocus.focus(); } catch (_) {}
    }
    _hiPrevFocus = null;
  }

  function setupHabitInfoSheet() {
    const overlay = document.getElementById('hi-overlay');
    const sheet   = document.getElementById('hi-sheet');
    const closeBtn = document.getElementById('hi-close-btn');
    if (!overlay || !sheet || !closeBtn) return;

    closeBtn.addEventListener('click', closeHabitInfoSheet);
    overlay.addEventListener('click', closeHabitInfoSheet);

    // "View full details" → close this popup and open the View Note sheet
    // 'View full details' button removed — the About text now lives
    // inline in this sheet, so the secondary navigation is unnecessary.
    // The View Note sheet (long-press → View Note) still exists as the
    // separate full-detail surface; users can reach it from there.

    // Reuse the swipe-down-to-dismiss gesture from settings
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, () => {
        sheet.classList.add('hidden');
        overlay.classList.add('hidden');
        sheet.classList.remove('hi-open');
        if (_hiPrevFocus && typeof _hiPrevFocus.focus === 'function') {
          try { _hiPrevFocus.focus(); } catch (_) {}
        }
        _hiPrevFocus = null;
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.hi-drag-handle, .hi-header',
        openClass:      'hi-open',
      });
    }

    // ESC key dismiss
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) {
        closeHabitInfoSheet();
      }
    });

    // Event delegation: any click on a .hg-info-btn opens the info sheet
    // for the corresponding habit. Stops propagation so it doesn't trigger
    // any parent click handler (e.g., card tap).
    document.addEventListener('click', e => {
      const btn = e.target.closest('.hg-info-btn[data-habit-info]');
      if (!btn) return;
      e.stopPropagation();
      e.preventDefault();
      const habitId = btn.getAttribute('data-habit-info');
      const habit   = habits.find(h => h.id === habitId);
      if (habit) openHabitInfoSheet(habit);
    });
  }

  function setupMorningNudge() {
    const el = document.getElementById('morning-nudge');
    const dismissBtn = document.getElementById('morning-nudge-dismiss');
    if (el && dismissBtn) {
      el.addEventListener('click', e => {
        if (e.target === dismissBtn || dismissBtn.contains(e.target)) return;
        openMorningPackModal();
      });
      dismissBtn.addEventListener('click', e => {
        e.stopPropagation();
        morningNudgeDismissedDate = today;
        el.classList.add('hidden');
      });
    }

    // Locked-In nudge — same pattern, separate dismiss state
    const liEl = document.getElementById('lockedin-nudge');
    const liDismissBtn = document.getElementById('lockedin-nudge-dismiss');
    if (liEl && liDismissBtn) {
      liEl.addEventListener('click', e => {
        if (e.target === liDismissBtn || liDismissBtn.contains(e.target)) return;
        openLockedInPackModal();
      });
      liDismissBtn.addEventListener('click', e => {
        e.stopPropagation();
        lockedInNudgeDismissedDate = today;
        liEl.classList.add('hidden');
      });
    }
  }

  // ── FEATURE 4: RANK INFO POPUP ───────────────────────────
  function showRankInfoPopup() {
    const rank      = getRank(totalPoints);
    const rankIdx   = RANKS.findIndex(r => r.id === rank.id);
    const isMax     = rank.next === null;
    const ptsIn     = totalPoints - rank.min;
    const range     = isMax ? 1 : (rank.max - rank.min + 1);
    const pct       = isMax ? 100 : Math.min(100, Math.round((ptsIn / range) * 100));
    const toNext    = isMax ? 0 : rank.next - totalPoints;

    // 7-day XP average
    const sevenDayXP = calcSevenDayXP();
    const dailyAvg   = Math.round(sevenDayXP / 7);

    const rpBadge = document.getElementById('rp-badge');
    rpBadge.textContent = rank.id;
    rpBadge.setAttribute('data-rank', rank.id); // per-rank color via CSS vars
    document.getElementById('rp-rank-name').textContent = rank.label || rank.id + ' Rank';
    document.getElementById('rp-xp-line').textContent   = totalPoints.toLocaleString() + ' XP total';

    const tonextEl = document.getElementById('rp-tonext');
    if (isMax) {
      tonextEl.textContent = 'MAX RANK reached 👑';
    } else {
      const nextRank = RANKS[rankIdx + 1];
      tonextEl.textContent = toNext.toLocaleString() + ' XP to ' + (nextRank ? nextRank.id : 'next') + ' Rank';
    }

    const avgEl = document.getElementById('rp-avg');
    avgEl.innerHTML = 'Last 7 days: <strong>' + sevenDayXP.toLocaleString() + ' XP</strong> · ~' + dailyAvg + '/day';

    const etaEl = document.getElementById('rp-eta');
    if (!isMax && dailyAvg > 0) {
      const daysLeft = Math.ceil(toNext / dailyAvg);
      etaEl.textContent = 'At this pace: ' + (daysLeft === 1 ? 'rank up tomorrow!' : daysLeft + ' days to next rank');
    } else if (isMax) {
      etaEl.textContent = 'You are the best of the best.';
    } else {
      etaEl.textContent = 'Keep going — every habit counts.';
    }

    // Show popup
    const overlay = document.getElementById('rank-popup-overlay');
    const popup   = document.getElementById('rank-popup');
    overlay.classList.remove('hidden');
    popup.classList.remove('hidden');
    requestAnimationFrame(() => {
      popup.classList.add('rp-open');
      setTimeout(() => {
        document.getElementById('rp-bar-fill').style.width = pct + '%';
      }, 60);
    });
    navigator.vibrate && navigator.vibrate(8);
  }

  function closeRankPopup() {
    const popup   = document.getElementById('rank-popup');
    const overlay = document.getElementById('rank-popup-overlay');
    popup.classList.remove('rp-open');
    popup.addEventListener('transitionend', () => {
      popup.classList.add('hidden');
      overlay.classList.add('hidden');
    }, { once: true });
  }

  function calcSevenDayXP() {
    let total = 0;
    let d = today;
    for (let i = 0; i < 7; i++) {
      const ids = completions[d] || [];
      ids.forEach(id => {
        const h = habits.find(x => x.id === id);
        if (h) total += DIFFICULTY[h.difficulty]?.pts || 0;
      });
      d = prevDay(d);
    }
    return total;
  }

  function setupRankPopup() {
    // v2.1.0 redesign: the v1.x .rank-track element was replaced by
    // the rank metric card (.metric-card--rank). Bind the popup-open
    // handler to the new card. Fall back to .rank-track for legacy
    // markup safety. All bindings tolerate null so init() never
    // breaks if any element is missing.
    const rankCard = document.querySelector('.metric-card--rank') ||
                     document.querySelector('.rank-track');
    if (rankCard) rankCard.addEventListener('click', showRankInfoPopup);
    const closeBtn = document.getElementById('rank-popup-close');
    if (closeBtn) closeBtn.addEventListener('click', closeRankPopup);
    const overlay = document.getElementById('rank-popup-overlay');
    if (overlay) overlay.addEventListener('click', closeRankPopup);
  }

  // ── FEATURE 5: PERFECT DAY CELEBRATION ───────────────────
  let pdcRafId = null;

  function triggerPerfectDayCelebration() {
    const overlay = document.getElementById('pdc-overlay');
    const canvas  = document.getElementById('pdc-canvas');
    const xpEl    = document.getElementById('pdc-xp');
    if (!overlay || !canvas) return;

    // Compute today's total XP
    const todayIds = completions[today] || [];
    const todayXP  = todayIds.reduce((sum, id) => {
      const h = habits.find(x => x.id === id);
      return sum + (h ? diffPts(h.difficulty) : 0);
    }, 0);
    xpEl.innerHTML = iconify('+' + todayXP + ' XP earned today ⚡', { size: 16 });

    // Confetti canvas
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');

    const COLORS = ['#f59e0b', '#fbbf24', '#22c55e', '#a78bfa', '#60a5fa', '#fff'];
    const dots   = Array.from({ length: 60 }, () => ({
      x:     Math.random() * canvas.width,
      y:     -10 - Math.random() * canvas.height * 0.4,
      vx:    (Math.random() - 0.5) * 3,
      vy:    2 + Math.random() * 3,
      r:     2.5 + Math.random() * 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 1,
    }));

    if (pdcRafId) { cancelAnimationFrame(pdcRafId); pdcRafId = null; }

    function drawPDC() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dots.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.alpha -= 0.008;
        if (p.alpha <= 0) return;
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      if (dots.some(p => p.alpha > 0)) pdcRafId = requestAnimationFrame(drawPDC);
    }
    pdcRafId = requestAnimationFrame(drawPDC);

    overlay.classList.remove('hidden');
    overlay.classList.add('pdc-active');
    navigator.vibrate && navigator.vibrate([50, 30, 80, 30, 50]);

    // Auto-dismiss after 2.2 s; tap to dismiss early
    const dismiss = () => {
      overlay.classList.remove('pdc-active');
      overlay.classList.add('hidden');
      if (pdcRafId) { cancelAnimationFrame(pdcRafId); pdcRafId = null; }
      overlay.removeEventListener('click', dismiss);
    };
    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 2200);
  }

  // toggleHabit(id, li, opts?)
  //   opts.silent     — skip burst UI (chime, particles, flash, XP float).
  //                     Used by HealthKit auto-verify so walking 3,000 steps
  //                     doesn't trigger the same celebration as a manual tap.
  //                     Milestone popups (rank-up, stat-up, compound) still
  //                     fire — those are real moments worth celebrating.
  //   li may be null  — auto-verify can run when the user is on a different
  //                     tab. State mutations + popup queueing happen
  //                     regardless; DOM updates only when li is provided.
  function toggleHabit(id, li, opts) {
    opts = opts || {};
    const silent  = !!opts.silent;
    const wasDone = isChecked(id);
    const oldRank       = wasDone ? null : getRank(totalPoints);
    const oldStatLevels = wasDone ? null : captureStatLevels();

    if (wasDone) {
      uncheck(id);
      if (li) {
        li.classList.remove('completed');
        li.querySelector('.habit-cb').classList.remove('checked');
      }
      // If the user un-checks an auto-verified completion, that un-check
      // is permanent for the day — the auto-verifier must NOT re-check
      // it on later refresh. Recorded per-habit-name (Daily walk, Sleep,
      // Sleep before midnight, future auto-verify habits) under one
      // generic AUTO_VERIFY.markUnchecked() call.
      try {
        if (typeof AUTO_VERIFY !== 'undefined' && AUTO_VERIFY.isAutoVerifiedToday(id)) {
          const h = habits.find(x => x.id === id);
          if (h && isHealthAutoVerifiableHabit(h)) {
            AUTO_VERIFY.markUnchecked(h.name);
          }
          AUTO_VERIFY.clearAutoVerify(id);
        }
      } catch (_) {}
    } else {
      // Cancel today's pending reminder fire — habit just got done, no
      // need to nag. Tomorrow's will be re-scheduled at daily reset.
      try { Notif.onHabitCompleted(id); } catch (_) {}
      // Minimum enforcement for measurable habits
      const habit = habits.find(h => h.id === id);
      if (habit && !meetsMinimum(habit)) {
        // Tappable toast → opens Edit Habit straight to the goal stepper.
        // (Skip in silent mode — auto-verify shouldn't pop a CTA toast.)
        if (!silent) {
          showHabitToast('Set your goal value to check off this habit', {
            cta:   'Set goal',
            onTap: () => openEditModal(habit.id),
          });
        }
        return;
      }
      // Snapshot compound state so we can detect if THIS tap fires the bonus.
      // If it does, the fanfare in showCompoundPopup() replaces the regular chime.
      const compoundBefore = JSON.stringify(compoundAwarded);
      check(id);
      const compoundFiredNow = JSON.stringify(compoundAwarded) !== compoundBefore;

      if (li) {
        li.classList.add('completed');
        const cb = li.querySelector('.habit-cb');
        cb.classList.add('checked');
        const r = document.createElement('span');
        r.className = 'cb-ripple';
        cb.appendChild(r);
        r.addEventListener('animationend', () => r.remove(), { once: true });
      }

      // Feature 1: sound + particles + card flash + floating XP — the
      // per-tap "burst." Suppressed in silent mode (auto-verify) so the
      // experience feels like the system noticed, not like the user tapped.
      // Suppress regular chime if compound fanfare is taking over this moment.
      if (!silent) {
        if (!compoundFiredNow) playCheckSound();
        if (li) {
          const diff = habit ? habit.difficulty : 'medium';
          spawnXpParticles(li, diff);
          const DIFF_FLASH = { easy: 'rgba(167,139,250,0.6)', medium: 'rgba(96,165,250,0.6)', hard: 'rgba(251,146,60,0.6)', legendary: 'rgba(251,191,36,0.65)' };
          li.style.setProperty('--diff-flash-color', DIFF_FLASH[diff] || 'rgba(139,92,246,0.55)');
          li.classList.remove('card-flash-anim');
          void li.offsetWidth;
          li.classList.add('card-flash-anim');
          li.addEventListener('animationend', () => li.classList.remove('card-flash-anim'), { once: true });

          // Floating XP number (always shown; visually distinct on weekends)
          const xpAmt = habit ? diffPts(habit.difficulty) : 0;
          const xpFloat = document.createElement('span');
          xpFloat.className = 'xp-float';
          xpFloat.innerHTML = iconify('⚡+' + xpAmt + ' XP' + (isWeekend() ? ' 2×' : ''), { size: 14 });
          li.appendChild(xpFloat);
          xpFloat.addEventListener('animationend', () => xpFloat.remove(), { once: true });
        }
      }

      // Detect rank up
      const newRank = getRank(totalPoints);
      if (newRank.id !== oldRank.id) {
        levelUpQueue.unshift({ type: 'rank', rank: newRank });
      }

      // Detect stat level-ups — every level triggers a notification
      STATS.forEach(st => {
        const oldLv = oldStatLevels[st.id];
        const newLv = statLevel(stats[st.id]?.pts || 0);
        for (let lv = oldLv + 1; lv <= newLv; lv++) {
          const bonusThr = STAT_BONUS_THRESHOLDS.find(t => t.level === lv);
          levelUpQueue.push({ type: 'stat', stat: st, level: lv, bonusPts: bonusThr ? bonusThr.pts : null });
        }
      });

      // Class change: check on any stat level-up.
      // Route through checkClassChange() so first-time Civilian → class
      // transitions fire the Awakening celebration (and persist the
      // origin story), and multi-stat ties prompt the class-choice screen.
      if (STATS.some(st => statLevel(stats[st.id]?.pts || 0) > (oldStatLevels[st.id] || 0))) {
        checkClassChange(false);
      }

      if (levelUpQueue.length && !levelUpActive) drainLevelUpQueue();
      else if (!levelUpActive && achQueue.length && !achPopupTimer) drainAchQueue();
    }

    if (li) {
      const count = getStreak(id);
      const badge = li.querySelector('.streak-badge');
      badge.className = 'streak-badge' + (count > 0 ? ' active' : '');
      badge.innerHTML = count > 0 ? '<span class="streak-fire">' + streakIconHtml({ size: 14 }) + '</span>' + count : '—';
      if (!wasDone && count > 0) {
        void badge.offsetWidth;
        badge.classList.add('pop');
        badge.addEventListener('animationend', () => badge.classList.remove('pop'), { once: true });
      }
    }

    if (!wasDone) checkCompoundEffect(id);
    renderRank();
    updateProgress();
    checkPerfectDay();
    if (currentTab === 'profile') renderProfile();
  }

  function updateProgress() {
    const todayHabits = habits.filter(isScheduledToday);
    const total = todayHabits.length;
    const done  = todayHabits.filter(h => isChecked(h.id)).length;
    document.getElementById('completed-count').textContent = done;
    document.getElementById('total-count').textContent = total;
    const pct = total === 0 ? 0 : (done / total) * 100;
    document.getElementById('progress-bar').style.width = pct + '%';
    const listEl = document.getElementById('habit-list');
    if (listEl) listEl.classList.toggle('all-complete', total > 0 && done === total);
    updatePerfectStreakDisplay();
    renderCompoundProgress();
    // v2.1.0 status-header redesign — dependent cards
    try { updateHeaderMetrics(); } catch (_) {}
    try { updateStatusPills(); }   catch (_) {}
  }

  // ── v2.1.0 STATUS HEADER REDESIGN ─────────────────────────────
  // Renders the 3-card metric strip's dynamic data:
  //  - Rank card's class-affinity sub-label ("CIVILIAN" / "WARRIOR" / etc.)
  //  - Week card: XP earned Sunday→today, day-of-week counter, bar
  //  - 30-day sparkline card: cumulative XP path + total + 7-day delta
  // Called from updateProgress() so it refreshes on every toggle/render.
  function updateHeaderMetrics() {
    // ── Rank class-affinity sub (top-right of rank card) ─────
    try {
      const subEl = document.getElementById('rank-class-sub');
      if (subEl) {
        const cls = (typeof currentClass !== 'undefined' && currentClass) ? currentClass : 'CIVILIAN';
        const def = (typeof CLASSES !== 'undefined') ? CLASSES[cls] : null;
        subEl.textContent = (def && def.name ? def.name : 'CIVILIAN').toUpperCase();
      }
    } catch (_) {}

    // ── Week card: XP this calendar week (Sun 00:00 → Sat 23:59) ─
    try {
      const now = new Date();
      const dow = now.getDay(); // 0=Sun ... 6=Sat
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - dow);
      weekStart.setHours(0, 0, 0, 0);

      // Sum XP across each completed habit on each day from Sunday onward.
      // completions is { 'YYYY-MM-DD': [habitId, ...] }; XP per completion
      // derives from the habit's difficulty via DIFFICULTY[diff].pts.
      let weekXP = 0;
      const habitIndex = {};
      habits.forEach(h => { habitIndex[h.id] = h; });
      for (let i = 0; i <= dow; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const iso = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        const ids = completions[iso] || [];
        ids.forEach(id => {
          const h = habitIndex[id];
          if (!h) return;
          const diff = h.difficulty || 'medium';
          const pts = (DIFFICULTY[diff] && DIFFICULTY[diff].pts) || 3;
          weekXP += pts;
        });
      }

      // Weekly target — generous-but-not-trivial scale. Tunable.
      // 200 XP/week ≈ ~5 medium habits × 6 days at 3pts each, matches an
      // engaged user's realistic weekly throughput at mid-game.
      const WEEK_XP_TARGET = 200;
      const pct = Math.min(100, Math.round((weekXP / WEEK_XP_TARGET) * 100));

      const cur = document.getElementById('week-xp-current');
      const bar = document.getElementById('week-xp-bar');
      const day = document.getElementById('week-xp-day');
      if (cur) cur.textContent = weekXP;
      if (bar) bar.style.width = pct + '%';
      if (day) day.textContent = (dow + 1); // Sunday=Day 1, Saturday=Day 7
    } catch (_) {}

    // ── 30-day cumulative XP sparkline ───────────────────────
    try {
      const series = []; // 30 entries — cumulative XP at end of each day
      let cum = 0;
      const habitIndex = {};
      habits.forEach(h => { habitIndex[h.id] = h; });
      // Walk 30 days ending today (oldest → newest).
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // First pass: compute XP earned ON each of the past 30 days
      const perDay = new Array(30).fill(0);
      for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - (29 - i));
        const iso = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        const ids = completions[iso] || [];
        let dayXP = 0;
        ids.forEach(id => {
          const h = habitIndex[id];
          if (!h) return;
          const diff = h.difficulty || 'medium';
          const pts = (DIFFICULTY[diff] && DIFFICULTY[diff].pts) || 3;
          dayXP += pts;
        });
        perDay[i] = dayXP;
      }
      for (let i = 0; i < 30; i++) {
        cum += perDay[i];
        series.push(cum);
      }
      const totalXP = series[29];
      const last7XP = perDay.slice(23).reduce((a, b) => a + b, 0);

      // Render numbers
      const totalEl = document.getElementById('xp-30d-total');
      const deltaEl = document.getElementById('xp-30d-delta');
      if (totalEl) totalEl.textContent = totalXP;
      if (deltaEl) deltaEl.textContent = '+' + last7XP + ' / 7D';

      // Render SVG paths. viewBox is 130×22; scale series → coords.
      const maxY = Math.max(1, totalXP); // floor 1 to avoid div-by-zero
      const W = 130, H = 22;
      const points = series.map((v, i) => {
        const x = (i / 29) * W;
        const y = H - (v / maxY) * (H - 1); // 1px floor at top
        return [x, y];
      });
      const linePath = points.map((p, i) =>
        (i === 0 ? 'M ' : 'L ') + p[0].toFixed(2) + ',' + p[1].toFixed(2)
      ).join(' ');
      const areaPath = linePath + ' L ' + W + ',' + H + ' L 0,' + H + ' Z';

      const line = document.getElementById('xp-30d-spark-line');
      const area = document.getElementById('xp-30d-spark-area');
      const dot  = document.getElementById('xp-30d-spark-dot');
      if (line) line.setAttribute('d', linePath);
      if (area) area.setAttribute('d', areaPath);
      if (dot && points.length) {
        const last = points[points.length - 1];
        dot.setAttribute('cx', last[0].toFixed(2));
        dot.setAttribute('cy', last[1].toFixed(2));
      }
    } catch (_) {}
  }

  // Renders the status pill row: active habit packs (Morning Routine,
  // Locked-In) + class affinity lean. Hides the row entirely when
  // there's nothing to show (e.g., first-launch Civilian with no packs).
  function updateStatusPills() {
    const row   = document.getElementById('status-pills');
    const list  = document.getElementById('status-pills-list');
    if (!row || !list) return;

    const pills = [];

    // ── Active packs ─────────────────────────────────────────
    // Both packs use the generic userHasAllPackHabits(packId) helper.
    // Pack IDs come from the PACKS constant: 'morning' + 'locked-in'.
    try {
      if (typeof userHasAllPackHabits === 'function') {
        if (userHasAllPackHabits('morning'))    pills.push({ key: 'mr', label: 'MORNING ROUTINE', active: true });
        if (userHasAllPackHabits('locked-in'))  pills.push({ key: 'li', label: 'LOCKED-IN',       active: true });
      }
    } catch (_) {}

    // ── Class affinity / current class ───────────────────────
    // Always render a class pill (CIVILIAN if not yet awakened, or the
    // user's actual class otherwise, or stat-LEAN if currentClass isn't
    // set but a stat is at Lv1+). Guarantees the status row always has
    // at least one pill so the visual envelope renders.
    try {
      if (typeof currentClass !== 'undefined' && currentClass && currentClass !== 'CIVILIAN') {
        // User has Awakened — show their actual class pill.
        const def = (typeof CLASSES !== 'undefined') ? CLASSES[currentClass] : null;
        const className = (def && def.name) ? def.name.toUpperCase() : currentClass;
        const classStat = currentClass === 'SAGE' ? '' : currentClass;
        const key = currentClass.toLowerCase();
        pills.push({ key: key, label: className, active: false });
      } else if (typeof _statLevels === 'function') {
        // Pre-Awakening — show top stat if any leveled, else CIVILIAN.
        const levels = _statLevels();
        const top = levels && levels[0];
        if (top && top.lv > 0) {
          pills.push({ key: top.id.toLowerCase(), label: top.id + '-LEAN', active: false });
        } else {
          pills.push({ key: 'civilian', label: 'CIVILIAN', active: false });
        }
      } else {
        pills.push({ key: 'civilian', label: 'CIVILIAN', active: false });
      }
    } catch (_) {
      pills.push({ key: 'civilian', label: 'CIVILIAN', active: false });
    }

    // Always show the row now — at minimum it has the class pill.
    row.classList.remove('hidden');
    list.innerHTML = pills.map(p =>
      '<span class="status-pill status-pill--' + p.key + (p.active ? ' status-pill--active' : '') + '">' +
        '<span class="status-pill-dot" aria-hidden="true"></span>' +
        esc(p.label) +
      '</span>'
    ).join('');
  }

  // ── XP·30D detail sheet (v2.1.0) ─────────────────────────────
  // Opens on tap of the .metric-card--spark in the header. Bottom-
  // sheet pattern matching the leaderboard ranking sheet. Renders a
  // larger version of the cumulative XP chart + a 6-cell stats grid.
  function openXpDetail() {
    const overlay = document.getElementById('xp-detail-overlay');
    const sheet   = document.getElementById('xp-detail-sheet');
    if (!overlay || !sheet) return;
    populateXpDetail();
    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }
  function closeXpDetail() {
    const overlay = document.getElementById('xp-detail-overlay');
    const sheet   = document.getElementById('xp-detail-sheet');
    if (overlay) overlay.classList.add('hidden');
    if (sheet)   sheet.classList.add('hidden');
  }
  function populateXpDetail() {
    // Build the per-day XP array for the last 30 days (oldest → newest)
    const habitIndex = {};
    habits.forEach(h => { habitIndex[h.id] = h; });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const perDay = new Array(30).fill(0);
    const dates  = new Array(30).fill('');
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - (29 - i));
      const iso = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      dates[i] = iso;
      const ids = completions[iso] || [];
      let dayXP = 0;
      ids.forEach(id => {
        const h = habitIndex[id];
        if (!h) return;
        const diff = h.difficulty || 'medium';
        const pts = (DIFFICULTY[diff] && DIFFICULTY[diff].pts) || 3;
        dayXP += pts;
      });
      perDay[i] = dayXP;
    }
    // Cumulative series
    const cumulative = new Array(30).fill(0);
    let cum = 0;
    for (let i = 0; i < 30; i++) {
      cum += perDay[i];
      cumulative[i] = cum;
    }

    // Stats
    const total30 = cumulative[29];
    const last7   = perDay.slice(23).reduce((a, b) => a + b, 0);
    const totalAllTime = (typeof totalPoints === 'number') ? totalPoints : total30;
    const daysActive = perDay.filter(x => x > 0).length;
    // Best day
    let bestDay = 0, bestIdx = -1;
    perDay.forEach((v, i) => { if (v > bestDay) { bestDay = v; bestIdx = i; } });

    // This-week XP (Sunday → today inclusive)
    const dow = new Date().getDay();
    let weekXP = 0;
    for (let i = dow; i >= 0; i--) {
      // perDay index for today is 29; walk back dow steps
      weekXP += perDay[29 - (dow - i)] || 0;
    }
    // Simpler equivalent: sum the last (dow + 1) entries of perDay
    weekXP = perDay.slice(29 - dow).reduce((a, b) => a + b, 0);

    // Render numeric cells
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (val || 0).toLocaleString('en-US');
    };
    setText('xp-detail-total',        totalAllTime);
    setText('xp-detail-week',         weekXP);
    setText('xp-detail-7d',           last7);
    setText('xp-detail-30d',          total30);
    setText('xp-detail-days-active',  daysActive);
    setText('xp-detail-best-day',     bestDay);
    // Best day sub: format the date (e.g., "MAY 8")
    const bestSubEl = document.getElementById('xp-detail-best-day-sub');
    if (bestSubEl) {
      if (bestIdx >= 0 && bestDay > 0) {
        const bestDate = new Date(dates[bestIdx] + 'T12:00:00');
        const monthShort = bestDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        bestSubEl.textContent = 'XP · ' + monthShort + ' ' + bestDate.getDate();
      } else {
        bestSubEl.textContent = 'XP · —';
      }
    }

    // Big chart paths (viewBox 400×140; reserve 1px floor at top)
    const W = 400, H = 140;
    const maxY = Math.max(1, total30);
    const points = cumulative.map((v, i) => {
      const x = (i / 29) * W;
      const y = H - (v / maxY) * (H - 1);
      return [x, y];
    });
    const linePath = points.map((p, i) =>
      (i === 0 ? 'M ' : 'L ') + p[0].toFixed(2) + ',' + p[1].toFixed(2)
    ).join(' ');
    const areaPath = linePath + ' L ' + W + ',' + H + ' L 0,' + H + ' Z';

    const line = document.getElementById('xp-detail-line');
    const area = document.getElementById('xp-detail-area');
    const dot  = document.getElementById('xp-detail-dot');
    if (line) line.setAttribute('d', linePath);
    if (area) area.setAttribute('d', areaPath);
    if (dot && points.length) {
      const last = points[points.length - 1];
      dot.setAttribute('cx', last[0].toFixed(2));
      dot.setAttribute('cy', last[1].toFixed(2));
    }

    // Axis labels — start, midpoint, end of the 30-day window
    const fmtAxis = (iso) => {
      const d = new Date(iso + 'T12:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    };
    const startEl = document.getElementById('xp-detail-axis-start');
    const midEl   = document.getElementById('xp-detail-axis-mid');
    const endEl   = document.getElementById('xp-detail-axis-end');
    if (startEl) startEl.textContent = fmtAxis(dates[0]);
    if (midEl)   midEl.textContent   = fmtAxis(dates[14]);
    if (endEl)   endEl.textContent   = fmtAxis(dates[29]);
  }
  function setupXpDetail() {
    const card    = document.querySelector('.metric-card--spark');
    const overlay = document.getElementById('xp-detail-overlay');
    const sheet   = document.getElementById('xp-detail-sheet');
    const close   = document.getElementById('xp-detail-close');
    if (card) card.addEventListener('click', openXpDetail);
    if (overlay) overlay.addEventListener('click', closeXpDetail);
    if (close)   close.addEventListener('click', closeXpDetail);
    if (sheet && typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, closeXpDetail, {});
    }
  }

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── TABS ──────────────────────────────────────────────────
  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tab) {
    // Close the boss full-screen modal on any tab change. The modal
    // overlays the Quests tab; leaving the tab (or re-entering it
    // fresh) should not leave the modal hanging over.
    if (typeof closeBossFullScreen === 'function') closeBossFullScreen();
    currentTab = tab;
    // Exit reorder mode whenever we leave the habits tab
    document.getElementById('habit-list').classList.remove('reorder-mode');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const profilePanel = document.getElementById('profile-panel');
    const habitsPanel  = document.getElementById('main-scroll');
    const statsPanel   = document.getElementById('stats-panel');
    const histPanel    = document.getElementById('history-panel');
    const questsPanel  = document.getElementById('quests-panel');
    const itemsPanel   = document.getElementById('items-panel');
    const socialPanel  = document.getElementById('social-panel');
    const footer       = document.getElementById('main-footer');

    profilePanel.classList.toggle('hidden', tab !== 'profile');
    habitsPanel.classList.toggle('hidden',  tab !== 'habits');
    statsPanel.classList.toggle('hidden',   tab !== 'stats');
    histPanel.classList.toggle('hidden',    tab !== 'history');
    questsPanel.classList.toggle('hidden',  tab !== 'quests');
    itemsPanel.classList.toggle('hidden',   tab !== 'items');
    socialPanel.classList.toggle('hidden',  tab !== 'social');
    footer.style.display = tab === 'habits' ? '' : 'none';

    if (tab === 'profile')      renderProfile();
    if (tab === 'stats')        renderStats();
    if (tab === 'history')      renderHistory();
    // Quests tab: always re-greet the user with the gate. Reset the
    // expansion flag on every tab activation so re-entering the
    // dungeon is an intentional act, not a stale-state continuation.
    // renderQuestsPanel() handles the gate-vs-dungeon visibility
    // swap and re-renders the boss list lazily when expanded.
    if (tab === 'quests') {
      questsGateExpanded = false;
      renderQuestsPanel();
    }
    // Render the Leaderboard preview when the Social tab is opened.
    if (tab === 'social') {
      renderLeaderboardPreview();
    }
    // Render the Pokédex when the Items tab is opened (v2.0.1 DROPS).
    if (tab === 'items') {
      renderPokedex();
    }
    checkStreakDanger();
    checkMorningRoutineNudge();
  }

  // ── HABIT LIBRARY ─────────────────────────────────────────
  function setupLibrary() {
    document.getElementById('add-habit-btn').addEventListener('click', openLibrary);
    document.getElementById('lib-close-btn').addEventListener('click', closeLibrary);
    document.getElementById('lib-overlay').addEventListener('click', closeLibrary);

    // Swipe-down-to-dismiss on the Add Habits sheet
    if (typeof attachSheetDismissGesture === 'function') {
      const libSheet   = document.getElementById('lib-sheet');
      const libOverlay = document.getElementById('lib-overlay');
      attachSheetDismissGesture(libSheet, libOverlay, () => {
        libSheet.classList.add('hidden');
        libOverlay.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.lib-drag-handle, .lib-header',
        scrollTarget:   '#lib-list',
      });
    }

    // Standalone pack add buttons removed — pack strips themselves are now
    // the entry point for adding missing pack habits. These guards stay in
    // case the HTML is reintroduced later without causing a crash.
    const mrBtn = document.getElementById('add-morning-btn');
    if (mrBtn) mrBtn.addEventListener('click', openMorningPackModal);
    const liBtn = document.getElementById('add-lockedin-btn');
    if (liBtn) liBtn.addEventListener('click', openLockedInPackModal);
    document.getElementById('mr-cancel-btn').addEventListener('click',  closeMorningPackModal);
    document.getElementById('mr-overlay').addEventListener('click', e => {
      if (e.target.id === 'mr-overlay') closeMorningPackModal();
    });
    document.getElementById('mr-confirm-btn').addEventListener('click', confirmMorningPackAdd);
  }

  // ── MORNING ROUTINE PACK — UI ────────────────────────────────
  function updateMorningButtonVisibility() {
    const btn = document.getElementById('add-morning-btn');
    if (!btn) return;
    btn.classList.toggle('hidden', getMissingMorningHabits().length === 0);
  }
  function updateLockedInButtonVisibility() {
    const btn = document.getElementById('add-lockedin-btn');
    if (!btn) return;
    btn.classList.toggle('hidden', getMissingPackHabits('locked-in').length === 0);
  }

  // Generic pack-confirmation modal opener. Powers both Morning Routine
  // and Locked-In via packId. Re-uses the #mr-overlay DOM, themes per pack.
  let _packModalActiveId = 'morning';

  function openPackConfirmModal(packId) {
    const pack = getPackById(packId);
    if (!pack) return;
    _packModalActiveId = packId;

    const ov     = document.getElementById('mr-overlay');
    const card   = ov && ov.querySelector('.mr-card');
    const list   = document.getElementById('mr-list');
    const count  = document.getElementById('mr-count');
    const btn    = document.getElementById('mr-confirm-btn');
    const iconEl = document.getElementById('mr-icon');
    const titleEl    = document.getElementById('mr-title');
    const subtitleEl = document.getElementById('mr-subtitle');
    if (!ov || !list || !count || !btn) return;

    // Theme (gold for MR, violet for Locked-In)
    if (card) {
      card.classList.remove('mr-card--morning', 'mr-card--lockedin');
      card.classList.add(packId === 'locked-in' ? 'mr-card--lockedin' : 'mr-card--morning');
    }
    // Use the custom pack PNG if we have one for this pack id, else
    // fall back to iconify on the raw pack.emoji.
    if (iconEl) {
      const pkPng = packId === 'morning'   ? packIconHtml('morning',  { size: 44 }) :
                    packId === 'locked-in' ? packIconHtml('lockedin', { size: 44 }) :
                    null;
      iconEl.innerHTML = pkPng || iconify(pack.emoji, { size: 32 });
    }
    if (titleEl)    titleEl.textContent    = 'Add ' + pack.name + '?';
    if (subtitleEl) {
      subtitleEl.textContent = packId === 'locked-in'
        ? '16 habits — the complete discipline cycle.'
        : 'This pack contains 10 habits designed to compound daily.';
    }

    const activeNames = new Set(habits.map(h => h.name));
    const defs        = getPackHabitDefs(packId);
    const missing     = defs.filter(d => !activeNames.has(d.name));

    list.innerHTML = '';
    defs.forEach(def => {
      const have = activeNames.has(def.name);
      const row  = document.createElement('div');
      row.className = 'mr-row' + (have ? ' mr-row--have' : '');
      row.innerHTML =
        '<span class="mr-row-emoji">' + habitIconHtml(def, { size: 20 }) + '</span>' +
        '<span class="mr-row-name">' + esc(def.name) + '</span>' +
        '<span class="mr-row-tag">' + (have ? '✓ Already added' : '+ Will add') + '</span>';
      list.appendChild(row);
    });

    if (missing.length === 0) {
      count.textContent = 'All ' + defs.length + ' habits already in your routine.';
      btn.disabled      = true;
      btn.textContent   = 'All habits already added';
    } else {
      count.textContent = 'Adding ' + missing.length + ' new habit' + (missing.length === 1 ? '' : 's') + ' to your routine';
      btn.disabled      = false;
      btn.textContent   = 'Add ' + missing.length + ' Habit' + (missing.length === 1 ? '' : 's');
    }

    ov.classList.remove('hidden');
  }

  // Backward-compat alias used by existing call sites
  function openMorningPackModal() { openPackConfirmModal('morning'); }
  function openLockedInPackModal() { openPackConfirmModal('locked-in'); }

  // ── CUSTOM HABIT MODAL ─────────────────────────────────────
  // User authors a habit: emoji + name + which stat it builds.
  // Difficulty is FIXED at CUSTOM_HABIT_DIFFICULTY ('medium' / 3 XP) so
  // customs can't game the rank economy. Capped at MAX_CUSTOM_HABITS.
  let _customEmoji   = '⚡';
  let _customStatId  = null;

  function openCustomHabitModal() {
    if (habits.filter(h => h.custom).length >= MAX_CUSTOM_HABITS) return;
    _customEmoji  = '⚡';
    _customStatId = null;
    document.getElementById('custom-emoji-btn').textContent = _customEmoji;
    document.getElementById('custom-name-input').value = '';
    document.getElementById('custom-error').classList.add('hidden');
    renderCustomStatGrid();
    updateCustomSaveBtn();
    document.getElementById('custom-overlay').classList.remove('hidden');
    setTimeout(() => {
      try { document.getElementById('custom-name-input').focus(); } catch (_) {}
    }, 80);
  }

  function closeCustomHabitModal() {
    document.getElementById('custom-overlay').classList.add('hidden');
  }

  function renderCustomStatGrid() {
    const grid = document.getElementById('custom-stat-grid');
    if (!grid) return;
    grid.innerHTML = '';
    STATS.forEach(st => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'custom-stat-btn' + (_customStatId === st.id ? ' selected' : '');
      btn.style.setProperty('--cs-color', st.color);
      btn.style.setProperty('--cs-glow',  colorWithAlpha(st.color, 0.32));
      btn.innerHTML =
        '<span class="custom-stat-icon">' + statIconHtml(st, { size: 22 }) + '</span>' +
        '<span class="custom-stat-name">' + esc(st.label) + '</span>';
      btn.addEventListener('click', () => {
        _customStatId = st.id;
        renderCustomStatGrid();
        updateCustomSaveBtn();
      });
      grid.appendChild(btn);
    });
  }

  function updateCustomSaveBtn() {
    const name = (document.getElementById('custom-name-input').value || '').trim();
    document.getElementById('custom-save-btn').disabled = !(name.length > 0 && _customStatId);
  }

  function saveCustomHabit() {
    const name = (document.getElementById('custom-name-input').value || '').trim();
    const errEl = document.getElementById('custom-error');
    const showErr = (msg) => { errEl.textContent = msg; errEl.classList.remove('hidden'); };

    if (!name)            return showErr('Give your habit a name.');
    if (!_customStatId)   return showErr('Pick the stat this habit trains.');
    if (habits.some(h => h.name.toLowerCase() === name.toLowerCase())) {
      return showErr('You already have a habit with that name.');
    }
    if (habits.filter(h => h.custom).length >= MAX_CUSTOM_HABITS) {
      return showErr('You\'ve reached the ' + MAX_CUSTOM_HABITS + '-custom-habit cap.');
    }

    const newH = {
      id:          uid(),
      emoji:       _customEmoji || '⚡',
      name:        name,
      difficulty:  CUSTOM_HABIT_DIFFICULTY,
      type:        'build',
      primaryStat: _customStatId,
      custom:      true,
    };
    habits.push(newH);
    save();
    renderHabits();
    renderLibrary();
    closeCustomHabitModal();
    // Per-habit reminder offers were removed in v1.1.3 — Awakened sends
    // ONE morning digest by default, no per-habit prompts. Power users
    // can still set per-habit reminders via Edit Habit.
  }

  function setupCustomHabitModal() {
    const overlay = document.getElementById('custom-overlay');
    if (!overlay) return;
    document.getElementById('custom-cancel-btn').addEventListener('click', closeCustomHabitModal);
    document.getElementById('custom-save-btn').addEventListener('click', saveCustomHabit);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeCustomHabitModal();
    });
    document.getElementById('custom-name-input').addEventListener('input', updateCustomSaveBtn);
    document.getElementById('custom-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !document.getElementById('custom-save-btn').disabled) {
        e.preventDefault();
        saveCustomHabit();
      }
    });
    document.getElementById('custom-emoji-btn').addEventListener('click', (e) => {
      openEmojiPicker(e.currentTarget, _customEmoji, (em) => {
        _customEmoji = em || '⚡';
        document.getElementById('custom-emoji-btn').textContent = _customEmoji;
      });
    });
  }

  function closeMorningPackModal() {
    document.getElementById('mr-overlay').classList.add('hidden');
  }

  function confirmPackAdd() {
    const packId  = _packModalActiveId;
    const missing = getMissingPackHabits(packId);
    if (missing.length === 0) { closeMorningPackModal(); return; }

    // Add in canonical pack order, preserving each habit's defaults.
    // Dedup: getMissingPackHabits already filtered to absent names.
    // Existing streaks/progress on existing entries remain untouched.
    const _justAdded = [];
    missing.forEach(def => {
      const newH = {
        id:          uid(),
        emoji:       def.emoji,
        name:        def.name,
        difficulty:  def.difficulty,
        type:        def.type || 'build',
        primaryStat: def.primaryStat,
      };
      habits.push(newH);
      _justAdded.push(newH);
      if (def.note) habitNotes[newH.id] = def.note;
    });
    save();

    // Mark the player's path (only on first MR add — Locked-In doesn't override)
    if (packId === 'morning' && !selectedPackId) {
      selectedPackId = 'morning';
      try { localStorage.setItem('hb_path', selectedPackId); } catch (_) {}
    }

    const pack = getPackById(packId);
    closeMorningPackModal();
    closeLibrary();
    renderHabits();
    updateMorningButtonVisibility();
    updateLockedInButtonVisibility();
    updateLockedInButtonVisibility();
    showHabitToast(pack.name + ' added — ' + missing.length + ' habit' + (missing.length === 1 ? '' : 's'));

    // Auto-trigger the notification prompt when a pack is added and the
    // user hasn't been asked yet. Pack-based paths (Morning Routine,
    // Locked-In) are committing to a daily routine — a single morning
    // reminder is the most useful default for them. Fired as a follow-up
    // to the toast (not blocking the pack-add) so the moment feels
    // natural: "you committed → here's what we suggest."
    const isReminderable = (packId === 'morning' || packId === 'locked-in');
    if (isReminderable) {
      try {
        if (Notif && Notif.permAskedBefore && !Notif.permAskedBefore()) {
          setTimeout(() => runOnboardingNotifPrompt(() => {}), 600);
        }
      } catch (_) {}
    }
  }

  // Backward-compat alias for existing wiring
  function confirmMorningPackAdd() { confirmPackAdd(); }

  function openLibrary() {
    renderLibrary();
    document.getElementById('lib-overlay').classList.remove('hidden');
    document.getElementById('lib-sheet').classList.remove('hidden');
  }

  function closeLibrary() {
    document.getElementById('lib-overlay').classList.add('hidden');
    document.getElementById('lib-sheet').classList.add('hidden');
  }

  function renderLibrary() {
    const list = document.getElementById('lib-list');
    list.innerHTML = '';
    const activeNames = new Set(habits.map(h => h.name));

    // Build available-habits map per category
    const catData = OB_CATEGORIES.map(cat => {
      const available = [];
      for (let i = cat.start; i < cat.end; i++) {
        if (!activeNames.has(DEFAULT_HABITS[i].name)) available.push(i);
      }
      return { cat, available };
    }).filter(d => d.available.length > 0);

    // ── Morning Routine pack entry — always shown at the top ──
    // Distinct orange/gold styling marks this as a curated pack
    // (not a regular category) and signals the compound bonus.
    const mrEntry = document.createElement('div');
    mrEntry.className = 'lib-pack-entry';
    const mrMissing = getMissingMorningHabits().length;
    mrEntry.innerHTML =
      '<span class="lib-pack-emoji">' + packIconHtml('morning', { size: 44 }) + '</span>' +
      '<span class="lib-pack-text">' +
        '<span class="lib-pack-title">Morning Routine ' +
          '<span class="lib-pack-bolt" data-bonus-info aria-label="About the Compound Effect Bonus" role="button" tabindex="0">' + xpIconHtml({ size: 14 }) + '</span>' +
        '</span>' +
        '<span class="lib-pack-sub">Complete 10-habit starter pack</span>' +
      '</span>' +
      '<span class="lib-pack-count">' +
        (mrMissing === 0 ? 'All added' : '10 habits') +
      '</span>' +
      '<span class="lib-pack-chevron">›</span>';
    mrEntry.addEventListener('click', openMorningPackModal);

    // ── Locked-In pack entry — sits directly below Morning Routine ──
    // Violet accent distinguishes it from MR's gold; the lock + bolt
    // signal "bigger achievement, second compound bonus."
    const liEntry = document.createElement('div');
    liEntry.className = 'lib-pack-entry lib-pack-entry--lockedin';
    const liMissing = getMissingPackHabits('locked-in').length;
    liEntry.innerHTML =
      '<span class="lib-pack-emoji">' + packIconHtml('lockedin', { size: 44 }) + '</span>' +
      '<span class="lib-pack-text">' +
        '<span class="lib-pack-title">Locked-In ' +
          '<span class="lib-pack-bolt" aria-label="Locked-In Bonus">' + xpIconHtml({ size: 14 }) + '</span>' +
        '</span>' +
        '<span class="lib-pack-sub">Master the full discipline cycle.</span>' +
      '</span>' +
      '<span class="lib-pack-count">' +
        (liMissing === 0 ? 'All added' : '16 habits') +
      '</span>' +
      '<span class="lib-pack-chevron">›</span>';
    liEntry.addEventListener('click', openLockedInPackModal);

    // ── Create your own — purple-accented, dashed border, sits below packs ──
    // Always shown (until cap is reached) so users can author personal habits
    // alongside the curated 49. XP is fixed at Medium so the rank economy
    // can't be gamed.
    const customCount    = habits.filter(h => h.custom).length;
    const customsLeft    = Math.max(0, MAX_CUSTOM_HABITS - customCount);
    const customEntry    = document.createElement('div');
    customEntry.className = 'lib-pack-entry lib-pack-entry--custom';
    customEntry.innerHTML =
      '<span class="lib-pack-emoji">' + packIconHtml('custom', { size: 44 }) + '</span>' +
      '<span class="lib-pack-text">' +
        '<span class="lib-pack-title">Create Your Own</span>' +
        '<span class="lib-pack-sub">' +
          (customsLeft === 0
            ? 'Cap reached (' + MAX_CUSTOM_HABITS + ' custom habits)'
            : 'Your habit, your stat. +3 XP per completion.') +
        '</span>' +
      '</span>' +
      '<span class="lib-pack-count">' +
        (customsLeft === 0 ? 'Full' : customsLeft + ' left') +
      '</span>' +
      '<span class="lib-pack-chevron">›</span>';
    if (customsLeft > 0) {
      customEntry.addEventListener('click', openCustomHabitModal);
    } else {
      customEntry.style.opacity = '0.55';
      customEntry.style.cursor  = 'not-allowed';
    }

    list.appendChild(mrEntry);
    list.appendChild(liEntry);
    list.appendChild(customEntry);

    if (!catData.length) {
      // Pack entry above is shown; the rest of the categories area is empty.
      const empty = document.createElement('p');
      empty.className = 'lib-empty';
      empty.textContent = 'All individual habits are already in your list.';
      list.appendChild(empty);
      return;
    }

    // ── Accordion state ──────────────────────────────────────
    let libOpenIdx = -1; // start with all categories collapsed

    function libSetOpen(idx) {
      list.querySelectorAll('.ob-acc-section').forEach((sec, i) => {
        const body    = sec.querySelector('.ob-acc-body');
        const chevron = sec.querySelector('.ob-acc-chevron');
        const isOpen  = (i === idx);
        sec.classList.toggle('ob-open', isOpen);
        chevron.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(0deg)';
        body.style.maxHeight    = isOpen ? body.scrollHeight + 'px' : '0';
      });
      libOpenIdx = idx;
    }

    catData.forEach(({ cat, available }, catIdx) => {
      const sec = document.createElement('div');
      sec.className = 'ob-acc-section';

      const hdr = document.createElement('div');
      hdr.className = 'ob-acc-header';
      hdr.innerHTML =
        '<span class="ob-acc-label">' + cat.label + '</span>' +
        '<span class="ob-acc-count">' + available.length + ' available</span>' +
        '<span class="ob-acc-chevron">▶</span>';
      hdr.addEventListener('click', () => libSetOpen(libOpenIdx === catIdx ? -1 : catIdx));
      sec.appendChild(hdr);

      const body  = document.createElement('div');
      body.className = 'ob-acc-body';
      body.style.maxHeight = '0';

      const inner = document.createElement('div');
      inner.className = 'ob-acc-inner';

      available.forEach(idx => {
        const h    = DEFAULT_HABITS[idx];
        const card = document.createElement('div');
        card.className = 'lib-card';
        card.innerHTML =
          '<span class="ob-card-emoji">' + habitIconHtml(h, { size: 24 }) + '</span>' +
          '<span class="ob-card-name">' + esc(h.name) + '</span>' +
          '<span class="diff-badge ' + h.difficulty + '">' + DIFFICULTY[h.difficulty].label + '</span>' +
          '<span class="lib-card-add">›</span>';

        card.addEventListener('click', () => openHabitDetail(h, {
          context: 'library',
          onConfirm: cfg => {
            const newH = { id: uid(), emoji: h.emoji, name: h.name, difficulty: cfg.difficulty, type: cfg.type || h.type || 'build' };
            if (cfg.days)                                 newH.days           = cfg.days;
            if (typeof cfg.stepGoal === 'number')         newH.stepGoal       = cfg.stepGoal;
            else if (typeof cfg.sleepGoalHours === 'number') newH.sleepGoalHours = cfg.sleepGoalHours;
            else if (cfg.goal)                            newH.goal           = cfg.goal;
            if (cfg.startDate)                            newH.startDate      = cfg.startDate;
            habits.push(newH);
            // Pre-fill note from DEFAULT_HABITS if present
            if (h.note) habitNotes[newH.id] = h.note;
            save();
            renderHabits();
            renderLibrary();
          },
        }));
        inner.appendChild(card);
      });

      body.appendChild(inner);
      sec.appendChild(body);
      list.appendChild(sec);
    });

    // All categories start collapsed; user expands what they want.
    requestAnimationFrame(() => libSetOpen(-1));
  }

  // ── HABIT DETAIL SCREEN ───────────────────────────────────
  // opts: { context, isSelected, existingConfig, onConfirm, onRemove }
  //   context       'library' (default) | 'onboarding'
  //   isSelected    onboarding only — true if habit already in obSelected
  //   existingConfig previously saved config to pre-populate fields
  //   onConfirm(cfg) called when user taps Add / Update
  //   onRemove()     onboarding only — called when user taps Remove
  function openHabitDetail(h, opts) {
    opts = opts || {};
    const isOnboarding = opts.context === 'onboarding';
    const isSelected   = isOnboarding && (opts.isSelected || false);
    const alreadyAdded = !isOnboarding && habits.some(a => a.name === h.name);
    const measurable   = MEASURABLE_HABITS[h.name] || null;

    // Pre-populate from existing config (re-opening a selected onboarding habit)
    const ec = opts.existingConfig || {};

    // Mutable state for this screen
    let hdType  = ec.type       || h.type || 'build';
    let hdSched = ec.sched      || 'daily';
    let hdDays  = ec.days       ? [...ec.days] : [];
    let hdNdays = ec.ndays      || 3;
    let hdGoal;
    if (ec.goal) {
      hdGoal = ec.goal.value;
    } else if (measurable) {
      if (measurable.bodyweightMin) {
        const bw = parseInt(localStorage.getItem('hb_bodyweight') || '0', 10);
        hdGoal = bw > 0 ? bw : measurable.def;
      } else {
        hdGoal = Math.max(measurable.min, measurable.def);
      }
    } else {
      hdGoal = 0;
    }
    // Step-goal staging — same pattern as hdGoal, mutually exclusive
    // with the time/count stepper for canonical Daily walk.
    const hdIsStepGoal = isStepGoalHabit(h);
    let hdStepGoal;
    if (typeof ec.stepGoal === 'number') hdStepGoal = ec.stepGoal;
    else                                  hdStepGoal = HEALTHKIT_WALK_DEFAULT_THRESHOLD;
    // Sleep-goal staging (canonical "Sleep" only). Mutually exclusive
    // with both the step-goal chips above AND the time/count stepper
    // below — branching is in the render() goal-card section.
    const hdIsSleepGoal = isSleepDurationHabit(h);
    let hdSleepGoal;
    if (typeof ec.sleepGoalHours === 'number') hdSleepGoal = ec.sleepGoalHours;
    else                                        hdSleepGoal = HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
    let hdDiff  = ec.difficulty || h.difficulty;
    let hdStart = ec.startDate  || today;

    function getScheduleDays() {
      if (hdSched === 'daily')    return undefined;
      if (hdSched === 'specific') return hdDays.length ? ALL_DAYS.filter(d => hdDays.includes(d)) : undefined;
      // ndays: evenly distribute across week
      const all = ALL_DAYS, step = 7 / hdNdays, out = [];
      for (let i = 0; i < hdNdays; i++) out.push(all[Math.min(6, Math.round(i * step))]);
      return out;
    }

    function schedLabel() {
      if (hdSched === 'daily') return 'Every Day';
      if (hdSched === 'ndays') return hdNdays + 'x / week';
      if (!hdDays.length)     return 'Pick days…';
      const abbr = ['M','T','W','T','F','S','S'];
      return ALL_DAYS.filter(d => hdDays.includes(d)).map((d, _i) => abbr[ALL_DAYS.indexOf(d)]).join('');
    }

    function render() {
      const content = document.getElementById('hd-content');
      content.innerHTML = '';

      // ── Header ─────────────────────────────────────────────
      const hdr = document.createElement('div');
      hdr.className = 'hd-header';
      hdr.innerHTML =
        '<button class="hd-back-btn" id="hd-back" aria-label="Back">←</button>' +
        '<div class="hd-header-info">' +
          '<span class="hd-header-emoji">' + habitIconHtml(h, { size: 28 }) + '</span>' +
          '<span class="hd-header-name">' + esc(h.name) + '</span>' +
        '</div>';
      content.appendChild(hdr);
      document.getElementById('hd-back').addEventListener('click', closeHabitDetail);

      if (alreadyAdded) {
        const msg = document.createElement('div');
        msg.className = 'hd-already';
        msg.innerHTML = '<span class="hd-already-icon">✓</span><span>Already in your habits list</span>';
        content.appendChild(msg);
        return;
      }

      // ── Scrollable body ────────────────────────────────────
      const body = document.createElement('div');
      body.className = 'hd-body';

      // ── Section 1: Habit Type (read-only) ─────────────────
      const typeCard = hdSection('Habit Type');
      const typeBadge = document.createElement('span');
      typeBadge.className = 'hd-type-badge hd-type-badge--' + hdType;
      typeBadge.textContent = hdType === 'build' ? '⬆ Build' : '⛔ Quit';
      typeCard.appendChild(typeBadge);
      body.appendChild(typeCard);

      // ── Section 2: Schedule ────────────────────────────────
      const schedCard = hdSection('Goal Period');
      const schedOpts = document.createElement('div');
      schedOpts.className = 'hd-sched-opts';

      [['daily','Every Day'],['specific','Specific days'],['ndays','Days per week']].forEach(([id, lbl]) => {
        const row = document.createElement('div');
        row.className = 'hd-sched-opt' + (hdSched === id ? ' hd-sched-opt--active' : '');
        const dot = document.createElement('span');
        dot.className = 'hd-sched-dot';
        const txt = document.createElement('span');
        txt.textContent = lbl;
        row.append(dot, txt);
        row.addEventListener('click', e => {
          e.stopPropagation();
          if (hdSched !== id) { hdSched = id; hdDays = []; render(); }
        });
        schedOpts.appendChild(row);

        // Inline sub-controls for active option
        if (hdSched === id) {
          if (id === 'specific') {
            const daysRow = document.createElement('div');
            daysRow.className = 'hd-days-row';
            ALL_DAYS.forEach((day, di) => {
              const b = document.createElement('button');
              b.className = 'hd-day-btn' + (hdDays.includes(day) ? ' hd-day-btn--on' : '');
              b.textContent = DAY_LABELS[di];
              b.addEventListener('click', e => {
                e.stopPropagation();
                hdDays = hdDays.includes(day) ? hdDays.filter(d => d !== day) : [...hdDays, day];
                // re-render just the day btn states (minor optimisation)
                render();
              });
              daysRow.appendChild(b);
            });
            schedOpts.appendChild(daysRow);
          } else if (id === 'ndays') {
            const stepper = document.createElement('div');
            stepper.className = 'hd-stepper hd-stepper--sub';
            const dec = document.createElement('button');
            dec.className = 'hd-step-btn';
            dec.textContent = '−';
            dec.addEventListener('click', e => { e.stopPropagation(); if (hdNdays > 1) { hdNdays--; render(); } });
            const val = document.createElement('span');
            val.className = 'hd-step-val';
            val.textContent = hdNdays + 'x per week';
            const inc = document.createElement('button');
            inc.className = 'hd-step-btn';
            inc.textContent = '+';
            inc.addEventListener('click', e => { e.stopPropagation(); if (hdNdays < 7) { hdNdays++; render(); } });
            stepper.append(dec, val, inc);
            schedOpts.appendChild(stepper);
          }
        }
      });

      schedCard.appendChild(schedOpts);
      body.appendChild(schedCard);

      // ── Section 3: Goal Value ──────────────────────────────
      // Step-goal habits (canonical Daily walk) get the chip picker
      // here too — matches the post-onboarding Edit Habit modal so
      // there's no jarring difference between the two surfaces.
      if (hdIsStepGoal) {
        const goalCard = hdSection('Goal Value');
        const valueRow = document.createElement('div');
        valueRow.className = 'habit-edit-stepgoal-row';
        const valueLabel = document.createElement('span');
        valueLabel.className = 'habit-edit-stepgoal-label';
        valueLabel.textContent = 'Step goal';
        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'habit-edit-stepgoal-value';
        valueDisplay.textContent = hdStepGoal.toLocaleString() + ' steps';
        valueRow.append(valueLabel, valueDisplay);
        goalCard.appendChild(valueRow);

        const chips = document.createElement('div');
        chips.className = 'habit-edit-stepgoal-chips';
        const chipDefs = HEALTHKIT_WALK_PRESETS.map(n => ({ preset: String(n), label: n.toLocaleString() }))
          .concat([{ preset: 'custom', label: 'Custom' }]);
        chipDefs.forEach(({ preset, label }) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'habit-edit-stepgoal-chip';
          btn.dataset.preset = preset;
          btn.textContent = label;
          chips.appendChild(btn);
        });
        const setActive = () => {
          const isCustom = !HEALTHKIT_WALK_PRESETS.includes(hdStepGoal);
          chips.querySelectorAll('.habit-edit-stepgoal-chip').forEach(chip => {
            const p = chip.dataset.preset;
            const active = (p === 'custom') ? isCustom : (parseInt(p, 10) === hdStepGoal);
            chip.classList.toggle('habit-edit-stepgoal-chip--active', active);
          });
        };
        setActive();

        const customRow = document.createElement('div');
        customRow.className = 'habit-edit-stepgoal-custom hidden';
        const customInput = document.createElement('input');
        customInput.type = 'number';
        customInput.inputMode = 'numeric';
        customInput.min = HEALTHKIT_WALK_THRESHOLD_MIN;
        customInput.max = HEALTHKIT_WALK_THRESHOLD_MAX;
        customInput.placeholder = 'Enter steps (100–50,000)';
        customInput.className = 'habit-edit-stepgoal-input';
        const customSave = document.createElement('button');
        customSave.type = 'button';
        customSave.className = 'habit-edit-stepgoal-save';
        customSave.textContent = 'Save';
        const customCancel = document.createElement('button');
        customCancel.type = 'button';
        customCancel.className = 'habit-edit-stepgoal-cancel';
        customCancel.textContent = 'Cancel';
        customRow.append(customInput, customSave, customCancel);

        chips.addEventListener('click', (e) => {
          const chip = e.target.closest('.habit-edit-stepgoal-chip');
          if (!chip) return;
          const p = chip.dataset.preset;
          if (p === 'custom') {
            customRow.classList.remove('hidden');
            customInput.value = String(hdStepGoal);
            setTimeout(() => customInput.focus(), 50);
            return;
          }
          const n = parseInt(p, 10);
          if (!Number.isFinite(n)) return;
          hdStepGoal = n;
          customRow.classList.add('hidden');
          valueDisplay.textContent = hdStepGoal.toLocaleString() + ' steps';
          setActive();
        });
        const commitCustom = () => {
          const parsed = parseInt(customInput.value, 10);
          const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_WALK_DEFAULT_THRESHOLD;
          hdStepGoal = Math.max(HEALTHKIT_WALK_THRESHOLD_MIN, Math.min(HEALTHKIT_WALK_THRESHOLD_MAX, fallback));
          customRow.classList.add('hidden');
          valueDisplay.textContent = hdStepGoal.toLocaleString() + ' steps';
          setActive();
        };
        customSave.addEventListener('click', commitCustom);
        customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitCustom(); });
        customCancel.addEventListener('click', () => { customRow.classList.add('hidden'); });

        goalCard.appendChild(chips);
        goalCard.appendChild(customRow);
        body.appendChild(goalCard);
      } else if (hdIsSleepGoal) {
        // Sleep-goal chips — mirrors the step-goal block above with
        // hours instead of steps. Reuses the same .habit-edit-stepgoal-*
        // CSS classes so the visual treatment matches.
        const goalCard = hdSection('Goal Value');
        const valueRow = document.createElement('div');
        valueRow.className = 'habit-edit-stepgoal-row';
        const valueLabel = document.createElement('span');
        valueLabel.className = 'habit-edit-stepgoal-label';
        valueLabel.textContent = 'Sleep goal';
        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'habit-edit-stepgoal-value';
        const fmtSleep = (n) => n + (n === 1 ? ' hour' : ' hours');
        valueDisplay.textContent = fmtSleep(hdSleepGoal);
        valueRow.append(valueLabel, valueDisplay);
        goalCard.appendChild(valueRow);

        const chips = document.createElement('div');
        chips.className = 'habit-edit-stepgoal-chips';
        const chipDefs = HEALTHKIT_SLEEP_PRESETS.map(n => ({ preset: String(n), label: n + ' hrs' }))
          .concat([{ preset: 'custom', label: 'Custom' }]);
        chipDefs.forEach(({ preset, label }) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'habit-edit-stepgoal-chip';
          btn.dataset.preset = preset;
          btn.textContent = label;
          chips.appendChild(btn);
        });
        const setActive = () => {
          const isCustom = !HEALTHKIT_SLEEP_PRESETS.includes(hdSleepGoal);
          chips.querySelectorAll('.habit-edit-stepgoal-chip').forEach(chip => {
            const p = chip.dataset.preset;
            const active = (p === 'custom') ? isCustom : (parseFloat(p) === hdSleepGoal);
            chip.classList.toggle('habit-edit-stepgoal-chip--active', active);
          });
        };
        setActive();

        const customRow = document.createElement('div');
        customRow.className = 'habit-edit-stepgoal-custom hidden';
        const customInput = document.createElement('input');
        customInput.type = 'number';
        customInput.inputMode = 'decimal';
        customInput.min = HEALTHKIT_SLEEP_GOAL_MIN_HOURS;
        customInput.max = HEALTHKIT_SLEEP_GOAL_MAX_HOURS;
        customInput.step = 0.5;
        customInput.placeholder = 'Enter hours (3–14, 0.5 step)';
        customInput.className = 'habit-edit-stepgoal-input';
        const customSave = document.createElement('button');
        customSave.type = 'button';
        customSave.className = 'habit-edit-stepgoal-save';
        customSave.textContent = 'Save';
        const customCancel = document.createElement('button');
        customCancel.type = 'button';
        customCancel.className = 'habit-edit-stepgoal-cancel';
        customCancel.textContent = 'Cancel';
        customRow.append(customInput, customSave, customCancel);

        chips.addEventListener('click', (e) => {
          const chip = e.target.closest('.habit-edit-stepgoal-chip');
          if (!chip) return;
          const p = chip.dataset.preset;
          if (p === 'custom') {
            customRow.classList.remove('hidden');
            customInput.value = String(hdSleepGoal);
            setTimeout(() => customInput.focus(), 50);
            return;
          }
          const n = parseFloat(p);
          if (!Number.isFinite(n)) return;
          hdSleepGoal = n;
          customRow.classList.add('hidden');
          valueDisplay.textContent = fmtSleep(hdSleepGoal);
          setActive();
        });
        const commitCustom = () => {
          const parsed = parseFloat(customInput.value);
          const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
          hdSleepGoal = Math.max(HEALTHKIT_SLEEP_GOAL_MIN_HOURS, Math.min(HEALTHKIT_SLEEP_GOAL_MAX_HOURS, fallback));
          customRow.classList.add('hidden');
          valueDisplay.textContent = fmtSleep(hdSleepGoal);
          setActive();
        };
        customSave.addEventListener('click', commitCustom);
        customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitCustom(); });
        customCancel.addEventListener('click', () => { customRow.classList.add('hidden'); });

        goalCard.appendChild(chips);
        goalCard.appendChild(customRow);
        body.appendChild(goalCard);
      } else if (measurable) {
        const goalCard = hdSection('Goal Value');

        // Special bodyweight input for Protein goal
        if (measurable.bodyweightMin) {
          const bwWrap = document.createElement('div');
          bwWrap.className = 'hd-bw-wrap';
          const bwLabel = document.createElement('label');
          bwLabel.className = 'hd-bw-label';
          bwLabel.textContent = 'Your bodyweight (lbs)';
          const bwInput = document.createElement('input');
          bwInput.type = 'number';
          bwInput.className = 'hd-bw-input';
          bwInput.placeholder = 'Enter your bodyweight in lbs';
          bwInput.min = 50; bwInput.max = 500; bwInput.step = 1;
          const savedBW = localStorage.getItem('hb_bodyweight');
          if (savedBW) bwInput.value = savedBW;
          bwInput.addEventListener('input', () => {
            const bw = parseInt(bwInput.value, 10);
            if (bw > 0) {
              localStorage.setItem('hb_bodyweight', String(bw));
              if (hdGoal < bw) { hdGoal = bw; render(); }
            }
          });
          bwWrap.append(bwLabel, bwInput);
          goalCard.appendChild(bwWrap);
        }

        const stepper = document.createElement('div');
        stepper.className = 'hd-stepper';
        const dec = document.createElement('button');
        dec.className = 'hd-step-btn';
        dec.textContent = '−';
        dec.addEventListener('click', () => {
          const floor = measurable.bodyweightMin
            ? Math.max(measurable.step, parseInt(localStorage.getItem('hb_bodyweight') || '0', 10))
            : measurable.min;
          if (hdGoal - measurable.step >= Math.max(measurable.step, floor)) {
            hdGoal -= measurable.step; render();
          }
        });
        const val = document.createElement('span');
        val.className = 'hd-step-val';
        val.textContent = hdGoal.toLocaleString() + ' ' + measurable.unit + ' / day';
        const inc = document.createElement('button');
        inc.className = 'hd-step-btn';
        inc.textContent = '+';
        inc.addEventListener('click', () => { hdGoal += measurable.step; render(); });
        stepper.append(dec, val, inc);
        goalCard.appendChild(stepper);
        body.appendChild(goalCard);
      }

      // ── Section 4: Difficulty (read-only) ─────────────────
      const diffCard = hdSection('Difficulty');
      const diffRow  = document.createElement('div');
      diffRow.className = 'hd-diff-row';
      const badge = document.createElement('span');
      badge.className = 'diff-badge ' + hdDiff;
      badge.textContent = DIFFICULTY[hdDiff].label;
      const xpNote = document.createElement('div');
      xpNote.className = 'hd-xp-note';
      xpNote.innerHTML = iconify('⚡ +' + DIFFICULTY[hdDiff].pts + ' XP per completion', { size: 14 });
      diffRow.appendChild(badge);
      diffCard.append(diffRow, xpNote);
      body.appendChild(diffCard);

      // ── Section 5: Start Date ──────────────────────────────
      const dateCard = hdSection('Start Date');
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.className = 'hd-date-input';
      dateInput.value = hdStart;
      dateInput.addEventListener('change', () => { hdStart = dateInput.value || today; });
      dateCard.appendChild(dateInput);
      body.appendChild(dateCard);

      content.appendChild(body);

      // ── Footer: Add / Update button ───────────────────────
      const footer = document.createElement('div');
      footer.className = 'hd-footer';
      const addBtn = document.createElement('button');
      addBtn.className = 'hd-add-btn';
      addBtn.textContent = (isOnboarding || !isSelected) ? 'Add to My Habits' : 'Update Habit';
      addBtn.addEventListener('click', () => {
        const days = getScheduleDays();
        const cfg  = {
          type:       hdType,
          sched:      hdSched,
          ndays:      hdNdays,
          difficulty: hdDiff,
          days:       days || undefined,
          // Goal — mutually exclusive between three branches:
          //   step-goal habits carry stepGoal (Daily walk)
          //   sleep-goal habits carry sleepGoalHours (Sleep)
          //   measurable habits carry the legacy goal{value,unit} shape
          goal:           (!hdIsStepGoal && !hdIsSleepGoal && measurable) ? { value: hdGoal, unit: measurable.unit } : undefined,
          stepGoal:       hdIsStepGoal  ? hdStepGoal  : undefined,
          sleepGoalHours: hdIsSleepGoal ? hdSleepGoal : undefined,
          startDate:  hdStart !== today ? hdStart : undefined,
        };
        if (opts.onConfirm) {
          opts.onConfirm(cfg);
        } else {
          // Default (library) behaviour
          const newH = { id: uid(), emoji: h.emoji, name: h.name, difficulty: hdDiff, type: hdType };
          if (days)              newH.days           = days;
          if (hdIsStepGoal)      newH.stepGoal       = hdStepGoal;
          else if (hdIsSleepGoal) newH.sleepGoalHours = hdSleepGoal;
          else if (measurable)   newH.goal           = { value: hdGoal, unit: measurable.unit };
          if (hdStart !== today) newH.startDate      = hdStart;
          habits.push(newH);
          save();
          renderHabits();
          renderLibrary();
        }
        closeHabitDetail();
      });
      footer.appendChild(addBtn);

      // Remove button — shown when re-configuring an already-selected onboarding habit
      if (isSelected && opts.onRemove) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'hd-remove-btn';
        removeBtn.textContent = 'Remove from list';
        removeBtn.addEventListener('click', () => {
          opts.onRemove();
          closeHabitDetail();
        });
        footer.appendChild(removeBtn);
      }

      content.appendChild(footer);
    }

    render();
    document.getElementById('hd-sheet').classList.remove('hidden');
  }

  function closeHabitDetail() {
    document.getElementById('hd-sheet').classList.add('hidden');
    document.getElementById('hd-content').innerHTML = '';
  }

  function setupHabitDetailGesture() {
    if (typeof attachSheetDismissGesture !== 'function') return;
    const sheet = document.getElementById('hd-sheet');
    if (!sheet) return;
    attachSheetDismissGesture(sheet, null, closeHabitDetail, {
      baseTransform:  'translateX(-50%) ',
      handleSelector: '.hd-drag-handle',
      scrollTarget:   '#hd-content',
    });
  }

  // Creates a labelled section card for the detail screen
  function hdSection(label) {
    const sec = document.createElement('div');
    sec.className = 'hd-section';
    const lbl = document.createElement('div');
    lbl.className = 'hd-section-label';
    lbl.textContent = label;
    sec.appendChild(lbl);
    return sec;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── DIFFICULTY SELECTOR HELPER ────────────────────────────
  function setActiveDiff(rowId, diff) {
    document.getElementById(rowId).querySelectorAll('.diff-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.diff === diff);
    });
  }

  function setActiveDays(rowId, days) {
    document.getElementById(rowId).querySelectorAll('.day-btn').forEach(b => {
      b.classList.toggle('active', days.includes(b.dataset.day));
    });
  }

  // ── LONG PRESS ────────────────────────────────────────────
  function bindLongPress(el, id) {
    let timer = null, moved = false, sx, sy;

    el.addEventListener('touchstart', e => {
      if (e.target.closest('[data-drag]')) return;
      moved = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      el.classList.add('pressing');
      timer = setTimeout(() => {
        if (!moved) {
          navigator.vibrate && navigator.vibrate(32);
          document.getElementById('habit-list').classList.add('reorder-mode');
          showCtxMenu(id, el);
        }
      }, 480);
    }, { passive: true });

    el.addEventListener('touchmove', e => {
      if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 8) {
        moved = true; clearTimeout(timer); el.classList.remove('pressing');
      }
    }, { passive: true });

    el.addEventListener('touchend',   () => { clearTimeout(timer); el.classList.remove('pressing'); });
    el.addEventListener('touchcancel',() => { clearTimeout(timer); el.classList.remove('pressing'); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(id, el); });
  }

  // ── SCHEDULE PICKER ──────────────────────────────────────
  const SCHED_PRESETS = {
    daily:    [...ALL_DAYS],
    weekdays: ['Mon','Tue','Wed','Thu','Fri'],
    weekends: ['Fri','Sat','Sun'],
    '3x':     ['Mon','Wed','Fri'],
  };

  function openSchedulePicker(id) {
    schedHabitId = id;
    const habit = habits.find(h => h.id === id);
    schedFormDays = habit?.days ? [...habit.days] : [...ALL_DAYS];
    setActiveDays('sched-days-row', schedFormDays);
    syncSchedPresets();
    refreshSchedReminderUI();
    document.getElementById('sched-overlay').classList.remove('hidden');
    document.getElementById('sched-sheet').classList.remove('hidden');
  }

  // Sync the Reminder row in the Schedule sheet to the habit's current
  // per-habit reminder state. Called on open + after change/clear.
  function refreshSchedReminderUI() {
    const btn   = document.getElementById('sched-reminder-btn');
    const clear = document.getElementById('sched-reminder-clear');
    if (!btn || !clear || !schedHabitId) return;
    let time = null;
    try { time = (Notif.reminderFor && Notif.reminderFor(schedHabitId)) || null; } catch (_) {}
    if (time) {
      const [hStr, mStr] = time.split(':');
      const h  = parseInt(hStr, 10) || 0;
      const m  = parseInt(mStr, 10) || 0;
      const pm = h >= 12;
      const h12 = ((h % 12) || 12);
      const label = h12 + ':' + String(m).padStart(2, '0') + ' ' + (pm ? 'PM' : 'AM');
      btn.textContent  = '⏰ ' + label;
      btn.classList.add('sched-reminder-btn--set');
      clear.classList.remove('hidden');
    } else {
      btn.textContent  = '+ Add reminder';
      btn.classList.remove('sched-reminder-btn--set');
      clear.classList.add('hidden');
    }
  }

  function closeSchedulePicker() {
    document.getElementById('sched-overlay').classList.add('hidden');
    document.getElementById('sched-sheet').classList.add('hidden');
    schedHabitId = null;
  }

  function syncSchedPresets() {
    document.querySelectorAll('.sched-preset').forEach(btn => {
      const preset = SCHED_PRESETS[btn.dataset.preset];
      const match  = preset.length === schedFormDays.length && preset.every(d => schedFormDays.includes(d));
      btn.classList.toggle('active', match);
    });
  }

  function setupSchedulePicker() {
    document.getElementById('sched-overlay').addEventListener('click', closeSchedulePicker);
    document.getElementById('sched-cancel-btn').addEventListener('click', closeSchedulePicker);

    // Swipe-down-to-dismiss
    if (typeof attachSheetDismissGesture === 'function') {
      const ss = document.getElementById('sched-sheet');
      const so = document.getElementById('sched-overlay');
      attachSheetDismissGesture(ss, so, closeSchedulePicker, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.sched-drag-handle, .sched-header',
      });
    }

    document.getElementById('sched-save-btn').addEventListener('click', () => {
      const habit = habits.find(h => h.id === schedHabitId);
      if (habit) {
        if (schedFormDays.length === 7) delete habit.days;
        else habit.days = [...schedFormDays];
        save();
        renderHabits();
      }
      closeSchedulePicker();
    });

    document.getElementById('sched-days-row').querySelectorAll('.day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        schedFormDays = [...document.getElementById('sched-days-row').querySelectorAll('.day-btn.active')].map(b => b.dataset.day);
        if (schedFormDays.length === 0) { btn.classList.add('active'); schedFormDays = [btn.dataset.day]; }
        syncSchedPresets();
      });
    });

    document.querySelectorAll('.sched-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        schedFormDays = [...SCHED_PRESETS[btn.dataset.preset]];
        setActiveDays('sched-days-row', schedFormDays);
        syncSchedPresets();
      });
    });

    // Per-habit reminder controls. The button opens the same custom
    // hour + 15-min minute picker used by Settings. The Remove button
    // clears the reminder and is hidden when none is set.
    const remBtn   = document.getElementById('sched-reminder-btn');
    const remClear = document.getElementById('sched-reminder-clear');
    if (remBtn) {
      remBtn.addEventListener('click', () => {
        if (!schedHabitId) return;
        const habit = habits.find(h => h.id === schedHabitId);
        const current = (Notif.reminderFor && Notif.reminderFor(schedHabitId))
          || (typeof defaultReminderTimeFor === 'function' ? defaultReminderTimeFor(habit) : '07:00');
        openDigestTimePickerModal(current, async (newT) => {
          try { await Notif.setReminder(schedHabitId, newT); } catch (_) {}
          refreshSchedReminderUI();
          if (typeof refreshRemindersPanel === 'function') refreshRemindersPanel();
        });
      });
    }
    if (remClear) {
      remClear.addEventListener('click', async () => {
        if (!schedHabitId) return;
        try { await Notif.clearReminder(schedHabitId); } catch (_) {}
        refreshSchedReminderUI();
        if (typeof refreshRemindersPanel === 'function') refreshRemindersPanel();
      });
    }
  }

  // ── CONTEXT MENU ─────────────────────────────────────────
  function showCtxMenu(id, el) {
    ctxHabitId = id;
    const menu = document.getElementById('ctx-menu');
    const overlay = document.getElementById('ctx-overlay');
    // View Note is now the full habit detail sheet (stats + editable note),
    // so always show it regardless of whether a note has been written yet.
    const ctxNoteBtn = document.getElementById('ctx-note');
    ctxNoteBtn.classList.remove('hidden');
    document.getElementById('ctx-note-label').textContent = 'View Note';
    menu.classList.remove('hidden');
    overlay.classList.remove('hidden');
    const rect = el.getBoundingClientRect();
    const mw = 210;
    let left = rect.right - mw, top = rect.bottom + 6;
    if (left < 8) left = 8;
    if (top + 160 > window.innerHeight - 20) top = rect.top - 166;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top  = Math.max(8, top)  + 'px';
  }

  function hideCtxMenu() {
    document.getElementById('ctx-menu').classList.add('hidden');
    document.getElementById('ctx-overlay').classList.add('hidden');
    ctxHabitId = null;
  }

  function setupCtxMenu() {
    document.getElementById('ctx-overlay').addEventListener('click', hideCtxMenu);
    document.getElementById('ctx-overlay').addEventListener('touchstart', hideCtxMenu, { passive: true });
    document.getElementById('ctx-edit').addEventListener('click', () => { const id = ctxHabitId; hideCtxMenu(); openEditModal(id); });
    document.getElementById('ctx-note').addEventListener('click', () => { const id = ctxHabitId; hideCtxMenu(); openNoteModal(id); });
    document.getElementById('ctx-schedule').addEventListener('click', () => { const id = ctxHabitId; hideCtxMenu(); openSchedulePicker(id); });
    document.getElementById('ctx-delete').addEventListener('click', () => { const id = ctxHabitId; hideCtxMenu(); deleteHabit(id); });
  }

  // ── COMPOUND EFFECT BONUS ─────────────────────────────────
  let compoundPopupTimer = null;

  // v2.0.1 compound bonus rewrite. Per-day curve with milestone
  // spikes at days 7/14/30/90/180/365. Locked-In is a 1.5× variant
  // of Morning Routine — same shape, bigger numbers (the Locked-In
  // pack is 16 habits vs MR's 10, harder to maintain, deserves more).
  // The new rank thresholds (S = 70,000 XP) are calibrated for THIS
  // curve — the previous coarse 6-tier function (5/10/20/30/50/75)
  // was nowhere near enough to support a 6-month-to-S progression.
  //
  // Pattern: days 1-6 ramp linearly, then steady-state with milestone
  // spikes at 7/14/30/90/180/365. After day 90 the steady-state drops
  // back below the milestone (200<300, 250<500, 300<1000) so milestones
  // feel like genuine spikes rather than permanent step-ups.
  function getCompoundXP(packId, streak) {
    if (typeof streak !== 'number' || streak <= 0) return 0;

    if (packId === 'morning') {
      // Days 1-6: linear ramp 5 → 30 (5×streakDay)
      if (streak <= 6) return streak * 5;
      // Day 7 milestone + steady-state through day 13 (both 50)
      if (streak <= 13) return 50;
      // Day 14 milestone + steady-state through day 29 (both 75)
      if (streak <= 29) return 75;
      // Day 30 milestone + steady-state through day 89 (both 150)
      if (streak <= 89) return 150;
      // Day 90 spike, then drop to higher steady-state
      if (streak === 90) return 300;
      if (streak <= 179) return 200;
      // 6-month spike
      if (streak === 180) return 500;
      if (streak <= 364) return 250;
      // 1-year spike
      if (streak === 365) return 1000;
      return 300; // year+ steady-state
    }

    if (packId === 'locked-in') {
      // 1.5× Morning Routine values (rounded as spec'd)
      if (streak <= 6) {
        const ramp = [0, 8, 15, 23, 30, 38, 45];
        return ramp[streak];
      }
      if (streak <= 13) return 75;
      if (streak <= 29) return 112;
      if (streak <= 89) return 225;
      if (streak === 90) return 450;
      if (streak <= 179) return 300;
      if (streak === 180) return 750;
      if (streak <= 364) return 375;
      if (streak === 365) return 1500;
      return 450;
    }

    return 0;
  }

  function getCompoundMotivation(streak) {
    if (streak >= 366) return 'You are the Compound Effect personified.';
    if (streak === 365) return 'One full year. You have fully awakened.';
    if (streak === 180) return 'Six months. You are not the same person who started.';
    if (streak === 90)  return 'Ninety days. Science says this change is now permanent.';
    if (streak === 30)  return 'Thirty days. This is no longer a habit. This is your identity.';
    if (streak === 14)  return 'Two weeks strong. This is becoming who you are.';
    if (streak === 7)   return 'One week of excellence. Your brain is rewiring.';
    return 'The compound effect has begun.';
  }

  function getPackHabitNames(packId) {
    const pack = PACKS.find(p => p.id === packId);
    if (!pack || !pack.habits || !pack.habits.length) return [];
    return pack.habits.map(i => DEFAULT_HABITS[i].name);
  }

  function getPackProgress(packId) {
    const names = getPackHabitNames(packId);
    const owned = names.filter(n => {
      const h = habits.find(hh => hh.name === n);
      return h && isScheduledToday(h);
    });
    const done = owned.filter(n => {
      const h = habits.find(hh => hh.name === n);
      return h && isChecked(h.id);
    });
    return { done: done.length, total: owned.length };
  }

  function getHabitCompoundPackIds(habitName) {
    return BONUS_PACK_IDS.filter(pid =>
      getPackHabitNames(pid).includes(habitName)
    );
  }

  // Backward-compat wrapper used elsewhere (nudge logic, etc.)
  function userHasAllCanonicalMorning() {
    return userHasAllPackHabits('morning');
  }

  // Bonus-popup queue — guarantees Locked-In's modal never overlaps the
  // Compound Effect modal. Items are { packId, newStreak, finalXP, doubled }.
  let _bonusPopupQueue  = [];
  let _bonusPopupActive = false;

  function checkCompoundEffect(habitId) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;
    // Walk every bonus-eligible pack in fire-order. Each is independently
    // gated by composition + completion. Packs both can fire on the same
    // tick — the modal queue sequences their celebration popups.
    BONUS_PACK_IDS.forEach(packId => {
      if (!isHabitInPack(habit, packId)) return;
      if (compoundAwarded[packId] === today) return;
      if (!userHasAllPackHabits(packId)) return;
      const { done, total } = getPackProgress(packId);
      if (total === 0 || done < total) return;
      awardCompoundEffect(packId);
    });
  }

  function awardCompoundEffect(packId) {
    const cs        = compoundStreaks[packId] || { streak: 0, lastDate: null };
    const yesterday = prevDay(today);
    const newStreak = cs.lastDate === yesterday ? cs.streak + 1 : 1;

    compoundStreaks[packId]  = { streak: newStreak, lastDate: today };
    compoundAwarded[packId]  = today;

    const baseXP  = getCompoundXP(packId, newStreak);
    const finalXP = isWeekend() ? baseXP * 2 : baseXP;
    totalPoints  += finalXP;

    save();
    renderRank();
    if (currentTab === 'profile') renderProfile();
    renderCompoundProgress();

    // ── Streak Shield: earn one for every 14-day milestone (max 3) ────
    tryEarnShield(packId, newStreak);

    // ── Personal Records hooks for pack streaks + lifetime XP ─────
    prUpdate('total_xp_lifetime', getPR('total_xp_lifetime').value + finalXP);
    if (packId === 'morning')   prUpdate('longest_mr_streak', newStreak);
    if (packId === 'locked-in') prUpdate('longest_li_streak', newStreak);

    // Queue instead of show-now so multiple packs sequence cleanly.
    _bonusPopupQueue.push({
      packId,
      newStreak,
      finalXP,
      doubled: isWeekend() && finalXP !== baseXP,
    });
    drainBonusPopupQueue();
  }

  function drainBonusPopupQueue() {
    if (_bonusPopupActive || !_bonusPopupQueue.length) return;
    const item = _bonusPopupQueue.shift();
    _bonusPopupActive = true;
    showCompoundPopup(item.packId, item.newStreak, item.finalXP, item.doubled);
  }

  function showCompoundPopup(packId, streak, xp, doubled) {
    const pack = getPackById(packId);
    if (!pack) { _bonusPopupActive = false; return; }
    const isLockedIn = packId === 'locked-in';

    // Pack-specific copy
    const labelEl = document.getElementById('cp-label');
    if (labelEl) labelEl.innerHTML = iconify(pack.bonusLabel || '⚡ COMPOUND EFFECT BONUS', { size: 22 });
    document.getElementById('cp-pack-msg').textContent =
      isLockedIn
        ? 'All 16 habits complete. You owned the day.'
        : 'All ' + pack.name + ' habits complete!';
    document.getElementById('cp-xp').textContent     = '+' + xp + ' XP' + (doubled ? ' 2×' : '');
    document.getElementById('cp-streak').innerHTML = streakify('Day ' + streak + ' in a row 🔥', 18);
    document.getElementById('cp-motivation').textContent = getCompoundMotivation(streak);

    const el = document.getElementById('compound-popup');
    // Theme the popup per pack (gold for MR, violet for Locked-In).
    el.classList.remove('cp--morning', 'cp--lockedin');
    el.classList.add(isLockedIn ? 'cp--lockedin' : 'cp--morning');

    el.classList.remove('hidden', 'cp-hide');
    void el.offsetWidth; // force reflow so animation replays
    el.classList.add('cp-show');
    // Pack-specific fanfare. Locked-In gets an extended flourish
    // because it's the bigger achievement.
    if (isLockedIn && typeof playFanfareLockedIn === 'function') {
      playFanfareLockedIn();
    } else {
      playFanfare();
    }
    if (compoundPopupTimer) clearTimeout(compoundPopupTimer);
    compoundPopupTimer = setTimeout(hideCompoundPopup, 3000);
  }

  function hideCompoundPopup() {
    const el = document.getElementById('compound-popup');
    el.classList.remove('cp-show');
    el.classList.add('cp-hide');
    el.addEventListener('animationend', () => {
      el.classList.remove('cp-hide');
      el.classList.add('hidden');
      // Now drain any queued bonuses (e.g., Locked-In after MR).
      _bonusPopupActive = false;
      // Small delay for breathing room between celebrations
      setTimeout(drainBonusPopupQueue, 320);
    }, { once: true });
    if (compoundPopupTimer) { clearTimeout(compoundPopupTimer); compoundPopupTimer = null; }
  }

  function setupCompoundPopup() {
    document.getElementById('compound-popup').addEventListener('click', hideCompoundPopup);
    // Delegated tap on a pack progress row → opens the Add Pack modal
    // for the matching pack so users can fill in the missing habits.
    // The ⚡ bolt and 🌙/🛡️ chips inside the row stop propagation via
    // their own handlers, so chip-tap doesn't trigger this row click.
    document.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      // Honest Day chip
      const honest = t.closest('[data-honest-pack]');
      if (honest) {
        e.preventDefault();
        e.stopPropagation();
        openHonestDayModal(honest.getAttribute('data-honest-pack'));
        return;
      }
      // Shield info chip
      const shield = t.closest('[data-shield-info]');
      if (shield) {
        e.preventDefault();
        e.stopPropagation();
        openShieldInfoModal();
        return;
      }
      // Skip if the bolt was tapped (its handler runs first)
      if (t.closest('[data-bonus-info]')) return;
      const row = t.closest('[data-pack-add]');
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      const packId = row.getAttribute('data-pack-add');
      if (packId === 'morning')   openMorningPackModal();
      else if (packId === 'locked-in') openLockedInPackModal();
    });
  }

  // ── ORIGIN STORY popup — renders both chapters ──────────
  function openOriginStorySheet() {
    if (!originBeginning || !originBeginning.text) return;
    const ov    = document.getElementById('origin-overlay');
    const sheet = document.getElementById('origin-sheet');
    if (!ov || !sheet) return;

    // ── Chapter 1: The Beginning ─────────────────────────
    const ch1Label = document.getElementById('origin-ch1-label');
    const ch1Text  = document.getElementById('origin-ch1-text');
    if (ch1Label) ch1Label.textContent = '📜 THE BEGINNING · ' + _shortDate(originBeginning.dateISO);
    if (ch1Text)  ch1Text.textContent  = originBeginning.text;

    // ── Chapter 2: The Awakening (or teaser) ─────────────
    const haveCh2  = !!(originAwakening && originAwakening.text);
    const ch2Label = document.getElementById('origin-ch2-label');
    const ch2Text  = document.getElementById('origin-ch2-text');
    const ch2Since = document.getElementById('origin-since');
    const ch2Badge = document.getElementById('origin-class-badge');
    const ch2Teaser= document.getElementById('origin-ch2-teaser');
    const divider  = document.getElementById('origin-divider');

    if (haveCh2) {
      const cls = CLASSES[originAwakening.classKey] || CLASSES.SAGE;
      if (ch2Label) ch2Label.textContent = '⚔️ THE AWAKENING · ' + _shortDate(originAwakening.dateISO);
      if (ch2Badge) {
        ch2Badge.style.color       = cls.color;
        ch2Badge.style.borderColor = cls.color + '60';
        ch2Badge.style.background  = cls.color + '14';
        // Class emblem + name — Chapter 2 badge in the Origin sheet.
        const _ch2Key = (originAwakening && originAwakening.classKey) || null;
        ch2Badge.innerHTML = classIconHtml(_ch2Key, { size: 18 }) + '<span>' + esc(cls.name) + '</span>';
        ch2Badge.classList.remove('hidden');
      }
      if (ch2Text)  { ch2Text.textContent  = originAwakening.text; ch2Text.classList.remove('hidden'); }
      if (ch2Since) { ch2Since.textContent = cls.name + ' since ' + originAwakening.dateDisplay; ch2Since.classList.remove('hidden'); }
      if (ch2Teaser) ch2Teaser.classList.add('hidden');
      if (divider)   divider.classList.remove('hidden');
      sheet.style.setProperty('--origin-accent', cls.color);
    } else {
      // Civilian — show Chapter 2 placeholder + teaser
      if (ch2Label && ch2Label.textContent !== '⚔️ THE AWAKENING') ch2Label.textContent = '⚔️ THE AWAKENING';
      if (ch2Badge) ch2Badge.classList.add('hidden');
      if (ch2Text)  ch2Text.classList.add('hidden');
      if (ch2Since) ch2Since.classList.add('hidden');
      if (ch2Teaser) ch2Teaser.classList.remove('hidden');
      if (divider)   divider.classList.remove('hidden');
      sheet.style.setProperty('--origin-accent', '#8b5cf6');
    }

    ov.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }
  function closeOriginStorySheet() {
    document.getElementById('origin-overlay').classList.add('hidden');
    document.getElementById('origin-sheet').classList.add('hidden');
  }
  function shareOriginStory() {
    if (!originBeginning || !originBeginning.text) return;
    let text = '📜 My Origin:\n\n' + originBeginning.text;
    if (originAwakening && originAwakening.text) {
      text += '\n\n⚔️\n\n' + originAwakening.text;
    }
    text += '\n\n— Awakened: Habit RPG';
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
      return;
    }
    try {
      navigator.clipboard.writeText(text).then(() => {
        if (typeof showHabitToast === 'function') showHabitToast('Copied to clipboard');
      });
    } catch (_) {
      if (typeof showHabitToast === 'function') showHabitToast('Sharing not supported on this device');
    }
  }
  function setupOriginStorySheet() {
    const ov    = document.getElementById('origin-overlay');
    const sheet = document.getElementById('origin-sheet');
    const close = document.getElementById('origin-close');
    const share = document.getElementById('origin-share');
    if (!ov || !sheet) return;
    if (close) close.addEventListener('click', closeOriginStorySheet);
    if (ov)    ov.addEventListener('click', closeOriginStorySheet);
    if (share) share.addEventListener('click', shareOriginStory);
    // Delegated click — Status tab "Your Origin" button
    document.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const btn = t.closest('#sc-origin-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      openOriginStorySheet();
    });
    // Swipe-down dismiss
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, ov, () => {
        sheet.classList.add('hidden');
        ov.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.origin-drag-handle, .origin-header',
        scrollTarget:   '.origin-body',
      });
    }
    // ESC dismiss
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) closeOriginStorySheet();
    });
  }

  // ── HONEST DAY modal ─────────────────────────────────────
  let _honestPackPending = null;
  function openHonestDayModal(packId) {
    if (!canMarkHonestDayToday(packId)) return;
    _honestPackPending = packId;
    const pack = getPackById(packId);
    const packName = pack ? pack.name : packId;
    const remainingThisMonth = 1 - getHonestDayUsesThisMonth(packId); // always 1 when canMark is true
    document.getElementById('hm-body').innerHTML =
      "You'll skip <b>" + esc(packName) + "</b> today without breaking your streak. " +
      "Honest about what happened. <b>" + remainingThisMonth + "</b> use" +
      (remainingThisMonth === 1 ? '' : 's') + " left this month.";
    document.getElementById('honest-overlay').classList.remove('hidden');
    document.getElementById('honest-modal').classList.remove('hidden');
  }
  function closeHonestDayModal() {
    document.getElementById('honest-overlay').classList.add('hidden');
    document.getElementById('honest-modal').classList.add('hidden');
    _honestPackPending = null;
  }
  function confirmHonestDay() {
    if (!_honestPackPending) { closeHonestDayModal(); return; }
    const ok = markTodayAsHonestDay(_honestPackPending);
    closeHonestDayModal();
    if (ok && typeof showHabitToast === 'function') {
      showHabitToast('🌙 Honest Rest day marked. Your streak is held.');
    }
    if (currentTab === 'habits')   renderCompoundProgress();
    if (currentTab === 'profile')  renderProfile();
  }
  function setupHonestDayModal() {
    const cancel = document.getElementById('hm-cancel');
    const confirm = document.getElementById('hm-confirm');
    const overlay = document.getElementById('honest-overlay');
    if (cancel)  cancel.addEventListener('click', closeHonestDayModal);
    if (confirm) confirm.addEventListener('click', confirmHonestDay);
    if (overlay) overlay.addEventListener('click', closeHonestDayModal);
  }

  // ── SHIELD INFO modal ────────────────────────────────────
  function openShieldInfoModal() {
    document.getElementById('shield-overlay').classList.remove('hidden');
    document.getElementById('shield-modal').classList.remove('hidden');
  }
  function closeShieldInfoModal() {
    document.getElementById('shield-overlay').classList.add('hidden');
    document.getElementById('shield-modal').classList.add('hidden');
  }
  function setupShieldInfoModal() {
    const close = document.getElementById('sm-close');
    const ok    = document.getElementById('sm-ok');
    const ov    = document.getElementById('shield-overlay');
    if (close) close.addEventListener('click', closeShieldInfoModal);
    if (ok)    ok.addEventListener('click', closeShieldInfoModal);
    if (ov)    ov.addEventListener('click', closeShieldInfoModal);
  }

  // ── BONUS INFO POPUP ─────────────────────────────────────
  // Tapping the ⚡ on any pack progress row opens this popup. It explains
  // the Compound Effect XP tier formula AND the ROI rationale for both
  // Morning Routine and Locked-In packs.
  function openBonusInfoPopup() {
    const ov = document.getElementById('bonus-info-overlay');
    const md = document.getElementById('bonus-info-modal');
    if (!ov || !md) return;
    // Populate live shield + honest-day counts so users see their current state
    const shieldEl = document.getElementById('bi-shield-counts');
    if (shieldEl) {
      const mr = streakShields['morning']   || 0;
      const li = streakShields['locked-in'] || 0;
      shieldEl.innerHTML =
        '<span class="bi-stat-pill">🌅 ' + mr + '/3</span>' +
        '<span class="bi-stat-pill">🔒 ' + li + '/3</span>';
    }
    const honestEl = document.getElementById('bi-honest-counts');
    if (honestEl) {
      const mrUsed = getHonestDayUsesThisMonth('morning');
      const liUsed = getHonestDayUsesThisMonth('locked-in');
      const monthLabel = (function() {
        try { return new Date(today + 'T12:00:00').toLocaleDateString('en-US', { month: 'long' }); }
        catch (_) { return 'this month'; }
      })();
      honestEl.innerHTML =
        '<span class="bi-stat-pill">🌅 ' + (mrUsed ? 'used' : 'available') + '</span>' +
        '<span class="bi-stat-pill">🔒 ' + (liUsed ? 'used' : 'available') + '</span>' +
        '<span class="bi-stat-pill bi-stat-pill--quiet">' + monthLabel + '</span>';
    }
    ov.classList.remove('hidden');
    md.classList.remove('hidden');
  }
  function closeBonusInfoPopup() {
    const ov = document.getElementById('bonus-info-overlay');
    const md = document.getElementById('bonus-info-modal');
    if (!ov || !md) return;
    ov.classList.add('hidden');
    md.classList.add('hidden');
  }
  // ── PERSONAL RECORDS — detail popup, celebrations, queue ───
  function _prMetaSummary(prId, meta) {
    if (!meta) return '';
    if (prId === 'longest_habit_streak' && meta.habitName) return meta.habitName;
    if (prId === 'longest_stat_streak'  && meta.statId)    {
      const stat = STATS.find(s => s.id === meta.statId);
      return stat ? stat.icon + ' ' + stat.name : meta.statId;
    }
    return '';
  }

  function _prBeatHint(prId, value) {
    if (prId === 'highest_rank') {
      const idx = RANKS.findIndex(r => r.id === value);
      const next = (idx >= 0 && idx < RANKS.length - 1) ? RANKS[idx + 1].id : null;
      return next ? 'Reach ' + next + ' rank to break this.' : 'Max rank achieved — nothing left to beat.';
    }
    const v = Number(value) || 0;
    return 'Beat: ' + (v + 1).toLocaleString();
  }

  function openPRDetailSheet(prId) {
    const def = getPRDef(prId);
    if (!def) return;
    const rec   = personalRecords[prId] || { value: 0, meta: null, lastUpdated: null };
    const accent = _prTileAccent(def);
    const sheet = document.getElementById('pr-detail-sheet');
    const ov    = document.getElementById('pr-detail-overlay');
    if (!sheet || !ov) return;

    sheet.style.setProperty('--pr-accent', accent);
    document.getElementById('pr-detail-icon').textContent  = def.icon;
    document.getElementById('pr-detail-title').textContent = def.description;
    document.getElementById('pr-detail-value').textContent = _formatPRValue(prId, rec.value);
    const metaSummary = _prMetaSummary(prId, rec.meta);
    document.getElementById('pr-detail-meta').textContent = metaSummary
      ? metaSummary + (rec.lastUpdated ? '  ·  set ' + rec.lastUpdated : '')
      : (rec.lastUpdated ? 'Set ' + rec.lastUpdated : 'Not yet set');
    document.getElementById('pr-detail-desc').textContent       = '';
    document.getElementById('pr-detail-motivation').textContent = def.motivation;
    document.getElementById('pr-detail-beat').textContent       = _prBeatHint(prId, rec.value);

    ov.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }

  function closePRDetailSheet() {
    document.getElementById('pr-detail-overlay').classList.add('hidden');
    document.getElementById('pr-detail-sheet').classList.add('hidden');
  }

  // ── ALL-PR SHEET — opens from the Status tab button ───────
  function openPRAllSheet() {
    const ov    = document.getElementById('pr-all-overlay');
    const sheet = document.getElementById('pr-all-sheet');
    const grid  = document.getElementById('pr-all-grid');
    if (!ov || !sheet || !grid) return;
    grid.innerHTML = buildAllPRTilesHTML();
    ov.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }
  function closePRAllSheet() {
    document.getElementById('pr-all-overlay').classList.add('hidden');
    document.getElementById('pr-all-sheet').classList.add('hidden');
  }

  function setupPRDetailSheet() {
    const ov     = document.getElementById('pr-detail-overlay');
    const sheet  = document.getElementById('pr-detail-sheet');
    const close  = document.getElementById('pr-detail-close');
    const allOv    = document.getElementById('pr-all-overlay');
    const allSheet = document.getElementById('pr-all-sheet');
    const allClose = document.getElementById('pr-all-close');

    if (ov)    ov.addEventListener('click', closePRDetailSheet);
    if (close) close.addEventListener('click', closePRDetailSheet);
    if (allOv)    allOv.addEventListener('click', closePRAllSheet);
    if (allClose) allClose.addEventListener('click', closePRAllSheet);

    // Delegated taps:
    //   - #pr-open-btn (Status-tab button) → opens the All-PRs grid sheet
    //   - any [data-pr-id] tile → opens the per-PR detail sheet
    document.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const opener = t.closest('#pr-open-btn');
      if (opener) {
        e.stopPropagation();
        e.preventDefault();
        openPRAllSheet();
        return;
      }
      const tile = t.closest('[data-pr-id]');
      if (!tile) return;
      e.stopPropagation();
      e.preventDefault();
      const prId = tile.getAttribute('data-pr-id');
      // STACK the detail sheet on top of the All-PRs sheet (don't close
      // the parent). Closing the detail then leaves the user on the
      // All-PRs grid, which is what they expect when navigating back.
      openPRDetailSheet(prId);
    });

    // Swipe-down dismiss for both sheets
    if (sheet && ov && typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, ov, () => {
        sheet.classList.add('hidden');
        ov.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.pr-drag-handle, .pr-detail-header',
        scrollTarget:   '.pr-detail-body',
      });
    }
    if (allSheet && allOv && typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(allSheet, allOv, () => {
        allSheet.classList.add('hidden');
        allOv.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.pr-drag-handle, .pr-all-header',
        scrollTarget:   '.pr-all-grid',
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      // Close the topmost sheet only — detail is stacked above All-PRs,
      // so close detail first; only close All-PRs if detail isn't open.
      if (sheet && !sheet.classList.contains('hidden')) {
        closePRDetailSheet();
      } else if (allSheet && !allSheet.classList.contains('hidden')) {
        closePRAllSheet();
      }
    });
  }

  // ── PR celebration sounds (Web Audio, distinct from fanfare) ──
  function playPRChime() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;
      // E5 → G5 → B5 quick uplift
      const notes = [659.25, 783.99, 987.77];
      notes.forEach((freq, i) => {
        ['sine', 'triangle'].forEach(type => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(freq, t0 + i * 0.08);
          osc.connect(gain);
          gain.connect(ac.destination);
          const peak = type === 'sine' ? 0.18 : 0.08;
          gain.gain.setValueAtTime(0.0001, t0 + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(peak, t0 + i * 0.08 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.08 + 0.30);
          osc.start(t0 + i * 0.08);
          osc.stop(t0 + i * 0.08 + 0.32);
        });
      });
    } catch (_) {}
  }

  function playPRTakeover() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;
      // Cinematic ascent: D4 → A4 → D5 → A5 sustained
      const notes = [
        { f: 293.66, s: 0.00, d: 0.30, p: 0.22 },
        { f: 440.00, s: 0.20, d: 0.30, p: 0.22 },
        { f: 587.33, s: 0.40, d: 0.50, p: 0.26 },
        { f: 880.00, s: 0.60, d: 1.20, p: 0.28 },
      ];
      notes.forEach(n => {
        ['sine', 'triangle'].forEach(type => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(n.f, t0 + n.s);
          osc.connect(gain);
          gain.connect(ac.destination);
          const peak = type === 'sine' ? n.p : n.p * 0.5;
          gain.gain.setValueAtTime(0.0001, t0 + n.s);
          gain.gain.exponentialRampToValueAtTime(peak, t0 + n.s + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.s + n.d);
          osc.start(t0 + n.s);
          osc.stop(t0 + n.s + n.d + 0.05);
        });
      });
    } catch (_) {}
  }

  // ── Celebration display + queue ────────────────────────────
  function showPRTier2Modal(item) {
    const def = getPRDef(item.prId);
    if (!def) { _prCelebrationActive = false; drainPRCelebrationQueue(); return; }
    const accent = _prTileAccent(def);
    const popup  = document.getElementById('pr-popup');
    if (!popup) { _prCelebrationActive = false; drainPRCelebrationQueue(); return; }
    popup.style.setProperty('--pr-accent', accent);
    document.getElementById('pr-popup-icon').textContent  = def.icon;
    document.getElementById('pr-popup-title').textContent = def.description;
    document.getElementById('pr-popup-value').textContent = _formatPRValue(item.prId, item.newValue);
    const prevTxt = (item.prevValue && item.prevValue > 0)
      ? 'Previous: ' + _formatPRValue(item.prId, item.prevValue)
      : 'Your first record. Set the bar.';
    document.getElementById('pr-popup-prev').textContent = prevTxt;
    popup.classList.remove('hidden');
    void popup.offsetWidth;
    popup.classList.add('pr-popup--show');
    playPRChime();

    const dismiss = () => {
      popup.classList.remove('pr-popup--show');
      popup.classList.add('pr-popup--hide');
      popup.addEventListener('animationend', () => {
        popup.classList.remove('pr-popup--hide');
        popup.classList.add('hidden');
        _prCelebrationActive = false;
        setTimeout(drainPRCelebrationQueue, 260);
      }, { once: true });
      popup.removeEventListener('click', dismiss);
    };
    popup.addEventListener('click', dismiss);
    setTimeout(dismiss, 3200);
  }

  function showPRTier3Takeover(item) {
    const def = getPRDef(item.prId);
    if (!def) { _prCelebrationActive = false; drainPRCelebrationQueue(); return; }
    const accent  = _prTileAccent(def);
    const overlay = document.getElementById('pr-takeover');
    if (!overlay) { _prCelebrationActive = false; drainPRCelebrationQueue(); return; }
    overlay.style.setProperty('--pr-accent', accent);

    let headline = '';
    let sub = def.motivation;
    if (item.prId === 'longest_mr_streak')      headline = item.newValue + '-DAY MORNING ROUTINE';
    else if (item.prId === 'longest_li_streak') headline = item.newValue + '-DAY LOCKED-IN';
    else if (item.prId === 'highest_rank')      headline = item.newValue + ' RANK';
    else                                        headline = String(item.newValue) + ' ' + def.label.toUpperCase();

    document.getElementById('pr-takeover-headline').textContent = headline;
    document.getElementById('pr-takeover-sub').textContent      = sub;

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('pr-takeover--show');
    playPRTakeover();

    const dismiss = () => {
      overlay.classList.remove('pr-takeover--show');
      overlay.classList.add('pr-takeover--hide');
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('pr-takeover--hide');
        overlay.classList.add('hidden');
        _prCelebrationActive = false;
        setTimeout(drainPRCelebrationQueue, 320);
      }, { once: true });
      overlay.removeEventListener('click', dismiss);
    };
    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 5000);
  }

  function drainPRCelebrationQueue() {
    if (_prCelebrationActive || !_prCelebrationQueue.length) return;
    // Don't fire PR celebrations until any queued bonus popups have finished.
    if (_bonusPopupActive || (_bonusPopupQueue && _bonusPopupQueue.length)) {
      setTimeout(drainPRCelebrationQueue, 400);
      return;
    }
    _prCelebrationActive = true;
    const item = _prCelebrationQueue.shift();
    const def  = getPRDef(item.prId);
    if (item.mode === 'tier1' || (def && def.tier === 1)) {
      // Tier 1 toast
      const valStr = _formatPRValue(item.prId, item.newValue);
      showHabitToast('🏆 ' + valStr + ' ' + def.label);
      setTimeout(() => {
        _prCelebrationActive = false;
        drainPRCelebrationQueue();
      }, 2400);
    } else if (item.mode === 'tier3') {
      showPRTier3Takeover(item);
    } else {
      showPRTier2Modal(item);
    }
  }

  function setupBonusInfoPopup() {
    const ov = document.getElementById('bonus-info-overlay');
    const closeBtn = document.getElementById('bi-close-btn');
    const doneBtn  = document.getElementById('bi-done-btn');
    if (ov)       ov.addEventListener('click', closeBonusInfoPopup);
    if (closeBtn) closeBtn.addEventListener('click', closeBonusInfoPopup);
    if (doneBtn)  doneBtn.addEventListener('click', closeBonusInfoPopup);

    // Delegated click — every ⚡ rendered with [data-bonus-info] is clickable
    // (current pack-progress strip rows, plus any future surfaces that opt in).
    document.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const bolt = t.closest('[data-bonus-info]');
      if (!bolt) return;
      e.stopPropagation();
      e.preventDefault();
      openBonusInfoPopup();
    });

    // ESC dismiss
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const md = document.getElementById('bonus-info-modal');
      if (md && !md.classList.contains('hidden')) closeBonusInfoPopup();
    });
  }


  // ── DUNGEON BOSSES UI ────────────────────────────────────────
  // Render path for the boss-card grid inside the dungeon view of
  // #quests-panel. Each card opens the full-screen detail modal
  // (#boss-fs-overlay) on tap. Builders + open/close + setup live
  // below, in that order.
  // ── LEADERBOARD (Social tab) — v2.1 Phase C live ──────────
  // Surfaces the user's three Apple-Health-verified stats with
  // live competitive rankings via /v1/leaderboard/top fetches.
  // Tap any card → opens the Top-N ranking sheet for that metric.
  //
  // Three cards, fixed order (matches the metric definitions in the
  // Leaderboard module):
  //   1. Steps — last 7 days (current trailing sum + best week peak)
  //   2. 7+ hour sleep streak (current + best)
  //   3. Before-midnight bedtime streak (current + best)
  //
  // Empty-state handling: web/non-iOS users + iOS users without
  // HealthKit permission see a single explainer card instead of
  // zeroed-out stat rows. The competitive framing requires verified
  // data — showing "0 steps · best 0" would be misleading.
  function renderLeaderboardPreview() {
    const list  = document.getElementById('lb-preview-list');
    const empty = document.getElementById('lb-preview-empty');
    if (!list || !empty) return;

    // Render the three stat cards always — even on web/no-permission.
    // On web the data will be zeros (no HealthKit feeding the module),
    // but the user explicitly asked to see the layout in their browser
    // for previewing purposes. We surface a small note inside the
    // empty-state box explaining that real data only flows on iOS,
    // rather than gating the whole preview behind it.
    const isAvailable = (typeof Health !== 'undefined') &&
                         Health.isAvailable && Health.isAvailable();
    const isGranted   = isAvailable && Health.permissionStatus &&
                         Health.permissionStatus() === 'granted';

    if (!isAvailable) {
      // Web / non-iOS: show a soft note above the cards. Cards still
      // render below (with whatever zeros are in storage) for layout
      // visibility. The leaderboard ranking itself is live for iOS
      // users; this note clarifies that the data feeding it requires
      // the iOS app + Apple Health.
      empty.classList.remove('hidden');
      empty.innerHTML =
        '<div style="font-weight:700; color: var(--text-primary); margin-bottom:4px;">iOS only</div>' +
        '<div style="font-size:0.82rem;">These stats populate from Apple Health on the iOS app. The cards below show your current values (zero on web).</div>';
    } else if (!isGranted) {
      // Native but no permission yet — actionable copy.
      empty.classList.remove('hidden');
      empty.innerHTML =
        '<div style="font-weight:700; color: var(--text-primary); margin-bottom:4px;">Apple Health not connected</div>' +
        '<div style="font-size:0.82rem;">Grant HealthKit permission to start tracking these stats. Visit the Habits tab to trigger the prompt, or enable it in iOS Settings → Privacy → Health → Awakened.</div>';
    } else {
      empty.classList.add('hidden');
    }

    const snap = lbGetSnapshot();

    const fmt = n => (n || 0).toLocaleString('en-US');
    const nightWord = n => n === 1 ? 'night' : 'nights';

    // Card-builder. Icon-led layout: each card is a button so it
    // exposes click + keyboard activation natively. data-metric is
    // read by the click handler to open the right Top-50 view.
    function buildCard(metric, iconHTML, valueHTML, metaHTML) {
      return '<button type="button" class="lb-stat-card" data-lb-metric="' + metric + '">' +
        '<div class="lb-stat-icon-wrap">' + iconHTML + '</div>' +
        '<div class="lb-stat-body">' +
          '<div class="lb-stat-value">' + valueHTML + '</div>' +
          '<div class="lb-stat-meta">' + metaHTML + '</div>' +
        '</div>' +
        '<div class="lb-stat-chev">›</div>' +
      '</button>';
    }

    const walkIcon  = '<img src="assets/habit-icons/icon-walk.png" alt="" draggable="false" loading="lazy" decoding="async">';
    const sleepIcon = '<img src="assets/habit-icons/icon-sleep.png" alt="" draggable="false" loading="lazy" decoding="async">';
    const moonIcon  = '<span class="lb-stat-icon-glyph" aria-hidden="true">🌙</span>';

    // Card 1 — Steps this calendar week (Sunday 00:00 → Saturday
    // 23:59:59 device-local, resets every Sunday). The
    // `steps_last_7_days` field name on the snapshot is a legacy
    // identifier; semantics are now "current calendar week."
    const stepsValue = fmt(snap.steps_last_7_days) + '<span class="lb-stat-value-unit">steps this week</span>';
    const stepsMeta  = snap.best_7day_step_total > 0
      ? 'Best week: <b>' + fmt(snap.best_7day_step_total) + '</b>'
      : 'Best week: — (start walking to climb the leaderboard)';

    // Card 2 — 7+ hour sleep streak
    const sleepValue = snap.current_sleep_streak +
      '<span class="lb-stat-value-unit">sleep streak · 7+ hr</span>';
    const sleepMeta  = 'Best: <b>' + snap.best_sleep_streak + ' ' + nightWord(snap.best_sleep_streak) + '</b>';

    // Card 3 — Before-midnight bedtime streak
    const bedtimeValue = snap.current_bedtime_streak +
      '<span class="lb-stat-value-unit">bedtime streak · before midnight</span>';
    const bedtimeMeta  = 'Best: <b>' + snap.best_bedtime_streak + ' ' + nightWord(snap.best_bedtime_streak) + '</b>';

    list.innerHTML =
      buildCard('step_total',   walkIcon,  stepsValue,   stepsMeta) +
      buildCard('sleep_streak', sleepIcon, sleepValue,   sleepMeta) +
      buildCard('bedtime_streak', moonIcon, bedtimeValue, bedtimeMeta);
  }
  try { window.renderLeaderboardPreview = renderLeaderboardPreview; } catch (_) {}

  // ── LEADERBOARD RANKING SHEET (v2.1.0 Phase C — LIVE) ───────
  // Tap any stat card on the Social tab → opens this bottom sheet
  // with the real Top-N for that metric, fetched from the
  // Cloudflare Workers backend at /v1/leaderboard/top.
  //
  // Cache strategy: stale-while-revalidate. On open, render any
  // cached entries from hb_lb_cache_<metric> instantly, then fire a
  // background fetch and swap to fresh data when it lands. If the
  // network fetch fails AND the cache is <24h old, keep showing
  // cached entries with a "last updated" footer. If both fail, show
  // an empty state.
  //
  // Backend metric IDs (per BACKEND.md §6):
  //   step_total      — cumulative steps over the rolling 7-day window
  //   sleep_streak    — current consecutive ≥7h sleep nights
  //   bedtime_streak  — current consecutive before-midnight nights
  //
  // The Social-tab cards use these same IDs as data-lb-metric so
  // open/fetch don't require any translation.

  const LB_METRIC_META = {
    step_total: {
      title: 'Steps · this week',
      blurb: 'Total steps from Sunday 12:00 AM through Saturday 11:59 PM (device-local). Resets every Sunday. Apple Health is the only source — no manual logging.',
      unit:  'steps',
      formatValue: n => (n || 0).toLocaleString('en-US'),
    },
    sleep_streak: {
      title: '7+ hour sleep streak',
      blurb: 'Longest current run of consecutive nights with at least 7 hours of sleep. Verified by Apple Health.',
      unit:  'nights',
      formatValue: n => (n || 0).toString(),
    },
    bedtime_streak: {
      title: 'Before-midnight bedtime streak',
      blurb: 'Longest current run of consecutive nights asleep before midnight. Verified by Apple Health.',
      unit:  'nights',
      formatValue: n => (n || 0).toString(),
    },
  };

  // localStorage cache key per metric. Object shape:
  //   { top: [{rank, alias, current_value}], me: { rank, current_value } | null, fetched_at: <epoch_ms> }
  const LB_CACHE_KEY_PREFIX = 'hb_lb_cache_';
  const LB_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — past this, treat as empty

  function lbCacheRead(metric) {
    try {
      const raw = localStorage.getItem(LB_CACHE_KEY_PREFIX + metric);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.fetched_at !== 'number') return null;
      if ((Date.now() - parsed.fetched_at) > LB_CACHE_MAX_AGE_MS) return null;
      return parsed;
    } catch (_) { return null; }
  }
  function lbCacheWrite(metric, top, me) {
    try {
      localStorage.setItem(LB_CACHE_KEY_PREFIX + metric, JSON.stringify({
        top:        Array.isArray(top) ? top : [],
        me:         me || null,
        fetched_at: Date.now(),
      }));
    } catch (_) {}
  }
  function lbFormatRelativeTime(epochMs) {
    const diffMs = Date.now() - epochMs;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    return 'a while ago';
  }

  // Renders the rank-list content given a backend response. Splits
  // the user-row out of the top-N (or surfaces a separate "your rank"
  // line if me.rank > top.length). Empty top → first-to-rank message.
  function lbBuildRankList(metric, top, me, stale_footer) {
    const meta = LB_METRIC_META[metric];
    if (!meta) return '';

    if (!Array.isArray(top) || top.length === 0) {
      return (
        '<div class="lb-rank-empty">' +
          '<div class="lb-rank-empty-icon" aria-hidden="true">🏆</div>' +
          '<div class="lb-rank-empty-title">Be the first to rank.</div>' +
          '<div class="lb-rank-empty-body">Start tracking your ' + esc(meta.unit) + ' to claim the top spot.</div>' +
        '</div>'
      );
    }

    const myAlias = lbGetMyAlias();
    let yourRankLine = '';

    // If the user is OUTSIDE the top-N (or has not submitted yet),
    // show a separate "Your rank: #N" line above the top-N list.
    if (me && typeof me.rank === 'number' && me.rank > 0) {
      const inTopN = top.some(r => r && r.alias === myAlias);
      if (!inTopN) {
        yourRankLine =
          '<div class="lb-rank-row lb-rank-row--me lb-rank-row--out-of-top">' +
            '<span class="lb-rank-pos">#' + me.rank + '</span>' +
            '<span class="lb-rank-name">' + esc(myAlias || 'You') + '</span>' +
            '<span class="lb-rank-value">' + meta.formatValue(me.current_value) + '</span>' +
          '</div>' +
          '<div class="lb-rank-divider" aria-hidden="true"></div>';
      }
    } else if (!me) {
      // me === null → user hasn't submitted this metric yet (or
      // lbSubmitAllMetrics hasn't fired since sign-in)
      yourRankLine =
        '<div class="lb-rank-row lb-rank-row--me lb-rank-row--pending">' +
          '<span class="lb-rank-pos">—</span>' +
          '<span class="lb-rank-name">' + esc(myAlias || 'You') + ' <em class="lb-rank-name-sub">· submitting…</em></span>' +
          '<span class="lb-rank-value">—</span>' +
        '</div>' +
        '<div class="lb-rank-divider" aria-hidden="true"></div>';
    }

    const topRows = top.map(row => {
      const isMe = myAlias && row.alias === myAlias;
      const rankClass = isMe ? 'lb-rank-row lb-rank-row--me' : 'lb-rank-row';
      return '<div class="' + rankClass + '">' +
        '<span class="lb-rank-pos">#' + (row.rank || '?') + '</span>' +
        '<span class="lb-rank-name">' + esc(row.alias || '—') + '</span>' +
        '<span class="lb-rank-value">' + meta.formatValue(row.current_value) + '</span>' +
      '</div>';
    }).join('');

    const footer = stale_footer
      ? '<div class="lb-rank-footer">' + esc(stale_footer) + '</div>'
      : '';

    return yourRankLine + topRows + footer;
  }

  function lbBuildLoadingSkeleton() {
    let html = '';
    for (let i = 0; i < 5; i++) {
      html +=
        '<div class="lb-rank-row lb-rank-row--skeleton">' +
          '<span class="lb-rank-pos lb-skel-block"></span>' +
          '<span class="lb-rank-name lb-skel-block"></span>' +
          '<span class="lb-rank-value lb-skel-block"></span>' +
        '</div>';
    }
    return html;
  }

  function lbBuildErrorState(code) {
    if (code === 'STUB_USER' || code === 'NOT_SIGNED_IN' || code === 'LOCAL_DEV_SKIP') {
      return (
        '<div class="lb-rank-empty">' +
          '<div class="lb-rank-empty-icon" aria-hidden="true">🔒</div>' +
          '<div class="lb-rank-empty-title">Sign in to see live rankings.</div>' +
          '<div class="lb-rank-empty-body">Real leaderboard data requires an Awakened account.</div>' +
        '</div>'
      );
    }
    return (
      '<div class="lb-rank-empty">' +
        '<div class="lb-rank-empty-icon" aria-hidden="true">📡</div>' +
        '<div class="lb-rank-empty-title">Couldn’t load rankings.</div>' +
        '<div class="lb-rank-empty-body">Check your connection. The list updates each time you open this tab.</div>' +
      '</div>'
    );
  }

  // Reads the signed-in user's alias (for highlighting their row in
  // the leaderboard). Returns null if not signed in or on stub.
  function lbGetMyAlias() {
    try {
      if (typeof window.Auth === 'undefined') return null;
      const u = window.Auth.getCurrentUser();
      return (u && u.alias) ? u.alias : null;
    } catch (_) { return null; }
  }

  // Tracks the open metric so concurrent fetches don't write into
  // a stale DOM (user switched tabs mid-fetch).
  let _lbCurrentOpenMetric = null;

  async function openLeaderboardRanking(metric) {
    const meta = LB_METRIC_META[metric];
    if (!meta) return;
    const sheet   = document.getElementById('lb-rank-sheet');
    const overlay = document.getElementById('lb-rank-overlay');
    const listEl  = document.getElementById('lb-rank-list');
    if (!sheet || !overlay || !listEl) return;

    document.getElementById('lb-rank-title').textContent = meta.title;
    document.getElementById('lb-rank-blurb').textContent = meta.blurb;

    _lbCurrentOpenMetric = metric;

    // Phase 1: instant render from cache if we have one, otherwise
    // show the loading skeleton. This makes repeat opens of the same
    // metric feel snappy even before the network responds.
    const cached = lbCacheRead(metric);
    if (cached) {
      const staleNote = 'Last updated ' + lbFormatRelativeTime(cached.fetched_at);
      listEl.innerHTML = lbBuildRankList(metric, cached.top, cached.me, staleNote);
    } else {
      listEl.innerHTML = lbBuildLoadingSkeleton();
    }

    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');

    // Phase 2: background fetch. If the user closed the sheet or
    // switched metrics by the time it lands, don't write to the DOM.
    let result;
    try {
      result = await window.Auth.fetchLeaderboardTop(metric);
    } catch (e) {
      result = { ok: false, code: 'NETWORK' };
    }
    if (_lbCurrentOpenMetric !== metric) return; // user moved on

    if (result && result.ok) {
      lbCacheWrite(metric, result.top, result.me);
      listEl.innerHTML = lbBuildRankList(metric, result.top, result.me);
    } else if (result && result.code === 'EXPIRED') {
      // JWT died mid-view. Auth.fetchLeaderboardTop already cleared
      // hb_user; reload re-arms the sign-in gate.
      window.location.reload();
    } else if (!cached) {
      // No cache to fall back on — show error or stub state
      listEl.innerHTML = lbBuildErrorState(result && result.code);
    }
    // If we have cached AND fetch failed (not EXPIRED), the cached
    // render from Phase 1 stays — nothing to do here.
  }

  function closeLeaderboardRanking() {
    const sheet   = document.getElementById('lb-rank-sheet');
    const overlay = document.getElementById('lb-rank-overlay');
    if (sheet)   sheet.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
  }

  function setupLeaderboardPreview() {
    const list = document.getElementById('lb-preview-list');
    if (list) {
      list.addEventListener('click', e => {
        const card = e.target.closest('[data-lb-metric]');
        if (!card) return;
        openLeaderboardRanking(card.getAttribute('data-lb-metric'));
      });
    }
    const overlay = document.getElementById('lb-rank-overlay');
    const sheet   = document.getElementById('lb-rank-sheet');
    const close   = document.getElementById('lb-rank-close');
    if (overlay) overlay.addEventListener('click', closeLeaderboardRanking);
    if (close)   close.addEventListener('click', closeLeaderboardRanking);
    if (sheet && typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, closeLeaderboardRanking, {
        scrollTarget: '.lb-rank-list',
      });
    }
  }
  try { window.openLeaderboardRanking = openLeaderboardRanking; } catch (_) {}

  // CARDS.md-spec boss card. 5:7 portrait, 6 stacked regions
  // (header / art / stat strip / flavor / kill condition / progress).
  // Tappable — opens the full-screen detail modal via openBossFullScreen.
  //
  // State variants composed via classes:
  //   .bcard--active   — streak > 0, border pulses purple-gold
  //   .bcard--defeated — kill_count > 0, gold border + corner trophy
  //   .bcard--burned   — Carouser's weekend_burned === true
  //
  // Illustration path derives from id by swapping underscores for
  // hyphens (the_insomniac → the-insomniac.png) since the source
  // assets ship with hyphens.
  function buildBossCardHTML(id) {
    const cfg = BOSSES[id];
    const state = getBossState(id);
    const imgPath = 'assets/bosses/' + id.replace(/_/g, '-') + '.png';
    const dots = Array.from({ length: cfg.streakTarget }, (_, i) =>
      '<span class="bcard-dot' + (i < state.streak ? ' bcard-dot--filled' : '') + '"></span>'
    ).join('');

    // Compose state classes. They stack — engaged + active + defeated
    // can all apply at once. v2.0.1 engagement-pivot adds .bcard--engaged
    // (gold border + HUNTING label), .bcard--dormant (dim, unlocked but
    // not hunted), and .bcard--preview (locked rank, view-only).
    //
    // Preview state takes precedence over dormant/engaged — a boss in
    // a locked dungeon can't be engaged (the modal renders a "Reach X
    // rank to engage" label instead of the ENGAGE button), so engaging
    // semantics don't apply. The card just shows the kit so the user
    // knows what's coming.
    const isPreview = !isGateUnlocked(cfg.rank);
    const stateClasses = [];
    if (isPreview) {
      stateClasses.push('bcard--preview');
    } else if (state.engaged === true) {
      stateClasses.push('bcard--engaged');
    } else {
      stateClasses.push('bcard--dormant');
    }
    if (state.streak > 0) stateClasses.push('bcard--active');
    if (state.kill_count > 0) stateClasses.push('bcard--defeated');
    // weekend_burned only present on Carouser; default-false elsewhere.
    if (state.weekend_burned === true) stateClasses.push('bcard--burned');
    const classAttr = ['bcard'].concat(stateClasses).join(' ');

    // Top-right corner label. Mutually exclusive between HUNTING (engaged
    // and unlocked) and PREVIEW (locked-walkable). Fills the slot where
    // the glyph used to live before the emoji-removal pass. Higher
    // z-index than the rank pill so it visually anchors the state.
    let cornerLabel = '';
    if (isPreview) {
      cornerLabel = '<span class="bcard-preview-label" aria-hidden="true">PREVIEW</span>';
    } else if (state.engaged === true) {
      cornerLabel = '<span class="bcard-hunting-label" aria-hidden="true">HUNTING</span>';
    }

    // Cadence display: capitalize first letter for the stat strip.
    const cadenceLabel = (cfg.cadence || 'daily').charAt(0).toUpperCase() +
                         (cfg.cadence || 'daily').slice(1);

    // Trophy prefix on kill-count line when count > 0 (per CARDS.md
    // line 153). Defeated state ALSO adds a corner trophy overlay
    // (line 180-182) — they're separate visual cues.
    const killText = state.kill_count > 0
      ? '🏆 Defeated: ' + state.kill_count + ' time' + (state.kill_count === 1 ? '' : 's')
      : 'Defeated: 0 times';

    // Defeated-state corner trophy. Renders as a span overlay so the
    // gold-border treatment can do its own thing on .bcard--defeated.
    const cornerTrophy = state.kill_count > 0
      ? '<span class="bcard-corner-trophy" aria-hidden="true">🏆</span>'
      : '';

    // Burned-state overlay text. Per CARDS.md: "Weekend forfeit —
    // opens Friday." Sits above the rest of the card content via
    // higher z-index when .bcard--burned is active.
    const burnedOverlay = state.weekend_burned === true
      ? '<div class="bcard-burned-overlay" aria-hidden="true">Weekend forfeit — opens Friday</div>'
      : '';

    return (
      '<button type="button" class="' + classAttr + '" data-boss="' + id + '" aria-label="View ' + esc(cfg.name) + ' details">' +
        cornerTrophy +
        cornerLabel +
        burnedOverlay +
        // Region a: Header strip — rank pill (absolute, left) +
        // boss name (centered in the full strip width).
        '<div class="bcard-header">' +
          '<span class="bcard-rank-pill rank-badge" data-rank="' + esc(cfg.rank) + '">' + esc(cfg.rank) + '</span>' +
          '<span class="bcard-name">' + esc(cfg.name) + '</span>' +
        '</div>' +
        // Region b: Art window — bleed-to-edge illustration
        '<div class="bcard-art">' +
          '<img src="' + imgPath + '" alt="" draggable="false" loading="lazy" decoding="async">' +
        '</div>' +
        // Region c: Stat strip — STAT · CADENCE
        '<div class="bcard-stats">' +
          '<span class="bcard-stat-label">STAT</span> ' +
          '<span class="bcard-stat-value">' + esc(cfg.statDomain || '—') + '</span>' +
          '<span class="bcard-stat-sep">·</span>' +
          '<span class="bcard-stat-label">CADENCE</span> ' +
          '<span class="bcard-stat-value">' + esc(cadenceLabel) + '</span>' +
        '</div>' +
        // Region d: Flavor — italic gray-purple
        '<div class="bcard-flavor">' + esc(cfg.flavorShort) + '</div>' +
        // Region e: Kill condition
        '<div class="bcard-cond">' + esc(cfg.killCondShort) + '</div>' +
        // Region f: Progress — dots + streak label + kill count
        '<div class="bcard-progress">' +
          '<div class="bcard-dots">' + dots + '</div>' +
          '<div class="bcard-progress-label">' + state.streak + ' / ' + cfg.streakTarget + ' nights</div>' +
          '<div class="bcard-kills">' + killText + '</div>' +
        '</div>' +
      '</button>'
    );
  }

  // Renders the boss list inside the dungeon view. Optional rankFilter
  // limits to bosses tagged with that rank (CLAUDE.md → "Where they
  // live"). Single render path as of the cleanup that removed the old
  // card style — boss-cards-only-newstyle from here on. Each card
  // renders into a 2-col grid; tap opens the full-screen detail modal.
  function renderBossesPanel(rankFilter) {
    const list = document.getElementById('bosses-list');
    if (!list) return;
    const bossIds = Object.keys(BOSSES).filter(id =>
      !rankFilter || BOSSES[id].rank === rankFilter
    );
    if (bossIds.length === 0) {
      list.innerHTML = '<p class="dungeon-empty">No bosses await yet. Check back as more dungeons fill.</p>';
      list.classList.remove('bosses-list--cards');
      return;
    }
    list.classList.add('bosses-list--cards');
    list.innerHTML = bossIds.map(buildBossCardHTML).join('');
  }

  // ── Full-screen boss detail modal ──────────────────────────
  // Replaces the v1.1.7 bottom-sheet detail. Tapping any boss card
  // (.bcard) opens this overlay. Closes via Back button, ESC key,
  // or any tab switch. Pulls all data from BOSSES[id] + getBossState.
  // Cadence label capitalizes for display ("daily" → "Daily").
  function openBossFullScreen(id) {
    const cfg = BOSSES[id];
    if (!cfg) return;
    const state = getBossState(id);
    const overlay = document.getElementById('boss-fs-overlay');
    if (!overlay) return;

    const cadenceLabel = (cfg.cadence || 'daily').charAt(0).toUpperCase() +
                         (cfg.cadence || 'daily').slice(1);
    const imgPath = 'assets/bosses/' + id.replace(/_/g, '-') + '.png';

    // Header — rank pill
    const rankPill = document.getElementById('bfs-rank-pill');
    if (rankPill) {
      rankPill.textContent = cfg.rank;
      rankPill.setAttribute('data-rank', cfg.rank); // per-rank color via CSS vars
    }

    // Hero art
    const heroImg = document.getElementById('bfs-hero-img');
    if (heroImg) {
      heroImg.src = imgPath;
      heroImg.alt = cfg.name;
    }

    // Name + rank label
    const nameEl = document.getElementById('bfs-name');
    if (nameEl) nameEl.textContent = cfg.name;
    const rankLabel = document.getElementById('bfs-rank-label');
    if (rankLabel) rankLabel.textContent = cfg.rank + '-RANK BOSS';

    // Long flavor (italic, larger)
    const flavorEl = document.getElementById('bfs-flavor');
    if (flavorEl) flavorEl.textContent = cfg.flavorLong || cfg.flavorShort || '';

    // Stats grid
    const setStat = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setStat('bfs-stat-rank',     cfg.rank);
    setStat('bfs-stat-domain',   cfg.statDomain || '—');
    setStat('bfs-stat-cadence',  cadenceLabel);
    setStat('bfs-stat-defeated',
      state.kill_count + ' time' + (state.kill_count === 1 ? '' : 's')
    );

    // Kill condition (long version)
    const killCondEl = document.getElementById('bfs-kill-cond');
    if (killCondEl) killCondEl.textContent = cfg.killCondLong || cfg.killCondShort || '';

    // Progress dots + label (sized larger via CSS for the modal context)
    const progressEl = document.getElementById('bfs-progress');
    if (progressEl) {
      const dots = Array.from({ length: cfg.streakTarget }, (_, i) =>
        '<span class="bfs-dot' + (i < state.streak ? ' bfs-dot--filled' : '') + '"></span>'
      ).join('');
      progressEl.innerHTML =
        '<div class="bfs-dots">' + dots + '</div>' +
        '<div class="bfs-progress-label">' + state.streak + ' / ' + cfg.streakTarget + ' nights</div>';
    }

    // Burned banner (Carouser only when weekend_burned === true)
    const burnedBanner = document.getElementById('bfs-burned-banner');
    if (burnedBanner) {
      if (state.weekend_burned === true) {
        burnedBanner.classList.remove('hidden');
      } else {
        burnedBanner.classList.add('hidden');
      }
    }

    // Engagement section (v2.0.1) — three mutually-exclusive states:
    // preview (rank locked), engaged, or not-engaged-but-unlockable.
    // Stamps `data-boss-id` on the buttons so the click handlers
    // (wired once in setupBossesPanel) can dispatch.
    const engageState   = document.getElementById('bfs-engage-state');
    const engageCta     = document.getElementById('bfs-engage-cta');
    const engagePreview = document.getElementById('bfs-engage-preview');
    const engageBtn     = document.getElementById('bfs-engage-btn');
    const disengageBtn  = document.getElementById('bfs-disengage-btn');
    const engageSince   = document.getElementById('bfs-engage-since');
    const engagePreviewLabel = document.getElementById('bfs-engage-preview-label');
    const isPreview = !isGateUnlocked(cfg.rank);

    if (engageState && engageCta && engagePreview) {
      // Default-hide all three; one branch unhides exactly one.
      engageState.classList.add('hidden');
      engageCta.classList.add('hidden');
      engagePreview.classList.add('hidden');

      if (isPreview) {
        // Rank locked — static "Reach X rank to engage" label.
        // ENGAGE button is intentionally absent; engageBoss() also
        // refuses preview-state bosses defensively (see helper).
        engagePreview.classList.remove('hidden');
        if (engagePreviewLabel) {
          engagePreviewLabel.textContent = 'Reach ' + cfg.rank + ' rank to engage';
        }
      } else if (state.engaged === true) {
        engageState.classList.remove('hidden');
        if (engageSince) {
          engageSince.textContent = 'HUNTING SINCE ' + formatEngagedAt(state.engaged_at);
        }
        if (disengageBtn) disengageBtn.setAttribute('data-boss-id', id);
      } else {
        engageCta.classList.remove('hidden');
        if (engageBtn) {
          engageBtn.setAttribute('data-boss-id', id);
          // v2.0.1: button text shows the souls cost. Always-tappable
          // — broke-state is handled by engageBoss's balance check
          // which fires a precise "Need N souls. You have M." toast.
          const cost = engageCostSouls(cfg.rank);
          engageBtn.textContent = cost > 0
            ? 'ENGAGE BOSS — ' + cost + ' SOULS'
            : 'ENGAGE BOSS';
        }
      }
    }

    // Track which boss the modal is currently showing so engage/
    // disengage actions from the helper functions can refresh it.
    bfsCurrentBossId = id;

    overlay.classList.remove('hidden');
    document.body.classList.add('bfs-locked'); // lock background scroll
  }

  // Tracks the boss currently shown in the full-screen modal so
  // engage/disengage helpers can refresh the visible state without
  // each helper needing to re-resolve which boss is on screen.
  let bfsCurrentBossId = null;

  function refreshBossFullScreenIfOpen(bossId) {
    const overlay = document.getElementById('boss-fs-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (bfsCurrentBossId !== bossId) return;
    // Re-run open with the same boss to repopulate fields without
    // closing the overlay (open() already short-circuits on the
    // visible-overlay branch — it just rewrites the inner content).
    openBossFullScreen(bossId);
  }

  // Friendly date display for engaged_at. ISO 8601 stored, displayed
  // as "today" / "yesterday" / "N days ago" for recent dates and an
  // absolute "May 9, 2026" for older. Falls back to "—" if missing.
  function formatEngagedAt(isoString) {
    if (!isoString) return '—';
    const then = new Date(isoString);
    if (isNaN(then.getTime())) return '—';
    const now = new Date();
    // Compare device-local calendar days, not 24-hour windows.
    const ymdNow  = now.getFullYear() + '-' + (now.getMonth()+1) + '-' + now.getDate();
    const ymdThen = then.getFullYear() + '-' + (then.getMonth()+1) + '-' + then.getDate();
    if (ymdNow === ymdThen) return 'today';
    const ms = now.setHours(0,0,0,0) - new Date(then).setHours(0,0,0,0);
    const days = Math.round(ms / (1000 * 60 * 60 * 24));
    if (days === 1) return 'yesterday';
    if (days > 1 && days < 7) return days + ' days ago';
    // Older — absolute date, e.g., "May 9, 2026"
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function closeBossFullScreen() {
    const overlay = document.getElementById('boss-fs-overlay');
    if (!overlay) return;
    if (overlay.classList.contains('hidden')) return;
    overlay.classList.add('hidden');
    document.body.classList.remove('bfs-locked');
    // Reset scroll position so re-opening starts from the top.
    overlay.scrollTop = 0;
  }
  try { window.openBossFullScreen = openBossFullScreen; } catch (_) {}
  try { window.closeBossFullScreen = closeBossFullScreen; } catch (_) {}

  function setupBossesPanel() {
    const list = document.getElementById('bosses-list');
    if (list) {
      list.addEventListener('click', (e) => {
        const card = e.target.closest('.bcard[data-boss]');
        if (!card) return;
        const id = card.getAttribute('data-boss');
        if (id) openBossFullScreen(id);
      });
    }
    // Wire the modal's Back button + ESC key.
    const backBtn = document.getElementById('bfs-back');
    if (backBtn) backBtn.addEventListener('click', closeBossFullScreen);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const overlay = document.getElementById('boss-fs-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        closeBossFullScreen();
      }
    });

    // Engagement buttons (v2.0.1). The handlers read data-boss-id
    // off the button — set by openBossFullScreen at open time so
    // we don't capture a stale boss id at setup time.
    const engageBtn = document.getElementById('bfs-engage-btn');
    if (engageBtn) {
      engageBtn.addEventListener('click', () => {
        const id = engageBtn.getAttribute('data-boss-id');
        if (id) engageBoss(id);
      });
    }
    const disengageBtn = document.getElementById('bfs-disengage-btn');
    if (disengageBtn) {
      disengageBtn.addEventListener('click', () => {
        const id = disengageBtn.getAttribute('data-boss-id');
        if (!id) return;
        const cfg = BOSSES[id];
        const name = (cfg && cfg.name) || 'this boss';
        // Native confirm — accessible, iOS-WebView-styled. Custom
        // brand-matched modal would be polish; functional path here.
        const ok = window.confirm('Stop hunting ' + name + '? Your current streak will reset.');
        if (ok) disengageBoss(id);
      });
    }
  }

  // ── QUESTS TAB GATE GRID (v2.0.2 → v2.0.5) ─────────────────
  // 3×2 grid of rank-tier gates (E/D/C/B/A/S). E starts unlocked;
  // D-S render in locked state and unlock as the user climbs ranks.
  // Tapping an unlocked gate swaps to the dungeon-view (back button +
  // dungeon header + flavor + bosses for that tier). Tapping a locked
  // gate fires a "Reach X rank to unlock" toast — no expansion.
  //
  // Tab re-entry resets to gate-view (questsGateExpanded = false).
  // Per-rank header/flavor copy lives in DUNGEON_FLAVOR. The boss list
  // filters by rank; if a tier is unlocked but has no bosses defined,
  // the empty-state copy in renderBossesPanel surfaces.
  let questsGateExpanded = false;
  let currentDungeonRank = 'E'; // which rank tier the dungeon-view shows

  // Per-rank copy for the dungeon-view header + flavor line. Edit
  // these strings here, not in markup — the markup uses dynamic IDs
  // (#dungeon-header-text, #dungeon-flavor-text) populated at expand
  // time. Empty dungeons (no bosses yet at that rank) show the empty-
  // state copy from renderBossesPanel; the flavor line above it stays
  // as defined here for atmospheric framing.
  const DUNGEON_FLAVOR = {
    E: { header: 'E-RANK DUNGEON', flavor: 'The first threshold. Two bosses linger in the dark.' },
    D: { header: 'D-RANK DUNGEON', flavor: 'A deeper hall awaits its keepers.' },
    C: { header: 'C-RANK DUNGEON', flavor: 'The middle road. Seasoned ground.' },
    B: { header: 'B-RANK DUNGEON', flavor: 'Most never reach this gate.' },
    A: { header: 'A-RANK DUNGEON', flavor: 'Mastery starts here.' },
    S: { header: 'S-RANK DUNGEON', flavor: 'The apex. The few.' },
  };

  // Returns true if the user's current rank is at or above the gate's
  // rank tier. RANKS array is ordered E,D,C,B,A,S,S+ — index comparison
  // gives "have I climbed at least to this tier?" semantics. S+ users
  // pass for any gate tier.
  function isGateUnlocked(gateRankId) {
    const userRankId = getRank(totalPoints).id;
    const userIdx = RANKS.findIndex(r => r.id === userRankId);
    const gateIdx = RANKS.findIndex(r => r.id === gateRankId);
    if (gateIdx < 0) return false;
    return userIdx >= gateIdx;
  }
  try { window.isGateUnlocked = isGateUnlocked; } catch (_) {}

  // Returns true if any boss in the BOSSES roster has rank === rankId.
  // Used to determine if a locked gate should be walkable in preview
  // mode — locked gates with content become walkable; locked gates
  // with no content stay hard-locked (no point promising air).
  function hasBossesAtRank(rankId) {
    if (!rankId) return false;
    return Object.keys(BOSSES).some(id => BOSSES[id].rank === rankId);
  }
  try { window.hasBossesAtRank = hasBossesAtRank; } catch (_) {}

  // Soft-entry gate. True if the user's rank meets the threshold OR
  // the rank has at least one boss configured (preview-walkable).
  // The render path uses `isGateUnlocked` (NOT this) to decide
  // preview-vs-live state inside the dungeon — entry allowed and
  // engagement allowed are different concepts.
  function isGateEntryAllowed(rankId) {
    return isGateUnlocked(rankId) || hasBossesAtRank(rankId);
  }
  try { window.isGateEntryAllowed = isGateEntryAllowed; } catch (_) {}

  function renderQuestsPanel() {
    const gateView    = document.getElementById('quests-gate-view');
    const dungeonView = document.getElementById('quests-dungeon-view');
    if (!gateView || !dungeonView) return;

    if (questsGateExpanded) {
      gateView.classList.add('hidden');
      dungeonView.classList.remove('hidden');

      // Populate the rank-aware header + flavor.
      const rank = currentDungeonRank || 'E';
      const flavor = DUNGEON_FLAVOR[rank] || DUNGEON_FLAVOR.E;
      const headerEl = document.getElementById('dungeon-header-text');
      const flavorEl = document.getElementById('dungeon-flavor-text');
      if (headerEl) headerEl.textContent = flavor.header;
      if (flavorEl) flavorEl.textContent = flavor.flavor;

      // Render only this rank's bosses. Empty-state handled inside.
      renderBossesPanel(rank);
    } else {
      gateView.classList.remove('hidden');
      dungeonView.classList.add('hidden');

      // Apply locked-state to each cell based on user's current rank
      // AND whether the rank has bosses (soft-entry rule, v2.0.1).
      // Three states per cell:
      //   1. unlocked            → no locked class, no preview class
      //   2. locked + has-bosses → .gate-cell--preview (walkable, dim
      //      art, no lock icon, "PREVIEW" affordance)
      //   3. locked + no-bosses  → .gate-cell--locked (hard-locked,
      //      lock icon visible, tap fires toast)
      // Markup stays static — all decisions stamped here.
      const cells = gateView.querySelectorAll('.gate-cell[data-gate-rank]');
      cells.forEach(cell => {
        const r = cell.getAttribute('data-gate-rank');
        const unlocked = isGateUnlocked(r);
        const hasContent = hasBossesAtRank(r);
        const isPreview = !unlocked && hasContent;
        const isHardLocked = !unlocked && !hasContent;

        cell.classList.toggle('gate-cell--locked', isHardLocked);
        cell.classList.toggle('gate-cell--preview', isPreview);

        // Aria label reflects state for screen readers. Preview gates
        // are walkable but communicate the engagement gate to come.
        let label;
        if (unlocked) {
          label = 'Enter ' + r + '-rank dungeon';
        } else if (isPreview) {
          label = 'Preview ' + r + '-rank dungeon. Reach ' + r + ' rank to engage.';
        } else {
          label = r + '-rank dungeon, locked. Reach ' + r + ' rank to unlock.';
        }
        cell.setAttribute('aria-label', label);
      });
    }
  }
  try { window.renderQuestsPanel = renderQuestsPanel; } catch (_) {}

  function setupQuestsGate() {
    const grid    = document.getElementById('quests-gate-grid');
    const backBtn = document.getElementById('quests-dungeon-back');

    // Delegated click handler on the whole grid. Reads data-gate-rank
    // off the tapped cell, branches on locked-vs-unlocked. Replaces
    // the v2.0.2/2.0.3 handler that targeted #quests-gate-button by id.
    if (grid) {
      grid.addEventListener('click', (e) => {
        const cell = e.target.closest('.gate-cell[data-gate-rank]');
        if (!cell || !grid.contains(cell)) return;
        const rank = cell.getAttribute('data-gate-rank');
        if (!rank) return;
        // Soft-entry rule (v2.0.1): walk in if the rank is unlocked OR
        // has bosses to preview. Locked-with-no-content stays toast-only.
        if (!isGateEntryAllowed(rank)) {
          if (typeof showHabitToast === 'function') {
            showHabitToast('Reach ' + rank + ' rank to unlock');
          }
          return;
        }
        // Entry allowed → expand. The dungeon-view render decides
        // whether this is preview or live based on isGateUnlocked.
        currentDungeonRank = rank;
        questsGateExpanded = true;
        renderQuestsPanel();
      });
      // Keyboard: native <button> already dispatches click on Enter/
      // Space, so the delegated handler picks those up automatically.
    }
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        questsGateExpanded = false;
        renderQuestsPanel();
      });
    }
  }



  // Comeback sound — grounded determination, not triumphant
  function playComebackChime() {
    if (!soundEnabled) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime;
      // Simple A3 → D4 → A4 walking up — steady, resolved
      const notes = [
        { f: 220.00, s: 0.00, d: 0.32, p: 0.16 },
        { f: 293.66, s: 0.20, d: 0.32, p: 0.16 },
        { f: 440.00, s: 0.40, d: 0.95, p: 0.18 },
      ];
      notes.forEach(n => {
        ['sine', 'triangle'].forEach(type => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(n.f, t0 + n.s);
          osc.connect(gain); gain.connect(ac.destination);
          const peak = type === 'sine' ? n.p : n.p * 0.45;
          gain.gain.setValueAtTime(0.0001, t0 + n.s);
          gain.gain.exponentialRampToValueAtTime(peak, t0 + n.s + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.s + n.d);
          osc.start(t0 + n.s);
          osc.stop(t0 + n.s + n.d + 0.05);
        });
      });
    } catch (_) {}
  }

  function showComebackScreen(item) {
    const overlay = document.getElementById('comeback-screen');
    if (!overlay) { levelUpActive = false; drainLevelUpQueue(); return; }
    document.getElementById('cb-message').textContent = item.msg || 'The hunter who returns is stronger than the one who never fell.';
    document.getElementById('cb-xp').textContent      = '+' + item.xp + ' Resilience XP';

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('cb-show');
    playComebackChime();
    navigator.vibrate && navigator.vibrate([40, 30, 80]);

    const dismiss = () => {
      overlay.classList.remove('cb-show');
      overlay.classList.add('cb-hide');
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('cb-hide');
        overlay.classList.add('hidden');
        levelUpActive = false;
        drainLevelUpQueue();
      }, { once: true });
      overlay.removeEventListener('click', dismiss);
    };
    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 5500);
  }


  function renderCompoundProgress() {
    const wrap = document.getElementById('compound-progress');
    if (!wrap) return;
    // Show a row for every bonus pack the user has at least one habit in.
    // EXCEPT: hide the Morning Routine row when the user has truly committed
    // to the Locked-In path. Since LI's 16 = MR's 10 + 6 extras, any LI
    // habit count > 0 trivially fires (because MR habits also count toward
    // LI). We must check for at least one of the 6 LI-EXCLUSIVE extras
    // before suppressing the MR strip. Pure-MR users keep their MR row.
    const liExclusivelyActive = (function() {
      const liExtraNames = (typeof _LOCKED_IN_EXTRA_INDICES !== 'undefined' &&
                            typeof DEFAULT_HABITS !== 'undefined')
        ? new Set(_LOCKED_IN_EXTRA_INDICES.map(i => DEFAULT_HABITS[i] && DEFAULT_HABITS[i].name).filter(Boolean))
        : new Set();
      if (liExtraNames.size === 0) return false;
      return habits.some(h => liExtraNames.has(h.name));
    })();
    const rows = BONUS_PACK_IDS.map(packId => {
      if (packId === 'morning' && liExclusivelyActive) return '';
      if (packId === 'locked-in' && !liExclusivelyActive) return '';
      const { done, total } = getPackProgress(packId);
      if (total === 0) return '';
      const pack            = getPackById(packId);
      // Display total = canonical pack size (10 / 16) so users see how
      // close they are to the FULL bonus, not just to today's owned subset.
      const canonicalTotal  = getPackHabitDefs(packId).length;
      const awarded         = compoundAwarded[packId] === today;
      const cs              = compoundStreaks[packId];
      const streak          = cs && cs.streak > 0 && cs.lastDate === today ? cs.streak : 0;
      const cls             = packId === 'locked-in' ? ' cp-prog-row--lockedin' : '';
      // "Missing canonical habits" = how many of the pack's 10/16 habits the
      // user doesn't yet have in their active list. Different from "done" which
      // counts today's completions out of canonical total.
      const missingDefs   = (typeof getMissingPackHabits === 'function')
        ? getMissingPackHabits(packId)
        : (packId === 'morning' && typeof getMissingMorningHabits === 'function'
            ? getMissingMorningHabits() : []);
      const missingCount  = missingDefs.length;
      const hasMissing    = missingCount > 0 && !awarded;
      const addPill = hasMissing
        ? '<span class="cp-prog-add">+ ' + missingCount + ' missing</span>'
        : '';
      // Streak Shield indicator — show when ≥1 shield held for this pack
      const shieldCount = streakShields[packId] || 0;
      const shieldChip  = shieldCount > 0
        ? '<span class="cp-prog-shield" data-shield-info="' + esc(packId) + '" role="button" tabindex="0" aria-label="Streak Shields">🛡️ ' + shieldCount + '</span>'
        : '';
      // Honest Day chip — only when streak active, not completed today, all habits in,
      // and an Honest Day is still available this month
      const honestAvailable = streak > 0 && !awarded && !hasMissing &&
                              canMarkHonestDayToday(packId);
      const honestChip = honestAvailable
        ? '<span class="cp-prog-honest" data-honest-pack="' + esc(packId) + '" role="button" tabindex="0" aria-label="Mark today as Honest Rest">🌙 Rest</span>'
        : '';
      return '<div class="cp-prog-row' + cls + (hasMissing ? ' cp-prog-row--addable' : '') +
                  '" data-pack-add="' + esc(packId) + '" role="button" tabindex="0" ' +
                  'aria-label="' + esc(pack.name) + ' progress' + (hasMissing ? ' — tap to add missing habits' : '') + '">' +
        // Map pack id → custom pack-icon key. Falls back to iconify on
        // the raw emoji for any pack id that doesn't have a mapped icon.
        '<span class="cp-prog-name">' +
          (packId === 'morning'    ? packIconHtml('morning',  { size: 18 }) :
           packId === 'locked-in'  ? packIconHtml('lockedin', { size: 18 }) :
           iconify(pack.emoji, { size: 14 })) +
          ' ' + esc(pack.name) +
        '</span>' +
        '<span class="cp-prog-count' + (awarded ? ' cp-prog-done' : '') + '">' +
          (awarded ? '✓ Complete' : done + '/' + canonicalTotal) +
        '</span>' +
        // Tappable bolt → opens the Bonus Info popup explaining the formula + ROI
        '<button class="cp-prog-bolt" data-bonus-info aria-label="About the Compound Effect Bonus">' + xpIconHtml({ size: 22 }) + '</button>' +
        (streak > 0 ? '<span class="cp-prog-streak">Day ' + streak + ' ' + streakIconHtml({ size: 14 }) + '</span>' : '') +
        shieldChip +
        honestChip +
        addPill +
      '</div>';
    }).filter(Boolean).join('');
    if (rows) {
      wrap.innerHTML = rows;
      wrap.classList.remove('hidden');
    } else {
      wrap.classList.add('hidden');
    }
  }

  // ── PR STRIP RENDERING ───────────────────────────────────
  // Horizontal scrollable strip of 10 PR tiles for the Status tab.
  function _formatPRValue(prId, value) {
    if (prId === 'highest_rank') return value || '—';
    if (prId === 'total_xp_lifetime' || prId === 'most_xp_day') return Number(value || 0).toLocaleString();
    if (prId === 'total_habits_lifetime') return Number(value || 0).toLocaleString();
    return String(value || 0);
  }

  function _prTileAccent(def) {
    if (def.accent === 'stat') {
      // Use the stat's color from meta
      const meta = (personalRecords[def.id] || {}).meta || {};
      const stat = STATS.find(s => s.id === meta.statId);
      return stat ? stat.color : '#a78bfa';
    }
    return def.accent || '#a78bfa';
  }

  // Compact button on the Status tab — taps open the "All PRs" sheet.
  // The button shows a small headline plus a 1-line summary of standout PRs
  // (most-habits-day + active-days) so it never feels empty.
  function buildPRStripHTML() {
    // Compact chip — sits inline next to the name and rank.
    // Tap opens the full All-PRs grid sheet.
    return '<button id="pr-open-btn" class="pr-open-chip" aria-label="View Personal Records">' +
      '<span class="pr-open-icon">🏆</span>' +
      '<span class="pr-open-label">PR</span>' +
    '</button>';
  }

  function buildAllPRTilesHTML() {
    return PR_DEFS.map(def => {
      const rec    = personalRecords[def.id] || { value: 0 };
      const accent = _prTileAccent(def);
      const valStr = _formatPRValue(def.id, rec.value);
      return '<button class="pr-tile pr-tile--grid" data-pr-id="' + esc(def.id) + '" ' +
                  'style="--pr-accent:' + accent + '" ' +
                  'aria-label="View ' + esc(def.label) + ' record">' +
        // PR icon dropped — emoji-free pass. Tile reads via accent color + value.
        '<span class="pr-tile-value">' + esc(valStr) + '</span>' +
        '<span class="pr-tile-label">' + esc(def.label) + '</span>' +
      '</button>';
    }).join('');
  }

  function buildCompoundBadgesHTML() {
    return BONUS_PACK_IDS.filter(packId => {
      const cs = compoundStreaks[packId];
      return cs && cs.streak > 0;
    }).map(packId => {
      const pack = getPackById(packId);
      const s    = compoundStreaks[packId].streak;
      const iconHTML = packId === 'morning'   ? packIconHtml('morning',  { size: 14 }) :
                       packId === 'locked-in' ? packIconHtml('lockedin', { size: 14 }) :
                       iconify(packId === 'locked-in' ? '🔒' : '⚡', { size: 14 });
      return '<div class="sc-compound-badge">' + iconHTML + ' ' + esc(pack.name) + ': Day ' + s + '</div>';
    }).join('');
  }

  // ── SHARED HABIT INFO RENDERING ──────────────────────────
  // Populates a stat badge, description text node, and 4-cell stats
  // grid for any popup that displays habit performance info. Both the
  // History info popup (prefix 'hi') and the View Note bottom-sheet
  // (prefix 'vn') call this with the same habit so the data and styling
  // stay perfectly consistent across the two screens.
  function populateHabitInfoBlock(prefix, habit) {
    const statId  = getHabitPrimaryStat(habit);
    const stat    = STATS.find(s => s.id === statId) || STATS[0];

    // Stat badge
    const badge = document.getElementById(prefix + '-stat-badge');
    if (badge) {
      badge.style.background  = colorWithAlpha(stat.color, 0.16);
      badge.style.borderColor = colorWithAlpha(stat.color, 0.55);
      badge.style.color       = stat.color;
      badge.innerHTML =
        '<span class="hi-badge-icon">' + statIconHtml(stat, { size: 18 }) + '</span>' +
        '<span class="hi-badge-label">' + esc(stat.label) + ' · ' + esc(stat.name) + '</span>';
    }

    // Stat description
    const desc = document.getElementById(prefix + '-stat-desc');
    if (desc) desc.textContent = STAT_INFO_BLURB[statId] || STAT_INFO_BLURB.FOCUS;

    // Performance stats — 4 metrics shared across both popups
    const cur = document.getElementById(prefix + '-current');
    if (cur) cur.textContent = (streaks[habit.id] && streaks[habit.id].count) || 0;

    const week  = document.getElementById(prefix + '-week');
    if (week)  week.textContent  = computeWeekCompletionsForHabit(habit);

    const best  = document.getElementById(prefix + '-best');
    if (best)  best.textContent  = computeBestStreakForHabit(habit);

    const total = document.getElementById(prefix + '-total');
    if (total) total.textContent = computeTotalCompletionsForHabit(habit);

    // Reminder state — only the View Note sheet (prefix="vn") has this
    // section in the markup; History info popup (prefix="hi") doesn't.
    const remEl = document.getElementById(prefix + '-reminder-display');
    if (remEl) {
      let time = null;
      try { time = (Notif.reminderFor && Notif.reminderFor(habit.id)) || null; } catch (_) {}
      if (time) {
        const [hStr, mStr] = time.split(':');
        const h  = parseInt(hStr, 10) || 0;
        const m  = parseInt(mStr, 10) || 0;
        const pm = h >= 12;
        const h12 = ((h % 12) || 12);
        const label = h12 + ':' + String(m).padStart(2, '0') + ' ' + (pm ? 'PM' : 'AM');
        remEl.textContent = label;
        remEl.classList.add('vn-reminder-display--set');
        remEl.classList.remove('vn-reminder-display--none');
      } else {
        remEl.textContent = 'No reminder set';
        remEl.classList.add('vn-reminder-display--none');
        remEl.classList.remove('vn-reminder-display--set');
      }
    }
  }

  // ── VIEW NOTE — full habit detail bottom-sheet ───────────
  // Replaces the previous read-only note modal. Shows everything the
  // History info popup shows PLUS the editable personal note.
  let _vnHabitId    = null;
  let _vnPrevFocus  = null;

  function openNoteModal(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    _vnHabitId   = id;
    _vnPrevFocus = document.activeElement;

    // Header
    setHabitIcon(document.getElementById('note-modal-emoji'), habit, 56);
    document.getElementById('note-modal-name').textContent  = habitDisplayName(habit);
    const diffKey = habit.difficulty || 'easy';
    const diff    = DIFFICULTY[diffKey] || DIFFICULTY.easy;
    document.getElementById('vn-diff').textContent =
      diff.label + ' · +' + diff.pts + ' XP';
    document.getElementById('vn-diff').className =
      'vn-diff vn-diff--' + diffKey;

    // Shared stats block
    populateHabitInfoBlock('vn', habit);

    // System-managed message — shown for read-only auto-verify habits
    // (Daily walk, Sleep, Sleep before midnight per v2.0 policy). Sits
    // above the ABOUT-THIS-HABIT description so users opening the modal
    // via card tap (the read-only routing path) see the explainer
    // first. Body copy is per-habit so the message reads specifically
    // about the user's tapped habit, not generically.
    const sysEl = document.getElementById('vn-system-section');
    const sysBody = document.getElementById('vn-system-message');
    const isReadOnly = isReadOnlyAutoVerifyHabit(habit);
    if (sysEl) sysEl.classList.toggle('hidden', !isReadOnly);
    if (isReadOnly && sysBody) {
      sysBody.innerHTML = systemManagedHtmlFor(habit);
    }

    // Read-only canonical description from the habit library.
    // (Any user-typed notes from earlier versions remain in habitNotes
    // localStorage but are no longer displayed or editable — orphaned
    // intentionally, not deleted.)
    const noteEl = document.getElementById('vn-note-display');
    const desc   = getHabitDescription(habit);
    if (desc) {
      noteEl.textContent = desc;
      noteEl.classList.remove('vn-note-display--empty');
    } else {
      noteEl.textContent = 'Description coming soon.';
      noteEl.classList.add('vn-note-display--empty');
    }

    // Show
    document.getElementById('note-overlay').classList.remove('hidden');
    document.getElementById('note-modal').classList.remove('hidden');
  }

  function closeNoteModal() {
    document.getElementById('note-overlay').classList.add('hidden');
    document.getElementById('note-modal').classList.add('hidden');
    _vnHabitId = null;
    if (_vnPrevFocus && typeof _vnPrevFocus.focus === 'function') {
      try { _vnPrevFocus.focus(); } catch (_) {}
    }
    _vnPrevFocus = null;
  }

  function setupNoteModal() {
    const overlay = document.getElementById('note-overlay');
    const sheet   = document.getElementById('note-modal');
    const closeBtn = document.getElementById('note-close-btn');
    const editBtn  = document.getElementById('vn-edit-btn');
    if (!overlay || !sheet) return;

    overlay.addEventListener('click', closeNoteModal);
    closeBtn.addEventListener('click', closeNoteModal);

    // Edit pencil → existing Edit Habit flow
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const id = _vnHabitId;
        closeNoteModal();
        if (id) openEditModal(id);
      });
    }

    // Swipe-down-to-dismiss via the shared utility
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, () => {
        sheet.classList.add('hidden');
        overlay.classList.add('hidden');
        _vnHabitId = null;
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.vn-drag-handle, .vn-header',
        scrollTarget:   '.vn-body',
      });
    }

    // ESC key dismiss
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) {
        closeNoteModal();
      }
    });
  }

  // ── WHAT'S NEW SHEET ─────────────────────────────────────
  // Auto-shows once on first launch after an update. Manually
  // re-openable from Settings → "What's New".
  const WHATS_NEW_SEEN_KEY = 'hb_whats_new_seen';

  function getStoredWhatsNewSeen() {
    try { return localStorage.getItem(WHATS_NEW_SEEN_KEY) || ''; } catch (_) { return ''; }
  }
  function setStoredWhatsNewSeen(version) {
    try { localStorage.setItem(WHATS_NEW_SEEN_KEY, version); } catch (_) {}
  }

  function openWhatsNewSheet(opts) {
    opts = opts || {};
    const overlay = document.getElementById('wn-overlay');
    const sheet   = document.getElementById('wn-sheet');
    if (!overlay || !sheet) return;

    const version = getLatestWhatsNewVersion();
    const data    = WHATS_NEW[version];
    if (!data) return;

    document.getElementById('wn-subtitle').textContent =
      'Version ' + version + ' — ' + data.subtitle;

    const list = document.getElementById('wn-list');
    list.innerHTML = '';
    (data.items || []).forEach(item => {
      const row = document.createElement('div');
      row.className = 'wn-item';
      row.innerHTML =
        '<span class="wn-item-emoji">' + item.emoji + '</span>' +
        '<div class="wn-item-text">' +
          '<div class="wn-item-title">' + esc(item.title) + '</div>' +
          '<div class="wn-item-desc">' + esc(item.description) + '</div>' +
        '</div>';
      list.appendChild(row);
    });

    // Track whether THIS open was an auto-show (counts as "seen")
    sheet.dataset.wnAuto = opts.manual ? '0' : '1';

    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }

  function closeWhatsNewSheet() {
    const overlay = document.getElementById('wn-overlay');
    const sheet   = document.getElementById('wn-sheet');
    if (!overlay || !sheet) return;
    // Only mark as seen when this was an auto-show (or manually-closed
    // auto-show). Manual opens from Settings don't update the flag.
    if (sheet.dataset.wnAuto === '1') {
      const version = getLatestWhatsNewVersion();
      if (version) setStoredWhatsNewSeen(version);
    }
    overlay.classList.add('hidden');
    sheet.classList.add('hidden');
    sheet.dataset.wnAuto = '0';
  }

  function setupWhatsNewSheet() {
    const overlay  = document.getElementById('wn-overlay');
    const sheet    = document.getElementById('wn-sheet');
    const closeBtn = document.getElementById('wn-close-btn');
    if (!overlay || !sheet || !closeBtn) return;

    closeBtn.addEventListener('click', closeWhatsNewSheet);
    overlay.addEventListener('click', closeWhatsNewSheet);

    // Spec: "Tap anywhere ... to dismiss" — clicking the sheet itself
    // (except interactive children) dismisses too.
    sheet.addEventListener('click', e => {
      if (e.target.closest('.wn-close-btn')) return; // already handled
      closeWhatsNewSheet();
    });

    // Swipe-down dismiss via the shared utility
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, closeWhatsNewSheet, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.wn-drag-handle, .wn-header',
        scrollTarget:   '.wn-list',
      });
    }

    // ESC dismiss on desktop
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) {
        closeWhatsNewSheet();
      }
    });
  }

  // Auto-show the What's New sheet on first launch after an update.
  // Skipped during onboarding (handled by finishOnboarding setting the
  // seen-version directly), and skipped if the user has already seen
  // the latest version.
  function maybeAutoShowWhatsNew() {
    const latest = getLatestWhatsNewVersion();
    if (!latest) return;
    const seen = getStoredWhatsNewSeen();
    if (seen && compareSemver(seen, latest) >= 0) return;
    // Defer slightly so the underlying app render settles first
    setTimeout(() => openWhatsNewSheet({ manual: false }), 480);
  }

  // ── DAILY INSIGHT (Morning Briefing) — v1.1.5 ─────────────
  // Once-per-day full-screen bottom sheet with a featured habit, two
  // lines of context (builds / compounds), three quick stats, and a
  // single CTA ("ENTER THE DAY"). Fires on:
  //   - End of init() for fully-onboarded users (after What's New)
  //   - visibilitychange resume from background
  // Both paths gate via shouldShowDailyInsight(); persistence in
  // hb_daily_insight_last_shown ensures it only fires once per
  // device-local calendar day.

  function shouldShowDailyInsight() {
    // Welcome / onboarding users skip — they're already in another flow.
    if (localStorage.getItem('hb_welcomed') !== '1') return false;
    if (!habits || habits.length === 0) return false;

    // Day 1 grace period — origin date is today's local date. The user
    // is fresh from onboarding; don't pile another modal on top.
    const todayLocal = getDeviceLocalDate();
    const originDate = (originBeginning && originBeginning.dateISO) || null;
    if (originDate === todayLocal) return false;

    // Already shown today → wait until tomorrow.
    if (localStorage.getItem('hb_daily_insight_last_shown') === todayLocal) return false;

    // Don't preempt other live modals. If What's New is currently up,
    // skip this fire — visibilitychange will retry next resume, by
    // which time the user will have dismissed What's New.
    const whatsNewSheet = document.getElementById('whats-new-sheet');
    if (whatsNewSheet && !whatsNewSheet.classList.contains('hidden')) return false;
    const beginningScreen = document.getElementById('beginning-screen');
    if (beginningScreen && !beginningScreen.classList.contains('hidden')) return false;

    return true;
  }

  // Composes the "{N} OBJECTIVES. {M} SYSTEM-VERIFIED. {K} ON YOU."
  // status line. Pure function of the user's active habits + current
  // HealthKit availability/grant/pause state.
  function composeBriefingStatusLine() {
    const total = (habits && habits.length) || 0;
    if (total === 0) return '';  // card shouldn't render anyway, defensive
    const auto = habits.filter(canAutoVerify).length;
    const manual = total - auto;
    if (auto === 0)         return total + ' OBJECTIVES. ALL ON YOU.';
    if (auto === total)     return total + ' OBJECTIVES. ALL SYSTEM-VERIFIED.';
    return total + ' OBJECTIVES. ' + auto + ' SYSTEM-VERIFIED. ' + manual + ' ON YOU.';
  }

  // Build a single habit row for the briefing slate. Pure HTML
  // string — caller injects into the appropriate group container.
  // Layout: [colored difficulty dot] [name · goal] [verify tag] [+XP]
  function buildBriefingRow(habit) {
    const diff = (DIFFICULTY[habit.difficulty] || DIFFICULTY.easy);
    const parts = (typeof habitDisplayParts === 'function')
      ? habitDisplayParts(habit) : { base: habit.name, goal: null };
    const display = parts.goal ? (parts.base + ' · ' + parts.goal) : parts.base;
    const verifyTag = canAutoVerify(habit)
      ? '<span class="di-row-verify">Apple Health verifies</span>'
      : '';
    return (
      '<div class="di-row">' +
        '<span class="di-row-dot di-row-dot--' + (habit.difficulty || 'easy') + '"></span>' +
        '<div class="di-row-main">' +
          '<span class="di-row-name">' + esc(display) + '</span>' +
          verifyTag +
        '</div>' +
        '<span class="di-row-xp">+' + diff.pts + '</span>' +
      '</div>'
    );
  }

  function showDailyInsight() {
    if (!shouldShowDailyInsight()) return;

    const sheet   = document.getElementById('daily-insight-sheet');
    const overlay = document.getElementById('daily-insight-overlay');
    if (!sheet || !overlay) return;

    // ── Header: "THU · MAY 7 · DAY 11" + "TODAY'S BRIEFING" ──
    const headerEl = document.getElementById('di-header-line');
    if (headerEl) {
      const d = new Date();
      const days   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
      const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const dayCount = getDaysSinceOrigin();
      let line = days[d.getDay()] + ' · ' + months[d.getMonth()] + ' ' + d.getDate();
      if (dayCount != null) line += ' · DAY ' + dayCount;
      headerEl.textContent = line;
    }

    // ── Tactical status line ──
    const statusEl = document.getElementById('di-status-line');
    if (statusEl) statusEl.textContent = composeBriefingStatusLine();

    // ── Habit slate, grouped by time of day ──
    // Bucket the user's active habits, then render the three groups
    // (morning / day / evening) in fixed order. Empty groups skipped.
    const buckets = { morning: [], day: [], evening: [] };
    habits.forEach(h => {
      const bucket = getHabitTimeOfDay(h);
      (buckets[bucket] || buckets.day).push(h);
    });
    const groupConfig = [
      { id: 'morning', label: 'MORNING' },
      { id: 'day',     label: 'DAY'     },
      { id: 'evening', label: 'EVENING' },
    ];
    const slateEl = document.getElementById('di-slate');
    if (slateEl) {
      const html = groupConfig.map(g => {
        const list = buckets[g.id];
        if (!list.length) return '';
        return (
          '<div class="di-group">' +
            '<div class="di-group-label">' + g.label + '</div>' +
            list.map(buildBriefingRow).join('') +
          '</div>'
        );
      }).join('');
      slateEl.innerHTML = html;
    }

    // ── WHERE YOU STAND ──
    const xpEl     = document.getElementById('di-xp');
    const streakEl = document.getElementById('di-streak');
    const daysEl   = document.getElementById('di-days');
    if (xpEl)     xpEl.textContent     = totalPoints.toLocaleString();
    if (streakEl) streakEl.textContent = (perfectStreak && perfectStreak.count) || 0;
    if (daysEl) {
      const daysActive = Object.keys(completions || {}).filter(d =>
        Array.isArray(completions[d]) && completions[d].length > 0
      ).length;
      daysEl.textContent = daysActive;
    }

    // ── Show ──
    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }

  function dismissDailyInsight() {
    const sheet   = document.getElementById('daily-insight-sheet');
    const overlay = document.getElementById('daily-insight-overlay');
    if (sheet)   sheet.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
    // Persist last-shown AFTER dismissal so an interrupted-mid-show
    // (process kill) still gets retried on next launch.
    try { localStorage.setItem('hb_daily_insight_last_shown', getDeviceLocalDate()); }
    catch (_) {}
  }

  function setupDailyInsight() {
    const sheet   = document.getElementById('daily-insight-sheet');
    const overlay = document.getElementById('daily-insight-overlay');
    const cta     = document.getElementById('di-enter-btn');
    if (!sheet || !overlay) return;

    if (cta)     cta.addEventListener('click', dismissDailyInsight);
    if (overlay) overlay.addEventListener('click', dismissDailyInsight);

    // Drag-down dismiss — same pattern as other bottom sheets.
    if (typeof attachSheetDismissGesture === 'function') {
      attachSheetDismissGesture(sheet, overlay, dismissDailyInsight, {
        scrollTarget: '.di-body',
      });
    }
  }

  // ── EDIT MODAL ───────────────────────────────────────────
  let editGoalValue = 0;
  // HealthKit step-goal staging for the Edit Habit modal. editStepGoal
  // holds the in-flight value; editStepGoalEnabled gates whether the
  // step-goal control replaces the time/count stepper for this open.
  // Mirrors editGoalValue's pattern — staging, not in-place mutation,
  // so Cancel doesn't need to undo anything.
  let editStepGoal = HEALTHKIT_WALK_DEFAULT_THRESHOLD;
  let editStepGoalEnabled = false;
  // Sleep-goal staging — same pattern, mutually exclusive with both
  // the step-goal control and the time/count stepper.
  let editSleepGoal = HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
  let editSleepGoalEnabled = false;

  function refreshEditGoalDisplay() {
    const habit = habits.find(h => h.id === editingId);
    if (!habit) return;
    const m = MEASURABLE_HABITS[habit.name];
    if (!m) return;
    document.getElementById('edit-goal-val').textContent = editGoalValue.toLocaleString() + ' ' + m.unit;
  }

  // Updates the step-goal display + chip-active state in the Edit Habit
  // modal to match editStepGoal. Called from openEditModal and from
  // every chip / Save handler.
  function refreshEditStepGoalDisplay() {
    const valueEl = document.getElementById('edit-stepgoal-value');
    if (valueEl) valueEl.textContent = editStepGoal.toLocaleString() + ' steps';
    const isCustom = !HEALTHKIT_WALK_PRESETS.includes(editStepGoal);
    document.querySelectorAll('#edit-stepgoal .habit-edit-stepgoal-chip').forEach(chip => {
      const preset = chip.dataset.preset;
      let active;
      if (preset === 'custom') active = isCustom;
      else                     active = parseInt(preset, 10) === editStepGoal;
      chip.classList.toggle('habit-edit-stepgoal-chip--active', active);
    });
  }

  // Sleep-goal display refresh — mirrors refreshEditStepGoalDisplay but
  // for the Sleep habit's chip picker. Hours-formatted ("7 hours" /
  // "8.5 hours"); pluralization handled by `=== 1` check (3–14 range
  // never produces "1 hours" since min is 3, but kept defensively).
  function refreshEditSleepGoalDisplay() {
    const valueEl = document.getElementById('edit-sleepgoal-value');
    if (valueEl) {
      const h = editSleepGoal;
      valueEl.textContent = h + (h === 1 ? ' hour' : ' hours');
    }
    const isCustom = !HEALTHKIT_SLEEP_PRESETS.includes(editSleepGoal);
    document.querySelectorAll('#edit-sleepgoal .habit-edit-stepgoal-chip').forEach(chip => {
      const preset = chip.dataset.preset;
      let active;
      if (preset === 'custom') active = isCustom;
      else                     active = parseFloat(preset) === editSleepGoal;
      chip.classList.toggle('habit-edit-stepgoal-chip--active', active);
    });
  }

  function openEditModal(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    editingId     = id;
    editFormEmoji = habit.emoji || '';
    editFormDiff  = habit.difficulty || 'easy';
    document.getElementById('edit-input').value = habit.name;
    setActiveDiff('edit-diff-row', editFormDiff);

    // Canonical habits: lock name + emoji + difficulty because those
    // are foreign keys for HABIT_ICONS, AUTO_VERIFY, HABIT_TIME_OF_DAY,
    // etc. Renaming or re-emojifying a canonical habit silently breaks
    // every per-name lookup. Lock applied via class on the modal +
    // readOnly on the name input + an early-return in the emoji
    // button click handler (see setupEditModal). (v1.1.6)
    const modal = document.getElementById('edit-modal');
    const canonical = isCanonicalHabit(habit);
    if (modal) modal.classList.toggle('edit-modal--canonical', canonical);
    const nameInput = document.getElementById('edit-input');
    if (nameInput) nameInput.readOnly = canonical;
    // Hide the "Tap to choose an emoji" hint when locked.
    const emojiHint = document.querySelector('#edit-modal .emoji-row-hint');
    if (emojiHint) emojiHint.classList.toggle('hidden', canonical);
    // The combined help line below the difficulty pill — broaden the
    // copy when the whole header (name/emoji/difficulty) is locked.
    const diffHelp = document.querySelector('#edit-modal .edit-diff-help');
    if (diffHelp) {
      diffHelp.textContent = canonical
        ? "Name, emoji, and difficulty are set by the habit type and can't be changed."
        : "Difficulty is set by the habit type and can't be changed.";
    }
    // Render the emoji-button content. For canonical habits, prefer
    // the DALL-E icon (via setHabitIcon) so the button matches what
    // the Habits tab card shows. For custom habits, fall back to the
    // emoji glyph picker pattern. setHabitIcon already falls back to
    // emoji.textContent if no DALL-E icon is mapped for this name. (v1.1.6)
    const emojiBtn = document.getElementById('edit-emoji-btn');
    if (canonical) {
      setHabitIcon(emojiBtn, habit, 36);
      if (editFormEmoji || getHabitIcon(habit)) emojiBtn.classList.add('has-emoji');
      else emojiBtn.classList.remove('has-emoji');
    } else {
      setEmojiBtn(emojiBtn, editFormEmoji);
    }

    // Goal control — mutually exclusive between three branches:
    //   (1) step-goal chips     (canonical "Daily walk")
    //   (2) sleep-goal chips    (canonical "Sleep")
    //   (3) time/count stepper  (every other measurable habit)
    // The bedtime habit ("Sleep before midnight") is binary — none of
    // the three render for it (it's not in MEASURABLE_HABITS).
    const stepGoalEl  = document.getElementById('edit-stepgoal');
    const sleepGoalEl = document.getElementById('edit-sleepgoal');
    const goalRow     = document.getElementById('edit-goal-row');
    editStepGoalEnabled  = isStepGoalHabit(habit);
    editSleepGoalEnabled = isSleepDurationHabit(habit);

    if (editStepGoalEnabled) {
      editStepGoal = getHabitStepGoal(habit);
      stepGoalEl.hidden  = false;
      sleepGoalEl.hidden = true;
      goalRow.classList.add('hidden');
      document.getElementById('edit-stepgoal-custom').classList.add('hidden');
      refreshEditStepGoalDisplay();
    } else if (editSleepGoalEnabled) {
      editSleepGoal = getSleepGoalHours(habit);
      stepGoalEl.hidden  = true;
      sleepGoalEl.hidden = false;
      goalRow.classList.add('hidden');
      document.getElementById('edit-sleepgoal-custom').classList.add('hidden');
      refreshEditSleepGoalDisplay();
    } else {
      stepGoalEl.hidden  = true;
      sleepGoalEl.hidden = true;
      // Existing time/count stepper path.
      const m = MEASURABLE_HABITS[habit.name];
      if (m) {
        editGoalValue = habit.goal ? habit.goal.value : m.def;
        document.getElementById('edit-goal-label').textContent = habit.name + ' goal';
        refreshEditGoalDisplay();
        goalRow.classList.remove('hidden');
      } else {
        goalRow.classList.add('hidden');
      }
    }

    // Read-only reminder display — shows the time if one is set,
    // hides the section entirely otherwise.
    refreshEditReminderUI(id);

    document.getElementById('edit-modal').classList.remove('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
    setTimeout(() => { const i = document.getElementById('edit-input'); i.focus(); i.select(); }, 80);
  }

  // Renders the Edit Habit reminder section as a READ-ONLY display
  // (v1.1.6). Shows the current per-habit reminder time if one is
  // set; hides the section entirely otherwise. Set / Change / Remove
  // happens via the Schedule sheet (⋯ → Schedule), which uses the
  // working openDigestTimePickerModal. The previous editable version
  // tried to fire <input type="time">.showPicker() on a hidden 0×0
  // input, which anchored badly cross-platform — see v1.1.6 changelog.
  function refreshEditReminderUI(habitId) {
    const row = document.getElementById('edit-reminder-row');
    const display = document.getElementById('edit-reminder-time-display');
    if (!row || !display) return;
    const time = Notif.reminderFor(habitId);
    if (time) {
      display.textContent = formatTime12(time);
      row.classList.remove('hidden');
    } else {
      row.classList.add('hidden');
    }
  }

  // Sensible default reminder time for a habit based on its category.
  // Morning habits → 7:00, Locked-In varies, everything else → 8:00.
  function defaultReminderTimeFor(habit) {
    if (!habit) return '08:00';
    if (isMorningHabit(habit)) return '07:00';
    const evening = ['Read', 'Journal', 'Plan tomorrow the night before',
                     'No screens 1 hour before bed', 'Sleep before midnight',
                     'Review investments or trading journal'];
    if (evening.indexOf(habit.name) >= 0) return '21:00';
    if (habit.primaryStat === 'STR' && /workout|cardio|train|sprint/i.test(habit.name || '')) return '06:00';
    return '08:00';
  }

  function formatTime12(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return hhmm;
    let h = parseInt(m[1], 10); const mm = m[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return h + ':' + mm + ' ' + ampm;
  }

  function closeEditModal() {
    closeEmojiPicker();
    document.getElementById('edit-modal').classList.add('hidden');
    document.getElementById('modal-overlay').classList.add('hidden');
    editingId = null;
  }

  function commitEdit() {
    const name = document.getElementById('edit-input').value.trim();
    if (!name || !editingId) return;
    const habit = habits.find(h => h.id === editingId);
    if (habit) {
      // v2.0.1 edit-floor enforcement for step-goal habits. Catches the
      // case where an existing user's habit already has a sub-8K goal
      // stored — they open the modal, don't change anything, tap Save.
      // The custom-input commit path validates only user-typed values;
      // this catches "no change but stored value is sub-floor."
      if (editStepGoalEnabled && editStepGoal < HEALTHKIT_WALK_EDIT_FLOOR) {
        try {
          if (typeof showHabitToast === 'function') {
            showHabitToast('Minimum 8,000 steps. The discipline starts here.');
          }
        } catch (_) {}
        return; // don't close modal, don't save
      }
      // Canonical habits: ignore name/emoji from the form (the inputs
      // are visually locked, but defense in depth — never let a
      // canonical habit's foreign-key fields get rewritten through
      // this surface). difficulty is already read-only-by-CSS in the
      // diff-row, but skip the assignment too for parity. (v1.1.6)
      if (!isCanonicalHabit(habit)) {
        habit.name = name; habit.emoji = editFormEmoji; habit.difficulty = editFormDiff;
      }
      // Persist HealthKit goal if the modal was in step-goal OR
      // sleep-goal mode. Each is staged inline as user taps chips
      // (editStepGoal / editSleepGoal); we commit here so Cancel
      // doesn't accidentally persist a staged value.
      if (editStepGoalEnabled) {
        habit.stepGoal = editStepGoal;
        // Threshold change may immediately auto-check today if user's
        // current step count is past the new goal — clear the cache so
        // renderHabits → autoVerifyWalk re-queries fresh.
        try { Health.clearCache && Health.clearCache(); } catch (_) {}
      } else if (editSleepGoalEnabled) {
        habit.sleepGoalHours = editSleepGoal;
        // Same logic for sleep — if last night's sleep already exceeds
        // the new goal, the next renderHabits will auto-check.
        try { Health.clearSleepCache && Health.clearSleepCache(); } catch (_) {}
      } else {
        // Time/count stepper path (mutually exclusive with both above).
        const m = MEASURABLE_HABITS[habit.name];
        if (m) habit.goal = { value: editGoalValue, unit: m.unit };
      }
      save(); renderHabits();
    }
    closeEditModal();
  }

  function setupEditModal() {
    document.getElementById('modal-overlay').addEventListener('click', closeEditModal);
    document.getElementById('cancel-edit-btn').addEventListener('click', closeEditModal);
    document.getElementById('save-edit-btn').addEventListener('click', commitEdit);
    document.getElementById('edit-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') closeEditModal();
    });
    document.getElementById('edit-emoji-btn').addEventListener('click', () => {
      // Canonical habits: emoji is locked. See openEditModal for why.
      const habit = habits.find(h => h.id === editingId);
      if (isCanonicalHabit(habit)) return;
      const btn = document.getElementById('edit-emoji-btn');
      openEmojiPicker(btn, editFormEmoji, em => { editFormEmoji = em; setEmojiBtn(btn, em); });
    });
    // Difficulty is intentionally read-only on the Edit Habit screen —
    // a habit's difficulty is a property of the canonical library entry,
    // not user-adjustable. CSS (.diff-row--locked) handles the visual.
    // No click listener attached on purpose.
    document.getElementById('edit-goal-dec').addEventListener('click', () => {
      const habit = habits.find(h => h.id === editingId);
      const m = habit && MEASURABLE_HABITS[habit.name];
      if (m && editGoalValue - m.step >= m.min) { editGoalValue -= m.step; refreshEditGoalDisplay(); }
    });
    document.getElementById('edit-goal-inc').addEventListener('click', () => {
      const habit = habits.find(h => h.id === editingId);
      const m = habit && MEASURABLE_HABITS[habit.name];
      if (m) { editGoalValue += m.step; refreshEditGoalDisplay(); }
    });

    // ── HealthKit step-goal control (Edit Habit modal) ───────
    // Preset chips stage editStepGoal in memory; commitEdit persists it
    // to habit.stepGoal. "Custom" reveals the inline numeric input.
    const stepGoalChips = document.getElementById('edit-stepgoal');
    if (stepGoalChips) {
      stepGoalChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.habit-edit-stepgoal-chip');
        if (!chip) return;
        const preset = chip.dataset.preset;
        if (preset === 'custom') {
          const customRow = document.getElementById('edit-stepgoal-custom');
          customRow.classList.remove('hidden');
          const input = document.getElementById('edit-stepgoal-input');
          input.value = String(editStepGoal);
          setTimeout(() => input.focus(), 50);
          return;
        }
        const n = parseInt(preset, 10);
        if (!Number.isFinite(n)) return;
        editStepGoal = n;
        document.getElementById('edit-stepgoal-custom').classList.add('hidden');
        refreshEditStepGoalDisplay();
      });
    }
    const stepGoalSave   = document.getElementById('edit-stepgoal-save');
    const stepGoalCancel = document.getElementById('edit-stepgoal-cancel');
    const stepGoalInput  = document.getElementById('edit-stepgoal-input');
    const commitStepGoal = () => {
      if (!stepGoalInput) return;
      const parsed = parseInt(stepGoalInput.value, 10);
      // Reject sub-8K values explicitly per the v2.0.1 edit-floor.
      // Silent clamping (the old behavior) was misleading — user typed
      // 5000 and got 8000 back without explanation. Toast + keep the
      // custom input open so they can fix it.
      if (!Number.isFinite(parsed) || parsed < HEALTHKIT_WALK_EDIT_FLOOR) {
        try {
          if (typeof showHabitToast === 'function') {
            showHabitToast('Minimum 8,000 steps. The discipline starts here.');
          }
        } catch (_) {}
        return;
      }
      // Clamp upper bound silently — 50K is the absolute ceiling.
      editStepGoal = Math.min(HEALTHKIT_WALK_THRESHOLD_MAX, parsed);
      document.getElementById('edit-stepgoal-custom').classList.add('hidden');
      refreshEditStepGoalDisplay();
    };
    if (stepGoalSave)  stepGoalSave.addEventListener('click', commitStepGoal);
    if (stepGoalInput) stepGoalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitStepGoal(); });
    if (stepGoalCancel) {
      stepGoalCancel.addEventListener('click', () => {
        document.getElementById('edit-stepgoal-custom').classList.add('hidden');
      });
    }

    // ── HealthKit sleep-goal control (Edit Habit modal) ──────
    // Same staging/commit pattern as the step-goal control above. Chip
    // values are HOURS (string-encoded in data-preset for symmetry with
    // the step picker). Custom input accepts 0.5-step floats.
    const sleepGoalChips = document.getElementById('edit-sleepgoal');
    if (sleepGoalChips) {
      sleepGoalChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.habit-edit-stepgoal-chip');
        if (!chip) return;
        const preset = chip.dataset.preset;
        if (preset === 'custom') {
          const customRow = document.getElementById('edit-sleepgoal-custom');
          customRow.classList.remove('hidden');
          const input = document.getElementById('edit-sleepgoal-input');
          input.value = String(editSleepGoal);
          setTimeout(() => input.focus(), 50);
          return;
        }
        const n = parseFloat(preset);
        if (!Number.isFinite(n)) return;
        editSleepGoal = n;
        document.getElementById('edit-sleepgoal-custom').classList.add('hidden');
        refreshEditSleepGoalDisplay();
      });
    }
    const sleepGoalSave   = document.getElementById('edit-sleepgoal-save');
    const sleepGoalCancel = document.getElementById('edit-sleepgoal-cancel');
    const sleepGoalInput  = document.getElementById('edit-sleepgoal-input');
    const commitSleepGoal = () => {
      if (!sleepGoalInput) return;
      // Same clamping logic as setSleepGoalHours, applied to staging only.
      const parsed = parseFloat(sleepGoalInput.value);
      const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
      editSleepGoal = Math.max(HEALTHKIT_SLEEP_GOAL_MIN_HOURS, Math.min(HEALTHKIT_SLEEP_GOAL_MAX_HOURS, fallback));
      document.getElementById('edit-sleepgoal-custom').classList.add('hidden');
      refreshEditSleepGoalDisplay();
    };
    if (sleepGoalSave)  sleepGoalSave.addEventListener('click', commitSleepGoal);
    if (sleepGoalInput) sleepGoalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitSleepGoal(); });
    if (sleepGoalCancel) {
      sleepGoalCancel.addEventListener('click', () => {
        document.getElementById('edit-sleepgoal-custom').classList.add('hidden');
      });
    }

    // Reminder picker block removed in v1.1.6 — see index.html note.
    // Per-habit reminders now live exclusively on the Schedule sheet
    // (⋯ → Schedule), which uses openDigestTimePickerModal.
  }

  // Permission explainer modal — shown once before the iOS native prompt.
  function showNotifExplainer(callback, opts) {
    opts = opts || {};
    const ov = document.getElementById('notif-explain-overlay');
    if (!ov) { callback && callback(true); return; }

    // Allow callers to override copy/labels for context (onboarding A vs.
    // in-edit prompt). Defaults are the in-edit copy that already shipped.
    const titleEl = ov.querySelector('.custom-title');
    const subEl   = ov.querySelector('.custom-sub');
    const cancelBtn = document.getElementById('notif-explain-cancel');
    const enableBtn = document.getElementById('notif-explain-enable');
    const _origTitle  = titleEl ? titleEl.innerHTML  : '';
    const _origSub    = subEl   ? subEl.innerHTML    : '';
    const _origCancel = cancelBtn ? cancelBtn.textContent : '';
    const _origEnable = enableBtn ? enableBtn.textContent : '';
    if (opts.title  && titleEl) titleEl.innerHTML = opts.title;
    if (opts.body   && subEl)   subEl.innerHTML   = opts.body;
    if (opts.cancelLabel && cancelBtn) cancelBtn.textContent = opts.cancelLabel;
    if (opts.enableLabel && enableBtn) enableBtn.textContent = opts.enableLabel;

    ov.classList.remove('hidden');
    const finish = (ok) => {
      ov.classList.add('hidden');
      // Restore originals so the next caller (e.g., in-edit) gets default copy.
      if (titleEl)  titleEl.innerHTML  = _origTitle;
      if (subEl)    subEl.innerHTML    = _origSub;
      if (cancelBtn) cancelBtn.textContent = _origCancel;
      if (enableBtn) enableBtn.textContent = _origEnable;
      try { callback && callback(ok); } catch (_) {}
    };
    cancelBtn.onclick = () => finish(false);
    enableBtn.onclick = () => finish(true);
  }

  // ── Onboarding A: ask for notification permission once, before the
  //   user starts adding habits. Skipped if we've already asked. Resolves
  //   when the user taps either button (cb is called, fire-and-forget).
  async function runOnboardingNotifPrompt(cb) {
    try {
      if (Notif.permAskedBefore && Notif.permAskedBefore()) { cb && cb(); return; }
    } catch (_) {}
    showNotifExplainer(async (ok) => {
      if (!ok) {
        // "Maybe Later" → mark BOTH the deferred flag and the
        // perm-asked flag so A never fires a second time. The spec
        // expects A to fire at most once per user.
        try {
          localStorage.setItem('hb_notif_perm_deferred', '1');
          localStorage.setItem('hb_notif_perm_requested', '1');
        } catch (_) {}
        cb && cb();
        return;
      }
      try {
        const granted = await Notif.requestPermission();
        if (granted === 'granted') {
          // Schedule the once-a-day digest at 9:00 AM by default. The
          // confirmation toast lets the user scroll the time chip to
          // change it inline, no Settings trip required.
          try { await Notif.setDailyDigest('09:00'); } catch (_) {}
          if (typeof showReminderConfirmToast === 'function') {
            showReminderConfirmToast('09:00');
          }
        } else {
          if (typeof showHabitToast === 'function') {
            showHabitToast('Reminders are off. Enable in iOS Settings → Awakened anytime.', { sticky: true });
          }
        }
      } catch (_) {}
      cb && cb();
    }, {
      title: 'Stay on Track',
      body:  'One morning reminder.<br>The rest is on you.',
      cancelLabel: 'Maybe Later',
      enableLabel: 'Enable Reminder',
    });
  }

  // ── Onboarding B: per-session offer counter so we don't spam users
  //   who keep skipping. Resets on app reload (NOT persisted). After
  //   3 consecutive skips, B no-ops for the rest of the session.
  let _reminderOfferSkipCount = 0;
  const REMINDER_OFFER_SKIP_LIMIT = 3;

  function _shouldOfferReminder() {
    return _reminderOfferSkipCount < REMINDER_OFFER_SKIP_LIMIT;
  }

  // Single-habit B: open the offer modal for one habit.
  function offerHabitReminder(habit) {
    if (!habit) return;
    if (!_shouldOfferReminder()) return;
    if (!_remOfferEls()) return;
    // If a habit already has a reminder set (e.g., user re-added something),
    // don't re-prompt.
    try { if (Notif.reminderFor && Notif.reminderFor(habit.id)) return; } catch (_) {}

    const els = _remOfferEls();
    els.title.textContent = '📲 Want a reminder for it?';
    els.sub.innerHTML     = '✅ <strong>' + esc(habit.name) + '</strong> added.<br>Pick a time and we\'ll remind you daily.';
    els.timeRow.style.display = '';
    els.timeInput.value = (typeof defaultReminderTimeFor === 'function')
      ? defaultReminderTimeFor(habit)
      : '07:00';
    els.skipBtn.textContent = 'Skip';
    els.saveBtn.textContent = 'Set Reminder';
    els.overlay.classList.remove('hidden');

    els.skipBtn.onclick = () => {
      _reminderOfferSkipCount++;
      els.overlay.classList.add('hidden');
    };
    els.saveBtn.onclick = async () => {
      _reminderOfferSkipCount = 0;
      const t = els.timeInput.value || '07:00';
      els.overlay.classList.add('hidden');
      try { await Notif.setReminder(habit.id, t); } catch (_) {}
      // If permission was denied at A, surface that the reminder won't
      // actually deliver. The reminder is still saved.
      try {
        const perm = await Notif.checkPermission();
        if (perm !== 'granted' && typeof showHabitToast === 'function') {
          showHabitToast('Reminder saved. Enable notifications in iOS Settings to receive it.');
        }
      } catch (_) {}
    };
  }

  // Pack B: ONE offer for an entire pack add. Defaults to 7:00 AM
  //   per the spec; user can adjust each habit later via Edit Habit.
  function offerPackReminders(addedHabits) {
    if (!addedHabits || !addedHabits.length) return;
    if (!_shouldOfferReminder()) return;
    if (!_remOfferEls()) return;

    const els = _remOfferEls();
    const n   = addedHabits.length;
    els.title.textContent = '📲 Set Default Reminders?';
    els.sub.innerHTML     = 'Set <strong>7:00 AM</strong> reminders for these <strong>' + n +
                            '</strong> habit' + (n === 1 ? '' : 's') +
                            '?<br>You can adjust each later in Edit Habit.';
    // Hide the time input — pack mode uses a fixed default of 07:00.
    els.timeRow.style.display = 'none';
    els.skipBtn.textContent = 'No reminders';
    els.saveBtn.textContent = 'Yes, set defaults';
    els.overlay.classList.remove('hidden');

    els.skipBtn.onclick = () => {
      _reminderOfferSkipCount++;
      els.overlay.classList.add('hidden');
    };
    els.saveBtn.onclick = async () => {
      _reminderOfferSkipCount = 0;
      els.overlay.classList.add('hidden');
      try {
        for (const h of addedHabits) {
          // defaultReminderTimeFor handles habit-specific defaults (e.g.,
          // "Sleep before midnight" → 23:00). Pack default 07:00 is used
          // only when nothing more specific applies.
          const t = (typeof defaultReminderTimeFor === 'function' ? defaultReminderTimeFor(h) : '07:00') || '07:00';
          await Notif.setReminder(h.id, t);
        }
      } catch (_) {}
      try {
        const perm = await Notif.checkPermission();
        if (perm !== 'granted' && typeof showHabitToast === 'function') {
          showHabitToast('Reminders saved. Enable notifications in iOS Settings to receive them.');
        } else if (typeof showHabitToast === 'function') {
          showHabitToast('✓ ' + n + ' reminder' + (n === 1 ? '' : 's') + ' set');
        }
      } catch (_) {}
    };
  }

  function _remOfferEls() {
    const overlay  = document.getElementById('reminder-offer-overlay');
    if (!overlay) return null;
    return {
      overlay,
      title:    document.getElementById('reminder-offer-title'),
      sub:      document.getElementById('reminder-offer-sub'),
      timeRow:  document.getElementById('reminder-offer-time-row'),
      timeInput:document.getElementById('reminder-offer-time'),
      skipBtn:  document.getElementById('reminder-offer-skip'),
      saveBtn:  document.getElementById('reminder-offer-save'),
    };
  }

  function setupReminderOfferModal() {
    const overlay = document.getElementById('reminder-offer-overlay');
    if (!overlay) return;
    // Backdrop tap = skip
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        const skip = document.getElementById('reminder-offer-skip');
        if (skip) skip.click();
      }
    });
  }

  // ── DELETE ───────────────────────────────────────────────
  function deleteHabit(id) {
    habits = habits.filter(h => h.id !== id);
    for (const d in completions) completions[d] = completions[d].filter(x => x !== id);
    delete streaks[id];
    save();
    // Permanently cancel this habit's reminder + drop it from storage.
    try { Notif.clearReminder(id); } catch (_) {}
    renderHabits();
  }

  // ── EMOJI PICKER ─────────────────────────────────────────
  function setEmojiBtn(btn, emoji) {
    if (emoji) { btn.textContent = emoji; btn.classList.add('has-emoji'); }
    else       { btn.textContent = '';    btn.classList.remove('has-emoji'); }
  }

  function openEmojiPicker(anchorBtn, currentEmoji, onSelect) {
    pickerCallback = onSelect;
    const grid = document.getElementById('emoji-grid');
    grid.innerHTML = '';
    EMOJIS.forEach(em => {
      const b = document.createElement('button');
      b.className = 'emoji-opt' + (em === currentEmoji ? ' selected' : '');
      b.textContent = em; b.type = 'button';
      b.addEventListener('click', e => { e.stopPropagation(); pickerCallback && pickerCallback(em); closeEmojiPicker(); });
      grid.appendChild(b);
    });
    const picker = document.getElementById('emoji-picker');
    picker.classList.remove('hidden');
    document.getElementById('emoji-overlay').classList.remove('hidden');
    const r = anchorBtn.getBoundingClientRect();
    const pw = 236, ph = 220;
    let left = r.left, top = r.bottom + 6;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 6;
    picker.style.left = Math.max(8, left) + 'px';
    picker.style.top  = Math.max(8, top)  + 'px';
  }

  function closeEmojiPicker() {
    document.getElementById('emoji-picker').classList.add('hidden');
    document.getElementById('emoji-overlay').classList.add('hidden');
    pickerCallback = null;
  }

  function setupEmojiPicker() {
    document.getElementById('emoji-overlay').addEventListener('click', closeEmojiPicker);
    document.getElementById('emoji-overlay').addEventListener('touchstart', closeEmojiPicker, { passive: true });
    document.getElementById('emoji-clear-btn').addEventListener('click', () => { pickerCallback && pickerCallback(''); closeEmojiPicker(); });
  }

  // ── DRAG & DROP — long-press to reorder ────────────────────
  // Existing implementation used a dedicated 6-dot handle. This rewrite
  // adds long-press (400ms hold on the card body) as the primary trigger
  // while keeping the [data-drag] handle as an instant-drag fallback.
  // Order persists via the in-memory `habits` array → save() → hb_habits
  // localStorage. Pack streaks (MR, LI) are pack-membership-based, not
  // list-position-based, so visual reorder doesn't affect them.
  const LONG_PRESS_MS         = 400;
  const LP_MOVE_THRESHOLD     = 10;     // px — finger movement that cancels long-press
  const DRAG_IDLE_TIMEOUT_MS  = 1500;   // exit drag mode if no movement after this
  const AUTOSCROLL_EDGE       = 80;     // px from viewport edge that triggers scroll
  const POST_DROP_GUARD_MS    = 200;    // suppress immediate re-trigger after a drop

  let drag = null;
  let _postDropGuardUntil = 0;

  function bindDrag() {
    const list = document.getElementById('habit-list');
    if (!list) return;
    // Long-press on the entire card body — primary trigger.
    list.querySelectorAll('.habit-item[data-id]').forEach(item => {
      attachLongPressDrag(item);
    });
    // Instant-drag from the dedicated 6-dot handle (preserved as fallback).
    list.querySelectorAll('[data-drag]').forEach(handle => {
      handle.addEventListener('touchstart', onHandleStart, { passive: false });
      handle.addEventListener('mousedown',  onHandleStart);
    });
  }

  function clientPos(e) {
    if (e.touches && e.touches.length)               return { x: e.touches[0].clientX,        y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function attachLongPressDrag(item) {
    const onStart = (e) => {
      if (Date.now() < _postDropGuardUntil) return;
      // Skip if the press starts on an interactive sub-element. Tapping
      // those should still feel like a tap, not a wait-for-drag.
      if (e.target.closest('[data-drag]')) return;       // dedicated handle owns its own path
      if (e.target.closest('[data-more]')) return;       // "more" menu button
      if (e.target.closest('.habit-cb'))    return;      // checkbox itself

      const isTouch = e.type === 'touchstart';
      if (!isTouch && e.button !== 0) return;

      const start = clientPos(e);
      let canceled  = false;
      let triggered = false;
      item.classList.add('lp-pressing');

      const pressTimer = setTimeout(() => {
        if (canceled) return;
        triggered = true;
        item.classList.remove('lp-pressing');
        // Convert the long-press into an active drag.
        enterDragMode(item, start, isTouch);
      }, LONG_PRESS_MS);

      const onMove = (me) => {
        const mp = clientPos(me);
        if (Math.abs(mp.x - start.x) > LP_MOVE_THRESHOLD ||
            Math.abs(mp.y - start.y) > LP_MOVE_THRESHOLD) {
          canceled = true;
          clearTimeout(pressTimer);
          cleanup();
        }
      };
      const onEnd = () => {
        if (!triggered) {
          // User released before long-press fired — let the click bubble normally.
          canceled = true;
          clearTimeout(pressTimer);
        }
        cleanup();
      };
      function cleanup() {
        item.classList.remove('lp-pressing');
        if (isTouch) {
          document.removeEventListener('touchmove',   onMove);
          document.removeEventListener('touchend',    onEnd);
          document.removeEventListener('touchcancel', onEnd);
        } else {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onEnd);
        }
      }
      if (isTouch) {
        document.addEventListener('touchmove',   onMove, { passive: true });
        document.addEventListener('touchend',    onEnd,  { once: true });
        document.addEventListener('touchcancel', onEnd,  { once: true });
      } else {
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onEnd, { once: true });
      }
    };
    item.addEventListener('touchstart', onStart, { passive: true });
    item.addEventListener('mousedown',  onStart);
  }

  // Dedicated-handle path: skip the 400ms long-press, drag immediately.
  function onHandleStart(e) {
    const isTouch = e.type === 'touchstart';
    if (!isTouch && e.button !== 0) return;
    if (isTouch) e.preventDefault();
    const item = e.currentTarget.closest('[data-id]');
    if (!item) return;
    enterDragMode(item, clientPos(e), isTouch);
  }

  function enterDragMode(item, startPos, isTouch) {
    if (drag) return; // already dragging
    const list = document.getElementById('habit-list');
    const rect = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.className = 'habit-item drag-ghost';
    ghost.style.width = rect.width + 'px';
    ghost.style.left  = rect.left  + 'px';
    ghost.style.top   = rect.top   + 'px';
    document.body.appendChild(ghost);
    item.classList.add('drag-placeholder');
    list.classList.add('is-dragging');

    // Prevent body scroll + selection while dragging.
    const bodyOverflow = document.body.style.overflow;
    document.body.style.userSelect       = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.cursor           = 'grabbing';
    document.body.style.overflow         = 'hidden';

    drag = {
      id:           item.dataset.id,
      item,
      ghost,
      // The grid is 3-column, so the ghost has to follow both axes.
      offsetX:      startPos.x - rect.left,
      offsetY:      startPos.y - rect.top,
      isTouch,
      lastX:        startPos.x,
      lastY:        startPos.y,
      bodyOverflow,
      idleTimer:    null,
      autoScrollRAF: null,
    };
    resetIdleTimer();
    startAutoScrollLoop();

    navigator.vibrate && navigator.vibrate(50);

    if (isTouch) {
      document.addEventListener('touchmove',   onDragMove, { passive: false });
      document.addEventListener('touchend',    onDragEnd,  { once: true });
      document.addEventListener('touchcancel', onDragEnd,  { once: true });
    } else {
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup',   onDragEnd, { once: true });
    }
  }

  function onDragMove(e) {
    if (!drag) return;
    if (e.type === 'touchmove') e.preventDefault();
    const { x, y } = clientPos(e);
    drag.lastX = x;
    drag.lastY = y;
    drag.ghost.style.left = (x - drag.offsetX) + 'px';
    drag.ghost.style.top  = (y - drag.offsetY) + 'px';
    resetIdleTimer();
    const items = getOtherItems();
    items.forEach(el => el.classList.remove('drop-target--before', 'drop-target--after'));
    const target = findDropTarget(items, x, y);
    if (target) target.el.classList.add(target.before ? 'drop-target--before' : 'drop-target--after');
  }

  function onDragEnd(e) {
    if (!drag) return;
    const isTouch = drag.isTouch;
    if (isTouch) document.removeEventListener('touchmove', onDragMove);
    else         document.removeEventListener('mousemove', onDragMove);

    // Restore body styles
    document.body.style.userSelect       = '';
    document.body.style.webkitUserSelect = '';
    document.body.style.cursor           = '';
    document.body.style.overflow         = drag.bodyOverflow || '';

    // Stop helpers
    clearTimeout(drag.idleTimer);
    if (drag.autoScrollRAF) cancelAnimationFrame(drag.autoScrollRAF);

    const items = getOtherItems();
    items.forEach(el => el.classList.remove('drop-target--before', 'drop-target--after'));

    const { x, y } = clientPos(e);
    const target = findDropTarget(items, x, y);
    if (target && target.el.dataset.id !== drag.id) {
      const fromIdx = habits.findIndex(h => h.id === drag.id);
      const [moved] = habits.splice(fromIdx, 1);
      const toIdx   = habits.findIndex(h => h.id === target.el.dataset.id);
      habits.splice(target.before ? toIdx : toIdx + 1, 0, moved);
      save();
      navigator.vibrate && navigator.vibrate(15);
    }
    drag.ghost.remove();
    drag.item.classList.remove('drag-placeholder');
    drag = null;
    document.getElementById('habit-list').classList.remove('is-dragging', 'reorder-mode');
    _postDropGuardUntil = Date.now() + POST_DROP_GUARD_MS;
    renderHabits();
  }

  function resetIdleTimer() {
    if (!drag) return;
    if (drag.idleTimer) clearTimeout(drag.idleTimer);
    drag.idleTimer = setTimeout(() => {
      // No movement for too long — exit drag silently, no reorder.
      cancelDragSilently();
    }, DRAG_IDLE_TIMEOUT_MS);
  }

  function cancelDragSilently() {
    if (!drag) return;
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('mousemove', onDragMove);
    document.body.style.userSelect       = '';
    document.body.style.webkitUserSelect = '';
    document.body.style.cursor           = '';
    document.body.style.overflow         = drag.bodyOverflow || '';
    if (drag.autoScrollRAF) cancelAnimationFrame(drag.autoScrollRAF);
    const items = getOtherItems();
    items.forEach(el => el.classList.remove('drop-target--before', 'drop-target--after'));
    drag.ghost.remove();
    drag.item.classList.remove('drag-placeholder');
    drag = null;
    document.getElementById('habit-list').classList.remove('is-dragging', 'reorder-mode');
    _postDropGuardUntil = Date.now() + POST_DROP_GUARD_MS;
  }

  function startAutoScrollLoop() {
    // The Habits panel itself scrolls (#main-scroll). Fall back to
    // window scroll if for some reason that element is unavailable.
    const scroller = document.getElementById('main-scroll') || document.scrollingElement || document.documentElement;
    function tick() {
      if (!drag) return;
      const y    = drag.lastY;
      const top  = AUTOSCROLL_EDGE;
      const bot  = window.innerHeight - AUTOSCROLL_EDGE;
      let dy = 0;
      if (y < top)      dy = -Math.max(2, (top - y) / 6);
      else if (y > bot) dy =  Math.max(2, (y - bot) / 6);
      if (dy !== 0 && scroller && typeof scroller.scrollTop === 'number') {
        scroller.scrollTop += dy;
      }
      drag.autoScrollRAF = requestAnimationFrame(tick);
    }
    drag.autoScrollRAF = requestAnimationFrame(tick);
  }

  function getOtherItems() {
    return [...document.getElementById('habit-list').querySelectorAll('[data-id]')]
      .filter(el => !el.classList.contains('drag-placeholder'));
  }

  // 2D drop targeting for the 3-column grid layout. Pick the cell whose
  // center is closest to the cursor (Euclidean), then split it: cursor
  // on the LEFT half = drop "before" this cell in the linear habit array,
  // RIGHT half = "after". This gives 2N insertion slots for N visible
  // cells and naturally handles drops between rows or off the grid edge.
  function findDropTarget(items, clientX, clientY) {
    if (!items.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const el of items) {
      const r  = el.getBoundingClientRect();
      const cx = r.left + r.width  / 2;
      const cy = r.top  + r.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best     = { el, cx };
      }
    }
    if (!best) return null;
    return { el: best.el, before: clientX < best.cx };
  }

  // ── STAT DETAIL SHEET ────────────────────────────────────
  // Build a quick emoji+difficulty lookup from DEFAULT_HABITS
  const _habitMeta = {};
  DEFAULT_HABITS.forEach(h => { _habitMeta[h.name] = { emoji: h.emoji, difficulty: h.difficulty }; });

  function openStatDetail(statId) {
    const st     = STATS.find(s => s.id === statId);
    if (!st) return;
    const stPts  = stats[st.id]?.pts || 0;
    const level  = statLevel(stPts);
    const lvXP   = xpForLevel(level);
    const ptsIn  = stPts - lvXP;
    const needed = xpToNextLevel(level);
    const pct    = level >= 20 ? 100 : Math.min(100, Math.round((ptsIn / needed) * 100));
    const toNext = level >= 20 ? 0 : needed - ptsIn;

    const sheet  = document.getElementById('stat-detail-sheet');
    const glow   = st.color + '20';

    // Track which stat is open so the delegated Add handler knows
    // which stat's habit list to refresh after an add.
    sheet.dataset.statId = st.id;

    // Set CSS colour variables
    sheet.style.setProperty('--sd-color', st.color);
    sheet.style.setProperty('--sd-glow',  glow);

    // Header
    document.getElementById('stat-detail-badge').style.background  = st.color + '18';
    document.getElementById('stat-detail-badge').style.borderColor = st.color;
    setStatIcon(document.getElementById('stat-detail-icon'), st, 56); // Stat Detail sheet header
    document.getElementById('stat-detail-label').textContent = st.label;
    document.getElementById('stat-detail-name').textContent  = st.name;
    document.getElementById('stat-detail-level').textContent =
      'Level ' + level + (level >= 20 ? '  ·  MAX 👑' : '');

    // Progress bar (animate after paint; gold when maxed)
    const bar    = document.getElementById('stat-detail-prog-bar');
    const barClr = level >= 20 ? '#f59e0b' : st.color;
    bar.style.background = barClr;
    bar.style.boxShadow  = '0 0 8px ' + barClr;
    bar.style.width      = '0%';
    document.getElementById('stat-detail-pts').textContent    = ptsIn + ' XP';
    document.getElementById('stat-detail-tonext').textContent =
      level >= 20 ? 'MAX LEVEL' : toNext + ' XP to Level ' + (level + 1);

    // XP summary row
    document.getElementById('stat-detail-cur-xp').textContent   = ptsIn.toLocaleString() + ' XP';
    document.getElementById('stat-detail-total-xp').textContent = stPts.toLocaleString() + ' XP';

    // Description
    document.getElementById('stat-detail-desc').textContent = STAT_DESCRIPTIONS[st.id] || '';

    // Linked habits — each row shows an Add button if the user doesn't
    // have the habit yet, or an "Active" indicator if they do. Tap → add.
    renderStatDetailHabits(st);

    // Show sheet
    document.getElementById('stat-detail-overlay').classList.remove('hidden');
    sheet.classList.remove('hidden');
    requestAnimationFrame(() => {
      sheet.classList.add('sd-open');
      setTimeout(() => { bar.style.width = pct + '%'; }, 80);
    });

    navigator.vibrate && navigator.vibrate(8);
  }

  function closeStatDetail() {
    const sheet   = document.getElementById('stat-detail-sheet');
    const overlay = document.getElementById('stat-detail-overlay');
    sheet.classList.remove('sd-open');
    sheet.addEventListener('transitionend', () => {
      sheet.classList.add('hidden');
      overlay.classList.add('hidden');
    }, { once: true });
  }

  // Render the linked-habits list for a given stat. Each row gets either
  // a "+ Add" tap target (if the user doesn't have the habit) or a muted
  // "✓ Active" badge (if they do). Used both on initial open and after
  // an in-sheet add to refresh state.
  function renderStatDetailHabits(st) {
    const listEl = document.getElementById('stat-detail-habits');
    if (!listEl) return;
    const activeNames = new Set(habits.map(h => h.name));
    listEl.innerHTML = st.habits.map(name => {
      const meta = _habitMeta[name] || { emoji: '', difficulty: 'medium' };
      const have = activeNames.has(name);
      const ctrl = have
        ? '<span class="sdh-active" aria-label="Already in your habits">✓ Active</span>'
        : '<button class="sdh-add-btn" data-add-habit="' + esc(name) + '" aria-label="Add ' + esc(name) + ' to your habits">+ Add</button>';
      // Synthesize a habit-like object for habitIconHtml — _habitMeta
      // only stores { emoji, difficulty }, but the helper just needs
      // .name and .emoji to decide between PNG and emoji fallback.
      const habitLike = { name, emoji: meta.emoji };
      return '<div class="sdh-row' + (have ? ' sdh-row--have' : '') + '">' +
        '<span class="sdh-emoji">' + habitIconHtml(habitLike, { size: 20 }) + '</span>' +
        '<span class="sdh-name">'  + esc(name) + '</span>' +
        '<span class="diff-badge ' + meta.difficulty + '">' + DIFFICULTY[meta.difficulty].label + '</span>' +
        ctrl +
      '</div>';
    }).join('');
  }

  // Adds a canonical habit to the user's active list (idempotent).
  // Called when the user taps "+ Add" on a linked-habit row in the
  // stat detail sheet. Refreshes the row in place.
  function addHabitFromStatSheet(name, statId) {
    if (habits.some(h => h.name === name)) return;
    const def = DEFAULT_HABITS.find(d => d.name === name);
    if (!def) return;
    const newH = {
      id:          uid(),
      emoji:       def.emoji,
      name:        def.name,
      difficulty:  def.difficulty,
      type:        def.type || 'build',
      primaryStat: def.primaryStat,
    };
    habits.push(newH);
    if (def.note) habitNotes[newH.id] = def.note;
    save();
    renderHabits();
    updateMorningButtonVisibility();
    updateLockedInButtonVisibility();
    // Re-render the linked-habits list so the row flips to "Active"
    const st = STATS.find(s => s.id === statId);
    if (st) renderStatDetailHabits(st);
    showHabitToast(name + ' added');
  }

  function setupStatDetail() {
    document.getElementById('stat-detail-close').addEventListener('click',   closeStatDetail);
    document.getElementById('stat-detail-overlay').addEventListener('click', closeStatDetail);

    // Delegated tap on any "+ Add" button inside the linked-habits list.
    // Looks up the current stat from the sheet to refresh the row in place.
    const sheet = document.getElementById('stat-detail-sheet');
    if (sheet) {
      sheet.addEventListener('click', e => {
        const t = e.target;
        if (!t || !t.closest) return;
        const btn = t.closest('[data-add-habit]');
        if (!btn) return;
        e.stopPropagation();
        e.preventDefault();
        const name = btn.getAttribute('data-add-habit');
        // Stat ID is captured from the sheet's currently-rendered context
        // by reading the title's stat label (set by openStatDetail).
        const statId = sheet.dataset.statId || '';
        addHabitFromStatSheet(name, statId);
      });
    }

    // Swipe-down-to-dismiss
    if (typeof attachSheetDismissGesture === 'function') {
      const sd = document.getElementById('stat-detail-sheet');
      const so = document.getElementById('stat-detail-overlay');
      // Direct hide — gesture has already animated the slide-down, so we
      // skip closeStatDetail (which waits for its own transitionend that
      // won't fire because the sheet is already off-screen).
      attachSheetDismissGesture(sd, so, () => {
        sd.classList.add('hidden');
        so.classList.add('hidden');
      }, {
        baseTransform:  'translateX(-50%) ',
        handleSelector: '.stat-detail-drag-handle, .stat-detail-header',
        openClass:      'sd-open',
        scrollTarget:   '.stat-detail-habits-list',
      });
    }
  }

  // ── SETTINGS & RESET ─────────────────────────────────────
  function openSettings() {
    const sheet = document.getElementById('settings-sheet');
    document.getElementById('settings-overlay').classList.remove('hidden');
    sheet.classList.remove('hidden');
    requestAnimationFrame(() => sheet.classList.add('ss-open'));
  }

  function closeSettings() {
    const sheet = document.getElementById('settings-sheet');
    sheet.classList.remove('ss-open');
    sheet.addEventListener('transitionend', () => {
      sheet.classList.add('hidden');
      document.getElementById('settings-overlay').classList.add('hidden');
    }, { once: true });
  }

  // ── BOTTOM-SHEET DISMISS GESTURE (reusable) ──────────────
  // Attaches swipe/drag-down-to-dismiss to a bottom sheet element.
  //   sheet         — the sheet DOM element (must already be styled as bottom sheet)
  //   overlay       — backdrop element to fade (or null)
  //   onDismiss     — callback to fully hide sheet+overlay after slide-out completes
  //   opts:
  //     baseTransform     — base transform string preserved during drag (default 'translateX(-50%) ')
  //     handleSelector    — CSS selector for top "drag-zone" elements (drag works from these even
  //                         when content is scrolled). Anywhere else, we only drag if scrollTop===0.
  //     dismissThreshold  — fraction of sheet height beyond which release dismisses (default 0.30)
  //     flickVelocity     — px/ms downward velocity that counts as a "flick" (default 0.6)
  //     openClass         — class indicating sheet is open (default 'ss-open')
  function attachSheetDismissGesture(sheet, overlay, onDismiss, opts) {
    opts = opts || {};
    const baseTransform    = opts.baseTransform    || 'translateX(-50%) ';
    const handleSelector   = opts.handleSelector   || '.settings-drag-handle, .settings-header';
    const dismissThreshold = opts.dismissThreshold || 0.30;
    const flickVelocity    = opts.flickVelocity    || 0.6;
    const openClass        = opts.openClass        || 'ss-open';
    // Optional inner scrollable child selector. When the sheet has
    // overflow: hidden and a nested scrollable element (e.g., lib-sheet
    // wraps lib-list), point this at that child so we can correctly tell
    // whether the user is at the top vs scrolling content.
    const scrollTargetSel  = opts.scrollTarget     || null;

    let startY = 0, lastY = 0, lastTime = 0, velocity = 0;
    let dragging = false, allowDrag = false, mouseDown = false;

    function getY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }

    function getScrollEl() {
      if (!scrollTargetSel) return sheet;
      return sheet.querySelector(scrollTargetSel) || sheet;
    }

    function onStart(e) {
      if (sheet.classList.contains('hidden')) return;
      startY   = getY(e);
      lastY    = startY;
      lastTime = e.timeStamp || Date.now();
      velocity = 0;
      dragging = false;

      // Allow drag-to-dismiss only if user starts in the header/handle region,
      // OR the sheet's internal scroll is already at the very top.
      // Otherwise this is a regular content scroll — don't hijack it.
      const inHandle = e.target && e.target.closest && e.target.closest(handleSelector);
      const scrollEl = getScrollEl();
      const atTop    = scrollEl.scrollTop <= 0;
      allowDrag = !!inHandle || atTop;
    }

    function onMove(e) {
      if (!allowDrag || sheet.classList.contains('hidden')) return;
      const y  = getY(e);
      const dy = y - startY;

      // Only track downward movement
      if (dy <= 0) {
        if (dragging) {
          // User reversed direction — let it snap back gently
          sheet.style.transition = 'transform 0.18s ease-out';
          sheet.style.transform  = '';
          if (overlay) overlay.style.opacity = '';
          dragging = false;
        }
        return;
      }

      if (!dragging) {
        dragging = true;
        sheet.style.transition = 'none';
        if (overlay) overlay.style.transition = 'none';
      }

      // Suppress native scroll/rubber-band while we drag
      if (e.cancelable) e.preventDefault();

      sheet.style.transform = baseTransform + 'translateY(' + dy + 'px)';

      if (overlay) {
        const sheetH = sheet.offsetHeight || 1;
        const fade   = Math.min(1, dy / sheetH);
        overlay.style.opacity = String(1 - fade * 0.85);
      }

      // Track instantaneous velocity for flick detection
      const now = e.timeStamp || Date.now();
      const dt  = now - lastTime;
      if (dt > 0) velocity = (y - lastY) / dt;
      lastY    = y;
      lastTime = now;
    }

    function onEnd() {
      mouseDown = false;
      if (!dragging) return;
      dragging = false;

      const dy            = lastY - startY;
      const sheetH        = sheet.offsetHeight || 1;
      const overThreshold = dy > sheetH * dismissThreshold;
      const flicked       = velocity > flickVelocity;

      if (overThreshold || flicked) {
        // Slide the rest of the way down, then run dismiss callback
        sheet.style.transition = 'transform 0.22s ease-in';
        sheet.style.transform  = baseTransform + 'translateY(' + sheetH + 'px)';
        if (overlay) {
          overlay.style.transition = 'opacity 0.22s ease-in';
          overlay.style.opacity    = '0';
        }
        sheet.addEventListener('transitionend', function done() {
          // Order matters: call onDismiss first so the sheet is hidden
          // (display:none) BEFORE we clear inline transforms — otherwise
          // sheets without an openClass would briefly snap back to their
          // base on-screen position.
          sheet.classList.remove(openClass);
          if (typeof onDismiss === 'function') onDismiss();
          sheet.style.transition = '';
          sheet.style.transform  = '';
          if (overlay) {
            overlay.style.transition = '';
            overlay.style.opacity    = '';
          }
        }, { once: true });
      } else {
        // Snap back to fully open
        sheet.style.transition = 'transform 0.25s ease-out';
        sheet.style.transform  = '';
        if (overlay) {
          overlay.style.transition = 'opacity 0.25s ease-out';
          overlay.style.opacity    = '';
        }
        sheet.addEventListener('transitionend', function done() {
          sheet.style.transition = '';
          if (overlay) overlay.style.transition = '';
        }, { once: true });
      }
    }

    // Touch
    sheet.addEventListener('touchstart',  onStart, { passive: true  });
    sheet.addEventListener('touchmove',   onMove,  { passive: false }); // need preventDefault
    sheet.addEventListener('touchend',    onEnd,   { passive: true  });
    sheet.addEventListener('touchcancel', onEnd,   { passive: true  });

    // Mouse (desktop PWA)
    sheet.addEventListener('mousedown', e => { mouseDown = true; onStart(e); });
    document.addEventListener('mousemove', e => { if (mouseDown) onMove(e); });
    document.addEventListener('mouseup',   ()   => { if (mouseDown) onEnd();   });
  }

  function showReset1() {
    closeSettings();
    // Small delay so settings sheet closes first
    setTimeout(() => {
      document.getElementById('reset1-overlay').classList.remove('hidden');
      document.getElementById('reset1-modal').classList.remove('hidden');
    }, 180);
  }

  function closeReset1() {
    document.getElementById('reset1-overlay').classList.add('hidden');
    document.getElementById('reset1-modal').classList.add('hidden');
  }

  function showReset2() {
    closeReset1();
    const input = document.getElementById('reset-type-input');
    input.value = '';
    input.classList.remove('valid');
    document.getElementById('reset2-confirm').disabled = true;
    document.getElementById('reset2-overlay').classList.remove('hidden');
    document.getElementById('reset2-modal').classList.remove('hidden');
    setTimeout(() => input.focus(), 120);
  }

  function closeReset2() {
    document.getElementById('reset2-overlay').classList.add('hidden');
    document.getElementById('reset2-modal').classList.add('hidden');
  }

  function performReset() {
    // Clear all hb_ keys from localStorage
    Object.keys(localStorage)
      .filter(k => k.startsWith('hb_'))
      .forEach(k => localStorage.removeItem(k));
    // Hard reload → welcome screen shows for fresh user
    location.href = location.href.split('?')[0] + '?r=' + Date.now();
  }

  // ── CHECK FOR UPDATES ────────────────────────────────────
  // Belt-and-suspenders update detection:
  //   1) Ask the SW to re-check by calling reg.update() and listening for
  //      the standard 'updatefound' / 'statechange' events.
  //   2) IN PARALLEL, fetch sw.js directly with a cache-busting query and
  //      parse out CACHE_VERSION. If it differs from what we have stored
  //      from the last successful registration, treat that as an update —
  //      even if the SW system didn't fire 'updatefound' (race condition,
  //      Safari quirk, byte-compare false-negative).
  //   3) If everything reports stale, treat as up-to-date.
  //
  // When an update IS detected, we wipe ALL caches before reloading so the
  // new SW pre-caches from the network instead of inheriting a stale entry
  // through the cache-first fetch handler.
  const SW_KNOWN_VERSION_KEY = 'hb_sw_known_version';

  function parseSwVersion(text) {
    // Match: const CACHE_VERSION = 'v4.90';
    const m = text.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  }

  function checkForUpdates() {
    const btn   = document.getElementById('update-check-btn');
    const label = document.getElementById('update-check-label');
    if (!btn || !label) return;

    btn.disabled = true;
    btn.classList.add('update-btn--checking');
    label.textContent = 'Checking...';

    // No SW support → treat as up to date
    if (!('serviceWorker' in navigator)) {
      setTimeout(resolveUpToDate, 600);
      return;
    }

    let resolved = false;

    // ── Path A: standard SW update check ─────────────────────
    const swPath = navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;
      if (reg.waiting) { resolveUpdateFound(reg.waiting); return; }

      // Listen for a NEW worker entering the installing state
      const onUpdateFound = () => {
        const incoming = reg.installing;
        if (!incoming) return;
        const onStateChange = () => {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            incoming.removeEventListener('statechange', onStateChange);
            resolveUpdateFound(incoming);
          }
        };
        incoming.addEventListener('statechange', onStateChange);
      };
      reg.addEventListener('updatefound', onUpdateFound);
      // ALSO check if a worker is already installing right now (race-safe)
      if (reg.installing) onUpdateFound();
      return reg.update().catch(() => {});
    }).catch(() => {});

    // ── Path B: direct version-string comparison (fallback) ──
    const versionPath = fetch('sw.js?_=' + Date.now(), { cache: 'no-store' })
      .then(r => r.ok ? r.text() : '')
      .then(parseSwVersion)
      .catch(() => null);

    // Wait for either path to settle, with a 4-second ceiling so the
    // user always gets feedback even on flaky networks.
    Promise.allSettled([swPath, versionPath, wait(2500)]).then(async () => {
      if (resolved) return;
      const liveVersion   = await versionPath;
      const knownVersion  = (() => {
        try { return localStorage.getItem(SW_KNOWN_VERSION_KEY); } catch (_) { return null; }
      })();
      if (liveVersion && knownVersion && liveVersion !== knownVersion) {
        // Version drift detected — force a hard refresh path. This handles
        // the case where the SW is "controlling" us with a stale CACHE_VERSION
        // but we have an even newer sw.js sitting on the server that didn't
        // get registered as an update for whatever reason.
        return forceHardRefresh(liveVersion);
      }
      resolveUpToDate();
    });

    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    function resolveUpdateFound(worker) {
      if (resolved) return;
      resolved = true;
      btn.classList.remove('update-btn--checking');
      btn.classList.add('update-btn--found');
      label.textContent = 'Update found! Reloading...';
      setTimeout(() => {
        // Wipe caches first so the new SW activates with a clean slate.
        // controllerchange handler in registerSW() calls location.reload()
        // once the new SW takes over.
        clearAllCaches().finally(() => {
          worker.postMessage({ type: 'SKIP_WAITING' });
        });
      }, 1200);
    }

    async function forceHardRefresh(newVersion) {
      if (resolved) return;
      resolved = true;
      btn.classList.remove('update-btn--checking');
      btn.classList.add('update-btn--found');
      label.textContent = 'Update found! Reloading...';
      try { localStorage.setItem(SW_KNOWN_VERSION_KEY, newVersion); } catch (_) {}
      try {
        await clearAllCaches();
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch (_) {}
      setTimeout(() => location.reload(), 800);
    }

    function clearAllCaches() {
      if (!window.caches) return Promise.resolve();
      return caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
    }

    function resolveUpToDate() {
      if (resolved) return;
      resolved = true;
      btn.classList.remove('update-btn--checking');
      btn.classList.add('update-btn--uptodate');
      label.textContent = "You're up to date ✓";
      btn.disabled = false;
      setTimeout(() => {
        btn.classList.remove('update-btn--uptodate');
        label.textContent = 'Check for Updates';
      }, 2000);
    }
  }

  function setupSettings() {
    // Apply sound state on open
    document.getElementById('settings-btn').addEventListener('click', () => {
      document.getElementById('sound-toggle').setAttribute('aria-checked', soundEnabled ? 'true' : 'false');
      // Refresh the Reminders panel each time Settings opens — the
      // permission state, paused-until timestamp, and active count can
      // all change between opens.
      refreshRemindersPanel();
      // Refresh the Apple Health panel each time Settings opens — the
      // user may have changed permission state in iOS Settings between
      // opens, and the header summary needs to reflect that immediately.
      refreshHealthPanel();
      openSettings();
    });

    // Sound toggle
    document.getElementById('sound-toggle').addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('hb_sound', soundEnabled ? 'on' : 'off');
      document.getElementById('sound-toggle').setAttribute('aria-checked', soundEnabled ? 'true' : 'false');
    });
    // Close settings
    document.getElementById('settings-close').addEventListener('click', closeSettings);
    document.getElementById('settings-overlay').addEventListener('click', closeSettings);

    // Swipe-down-to-dismiss gesture (iOS-style)
    const ssSheet   = document.getElementById('settings-sheet');
    const ssOverlay = document.getElementById('settings-overlay');
    attachSheetDismissGesture(ssSheet, ssOverlay, () => {
      // Same end-state the X button produces — sheet & overlay hidden.
      ssSheet.classList.add('hidden');
      ssOverlay.classList.add('hidden');
    });
    // Check for updates
    document.getElementById('update-check-btn').addEventListener('click', checkForUpdates);
    // Open reset step 1
    document.getElementById('reset-open-btn').addEventListener('click', showReset1);
    // Step 1 buttons
    document.getElementById('reset1-cancel').addEventListener('click', closeReset1);
    document.getElementById('reset1-overlay').addEventListener('click', closeReset1);
    document.getElementById('reset1-continue').addEventListener('click', showReset2);
    // Step 2 buttons
    document.getElementById('reset2-cancel').addEventListener('click', closeReset2);
    document.getElementById('reset2-overlay').addEventListener('click', closeReset2);
    document.getElementById('reset2-confirm').addEventListener('click', performReset);
    // Live validation: only "RESET" (exact, uppercase) enables the button
    document.getElementById('reset-type-input').addEventListener('input', e => {
      const valid = e.target.value === 'RESET';
      e.target.classList.toggle('valid', valid);
      document.getElementById('reset2-confirm').disabled = !valid;
    });

    // ── Settings → Reminders panel wiring ────────────────────
    setupReminderSettings();
    // ── Settings → Apple Health panel wiring (v1.1.6) ────────
    setupHealthSettings();
    // ── Settings → Account panel wiring (v2.1 Phase A scaffold) ──
    setupAccountSettings();
    // ── Settings → Legal panel wiring (v2.1 Phase E) ─────────
    setupLegalSettings();
    // ── Generic collapsible setup (Appearance / Reminders / Health / Account / Coming / Legal) ──
    setupCollapsibleSettings();
  }

  // v2.1 Phase E — wires the Settings → LEGAL → Privacy Policy row.
  // Opens the policy in the iOS in-app browser. If Capacitor's Browser
  // plugin is installed we use it; otherwise window.open falls back to
  // Safari on iOS and a new tab on web. We deliberately do NOT install
  // a new Capacitor plugin for this — the fallback is good enough.
  function setupLegalSettings() {
    const link = document.getElementById('settings-privacy-policy-link');
    if (!link) return;
    link.addEventListener('click', () => {
      try {
        const cap = window.Capacitor;
        const browserPlugin = cap && cap.Plugins && cap.Plugins.Browser;
        if (browserPlugin && typeof browserPlugin.open === 'function') {
          browserPlugin.open({ url: AWAKENED_PRIVACY_POLICY_URL });
          return;
        }
      } catch (_) {}
      try { window.open(AWAKENED_PRIVACY_POLICY_URL, '_blank'); } catch (_) {}
    });
  }

  // Settings → Account section. v2.1.0 Phase E (partial):
  // restyled identity card + sign-out + DELETE actually wires to
  // the live backend via Auth.deleteAccount() with a type-DELETE
  // confirmation modal. Sign-out is unchanged from Phase A —
  // clearUser() + reload re-arms the gate.
  function setupAccountSettings() {
    const summary    = document.getElementById('settings-account-summary');
    const avatarEl   = document.getElementById('account-identity-avatar');
    const aliasEl    = document.getElementById('account-identity-alias');
    const sinceEl    = document.getElementById('account-identity-since');
    const signoutBtn = document.getElementById('settings-account-signout');
    const deleteBtn  = document.getElementById('settings-account-delete');

    const user = (typeof window.Auth !== 'undefined') ? window.Auth.getCurrentUser() : null;
    if (user && user.alias) {
      if (summary)  summary.textContent  = '@' + user.alias;
      if (aliasEl)  aliasEl.textContent  = user.alias;
      if (avatarEl) avatarEl.textContent = user.alias.charAt(0).toUpperCase();
      if (sinceEl) {
        const memberSince = formatMemberSince(user.signed_in_date);
        sinceEl.textContent = memberSince ? ('Member since ' + memberSince) : '—';
      }
    } else {
      if (summary)  summary.textContent  = 'Signed out';
      if (aliasEl)  aliasEl.textContent  = '—';
      if (avatarEl) avatarEl.textContent = '—';
      if (sinceEl)  sinceEl.textContent  = '—';
    }

    if (signoutBtn) {
      signoutBtn.addEventListener('click', () => {
        if (typeof window.Auth === 'undefined') return;
        // v2.1 Phase E — show a brief overlay before clearing state so
        // the user's brain registers the transition. The reload itself
        // dismisses the overlay; no Cancel path (user committed by
        // tapping Sign out).
        const overlay = document.getElementById('signing-out-overlay');
        if (overlay) overlay.classList.remove('hidden');
        setTimeout(() => {
          try { window.Auth.clearUser(); } catch (_) {}
          window.location.reload();
        }, 600);
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', openDeleteAccountModal);
    }

    // v2.1 Phase D — Backup / Restore wiring
    const backupBtn   = document.getElementById('settings-account-backup');
    const restoreBtn  = document.getElementById('settings-account-restore');
    const restoreFile = document.getElementById('settings-account-restore-file');
    if (backupBtn) {
      backupBtn.addEventListener('click', async () => {
        if (typeof window.Auth === 'undefined' ||
            typeof window.Auth.exportToFile !== 'function') return;
        let res;
        try {
          res = await window.Auth.exportToFile();
        } catch (e) {
          res = { ok: false, error: String(e && e.message || e) };
        }
        if (res && res.ok) {
          const msg = (res.channel === 'native')
            ? 'Backup created — choose where to save'
            : 'Backup saved to Downloads';
          try { showHabitToast(msg); } catch (_) {}
        } else {
          try { showHabitToast('Backup failed — please try again'); } catch (_) {}
        }
      });
    }
    if (restoreBtn && restoreFile) {
      restoreBtn.addEventListener('click', openRestoreModal);
      restoreFile.addEventListener('change', onRestoreFilePicked);
    }
  }

  // Formats YYYY-MM-DD → "May 12, 2026". Returns null on bad input
  // so caller can decide fallback. Used for "Member since X" line.
  function formatMemberSince(dateISO) {
    if (typeof dateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
    try {
      // Parse as UTC and format in device locale's long-month form.
      // Using midday UTC avoids timezone-rollover edge cases.
      const d = new Date(dateISO + 'T12:00:00Z');
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) {
      return null;
    }
  }

  // Opens the type-DELETE confirmation modal. Cancel = close + reset.
  // Confirm requires typing "DELETE" (case-insensitive) to enable.
  // On confirm: calls Auth.deleteAccount(), handles each result code:
  //   ok / EXPIRED → reload (gate re-appears, user fully signed out)
  //   LOCAL_DEV_CLEARED → reload (no backend call needed)
  //   NETWORK / BACKEND_ERROR → show inline error, re-enable button
  //     so user can retry without dismissing the modal
  function openDeleteAccountModal() {
    const overlay   = document.getElementById('delete-account-modal');
    const input     = document.getElementById('da-confirm-input');
    const cancelBtn = document.getElementById('da-cancel');
    const confirmBtn = document.getElementById('da-confirm');
    const errorEl   = document.getElementById('da-error');
    if (!overlay || !input || !cancelBtn || !confirmBtn) return;

    // Reset modal state
    input.value = '';
    if (errorEl) errorEl.textContent = '';
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Delete Forever';

    overlay.classList.remove('hidden');
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 100);

    const closeModal = () => {
      overlay.classList.add('hidden');
      // Re-attach handlers will be re-wired next time the modal opens.
      input.removeEventListener('input', onInput);
      cancelBtn.removeEventListener('click', closeModal);
      confirmBtn.removeEventListener('click', onConfirm);
      input.removeEventListener('keydown', onKeydown);
    };

    const onInput = () => {
      const matches = input.value.trim().toUpperCase() === 'DELETE';
      confirmBtn.disabled = !matches;
      if (errorEl) errorEl.textContent = '';
    };

    const onKeydown = (e) => {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'Enter' && !confirmBtn.disabled) onConfirm();
    };

    const onConfirm = async () => {
      if (confirmBtn.disabled) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting…';
      cancelBtn.disabled = true;
      if (errorEl) errorEl.textContent = '';

      let result;
      try {
        result = await window.Auth.deleteAccount();
      } catch (e) {
        result = { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
      }

      if (result && result.ok) {
        // Success or local-dev cleared — reload re-arms the gate.
        window.location.reload();
        return;
      }

      if (result && result.code === 'EXPIRED') {
        // Auth.deleteAccount cleared hb_user already; reload re-arms gate.
        try {
          if (typeof showHabitToast === 'function') {
            showHabitToast('Your session expired. Please sign in again.');
          }
        } catch (_) {}
        window.location.reload();
        return;
      }

      // NETWORK / BACKEND_ERROR / NOT_SIGNED_IN: surface inline,
      // keep local state, allow retry.
      const detail = (result && result.detail) || 'Could not delete account. Try again.';
      if (errorEl) errorEl.textContent = detail;
      confirmBtn.textContent = 'Delete Forever';
      // Keep confirmBtn disabled — user must re-type DELETE to retry
      // (defensive: forces a deliberate second confirm after error).
      input.value = '';
      cancelBtn.disabled = false;
      // Re-focus input so retry path is one keystroke
      setTimeout(() => { try { input.focus(); } catch (_) {} }, 50);
    };

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown);
    cancelBtn.addEventListener('click', closeModal);
    confirmBtn.addEventListener('click', onConfirm);
    // Tap outside the modal also cancels (matches existing modal pattern).
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    }, { once: true });
  }

  // ── v2.1 Phase D — Restore-from-backup modal flow ─────────
  // Three sequential panels share one overlay (#restore-modal-overlay):
  //   step1 — warning + Choose File trigger
  //   step2 — backup metadata + final destructive confirmation
  //   error — invalid backup file rejection
  // The active panel is whichever lacks .hidden. Validated payload
  // is parked in _pendingRestoreData until step 2 confirms.
  let _pendingRestoreData = null;

  function _restoreShowPanel(which) {
    ['restore-modal-step1', 'restore-modal-step2', 'restore-modal-error'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id === which) el.classList.remove('hidden');
      else              el.classList.add('hidden');
    });
  }

  function _closeRestoreModal() {
    const overlay = document.getElementById('restore-modal-overlay');
    if (overlay) overlay.classList.add('hidden');
    _pendingRestoreData = null;
    // Reset to step1 so next open starts fresh
    _restoreShowPanel('restore-modal-step1');
    // Clear the file input so the same file can be re-picked
    const fileEl = document.getElementById('settings-account-restore-file');
    if (fileEl) try { fileEl.value = ''; } catch (_) {}
  }

  function openRestoreModal() {
    const overlay = document.getElementById('restore-modal-overlay');
    if (!overlay) return;
    _pendingRestoreData = null;
    _restoreShowPanel('restore-modal-step1');
    overlay.classList.remove('hidden');

    // Wire step1 buttons (idempotent — uses {once:true} to auto-clean)
    const cancelBtn = document.getElementById('rm-step1-cancel');
    const chooseBtn = document.getElementById('rm-step1-choose');
    if (cancelBtn) cancelBtn.addEventListener('click', _closeRestoreModal, { once: true });
    if (chooseBtn) chooseBtn.addEventListener('click', () => {
      const fileEl = document.getElementById('settings-account-restore-file');
      if (fileEl) fileEl.click();
    }, { once: true });

    // Tap-outside cancels
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _closeRestoreModal();
    }, { once: true });
  }

  function onRestoreFilePicked(e) {
    const file = e && e.target && e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const res  = (window.Auth && typeof window.Auth.parseBackupFile === 'function')
        ? window.Auth.parseBackupFile(text)
        : { ok: false, error: 'Auth module not loaded.' };
      if (!res.ok) {
        const msgEl = document.getElementById('rm-error-msg');
        if (msgEl) msgEl.textContent = res.error || 'This file isn\'t a valid Awakened backup.';
        _restoreShowPanel('restore-modal-error');
        const closeBtn = document.getElementById('rm-error-close');
        if (closeBtn) closeBtn.addEventListener('click', _closeRestoreModal, { once: true });
        return;
      }
      // Valid — park the data and show step 2 with metadata
      _pendingRestoreData = res.data;
      const metaEl = document.getElementById('rm-step2-meta');
      if (metaEl) {
        const when = _humanizeBackupDate(res.data._generated_at);
        const ver  = res.data._app_version || 'unknown';
        metaEl.textContent = 'Backup from ' + when + ' (app version ' + ver + ').';
      }
      _restoreShowPanel('restore-modal-step2');

      const cancelBtn  = document.getElementById('rm-step2-cancel');
      const confirmBtn = document.getElementById('rm-step2-confirm');
      if (cancelBtn)  cancelBtn.addEventListener('click', _closeRestoreModal, { once: true });
      if (confirmBtn) confirmBtn.addEventListener('click', _executeRestore, { once: true });
    };
    reader.onerror = () => {
      const msgEl = document.getElementById('rm-error-msg');
      if (msgEl) msgEl.textContent = 'Could not read that file.';
      _restoreShowPanel('restore-modal-error');
      const closeBtn = document.getElementById('rm-error-close');
      if (closeBtn) closeBtn.addEventListener('click', _closeRestoreModal, { once: true });
    };
    reader.readAsText(file);
  }

  function _humanizeBackupDate(iso) {
    if (typeof iso !== 'string') return 'unknown date';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return 'unknown date';
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) { return 'unknown date'; }
  }

  function _executeRestore() {
    if (!_pendingRestoreData) { _closeRestoreModal(); return; }
    try {
      window.Auth.applyBackup(_pendingRestoreData);
    } catch (_) {}
    // Full reload — rebuilds all in-memory state from the restored
    // localStorage. hb_user was wiped by applyBackup, so the sign-in
    // gate re-arms on the next boot.
    window.location.reload();
  }

  // Builds + wires the Settings → Reminders panel. Each control writes
  // to the relevant Notif.* setter, then we re-run rescheduleAll so the
  // change takes effect immediately.
  async function rescheduleNow() {
    try { await Notif.rescheduleAll(habits, today, completions[today] || []); } catch (_) {}
    refreshRemindersPanel();
  }

  function refreshRemindersPanel() {
    if (!document.getElementById('settings-rem-permission')) return;
    Notif.checkPermission().then(perm => {
      const lbl = document.getElementById('settings-rem-permission');
      const enableBtn = document.getElementById('settings-rem-enable');
      const webNote   = document.getElementById('settings-rem-web-note');
      const status = Notif.status();
      // Permission label
      const display = perm === 'granted' ? 'Granted ✓' :
                      perm === 'denied'  ? 'Denied'    :
                      perm === 'unsupported' ? 'Not supported here' :
                      'Not set';
      lbl.textContent = display;
      lbl.className = 'settings-rem-value' +
        (perm === 'granted' ? ' granted' : perm === 'denied' ? ' denied' : '');
      // Enable button visible when not yet granted (and on a native build)
      if (status.isNative && perm !== 'granted' && perm !== 'unsupported') {
        enableBtn.classList.remove('hidden');
      } else {
        enableBtn.classList.add('hidden');
      }
      // Soft message for web (non-iOS) users
      if (!status.isNative) webNote.classList.remove('hidden');
      else                   webNote.classList.add('hidden');

      // Daily morning reminder (the digest) — button shows formatted time
      const digestBtn   = document.getElementById('settings-rem-digest-btn');
      const digestClear = document.getElementById('settings-rem-digest-clear');
      if (digestBtn) {
        const t = status.digestTime || '09:00';
        const [hStr, mStr] = t.split(':');
        const h = parseInt(hStr, 10) || 0;
        const m = parseInt(mStr, 10) || 0;
        const pm = h >= 12;
        const h12 = ((h % 12) || 12);
        digestBtn.textContent = h12 + ':' + String(m).padStart(2, '0') + ' ' + (pm ? 'PM' : 'AM');
      }
      if (digestClear) digestClear.classList.toggle('hidden', !status.digestTime);

      // (Daily limit row removed in v1.1.3 — see Notif.dailyLimit comment.)

      // Quiet hours
      document.getElementById('settings-rem-quiet-toggle').setAttribute('aria-checked', status.quietOn ? 'true' : 'false');
      document.getElementById('settings-rem-quiet-start').value = status.quietStart;
      document.getElementById('settings-rem-quiet-end').value   = status.quietEnd;

      // Pause status
      const pauseStatus  = document.getElementById('settings-rem-pause-status');
      const pauseCancel  = document.getElementById('settings-rem-pause-cancel');
      if (status.paused) {
        const d = new Date(status.pausedUntil);
        pauseStatus.textContent = 'Paused until ' + d.toLocaleString();
        pauseCancel.classList.remove('hidden');
      } else {
        pauseStatus.textContent = 'Currently: Active';
        pauseCancel.classList.add('hidden');
      }

      // Master disable toggle
      document.getElementById('settings-rem-master-toggle').setAttribute('aria-checked', status.disabled ? 'true' : 'false');

      // Active count + collapsed-header summary
      document.getElementById('settings-rem-count').textContent = status.count;
      const sum = document.getElementById('settings-rem-section-summary');
      if (sum) {
        sum.textContent = status.disabled
          ? 'Off'
          : status.paused
            ? 'Paused'
            : status.count + ' active';
      }

      // Refresh the list view if it's currently expanded
      const list = document.getElementById('settings-rem-list');
      if (!list.classList.contains('hidden')) renderRemindersList();
    });
  }

  function renderRemindersList() {
    const list = document.getElementById('settings-rem-list');
    if (!list) return;
    list.innerHTML = '';
    const r = Notif.getReminders();
    const ids = Object.keys(r);
    if (!ids.length) {
      list.innerHTML = '<div class="settings-rem-list-empty">No reminders set yet. Add one from any habit.</div>';
      return;
    }
    ids.forEach(id => {
      const habit = habits.find(h => h.id === id);
      if (!habit) return;
      const row = document.createElement('div');
      row.className = 'settings-rem-list-item';
      // Inline name with either the mapped icon or the habit emoji.
      // Curated habits with PNG art get a small inline image; everything
      // else keeps the emoji prefix.
      const iconHTML = getHabitIcon(habit)
        ? habitIconHtml(habit, { size: 18 })
        : esc(habit.emoji || '');
      row.innerHTML =
        '<span class="settings-rem-list-name">' + iconHTML + ' ' + esc(habit.name) + '</span>' +
        '<span class="settings-rem-list-time">' + formatTime12(r[id]) + '</span>' +
        '<button class="settings-rem-list-remove" type="button">Remove</button>';
      row.querySelector('.settings-rem-list-remove').addEventListener('click', async () => {
        await Notif.clearReminder(id);
        renderRemindersList();
        refreshRemindersPanel();
      });
      list.appendChild(row);
    });
  }

  // Wire up every collapsible Settings section in one pass. Each
  // [data-collapsible] toggle button is paired with a body element via
  // its aria-controls equivalent (here we infer the body id from the
  // toggle id by replacing "-toggle" with "-body"). Default state is
  // collapsed (matching the markup).
  function setupCollapsibleSettings() {
    const toggles = document.querySelectorAll('.settings-collapsible-toggle[data-collapsible]');
    toggles.forEach(toggle => {
      const bodyId = toggle.id.replace('-toggle', '-body');
      const body   = document.getElementById(bodyId);
      if (!body) return;
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        body.classList.toggle('settings-collapsible-body--collapsed', expanded);
      });
    });
  }

  function setupReminderSettings() {
    const enable     = document.getElementById('settings-rem-enable');
    // Daily-limit dropdown removed in v1.1.3.
    const quietTog   = document.getElementById('settings-rem-quiet-toggle');
    const quietStart = document.getElementById('settings-rem-quiet-start');
    const quietEnd   = document.getElementById('settings-rem-quiet-end');
    const pause24    = document.getElementById('settings-rem-pause-24');
    const pause7d    = document.getElementById('settings-rem-pause-7d');
    const pauseCancel= document.getElementById('settings-rem-pause-cancel');
    const masterTog  = document.getElementById('settings-rem-master-toggle');
    const viewAll    = document.getElementById('settings-rem-view-all');
    if (!enable) return;

    enable.addEventListener('click', async () => {
      // Show the explainer first if we haven't asked before, otherwise go
      // straight to the iOS native prompt.
      const ask = async () => {
        const granted = await Notif.requestPermission();
        await rescheduleNow();
        if (granted !== 'granted' && typeof showHabitToast === 'function') {
          showHabitToast('Permission denied. Enable in iOS Settings → Awakened.');
        }
      };
      if (!Notif.permAskedBefore()) {
        showNotifExplainer(async (ok) => { if (ok) await ask(); });
      } else {
        await ask();
      }
    });

    // (Daily-limit change handler removed in v1.1.3.)

    // Daily morning reminder — tap the time button to open a custom
    // picker (hour + 15-min minute), then save automatically as the
    // user picks. "Turn off" clears the digest entirely.
    const digestBtn   = document.getElementById('settings-rem-digest-btn');
    const digestClear = document.getElementById('settings-rem-digest-clear');
    if (digestBtn) {
      digestBtn.addEventListener('click', () => {
        const current = (Notif.dailyDigestTime && Notif.dailyDigestTime()) || '09:00';
        openDigestTimePickerModal(current, async (newT) => {
          try { await Notif.setDailyDigest(newT); } catch (_) {}
          // Re-render the panel so the button label + clear-button visibility
          // reflect the new state.
          refreshRemindersPanel();
        });
      });
    }
    if (digestClear) {
      digestClear.addEventListener('click', async () => {
        try { await Notif.clearDailyDigest(); } catch (_) {}
        refreshRemindersPanel();
        if (typeof showHabitToast === 'function') {
          showHabitToast('Morning reminder turned off', { sticky: true });
        }
      });
    }

    quietTog.addEventListener('click', async () => {
      const next = quietTog.getAttribute('aria-checked') !== 'true';
      Notif.setQuietOn(next);
      quietTog.setAttribute('aria-checked', next ? 'true' : 'false');
      await rescheduleNow();
    });
    quietStart.addEventListener('change', async () => {
      if (quietStart.value) Notif.setQuietStart(quietStart.value);
      await rescheduleNow();
    });
    quietEnd.addEventListener('change', async () => {
      if (quietEnd.value) Notif.setQuietEnd(quietEnd.value);
      await rescheduleNow();
    });

    pause24.addEventListener('click',     async () => { Notif.setPausedUntil(Date.now() + 24 * 3600 * 1000);     await rescheduleNow(); });
    pause7d.addEventListener('click',     async () => { Notif.setPausedUntil(Date.now() + 7 * 24 * 3600 * 1000); await rescheduleNow(); });
    pauseCancel.addEventListener('click', async () => { Notif.setPausedUntil(0);                                  await rescheduleNow(); });

    masterTog.addEventListener('click', async () => {
      const next = masterTog.getAttribute('aria-checked') !== 'true';
      Notif.setDisabled(next);
      masterTog.setAttribute('aria-checked', next ? 'true' : 'false');
      await rescheduleNow();
    });

    viewAll.addEventListener('click', () => {
      const list = document.getElementById('settings-rem-list');
      const expanded = !list.classList.contains('hidden');
      if (expanded) {
        list.classList.add('hidden');
        viewAll.classList.remove('expanded');
      } else {
        renderRemindersList();
        list.classList.remove('hidden');
        viewAll.classList.add('expanded');
      }
    });
  }

  // ── Settings → Apple Health panel (v1.1.6) ───────────────
  // Mirrors refreshRemindersPanel: pure read-from-state, no event
  // wiring (that's setupHealthSettings). Computes the panel's state
  // (A/B/C) from Health.* + localStorage and updates the DOM in place.
  //
  // States:
  //   A — HealthKit unavailable (web / non-iOS) → "iOS only"
  //   B — Permission granted → "Connected" (toggle ON) or "Paused" (toggle OFF)
  //   C — Permission unknown / denied → "Not connected"
  function refreshHealthPanel() {
    const summary    = document.getElementById('settings-health-summary');
    const stateA     = document.getElementById('settings-health-state-unavailable');
    const stateB     = document.getElementById('settings-health-state-connected');
    const stateC     = document.getElementById('settings-health-state-disconnected');
    if (!summary || !stateA || !stateB || !stateC) return;

    // Hide all three; the active branch reveals one.
    stateA.classList.add('hidden');
    stateB.classList.add('hidden');
    stateC.classList.add('hidden');

    if (typeof Health === 'undefined' || !Health.isAvailable()) {
      stateA.classList.remove('hidden');
      summary.textContent = 'iOS only';
      return;
    }

    const status   = Health.permissionStatus(); // 'granted' | 'denied' | 'unknown' | 'unavailable'
    const disabled = isAutoVerifyDisabled();

    if (status === 'granted') {
      stateB.classList.remove('hidden');
      const toggle = document.getElementById('settings-health-autoverify-toggle');
      const pausedNote = document.getElementById('settings-health-paused-note');
      if (toggle) toggle.setAttribute('aria-checked', disabled ? 'false' : 'true');
      if (pausedNote) pausedNote.classList.toggle('hidden', !disabled);
      summary.textContent = disabled ? 'Paused' : 'Connected';
    } else {
      // 'unknown' and 'denied' both surface State C — the Connect button's
      // click handler dispatches to the right path based on which one.
      stateC.classList.remove('hidden');
      summary.textContent = 'Not connected';
    }
  }

  // Wires the Apple Health panel's interactive controls. Idempotent —
  // safe to call once during setupSettings.
  function setupHealthSettings() {
    const toggle    = document.getElementById('settings-health-autoverify-toggle');
    const connectBtn= document.getElementById('settings-health-connect-btn');
    const manageLink= document.getElementById('settings-health-manage-link');

    if (toggle) {
      toggle.addEventListener('click', () => {
        // Flip the disabled flag based on current toggle state.
        const next = toggle.getAttribute('aria-checked') !== 'true'; // next = ON?
        setAutoVerifyDisabled(!next);
        if (next) {
          // Clear the in-memory cache so a stale 0-step read doesn't
          // block immediate re-verification of an already-walked day.
          try { Health.clearCache && Health.clearCache(); } catch (_) {}
          // Re-render Habits so any habit already past threshold gets
          // auto-checked right away — no need to switch tabs first.
          try { renderHabits(); } catch (_) {}
        }
        // No undo of prior auto-checks on pause — that's by design.
        refreshHealthPanel();
      });
    }

    if (connectBtn) {
      connectBtn.addEventListener('click', async () => {
        if (typeof Health === 'undefined' || !Health.isAvailable()) return;
        const status = Health.permissionStatus();
        if (status === 'unknown') {
          // First request — fires iOS native sheet.
          await Health.requestPermissions();
        } else {
          // 'denied' — iOS won't allow re-prompting. Deep-link to
          // Settings so the user can flip the Steps toggle manually.
          try { window.location.href = 'app-settings:'; } catch (_) {}
        }
        refreshHealthPanel();
      });
    }

    if (manageLink) {
      manageLink.addEventListener('click', () => {
        try { window.location.href = 'app-settings:'; } catch (_) {}
      });
    }
  }

  // ── WELCOME SCREEN ────────────────────────────────────────
  function playWelcomeSound() {
    try {
      const ac  = new (window.AudioContext || window.webkitAudioContext)();
      // Layer 1: rising whoosh
      const osc1  = ac.createOscillator();
      const gain1 = ac.createGain();
      osc1.connect(gain1); gain1.connect(ac.destination);
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(180, ac.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(920, ac.currentTime + 0.14);
      osc1.frequency.exponentialRampToValueAtTime(460, ac.currentTime + 0.55);
      gain1.gain.setValueAtTime(0, ac.currentTime);
      gain1.gain.linearRampToValueAtTime(0.15, ac.currentTime + 0.06);
      gain1.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
      osc1.start(ac.currentTime); osc1.stop(ac.currentTime + 0.65);
      // Layer 2: high chime ping
      const osc2  = ac.createOscillator();
      const gain2 = ac.createGain();
      osc2.connect(gain2); gain2.connect(ac.destination);
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1760, ac.currentTime + 0.08);
      osc2.frequency.exponentialRampToValueAtTime(880, ac.currentTime + 0.5);
      gain2.gain.setValueAtTime(0, ac.currentTime + 0.08);
      gain2.gain.linearRampToValueAtTime(0.09, ac.currentTime + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.7);
      osc2.start(ac.currentTime + 0.08); osc2.stop(ac.currentTime + 0.75);
      osc2.onended = () => ac.close();
    } catch (_) {}
  }

  function showWelcomeScreen() {
    const screen = document.getElementById('welcome-screen');
    screen.classList.remove('hidden');

    // ── Particle canvas ──────────────────────────────────
    const canvas = document.getElementById('wc-canvas');
    const ctx2d  = canvas.getContext('2d');
    let rafId    = null;

    function resizeCanvas() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas, { passive: true });

    const particles = [];
    const COUNT = 55;
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x:       Math.random() * window.innerWidth,
        y:       Math.random() * window.innerHeight,
        size:    0.8 + Math.random() * 2.4,
        speed:   0.18 + Math.random() * 0.42,
        opacity: 0.08 + Math.random() * 0.45,
        color:   Math.random() > 0.55 ? '#8b5cf6' : '#f59e0b',
        drift:   (Math.random() - 0.5) * 0.28,
      });
    }

    function drawFrame() {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.y       -= p.speed;
        p.x       += p.drift;
        p.opacity += (Math.random() - 0.5) * 0.012;
        p.opacity  = Math.max(0.04, Math.min(0.65, p.opacity));
        if (p.y < -6)          { p.y = canvas.height + 6; p.x = Math.random() * canvas.width; }
        if (p.x < -6)          { p.x = canvas.width  + 6; }
        if (p.x > canvas.width + 6) { p.x = -6; }
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx2d.fillStyle = p.color;
        ctx2d.globalAlpha = p.opacity;
        ctx2d.fill();
      });
      ctx2d.globalAlpha = 1;
      rafId = requestAnimationFrame(drawFrame);
    }
    rafId = requestAnimationFrame(drawFrame);

    // ── Cinematic sequence ────────────────────────────────
    // 200ms  — opener line fades in
    setTimeout(() => {
      document.getElementById('wc-opener').classList.add('wc-anim');
    }, 200);

    // 750ms  — title SLAMS in + shockwave + sound
    setTimeout(() => {
      document.getElementById('wc-title').classList.add('wc-anim');
      const sw = document.getElementById('wc-shockwave');
      void sw.offsetWidth;
      sw.classList.add('wc-sw-fire');
      playWelcomeSound();
    }, 750);

    // 1350ms — tagline fades up
    setTimeout(() => {
      document.getElementById('wc-tagline').classList.add('wc-anim');
    }, 1350);

    // 1900ms — name input slides up, auto-focus
    setTimeout(() => {
      document.getElementById('wc-input-wrap').classList.add('wc-anim');
      setTimeout(() => document.getElementById('wc-name-input').focus(), 100);
    }, 1900);

    // 2400ms — START button fades up, then switches to glow loop
    setTimeout(() => {
      const btn = document.getElementById('wc-start-btn');
      btn.classList.add('wc-anim');
      btn.addEventListener('animationend', () => {
        btn.classList.remove('wc-anim');
        btn.classList.add('wc-shown');
      }, { once: true });
    }, 2400);

    // 2950ms — motivational quote fades in beneath the button
    setTimeout(() => {
      document.getElementById('wc-quote').classList.add('wc-anim');
    }, 2950);

    // ── Interactivity ─────────────────────────────────────
    const nameInput = document.getElementById('wc-name-input');
    const startBtn  = document.getElementById('wc-start-btn');

    nameInput.addEventListener('input', () => {
      startBtn.disabled = nameInput.value.trim().length === 0;
    });

    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !startBtn.disabled) startBtn.click();
    });

    function launchQuest() {
      const name = nameInput.value.trim();
      if (!name) return;

      // Save name & mark as welcomed
      playerName = name;
      localStorage.setItem('hb_name',     playerName);
      localStorage.setItem('hb_welcomed', '1');

      // Stop particle loop
      cancelAnimationFrame(rafId);

      // White flash → transition to path selection
      const flash = document.getElementById('wc-flash');
      flash.classList.add('wc-flash-fire');
      setTimeout(() => {
        screen.classList.add('hidden');
        needsWelcome = false;
        showPathScreen();
      }, 420);
    }

    startBtn.addEventListener('click', launchQuest);
  }

  // ── CHOOSE YOUR PATH ─────────────────────────────────────
  // Morning Routine habit indices (DEFAULT_HABITS order). Mirrors the
  // canonical _MORNING_HABIT_INDICES at top-of-file used by PACKS —
  // tech-debt: this is a duplicate, candidate for DRY refactor later.
  // Both copies must stay in sync. v2.0.1 swap: 2 (Sleep before
  // midnight) → 1 (Sleep, 7+ hours).
  //   1=Sleep, 23=Wake up consistent, 14=No phone after waking,
  //  16=Morning sunlight, 41=Morning gratitude, 6=Daily walk,
  //  46=Vitamins, 12=Meditate & Breathwork, 4=Strength training, 19=Whole foods
  var MORNING_HABIT_INDICES = [1, 23, 14, 16, 41, 6, 46, 12, 4, 19];

  function showPathScreen() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('onboarding').classList.add('hidden');

    var screen   = document.getElementById('path-screen');
    var cardsEl  = document.getElementById('path-cards');
    var btn      = document.getElementById('path-continue-btn');

    screen.classList.remove('hidden');
    cardsEl.innerHTML    = '';
    btn.disabled         = true;
    btn.style.background = '';
    btn.onclick          = null;

    var chosen = null; // 'morning' | 'locked-in' | 'custom'

    // ── Card: Morning Routine ──────────────────────────────
    var morningCard = document.createElement('div');
    morningCard.className = 'path-card';
    morningCard.style.setProperty('--pack-color', '#f59e0b');
    morningCard.innerHTML =
      '<div class="path-card-check">✓</div>'                                    +
      '<div class="path-card-emoji">' + packIconHtml('morning', { size: 56 }) + '</div>'                                   +
      '<div class="path-card-name">Morning Routine</div>'                       +
      '<div class="path-card-tagline">Win the morning. Win the day.</div>'      +
      '<div class="path-card-sub">For the intentional starter</div>'            +
      '<div class="path-card-count">10 habits pre-selected</div>';

    // ── Card: Locked-In ────────────────────────────────────
    var lockedInCard = document.createElement('div');
    lockedInCard.className = 'path-card';
    lockedInCard.style.setProperty('--pack-color', '#7c3aed');
    lockedInCard.innerHTML =
      '<div class="path-card-check">✓</div>'                                    +
      '<div class="path-card-emoji">' + packIconHtml('lockedin', { size: 56 }) + '</div>'                                   +
      '<div class="path-card-name">Locked-In</div>'                             +
      '<div class="path-card-tagline">Master the day.</div>'                    +
      '<div class="path-card-sub">For full discipline cycles</div>'             +
      '<div class="path-card-count">16 habits pre-selected</div>';

    // ── Card: Make Your Own ────────────────────────────────
    var customCard = document.createElement('div');
    customCard.className = 'path-card';
    customCard.style.setProperty('--pack-color', '#a855f7');
    customCard.innerHTML =
      '<div class="path-card-check">✓</div>'                       +
      '<div class="path-card-emoji">' + packIconHtml('custom', { size: 56 }) + '</div>'                      +
      '<div class="path-card-name">Make Your Own</div>'            +
      '<div class="path-card-tagline">Your path, your rules</div>' +
      '<div class="path-card-count">Build from scratch</div>';

    // ── Card selection helper ──────────────────────────────
    function selectCard(card, id, color) {
      morningCard.classList.remove('path-selected');
      lockedInCard.classList.remove('path-selected');
      customCard.classList.remove('path-selected');
      card.classList.add('path-selected');
      chosen               = id;
      btn.disabled         = false;
      btn.style.background = color;
    }

    var customWarningShown = false;

    function showCustomWarning() {
      var ov = document.getElementById('custom-warning-overlay');
      if (!ov) return;
      ov.classList.remove('hidden');

      document.getElementById('cw-continue-btn').onclick = function() {
        ov.classList.add('hidden');
        // user keeps custom selection — already applied
      };
      document.getElementById('cw-switch-btn').onclick = function() {
        ov.classList.add('hidden');
        selectCard(morningCard, 'morning', '#f59e0b');
      };
    }

    morningCard.onclick  = function() { selectCard(morningCard,  'morning',   '#f59e0b'); };
    lockedInCard.onclick = function() { selectCard(lockedInCard, 'locked-in', '#7c3aed'); };
    customCard.onclick   = function() {
      selectCard(customCard, 'custom', '#a855f7');
      if (!customWarningShown) {
        customWarningShown = true;
        showCustomWarning();
      }
    };

    cardsEl.appendChild(morningCard);
    cardsEl.appendChild(lockedInCard);
    cardsEl.appendChild(customCard);

    // ── Continue button ────────────────────────────────────
    btn.onclick = function() {
      if (!chosen) return;

      selectedPackId = chosen;
      // Pull the chosen pack's habit indices from the canonical PACKS data —
      // single source of truth, automatically picks up Locked-In's 16 habits.
      var pack = getPackById(chosen);
      var habitsForOb = (pack && pack.habits) ? pack.habits.slice() : [];

      var flash = document.getElementById('path-flash-overlay');
      if (flash) flash.classList.add('active');

      setTimeout(function() {
        if (flash) flash.classList.remove('active');
        screen.classList.add('hidden');
        showOnboarding(habitsForOb);
      }, 340);
    };
  }

  // ── ONBOARDING ────────────────────────────────────────────
  function showOnboarding(preSelectedIndices) {
    document.getElementById('app').classList.add('hidden');
    const screen = document.getElementById('onboarding');
    screen.classList.remove('hidden');

    // Pre-fill name if captured from welcome screen
    const obNameInput = document.getElementById('ob-name-input');
    if (obNameInput && playerName && playerName !== 'Hunter') {
      obNameInput.value = playerName;
    }

    obSelected.clear();
    if (Array.isArray(preSelectedIndices) && preSelectedIndices.length) {
      preSelectedIndices.forEach(i => obSelected.add(i));
    }
    const list = document.getElementById('ob-list');
    list.innerHTML = '';

    let openIdx = -1; // track which accordion section is open

    // Update the count badge in a category header
    function refreshCatCount(catIdx) {
      const cat = OB_CATEGORIES[catIdx];
      const sel = [...obSelected].filter(i => i >= cat.start && i < cat.end).length;
      const total = cat.end - cat.start;
      const countEl = list.querySelectorAll('.ob-acc-header')[catIdx]?.querySelector('.ob-acc-count');
      if (!countEl) return;
      if (sel > 0) {
        countEl.textContent = sel + '/' + total + ' selected';
        countEl.classList.add('ob-acc-count-active');
      } else {
        countEl.textContent = total + ' habits';
        countEl.classList.remove('ob-acc-count-active');
      }
    }

    // Open or close a section by index (-1 = close all)
    function setOpen(idx) {
      list.querySelectorAll('.ob-acc-section').forEach((sec, i) => {
        const body    = sec.querySelector('.ob-acc-body');
        const chevron = sec.querySelector('.ob-acc-chevron');
        const isOpen  = (i === idx);
        sec.classList.toggle('ob-open', isOpen);
        chevron.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(0deg)';
        body.style.maxHeight    = isOpen ? body.scrollHeight + 'px' : '0';
      });
      openIdx = idx;
    }

    OB_CATEGORIES.forEach((cat, catIdx) => {
      const total = cat.end - cat.start;

      const sec = document.createElement('div');
      sec.className = 'ob-acc-section';

      // ── Accordion header ──────────────────────────────────
      const hdr = document.createElement('div');
      hdr.className = 'ob-acc-header';
      hdr.innerHTML =
        '<span class="ob-acc-label">' + cat.label + '</span>' +
        '<span class="ob-acc-count">' + total + ' habits</span>' +
        '<span class="ob-acc-chevron">▶</span>';

      hdr.addEventListener('click', () => {
        setOpen(openIdx === catIdx ? -1 : catIdx);
      });
      sec.appendChild(hdr);

      // ── Accordion body ────────────────────────────────────
      const body  = document.createElement('div');
      body.className = 'ob-acc-body';
      body.style.maxHeight = '0';

      const inner = document.createElement('div');
      inner.className = 'ob-acc-inner';

      for (let i = cat.start; i < cat.end; i++) {
        const h    = DEFAULT_HABITS[i];
        const card = document.createElement('div');
        card.className = 'ob-card';
        card.innerHTML =
          '<div class="ob-card-check"></div>' +
          '<span class="ob-card-emoji">' + habitIconHtml(h, { size: 24 }) + '</span>' +
          '<span class="ob-card-name">' + esc(h.name) + '</span>' +
          '<span class="diff-badge ' + h.difficulty + '">' + DIFFICULTY[h.difficulty].label + '</span>';

        // Apply pre-selection state (from pack)
        if (obSelected.has(i)) {
          card.classList.add('ob-selected');
          card.querySelector('.ob-card-check').textContent = '✓';
        }

        const idx = i;

        const obSelect = cfg => {
          obSelected.add(idx);
          obConfig.set(idx, cfg || {});
          card.classList.add('ob-selected');
          card.querySelector('.ob-card-check').textContent = '✓';
          refreshCatCount(catIdx);
          updateObBtn();
          if (openIdx === catIdx) body.style.maxHeight = inner.scrollHeight + 'px';
        };
        const obDeselect = () => {
          obSelected.delete(idx);
          obConfig.delete(idx);
          card.classList.remove('ob-selected');
          card.querySelector('.ob-card-check').textContent = '';
          refreshCatCount(catIdx);
          updateObBtn();
          if (openIdx === catIdx) body.style.maxHeight = inner.scrollHeight + 'px';
        };

        card.addEventListener('click', () => {
          openHabitDetail(h, {
            context:        'onboarding',
            isSelected:     obSelected.has(idx),
            existingConfig: obConfig.get(idx),
            onConfirm: obSelect,
            onRemove:  obDeselect,
          });
        });
        inner.appendChild(card);
      }

      body.appendChild(inner);
      sec.appendChild(body);
      list.appendChild(sec);
    });

    // Refresh category counts for any pre-selected habits
    if (obSelected.size > 0) {
      OB_CATEGORIES.forEach((_, catIdx) => refreshCatCount(catIdx));
    }

    document.getElementById('ob-start-btn').addEventListener('click', completeOnboarding);
    updateObBtn();
  }

  function updateObBtn() {
    const btn = document.getElementById('ob-start-btn');
    const n   = obSelected.size;
    btn.disabled    = n === 0;
    btn.textContent = n === 0
      ? 'Start My Quest'
      : 'Start My Quest — ' + n + ' selected';
  }

  function completeOnboarding() {
    // Onboarding A: ask for notification permission BEFORE the user lands
    // on the main app. Skipped automatically if we've already asked.
    // The handler is fire-and-forget — _completeOnboardingFinish runs
    // whether the user enabled or deferred. If permission was already
    // requested in a prior install/session, we go straight to finish.
    runOnboardingNotifPrompt(() => _completeOnboardingFinish());
  }

  function _completeOnboardingFinish() {
    const nameInput = document.getElementById('ob-name-input');
    if (nameInput && nameInput.value.trim()) {
      playerName = nameInput.value.trim();
      localStorage.setItem('hb_name', playerName);
    }
    if (selectedPackId) localStorage.setItem('hb_path', selectedPackId);

    // Build habits using per-habit configs stored in obConfig, falling back to defaults
    habits = [...obSelected].sort((a, b) => a - b).map(i => {
      const base = DEFAULT_HABITS[i];
      const cfg  = obConfig.get(i) || {};
      const newH = {
        id:         uid(),
        emoji:      base.emoji,
        name:       base.name,
        difficulty: cfg.difficulty || base.difficulty,
        type:       cfg.type       || base.type || 'build',
      };
      if (cfg.days)      newH.days      = cfg.days;
      if (cfg.startDate) newH.startDate = cfg.startDate;
      // Goal — mutually exclusive across four branches: step-goal
      // habits (canonical Daily walk), sleep-goal habits (canonical
      // Sleep), legacy measurable habits, and binary auto-verify
      // habits (Sleep before midnight — no goal at all). v1.1.5+.
      if (typeof cfg.stepGoal === 'number') {
        newH.stepGoal = cfg.stepGoal;
      } else if (isStepGoalHabit(base)) {
        // User didn't open the detail sheet — persist the default so
        // habit.stepGoal is always set for canonical Daily walk.
        newH.stepGoal = HEALTHKIT_WALK_DEFAULT_THRESHOLD;
      } else if (typeof cfg.sleepGoalHours === 'number') {
        newH.sleepGoalHours = cfg.sleepGoalHours;
      } else if (isSleepDurationHabit(base)) {
        // Same default-fill rationale as Daily walk.
        newH.sleepGoalHours = HEALTHKIT_SLEEP_DEFAULT_GOAL_HOURS;
      } else if (cfg.goal) {
        newH.goal = cfg.goal;
      } else {
        const m = MEASURABLE_HABITS[base.name];
        if (m) {
          const defVal = m.bodyweightMin
            ? Math.max(m.def, parseInt(localStorage.getItem('hb_bodyweight') || '0', 10))
            : Math.max(m.min, m.def);
          newH.goal = { value: defVal, unit: m.unit };
        }
      }
      return newH;
    });

    // Pre-fill coaching notes for Morning Routine pack
    if (selectedPackId === 'morning') {
      const MORNING_NOTES = {
        'Sleep before midnight':              'It all starts the night before. Quality sleep before midnight sets the foundation for everything.',
        'Wake up at consistent time':         'Discipline starts before your feet hit the floor. Same time every day builds the warrior.',
        'No phone or social media after waking': 'Protect your mind in the first 30 minutes. What you consume first shapes your entire day.',
        'Get morning sunlight':               'Get outside. Natural light sets your circadian rhythm and signals your body it is time to conquer.',
        'Morning gratitude practice':         'Three things. Every morning. Rewires your brain toward abundance over time.',
        'Daily walk':                         'Background movement matters. Hit your step goal — anywhere, any pace. Walks while on calls, errands, anywhere it fits in your day.',
        'Vitamins and minerals':              'Your body cannot perform without the right fuel. Non negotiable.',
        'Meditate & Breathwork':              'Stillness is a skill. 10 minutes of presence builds the focus that trading and life demand.',
        'Strength training':                  'The body you build reflects the discipline you practice. Show up for it daily.',
        'Whole foods diet':                   'You are what you eat. Real food builds a real body and a sharp mind.',
      };
      habits.forEach(h => {
        const note = MORNING_NOTES[h.name];
        if (note) habitNotes[h.id] = note;
      });
    }

    // Pre-fill any DEFAULT_HABITS note (e.g. No alcohol weekend challenge)
    habits.forEach(h => {
      if (habitNotes[h.id]) return; // already set (morning notes above take priority)
      const base = DEFAULT_HABITS.find(d => d.name === h.name);
      if (base && base.note) habitNotes[h.id] = base.note;
    });

    // Reset onboarding state
    obConfig.clear();

    save();
    needsOnboarding = false;
    // Brand-new users just saw all the v1.1.0 features for the first time
    // via onboarding — no need to greet them with a "What's New" popup.
    setStoredWhatsNewSeen(APP_VERSION);

    // ── Generate Chapter 1: The Beginning ─────────────────
    saveBeginningIfMissing();

    document.getElementById('onboarding').classList.add('hidden');
    // Show The Beginning reveal BEFORE the main app — it's the
    // user's first real moment with their permanent narrative.
    showBeginningReveal(() => {
      document.getElementById('app').classList.remove('hidden');
      render();
      // First-install daily-login bonus: deferred from init() so the
      // toast doesn't appear over the welcome/onboarding screens.
      // Now that the main app is finally visible, fire it here.
      // Idempotent — no-ops if init's gate had already let it through.
      try { tryGrantDailyLoginBonus(); } catch (_) {}
    });
  }

  // ── The Beginning reveal — full-screen typewriter ────────
  function showBeginningReveal(onComplete) {
    const overlay = document.getElementById('beginning-screen');
    if (!overlay || !originBeginning || !originBeginning.text) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }
    const storyEl = document.getElementById('bg-story');
    const hintEl  = document.getElementById('bg-hint');
    if (storyEl) {
      storyEl.textContent = '';
      storyEl.classList.remove('bg-story--done');
    }
    if (hintEl) hintEl.textContent = 'Tap to skip · or wait';

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('bg-show');

    const fullText = originBeginning.text;
    let typeIdx = 0;
    let typing = true;
    let typeTimer = null;
    const TYPE_MS = 30;

    function tick() {
      if (!typing || !storyEl) return;
      typeIdx++;
      storyEl.textContent = fullText.slice(0, typeIdx);
      if (typeIdx >= fullText.length) {
        typing = false;
        if (storyEl) storyEl.classList.add('bg-story--done');
        if (hintEl)  hintEl.textContent = 'Tap to continue';
        return;
      }
      typeTimer = setTimeout(tick, TYPE_MS);
    }
    const startTimer = setTimeout(() => { typeTimer = setTimeout(tick, 0); }, 700);

    let autoDismissTimer = null;
    function dismiss() {
      typing = false;
      clearTimeout(typeTimer);
      clearTimeout(startTimer);
      clearTimeout(autoDismissTimer);
      overlay.classList.remove('bg-show');
      overlay.classList.add('bg-hide');
      // Sweep any reminder-confirmation toasts left over from the
      // onboarding-time picker. They live as direct children of <body>
      // (intentionally, so they survive other overlays) but should NOT
      // outlive the Beginning chapter — the user has clearly moved on.
      // Same for the floating hour/minute picker popup it spawns.
      document.querySelectorAll('.habit-toast--reminder, .ht-rem-popup').forEach(el => el.remove());
      overlay.addEventListener('animationend', () => {
        overlay.classList.remove('bg-hide');
        overlay.classList.add('hidden');
        if (typeof onComplete === 'function') onComplete();
      }, { once: true });
      overlay.removeEventListener('click', onTap);
    }
    function onTap() {
      if (typing) {
        typing = false;
        clearTimeout(typeTimer);
        if (storyEl) {
          storyEl.textContent = fullText;
          storyEl.classList.add('bg-story--done');
        }
        if (hintEl) hintEl.textContent = 'Tap to continue';
      } else {
        dismiss();
      }
    }
    overlay.addEventListener('click', onTap);
  }

  // ── SERVICE WORKER ────────────────────────────────────────
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('sw.js').then(reg => {

      // Record the live sw.js CACHE_VERSION so checkForUpdates() can compare
      // against it later. Done in the background — don't block registration.
      fetch('sw.js?_=' + Date.now(), { cache: 'no-store' })
        .then(r => r.ok ? r.text() : '')
        .then(text => {
          const m = text && text.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
          if (m) { try { localStorage.setItem('hb_sw_known_version', m[1]); } catch (_) {} }
        })
        .catch(() => {});

      // Helper: show the banner for a given waiting worker
      function offerUpdate(worker) {
        showUpdateBanner(() => {
          worker.postMessage({ type: 'SKIP_WAITING' });
        });
      }

      // Case 1: a new SW is already waiting on page load (e.g. user
      //         opened a new tab after an update downloaded in another tab)
      if (reg.waiting) {
        offerUpdate(reg.waiting);
      }

      // Case 2: a new SW finishes installing while the page is open
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        incoming.addEventListener('statechange', () => {
          // 'installed' + existing controller = update waiting to take over
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            offerUpdate(incoming);
          }
        });
      });

    }).catch(() => {});

    // When the SW controller actually changes (after skipWaiting), reload
    // so the page is served fresh by the new service worker.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });
  }

  function showUpdateBanner(onConfirm) {
    // Only show one banner at a time
    if (document.getElementById('sw-update-banner')) return;

    const banner = document.createElement('div');
    banner.id        = 'sw-update-banner';
    banner.className = 'sw-update-banner';
    banner.innerHTML =
      '<span class="sw-update-msg">⬆ Update available</span>' +
      '<button class="sw-update-btn" id="sw-update-btn">Refresh</button>' +
      '<button class="sw-update-dismiss" id="sw-update-dismiss" aria-label="Dismiss">✕</button>';

    document.body.appendChild(banner);

    // Slight delay so the slide-down animation is visible
    requestAnimationFrame(() => banner.classList.add('sw-update-banner--show'));

    document.getElementById('sw-update-btn').addEventListener('click', () => {
      banner.remove();
      onConfirm();
    });

    document.getElementById('sw-update-dismiss').addEventListener('click', () => {
      banner.classList.remove('sw-update-banner--show');
      setTimeout(() => banner.remove(), 320);
    });
  }

  // ─────────────────────────────────────────────────────────
  // ── PUSH NOTIFICATIONS / REMINDERS ────────────────────────
  // ─────────────────────────────────────────────────────────
  // Per-habit local-notification system. One reminder time per habit.
  // Capacitor's @capacitor/local-notifications plugin handles persistence
  // across app restarts on iOS. Falls back to the Web Notifications API
  // (best-effort) for the PWA build, with a soft "use the iOS app"
  // message in Settings.
  //
  // localStorage keys (all hb_*):
  //   hb_reminders                  { habitId: 'HH:MM', ... }
  //   hb_notif_perm_requested       '1' once user has seen the explainer
  //   hb_notif_disabled             '1' if master toggle off
  //   hb_notif_paused_until         ISO timestamp; current time < this = paused
  //   hb_notif_daily_limit          number; 0 = unlimited (default 3)
  //   hb_notif_quiet_enabled        '1'/'0'  (default '1')
  //   hb_notif_quiet_start          'HH:MM'  (default '22:00')
  //   hb_notif_quiet_end            'HH:MM'  (default '07:00')
  //   hb_notif_daily_digest_time    'HH:MM' if user opted into the morning
  //                                 reminder, otherwise unset. The digest
  //                                 is the ONE notification a day Awakened
  //                                 sends by default — a gentle "show up"
  //                                 ping at the user's chosen morning time.

  const Notif = (() => {
    const KEY_REMINDERS    = 'hb_reminders';
    const KEY_PERM_ASKED   = 'hb_notif_perm_requested';
    const KEY_DISABLED     = 'hb_notif_disabled';
    const KEY_PAUSED_UNTIL = 'hb_notif_paused_until';
    const KEY_DAILY_LIMIT  = 'hb_notif_daily_limit';
    const KEY_QUIET_ON     = 'hb_notif_quiet_enabled';
    const KEY_QUIET_START  = 'hb_notif_quiet_start';
    const KEY_QUIET_END    = 'hb_notif_quiet_end';
    const KEY_DIGEST_TIME  = 'hb_notif_daily_digest_time';
    // Stable plugin notification ID for the once-a-day digest. Picked from
    // a numeric range that won't collide with notifIdFor() habit hashes.
    const DIGEST_NOTIF_ID  = 1;

    // Voice-coded copy keyed by primary stat. Used as a fallback for
    // habits that don't have a dedicated entry in HABIT_NOTIF_COPY (and
    // for user-authored custom habits).
    const COPY = {
      STR:    { title: 'Time to train. {n} awaits.',   body: "The path doesn't walk itself." },
      FOCUS:  { title: 'Stillness now. {n}.',          body: 'Five minutes of focus changes the day.' },
      INT:    { title: '{n} is ready.',                body: 'The unlearned version of you is no longer enough.' },
      WILL:   { title: '{n}. Get in the cold.',        body: 'Comfort is the enemy.' },
      VIT:    { title: '{n}.',                         body: 'The body keeps the score.' },
      WLT:    { title: '{n} awaits.',                  body: 'Compound the small wins.' },
      CUSTOM: { title: '{n} awaits.',                  body: 'Today, you choose.' },
    };

    // Per-habit unique notification copy. Each curated library habit
    // gets its own title + body so the user doesn't see "Hydrate." with
    // identical body text on five different VIT habits. Keyed by the
    // habit's exact name (the foreign key used everywhere). Custom
    // user-authored habits fall through to the per-stat COPY above.
    const HABIT_NOTIF_COPY = {
      // Physical Performance
      'Hydrate':                            { title: 'Hydrate.',          body: 'Water the temple.' },
      'Sleep':                              { title: 'Sleep.',            body: 'Repair begins when you let it.' },
      'Sleep before midnight':              { title: 'Bed by midnight.',  body: 'Tomorrow is built tonight.' },
      'Cardio workout':                     { title: 'Cardio.',           body: 'Move before the day moves you.' },
      'Strength training':                  { title: 'Train, Hunter.',    body: "The path doesn't walk itself." },
      'Sprint session':                     { title: 'Sprint.',           body: 'Speed is forged in the burn.' },
      'Daily walk':                         { title: 'Walk.',             body: 'Movement clears the static.' },
      'Ice bath or cold plunge':            { title: 'Plunge.',           body: 'Comfort is the enemy.' },
      'Cold shower':                        { title: 'Cold shower.',      body: 'Choose discomfort once. Win the day.' },
      'Mobility & Stretching':              { title: 'Stretch.',          body: 'Tight muscles, tight mind.' },
      'Protein goal':                       { title: 'Protein.',          body: "You can't build with empty hands." },

      // Mental & Focus
      'Read':                               { title: 'Read.',             body: 'The unlearned version of you is no longer enough.' },
      'Meditate & Breathwork':              { title: 'Sit. Breathe.',     body: 'Stillness is a skill.' },
      'Journal':                            { title: 'Journal.',          body: 'What stays in the head stays the same.' },
      'No phone or social media after waking': { title: 'Phone down.',    body: 'Protect the first 30 minutes.' },
      'Review daily goals/intentions':      { title: "Set today's intent.", body: 'Direction beats motion.' },
      'Get morning sunlight':               { title: 'Morning sun.',      body: "Tell your body it's time." },
      'No social media before noon':        { title: 'No feed before noon.', body: 'Build before you scroll.' },
      'No screens 1 hour before bed':       { title: 'Screens off.',      body: 'The body remembers blue light.' },

      // Nutrition
      'Whole foods diet':                   { title: 'Whole foods.',      body: 'Real food. Real body.' },
      'No sugar/junk food':                 { title: 'No junk.',          body: "Cravings lie. Discipline doesn't." },
      'No alcohol':                         { title: 'Stay clear.',       body: 'Tomorrow is sharper sober.' },
      'No caffeine':                        { title: 'No caffeine.',      body: 'Earned energy lasts.' },

      // Discipline & Productivity
      'Wake up at consistent time':         { title: 'Wake up.',          body: 'Discipline starts before your feet hit the floor.' },
      'Complete your #1 priority task':     { title: 'Top priority.',     body: 'One thing well beats five things half.' },
      'Plan tomorrow the night before':     { title: 'Plan tomorrow.',    body: 'The day is won the night before.' },
      'Tidy/clean space':                   { title: 'Tidy.',             body: 'Outer order, inner calm.' },
      'Under 1 hour screen time':           { title: 'Cap the scroll.',   body: 'Your attention is the asset.' },
      'Digital declutter':                  { title: 'Declutter.',        body: "Delete what doesn't serve you." },
      'No doomscrolling until after 5PM':   { title: 'No doomscroll.',    body: 'Your mind belongs to you until 5.' },
      'Review your long term goals':        { title: 'Goals check.',      body: 'Aim before you fire.' },

      // Financial & Growth
      'Track finances & net worth':         { title: 'Track the numbers.', body: 'What you measure, you master.' },
      'Work on a side project or business': { title: 'Build something.',  body: 'The future is built in stolen hours.' },
      'Review investments or trading journal': { title: 'Review the trade.', body: 'The market rewards the patient.' },
      'Generate one new business or content idea': { title: 'One new idea.', body: 'Quantity breeds quality.' },

      // Learning & Skills
      'Educational podcast':                { title: 'Podcast.',          body: 'Learn while you move.' },
      'Practice a skill':                   { title: 'Practice.',         body: "Reps over time. There's no other path." },
      'Flashcard review':                   { title: 'Flashcards.',       body: 'Memory is built brick by brick.' },
      'Write down lessons learned':         { title: "Capture today's lesson.", body: "What's not written is forgotten." },
      'Learn something new':                { title: 'Learn.',            body: 'Curiosity is the cheapest edge.' },
      'Language learning':                  { title: 'Practice the tongue.', body: 'Consistency beats intensity.' },

      // Wellbeing & Relationships
      'Morning gratitude practice':         { title: 'Three gratitudes.', body: "Notice what's already enough." },
      'Pray or set intentions':             { title: 'Set intent.',       body: 'Speak it. Mean it. Move.' },
      'Call or text a family member':       { title: 'Reach out.',        body: 'Bonds rust without touch.' },
      'Do something kind for someone':      { title: 'Be kind.',          body: 'The smallest gesture compounds.' },
      'Barefoot grounding outside':         { title: 'Earth the body.',   body: 'Bare feet on real ground.' },
      'Vitamins and minerals':              { title: 'Vitamins.',         body: "The body can't perform without fuel." },
      'Visualization practice':             { title: 'Visualize.',        body: 'See it before you live it.' },
      'Sleep early before 11PM':            { title: 'Bed by 11.',        body: 'Recovery is part of the work.' },
    };

    function plugin() {
      try { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications; }
      catch (_) { return null; }
    }
    function isNative() { return !!(plugin() && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
    function hasWebNotif() { return typeof window.Notification !== 'undefined'; }

    // Hash a habit-uid string into a positive 31-bit int for plugin notification IDs.
    function notifIdFor(habitId) {
      let h = 5381;
      for (let i = 0; i < habitId.length; i++) h = ((h << 5) + h + habitId.charCodeAt(i)) | 0;
      return Math.abs(h) || 1;
    }

    // ── Storage helpers ──
    function reminders() { try { return JSON.parse(localStorage.getItem(KEY_REMINDERS) || '{}'); } catch (_) { return {}; } }
    function setReminders(o) { localStorage.setItem(KEY_REMINDERS, JSON.stringify(o)); }

    function isDisabled()    { return localStorage.getItem(KEY_DISABLED) === '1'; }
    function setDisabled(d)  { d ? localStorage.setItem(KEY_DISABLED, '1') : localStorage.removeItem(KEY_DISABLED); }

    function pausedUntil()   { const v = localStorage.getItem(KEY_PAUSED_UNTIL); return v ? parseInt(v, 10) : 0; }
    function isPaused()      { return Date.now() < pausedUntil(); }
    function setPausedUntil(ts) { ts ? localStorage.setItem(KEY_PAUSED_UNTIL, String(ts)) : localStorage.removeItem(KEY_PAUSED_UNTIL); }

    // Daily limit removed from the Settings UI in v1.1.3 — the user
    // self-regulates cadence by choosing whether to add per-habit
    // reminders. We still honor a stored value if a previous version
    // wrote one (backward compat), but new users default to 0 (no cap).
    function dailyLimit()    { const n = parseInt(localStorage.getItem(KEY_DAILY_LIMIT), 10); return isFinite(n) ? n : 0; }
    function setDailyLimit(n){ localStorage.setItem(KEY_DAILY_LIMIT, String(n)); }

    function quietOn()       { return (localStorage.getItem(KEY_QUIET_ON) || '1') === '1'; }
    function setQuietOn(b)   { localStorage.setItem(KEY_QUIET_ON, b ? '1' : '0'); }
    function quietStart()    { return localStorage.getItem(KEY_QUIET_START) || '22:00'; }
    function quietEnd()      { return localStorage.getItem(KEY_QUIET_END)   || '07:00'; }
    function setQuietStart(t){ localStorage.setItem(KEY_QUIET_START, t); }
    function setQuietEnd(t)  { localStorage.setItem(KEY_QUIET_END, t); }

    // ── Permission ──
    async function checkPermission() {
      const p = plugin();
      if (p && isNative()) {
        try {
          const r = await p.checkPermissions();
          return r.display || 'prompt';
        } catch (_) { return 'prompt'; }
      }
      if (hasWebNotif()) return Notification.permission || 'default'; // 'granted'|'denied'|'default'
      return 'unsupported';
    }
    async function requestPermission() {
      localStorage.setItem(KEY_PERM_ASKED, '1');
      const p = plugin();
      if (p && isNative()) {
        try { const r = await p.requestPermissions(); return r.display || 'denied'; }
        catch (_) { return 'denied'; }
      }
      if (hasWebNotif()) {
        try { return await Notification.requestPermission(); } catch (_) { return 'denied'; }
      }
      return 'unsupported';
    }
    function permAskedBefore() { return localStorage.getItem(KEY_PERM_ASKED) === '1'; }

    // ── Voice-coded copy ──
    function copyFor(habit) {
      if (!habit) return COPY.CUSTOM;
      // Per-habit unique copy takes priority for curated library habits.
      // Each entry in HABIT_NOTIF_COPY is fully formed (no {n} placeholder)
      // so a user with both Hydrate and Sleep gets distinctly different
      // notification text instead of the same per-stat fallback.
      if (!habit.custom && habit.name && HABIT_NOTIF_COPY[habit.name]) {
        const tpl = HABIT_NOTIF_COPY[habit.name];
        return { title: tpl.title, body: tpl.body };
      }
      // Fallback — per-stat copy for any curated habit not yet in the
      // per-habit map, plus all user-authored custom habits.
      const key = habit.custom ? 'CUSTOM' : (habit.primaryStat || 'CUSTOM');
      const tpl = COPY[key] || COPY.CUSTOM;
      return {
        title: tpl.title.replace('{n}', habit.name || 'your habit'),
        body:  tpl.body,
      };
    }

    // ── Time helpers ──
    function parseHM(s)    { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? { h: +m[1], m: +m[2] } : null; }
    function minutesOf(hm) { return hm.h * 60 + hm.m; }
    // Returns true if a given HH:MM falls inside the quiet window. Quiet
    // hours wrap midnight (e.g., 22:00–07:00) so we handle that case.
    function isInQuietHours(hm) {
      if (!quietOn()) return false;
      const start = parseHM(quietStart()); const end = parseHM(quietEnd());
      if (!start || !end) return false;
      const t = minutesOf(hm), s = minutesOf(start), e = minutesOf(end);
      return s <= e ? (t >= s && t < e) : (t >= s || t < e);
    }

    // Was this reminder time chosen explicitly by the user (i.e., already
    // stored)? If so, the spec says quiet hours should NOT block it.
    function isUserExplicitlyChosenTime(habitId, hm) {
      const r = reminders()[habitId];
      if (!r) return false;
      const stored = parseHM(r);
      return !!stored && stored.h === hm.h && stored.m === hm.m;
    }

    // ── Schedule a single habit ──
    async function scheduleOne(habit, hm) {
      const p = plugin();
      if (!p || !isNative()) return false;     // no-op on web; still saved to storage
      if (isDisabled() || isPaused()) return false;
      // Quiet-hours skip ONLY if this isn't the user's explicitly-chosen time.
      if (isInQuietHours(hm) && !isUserExplicitlyChosenTime(habit.id, hm)) return false;
      const id = notifIdFor(habit.id);
      const c  = copyFor(habit);
      try {
        await p.cancel({ notifications: [{ id }] });
        await p.schedule({
          notifications: [{
            id,
            title: c.title,
            body:  c.body,
            schedule: { on: { hour: hm.h, minute: hm.m }, allowWhileIdle: true },
            extra: { habitId: habit.id },
          }],
        });
        return true;
      } catch (e) {
        console.warn('schedule failed', e);
        return false;
      }
    }

    async function cancelOne(habitId) {
      const p = plugin();
      if (!p || !isNative()) return;
      try { await p.cancel({ notifications: [{ id: notifIdFor(habitId) }] }); } catch (_) {}
    }

    async function cancelAll() {
      const p = plugin();
      if (!p || !isNative()) return;
      try {
        const pending = await p.getPending();
        const ids = (pending && pending.notifications || []).map(n => ({ id: n.id }));
        if (ids.length) await p.cancel({ notifications: ids });
      } catch (_) {}
    }

    // Apply daily-limit: keep the EARLIEST N reminders (by clock time today).
    function applyDailyLimit(entries) {
      const limit = dailyLimit();
      if (limit <= 0) return entries;          // 0 = unlimited
      return entries.slice().sort((a, b) => {
        return minutesOf(parseHM(a.time)) - minutesOf(parseHM(b.time));
      }).slice(0, limit);
    }

    // ── Public: set / change a habit's reminder ──
    async function setReminder(habitId, time) {
      const r = reminders();
      r[habitId] = time;
      setReminders(r);
      // habits is the closure-scoped array — accessible because Notif lives
      // inside the same IIFE. Fall back to a stub if the habit was just
      // deleted in the same tick (rare).
      const habit = habits.find(h => h.id === habitId) ||
                    { id: habitId, name: 'Habit', primaryStat: null };
      const hm = parseHM(time);
      if (!hm) return;
      await scheduleOne(habit, hm);
    }
    async function clearReminder(habitId) {
      const r = reminders();
      delete r[habitId];
      setReminders(r);
      await cancelOne(habitId);
    }

    // Reschedule everything from scratch (called on app open + daily reset
    // + Settings changes). Honors disabled, paused, daily-limit, and quiet
    // hours. Habits that have already been completed today have today's
    // notification skipped (it would auto-fire tomorrow anyway via repeat).
    async function rescheduleAll(habitsList, todayStr, completionsToday) {
      await cancelAll();
      if (isDisabled() || isPaused()) return;
      const r = reminders();
      const entries = [];
      Object.keys(r).forEach(habitId => {
        const habit = habitsList.find(h => h.id === habitId);
        if (!habit) return;     // habit deleted; skip
        entries.push({ habit, time: r[habitId] });
      });
      const after = applyDailyLimit(entries);
      for (const e of after) {
        // If today is done, the daily-repeat schedule will still fire tomorrow.
        // (Capacitor's `every: 'day'` would enable that, but iOS doesn't support
        //  precise repeat with a specific HH:MM — we use the daily fixed
        //  schedule pattern which does repeat.)
        const hm = parseHM(e.time);
        if (!hm) continue;
        await scheduleOne(e.habit, hm);
      }
      // Re-arm the daily 7 PM check-in alongside per-habit reminders so
      // every caller of rescheduleAll keeps the check-in fresh. Also
      // re-arm the 1 PM mid-day check-in so its conditional body reflects
      // the freshest state at every reschedule.
      try { await scheduleDailyCheckin(); } catch (_) {}
      try { await scheduleMidDayCheckin(); } catch (_) {}
    }

    // Called from toggleHabit when a user marks a habit complete TODAY.
    // We cancel just today's pending fire — tomorrow's will be re-scheduled
    // by rescheduleAll() at next daily reset.
    async function onHabitCompleted(habitId) {
      // The simple way: cancel the entire pending notification for this id.
      // It will be re-scheduled by rescheduleAll on next daily reset.
      await cancelOne(habitId);
      // Progress just changed — re-arm the daily check-in so its body
      // reflects the new completion state. Same for the mid-day check-in
      // (the at-risk-streak set changes when habits get completed).
      try { await scheduleDailyCheckin(); } catch (_) {}
      try { await scheduleMidDayCheckin(); } catch (_) {}
    }

    function status() {
      const r = reminders();
      return {
        count:           Object.keys(r).length,
        disabled:        isDisabled(),
        paused:          isPaused(),
        pausedUntil:     pausedUntil(),
        dailyLimit:      dailyLimit(),
        quietOn:         quietOn(),
        quietStart:      quietStart(),
        quietEnd:        quietEnd(),
        permRequested:   permAskedBefore(),
        isNative:        isNative(),
        digestTime:      dailyDigestTime(),
      };
    }

    // ── Daily digest — the once-a-day morning reminder ──
    // The default notification Awakened sends. One ping. Brief copy.
    // Repeats daily at the chosen time, persists across reboots via
    // Capacitor's repeating notification schedule.
    function dailyDigestTime() { return localStorage.getItem(KEY_DIGEST_TIME) || null; }

    // ── Digest copy composers ──
    // Title: "Awakened" by default, "Awakened — {Class}" once the user
    // has earned a class. Civilian users keep the bare title because the
    // word "Civilian" pairs awkwardly with "Awakened — " (they're literally
    // not awakened yet).
    function composeDigestTitle() {
      let cls = null;
      try { cls = (typeof currentClass === 'string') ? currentClass : null; } catch (_) {}
      if (!cls || cls === 'CIVILIAN') return 'Awakened';
      let name = '';
      try { name = (typeof CLASSES === 'object' && CLASSES[cls] && CLASSES[cls].name) || ''; } catch (_) {}
      return name ? ('Awakened — ' + name) : 'Awakened';
    }

    // Body: combines player name + today's habit count + day-of-week
    // flavor + class voice + special triggers (perfect day, weekend 2x).
    // Format always leads with the user's name and a comma:
    //   "Richie, 6 await today."
    //   "Marcus, the path doesn't walk itself."
    const DIGEST_FLAVOR = {
      CIVILIAN: ['the path begins.', 'show up.', 'discipline is a daily promise.', 'you are forging the next version of you.'],
      STR:      ['strength is built daily.', "the path doesn't walk itself.", 'the body reflects the work.', "what the strong do, others won't."],
      INT:      ['the unlearned version grows stale.', 'knowledge compounds daily.', 'the mind is the long game.', 'read. reflect. repeat.'],
      VIT:      ['movement is medicine.', 'the body keeps score.', 'recovery is part of the work.', 'endurance is earned in mornings.'],
      FOCUS:    ['sharpen the blade.', 'focus is a discipline.', 'distractions are the enemy.', 'strike before doubt does.'],
      WILL:     ["what others won't, you will.", 'comfort is the enemy.', 'resolve is forged at dawn.', 'the cold makes the warrior.'],
      WLT:      ['compound the small wins.', 'wealth is built in routine.', "today's habit is tomorrow's leverage.", 'the market rewards patience.'],
      SAGE:     ['all paths lead through today.', 'balance is the rarest discipline.', 'show up everywhere.', 'the complete hunter trains all six.'],
    };

    function composeDigestBody() {
      // Pull all the signals defensively — composer must never crash the
      // schedule call even if data is missing.
      let name = 'Hunter';
      try { if (typeof playerName === 'string' && playerName.trim()) name = playerName.trim(); } catch (_) {}

      let cls = 'CIVILIAN';
      try { if (typeof currentClass === 'string' && currentClass) cls = currentClass; } catch (_) {}

      let count = 0;
      try {
        if (Array.isArray(habits) && typeof isScheduledToday === 'function') {
          count = habits.filter(isScheduledToday).length;
        }
      } catch (_) {}

      let weekend = false;
      try { weekend = (typeof isWeekend === 'function') && isWeekend(); } catch (_) {}

      // Day-of-week index in PT (matches the rest of the app's date math).
      // Mon/Wed/Fri/Sat/Sun = "count" days. Tue/Thu = "flavor" days.
      // (Civilian + Sage Tuesday/Thursday still get class-flavored lines.)
      let dow = new Date().getDay(); // 0=Sun
      try {
        if (typeof getTodayDayName === 'function') {
          const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
          const n = getTodayDayName();
          if (n in map) dow = map[n];
        }
      } catch (_) {}

      // Edge: zero habits scheduled today → permission to rest.
      if (count === 0) {
        return name + ', today is yours. Take a clean rest.';
      }

      // Special trigger: yesterday was a perfect day. Honors any day-of-week.
      // Detected by checking the perfect-streak count > 0 (it increments on
      // perfect-day completion and survives until the next non-perfect day).
      let perfectStreakCount = 0;
      try {
        if (typeof perfectStreak === 'object' && perfectStreak && typeof perfectStreak.count === 'number') {
          perfectStreakCount = perfectStreak.count;
        }
      } catch (_) {}
      if (perfectStreakCount >= 1 && (dow === 1 || dow === 0)) {
        // Trigger Sun/Mon morning so the user wakes up to acknowledgment.
        return name + ', ' + count + ' await. Yesterday was perfect.';
      }

      // Tuesday + Thursday → flavor line (no count).
      if (dow === 2 || dow === 4) {
        const lines = DIGEST_FLAVOR[cls] || DIGEST_FLAVOR.CIVILIAN;
        const line  = lines[(dow + new Date().getDate()) % lines.length];
        return name + ', ' + line;
      }

      // Saturday + Sunday during a double-XP weekend → suffix the count.
      if (weekend) {
        return name + ', ' + count + ' await. ⚡ 2x XP.';
      }

      // Mon/Wed/Fri → straight count, with class label if awakened.
      if (cls && cls !== 'CIVILIAN') {
        const cn = (typeof CLASSES === 'object' && CLASSES[cls] && CLASSES[cls].name) || null;
        if (cn) return name + ', ' + count + ' await, ' + cn + '.';
      }
      return name + ', ' + count + ' await today.';
    }

    async function setDailyDigest(time) {
      // Persist the choice regardless of platform — web users still see
      // it reflected in Settings even if the actual schedule is iOS-only.
      localStorage.setItem(KEY_DIGEST_TIME, time);
      const hm = parseHM(time);
      if (!hm) return false;
      const p = plugin();
      if (!p || !isNative()) return false;
      if (isDisabled() || isPaused()) return false;
      try {
        await p.cancel({ notifications: [{ id: DIGEST_NOTIF_ID }] });
        // TIMEZONE: Capacitor's schedule.on.{hour,minute} is interpreted
        // by iOS as DEVICE-LOCAL time, not UTC and not the app's PT
        // anchor. That's the right behavior — a user in NYC who picks
        // 9:00 AM gets the notification at 9 AM Eastern, not 9 AM PT.
        // (Streak math elsewhere in the app DOES use PT — see getPTDate.
        //  These two are intentionally different concerns.)
        await p.schedule({
          notifications: [{
            id:    DIGEST_NOTIF_ID,
            title: composeDigestTitle(),
            body:  composeDigestBody(),
            schedule: { on: { hour: hm.h, minute: hm.m }, allowWhileIdle: true },
            extra: { kind: 'digest' },
          }],
        });
        return true;
      } catch (e) {
        console.warn('digest schedule failed', e);
        return false;
      }
    }

    async function clearDailyDigest() {
      localStorage.removeItem(KEY_DIGEST_TIME);
      const p = plugin();
      if (!p || !isNative()) return;
      try { await p.cancel({ notifications: [{ id: DIGEST_NOTIF_ID }] }); } catch (_) {}
    }

    // ── Daily Check-In (6 PM local) ──
    // Re-scheduled every time progress changes so the body reflects the
    // user's actual completion state at fire time. Fires once per
    // schedule (repeats: false). Re-armed by every relevant event (app
    // open, habit toggle, add/delete, daily reset, etc.).
    async function cancelDailyCheckin() {
      const p = plugin();
      if (!p || !isNative()) return;
      try { await p.cancel({ notifications: [{ id: CHECKIN_NOTIF_ID }] }); } catch (_) {}
    }
    async function scheduleDailyCheckin() {
      // Always cancel the previous schedule first — if we're allowed to
      // re-arm, we'll do it below; if not (disabled/paused/etc.), the
      // cancel ensures no stale ping fires.
      await cancelDailyCheckin();
      const p = plugin();
      if (!p || !isNative()) return false;
      if (isDisabled() || isPaused()) return false;

      // Day-1 suppression — be quiet on a brand-new user's first day.
      if (isDayOne()) return false;

      // Compute progress + copy at SCHEDULE time. (We re-schedule on
      // every meaningful change, so this is always fresh for the next
      // fire.)
      const { completed, total } = getTodaysHabitProgress();
      const state = getCheckinProgressState(completed, total);
      if (!state) return false;     // no scheduled habits today
      const body = pickCheckinCopy(state, completed, total);
      if (!body) return false;

      // Quiet hours — skip if 18:00 falls inside the user's quiet window.
      // (User can't manually pick the check-in time, so quiet hours
      // ALWAYS apply to it — unlike per-habit reminders where an
      // explicitly-chosen time wins.)
      const checkinHM = parseHM(CHECKIN_TIME);
      if (checkinHM && isInQuietHours(checkinHM)) return false;

      try {
        const fireAt = computeNextCheckinDate();
        await p.schedule({
          notifications: [{
            id:       CHECKIN_NOTIF_ID,
            title:    'Awakened',
            body:     body,
            schedule: { at: fireAt, allowWhileIdle: true },
            extra:    { kind: 'checkin' },
          }],
        });
        return true;
      } catch (e) {
        console.warn('checkin schedule failed', e);
        return false;
      }
    }
    async function reapplyCheckin() {
      // Convenience alias — match the reapplyDigest pattern. Wraps
      // scheduleDailyCheckin which itself is idempotent.
      return scheduleDailyCheckin();
    }

    // ── Mid-Day Check-In (1 PM local) ──
    // Conditional copy: souls-bonus-pending > at-risk-streak > caught-up.
    // Skipped entirely if user has zero habits (computeMidDayBody returns
    // null). Same scaffold as the 7 PM check-in: cancel, evaluate, schedule
    // once, re-arm on every relevant event. Class-aware title via
    // composeDigestTitle so Civilian still reads "Awakened" alone.
    async function cancelMidDayCheckin() {
      const p = plugin();
      if (!p || !isNative()) return;
      try { await p.cancel({ notifications: [{ id: MIDDAY_NOTIF_ID }] }); } catch (_) {}
    }
    async function scheduleMidDayCheckin() {
      await cancelMidDayCheckin();
      const p = plugin();
      if (!p || !isNative()) return false;
      if (isDisabled() || isPaused()) return false;
      // Day-1 suppression — mirror the 7 PM check-in's quiet first day.
      if (isDayOne()) return false;

      // Compute body at schedule time. null = skip (priority 4: no habits).
      const body = computeMidDayBody();
      if (!body) return false;

      // Quiet hours — skip if 1 PM falls inside the user's quiet window.
      // (Unlikely default, but a user with daytime quiet hours might set
      // this — respect it like the 7 PM check-in does.)
      const middayHM = parseHM(MIDDAY_TIME);
      if (middayHM && isInQuietHours(middayHM)) return false;

      try {
        const fireAt = computeNextMidDayDate();
        await p.schedule({
          notifications: [{
            id:       MIDDAY_NOTIF_ID,
            title:    composeDigestTitle(),
            body:     body,
            schedule: { at: fireAt, allowWhileIdle: true },
            extra:    { kind: 'midday' },
          }],
        });
        return true;
      } catch (e) {
        console.warn('midday schedule failed', e);
        return false;
      }
    }
    async function reapplyMidDay() {
      return scheduleMidDayCheckin();
    }

    // Re-arm the digest after pause/disable changes or app restart.
    async function reapplyDigest() {
      const t = dailyDigestTime();
      if (!t) return;
      if (isDisabled() || isPaused()) {
        const p = plugin();
        if (p && isNative()) {
          try { await p.cancel({ notifications: [{ id: DIGEST_NOTIF_ID }] }); } catch (_) {}
        }
        return;
      }
      await setDailyDigest(t);
    }

    return {
      // queries
      getReminders: reminders,
      reminderFor:  (id) => reminders()[id] || null,
      status,
      checkPermission, requestPermission, permAskedBefore,
      // mutators
      setReminder, clearReminder, rescheduleAll, onHabitCompleted, cancelAll,
      setDisabled, setPausedUntil, setDailyLimit,
      setQuietOn, setQuietStart, setQuietEnd,
      // daily digest — the default once-a-day reminder
      dailyDigestTime, setDailyDigest, clearDailyDigest, reapplyDigest,
      // daily check-in (7 PM local — progress-aware copy)
      scheduleDailyCheckin, cancelDailyCheckin, reapplyCheckin,
      // mid-day check-in (1 PM local — souls/streak/caught-up conditional)
      scheduleMidDayCheckin, cancelMidDayCheckin, reapplyMidDay,
      composeDigestTitle, composeDigestBody,
      // internals exposed for the UI
      copyFor, parseHM, isPaused, isDisabled,
    };
  })();

  // Expose Notif on window for dev / testing access (so the in-page
  // console can fire a sample digest notification, inspect the digest
  // copy composers, etc.). Production app code uses the closure-scoped
  // Notif directly — this is purely for inspectability.
  try { window.Notif = Notif; } catch (_) {}

  // ── HealthKit module ──────────────────────────────────────
  // Plugin:    @perfood/capacitor-healthkit (Cap 6-compatible, 15mo stale at adoption)
  // Adopted:   v1.1.4 (May 2026)
  // Why this:  fresh alternatives (@capgo/capacitor-health, others) all require
  //            Capacitor 8+. Awakened is on Capacitor 6. @perfood works, has
  //            4.3k weekly downloads, and a small read-only API surface that's
  //            unlikely to break.
  //
  // Migration target:
  //   - When we upgrade to Capacitor 8 (likely v1.2 or v2.0): swap to
  //     @capgo/capacitor-health. It's the actively-maintained successor.
  //     Repo: github.com/Cap-go/capacitor-health
  //   - If v2.x bosses need data this plugin can't expose (HRV, VO2 max, raw
  //     workout segments), self-roll a Swift shim instead. Don't chase forks.
  //
  // Wrapper pattern:
  //   Everything HealthKit-related is funneled through the Health.* surface
  //   below. Swap cost = rewrite this module. Don't import the plugin elsewhere.
  // ─────────────────────────────────────────────────────────
  const Health = (() => {
    // ── Capabilities ─────────────────────────────────────
    function isAvailable() {
      // Capacitor only injects window.Capacitor on native iOS / Android.
      // Web / PWA users get a no-op surface — every read returns null,
      // permissionStatus returns 'unavailable'.
      try {
        return !!(
          window.Capacitor &&
          window.Capacitor.isNativePlatform &&
          window.Capacitor.isNativePlatform() &&
          window.Capacitor.getPlatform &&
          window.Capacitor.getPlatform() === 'ios'
        );
      } catch (_) {
        return false;
      }
    }

    function plugin() {
      // Lazy resolution — the plugin object only exists in the native
      // bundle. On web this returns undefined and every method below
      // short-circuits via isAvailable().
      try {
        return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHealthkit;
      } catch (_) {
        return null;
      }
    }

    // ── In-memory caches (5 min TTL) ─────────────────────
    // We never persist HealthKit data — Apple Health is the source of
    // truth; these caches just avoid hammering it on every render.
    // Step + sleep have separate caches with separate clear methods so
    // each habit's auto-verify can refresh independently.
    const STEP_CACHE_TTL_MS  = 5 * 60 * 1000;
    const SLEEP_CACHE_TTL_MS = 5 * 60 * 1000;
    let stepCache  = null; // { steps, fetchedAt }
    let sleepCache = null; // { totalAsleepHours, earliestSleepStart, samples, fetchedAt }

    function isCacheFresh() {
      return stepCache && (Date.now() - stepCache.fetchedAt) < STEP_CACHE_TTL_MS;
    }
    function isSleepCacheFresh() {
      return sleepCache && (Date.now() - sleepCache.fetchedAt) < SLEEP_CACHE_TTL_MS;
    }

    function clearCache() {
      stepCache = null;
    }
    function clearSleepCache() {
      sleepCache = null;
    }

    // ── Permission status (locally tracked) ──────────────
    // The plugin has no "is authorized?" introspection method that
    // works reliably for read-only scopes (Apple intentionally hides
    // this so apps can't fingerprint denial). We track our last-known
    // status in localStorage instead.
    //   'granted'  — request returned without throwing AND a subsequent
    //                read succeeded (or hasn't been attempted yet)
    //   'denied'   — read attempt threw a permission-shaped error
    //   'unknown'  — never requested
    function permissionStatus() {
      if (!isAvailable()) return 'unavailable';
      const s = localStorage.getItem('hb_healthkit_status');
      return s === 'granted' || s === 'denied' ? s : 'unknown';
    }

    function setStatus(s) {
      try { localStorage.setItem('hb_healthkit_status', s); } catch (_) {}
    }

    // ── Authorization request ────────────────────────────
    // v1.1.5 requests stepCount + sleepAnalysis in a single call. iOS
    // bundles them into one permission sheet on the FIRST grant. For
    // existing v1.1.5 step-only users (granted before sleep was added
    // to the read array), see requestSleepPermissionIfNeeded() — iOS
    // doesn't auto-prompt for new categories on subsequent queries; we
    // have to explicitly re-call requestAuthorization with the new type.
    //
    // Permissions are independent: a user can grant steps and deny
    // sleep. Both code paths handle null returns gracefully — if sleep
    // is denied, getSleepLastNight returns null and sleep auto-verify
    // silently no-ops. Steps continue to work.
    async function requestPermissions() {
      if (!isAvailable()) return 'unavailable';
      const p = plugin();
      if (!p) {
        console.warn('[Health] plugin not registered on native bridge');
        return 'unavailable';
      }
      try {
        // Plugin uses friendly-alias strings for auth (different namespace
        // than query). 'steps' maps to stepCount, 'activity' maps to
        // sleepAnalysis + workoutType. Sleep-only is not supported by this
        // plugin's auth API; 'activity' is the only path to sleep
        // authorization. Workout permission is requested as a side effect
        // — used for v1.2.0+ workout-type habits.
        await p.requestAuthorization({
          read: ['steps', 'activity'],
          write: [''],
          all: [''],
        });
        // Apple's HealthKit doesn't report grant/deny back to the app
        // for read scopes. We optimistically mark 'granted' here; if a
        // subsequent read throws or returns no data when we expect some,
        // the read path can downgrade us to 'denied'.
        setStatus('granted');
        try { localStorage.setItem('hb_healthkit_prompted', '1'); } catch (_) {}
        // Sleep was bundled in this request — flag it as already-asked
        // so the upgrade-path helper below no-ops for fresh installs.
        try { localStorage.setItem('hb_healthkit_sleep_requested', '1'); } catch (_) {}
        console.log('[Health] permission request completed');
        return 'granted';
      } catch (e) {
        console.warn('[Health] permission request failed', e);
        setStatus('denied');
        try { localStorage.setItem('hb_healthkit_prompted', '1'); } catch (_) {}
        return 'denied';
      }
    }

    // ── Upgrade-path sleep authorization ─────────────────
    // Idempotent. Existing v1.1.5 step-grant users granted Steps before
    // sleep was added to the auth read array. iOS doesn't auto-prompt
    // on the first sleep query — we have to explicitly re-call
    // requestAuthorization with the new type. iOS shows the permission
    // sheet for ONLY the new category (sleep); the existing Steps
    // grant stays untouched.
    //
    // Flagged via hb_healthkit_sleep_requested. Set to '1' ONLY on
    // successful resolve of p.requestAuthorization() — never in the
    // catch block. iOS resolves silently for already-decided categories
    // (granted OR denied), so a real throw is a real failure and
    // should be retried on the next launch. Defensive flag-setting in
    // catch was the bug that landed users in a "flag=1, but iOS sheet
    // never fired" state.
    async function requestSleepPermissionIfNeeded() {
      if (!isAvailable()) return 'unavailable';
      if (localStorage.getItem('hb_healthkit_sleep_requested') === '1') return 'already-requested';
      const p = plugin();
      if (!p) return 'unavailable';
      try {
        // 'activity' is the plugin's friendly alias for sleep+workout.
        // See requestPermissions() above for the full explanation of
        // why 'sleepAnalysis' alone doesn't work in the auth API.
        // Re-pass 'steps' so iOS sees a coherent set; the existing Steps
        // grant stays untouched, and the new sheet shows ONLY the new
        // categories (sleep + workout).
        await p.requestAuthorization({
          read: ['steps', 'activity'],
          write: [''],
          all: [''],
        });
        // ONLY set the flag here — post-resolve. Never in catch.
        try { localStorage.setItem('hb_healthkit_sleep_requested', '1'); } catch (_) {}
        console.log('[Health] sleep permission request completed (upgrade path)');
        return 'requested';
      } catch (e) {
        console.warn('[Health] sleep permission request failed', e);
        // Do NOT set the flag here. A throw is a real failure —
        // retry next cold launch. (Previously flagged defensively
        // here, which left users stuck with flag=1 and no sheet.)
        return 'failed';
      }
    }

    // ── Step query ───────────────────────────────────────
    // Returns total steps for today (PT date). Sums all sample values
    // returned by HealthKit in the [00:00 PT, now] window.
    //
    // Returns null on:
    //   - non-native platform
    //   - missing plugin
    //   - permission denied / never requested
    //   - HealthKit query throws
    //
    // Never throws. Auto-verify must be a silent enhancement.
    async function getStepsToday() {
      if (!isAvailable()) return null;
      if (isCacheFresh()) return stepCache.steps;

      const p = plugin();
      if (!p) return null;

      const status = permissionStatus();
      if (status === 'denied' || status === 'unknown') {
        // 'unknown' = never requested. Caller should call
        // requestPermissions() first. We don't auto-prompt here so reads
        // never trigger an unexpected iOS sheet.
        return null;
      }

      try {
        // PT-anchored "start of today." getPTDate() returns "YYYY-MM-DD"
        // in America/Los_Angeles. Construct an ISO at midnight PT, which
        // HealthKit interprets as a wall-clock timestamp.
        const todayPT = (typeof getPTDate === 'function') ? getPTDate() : new Date().toISOString().slice(0, 10);
        const start = new Date(todayPT + 'T00:00:00');
        const end = new Date();

        // sampleName MUST be 'stepCount' (camelCase, maps to
        // HKQuantityTypeIdentifierStepCount). The @perfood README
        // ambiguously suggests 'steps' as an alternative — that string
        // is accepted only by requestAuthorization, not by the query
        // API. Passing 'steps' here throws "Error in sample name."
        const result = await p.queryHKitSampleType({
          sampleName: 'stepCount',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          limit: 0, // 0 = unlimited per @perfood README
        });

        // result shape: { countReturn, resultData: [{ value, ...}, ...] }
        const samples = (result && result.resultData) || [];
        const total = samples.reduce((sum, s) => sum + (Number(s.value) || 0), 0);

        stepCache = { steps: total, fetchedAt: Date.now() };
        // First successful read confirms 'granted' — if iOS had silently
        // denied, the query would have thrown or returned empty. We
        // accept zero-step days as legitimate (user just hasn't moved).
        setStatus('granted');
        console.log('[Health] steps today:', total, '(samples:', samples.length, ')');
        return total;
      } catch (e) {
        console.warn('[Health] step query failed', e);
        // Don't flip to 'denied' on a single failure — could be transient.
        // Only requestPermissions explicitly setting 'denied' on throw.
        return null;
      }
    }

    // ── Sleep query ──────────────────────────────────────
    // Returns last night's main sleep block summary, or null. Window:
    // [now − 18h, now]. Caller decides what to do with the return.
    //
    // Shape:
    //   {
    //     totalAsleepHours:   <number>,           // sum of 'Asleep' sample durations
    //     earliestSleepStart: <Date>,             // earliest qualifying asleep sample.startDate
    //     samples:            [{startDate, endDate, duration, sleepState}, ...]
    //   }
    //
    // Returns null on:
    //   - non-native platform / missing plugin
    //   - permission denied / never requested
    //   - HealthKit query throws OR resultData is empty
    //
    // Caveats:
    //   - The plugin collapses Apple's HKCategoryValueSleepAnalysis enum
    //     into 2 strings: 'InBed' and 'Asleep'. The 'Asleep' bucket
    //     incorrectly includes `awake` rawValue=2 samples (not just
    //     asleepCore/Deep/REM). For total-asleep computation this
    //     overcounts by however long mid-night awake periods are —
    //     typically <15 min/night. Acceptable v1 error margin.
    //   - earliestSleepStart uses the EARLIEST 'Asleep' sample whose
    //     duration ≥ HEALTHKIT_SLEEP_NAP_MIN_MINUTES. The 30-min filter
    //     skips brief naps. Edge case: a 1-hour evening nap will produce
    //     a false-positive "before midnight" verdict. Rare; user can
    //     manually un-check.
    //   - Window is 18h backwards from now. Device-local clock — sleep
    //     crosses midnight, PT-anchoring is wrong (CLAUDE.md notif rule).
    //   - Sleep data lands in HealthKit on wake (Apple Watch) or backfill
    //     (iPhone alarm). Auto-verify won't fire AT midnight; it fires
    //     when user opens app in the morning.
    //
    // Never throws.
    async function getSleepLastNight() {
      if (!isAvailable()) return null;
      if (isSleepCacheFresh()) return sleepCache;

      const p = plugin();
      if (!p) return null;

      const status = permissionStatus();
      if (status === 'denied' || status === 'unknown') return null;

      try {
        const now = new Date();
        const start = new Date(now.getTime() - HEALTHKIT_SLEEP_LOOKBACK_HOURS * 3600 * 1000);

        const result = await p.queryHKitSampleType({
          sampleName: 'sleepAnalysis',
          startDate: start.toISOString(),
          endDate: now.toISOString(),
          limit: 0,
        });

        const samples = (result && result.resultData) || [];
        if (samples.length === 0) {
          // Empty result = no signal (iPhone-only with no data, or genuinely
          // no sleep). Return null — auto-verify treats this as silent skip,
          // not a failed habit.
          console.log('[Health] sleep: no samples in last', HEALTHKIT_SLEEP_LOOKBACK_HOURS, 'h');
          return null;
        }

        // Filter to 'Asleep' samples (excluded: 'InBed' wrappers).
        const asleepSamples = samples.filter(s => s && s.sleepState === 'Asleep');

        // Total — sum durations (already in hours from plugin).
        const totalAsleepHours = asleepSamples.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);

        // Earliest qualifying asleep sample = first sample whose duration
        // exceeds the nap floor. Sort by startDate ascending.
        const napFloorHours = HEALTHKIT_SLEEP_NAP_MIN_MINUTES / 60;
        const qualifying = asleepSamples
          .filter(s => Number(s.duration) >= napFloorHours)
          .map(s => ({ ...s, _start: new Date(s.startDate) }))
          .sort((a, b) => a._start - b._start);
        const earliestSleepStart = qualifying.length ? qualifying[0]._start : null;

        sleepCache = {
          totalAsleepHours,
          earliestSleepStart,
          samples: asleepSamples,
          fetchedAt: Date.now(),
        };
        setStatus('granted');
        console.log('[Health] sleep last night:', totalAsleepHours.toFixed(2), 'h asleep,',
          'earliest:', earliestSleepStart && earliestSleepStart.toISOString(),
          '(samples:', samples.length, 'asleep:', asleepSamples.length, ')');
        return sleepCache;
      } catch (e) {
        console.warn('[Health] sleep query failed', e);
        return null;
      }
    }

    // Public surface
    return {
      isAvailable,
      requestPermissions,
      requestSleepPermissionIfNeeded,
      getStepsToday,
      getSleepLastNight,
      permissionStatus,
      clearCache,       // step cache
      clearSleepCache,  // sleep cache
    };
  })();

  // Expose for dev / testing — same pattern as Notif.
  try { window.Health = Health; } catch (_) {}

  // ── AUTO_VERIFY metadata storage ─────────────────────────
  // Persists which completions were auto-verified (vs. manually tapped)
  // and which auto-verified completions the user explicitly un-checked
  // (so we don't re-check them on next refresh).
  //
  // localStorage shape:
  //   hb_completions_auto      { 'YYYY-MM-DD': { habitId: { source, value } } }
  //   hb_av_unchecked_dates    { habitName: ['YYYY-MM-DD', ...] }  (per-habit, auto-pruned to 14 days)
  //
  // The unchecked-dates map is keyed by habit NAME (canonical foreign
  // key, stable across reinstalls — see CLAUDE.md "habit identity is
  // the name string"). v1.1.5 migrates the old walk-only flat array
  // (hb_walk_unchecked_dates) into 'Daily walk' under the new key.
  const AUTO_VERIFY = (() => {
    function load() {
      try { return JSON.parse(localStorage.getItem('hb_completions_auto') || '{}'); }
      catch (_) { return {}; }
    }
    function persist(map) {
      try { localStorage.setItem('hb_completions_auto', JSON.stringify(map)); } catch (_) {}
    }
    function loadUncheckedMap() {
      // One-time migration: fold legacy 'hb_walk_unchecked_dates' (flat
      // array) into the new per-habit-name map under 'Daily walk'.
      try {
        const legacy = localStorage.getItem('hb_walk_unchecked_dates');
        if (legacy !== null) {
          const arr = JSON.parse(legacy) || [];
          const cur = JSON.parse(localStorage.getItem('hb_av_unchecked_dates') || '{}');
          const merged = Array.from(new Set([...(cur['Daily walk'] || []), ...arr]));
          cur['Daily walk'] = merged;
          localStorage.setItem('hb_av_unchecked_dates', JSON.stringify(cur));
          localStorage.removeItem('hb_walk_unchecked_dates');
        }
      } catch (_) {}
      try { return JSON.parse(localStorage.getItem('hb_av_unchecked_dates') || '{}'); }
      catch (_) { return {}; }
    }
    function persistUncheckedMap(map) {
      try { localStorage.setItem('hb_av_unchecked_dates', JSON.stringify(map)); } catch (_) {}
    }
    function recordAutoVerify(id, meta) {
      if (!today) return;
      const map = load();
      if (!map[today]) map[today] = {};
      map[today][id] = meta || { source: 'unknown' };
      persist(map);
    }
    function clearAutoVerify(id) {
      const map = load();
      if (map[today] && map[today][id]) {
        delete map[today][id];
        if (!Object.keys(map[today]).length) delete map[today];
        persist(map);
      }
    }
    function isAutoVerifiedToday(id) {
      const map = load();
      return !!(map[today] && map[today][id]);
    }
    function isAutoVerifiedOnDate(id, dateStr) {
      const map = load();
      return !!(map[dateStr] && map[dateStr][id]);
    }
    // Mark today as "user explicitly un-checked auto-verified completion
    // of habitName" — auto-verify will not re-check until tomorrow.
    function markUnchecked(habitName) {
      if (!habitName || !today) return;
      const map = loadUncheckedMap();
      const arr = map[habitName] || [];
      if (!arr.includes(today)) arr.push(today);
      // Prune entries older than 14 days per habit. Cheap; runs on
      // each write so per-habit arrays stay bounded.
      const cutoff = new Date(today + 'T00:00:00');
      cutoff.setDate(cutoff.getDate() - 14);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      map[habitName] = arr.filter(d => d >= cutoffStr);
      persistUncheckedMap(map);
    }
    function wasUncheckedToday(habitName) {
      if (!habitName || !today) return false;
      const map = loadUncheckedMap();
      return Array.isArray(map[habitName]) && map[habitName].includes(today);
    }
    // Backward-compat aliases — referenced by existing toggleHabit code.
    // Thin wrappers so we don't have to touch the call site immediately.
    const markWalkUnchecked       = () => markUnchecked('Daily walk');
    const wasWalkUncheckedToday   = () => wasUncheckedToday('Daily walk');
    return {
      recordAutoVerify, clearAutoVerify,
      isAutoVerifiedToday, isAutoVerifiedOnDate,
      markUnchecked, wasUncheckedToday,
      markWalkUnchecked, wasWalkUncheckedToday, // legacy
    };
  })();
  try { window.AutoVerify = AUTO_VERIFY; } catch (_) {}

  // ── Walk auto-verify orchestration ───────────────────────
  // Locates the canonical "Daily walk" habit (strict equality on name +
  // not custom — see CLAUDE.md "Habit identity is the name string"
  // convention). Returns null if missing.
  function findWalkHabit() {
    return habits.find(h => h.name === 'Daily walk' && !h.custom) || null;
  }

  // First-encounter pre-prompt explainer. Shown ONCE per device, before
  // iOS's native HealthKit permission sheet. The native sheet is opaque
  // about what permissions an app is asking for and why — this modal
  // gives users the context to make an informed grant.
  //
  // Triggered from autoVerifyWalk() the first time we see the walk habit
  // on a native iOS build with permissionStatus === 'unknown'.
  function showHealthKitPreprompt() {
    if (document.getElementById('hk-preprompt-overlay')) return;

    // Read the user's current goal so the copy reflects reality. Fresh
    // installs see the default 3,000; users who've already configured
    // a different value (via Edit Habit during onboarding or after) see
    // their own number.
    const walk = (typeof findWalkHabit === 'function') ? findWalkHabit() : null;
    const initialGoal = walk ? getHabitStepGoal(walk) : HEALTHKIT_WALK_DEFAULT_THRESHOLD;

    // v1.1.5 sleep extension: detect if the user also has either sleep
    // habit. If so, append a sentence acknowledging that sleep
    // auto-verifies too. Single permission grant covers both data types
    // — no separate explainer or chip picker for sleep here (configured
    // via Edit Habit modal).
    const hasSleepHabit   = !!(typeof findSleepHabit === 'function' && findSleepHabit());
    const hasBedtimeHabit = !!(typeof findSleepBeforeMidnightHabit === 'function' && findSleepBeforeMidnightHabit());
    const hasAnySleep     = hasSleepHabit || hasBedtimeHabit;
    let sleepLine = '';
    if (hasSleepHabit && hasBedtimeHabit) {
      sleepLine = 'Your sleep habits — Sleep and Sleep before midnight — auto-verify too, based on last night’s Apple Health data.';
    } else if (hasSleepHabit) {
      sleepLine = 'Your Sleep habit auto-verifies too, based on last night’s Apple Health data.';
    } else if (hasBedtimeHabit) {
      sleepLine = 'Your Sleep before midnight habit auto-verifies too, based on last night’s Apple Health data.';
    }
    const dataLabel = hasAnySleep ? 'Your steps and sleep' : 'Your steps';

    const overlay = document.createElement('div');
    overlay.id = 'hk-preprompt-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-card hk-preprompt-card">' +
        '<h2 class="hk-preprompt-title">Auto-verify your ' + (hasAnySleep ? 'Habits' : 'Walk') + '</h2>' +
        '<p class="hk-preprompt-body">' +
          'Awakened can use Apple Health to mark the Daily walk habit complete ' +
          'when you reach <button type="button" id="hk-preprompt-goal-btn" class="hk-preprompt-goal-btn">' +
            initialGoal.toLocaleString() + '+ steps' +
          '</button> &mdash; no tap needed.' +
        '</p>' +
        // Inline chip picker — collapsed by default, opens when the
        // step-goal value above is tapped. Reuses .habit-edit-stepgoal-*
        // styles for visual consistency with the Edit Habit modal.
        '<div id="hk-preprompt-stepgoal" class="habit-edit-stepgoal hk-preprompt-stepgoal" hidden>' +
          '<div class="habit-edit-stepgoal-chips">' +
            '<button class="habit-edit-stepgoal-chip" data-preset="8000"  type="button">8,000</button>' +
            '<button class="habit-edit-stepgoal-chip" data-preset="10000" type="button">10,000</button>' +
            '<button class="habit-edit-stepgoal-chip" data-preset="custom" type="button">Custom</button>' +
          '</div>' +
          '<div id="hk-preprompt-stepgoal-custom" class="habit-edit-stepgoal-custom hidden">' +
            '<input id="hk-preprompt-stepgoal-input" class="habit-edit-stepgoal-input" type="number" inputmode="numeric" min="8000" max="50000" placeholder="Enter steps (8,000–50,000)">' +
            '<button id="hk-preprompt-stepgoal-save"   class="habit-edit-stepgoal-save"   type="button">Save</button>' +
            '<button id="hk-preprompt-stepgoal-cancel" class="habit-edit-stepgoal-cancel" type="button">Cancel</button>' +
          '</div>' +
        '</div>' +
        (sleepLine ? '<p class="hk-preprompt-body">' + sleepLine + '</p>' : '') +
        '<p class="hk-preprompt-body hk-preprompt-privacy">' +
          dataLabel + ' stay on your device. Awakened never sees them leave your phone.' +
        '</p>' +
        '<div class="hk-preprompt-actions">' +
          '<button class="hk-preprompt-secondary" id="hk-preprompt-skip">Not Now</button>' +
          '<button class="hk-preprompt-primary"   id="hk-preprompt-enable">Enable</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const close = () => {
      try { localStorage.setItem('hb_healthkit_prompted', '1'); } catch (_) {}
      overlay.remove();
    };

    // ── Step-goal picker wiring ──────────────────────────────
    // Tapping the inline number toggles the chip picker. Tapping a
    // preset writes via setHabitStepGoal (immediately persists, since
    // the modal has no Save button — just Enable / Not Now). The
    // displayed number updates live so the user sees their choice
    // reflected before they grant permission.
    const goalBtn  = document.getElementById('hk-preprompt-goal-btn');
    const picker   = document.getElementById('hk-preprompt-stepgoal');
    const chipGrp  = picker.querySelector('.habit-edit-stepgoal-chips');
    const customRow= document.getElementById('hk-preprompt-stepgoal-custom');
    const customIn = document.getElementById('hk-preprompt-stepgoal-input');
    const customSave = document.getElementById('hk-preprompt-stepgoal-save');
    const customCancel = document.getElementById('hk-preprompt-stepgoal-cancel');

    const refreshChipState = () => {
      const cur = walk ? getHabitStepGoal(walk) : initialGoal;
      const isCustom = !HEALTHKIT_WALK_PRESETS.includes(cur);
      picker.querySelectorAll('.habit-edit-stepgoal-chip').forEach(chip => {
        const p = chip.dataset.preset;
        const active = (p === 'custom') ? isCustom : (parseInt(p, 10) === cur);
        chip.classList.toggle('habit-edit-stepgoal-chip--active', active);
      });
      goalBtn.textContent = cur.toLocaleString() + '+ steps';
    };
    refreshChipState();

    goalBtn.addEventListener('click', () => {
      picker.hidden = !picker.hidden;
    });

    chipGrp.addEventListener('click', (e) => {
      const chip = e.target.closest('.habit-edit-stepgoal-chip');
      if (!chip) return;
      const p = chip.dataset.preset;
      if (p === 'custom') {
        customRow.classList.remove('hidden');
        customIn.value = walk ? String(getHabitStepGoal(walk)) : String(initialGoal);
        setTimeout(() => customIn.focus(), 50);
        return;
      }
      const n = parseInt(p, 10);
      if (!Number.isFinite(n)) return;
      // Persist only if the user actually has the walk habit (they
      // should — the pre-prompt is gated on findWalkHabit() returning
      // truthy in autoVerifyWalk, but be defensive).
      if (walk) setHabitStepGoal(walk, n);
      customRow.classList.add('hidden');
      refreshChipState();
    });

    const commitCustom = () => {
      const parsed = parseInt(customIn.value, 10);
      const fallback = Number.isFinite(parsed) ? parsed : HEALTHKIT_WALK_DEFAULT_THRESHOLD;
      const n = Math.max(HEALTHKIT_WALK_THRESHOLD_MIN, Math.min(HEALTHKIT_WALK_THRESHOLD_MAX, fallback));
      if (walk) setHabitStepGoal(walk, n);
      customRow.classList.add('hidden');
      refreshChipState();
    };
    customSave.addEventListener('click', commitCustom);
    customIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitCustom(); });
    customCancel.addEventListener('click', () => { customRow.classList.add('hidden'); });

    // ── Skip / Enable wiring ─────────────────────────────────
    document.getElementById('hk-preprompt-skip').addEventListener('click', () => {
      console.log('[Health] user declined pre-prompt — proceeding without HealthKit');
      close();
    });
    document.getElementById('hk-preprompt-enable').addEventListener('click', async () => {
      close();
      const result = await Health.requestPermissions();
      console.log('[Health] permission result:', result);
      if (result === 'granted') {
        // Try to verify immediately — if user has already walked today
        // OR slept past their goal last night, they get instant
        // gratification on both habits.
        autoVerifyWalk();
        autoVerifySleep();
      }
    });
  }

  // Auto-verify entry point. Called from renderHabits() on each render.
  // Async: returns a promise that resolves after the HealthKit query
  // completes (or short-circuits). Never throws — auto-verify is a
  // silent enhancement.
  async function autoVerifyWalk() {
    if (!Health.isAvailable()) return;          // web / non-iOS

    const walk = findWalkHabit();
    const status = Health.permissionStatus();

    // First-encounter path: show pre-prompt only when the user has the
    // walk habit (the prompt's whole purpose is to enable auto-verify
    // for that habit). Don't query HealthKit yet.
    if (status === 'unknown') {
      if (walk && localStorage.getItem('hb_healthkit_prompted') !== '1') {
        showHealthKitPreprompt();
      }
      return;
    }
    if (status !== 'granted') return;

    // Fetch steps once. Used by:
    //   1. Leaderboard recording — passive, ignores pause toggle and
    //      habit presence (matches the bosses pattern; we want
    //      historical depth even for users without the walk habit).
    //   2. Habit auto-verify — gated on habit presence + pause +
    //      already-checked + opted-out.
    const steps = await Health.getStepsToday();
    if (steps == null) return;

    // ── Leaderboard recording (v2.0.2) ─────────────────────
    // Independent of habit presence + pause toggle (see module
    // docs). Wrapped in try so a leaderboard bug can't break the
    // habit auto-verify path below.
    try { lbRecordStepsToday(steps); }
    catch (e) { console.warn('[Leaderboard] step record failed', e); }

    // ── Boss evaluation (Steel Wolf, D-rank) ───────────────
    // Same independence rules as the Insomniac/Carouser evaluators
    // in autoVerifySleep — bosses ignore the pause toggle and habit
    // presence. Idempotent on the day date so visibility-change
    // refires don't double-count. Wrapped in try for the same
    // reason as the leaderboard call.
    try {
      evaluateSteelWolfForDay(steps, getDeviceLocalDate());
    } catch (e) { console.warn('[Bosses] steel wolf eval failed', e); }

    // ── Habit auto-verify gates ────────────────────────────
    // User has paused auto-verify in Settings → Apple Health. Manual
    // completion path is unaffected. (v1.1.5)
    if (isAutoVerifyDisabled()) return;
    if (!walk) return;                           // user doesn't have the habit
    if (isChecked(walk.id)) return;              // already done (manual or auto)
    if (AUTO_VERIFY.wasUncheckedToday('Daily walk')) return;  // user opted out for today
    const threshold = getHabitStepGoal(walk);
    if (steps < threshold) return;

    AUTO_VERIFY.recordAutoVerify(walk.id, {
      source: 'healthkit-steps',
      value: steps,
      threshold: threshold,
    });

    // If the LI is currently in the DOM, animate via the standard
    // toggleHabit path (silent mode skips the burst). Otherwise mutate
    // state silently — UI catches up on next renderHabits().
    const li = document.querySelector('.habit-item[data-id="' + walk.id + '"]');
    toggleHabit(walk.id, li, { silent: true });
    console.log('[Health] auto-verified Daily walk:', steps, 'steps');

    // Re-render so buildItem() can paint the auto-verify pill into the
    // card. The next autoVerifyWalk() call from that render no-ops via
    // the isChecked() guard, so no loop.
    if (currentTab === 'habits') renderHabits();
  }
  try { window.autoVerifyWalk = autoVerifyWalk; } catch (_) {}

  // ── Sleep auto-verify orchestration (v1.1.5) ─────────────
  // Two parallel paths, both feeding from the same Health.getSleepLastNight()
  // query (single HealthKit roundtrip per render thanks to the sleep cache):
  //   - Sleep duration habit  → totalAsleepHours ≥ habit.sleepGoalHours
  //   - Sleep before midnight → earliestSleepStart < device-local midnight
  //
  // Triggered from renderHabits() and visibilitychange — same hooks as
  // autoVerifyWalk. Sleep data lands in HealthKit on user wake (Apple Watch)
  // or backfill (iPhone alarm), so neither auto-verify fires AT midnight;
  // they fire when the user opens the app in the morning.
  function findSleepHabit() {
    return habits.find(h => h.name === 'Sleep' && !h.custom) || null;
  }
  function findSleepBeforeMidnightHabit() {
    return habits.find(h => h.name === 'Sleep before midnight' && !h.custom) || null;
  }

  async function autoVerifySleep() {
    if (!Health.isAvailable()) return;

    const status = Health.permissionStatus();
    // Don't trigger the pre-prompt from the sleep path — autoVerifyWalk
    // already handles that. If status is 'unknown', let walk handle it.
    if (status !== 'granted') return;

    // Upgrade-path: existing v1.1.5 step-grant users granted Steps
    // before sleep was added to the auth array. iOS doesn't auto-prompt
    // on the first sleep query — we have to explicitly re-call
    // requestAuthorization with the new type. Idempotent + flagged in
    // localStorage so it only fires once per device. Fresh installs
    // pass through immediately (flag set during the bundled request).
    await Health.requestSleepPermissionIfNeeded();

    const data = await Health.getSleepLastNight();
    if (!data) return;

    // ── Boss evaluation (v1.1.7+) ───────────────────────────
    // Runs independently of habit presence + pause toggle. The
    // Settings → Apple Health pause is scoped to habit auto-verify
    // only; bosses are passive background progress and shouldn't be
    // gated on that. Both evaluators are idempotent on nightDate so
    // visibility-change refires don't double-count.
    //
    // Bedtime boolean is computed once from the shared helper and
    // reused below by Path B. The Carouser needs both signals (sleep
    // hours + before-midnight onset) so it gets the boolean here.
    const bedtimeQualifying = getBedtimeSamplesInWindow(data.samples || []);
    const bedtimeBeforeMidnight = bedtimeQualifying.length > 0;
    try {
      evaluateInsomniacForNight(data.totalAsleepHours, getDeviceLocalDate());
    } catch (e) { console.warn('[Bosses] insomniac eval failed', e); }
    try {
      evaluateCarouserForNight(data.totalAsleepHours, bedtimeBeforeMidnight, getDeviceLocalDate());
    } catch (e) { console.warn('[Bosses] carouser eval failed', e); }

    // ── Leaderboard recording (v2.0.2) ──────────────────────
    // Same independence rules as bosses — passive accumulation,
    // ignores pause toggle. Records both metrics in one call.
    try {
      lbRecordSleepNight(data.totalAsleepHours, bedtimeBeforeMidnight, getDeviceLocalDate());
    } catch (e) { console.warn('[Leaderboard] sleep record failed', e); }

    // ── Habit auto-verify — gated on pause toggle + habit presence ──
    if (isAutoVerifyDisabled()) return;
    const sleep = findSleepHabit();
    const bedtime = findSleepBeforeMidnightHabit();
    if (!sleep && !bedtime) return;

    // ── Path A: Sleep duration ──────────────────────────────
    if (sleep && !isChecked(sleep.id) && !AUTO_VERIFY.wasUncheckedToday('Sleep')) {
      const goalHours = getSleepGoalHours(sleep);
      if (data.totalAsleepHours >= goalHours) {
        // Re-check completion (async race with manual tap).
        if (!isChecked(sleep.id)) {
          AUTO_VERIFY.recordAutoVerify(sleep.id, {
            source: 'healthkit-sleep-duration',
            value: data.totalAsleepHours,
            threshold: goalHours,
          });
          const li = document.querySelector('.habit-item[data-id="' + sleep.id + '"]');
          toggleHabit(sleep.id, li, { silent: true });
          console.log('[Health] auto-verified Sleep:', data.totalAsleepHours.toFixed(2), 'h');
        }
      }
    }

    // ── Path B: Sleep before midnight ────────────────────────
    // STRICT WINDOW: sleep onset must be in [20:00, 24:00) device-local
    // on the prior day. The previous "any sample.startDate < midnight
    // today" check was too permissive — a Wednesday-night sleep block
    // (whose startDate is technically before Friday's midnight by ~24
    // hours) would falsely qualify Friday's bedtime habit when the user
    // had been awake all of Thursday into Friday morning. Also catches
    // afternoon naps (start before 8 PM) and "passed out at 6 PM"
    // exhaustion events as not-credit-worthy — those aren't an
    // intentional pre-midnight bedtime.
    //
    // CLAUDE.md: notifications + sleep windows use device-local time,
    // not PT — sleep crosses midnight, PT-anchoring is wrong.
    if (bedtime && !isChecked(bedtime.id) && !AUTO_VERIFY.wasUncheckedToday('Sleep before midnight')) {
      // Reuses the bedtimeQualifying array computed above (boss path).
      // Single source-of-truth via getBedtimeSamplesInWindow().
      const qualifying = bedtimeQualifying;

      if (qualifying.length > 0) {
        const earliest = qualifying[0].start;
        AUTO_VERIFY.recordAutoVerify(bedtime.id, {
          source: 'healthkit-sleep-bedtime',
          value: earliest.toISOString(),
        });
        const li = document.querySelector('.habit-item[data-id="' + bedtime.id + '"]');
        toggleHabit(bedtime.id, li, { silent: true });
        console.log('[Health] auto-verified Sleep before midnight:', earliest.toISOString());
      } else {
        console.log('[Health] Sleep before midnight: no qualifying onset in [20:00, 24:00) window');
      }
    }

    // Single re-render after both paths — buildItem() picks up new pills,
    // next render's autoVerifySleep() no-ops via isChecked() guards.
    if (currentTab === 'habits') renderHabits();
  }
  try { window.autoVerifySleep = autoVerifySleep; } catch (_) {}

  // ── INIT ─────────────────────────────────────────────────
  function init() {
    load();
    // v2.0.1 rank-scaling overhaul — fraction-based XP migration runs
    // once per device. Must happen AFTER load() (totalPoints loaded)
    // and BEFORE any rank-rendering / achievement-checking that
    // reads totalPoints. See migrateXPToNewThresholds() for rationale.
    try { migrateXPToNewThresholds(); } catch (_) {}
    today = getPTDate();
    histViewYear  = parseInt(today.slice(0, 4), 10);
    histViewMonth = parseInt(today.slice(5, 7), 10) - 1;
    if (currentClass === null) {
      // First run — set class silently, no popup
      currentClass = determineClass();
      localStorage.setItem('hb_class', currentClass);
    }
    // ── v1.2 migration: re-classify under new Lv5 rules ────────
    // Existing users currently classified under the old rules (e.g.,
    // Sage at all-Lv2) get silently re-evaluated. Most early users
    // will end up Civilian until they earn Lv5 in at least one stat.
    if (!localStorage.getItem('hb_class_v2_migrated')) {
      const r = evaluateClass(currentClass);
      // For migration we never fire popups — even if multi-stat choice
      // would apply, leave them as their current class (or Civilian if
      // they don't qualify) and the choice will trigger naturally on
      // their next level-up after upgrading.
      const target = r.choice ? 'CIVILIAN' : r.class;
      if (target !== currentClass) {
        currentClass = target;
        localStorage.setItem('hb_class', currentClass);
      }
      // Pre-flag awakening as already-seen if user was already in a class
      // before migration — they shouldn't get the first-time celebration
      // for a class they were already running.
      if (currentClass !== 'CIVILIAN') {
        localStorage.setItem('hb_awakened_once', '1');
      }
      localStorage.setItem('hb_class_v2_migrated', '1');
    }
    // ── v1.1.5 migration: rename canonical 'Cardio' → 'Cardio workout'.
    // The original name read as redundant with 'Daily walk' in the
    // habit grid; the rename signals "dedicated training session" to
    // distinguish it from ambient steps. Habit identity is the name
    // string (CLAUDE.md), so we rewrite habit.name in-place. Streaks,
    // completions, and PRs continue to work because they're keyed by
    // habit.id, not name.
    if (!localStorage.getItem('hb_cardio_renamed')) {
      let didRename = false;
      habits.forEach(h => {
        if (h && h.name === 'Cardio' && !h.custom) {
          h.name = 'Cardio workout';
          didRename = true;
        }
      });
      if (didRename) save();
      localStorage.setItem('hb_cardio_renamed', '1');
    }
    // ── v2.0.2 Daily walk step-target migration (v2.1 patch) ────
    // The legacy default for Daily walk's stepGoal was 3000 (set
    // during an earlier dev cycle). HEALTHKIT_WALK_DEFAULT_THRESHOLD
    // was bumped to 8000 mid-v2.0.2, but users seeded before the
    // bump still carry the stale 3000 value in localStorage.
    //
    // Migration targets ONLY the exact stale-default value 3000.
    // Users who deliberately customized below 8000 (e.g., 5000 for
    // injury recovery) are left untouched — only the rote 3000
    // default gets bumped. Habit identity is the name string per
    // CLAUDE.md convention; we match canonical 'Daily walk' on
    // non-custom habits.
    //
    // Idempotent via hb_walk_target_migrated_v1. Sets the flag
    // regardless of whether anything was changed, so users without
    // the habit (or who already customized) don't get re-scanned
    // on every app open.
    if (!localStorage.getItem('hb_walk_target_migrated_v1')) {
      let didBump = false;
      habits.forEach(h => {
        if (h && h.name === 'Daily walk' && !h.custom && h.stepGoal === 3000) {
          h.stepGoal = 8000;
          didBump = true;
        }
      });
      if (didBump) save();
      localStorage.setItem('hb_walk_target_migrated_v1', '1');
    }
    // ── v1.1.5 bedtime window-fix recovery ────────────────────
    // The pre-fix bedtime auto-verify could false-positive when the
    // user had any prior asleep sample whose startDate fell before
    // device-local midnight today — including wrong-night carryovers
    // (Wed-night sleep showing on Fri's check) and afternoon naps.
    // Now scoped strictly to [20:00, 24:00) device-local on the prior
    // day. This one-time migration clears today's false-positive on
    // first launch of the fixed build so the new strict logic gets to
    // re-evaluate against actual data. Idempotent via flag.
    // ── v2.1 content patch — inventory backfill for new commons ───
    // 6 new common cards were added in v2.1 (2 per existing boss
    // filling previously-empty slots). loadInventory's existing
    // backfill loop catches new card IDs on next read, but we set
    // an explicit migration flag so the operation is observable and
    // testable. Reading hb_inventory triggers the backfill via
    // Object.keys(CARDS).forEach in loadInventory; the flag merely
    // marks "we've seen the v3-commons schema."
    if (!localStorage.getItem('hb_inventory_commons_v3_migrated')) {
      try {
        const inv = getInventory(); // forces loadInventory → backfill
        // Defensive: ensure the 6 new ids are present even if the
        // backfill loop changed shape in some edge case.
        const newCommonIds = [
          'tossing_bedroll', 'drowsy_signet',
          'sobriety_token',  'steady_steps',
          'pups_hood',       'trackers_wrap',
        ];
        let mutated = false;
        newCommonIds.forEach(id => {
          if (!inv.cards[id]) {
            inv.cards[id] = { discovered: false, count: 0, first_acquired_date: null };
            mutated = true;
          }
        });
        if (mutated) persistInventory();
      } catch (_) {}
      localStorage.setItem('hb_inventory_commons_v3_migrated', '1');
    }
    if (!localStorage.getItem('hb_bedtime_window_fix_v1')) {
      try {
        const bedtimeHabit = habits.find(h => h && h.name === 'Sleep before midnight' && !h.custom);
        if (bedtimeHabit && AUTO_VERIFY.isAutoVerifiedToday(bedtimeHabit.id)) {
          // Clear auto-verify metadata FIRST so toggleHabit's path
          // doesn't see this as an "un-check of an auto-verified
          // completion" (which would call markUnchecked and block
          // re-verification today). Direct mutation of completions[today]
          // + XP reversal mirrors what toggleHabit would do, minus the
          // markUnchecked side-effect we don't want.
          AUTO_VERIFY.clearAutoVerify(bedtimeHabit.id);
          if (Array.isArray(completions[today])) {
            const idx = completions[today].indexOf(bedtimeHabit.id);
            if (idx >= 0) {
              completions[today].splice(idx, 1);
              const diff = bedtimeHabit.difficulty || 'medium';
              const pts = (DIFFICULTY[diff] && DIFFICULTY[diff].pts) || 3;
              totalPoints = Math.max(0, totalPoints - pts);
              save();
            }
          }
          console.log('[Migration] Cleared bedtime false-positive for', today);
        }
      } catch (_) {}
      localStorage.setItem('hb_bedtime_window_fix_v1', '1');
    }
    // ── v2.0 habits-order migration ──────────────────────────
    // Apply the auto-verify-first invariant once on cold launch.
    // Idempotent — sortHabitsAutoVerifyFirst is a no-op when the
    // array is already partitioned correctly. Existing v1.x users
    // get a one-time reorder; newly added habits stay sorted via
    // save() which calls the same helper.
    sortHabitsAutoVerifyFirst(habits);

    // ── Insomniac missed-night check (v1.1.7) ───────────────
    // Detects a calendar-day gap since last evaluation and resets
    // the streak. Init-only — visibilitychange resumes don't trigger
    // this (multi-foreground days would mis-reset). See
    // checkMissedNightForInsomniac for first-install handling.
    // v2.0.1: opt all existing-state bosses out of the new engagement
    // model on first launch post-deploy. Idempotent — runs once via
    // localStorage flag, never again. MUST run before the missed-
    // period checks below so they see the cleared streak/eval state
    // and short-circuit on the new engagement gate.
    try { migrateBossesToEngagementModel(); } catch (_) {}
    // v2.0.1 Souls currency — load (or grant first-install starting
    // balance), then try the daily login bonus (idempotent on
    // device-local calendar day). Order matters: load before grant.
    try { loadSouls(); } catch (_) {}
    try { tryGrantDailyLoginBonus(); } catch (_) {}
    try { refreshSoulsDisplay(); } catch (_) {}
    try { checkMissedNightForInsomniac(); } catch (_) {}
    try { checkMissedWeekendForCarouser(); } catch (_) {}
    try { checkMissedDayForSteelWolf(); } catch (_) {}
    // ── HealthKit auth-version migration ─────────────────────
    // Whenever HEALTHKIT_AUTH_VERSION is bumped (i.e., a new HealthKit
    // category was added to the requestAuthorization() read array),
    // existing users with status='granted' need to re-fire the auth
    // call so iOS shows a sheet for the newly-added categories. We
    // can't detect "category not yet authorized" via the plugin API
    // — Apple intentionally hides denial state for read scopes. So we
    // version the auth surface and let the upgrade-gate re-fire when
    // the stored version is older than current.
    //
    // This pattern obsoletes the v1.1.5-only hb_sleep_recovery_v1
    // flag (which only addressed the specific dev-build bug) and
    // generalizes it for every future category addition.
    try {
      const stored = parseInt(localStorage.getItem('hb_healthkit_authversion') || '0', 10);
      if (!Number.isFinite(stored) || stored < HEALTHKIT_AUTH_VERSION) {
        HEALTHKIT_AUTH_FLAGS_TO_CLEAR.forEach(k => {
          try { localStorage.removeItem(k); } catch (_) {}
        });
        localStorage.setItem('hb_healthkit_authversion', String(HEALTHKIT_AUTH_VERSION));
      }
    } catch (_) {}
    // ── v1.1.5 sleep auth upgrade-path ───────────────────────
    // Existing v1.1.5 step-grant users granted Steps before sleep was
    // added to the auth array. Fire once per cold launch (idempotent
    // via hb_healthkit_sleep_requested flag inside the helper). Not
    // gated on having a sleep habit — future-proofs against users
    // adding Sleep / Sleep before midnight later.
    //
    // Slight delay so the WebView is fully ready before iOS draws the
    // permission sheet — avoids races during app cold launch.
    try {
      if (Health.isAvailable() && Health.permissionStatus() === 'granted') {
        if (localStorage.getItem('hb_healthkit_sleep_requested') !== '1') {
          setTimeout(() => {
            try { Health.requestSleepPermissionIfNeeded(); } catch (_) {}
          }, 1500);
        }
      }
    } catch (_) {}
    setupTabs();
    setupLibrary();
    setupSchedulePicker();
    setupCtxMenu();
    setupEditModal();
    setupNoteModal();
    setupDailyInsight();
    setupCompoundPopup();
    setupBonusInfoPopup();
    setupPRDetailSheet();
    setupBossesPanel();
    setupQuestsGate();
    setupLeaderboardPreview();
    setupSoulsInfoModal();
    // v2.0.1 DROPS Phase 1 — inventory + reveal + Pokédex wiring.
    try { loadInventory(); } catch (_) {}
    setupCardRevealModal();
    setupPokedex();
    setupCardDetailModal();
    // Process any reveals queued from drops that happened in a prior
    // session but the modal didn't get a chance to show (e.g., user
    // closed app mid-reveal). DROPS.md spec: "Show them one at a
    // time on next app open. Don't drop any."
    try { setTimeout(() => processRevealQueue(), 800); } catch (_) {}
    setupHonestDayModal();
    setupShieldInfoModal();
    setupOriginStorySheet();
    migrateOriginStoriesIfNeeded();
    // v3: rewrite story text using the new tightened templates while
    // preserving original dates/classes. Idempotent via hb_origin_v3_migrated.
    migrateOriginTextV3IfNeeded();
    // v4: strip leading date from story body so the date only appears in
    // the chapter header. Idempotent via hb_origin_v4_migrated.
    migrateOriginTextV4IfNeeded();
    // Streak forgiveness: on app open, process missed days (use shields /
    // absorb honest days / break streaks), then surface any queued shield
    // notices as toasts, then check for comeback opportunity if the user
    // has a pending break flag.
    processStreakRollover();
    setTimeout(() => flushPendingShieldNotices(), 800);
    migratePRsIfNeeded();
    setupEmojiPicker();
    setupCustomHabitModal();
    setupReminderOfferModal();
    setupStreaksSheet();
    setupClassDetail();
    setupNotifTapRouting();
    setupStatDetail();
    setupSettings();
    setupStreakDanger();
    setupMorningNudge();
    setupDoubleXpBanner();
    setupHabitInfoSheet();
    setupHabitDetailGesture();
    setupWhatsNewSheet();
    setupRankPopup();
    setupXpDetail();

    // Reflect canonical APP_VERSION in the Settings header
    const verEl = document.getElementById('settings-app-ver');
    if (verEl) verEl.textContent = 'Version ' + APP_VERSION;

    // Settings → "What's New" button (manual open — does NOT update flag)
    const wnBtn = document.getElementById('settings-whats-new-btn');
    if (wnBtn) {
      wnBtn.addEventListener('click', () => {
        // Close settings first so the new sheet has a clean stage
        if (typeof closeSettings === 'function') closeSettings();
        setTimeout(() => openWhatsNewSheet({ manual: true }), 320);
      });
    }

    document.getElementById('day-popup-overlay').addEventListener('click', closeDayPopup);
    document.getElementById('day-popup').addEventListener('click', closeDayPopup);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      checkDayChange();
      // App resume → invalidate both HealthKit caches and re-attempt
      // both auto-verifies. User may have walked or finished sleeping
      // while we were backgrounded; sleep data in particular only
      // appears in HealthKit on wake (Apple Watch) or alarm-time
      // backfill (iPhone), so resume is a high-yield moment.
      try { Health.clearCache       && Health.clearCache();       } catch (_) {}
      try { Health.clearSleepCache  && Health.clearSleepCache();  } catch (_) {}
      try { autoVerifyWalk();  } catch (_) {}
      try { autoVerifySleep(); } catch (_) {}
      // v2.1.0 Phase C — push fresh metric snapshot to backend on
      // resume. Debounced to 5 min so rapid foreground/background
      // cycling doesn't hammer the workers.
      try { lbSubmitAllMetricsDebounced(); } catch (_) {}
      // Daily Insight retry — if user backgrounded across midnight and
      // resumed in the morning, this is the natural moment to fire.
      // shouldShowDailyInsight() handles all gating (Day 1, already
      // shown today, modal-stack conflict).
      try { if (shouldShowDailyInsight()) showDailyInsight(); } catch (_) {}
    });
    setInterval(() => { checkDayChange(); checkStreakDanger(); checkMorningRoutineNudge(); }, 60_000);
    registerSW();

    // Reschedule habit reminders on app open. Picks up pause-expirations,
    // any habits/reminders the user added on another device, and re-arms
    // notifications so iOS has them ready while the app is closed.
    setTimeout(() => {
      try { Notif.rescheduleAll(habits, today, completions[today] || []); } catch (_) {}
      // Also re-arm the daily morning digest (the default reminder).
      try { Notif.reapplyDigest(); } catch (_) {}
      // Re-arm the 7 PM check-in + 1 PM mid-day check-in (rescheduleAll
      // above already does both internally, but call explicitly for
      // resilience if the per-habit path is ever short-circuited).
      try { Notif.reapplyCheckin(); } catch (_) {}
      try { Notif.reapplyMidDay(); } catch (_) {}
      // v2.1.0 Phase C — fire the leaderboard snapshot submission
      // after main app mounts. Debounced via hb_lb_last_submit so a
      // hot relaunch within 5 min stays quiet.
      try { lbSubmitAllMetricsDebounced(); } catch (_) {}
    }, 1200);

    if (needsWelcome) {
      showWelcomeScreen();
    } else if (needsOnboarding) {
      showPathScreen();
    } else {
      render();
      setupFridayBanner();
      // Auto-show What's New for users who already finished onboarding
      // and have either never seen this version or last saw an older one.
      maybeAutoShowWhatsNew();
      // Daily Insight — fires once per device-local calendar day for
      // fully-onboarded users. Deferred long enough that What's New
      // (if eligible) opens first; shouldShowDailyInsight() checks for
      // a visible What's New sheet and silently defers if so. The
      // visibilitychange handler picks it up on the next resume.
      setTimeout(() => {
        try { if (shouldShowDailyInsight()) showDailyInsight(); } catch (_) {}
      }, 900);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();