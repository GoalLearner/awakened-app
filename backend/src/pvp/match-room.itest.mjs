// match-room.itest.mjs — local integration test for the PvP MatchRoom Durable
// Object. Requires `wrangler dev` running on :8787 with backend/.dev.vars
// (JWT_SIGNING_KEY + PVP_TURN_DEADLINE_MS=3000).
//   node backend/src/pvp/match-room.itest.mjs
//
// Drives full matches over BOTH transports (HTTP poll + WebSocket) and exercises
// the ugly paths: forfeit + turn-timeout auto-resolve.
import { SignJWT } from 'jose';
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const BASE = 'http://localhost:8787';
const WS_BASE = 'ws://localhost:8787';
const KEY = new TextEncoder().encode('test-local-signing-key-0123456789abcdef0123456789abcdef0123456789');

async function mint(sub, alias) {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ alias }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub).setIssuer('awakened-backend').setAudience('awakened-app')
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(KEY);
}
async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMB_A = { name: 'Alice', weaponId: 'nightfall_blade', weaponName: 'Nightfall', stats: { STR: 14, VIT: 10, INT: 6, FOCUS: 9, WILL: 7, WLT: 4 } };
const COMB_B = { name: 'Bob', weaponId: 'wraithwind_bow', weaponName: 'Wraithwind', stats: { STR: 6, VIT: 12, INT: 8, FOCUS: 11, WILL: 9, WLT: 3 } };

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  OK   ' + name); } else { fail++; console.error('  FAIL ' + name, extra !== undefined ? JSON.stringify(extra) : ''); } }
const firstMove = (slot) => (slot.kit.find((m) => !(slot.cd[m.id] > 0)) || { id: 'struggle' }).id;

// ── 1. Full match over HTTP (create -> join -> poll+submit until KO) ──
async function httpMatch() {
  console.log('\n[1] HTTP match');
  const t1 = await mint('pvp-http-1', 'Alice'), t2 = await mint('pvp-http-2', 'Bob');
  const created = await api(t1, 'POST', '/v1/pvp/create', { combatant: COMB_A });
  ok('create returns a code', !!(created.ok && created.code), created);
  const code = created.code;
  const joined = await api(t2, 'POST', '/v1/pvp/join', { code, combatant: COMB_B });
  ok('join -> phase active', !!(joined.ok && joined.state && joined.state.phase === 'active'), joined && joined.state);
  let guard = 0, result = null;
  while (guard++ < 60) {
    const s1 = (await api(t1, 'GET', '/v1/pvp/state?code=' + code)).state;
    if (!s1) break;
    if (s1.phase === 'ended') { result = s1.result; break; }
    const turn = s1.turn;
    const s2 = (await api(t2, 'GET', '/v1/pvp/state?code=' + code)).state;
    await api(t1, 'POST', '/v1/pvp/submit', { code, turn, moveId: firstMove(s1.me) });
    await api(t2, 'POST', '/v1/pvp/submit', { code, turn, moveId: firstMove(s2.me) });
    await sleep(30);
  }
  ok('HTTP match ends with a winner', !!(result && (result.winnerSide === 'p' || result.winnerSide === 'b')), result);
  console.log('     result:', JSON.stringify(result));
}

