/**
 * W1232 — owner 2026-11-17, sparring a friend's Echo: "make sure that your personal ultimate and
 * special attack and shadows are there as well". The earned execute (W757, a maxed ultra+ weapon's
 * 5th move) was stripped by sanitizeCombatant, so no duel ever armed it. Pinned here: the flag
 * survives the sanitizer, the kit gains the execute only for an eligible weapon, and only for true.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeCombatant } from './pvp/match-room';
import * as CC from './pvp/combat-core.js';

const stats = { STR: 81, VIT: 114, INT: 58, FOCUS: 90, WILL: 87, WLT: 13 };
const kitIds = (raw: unknown) => (CC as any).buildCombatant(sanitizeCombatant(raw)).kit.map((m: { id: string }) => m.id);

describe('W1232 — the earned special attack reaches the duel', () => {
  it('a maxed Duskforge fights with Reckoning as its 5th move', () => {
    expect(sanitizeCombatant({ stats, weaponId: 'duskforge_greatblade', exeMax: true }).exeMax).toBe(true);
    expect(kitIds({ stats, weaponId: 'duskforge_greatblade', exeMax: true })).toEqual(['cleave', 'oathstrike', 'immolate', 'bulwark', 'reckoning']);
  });
  it('the magic and ranged mythics get Ruin and Piercing Shot', () => {
    expect(kitIds({ stats, weaponId: 'reverie_staff', exeMax: true }).pop()).toBe('ruin');
    expect(kitIds({ stats, weaponId: 'vigil_bow', exeMax: true }).pop()).toBe('piercingshot');
  });
  it('no flag, a non-true flag, or an ineligible weapon: four moves', () => {
    expect(kitIds({ stats, weaponId: 'duskforge_greatblade' })).toHaveLength(4);
    expect(kitIds({ stats, weaponId: 'duskforge_greatblade', exeMax: 'true' })).toHaveLength(4);
    expect(sanitizeCombatant({ stats, weaponId: 'duskforge_greatblade', exeMax: 1 }).exeMax).toBeUndefined();
    expect(kitIds({ stats, weaponId: 'unarmed', exeMax: true })).not.toContain('reckoning');
  });
});
