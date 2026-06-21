/**
 * Public profile summary handler (v3 Phase 1z.190 + 1z.195).
 *
 *   PUT /v1/users/me/public-profile-summary
 *
 * Authenticated. Upserts the caller's row in `public_profile_summary`
 * with a preformatted public rank summary AND optional public
 * achievement summary fields (Global Friend Achievements MVP-A).
 * The backend NEVER recomputes rank or achievements from XP,
 * HealthKit, or the opaque `user_state_snapshots.state_json` blob —
 * derivation lives exclusively in the client (rank via
 * `getRankDivisionInfo`, achievement aggregates via locally-
 * computed counts of inventory + bosses + streak bands).
 *
 * Rank validation (1z.190):
 *   - rankTier ∈ {E, D, C, B, A, S, S+}
 *   - rankDivision ∈ {I, II, III, null}
 *   - if rankTier === 'S+'  then rankDivision === null
 *   - if rankTier !== 'S+'  then rankDivision ∈ {I, II, III}
 *   - rankLabel matches `<tier>` (S+) or `<tier> <division>`
 *   - rankSortValue is a finite integer in [0, 6_999_999_999]
 *   - rankPoints is a finite integer in [0, 999_999_999]
 *   - clientUpdatedAt parses as a finite Date
 *
 * Achievements validation (1z.195) — optional `achievements`
 * object on the body. When present:
 *   - bossesSlainTotal     : optional integer in [0, 999_999]
 *   - ultraRareDropsTotal  : optional integer in [0, 9_999]
 *   - verifiedStreakLabel  : optional string matching
 *       /^\d{1,4}-day (MR|LI|stat|habit) streak$/
 * Streak label uses the streak TYPE + LENGTH only — NEVER the
 * user's private habit name. Cumulative counts are aggregates;
 * we never receive per-event timestamps or item identities.
 *
 * Read path: handlers/friends.ts' serializeFriendRow LEFT JOINs
 * this table and merges optional rank + achievement fields onto
 * the friend row. `rank_points` and `metadata_json` are
 * intentionally withheld from the friends payload (privacy:
 * hides exact XP magnitude; metadata stays an opaque future
 * seam). Achievement fields leak out as cumulative counts only.
 *
 * Write semantics for achievements:
 *   - If the body omits `achievements` entirely, achievement
 *     columns and `achievements_updated_at` are preserved
 *     verbatim. The rank-only daily heartbeat is a true no-op
 *     for the achievement surface.
 *   - If the body contains `achievements: {}` (an empty object,
 *     or one with all-undefined fields), nothing changes — same
 *     preservation rule.
 *   - If the body contains at least one defined achievement
 *     field, ONLY those provided fields update; omitted ones
 *     are preserved via COALESCE. `achievements_updated_at` is
 *     set to Date.now().
 */
import type { Env } from '../env';
import type { SessionPayload } from '../session-jwt';
import { jsonOk, jsonError } from '../lib/responses';

const ALLOWED_TIERS = ['E', 'D', 'C', 'B', 'A', 'S', 'S+'] as const;
const ALLOWED_DIVISIONS = ['I', 'II', 'III'] as const;

const RANK_LABEL_RE = /^(E|D|C|B|A|S|S\+)(?: (I|II|III))?$/;

// rank_sort_value ceiling matches the 1z.189 formula's maximum:
// tierWeight=6 (S+) * 1_000_000_000 + divWeight=3 * 1_000_000
// + points=999_999  →  6_003_999_999. We accept a slightly wider
// ceiling so an honest client can submit any monotonic encoding
// without us having to hardcode the exact formula on the server.
const SORT_VALUE_MAX = 6_999_999_999;
const RANK_POINTS_MAX = 999_999_999;
// W453 — Prestige star count (S+ endgame). Display-only, client-authoritative,
// stored verbatim like rank_points. The ceiling is pure anti-garbage: 100k
// stars would be ~1.2 billion XP, far above any real player.
const PRESTIGE_MAX = 100_000;

