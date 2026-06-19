// ─────────────────────────────────────────────────────────────────────────
// match-room.ts — the authoritative PvP match engine (Cloudflare Durable Object).
//
// One DO instance per match, addressed by idFromName(matchCode). It owns the
// battle and is the SINGLE source of truth: clients send intents, the DO runs the
// shared combat-core to resolve every turn, and broadcasts the result. The client
// never computes an outcome (PVP.md §21.2).
//
// HIBERNATION MODEL: the DO may be evicted from memory between messages (WebSocket
// Hibernation), so NO authoritative state lives in instance fields. Everything is
// persisted to this.state.storage under one 'match' blob, and the live BattleSession
// is REBUILT on demand by deterministic replay: pvpStartBattle(seed) + replaying
// every recorded turn. Because combat is seeded-deterministic, {seed, combatants,
// moveHistory} fully reconstructs the session. This is what makes reconnect + turn
// timeout robust.
//
// Transport: WebSocket (primary) AND plain HTTP (fallback/poll) both hit the same DO
// and the same authoritative logic.
// ─────────────────────────────────────────────────────────────────────────
import type { Env } from '../env';
import {
  buildCombatant, pvpStartBattle, pvpResolveTurn, pvpResult,
  defaultMoveForTimeout, WEAPON_MOVES,
} from './combat-core.js';

const TURN_DEADLINE_MS = 45_000;      // a player has 45s to submit each turn
const DISCONNECT_GRACE_MS = 120_000;  // sustained disconnect past this -> forfeit
const MAX_STAT = 200;                 // anti-cheat sanity bound per stat

type Slot = 'p' | 'b';
interface RawCombatant { name: string; weaponId: string; weaponName: string; stats: Record<string, number>; }
interface PlayerSlot { userId: string; alias: string; combatant: RawCombatant; }
interface MatchState {
  code: string;
  ranked: boolean;
  phase: 'lobby' | 'active' | 'ended';
  seed: number;
  p1: PlayerSlot | null;
  p2: PlayerSlot | null;
  turn: number;                       // current (unresolved) turn number, 1-based
  moveHistory: Array<{ p: string; b: string }>;
  pending: { p?: string; b?: string };
  deadlineMs: number | null;
  connected: { p: boolean; b: boolean };
  lastSeen: { p: number; b: number };
  result: { winnerSide: Slot | 'draw'; winnerUserId: string | null; reason: string } | null;
  startedAtMs: number | null;
  persisted: boolean;                 // wrote the D1 record yet?
}

function sanitizeCombatant(raw: any): RawCombatant {
  const stats: Record<string, number> = {};
  const KEYS = ['STR', 'VIT', 'INT', 'FOCUS', 'WILL', 'WLT'];
  const src = (raw && raw.stats) || {};
  for (const k of KEYS) {
    let v = Number(src[k]);
    if (!Number.isFinite(v) || v < 0) v = 0;
    stats[k] = Math.min(MAX_STAT, Math.round(v));
  }
  let weaponId = String((raw && raw.weaponId) || 'unarmed');
  if (!(weaponId in WEAPON_MOVES)) weaponId = 'unarmed';
  return {
    name: String((raw && raw.name) || 'Hunter').slice(0, 40),
    weaponId,
    weaponName: String((raw && raw.weaponName) || '').slice(0, 60),
    stats,
  };
}

export class MatchRoom {
  state: DurableObjectState;
  env: Env;
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ── persistence ──
  async load(): Promise<MatchState | null> {
    return (await this.state.storage.get<MatchState>('match')) ?? null;
  }
  async save(m: MatchState): Promise<void> {
    await this.state.storage.put('match', m);
  }

  // Rebuild the live combat-core session from the persisted record (replay).
  rebuild(m: MatchState): any | null {
    if (!m.p1 || !m.p2) return null;
    const a = buildCombatant(m.p1.combatant);
    const b = buildCombatant(m.p2.combatant);
    const sess = pvpStartBattle(a, b, m.seed);
    for (const h of m.moveHistory) {
      if (sess.done) break;
      pvpResolveTurn(sess, h.p, h.b);
    }
    return sess;
  }

