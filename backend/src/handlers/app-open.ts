/**
 * POST /v1/users/me/app-open — record that the caller opened the app today.
 *
 * Per-user retention tracking (owner-requested; see migration 0027_app_opens).
 * Append-light: a single UPSERT of one row per (user, UTC day), so repeated
 * foregrounds the same day touch the same row. Fire-and-forget on the client —
 * NO reads on the hot path, returns 200 immediately, idempotent.
 *
 * W834 (Train 3, G2) — the request body is now READ (it was ignored):
 *   { build?: string, events?: [{ e: string, d?: string }] }
 *   - build → app_opens.build (the day-row keeps the latest non-null value).
 *     Latest-row build per user powers the R1b Monday-push version gate.
 *   - events → funnel_events (≤10 per call, name/detail clamped, 90-day
 *     inline self-prune). The response carries events_accepted so the client
 *     only clears its local queue for events that actually landed — a
 *     rate-limited call reports 0 and the client retries on the next ping.
 * A missing/malformed body stays a plain lifecycle ping (never an error).
 *
 * Auth: required. user_id is ALWAYS the verified session `sub`; clients cannot
 * specify or override it (date_utc is derived server-side from the Worker clock,
 * not from the request body, so the table can't be back/forward-dated by a client).
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk } from '../lib/responses';

const EVENTS_MAX_PER_CALL = 10;
const EVENT_NAME_RE = /^[a-z0-9_.-]{1,40}$/i;
const FUNNEL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function clamp(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > max ? t.slice(0, max) : t;
}

export async function handleAppOpenPost(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  // Cheap throttle. The day's row already exists after the first call, so
  // dropping bursts is correct — and we return 200 either way (this is a
  // fire-and-forget lifecycle ping; we never want a metrics write to surface
  // an error to the app). Throttled calls accept no events (events_accepted: 0
  // tells the client to hold them for the next ping).
  const rl = await env.RL_APP_OPEN.limit({ key: session.userId });
  if (!rl.success) {
    return jsonOk({ ok: true, deduped: true, events_accepted: 0 });
  }

  // Tolerant body parse — the pre-W834 client sends no body at all.
  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const build = clamp(body?.build, 40);

  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const dateUtc = new Date(nowSec * 1000).toISOString().slice(0, 10); // 'YYYY-MM-DD' (UTC)

  await env.DB.prepare(
    `INSERT INTO app_opens (user_id, opened_at, date_utc, build)
       VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, date_utc) DO UPDATE SET
       opened_at = excluded.opened_at,
       build     = COALESCE(excluded.build, app_opens.build)`,
  )
    .bind(session.userId, nowSec, dateUtc, build)
    .run();

  // ── W834 — funnel events (optional, batched) ──
  let accepted = 0;
  const rawEvents = body && Array.isArray(body.events) ? body.events : [];
  if (rawEvents.length > 0) {
    const stmts = [];
    for (const raw of rawEvents.slice(0, EVENTS_MAX_PER_CALL)) {
      const r = raw as Record<string, unknown> | null;
      const name = clamp(r?.e, 40);
      if (!name || !EVENT_NAME_RE.test(name)) continue; // skip junk, accept the rest
      const detail = clamp(r?.d, 200);
      stmts.push(
        env.DB.prepare(
          'INSERT INTO funnel_events (user_id, created_at, event, detail, build) VALUES (?, ?, ?, ?, ?)',
        ).bind(session.userId, nowMs, name, detail, build),
      );
    }
    if (stmts.length > 0) {
      // Self-bounding retention, same posture as client_errors: inline so the
      // table can never outgrow the window even if crons stall.
      stmts.push(
        env.DB.prepare('DELETE FROM funnel_events WHERE created_at < ?').bind(
          nowMs - FUNNEL_RETENTION_MS,
        ),
      );
      await env.DB.batch(stmts);
      accepted = stmts.length - 1; // minus the prune
    }
  }

  return jsonOk({ ok: true, date_utc: dateUtc, events_accepted: accepted });
}
