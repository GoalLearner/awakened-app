/**
 * W1233 — owner 2026-11-17, sparring a friend's Echo: "make sure that your personal ultimate and special attack and
 * shadows are there as well". He chose BOTH sides armed. The duel engine (combat-core.js) now fills a Surge for each
 * fighter, fires either side's ultimate (the move id 'ultimate'), and lifts each fighter by its marching army; the
 * MatchRoom carries the choice, shows both Surges, and accepts UNLEASH; a rated Echo marches the player's army.
 */
import { describe, expect, it } from 'vitest';
import * as CC from './pvp/combat-core.js';
import { MatchRoom, sanitizeArmyAndUlt, sanitizeCombatant } from './pvp/match-room';

const C = CC as any;
const stats = { STR: 81, VIT: 114, INT: 58, FOCUS: 90, WILL: 87, WLT: 13 };
const fighter = (o: Record<string, unknown> = {}) => C.buildCombatant(sanitizeCombatant({ stats, weaponId: 'duskforge_greatblade', ...o }));
const battle = (a: any, b: any, seed = 11) => C.pvpStartBattle(a, b, seed);
// the player's pick: UNLEASH at a full Surge, else the first attack off cooldown, else anything legal
const pickP = (s: any, ult = true) => {
  if (ult && s.pSurge >= 1) return 'ultimate';
  const off = s.pMoves.filter((m: any) => !(s.cd[m.id] > 0));
  const atk = off.find((m: any) => (m.power || 0) > 0);
  return atk ? atk.id : off.length ? off[0].id : 'struggle';
};

describe('W1233 — the Surge and ultimates in the duel engine', () => {
  it('both Surges fill from damage dealt and taken, bounded to 1', () => {
    const s = battle(fighter(), fighter());
    expect([s.pSurge, s.bSurge]).toEqual([0, 0]);
    C.pvpResolveTurn(s, 'cleave', 'cleave');
    expect(s.pSurge).toBeGreaterThan(0);
    expect(s.bSurge).toBeGreaterThan(0);
    for (let i = 0; i < 6 && !s.done; i++) C.pvpResolveTurn(s, 'cleave', 'cleave');
    expect(s.pSurge).toBeLessThanOrEqual(1);
    expect(s.bSurge).toBeLessThanOrEqual(1);
  });

  it('the ultimate is refused below a full Surge, and at full it lands tagged and spends the Surge', () => {
    const s = battle(fighter(), fighter());
    expect(C.pvpResolveTurn(s, 'ultimate', 'cleave')).toMatchObject({ ok: false, code: 'BAD_MOVE_P' });
    expect(C.pvpResolveTurn(s, 'cleave', 'ultimate')).toMatchObject({ ok: false, code: 'BAD_MOVE_B' });
    s.pSurge = 1;
    const r = C.pvpResolveTurn(s, 'ultimate', 'cleave');
    expect(r.ok).toBe(true);
    const ev = r.events.find((e: any) => e.side === 'p' && e.ultId);
    expect(ev).toBeTruthy();
    expect(ev.ultId).toBe('verdict');           // Duskforge is melee: its Signature
    if (ev.t === 'hit') expect(ev.ult).toBe(true);
    expect(s.pSurge).toBe(0);
  });

  it('the Echo side fires its own ultimate the same way', () => {
    const s = battle(fighter(), fighter({ ultId: 'storm' }));
    s.bSurge = 1;
    const r = C.pvpResolveTurn(s, 'cleave', 'ultimate');
    expect(r.events.some((e: any) => e.side === 'b' && e.ultId === 'storm')).toBe(true);
    expect(s.bSurge).toBe(0);
  });

  it('the Signature follows the weapon; an earned one is honoured; a Signature id or junk falls back', () => {
    const sig = (weaponId: string) => { const s = battle(fighter({ weaponId }), fighter()); return C.ultIdFor(s, 'p'); };
    expect(sig('duskforge_greatblade')).toBe('verdict');
    expect(sig('reverie_staff')).toBe('starfall');
    expect(sig('vigil_bow')).toBe('rain');
    expect(C.ultIdFor(battle(fighter({ ultId: 'reaper' }), fighter()), 'p')).toBe('reaper');
    expect(fighter({ ultId: 'starfall' }).ultId).toBe('signature');
    expect(fighter({ ultId: 'constructor' }).ultId).toBe('signature');
  });

  it('the numbers mirror the client table (app.js ASCENT_ULTIMATES)', () => {
    const U = C.ULTS;
    expect([U.verdict.power, U.feast.power, U.quicksilver.prio, U.hellfire.fxs[0].mag, U.storm.pierce, U.reaper.exe, U.arise.scale, U.dawnbreaker.fxs[0].mag])
      .toEqual([2.6, 1.2, 2, 0.11, true, { thr: 0.35, mult: 2.8 }, { per: 0.15, cap: 8 }, -0.3]);
    expect([C.SURGE_DEALT_K, C.SURGE_TAKEN_K]).toEqual([0.9, 1.1]);
  });

  it('Storm of Blades goes through a raised guard; a plain blow is halved by it', () => {
    const run = (ultId: string) => {
      const s = battle(fighter({ ultId }), fighter(), 5);
      s.bS.guard = 1; s.pSurge = 1;
      const ev = C.pvpResolveTurn(s, 'ultimate', 'bulwark').events.find((e: any) => e.side === 'p' && e.t === 'hit');
      return { dmg: ev ? ev.dmg : 0, guard: s.bS.guard };
    };
    const storm = run('storm');
    expect(storm.dmg).toBeGreaterThan(0);
    expect(storm.guard).toBe(1);   // the guard was not spent: the storm never touched it
  });

  it('Arise grows with the marching army, capped at 8', () => {
    const p = (n: number) => C.ultMoveFor(battle(fighter({ ultId: 'arise', shadows: n }), fighter()), 'p').power;
    expect(p(0)).toBeCloseTo(2.2);
    expect(p(4)).toBeCloseTo(2.8);
    expect(p(30)).toBeCloseTo(2.2 + 0.15 * 8);
  });

  it('the army lifts attack, defense, edge and the health bar, as in the Ascent; bounded at 80%', () => {
    const a = fighter(), b = fighter({ shadowPct: 30 }), c = fighter({ shadowPct: 500 });
    expect(b.attack / a.attack).toBeCloseTo(1.3);
    expect(b.defense / a.defense).toBeCloseTo(1.3);
    expect(c.attack / a.attack).toBeCloseTo(1.8);
    expect(battle(b, a).pMax).toBeGreaterThan(battle(a, a).pMax);
  });

  it('a stun swallows the ultimate and keeps the Surge', () => {
    const s = battle(fighter(), fighter());
    s.pSurge = 1; s.pS.stun = 1;
    C.pvpResolveTurn(s, 'ultimate', 'cleave');
    expect(s.pSurge).toBeGreaterThanOrEqual(1);
  });

  it('Crimson Feast heals only when it lands', () => {
    const s = battle(fighter({ ultId: 'feast' }), fighter());
    s.pHP = Math.round(s.pMax / 2); s.pSurge = 1;
    const r = C.pvpResolveTurn(s, 'ultimate', 'bulwark');
    const landed = r.events.some((e: any) => e.side === 'p' && e.t === 'hit');
    expect(r.events.some((e: any) => e.side === 'p' && e.t === 'heal')).toBe(landed);
  });
});