// v3 Phase 1z.195 — public achievement summary caps. Tight enough
// to defend against accidental client-side overflow without being
// so tight that a legitimate hardcore user hits the wall.
const BOSSES_SLAIN_MAX     = 999_999;
const ULTRA_RARE_DROPS_MAX = 9_999;
const POWER_MAX            = 1_000_000;   // display power cap (anti-garbage; well above any real build)
const AVG_STEPS_MAX        = 1_000_000;   // W304 — lifetime avg steps/day cap (anti-garbage)
const COMBATANT_STAT_MAX   = 200;         // W440 — per-stat cap (matches the DO's MAX_STAT)
const COMBATANT_KEYS       = ['STR', 'VIT', 'INT', 'FOCUS', 'WILL', 'WLT'] as const;
// Streak label allowlist: "<digits>-day <type> streak". Types are
// the four streak kinds the client tracks (Morning Routine, Locked-
// In, top stat, top habit). The user's private habit name is NEVER
// part of this label.
const STREAK_LABEL_RE = /^\d{1,4}-day (MR|LI|stat|habit) streak$/;

// W257 — equipped Arena title whitelist. The 14 fixed cosmetic title IDs the
// Ascent tower can award (10 boss titles + 4 rating milestones). Mirrors
// ARENA_TITLES in app.js — IDs only; display names resolve client-side.
// The server cannot verify a title is genuinely unlocked (the Arena is a
// client-side minigame); accepted cosmetic-only risk. This field can never
// grant power, currency, or progression.
const ARENA_TITLE_IDS = [
  // W266 — rating-milestone ladder (current clients)
  'rt_contender', 'rt_brawler', 'rt_duelist', 'rt_blade', 'rt_reaver',
  'rt_elite', 'rt_warbringer', 'rt_sovereign', 'rt_apex', 'rt_monarch',
  'rt_grandmaster',
  // W269 — the summit trophy "The Second Awakened" (clear all 100 floors; off
  // the rating ladder). Display name resolves client-side, same as the rest.
  'summit_second_awakened',
  // legacy W257-era ids — accepted from pre-W266 clients still in the wild;
  // the client remaps them forward on its next launch
  'asc_brawler', 'asc_wallbreaker', 'asc_ironbreaker', 'asc_edgewalker',
  'asc_duelist', 'asc_unbroken', 'asc_tyrantsbane', 'asc_siegebreaker',
  'asc_shadowcaller', 'asc_sovereign',
  'asc_rank_contender', 'asc_rank_duelist', 'asc_rank_elite', 'asc_rank_apex',
] as const;

interface PutBody {
  rankTier?: unknown;
  rankDivision?: unknown;
  rankLabel?: unknown;
  rankSortValue?: unknown;
  rankPoints?: unknown;
  prestige?: unknown;   // W453 — Prestige star count (S+ only)
  clientUpdatedAt?: unknown;
  achievements?: unknown;
  arenaTitle?: unknown;
  avatarId?: unknown;
  power?: unknown;
  avgStepsPerDay?: unknown;
  combatant?: unknown;   // W440 — loadout snapshot for "Duel a Friend's Echo" (6 stats + weapon)
}

// Per-field "was this key present in the achievements object?"
// distinguishes "omitted → preserve existing column" from
// "explicit value supplied → overwrite". Crucial for the null
// case: a null verifiedStreakLabel from the client is a deliberate
// "clear my streak" signal, while omitting the key entirely
// preserves whatever's already in D1.
interface AchField<T> { set: boolean; value: T | null }
interface ValidatedAchievements {
  bossesSlainTotal:     AchField<number>;
  ultraRareDropsTotal:  AchField<number>;
  verifiedStreakLabel:  AchField<string>;
  hasAny:               boolean;
}

interface Validated {
  rankTier: string;
  rankDivision: string | null;
  rankLabel: string;
  rankSortValue: number;
  rankPoints: number;
  prestige: number;   // W453 — coerced to 0 for non-S+ tiers
  clientUpdatedAt: string;
  achievements: ValidatedAchievements;
  // W257 — equipped Arena title. Same set/clear/preserve semantics as
  // verifiedStreakLabel: omitted key → preserve existing column; null →
  // deliberate "unequipped" clear; string → must be a whitelisted ID.
  arenaTitle: AchField<string>;
  // Profile card (W-next) — same set/clear/preserve semantics.
  avatarId: AchField<string>;
  power: AchField<number>;
  avgStepsPerDay: AchField<number>;
  // W440 — combatant loadout snapshot (stored as a validated JSON string in combatant_json).
  combatant: AchField<string>;
}

function isAllowedTier(v: unknown): v is (typeof ALLOWED_TIERS)[number] {
  return typeof v === 'string' && (ALLOWED_TIERS as readonly string[]).includes(v);
}

function isAllowedDivision(v: unknown): v is (typeof ALLOWED_DIVISIONS)[number] {
  return typeof v === 'string' && (ALLOWED_DIVISIONS as readonly string[]).includes(v);
}

