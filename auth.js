// auth.js — Sign in with Apple gate + session helpers (v2.1 Phase A).
//
// Requires Apple Developer Portal capability enabled on
// com.goallearner.awakened — see BACKEND.md §4.
//
// PHASE A SCOPE: scaffolding only. The /auth/verify endpoint does not
// exist yet (Phase B). On successful Apple authorize, this module
// writes a STUB hb_user with jwt = "PHASE_A_STUB" so the gate flow
// can be tested end-to-end without a backend. Phase B replaces the
// stub in signInWithApple() with a real POST to /v1/auth/verify.
//
// Loaded BEFORE app.js. app.js's IIFE checks Auth.getCurrentUser()
// at the top and short-circuits if null — the main app does not
// mount until the user is signed in.
//
// All helpers exposed on window.Auth.

(function () {
  'use strict';

  const STORAGE_KEY = 'hb_user';
  // Phase A stub JWT marker — Phase B grep target. EXACTLY ONE reference
  // in this codebase should exist (this line + the assignment below).
  const PHASE_A_STUB_JWT = 'PHASE_A_STUB';
  // Phase A stub expiry — far future so the gate doesn't re-prompt for
  // re-auth during Phase A testing. Phase B will use a real ~90-day
  // expiry from the backend.
  const PHASE_A_STUB_EXPIRY_MS = 1000 * 60 * 60 * 24 * 365; // 1 year

  // Localhost dev-bypass marker — INTENTIONALLY DISTINCT from
  // PHASE_A_STUB_JWT. Phase B's backend wiring will identify and reject
  // localhost-stub users so they never reach the real /v1/auth/verify
  // endpoint (dev state shouldn't pollute the prod user table). Grep
  // target for future cleanup. See devSignInIfLocalhost() below.
  const LOCALHOST_DEV_STUB = 'LOCALHOST_DEV_STUB';

  // Resolves the Capacitor plugin reference. Returns null on web/PWA
  // (plugin is iOS-only). Tolerant of plugin-not-yet-registered cases.
  function getApplePlugin() {
    try {
      const cap = window.Capacitor;
      if (!cap || !cap.Plugins) return null;
      return cap.Plugins.SignInWithApple || null;
    } catch (_) {
      return null;
    }
  }

  function isNative() {
    try {
      return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  }

  function deviceLocalDate() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // ── Storage helpers ──────────────────────────────────────────

  function readUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function writeUser(user) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch (_) {}
  }

  // ── Public API ───────────────────────────────────────────────

  // Returns the current signed-in user or null. Treats expired JWTs
  // as "no user" so callers don't have to check expiry separately.
  // Phase A: PHASE_A_STUB_JWT bypasses expiry-as-missing (it's
  // intentionally far-future and valid for the testing window).
  function getCurrentUser() {
    const u = readUser();
    if (!u || !u.sub || !u.jwt) return null;
    if (u.jwt === PHASE_A_STUB_JWT) return u;
    const nowMs = Date.now();
    if (typeof u.jwt_expires_at === 'number' && u.jwt_expires_at <= nowMs) {
      return null;
    }
    return u;
  }

  function getJwt() {
    const u = readUser();
    return (u && u.jwt) ? u.jwt : null;
  }

  function clearUser() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  // True when JWT is within 14 days of expiry. Phase A stub returns
  // false (stub expiry is 1 year out). Phase B uses this to trigger
  // silent re-authorize via SignInWithApple.authorize().
  function isJwtNearExpiry() {
    const u = readUser();
    if (!u || !u.jwt_expires_at) return true;
    if (u.jwt === PHASE_A_STUB_JWT) return false;
    const nowMs = Date.now();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    return (u.jwt_expires_at - nowMs) < fourteenDaysMs;
  }

  // Alias validation. Server has final say (Phase B); client-side
  // mirror for instant feedback in the gate UI.
  // Rules: 3–20 chars, [A-Za-z0-9 _-] only. No leading/trailing space.
  function validateAlias(alias) {
    if (typeof alias !== 'string') return false;
    const trimmed = alias.trim();
    if (trimmed !== alias) return false;
    if (trimmed.length < 3 || trimmed.length > 20) return false;
    return /^[A-Za-z0-9 _-]+$/.test(trimmed);
  }

  // Invokes the Apple Sign-In native flow. Returns the Apple plugin
  // response on success, or null on cancel/failure. On success, writes
  // a STUB hb_user with the Apple sub but no alias yet — the caller
  // (gate UI) transitions to the alias picker, which then invokes
  // completeSignIn(alias) to fill in the alias.
  //
  // PHASE A STUB: does NOT POST to /auth/verify. Phase B replaces
  // this with a real fetch.
  async function signInWithApple() {
    const plugin = getApplePlugin();
    if (!plugin) {
      // Web/PWA or plugin-not-registered — Phase A can't proceed.
      // The gate UI surfaces a friendly error in this case.
      throw new Error('NATIVE_ONLY');
    }
    let response;
    try {
      const result = await plugin.authorize({
        clientId: 'com.goallearner.awakened',
        redirectURI: '',
        scopes: 'name email',
        // Random nonce per BACKEND.md §4; opaque to the client beyond
        // round-tripping through Apple's signed identity token.
        state: Math.random().toString(36).slice(2),
      });
      response = result && result.response ? result.response : null;
    } catch (e) {
      // User cancellation or plugin error. Return null so the gate
      // stays on the "Sign in with Apple" step.
      return null;
    }
    if (!response || !response.user) return null;

    // Write the Phase A stub. The alias is null until the user picks
    // one via completeSignIn(). The gate UI gates main-app mounting
    // on hb_user.alias being set (see app.js gate guard).
    writeUser({
      sub:            response.user,
      alias:          null,
      jwt:            PHASE_A_STUB_JWT,
      jwt_expires_at: Date.now() + PHASE_A_STUB_EXPIRY_MS,
      signed_in_date: deviceLocalDate(),
    });
    return response;
  }

  // Finalizes the sign-in flow by recording the user's chosen alias.
  // Validates client-side (server-side check arrives in Phase B).
  // Also writes hb_name = alias for back-compat with existing code
  // that reads hb_name (the in-app personalization throughout app.js).
  function completeSignIn(alias) {
    if (!validateAlias(alias)) return false;
    const u = readUser();
    if (!u) return false;
    u.alias = alias.trim();
    writeUser(u);
    try {
      localStorage.setItem('hb_name', alias.trim());
    } catch (_) {}
    return true;
  }

  // ── Localhost dev-bypass ─────────────────────────────────────
  // Phase A's mandatory sign-in gate calls SignInWithApple.authorize()
  // which only works under Capacitor's native iOS WebView. On a
  // localhost dev server (serve.ps1 → http://localhost:8080) the
  // Apple button is unreachable, leaving devs locked at the gate
  // with no way to test changes to the rest of the app.
  //
  // isLocalhostDev() detects "web browser AND localhost-shaped host"
  // AND explicitly excludes Capacitor native — which is critical
  // because Capacitor's iOS WebView ALSO uses 'localhost' as the
  // hostname (capacitor://localhost scheme). Without the
  // isNative() exclusion, this bypass would silently fire on
  // production iOS too — breaking the entire mandatory-gate
  // contract for real users.
  function isLocalhostDev() {
    try {
      if (isNative()) return false;
      const host = window.location.hostname;
      return host === 'localhost' ||
             host === '127.0.0.1' ||
             host === '0.0.0.0' ||
             host.endsWith('.local');
    } catch (_) {
      return false;
    }
  }

  // Writes a stable dev-user entry to localStorage so the sign-in
  // gate's `(user && user.alias)` check passes immediately on
  // localhost. No-op outside localhost. No-op if a real user is
  // already signed in (don't overwrite intentional state — devs
  // who tested with their own Apple ID keep that identity).
  //
  // Stable sub + alias means the dev user persists across reloads
  // and never hits the alias picker. LOCALHOST_DEV_STUB jwt marker
  // is intentionally distinct from PHASE_A_STUB so Phase B's
  // backend can reject dev-stub users at /v1/auth/verify and stop
  // them from polluting the prod user table.
  function devSignInIfLocalhost() {
    if (!isLocalhostDev()) return false;
    if (readUser()) return false; // respect existing user state
    writeUser({
      sub:            'localhost-dev-user',
      alias:          'DevUser',
      jwt:            LOCALHOST_DEV_STUB,
      // ~10-year expiry — well beyond any reasonable dev cycle
      jwt_expires_at: Date.now() + (1000 * 60 * 60 * 24 * 365 * 10),
      signed_in_date: deviceLocalDate(),
    });
    try { localStorage.setItem('hb_name', 'DevUser'); } catch (_) {}
    return true;
  }

  // Expose on window for app.js + Settings interactions.
  window.Auth = {
    getCurrentUser,
    getJwt,
    clearUser,
    isJwtNearExpiry,
    validateAlias,
    signInWithApple,
    completeSignIn,
    devSignInIfLocalhost,
    isLocalhostDev,
    // Diagnostic flag — Phase B will set this to false (no stub anymore)
    // and add backend-side health-check helpers.
    PHASE_A: true,
    isNative,
  };
})();
