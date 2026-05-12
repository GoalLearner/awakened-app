# BACKEND.md — Awakened v2.1 Backend Design

**Status:** v1.1 DESIGN — Phase A iOS-side shipped (TestFlight build 50, commit `630bbe6`); Phase B implementation not started.
**Last updated:** May 11, 2026
**Designer:** Richie (with Claude as design partner)

Companion docs:
- `CLAUDE.md` — operational reference for shipped code
- `DROPS.md` — drops/cards collection system (v1.4)
- `EQUIPMENT.md` — equipment / item schema (v1.3)
- `BOSSES.md` — boss-system design
- `CARDS.md` — boss card visual spec

---

## Summary

v2.1 introduces the first backend in Awakened's lifetime. Single feature: **the live leaderboard.** Three Apple-Health-verifiable metrics (7-day step total, longest 7+ hour sleep streak, longest before-midnight bedtime streak) get pushed to a tiny Cloudflare-edge backend on app open + visibility change, and the Social tab swaps its mock entries for real top-50 rankings.

Authentication is **mandatory Sign in with Apple at first launch** — no skip, no soft prompt in v2.1. The leaderboard is the v2.1 hook; soft-gating is a v2.2 consideration if install→activation telemetry shows the mandatory gate is hurting conversion.

A **JSON export/import button** ships in Settings → Account as the cross-device-sync safety net. Users who delete-and-reinstall the app can manually checkpoint their full `hb_*` state to a JSON file and restore it. Real cross-device sync is deferred to v2.2.

Privacy posture is deliberate: only the alias + 3 leaderboard metrics ever leave the device. HealthKit raw data, habit names, custom habits, completion history, souls, inventory, class, and XP details all stay local-only.

---

## Scope

### In-scope (v2.1)

Five phases, sequenced. Each becomes a separate implementation commit train:

- **Phase A — iOS Sign in with Apple integration.** Capability registration, plugin install, mandatory sign-in gate UI, identity-token capture (stub backend call).
- **Phase B — Backend skeleton.** Cloudflare Workers + D1 schema + 4 endpoints + Apple JWKs verification + deployment.
- **Phase C — Client wiring.** Live `/v1/leaderboard/submit` from `lbGetSnapshot()`, replace mocks in Social tab, offline fallback to cached top-N.
- **Phase D — Export / import safety net.** Settings → Account buttons. JSON download + JSON file-picker + restore-with-confirmation modal.
- **Phase E — Privacy posture.** Sign out + delete account in Settings, privacy policy update, App Store privacy questionnaire updates.

### Out-of-scope (v2.1)

Explicitly deferred to v2.2 or later. Do not relitigate during v2.1 implementation:

- Friends list / following / friend-only leaderboards
- Server-driven push notifications ("you got passed in ranking!")
- Anti-cheat / server-side HealthKit verification of submitted values
- Time-windowed leaderboards (weekly resets, monthly resets, seasons)
- Regional / country / age-bracket breakdowns
- Cosmetic flexes / equip-on-public-profile / card showcase
- **Automatic cloud sync of full state** — that is real sync, not what v2.1 ships. Export/import is the v2.1 mitigation. Sync is v2.2.
- Server-to-server Apple notification webhook (account-revocation events from Apple). Acknowledged but skipped in v2.1. Without it, a user who revokes Sign in with Apple in iOS Settings + reinstalls would create a new backend account — acceptable edge-case loss for v1.
- Cross-device login state (signing in on iPad picks up where iPhone left off). Requires sync, deferred.

---

## Architecture

### Stack decision: Cloudflare Workers + D1

**Why D1 over Postgres / Supabase:**

D1 is Cloudflare's edge-distributed SQLite. For v2.1's workload (4 endpoints, one global all-time leaderboard per metric, ~3 read+1 write per active user per day) it's drastically over-engineered to reach for Postgres. D1's strengths land exactly where v2.1 needs them:

- **Faster to scaffold.** One `wrangler d1 create` command + one migration SQL file. No connection pooling, no IAM, no separate DB host to provision.
- **Cheaper free tier.** 5 GB storage + 5M reads/day free. Awakened's projected first-year footprint is <50 MB and <100K reads/day across the active user base.
- **Sufficient query model.** Top-N indexed lookup against `(metric, value DESC)` is what 100% of leaderboard reads are. No joins beyond `users ⋈ leaderboard_snapshots`. No transactions across regions. No real-time subscriptions needed.

**Acknowledged D1 limitations:**

- Non-ACID across regions (writes to D1 are eventually consistent across the edge replica set, typically <10s). Acceptable for a leaderboard that displays "your rank as of a few minutes ago."
- Per-query result size cap (~50K rows). Won't bite at any realistic Awakened scale.
- No full-text search built-in. Won't need it for v2.1.

**Migration trigger:** if v2.x needs friends-graph queries (recursive joins), real-time leaderboard updates (subscriptions), or transactional cross-table writes with strong consistency, revisit Postgres (Neon / Supabase / self-hosted). The schema migration is straightforward — both D1 and Postgres speak SQL. The Workers handlers would need to swap the DB driver. Estimated migration cost when triggered: ~1 day.

### Why Cloudflare over AWS / Vercel / Fly

- **Free tier covers actual v2.1 load by an order of magnitude.** No surprise bills.
- **Zero cold starts.** Workers are pre-warmed across the edge. Every request is sub-50ms first-byte. Lambda + DynamoDB has cold-start tax on the first request after idle; Vercel Functions inherit AWS Lambda's cold-start behavior.
- **JWT-friendly deploy.** Workers natively support `crypto.subtle.verify` against Apple's JWKs without an SDK; everything is fetch + Web Crypto API.
- **Global edge by default.** No multi-region setup. A user in Tokyo hits the Tokyo edge, a user in NYC hits the NYC edge.
- **Wrangler CLI is good.** `wrangler deploy` is a one-shot publish; `wrangler tail` streams logs in real time; `wrangler d1 execute` runs ad-hoc SQL against staging/prod.

### Capacitor plugin

`@capacitor-community/apple-sign-in@^7.0.0` (latest stable at time of design). Plugin surface used:

```
import { SignInWithApple } from '@capacitor-community/apple-sign-in';

const result = await SignInWithApple.authorize({
  clientId: 'com.goallearner.awakened',
  redirectURI: '',  // unused for iOS native
  scopes: 'name email',
  state: '<random nonce>',
});
// result.response.identityToken — the JWT we POST to /v1/auth/verify
// result.response.user — Apple's stable per-app `sub`
```

Plugin is iOS-only (no web fallback). On the PWA build, `SignInWithApple.authorize` will throw or no-op — handled by showing a "Sign-in is only available in the iOS app" message in the sign-in gate on web.

---

## Auth flow

### Sequence (mandatory gate, first launch)

