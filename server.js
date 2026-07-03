// 섯다 게임 서버: 계정, 로비, 방, 게임 진행
'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { createDeck, shuffle, evaluate, decideWinners } = require('./game');

const PORT = process.env.PORT || 3100;
const DEBUG = !!process.env.SEOTDA_DEBUG;
const dlog = (...a) => { if (DEBUG) console.log('[debug]', ...a); };

// 예기치 못한 오류도 로그에 남도록 (Render 로그에서 확인 가능)
process.on('unhandledRejection', (e) => console.error('[fatal] 처리되지 않은 Promise 오류:', e));
process.on('uncaughtException', (e) => console.error('[fatal] 처리되지 않은 예외:', e));
const START_MONEY = 100_000_000; // 기본 지급 1억
const ANTE = 10_000; // 판돈(삥 단위)
const TURN_TIME = 30_000; // 베팅 제한시간
const RESULT_TIME = 6_000; // 결과 표시 후 다음 판까지

// ---------- 유저 저장소 (db.js: Supabase 또는 로컬 JSON 폴백) ----------
const db = require('./db');
const users = db.users; // 인메모리 캐시 (게임 로직은 동기 접근)
const saveUsers = db.save;

// ---------- HTTP ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || !/^[가-힣a-zA-Z0-9_]{2,12}$/.test(username)) {
    return res.status(400).json({ error: '닉네임은 2~12자 한글/영문/숫자만 가능합니다.' });
  }
  if (password.length < 4) return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
  if (await db.getUser(username)) return res.status(409).json({ error: '이미 존재하는 닉네임입니다.' });
  const token = crypto.randomBytes(24).toString('hex');
  try {
    await db.createUser(username, { pwHash: bcrypt.hashSync(password, 10), money: START_MONEY, token, wins: 0, losses: 0 });
  } catch (e) {
    if (e.message !== 'exists') console.error(`[register] 저장소 오류 (${username}):`, e);
    return res.status(e.message === 'exists' ? 409 : 500)
      .json({ error: e.message === 'exists' ? '이미 존재하는 닉네임입니다.' : '저장소 오류가 발생했습니다.' });
  }
  console.log(`[register] 가입 완료: ${username}`);
  res.json({ token, username, money: START_MONEY });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const u = await db.getUser(username);
  if (!u || !bcrypt.compareSync(password || '', u.pwHash)) {
    return res.status(401).json({ error: '닉네임 또는 비밀번호가 틀렸습니다.' });
  }
  u.token = crypto.randomBytes(24).toString('hex');
  saveUsers(username);
  res.json({ token: u.token, username, money: u.money });
});

const server = http.createServer(app);
const io = new Server(server);

// ---------- 방 관리 ----------
const rooms = new Map(); // roomId -> room
const socketsByUser = new Map(); // username -> socket
let roomSeq = 1;

function makeRoom(name, hostId) {
  const id = 'r' + roomSeq++;
  const room = {
    id, name: name || `${hostId}의 방`, hostId,
    phase: 'waiting', // waiting | playing
    players: [], // {id, ready, leaveReserved, joinNext, cards, hand, folded, allIn, betStreet, acted}
    pot: 0, carryPot: 0, currentBet: 0, lastRaise: 0,
    turnIdx: -1, dealerIdx: -1, turnDeadline: 0, turnTimer: null, roundTimer: null,
    lastResult: null, roundNo: 0,
  };
  rooms.set(id, room);
  return room;
}

function lobbySummary() {
  return [...rooms.values()].map((r) => ({
    id: r.id, name: r.name, host: r.hostId, phase: r.phase, count: r.players.length, max: 5,
  }));
}
function broadcastLobby() { io.emit('lobby:rooms', lobbySummary()); }

function playerView(room, viewerId) {
  const showdown = room.lastResult && room.phase === 'playing' && room.roundPhase === 'result';
  return {
    id: room.id, name: room.name, hostId: room.hostId, phase: room.phase,
    roundPhase: room.roundPhase || null, roundNo: room.roundNo,
    pot: room.pot, carryPot: room.carryPot, currentBet: room.currentBet, ante: ANTE,
    lastRaise: room.lastRaise, turnTime: TURN_TIME,
    turnId: room.turnIdx >= 0 ? room.players[room.turnIdx]?.id : null,
    turnDeadline: room.turnDeadline,
    lastResult: room.lastResult,
    players: room.players.map((p) => ({
      id: p.id, money: users[p.id]?.money ?? 0, ready: p.ready,
      leaveReserved: p.leaveReserved, folded: p.folded, allIn: p.allIn,
      betStreet: p.betStreet, inRound: p.inRound,
      cards: p.cards
        ? (p.id === viewerId || (showdown && !p.folded && p.revealed) ? p.cards : p.cards.map(() => null))
        : null,
      hand: (p.id === viewerId || (showdown && !p.folded && p.revealed)) && p.hand ? p.hand.name : null,
    })),
  };
}

