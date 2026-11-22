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

// ── W1275 — owner 2026-11-22: "Make sure there's no foul language usernames and none disguised with numbers or etc". A probe
// of the v1 filter let through "Nigga", "N1gga", "S1ut", "Fuk", "Phuck", "Fvck", "Sh1iit", "Tw4t", "N199er", "Wanker",
// "PornKing", "BigAss", "xXCumXx", "KYS", "Heil" — and refused "Dickens", "Hancock", "Cocktail", "Japan", "Nigeria",
// "Connor" (coon → con). The alias check (isProfane) now also:
//   1. folds digits both ways the trolls use them: 1 → i AND 1 → l, 9 / 6 → g (the old fold had 1 → i only);
//   2. collapses repeats AFTER the fold ("Sh1iit" → shit);
//   3. carries ALIAS_EXTRA, the obscenities and spellings the board's prose list leaves out (the board is unchanged);
//   4. checks SHORT words (ass, cum, fag, tits …) as whole pieces of the name only — split at spaces, _ and -, at a
//      lower→Upper turn ("BigAss") and at letters↔digits — so "Classic", "Assassin" and "Document" stay fine;
//   5. strips BENIGN words (real names, places, words that merely contain a stem: Hancock, Japan, Therapist …) before
//      the substring checks, so "Hancock" passes but "HancockFuck" does not;
//   6. drops the collapsed forms that are ordinary syllables (coon → "con", piss → "pis", boob → "bob").
const ALIAS_EXTRA: ReadonlyArray<string> = [
  'nigga', 'nigg', 'nigr', 'niga', 'nibba', 'negroid',
  'fuk', 'fuq', 'fvck', 'phuck', 'phuk', 'fukk', 'muthafuck', 'mothafuck',
  'shyt', 'biatch', 'biotch', 'kunt', 'twat', 'wank', 'jizz', 'porn', 'penis', 'vagina', 'skank', 'hooker',
  'testicle', 'scrotum', 'bollock', 'blowjob', 'handjob', 'rimjob', 'cumshot', 'cumslut', 'hentai', 'bukkake',
  'sloot', 'ahole', 'asswipe', 'asshat', 'dumbass', 'jackass', 'fatass',
  'killyourself', 'killurself', 'kilyourself', 'swastika', 'siegheil', 'whitepower', 'gasthejews', 'heilhitler',
];
const ALIAS_SHORT: ReadonlySet<string> = new Set([
  'ass', 'asses', 'arse', 'cum', 'cums', 'fag', 'fags', 'hoe', 'hoes', 'tit', 'tits', 'titty', 'titties', 'boob', 'boobs',
  'sex', 'anal', 'kys', 'thot', 'heil', 'nude', 'nudes', 'horny', 'milf', 'dilf', 'lesbo', 'homo',
  'nig', 'nigs', 'fck', 'fk', 'fuc', 'shat', 'cok', 'dik', 'puss', 'smut', 'tranny', 'chink',
]);
const ALIAS_BENIGN: ReadonlyArray<string> = [
  'japan', 'japanese', 'pakistan', 'pakistani', 'nigeria', 'nigerian', 'scunthorpe', 'sussex', 'essex', 'middlesex',
  'dickens', 'dickson', 'dickinson', 'benedick', 'dickie', 'hancock', 'peacock', 'cocktail', 'cockpit', 'cockatoo', 'cockatiel',
  'babcock', 'hitchcock', 'woodcock', 'shuttlecock', 'cockburn', 'raccoon', 'cocoon', 'tycoon', 'spice', 'spicy', 'hospice',
  'auspicious', 'conspicuous', 'despicable', 'grape', 'drape', 'scrape', 'trapeze', 'therapist', 'torpedo', 'ashton', 'ashtray',
  'nazir', 'nazim', 'nutcracker', 'firecracker', 'analyst', 'analysis', 'canal', 'banal', 'document', 'cucumber',
  'penistone', 'shitake', 'shiitake', 'cockney', 'scrapes', 'grapes', 'drapes',
];
const ALIAS_SKIP_COLLAPSED: ReadonlySet<string> = new Set(['con', 'pis', 'bob', 'nig', 'fuk']);
const ALIAS_LONG: ReadonlyArray<string> = Array.from(new Set([...PROFANITY_WORDS, ...ALIAS_EXTRA]));
const ALIAS_LONG_COLLAPSED: ReadonlyArray<string> = Array.from(new Set(ALIAS_LONG.map(normalizeFull)))
  .filter((w) => w.length >= 3 && !ALIAS_SKIP_COLLAPSED.has(w));
