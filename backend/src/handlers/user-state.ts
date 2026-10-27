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
// can't fill D1 with multi-megabyte states.
// W1076 — 1 MB (was 512 KB). The snapshot carries the whole completion history by design
// (never pruned), and the heaviest hunter on record was at 247 KB after five months: 512 KB
// was about a year and a half away for a 40-vow hunter, after which every backup failed
// silently. D1 allows 2 MB per row. The client may also send the save gzip-encoded
// (X-State-Encoding: gzip), which is decoded here and measured after decoding.
const MAX_PAYLOAD_BYTES = 1024 * 1024;

// W1101 — a phone that started over must not replace a backup holding far more history. A
// reinstall that tapped Cancel on the restore prompt uploaded its fresh state on its next
// change, and the backup it replaced was the only copy (Zynfandel, 3.0.16, 2026-10-26).
// An upload from a DIFFERENT device than the one that made the backup, carrying more than a
// week less history, is refused while that backup is under two weeks old. The hunter can
// still restore it from Settings, and a restore brings back the backup's device id, so the
// next upload passes. Uploads from the backup's own device are never refused. Reset all
// progress makes a new device id; from W1102 its first save says fresh_start and is taken
// (older apps go without a backup until the old one is two weeks old).
const RICHER_MARGIN_DAYS = 7;
const RICHER_HOLD_MS = 14 * 24 * 60 * 60 * 1000;

/** Distinct days in a save's completion history: the hot blob plus its archived month chunks. */
export function historyDays(state: unknown): number {
  const keys = state && typeof state === 'object' ? (state as { keys?: unknown }).keys : null;
  if (!keys || typeof keys !== 'object') return 0;
  const days = new Set<string>();
  for (const [k, v] of Object.entries(keys as Record<string, unknown>)) {
    if ((k !== 'hb_completions' && !k.startsWith('hb_completions_arch_')) || typeof v !== 'string') continue;
    try {
      const o = JSON.parse(v);
      if (o && typeof o === 'object' && !Array.isArray(o)) for (const d of Object.keys(o)) days.add(d);
    } catch { /* an unreadable chunk counts nothing */ }
  }
  return days.size;
}

/** W1076 — gunzip a buffer, refusing anything that inflates past `max` bytes. */
async function gunzipCapped(raw: ArrayBuffer, max: number): Promise<string> {
  const stream = new Response(raw).body!.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* done with it */ }
      throw new Error('INFLATED_TOO_LARGE');
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

interface PostBody {
  state_version?: unknown;
  app_version?: unknown;
  client_updated_at?: unknown;
  device_id?: unknown;
  checksum?: unknown;
  state?: unknown;
  fresh_start?: unknown;   // W1102 — Reset all progress: replace the backup on purpose
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
    if ((request.headers.get('X-State-Encoding') || '').toLowerCase() === 'gzip') {
      const text = await gunzipCapped(await request.arrayBuffer(), MAX_PAYLOAD_BYTES + 256 * 1024);
      body = JSON.parse(text) as PostBody;
    } else {
      body = (await request.json()) as PostBody;
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'INFLATED_TOO_LARGE') {
      return jsonError(413, 'PAYLOAD_TOO_LARGE', `Snapshot exceeds ${MAX_PAYLOAD_BYTES} bytes.`);
    }
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
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

  // W1040 — the three envelope strings were stored at any length; clamp them.
  const appVersion = typeof body.app_version === 'string' ? body.app_version.slice(0, 40) : null;
  const deviceId = typeof body.device_id === 'string' ? body.device_id.slice(0, 128) : null;
  const checksum = typeof body.checksum === 'string' ? body.checksum.slice(0, 128) : null;

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

  // W1076 — an unchanged save (same checksum as the stored row) only stamps the time: the
  // client pushes the whole snapshot on every cold launch, and most of those carried nothing
  // new. One small UPDATE instead of rewriting a blob of up to a megabyte.
  if (checksum) {
    try {
      const same = await env.DB.prepare(
        'UPDATE user_state_snapshots SET server_updated_at = ? WHERE user_id = ? AND checksum = ?',
      ).bind(now, session.userId, checksum).run();
      if (same.meta && Number(same.meta.changes) >= 1) {
        return jsonOk({
          state_version: stateVersion,
          client_updated_at: clientUpdatedAt,
          server_updated_at: new Date(now).toISOString(),
          bytes: stateJson.length,
          unchanged: true,
        });
      }
    } catch (err) {
      console.error('user-state checksum short-circuit failed (saving in full):', err instanceof Error ? err.message : err);
    }
  }

  // W1101 — keep a richer backup made on another device (see RICHER_MARGIN_DAYS). Any error
  // here saves as before: the guard must never be what stops a backup.
  if (deviceId && body.fresh_start !== true) {
    try {
      const prev = await env.DB.prepare(
        'SELECT device_id, server_updated_at FROM user_state_snapshots WHERE user_id = ?',
      ).bind(session.userId).first<{ device_id: string | null; server_updated_at: number }>();
      if (prev && prev.device_id && prev.device_id !== deviceId && now - Number(prev.server_updated_at) < RICHER_HOLD_MS) {
        const blob = await env.DB.prepare(
          'SELECT state_json FROM user_state_snapshots WHERE user_id = ?',
        ).bind(session.userId).first<{ state_json: string }>();
        const stored = blob ? historyDays(JSON.parse(blob.state_json)) : 0;
        if (stored > historyDays(body.state) + RICHER_MARGIN_DAYS) {
          return jsonError(409, 'CLOUD_RICHER', 'The backup holds more history than this device. Restore it from Settings.');
        }
      }
    } catch (err) {
      console.error('user-state richer-backup check failed (saving):', err instanceof Error ? err.message : err);
    }
  }

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

  // ── Vertical Jump Program (migration 0028) — mirror the client's
  // onboarding-goal flag into the queryable users.onboarding_goal column so
  // cohort counts (the FITxVERT proxy metric) never require parsing the JSON
  // blob. collectState() stores raw localStorage strings under state.keys.
  // Best-effort: absent on old clients -> leave the column at its default.
  // Never fatal — the snapshot already persisted above.
  try {
    const st = body.state as { keys?: Record<string, unknown> } | null;
    const raw = st && st.keys ? st.keys['hb_onboarding_goal'] : undefined;
    if (raw === 'jump_program' || raw === 'default') {
      await env.DB.prepare(
        'UPDATE users SET onboarding_goal = ?, updated_at = ? WHERE id = ?',
      )
        .bind(raw, now, session.userId)
        .run();
    }
  } catch {
    // non-fatal: the goal mirror can catch up on the next sync.
  }

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
