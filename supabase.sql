-- 섯다 게임 Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에서 이 파일 전체를 실행하세요.

-- 사용자 계정 (닉네임, 비밀번호 해시, 잔액, 전적)
create table if not exists public.seotda_users (
  username   text primary key,
  pw_hash    text not null,
  token      text,
  money      bigint not null default 100000000,
  wins       int not null default 0,
  losses     int not null default 0,
  created_at timestamptz not null default now()
);

-- 게임 결과 기록 (판마다 참가자별 승패와 금액 증감)
create table if not exists public.seotda_game_results (
  id         bigint generated always as identity primary key,
  room_name  text,
  round_no   int,
  username   text not null references public.seotda_users(username) on delete cascade,
  result     text not null check (result in ('win', 'lose', 'draw', 'replay')),
  delta      bigint not null,          -- 이번 판 금액 증감 (+획득 / -손실)
  hand       text,                     -- 족보 이름 (예: 38광땡, 알리, 3끗)
  pot        bigint,                   -- 해당 판의 팟 크기
  played_at  timestamptz not null default now()
);

create index if not exists idx_results_user on public.seotda_game_results (username, played_at desc);
create index if not exists idx_results_time on public.seotda_game_results (played_at desc);

-- 서버는 service_role 키로 접근하므로 RLS를 켜두면 외부(anon) 접근이 차단됩니다.
alter table public.seotda_users enable row level security;
alter table public.seotda_game_results enable row level security;
