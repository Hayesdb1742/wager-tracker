-- ============================================================
-- Historical data tables
-- teams: dim table for NFL/CFB teams (to be enriched via sports API)
-- historical_picks: stores 2024 season raw bet data from the
--   pre-app spreadsheet. member_id is nullable until users sign
--   up and are linked by display_name.
-- ============================================================

-- ============================================================
-- TEAMS
-- ============================================================
create table public.teams (
  id           serial primary key,
  name         text not null unique,
  abbreviation text null,
  sport        text not null check (sport in ('CFB', 'NFL')),
  external_id  text null,  -- for sports API reconciliation
  created_at   timestamptz not null default now()
);

-- ============================================================
-- HISTORICAL PICKS
-- ============================================================
create table public.historical_picks (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  member_id    uuid null references public.profiles(id) on delete set null,
  week_number  int not null check (week_number >= 1),
  season_year  int not null,
  bet_text     text not null,
  is_lotw      boolean not null default false,
  result       text null check (result in ('Win', 'Lose', 'Push')),
  created_at   timestamptz not null default now()
);

create index historical_picks_member_idx on public.historical_picks (member_id);
create index historical_picks_season_week_idx on public.historical_picks (season_year, week_number);
create index historical_picks_display_name_idx on public.historical_picks (display_name);

-- ============================================================
-- RLS
-- ============================================================
alter table public.teams enable row level security;
alter table public.historical_picks enable row level security;

-- Teams are readable by all authenticated users, writable by admin
create policy "teams_read_authenticated" on public.teams
  for select
  to authenticated
  using (true);

create policy "teams_admin_write" on public.teams
  for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN');

-- Historical picks: authenticated users can read all
create policy "historical_picks_read_authenticated" on public.historical_picks
  for select
  to authenticated
  using (true);

create policy "historical_picks_admin_write" on public.historical_picks
  for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN');