function syncRoom(room) {
  for (const p of room.players) {
    const s = socketsByUser.get(p.id);
    if (s) s.emit('room:state', playerView(room, p.id));
  }
  broadcastLobby();
}

function roomToast(room, msg) {
  for (const p of room.players) {
    const s = socketsByUser.get(p.id);
    if (s) s.emit('toast', msg);
  }
}

function sendMe(id) {
  const s = socketsByUser.get(id);
  if (s && users[id]) s.emit('me', { username: id, money: users[id].money });
}

// ---------- 게임 진행 ----------
function activePlayers(room) { return room.players.filter((p) => p.inRound && !p.folded); }

function clearTimers(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
}

function startRound(room) {
  clearTimers(room);
  // 나가기 예약 / 파산 / 접속끊김 정리
  for (const p of [...room.players]) {
    if (p.leaveReserved || !socketsByUser.get(p.id) || (users[p.id]?.money ?? 0) < ANTE) {
      if ((users[p.id]?.money ?? 0) < ANTE && !p.leaveReserved) {
        const s = socketsByUser.get(p.id);
        if (s) s.emit('toast', '게임머니가 부족하여 방에서 나갑니다.');
      }
      removePlayer(room, p.id, false);
    }
  }
  if (!rooms.has(room.id)) return;
  if (room.players.length < 2) {
    room.phase = 'waiting';
    room.roundPhase = null;
    room.pot = 0; room.carryPot = 0;
    for (const p of room.players) { p.ready = false; p.cards = null; p.hand = null; p.inRound = false; }
    roomToast(room, '인원이 부족하여 대기 상태로 전환합니다.');
    syncRoom(room);
    return;
  }

  dlog(`startRound #${room.roundNo + 1} room=${room.id} players=${room.players.map((p) => `${p.id}(${users[p.id]?.money})`).join(',')} carry=${room.carryPot}`);
  room.roundNo++;
  room.roundPhase = 'betting';
  room.lastResult = null;
  room.pot = room.carryPot; room.carryPot = 0;
  room.currentBet = 0; room.lastRaise = 0;
  room.dealerIdx = (room.dealerIdx + 1) % room.players.length;

  const deck = shuffle(createDeck());
  for (const p of room.players) {
    p.inRound = true; p.folded = false; p.allIn = false; p.acted = false;
    p.betStreet = 0; p.revealed = false;
    p.cards = [deck.pop(), deck.pop()];
    p.hand = evaluate(p.cards[0], p.cards[1]);
    // 판돈(ante)
    users[p.id].money -= ANTE;
    room.pot += ANTE;
    p.paid = ANTE; // 이번 판 지출 누계 (결과 기록용)
    sendMe(p.id);
  }
  saveUsers();

  room.turnIdx = nextActiveIdx(room, room.dealerIdx);
  if (room.turnIdx === -1) return showdown(room, false); // 전원 올인 등 베팅 불가 상황
  armTurnTimer(room);
  syncRoom(room);
}

function nextActiveIdx(room, fromIdx) {
  const n = room.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIdx + i) % n;
    const p = room.players[idx];
    if (p.inRound && !p.folded && !p.allIn) return idx;
  }
  return -1;
}

function armTurnTimer(room) {
  clearTimers(room);
  room.turnDeadline = Date.now() + TURN_TIME;
  room.turnTimer = setTimeout(() => {
    const p = room.players[room.turnIdx];
    if (p && room.roundPhase === 'betting') {
      roomToast(room, `${p.id}님이 시간 초과로 다이했습니다.`);
      applyAction(room, p, 'die');
    }
  }, TURN_TIME);
}

function bettingSettled(room) {
  const act = activePlayers(room);
  return act.every((p) => p.allIn || (p.acted && p.betStreet === room.currentBet));
}

function payToPot(room, p, amount) {
  const cash = users[p.id].money;
  const pay = Math.min(amount, cash); // 잔액 초과 시 올인 처리 (사이드팟 없음, 친선전 간소화)
  dlog(`pay ${p.id} amount=${amount} pay=${pay} cash=${cash} pot=${room.pot}→${room.pot + pay} curBet=${room.currentBet}`);
  users[p.id].money -= pay;
  p.betStreet += pay;
  p.paid += pay;
  room.pot += pay;
  if (users[p.id].money === 0) p.allIn = true;
  sendMe(p.id);
  return pay;
}

