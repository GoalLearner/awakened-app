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

const ALLOWED_EVENT_TYPES = [
  'boss_kill',
  'rank_up',
  'step_milestone_bucket',
  // v3 Phase 1z.223A — generic public ultra-rare drop event.
  // The eventLabel is hard-pinned to a single privacy-safe
  // string ("looted an ultra-rare item"); we NEVER accept the
  // card/item name, the cardId, the inventory identity, the
  // pity counter state, or any free-text label. Hunter mode
  // continues to render the local card_name surface privately
  // via _guildhallRowHtml; this entry only powers Guild-mode
  // friend feed visibility.
  'ultra_rare_drop',
  // v3 Phase 1z.226A — generic public rare-tier item drop. As
  // with ultra_rare_drop, the label is a single fixed string
  // ("found a rare item") and the eventKey is fixed ("rare").
  // Card name, card id, slot, and pity state are NEVER
  // accepted. Intentionally distinct from the `card_drop`
  // event type used in local Hunter activity — that type
  // carries the card name and remains rejected forever.
  'rare_item_drop',
  // v3 Phase 1z.226A — one-shot prestige unlock for the
  // existing 100K Step Club accolade. eventValue is the
  // canonical 100,000 marker; eventLabel is a single fixed
  // string. Distinct from step_milestone_bucket — the latter
  // fires once per bucket crossing across a day; this fires
  // ONCE per accolade lifetime.
  'step_100k_club_unlocked',
  // v3 Phase 1z.226A — generic verified-streak milestone.
  // The label is a fixed band-keyed phrase ("reached a 30-day
  // verified streak") with NO habit name, NO habit category,
  // NO completion detail. eventValue carries the band integer;
  // eventKey carries `verified_streak:<band>` so backend can
  // sanity-cross-check the trio at write time.
  'verified_streak',
  // v3 Phase 1z.256 — generic verified-workout event. Fires at
  // most once per device-local day (eventKey carries the date).
  // Label is the single fixed string "completed a verified
  // workout". The whole point of this event is to celebrate
  // that a user finished a verified Apple Health workout
  // WITHOUT leaking workout type, duration, calories, heart
  // rate, distance, pace, or location. Any unknown extra field
  // on the payload is silently dropped by the validator (it
  // reads only the named fields), and the test suite locks
  // that behavior in for known HealthKit smuggling vectors.
  'verified_workout',
  // v3 Phase 1z.256 — verified sleep over 7 hours. Fires at
  // most once per sleep-night-date (eventKey carries the date).
  // Label is the single fixed string "slept over 7 hours last
  // night". eventValue is null because the threshold is already
  // encoded in the eventType + label; we never accept raw sleep
  // hours, sleep score, bedtime/wake time, or sleep stages.
  'verified_sleep_7h',
  // v3 Phase 1z.256 — bucketed flights-climbed milestone. Same
  // shape as step_milestone_bucket, but the allowed buckets are
  // {10, 25, 50, 100} flights. The exact non-bucketed flight
  // count is rejected so a public feed event can never leak
  // raw daily flights.
  'flights_milestone_bucket',
  // W258 — Arena title earned (cosmetic Ascent-tower prestige). The label is
  // server-anchored per title id (ARENA_TITLE_LABELS below) so no free text
  // ever travels; clientEventId is pinned to "arena_title:<id>" which, with
  // the UNIQUE(user_id, client_event_id) constraint, makes each title
  // announce ONCE EVER per user — re-clears and soft resets stay silent.
  'arena_title_earned',
] as const;
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number];

const ALLOWED_BOSS_RANKS  = ['E', 'D', 'C', 'B', 'A', 'S', 'S+'] as const;