// ── 2. Full match over WebSocket (auto-play both sides until match_end) ──
function wsClient(code, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_BASE + '/v1/pvp/ws?code=' + code + '&token=' + token);
    const out = { end: null, turns: 0, mismatches: 0, ws };
    const to = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('ws timeout')); }, 20000);
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'state' || m.type === 'match_start' || m.type === 'turn_result') {
        if (m.type === 'turn_result') {
          out.turns++;
          // live session HP (ABSOLUTE: pHP=slot p, bHP=slot b) must equal the per-slot REBUILD HP
          // (me/opp are RELATIVE to m.you) every turn — the determinism guarantee test 8 checks for
          // bots (always slot p), here for humans where the joiner is slot b so the mapping flips.
          const myLive = m.you === 'p' ? m.pHP : m.bHP;
          const oppLive = m.you === 'p' ? m.bHP : m.pHP;
          if (m.me && Math.abs((myLive || 0) - (m.me.hp || 0)) > 1e-6) out.mismatches++;
          if (m.opp && Math.abs((oppLive || 0) - (m.opp.hp || 0)) > 1e-6) out.mismatches++;
        }
        if (m.phase === 'active' && m.me && !m.youSubmitted) {
          try { ws.send(JSON.stringify({ type: 'submit_move', turn: m.turn, moveId: firstMove(m.me) })); } catch {}
        }
      } else if (m.type === 'match_end') {
        out.end = m; clearTimeout(to); try { ws.close(); } catch {}
        resolve(out);
      }
    });
    ws.addEventListener('error', (e) => { clearTimeout(to); reject(e instanceof Error ? e : new Error('ws error')); });
  });
}
async function wsMatch() {
  console.log('\n[2] WebSocket match');
  const t1 = await mint('pvp-ws-1', 'WsAlice'), t2 = await mint('pvp-ws-2', 'WsBob');
  const created = await api(t1, 'POST', '/v1/pvp/create', { combatant: COMB_A });
  const code = created.code;
  await api(t2, 'POST', '/v1/pvp/join', { code, combatant: COMB_B });
  try {
    const [r1, r2] = await Promise.all([wsClient(code, t1), wsClient(code, t2)]);
    ok('both WS clients receive match_end', !!(r1.end && r2.end), { r1: !!r1.end, r2: !!r2.end });
    ok('WS match has a winner', !!(r1.end && r1.end.result && (r1.end.result.winnerSide === 'p' || r1.end.result.winnerSide === 'b')), r1.end && r1.end.result);
    ok('both clients agree on the winner', !!(r1.end && r2.end && r1.end.result.winnerSide === r2.end.result.winnerSide), { a: r1.end && r1.end.result.winnerSide, b: r2.end && r2.end.result.winnerSide });
    // human-vs-human replay determinism: each client's per-turn REBUILD HP must match the live
    // broadcast every turn (RNG in lockstep). Bots are covered by test 8; this covers humans.
    ok('human WS: live HP === rebuild HP every turn (no replay drift)', r1.mismatches === 0 && r2.mismatches === 0, { r1: r1.mismatches, r2: r2.mismatches, turns: r1.turns });
    console.log('     result:', JSON.stringify(r1.end && r1.end.result));
  } catch (e) { ok('WebSocket match (transport)', false, String(e && e.message)); }
}

// ── 3. Forfeit: P1 quits -> P2 wins ──
async function forfeitTest() {
  console.log('\n[3] Forfeit');
  const t1 = await mint('pvp-ff-1', 'A'), t2 = await mint('pvp-ff-2', 'B');
  const code = (await api(t1, 'POST', '/v1/pvp/create', { combatant: COMB_A })).code;
  await api(t2, 'POST', '/v1/pvp/join', { code, combatant: COMB_B });
  const f = await api(t1, 'POST', '/v1/pvp/forfeit', { code });
  ok('forfeit ends the match', !!(f.ok && f.state && f.state.phase === 'ended'), f && f.state);
  ok('forfeiter loses (opponent = b wins)', !!(f.state && f.state.result && f.state.result.winnerSide === 'b' && f.state.result.reason === 'forfeit'), f.state && f.state.result);
}

// ── 4. Turn timeout: one side never submits -> alarm auto-resolves ──
async function timeoutTest() {
  console.log('\n[4] Turn timeout (deadline 3s)');
  const t1 = await mint('pvp-to-1', 'A'), t2 = await mint('pvp-to-2', 'B');
  const code = (await api(t1, 'POST', '/v1/pvp/create', { combatant: COMB_A })).code;
  const joined = await api(t2, 'POST', '/v1/pvp/join', { code, combatant: COMB_B });
  const startTurn = joined.state.turn;
  // P1 submits turn 1; P2 stays silent. The alarm should auto-resolve the turn.
  await api(t1, 'POST', '/v1/pvp/submit', { code, turn: startTurn, moveId: firstMove(joined.state.me) });
  await sleep(4500); // > 3s deadline + alarm slack
  const st = (await api(t1, 'GET', '/v1/pvp/state?code=' + code)).state;
  ok('timeout auto-advanced the turn (no stall)', !!(st && (st.turn > startTurn || st.phase === 'ended')), st && { turn: st.turn, phase: st.phase });
  console.log('     turn after timeout:', st && st.turn, 'phase', st && st.phase);
}

