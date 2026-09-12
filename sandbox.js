/*
 * sandbox.js — W938 TEST HUNTER.
 *
 * Lets the owner run the whole first-run path (Sign in with Apple → onboarding
 * → the first session) on his real iPhone without deleting or disturbing his
 * account. Loaded BEFORE auth.js and app.js so nothing reads or sends state
 * before this file has decided what state the app is allowed to see.
 *
 * HOW IT KEEPS HIS ACCOUNT SAFE
 *   1. Set aside, never copy-and-hope. Every `hb_` key — progress, habits,
 *      relics, the signed-in session, the owner tag — is renamed to `hbsb_`.
 *      That prefix is invisible to every sweep in the app (the W689 purge,
 *      Reset All Progress, CloudSync's backup builder and the W818 quarantine
 *      cleanup all match `hb_` or `hbq_` exactly). The app boots as a fresh
 *      install. One key is doubled at a time, never the whole store (the W821
 *      quota lesson).
 *   2. Nothing leaves the phone. While a test runs, every non-GET request to
 *      the network is answered locally with a 503 SANDBOX — no step uploads,
 *      no cloud backups, no posts, no funnel pings, no push tokens, no error
 *      reports. Sign in with Apple and token refresh are let through: they
 *      mint a session JWT and change nothing else (sessions are stateless, so
 *      the original session still works when it is put back). GETs pass so
 *      the test hunter sees the real board. The live co-op socket is refused.
 *      Native notification scheduling and the home-screen widget are shielded
 *      too, so his real reminders and widget are not rewritten.
 *   3. Ending always restores. END TEST wipes the test hunter's keys and puts
 *      every `hbsb_` key back under its real name. Closing the app does the
 *      same thing on the next launch: the test lives in sessionStorage, which
 *      a relaunch clears, so a relaunch can never quietly continue a test.
 *   4. Every step is resumable. A phase flag is written before each stage, and
 *      boot finishes whichever stage a crash interrupted. The scratch wipe only
 *      ever runs while every real key is still set aside, and nothing under
 *      `hbsb_` is removed until its value has been written back.
 *
 * Self-contained on purpose: if app.js ever throws, END TEST still works.
 */