  // ── HTTP entry (create/join/state/submit/forfeit + WS upgrade) ──
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') return this.handleUpgrade(request);
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    const userId = request.headers.get('X-PvP-User') || '';
    const alias = request.headers.get('X-PvP-Alias') || '';
    if (!userId) return json({ ok: false, code: 'NO_AUTH' }, 401);
    let body: any = {};
    try { body = await request.json(); } catch { /* GET */ }
    switch (action) {
      case 'create':  return json(await this.doCreate(userId, alias, body));
      case 'join':    return json(await this.doJoin(userId, alias, body));
      case 'state':   return json(await this.doState(userId));
      case 'submit':  return json(await this.doSubmit(userId, body));
      case 'forfeit': return json(await this.doForfeit(userId));
      default:        return json({ ok: false, code: 'BAD_ACTION' }, 400);
    }
  }

  async doCreate(userId: string, alias: string, body: any): Promise<any> {
    let m = await this.load();
    if (m && m.p1 && m.p1.userId !== userId) return { ok: false, code: 'CODE_TAKEN' };
    if (m && m.p1) return { ok: true, code: m.code, state: this.view(m, userId) }; // idempotent re-create by owner
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    m = {
      code: String(body.code || ''),
      ranked: !!body.ranked,
      phase: 'lobby', seed,
      p1: { userId, alias, combatant: sanitizeCombatant(body.combatant) },
      p2: null,
      turn: 1, moveHistory: [], pending: {}, deadlineMs: null,
      connected: { p: false, b: false }, lastSeen: { p: 0, b: 0 },
      result: null, startedAtMs: null, persisted: false,
    };
    await this.save(m);
    return { ok: true, code: m.code, state: this.view(m, userId) };
  }

  async doJoin(userId: string, alias: string, body: any): Promise<any> {
    const m = await this.load();
    if (!m || !m.p1) return { ok: false, code: 'NO_MATCH' };
    if (m.p1.userId === userId) return { ok: false, code: 'CANNOT_JOIN_SELF' };
    if (m.p2 && m.p2.userId !== userId) return { ok: false, code: 'MATCH_FULL' };
    if (m.phase === 'ended') return { ok: false, code: 'ENDED' };
    if (!m.p2) {
      m.p2 = { userId, alias, combatant: sanitizeCombatant(body.combatant) };
      m.phase = 'active';
      m.startedAtMs = Date.now();
      this.armDeadline(m);
      await this.save(m);
      await this.persistStart(m);
      this.broadcastStart(m);
    }
    return { ok: true, code: m.code, state: this.view(m, userId) };
  }

  async doState(userId: string): Promise<any> {
    const m = await this.load();
    if (!m) return { ok: false, code: 'NO_MATCH' };
    return { ok: true, state: this.view(m, userId) };
  }

  async doSubmit(userId: string, body: any): Promise<any> {
    const m = await this.load();
    if (!m || m.phase !== 'active') return { ok: false, code: 'NOT_ACTIVE' };
    const slot = this.slotFor(m, userId);
    if (!slot) return { ok: false, code: 'NOT_PARTICIPANT' };
    const turn = Number(body.turn);
    const moveId = String(body.moveId || '');
    if (turn !== m.turn) return { ok: false, code: 'STALE_TURN', turn: m.turn };
    if (m.pending[slot]) return { ok: true, state: this.view(m, userId) }; // double-submit ignored (idempotent)
    // validate against the live session's current cooldowns
    const sess = this.rebuild(m);
    if (!sess || sess.done) return { ok: false, code: 'DONE' };
    const kit = slot === 'p' ? sess.pMoves : sess.bMoves;
    const cd = slot === 'p' ? sess.cd : sess.bcd;
    const legal = kit.some((x: any) => x.id === moveId) ? !(cd[moveId] > 0) : moveId === 'struggle';
    if (!legal) return { ok: false, code: 'ILLEGAL_MOVE' };
    m.pending[slot] = moveId;
    await this.resolveIfReady(m, sess);
    await this.save(m);
    this.broadcastState(m);
    return { ok: true, state: this.view(m, userId) };
  }

  async doForfeit(userId: string): Promise<any> {
    const m = await this.load();
    if (!m) return { ok: false, code: 'NO_MATCH' };
    const slot = this.slotFor(m, userId);
    if (!slot) return { ok: false, code: 'NOT_PARTICIPANT' };
    if (m.phase === 'ended') return { ok: true, state: this.view(m, userId) };
    await this.endMatch(m, slot === 'p' ? 'b' : 'p', 'forfeit');
    return { ok: true, state: this.view(m, userId) };
  }

  // ── turn resolution ──
  async resolveIfReady(m: MatchState, sess: any): Promise<void> {
    if (!m.pending.p || !m.pending.b) return;
    const r = pvpResolveTurn(sess, m.pending.p, m.pending.b);
    if (!r.ok) {
      // a move went illegal between submit + resolve (cooldown race etc.) — drop
      // the offending side's pending and let the timeout backstop it.
      if (r.code === 'BAD_MOVE_P') delete m.pending.p;
      else if (r.code === 'BAD_MOVE_B') delete m.pending.b;
      return;
    }
    m.moveHistory.push({ p: m.pending.p, b: m.pending.b });
    m.pending = {};
    m.turn = sess.turn;
    if (sess.done) {
      this.broadcastTurn(m, r.events || [], sess);
      const res = pvpResult(sess);
      await this.endMatch(m, res.winnerSide as Slot, res.timedOut ? 'turn_cap' : 'ko');
    } else {
      // arm the NEXT turn's deadline BEFORE broadcasting so the turn_result the
      // clients animate already carries the fresh deadlineMs (drives the client
      // turn timer). The persisted record + alarm are set here too.
      this.armDeadline(m);
      await this.state.storage.put('match', m);
      this.broadcastTurn(m, r.events || [], sess);
    }
  }

  armDeadline(m: MatchState): void {
    // PVP_TURN_DEADLINE_MS (a wrangler var) overrides the default — lets the
    // integration test exercise the turn-timeout path in seconds, not 45s.
    const dl = Number((this.env as any).PVP_TURN_DEADLINE_MS) || TURN_DEADLINE_MS;
    m.deadlineMs = Date.now() + dl;
    this.state.storage.setAlarm(m.deadlineMs);
  }

  async alarm(): Promise<void> {
    const m = await this.load();
    if (!m || m.phase !== 'active') return;
    const now = Date.now();
    // disconnect forfeit: if a player has been gone past the grace window, the
    // present player wins.
    for (const slot of ['p', 'b'] as Slot[]) {
      if (!m.connected[slot] && m.lastSeen[slot] && now - m.lastSeen[slot] > DISCONNECT_GRACE_MS) {
        await this.endMatch(m, slot === 'p' ? 'b' : 'p', 'disconnect');
        return;
      }
    }
    if (m.deadlineMs && now < m.deadlineMs - 1000) { this.state.storage.setAlarm(m.deadlineMs); return; }
    // turn timeout: auto-submit a default move for any side that hasn't.
    const sess = this.rebuild(m);
    if (!sess || sess.done) return;
    if (!m.pending.p) m.pending.p = defaultMoveForTimeout(sess.pMoves, sess.cd);
    if (!m.pending.b) m.pending.b = defaultMoveForTimeout(sess.bMoves, sess.bcd);
    await this.resolveIfReady(m, sess);
    await this.save(m);
    this.broadcastState(m);
  }

  async endMatch(m: MatchState, winnerSide: Slot | 'draw', reason: string): Promise<void> {
    m.phase = 'ended';
    m.deadlineMs = null;
    const winnerUserId = winnerSide === 'draw' ? null
      : winnerSide === 'p' ? (m.p1 && m.p1.userId) || null : (m.p2 && m.p2.userId) || null;
    m.result = { winnerSide, winnerUserId, reason };
    this.state.storage.deleteAlarm();
    await this.save(m);
    await this.persistEnd(m);
    this.broadcastEnd(m);
  }

  // ── WebSocket (hibernatable) ──
  async handleUpgrade(request: Request): Promise<Response> {
    const userId = request.headers.get('X-PvP-User') || '';
    const alias = request.headers.get('X-PvP-Alias') || '';
    const m = await this.load();
    if (!m) return json({ ok: false, code: 'NO_MATCH' }, 404);
    const slot = this.slotFor(m, userId);
    if (!slot) return json({ ok: false, code: 'NOT_PARTICIPANT' }, 403);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server, [slot, userId]);
    m.connected[slot] = true; m.lastSeen[slot] = Date.now();
    await this.save(m);
    // send the current snapshot immediately + notify the opponent
    try { server.send(JSON.stringify({ type: 'state', ...this.view(m, userId) })); } catch { /* */ }
    this.sendToSlot(m, slot === 'p' ? 'b' : 'p', { type: 'opp_status', connected: true });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const tags = this.state.getTags(ws);
    const slot = (tags[0] as Slot) || null;
    const userId = tags[1] || '';
    if (!slot) return;
    let msg: any = {};
    try { msg = JSON.parse(typeof message === 'string' ? message : ''); } catch { return; }
    const m = await this.load();
    if (!m) return;
    m.lastSeen[slot] = Date.now(); m.connected[slot] = true;
    if (msg.type === 'ping') { try { ws.send(JSON.stringify({ type: 'pong' })); } catch { /* */ } await this.save(m); return; }
    if (msg.type === 'resync') { await this.save(m); try { ws.send(JSON.stringify({ type: 'state', ...this.view(m, userId) })); } catch { /* */ } return; }
    if (msg.type === 'forfeit') { await this.doForfeit(userId); return; }
    if (msg.type === 'submit_move') {
      const r = await this.doSubmit(userId, { turn: msg.turn, moveId: msg.moveId });
      if (!r.ok) { try { ws.send(JSON.stringify({ type: 'error', code: r.code, detail: 'submit rejected' })); } catch { /* */ } }
      return;
    }
    await this.save(m);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const tags = this.state.getTags(ws);
    const slot = (tags[0] as Slot) || null;
    if (!slot) return;
    const m = await this.load();
    if (!m) return;
    // only mark disconnected if no OTHER live socket holds this slot
    const others = this.state.getWebSockets(slot).filter((s) => s !== ws);
    if (others.length === 0) {
      m.connected[slot] = false; m.lastSeen[slot] = Date.now();
      await this.save(m);
      this.sendToSlot(m, slot === 'p' ? 'b' : 'p', { type: 'opp_status', connected: false });
      // arm a disconnect-grace check so a vanished player eventually forfeits
      if (m.phase === 'active') this.state.storage.setAlarm(Date.now() + DISCONNECT_GRACE_MS + 1000);
    }
  }

  // ── broadcast helpers ──
  sendToSlot(m: MatchState, slot: Slot, payload: any): void {
    const data = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets(slot)) { try { ws.send(data); } catch { /* */ } }
  }
  broadcastBoth(m: MatchState, makePayload: (slot: Slot) => any): void {
    this.sendToSlot(m, 'p', makePayload('p'));
    this.sendToSlot(m, 'b', makePayload('b'));
  }
  broadcastStart(m: MatchState): void {
    this.broadcastBoth(m, (slot) => ({ type: 'match_start', ...this.viewBySlot(m, slot) }));
  }
  broadcastState(m: MatchState): void {
    this.broadcastBoth(m, (slot) => ({ type: 'state', ...this.viewBySlot(m, slot) }));
  }
  broadcastTurn(m: MatchState, events: any[], sess: any): void {
    this.broadcastBoth(m, (slot) => ({
      type: 'turn_result', turn: m.turn, events, pHP: sess.pHP, bHP: sess.bHP,
      done: sess.done, winnerSide: sess.done ? (sess.won ? 'p' : 'b') : null,
      ...this.viewBySlot(m, slot),
    }));
  }
  broadcastEnd(m: MatchState): void {
    this.broadcastBoth(m, (slot) => ({
      type: 'match_end', result: m.result, you: slot,
      youWon: m.result ? m.result.winnerSide === slot : false,
      ...this.viewBySlot(m, slot),
    }));
  }

  // ── views ──
  slotFor(m: MatchState, userId: string): Slot | null {
    if (m.p1 && m.p1.userId === userId) return 'p';
    if (m.p2 && m.p2.userId === userId) return 'b';
    return null;
  }
  view(m: MatchState, userId: string): any { return this.viewBySlot(m, this.slotFor(m, userId) || 'p'); }
  viewBySlot(m: MatchState, you: Slot): any {
    let sess: any = null;
    if (m.phase !== 'lobby' && m.p1 && m.p2) sess = this.rebuild(m);
    const meSlot = you, oppSlot: Slot = you === 'p' ? 'b' : 'p';
    const meP = you === 'p' ? m.p1 : m.p2, oppP = you === 'p' ? m.p2 : m.p1;
    const hp = (slot: Slot) => sess ? (slot === 'p' ? sess.pHP : sess.bHP) : null;
    const maxhp = (slot: Slot) => sess ? (slot === 'p' ? sess.pMax : sess.bMax) : null;
    // per-side presentation state so the client renders the SAME battle UI
    // (status chips + super/weak effectiveness toast) without re-running the engine.
    const eff = (slot: Slot) => sess ? (slot === 'p' ? sess.pEff : sess.bEff) : 1;
    const status = (slot: Slot) => sess ? (slot === 'p' ? sess.pS : sess.bS) : null;
    const myKit = sess ? (you === 'p' ? sess.pMoves : sess.bMoves) : (meP ? buildCombatant(meP.combatant).kit : []);
    const myCd = sess ? (you === 'p' ? sess.cd : sess.bcd) : {};
    return {
      code: m.code, phase: m.phase, ranked: m.ranked, turn: m.turn, you, seed: m.seed,
      deadlineMs: m.deadlineMs,
      youSubmitted: !!m.pending[meSlot], oppSubmitted: !!m.pending[oppSlot],
      oppConnected: m.connected[oppSlot],
      me: meP ? { alias: meP.alias, name: meP.combatant.name, hp: hp(meSlot), maxHP: maxhp(meSlot), eff: eff(meSlot), status: status(meSlot), kit: myKit, cd: myCd } : null,
      opp: oppP ? { alias: oppP.alias, name: oppP.combatant.name, hp: hp(oppSlot), maxHP: maxhp(oppSlot), eff: eff(oppSlot), status: status(oppSlot) } : null,
      result: m.result,
    };
  }

  // ── D1 durable record ──
  async persistStart(m: MatchState): Promise<void> {
    try {
      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO pvp_matches
           (id, code, p1_user_id, p2_user_id, p1_alias, p2_alias, p1_combatant_json, p2_combatant_json, ranked, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      ).bind(
        m.code, m.code, m.p1!.userId, m.p2!.userId, m.p1!.alias, m.p2!.alias,
        JSON.stringify(m.p1!.combatant), JSON.stringify(m.p2!.combatant),
        m.ranked ? 1 : 0, new Date(m.startedAtMs || Date.now()).toISOString(),
      ).run();
    } catch { /* best-effort */ }
  }
  async persistEnd(m: MatchState): Promise<void> {
    if (m.persisted) return;
    m.persisted = true;
    await this.save(m);
    try {
      const result = m.result;
      const resStr = !result ? null : result.winnerSide === 'draw' ? 'draw'
        : result.reason === 'forfeit' || result.reason === 'disconnect' ? 'forfeit'
        : result.winnerSide === 'p' ? 'p1_win' : 'p2_win';
      await this.env.DB.prepare(
        `UPDATE pvp_matches SET status='ended', result=?, winner_user_id=?, turns=?, ended_at=? WHERE id=?`,
      ).bind(resStr, result ? result.winnerUserId : null, m.moveHistory.length, new Date().toISOString(), m.code).run();
    } catch { /* best-effort */ }
    // ranked ELO update (PVP.md §11.3) — invite duels are unranked in v1.
    if (m.ranked && m.result && m.result.winnerSide !== 'draw' && m.p1 && m.p2) {
      try { await this.updateElo(m.p1.userId, m.p2.userId, m.result.winnerSide === 'p'); } catch { /* */ }
    }
  }
  async updateElo(p1: string, p2: string, p1Won: boolean): Promise<void> {
    const get = async (uid: string) => {
      const row = await this.env.DB.prepare('SELECT elo, peak_elo, wins, losses, draws FROM pvp_ratings WHERE user_id=?').bind(uid).first<any>();
      return row || { elo: 1500, peak_elo: 1500, wins: 0, losses: 0, draws: 0 };
    };
    const r1 = await get(p1), r2 = await get(p2);
    const k = (e: number) => e < 1700 ? 32 : e < 2200 ? 24 : e < 2600 ? 16 : 12;
    const exp = (a: number, b: number) => 1 / (1 + Math.pow(10, (b - a) / 400));
    const d1 = Math.round(k(r1.elo) * ((p1Won ? 1 : 0) - exp(r1.elo, r2.elo)));
    const d2 = Math.round(k(r2.elo) * ((p1Won ? 0 : 1) - exp(r2.elo, r1.elo)));
    const now = new Date().toISOString();
    const upsert = async (uid: string, r: any, delta: number, won: boolean) => {
      const elo = Math.max(0, r.elo + delta);
      await this.env.DB.prepare(
        `INSERT INTO pvp_ratings (user_id, elo, peak_elo, wins, losses, draws, last_match_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET elo=excluded.elo,
           peak_elo=MAX(pvp_ratings.peak_elo, excluded.elo),
           wins=pvp_ratings.wins+excluded.wins, losses=pvp_ratings.losses+excluded.losses,
           last_match_at=excluded.last_match_at`,
      ).bind(uid, elo, Math.max(elo, r.peak_elo), won ? 1 : 0, won ? 0 : 1, 0, now).run();
    };
    await upsert(p1, r1, d1, p1Won);
    await upsert(p2, r2, d2, !p1Won);
  }
}

function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
