// Type declarations for combat-core.js (the JS lift of the shipped Arena engine).
// The .js is the source of truth (a faithful transcription verified by the parity
// cross-check); these types let the TS Durable Object consume it safely.

export interface Combatant {
  name: string;
  attack: number;
  defense: number;
  edge: number;
  power: number;
  stats: Record<string, number>;
  arch: string;
  weaponId: string;
  weaponName: string;
  kit: Array<Record<string, any>>;
  attuned: number;
  isBot: boolean;
}

export interface BattleSession {
  m: { player: Combatant; bot: Combatant };
  pHP: number; pMax: number; bHP: number; bMax: number;
  pMoves: Array<Record<string, any>>;
  bMoves: Array<Record<string, any>>;
  cd: Record<string, number>;
  bcd: Record<string, number>;
  turn: number;
  done: boolean;
  won: boolean;
  log: any[];
  dmgDealt: { p: number; b: number };
  timedOut?: boolean;
  rng: () => number;
  [k: string]: any;
}

export interface PvpResult {
  done: boolean;
  winnerSide: 'p' | 'b' | null;
  pHP: number; bHP: number; pMax: number; bMax: number;
  turns: number;
  timedOut: boolean;
  dpDealt: number; dbDealt: number;
}

export const ARENA_MOVE_LIB: Record<string, Record<string, any>>;
export const WEAPON_MOVES: Record<string, string[]>;
export const _WEAPON_ATTUNE: Record<string, string[]>;
export const _BATTLE_TURN_CAP: number;
export const _ATTUNED_MULT: number;

export function buildCombatant(input: any): Combatant;
export function pvpStartBattle(a: Combatant, b: Combatant, seed: number): BattleSession;
export function pvpResolveTurn(sess: BattleSession, moveP: string, moveB: string): { ok: boolean; code?: string; events?: any[] };
export function pvpResult(sess: BattleSession): PvpResult;
export function defaultMoveForTimeout(moves: Array<Record<string, any>>, cd: Record<string, number>): string;
export function arenaTakeTurn(sess: BattleSession, moveId: string): any[] | null;
export function kitForWeapon(weaponId: string): Array<Record<string, any>>;
export function attuneForWeapon(weaponId: string, arch: string): number;

export const _arMulberry32: (a: number) => () => number;
export const _arenaCombatProfile: (s: Record<string, number>) => any;
export const _arenaArchOf: (c: any) => string;
export const _arenaEffectiveness: (pa: string, fa: string) => any;
export const _arenaSideOdds: (c: any) => { crit: number; miss: number };
export const _arExecMove: (sess: BattleSession, side: 'p' | 'b', move: any, events: any[]) => void;
export const _arApplyFx: (...args: any[]) => void;
export const _arEndTurn: (sess: BattleSession, events: any[]) => void;
export const _arResolveTurn: (sess: BattleSession, pMove: any, bMove: any) => any[];
export const _arenaPickMove: (ctx: any) => any;