```
1. App init → check localStorage.hb_user
2. If hb_user missing OR jwt expired:
   a. Show #signin-gate overlay (full-screen, no dismiss)
   b. User taps "Sign in with Apple" button
   c. Capacitor plugin: SignInWithApple.authorize()
   d. iOS shows native prompt → user authorizes → plugin returns { user, identityToken }
   e. Client POST /v1/auth/verify with { identityToken, alias? }
       - alias is sent ONLY on first sign-in (when the gate also shows an alias picker)
       - subsequent sign-ins omit alias; backend looks up existing user by apple_sub
   f. Backend validates identityToken against Apple's public JWKs
   g. Backend NORMALIZES alias (lowercase for everyone EXCEPT preserved-case subs)
   h. Backend upserts user row (creates on first sign-in, returns existing on subsequent)
   i. Backend returns { jwt, user: { id, alias, created_at } }
       - response's alias is the NORMALIZED value (may differ from request's alias)
   j. Client stores response.alias in hb_user (NOT what the user typed)
3. Hide #signin-gate, continue app load
```

### Alias normalization (locked decision)

All aliases are forced lowercase server-side **except** for an allowlist of preserved-case Apple subs. v2.1 launch allowlist contains exactly one entry: Richie's. Anyone else who registers `"TopDog"` ends up stored as `"topdog"` and that's what appears on the leaderboard.

