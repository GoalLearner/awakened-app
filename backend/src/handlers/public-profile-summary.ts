/**
 * Public profile summary handler (v3 Phase 1z.190).
 *
 *   PUT /v1/users/me/public-profile-summary
 *
 * Authenticated. Upserts the caller's row in `public_profile_summary`
 * with a preformatted public rank summary. The backend NEVER
 * recomputes rank from XP, HealthKit, or the opaque
 * `user_state_snapshots.state_json` blob — rank derivation lives
 * exclusively in the client `getRankDivisionInfo` helper (single
 * source of truth, locked in 1z.189).
 *
 * Validation is shape + range only:
 *   - rankTier ∈ {E, D, C, B, A, S, S+}
 *   - rankDivision ∈ {I, II, III, null}
 *   - if rankTier === 'S+'  then rankDivision === null
 *   - if rankTier !== 'S+'  then rankDivision ∈ {I, II, III}
 *   - rankLabel matches `<tier>` (S+) or `<tier> <division>`
 *   - rankSortValue is a finite integer in [0, 6_999_999_999]
 *   - rankPoints is a finite integer in [0, 999_999_999]
 *   - clientUpdatedAt parses as a finite Date
 *
 * Read path: handlers/friends.ts' serializeFriendRow LEFT JOINs
 * this table and merges optional rank fields onto the friend row.
 * `rank_points` is intentionally withheld from the friends payload
 * in v1 (privacy: hides exact XP magnitude); only rankLabel /
 * rankSortValue / rankTier / rankDivision / rankUpdatedAt leak out.
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

interface PutBody {
  rankTier?: unknown;
  rankDivision?: unknown;
  rankLabel?: unknown;
  rankSortValue?: unknown;
  rankPoints?: unknown;
  clientUpdatedAt?: unknown;
}

interface Validated {
  rankTier: string;
  rankDivision: string | null;
  rankLabel: string;
  rankSortValue: number;
  rankPoints: number;
  clientUpdatedAt: string;
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

  return {
    ok: true,
    value: {
      rankTier,
      rankDivision,
      rankLabel: body.rankLabel,
      rankSortValue: body.rankSortValue,
      rankPoints: body.rankPoints,
      clientUpdatedAt: body.clientUpdatedAt,
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

  // Upsert by user_id. metadata_json stays NULL in v1; reserved for
  // future achievement payloads. The PRIMARY KEY conflict path
  // updates every mutable field but never touches the FK.
  await env.DB.prepare(
    `INSERT INTO public_profile_summary (
        user_id, rank_tier, rank_division, rank_label,
        rank_sort_value, rank_points,
        client_updated_at, server_updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(user_id) DO UPDATE SET
        rank_tier         = excluded.rank_tier,
        rank_division     = excluded.rank_division,
        rank_label        = excluded.rank_label,
        rank_sort_value   = excluded.rank_sort_value,
        rank_points       = excluded.rank_points,
        client_updated_at = excluded.client_updated_at,
        server_updated_at = excluded.server_updated_at`,
  )
    .bind(
      session.userId,
      v.rankTier,
      v.rankDivision,
      v.rankLabel,
      v.rankSortValue,
      v.rankPoints,
      v.clientUpdatedAt,
      serverUpdatedAt,
    )
    .run();

  return jsonOk({
    ok: true,
    rankLabel: v.rankLabel,
    rankSortValue: v.rankSortValue,
    rankUpdatedAt: new Date(serverUpdatedAt).toISOString(),
  });
}