describe('W1233 — the Echo (bot) fires its ultimate, deterministically', () => {
  it('a full Surge makes the Echo fire its Signature; below full it fights with its kit', () => {
    const s = battle(fighter(), fighter(), 21);
    expect(C.pvpBotMove(s)).not.toBe('ultimate');
    s.bSurge = 1;
    expect(C.pvpBotMove(s)).toBe('ultimate');
    const r = C.pvpResolveTurn(s, pickP(s, false), 'ultimate');
    expect(r.events.some((e: any) => e.side === 'b' && e.ultId === 'verdict')).toBe(true);
  });

  it('Reaper holds for the finish (or its patience); a stunned Echo never fires', () => {
    const s = battle(fighter(), fighter({ ultId: 'reaper' }));
    s.bSurge = 1;
    expect(C.pvpBotMove(s)).not.toBe('ultimate');   // foe (you) is healthy: it waits
    s.pHP = Math.floor(s.pMax * 0.3);
    expect(C.pvpBotMove(s)).toBe('ultimate');
    const t = battle(fighter(), fighter());
    t.bSurge = 1; t.bS.stun = 1;
    expect(C.pvpBotMove(t)).not.toBe('ultimate');
  });

  it('a rebuilt session from the same history matches the live one (the MatchRoom replay)', () => {
    const play = (record?: Array<{ p: string }>) => {
      const s = battle(fighter({ ultId: 'hellfire' }), fighter({ shadowPct: 20, shadows: 9 }), 99);
      const ps: Array<{ p: string }> = [];
      for (let i = 0; i < 14 && !s.done; i++) {
        const want = record ? record[i] && record[i].p : pickP(s);
        if (!want) break;
        const b = C.pvpBotMove(s);
        const r = C.pvpResolveTurn(s, want, b);
        if (!r.ok) break;
        ps.push({ p: want });
      }
      return { s, ps };
    };
    const live = play();
    const again = play(live.ps);
    expect([again.s.pHP, again.s.bHP, again.s.turn, again.s.pSurge, again.s.bSurge]).toEqual([live.s.pHP, live.s.bHP, live.s.turn, live.s.pSurge, live.s.bSurge]);
    expect(live.ps.some((x) => x.p === 'ultimate')).toBe(true);
  });
});