function foldDigits(input: string, one: 'i' | 'l'): string {
  const map: Record<string, string> = { '0': 'o', '1': one, '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': one };
  return input.toLowerCase().replace(/./g, (c) => map[c] ?? c).replace(/[^a-z]/g, '');
}
function stripBenign(s: string): string {
  let out = s;
  for (const w of ALIAS_BENIGN) if (out.includes(w)) out = out.split(w).join('');
  return out;
}
function aliasPieces(alias: string): string[] {
  return String(alias || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}
/** W1275 — the stricter alias pass (see above). */
function isProfaneAliasV2(alias: string): boolean {
  const forms = new Set<string>();
  for (const s of [lowerStripped(alias), foldDigits(alias, 'i'), foldDigits(alias, 'l')]) {
    if (!s) continue;
    forms.add(stripBenign(s));
    forms.add(stripBenign(s.replace(/(.)\1+/g, '$1')));
  }
  for (const s of forms) {
    if (!s) continue;
    for (const w of ALIAS_LONG) if (w.length >= 3 && s.includes(w)) return true;
    for (const w of ALIAS_LONG_COLLAPSED) if (s.includes(w)) return true;
  }
  const pieces = aliasPieces(alias);
  const whole = String(alias || '').replace(/[^A-Za-z0-9]/g, '');
  for (const p of whole ? [...pieces, whole] : pieces) {
    for (const s of [p.toLowerCase(), foldDigits(p, 'i'), foldDigits(p, 'l')]) {
      if (!s) continue;
      // as written, every repeat collapsed ("Cuuum"), or long runs cut to two ("Asss" → ass)
      if (ALIAS_SHORT.has(s) || ALIAS_SHORT.has(s.replace(/(.)\1+/g, '$1')) || ALIAS_SHORT.has(s.replace(/(.)\1{2,}/g, '$1$1'))) return true;
    }
  }
  return false;
}

/**
 * Returns true if the alias contains any profane word, checking both
 * raw-stripped and fully-normalized forms.
 */
export function isProfane(alias: string): boolean {
  const stripped = lowerStripped(alias);
  if (stripped.length === 0) return false;
  return isProfaneAliasV2(alias);   // W1275 — replaces the v1 passes below (kept for the record)

}

/** The v1 alias passes (before W1275), kept for comparison tests. */
export function isProfaneV1(alias: string): boolean {
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
  if (folded.length > 0 && RESERVED_ALIASES.has(folded)) return true;
  return isStaffAlias(alias);
}

// W1075 SECURITY — staff and system words. "Awakened Support wants to join your guild" or a
// board reply from "Moderator" reads as the developers; nothing marked them as a hunter.
// Whole-word match on the alias split at its separators (space, underscore, hyphen), plus the
// app's own name anywhere in it. Short real names stay available: "Dev" (a given name) and
// "Team" are deliberately absent.
const STAFF_WORDS: ReadonlySet<string> = new Set([
  'admin', 'admins', 'administrator', 'mod', 'mods', 'moderator', 'moderators',
  'system', 'support', 'official', 'staff', 'developer', 'developers', 'owner',
]);
export function isStaffAlias(alias: string): boolean {
  const lower = String(alias || '').toLowerCase();
  if (lower.replace(/[^a-z0-9]/g, '').includes('awakened')) return true;
  return lower.split(/[\s_-]+/).some((w) => STAFF_WORDS.has(w));
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
  aliasPieces,
  foldDigits,
  lowerStripped,
  normalizeFull,
  deLeet,
  PROFANITY_WORDS,
  NORMALIZED_WORDS,
  RESERVED_ALIASES,
};
