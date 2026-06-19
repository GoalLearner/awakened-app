// match-room.itest.mjs — local integration test for the PvP MatchRoom Durable
// Object. Requires `wrangler dev` running on :8787 with backend/.dev.vars
// (JWT_SIGNING_KEY + PVP_TURN_DEADLINE_MS=3000).
//   node backend/src/pvp/match-room.itest.mjs
//
// Drives full matches over BOTH transports (HTTP poll + WebSocket) and exercises
// the ugly paths: forfeit + turn-timeout auto-resolve.
import { SignJWT } from 'jose';

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
    const out = { end: null, turns: 0, ws };
    const to = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('ws timeout')); }, 20000);
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'state' || m.type === 'match_start' || m.type === 'turn_result') {
        if (m.type === 'turn_result') out.turns++;
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

// ── 6. Ranked match -> MMR moves symmetrically + match_end carries the delta. ──
async function rankedTest() {
  console.log('\n[6] Ranked match -> MMR update');
  const t1 = await mint('pvp-rank-1', 'RankA'), t2 = await mint('pvp-rank-2', 'RankB');
  const before1 = (await api(t1, 'GET', '/v1/pvp/rating')).elo;
  const before2 = (await api(t2, 'GET', '/v1/pvp/rating')).elo;
  const created = await api(t1, 'POST', '/v1/pvp/create', { combatant: COMB_A, ranked: true });
  const code = created.code;
  ok('ranked create returns a code', !!(created.ok && code), created);
  const joined = await api(t2, 'POST', '/v1/pvp/join', { code, combatant: COMB_B });
  ok('ranked join -> active', !!(joined.ok && joined.state && joined.state.ranked === true), joined && joined.state);
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
  ok('ranked match ended with a winner', !!(result && (result.winnerSide === 'p' || result.winnerSide === 'b')), result);
  await sleep(150); // let the post-end D1 write settle
  const after1 = await api(t1, 'GET', '/v1/pvp/rating');
  const after2 = await api(t2, 'GET', '/v1/pvp/rating');
  const winP = result && result.winnerSide === 'p';
  const winBefore = winP ? before1 : before2, winAfter = (winP ? after1 : after2).elo;
  const loseBefore = winP ? before2 : before1, loseAfter = (winP ? after2 : after1).elo;
  ok('winner gained ELO', winAfter > winBefore, { winBefore, winAfter });
  ok('loser lost ELO', loseAfter < loseBefore, { loseBefore, loseAfter });
  ok('movement is symmetric (same K-bracket)', (winAfter - winBefore) === (loseBefore - loseAfter), { gain: winAfter - winBefore, loss: loseBefore - loseAfter });
  ok('winner has a tier label', !!((winP ? after1 : after2).tier), winP ? after1.tier : after2.tier);
  ok('match_end view carried the per-player rating delta', !!(endView && endView.rating && typeof endView.rating.delta === 'number'), endView && endView.rating);
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
  await rankedTest();
  console.log('\nPvP integration: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
