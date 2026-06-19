// bots.ts — the ranked AI bot roster (PVP.md §11.1/§14). When you Find Match, the
// matchmaker pairs you with the roster bot nearest your ELO; the MatchRoom DO resolves
// the bot's moves with the SHIPPED Ascent AI. Bots are server-authoritative content
// (never client input). Stat budgets scale with the ELO band so the ladder feels like a
// real climb; the AI is tier-2 (beatable). Tune freely — this is pure data.
import { eloTier } from './elo';

export interface BotDef {
  id: string;
  name: string;
  elo: number;
  combatant: { name: string; weaponId: string; weaponName: string; stats: Record<string, number>; avatar: string };
}

const ROSTER: BotDef[] = [
  // ── Bronze ──
  { id: 'cinderpaw', name: 'Cinderpaw', elo: 1360, combatant: { name: 'Cinderpaw', weaponId: 'unarmed', weaponName: 'Bare Fists', avatar: 'avatar-base.png', stats: { STR: 8, VIT: 7, INT: 5, FOCUS: 5, WILL: 4, WLT: 2 } } },
  { id: 'graveljaw', name: 'Gravel-Jaw', elo: 1450, combatant: { name: 'Gravel-Jaw', weaponId: 'hammerfall_warmaul', weaponName: 'Hammerfall Warmaul', avatar: 'avatar-paladin.png', stats: { STR: 11, VIT: 11, INT: 6, FOCUS: 5, WILL: 5, WLT: 3 } } },
  // ── Silver ──
  { id: 'ashveil', name: 'Ashveil', elo: 1540, combatant: { name: 'Ashveil', weaponId: 'kilnforged_warblade', weaponName: 'Kilnforged Warblade', avatar: 'avatar-warrior.png', stats: { STR: 15, VIT: 11, INT: 7, FOCUS: 9, WILL: 6, WLT: 3 } } },
  { id: 'mirewright', name: 'Mirewright', elo: 1630, combatant: { name: 'Mirewright', weaponId: 'vessel_of_refusal', weaponName: 'Vessel of Refusal', avatar: 'avatar-mage.png', stats: { STR: 9, VIT: 18, INT: 13, FOCUS: 8, WILL: 10, WLT: 4 } } },
  // ── Gold ──
  { id: 'stormcaller', name: 'Stormcaller', elo: 1730, combatant: { name: 'Stormcaller', weaponId: 'aetherspire_staff', weaponName: 'Aetherspire Staff', avatar: 'avatar-sage.png', stats: { STR: 8, VIT: 18, INT: 24, FOCUS: 11, WILL: 13, WLT: 4 } } },
  { id: 'quickstep', name: 'Quickstep', elo: 1830, combatant: { name: 'Quickstep', weaponId: 'ten_thousand_step_blade', weaponName: 'Ten-Thousand-Step Blade', avatar: 'avatar-assassin.png', stats: { STR: 15, VIT: 13, INT: 9, FOCUS: 20, WILL: 15, WLT: 4 } } },
  // ── Platinum ──
  { id: 'duskwarden', name: 'Dusk Warden', elo: 2060, combatant: { name: 'Dusk Warden', weaponId: 'duskforge_greatblade', weaponName: 'Duskforge Greatblade', avatar: 'avatar-warrior.png', stats: { STR: 26, VIT: 22, INT: 15, FOCUS: 15, WILL: 13, WLT: 5 } } },
  { id: 'wraithshot', name: 'Wraithshot', elo: 2180, combatant: { name: 'Wraithshot', weaponId: 'wraithwind_bow', weaponName: 'Wraithwind Bow', avatar: 'avatar-ranger.png', stats: { STR: 12, VIT: 20, INT: 15, FOCUS: 27, WILL: 22, WLT: 5 } } },
  // ── Diamond+ ──
  { id: 'oathbreaker', name: 'The Oathbreaker', elo: 2380, combatant: { name: 'The Oathbreaker', weaponId: 'titan_oathblade', weaponName: 'Titan Oathblade', avatar: 'avatar-paladin.png', stats: { STR: 32, VIT: 28, INT: 19, FOCUS: 19, WILL: 17, WLT: 6 } } },
  { id: 'ladynightfall', name: 'Lady Nightfall', elo: 2560, combatant: { name: 'Lady Nightfall', weaponId: 'nightfall_blade', weaponName: 'Nightfall', avatar: 'avatar-assassin.png', stats: { STR: 30, VIT: 28, INT: 24, FOCUS: 24, WILL: 22, WLT: 6 } } },
];

// Pick a bot near the player's ELO (a little randomness among the closest few so repeat
// queues vary). Deterministic fallback: the whole roster is always non-empty.
export function pickBot(elo: number): BotDef {
  const sorted = ROSTER.slice().sort((a, b) => Math.abs(a.elo - elo) - Math.abs(b.elo - elo));
  const pool = sorted.slice(0, 3);
  const i = Math.floor(Math.random() * pool.length);
  return pool[i] || sorted[0];
}

export function botMeta(bot: BotDef): { id: string; alias: string; elo: number; tier: string; weaponName: string; avatar: string } {
  return { id: bot.id, alias: bot.name, elo: bot.elo, tier: eloTier(bot.elo), weaponName: bot.combatant.weaponName, avatar: bot.combatant.avatar };
}