function applyAction(room, p, type) {
  if (room.roundPhase !== 'betting') return '지금은 베팅할 수 없습니다.';
  const cur = room.players[room.turnIdx];
  if (!cur || cur.id !== p.id) return '내 차례가 아닙니다.';

  const toCall = room.currentBet - p.betStreet;
  const potNow = room.pot;

  switch (type) {
    case 'die':
      p.folded = true;
      break;
    case 'call':
      if (toCall <= 0 && p.acted) return '콜 할 금액이 없습니다.';
      payToPot(room, p, toCall);
      break;
    case 'check':
      if (toCall > 0) return '베팅이 있어 체크할 수 없습니다.';
      break;
    case 'bbing': { // 삥: 기본 단위 베팅 (첫 베팅만)
      if (room.currentBet > 0) return '이미 베팅이 시작되어 삥을 할 수 없습니다.';
      payToPot(room, p, ANTE);
      room.currentBet = p.betStreet;
      room.lastRaise = ANTE;
      break;
    }
    case 'ddadang': { // 따당: 직전 베팅의 2배로 레이즈
      if (room.currentBet === 0) return '따당은 베팅이 있어야 가능합니다.';
      const target = room.currentBet + room.lastRaise * 2;
      const raise = target - room.currentBet;
      payToPot(room, p, target - p.betStreet);
      if (p.betStreet > room.currentBet) {
        room.lastRaise = p.betStreet - room.currentBet;
        room.currentBet = p.betStreet;
        for (const q of activePlayers(room)) if (q !== p) q.acted = false;
      }
      break;
    }
    case 'half': { // 하프: (팟 + 콜금액)의 절반 레이즈
      const raise = Math.max(ANTE, Math.floor((potNow + toCall) / 2));
      payToPot(room, p, toCall + raise);
      if (p.betStreet > room.currentBet) {
        room.lastRaise = p.betStreet - room.currentBet;
        room.currentBet = p.betStreet;
        for (const q of activePlayers(room)) if (q !== p) q.acted = false;
      }
      break;
    }
    case 'allin': {
      payToPot(room, p, users[p.id].money);
      if (p.betStreet > room.currentBet) {
        room.lastRaise = p.betStreet - room.currentBet;
        room.currentBet = p.betStreet;
        for (const q of activePlayers(room)) if (q !== p) q.acted = false;
      }
      break;
    }
    default:
      return '알 수 없는 액션입니다.';
  }
  p.acted = true;
  saveUsers();
  advanceTurn(room);
  return null;
}

function advanceTurn(room) {
  const act = activePlayers(room);
  if (act.length <= 1) return showdown(room, true);
  if (bettingSettled(room)) return showdown(room, false);
  room.turnIdx = nextActiveIdx(room, room.turnIdx);
  if (room.turnIdx === -1) return showdown(room, false);
  armTurnTimer(room);
  syncRoom(room);
}

