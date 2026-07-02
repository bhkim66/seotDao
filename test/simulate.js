// 게임 로직 단위 테스트 + 봇 시뮬레이션 통합 테스트
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { evaluate, decideWinners, createDeck } = require('../game');

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ✘ FAIL: ${desc}`); }
}

// ---------- 단위 테스트 ----------
console.log('[1/2] 족보 판정 단위 테스트');
const C = (m, k = false, y = false) => ({ m, k, y });

check('덱은 20장', createDeck().length === 20);
check('광은 3장', createDeck().filter((c) => c.k).length === 3);
check('38광땡', evaluate(C(3, true), C(8, true)).name === '38광땡');
check('18광땡', evaluate(C(1, true), C(8, true)).name === '18광땡');
check('13광땡', evaluate(C(1, true), C(3, true)).name === '13광땡');
check('장땡', evaluate(C(10), C(10)).name === '장땡');
check('1땡', evaluate(C(1, true), C(1)).name === '1땡');
check('알리', evaluate(C(1), C(2)).name === '알리');
check('독사', evaluate(C(1), C(4)).name === '독사');
check('구삥', evaluate(C(1), C(9)).name === '구삥');
check('장삥', evaluate(C(1), C(10)).name === '장삥');
check('장사', evaluate(C(4), C(10)).name === '장사');
check('세륙', evaluate(C(4), C(6)).name === '세륙');
check('갑오(4+5)', evaluate(C(4), C(5)).name === '갑오');
check('망통(3+7)', evaluate(C(3), C(7)).name === '망통');
check('땡잡이 특수', evaluate(C(3), C(7)).special === 'ttaengjabi');
check('암행어사 특수', evaluate(C(4), C(7)).special === 'amhaengeosa');
check('구사 특수', evaluate(C(4), C(9)).special === 'gusa');
check('멍텅구리구사', evaluate(C(4, false, true), C(9, false, true)).special === 'mongtongguri');
check('3끗(1+2 아님, 5+8)', evaluate(C(5), C(8)).name === '3끗');
check('광땡 > 장땡', evaluate(C(1, true), C(3, true)).score > evaluate(C(10), C(10)).score);
check('장땡 > 알리', evaluate(C(10), C(10)).score > evaluate(C(1), C(2)).score);
check('알리 > 갑오', evaluate(C(1), C(2)).score > evaluate(C(4), C(5)).score);

// 승자 결정
const E = (id, c1, c2) => ({ id, hand: evaluate(c1, c2) });
let d;
d = decideWinners([E('a', C(9), C(9)), E('b', C(3), C(7))]);
check('땡잡이가 9땡을 잡음', d.winners.length === 1 && d.winners[0] === 'b' && d.note === 'ttaengjabi');
d = decideWinners([E('a', C(1, true), C(8, true)), E('b', C(4), C(7))]);
check('암행어사가 18광땡을 잡음', d.winners[0] === 'b' && d.note === 'amhaengeosa');
d = decideWinners([E('a', C(3, true), C(8, true)), E('b', C(4), C(7))]);
check('암행어사는 38광땡을 못 잡음', d.winners[0] === 'a' && !d.note);
d = decideWinners([E('a', C(1, true), C(3, true)), E('b', C(3), C(7))]);
check('땡잡이는 광땡을 못 잡음', d.winners[0] === 'a' && !d.note);
d = decideWinners([E('a', C(1), C(2)), E('b', C(4), C(9))]);
check('구사: 승자가 알리면 재경기', d.replay && d.replayReason === '구사');
d = decideWinners([E('a', C(6), C(6)), E('b', C(4), C(9))]);
check('구사: 승자가 땡이면 재경기 아님', !d.replay && d.winners[0] === 'a');
d = decideWinners([E('a', C(10), C(10)), E('b', C(4, false, true), C(9, false, true))]);
check('멍텅구리구사: 장땡도 재경기', d.replay && d.replayReason === '멍텅구리구사');
d = decideWinners([E('a', C(3, true), C(8, true)), E('b', C(4, false, true), C(9, false, true))]);
check('멍텅구리구사: 광땡은 유효', !d.replay && d.winners[0] === 'a');
d = decideWinners([E('a', C(4), C(5)), E('b', C(2), C(7)), E('c', C(5), C(6))]);
check('갑오 2명 무승부 (스플릿)', d.winners.length === 2 && d.winners.includes('a') && d.winners.includes('b'));

console.log(`  단위 테스트: ${pass} 통과, ${fail} 실패`);

// ---------- 통합 테스트 (봇 시뮬레이션) ----------
console.log('[2/2] 봇 시뮬레이션 통합 테스트');
const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const ioc = require('socket.io-client');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'users.json');
const resultsFile = path.join(dataDir, 'results.ndjson');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const backup = fs.existsSync(dataFile) ? fs.readFileSync(dataFile) : null;
fs.writeFileSync(dataFile, '{}'); // 테스트용 초기화
if (fs.existsSync(resultsFile)) fs.unlinkSync(resultsFile);

const serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE); return; } catch { await sleep(200); }
  }
  throw new Error('서버 시작 실패');
}

async function register(name) {
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'test1234' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`가입 실패 ${name}: ${data.error}`);
  return data;
}

function makeBot(name, token) {
  const bot = { name, state: null, money: 0, results: [], leftRoom: false, acted: 0 };
  const s = ioc(BASE, { auth: { token, username: name } });
  bot.socket = s;
  s.on('me', (me) => { bot.money = me.money; });
  s.on('room:left', () => { bot.leftRoom = true; });
  s.on('room:state', (st) => {
    bot.state = st;
    if (st.roundPhase === 'result' && st.lastResult && !bot.results.some((r) => r.roundNo === st.roundNo)) {
      bot.results.push({ roundNo: st.roundNo, ...st.lastResult });
    }
    // 내 차례면 액션 (첫 액션은 삥, 이후 콜/체크)
    if (st.roundPhase === 'betting' && st.turnId === name) {
      const me = st.players.find((p) => p.id === name);
      const toCall = st.currentBet - me.betStreet;
      const act = st.currentBet === 0 ? 'bbing' : toCall > 0 ? 'call' : 'check';
      bot.acted++;
      setTimeout(() => s.emit('game:action', act, () => {}), 50);
    }
  });
  return bot;
}

(async () => {
  try {
    await waitForServer();
    const [a, b, c] = await Promise.all([register('봇하나'), register('봇둘'), register('봇셋')]);
    check('가입 시 1억 지급', a.money === 100_000_000);

    const botA = makeBot('봇하나', a.token);
    const botB = makeBot('봇둘', b.token);
    const botC = makeBot('봇셋', c.token);
    await sleep(500);

    // 방 생성/입장
    let roomId;
    await new Promise((res, rej) => botA.socket.emit('room:create', '테스트방', (r) => r.ok ? (roomId = r.roomId, res()) : rej(new Error(r.error))));
    await new Promise((res, rej) => botB.socket.emit('room:join', roomId, (r) => r.ok ? res() : rej(new Error(r.error))));
    await new Promise((res, rej) => botC.socket.emit('room:join', roomId, (r) => r.ok ? res() : rej(new Error(r.error))));
    await sleep(300);
    check('방에 3명 입장', botA.state?.players.length === 3);

    // 준비 전 시작 시도 → 실패해야 함
    const early = await new Promise((res) => botA.socket.emit('room:start', res));
    check('준비 전 시작 불가', !!early.error);

    // 6번째 인원 제한은 5명 필요하므로 스킵, 준비 후 시작
    botB.socket.emit('room:ready', true);
    botC.socket.emit('room:ready', true);
    await sleep(300);
    const started = await new Promise((res) => botA.socket.emit('room:start', res));
    check('전원 준비 후 시작 성공', !!started.ok);

    // 첫 판 결과 대기
    for (let i = 0; i < 100 && !botA.results.length; i++) await sleep(200);
    check('1판 결과 수신', botA.results.length >= 1);
    const r1 = botA.results[0];
    check('결과 타입 유효', ['showdown', 'fold', 'replay'].includes(r1.type));
    if (r1.type === 'showdown') {
      check('쇼다운 패 공개', r1.entries.length >= 2 && r1.entries.every((e) => e.name));
    }

    // 자동 다음 판 진행 확인
    for (let i = 0; i < 120 && botA.results.length < 2; i++) await sleep(200);
    check('2판 자동 진행', botA.results.length >= 2);

    // 돈 보존 법칙: 세 봇 돈 합 = 3억 (팟 이월분 제외)
    await sleep(300);
    const totalMoney = botA.money + botB.money + botC.money + (botA.state?.pot || 0) + (botA.state?.carryPot || 0);
    check(`돈 총합 보존 (${totalMoney})`, totalMoney === 300_000_000);

    // 나가기 예약: 베팅 중에 예약 → 판 끝나면 자동 퇴장
    for (let i = 0; i < 100 && botB.state?.roundPhase !== 'betting'; i++) await sleep(100);
    const leaveRes = await new Promise((res) => botB.socket.emit('room:leave', res));
    check('게임 중 나가기 = 예약 처리', leaveRes.ok && leaveRes.reserved === true);
    for (let i = 0; i < 150 && !botB.leftRoom; i++) await sleep(200);
    check('판 종료 후 예약 퇴장 완료', botB.leftRoom);

    // 남은 2명 게임 지속 확인 후, 봇C 강제 접속종료 (페이지 이탈 시뮬레이션)
    const before = botA.results.length;
    for (let i = 0; i < 150 && botA.results.length <= before; i++) await sleep(200);
    check('2명으로 게임 계속 진행', botA.results.length > before);

    for (let i = 0; i < 100 && botA.state?.roundPhase !== 'betting'; i++) await sleep(100);
    botC.socket.disconnect(); // 페이지 이탈
    await sleep(1000);
    check('이탈자 자동 퇴장', botA.state?.players.every((p) => p.id !== '봇셋'));
    // 1명 남음 → 대기 상태 전환
    for (let i = 0; i < 100 && botA.state?.phase !== 'waiting'; i++) await sleep(200);
    check('1명 남으면 대기 전환', botA.state?.phase === 'waiting');

    // 게임 결과 기록 검증 (JSON 폴백: data/results.ndjson)
    await sleep(700);
    const lines = fs.existsSync(resultsFile)
      ? fs.readFileSync(resultsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      : [];
    check('게임 결과가 기록됨', lines.length >= 3);
    check('결과 행에 승패/금액 필드 존재', lines.every((r) =>
      ['win', 'lose', 'draw', 'replay'].includes(r.result) && typeof r.delta === 'number' && r.username));
    const round1 = lines.filter((r) => r.round_no === 1 && r.result !== 'replay');
    if (round1.length) {
      const sum = round1.reduce((s, r) => s + r.delta, 0);
      check(`1판 delta 합계 = 0 (제로섬, 실제 ${sum})`, sum === 0);
    }

    botA.socket.disconnect();
    botB.socket.disconnect();
  } catch (e) {
    fail++;
    console.error('  ✘ 통합 테스트 오류:', e.message);
  } finally {
    serverProc.kill();
    if (backup) fs.writeFileSync(dataFile, backup); else fs.writeFileSync(dataFile, '{}');
    console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
    process.exit(fail ? 1 : 0);
  }
})();