**Why:**
- Distinctive founder signature on every leaderboard surface without needing a verified-badge UI or admin-role visual element
- The casing IS the signal — OSRS-authentic, no extra rendering complexity
- Forces a community aesthetic (all-lowercase usernames have a chill late-90s-forum vibe; aligns with Awakened's typography)
- Reduces visual noise — no `"ALLCAPS_DESTROYER"` shouting on the leaderboard
- Zero performance cost; one Set lookup + one `.toLowerCase()` call

**Implementation:**
```typescript
const PRESERVED_CASE_SUBS = new Set([env.RICHIE_APPLE_SUB]);

function normalizeAlias(alias: string, appleSub: string): string {
  const trimmed = alias.trim();
  return PRESERVED_CASE_SUBS.has(appleSub) ? trimmed : trimmed.toLowerCase();
}
```

Applied inside `/v1/auth/verify` BEFORE the alias is validated for charset/profanity/uniqueness and BEFORE the DB insert. The response returns the normalized form so the client knows what's actually stored.

**Bootstrapping:** `RICHIE_APPLE_SUB` is captured from his first sign-in to TestFlight (the v2.1 Phase A stub build), then set via `wrangler secret put RICHIE_APPLE_SUB` before Phase B's `/v1/auth/verify` deploys. Hardcoded set is fine for v2.1; an `is_admin` column on `users` can replace the hardcoded set in v2.2+ if the privilege needs to be grantable to additional accounts.

**Side effect on uniqueness:** the `UNIQUE INDEX ON LOWER(alias)` already enforced case-insensitive uniqueness, so normalization doesn't change the collision logic. `"TopDog"` and `"TOPDOG"` and `"topdog"` were always going to collide. The normalization just chooses which case wins in storage.

### Mandatory-gate decision (locked)

The sign-in gate is **mandatory at first launch** — no skip, no "maybe later", no soft prompt in v2.1.

**Tradeoff acknowledged:** mandatory auth at first launch is a known conversion killer. Industry data suggests 10–30% of users who would have engaged with a soft-gated app bounce at a mandatory gate. For Awakened's current user base (small, TestFlight-only, primarily Richie + close-circle test users) this cost is acceptable.

**Why we accept it for v2.1:**

- The leaderboard IS the v2.1 hook. Soft-gating creates a confused UX where the Social tab shows "Sign in to compete" but the rest of the app works without auth — bifurcates the product narrative.
- Auth-bound state simplifies every downstream feature (cloud sync, friends, server-driven push) that v2.2+ will build on this foundation.
- Sign in with Apple is the lowest-friction auth available on iOS — one tap, no email/password forms, no name reveal required.

**Soft-prompt revisit trigger:** if install→activation telemetry shows >25% drop-off at the gate after v2.1 reaches a broader user base, revisit and add a "skip for now" path that disables leaderboard + cloud features but allows local-only use. v2.2 work item, not v2.1.

### `hb_user` storage shape

```js
{
  sub:               '001234.abcdef...',  // Apple's stable per-app subject identifier
  alias:             'HunterShadow',
  jwt:               'eyJhbGc...',        // backend session JWT
  signed_in_date:    '2026-05-11',        // device-local YYYY-MM-DD
  jwt_expires_at:    1726678000,          // Unix epoch seconds
}
```

### JWT lifetime + refresh

JWT lifetime is **90 days** from issue. Backend includes `iat` (issued-at) and `exp` (expires-at) claims.

**Refresh-on-open** — on every app open, check `hb_user.jwt_expires_at`:
- If `>14 days` remaining: do nothing, use existing JWT.
- If `<14 days` remaining: silently re-authorize via Apple (`SignInWithApple.authorize()` — typically silent on iOS if the user hasn't revoked) → exchange fresh identity token for a new JWT via `/v1/auth/verify` (without an alias — backend recognizes the apple_sub and returns the existing user).
- If silent re-authorize FAILS (user revoked Sign in with Apple in iOS Settings): clear `hb_user`, show `#signin-gate` again.

If JWT has already expired when the app opens, treat as `<14 days` case → silent refresh attempt → fallback to gate if it fails.

### Internal-UUID primary key (locked decision)

Users table primary key is an **internal UUID v4**, not Apple `sub`. Apple `sub` is a `UNIQUE NOT NULL` foreign-key column.

**Why:**
- Insulates against Apple Team ID changes. Apple's `sub` claim is stable per `(Apple ID, Team ID, App ID)`. If we ever transfer the app to a different team, every user's `sub` rotates and we'd lose the rows. With an internal UUID PK, the migration is a single `UPDATE users SET apple_sub = ... WHERE apple_sub = ...` per affected user.
- Keeps the door open for future non-Apple auth (Google Sign-In for Android, email magic-link, etc.) without a schema migration. We'd just add `google_sub TEXT UNIQUE NULLABLE` and `email TEXT UNIQUE NULLABLE` columns. The PK never changes.
- Cleaner foreign keys in `leaderboard_snapshots`. `user_id TEXT` referencing an internal UUID is a stable contract regardless of which auth provider issued the user's identity.

---

## Database schema (D1 SQL)

All timestamps are Unix epoch seconds (INTEGER) for portability and arithmetic ease. UTF-8 throughout.

### Schema v1

```sql
-- /backend/migrations/0001_initial.sql

CREATE TABLE users (
  id         TEXT PRIMARY KEY,            -- UUID v4, generated by Worker
  apple_sub  TEXT UNIQUE NOT NULL,        -- Apple's stable per-app subject identifier
  alias      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Case-insensitive alias uniqueness. "HunterShadow" and "huntershadow" collide.
CREATE UNIQUE INDEX idx_users_alias_lower ON users(LOWER(alias));

CREATE TABLE leaderboard_snapshots (
  user_id        TEXT NOT NULL,
  metric         TEXT NOT NULL,           -- 'steps_7d' | 'sleep_streak' | 'bedtime_streak'
  current_value  INTEGER NOT NULL,        -- live rolling value (most recent)
  best_value     INTEGER NOT NULL,        -- all-time peak
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, metric),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for top-N queries. Two indexes — one per ranking mode.
-- v2.1 only uses idx_lb_metric_current; idx_lb_metric_best is forward-investment
-- for the "all-time greatest" view in v2.2.
CREATE INDEX idx_lb_metric_current ON leaderboard_snapshots(metric, current_value DESC);
CREATE INDEX idx_lb_metric_best    ON leaderboard_snapshots(metric, best_value DESC);
```

### Migration discipline

Each schema change ships as a numbered SQL file in `/backend/migrations/`:

```
/backend/migrations/
  0001_initial.sql
  0002_<short_description>.sql
  0003_<short_description>.sql
  ...
```

Wrangler applies migrations in order via `wrangler d1 migrations apply <db_name>`. Never edit a migration after it's been applied to production — add a new numbered migration instead.

Migration commit discipline: when a migration ships, the commit message starts with `migration:` so it's grep-able in `git log --grep migration`.

---

## Endpoints

All endpoints prefixed `/v1/`. Future breaking changes go to `/v2/` paths and run alongside `/v1/` until clients are upgraded.

CORS: only the iOS Capacitor origin (`capacitor://localhost`) and Netlify production origin are allowed. Web PWA on `awakened.netlify.app` (or wherever it lives) gets a permissive CORS allowance; everything else is rejected.

### `POST /v1/auth/verify`

**Auth:** none.
**Purpose:** exchange a fresh Apple identity token for a backend session JWT. Creates a new user row on first call, returns the existing user on subsequent calls (matched by `apple_sub`).

**Request:**
```json
{
  "identityToken": "eyJhbGc...",
  "alias": "HunterShadow"    // OPTIONAL: only on first sign-in
}
```

**Response 200:**
```json
{
  "jwt": "eyJhbGc...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "alias": "HunterShadow",
    "created_at": 1726000000
  }
}
```

**Errors:**
- `400 BAD_REQUEST` — body malformed (missing `identityToken`)
- `401 INVALID_TOKEN` — identity token signature invalid, expired, or audience mismatch (not `com.goallearner.awakened`)
- `409 ALIAS_TAKEN` — first-sign-in case; another user already has the alias (case-insensitive). Client should re-prompt for alias and retry.
- `422 ALIAS_REJECTED` — first-sign-in case; alias fails profanity filter, exceeds length cap (32 chars), or contains disallowed characters (only `[A-Za-z0-9_-]` allowed). Client re-prompts with explanation.
- `422 ALIAS_REQUIRED` — first-sign-in (no existing user for this `apple_sub`) but no `alias` field in body. Client re-prompts with alias picker.

**Validation flow on backend:**
1. Decode JWT header → check `kid` claim → fetch matching public key from Apple's JWKs endpoint (cached for 24h)
2. Verify signature, expiration (`exp`), and audience (`aud === 'com.goallearner.awakened'`)
3. Extract `sub` claim
4. `SELECT * FROM users WHERE apple_sub = ?`
   - If found: skip alias validation, issue JWT for that user, return
   - If not found:
     - If `alias` missing → 422 ALIAS_REQUIRED
     - **Normalize the alias via `normalizeAlias(alias, sub)`** (lowercase for everyone except `PRESERVED_CASE_SUBS` — see "Alias normalization" section)
     - Validate the normalized alias (length, charset, profanity, uniqueness)
     - `INSERT INTO users (id, apple_sub, alias, created_at, updated_at) VALUES (?, ?, ?, ?, ?)` with fresh UUID + the normalized alias
     - Issue JWT, return — response's `user.alias` is the normalized form, NOT what the user typed

### `POST /v1/leaderboard/submit`

**Auth:** `Authorization: Bearer <jwt>` required.
**Purpose:** upsert the user's snapshot for each metric.

**Request:**
```json
{
  "snapshots": [
    { "metric": "steps_7d",        "current_value": 28432, "best_value": 67891 },
    { "metric": "sleep_streak",    "current_value": 5,     "best_value": 23 },
    { "metric": "bedtime_streak",  "current_value": 0,     "best_value": 12 }
  ]
}
```

**Response:** `204 NO_CONTENT`.

**Errors:**
- `401 INVALID_JWT` — JWT missing, malformed, expired, or signature invalid
- `400 BAD_REQUEST` — body malformed, unknown metric, negative value, value exceeds sanity cap (see below)

**Sanity caps** (server rejects with 400 if exceeded — defense against accidentally-corrupted client state, NOT a real anti-cheat layer):
- `steps_7d`: max 7 × 200,000 = 1,400,000 (200K steps/day is well above any realistic human)
- `sleep_streak`: max 3650 (10 years of consecutive nights — generous)
- `bedtime_streak`: max 3650 (same rationale)

**Side effects:**
```sql
INSERT INTO leaderboard_snapshots (user_id, metric, current_value, best_value, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(user_id, metric) DO UPDATE SET
  current_value = excluded.current_value,
  best_value = MAX(best_value, excluded.best_value),
  updated_at = excluded.updated_at;
```

Note `best_value` uses `MAX(best_value, excluded.best_value)` — never decreases. If the client somehow sends a lower `best_value` (e.g., from a fresh-install before they restored their export), we preserve the historical peak rather than overwrite.

### `GET /v1/leaderboard/top`

**Auth:** `Authorization: Bearer <jwt>` required.
**Query params:**
- `metric` — one of `steps_7d` | `sleep_streak` | `bedtime_streak`. Required.
- `limit` — 1–100, default 50.

**Response 200:**
```json
{
  "metric": "steps_7d",
  "entries": [
    { "rank": 1, "alias": "TopDog", "value": 142000 },
    { "rank": 2, "alias": "RunsHard", "value": 138420 },
    ...
  ],
  "me": { "rank": 42, "value": 28432 },
  "updated_at": 1726000000
}
```

`me` is `null` if the calling user has no submitted snapshot for this metric yet.

**Errors:**
- `401 INVALID_JWT`
- `400 BAD_REQUEST` — unknown metric or limit out of range

**Query:**
```sql
SELECT u.alias, ls.current_value, ROW_NUMBER() OVER (ORDER BY ls.current_value DESC) AS rank
FROM leaderboard_snapshots ls
JOIN users u ON u.id = ls.user_id
WHERE ls.metric = ?
ORDER BY ls.current_value DESC
LIMIT ?;
```

Plus a separate "find me" query:
```sql
SELECT rank, value FROM (
  SELECT user_id, current_value AS value,
         ROW_NUMBER() OVER (ORDER BY current_value DESC) AS rank
  FROM leaderboard_snapshots WHERE metric = ?
) WHERE user_id = ?;
```

### `POST /v1/account/delete`

**Auth:** `Authorization: Bearer <jwt>` required.
**Purpose:** App Store requirement for apps offering Sign in with Apple — users must be able to delete their account from within the app.

**Request:** empty body.
**Response:** `204 NO_CONTENT`.

**Errors:**
- `401 INVALID_JWT`

**Side effects:**
```sql
DELETE FROM users WHERE id = ?;
-- leaderboard_snapshots cascade-deletes via FK ON DELETE CASCADE
```

The Apple `sub` is now orphaned from any user row. If the same Apple ID signs in again later, a new user row is created (fresh UUID, fresh alias prompt). No "soft delete" — full hard delete satisfies the App Store requirement and matches the user's reasonable expectation when they tap "Delete my account."

### Rate limits

Configured via Cloudflare's built-in rate limiter (Workers Rate Limiting). Applied per-IP for unauthenticated routes, per-JWT-user for authenticated routes.

| Endpoint | Limit | Reason |
|---|---|---|
| `POST /v1/auth/verify` | 10 req / minute / IP | Prevents brute-force enumeration of valid Apple sub values + alias-collision probing |
| `POST /v1/leaderboard/submit` | 12 req / hour / user | Client debounces to 5min minimum, so 12/hr is a 5× headroom buffer |
| `GET /v1/leaderboard/top` | 60 req / minute / user | UI may refresh top-N on tab switch + pull-to-refresh — generous |
| `POST /v1/account/delete` | 5 req / minute / user | Deletion is irreversible; rate limit is defense against a runaway client bug |

Exceeding a limit returns `429 TOO_MANY_REQUESTS` with `Retry-After` header. Client surfaces a toast: "Slow down — try again in a moment."

---

## Client wiring (changes to `app.js`)

### `lbSubmitSnapshot()` — new function

```js
let _lastLbSubmitMs = 0;
const LB_SUBMIT_MIN_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes

async function lbSubmitSnapshot() {
  if (!Health.isAvailable()) return;            // web/no-HealthKit: skip
  if (!getJwt()) return;                         // not signed in: skip
  const now = Date.now();
  if (now - _lastLbSubmitMs < LB_SUBMIT_MIN_INTERVAL_MS) return;  // debounced
  _lastLbSubmitMs = now;

  const snap = lbGetSnapshot();
  const payload = {
    snapshots: [
      { metric: 'steps_7d',       current_value: snap.steps_last_7_days,       best_value: snap.best_7day_step_total },
      { metric: 'sleep_streak',   current_value: snap.current_sleep_streak,    best_value: snap.best_sleep_streak },
      { metric: 'bedtime_streak', current_value: snap.current_bedtime_streak,  best_value: snap.best_bedtime_streak },
    ],
  };

  try {
    await fetch(`${BACKEND_URL}/v1/leaderboard/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    // Silent fail; the 5-min debounce means we'll retry on next app open.
    _lastLbSubmitMs = 0;  // allow immediate retry on next event
  }
}
```

### Call sites

- App init (after auth completes): `lbSubmitSnapshot()`
- `visibilitychange` resume from background: `lbSubmitSnapshot()`
- Right after `autoVerifySleep()` and `autoVerifyWalk()` complete (so freshly-recorded values get pushed without waiting for next app open)

### Social tab — replace mocks with real fetch

`openLeaderboardRanking(metric)` currently renders blurred mocks from `LB_MOCK_NAMES` + `LB_METRIC_META[metric].mockTop`. Replace with:

```js
async function openLeaderboardRanking(metric) {
  // ... existing modal-open scaffold ...
  const cached = loadLbCache(metric);
  if (cached) renderLbEntries(cached);   // fast path: show cached immediately

  try {
    const res = await fetch(`${BACKEND_URL}/v1/leaderboard/top?metric=${metric}&limit=50`, {
      headers: { 'Authorization': `Bearer ${getJwt()}` },
    });
    if (!res.ok) throw new Error('lb fetch failed: ' + res.status);
    const data = await res.json();
    saveLbCache(metric, data);
    renderLbEntries(data);
  } catch (_) {
    if (!cached) renderLbError();  // no cache + fetch failed: error state
    // if cached + fetch failed: keep showing cached, no error
  }
}
```

**Cleanup:**
- Delete `LB_MOCK_NAMES`
- Delete `LB_METRIC_META[metric].mockTop`
- Delete `.lb-rank-row--mock` CSS class + blur filter
- Delete "rank pending — live rankings open in a future update" footer note
- Keep `.lb-rank-row--user` gold-accent styling for the calling user's row

### Offline / cache fallback

New localStorage key: `hb_lb_cache`.

Shape:
```js
{
  [metric]: {
    entries:    [{ rank, alias, value }],
    me:         { rank, value } | null,
    fetched_at: 1726000000  // Unix epoch seconds
  }
}
```

Cache helpers:
```js
function loadLbCache(metric) {
  try {
    const raw = localStorage.getItem('hb_lb_cache');
    if (!raw) return null;
    const all = JSON.parse(raw);
    return all[metric] || null;
  } catch (_) { return null; }
}

