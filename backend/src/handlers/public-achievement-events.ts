/**
 * Public achievement events handler (v3 Phase 1z.200).
 *
 *   POST /v1/users/me/public-achievement-events
 *     - Authenticated. Batch write of 1–10 allowlisted public
 *       events. The backend NEVER recomputes event labels — every
 *       label is preformatted client-side under a strict per-type
 *       regex. Duplicates collapse via UNIQUE (user_id,
 *       client_event_id) + ON CONFLICT DO NOTHING.
 *
 *   GET /v1/friends/activity?limit=30
 *     - Authenticated. Returns newest events across accepted
 *       friends + the viewer themselves, joined to alias +
 *       rankLabel so the client can render in one roundtrip.
 *       Strangers, pending requests, and removed users are
 *       excluded. user_id, client_event_id, metadata_json, and
 *       rank_points are NEVER returned.
 *
 * Allowed event types in v1 (locked in 1z.199 audit):
 *
 *   boss_kill            "defeated The Glass Strider"
 *   rank_up              "reached D II"
 *   step_milestone_bucket "crossed 10,000 steps today"  ← BUCKETED
 *
 * Hard-rejected in v1:
 *
 *   ultra_rare_drop  → defer; leaks loot identity
 *   card_drop        → too frequent; defer entirely
 *   sleep_quality_7h → health-sensitive; defer
 *   habit_streak     → leaks habit names; defer
 *   friend_added     → roster event, not an achievement
 *   "crossed 15,319 steps today" → exact step counts NEVER allowed
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

const ALLOWED_EVENT_TYPES = ['boss_kill', 'rank_up', 'step_milestone_bucket'] as const;
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number];

const ALLOWED_BOSS_RANKS  = ['E', 'D', 'C', 'B', 'A', 'S', 'S+'] as const;

// Label regex allowlists. Tight on purpose — every label is
// client-preformatted under the same rules we expect at submit
// time, so a leak vector via free-text labels is impossible.
const RE_BOSS_KILL_LABEL    = /^defeated [A-Za-z0-9 '\-]+$/;
const RE_RANK_UP_LABEL      = /^reached (E|D|C|B|A|S|S\+)( III| II| I)?$/;
const RE_STEP_BUCKET_LABEL  = /^crossed (10,000|20,000|30,000|40,000|50,000|60,000|70,000|80,000|90,000|100,000) steps today$/;

const ALLOWED_STEP_BUCKETS = new Set([10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000]);

const EVENT_KEY_RE         = /^[A-Za-z0-9_\-]+$/;
const CLIENT_EVENT_ID_RE   = /^[A-Za-z0-9_:\-]+$/;

const MAX_BATCH_SIZE       = 10;
const MIN_BATCH_SIZE       = 1;
const MAX_EVENT_KEY_LEN    = 64;
const MAX_CLIENT_EVENT_ID  = 128;
const MAX_LABEL_LEN        = 200;

// Time bounds for clientCreatedAt. 7 days back is enough for the
// client to retry / backfill after a deploy; 5 minutes ahead
// allows for normal clock skew between device and server.
const STALE_MAX_AGE_MS     = 7 * 24 * 60 * 60 * 1000;
const FUTURE_MAX_SKEW_MS   = 5 * 60 * 1000;

const RANK_SORT_VALUE_MAX  = 6_999_999_999;
const BOSS_KILL_COUNT_MAX  = 999_999;

// Default + bounds for the friend-feed read query.
const FEED_DEFAULT_LIMIT   = 30;
const FEED_MIN_LIMIT       = 1;
const FEED_MAX_LIMIT       = 50;

interface RawEvent {
  eventType?: unknown;
  eventKey?: unknown;
  eventLabel?: unknown;
  eventValue?: unknown;
  rarity?: unknown;
  clientEventId?: unknown;
  clientCreatedAt?: unknown;
}

interface ValidEvent {
  eventType:        AllowedEventType;
  eventKey:         string;
  eventLabel:       string;
  eventValue:       number | null;
  rarity:           string | null;
  clientEventId:    string;
  clientCreatedAt:  string;
}

interface PostBody {
  events?: unknown;
}

function isInt(v: unknown, min: number, max: number): v is number {
  return (
    typeof v === 'number'
    && Number.isFinite(v)
    && Number.isInteger(v)
    && v >= min
    && v <= max
  );
}

function isAllowedType(v: unknown): v is AllowedEventType {
  return typeof v === 'string' && (ALLOWED_EVENT_TYPES as readonly string[]).includes(v);
}

function validateEvent(
  raw: RawEvent,
  now: number,
):
  | { ok: true; value: ValidEvent }
  | { ok: false; code: string; detail: string } {
  if (!isAllowedType(raw.eventType)) {
    return {
      ok: false,
      code: 'INVALID_EVENT_TYPE',
      detail: `eventType must be one of ${ALLOWED_EVENT_TYPES.join(', ')}.`,
    };
  }
  const eventType = raw.eventType;

  if (typeof raw.eventKey !== 'string'
      || raw.eventKey.length === 0
      || raw.eventKey.length > MAX_EVENT_KEY_LEN
      || !EVENT_KEY_RE.test(raw.eventKey)) {
    return {
      ok: false,
      code: 'INVALID_EVENT_KEY',
      detail: `eventKey must be 1..${MAX_EVENT_KEY_LEN} chars matching [A-Za-z0-9_-].`,
    };
  }
  const eventKey = raw.eventKey;

  if (typeof raw.eventLabel !== 'string'
      || raw.eventLabel.length === 0
      || raw.eventLabel.length > MAX_LABEL_LEN) {
    return {
      ok: false,
      code: 'INVALID_EVENT_LABEL',
      detail: 'eventLabel must be a non-empty string.',
    };
  }
  const eventLabel = raw.eventLabel;

  if (typeof raw.clientEventId !== 'string'
      || raw.clientEventId.length === 0
      || raw.clientEventId.length > MAX_CLIENT_EVENT_ID
      || !CLIENT_EVENT_ID_RE.test(raw.clientEventId)) {
    return {
      ok: false,
      code: 'INVALID_CLIENT_EVENT_ID',
      detail: `clientEventId must be 1..${MAX_CLIENT_EVENT_ID} chars matching [A-Za-z0-9_:\\-].`,
    };
  }
  const clientEventId = raw.clientEventId;

  if (typeof raw.clientCreatedAt !== 'string') {
    return {
      ok: false,
      code: 'INVALID_CLIENT_CREATED_AT',
      detail: 'clientCreatedAt must be an ISO string.',
    };
  }
  const ts = Date.parse(raw.clientCreatedAt);
  if (!Number.isFinite(ts)) {
    return {
      ok: false,
      code: 'INVALID_CLIENT_CREATED_AT',
      detail: 'clientCreatedAt must be a valid ISO timestamp.',
    };
  }
  if (now - ts > STALE_MAX_AGE_MS) {
    return {
      ok: false,
      code: 'EVENT_STALE',
      detail: 'clientCreatedAt is older than 7 days.',
    };
  }
  if (ts - now > FUTURE_MAX_SKEW_MS) {
    return {
      ok: false,
      code: 'EVENT_FUTURE',
      detail: 'clientCreatedAt is more than 5 minutes in the future.',
    };
  }
  const clientCreatedAt = raw.clientCreatedAt;

  // Per-type label + value + rarity validation.
  let eventValue: number | null = null;
  let rarity: string | null = null;

  if (eventType === 'boss_kill') {
    if (!RE_BOSS_KILL_LABEL.test(eventLabel)) {
      return { ok: false, code: 'INVALID_EVENT_LABEL', detail: 'boss_kill label must match "defeated <bossName>".' };
    }
    if (!isInt(raw.eventValue, 1, BOSS_KILL_COUNT_MAX)) {
      return { ok: false, code: 'INVALID_EVENT_VALUE', detail: `boss_kill eventValue must be integer in [1, ${BOSS_KILL_COUNT_MAX}].` };
    }
    eventValue = raw.eventValue;
    if (typeof raw.rarity !== 'string' || !(ALLOWED_BOSS_RANKS as readonly string[]).includes(raw.rarity)) {
      return { ok: false, code: 'INVALID_RARITY', detail: 'boss_kill rarity must be one of E, D, C, B, A, S, S+.' };
    }
    rarity = raw.rarity;
  } else if (eventType === 'rank_up') {
    if (!RE_RANK_UP_LABEL.test(eventLabel)) {
      return { ok: false, code: 'INVALID_EVENT_LABEL', detail: 'rank_up label must match "reached <tier>[ <division>]".' };
    }
    if (raw.eventValue === null || raw.eventValue === undefined) {
      eventValue = null;
    } else if (isInt(raw.eventValue, 0, RANK_SORT_VALUE_MAX)) {
      eventValue = raw.eventValue;
    } else {
      return { ok: false, code: 'INVALID_EVENT_VALUE', detail: `rank_up eventValue must be null or integer in [0, ${RANK_SORT_VALUE_MAX}].` };
    }
    if (raw.rarity !== undefined && raw.rarity !== null) {
      return { ok: false, code: 'INVALID_RARITY', detail: 'rank_up rarity must be null.' };
    }
    rarity = null;
  } else {
    // step_milestone_bucket
    if (!RE_STEP_BUCKET_LABEL.test(eventLabel)) {
      return { ok: false, code: 'INVALID_EVENT_LABEL', detail: 'step_milestone_bucket label must match the bucket allowlist.' };
    }
    if (!isInt(raw.eventValue, 10000, 100000) || !ALLOWED_STEP_BUCKETS.has(raw.eventValue)) {
      return { ok: false, code: 'INVALID_EVENT_VALUE', detail: 'step_milestone_bucket eventValue must be one of the allowlisted bucket integers.' };
    }
    eventValue = raw.eventValue;
    if (raw.rarity !== undefined && raw.rarity !== null) {
      return { ok: false, code: 'INVALID_RARITY', detail: 'step_milestone_bucket rarity must be null.' };
    }
    rarity = null;
  }

  return {
    ok: true,
    value: {
      eventType,
      eventKey,
      eventLabel,
      eventValue,
      rarity,
      clientEventId,
      clientCreatedAt,
    },
  };
}

export async function handlePublicAchievementEventsPost(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_PUBLIC_EVENTS_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many public event submissions. Try again in a minute.');
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  if (!body || !Array.isArray(body.events)) {
    return jsonError(400, 'INVALID_BODY', 'Body must be { events: [...] }.');
  }
  const rawEvents = body.events as RawEvent[];
  if (rawEvents.length < MIN_BATCH_SIZE || rawEvents.length > MAX_BATCH_SIZE) {
    return jsonError(400, 'INVALID_BATCH_SIZE', `events must contain between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE} entries.`);
  }

  const now = Date.now();
  const valid: ValidEvent[] = [];
  for (let i = 0; i < rawEvents.length; i++) {
    const check = validateEvent(rawEvents[i] ?? {}, now);
    if (!check.ok) {
      return jsonError(400, check.code, `events[${i}]: ${check.detail}`);
    }
    valid.push(check.value);
  }

  // Insert one row per valid event with ON CONFLICT DO NOTHING.
  // Duplicates (same user_id + client_event_id) collapse silently
  // and count toward duplicateCount; new rows count toward
  // insertedCount. metadata_json stored as NULL in v1.
  let insertedCount = 0;
  let duplicateCount = 0;
  for (const ev of valid) {
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      `INSERT INTO public_achievement_events (
          id, user_id, event_type, event_key, event_label,
          event_value, rarity,
          client_event_id, client_created_at, server_created_at,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(user_id, client_event_id) DO NOTHING`,
    )
      .bind(
        id,
        session.userId,
        ev.eventType,
        ev.eventKey,
        ev.eventLabel,
        ev.eventValue,
        ev.rarity,
        ev.clientEventId,
        ev.clientCreatedAt,
        now,
      )
      .run();
    const changes = (result.meta && typeof result.meta.changes === 'number') ? result.meta.changes : 0;
    if (changes > 0) insertedCount++;
    else duplicateCount++;
  }

  return jsonOk({
    ok: true,
    insertedCount,
    duplicateCount,
  });
}

interface FeedRow {
  id: string;
  user_id: string;
  event_type: string;
  event_key: string;
  event_label: string;
  event_value: number | null;
  rarity: string | null;
  server_created_at: number;
  alias: string;
  rank_label: string | null;
}

export async function handleFriendsActivityGet(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_PUBLIC_EVENTS_READ.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many activity reads. Try again in a minute.');
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  let limit = FEED_DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < FEED_MIN_LIMIT || parsed > FEED_MAX_LIMIT) {
      return jsonError(400, 'INVALID_LIMIT', `limit must be an integer in [${FEED_MIN_LIMIT}, ${FEED_MAX_LIMIT}].`);
    }
    limit = parsed;
  }

  // Friend scope: accepted-friend IDs union'd with the viewer's
  // own user_id. This produces a "your guild's recent activity"
  // feed (viewer + accepted friends) rather than "strangers'
  // activity." Self inclusion keeps solo users from seeing an
  // empty feed.
  //
  // The JOIN against users + public_profile_summary picks up the
  // friend's current alias and (optional) rankLabel so the
  // client renders in one roundtrip. rank_points + metadata_json
  // are never selected.
  const results = await env.DB.prepare(
    `SELECT e.id                AS id,
            e.user_id           AS user_id,
            e.event_type        AS event_type,
            e.event_key         AS event_key,
            e.event_label       AS event_label,
            e.event_value       AS event_value,
            e.rarity            AS rarity,
            e.server_created_at AS server_created_at,
            u.alias             AS alias,
            p.rank_label        AS rank_label
       FROM public_achievement_events e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN public_profile_summary p ON p.user_id = e.user_id
      WHERE e.user_id = ?
         OR e.user_id IN (
             SELECT CASE WHEN f.requester_user_id = ?
                         THEN f.recipient_user_id
                         ELSE f.requester_user_id END
               FROM friends f
              WHERE f.status = 'accepted'
                AND (f.requester_user_id = ? OR f.recipient_user_id = ?)
           )
      ORDER BY e.server_created_at DESC
      LIMIT ?`,
  )
    .bind(
      session.userId,
      session.userId,
      session.userId,
      session.userId,
      limit,
    )
    .all<FeedRow>();

  const events = (results.results ?? []).map(r => ({
    id:          r.id,
    // user_id is INTENTIONALLY omitted from the response. The
    // viewer already knows their friends; surfacing user_id adds
    // no UI signal and creates a needless identity-disclosure
    // vector. If a future product surface needs cross-event
    // grouping per-user, derive a per-user cohort here.
    alias:       r.alias,
    rankLabel:   r.rank_label ?? null,
    eventType:   r.event_type,
    eventKey:    r.event_key,
    eventLabel:  r.event_label,
    eventValue:  r.event_value,
    rarity:      r.rarity,
    createdAt:   new Date(r.server_created_at).toISOString(),
  }));

  return jsonOk({ ok: true, events });
}
