// 회귀 테스트: 같은 계정 중복 접속(탭 2개) 시 좌석 승계 및 돈 보존 검증
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ioc = require('socket.io-client');

const PORT = 3197;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const check = (desc, cond) => cond ? pass++ : (fail++, console.error(`  ✘ FAIL: ${desc}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'users.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const backup = fs.existsSync(dataFile) ? fs.readFileSync(dataFile) : null;
fs.writeFileSync(dataFile, '{}');

const serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT },
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function register(name) {
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'test1234' }),
  });
  return res.json();
}

function connectBot(name, token, autoPlay = true) {
  const bot = { name, state: null, money: 100_000_000 };
  const s = ioc(BASE, { auth: { token, username: name }, reconnection: false });
  bot.socket = s;
  s.on('me', (me) => { bot.money = me.money; });
  s.on('room:state', (st) => {
    bot.state = st;
    if (autoPlay && st.roundPhase === 'betting' && st.turnId === name) {
      const me = st.players.find((p) => p.id === name);
      const toCall = st.currentBet - me.betStreet;
      const act = st.currentBet === 0 ? 'bbing' : toCall > 0 ? 'call' : 'check';
      setTimeout(() => s.emit('game:action', act, () => {}), 60);
    }
  });
  return bot;
}

// 전체 타임아웃 가드 (행 방지)
setTimeout(() => { console.error('  ✘ 테스트 전체 타임아웃 (120초)'); process.exit(1); }, 120_000).unref();

(async () => {
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
    const [a, b, c] = await Promise.all([register('갑돌'), register('을순'), register('병철')]);
    console.log('  가입 완료:', [a, b, c].map((x) => x.error || 'ok').join(','));

    const A = connectBot('갑돌', a.token);
    const B = connectBot('을순', b.token);
    const C = connectBot('병철', c.token);
    await sleep(400);

    let roomId;
    await new Promise((r) => A.socket.emit('room:create', '중복테스트', (x) => (roomId = x.roomId, r())));
    console.log('  방 생성:', roomId);
    await new Promise((r) => B.socket.emit('room:join', roomId, r));
    await new Promise((r) => C.socket.emit('room:join', roomId, r));
    B.socket.emit('room:ready', true);
    C.socket.emit('room:ready', true);
    await sleep(300);
    await new Promise((r) => A.socket.emit('room:start', (x) => { console.log('  시작:', JSON.stringify(x)); r(); }));
    await sleep(1200);
    check('게임 시작됨', A.state?.phase === 'playing');

    // 갑 계정으로 두 번째 탭 접속 (게임 도중) — 좌석 승계되어야 함
    const A2 = connectBot('갑돌', a.token);
    await sleep(800);
    check('중복 접속 후에도 갑이 방에 남아있음', A2.state?.players.some((p) => p.id === '갑돌'));
    check('새 세션이 방 상태를 수신함', !!A2.state && A2.state.id === roomId);
    check('기존 세션은 끊김', !A.socket.connected);

    // 새 세션이 이어서 플레이 가능해야 함 (다음 라운드 정상 진행)
    const seenRound = A2.state?.roundNo || 0;
    let progressed = false;
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      if ((A2.state?.roundNo || 0) > seenRound) { progressed = true; break; }
    }
    check('중복 접속 이후에도 게임 계속 진행', progressed);

    // 돈 보존
    await sleep(500);
    const st = A2.state;
    const inPlay = st.players.reduce((s2, p) => s2 + p.money, 0);
    const total = inPlay + (st.pot || 0) + (st.carryPot || 0);
    check(`돈 총합 보존 (${total})`, total === 300_000_000);

    A2.socket.disconnect(); B.socket.disconnect(); C.socket.disconnect();
  } catch (e) {
    fail++;
    console.error('  ✘ 오류:', e.message);
  } finally {
    serverProc.kill();
    if (backup) fs.writeFileSync(dataFile, backup); else fs.writeFileSync(dataFile, '{}');
    console.log(`중복접속 테스트: ${pass} 통과, ${fail} 실패`);
    process.exit(fail ? 1 : 0);
  }
})();