function saveLbCache(metric, data) {
  try {
    const raw = localStorage.getItem('hb_lb_cache') || '{}';
    const all = JSON.parse(raw);
    all[metric] = { ...data, fetched_at: Math.floor(Date.now() / 1000) };
    localStorage.setItem('hb_lb_cache', JSON.stringify(all));
  } catch (_) {}
}
```

Footer text rendered alongside the entries:
- `fetched_at` within last 2 minutes → "Live"
- `fetched_at` 2–60 minutes ago → "Last updated Nm ago"
- `fetched_at` >60 minutes ago → "Last updated [date]"
- No cache + fetch failed → render-error state ("Couldn't load leaderboard. Check connection.")

### Auth scaffolding

New module-scope helpers:

```js
function getJwt() {
  try {
    const u = JSON.parse(localStorage.getItem('hb_user') || 'null');
    return u && u.jwt ? u.jwt : null;
  } catch (_) { return null; }
}

function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem('hb_user') || 'null'); } catch (_) { return null; }
}

function clearUser() {
  localStorage.removeItem('hb_user');
}

function isJwtNearExpiry() {
  const u = getCurrentUser();
  if (!u || !u.jwt_expires_at) return true;
  const now = Math.floor(Date.now() / 1000);
  return (u.jwt_expires_at - now) < (14 * 24 * 60 * 60);  // <14 days
}
```

### Sign-in gate UI

New full-screen overlay `#signin-gate` (defaults to `display: none`). Shown when `getCurrentUser() === null` after `hb_welcomed === '1'` (welcome screen comes first, then sign-in). On first-launch flows:

1. Welcome screen
2. Sign-in gate (NEW — mandatory)
3. Path/onboarding screens
4. App loads