(function () {
  'use strict';

  var FLAG  = 'awk_sandbox_v1';      // not hb_-prefixed: no sweep, backup or purge reads it
  var TOKEN = 'awk_sandbox_token';   // sessionStorage: survives a reload, not a relaunch
  var BAK   = 'hbsb_';               // set-aside prefix

  // Device-level permission state stays in place: iOS keeps the HealthKit
  // grant for this install no matter which hunter is signed in, and removing
  // hb_healthkit_status is exactly the W830 Health blackout.
  var DEVICE = {
    hb_debug_healthkit: 1,
    hb_healthkit_prompted: 1,
    hb_hk_answered_v1: 1,
    hb_hk_first_read_v1: 1,
    hb_healthkit_status: 1,
    hb_healthkit_sleep_requested: 1,
    hb_healthkit_flights_requested: 1,
    hb_healthkit_energy_requested: 1,
    hb_healthkit_authversion: 1,
  };

  // Network calls a test may still make: minting a session changes nothing.
  var ALLOWED_POSTS = /\/v1\/auth\/(verify|refresh)(\?|$)/;

  var blocked = 0;

  function readFlag() {
    try { var raw = localStorage.getItem(FLAG); return raw ? JSON.parse(raw) : null; }
    catch (_) { return null; }
  }
  function writeFlag(f) { localStorage.setItem(FLAG, JSON.stringify(f)); }
  function listKeys(pred) {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && pred(k)) out.push(k);
    }
    return out;
  }
  function isHunterState(k) { return k.indexOf('hb_') === 0 && !DEVICE[k]; }
  function isSetAside(k)    { return k.indexOf(BAK) === 0; }

  // Put every set-aside key back under its real name, overwriting whatever the
  // test left there. Writes before it removes, so a failure part-way loses
  // nothing and the next boot simply carries on. Idempotent.
  function putBack() {
    listKeys(isSetAside).forEach(function (bk) {
      var v = localStorage.getItem(bk);
      if (v !== null) localStorage.setItem(bk.slice(BAK.length), v);
      localStorage.removeItem(bk);
    });
  }

  // Remove the test hunter. Only ever called while every real key is under hbsb_.
  function wipeTestHunter() {
    listKeys(isHunterState).forEach(function (k) { localStorage.removeItem(k); });
  }

  function clearToken() {
    try { sessionStorage.removeItem(TOKEN); } catch (_) {}
  }

  // Finish whatever stage an earlier run stopped in.
  function recover(f) {
    if (f.phase === 'moving' || f.phase === 'restore') {
      // Moving: some real keys are set aside, the rest never moved, and no
      // test state exists yet. Restore: the test hunter is already gone and
      // some real keys are already back. Either way, only put back.
      putBack();
    } else {
      // Active (the app was closed mid-test) or wipe (a crash during END).
      writeFlag({ phase: 'wipe', token: f.token, startedAt: f.startedAt });
      wipeTestHunter();
      writeFlag({ phase: 'restore', token: f.token, startedAt: f.startedAt });
      putBack();
    }
    localStorage.removeItem(FLAG);
    clearToken();
  }

  function start() {
    if (readFlag()) return { ok: false, code: 'ALREADY_RUNNING' };
    var token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    var startedAt = Date.now();
    var moved = 0;
    try {
      writeFlag({ phase: 'moving', token: token, startedAt: startedAt });
      listKeys(isHunterState).forEach(function (k) {
        var v = localStorage.getItem(k);
        if (v === null) return;
        localStorage.setItem(BAK + k, v);   // one key doubled at a time, never the store
        localStorage.removeItem(k);
        moved++;
      });
      sessionStorage.setItem(TOKEN, token);
      writeFlag({ phase: 'active', token: token, startedAt: startedAt, moved: moved });
      // A brand-new install has no cloud backup to offer; this Apple ID does.
      // Without this the first screen after sign-in offers to restore the real
      // account into the test, which is not what a new hunter sees.
      localStorage.setItem('hb_cloud_restore_dismissed', '1');
    } catch (e) {
      try { putBack(); localStorage.removeItem(FLAG); clearToken(); } catch (_) {}
      return { ok: false, code: 'STORAGE', detail: String(e && e.message || e) };
    }
    return { ok: true, moved: moved };
  }

  function end() {
    var f = readFlag();
    if (!f) return { ok: false, code: 'NOT_RUNNING' };
    try {
      recover({ phase: 'active', token: f.token, startedAt: f.startedAt });
    } catch (e) {
      // The phase flag is still on disk; the next launch finishes the job.
      return { ok: false, code: 'STORAGE', detail: String(e && e.message || e) };
    }
    return { ok: true };
  }

  // ── guards ──────────────────────────────────────────────────────────────
  function installNetworkGuard() {
    var realFetch = window.fetch;
    if (typeof realFetch === 'function') {
      window.fetch = function (input, init) {
        var url = (typeof input === 'string') ? input : ((input && input.url) || '');
        var method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
        var remote = /^https?:\/\//i.test(url);
        if (remote && method !== 'GET' && method !== 'HEAD' && !ALLOWED_POSTS.test(url)) {
          blocked++;
          return Promise.resolve(new Response(
            JSON.stringify({ ok: false, code: 'SANDBOX', detail: 'Test hunter: nothing is sent while a test runs.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          ));
        }
        return realFetch.apply(this, arguments);
      };
    }
    var RealWS = window.WebSocket;
    if (typeof RealWS === 'function') {
      var Refused = function () { throw new Error('SANDBOX: live connections are off while a test runs'); };
      Refused.prototype = RealWS.prototype;
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (c) {
        try { Refused[c] = RealWS[c]; } catch (_) {}
      });
      window.WebSocket = Refused;
    }
  }

  // Native writes that would outlive the test on this device.
  function installNativeGuard() {
    var status = {};
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      if (!P || typeof Proxy !== 'function') return status;
      var shield = function (name, isWrite) {
        var real = P[name];
        if (!real) { status[name] = 'absent'; return; }
        var shim = new Proxy(real, {
          get: function (target, prop) {
            var v = target[prop];
            if (typeof prop === 'string' && typeof v === 'function') {
              if (isWrite(prop)) return function () { blocked++; return Promise.resolve({}); };
              return function () { return v.apply(target, arguments); };
            }
            return v;
          },
        });
        try { P[name] = shim; } catch (_) {}
        status[name] = (P[name] === shim) ? 'shielded' : 'unshielded';
      };
      // Reads (pending list, permission checks, listeners) still work.
      shield('LocalNotifications', function (m) {
        return /^(schedule|cancel|removeDeliveredNotifications|removeAllDeliveredNotifications|createChannel|deleteChannel|registerActionTypes)$/.test(m);
      });
      shield('WidgetBridge', function () { return true; });
    } catch (_) {}
    return status;
  }

  function mountBar() {
    var build = function () {
      if (document.getElementById('awk-sandbox-bar')) return;
      var css = document.createElement('style');
      css.textContent =
        '#awk-sandbox-bar{position:fixed;left:50%;transform:translateX(-50%);' +
        'top:calc(env(safe-area-inset-top,0px) + 4px);z-index:2147483000;' +
        'height:24px;padding:0 12px;border-radius:999px;border:1px solid rgba(167,139,250,.7);' +
        'background:rgba(12,10,30,.92);color:#c4b5fd;font:700 10px/24px "JetBrains Mono",ui-monospace,monospace;' +
        'letter-spacing:1.6px;white-space:nowrap;cursor:pointer;-webkit-tap-highlight-color:transparent;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.45)}' +
        '#awk-sandbox-bar:active{background:rgba(40,30,80,.95)}';
      document.head.appendChild(css);
      var bar = document.createElement('button');
      bar.id = 'awk-sandbox-bar';
      bar.type = 'button';
      bar.textContent = 'TEST HUNTER · END TEST';
      bar.addEventListener('click', function () {
        var ok = true;
        try {
          ok = window.confirm('End the test?\n\nEverything the test hunter did is discarded, ' +
                              'and your own progress comes back exactly as it was.');
        } catch (_) {}
        if (!ok) return;
        var r = end();
        if (!r.ok) {
          try { window.alert('The test could not finish restoring right now. Close the app and open it again; it finishes on launch.'); } catch (_) {}
          return;
        }
        try { window.location.reload(); } catch (_) {}
      });
      document.body.appendChild(bar);
    };
    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build);
  }

  // ── boot ────────────────────────────────────────────────────────────────
  var active = false;
  var native = {};
  try {
    var f = readFlag();
    if (!f) {
      // A flag can only be missing with keys still set aside if storage was
      // edited by hand. Put back, never wipe.
      if (listKeys(isSetAside).length) putBack();
    } else {
      var tok = null;
      try { tok = sessionStorage.getItem(TOKEN); } catch (_) {}
      if (f.phase === 'active' && tok && tok === f.token) active = true;
      else recover(f);
    }
  } catch (e) {
    try { console.warn('[sandbox] boot recovery failed; it will retry next launch', e); } catch (_) {}
  }

  if (active) {
    installNetworkGuard();
    native = installNativeGuard();
    mountBar();
    try { console.warn('[sandbox] TEST HUNTER active — nothing is sent; your progress is set aside'); } catch (_) {}
  }

  window.__awkSandbox = {
    active: function () { return active; },
    start: start,
    end: end,
    status: function () {
      var f2 = readFlag();
      return {
        active: active,
        phase: f2 ? f2.phase : null,
        startedAt: f2 ? f2.startedAt : null,
        setAside: listKeys(isSetAside).length,
        blocked: blocked,
        native: native,
      };
    },
  };
})();
