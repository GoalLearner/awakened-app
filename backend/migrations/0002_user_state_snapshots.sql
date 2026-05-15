-- 0002_user_state_snapshots.sql
-- Cloud Sync v1 (v3 Phase 1w).
--
-- Adds the per-user state snapshot table that powers
-- GET /v1/users/me/state + POST /v1/users/me/state.
--
-- One row per user. The client POSTs a single JSON snapshot of all
-- allowlisted localStorage keys; the backend stores it as text. No
-- field-level decomposition in v1 — the snapshot stays opaque to the
-- backend so client schema changes don't require backend migrations.
--
-- Apply to remote (Cloudflare-side) D1:
--   wrangler d1 execute awakened-db --remote \
--     --file=migrations/0002_user_state_snapshots.sql
--
-- Local dry-run:
--   wrangler d1 execute awakened-db --local \
--     --file=migrations/0002_user_state_snapshots.sql
--
-- Migration discipline (same as 0001): NEVER edit after applying. Add
-- 0003_*.sql for any subsequent schema changes.

CREATE TABLE user_state_snapshots (
  -- FK-style reference to users.id. Not enforced as a real FK so
  -- the same delete cascade can happen via /v1/account/delete code
  -- path (single source of truth for "delete account").
  user_id            TEXT PRIMARY KEY,

  -- Opaque JSON blob — the client's snapshot envelope. Backend
  -- never parses past the top-level metadata fields below; that's
  -- by design so client schema can evolve without backend deploys.
  -- Expected envelope:
  --   {
  --     "version": 1,
  --     "appVersion": "2.2.0",
  --     "createdAt": "2026-05-14T20:10:00.000Z",
  --     "localDate": "2026-05-14",
  --     "keys": { "hb_habits": "...", "hb_completions": "...", ... }
  --   }
  state_json         TEXT NOT NULL,

  -- Snapshot envelope version. Starts at 1. Bump when the client-
  -- side allowlist or envelope shape changes in a backwards-
  -- incompatible way.
  state_version      INTEGER NOT NULL DEFAULT 1,

  -- App version that created the snapshot (e.g. "2.2.0"). Stored
  -- for diagnostics; backend doesn't gate on it.
  app_version        TEXT,

  -- Client-side timestamp at the moment the snapshot was built.
  -- Used for conflict detection — server compares this against the
  -- previous client_updated_at to decide if the upload is stale.
  -- ISO 8601 string (client sends new Date().toISOString()).
  client_updated_at  TEXT NOT NULL,

  -- Server-side timestamp set by the backend at upsert time. Unix
  -- epoch ms (matches the timestamp convention used by users +
  -- leaderboard_snapshots tables).
  server_updated_at  INTEGER NOT NULL,

  -- Opaque device identifier the client may send for diagnostics
  -- ("which device wrote this?"). Backend never indexes or
  -- enforces uniqueness. v1 stores it; future v2 multi-device
  -- merge logic may use it.
  device_id          TEXT,

  -- Optional client-computed checksum (e.g. SHA-256 hex) of the
  -- state_json payload. Backend stores but does NOT verify in v1 —
  -- it's a debugging aid for "did the upload land intact?". v2
  -- may add server-side recomputation as integrity gate.
  checksum           TEXT
);

-- No additional indexes — user_id is the primary key and the only
-- lookup pattern in v1 (handler does WHERE user_id = ?).