Gate markup:
```
┌──────────────────────────────────┐
│        AWAKENED                  │
│                                  │
│   Sign in to claim your hunter   │
│   identity. Your stats will sync │
│   to the global leaderboard.     │
│                                  │
│   [  Sign in with Apple  ]       │
│                                  │
│   By signing in you agree to     │
│   the Privacy Policy.            │
└──────────────────────────────────┘
```

After successful sign-in, on first-time-only the gate transitions to an **alias picker** (or this can be a second step within the same gate):

```
┌──────────────────────────────────┐
│   PICK YOUR HUNTER NAME          │
│                                  │
│   This is how you'll appear on   │
│   the leaderboard.               │
│                                  │
│   [______________________]       │
│   3-32 chars, letters/numbers    │
│                                  │
│   [   Continue   ]               │
└──────────────────────────────────┘
```

Alias defaults to existing `localStorage.getItem('hb_name')` if set. Client-side validation: length + charset. Server-side: profanity + uniqueness. On server rejection, display the error and let the user retry.

---

## Export / import (Phase D)

### Backup button

**Settings → Account → "Backup my data"**

Click handler:
```js
function exportBackup() {
  const data = { _backup_version: 1, _exported_at: new Date().toISOString() };
  // Walk every hb_* key in localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('hb_')) data[k] = localStorage.getItem(k);
  }
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `awakened-backup-${getDeviceLocalDate()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

Filename: `awakened-backup-YYYY-MM-DD.json`.

### Restore button

**Settings → Account → "Restore from backup"**

Click handler:
```js
function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (_) { showHabitToast('Invalid backup file.'); return; }
    if (!parsed._backup_version || parsed._backup_version !== 1) {
      showHabitToast('Unsupported backup version.');
      return;
    }
    const confirmed = await showDestructiveConfirm(
      'Restore from backup',
      'This will OVERWRITE all your current Awakened data — habits, streaks, inventory, everything. This cannot be undone. Continue?',
      'Restore', 'Cancel'
    );
    if (!confirmed) return;
    // Wipe all hb_* keys
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('hb_')) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    // Write backup keys
    Object.keys(parsed).forEach(k => {
      if (k.startsWith('hb_')) localStorage.setItem(k, parsed[k]);
    });
    // Reload to re-init from restored state
    window.location.reload();
  };
  input.click();
}
```

### Backup format

```json
{
  "_backup_version": 1,
  "_exported_at": "2026-05-11T22:30:00.000Z",
  "hb_habits": "[...]",
  "hb_completions": "{...}",
  "hb_streaks": "{...}",
  "hb_points": "1234",
  "hb_bosses": "{...}",
  "hb_inventory": "{...}",
  "hb_souls": "{...}",
  "hb_user": "{...}",
  ...
}
```

All `hb_*` keys are captured verbatim (their values are already JSON strings or plain values stored in localStorage). The two leading `_` keys are metadata, ignored on restore by the `startsWith('hb_')` filter.

**Forward-compat:** future schema changes that need backup-restore awareness (e.g., a v2 schema that splits one key into two) bump `_backup_version` to 2 and the restore handler grows a migration branch. Old backups (v1) restore into a v2-aware schema via in-restore-time migration logic.

**v2.1 scope:** v1 format only, no migration logic. The migration scaffold is acknowledged but skipped until needed.

### Out-of-scope for v2.1

Automatic cloud-side backup of state (cloud sync). That's a v2.2 feature. The manual export button gives users agency over their own persistence in v2.1.

---

## Privacy posture (Phase E)

### What gets transmitted to the backend

Only:
- Alias (the user's chosen hunter name)
- Leaderboard metrics: `current_value` and `best_value` for `steps_7d`, `sleep_streak`, `bedtime_streak`

That's it. Three integers × two values each = 6 numbers per user per submission.

### What does NOT get transmitted

- HealthKit raw data (step samples, sleep samples, bedtime samples) — stays on device
- Habit names (canonical or custom) — stays on device
- Custom habit details (emoji, primary stat, etc.) — stays on device
- Completion history (which habits, which days) — stays on device
- Souls balance or transaction history — stays on device
- Inventory (card collection, drop history) — stays on device
- Class assignment, XP, rank, stat levels — stays on device
- Achievements, perfect-day streak, compound bonus state — stays on device
- Player name (if different from alias) — stays on device
- Notes (legacy `hb_notes` key) — stays on device
- All Apple Health–derived intermediate state (daily step counts, sleep durations, bedtime booleans) — stays on device

**Privacy framing:** the backend learns "what's the user's 7-day step total" — it does NOT learn "what days they walked, when they walked, or how their walking distributed across the week." Aggregate-only.

### Settings → Account section

New collapsible (or top-level row) in Settings:

```
ACCOUNT
─────────
Signed in as @HunterShadow
Member since May 11, 2026

[ Sign out ]
[ Delete my account ]
```

**Sign out:**
```js
function signOut() {
  clearUser();
  // Local data (habits, streaks, inventory, souls) stays intact.
  // User is now signed out → sign-in gate appears on next render.
  window.location.reload();
}
```

Sign-out preserves local habit state. The user can sign back in with the same Apple ID and resume the same backend identity (apple_sub is stable). Their leaderboard rank is preserved.

**Delete my account:**
```js
async function deleteAccount() {
  const confirmed = await showDestructiveConfirm(
    'Delete account',
    'This will permanently delete your leaderboard identity and remove you from all rankings. Your local habit data will stay on this device. You can sign back in later but will start with a fresh leaderboard slot. Continue?',
    'Delete', 'Cancel'
  );
  if (!confirmed) return;
  try {
    await fetch(`${BACKEND_URL}/v1/account/delete`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getJwt()}` },
    });
  } catch (_) {
    showHabitToast('Failed to delete. Try again later.');
    return;
  }
  clearUser();
  showHabitToast('Account deleted.');
  window.location.reload();
}
```

After delete:
- Backend rows (user + all leaderboard_snapshots via cascade) are gone
- Local `hb_user` cleared
- Local habit state preserved (intentionally — the user might want to keep their daily habit tracking and just opt out of the leaderboard)
- App enters signed-out state → sign-in gate appears on reload

### Apple privacy nutrition labels

App Store Connect → App Privacy needs an update before submission. New data collection categories:

- **Identifiers → User ID** — Apple `sub` (anonymous identifier; linked to user via Sign in with Apple)
- **User Content → Other User Content** — alias (display name)
- **Usage Data → Other Usage Data** — leaderboard metrics (steps, sleep, bedtime aggregates)

All three are linked to the user identity (not anonymous beyond the apple_sub abstraction). None are used for tracking across other apps or websites.

### Privacy policy update

Required before App Store submission. Standalone doc, not BACKEND.md. TODO for Phase E:
- Create `/PRIVACY.md` at project root with the new data-collection language
- Host the rendered version at a stable URL (Netlify or GitHub Pages)
- Link from the sign-in gate ("By signing in you agree to the Privacy Policy.")
- Reference the URL in App Store Connect

---

## Secrets + deploy

### Cloudflare account setup (one-time manual step)

```bash
# 1. Create Cloudflare account (free) at cloudflare.com
# 2. Install Wrangler CLI globally
npm install -g wrangler