// ── 5. Reconnect: a WS drop mid-turn must NOT delay the turn timeout to the
//       120s disconnect grace (regression for the single-alarm-slot clobber). ──
async function reconnectTest() {
  console.log('\n[5] Reconnect + turn-deadline restore (deadline 3s)');
  const t1 = await mint('pvp-rc-1', 'A'), t2 = await mint('pvp-rc-2', 'B');
  const code = (await api(t1, 'POST', '/v1/pvp/create', { combatant: COMB_A })).code;
  await api(t2, 'POST', '/v1/pvp/join', { code, combatant: COMB_B });
  const open = (ws) => new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('open timeout')), 8000); ws.addEventListener('open', () => { clearTimeout(to); res(); }); ws.addEventListener('error', () => { clearTimeout(to); rej(new Error('ws error')); }); });
  try {
    const ws1 = new WebSocket(WS_BASE + '/v1/pvp/ws?code=' + code + '&token=' + t1);
    const ws2 = new WebSocket(WS_BASE + '/v1/pvp/ws?code=' + code + '&token=' + t2);
    await Promise.all([open(ws1), open(ws2)]);
    // P1's socket drops, then reconnects — handleUpgrade must restore the turn deadline.
    ws1.close();
    await sleep(300);
    const ws1b = new WebSocket(WS_BASE + '/v1/pvp/ws?code=' + code + '&token=' + t1);
    let snapshot = false;
    ws1b.addEventListener('message', (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === 'state' || m.type === 'match_start') snapshot = true; });
    await open(ws1b);
    await sleep(200);
    ok('reconnect receives a state snapshot', snapshot);
    // neither side submits — with the fix the 3s turn deadline still fires (alarm
    // restored), so the turn auto-resolves well before the 120s grace.
    await sleep(5000);
    const st = (await api(t1, 'GET', '/v1/pvp/state?code=' + code)).state;
    ok('turn timeout fires on schedule after a reconnect (not delayed to grace)', !!(st && (st.turn > 1 || st.phase === 'ended')), st && { turn: st.turn, phase: st.phase });
    try { ws2.close(); ws1b.close(); } catch {}
  } catch (e) { ok('reconnect test (transport)', false, String(e && e.message)); }
}

// ── 6. Friend (invite-by-code) duels are UNRANKED — playing one must NOT move ELO.
//       You pick the opponent here, so a ranked one would let you farm a weak friend.
//       Rating moves ONLY via Find Match (test 7). The server forces ranked=false here,
//       ignoring the client's flag — this guards the ladder against friend-farming. ──
async function friendlyUnrankedTest() {
  console.log('\n[6] Friend (invite) duel -> UNRANKED (no ELO change)');
  const t1 = await mint('pvp-fr-1', 'FriendA'), t2 = await mint('pvp-fr-2', 'FriendB');
  const before1 = (await api(t1, 'GET', '/v1/pvp/rating')).elo;
  const before2 = (await api(t2, 'GET', '/v1/pvp/rating')).elo;
  const created = await api(t1, 'POST', '/v1/pvp/create', { combatant: COMB_A, ranked: true }); // client ASKS for ranked...
  const code = created.code;
  ok('invite create returns a code', !!(created.ok && code), created);
  const joined = await api(t2, 'POST', '/v1/pvp/join', { code, combatant: COMB_B });
  ok('...but the server forces the invite duel UNRANKED', !!(joined.ok && joined.state && joined.state.ranked === false), joined && joined.state && { ranked: joined.state.ranked });
  let guard = 0, result = null, endView = null;
  while (guard++ < 80) {
    const s1 = (await api(t1, 'GET', '/v1/pvp/state?code=' + code)).state;
    if (!s1) break;
    if (s1.phase === 'ended') { result = s1.result; endView = s1; break; }
    const turn = s1.turn;
    const s2 = (await api(t2, 'GET', '/v1/pvp/state?code=' + code)).state;
    await api(t1, 'POST', '/v1/pvp/submit', { code, turn, moveId: firstMove(s1.me) });
    await api(t2, 'POST', '/v1/pvp/submit', { code, turn, moveId: firstMove(s2.me) });
    await sleep(25);
  }
  ok('friendly match ended with a winner', !!(result && (result.winnerSide === 'p' || result.winnerSide === 'b')), result);
  await sleep(150); // let any (non-)write settle
  const after1 = (await api(t1, 'GET', '/v1/pvp/rating')).elo;
  const after2 = (await api(t2, 'GET', '/v1/pvp/rating')).elo;
  ok('winner ELO UNCHANGED (no friend-farming)', after1 === before1, { before1, after1 });
  ok('loser ELO UNCHANGED', after2 === before2, { before2, after2 });
  ok('match_end carries NO rating delta for a friendly', !(endView && endView.rating), endView && endView.rating);
}

