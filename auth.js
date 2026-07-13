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
  // v3 W329 — Guest "try-it-first" stub. Native-allowed (unlike the
  // localhost dev stub). Always-valid locally; every server helper no-ops
  // through _stubGate until the user signs in and claims an alias.
  const GUEST_STUB = 'GUEST_STUB';

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
    if (u.jwt === GUEST_STUB) return u;   // W329 — guest is always valid locally
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

  // The backend origin (https://…workers.dev). PvP (app.js) needs it to build
  // its own fetch() URLs and the wss:// WebSocket URL for realtime duels.
  function getBackendBase() {
    return BACKEND_URL;
  }

  function clearUser() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    // W644 — entitlements are PER-ACCOUNT; purge their display caches on sign-out
    // so the next account on this device can't inherit them (the class of bug
    // behind the 2.1(b) "already purchased on a new account" rejection).
    _memberCache = null;   // W651 — membership is per-account
    try { localStorage.removeItem('hb_member_owned'); } catch (_) {}
    try { localStorage.removeItem('hb_founder_owned'); } catch (_) {}   // W655 — legacy key cleanup
    try { localStorage.removeItem('hb_skins_owned_cache'); } catch (_) {}
  }

  // True when JWT is within 14 days of expiry. Phase A stubs and
  // dev-stubs return false (no real backend session to refresh).
  function isJwtNearExpiry() {
    const u = readUser();
    if (!u || !u.jwt_expires_at) return true;
    if (u.jwt === LOCALHOST_DEV_STUB) return false;
    if (u.jwt === GUEST_STUB) return false;   // W329 — no backend session to refresh
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

  // Transient state held between signInWithApple() (step 1) and
  // completeSignIn(alias) (step 2).
  //
  // v3 Phase 1z.245 — Now ALSO persisted to localStorage under
  // PENDING_LS_KEY for ≤ 10 minutes so the alias claim can be deferred
  // until the cinematic onboarding's name screen calls completeSignIn.
  // The legacy "alias picker right after Apple" gate step is gone; we
  // reload after Apple auth and the cinematic claims the alias inline.
  // Apple identity tokens are short-lived (~10 min), so the persisted
  // window is bounded — if the user force-quits and waits, they re-do
  // the Apple Sign-In on next launch.
  let _pendingIdentityToken = null;
  let _pendingAppleSub = null;
  let _pendingApplePayload = null; // { givenName, familyName, email } for UX pre-fill
  const PENDING_LS_KEY = 'hb_apple_pending_v1';
  const PENDING_TTL_MS = 10 * 60 * 1000;  // 10 min — match Apple token lifetime

  function _savePending() {
    try {
      if (!_pendingIdentityToken || !_pendingAppleSub) {
        localStorage.removeItem(PENDING_LS_KEY);
        return;
      }
      localStorage.setItem(PENDING_LS_KEY, JSON.stringify({
        t: _pendingIdentityToken,
        s: _pendingAppleSub,
        p: _pendingApplePayload,
        e: Date.now() + PENDING_TTL_MS,
      }));
    } catch (_) {}
  }
  function _clearPending() {
    _pendingIdentityToken = null;
    _pendingAppleSub = null;
    _pendingApplePayload = null;
    try { localStorage.removeItem(PENDING_LS_KEY); } catch (_) {}
  }
  (function _restorePending() {
    try {
      const raw = localStorage.getItem(PENDING_LS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || !obj.t || !obj.s) { _clearPending(); return; }
      if (typeof obj.e === 'number' && Date.now() > obj.e) { _clearPending(); return; }
      _pendingIdentityToken = obj.t;
      _pendingAppleSub      = obj.s;
      _pendingApplePayload  = obj.p || null;
    } catch (_) {}
  })();

  // True when an Apple identity token has been received but the alias
  // hasn't been claimed yet. Used by the gate to allow the app to mount
  // (so the cinematic name screen can call completeSignIn() inline)
  // and by the cinematic to know when to make the backend call.
  function isApplePending() {
    return !!_pendingIdentityToken && !!_pendingAppleSub;
  }
  function getPendingGivenName() {
    return (_pendingApplePayload && _pendingApplePayload.givenName) || null;
  }

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
    // v3 Phase 1z.245 — persist so the alias claim survives the reload
    // into the main app / cinematic onboarding flow.
    _savePending();
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
      // Clear pending state — identityToken has served its purpose and
      // Apple's tokens are single-use anyway. v3 Phase 1z.245 — also
      // removes the persisted PENDING_LS_KEY localStorage entry.
      _clearPending();
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
    if (u.jwt === GUEST_STUB) return { ok: false, code: 'GUEST_SKIP' };   // W329
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
  // W321 — last week's final step standings (champion + caller placement).
  async function fetchLastWeekSteps(limit) {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    const lim = (Number.isInteger(limit) && limit > 0 && limit <= 100) ? limit : 50;
    const url = BACKEND_URL + '/v1/leaderboard/last-week?limit=' + lim;
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers: { 'Authorization': 'Bearer ' + u.jwt } });
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }
    let data;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 200 && data) {
      return {
        ok: true,
        weekStart: data.weekStart,
        weekEnd:   data.weekEnd,
        total:     data.total || 0,
        champion:  data.champion || null,
        me:        data.me || null,
        records:   Array.isArray(data.records) ? data.records : [],
        myTitle:   data.myTitle || null,
      };
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    return { ok: false, code: (data && data.code) || 'SERVER', detail: (data && data.detail) || ('HTTP ' + res.status) };
  }

  // W320 — friends leaderboard read (steps this week among accepted friends).
  async function fetchFriendsLeaderboard(metric, limit) {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    const m = (typeof metric === 'string' && metric) ? metric : 'step_total';
    const lim = (Number.isInteger(limit) && limit > 0 && limit <= 100) ? limit : 50;
    const url = BACKEND_URL + '/v1/friends/leaderboard?metric=' + encodeURIComponent(m) + '&limit=' + lim;
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers: { 'Authorization': 'Bearer ' + u.jwt } });
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }
    let data;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 200 && data) {
      return {
        ok: true,
        metric:    data.metric,
        weekStart: data.weekStart,
        total:     data.total || 0,
        rows:      Array.isArray(data.rows) ? data.rows : [],
        me:        data.me || null,
      };
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    return { ok: false, code: (data && data.code) || 'SERVER', detail: (data && data.detail) || ('HTTP ' + res.status) };
  }

  // W319 — "Hunters in your rank" cohort board read.
  async function fetchRankBand(limit) {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    const lim = (Number.isInteger(limit) && limit > 0 && limit <= 50) ? limit : 25;
    const url = BACKEND_URL + '/v1/leaderboard/rank-band?limit=' + lim;
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers: { 'Authorization': 'Bearer ' + u.jwt } });
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' };
    }
    let data;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 200 && data) {
      return {
        ok: true,
        tier:  data.tier || null,
        total: data.total || 0,
        top:   Array.isArray(data.top) ? data.top : [],
        me:    data.me || null,
        near:  Array.isArray(data.near) ? data.near : [],
      };
    }
    if (res.status === 401) {
      clearUser();
      return { ok: false, code: 'EXPIRED', detail: (data && data.detail) || 'Session expired.' };
    }
    return { ok: false, code: (data && data.code) || 'SERVER', detail: (data && data.detail) || ('HTTP ' + res.status) };
  }

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

  // v3 W329 — Guest "try-it-first". Writes a GUEST_STUB hb_user with NO
  // alias, so the sign-in gate mounts the app via its dedicated guest branch
  // (not the alias pass) and every server helper no-ops through _stubGate.
  // Native-ALLOWED (the whole point). Never overwrites an existing session.
  // The full single-player loop is local; a later Apple sign-in claims the
  // alias and the existing CloudSync adopt-local path keeps all progress.
  function startGuest() {
    if (readUser()) return false; // respect any existing real/pending/guest state
    writeUser({
      sub:            'guest-local',
      alias:          null,
      jwt:            GUEST_STUB,
      jwt_expires_at: Date.now() + (1000 * 60 * 60 * 24 * 365 * 10),
      signed_in_date: deviceLocalDate(),
      is_guest:       true,
    });
    return true;
  }
  function isGuest() {
    try { const u = readUser(); return !!(u && u.jwt === GUEST_STUB); } catch (_) { return false; }
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
  // W381 (security) — identity/session keys are NEVER exported or restored. A
  // backup file is shareable (iCloud/AirDrop/Mail); carrying hb_user would ship a
  // live backend JWT, letting whoever restores the file act as the exporter's
  // account — and would also defeat the documented force-re-auth on restore.
  // Mirrors the CloudSync allowlist, which already omits hb_user.
  const BACKUP_EXCLUDE_KEYS = [STORAGE_KEY, PENDING_LS_KEY];

  /**
   * Build the backup payload from the current localStorage state.
   * Returns the object directly — caller serializes / downloads.
   */
  function _buildBackupPayload() {
    const keys = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(BACKUP_KEY_PREFIX) && BACKUP_EXCLUDE_KEYS.indexOf(k) === -1) {
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
      // W381 (security) — never restore identity/session keys, even from older
      // backup files already in the wild, so a restore can't re-inject a foreign JWT.
      if (BACKUP_EXCLUDE_KEYS.indexOf(k) !== -1) continue;
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
  // Friends + legacy-duels-residual helpers
  // (v3 Phase 1x; trimmed by 1z.279 Duels permanent retirement).
  //
  // Same error shape as the leaderboard/cloud helpers above:
  //   { ok: true, ...payload } on success
  //   { ok: false, code, detail } on failure
  // Callers must wrap try/catch around UI rendering anyway; these
  // helpers themselves don't throw — network errors map to
  // { ok: false, code: 'NETWORK' }.
  //
  // The only duel-named helper that survived retirement is
  // submitVerifiedEvents, used by app.js's _drainVerifiedEventOutbox
  // to flush any pre-retirement queue contents on upgraded devices.
  // The 9 helpers wrapping the deleted POST /v1/duels / accept /
  // decline / cancel / progress / resolve / score routes were
  // removed because zero call sites remain in app.js.
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

  // v3 Phase 1z.191 — Friend rank badges client submit path.
  // PUTs the caller's preformatted public rank summary to the
  // backend (shipped in 1z.190). Backend stores rankPoints but
  // never returns it to friends. Callers must build the payload
  // via app.js' _publicRankSummary(totalPoints) so the formula
  // for rankSortValue stays in one place.
  function submitPublicProfileSummary(payload) {
    return _authedFetch('PUT', '/v1/users/me/public-profile-summary', payload);
  }

  // v3 Phase 1z.204 — Public friend activity events MVP-B client
  // submit path. POSTs a batch (1–10) of preformatted public
  // events (boss_kill / rank_up / step_milestone_bucket) to the
  // backend (shipped in 1z.200 / deployed 1z.203). Backend
  // dedupes on UNIQUE(user_id, client_event_id); resubmits are
  // a no-op. Caller builds the payload via app.js' public-event
  // queue so per-type label/value/regex contracts stay in one
  // place. Step milestones use BUCKETED values only (10000,
  // 20000, ..., 100000); raw step counts are NEVER submitted.
  function submitPublicAchievementEvents(events) {
    return _authedFetch('POST', '/v1/users/me/public-achievement-events', { events: events });
  }

  // v3 Phase 1z.204 — Friend-scoped public event feed. Returns
  // accepted-friend (+ self) public events sorted newest-first
  // with alias + optional rankLabel joined. Used by the Guild
  // Activity → Guild mode renderer. Backend never returns
  // user_id, client_event_id, metadata_json, or rank_points.
  function fetchFriendsActivity(limit) {
    const n = (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) ? Math.floor(limit) : 30;
    return _authedFetch('GET', '/v1/friends/activity?limit=' + encodeURIComponent(n));
  }

  // W270 — The Hall of the Awakened. submitHallFinish records the caller
  // as a finisher of all 100 Ascent floors; the server assigns the eternal
  // global ordinal (once-ever — re-submits return the same ordinal).
  // fetchHall reads the roll (top finishers + the caller's neighbourhood).
  function submitHallFinish(clientFinishedAt) {
    return _authedFetch('POST', '/v1/users/me/hall-of-awakened',
      clientFinishedAt ? { clientFinishedAt: clientFinishedAt } : {});
  }
  function fetchHall(limit) {
    const n = (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) ? Math.floor(limit) : 4;
    return _authedFetch('GET', '/v1/hall-of-awakened?limit=' + encodeURIComponent(n));
  }
  // W-next — public profile card for any user by alias (rank, power, boss
  // kills, avg steps/day, best floor, title, avatar). Real users only; sim
  // bots are synthesized client-side.
  function fetchPublicProfile(alias) {
    return _authedFetch('GET', '/v1/users/' + encodeURIComponent(alias) + '/profile');
  }

  function fetchFriends()                       { return _authedFetch('GET',  '/v1/friends'); }
  function sendFriendRequest(alias)             { return _authedFetch('POST', '/v1/friends/request', { alias: alias }); }
  function acceptFriendRequest(friendshipId)    { return _authedFetch('POST', '/v1/friends/' + encodeURIComponent(friendshipId) + '/accept'); }
  function declineFriendRequest(friendshipId)   { return _authedFetch('POST', '/v1/friends/' + encodeURIComponent(friendshipId) + '/decline'); }
  function removeFriend(friendshipId)           { return _authedFetch('POST', '/v1/friends/' + encodeURIComponent(friendshipId) + '/remove'); }

  // W603/W604 — push notifications. Register this device's APNs token so the
  // backend can push a friend-request / co-op-invite the moment it happens
  // (app closed). environment: 'production' for TestFlight/App Store builds,
  // 'sandbox' for Xcode debug. No-ops (returns a gate) when not signed in.
  function registerPushToken(token, environment) {
    return _authedFetch('POST', '/v1/users/me/device-token', {
      token: token,
      platform: 'ios',
      environment: environment === 'sandbox' ? 'sandbox' : 'production',
    });
  }
  function unregisterPushToken(token) {
    return _authedFetch('DELETE', '/v1/users/me/device-token', { token: token });
  }

  // v3 Phase 1z.279 — Sole surviving duel-named auth helper. Used
  // by app.js _drainVerifiedEventOutbox to flush any pre-retirement
  // queued events on upgraded devices. The backend POST
  // /v1/verified-events endpoint is also preserved during the
  // transition window; both will be removed together in the future
  // cleanup PR (see backend/migrations/RETIREMENT_PLAN.md).
  // Batch-submit verified events (≤25 per call). Backend dedupes
  // via UNIQUE(user_id, client_event_id) so retries are safe.
  function submitVerifiedEvents(events) {
    if (!Array.isArray(events)) {
      return Promise.resolve({ ok: false, code: 'INVALID_PAYLOAD', detail: 'events must be an array.' });
    }
    return _authedFetch('POST', '/v1/verified-events', { events: events });
  }

  // Co-op Dungeon Bosses v1 (W370) — client API wrappers. The boss roster
  // + goal/reward are server-authoritative; these only drive the
  // create/join/decline/cancel/resolve lifecycle + list/detail reads.
  function coopBossList()      { return _authedFetch('GET',  '/v1/coop-boss'); }
  function coopBossGet(id)     { return _authedFetch('GET',  '/v1/coop-boss/' + encodeURIComponent(id)); }
  function coopBossCreate(partnerUserId, bossId) { return _authedFetch('POST', '/v1/coop-boss', { partner_user_id: partnerUserId, boss_id: bossId }); }
  function coopBossJoin(id)    { return _authedFetch('POST', '/v1/coop-boss/' + encodeURIComponent(id) + '/join'); }
  function coopBossDecline(id) { return _authedFetch('POST', '/v1/coop-boss/' + encodeURIComponent(id) + '/decline'); }
  function coopBossCancel(id)  { return _authedFetch('POST', '/v1/coop-boss/' + encodeURIComponent(id) + '/cancel'); }
  function coopBossResolve(id) { return _authedFetch('POST', '/v1/coop-boss/' + encodeURIComponent(id) + '/resolve'); }
  function coopBossClaim(id)   { return _authedFetch('POST', '/v1/coop-boss/' + encodeURIComponent(id) + '/claim'); }   // W463.1 — atomic durable drop credit

  // Expose on window for app.js + Settings interactions.
  // ── W297 — Skins IAP (RevenueCat) + entitlements ───────────────────
  // Real-money cosmetic skin purchases. DORMANT until IAP_ENABLED flips true,
  // which requires: (1) @revenuecat/purchases-capacitor installed + `npx cap
  // sync ios` on the Mac, (2) the 10 non-consumable products live in App Store
  // Connect + RevenueCat, (3) REVENUECAT_PUBLIC_SDK_KEY set below. Backend grants
  // ownership via the RevenueCat webhook; the client reads truth from GET
  // /v1/users/me/entitlements. Cosmetic only — never power. See SETUP_IAP.md.
  // W628 — GO-LIVE (2026-07-08): every gate verified before this flip — 11 IAPs in
  // ASC (Stardust = .sovereign id), RC App Store app + paste-verified public key
  // (W627), .p8 In-App Purchase Key "Valid credentials" in RC, Paid Apps agreement
  // ACTIVE (thru Apr 2027), webhook chain configured, first-100 grandfather deployed
  // (cf1bad73). Ships in build 393 WITH the 11 IAPs attached to the version's App
  // Review submission, so review sees a working purchase flow. Web stays inert
  // (iapAvailable also requires the native RC plugin, absent in browsers).
  const IAP_ENABLED = true;
  // W627 — real production key (RevenueCat → Awakened: Habit RPG (App Store) →
  // Public API Key, created 2026-07-08). A PUBLIC client key by design — safe to
  // commit; the secret key never goes in the repo. Inert until IAP_ENABLED flips.
  const REVENUECAT_PUBLIC_SDK_KEY = 'appl_phiMKPUJwIaixRkGliIxAfwOQVF';

  function _rcPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Purchases) || null; }
    catch (_) { return null; }
  }
  function iapAvailable() {
    try {
      return !!(IAP_ENABLED && _rcPlugin() &&
        window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (_) { return false; }
  }
  // Backend user_id lives in the session JWT's `sub` claim (setSubject(userId)).
  // RevenueCat's appUserID MUST equal it so webhook grants land on this account.
  function getBackendUserId() {
    try {
      const u = readUser();
      if (!u || !u.jwt || u.jwt === LOCALHOST_DEV_STUB || u.jwt === 'PHASE_A_STUB') return null;
      const part = u.jwt.split('.')[1];
      if (!part) return null;
      const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
      return (payload && typeof payload.sub === 'string' && payload.sub) ? payload.sub : null;
    } catch (_) { return null; }
  }
  // Configure RevenueCat AND identify the backend user as its appUserID.
  // W638 — THE grant-integrity fix. RevenueCat's configure() is meant to run
  // EXACTLY ONCE per process and does NOT reliably switch/identify the user on
  // later calls; logIn() is the API that (a) binds the SDK to a specific
  // appUserID and (b) ALIASES any purchases made under an anonymous id (e.g. a
  // getProducts that ran before identify, or a cached anon id from a prior
  // launch) onto that account. Without this, a "successful" purchase can land on
  // a stale/anonymous RevenueCat subscriber — so its webhook grant targets the
  // wrong account and the buyer is stuck (observed: purchases never reaching the
  // signed-in user's RC subscriber). Guarded so configure runs once and logIn
  // runs only when the identity needs to change. no-op while IAP off / off-device.
  let _rcConfigured = false;
  let _rcIdentifiedFor = null;
  // W642 — StoreProduct cache. getProductPrices (wardrobe open) fetches every
  // product for its price tile; stash the StoreProduct objects here so purchaseSkin
  // can open the StoreKit sheet WITHOUT a second getProducts round-trip on tap
  // (that delay is what read as an "unresponsive" purchase button in App Review).
  let _rcProductCache = {};
  async function configurePurchases() {
    if (!iapAvailable()) return { ok: false, code: 'IAP_DISABLED' };
    const uid = getBackendUserId();
    if (!uid) return { ok: false, code: 'NOT_SIGNED_IN' };
    const rc = _rcPlugin();
    try {
      if (!_rcConfigured) {
        await rc.configure({ apiKey: REVENUECAT_PUBLIC_SDK_KEY, appUserID: uid });
        _rcConfigured = true;
      }
      if (_rcIdentifiedFor !== uid) {
        // logIn requires configure() first; aliases any anon-id purchases onto uid.
        try { await rc.logIn({ appUserID: uid }); } catch (_) {}
        _rcIdentifiedFor = uid;
      }
      return { ok: true };
    } catch (e) { return { ok: false, code: 'ERROR', detail: String((e && e.message) || e) }; }
  }
  // Purchase a skin by App Store product id. On success RevenueCat fires the
  // backend webhook (server-side grant); the caller then refreshes entitlements.
  // W311 — v8 API VERIFIED against @revenuecat/purchases-capacitor source:
  // configure / getProducts({products}) / purchaseStoreProduct({product}) /
  // restorePurchases are UNCHANGED v7->v8 (the break was native-only: iOS SDK
  // v5 / StoreKit 2 + Android BillingClient 7, not the Capacitor JS API). The one
  // v8 fix: getProducts type defaults to SUBSCRIPTION, so a NON-CONSUMABLE must
  // pass NON_SUBSCRIPTION (ignored on iOS, REQUIRED on Android). StoreKit 2 also
  // needs an In-App Purchase Key set in the RevenueCat dashboard (see SETUP_IAP.md).
  // W643 — timeout for the PREP leg ONLY (configure/getProducts). The purchase
  // sheet is user-paced and must NEVER be timed out — timing it out would falsely
  // fail a real in-flight charge and skip the grant/equip (adversarial-review find).
  function _rcWithTimeout(promise, ms) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise(function (_res, rej) { setTimeout(function () { rej(new Error('rc-timeout')); }, ms); }),
    ]);
  }
  async function purchaseSkin(productId) {
    const rc = _rcPlugin();
    let cfg;
    try { cfg = await _rcWithTimeout(configurePurchases(), 25000); }
    catch (_) { return { ok: false, code: 'TIMEOUT' }; }
    if (!cfg.ok) return cfg;
    try {
      // W642 — reuse the StoreProduct already fetched for the price tile so the
      // StoreKit sheet opens immediately on tap; fall back to a fresh fetch.
      let product = _rcProductCache[productId];
      if (!product) {
        const got = await _rcWithTimeout(rc.getProducts({ productIdentifiers: [productId], type: 'NON_SUBSCRIPTION' }), 25000);
        product = got && got.products && got.products[0];
        if (product) _rcProductCache[productId] = product;
      }
      if (!product) return { ok: false, code: 'NO_PRODUCT' };
      await rc.purchaseStoreProduct({ product });
      return { ok: true };
    } catch (e) {
      const msg = String((e && e.message) || e);
      const code = String((e && (e.code || e.errorCode)) || '');
      if (/rc-timeout/.test(msg)) return { ok: false, code: 'TIMEOUT' };   // W643 — prep-leg fetch timed out (not the sheet)
      if (e && (e.userCancelled || /cancel/i.test(msg))) return { ok: false, code: 'CANCELLED' };
      // W637 — the store reports the user ALREADY OWNS this non-consumable (bought
      // in a prior install/session that RevenueCat never captured, so a fresh
      // purchase is impossible). RESTORE instead: that pushes Apple's receipt to
      // RevenueCat, which then knows about the purchase — and the caller's
      // reconcileEntitlements() can grant it. Reported as success-needs-reconcile.
      // W637.1 — the RevenueCat Capacitor plugin rejects with a NUMERIC code STRING
      // ('6' = PRODUCT_ALREADY_PURCHASED, '7' = RECEIPT_ALREADY_IN_USE — the iOS
      // bridge does call.reject(msg, "\(error.code)")) and a description like
      // "already active"/"already in use" — NOT the symbolic names. Match the codes
      // FIRST (the reliable signal); keep the symbolic names (Android
      // ITEM_ALREADY_OWNED) + message wording as fallbacks.
      const alreadyOwned = code === '6' || code === '7'
        || /PRODUCT_ALREADY_PURCHASED|RECEIPT_ALREADY_IN_USE|ITEM_ALREADY_OWNED/i.test(code)
        || /already[\s_-]*(purchas|own|active|in[\s_-]*use)/i.test(msg);
      if (alreadyOwned) {
        try { await rc.restorePurchases(); } catch (_) {}
        return { ok: true, restored: true };
      }
      return { ok: false, code: 'ERROR', detail: msg };
    }
  }
  // W625 — batch localized price lookup for the shop tiles. Returns
  // { ok, prices: { <productId>: '<localizedPriceString>' } } — e.g.
  // { 'com.goallearner.awakened.skin.stardust.sovereign': '$4.99' }. Uses the
  // SAME getProducts call as purchaseSkin, so a product that resolves here is
  // guaranteed purchasable. Shows the STORE's price (region/currency-correct) —
  // never a hardcoded value. Gated on iapAvailable so it no-ops while dormant;
  // never throws.
  async function getProductPrices(productIds) {
    if (!iapAvailable()) return { ok: false, code: 'IAP_DISABLED' };
    if (!Array.isArray(productIds) || !productIds.length) return { ok: true, prices: {} };
    const cfg = await configurePurchases();
    if (!cfg.ok) return cfg;
    const rc = _rcPlugin();
    try {
      const got = await rc.getProducts({ productIdentifiers: productIds, type: 'NON_SUBSCRIPTION' });
      const list = (got && got.products) || [];
      const prices = {};
      for (const p of list) {
        if (p && p.identifier) {
          _rcProductCache[p.identifier] = p;   // W642 — reuse in purchaseSkin (instant sheet)
          if (p.priceString) prices[p.identifier] = String(p.priceString);
        }
      }
      return { ok: true, prices: prices };
    } catch (e) {
      return { ok: false, code: 'ERROR', detail: String((e && e.message) || e) };
    }
  }
  // Restore previously-purchased skins (App Store requirement). Webhook re-grants.
  // W638 — IDENTIFY first (configure + logIn), so the receipt is restored onto THIS
  // backend user's RC subscriber (not a stale/anonymous id), then reconcile picks it up.
  async function restorePurchases() {
    if (!iapAvailable()) return { ok: false, code: 'IAP_DISABLED' };
    const cfg = await configurePurchases();
    if (!cfg.ok) return cfg;
    try { await _rcPlugin().restorePurchases(); return { ok: true }; }
    catch (e) { return { ok: false, code: 'ERROR', detail: String((e && e.message) || e) }; }
  }
  // GET /v1/users/me/entitlements → owned cosmetic skin ids. Mirrors
  // fetchAccolades; the backend is the source of truth for ownership.
  async function fetchEntitlements() {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    const url = BACKEND_URL + '/v1/users/me/entitlements';
    let res;
    try { res = await fetch(url, { method: 'GET', headers: { 'Authorization': 'Bearer ' + u.jwt } }); }
    catch (e) { return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' }; }
    let data; try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 200 && data) {
      _updateMemberCache(data);              // W651/W655 — membership (active premium subscription)
      return { ok: true, skins: Array.isArray(data.skins) ? data.skins : [], premium: !!data.premium, member: !!data.member };
    }
    if (res.status === 401) { clearUser(); return { ok: false, code: 'EXPIRED' }; }
    if (res.status === 429) return { ok: false, code: 'RATE_LIMITED' };
    return { ok: false, code: 'ERROR', detail: (data && data.detail) || ('HTTP ' + res.status) };
  }
  // W637 — SELF-HEALING grant. Asks the backend to reconcile ownership against
  // RevenueCat's authoritative REST record and grant anything missing locally.
  // Recovers a lost/delayed webhook, and — after purchaseSkin's restore-on-
  // already-owned — a purchase RevenueCat only just ingested. Same return shape
  // + member-cache side-effect as fetchEntitlements; `reconciled` = # newly
  // granted. Safe to call redundantly (server INSERT OR IGNORE is idempotent).
  async function reconcileEntitlements() {
    const u = readUser();
    const gate = _stubGate(u);
    if (gate) return gate;
    let res;
    try {
      res = await fetch(BACKEND_URL + '/v1/users/me/entitlements/reconcile', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + u.jwt },
      });
    } catch (e) { return { ok: false, code: 'NETWORK', detail: 'Could not reach server.' }; }
    let data; try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 200 && data) {
      _updateMemberCache(data);              // W651 — reconcile also refreshes the membership
      return { ok: true, skins: Array.isArray(data.skins) ? data.skins : [], premium: !!data.premium, member: !!data.member, reconciled: (data.reconciled | 0) };
    }
    if (res.status === 401) { clearUser(); return { ok: false, code: 'EXPIRED' }; }
    if (res.status === 429) return { ok: false, code: 'RATE_LIMITED' };
    return { ok: false, code: 'ERROR', detail: (data && data.detail) || ('HTTP ' + res.status) };
  }

  // ── W651/W655 — "Awakened Premium" auto-renewable membership ─────────────
  // The membership, and since W655 the ONLY paid tier (the one-time Founder
  // pack was removed): no co-op entrance fees, unlimited concurrent hunts,
  // unlimited Ascent attempts. The backend derives `premium`/`member` from the
  // RevenueCat-webhook-maintained paid-through horizon; the client caches the
  // member flag for offline gating.
  const PREMIUM_PRODUCTS = {
    monthly: 'com.goallearner.awakened.premium.monthly',   // $4.99/mo
    yearly:  'com.goallearner.awakened.premium.yearly',    // $39.99/yr
  };
  let _memberCache = null; // tri-state: null = not yet resolved this session
  function _updateMemberCache(data) {
    const m = !!(data && data.member);
    _memberCache = m;
    try { localStorage.setItem('hb_member_owned', m ? '1' : '0'); } catch (_) {}
  }
  // The ONE flag every membership perk gates on (co-op fees/cap, Ascent lives).
  function isMember() {
    try {
      if (!IAP_ENABLED) return false;
      if (_memberCache === null) _memberCache = (localStorage.getItem('hb_member_owned') === '1');
      return _memberCache === true;
    } catch (_) { return false; }
  }
  // Buy a premium subscription. Same identify-first RevenueCat flow as skins,
  // but WITHOUT the NON_SUBSCRIPTION type override — these are auto-renewable
  // products, which is getProducts' default type. On success the webhook sets
  // the paid-through horizon; reconcile self-heals a lost delivery from RC's
  // REST record (subscriptions sweep, W650).
  async function purchasePremium(productId) {
    const pid = productId || PREMIUM_PRODUCTS.monthly;
    // W652 — the W643 lesson applies here too: timeout the PREP leg only
    // (configure/getProducts can hang on a flaky StoreKit fetch and would
    // latch the caller's busy guard forever); the purchase sheet itself is
    // user-paced and must never be timed out.
    let cfg;
    try { cfg = await _rcWithTimeout(configurePurchases(), 25000); }
    catch (_) { return { ok: false, code: 'TIMEOUT' }; }
    if (!cfg.ok) return cfg;
    const rc = _rcPlugin();
    try {
      const got = await _rcWithTimeout(rc.getProducts({ productIdentifiers: [pid] }), 25000);
      const product = got && got.products && got.products[0];
      if (!product) return { ok: false, code: 'NO_PRODUCT' };
      await rc.purchaseStoreProduct({ product });
    } catch (e) {
      const msg = String((e && e.message) || e);
      const code = String((e && (e.code || e.errorCode)) || '');
      if (e && (e.userCancelled || /cancel/i.test(msg))) return { ok: false, code: 'CANCELLED' };
      // Already-subscribed (codes 6/7, same numeric-string contract as skins):
      // restore so RevenueCat re-ingests the receipt, then fall through to the
      // reconcile below — it adopts the horizon from RC's REST record.
      const already = code === '6' || code === '7' || /already[\s_-]*(purchas|own|active|in[\s_-]*use)/i.test(msg);
      if (!already) return { ok: false, code: 'ERROR', detail: msg };
      try { await rc.restorePurchases(); } catch (_) {}
    }
    try {
      await reconcileEntitlements();
      if (!isMember()) { await new Promise((res) => setTimeout(res, 1500)); await reconcileEntitlements(); }
    } catch (_) {}
    // W652 — HONEST result: ok = the flow completed, member = the entitlement
    // actually landed. The already-subscribed fallthrough can complete without
    // membership materializing (restore found nothing / reconcile offline) —
    // the caller must not celebrate on ok alone.
    return { ok: true, member: isMember() };
  }
  // Localized subscription prices for the membership sheet. Separate from
  // getProductPrices because subscriptions must NOT pass NON_SUBSCRIPTION.
  async function getPremiumPrices() {
    if (!iapAvailable()) return { ok: false, code: 'IAP_DISABLED' };
    const cfg = await configurePurchases();
    if (!cfg.ok) return cfg;
    try {
      const got = await _rcPlugin().getProducts({ productIdentifiers: [PREMIUM_PRODUCTS.monthly, PREMIUM_PRODUCTS.yearly] });
      const prices = {};
      for (const p of (got && got.products) || []) {
        if (p && p.identifier && p.priceString) prices[p.identifier] = String(p.priceString);
      }
      return { ok: true, prices: prices };
    } catch (e) {
      return { ok: false, code: 'ERROR', detail: String((e && e.message) || e) };
    }
  }

  // ── Per-user retention ping (W526) ──────────────────────────────────────
  // POST /v1/users/me/app-open on launch + foreground so the backend can compute
  // real D1/D7/D30 retention, independent of Apple's opt-in App Store Analytics.
  // FIRE-AND-FORGET: never awaited on a UI path, errors swallowed, and throttled
  // client-side to one call / 5 min (the backend ALSO dedups per UTC day + rate-
  // limits, so this is belt-and-suspenders). Skips guest / local-dev / not-signed-in
  // users via _stubGate (no real backend session to authenticate with).
  let _lastAppOpenReportMs = 0;
  function reportAppOpen() {
    try {
      const u = readUser();
      if (_stubGate(u)) return;
      const now = Date.now();
      if (now - _lastAppOpenReportMs < 5 * 60 * 1000) return;
      _lastAppOpenReportMs = now;
      fetch(BACKEND_URL + '/v1/users/me/app-open', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + u.jwt },
        keepalive: true,
      }).catch(function () { /* fire-and-forget — a metrics ping must never surface to the user */ });
    } catch (_) { /* never let retention tracking break the app */ }
  }

  window.Auth = {
    getCurrentUser,
    reportAppOpen,
    getJwt,
    clearUser,
    isJwtNearExpiry,
    validateAlias,
    signInWithApple,
    completeSignIn,
    getPendingApplePayload,
    // v3 Phase 1z.245 — deferred alias claim
    isApplePending,
    getPendingGivenName,
    deleteAccount,
    submitLeaderboardSnapshot,
    fetchLeaderboardTop,
    fetchRankBand,
    fetchFriendsLeaderboard,
    fetchLastWeekSteps,
    // Weekly Steps Hall of Fame (v3 Phase 1z.36)
    fetchLeaderboardHallOfFame,
    // 100K Step Club roster (v3 Phase 1z.52)
    fetchStep100kClub,
    // 100K Step Club + future accolades (v3 Phase 1z.27)
    fetchAccolades,
    // W297 — skins IAP (RevenueCat) + entitlements
    iapAvailable,
    getBackendUserId,
    // PvP (W404) — realtime duel transport needs the API origin for its own
    // fetch() + WebSocket calls (app.js owns no networking otherwise).
    getBackendBase,
    configurePurchases,
    purchaseSkin,
    getProductPrices,   // W625 — localized shop prices
    restorePurchases,
    fetchEntitlements,
    reconcileEntitlements,   // W637 — self-healing grant (recovers lost webhook / restored purchase)
    // W651/W655 — Awakened Premium (auto-renewable membership; the only paid tier)
    purchasePremium,
    getPremiumPrices,
    isMember,
    PREMIUM_PRODUCTS,
    // Cloud Sync v1 (v3 Phase 1w)
    fetchCloudState,
    uploadCloudState,
    // Friend rank badges (v3 Phase 1z.191) — public profile summary
    // submit. PUT /v1/users/me/public-profile-summary.
    submitPublicProfileSummary,
    // Public friend activity events MVP-B (v3 Phase 1z.204) —
    // batch submit + friend-scoped feed read.
    submitPublicAchievementEvents,
    fetchFriendsActivity,
    // The Hall of the Awakened (W270) — finish submit + roll read.
    submitHallFinish,
    fetchHall,
    // Profile card (W-next) — public profile by alias.
    fetchPublicProfile,
    // Friends (v3 Phase 1x)
    fetchFriends,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    // Push notifications (W603/W604) — device-token register/unregister.
    registerPushToken,
    unregisterPushToken,
    // v3 Phase 1z.279 — legacy outbox drain target (sole surviving
    // duel-named helper; the 9 other duel API wrappers were removed
    // along with the Duels subsystem).
    submitVerifiedEvents,
    // Co-op Dungeon Bosses v1 (W370)
    coopBossList,
    coopBossGet,
    coopBossCreate,
    coopBossJoin,
    coopBossDecline,
    coopBossCancel,
    coopBossResolve,
    coopBossClaim,
    devSignInIfLocalhost,
    isLocalhostDev,
    startGuest,
    isGuest,
    isNative,
    BACKEND_URL,
    // v2.1 Phase D — JSON export / import
    exportToFile,
    parseBackupFile,
    applyBackup,
  };
})();
