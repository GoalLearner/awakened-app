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

  // ── Leaderboard helpers (v2.1.0 Phase C) ─────────────────────
  // submitLeaderboardSnapshot + fetchLeaderboardTop POST/GET against
  // the live Cloudflare Worker. Both return typed result objects so
  // callers can switch on result.code without nested response parsing.
  //
  // Stub-user gating: PHASE_A_STUB and LOCALHOST_DEV_STUB never hit
  // the real backend — they'd either crash (stub JWT isn't a valid
  // JWT) or pollute prod state (dev users on the global leaderboard).
  // Both return { ok: false, code: 'STUB_USER' } so callers can render
  // empty state without touching the network.

  function _stubGate(u) {
    if (!u || !u.jwt) return { ok: false, code: 'NOT_SIGNED_IN' };
    if (u.jwt === LOCALHOST_DEV_STUB) return { ok: false, code: 'LOCAL_DEV_SKIP' };
    if (u.jwt === 'PHASE_A_STUB') return { ok: false, code: 'STUB_USER' };
    return null; // proceed with real call
  }

  // POST /v1/leaderboard/submit. Upserts the user's (metric, value)
  // snapshot. Backend computes best_value via MAX preservation.
  // Returns the backend's response on success so the caller can log
  // the current/best for diagnostics.
  async function submitLeaderboardSnapshot(metric, currentValue, opts) {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    if (typeof metric !== 'string' || metric.length === 0) {
      return { ok: false, code: 'INVALID_METRIC', detail: 'metric required' };
    }
    if (!Number.isInteger(currentValue) || currentValue < 0) {
      return { ok: false, code: 'INVALID_VALUE', detail: 'value must be non-neg integer' };
    }

    // v3 Phase 1z.140 — optional `weeklySumSource` tag. When the
    // client passes a recognised source identifier (e.g.
    // 'client_sunday_utc_v2' for the w19+ Sunday-UTC-anchored weekly
    // sum), the backend uses it as a self-heal signal to override
    // 1z.131 monotonic MAX on the FIRST trusted submit for a
    // (user, metric) row — repairing rollover-contaminated values
    // automatically. Subsequent submits with the same tag use MAX.
    const body = { metric: metric, current_value: currentValue };
    const src = opts && opts.weeklySumSource;
    if (typeof src === 'string' && src.length > 0) {
      body.weekly_sum_source = src;
    }

    let res;
    try {
      res = await fetch(BACKEND_URL + '/v1/leaderboard/submit', {
        method:  'POST',
        headers: {
          'Authorization': 'Bearer ' + u.jwt,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }

    let data;
    try { data = await res.json(); } catch (_) { data = null; }

    if (res.status === 200) {
      return {
        ok: true,
        metric: data && data.metric,
        current_value: data && data.current_value,
        best_value: data && data.best_value,
      };
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    if (res.status === 429) {
      return { ok: false, code: 'RATE_LIMITED', detail: (data && data.detail) || 'Slow down.' };
    }
    return {
      ok: false,
      code: 'ERROR',
      detail: (data && data.detail) || ('Server responded ' + res.status),
    };
  }

  // GET /v1/leaderboard/top?metric=X&limit=N. Returns top + caller's
  // rank+value (or me === null if caller hasn't submitted this
  // metric yet).
  async function fetchLeaderboardTop(metric, limit) {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    if (typeof metric !== 'string' || metric.length === 0) {
      return { ok: false, code: 'INVALID_METRIC' };
    }
    const lim = (Number.isInteger(limit) && limit > 0 && limit <= 500) ? limit : 100;
    const url = BACKEND_URL + '/v1/leaderboard/top?metric=' + encodeURIComponent(metric) + '&limit=' + lim;

    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + u.jwt },
      });
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }

    let data;
    try { data = await res.json(); } catch (_) { data = null; }

    if (res.status === 200 && data) {
      return {
        ok: true,
        metric: data.metric,
        top:    Array.isArray(data.top) ? data.top : [],
        me:     data.me || null,
      };
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    if (res.status === 429) {
      return { ok: false, code: 'RATE_LIMITED', detail: (data && data.detail) || 'Slow down.' };
    }
    return {
      ok: false,
      code: 'ERROR',
      detail: (data && data.detail) || ('Server responded ' + res.status),
    };
  }

  // v3 Phase 1z.36 -- Weekly Steps Hall of Fame read endpoint.
  // GET /v1/leaderboard/hall-of-fame?metric=step_total&limit=N.
  // Returns the all-time top weekly step records plus caller's best.
  //
  //   { ok: true, metric, records: [...], me_best: {...} | null }
  //   { ok: false, code: 'EXPIRED' | 'RATE_LIMITED' | 'NETWORK' | 'ERROR' | 'INVALID_METRIC' }
  async function fetchLeaderboardHallOfFame(metric, limit) {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    if (typeof metric !== 'string' || metric.length === 0) {
      return { ok: false, code: 'INVALID_METRIC' };
    }
    // Backend caps at 100; client default at 50 matches the handler.
    const lim = (Number.isInteger(limit) && limit > 0 && limit <= 100) ? limit : 50;
    const url = BACKEND_URL + '/v1/leaderboard/hall-of-fame?metric=' + encodeURIComponent(metric) + '&limit=' + lim;

    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + u.jwt },
      });
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }

    let data;
    try { data = await res.json(); } catch (_) { data = null; }

    if (res.status === 200 && data) {
      return {
        ok: true,
        metric:  data.metric,
        records: Array.isArray(data.records) ? data.records : [],
        me_best: data.me_best || null,
      };
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    if (res.status === 429) {
      return { ok: false, code: 'RATE_LIMITED', detail: (data && data.detail) || 'Slow down.' };
    }
    if (res.status === 400) {
      return { ok: false, code: 'INVALID_METRIC', detail: (data && data.detail) || 'Unsupported metric.' };
    }
    return {
      ok: false,
      code: 'ERROR',
      detail: (data && data.detail) || ('Server responded ' + res.status),
    };
  }

  // v3 Phase 1z.52 -- 100K Step Club roster.
  // GET /v1/leaderboard/step-100k-club?limit=N.
  // Returns the real-user roster of 100K Step Club members plus the
  // caller's own membership status. Sim users are excluded server-
  // side; this surface is real-users-only.
  //
  //   { ok: true, type, members: [...], me: {...} | null }
  //   { ok: false, code: 'EXPIRED' | 'RATE_LIMITED' | 'NETWORK' | 'ERROR' }
  async function fetchStep100kClub(limit) {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    // Backend caps at 100; client default at 50 matches the handler.
    const lim = (Number.isInteger(limit) && limit > 0 && limit <= 100) ? limit : 50;
    const url = BACKEND_URL + '/v1/leaderboard/step-100k-club?limit=' + lim;

    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + u.jwt },
      });
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }

    let data;
    try { data = await res.json(); } catch (_) { data = null; }

    if (res.status === 200 && data) {
      return {
        ok: true,
        type:    data.type,
        members: Array.isArray(data.members) ? data.members : [],
        me:      data.me || null,
      };
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    if (res.status === 429) {
      return { ok: false, code: 'RATE_LIMITED', detail: (data && data.detail) || 'Slow down.' };
    }
    return {
      ok: false,
      code: 'ERROR',
      detail: (data && data.detail) || ('Server responded ' + res.status),
    };
  }

  // v3 Phase 1z.27 -- 100K Step Club + future accolade types.
  // GET /v1/users/me/accolades.
  //
  // Returns:
  //   { ok: true,  accolades: [...] }   (200 — may be empty array)
  //   { ok: false, code: 'EXPIRED' }    (401 — session gone, local cleared)
  //   { ok: false, code: 'RATE_LIMITED' | 'NETWORK' | 'ERROR' | ... }
  async function fetchAccolades() {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    const url = BACKEND_URL + '/v1/users/me/accolades';

    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + u.jwt },
      });
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }

    let data;
    try { data = await res.json(); } catch (_) { data = null; }

    if (res.status === 200 && data) {
      return {
        ok:        true,
        accolades: Array.isArray(data.accolades) ? data.accolades : [],
      };
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    if (res.status === 429) {
      return { ok: false, code: 'RATE_LIMITED', detail: (data && data.detail) || 'Slow down.' };
    }
    return {
      ok: false,
      code: 'ERROR',
      detail: (data && data.detail) || ('Server responded ' + res.status),
    };
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

  // ── v2.1 Phase D — JSON export / import data safety net ──
  // localStorage is the source of truth for game state on iOS
  // (WKWebView). iOS does NOT preserve WKWebView storage when the
  // user deletes + reinstalls the app, and there's no iCloud auto-
  // backup of WKWebView local data. These helpers let the user
  // manually checkpoint their state to a JSON file (saved via the
  // iOS share sheet) and restore it later. Backend untouched —
  // identity + leaderboard remain server-side, game state stays
  // device-local. v2.2+ may add real cross-device sync.

  const BACKUP_VERSION = 1;
  const BACKUP_KEY_PREFIX = 'hb_';

  /**
   * Build the backup payload from the current localStorage state.
   * Returns the object directly — caller serializes / downloads.
   */
  function _buildBackupPayload() {
    const keys = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(BACKUP_KEY_PREFIX)) {
          keys[k] = localStorage.getItem(k);
        }
      }
    } catch (_) {}
    return {
      _backup_version: BACKUP_VERSION,
      _generated_at:   new Date().toISOString(),
      _app_version:    (window.__APP_VERSION || '2.1.0'),
      keys,
    };
  }

  /**
   * Serialize the current state to a JSON file and trigger the
   * browser/WKWebView download. On iOS this opens the share sheet
   * so the user can save to Files / iCloud Drive / AirDrop.
   */
  /**
   * Two code paths depending on runtime:
   *
   * 1. Capacitor native (iOS app via WKWebView) — the standard
   *    Blob+anchor-click pattern silently fails on iOS (confirmed
   *    TestFlight build 54). Use @capacitor/filesystem to write the
   *    JSON to the app's Documents/ directory, then @capacitor/share
   *    to open the native share sheet so the user can route the
   *    file to Files / iCloud Drive / AirDrop / Mail / etc.
   *
   * 2. Browser / PWA / localhost — the Blob+anchor-click pattern
   *    works fine outside Capacitor's WKWebView. Keep the existing
   *    logic as the fallback path.
   *
   * Returns { ok: true, channel: 'native' | 'web', filename }
   * or     { ok: false, error: '<msg>' }. Caller (app.js) reads
   * `channel` to pick the right toast copy.
   */
  async function exportToFile() {
    const payload  = _buildBackupPayload();
    const json     = JSON.stringify(payload, null, 2);
    const todayIso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = 'awakened-backup-' + todayIso + '.json';

    // ─── Native iOS path (Capacitor) ───
    const cap = window.Capacitor;
    const isNativePlatform = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    if (isNativePlatform) {
      try {
        const Filesystem = cap.Plugins && cap.Plugins.Filesystem;
        const Share      = cap.Plugins && cap.Plugins.Share;
        if (Filesystem && typeof Filesystem.writeFile === 'function') {
          // Directory.Documents is the string 'DOCUMENTS' in the
          // plugin's enum. Encoding.UTF8 is 'utf8'. We pass the
          // raw string literals so we don't need to import the
          // ES module (auth.js is loaded as a plain script).
          await Filesystem.writeFile({
            path:      filename,
            data:      json,
            directory: 'DOCUMENTS',
            encoding:  'utf8',
          });
          // Get the file:// URI for Share.share. getUri returns
          // { uri: 'file:///var/mobile/.../awakened-backup-...json' }
          let fileUri = null;
          try {
            const u = await Filesystem.getUri({ path: filename, directory: 'DOCUMENTS' });
            fileUri = u && u.uri;
          } catch (_) {}
          if (Share && typeof Share.share === 'function' && fileUri) {
            try {
              await Share.share({
                title:       'Awakened backup',
                url:         fileUri,
                dialogTitle: 'Save Awakened backup',
              });
            } catch (_) {
              // User cancelled the share sheet — that's a normal
              // flow, not an error. The file still exists in the
              // app's Documents/ dir.
            }
          }
          return { ok: true, channel: 'native', filename };
        }
        // Plugin not available — fall through to web path.
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }

    // ─── Web / PWA / localhost fallback ───
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      // Small async cleanup — some browsers need the anchor + URL
      // to live briefly past the click to actually start the
      // download / share sheet.
      setTimeout(() => {
        try { document.body.removeChild(a); } catch (_) {}
        try { URL.revokeObjectURL(url); }    catch (_) {}
      }, 250);
      return { ok: true, channel: 'web', filename };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  /**
   * Parse + validate a backup file's text. Returns:
   *   { ok: true,  data: <parsed payload> }   on success
   *   { ok: false, error: '<msg>' }           on any failure
   * Validation rules:
   *   - Must parse as JSON
   *   - Must be a plain object
   *   - _backup_version must === 1 (future migrations live here)
   *   - keys must be an object (may be empty, but must exist)
   *   - Every entry in keys must have an hb_ prefix
   */
  function parseBackupFile(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { ok: false, error: 'File is not valid JSON.' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'File is not an Awakened backup.' };
    }
    if (data._backup_version !== BACKUP_VERSION) {
      return { ok: false, error: 'Backup format version not supported.' };
    }
    if (!data.keys || typeof data.keys !== 'object' || Array.isArray(data.keys)) {
      return { ok: false, error: 'Backup is missing the keys map.' };
    }
    for (const k of Object.keys(data.keys)) {
      if (!k.startsWith(BACKUP_KEY_PREFIX)) {
        return { ok: false, error: 'Backup contains unexpected keys.' };
      }
    }
    return { ok: true, data };
  }

  /**
   * Apply a previously-validated backup. Clears every hb_* key
   * (including hb_user — see comment below), then writes every key
   * from the backup. Caller is responsible for reloading the page
   * after this returns so all in-memory state is rebuilt fresh.
   *
   * Why we clear hb_user too: if the backup was taken under a
   * different signed-in identity, the stored JWT would not match
   * the apple_sub of the current user. Safer to force re-auth.
   * The restore modal copy warns the user about this.
   */
  function applyBackup(data) {
    // 1. Collect every hb_* key currently in storage
    const toDelete = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(BACKUP_KEY_PREFIX)) toDelete.push(k);
      }
    } catch (_) {}
    // 2. Delete them
    for (const k of toDelete) {
      try { localStorage.removeItem(k); } catch (_) {}
    }
    // 3. Write the backup's keys
    const keys = (data && data.keys) || {};
    for (const k of Object.keys(keys)) {
      const v = keys[k];
      if (typeof v === 'string') {
        try { localStorage.setItem(k, v); } catch (_) {}
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Cloud Sync v1 (v3 Phase 1w) — backend endpoint helpers.
  //
  // GET  /v1/users/me/state — fetchCloudState
  // POST /v1/users/me/state — uploadCloudState
  //
  // Both share the same error-handling shape as the leaderboard
  // helpers above: { ok: true, ... } on success; { ok: false,
  // code: 'NETWORK' | 'EXPIRED' | 'RATE_LIMITED' | 'ERROR', detail }
  // on failure. Callers in app.js' CloudSync module degrade
  // gracefully on any failure — local state remains authoritative.
  // ─────────────────────────────────────────────────────────
  async function fetchCloudState() {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    let res;
    try {
      res = await fetch(BACKEND_URL + '/v1/users/me/state', {
        method:  'GET',
        headers: { 'Authorization': 'Bearer ' + u.jwt },
      });
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }
    let data;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 200) {
      // Backend returns { exists, state_version?, state?, ... }.
      return {
        ok:               true,
        exists:           !!(data && data.exists),
        state_version:    (data && data.state_version) || null,
        app_version:      (data && data.app_version)   || null,
        client_updated_at:(data && data.client_updated_at) || null,
        server_updated_at:(data && data.server_updated_at) || null,
        device_id:        (data && data.device_id)     || null,
        checksum:         (data && data.checksum)      || null,
        state:            (data && data.state)         || null,
        reason:           (data && data.reason)        || null,
      };
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    if (res.status === 429) {
      return { ok: false, code: 'RATE_LIMITED', detail: (data && data.detail) || 'Slow down.' };
    }
    return {
      ok: false,
      code: 'ERROR',
      detail: (data && data.detail) || ('Server responded ' + res.status),
    };
  }

  async function uploadCloudState(payload) {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    if (!payload || typeof payload !== 'object') {
      return { ok: false, code: 'INVALID_PAYLOAD', detail: 'payload must be an object.' };
    }
    let res;
    try {
      res = await fetch(BACKEND_URL + '/v1/users/me/state', {
        method:  'POST',
        headers: {
          'Authorization': 'Bearer ' + u.jwt,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }
    let data;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 200) {
      return {
        ok:                true,
        state_version:     (data && data.state_version) || null,
        client_updated_at: (data && data.client_updated_at) || null,
        server_updated_at: (data && data.server_updated_at) || null,
        bytes:             (data && data.bytes) || null,
      };
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    if (res.status === 413) {
      return { ok: false, code: 'PAYLOAD_TOO_LARGE', detail: (data && data.detail) || 'Snapshot too large.' };
    }
    if (res.status === 429) {
      return { ok: false, code: 'RATE_LIMITED', detail: (data && data.detail) || 'Slow down.' };
    }
    return {
      ok: false,
      code: 'ERROR',
      detail: (data && data.detail) || ('Server responded ' + res.status),
    };
  }

  // ─────────────────────────────────────────────────────────
  // Discipline Duels v1 (v3 Phase 1x) — friends + duels helpers.
  //
  // Same error shape as the leaderboard/cloud helpers above:
  //   { ok: true, ...payload } on success
  //   { ok: false, code, detail } on failure
  // Callers must wrap try/catch around UI rendering anyway; these
  // helpers themselves don't throw — network errors map to
  // { ok: false, code: 'NETWORK' }.
  // ─────────────────────────────────────────────────────────
  async function _authedFetch(method, path, jsonBody) {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    const init = {
      method:  method,
      headers: { 'Authorization': 'Bearer ' + u.jwt },
    };
    if (jsonBody !== undefined && jsonBody !== null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(jsonBody);
    }
    let res;
    try {
      res = await fetch(BACKEND_URL + path, init);
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }
    let data;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.status >= 200 && res.status < 300) {
      // Trust the server payload; merge `ok: true` defensively.
      return Object.assign({ ok: true }, data || {});
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    if (res.status === 429) {
      return { ok: false, code: 'RATE_LIMITED', detail: (data && data.detail) || 'Slow down.' };
    }
    if (res.status === 404) {
      return { ok: false, code: (data && data.error) || 'NOT_FOUND', detail: (data && data.detail) || 'Not found.' };
    }
    return {
      ok:     false,
      code:   (data && data.error)  || 'ERROR',
      detail: (data && data.detail) || ('Server responded ' + res.status),
    };
  }

  function fetchFriends()                       { return _authedFetch('GET',  '/v1/friends'); }
  function sendFriendRequest(alias)             { return _authedFetch('POST', '/v1/friends/request', { alias: alias }); }
  function acceptFriendRequest(friendshipId)    { return _authedFetch('POST', '/v1/friends/' + encodeURIComponent(friendshipId) + '/accept'); }
  function declineFriendRequest(friendshipId)   { return _authedFetch('POST', '/v1/friends/' + encodeURIComponent(friendshipId) + '/decline'); }
  function removeFriend(friendshipId)           { return _authedFetch('POST', '/v1/friends/' + encodeURIComponent(friendshipId) + '/remove'); }

  function fetchDuels()                         { return _authedFetch('GET',  '/v1/duels'); }
  function createDuel(opponentAlias, options) {
    const body = { opponent_alias: opponentAlias };
    if (options && typeof options === 'object') {
      if (Number.isInteger(options.duration_days)) body.duration_days = options.duration_days;
      if (Number.isInteger(options.stake_souls))   body.stake_souls   = options.stake_souls;
      // Verified-Only Duel Types (v3 Phase 1x.6). Default applied at the
      // backend (`verified_objectives`) — only forward when explicitly
      // chosen so older callers keep working.
      if (typeof options.duel_type === 'string' && options.duel_type) {
        body.duel_type = options.duel_type;
      }
    }
    return _authedFetch('POST', '/v1/duels', body);
  }
  function acceptDuel(duelId)                   { return _authedFetch('POST', '/v1/duels/' + encodeURIComponent(duelId) + '/accept'); }
  function declineDuel(duelId)                  { return _authedFetch('POST', '/v1/duels/' + encodeURIComponent(duelId) + '/decline'); }
  // Outgoing duel cancel (v3 Phase 1z.1). Challenger-only, pending-only,
  // idempotent (returns `alreadyCancelled: true` if already cancelled).
  function cancelDuel(duelId)                   { return _authedFetch('POST', '/v1/duels/' + encodeURIComponent(duelId) + '/cancel'); }
  function fetchDuel(duelId)                    { return _authedFetch('GET',  '/v1/duels/' + encodeURIComponent(duelId)); }

  // Steps Duel Scoring v1 (v3 Phase 1y). Submit a per-participant
  // Apple Health snapshot to the backend; the resolver picks the
  // winner.
  function submitDuelProgress(duelId, payload) {
    return _authedFetch('POST', '/v1/duels/' + encodeURIComponent(duelId) + '/progress', payload);
  }
  function resolveDuel(duelId) {
    return _authedFetch('POST', '/v1/duels/' + encodeURIComponent(duelId) + '/resolve');
  }

  // Verified Duel Scoring Engine v1 (v3 Phase 1z). Batch-submit
  // verified events (≤25 per call). The backend dedupes via
  // UNIQUE(user_id, client_event_id) so retries are safe. Callers
  // should chunk batches of >25 events.
  function submitVerifiedEvents(events) {
    if (!Array.isArray(events)) {
      return Promise.resolve({ ok: false, code: 'INVALID_PAYLOAD', detail: 'events must be an array.' });
    }
    return _authedFetch('POST', '/v1/verified-events', { events: events });
  }

  // Verified Duel Scoring Engine v1 (v3 Phase 1z). GET both
  // participants' per-type score + label for a duel.
  function fetchDuelScore(duelId) {
    return _authedFetch('GET', '/v1/duels/' + encodeURIComponent(duelId) + '/score');
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
    submitLeaderboardSnapshot,
    fetchLeaderboardTop,
    // Weekly Steps Hall of Fame (v3 Phase 1z.36)
    fetchLeaderboardHallOfFame,
    // 100K Step Club roster (v3 Phase 1z.52)
    fetchStep100kClub,
    // 100K Step Club + future accolades (v3 Phase 1z.27)
    fetchAccolades,
    // Cloud Sync v1 (v3 Phase 1w)
    fetchCloudState,
    uploadCloudState,
    // Discipline Duels v1 (v3 Phase 1x)
    fetchFriends,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    fetchDuels,
    createDuel,
    acceptDuel,
    declineDuel,
    cancelDuel,
    fetchDuel,
    // Steps Duel Scoring v1 (v3 Phase 1y)
    submitDuelProgress,
    resolveDuel,
    // Verified Duel Scoring Engine v1 (v3 Phase 1z)
    submitVerifiedEvents,
    fetchDuelScore,
    devSignInIfLocalhost,
    isLocalhostDev,
    isNative,
    BACKEND_URL,
    // v2.1 Phase D — JSON export / import
    exportToFile,
    parseBackupFile,
    applyBackup,
  };
})();
