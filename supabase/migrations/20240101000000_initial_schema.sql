-- ============================================================
-- 001_initial_schema.sql
-- Run in Supabase SQL Editor or via: supabase db push
-- ============================================================

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role        text not null default 'MEMBER' check (role in ('ADMIN', 'MEMBER')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- INVITES
-- ============================================================
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  token       uuid not null unique default gen_random_uuid(),
  invited_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '72 hours'),
  used_at     timestamptz null
);

-- ============================================================
-- SEASONS
-- ============================================================
create table public.seasons (
  id         serial primary key,
  name       text not null,
  year       int not null unique,
  created_at timestamptz not null default now()
);

-- ============================================================
-- WEEKS
-- ============================================================
create table public.weeks (
  id              serial primary key,
  season_id       int not null references public.seasons(id),
  week_number     int not null,
  required_picks  int not null,
  opens_at        timestamptz not null,
  closes_at       timestamptz not null,
  status          text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  close_mode      text not null default 'MANUAL' check (close_mode in ('MANUAL', 'AUTO')),
  auto_close_at   timestamptz null,
  unique (season_id, week_number)
);

-- ============================================================
-- GAMES
-- ============================================================
create table public.games (
  id               uuid primary key default gen_random_uuid(),
  week_id          int not null references public.weeks(id),
  sport            text not null check (sport in ('CFB', 'NFL')),
  home_team        text not null,
  away_team        text not null,
  kickoff_time     timestamptz not null,
  status           text not null default 'SCHEDULED'
                     check (status in ('SCHEDULED', 'LIVE', 'FINAL', 'POSTPONED', 'CANCELLED')),
  winner           text null check (winner in ('HOME', 'AWAY', 'PUSH')),
  in_pool          boolean not null default true,
  external_id      text not null,
  resolution_mode  text not null default 'MANUAL' check (resolution_mode in ('MANUAL', 'API')),
  created_at       timestamptz not null default now(),
  unique (sport, external_id)
);

-- ============================================================
-- PICKS
-- ============================================================
create table public.picks (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.profiles(id),
  game_id        uuid not null references public.games(id),
  week_id        int not null references public.weeks(id),
  picked_team    text not null check (picked_team in ('HOME', 'AWAY')),
  is_lotw        boolean not null default false,
  points         int null,
  overridden_by  uuid null references public.profiles(id),
  overridden_at  timestamptz null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (member_id, game_id)
);

-- Enforce exactly one LOTW per member per week
create unique index picks_one_lotw_per_member_week
  on public.picks (member_id, week_id)
  where is_lotw = true;

-- ============================================================
-- PICK AUDIT LOG
-- ============================================================
create table public.pick_audit_log (
  id             uuid primary key default gen_random_uuid(),
  pick_id        uuid not null references public.picks(id),
  previous_team  text not null check (previous_team in ('HOME', 'AWAY')),
  new_team       text not null check (new_team in ('HOME', 'AWAY')),
  changed_by     uuid not null references public.profiles(id),
  changed_at     timestamptz not null default now()
);

-- ============================================================
-- WEEKLY SCORES
-- ============================================================
create table public.weekly_scores (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.profiles(id),
  week_id         int not null references public.weeks(id),
  pick_points     int not null default 0,
  forfeit_penalty int not null default 0,
  lotw_penalty    int not null default 0,
  total           int generated always as (pick_points + forfeit_penalty + lotw_penalty) stored,
  unique (member_id, week_id)
);

-- ============================================================
-- AUTH HOOK: Inject role into JWT app_metadata
-- ============================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  user_role text;
begin
  select role into user_role
  from public.profiles
  where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';
  claims := jsonb_set(
    claims,
    '{app_metadata, role}',
    to_jsonb(coalesce(user_role, 'MEMBER'))
  );

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Grant execute permission to supabase_auth_admin role
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
-- supabase_auth_admin must be able to read profiles to inject the role claim
grant select on table public.profiles to supabase_auth_admin;

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.seasons enable row level security;
alter table public.weeks enable row level security;
alter table public.games enable row level security;
alter table public.picks enable row level security;
alter table public.pick_audit_log enable row level security;
alter table public.weekly_scores enable row level security;

-- ---- PROFILES ----
create policy "profiles_read_all" on public.profiles
  for select using (auth.role() = 'authenticated');

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

create policy "profiles_admin_update_any" on public.profiles
  for update using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
  );

-- ---- INVITES ----
create policy "invites_admin_all" on public.invites
  for all using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
  );

-- ---- SEASONS ----
create policy "seasons_read_authenticated" on public.seasons
  for select using (auth.role() = 'authenticated');

create policy "seasons_admin_write" on public.seasons
  for all using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
  );

-- ---- WEEKS ----
create policy "weeks_read_authenticated" on public.weeks
  for select using (auth.role() = 'authenticated');

