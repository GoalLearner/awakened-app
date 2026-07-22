/**
 * profanity.test.ts — Profanity-filter behavioral tests.
 *
 * Verifies the four canonical scenarios from BACKEND.md §13 Q3:
 *   - Clean alias passes (no false-positive)
 *   - Obvious profanity fails
 *   - Leetspeak variant fails (via normalization)
 *   - "Assault" passes (no false-positive on benign-with-profane-stem)
 */
import { describe, expect, it } from 'vitest';
import { isProfane, isReservedAlias, _internals } from './profanity';

describe('isProfane', () => {
  describe('clean aliases pass', () => {
    it('accepts a typical name', () => {
      expect(isProfane('Hunter42')).toBe(false);
    });

    it('accepts Awakened-themed aliases', () => {
      expect(isProfane('ShadowMonarch')).toBe(false);
      expect(isProfane('Richie')).toBe(false);
      expect(isProfane('DevUser')).toBe(false);
      expect(isProfane('TopDog')).toBe(false);
    });

    it('accepts aliases with separators', () => {
      expect(isProfane('hunter_42')).toBe(false);
      expect(isProfane('shadow-runner')).toBe(false);
      expect(isProfane('my name')).toBe(false);
    });

    it('accepts the empty string (caller validates length separately)', () => {
      expect(isProfane('')).toBe(false);
    });
  });

  describe('obvious profanity fails', () => {
    it('flags common obscenities', () => {
      expect(isProfane('fuck')).toBe(true);
      expect(isProfane('shit')).toBe(true);
      expect(isProfane('bitch')).toBe(true);
      expect(isProfane('asshole')).toBe(true);
    });

    it('flags slurs', () => {
      expect(isProfane('nigger')).toBe(true);
      expect(isProfane('faggot')).toBe(true);
    });

    it('flags hate-org references', () => {
      expect(isProfane('NaziKnight')).toBe(true);
      expect(isProfane('kkk_user')).toBe(true);
    });

    it('flags as substring inside benign-looking padding', () => {
      expect(isProfane('xfuckx')).toBe(true);
      expect(isProfane('myAssholeName')).toBe(true);
    });
  });

  describe('leetspeak + obfuscation variants fail', () => {
    it('catches dot-separated obfuscation via normalization', () => {
      expect(isProfane('f.u.c.k')).toBe(true);
      expect(isProfane('s-h-i-t')).toBe(true);
    });

    it('catches repeated-character obfuscation via collapse', () => {
      expect(isProfane('fuuuuck')).toBe(true);
      expect(isProfane('fffuck')).toBe(true);
      expect(isProfane('bittttch')).toBe(true);
    });

    it('catches mixed-case + separator combos', () => {
      expect(isProfane('F_U_C_K')).toBe(true);
      expect(isProfane('Sh!t')).toBe(true);
    });
  });

  describe('benign-with-profane-stem passes', () => {
    it('does NOT flag "Assault" (no "ass" entry in wordlist)', () => {
      expect(isProfane('Assault')).toBe(false);
    });

    it('does NOT flag "Class" or "Brass"', () => {
      expect(isProfane('Class')).toBe(false);
      expect(isProfane('Brass')).toBe(false);
    });

    it('does NOT flag "Passenger" or "Glasses"', () => {
      expect(isProfane('Passenger')).toBe(false);
      expect(isProfane('Glasses')).toBe(false);
    });

    it('does NOT flag "Scunthorpe" (the famously-blocked town name)', () => {
      // The infamous case for naive profanity filters — "Scunthorpe"
      // contains "cunt" as substring. Our filter DOES catch this
      // because the wordlist includes "cunt". This is acknowledged
      // tradeoff: aggressive filtering > Scunthorpe support.
      // Documenting here to keep the assumption visible.
      expect(isProfane('Scunthorpe')).toBe(true);
    });
  });

  describe('internals.lowerStripped', () => {
    const { lowerStripped } = _internals;
    it('lowercases + strips non-alphanumeric', () => {
      expect(lowerStripped('Hello')).toBe('hello');
      expect(lowerStripped('H.E.L.L.O')).toBe('hello');
    });
    it('preserves repeated chars', () => {
      expect(lowerStripped('hellllo')).toBe('hellllo');
    });
    it('handles empty', () => {
      expect(lowerStripped('')).toBe('');
    });
  });

  describe('internals.normalizeFull', () => {
    const { normalizeFull } = _internals;
    it('lowercases + strips + collapses repeats', () => {
      expect(normalizeFull('Hello')).toBe('helo');
      expect(normalizeFull('h.e.l.l.o')).toBe('helo');
      expect(normalizeFull('hellllo')).toBe('helo');
    });
    it('handles empty', () => {
      expect(normalizeFull('')).toBe('');
    });
  });

  // W745 — leetspeak substitution must not be a bypass ("H1tler" is the whole point).
  describe('leetspeak / symbol-substitution bypasses are blocked', () => {
    const cases = ['H1tler', 'Hitl3r', 'N4zi', 'N1gger', 'N!gger', 'F4ggot', 'Sh1t', '5h1t', 'B1tch', '@sshole'];
    cases.forEach((c) => {
      it(`blocks "${c}"`, () => expect(isProfane(c)).toBe(true));
    });
  });

  // W745 — the leet fold must NOT newly false-positive on benign names with digits.
  describe('benign aliases with digits/leet still pass', () => {
    const ok = ['St3ph3n', 'L1am', '5cott', 'Al1ce', 'Scott', 'Passenger', 'Classic', 'Cassie', 'StepLord'];
    ok.forEach((c) => {
      it(`allows "${c}"`, () => expect(isProfane(c)).toBe(false));
    });
  });

  // W745 — reserved impersonation/hate-figure names → surfaced as "taken", NOT profanity.
  describe('isReservedAlias — figure names (exact leet-folded match)', () => {
    it('flags the reserved names + their leet variants', () => {
      ['Adolf', 'Ad0lf', 'Stalin', 'St4lin', 'Mussolini', 'Isis', '1515', 'Osama',
        'binLaden', 'Saddam', 'AlQaeda', 'Putin', 'Trump', 'Lenin'].forEach((c) => {
        expect(isReservedAlias(c)).toBe(true);
      });
    });
    it('does NOT match real names that merely CONTAIN a reserved token', () => {
      // The whole reason it's exact-match, not substring.
      ['Adolfo', 'Adolfina', 'Crisis', 'CrisisManager', 'Stalingrad', 'Isisco',
        'Hussein', 'Osamu', 'StepLord', 'Zeus', 'Trumpet', 'Lenina', 'Putina'].forEach((c) => {
        expect(isReservedAlias(c)).toBe(false);
      });
    });
    it('reserved names are NOT flagged as profanity (they route to ALIAS_TAKEN instead)', () => {
      // Adolf/Stalin/Isis must stay OUT of the profanity path so real people aren't accused.
      ['Adolf', 'Stalin', 'Isis'].forEach((c) => expect(isProfane(c)).toBe(false));
    });
  });
});