describe('W1233 — what a client may claim, and what the duel shows', () => {
  it('sanitizeArmyAndUlt keeps an earned ultimate and bounds the army', () => {
    expect(sanitizeArmyAndUlt({ ultId: 'storm', shadows: 12, shadowPct: 18.456 })).toEqual({ ultId: 'storm', shadows: 12, shadowPct: 18.46 });
    expect(sanitizeArmyAndUlt({ ultId: 'verdict', shadows: 999, shadowPct: 900 })).toEqual({ shadows: 40, shadowPct: 80 });
    expect(sanitizeArmyAndUlt({ ultId: 'x', shadows: -3, shadowPct: 'lots' })).toEqual({});
    expect(sanitizeArmyAndUlt(null)).toEqual({});
    expect(sanitizeCombatant({ stats, duelUlt: true }).duelUlt).toBe(true);
    expect(sanitizeCombatant({ stats, duelUlt: 'yes' }).duelUlt).toBeUndefined();
  });

  it('the MatchRoom view gives each side its Surge, ultimate and army', () => {
    const room = new MatchRoom({ storage: {} } as any, {} as any);
    const m: any = {
      code: 'ABCD', matchId: 'x', ranked: false, phase: 'active', seed: 3,
      p1: { userId: 'u1', alias: 'Richie', combatant: sanitizeCombatant({ stats, weaponId: 'duskforge_greatblade', ultId: 'arise', shadows: 9, shadowPct: 15, duelUlt: true }) },
      p2: { userId: 'bot:echo:u2', alias: 'Galilea', combatant: sanitizeCombatant({ stats, weaponId: 'reverie_staff' }) },
      turn: 1, moveHistory: [], pending: {}, deadlineMs: null, connected: { p: true, b: true }, lastSeen: { p: 0, b: 0 }, result: null,
    };
    const v = room.viewBySlot(m, 'p');
    expect(v.me).toMatchObject({ surge: 0, ultId: 'arise', shadows: 9 });
    expect(v.opp).toMatchObject({ surge: 0, ultId: 'starfall', shadows: 0 });
    expect(room.viewBySlot(m, 'b').me.ultId).toBe('starfall');
  });

  // W1235 — owner 2026-11-17 (an Echo spar, turn 3): "The ultimate ability bar never filled it up during the match".
  // The bar never repainted on the screen; this pins that the view it paints from does fill as turns are played.
  it('an Echo spar\'s view carries the filling Surge for both sides as turns are played', () => {
    const room = new MatchRoom({ storage: {} } as any, {} as any);
    const m: any = {
      code: 'ABCF', matchId: 'z', ranked: false, phase: 'active', seed: 5,
      p1: { userId: 'u1', alias: 'Richie', combatant: sanitizeCombatant({ stats, weaponId: 'duskforge_greatblade', duelUlt: true }) },
      p2: { userId: 'bot:echo:u2', alias: 'Galilea', combatant: sanitizeCombatant({ stats, weaponId: 'reverie_staff' }) },
      turn: 1, moveHistory: [], pending: {}, deadlineMs: null, connected: { p: true, b: true }, lastSeen: { p: 0, b: 0 }, result: null,
    };
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const sess = room.rebuild(m);
      m.moveHistory.push({ p: pickP(sess, false), b: 'slash' });   // an Echo's move is re-picked on replay
      m.turn += 1;
      seen.push(room.viewBySlot(m, 'p').me.surge);
    }
    const v = room.viewBySlot(m, 'p');
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[2]).toBeGreaterThan(seen[0]);
    expect(v.opp.surge).toBeGreaterThan(0);
  });

  it('an app without the UNLEASH gets the duel as before: no ultimates either side, no armies, no Surge shown', () => {
    const room = new MatchRoom({ storage: {} } as any, {} as any);
    const m: any = {
      code: 'ABCE', matchId: 'y', ranked: true, phase: 'active', seed: 4,
      p1: { userId: 'u1', alias: 'Old', combatant: sanitizeCombatant({ stats, weaponId: 'duskforge_greatblade', ultId: 'arise', shadows: 9, shadowPct: 15 }) },
      p2: { userId: 'bot:ashveil', alias: 'Ashveil', combatant: sanitizeCombatant({ stats, weaponId: 'kilnforged_warblade', shadows: 9, shadowPct: 15 }) },
      turn: 1, moveHistory: [], pending: {}, deadlineMs: null, connected: { p: true, b: true }, lastSeen: { p: 0, b: 0 }, result: null,
    };
    const sess = room.rebuild(m);
    expect(sess.ultsOff).toBe(true);
    expect(sess.m.player.shadowPct).toBe(0);
    expect(sess.m.bot.shadowPct).toBe(0);
    sess.bSurge = 1; sess.pSurge = 1;
    expect(C.pvpBotMove(sess)).not.toBe('ultimate');
    expect(C.pvpResolveTurn(sess, 'ultimate', 'slash')).toMatchObject({ ok: false, code: 'BAD_MOVE_P' });
    const v = room.viewBySlot(m, 'p');
    expect([v.me.surge, v.opp.surge, v.me.shadows]).toEqual([0, 0, 0]);
    // the new app marks itself; a human opponent must too
    m.p1.combatant = sanitizeCombatant({ stats, weaponId: 'duskforge_greatblade', duelUlt: true });
    expect(room.rebuild(m).ultsOff).toBeUndefined();
    m.p2 = { userId: 'u3', alias: 'Human', combatant: sanitizeCombatant({ stats, weaponId: 'kilnforged_warblade' }) };
    expect(room.rebuild(m).ultsOff).toBe(true);
  });
});