function isSafeInt(v: unknown, min: number, max: number): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    Number.isInteger(v) &&
    v >= min &&
    v <= max
  );
}

// v3 Phase 1z.195 — validate the optional achievements object.
// Returns:
//   { ok: true, value }     — all present fields are valid;
//                             value.hasAny=false means the object
//                             was present but every field was
//                             undefined (no-op for the upsert).
//   { ok: false, code, ... }— at least one defined field failed
//                             validation. We surface a 400 so the
//                             client can fix the payload.
//
// Per spec: a missing `achievements` key entirely means "preserve
// every achievement column verbatim, do NOT churn
// achievements_updated_at". The caller decides what to do with
// `hasAny=false` (treat it the same as a fully-missing object).
function validateAchievements(raw: unknown):
  | { ok: true; value: ValidatedAchievements }
  | { ok: false; code: string; detail: string } {
  const blank: ValidatedAchievements = {
    bossesSlainTotal:    { set: false, value: null },
    ultraRareDropsTotal: { set: false, value: null },
    verifiedStreakLabel: { set: false, value: null },
    hasAny:              false,
  };
  if (raw === undefined) return { ok: true, value: blank };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'INVALID_ACHIEVEMENTS',
      detail: 'achievements must be an object when present.',
    };
  }
  const obj = raw as Record<string, unknown>;
  const out: ValidatedAchievements = {
    bossesSlainTotal:    { set: false, value: null },
    ultraRareDropsTotal: { set: false, value: null },
    verifiedStreakLabel: { set: false, value: null },
    hasAny:              false,
  };

  if ('bossesSlainTotal' in obj) {
    if (!isSafeInt(obj.bossesSlainTotal, 0, BOSSES_SLAIN_MAX)) {
      return {
        ok: false,
        code: 'INVALID_BOSSES_SLAIN_TOTAL',
        detail: `bossesSlainTotal must be an integer in [0, ${BOSSES_SLAIN_MAX}].`,
      };
    }
    out.bossesSlainTotal = { set: true, value: obj.bossesSlainTotal };
    out.hasAny = true;
  }

  if ('ultraRareDropsTotal' in obj) {
    if (!isSafeInt(obj.ultraRareDropsTotal, 0, ULTRA_RARE_DROPS_MAX)) {
      return {
        ok: false,
        code: 'INVALID_ULTRA_RARE_DROPS_TOTAL',
        detail: `ultraRareDropsTotal must be an integer in [0, ${ULTRA_RARE_DROPS_MAX}].`,
      };
    }
    out.ultraRareDropsTotal = { set: true, value: obj.ultraRareDropsTotal };
    out.hasAny = true;
  }

  if ('verifiedStreakLabel' in obj) {
    // Null is a deliberate "clear my streak label" signal.
    if (obj.verifiedStreakLabel === null) {
      out.verifiedStreakLabel = { set: true, value: null };
      out.hasAny = true;
    } else if (typeof obj.verifiedStreakLabel === 'string'
            && STREAK_LABEL_RE.test(obj.verifiedStreakLabel)) {
      out.verifiedStreakLabel = { set: true, value: obj.verifiedStreakLabel };
      out.hasAny = true;
    } else {
      return {
        ok: false,
        code: 'INVALID_VERIFIED_STREAK_LABEL',
        detail: 'verifiedStreakLabel must match "<digits>-day (MR|LI|stat|habit) streak" or be null.',
      };
    }
  }

  return { ok: true, value: out };
}

