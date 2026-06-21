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
  { id: 'ashveil', name: 'Ashveil', elo: 1540, combatant: { name: 'Ashveil', weaponId: 'kilnforged_warblade', weaponName: 'Kilnforged Warblade', avatar: 'avatar-warrior.png', stats: { STR: 16, VIT: 13, INT: 8, FOCUS: 10, WILL: 7, WLT: 3 } } },
  { id: 'mirewright', name: 'Mirewright', elo: 1630, combatant: { name: 'Mirewright', weaponId: 'vessel_of_refusal', weaponName: 'Vessel of Refusal', avatar: 'avatar-mage.png', stats: { STR: 10, VIT: 21, INT: 16, FOCUS: 10, WILL: 13, WLT: 4 } } },
  // ── Gold ── (W445 — budgets lifted: a progressed player should EARN Gold, not farm it)
  { id: 'stormcaller', name: 'Stormcaller', elo: 1730, combatant: { name: 'Stormcaller', weaponId: 'aetherspire_staff', weaponName: 'Aetherspire Staff', avatar: 'avatar-sage.png', stats: { STR: 10, VIT: 24, INT: 30, FOCUS: 15, WILL: 18, WLT: 4 } } },
  { id: 'quickstep', name: 'Quickstep', elo: 1830, combatant: { name: 'Quickstep', weaponId: 'ten_thousand_step_blade', weaponName: 'Ten-Thousand-Step Blade', avatar: 'avatar-assassin.png', stats: { STR: 21, VIT: 19, INT: 13, FOCUS: 30, WILL: 21, WLT: 4 } } },
  // ── Platinum ── (W446 — +50% over the original baseline: a Platinum Echo must fight like a real
  //                Platinum player, who is already a high-level hunter.)
  { id: 'duskwarden', name: 'Dusk Warden', elo: 2060, combatant: { name: 'Dusk Warden', weaponId: 'duskforge_greatblade', weaponName: 'Duskforge Greatblade', avatar: 'avatar-warrior.png', stats: { STR: 39, VIT: 33, INT: 23, FOCUS: 23, WILL: 20, WLT: 7 } } },
  { id: 'wraithshot', name: 'Wraithshot', elo: 2180, combatant: { name: 'Wraithshot', weaponId: 'wraithwind_bow', weaponName: 'Wraithwind Bow', avatar: 'avatar-ranger.png', stats: { STR: 18, VIT: 30, INT: 23, FOCUS: 41, WILL: 33, WLT: 7 } } },
  // ── Diamond ── (W446 — +50% over baseline: a Diamond Echo represents a Diamond player — top-tier.)
  { id: 'oathbreaker', name: 'The Oathbreaker', elo: 2380, combatant: { name: 'The Oathbreaker', weaponId: 'titan_oathblade', weaponName: 'Titan Oathblade', avatar: 'avatar-paladin.png', stats: { STR: 48, VIT: 42, INT: 29, FOCUS: 29, WILL: 26, WLT: 9 } } },
  { id: 'ladynightfall', name: 'Lady Nightfall', elo: 2560, combatant: { name: 'Lady Nightfall', weaponId: 'nightfall_blade', weaponName: 'Nightfall', avatar: 'avatar-assassin.png', stats: { STR: 45, VIT: 42, INT: 36, FOCUS: 36, WILL: 33, WLT: 9 } } },
  // ── Master ── (NEW W445, lifted W446 to stay above the buffed Diamond — extends the ceiling past
  //              Diamond per REVIEW_S3's recommendation so 2600+ players face a genuine climb.)
  { id: 'ironrevenant', name: 'Ironclad Revenant', elo: 2700, combatant: { name: 'Ironclad Revenant', weaponId: 'duskforge_greatblade', weaponName: 'Duskforge Greatblade', avatar: 'avatar-warrior.png', stats: { STR: 56, VIT: 54, INT: 34, FOCUS: 34, WILL: 34, WLT: 9 } } },
  { id: 'tempestsovereign', name: 'Tempest Sovereign', elo: 2880, combatant: { name: 'Tempest Sovereign', weaponId: 'aetherspire_staff', weaponName: 'Aetherspire Staff', avatar: 'avatar-sage.png', stats: { STR: 22, VIT: 54, INT: 64, FOCUS: 40, WILL: 44, WLT: 9 } } },
  // ── Awakened ── (NEW W445, lifted W446; the apex Echoes. Budgets approach a maxed loadout —
  //                beating these should feel like a real fight, even for the top of the ladder.)
  { id: 'firstflame', name: 'The First Flame', elo: 3050, combatant: { name: 'The First Flame', weaponId: 'titan_oathblade', weaponName: 'Titan Oathblade', avatar: 'avatar-paladin.png', stats: { STR: 72, VIT: 62, INT: 42, FOCUS: 42, WILL: 40, WLT: 10 } } },
  { id: 'eclipsesovereign', name: 'Eclipse Sovereign', elo: 3300, combatant: { name: 'Eclipse Sovereign', weaponId: 'nightfall_blade', weaponName: 'Nightfall', avatar: 'avatar-assassin.png', stats: { STR: 76, VIT: 68, INT: 50, FOCUS: 50, WILL: 48, WLT: 10 } } },
];

// Pick a bot for the player's ELO. W445 — bias UPWARD within the nearest window: prefer Echoes at
// or above the player's rating so the climb is earned (a win is meaningful, a loss is real) instead
// of letting a strong player farm the weaker bots below them. Bounded by the nearest-3, so it can
// never throw a newcomer at a wildly-overtiered Echo. Deterministic fallback: roster is non-empty.
export function pickBot(elo: number): BotDef {
  const sorted = ROSTER.slice().sort((a, b) => Math.abs(a.elo - elo) - Math.abs(b.elo - elo));
  const near = sorted.slice(0, 3);
  const above = near.filter((b) => b.elo >= elo - 20);   // at-or-above (small buffer so "≈ equal" counts)
  const pool = above.length ? above : near;
  const i = Math.floor(Math.random() * pool.length);
  return pool[i] || sorted[0];
}

export function botMeta(bot: BotDef): { id: string; alias: string; elo: number; tier: string; weaponName: string; avatar: string } {
  return { id: bot.id, alias: bot.name, elo: bot.elo, tier: eloTier(bot.elo), weaponName: bot.combatant.weaponName, avatar: bot.combatant.avatar };
}
