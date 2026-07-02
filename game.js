// 섯다 게임 핵심 로직 (덱, 족보 판정, 승자 결정)
'use strict';

// 화투 20장: 1~10월 각 2장.
// k: 광 (1,3,8월 첫째 장), y: 열끗 (멍텅구리구사 판정에 필요한 4월/9월 열끗 포함)
function createDeck() {
  const deck = [];
  const KWANG = { 1: true, 3: true, 8: true };
  const YEOL = { 2: true, 4: true, 7: true, 9: true, 10: true }; // 각 월의 첫째 장이 열끗인 월 (8월은 광+열끗 구성)
  for (let m = 1; m <= 10; m++) {
    deck.push({ m, k: !!KWANG[m], y: !KWANG[m] && !!YEOL[m] });
    deck.push({ m, k: false, y: m === 8 }); // 8월 둘째 장 = 기러기(열끗)
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 족보 점수 체계 (높을수록 강함)
const SCORE = {
  GTT38: 1000, // 38광땡
  GTT18: 991,  // 18광땡
  GTT13: 990,  // 13광땡
  TTAENG: 900, // +월 → 901(1땡)~910(장땡)
  ALLI: 800,   // 알리 1·2
  DOKSA: 790,  // 독사 1·4
  GUBBING: 780,// 구삥 1·9
  JANGBBING: 770, // 장삥 1·10
  JANGSA: 760, // 장사 4·10
  SERYUK: 750, // 세륙 4·6
  KKUT: 100,   // +끗수 → 101~109 (109=갑오), 100=망통
};

// 두 장으로 족보 판정
function evaluate(c1, c2) {
  const [a, b] = c1.m <= c2.m ? [c1, c2] : [c2, c1];
  const pair = `${a.m}-${b.m}`;
  const r = { score: 0, name: '', special: null };

  // 광땡
  if (a.k && b.k) {
    if (pair === '3-8') return { ...r, score: SCORE.GTT38, name: '38광땡' };
    if (pair === '1-8') return { ...r, score: SCORE.GTT18, name: '18광땡' };
    if (pair === '1-3') return { ...r, score: SCORE.GTT13, name: '13광땡' };
  }
  // 땡
  if (a.m === b.m) {
    return { ...r, score: SCORE.TTAENG + a.m, name: a.m === 10 ? '장땡' : `${a.m}땡` };
  }
  // 특수패 (기본 족보는 끗으로 계산되지만 상황에 따라 발동)
  if (pair === '3-7') r.special = 'ttaengjabi'; // 땡잡이: 땡(1~장땡)을 잡음
  if (pair === '4-7') r.special = 'amhaengeosa'; // 암행어사: 13·18광땡을 잡음
  if (pair === '4-9') r.special = (a.y && b.y) ? 'mongtongguri' : 'gusa'; // 구사/멍텅구리구사: 재경기

  // 끗 계열 족보
  const named = {
    '1-2': [SCORE.ALLI, '알리'],
    '1-4': [SCORE.DOKSA, '독사'],
    '1-9': [SCORE.GUBBING, '구삥'],
    '1-10': [SCORE.JANGBBING, '장삥'],
    '4-10': [SCORE.JANGSA, '장사'],
    '4-6': [SCORE.SERYUK, '세륙'],
  };
  if (named[pair]) {
    const [score, name] = named[pair];
    return { ...r, score, name };
  }
  const kkut = (a.m + b.m) % 10;
  const name = kkut === 0 ? '망통' : kkut === 9 ? '갑오' : `${kkut}끗`;
  return { ...r, score: SCORE.KKUT + kkut, name };
}

const isTtaeng = (s) => s > SCORE.TTAENG && s <= SCORE.TTAENG + 10;
const isSmallKwangTtaeng = (s) => s === SCORE.GTT13 || s === SCORE.GTT18;

// 승자 결정. entries: [{id, hand:{score,name,special}}]
// 반환: { winners: [id], replay: bool, replayReason, note }
function decideWinners(entries) {
  if (entries.length === 1) return { winners: [entries[0].id], replay: false };

  let best = Math.max(...entries.map((e) => e.hand.score));
  let winners = entries.filter((e) => e.hand.score === best);
  let note = null;

  // 암행어사: 최고 패가 13/18광땡이면 암행어사가 잡음 (38광땡은 못 잡음)
  if (isSmallKwangTtaeng(best)) {
    const catchers = entries.filter((e) => e.hand.special === 'amhaengeosa');
    if (catchers.length) {
      winners = catchers;
      note = 'amhaengeosa';
    }
  }
  // 땡잡이: 최고 패가 땡(1땡~장땡)이면 땡잡이가 잡음 (광땡은 못 잡음)
  else if (isTtaeng(best)) {
    const catchers = entries.filter((e) => e.hand.special === 'ttaengjabi');
    if (catchers.length) {
      winners = catchers;
      note = 'ttaengjabi';
    }
  }

  const winScore = note ? Infinity : best;

  // 구사: 승자 패가 알리 이하이면 재경기 / 멍텅구리구사: 장땡 이하이면 재경기
  // (땡잡이·암행어사 발동 시에는 판이 뒤집힌 것이므로 재경기 없음)
  if (!note) {
    const hasMong = entries.some((e) => e.hand.special === 'mongtongguri');
    const hasGusa = entries.some((e) => e.hand.special === 'gusa');
    if (hasMong && winScore <= SCORE.TTAENG + 10) {
      return { winners: [], replay: true, replayReason: '멍텅구리구사' };
    }
    if (hasGusa && winScore <= SCORE.ALLI) {
      return { winners: [], replay: true, replayReason: '구사' };
    }
  }

  return { winners: winners.map((e) => e.id), replay: false, note };
}

module.exports = { createDeck, shuffle, evaluate, decideWinners, SCORE };