// ── 7. Find Match -> instant AI-bot ranked duel; the bot auto-moves server-side and
//       only the human's ELO updates (vs the bot's nominal rating). ──
async function botMatchTest() {
  console.log('\n[7] Find Match -> AI bot duel');
  const t = await mint('pvp-bot-1', 'BotChallenger');
  const beforeR = await api(t, 'GET', '/v1/pvp/rating');
  const found = await api(t, 'POST', '/v1/pvp/find', { combatant: COMB_A });
  ok('find returns a code + bot opponent meta', !!(found.ok && found.code && found.vsBot && found.opponent && found.opponent.alias && typeof found.opponent.elo === 'number'), found);
  ok('match starts active vs the bot', !!(found.state && found.state.phase === 'active' && found.state.opp && found.state.opp.isBot === true), found.state && found.state.opp);
  ok('the bot is reported CONNECTED (never "disconnected" — regression for the Echo d/c wedge)', found.state && found.state.oppConnected === true, found.state && { oppConnected: found.state.oppConnected });
  const code = found.code;
  let guard = 0, result = null;
  while (guard++ < 90) {
    const s = (await api(t, 'GET', '/v1/pvp/state?code=' + code)).state;
    if (!s) break;
    if (s.phase === 'ended') { result = s.result; break; }
    await api(t, 'POST', '/v1/pvp/submit', { code, turn: s.turn, moveId: firstMove(s.me) });
    await sleep(20);
  }
  ok('bot match ends with a result', !!(result && (result.winnerSide === 'p' || result.winnerSide === 'b' || result.winnerSide === 'draw')), result);
  await sleep(150);
  const after = await api(t, 'GET', '/v1/pvp/rating');
  const beforeN = (beforeR.wins || 0) + (beforeR.losses || 0) + (beforeR.draws || 0);
  const afterN = (after.wins || 0) + (after.losses || 0) + (after.draws || 0);
  ok('exactly one ranked match recorded for the human', afterN === beforeN + 1, { beforeN, afterN });
  ok('human ELO moved vs the bot', after.elo !== beforeR.elo, { before: beforeR.elo, after: after.elo });
  ok('rating carries the current season', !!(after.season && after.season.number >= 1 && typeof after.season.daysLeft === 'number'), after.season);
  ok('rating carries placement progress', typeof after.placementGames === 'number' && after.placementNeeded === 5, { pg: after.placementGames, pn: after.placementNeeded });
}

// ── 7b. Placement: a fresh hunter is unranked until 5 ranked matches; placement advances
//        one per ranked duel and the rank stays hidden until placed. ──
async function placementTest() {
  console.log('\n[7b] Season placement (fresh hunter)');
  const t = await mint('pvp-place-' + Date.now() + '-' + Math.floor(Math.random() * 1e4), 'Placer');
  const r0 = await api(t, 'GET', '/v1/pvp/rating');
  ok('fresh hunter starts unplaced at 0/5', r0.placementGames === 0 && r0.placed === false, { pg: r0.placementGames, placed: r0.placed });
  for (let n = 0; n < 2; n++) {
    const code = (await api(t, 'POST', '/v1/pvp/find', { combatant: COMB_A })).code;
    if (!code) { ok('placement: find a bot match', false, 'no code'); return; }
    let guard = 0;
    while (guard++ < 90) { const s = (await api(t, 'GET', '/v1/pvp/state?code=' + code)).state; if (!s || s.phase === 'ended') break; await api(t, 'POST', '/v1/pvp/submit', { code, turn: s.turn, moveId: firstMove(s.me) }); await sleep(20); }
    await sleep(120);
  }
  const r2 = await api(t, 'GET', '/v1/pvp/rating');
  ok('placement advances one per ranked match (2/5)', r2.placementGames === 2, { pg: r2.placementGames });
  ok('rank stays hidden before placed', r2.placed === false && r2.rank == null, { placed: r2.placed, rank: r2.rank });
}