create policy "weeks_admin_write" on public.weeks
  for all using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
  );

-- ---- GAMES ----
create policy "games_read_authenticated" on public.games
  for select using (auth.role() = 'authenticated');

create policy "games_admin_write" on public.games
  for all using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
  );

-- ---- PICKS ----
-- Admin bypasses all restrictions
create policy "picks_admin_all" on public.picks
  for all using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
  );

-- Members read their own picks at any time
create policy "picks_own_read" on public.picks
  for select using (member_id = auth.uid());

-- Members read other members' picks only after kickoff
create policy "picks_post_kickoff_read" on public.picks
  for select using (
    exists (
      select 1 from public.games g
      where g.id = picks.game_id
        and g.kickoff_time < now()
    )
  );

-- Members insert their own picks
create policy "picks_own_insert" on public.picks
  for insert with check (member_id = auth.uid());

-- Members update their own picks
create policy "picks_own_update" on public.picks
  for update using (member_id = auth.uid());

-- ---- PICK AUDIT LOG ----
create policy "pick_audit_log_admin_read" on public.pick_audit_log
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
  );

-- ---- WEEKLY SCORES ----
create policy "weekly_scores_read_authenticated" on public.weekly_scores
  for select using (auth.role() = 'authenticated');

-- ============================================================
-- POSTGRES FUNCTIONS
-- ============================================================

-- resolve_game: mark result and recalculate pick points
create or replace function public.resolve_game(
  p_game_id uuid,
  p_winner  text  -- 'HOME' | 'AWAY' | 'PUSH'
)
returns void
language plpgsql
security definer
as $$
begin
  -- Update game status and winner
  update public.games
  set status = 'FINAL', winner = p_winner
  where id = p_game_id;

  -- Recalculate points for all picks on this game
  update public.picks p
  set points = case
    when g.winner = 'PUSH' then 0
    when p.picked_team = g.winner and p.is_lotw then 2
    when p.picked_team = g.winner and not p.is_lotw then 1
    when p.picked_team != g.winner and p.is_lotw then -2
    when p.picked_team != g.winner and not p.is_lotw then -1
    else 0
  end
  from public.games g
  where p.game_id = p_game_id
    and g.id = p_game_id;

  -- Recalculate pick_points in weekly_scores for all affected members
  update public.weekly_scores ws
  set pick_points = (
    select coalesce(sum(p2.points), 0)
    from public.picks p2
    where p2.member_id = ws.member_id
      and p2.week_id = ws.week_id
      and p2.points is not null
  )
  where ws.member_id in (
    select member_id from public.picks where game_id = p_game_id
  );

  -- Insert weekly_scores rows for members who don't have one yet
  insert into public.weekly_scores (member_id, week_id, pick_points)
  select p.member_id, p.week_id,
    coalesce(sum(p2.points), 0)
  from public.picks p
  join public.picks p2 on p2.member_id = p.member_id and p2.week_id = p.week_id and p2.points is not null
  where p.game_id = p_game_id
  group by p.member_id, p.week_id
  on conflict (member_id, week_id) do nothing;
end;
$$;

-- close_week: apply forfeit and LOTW penalties, set week to CLOSED
create or replace function public.close_week(p_week_id int)
returns void
language plpgsql
security definer
as $$
declare
  v_required_picks int;
  r record;
begin
  select required_picks into v_required_picks
  from public.weeks where id = p_week_id;

  -- For each active member who participated or should have
  for r in
    select p.id as profile_id
    from public.profiles p
    where p.is_active = true
  loop
    declare
      v_pick_count int;
      v_has_lotw   boolean;
      v_forfeit    int;
      v_lotw_pen   int;
    begin
      select count(*) into v_pick_count
      from public.picks
      where member_id = r.profile_id and week_id = p_week_id;

      select exists(
        select 1 from public.picks
        where member_id = r.profile_id and week_id = p_week_id and is_lotw = true
      ) into v_has_lotw;

      v_forfeit := greatest(0, v_required_picks - v_pick_count) * -1;
      v_lotw_pen := case when v_has_lotw or v_pick_count = 0 then 0 else -1 end;

      -- Only create/update scores for members who have picks or penalties
      if v_pick_count > 0 or v_forfeit < 0 or v_lotw_pen < 0 then
        insert into public.weekly_scores (member_id, week_id, pick_points, forfeit_penalty, lotw_penalty)
        values (r.profile_id, p_week_id, 0, v_forfeit, v_lotw_pen)
        on conflict (member_id, week_id) do update
          set forfeit_penalty = excluded.forfeit_penalty,
              lotw_penalty    = excluded.lotw_penalty;
      end if;
    end;
  end loop;

  update public.weeks set status = 'CLOSED' where id = p_week_id;
end;
$$;