function showdown(room, byFold) {
  clearTimers(room);
  dlog(`showdown room=${room.id} round=${room.roundNo} byFold=${byFold} pot=${room.pot} phase=${room.roundPhase}`);
  if (room.roundPhase === 'result') return; // 중복 쇼다운 방지
  room.roundPhase = 'result';
  room.turnIdx = -1;
  const act = activePlayers(room);

  let result;
  const awards = {}; // username -> 이번 판 획득액 (결과 기록용)
  if (act.length === 0) {
    // 활성 플레이어 전원 이탈 → 팟을 다음 판으로 이월
    room.carryPot += room.pot;
    room.pot = 0;
    result = { type: 'replay', reason: '전원 이탈', carry: room.carryPot, entries: [] };
  } else if (byFold && act.length === 1) {
    // 전원 다이 → 남은 한 명이 팟 획득 (패 공개 없음)
    const w = act[0];
    users[w.id].money += room.pot;
    users[w.id].wins++;
    awards[w.id] = room.pot;
    result = { type: 'fold', winners: [w.id], amount: room.pot, entries: [] };
    room.pot = 0;
    sendMe(w.id);
  } else {
    for (const p of act) p.revealed = true;
    const entries = act.map((p) => ({ id: p.id, hand: p.hand }));
    const decision = decideWinners(entries);
    if (decision.replay) {
      // 구사/멍텅구리구사 재경기: 팟이 다음 판으로 이월
      room.carryPot = room.pot;
      room.pot = 0;
      result = {
        type: 'replay', reason: decision.replayReason, carry: room.carryPot,
        entries: entries.map((e) => ({ id: e.id, name: e.hand.name, special: e.hand.special })),
      };
    } else {
      const share = Math.floor(room.pot / decision.winners.length);
      decision.winners.forEach((id, i) => {
        const won = share + (i === 0 ? room.pot - share * decision.winners.length : 0);
        users[id].money += won;
        users[id].wins++;
        awards[id] = won;
        sendMe(id);
      });
      for (const p of act) if (!decision.winners.includes(p.id)) users[p.id].losses++;
      result = {
        type: 'showdown', winners: decision.winners, amount: room.pot, note: decision.note,
        entries: entries.map((e) => ({ id: e.id, name: e.hand.name, special: e.hand.special })),
      };
      room.pot = 0;
    }
  }
  // 게임 결과 기록: 참가자별 승패와 금액 증감 (delta = 획득액 - 이번 판 지출)
  const winnersArr = result.winners || [];
  db.recordResults(room.players.filter((p) => p.inRound).map((p) => ({
    room_name: room.name,
    round_no: room.roundNo,
    username: p.id,
    result: result.type === 'replay' ? 'replay'
      : winnersArr.includes(p.id) ? (winnersArr.length > 1 ? 'draw' : 'win') : 'lose',
    delta: (awards[p.id] || 0) - (p.paid || 0),
    hand: p.hand ? p.hand.name : null,
    pot: result.type === 'replay' ? result.carry : result.amount,
  })));

  saveUsers();
  room.lastResult = result;
  syncRoom(room);
  for (const p of room.players) sendMe(p.id);

  // 자동으로 다음 판 진행
  room.roundTimer = setTimeout(() => {
    if (rooms.has(room.id) && room.phase === 'playing') startRound(room);
  }, RESULT_TIME);
}

// ---------- 입장/퇴장 ----------
function removePlayer(room, id, midRoundLoss) {
  const idx = room.players.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const p = room.players[idx];

  if (midRoundLoss && room.phase === 'playing' && room.roundPhase === 'betting' && p.inRound && !p.folded) {
    // 게임 도중 이탈 → 해당 판 패배(다이 처리, 이미 건 돈은 팟에 남음)
    p.folded = true;
    users[p.id].losses++;
    db.recordResults([{
      room_name: room.name, round_no: room.roundNo, username: id,
      result: 'lose', delta: -(p.paid || 0), hand: p.hand ? p.hand.name : null, pot: room.pot,
    }]);
    const wasTurn = room.turnIdx === idx;
    room.players.splice(idx, 1);
    if (room.turnIdx > idx) room.turnIdx--;
    fixupAfterRemoval(room, id);
    roomToast(room, `${id}님이 게임을 이탈하여 패배 처리되었습니다.`);
    if (wasTurn) advanceTurn(room);
    else {
      const act = activePlayers(room);
      if (act.length <= 1 && room.roundPhase === 'betting') showdown(room, true);
      else syncRoom(room);
    }
  } else {
    room.players.splice(idx, 1);
    if (room.turnIdx > idx) room.turnIdx--;
    else if (room.turnIdx === idx) room.turnIdx = room.turnIdx % Math.max(room.players.length, 1);
    fixupAfterRemoval(room, id);
    syncRoom(room);
  }

  const s = socketsByUser.get(id);
  if (s) { s.leave(room.id); s.emit('room:left'); s.data.roomId = null; }
  saveUsers();

  if (room.players.length === 0) {
    clearTimers(room);
    rooms.delete(room.id);
  }
  broadcastLobby();
}

function fixupAfterRemoval(room, removedId) {
  if (room.hostId === removedId && room.players.length > 0) {
    room.hostId = room.players[0].id;
    roomToast(room, `${room.hostId}님이 새 방장이 되었습니다.`);
  }
  if (room.dealerIdx >= room.players.length) room.dealerIdx = 0;
}

// ---------- 소켓 ----------
io.use(async (socket, next) => {
  const { token, username } = socket.handshake.auth || {};
  const u = await db.getUser(username).catch(() => null);
  if (!u || u.token !== token) return next(new Error('인증 실패'));
  socket.data.username = username;
  next();
});