// ── 7c. Season roll: when the window expires, a prior-season row is projected as a soft reset
//        on read (elo halves its distance to 1500, placement re-opens) and committed on the next
//        ranked match. Forces the roll by ageing the local season window via wrangler d1. ──
async function playBotToKo(t) {
  const code = (await api(t, 'POST', '/v1/pvp/find', { combatant: COMB_A })).code;
  if (!code) return false;
  let guard = 0;
  while (guard++ < 90) { const s = (await api(t, 'GET', '/v1/pvp/state?code=' + code)).state; if (!s || s.phase === 'ended') break; await api(t, 'POST', '/v1/pvp/submit', { code, turn: s.turn, moveId: firstMove(s.me) }); await sleep(20); }
  await sleep(120);
  return true;
}
async function seasonResetTest() {
  console.log('\n[7c] Season roll soft-reset');
  const t = await mint('pvp-reset-' + Date.now() + '-' + Math.floor(Math.random() * 1e4), 'Resetter');
  if (!(await playBotToKo(t))) { ok('reset: play a seeding match', false); return; }
  const r1 = await api(t, 'GET', '/v1/pvp/rating');
  const elo1 = r1.elo, seasonN = r1.season && r1.season.number;
  ok('seeded one ranked match this season (1/5)', r1.placementGames === 1, { pg: r1.placementGames });
  let rolled = false;
  try {
    execSync("npx wrangler d1 execute awakened-db --local --command \"UPDATE pvp_seasons SET ends_at = datetime('now','-1 day') WHERE number = (SELECT MAX(number) FROM pvp_seasons)\"", { cwd: 'backend', stdio: 'ignore' });
    rolled = true;
  } catch { rolled = false; }
  if (!rolled) { ok('reset: roll the local season (wrangler d1)', false); return; }
  const r2 = await api(t, 'GET', '/v1/pvp/rating');
  const expected = Math.round(1500 + (elo1 - 1500) * 0.5);
  ok('a new season rolls in on read', !!(r2.season && r2.season.number === seasonN + 1), { was: seasonN, now: r2.season && r2.season.number });
  ok('elo soft-resets toward 1500 (read projection)', r2.elo === expected, { elo1, expected, got: r2.elo });
  ok('placement re-opens, rank hidden (0/5)', r2.placementGames === 0 && r2.placed === false && r2.rank == null, { pg: r2.placementGames, placed: r2.placed, rank: r2.rank });
  if (!(await playBotToKo(t))) { ok('reset: play a new-season match', false); return; }
  const r3 = await api(t, 'GET', '/v1/pvp/rating');
  ok('reset commits on the next match (1/5, new season)', !!(r3.placementGames === 1 && r3.season && r3.season.number === seasonN + 1), { pg: r3.placementGames, season: r3.season && r3.season.number });
}

// ── 8. Bot match over WS — the live session HP (top-level pHP/bHP) must equal the
//       viewBySlot REBUILD HP (me/opp) every turn. They diverge if the rebuild doesn't
//       re-pick the bot move (rng drift). Regression for that determinism fix. ──
async function botWsDeterminismTest() {
  console.log('\n[8] Bot match over WS — live vs rebuild HP consistency');
  const t = await mint('pvp-botws-1', 'BotWs');
  const found = await api(t, 'POST', '/v1/pvp/find', { combatant: COMB_A });
  if (!(found && found.code)) { ok('bot WS: find', false, found); return; }
  const code = found.code;
  await new Promise((resolve) => {
    let ws; try { ws = new WebSocket(WS_BASE + '/v1/pvp/ws?code=' + code + '&token=' + t); }
    catch (e) { ok('bot WS (transport)', false, String(e)); return resolve(); }
    let mismatches = 0, turns = 0, done = false;
    const to = setTimeout(() => { if (!done) { ok('bot WS match resolved', false, { turns }); } try { ws.close(); } catch {} resolve(); }, 18000);
    const maybeSubmit = (m) => { if (m.phase === 'active' && m.me && !m.youSubmitted && !m.done) { try { ws.send(JSON.stringify({ type: 'submit_move', turn: m.turn, moveId: firstMove(m.me) })); } catch {} } };
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'turn_result') {
        turns++;
        if (m.me && Math.abs((m.pHP || 0) - (m.me.hp || 0)) > 1e-6) mismatches++;
        if (m.opp && Math.abs((m.bHP || 0) - (m.opp.hp || 0)) > 1e-6) mismatches++;
      }
      if (m.type === 'state' || m.type === 'turn_result') maybeSubmit(m);
      if (m.type === 'match_end') {
        done = true;
        ok('bot WS match resolved with a winner', !!(m.result && m.result.winnerSide), m.result);
        ok('live sess HP === rebuild HP every turn (no rng drift in bot replay)', mismatches === 0, { mismatches, turns });
        clearTimeout(to); try { ws.close(); } catch {} resolve();
      }
    });
    ws.addEventListener('error', () => { ok('bot WS (transport)', false); clearTimeout(to); resolve(); });
  });
}

const openWs = (ws) => new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('open timeout')), 8000); ws.addEventListener('open', () => { clearTimeout(to); res(); }); ws.addEventListener('error', () => { clearTimeout(to); rej(new Error('ws error')); }); });