# 3. Authenticate
wrangler login
# Opens browser; authenticate with the Cloudflare account

# 4. Create the Worker project
cd backend
wrangler init awakened-backend --no-git
# Selects TypeScript template; creates wrangler.toml + src/index.ts

# 5. Create the D1 database
wrangler d1 create awakened-prod
# Outputs the database_id — copy this into wrangler.toml [[d1_databases]] section

# 6. Apply schema
wrangler d1 migrations apply awakened-prod

# 7. Set secrets (paste each value when prompted)
wrangler secret put JWT_SIGNING_KEY
# (paste a 32-byte random hex string — generate with: openssl rand -hex 32)

# 8. Deploy
wrangler deploy
# Outputs the deployed Worker URL — copy into app.js BACKEND_URL constant
```

### Secrets list (v2.1 minimum)

| Secret | Purpose | How to obtain |
|---|---|---|
| `JWT_SIGNING_KEY` | HMAC key for signing backend session JWTs (HS256) | `openssl rand -hex 32` |
| `APPLE_BUNDLE_ID` | Expected audience in Apple identity tokens. Set to `com.goallearner.awakened`. Not secret per se, but cleaner to store in env vars than hardcode. | App Store Connect → App ID |
| `RICHIE_APPLE_SUB` | Richie's stable Apple `sub` claim. Used by `normalizeAlias()` to allowlist his alias from forced lowercase (see "Alias normalization" section). | Captured from Phase A TestFlight: sign in, then `JSON.parse(localStorage.getItem('hb_user')).sub` in Safari Web Inspector. Set via `wrangler secret put RICHIE_APPLE_SUB`. |

**Deferred to v2.2** (server-to-server Apple notifications, not needed for v2.1):
- `APPLE_TEAM_ID` — Apple Developer Team ID
- `APPLE_KEY_ID` — Apple Sign-In key identifier
- `APPLE_PRIVATE_KEY` — .p8 private key for signing requests to Apple's server-to-server endpoints

For v2.1, identity-token verification uses Apple's PUBLIC JWKs (no private key needed). Apple's JWKs are at `https://appleid.apple.com/auth/keys` and are cached in the Worker for 24 hours via `cache: 'force-cache'` on the fetch.

### Repo layout

```
/awakened-app  (the existing repo)
├── app.js                ← existing (gets new auth scaffolding + lbSubmit + cache helpers)
├── index.html            ← existing (gets #signin-gate markup)
├── styles.css            ← existing (gets sign-in gate + account-section CSS)
├── sw.js                 ← existing
├── codemagic.yaml        ← existing (no v2.1 changes expected — entitlement already covers Sign in with Apple once enabled in Developer Portal)
├── package.json          ← existing (gains @capacitor-community/apple-sign-in)
├── BACKEND.md            ← THIS DOC
├── PRIVACY.md            ← NEW in Phase E
└── backend/              ← NEW SUBFOLDER for the Cloudflare Worker
    ├── package.json
    ├── wrangler.toml
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts       ← Worker entrypoint, router, all 4 handlers
    │   ├── apple-jwks.ts  ← Apple identity-token verification
    │   ├── session-jwt.ts ← issue/verify backend session JWTs
    │   ├── db.ts          ← typed D1 wrappers
    │   ├── profanity.ts   ← alias blocklist filter
    │   └── env.d.ts       ← typed bindings (D1, secrets)
    └── migrations/
        └── 0001_initial.sql
```

**wrangler.toml** template:
```toml
name = "awakened-backend"
main = "src/index.ts"
compatibility_date = "2026-05-11"

[[d1_databases]]
binding = "DB"
database_name = "awakened-prod"
database_id = "<copied from wrangler d1 create output>"

[vars]
APPLE_BUNDLE_ID = "com.goallearner.awakened"
# JWT_SIGNING_KEY set via `wrangler secret put` — NEVER in this file
```

### Deploy command

```bash
cd backend
wrangler deploy
```

That's it. Deploy is ~5 seconds. Logs:
```bash
wrangler tail
```

Run a single SQL query:
```bash
wrangler d1 execute awakened-prod --command "SELECT COUNT(*) FROM users"
```

---

## Failure modes

### Cloudflare is down

Client `lbSubmitSnapshot()` fetch fails → silent retry on next visibilitychange.

Client `openLeaderboardRanking()` fetch fails:
- If cached top-N exists → render cache, show "Last updated Nm ago" footer
- If no cache → render error state: "Couldn't load leaderboard. Check connection."

App remains fully usable. Habits, streaks, drops, notifications all work. Leaderboard is the only degraded surface.

### Apple's auth servers are down

Sign-in gate "Sign in with Apple" tap → plugin call fails → show inline error: "Apple sign-in is temporarily unavailable. Try again in a moment." Plus a retry button.

Per the mandatory-gate decision: the user is blocked from the app until Apple's auth service is back. **Acceptable for v2.1** given Apple's typical uptime (99.95%+) and the small user base. Soft-gate fallback would be needed before any wider release; v2.2 work item.

### JWT is invalid / expired mid-session

Any fetch that returns `401 INVALID_JWT`:
1. Attempt silent re-authorize via Apple (`SignInWithApple.authorize()`)
2. If silent re-authorize succeeds → POST /v1/auth/verify with fresh identity token → store new JWT → retry the original request
3. If silent re-authorize fails (user revoked Sign in with Apple in iOS Settings) → `clearUser()` → show sign-in gate

Single retry; no infinite loops. If the gate sign-in also fails, fall back to the "Apple servers down" UX.

### Backend deploys a breaking API change

API versioning protects this: existing `/v1/` paths stay live and stable. A breaking change ships as `/v2/`. Clients on the old binary continue to hit `/v1/` until they update. No client gets a surprise 500 from an unannounced server-side change.

When `/v2/` ships:
- Old clients (using `/v1/`) keep working with the v1 API behavior
- New client builds point at `/v2/`
- `/v1/` is deprecated only when a clean break is safe (typically months later)

### User has the app open while a deploy lands

Workers' atomic deploy means in-flight requests complete against the OLD version; new requests after deploy hit the NEW version. No partial-state.

For schema migrations: apply migration via `wrangler d1 migrations apply` BEFORE the deploy that depends on the new schema. Standard zero-downtime migration discipline: add columns nullable first, deploy code that reads either, then deploy code that writes new schema, then deploy code that no longer reads old schema.

---

## Implementation phases