io.on('connection', (socket) => {
  const me = socket.data.username;
  // 중복 접속 시 이전 세션을 종료하고 새 세션이 좌석을 승계
  const old = socketsByUser.get(me);
  socketsByUser.set(me, socket); // disconnect 핸들러가 방 제거를 하지 않도록 먼저 교체
  if (old && old !== socket) {
    const prevRoomId = old.data.roomId;
    old.data.roomId = null;
    old.emit('toast', '다른 곳에서 접속하여 연결이 종료됩니다.');
    old.disconnect(true);
    if (prevRoomId && rooms.has(prevRoomId)) {
      socket.data.roomId = prevRoomId;
      socket.join(prevRoomId);
    }
  }
  sendMe(me);
  socket.emit('lobby:rooms', lobbySummary());
  const curRoom = rooms.get(socket.data.roomId);
  if (curRoom) socket.emit('room:state', playerView(curRoom, me));

  socket.on('room:create', (name, cb) => {
    if (socket.data.roomId) return cb?.({ error: '이미 방에 있습니다.' });
    if ((users[me]?.money ?? 0) < ANTE) return cb?.({ error: '게임머니가 부족합니다.' });
    const room = makeRoom(String(name || '').slice(0, 20) || `${me}의 방`, me);
    joinRoom(room, socket, cb);
  });

  socket.on('room:join', (roomId, cb) => {
    if (socket.data.roomId) return cb?.({ error: '이미 방에 있습니다.' });
    const room = rooms.get(roomId);
    if (!room) return cb?.({ error: '존재하지 않는 방입니다.' });
    if (room.players.length >= 5) return cb?.({ error: '방이 가득 찼습니다. (최대 5명)' });
    if ((users[me]?.money ?? 0) < ANTE) return cb?.({ error: '게임머니가 부족합니다.' });
    joinRoom(room, socket, cb);
  });

  function joinRoom(room, socket, cb) {
    room.players.push({
      id: me, ready: false, leaveReserved: false,
      inRound: false, folded: false, allIn: false, acted: false,
      betStreet: 0, paid: 0, cards: null, hand: null, revealed: false,
    });
    socket.join(room.id);
    socket.data.roomId = room.id;
    cb?.({ ok: true, roomId: room.id });
    roomToast(room, `${me}님이 입장했습니다.`);
    syncRoom(room);
  }

  socket.on('room:ready', (ready) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.phase !== 'waiting') return;
    const p = room.players.find((p) => p.id === me);
    if (p) { p.ready = !!ready; syncRoom(room); }
  });

  socket.on('room:start', (cb) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return cb?.({ error: '방이 없습니다.' });
    if (room.hostId !== me) return cb?.({ error: '방장만 시작할 수 있습니다.' });
    if (room.phase !== 'waiting') return cb?.({ error: '이미 게임 중입니다.' });
    if (room.players.length < 2) return cb?.({ error: '2명 이상이어야 시작할 수 있습니다.' });
    const others = room.players.filter((p) => p.id !== room.hostId);
    if (!others.every((p) => p.ready)) return cb?.({ error: '모든 참가자가 준비를 완료해야 합니다.' });
    room.phase = 'playing';
    cb?.({ ok: true });
    roomToast(room, '게임을 시작합니다!');
    startRound(room);
  });

  socket.on('room:leave', (cb) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return cb?.({ error: '방이 없습니다.' });
    const p = room.players.find((p) => p.id === me);
    if (!p) return;
    if (room.phase === 'playing' && room.roundPhase === 'betting' && p.inRound && !p.folded) {
      // 게임 중에는 나가기 예약 (판이 끝나면 자동 퇴장)
      p.leaveReserved = !p.leaveReserved;
      cb?.({ ok: true, reserved: p.leaveReserved });
      roomToast(room, p.leaveReserved ? `${me}님이 나가기를 예약했습니다.` : `${me}님이 나가기 예약을 취소했습니다.`);
      syncRoom(room);
    } else {
      cb?.({ ok: true, reserved: false });
      removePlayer(room, me, false);
    }
  });

  socket.on('game:action', (type, cb) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.phase !== 'playing') return cb?.({ error: '게임 중이 아닙니다.' });
    const p = room.players.find((p) => p.id === me);
    if (!p) return;
    const err = applyAction(room, p, String(type));
    cb?.(err ? { error: err } : { ok: true });
  });

  socket.on('disconnect', () => {
    if (socketsByUser.get(me) !== socket) return; // 새 세션으로 교체된 경우
    socketsByUser.delete(me);
    const room = rooms.get(socket.data.roomId);
    if (room) {
      // 페이지 이탈 → 해당 판 패배 + 자동 퇴장
      removePlayer(room, me, true);
    }
  });
});

db.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`섯다 게임 서버 실행 중: http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error('[db] 초기화 실패:', e.message);
    process.exit(1);
  });