// ── 9. Rematch (human): play -> end -> p1 offers -> p2 accepts -> fresh active match. ──
async function rematchTest() {
  console.log('\n[9] Rematch (human) — offer -> accept -> fresh match');
  const t1 = await mint('pvp-rm-1', 'RmA'), t2 = await mint('pvp-rm-2', 'RmB');
  const created = await api(t1, 'POST', '/v1/pvp/create', { combatant: COMB_A, ranked: true });
  const code = created.code;
  await api(t2, 'POST', '/v1/pvp/join', { code, combatant: COMB_B });
  let guard = 0, ended = false;
  while (guard++ < 80) {
    const s1 = (await api(t1, 'GET', '/v1/pvp/state?code=' + code)).state;
    if (!s1) break;
    if (s1.phase === 'ended') { ended = true; break; }
    const s2 = (await api(t2, 'GET', '/v1/pvp/state?code=' + code)).state;
    await api(t1, 'POST', '/v1/pvp/submit', { code, turn: s1.turn, moveId: firstMove(s1.me) });
    await api(t2, 'POST', '/v1/pvp/submit', { code, turn: s2.turn, moveId: firstMove(s2.me) });
    await sleep(18);
  }
  ok('first match ended', ended);
  try {
    const ws1 = new WebSocket(WS_BASE + '/v1/pvp/ws?code=' + code + '&token=' + t1);
    const ws2 = new WebSocket(WS_BASE + '/v1/pvp/ws?code=' + code + '&token=' + t2);
    let offer = false, p1Start = false, p2Start = false;
    ws2.addEventListener('message', (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === 'rematch_offer') offer = true; if (m.type === 'match_start' && m.phase === 'active' && m.turn === 1) p2Start = true; });
    ws1.addEventListener('message', (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === 'match_start' && m.phase === 'active' && m.turn === 1) p1Start = true; });
    await Promise.all([openWs(ws1), openWs(ws2)]);
    await sleep(200);
    await api(t1, 'POST', '/v1/pvp/rematch', { code });
    await sleep(450);
    ok('opponent receives a rematch_offer', offer);
    const acc = await api(t2, 'POST', '/v1/pvp/rematch', { code });
    await sleep(500);
    ok('mutual rematch resets into a fresh active match', !!(acc.ok && acc.started), acc);
    ok('both clients get the fresh match_start (turn 1, active)', p1Start && p2Start, { p1Start, p2Start });
    const ns = (await api(t1, 'GET', '/v1/pvp/state?code=' + code)).state;
    ok('rematch match is active, turn 1, no result', !!(ns && ns.phase === 'active' && ns.turn === 1 && !ns.result), ns && { phase: ns.phase, turn: ns.turn });
    try { ws1.close(); ws2.close(); } catch {}
  } catch (e) { ok('rematch (transport)', false, String(e && e.message)); }
}

// ── 9b. Rematch must NOT inherit a stale disconnect. A player who connected over WS, dropped
//        >grace ago, then rejoins the rematch with no socket (HTTP) must not be force-forfeited
//        on the rematch's first turn alarm. Regression for resetForRematch not clearing lastSeen.
//        Needs PVP_DISCONNECT_GRACE_MS=2000 + PVP_TURN_DEADLINE_MS=3000 in .dev.vars. ──
async function rematchStalePresenceTest() {
  console.log('\n[9b] Rematch does not inherit a stale-disconnect forfeit');
  const t1 = await mint('pvp-rmsp-1', 'Present'), t2 = await mint('pvp-rmsp-2', 'Dropped');
  const code = (await api(t1, 'POST', '/v1/pvp/create', { combatant: COMB_A, ranked: true })).code;
  await api(t2, 'POST', '/v1/pvp/join', { code, combatant: COMB_B });
  let ws1, ws2;
  try {
    ws1 = new WebSocket(WS_BASE + '/v1/pvp/ws?code=' + code + '&token=' + t1);   // present player keeps its socket
    ws2 = new WebSocket(WS_BASE + '/v1/pvp/ws?code=' + code + '&token=' + t2);   // stamps lastSeen[b] so the drop is "stale", not 0
    await Promise.all([openWs(ws1), openWs(ws2)]);
  } catch (e) { ok('rematch stale-presence (transport)', false, String(e && e.message)); return; }
  let guard = 0, ended = false;
  while (guard++ < 80) {
    const s1 = (await api(t1, 'GET', '/v1/pvp/state?code=' + code)).state;
    if (!s1) break; if (s1.phase === 'ended') { ended = true; break; }
    const s2 = (await api(t2, 'GET', '/v1/pvp/state?code=' + code)).state;
    await api(t1, 'POST', '/v1/pvp/submit', { code, turn: s1.turn, moveId: firstMove(s1.me) });
    await api(t2, 'POST', '/v1/pvp/submit', { code, turn: s2.turn, moveId: firstMove(s2.me) });
    await sleep(18);
  }
  ok('seed match ended', ended);
  try { ws2.close(); } catch {}     // P2 drops: connected[b]=false, lastSeen[b]=now
  await sleep(2600);                // wait PAST the (2s) grace so lastSeen[b] is stale
  await api(t1, 'POST', '/v1/pvp/rematch', { code });
  const acc = await api(t2, 'POST', '/v1/pvp/rematch', { code });   // P2 accepts over HTTP (no socket)
  ok('rematch reset into a fresh active match', !!(acc.ok && acc.started), acc);
  await sleep(3800);                // let the rematch's FIRST turn alarm fire (deadline 3s)
  const st = (await api(t1, 'GET', '/v1/pvp/state?code=' + code)).state;
  const disco = !!(st && st.phase === 'ended' && st.result && st.result.reason === 'disconnect');
  ok('rematch did NOT force-forfeit the rejoined player on turn 1 (stale lastSeen cleared)', !disco, st && st.result);
  try { ws1.close(); } catch {}
}

