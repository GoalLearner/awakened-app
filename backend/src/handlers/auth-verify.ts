/**
 * POST /v1/auth/verify
 *
 * Public endpoint (no Authorization header required — this IS the
 * auth-issuance endpoint). Receives an Apple identity token + an
 * alias, validates both, and either:
 *
 *   - For a returning user (apple_sub already in DB): issues a fresh
 *     session JWT bound to their existing alias. The submitted alias
 *     is IGNORED — once a user has set an alias, they keep it for
 *     this Phase B release (alias-change is v2.2+).
 *
 *   - For a new user: inserts a row, issues a session JWT. Alias
 *     uniqueness is enforced case-insensitively via DB UNIQUE INDEX
 *     ON LOWER(alias); collision returns 409 with 3 suggestions.
 *
 * BACKEND.md §8 + §13 are the design contract.
 */
import type { Env } from '../env';
import { verifyAppleIdentityToken } from '../apple-jwks';
import { issueSessionJwt } from '../session-jwt';
import { isProfane } from '../profanity';
import { generateAliasSuggestions } from '../alias-suggestions';
import { jsonOk, jsonError } from '../lib/responses';

interface AuthVerifyBody {
  identityToken?: unknown;
  alias?: unknown;
}

interface UserRow {
  id: string;
  alias: string;
}

function validateAliasShape(
  alias: unknown,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof alias !== 'string') {
    return { ok: false, reason: 'Alias is required and must be a string.' };
  }
  const trimmed = alias.trim();
  if (trimmed.length < 3 || trimmed.length > 20) {
    return { ok: false, reason: 'Alias must be 3–20 characters.' };
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(trimmed)) {
    return {
      ok: false,
      reason: 'Alias may only contain letters, numbers, spaces, underscores, and hyphens.',
    };
  }
  if (isProfane(trimmed)) {
    return { ok: false, reason: 'Alias contains content not allowed.' };
  }
  return { ok: true, value: trimmed };
}

export async function handleAuthVerify(request: Request, env: Env): Promise<Response> {
  // Rate limit per IP. CF-Connecting-IP is Cloudflare's authoritative
  // client-IP header (X-Forwarded-For can be spoofed; CF-Connecting-IP
  // cannot, behind the Cloudflare edge).
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rl = await env.RL_AUTH_VERIFY.limit({ key: ip });
  if (!rl.success) {
    return jsonError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again in a minute.');
  }

  // Parse JSON body
  let body: AuthVerifyBody;
  try {
    body = (await request.json()) as AuthVerifyBody;
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object') {
    return jsonError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }

  // Validate identity token presence (deeper verification happens below)
  if (typeof body.identityToken !== 'string' || body.identityToken.length === 0) {
    return jsonError(400, 'IDENTITY_TOKEN_REQUIRED', 'identityToken field is required.');
  }

  // Validate alias shape (cheap rejection before expensive token verify)
  const aliasCheck = validateAliasShape(body.alias);
  if (!aliasCheck.ok) {
    return jsonError(400, 'ALIAS_INVALID', aliasCheck.reason);
  }
  const alias = aliasCheck.value;

  // Verify the Apple identity token. Throws on any failure (bad
  // signature, wrong issuer/audience, expired, etc.).
  let appleSub: string;
  try {
    const verified = await verifyAppleIdentityToken(body.identityToken, env);
    appleSub = verified.sub;
  } catch (err) {
    // W739 SECURITY — static detail on this unauthenticated endpoint; log the real
    // verifier error (JWKS/iss/aud/exp specifics) server-side only.
    console.error('Apple identity token verification failed:', err);
    return jsonError(401, 'APPLE_TOKEN_INVALID', 'Token verification failed.');
  }

  // Returning user lookup — match by apple_sub (stable across alias changes).
  const existing = await env.DB.prepare(
    'SELECT id, alias FROM users WHERE apple_sub = ?',
  )
    .bind(appleSub)
    .first<UserRow>();

  if (existing) {
    const jwt = await issueSessionJwt(existing.id, existing.alias, env);
    return jsonOk({ jwt, alias: existing.alias, isNewUser: false });
  }

  // New user — check alias collision (case-insensitive).
  const collision = await env.DB.prepare(
    'SELECT 1 FROM users WHERE LOWER(alias) = LOWER(?) LIMIT 1',
  )
    .bind(alias)
    .first();

  if (collision) {
    // Generate 3 suggestions. Each is DB-checked unique so the client
    // can render them as tappable chips without further collision risk.
    const suggested = await generateAliasSuggestions(alias, appleSub, env);
    return jsonError(
      409,
      'ALIAS_TAKEN',
      `The alias "${alias}" is already taken. Try one of these or pick your own.`,
      { suggested },
    );
  }

  // Insert + issue JWT. crypto.randomUUID() is available in the
  // Workers runtime (Web Crypto API).
  const userId = crypto.randomUUID();
  const now = Date.now();
  try {
    await env.DB.prepare(
      'INSERT INTO users (id, apple_sub, alias, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(userId, appleSub, alias, now, now)
      .run();
  } catch (err) {
    // Race-condition catch: another request inserted the same alias
    // between our collision check and our insert. UNIQUE INDEX throws.
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE') || msg.includes('constraint')) {
      const suggested = await generateAliasSuggestions(alias, appleSub, env);
      return jsonError(
        409,
        'ALIAS_TAKEN',
        `The alias "${alias}" was just taken by another user.`,
        { suggested },
      );
    }
    throw err;
  }

  const jwt = await issueSessionJwt(userId, alias, env);
  return jsonOk({ jwt, alias, isNewUser: true });
}
