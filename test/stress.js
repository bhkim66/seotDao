// 스트레스 테스트: 무작위 액션 봇 3명이 30판 이상 진행하며 매 판 돈 보존 검증
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ioc = require('socket.io-client');

const PORT = 3198;
const BASE = `http://localhost:${PORT}`;
const START = 100_000_000;

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'users.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const backup = fs.existsSync(dataFile) ? fs.readFileSync(dataFile) : null;
fs.writeFileSync(dataFile, '{}');

const serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, SEOTDA_DEBUG: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let violations = 0;

async function register(name) {
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'test1234' }),
  });
  return res.json();
}

const bots = [];
function makeBot(name, token) {
  const bot = { name, state: null, money: START, lastResultRound: 0, roundsSeen: 0 };
  const s = ioc(BASE, { auth: { token, username: name } });
  bot.socket = s;
  s.on('me', (me) => { bot.money = me.money; });
  s.on('room:state', (st) => {
    bot.state = st;
    if (st.roundPhase === 'result' && st.roundNo > bot.lastResultRound) {
      bot.lastResultRound = st.roundNo;
      bot.roundsSeen++;
      if (bot === bots[0]) {
        // 돈 보존 검증 (약간의 me 이벤트 지연 감안해 상태의 player.money 사용)
        const inPlay = st.players.reduce((sum, p) => sum + p.money, 0);
        const outMoney = bots.filter((b) => !st.players.some((p) => p.id === b.name)).reduce((s2, b) => s2 + b.money, 0);
        const total = inPlay + outMoney + st.pot + st.carryPot;
        if (total !== START * 3) {
          violations++;
          console.error(`!! 돈 보존 위반 round=${st.roundNo} total=${total} (기대 ${START * 3}) diff=${total - START * 3}`);
          console.error('   players:', st.players.map((p) => `${p.id}=${p.money}`).join(' '), 'pot=', st.pot, 'carry=', st.carryPot);
        }
      }
    }
    if (st.roundPhase === 'betting' && st.turnId === name) {
      const me = st.players.find((p) => p.id === name);
      const toCall = st.currentBet - me.betStreet;
      const opts = [];
      if (st.currentBet === 0) opts.push('bbing', 'bbing', 'check', 'half');
      else opts.push('call', 'call', 'call', 'ddadang', 'half', 'die');
      if (Math.random() < 0.05) opts.push('allin');
      const act = opts[Math.floor(Math.random() * opts.length)];
      setTimeout(() => s.emit('game:action', act, () => {}), 20 + Math.random() * 80);
    }
  });
  return bot;
}

(async () => {
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
    const creds = await Promise.all(['철수', '영희', '민수'].map(register));
    ['철수', '영희', '민수'].forEach((n, i) => bots.push(makeBot(n, creds[i].token)));
    await sleep(500);

    let roomId;
    await new Promise((res, rej) => bots[0].socket.emit('room:create', '스트레스', (r) => r.ok ? (roomId = r.roomId, res()) : rej(new Error(r.error))));
    for (const b of bots.slice(1)) {
      await new Promise((res, rej) => b.socket.emit('room:join', roomId, (r) => r.ok ? res() : rej(new Error(r.error))));
      b.socket.emit('room:ready', true);
    }
    await sleep(300);
    await new Promise((res, rej) => bots[0].socket.emit('room:start', (r) => r.ok ? res() : rej(new Error(r.error))));

    // 35판 또는 90초 동안 진행
    const t0 = Date.now();
    while (bots[0].roundsSeen < 35 && Date.now() - t0 < 90_000) await sleep(500);

    console.log(`\n진행된 판 수: ${bots[0].roundsSeen}, 돈 보존 위반: ${violations}건`);
    const final = bots.map((b) => `${b.name}=${b.money}`).join(' ');
    console.log('최종 잔액:', final);
    bots.forEach((b) => b.socket.disconnect());
    await sleep(300);
    process.exitCode = violations ? 1 : 0;
  } catch (e) {
    console.error('오류:', e);
    process.exitCode = 1;
  } finally {
    serverProc.kill();
    if (backup) fs.writeFileSync(dataFile, backup); else fs.writeFileSync(dataFile, '{}');
  }
})();