// ── 10. Rematch decline: p1 offers, p2 declines -> requester sees rematch_declined. ──
async function rematchDeclineTest() {
  console.log('\n[10] Rematch decline');
  const t1 = await mint('pvp-rmd-1', 'A'), t2 = await mint('pvp-rmd-2', 'B');
  const code = (await api(t1, 'POST', '/v1/pvp/create', { combatant: COMB_A, ranked: true })).code;
  await api(t2, 'POST', '/v1/pvp/join', { code, combatant: COMB_B });
  await api(t1, 'POST', '/v1/pvp/forfeit', { code });   // end fast
  try {
    const ws1 = new WebSocket(WS_BASE + '/v1/pvp/ws?code=' + code + '&token=' + t1);
    let declined = false;
    ws1.addEventListener('message', (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === 'rematch_declined') declined = true; });
    await openWs(ws1);
    await sleep(150);
    await api(t1, 'POST', '/v1/pvp/rematch', { code });
    await sleep(200);
    await api(t2, 'POST', '/v1/pvp/rematch/decline', { code });
    await sleep(400);
    ok('requester sees rematch_declined', declined);
    try { ws1.close(); } catch {}
  } catch (e) { ok('rematch decline (transport)', false, String(e && e.message)); }
}

// ── 14. Duel a Friend's Echo (W440) — unranked AI mirror of an accepted friend's published
//        loadout. Seeds users + public_profile_summary + an accepted friendship into the LOCAL
//        D1 (file-based so the combatant JSON never hits the shell), then exercises the friendship
//        gate, the NO_ECHO gate, the unknown-alias gate, and a full unranked bot duel. ──
async function echoFriendTest() {
  console.log('\n[14] Duel a Friend\'s Echo (W440)');
  const CHAL = 'pvp-echo-chal';
  const FRIEND = 'pvp-echo-friend', FRIEND_ALIAS = 'EchoFriend';
  const NOCOMB = 'pvp-echo-nocomb', NOCOMB_ALIAS = 'EchoNoComb';
  const STRANGER = 'pvp-echo-stranger', STRANGER_ALIAS = 'EchoStranger';
  const combJson = JSON.stringify({ name: FRIEND_ALIAS, weaponId: 'nightfall_blade', weaponName: 'Nightfall', avatar: 'avatar-sage.png', stats: { STR: 12, VIT: 14, INT: 8, FOCUS: 9, WILL: 7, WLT: 3 } }).replace(/'/g, "''");
  const seedPath = 'backend/.echo-seed.sql';
  try {
    const sql = [
      // the hand-built local D1 may lack `users` — create it to match the prod schema
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, apple_sub TEXT UNIQUE NOT NULL, alias TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);",
      `INSERT OR REPLACE INTO users (id, apple_sub, alias, created_at, updated_at) VALUES ('${FRIEND}','as-${FRIEND}','${FRIEND_ALIAS}',0,0);`,
      `INSERT OR REPLACE INTO users (id, apple_sub, alias, created_at, updated_at) VALUES ('${NOCOMB}','as-${NOCOMB}','${NOCOMB_ALIAS}',0,0);`,
      `INSERT OR REPLACE INTO users (id, apple_sub, alias, created_at, updated_at) VALUES ('${STRANGER}','as-${STRANGER}','${STRANGER_ALIAS}',0,0);`,
      `INSERT OR REPLACE INTO public_profile_summary (user_id, rank_tier, rank_label, client_updated_at, server_updated_at, combatant_json) VALUES ('${FRIEND}','D','D II','2026-01-01T00:00:00.000Z',0,'${combJson}');`,
      `INSERT OR REPLACE INTO public_profile_summary (user_id, rank_tier, rank_label, client_updated_at, server_updated_at, combatant_json) VALUES ('${NOCOMB}','D','D II','2026-01-01T00:00:00.000Z',0,NULL);`,
      // STRANGER is in users but has NO friends row -> the friendship gate (403), not 404
      `INSERT OR REPLACE INTO friends (id, requester_user_id, recipient_user_id, status) VALUES ('echo-fr-1','${CHAL}','${FRIEND}','accepted');`,
      `INSERT OR REPLACE INTO friends (id, requester_user_id, recipient_user_id, status) VALUES ('echo-fr-2','${CHAL}','${NOCOMB}','accepted');`,
    ].join('\n');
    writeFileSync(seedPath, sql);
    execSync('npx wrangler d1 execute awakened-db --local --file .echo-seed.sql', { cwd: 'backend', stdio: 'ignore' });
  } catch (e) { ok('echo: seed local D1 (users/ppl/friends)', false, String(e && e.message)); return; }
  finally { try { rmSync(seedPath, { force: true }); } catch {} }

  const t = await mint(CHAL, 'EchoChal');

  // a) an accepted-friend gate: a non-friend (exists, but no friendship) is refused
  const stranger = await api(t, 'POST', '/v1/pvp/echo-friend', { friendAlias: STRANGER_ALIAS, combatant: COMB_A });
  ok('echo a non-friend is refused (NOT_FRIENDS)', stranger && stranger.error === 'NOT_FRIENDS', stranger);
  // b) a friend who hasn't published a loadout -> NO_ECHO
  const nocomb = await api(t, 'POST', '/v1/pvp/echo-friend', { friendAlias: NOCOMB_ALIAS, combatant: COMB_A });
  ok('friend without a published loadout -> NO_ECHO', nocomb && nocomb.error === 'NO_ECHO', nocomb);
  // c) an unknown alias -> NOT_FOUND
  const ghost = await api(t, 'POST', '/v1/pvp/echo-friend', { friendAlias: 'NoSuchHunterXYZ', combatant: COMB_A });
  ok('unknown alias -> NOT_FOUND', ghost && ghost.error === 'NOT_FOUND', ghost);

  // d) the happy path: an accepted friend WITH a loadout -> an UNRANKED Echo duel
  const before = await api(t, 'GET', '/v1/pvp/rating');
  const beforeN = (before.wins || 0) + (before.losses || 0) + (before.draws || 0);
  const echo = await api(t, 'POST', '/v1/pvp/echo-friend', { friendAlias: FRIEND_ALIAS, combatant: COMB_A });
  ok('friend Echo starts (vsBot + friendEcho + code)', !!(echo.ok && echo.code && echo.vsBot === true && echo.friendEcho === true), echo);
  ok('Echo opponent is the friend', !!(echo.opponent && echo.opponent.alias === FRIEND_ALIAS), echo.opponent);
  ok('Echo match is UNRANKED (state.ranked === false)', !!(echo.state && echo.state.ranked === false), echo.state && { ranked: echo.state.ranked });
  ok('Echo opponent is a bot, reported connected (no d/c wedge)', !!(echo.state && echo.state.opp && echo.state.opp.isBot === true && echo.state.oppConnected === true), echo.state && echo.state.opp);
  // mirror of the friend's loadout: the bot fights with the friend's weapon
  ok('Echo bot carries the friend\'s weapon', !!(echo.state && echo.state.opp && echo.state.opp.weaponName === 'Nightfall'), echo.state && echo.state.opp);

  const code = echo.code;
  let guard = 0, result = null;
  while (guard++ < 90) {
    const s = (await api(t, 'GET', '/v1/pvp/state?code=' + code)).state;
    if (!s) break;
    if (s.phase === 'ended') { result = s.result; break; }
    await api(t, 'POST', '/v1/pvp/submit', { code, turn: s.turn, moveId: firstMove(s.me) });
    await sleep(20);
  }
  ok('Echo duel ends with a result', !!(result && (result.winnerSide === 'p' || result.winnerSide === 'b' || result.winnerSide === 'draw')), result);
  await sleep(150);
  const after = await api(t, 'GET', '/v1/pvp/rating');
  const afterN = (after.wins || 0) + (after.losses || 0) + (after.draws || 0);
  ok('UNRANKED: no ranked match recorded, ELO unchanged', afterN === beforeN && after.elo === before.elo, { beforeN, afterN, beforeElo: before.elo, afterElo: after.elo });
}

(async () => {
  // wait for the worker to be reachable
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) { up = true; break; } } catch {}
    await sleep(500);
  }
  if (!up) { console.error('worker not reachable at ' + BASE + ' — is `wrangler dev` running?'); process.exit(2); }
  console.log('worker is up at ' + BASE);
  await httpMatch();
  await wsMatch();
  await forfeitTest();
  await timeoutTest();
  await reconnectTest();
  await friendlyUnrankedTest();
  await botMatchTest();
  await placementTest();
  await seasonResetTest();
  await botWsDeterminismTest();
  await rematchTest();
  await rematchStalePresenceTest();
  await rematchDeclineTest();
  await echoFriendTest();
  console.log('\nPvP integration: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
