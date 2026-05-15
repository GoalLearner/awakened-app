/**
 * GET  /v1/users/me/state — fetch the caller's cloud backup
 * POST /v1/users/me/state — upsert the caller's cloud backup
 *
 * Cloud Sync v1 (v3 Phase 1w). Backup-and-restore layer for the
 * full client localStorage state. Backend stores the snapshot
 * envelope as opaque JSON — the client owns the schema.
 *
 * Auth: required. user_id is always derived from the verified
 * session JWT; clients cannot specify or override it.
 *
 * BACKEND.md §8.6 (added v3 Phase 1w).
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

// Hard cap on payload size so a misbehaving (or malicious) client
// can't fill D1 with multi-megabyte states. ~500 KB is roughly 10×
// the largest realistic Awakened snapshot (habit history + boss
// state + inventory rarely exceeds 50 KB). Keep it loose enough
// that v1.x growth doesn't trip it but tight enough that abuse
// trips immediately.
const MAX_PAYLOAD_BYTES = 512 * 1024;

interface PostBody {
  state_version?: unknown;
  app_version?: unknown;
  client_updated_at?: unknown;
  device_id?: unknown;
  checksum?: unknown;
  state?: unknown;
}

interface SnapshotRow {
  state_json: string;
  state_version: number;
  app_version: string | null;
  client_updated_at: string;
  server_updated_at: number;
  device_id: string | null;
  checksum: string | null;
}

// ─────────────────────────────────────────────────────────────
// GET /v1/users/me/state
// ─────────────────────────────────────────────────────────────
export async function handleUserStateGet(
  _request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_USER_STATE_GET.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(
      429,
      'RATE_LIMITED',
      'Too many state fetches. Try again in a minute.',
    );
  }

  const row = await env.DB.prepare(
    `SELECT state_json, state_version, app_version,
            client_updated_at, server_updated_at, device_id, checksum
       FROM user_state_snapshots
      WHERE user_id = ?`,
  )
    .bind(session.userId)
    .first<SnapshotRow>();

  if (!row) {
    return jsonOk({ exists: false });
  }

  // state_json is stored as text. Parse defensively — if D1 hands
  // back corrupt JSON for any reason, treat as "no usable backup"
  // rather than 500ing. Client falls back to "no cloud state".
  let state: unknown;
  try {
    state = JSON.parse(row.state_json);
  } catch {
    return jsonOk({ exists: false, reason: 'CORRUPT' });
  }

  return jsonOk({
    exists: true,
    state_version: row.state_version,
    app_version: row.app_version ?? null,
    client_updated_at: row.client_updated_at,
    server_updated_at: new Date(row.server_updated_at).toISOString(),
    device_id: row.device_id ?? null,
    checksum: row.checksum ?? null,
    state,
  });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/users/me/state
// ─────────────────────────────────────────────────────────────
export async function handleUserStatePost(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_USER_STATE_POST.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(
      429,
      'RATE_LIMITED',
      'Too many state uploads. Try again in a minute.',
    );
  }

  // Size guard. Content-Length is advisory; we also re-measure after
  // parsing for the actual case where headers lie.
  const contentLengthHeader = request.headers.get('Content-Length');
  if (contentLengthHeader) {
    const advertised = Number(contentLengthHeader);
    if (Number.isFinite(advertised) && advertised > MAX_PAYLOAD_BYTES) {
      return jsonError(
        413,
        'PAYLOAD_TOO_LARGE',
        `Snapshot exceeds ${MAX_PAYLOAD_BYTES} bytes.`,
      );
    }
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object') {
    return jsonError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }

  // ── Validate envelope fields ──
  const stateVersion = body.state_version;
  if (!Number.isInteger(stateVersion) || (stateVersion as number) < 1) {
    return jsonError(400, 'INVALID_STATE_VERSION', 'state_version must be a positive integer.');
  }

  const clientUpdatedAt = body.client_updated_at;
  if (typeof clientUpdatedAt !== 'string' || clientUpdatedAt.length === 0) {
    return jsonError(400, 'INVALID_TIMESTAMP', 'client_updated_at is required (ISO 8601 string).');
  }
  // Loose ISO 8601 sanity check. Date.parse rejects most malformed
  // input; we don't try to validate the full grammar.
  if (Number.isNaN(Date.parse(clientUpdatedAt))) {
    return jsonError(400, 'INVALID_TIMESTAMP', 'client_updated_at is not a valid ISO 8601 string.');
  }

  const appVersion = typeof body.app_version === 'string' ? body.app_version : null;
  const deviceId = typeof body.device_id === 'string' ? body.device_id : null;
  const checksum = typeof body.checksum === 'string' ? body.checksum : null;

  if (body.state === undefined || body.state === null) {
    return jsonError(400, 'INVALID_STATE', 'state field is required (object).');
  }
  if (typeof body.state !== 'object') {
    return jsonError(400, 'INVALID_STATE', 'state must be a JSON object.');
  }

  // Re-serialize the state object — guards against the client sending
  // through unexpected types (functions, etc.) by round-tripping.
  let stateJson: string;
  try {
    stateJson = JSON.stringify(body.state);
  } catch {
    return jsonError(400, 'INVALID_STATE', 'state could not be serialized to JSON.');
  }
  if (stateJson.length > MAX_PAYLOAD_BYTES) {
    return jsonError(
      413,
      'PAYLOAD_TOO_LARGE',
      `Serialized state exceeds ${MAX_PAYLOAD_BYTES} bytes.`,
    );
  }

  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO user_state_snapshots
       (user_id, state_json, state_version, app_version,
        client_updated_at, server_updated_at, device_id, checksum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       state_json        = excluded.state_json,
       state_version     = excluded.state_version,
       app_version       = excluded.app_version,
       client_updated_at = excluded.client_updated_at,
       server_updated_at = excluded.server_updated_at,
       device_id         = excluded.device_id,
       checksum          = excluded.checksum`,
  )
    .bind(
      session.userId,
      stateJson,
      stateVersion,
      appVersion,
      clientUpdatedAt,
      now,
      deviceId,
      checksum,
    )
    .run();

  return jsonOk({
    state_version: stateVersion,
    client_updated_at: clientUpdatedAt,
    server_updated_at: new Date(now).toISOString(),
    bytes: stateJson.length,
  });
}

// ─────────────────────────────────────────────────────────────
// DELETE side-effect helper — called from /v1/account/delete so
// the snapshot is wiped alongside the user + leaderboard rows.
// Exported for the account-delete handler to call. Idempotent.
// ─────────────────────────────────────────────────────────────
export async function deleteUserStateSnapshot(
  env: Env,
  userId: string,
): Promise<void> {
  await env.DB.prepare('DELETE FROM user_state_snapshots WHERE user_id = ?')
    .bind(userId)
    .run();
}