// Label regex allowlists. Tight on purpose — every label is
// client-preformatted under the same rules we expect at submit
// time, so a leak vector via free-text labels is impossible.
const RE_BOSS_KILL_LABEL    = /^defeated [A-Za-z0-9 '\-]+$/;
const RE_RANK_UP_LABEL      = /^reached (E|D|C|B|A|S|S\+)( III| II| I)?$/;
const RE_STEP_BUCKET_LABEL  = /^crossed (10,000|20,000|30,000|40,000|50,000|60,000|70,000|80,000|90,000|100,000) steps today$/;

// v3 Phase 1z.223A — ultra-rare drop label is a single fixed
// canonical string. Anchored equality — anything else (including
// "looted Crown of Deep Rest", "looted an ultra rare item"
// without the hyphen, "Looted ..." capitalized, trailing
// whitespace, etc.) is rejected.
const ULTRA_RARE_DROP_LABEL = 'looted an ultra-rare item';
// v3 Phase 1z.223A — fixed eventKey for ultra-rare drops. Pinning
// to a single string blocks the client from smuggling card_id
// out via the key field.
const ULTRA_RARE_DROP_KEY   = 'ultra_rare';

// v3 Phase 1z.226A — rare-tier drop. Same shape as
// ultra_rare_drop: every field hard-pinned. Card name / card id
// / slot / rarity tier are NEVER accepted.
const RARE_ITEM_DROP_LABEL = 'found a rare item';
const RARE_ITEM_DROP_KEY   = 'rare';

// v3 Phase 1z.226A — 100K Step Club accolade unlock. Single
// canonical event per accolade lifetime. The value 100000 is the
// marker, not a step count.
const STEP_100K_CLUB_LABEL = 'joined the 100K Step Club';
const STEP_100K_CLUB_KEY   = 'step_100k_club';
const STEP_100K_CLUB_VALUE = 100000;

// W258 — the 14 fixed Arena titles (mirrors ARENA_TITLES in app.js and the
// W257 whitelist in public-profile-summary.ts). id → exact display name; the
// event label must equal 'earned the title "<name>"' verbatim, so no free
// text ever reaches the feed.
const ARENA_TITLE_LABELS: Record<string, string> = {
  // W266 — rating-milestone ladder (current clients)
  rt_contender:       'Contender',
  rt_brawler:         'Brawler',
  rt_duelist:         'Duelist',
  rt_blade:           'Blade',
  rt_reaver:          'Reaver',
  rt_elite:           'Elite',
  rt_warbringer:      'Warbringer',
  rt_sovereign:       'Sovereign',
  rt_apex:            'Apex',
  rt_monarch:         'Monarch',
  rt_grandmaster:     'Grandmaster',
  // legacy W257-era ids — events from pre-W266 clients still validate
  asc_brawler:        'Brawler',
  asc_wallbreaker:    'Wallbreaker',
  asc_ironbreaker:    'Ironbreaker',
  asc_edgewalker:     'Edgewalker',
  asc_duelist:        'Reaver',
  asc_unbroken:       'Unbroken',
  asc_tyrantsbane:    'Tyrantsbane',
  asc_siegebreaker:   'Siegebreaker',
  asc_shadowcaller:   'Shadowcaller',
  asc_sovereign:      'The Second Awakened',
  asc_rank_contender: 'Ranked Contender',
  asc_rank_duelist:   'Ranked Blade',
  asc_rank_elite:     'Ranked Elite',
  asc_rank_apex:      'Apex',
};

// v3 Phase 1z.226A — verified streak milestone bands. Allowlist
// is { 7, 14, 30, 100, 365 } only. Every other length rejected.
// Label/key/value are cross-validated so a client cannot post
// `label: "30-day"` with `value: 7` and have it persist.
const VERIFIED_STREAK_BANDS = new Set([7, 14, 30, 100, 365]);
const VERIFIED_STREAK_LABEL_FOR_BAND: Record<number, string> = {
  7:   'reached a 7-day verified streak',
  14:  'reached a 14-day verified streak',
  30:  'reached a 30-day verified streak',
  100: 'reached a 100-day verified streak',
  365: 'reached a 365-day verified streak',
};
const VERIFIED_STREAK_KEY_FOR_BAND: Record<number, string> = {
  7:   'verified_streak:7',
  14:  'verified_streak:14',
  30:  'verified_streak:30',
  100: 'verified_streak:100',
  365: 'verified_streak:365',
};

const ALLOWED_STEP_BUCKETS = new Set([10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000]);

// v3 Phase 1z.256 — verified workout. Same hard-pin posture as
// the 1z.226A ultra/rare/100K-club events: label and key shape
// are both fixed; eventValue and rarity must be null. The key is
// date-scoped so dedupe naturally caps the public feed at one
// event per device-local day.
const VERIFIED_WORKOUT_LABEL = 'completed a verified workout';
const RE_VERIFIED_WORKOUT_KEY = /^verified_workout:\d{4}-\d{2}-\d{2}$/;

// v3 Phase 1z.256 — verified sleep ≥ 7 hours. Threshold lives in
// the event type, not the value. We accept null only — sending
// the raw hours (or anything else) is rejected so the public
// surface can never carry exact sleep duration.
const VERIFIED_SLEEP_7H_LABEL = 'slept over 7 hours last night';
const RE_VERIFIED_SLEEP_7H_KEY = /^verified_sleep_7h:\d{4}-\d{2}-\d{2}$/;

// v3 Phase 1z.256 — bucketed flights-climbed milestone. Mirrors
// step_milestone_bucket but with a much smaller bucket set so
// the feed isn't dominated by stair-day spam. Label / key /
// value all carry the bucket; the validator cross-checks the
// trio for internal consistency so a client cannot publish
// "climbed 100 flights" while binding eventValue=10.
const FLIGHTS_BUCKET_VALUES = new Set([10, 25, 50, 100]);
const RE_FLIGHTS_BUCKET_LABEL = /^climbed (10|25|50|100) flights today$/;
const RE_FLIGHTS_BUCKET_KEY = /^flights_milestone_bucket:\d{4}-\d{2}-\d{2}:(10|25|50|100)$/;

// v3 Phase 1z.226A — colon allowed so verified_streak band keys
// like "verified_streak:30" pass the cross-cutting key gate.
// boss_kill / rank_up / step_milestone_bucket / ultra_rare_drop /
// rare_item_drop / step_100k_club_unlocked keys do not contain
// colons, so widening this regex is purely additive.
const EVENT_KEY_RE         = /^[A-Za-z0-9_:\-]+$/;
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
  } else if (eventType === 'step_milestone_bucket') {
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
  } else if (eventType === 'ultra_rare_drop') {
    // v3 Phase 1z.223A — ultra_rare_drop. Strict allowlist with
    // ZERO degrees of freedom on label or key. The whole point
    // of this event is "something rare just happened" without
    // revealing what. eventKey, eventLabel, and rarity are
    // fully fixed; eventValue must be null. The client can
    // only vary the clientEventId (for idempotency) and the
    // clientCreatedAt timestamp.
    if (eventLabel !== ULTRA_RARE_DROP_LABEL) {
      return {
        ok: false,
        code: 'INVALID_EVENT_LABEL',
        detail: `ultra_rare_drop label must be exactly "${ULTRA_RARE_DROP_LABEL}".`,
      };
    }
    if (eventKey !== ULTRA_RARE_DROP_KEY) {
      return {
        ok: false,
        code: 'INVALID_EVENT_KEY',
        detail: `ultra_rare_drop eventKey must be exactly "${ULTRA_RARE_DROP_KEY}".`,
      };
    }
    if (raw.eventValue !== undefined && raw.eventValue !== null) {
      return {
        ok: false,
        code: 'INVALID_EVENT_VALUE',
        detail: 'ultra_rare_drop eventValue must be null.',
      };
    }
    eventValue = null;
    if (raw.rarity !== undefined && raw.rarity !== null) {
      return {
        ok: false,
        code: 'INVALID_RARITY',
        detail: 'ultra_rare_drop rarity must be null.',
      };
    }
    rarity = null;
  } else if (eventType === 'rare_item_drop') {
    // v3 Phase 1z.226A — rare-tier item drop. Same posture as
    // ultra_rare_drop: every field hard-pinned. Card identity is
    // never accepted. Intentionally distinct from the local
    // `card_drop` event type (which carries the card name and
    // remains rejected forever via INVALID_EVENT_TYPE above).
    if (eventLabel !== RARE_ITEM_DROP_LABEL) {
      return {
        ok: false,
        code: 'INVALID_EVENT_LABEL',
        detail: `rare_item_drop label must be exactly "${RARE_ITEM_DROP_LABEL}".`,
      };
    }
    if (eventKey !== RARE_ITEM_DROP_KEY) {
      return {
        ok: false,
        code: 'INVALID_EVENT_KEY',
        detail: `rare_item_drop eventKey must be exactly "${RARE_ITEM_DROP_KEY}".`,
      };
    }
    if (raw.eventValue !== undefined && raw.eventValue !== null) {
      return {
        ok: false,
        code: 'INVALID_EVENT_VALUE',
        detail: 'rare_item_drop eventValue must be null.',
      };
    }
    eventValue = null;
    if (raw.rarity !== undefined && raw.rarity !== null) {
      return {
        ok: false,
        code: 'INVALID_RARITY',
        detail: 'rare_item_drop rarity must be null.',
      };
    }
    rarity = null;
  } else if (eventType === 'step_100k_club_unlocked') {
    // v3 Phase 1z.226A — one-shot accolade unlock event. Label
    // and key are hard-pinned. eventValue must equal the
    // canonical 100,000 marker so the value cannot be smuggled
    // to disclose actual step counts.
    if (eventLabel !== STEP_100K_CLUB_LABEL) {
      return {
        ok: false,
        code: 'INVALID_EVENT_LABEL',
        detail: `step_100k_club_unlocked label must be exactly "${STEP_100K_CLUB_LABEL}".`,
      };
    }
    if (eventKey !== STEP_100K_CLUB_KEY) {
      return {
        ok: false,
        code: 'INVALID_EVENT_KEY',
        detail: `step_100k_club_unlocked eventKey must be exactly "${STEP_100K_CLUB_KEY}".`,
      };
    }
    if (raw.eventValue !== STEP_100K_CLUB_VALUE) {
      return {
        ok: false,
        code: 'INVALID_EVENT_VALUE',
        detail: `step_100k_club_unlocked eventValue must equal ${STEP_100K_CLUB_VALUE}.`,
      };
    }
    eventValue = STEP_100K_CLUB_VALUE;
    if (raw.rarity !== undefined && raw.rarity !== null) {
      return {
        ok: false,
        code: 'INVALID_RARITY',
        detail: 'step_100k_club_unlocked rarity must be null.',
      };
    }
    rarity = null;
  } else if (eventType === 'verified_streak') {
    // v3 Phase 1z.226A — verified_streak. Band must be in
    // {7,14,30,100,365}; label / key / value are cross-checked
    // so the trio is internally consistent. No habit name, no
    // habit category, no completion detail accepted.
    // v3 Phase 1z.256 — promoted from fallthrough `else` to an
    // explicit branch so the three new HealthKit-backed types
    // below can each own their own validation block.
    if (!isInt(raw.eventValue, 7, 365) || !VERIFIED_STREAK_BANDS.has(raw.eventValue)) {
      return {
        ok: false,
        code: 'INVALID_EVENT_VALUE',
        detail: 'verified_streak eventValue must be one of 7, 14, 30, 100, 365.',
      };
    }
    const band = raw.eventValue;
    const expectedLabel = VERIFIED_STREAK_LABEL_FOR_BAND[band];
    if (eventLabel !== expectedLabel) {
      return {
        ok: false,
        code: 'INVALID_EVENT_LABEL',
        detail: `verified_streak label must be exactly "${expectedLabel}" for eventValue ${band}.`,
      };
    }
    const expectedKey = VERIFIED_STREAK_KEY_FOR_BAND[band];
    if (eventKey !== expectedKey) {
      return {
        ok: false,
        code: 'INVALID_EVENT_KEY',
        detail: `verified_streak eventKey must be exactly "${expectedKey}" for eventValue ${band}.`,
      };
    }
    eventValue = band;
    if (raw.rarity !== undefined && raw.rarity !== null) {
      return {
        ok: false,
        code: 'INVALID_RARITY',
        detail: 'verified_streak rarity must be null.',
      };
    }
    rarity = null;
  } else if (eventType === 'verified_workout') {
    // v3 Phase 1z.256 — verified workout. Label hard-pinned; key
    // is date-scoped so the feed is naturally capped at one per
    // day per user. eventValue and rarity must be null. Unknown
    // extra fields on the payload (workoutType, calories,
    // heartRate, distance, pace, location, duration) are
    // silently dropped by the validator — the test suite locks
    // that behavior in for the known HealthKit smuggling
    // vectors.
    if (eventLabel !== VERIFIED_WORKOUT_LABEL) {
      return {
        ok: false,
        code: 'INVALID_EVENT_LABEL',
        detail: `verified_workout label must be exactly "${VERIFIED_WORKOUT_LABEL}".`,
      };
    }
    if (!RE_VERIFIED_WORKOUT_KEY.test(eventKey)) {
      return {
        ok: false,
        code: 'INVALID_EVENT_KEY',
        detail: 'verified_workout eventKey must match "verified_workout:<YYYY-MM-DD>".',
      };
    }
    if (raw.eventValue !== undefined && raw.eventValue !== null) {
      return {
        ok: false,
        code: 'INVALID_EVENT_VALUE',
        detail: 'verified_workout eventValue must be null.',
      };
    }
    eventValue = null;
    if (raw.rarity !== undefined && raw.rarity !== null) {
      return {
        ok: false,
        code: 'INVALID_RARITY',
        detail: 'verified_workout rarity must be null.',
      };
    }
    rarity = null;
  } else if (eventType === 'verified_sleep_7h') {
    // v3 Phase 1z.256 — verified sleep ≥ 7 hours. Threshold is
    // encoded in the eventType + label; eventValue MUST be null
    // so raw sleep duration, sleep score, bedtime/wake time,
    // or sleep stages can never appear on the public surface.
    // Unknown extra fields (sleepHours, asleepHours, sleepScore,
    // bedtime, wakeTime, sleepStages, deepSleep, remSleep) are
    // silently dropped by the validator — tests lock this in.
    if (eventLabel !== VERIFIED_SLEEP_7H_LABEL) {
      return {
        ok: false,
        code: 'INVALID_EVENT_LABEL',
        detail: `verified_sleep_7h label must be exactly "${VERIFIED_SLEEP_7H_LABEL}".`,
      };
    }
    if (!RE_VERIFIED_SLEEP_7H_KEY.test(eventKey)) {
      return {
        ok: false,
        code: 'INVALID_EVENT_KEY',
        detail: 'verified_sleep_7h eventKey must match "verified_sleep_7h:<YYYY-MM-DD>".',
      };
    }
    if (raw.eventValue !== undefined && raw.eventValue !== null) {
      return {
        ok: false,
        code: 'INVALID_EVENT_VALUE',
        detail: 'verified_sleep_7h eventValue must be null.',
      };
    }
    eventValue = null;
    if (raw.rarity !== undefined && raw.rarity !== null) {
      return {
        ok: false,
        code: 'INVALID_RARITY',
        detail: 'verified_sleep_7h rarity must be null.',
      };
    }
    rarity = null;
  } else if (eventType === 'flights_milestone_bucket') {
    // v3 Phase 1z.256 — flights_milestone_bucket (W258: was the chain's
    // terminal else-fallthrough; made explicit when arena_title_earned
    // joined the allowlist). Bucket must be one of
    // {10,25,50,100}; label / key / value are cross-checked so
    // the trio is internally consistent. Exact non-bucket
    // flights values are rejected.
    if (!isInt(raw.eventValue, 10, 100) || !FLIGHTS_BUCKET_VALUES.has(raw.eventValue)) {
      return {
        ok: false,
        code: 'INVALID_EVENT_VALUE',
        detail: 'flights_milestone_bucket eventValue must be one of 10, 25, 50, 100.',
      };
    }
    const bucket = raw.eventValue;
    if (!RE_FLIGHTS_BUCKET_LABEL.test(eventLabel)) {
      return {
        ok: false,
        code: 'INVALID_EVENT_LABEL',
        detail: 'flights_milestone_bucket label must match "climbed <N> flights today" for N in {10,25,50,100}.',
      };
    }
    if (!RE_FLIGHTS_BUCKET_KEY.test(eventKey)) {
      return {
        ok: false,
        code: 'INVALID_EVENT_KEY',
        detail: 'flights_milestone_bucket eventKey must match "flights_milestone_bucket:<YYYY-MM-DD>:<bucket>".',
      };
    }
    // Cross-check that label bucket, key bucket, and eventValue
    // all agree. Without this, a client could publish a "100
    // flights" label while binding eventValue=10 and the row
    // would order incorrectly in any future leaderboard derived
    // from the feed.
    const labelBucket = parseInt((eventLabel.match(/^climbed (\d+) flights today$/) ?? [, ''])[1] || '0', 10);
    const keyBucket = parseInt((eventKey.match(/:(\d+)$/) ?? [, ''])[1] || '0', 10);
    if (labelBucket !== bucket || keyBucket !== bucket) {
      return {
        ok: false,
        code: 'INVALID_EVENT_VALUE',
        detail: 'flights_milestone_bucket label / key / eventValue bucket must all agree.',
      };
    }
    eventValue = bucket;
    if (raw.rarity !== undefined && raw.rarity !== null) {
      return {
        ok: false,
        code: 'INVALID_RARITY',
        detail: 'flights_milestone_bucket rarity must be null.',
      };
    }
    rarity = null;
  } else if (eventType === 'arena_title_earned') {
    // W258 — Arena title earned. Strictest posture: the eventKey must be one
    // of the 14 known title ids, the label must equal the server-known
    // 'earned the title "<name>"' for THAT id (tamper-proof — no free text),
    // and the clientEventId is pinned to "arena_title:<id>" so the
    // UNIQUE(user_id, client_event_id) constraint makes every title a
    // once-ever announcement per user (re-clears / soft resets stay silent).
    const titleName = ARENA_TITLE_LABELS[eventKey];
    if (!titleName) {
      return {
        ok: false,
        code: 'INVALID_EVENT_KEY',
        detail: 'arena_title_earned eventKey must be a known Arena title id.',
      };
    }
    const expectedLabel = 'earned the title "' + titleName + '"';
    if (eventLabel !== expectedLabel) {
      return {
        ok: false,
        code: 'INVALID_EVENT_LABEL',
        detail: 'arena_title_earned label must exactly match the title id.',
      };
    }
    if (clientEventId !== 'arena_title:' + eventKey) {
      return {
        ok: false,
        code: 'INVALID_CLIENT_EVENT_ID',
        detail: 'arena_title_earned clientEventId must be "arena_title:<id>".',
      };
    }
    if (raw.eventValue !== undefined && raw.eventValue !== null) {
      return {
        ok: false,
        code: 'INVALID_EVENT_VALUE',
        detail: 'arena_title_earned eventValue must be null.',
      };
    }
    eventValue = null;
    if (raw.rarity !== undefined && raw.rarity !== null) {
      return {
        ok: false,
        code: 'INVALID_RARITY',
        detail: 'arena_title_earned rarity must be null.',
      };
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
