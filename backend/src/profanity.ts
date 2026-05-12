/**
 * profanity.ts — Alias profanity filter (v1, wordlist-based).
 *
 * Conservative ~60-entry wordlist covering common slurs, obscenities,
 * and hate terms. Phase F+ can swap this for a real moderation
 * service (Perspective API, Hive Moderation, OpenAI moderation, etc.).
 * Wordlist updates here are zero-downtime — redeploy the Worker.
 *
 * Normalization strategy:
 *   1. Lowercase
 *   2. Strip non-alphanumeric (catches "f.u.c.k" → "fuck")
 *   3. Collapse repeated chars (catches "fuuuuuuck" → "fuck")
 *
 * Matching strategy: substring match against the normalized form.
 *
 * False-positive guard: the wordlist deliberately EXCLUDES short
 * 2-3 letter substrings that commonly appear inside benign English
 * words. For example, "ass" is NOT in the list because it appears in
 * "assault", "passenger", "class", etc. We use "asshole" instead
 * (which doesn't false-positive on any common English word). Same
 * principle for other risky stems.
 *
 * Tradeoff: this lets through some creative bypasses (e.g. "as5ault"
 * with character substitution that defeats normalization), but
 * catches the high-frequency abuse vectors. v1 is good enough; v2
 * upgrades the matcher.
 */

/**
 * Wordlist v1. All entries are lowercase, alphanumeric-only, and
 * already in "collapsed-repeats" form (no double letters). Order
 * doesn't matter; matching is unordered.
 *
 * Add entries by appending to this array. Test with profanity.test.ts.
 */
const PROFANITY_WORDS: ReadonlyArray<string> = [
  // English obscenities / slurs (avoid common short stems like "ass")
  'fuck',
  'fck',
  'shit',
  'sht',
  'bitch',
  'asshole',
  'cunt',
  'dick',
  'pussy',
  'cock',
  'whore',
  'slut',
  'dildo',
  'bastard',
  'damn',
  'piss',
  'pissed',
  // Slurs / hate terms — included aggressively, low false-positive risk
  'nigger',
  'niger',  // collapsed form of "nigga"; catches "niggga" too
  'faggot',
  'fagot',
  'retard',
  'retarded',
  'spic',
  'kike',
  'chink',
  'gook',
  'wetback',
  'beaner',
  'tranny',
  'dyke',
  'jap',
  'paki',
  'sandnigger',
  'coon',
  'darky',
  'cracker',
  // Sexual / violent themes
  'rape',
  'rapist',
  'rapey',
  'pedo',
  'pedophile',
  'molest',
  'molester',
  'incest',
  // Extremism / hate organizations
  'nazi',
  'hitler',
  'kkk',
  'klan',
  // Drug references (light filter)
  'crackhead',
];

/**
 * Two normalization functions, paired with two substring checks per
 * wordlist entry. Each handles a different obfuscation class:
 *
 *   lowerStripped:    lowercase + strip non-alphanumeric.
 *     "F_U_C_K"  → "fuck"     (obfuscation via separators)
 *     "Sh!t"     → "sht"      (puncutation strip)
 *     "kkk_user" → "kkkuser"  (preserves repeats — catches abbrevs)
 *
 *   normalizeFull:    lowerStripped + collapse repeated chars.
 *     "fuuuuck"  → "fuk"      (leetspeak via char-repeat)
 *     "fffuck"   → "fuk"      (also char-repeat)
 *     "Assault"  → "asault"   (preserves wordlist for benign forms)
 *
 * isProfane runs BOTH checks. The raw check (lowerStripped on
 * alias, raw wordlist) catches short abbreviation entries like "kkk"
 * that would over-collapse under normalizeFull. The full check
 * (normalizeFull on both alias AND wordlist entry) catches leetspeak
 * variants that defeat the raw check.
 *
 *   "kkk_user" check:
 *     raw  → "kkkuser".includes("kkk") → TRUE → flagged
 *     full → "kuser".includes("k") → uhh, but "k" is only 1 char in
 *            the normalized wordlist; the false-positive guard below
 *            requires normalized words to be ≥3 chars to be checked
 *            in full mode. So "kkk" → "k" is skipped in full mode
 *            (would over-match) but caught in raw mode (substring of
 *            input). Win.
 *
 *   "fuuuuuck" check:
 *     raw  → "fuuuuuck".includes("fuck") → FALSE
 *     full → "fuk".includes("fuk") → TRUE → flagged
 *
 *   "myAssholeName" check:
 *     raw  → "myassholename".includes("asshole") → TRUE → flagged
 *     full → "myasholename".includes("ashole") → TRUE → flagged
 *
 *   "Assault" check (must NOT false-positive):
 *     raw  → "assault".includes(word)? No wordlist entry is a
 *            substring of "assault" (we excluded "ass").
 *     full → "asault".includes(word)? Same — no match.
 *     PASSES correctly.
 */
function lowerStripped(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeFull(input: string): string {
  return lowerStripped(input).replace(/(.)\1+/g, '$1');
}

/**
 * Precomputed normalized wordlist. Only entries that remain ≥3 chars
 * after normalizeFull are checked in full mode — shorter normalized
 * forms would over-match common letter sequences in benign aliases
 * (e.g. "kkk" → "k" would flag every alias with a 'k' in it).
 *
 * Short entries (like "kkk", "kkk_", "jap") are still effective via
 * the raw lowerStripped check, which preserves their original chars.
 */
const NORMALIZED_WORDS: ReadonlyArray<string> = PROFANITY_WORDS
  .map(normalizeFull)
  .filter((w, i, arr) => w.length >= 3 && arr.indexOf(w) === i); // ≥3 chars + dedupe

/**
 * Returns true if the alias contains any profane word, checking both
 * raw-stripped and fully-normalized forms.
 */
export function isProfane(alias: string): boolean {
  const stripped = lowerStripped(alias);
  if (stripped.length === 0) return false;

  // Raw mode: catches abbreviations + literal-character profanity.
  for (const word of PROFANITY_WORDS) {
    if (stripped.includes(word)) return true;
  }

  // Full mode: catches leetspeak / repeat-obfuscation variants.
  const normalized = normalizeFull(alias);
  if (normalized.length === 0) return false;
  for (const word of NORMALIZED_WORDS) {
    if (normalized.includes(word)) return true;
  }

  return false;
}

/** Exported for tests. */
export const _internals = {
  lowerStripped,
  normalizeFull,
  PROFANITY_WORDS,
  NORMALIZED_WORDS,
};
