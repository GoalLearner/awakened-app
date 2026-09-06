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
 * W745 — leetspeak fold: map the common digit/symbol letter-substitutions to
 * letters, THEN strip to a-z. Closes the "H1tler" / "N1gger" / "F4ggot" / "Sh1t"
 * bypass class that defeats both the raw and repeat-collapse checks (a determined
 * troll who can't type "Hitler" just types "H1tler"). Safe against false positives
 * for the same reason the rest of the list is: a benign alias only trips it if its
 * de-leeted form actually CONTAINS a curated wordlist word, and short benign stems
 * (like "ass") were deliberately excluded. "1" maps to "i" (the high-frequency case
 * for these words: n1gger, h1tler); l-substitution is a rarer vector left to v2.
 */
const LEET_MAP: Readonly<Record<string, string>> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i',
};
function deLeet(input: string): string {
  const mapped = input.toLowerCase().replace(/./g, (c) => LEET_MAP[c] ?? c);
  return mapped.replace(/[^a-z]/g, '');
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

  // Full mode: catches repeat-obfuscation variants ("fuuuuck" → "fuk").
  const normalized = normalizeFull(alias);
  if (normalized.length > 0) {
    for (const word of NORMALIZED_WORDS) {
      if (normalized.includes(word)) return true;
    }
  }

  // W745 Leet mode: catches digit/symbol letter-substitution ("H1tler", "N1gger",
  // "F4ggot", "Sh1t") that survives both checks above.
  const deleeted = deLeet(alias);
  if (deleeted.length > 0) {
    for (const word of PROFANITY_WORDS) {
      if (deleeted.includes(word)) return true;
    }
  }

  return false;
}

/**
 * W745 — RESERVED aliases: impersonation / hate-figure names (Adolf, Stalin, Isis,
 * bin Laden, …) that we refuse but which are ALSO real given names/surnames for real
 * people (Adolfo, Isis-the-name, the surname Hussein). So instead of the accusatory
 * "content not allowed" (isProfane), the caller returns the ordinary ALIAS_TAKEN
 * response — the name is quietly unavailable, no one is called a slur, and a troll gets
 * no reaction. Kept SEPARATE from PROFANITY_WORDS on purpose:
 *   - profanity uses SUBSTRING match (catches "NaziBoy") + returns "not allowed";
 *   - reserved uses EXACT leet-folded match + returns "taken".
 * Exact match is the whole point: "adolf" refuses "Adolf"/"Ad0lf" but NOT "Adolfo";
 * "isis" refuses "Isis"/"1515" but NOT "Crisis"; "stalin" not "Stalingrad".
 * All entries lowercase a-z only (the deLeet-folded form). Extend freely.
 */
const RESERVED_ALIASES: ReadonlySet<string> = new Set([
  'adolf', 'stalin', 'mussolini', 'himmler', 'goebbels', 'mengele', 'polpot',
  'osama', 'binladen', 'saddam', 'isis', 'alqaeda',
  // W745c — political/dictator figures (owner-requested). Exact match keeps collateral
  // tiny: "trump" refuses "Trump" but not "Trumpet"; "lenin" not "Lenina".
  'putin', 'trump', 'lenin',
  // DELIBERATELY NOT 'hussein': it's a top-tier global given name/surname (hundreds of
  // millions of real people) — even exact-match would refuse their real name for ~zero
  // impersonation benefit, since 'saddam' already covers the dictator. Do not "helpfully" add.
]);

/**
 * True if the alias IS a reserved figure/impersonation name (exact match on the
 * leet-folded, alpha-only form). Caller should surface this as ALIAS_TAKEN, not as
 * profanity. Non-substring by design so real names that merely CONTAIN one of these
 * (Adolfo, Crisis, Stalingrad) are unaffected.
 */
export function isReservedAlias(alias: string): boolean {
  const folded = deLeet(alias);
  return folded.length > 0 && RESERVED_ALIASES.has(folded);
}

// ── W914 — PROSE mode for the Community board. isProfane() is an ALIAS filter:
// substring match on a normalizer that collapses repeats, so "coon" becomes "con"
// and every prose word containing it ("second", "connect", "economy") reads as a
// slur; "rape" hits "grape", "sht" hits "ashtray", "jap" hits "Japan". A board
// post is many ordinary words, so this variant is word-aware:
//   ≥5-letter entries  → anywhere in the word (nigger, faggot, asshole, bastard …)
//   4-letter big-six   → anywhere (fuck, shit, cunt, slut, dick, cock: "bullshit")
//   other 4-letter     → the word itself or with a plain suffix (rapes, raped, raping)
//   ≤3-letter entries  → the whole word only (jap, kkk, and the collapsed "con")
// Leet and repeat-collapsed forms go through the same rules.
const PROSE_COMPOUND: ReadonlySet<string> = new Set(['fuck', 'shit', 'cunt', 'slut', 'dick', 'cock']);
const PROSE_SUFFIXES: ReadonlyArray<string> = ['s', 'es', 'ed', 'er', 'ers', 'ing', 'in', 'a', 'az', 'head', 'heads', 'hole', 'holes', 'face', 'faces', 'wad', 'wads', 'bag', 'bags', 'tard', 'tards', 'boy', 'boys'];
function matchesProseWord(hay: string, w: string): boolean {
  if (!hay || !w) return false;
  if (w.length >= 5) return hay.includes(w);
  if (w.length <= 3) return hay === w;
  if (PROSE_COMPOUND.has(w)) return hay.includes(w);
  if (hay === w) return true;
  const stem = w.endsWith('e') ? w.slice(0, -1) : w;
  for (const suf of PROSE_SUFFIXES) { if (hay === w + suf || hay === stem + suf) return true; }
  return false;
}
/** True when ONE prose word is a slur or obscenity (see the rules above). */
export function isProfaneWord(token: string): boolean {
  const stripped = lowerStripped(token);
  if (stripped.length === 0) return false;
  for (const w of PROFANITY_WORDS) { if (matchesProseWord(stripped, w)) return true; }
  const normalized = normalizeFull(token);
  for (const w of NORMALIZED_WORDS) { if (matchesProseWord(normalized, w)) return true; }
  const deleeted = deLeet(token);
  for (const w of PROFANITY_WORDS) { if (matchesProseWord(deleeted, w)) return true; }
  return false;
}

/** Exported for tests. */
export const _internals = {
  lowerStripped,
  normalizeFull,
  deLeet,
  PROFANITY_WORDS,
  NORMALIZED_WORDS,
  RESERVED_ALIASES,
};