function validate(body: PutBody):
  | { ok: true; value: Validated }
  | { ok: false; code: string; detail: string } {
  if (!isAllowedTier(body.rankTier)) {
    return {
      ok: false,
      code: 'INVALID_TIER',
      detail: 'rankTier must be one of E, D, C, B, A, S, S+.',
    };
  }
  const rankTier = body.rankTier;

  let rankDivision: string | null;
  if (rankTier === 'S+') {
    if (body.rankDivision !== null && body.rankDivision !== undefined) {
      return {
        ok: false,
        code: 'INVALID_DIVISION',
        detail: 'rankDivision must be null when rankTier is S+.',
      };
    }
    rankDivision = null;
  } else {
    if (!isAllowedDivision(body.rankDivision)) {
      return {
        ok: false,
        code: 'INVALID_DIVISION',
        detail: 'rankDivision must be one of I, II, III for non-S+ tiers.',
      };
    }
    rankDivision = body.rankDivision;
  }

  if (typeof body.rankLabel !== 'string') {
    return { ok: false, code: 'INVALID_LABEL', detail: 'rankLabel must be a string.' };
  }
  const labelMatch = body.rankLabel.match(RANK_LABEL_RE);
  if (!labelMatch) {
    return {
      ok: false,
      code: 'INVALID_LABEL',
      detail: 'rankLabel must match "<tier>" (S+) or "<tier> <division>" (e.g. "D II").',
    };
  }
  // Cross-check label vs tier/division. Defends against a client
  // that submits mismatched fields (tier=D, division=II, label="C I").
  const labelTier = labelMatch[1];
  const labelDiv = labelMatch[2] ?? null;
  if (labelTier !== rankTier || labelDiv !== rankDivision) {
    return {
      ok: false,
      code: 'INVALID_LABEL',
      detail: 'rankLabel must agree with rankTier and rankDivision.',
    };
  }

  if (!isSafeInt(body.rankSortValue, 0, SORT_VALUE_MAX)) {
    return {
      ok: false,
      code: 'INVALID_SORT_VALUE',
      detail: `rankSortValue must be an integer in [0, ${SORT_VALUE_MAX}].`,
    };
  }
  if (!isSafeInt(body.rankPoints, 0, RANK_POINTS_MAX)) {
    return {
      ok: false,
      code: 'INVALID_POINTS',
      detail: `rankPoints must be an integer in [0, ${RANK_POINTS_MAX}].`,
    };
  }

  // W453 — Prestige star count. Optional (pre-W453 clients omit it → 0) and
  // only meaningful at S+, so coerce to 0 for every lower tier.
  let prestige = 0;
  if (body.prestige !== undefined && body.prestige !== null) {
    if (!isSafeInt(body.prestige, 0, PRESTIGE_MAX)) {
      return {
        ok: false,
        code: 'INVALID_PRESTIGE',
        detail: `prestige must be an integer in [0, ${PRESTIGE_MAX}].`,
      };
    }
    prestige = body.prestige;
  }
  if (rankTier !== 'S+') prestige = 0;

  if (typeof body.clientUpdatedAt !== 'string') {
    return {
      ok: false,
      code: 'INVALID_TIMESTAMP',
      detail: 'clientUpdatedAt must be an ISO string.',
    };
  }
  const ts = Date.parse(body.clientUpdatedAt);
  if (!Number.isFinite(ts)) {
    return {
      ok: false,
      code: 'INVALID_TIMESTAMP',
      detail: 'clientUpdatedAt must be a valid ISO timestamp.',
    };
  }

  // v3 Phase 1z.195 — validate the optional achievements block.
  // A failure here surfaces as a 400 with the specific field code
  // so the client can correct the payload without resubmitting
  // the entire rank block.
  const achCheck = validateAchievements(body.achievements);
  if (!achCheck.ok) {
    return { ok: false, code: achCheck.code, detail: achCheck.detail };
  }

  // W257 — validate the optional equipped Arena title. Omitted →
  // preserve; null → clear ("unequipped"); string → whitelist only.
  let arenaTitle: AchField<string> = { set: false, value: null };
  if ('arenaTitle' in body && body.arenaTitle !== undefined) {
    if (body.arenaTitle === null) {
      arenaTitle = { set: true, value: null };
    } else if (
      typeof body.arenaTitle === 'string' &&
      (ARENA_TITLE_IDS as readonly string[]).includes(body.arenaTitle)
    ) {
      arenaTitle = { set: true, value: body.arenaTitle };
    } else {
      return {
        ok: false,
        code: 'INVALID_ARENA_TITLE',
        detail: 'arenaTitle must be a known Arena title id or null.',
      };
    }
  }

  // W-next — profile card display fields. Omitted → preserve existing column.
  let avatarId: AchField<string> = { set: false, value: null };
  if ('avatarId' in body && body.avatarId !== undefined) {
    if (body.avatarId === null) {
      avatarId = { set: true, value: null };
    } else if (typeof body.avatarId === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(body.avatarId)) {
      avatarId = { set: true, value: body.avatarId };
    } else {
      return { ok: false, code: 'INVALID_AVATAR_ID', detail: 'avatarId must be a short id string or null.' };
    }
  }
  let power: AchField<number> = { set: false, value: null };
  if ('power' in body && body.power !== undefined) {
    if (isSafeInt(body.power, 0, POWER_MAX)) {
      power = { set: true, value: body.power };
    } else {
      return { ok: false, code: 'INVALID_POWER', detail: `power must be an integer in [0, ${POWER_MAX}].` };
    }
  }

  let avgStepsPerDay: AchField<number> = { set: false, value: null };
  if ('avgStepsPerDay' in body && body.avgStepsPerDay !== undefined) {
    if (isSafeInt(body.avgStepsPerDay, 0, AVG_STEPS_MAX)) {
      avgStepsPerDay = { set: true, value: body.avgStepsPerDay };
    } else {
      return { ok: false, code: 'INVALID_AVG_STEPS', detail: 'avgStepsPerDay must be an integer in [0, ' + AVG_STEPS_MAX + '].' };
    }
  }

  // W440 — combatant loadout snapshot for "Duel a Friend's Echo". Validated to the
  // sanitizeCombatant shape (6 stats clamped, weapon/name/avatar bounded) and stored as an
  // opaque JSON string. Carries NO progression/currency/rank; the DO re-sanitizes it
  // authoritatively when it builds the Echo bot, so this is just an anti-garbage first pass.
  let combatant: AchField<string> = { set: false, value: null };
  if ('combatant' in body && body.combatant !== undefined) {
    if (body.combatant === null) {
      combatant = { set: true, value: null };
    } else if (typeof body.combatant === 'object') {
      const c = body.combatant as Record<string, unknown>;
      const src = (c.stats && typeof c.stats === 'object') ? c.stats as Record<string, unknown> : {};
      const stats: Record<string, number> = {};
      for (const k of COMBATANT_KEYS) {
        let v = Number(src[k]);
        if (!Number.isFinite(v) || v < 0) v = 0;
        stats[k] = Math.min(COMBATANT_STAT_MAX, Math.round(v));
      }
      const av = typeof c.avatar === 'string' && /^avatar[a-z0-9_-]{0,40}\.png$/i.test(c.avatar) ? c.avatar : '';
      const clean = {
        name: String(c.name || 'Hunter').slice(0, 40),
        weaponId: String(c.weaponId || 'unarmed').slice(0, 40),
        weaponName: String(c.weaponName || '').slice(0, 60),
        avatar: av,
        stats,
      };
      combatant = { set: true, value: JSON.stringify(clean) };
    } else {
      return { ok: false, code: 'INVALID_COMBATANT', detail: 'combatant must be an object or null.' };
    }
  }

  return {
    ok: true,
    value: {
      rankTier,
      rankDivision,
      rankLabel: body.rankLabel,
      rankSortValue: body.rankSortValue,
      rankPoints: body.rankPoints,
      prestige,
      clientUpdatedAt: body.clientUpdatedAt,
      achievements: achCheck.value,
      arenaTitle,
      avatarId,
      power,
      avgStepsPerDay,
      combatant,
    },
  };
}