Each phase is a separate commit train (multiple commits per phase OK). Phases are sequential — Phase B depends on Phase A; Phase C depends on Phase B; Phase D and E can ship in either order after C.

### Phase A — iOS Sign in with Apple integration

**Estimated cost:** half a day.

**Deliverables:**
1. **Apple Developer Portal capability.** Sign in with Apple checked on `com.goallearner.awakened` App ID. Confirm in the entitlements that codemagic.yaml's existing `App.entitlements` step is compatible (likely needs `com.apple.developer.applesignin = ['Default']` added; codemagic step grows by one PlistBuddy line).
2. **Plugin install.** `npm install @capacitor-community/apple-sign-in`. Verify with `npx cap sync ios` post-install.
3. **`#signin-gate` overlay UI.** Mandatory full-screen overlay shown when `getCurrentUser() === null` post-welcome. Two-step flow: Sign in with Apple button → (after success on first sign-in) alias picker.
4. **Auth scaffolding helpers in `app.js`:** `getCurrentUser`, `getJwt`, `clearUser`, `isJwtNearExpiry`, `signInWithApple()` (calls plugin, stubs backend POST with `console.log(identityToken)` for now).
5. **Test:** TestFlight build shows gate; tapping Sign in with Apple completes successfully; identity token logs to Xcode console.
6. **Cache version bump.** All edits to app.js/styles.css/index.html bump their `?v=` query strings. `CACHE_VERSION` bumps in sw.js.

### Phase B — Backend skeleton

**Estimated cost:** 1.5 days.

**Deliverables:**
1. **Repo subfolder:** `/backend/` created with the layout above. Separate `package.json`. `wrangler.toml` configured with D1 binding.
2. **Migration 0001:** initial schema (users + leaderboard_snapshots tables, 3 indexes).
3. **Apple JWKs verification:** `apple-jwks.ts` fetches Apple's public keys (24h cached), verifies identity-token signature, audience, expiration.
4. **Session JWT issuer/verifier:** `session-jwt.ts` issues HS256 JWTs with `iat`, `exp`, `sub: user.id` claims. 90-day lifetime.
5. **Endpoint handlers:** all 4 endpoints implemented. Includes alias validation (length, charset, profanity, uniqueness) and snapshot sanity caps.
6. **Rate limiting:** Workers Rate Limiting API configured per the table above.
7. **Deploy to production.** `wrangler deploy`. Worker is live at the assigned `*.workers.dev` subdomain (or a custom domain if registered).
8. **cURL smoke tests** for all 4 endpoints using a real Apple identity token captured from Phase A's TestFlight build.

### Phase C — Client wiring

**Estimated cost:** 1 day.

**Deliverables:**
1. **Real POST /v1/auth/verify.** Phase A's stubbed-out signInWithApple now actually calls the backend, parses the response, stores JWT in `hb_user`. JWT refresh logic per the auth-flow spec.
2. **`lbSubmitSnapshot()`** implemented in app.js. Wired to app init + visibilitychange + post-autoVerify hooks.
3. **`openLeaderboardRanking()`** replaces mocks with real fetch. Cache load + display, network fetch + update.
4. **`hb_lb_cache` helpers** (`loadLbCache`, `saveLbCache`). Render footer with "Live" / "Last updated Nm ago".
5. **Cleanup:** delete `LB_MOCK_NAMES`, `LB_METRIC_META[].mockTop`, `.lb-rank-row--mock` class, blur filter CSS, "rank pending" footer markup.
6. **TestFlight verification:** sign in, force-pull leaderboard, confirm real entries render; check `hb_lb_cache` persists.

### Phase D — Export / import safety net

**Estimated cost:** half a day.

**Deliverables:**
1. **Settings → Account section UI** added (above or below the existing collapsibles).
2. **`exportBackup()`** function and "Backup my data" button + handler.
3. **`importBackup()`** function and "Restore from backup" button + handler. Includes destructive confirmation modal.
4. **Test:** export → delete app → reinstall → sign in (fresh apple_sub matches; same user is restored on backend side) → import → verify habits/streaks/inventory restored.

### Phase E — Privacy posture

**Estimated cost:** half a day.

**Deliverables:**
1. **Sign out** button + handler.
2. **Delete account** button + handler with destructive confirmation + backend call.
3. **PRIVACY.md** at project root with the new data-collection language.
4. **App Store Connect** privacy nutrition labels updated.
5. **Sign-in gate** privacy policy link wired up.
6. **TestFlight verification:** sign out preserves habits, sign back in restores leaderboard rank, delete account wipes backend rows, fresh sign-in creates new identity.

### Total estimated cost

~3.5 days end-to-end, focused. Each phase commits independently; the v2.1 marketing version bump happens at the end of Phase E (or whenever the train is ready for App Store submission).

---

## Open questions (resolve before Phase A starts)

### 1. Apple Services ID — separate or reuse bundle ID?

**Recommendation:** reuse the bundle ID `com.goallearner.awakened` as the audience claim. Do NOT create a separate Services ID.

**Reasoning:** Services IDs are required when you implement Sign in with Apple on the WEB (Sign in with Apple JS) or via server-to-server flows from a non-iOS-app client. v2.1's only client is the iOS app, talking to the backend via REST. The native iOS plugin produces identity tokens with `aud` set to the bundle ID — verifying against the bundle ID at the backend is the canonical pattern.

