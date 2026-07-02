// 섯다 클라이언트
'use strict';

const $ = (sel) => document.querySelector(sel);
let socket = null;
let myName = null;
let myMoney = 0;
let roomState = null;
let authMode = 'login';
let lastAnimRound = -1;
let timerInterval = null;

// ---------- 유틸 ----------
function fmtMoney(n) {
  n = Math.floor(n || 0);
  if (n === 0) return '0원';
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  const won = n % 10_000;
  let s = '';
  if (eok) s += `${eok.toLocaleString()}억 `;
  if (man) s += `${man.toLocaleString()}만 `;
  if (won || !s) s += `${won.toLocaleString()}`;
  return s.trim() + '원';
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showScreen(name) {
  for (const id of ['auth', 'lobby', 'room']) {
    $(`#screen-${id}`).hidden = id !== name;
  }
}

// ---------- 인증 ----------
function setAuthMode(mode) {
  authMode = mode;
  $('#tab-login').classList.toggle('active', mode === 'login');
  $('#tab-register').classList.toggle('active', mode === 'register');
  $('#auth-submit').textContent = mode === 'login' ? '로그인' : '회원가입 (1억 지급)';
  $('#auth-error').textContent = '';
}
$('#tab-login').onclick = () => setAuthMode('login');
$('#tab-register').onclick = () => setAuthMode('register');

async function submitAuth() {
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  $('#auth-error').textContent = '';
  try {
    const res = await fetch(`/api/${authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { $('#auth-error').textContent = data.error || '오류가 발생했습니다.'; return; }
    localStorage.setItem('seotda_auth', JSON.stringify({ token: data.token, username: data.username }));
    connect(data.username, data.token);
  } catch {
    $('#auth-error').textContent = '서버에 연결할 수 없습니다.';
  }
}
$('#auth-submit').onclick = submitAuth;
$('#auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });

$('#btn-logout').onclick = () => {
  localStorage.removeItem('seotda_auth');
  socket?.disconnect();
  socket = null;
  showScreen('auth');
};

// ---------- 소켓 ----------
function connect(username, token) {
  myName = username;
  if (socket) socket.disconnect();
  socket = io({ auth: { token, username } });

  socket.on('connect', () => showScreen(roomState ? 'room' : 'lobby'));
  socket.on('connect_error', () => {
    localStorage.removeItem('seotda_auth');
    showScreen('auth');
    $('#auth-error').textContent = '세션이 만료되었습니다. 다시 로그인해주세요.';
  });

  socket.on('me', (me) => {
    myMoney = me.money;
    $('#lobby-nick').textContent = `👤 ${me.username}`;
    $('#lobby-money').textContent = fmtMoney(me.money);
    $('#room-money').textContent = fmtMoney(me.money);
  });

  socket.on('toast', toast);
  socket.on('lobby:rooms', renderLobby);
  socket.on('room:state', (state) => { roomState = state; showScreen('room'); renderRoom(); });
  socket.on('room:left', () => { roomState = null; lastAnimRound = -1; showScreen('lobby'); });
}

// ---------- 로비 ----------
function renderLobby(list) {
  const box = $('#room-list');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="room-empty">아직 열린 방이 없습니다.<br>첫 번째 방을 만들어보세요!</div>';
    return;
  }
  for (const r of list) {
    const el = document.createElement('div');
    el.className = 'room-item';
    const full = r.count >= r.max;
    el.innerHTML = `
      <div>
        <div class="rname">🎴 ${esc(r.name)}</div>
        <div class="rmeta">방장 ${esc(r.host)} · ${r.count}/${r.max}명 ${r.phase === 'playing' ? '<span class="badge-playing">· 게임중</span>' : ''}</div>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = full ? '가득참' : '입장';
    btn.disabled = full;
    btn.onclick = () => socket.emit('room:join', r.id, (res) => { if (res?.error) toast(res.error); });
    el.appendChild(btn);
    box.appendChild(el);
  }
}

$('#btn-create-room').onclick = () => {
  const name = prompt('방 이름을 입력하세요.', `${myName}의 방`);
  if (name === null) return;
  socket.emit('room:create', name, (res) => { if (res?.error) toast(res.error); });
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 게임 방 ----------
const SEAT_POS = {
  1: [[50, 80]],
  2: [[50, 80], [50, 13]],
  3: [[50, 80], [26, 16], [74, 16]],
  4: [[50, 80], [12, 44], [50, 12], [88, 44]],
  5: [[50, 80], [12, 46], [28, 14], [72, 14], [88, 46]],
};

function renderRoom() {
  const st = roomState;
  if (!st) return;
  $('#room-title').textContent = `🎴 ${st.name}  ·  ${st.players.length}/5명${st.roundNo ? `  ·  ${st.roundNo}판` : ''}`;

  // 팟
  $('#pot-label').textContent = st.phase === 'playing' ? fmtMoney(st.pot) : '';
  const carry = $('#carry-label');
  carry.hidden = !st.carryPot;
  if (st.carryPot) carry.textContent = `이월된 판돈 ${fmtMoney(st.carryPot)}`;

  renderSeats(st);
  renderWaitPanel(st);
  renderResult(st);
  renderActions(st);
  renderLeaveBtn(st);
}

function renderSeats(st) {
  const box = $('#seats');
  box.innerHTML = '';
  const myIdx = st.players.findIndex((p) => p.id === myName);
  const n = st.players.length;
  const pos = SEAT_POS[n] || SEAT_POS[5];
  const animate = st.roundNo !== lastAnimRound && st.roundPhase === 'betting';
  if (animate) lastAnimRound = st.roundNo;

  st.players.forEach((p, i) => {
    const rel = myIdx === -1 ? i : (i - myIdx + n) % n;
    const [x, y] = pos[rel];
    const seat = document.createElement('div');
    seat.className = 'seat' + (p.id === myName ? ' me' : '') + (p.folded ? ' folded' : '') + (st.turnId === p.id ? ' turn' : '');
    seat.style.left = x + '%';
    seat.style.top = y + '%';

    // 카드
    let cardsHtml = '';
    if (p.cards && p.inRound) {
      cardsHtml = `<div class="cards">${p.cards.map((c) =>
        `<div class="card-slot" ${animate ? '' : 'style="animation:none"'}>${c ? HWATU.face(c) : HWATU.back()}</div>`
      ).join('')}</div>`;
    } else {
      cardsHtml = `<div class="cards"></div>`;
    }

    // 상태
    const statuses = [];
    if (st.phase === 'waiting' && p.ready) statuses.push('<span class="st-ready">✔ 준비완료</span>');
    if (p.folded) statuses.push('<span class="st-die">다이</span>');
    if (p.allIn && !p.folded) statuses.push('<span class="st-allin">올인</span>');
    if (p.leaveReserved) statuses.push('<span class="st-leave">나가기 예약</span>');
    if (p.hand && !p.folded) statuses.push(`<span class="st-hand">${esc(p.hand)}</span>`);

    seat.innerHTML = `
      ${cardsHtml}
      <div class="plate">
        <div class="pname">${st.hostId === p.id ? '<span class="host-mark">👑</span> ' : ''}${esc(p.id)}</div>
        <div class="pmoney">${fmtMoney(p.money)}</div>
        <div class="pstatus">${statuses.join(' · ')}</div>
      </div>
      ${p.betStreet ? `<div class="pbet">${fmtMoney(p.betStreet)}</div>` : ''}`;
    box.appendChild(seat);
  });
}

function renderWaitPanel(st) {
  const panel = $('#wait-panel');
  if (st.phase !== 'waiting') { panel.hidden = true; return; }
  panel.hidden = false;

  const isHost = st.hostId === myName;
  const me = st.players.find((p) => p.id === myName);
  const others = st.players.filter((p) => p.id !== st.hostId);
  const allReady = others.length > 0 && others.every((p) => p.ready);

  $('#btn-ready').hidden = isHost;
  $('#btn-start').hidden = !isHost;
  if (!isHost && me) {
    $('#btn-ready').textContent = me.ready ? '준비 취소' : '준비';
  }
  if (isHost) {
    const startBtn = $('#btn-start');
    startBtn.disabled = !(st.players.length >= 2 && allReady);
  }
  $('#wait-msg').textContent =
    st.players.length < 2 ? '친구를 기다리는 중... (2명 이상 필요)'
    : isHost ? (allReady ? '모두 준비 완료! 게임을 시작하세요.' : '참가자들의 준비를 기다리는 중...')
    : (me?.ready ? '방장이 시작하기를 기다리는 중...' : '준비 버튼을 눌러주세요.');
}

$('#btn-ready').onclick = () => {
  const me = roomState?.players.find((p) => p.id === myName);
  socket.emit('room:ready', !me?.ready);
};
$('#btn-start').onclick = () => {
  socket.emit('room:start', (res) => { if (res?.error) toast(res.error); });
};

function renderResult(st) {
  const banner = $('#result-banner');
  const r = st.lastResult;
  if (!r || st.roundPhase !== 'result') { banner.hidden = true; return; }
  banner.hidden = false;

  const handsHtml = r.entries.map((e) => {
    const sp = { ttaengjabi: ' (땡잡이)', amhaengeosa: ' (암행어사)', gusa: ' (구사)', mongtongguri: ' (멍텅구리구사)' }[e.special] || '';
    return `<b>${esc(e.id)}</b> — ${esc(e.name)}${sp}`;
  }).join('<br>');

  if (r.type === 'replay') {
    banner.innerHTML = `
      <div class="r-title">🔄 재경기!</div>
      <div class="r-special">${esc(r.reason)} 발동</div>
      <div class="r-sub">판돈 ${fmtMoney(r.carry)}이 다음 판으로 이월됩니다.</div>
      <div class="r-hands">${handsHtml}</div>
      <div class="r-next">잠시 후 다음 판이 시작됩니다...</div>`;
  } else {
    const special = r.note === 'ttaengjabi' ? '💥 땡잡이 발동!' : r.note === 'amhaengeosa' ? '🕵️ 암행어사 발동!' : '';
    banner.innerHTML = `
      <div class="r-title">🏆 ${r.winners.map(esc).join(', ')} 승리!</div>
      ${special ? `<div class="r-special">${special}</div>` : ''}
      <div class="r-sub">${fmtMoney(r.amount)} 획득${r.type === 'fold' ? ' (전원 다이)' : ''}</div>
      ${handsHtml ? `<div class="r-hands">${handsHtml}</div>` : ''}
      <div class="r-next">잠시 후 다음 판이 시작됩니다...</div>`;
  }
}

function renderActions(st) {
  const bar = $('#action-bar');
  const me = st.players.find((p) => p.id === myName);
  const myTurn = st.roundPhase === 'betting' && st.turnId === myName && me && !me.folded;
  bar.hidden = !myTurn;

  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (!myTurn) return;

  const toCall = st.currentBet - me.betStreet;
  const ddadangAmt = st.currentBet + st.lastRaise * 2 - me.betStreet;
  const halfAmt = toCall + Math.max(st.ante, Math.floor((st.pot + toCall) / 2));

  const btns = {
    die: [true, ''],
    check: [toCall <= 0, ''],
    call: [toCall > 0, fmtMoney(Math.min(toCall, me.money))],
    bbing: [st.currentBet === 0, fmtMoney(st.ante)],
    ddadang: [st.currentBet > 0, fmtMoney(Math.min(ddadangAmt, me.money))],
    half: [true, fmtMoney(Math.min(halfAmt, me.money))],
    allin: [me.money > 0, fmtMoney(me.money)],
  };
  for (const btn of document.querySelectorAll('.act-btn')) {
    const act = btn.dataset.act;
    const [enabled, sub] = btns[act];
    btn.disabled = !enabled;
    const label = { die: '다이', check: '체크', call: '콜', bbing: '삥', ddadang: '따당', half: '하프', allin: '올인' }[act];
    btn.innerHTML = label + (sub && enabled ? `<small>${sub}</small>` : '');
  }

  // 타이머 바
  const total = st.turnTime || 30000;
  const tick = () => {
    const remain = Math.max(0, st.turnDeadline - Date.now());
    $('#turn-timer-fill').style.width = (remain / total * 100) + '%';
    if (remain <= 0 && timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  };
  tick();
  timerInterval = setInterval(tick, 200);
}

for (const btn of document.querySelectorAll('.act-btn')) {
  btn.onclick = () => {
    socket.emit('game:action', btn.dataset.act, (res) => { if (res?.error) toast(res.error); });
  };
}

function renderLeaveBtn(st) {
  const me = st.players.find((p) => p.id === myName);
  $('#btn-leave').textContent = me?.leaveReserved ? '나가기 예약됨 (취소)' : '나가기';
}

$('#btn-leave').onclick = () => {
  socket.emit('room:leave', (res) => { if (res?.error) toast(res.error); });
};

// ---------- 족보 모달 ----------
$('#btn-jokbo').onclick = () => { $('#jokbo-modal').hidden = false; };
$('#btn-jokbo2').onclick = () => { $('#jokbo-modal').hidden = false; };
$('#btn-jokbo-close').onclick = () => { $('#jokbo-modal').hidden = true; };
$('#jokbo-modal').onclick = (e) => { if (e.target === $('#jokbo-modal')) $('#jokbo-modal').hidden = true; };

// ---------- 시작 ----------
(() => {
  try {
    const saved = JSON.parse(localStorage.getItem('seotda_auth'));
    if (saved?.token && saved?.username) { connect(saved.username, saved.token); return; }
  } catch { /* ignore */ }
  showScreen('auth');
})();
