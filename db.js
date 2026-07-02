// 저장소 계층: SUPABASE_URL 설정 시 Supabase, 미설정 시 로컬 JSON 파일
'use strict';
const path = require('path');
const fs = require('fs');

// .env 파일 자동 로드 (있을 경우)
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env 없음 */ }

const users = {}; // username -> { pwHash, token, money, wins, losses } (인메모리 캐시)

let supabase = null;
let jsonFile = null;
let resultsFile = null;
let saveTimer = null;
const dirty = new Set();

async function init() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (url && key) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(url, key, { auth: { persistSession: false } });
    // 연결 확인
    const { error } = await supabase.from('seotda_users').select('username', { head: true, count: 'exact' });
    if (error) throw new Error(`Supabase 연결 실패: ${error.message} (supabase.sql 스키마를 먼저 실행했는지 확인하세요)`);
    console.log('[db] Supabase 저장소 사용');
  } else {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    jsonFile = path.join(dataDir, 'users.json');
    resultsFile = path.join(dataDir, 'results.ndjson');
    try { Object.assign(users, JSON.parse(fs.readFileSync(jsonFile, 'utf8'))); } catch { /* 첫 실행 */ }
    console.log('[db] 로컬 JSON 저장소 사용 (SUPABASE_URL 미설정)');
  }
}

const rowToUser = (r) => ({ pwHash: r.pw_hash, token: r.token, money: Number(r.money), wins: r.wins, losses: r.losses });
const userToRow = (name, u) => ({ username: name, pw_hash: u.pwHash, token: u.token, money: u.money, wins: u.wins, losses: u.losses });

// 유저 조회 (캐시 우선, Supabase는 없으면 DB에서 로드)
async function getUser(username) {
  if (users[username]) return users[username];
  if (supabase) {
    const { data, error } = await supabase.from('seotda_users').select('*').eq('username', username).maybeSingle();
    if (error) { console.error('[db] 유저 조회 실패:', error.message); return null; }
    if (data) { users[username] = rowToUser(data); return users[username]; }
  }
  return null;
}

// 신규 유저 생성 (중복 시 'exists' 오류)
async function createUser(username, rec) {
  if (supabase) {
    const { error } = await supabase.from('seotda_users').insert(userToRow(username, rec));
    if (error) throw new Error(error.code === '23505' ? 'exists' : error.message);
  }
  users[username] = rec;
  if (!supabase) save(username);
}

// 변경된 유저 저장 (디바운스). 인자 없으면 캐시 전체.
function save(...names) {
  for (const n of names.length ? names : Object.keys(users)) dirty.add(n);
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 300);
}

async function flush() {
  saveTimer = null;
  const batch = [...dirty];
  dirty.clear();
  if (supabase) {
    const rows = batch.filter((n) => users[n]).map((n) => userToRow(n, users[n]));
    if (!rows.length) return;
    const { error } = await supabase.from('seotda_users').upsert(rows);
    if (error) console.error('[db] 유저 저장 실패:', error.message);
  } else if (jsonFile) {
    fs.writeFile(jsonFile, JSON.stringify(users, null, 2), () => {});
  }
}

// 게임 결과 기록. rows: [{ room_name, round_no, username, result, delta, hand, pot }]
function recordResults(rows) {
  if (!rows.length) return;
  const stamped = rows.map((r) => ({ ...r, played_at: new Date().toISOString() }));
  if (supabase) {
    supabase.from('seotda_game_results').insert(stamped).then(({ error }) => {
      if (error) console.error('[db] 게임 결과 기록 실패:', error.message);
    });
  } else if (resultsFile) {
    fs.appendFile(resultsFile, stamped.map((r) => JSON.stringify(r)).join('\n') + '\n', () => {});
  }
}

module.exports = { init, users, getUser, createUser, save, recordResults };