export async function handlePublicProfileSummaryPut(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const rl = await env.RL_PUBLIC_PROFILE_WRITE.limit({ key: session.userId });
  if (!rl.success) {
    return jsonError(
      429,
      'RATE_LIMITED',
      'Too many public profile updates. Try again in a minute.',
    );
  }

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const check = validate(body);
  if (!check.ok) {
    return jsonError(400, check.code, check.detail);
  }
  const v = check.value;

  const serverUpdatedAt = Date.now();
  const ach = v.achievements;
  // v3 Phase 1z.195 — only stamp achievements_updated_at when the
  // client actually submitted at least one defined achievement
  // field. Rank-only daily heartbeats must NOT churn this column.
  const achievementsUpdatedAt = ach.hasAny ? serverUpdatedAt : null;

  // Upsert by user_id. The PRIMARY KEY conflict path updates rank
  // fields verbatim. Achievement columns use COALESCE so:
  //   - omitted achievement field → preserve existing row value
  //   - present achievement field → overwrite with the new value
  //     (null is also a valid "clear my streak label" signal)
  // metadata_json stays NULL in v1; reserved for genuinely future-
  // unstable fields. Backend NEVER recomputes any of these from
  // XP / HealthKit / user_state_snapshots.state_json.
  //
  // INSERT path (first-ever submission for this user): the four
  // new achievement columns fall back to the table's DEFAULT 0 /
  // NULL when the client omitted them. The corresponding bind
  // value is the validated number/null/null, so a first-time
  // achievements-only submission still records correctly.
  // Per-field "set" flags drive the CASE WHEN selectors on the
  // ON CONFLICT path so omitted achievement fields preserve
  // existing column values verbatim. On the INSERT path (first
  // submission for this user) COALESCE falls back to DEFAULT 0
  // for the integer counts and explicit NULL for the streak
  // label. INSERT is straight from the bound values; UPDATE uses
  // per-field CASE WHEN to honor preservation.
  const bossesSet = ach.bossesSlainTotal.set ? 1 : 0;
  const dropsSet  = ach.ultraRareDropsTotal.set ? 1 : 0;
  const streakSet = ach.verifiedStreakLabel.set ? 1 : 0;
  const achSet    = ach.hasAny ? 1 : 0;
  // W257 — equipped Arena title: same set/preserve sentinel pattern.
  const titleSet  = v.arenaTitle.set ? 1 : 0;
  const avatarSet = v.avatarId.set ? 1 : 0;
  const powerSet  = v.power.set ? 1 : 0;
  const avgStepsSet = v.avgStepsPerDay.set ? 1 : 0;
  const combatantSet = v.combatant.set ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO public_profile_summary (
        user_id, rank_tier, rank_division, rank_label,
        rank_sort_value, rank_points,
        client_updated_at, server_updated_at, metadata_json,
        bosses_slain_total, ultra_rare_drops_total,
        verified_streak_label, achievements_updated_at,
        arena_title, avatar_id, power, avg_steps_per_day, combatant_json,
        prestige_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL,
        COALESCE(?, 0), COALESCE(?, 0), ?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, 0), ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        rank_tier         = excluded.rank_tier,
        rank_division     = excluded.rank_division,
        rank_label        = excluded.rank_label,
        rank_sort_value   = excluded.rank_sort_value,
        rank_points       = excluded.rank_points,
        prestige_level    = excluded.prestige_level,
        client_updated_at = excluded.client_updated_at,
        server_updated_at = excluded.server_updated_at,
        bosses_slain_total      = CASE WHEN ? = 1
                                       THEN ?
                                       ELSE public_profile_summary.bosses_slain_total END,
        ultra_rare_drops_total  = CASE WHEN ? = 1
                                       THEN ?
                                       ELSE public_profile_summary.ultra_rare_drops_total END,
        verified_streak_label   = CASE WHEN ? = 1
                                       THEN ?
                                       ELSE public_profile_summary.verified_streak_label END,
        achievements_updated_at = CASE WHEN ? = 1
                                       THEN ?
                                       ELSE public_profile_summary.achievements_updated_at END,
        arena_title             = CASE WHEN ? = 1
                                       THEN ?
                                       ELSE public_profile_summary.arena_title END,
        avatar_id               = CASE WHEN ? = 1 THEN ? ELSE public_profile_summary.avatar_id END,
        power                   = CASE WHEN ? = 1 THEN ? ELSE public_profile_summary.power END,
        avg_steps_per_day       = CASE WHEN ? = 1 THEN ? ELSE public_profile_summary.avg_steps_per_day END,
        combatant_json          = CASE WHEN ? = 1 THEN ? ELSE public_profile_summary.combatant_json END`,
  )
    .bind(
      // INSERT bindings (positional with the VALUES clause)
      session.userId,
      v.rankTier,
      v.rankDivision,
      v.rankLabel,
      v.rankSortValue,
      v.rankPoints,
      v.clientUpdatedAt,
      serverUpdatedAt,
      ach.bossesSlainTotal.value,
      ach.ultraRareDropsTotal.value,
      ach.verifiedStreakLabel.value,
      achievementsUpdatedAt,
      v.arenaTitle.value,
      v.avatarId.value,
      v.power.value,
      v.avgStepsPerDay.value,
      v.combatant.value,
      v.prestige,   // W453 — appended last (the table's newest column → INSERT bind index 17)
      // ON CONFLICT CASE WHEN sentinels (sentinel, then value)
      bossesSet, ach.bossesSlainTotal.value,
      dropsSet,  ach.ultraRareDropsTotal.value,
      streakSet, ach.verifiedStreakLabel.value,
      achSet,    achievementsUpdatedAt,
      titleSet,  v.arenaTitle.value,
      avatarSet, v.avatarId.value,
      powerSet,  v.power.value,
      avgStepsSet, v.avgStepsPerDay.value,
      combatantSet, v.combatant.value,
    )
    .run();

  return jsonOk({
    ok: true,
    rankLabel: v.rankLabel,
    rankSortValue: v.rankSortValue,
    rankUpdatedAt: new Date(serverUpdatedAt).toISOString(),
    achievementsUpdatedAt: achievementsUpdatedAt !== null
      ? new Date(achievementsUpdatedAt).toISOString()
      : null,
  });
}