**When Services ID becomes required:** if v2.x ships a web sign-in flow (e.g., a Manage Account page on awakened.netlify.app where users can edit their alias or download their data without the iOS app), or an Android app, or any non-iOS auth surface. At that point: create a Services ID `com.goallearner.awakened.web` (the `.web` suffix convention is Apple's recommendation) and update the backend to accept identity tokens with EITHER audience claim.

**Action item:** none for v2.1. Proceed with bundle-ID audience.

### 2. Alias collision — last-write-wins / suffix / reject?

**Recommendation:** **REJECT** with a `409 ALIAS_TAKEN` response; client re-prompts the user to pick a different alias.

**Reasoning:**
- Last-write-wins is hostile to existing users. "TopDog" went to bed at rank 1; wakes up to find their alias overwritten by a stranger and their rank attributed to that stranger. Undermines the discipline-trust narrative.
- Auto-suffix ("TopDog2", "TopDog3") is mildly hostile to new users. They picked a name they liked; the system silently renames them. Better to surface the conflict and let them choose.
- Reject is OSRS-authentic — every popular game has a unique-username system. Users understand the model.

**Implementation:**
- Case-insensitive uniqueness (via `UNIQUE INDEX ON LOWER(alias)`)
- 409 response with helpful body: `{ error: 'ALIAS_TAKEN', suggested: ['TopDog42', 'TopDog_X'] }` — server suggests 2–3 random-suffix variants the client can offer as quick-tap alternatives
- Client UI: shows the error inline, lists the suggestions as tappable chips, lets user type a new name

**Action item:** confirm with Richie that "reject + suggest" is the right UX. If they prefer auto-suffix-on-server, simpler implementation; doc decision before Phase B.

### 3. Profanity filter — server-side or client-side? Library or hand-rolled?

**Recommendation:** **server-side, simple hand-rolled blocklist**, ~50–100 entries covering English-language slurs and obvious obscenities. Can be upgraded to a library later if international coverage matters.

**Reasoning:**
- **Server-side is non-negotiable.** Client-side filtering can be trivially bypassed (modify localStorage, intercept fetch, etc.). Server is the source of truth for whether an alias is acceptable.
- **Hand-rolled blocklist beats libraries for v2.1.** Libraries like `bad-words` ship hundreds of regex matchers + locale variants + leetspeak — overkill for a private-beta TestFlight rollout. A static array of strings, normalized lowercase + leet-substituted (`@→a`, `0→o`, `1→i`, `3→e`, `$→s`), matched against the candidate alias, is fast and good enough.
- **Client-side pre-validation** is a UX nicety. Add a 200ms-debounced client-side check against a stripped subset of the blocklist (`['admin', 'mod', 'bot', ...obvious]`) so the user gets instant "name taken" feedback during typing — without having to hit the server every keystroke. Server has final say.

**Action item:** Phase B includes a static `BLOCKLIST` array in `backend/src/profanity.ts`. Curate before deploy. Acceptable to ship a small list and grow it as misuse is reported.

### 4. Alias case normalization — preserved for whom?

**Recommendation:** lowercase everyone EXCEPT a hardcoded `PRESERVED_CASE_SUBS` set. v2.1 launch: exactly one entry — Richie's Apple `sub`. See the locked design in the "Alias normalization" subsection of the Auth flow section.

**Reasoning:** distinctive founder signature on the leaderboard at zero engineering cost. Forces a cohesive lowercase community aesthetic on everyone else. OSRS-authentic distinguishing mark via casing rather than a separate verified-badge UI.

**Tradeoffs accepted:**
- Other users lose expressive capitalization (CamelCase, ProperNouns). They retain `_` and `-` as separators.
- Doesn't scale to multi-admin without code change. Acceptable for v2.1 (solo developer). v2.2 can swap the hardcoded set for an `is_admin` column on `users` if grants need to be revocable/expandable without redeploys.
- Some users may notice the asymmetry. The casing IS the signal — same model as devs/staff in OSRS leaderboards. No UI work needed to explain it.

**Action item:** Phase B includes `backend/src/aliasNormalize.ts` with the locked `normalizeAlias(alias, appleSub)` function. `RICHIE_APPLE_SUB` secret must be set before `/v1/auth/verify` deploys — captured from Phase A TestFlight build's `hb_user.sub` in Safari Web Inspector against the device.

---

## Deferred to v2.2+

Listed here for completeness so Phase A–E implementation doesn't accidentally drift into them:

- **Friends list / following.** Requires schema additions (`friendships(user_a, user_b, status, created_at)`) + invitation flow + privacy controls. Standalone feature, not a leaderboard extension.
- **Friend-only leaderboards.** Same data, different query. Depends on friends.
- **Server-driven push notifications.** "You got passed in ranking!" / "Friend X just hit a new best." Requires Apple Push Notification service registration + device-token storage + push-service worker in the backend. Substantial Phase work.
- **Anti-cheat / server-side HealthKit verification.** Apple's HealthKit data is locally signed but exposing the signature for server verification is a research project. For v2.1, sanity caps catch obvious garbage; persistent fraud is acceptable risk at the discipline-app scale.
- **Time-windowed leaderboards.** Weekly resets ("this week's top sleepers"), monthly resets, seasonal competitions. Different data model (snapshots over time instead of point-in-time best).
- **Regional / country / age-bracket breakdowns.** Requires opt-in collection of region/age + segmented queries.
- **Cosmetic flexes / equip-on-public-profile / card showcase.** Phase 3 of the drops system per EQUIPMENT.md. Depends on having public profiles, which depends on the leaderboard backend.
- **Automatic cloud sync of full state.** Real multi-device sync. Hugely valuable but a separate engineering effort. v2.1 ships the export button as the manual mitigation.
- **Server-to-server Apple notification webhook** (account-revocation events). Acknowledged at the framework level. Without it, a user who revokes Sign in with Apple in iOS Settings + reinstalls would create a new backend account. Minor edge case, deferred.
- **Soft-prompt sign-in.** If install→activation telemetry shows the mandatory gate hurting conversion at v2.1's wider release, add a "Skip for now" path that disables leaderboard + cloud features but allows local-only use.
- **Account migration to a different Apple ID.** If a user wants to move their backend identity from one Apple ID to another. Defer; account-deletion + fresh sign-in is the manual workaround.
- **Email / Google / GitHub / non-Apple auth.** Schema is already future-proof (internal-UUID PK; auth-provider columns are nullable). Implementation deferred.

---

## Changelog

- **v1.1 (May 11, 2026, evening)** — Phase A iOS-side shipped to TestFlight (build 50, commit `630bbe6`). Codemagic auto-signing turned out to be broken for our Sign in with Apple capability — provisioning profiles auto-generated by Codemagic's API path omit the `com.apple.developer.applesignin` entitlement even when the App ID is correctly configured. After 8 build cycles diagnosing layers (CocoaPods deployment target → stale profile cache → Apple primary App ID config → cert-key env var availability → direct profile inspection), pivoted to MANUAL signing in codemagic.yaml using uploaded cert (`awakened-distribution`) + uploaded profile (`awakened-app-store-manual`). Manual signing is bulletproof and stays as the project's signing model going forward.
  - **NEW design decision:** alias case normalization. All usernames forced lowercase server-side EXCEPT for an allowlist of preserved-case Apple subs (`PRESERVED_CASE_SUBS`). v2.1 launch allowlist: exactly one entry, Richie's. New `normalizeAlias(alias, appleSub)` function called inside `/v1/auth/verify` before validation. New `RICHIE_APPLE_SUB` secret added to the v2.1 minimum secrets list. Captured from Phase A TestFlight via `JSON.parse(localStorage.getItem('hb_user')).sub` once Richie signs in to build 50.
- **v1.0 (May 11, 2026, afternoon)** — Initial design doc. Five-phase implementation plan for Sign in with Apple + Cloudflare Workers + D1 + leaderboard endpoints + JSON export/import + privacy posture. Decisions locked: mandatory sign-in gate at first launch, internal-UUID PK with Apple sub as UNIQUE FK, 90-day JWT lifetime with silent-refresh-via-Apple, case-insensitive unique alias with reject-and-suggest collision strategy, server-side hand-rolled profanity blocklist. Cross-device sync explicitly deferred to v2.2; export/import is the v2.1 mitigation.

---

*End of v1.1 design. Phase A is on TestFlight. Build Phase B sequentially through E. The doc is the source of truth — re-read the relevant phase section at kickoff to prevent mid-build drift.*
