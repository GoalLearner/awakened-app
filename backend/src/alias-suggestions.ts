/**
 * alias-suggestions.ts — Collision-recovery suggestion generator.
 *
 * Called by /v1/auth/verify when a new user's chosen alias collides
 * with an existing entry (case-insensitive). Returns up to 3 suggested
 * alternatives, each verified unique against the DB so the client can
 * present them as tappable chips without further collision risk.
 *
 * Three suggestion strategies, applied in order:
 *   1. base + random 2-digit suffix (e.g. "Hunter42")
 *   2. base + curated word suffix    (e.g. "HunterWolf")
 *   3. base + last-3-of-sub + 2-digit (e.g. "Hunter9k7-42")
 *
 * Strategy 3 incorporates a deterministic-per-user fingerprint from
 * the Apple sub so even pathological collisions resolve. Each
 * suggestion is checked against the DB; if it also collides
 * (vanishingly rare but possible at scale), we retry up to
 * MAX_ATTEMPTS times per strategy before giving up on that one.
 *
 * Suggestions are capped at 20 characters (max alias length per
 * BACKEND.md §13 alias validation rules).
 */
import type { Env } from './env';

const MAX_ALIAS_LEN = 20;
const MIN_ALIAS_LEN = 3;
const MAX_ATTEMPTS_PER_STRATEGY = 8;

/** Curated short-word pool. Mythic / discipline-coded vocabulary
 * aligned with the Solo-Leveling-flavored hunter narrative. */
const SUFFIX_WORDS: ReadonlyArray<string> = [
  'Hunter', 'Wolf', 'Star', 'Edge', 'Ace', 'Sage',
  'Echo', 'Drift', 'Spark', 'Stone', 'Vow', 'Iron',
  'Shade', 'Dawn', 'Wraith', 'Knight',
];

function randomTwoDigit(): string {
  return Math.floor(Math.random() * 90 + 10).toString(); // 10–99
}

function pickRandom<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function lastThreeOfSub(sub: string): string {
  // Strip Apple sub's separators (dots) and grab the last 3
  // alphanumeric chars. Returns at minimum an empty string for
  // pathological subs but realistically Apple subs are dense.
  const cleaned = sub.replace(/[^A-Za-z0-9]/g, '');
  return cleaned.slice(-3);
}

/**
 * Truncate to MAX_ALIAS_LEN, ensure ≥ MIN_ALIAS_LEN, return null if
 * we can't construct a valid candidate (caller skips).
 */
function clamp(candidate: string): string | null {
  const c = candidate.slice(0, MAX_ALIAS_LEN);
  return c.length >= MIN_ALIAS_LEN ? c : null;
}

/** Single DB lookup — returns true if alias is already taken. */
async function isAliasTaken(alias: string, env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 FROM users WHERE LOWER(alias) = LOWER(?) LIMIT 1',
  )
    .bind(alias)
    .first();
  return row !== null;
}

/**
 * Try a strategy up to MAX_ATTEMPTS_PER_STRATEGY times. Returns the
 * first unique candidate or null if all attempts collided.
 */
async function tryStrategy(
  strategy: () => string | null,
  alreadySeen: Set<string>,
  env: Env,
): Promise<string | null> {
  for (let i = 0; i < MAX_ATTEMPTS_PER_STRATEGY; i++) {
    const candidate = strategy();
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    if (alreadySeen.has(lower)) continue;
    if (await isAliasTaken(candidate, env)) {
      alreadySeen.add(lower);
      continue;
    }
    alreadySeen.add(lower);
    return candidate;
  }
  return null;
}

/**
 * Generate up to 3 unique alias suggestions for a colliding base.
 * Returns 0–3 results; client should render whatever comes back.
 */
export async function generateAliasSuggestions(
  base: string,
  sub: string,
  env: Env,
): Promise<string[]> {
  const suggestions: string[] = [];
  const seen = new Set<string>([base.toLowerCase()]);

  // Strategy 1: base + 2-digit suffix
  const s1 = await tryStrategy(
    () => clamp(`${base}${randomTwoDigit()}`),
    seen,
    env,
  );
  if (s1) suggestions.push(s1);

  // Strategy 2: base + curated word
  const s2 = await tryStrategy(
    () => clamp(`${base}${pickRandom(SUFFIX_WORDS)}`),
    seen,
    env,
  );
  if (s2) suggestions.push(s2);

  // Strategy 3: base + last-3-of-sub + 2-digit
  const subSuffix = lastThreeOfSub(sub);
  const s3 = await tryStrategy(
    () => clamp(`${base}${subSuffix}${randomTwoDigit()}`),
    seen,
    env,
  );
  if (s3) suggestions.push(s3);

  return suggestions;
}
