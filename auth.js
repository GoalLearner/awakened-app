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

  // ── BACKEND URL ──────────────────────────────────────────────
  // v2.1.0 Phase B: real backend at Cloudflare Workers. POST
  // /v1/auth/verify exchanges Apple identityToken + alias for a
  // session JWT. Same URL for prod web/PWA AND production iOS.
  // Localhost dev bypasses this entirely via devSignInIfLocalhost().
  // To rotate (e.g., custom domain in v2.2+), edit here only.
  const BACKEND_URL = 'https://awakened-backend.richmondcampano93.workers.dev';

  // Backend session JWT lifetime — matches BACKEND.md §4. 90 days
  // total; client uses isJwtNearExpiry() to silently re-authorize
  // via Apple when <14 days remain.
  const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

  // Localhost dev-bypass JWT marker. Phase B's backend explicitly
  // rejects this string + the matching sub/alias pattern at
  // verifySessionJwt time — defense-in-depth so dev state can never
  // reach the prod user table.
  const LOCALHOST_DEV_STUB = 'LOCALHOST_DEV_STUB';

  // Legacy Phase A stub marker (kept as a STRING LITERAL ONLY for
  // migration purposes — no longer assigned anywhere). Phase A
  // builds wrote `jwt: 'PHASE_A_STUB'` into hb_user before the real
  // backend existed. On Phase B's first launch, getCurrentUser()
  // returns null for any user whose jwt matches this literal,
  // forcing the gate to re-show and the user to sign in fresh
  // against the real backend. Their habit/streak/inventory state
  // (stored under separate hb_* keys) survives the migration.

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
  // and legacy Phase A stub JWTs as "no user" so the sign-in gate
  // re-appears and the user re-authorizes against the real backend.
  // The dev-stub (LOCALHOST_DEV_STUB) is exempt — dev users stay
  // signed in locally without backend contact.
  function getCurrentUser() {
    const u = readUser();
    if (!u || !u.sub || !u.jwt) return null;
    // Legacy Phase A stub migration: force re-auth against real backend.
    if (u.jwt === 'PHASE_A_STUB') return null;
    // Localhost dev stub is always valid on localhost (no expiry check).
    if (u.jwt === LOCALHOST_DEV_STUB) return u;
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

  // True when JWT is within 14 days of expiry. Phase A stubs and
  // dev-stubs return false (no real backend session to refresh).
  function isJwtNearExpiry() {
    const u = readUser();
    if (!u || !u.jwt_expires_at) return true;
    if (u.jwt === LOCALHOST_DEV_STUB) return false;
    if (u.jwt === 'PHASE_A_STUB') return true;  // force re-auth
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

  // In-memory transient state held between signInWithApple() (step 1)
  // and completeSignIn(alias) (step 2). NEVER persisted to localStorage
  // — if the user force-quits between steps, they re-authorize with
  // Apple on next launch. This is correct: Apple identity tokens are
  // short-lived (10 min) and a fresh one is required for backend
  // verification anyway.
  let _pendingIdentityToken = null;
  let _pendingAppleSub = null;
  let _pendingApplePayload = null; // { givenName, familyName, email } for UX pre-fill

  // Invokes the Apple Sign-In native flow. Returns the Apple plugin's
  // raw response on success (so the gate UI can pre-fill the alias
  // picker with Apple's givenName if available), or null on cancel.
  // Stores the identityToken in module memory for completeSignIn() to
  // POST to the backend.
  async function signInWithApple() {
    const plugin = getApplePlugin();
    if (!plugin) {
      // Web/PWA or plugin-not-registered. Real iOS hits the native
      // plugin; web/PWA users will see the gate UI's inline error.
      throw new Error('NATIVE_ONLY');
    }
    let response;
    try {
      const result = await plugin.authorize({
        clientId: 'com.goallearner.awakened',
        redirectURI: '',
        scopes: 'name email',
        // Random nonce; opaque to the client beyond round-tripping
        // through Apple's signed identity token.
        state: Math.random().toString(36).slice(2),
      });
      response = result && result.response ? result.response : null;
    } catch (e) {
      return null;
    }
    if (!response || !response.user || !response.identityToken) return null;

    _pendingIdentityToken = response.identityToken;
    _pendingAppleSub = response.user;
    _pendingApplePayload = {
      givenName:  response.givenName || null,
      familyName: response.familyName || null,
      email:      response.email || null,
    };
    return response;
  }

  // POSTs the cached Apple identityToken + chosen alias to the backend
  // and writes the resulting session JWT to hb_user. Returns a typed
  // result object the gate UI can switch on:
  //
  //   { ok: true }                                   — signed in
  //   { ok: false, code: 'ALIAS_INVALID', reason }   — local validation
  //   { ok: false, code: 'ALIAS_TAKEN', suggested: [...] }
  //   { ok: false, code: 'NO_PENDING_TOKEN', reason } — must re-Apple
  //   { ok: false, code: 'APPLE_TOKEN_INVALID', reason }
  //   { ok: false, code: 'NETWORK', reason }
  //   { ok: false, code: 'BACKEND_ERROR', reason }
  //
  // The gate UI for each failure case: ALIAS_TAKEN renders the 3
  // suggestion chips below the input; NO_PENDING_TOKEN / APPLE_TOKEN_INVALID
  // reset to the Apple-sign-in step; ALIAS_INVALID surfaces inline;
  // NETWORK / BACKEND_ERROR show a generic retry message.
  async function completeSignIn(alias) {
    if (!validateAlias(alias)) {
      return {
        ok: false,
        code: 'ALIAS_INVALID',
        reason: '3–20 chars, letters/numbers/space/_/- only.',
      };
    }
    if (!_pendingIdentityToken || !_pendingAppleSub) {
      return {
        ok: false,
        code: 'NO_PENDING_TOKEN',
        reason: 'Apple sign-in expired. Please sign in again.',
      };
    }

    let res;
    try {
      res = await fetch(BACKEND_URL + '/v1/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identityToken: _pendingIdentityToken,
          alias:         alias.trim(),
        }),
      });
    } catch (e) {
      return {
        ok: false,
        code: 'NETWORK',
        reason: 'Could not reach server. Check your connection.',
      };
    }

    let data;
    try { data = await res.json(); } catch (_) { data = null; }

    if (res.status === 200 && data && data.jwt) {
      writeUser({
        sub:            _pendingAppleSub,
        alias:          data.alias,
        jwt:            data.jwt,
        jwt_expires_at: Date.now() + SESSION_TTL_MS,
        signed_in_date: deviceLocalDate(),
      });
      try { localStorage.setItem('hb_name', data.alias); } catch (_) {}
      // Clear in-memory pending state — the identityToken has served
      // its purpose and Apple's tokens are single-use anyway.
      _pendingIdentityToken = null;
      _pendingAppleSub = null;
      _pendingApplePayload = null;
      return { ok: true, alias: data.alias, isNewUser: !!data.isNewUser };
    }

    if (res.status === 409 && data && data.error === 'ALIAS_TAKEN') {
      return {
        ok: false,
        code: 'ALIAS_TAKEN',
        reason: data.detail || 'That alias is taken. Try one of these.',
        suggested: Array.isArray(data.suggested) ? data.suggested : [],
      };
    }

    if (res.status === 400 && data && data.error === 'ALIAS_INVALID') {
      return {
        ok: false,
        code: 'ALIAS_INVALID',
        reason: data.detail || 'Alias rejected by server.',
      };
    }

    if (res.status === 401) {
      // Apple token rejected by backend — clear in-memory cache,
      // gate UI returns to Apple step.
      _pendingIdentityToken = null;
      _pendingAppleSub = null;
      _pendingApplePayload = null;
      return {
        ok: false,
        code: 'APPLE_TOKEN_INVALID',
        reason: (data && data.detail) || 'Sign in expired. Please sign in again.',
      };
    }

    return {
      ok: false,
      code: 'BACKEND_ERROR',
      reason: (data && data.detail) || ('Server responded ' + res.status + '.'),
    };
  }

  // Returns the cached Apple payload from signInWithApple() so the
  // alias picker can pre-fill with Apple's givenName if shared. null
  // if no pending Apple flow.
  function getPendingApplePayload() {
    return _pendingApplePayload;
  }

  // Hard-deletes the current user's backend account by POSTing to
  // /v1/account/delete with the active session JWT. On success the
  // backend cascade-deletes the user's row + all leaderboard
  // snapshots (FK ON DELETE CASCADE in migration 0001).
  //
  // Returns a typed result the caller switches on:
  //   { ok: true }                          — backend deleted; clear local + reload
  //   { ok: true, code: 'LOCAL_DEV_CLEARED' } — localhost dev path, no backend call
  //   { ok: false, code: 'NOT_SIGNED_IN' }  — no JWT to send (shouldn't happen if UI flow is correct)
  //   { ok: false, code: 'EXPIRED' }        — backend returned 401; session expired mid-modal
  //   { ok: false, code: 'NETWORK' }        — fetch threw (offline, DNS, etc.)
  //   { ok: false, code: 'BACKEND_ERROR' }  — 5xx or unexpected status
  //
  // Side effect on ok+EXPIRED: clears hb_user (the user is effectively
  // signed out). Side effect on NETWORK / BACKEND_ERROR: NOTHING —
  // backend may or may not have processed the delete; caller should
  // surface a retry prompt and preserve local state.
  async function deleteAccount() {
    const u = readUser();
    if (!u || !u.jwt) {
      return { ok: false, code: 'NOT_SIGNED_IN', detail: 'No active session.' };
    }

    // Localhost dev path: never call backend. Just clear local state
    // so the dev gate re-arms on next load.
    if (u.jwt === LOCALHOST_DEV_STUB) {
      clearUser();
      return { ok: true, code: 'LOCAL_DEV_CLEARED' };
    }

    let res;
    try {
      res = await fetch(BACKEND_URL + '/v1/account/delete', {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + u.jwt },
      });
    } catch (e) {
      // Network failure — preserve local state so user can retry.
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }

    let data;
    try { data = await res.json(); } catch (_) { data = null; }

    if (res.status === 200) {
      clearUser();
      // Defensive: clear leaderboard cache if Phase C lands one later.
      try { localStorage.removeItem('hb_lb_cache'); } catch (_) {}
      return { ok: true };
    }

    if (res.status === 401) {
      // Session expired between modal-open and Delete-Forever tap.
      // Clear hb_user since the JWT's worthless either way.
      clearUser();
      return {
        ok: false,
        code: 'EXPIRED',
        detail: (data && data.detail) || 'Session expired.',
      };
    }

    // 5xx or unexpected. Local state preserved — backend may or may
    // not have processed; if next sign-in shows the user still exists,
    // they can retry the delete.
    return {
      ok: false,
      code: 'BACKEND_ERROR',
      detail: (data && data.detail) || ('Server responded ' + res.status + '.'),
    };
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
    getPendingApplePayload,
    deleteAccount,
    devSignInIfLocalhost,
    isLocalhostDev,
    isNative,
    BACKEND_URL,
  };
})();
