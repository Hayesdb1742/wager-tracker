-- Week lifecycle automation: an UPCOMING state, advance_season(), and two cron jobs.
--
-- Through week 2 every step of the weekly cycle was a human: sync results by hand,
-- close_week by hand, then flip the next week OPEN by hand. Three facts made that
-- hard to automate as the schema stood:
--
-- 1. Only one week can be OPEN at a time. The picks page serves "the highest-numbered
--    OPEN week in the active season", so opening week N+1 while N still has Sunday and
--    Monday games hides N. The opener must therefore run AFTER the closer, never on a
--    clock of its own.
-- 2. CLOSED meant two things: "finished" and "not yet opened". Weeks were seeded CLOSED
--    so the picks page would not be hijacked by a future week, which left nothing to
--    tell "the next week to open" apart from "a week that already happened".
-- 3. weeks.opens_at was seeded as "first kickoff minus five days", which lands on the
--    prior week's Saturday -- mid-slate. It was never a usable opening time.
--
-- This migration gives each of those a home:
--
-- * A third status, UPCOMING, for weeks that have not been opened yet. CLOSED now only
--   ever means finished. Every consumer in the app already branches on OPEN or on CLOSED
--   specifically, so an UPCOMING week reads as "not current, not scored" everywhere.
-- * opens_at is redefined as "06:00 America/Chicago the day after the previous pool
--   week's last kickoff" -- i.e. the Tuesday morning after Monday Night Football.
-- * advance_season(): close any OPEN week whose pool games are all FINAL, and if nothing
--   is then OPEN, open the lowest UPCOMING week whose opens_at has passed. Runs hourly.
-- * request_results_sync(): asks the deployed app to pull scores for the OPEN week,
--   but only while a game has kicked off in the last eight hours and is not yet FINAL.
--   Runs every 15 minutes; on a Tuesday afternoon it makes no request at all.
--
-- Both functions are SECURITY DEFINER with the same service-role-only guard as
-- close_week and resolve_game, and lose their anon/authenticated/PUBLIC EXECUTE below.
-- pg_cron runs them as postgres, where auth.role() is null, so the guard passes.
--
-- The HTTP call needs two Vault secrets that this file deliberately does not create
-- (the migration is committed; the secret is not):
--
--   select vault.create_secret('<CRON_SECRET from .env.local>', 'cron_secret');
--   select vault.create_secret('https://wager-tracker.vercel.app', 'app_url');
--
-- Until both exist, request_results_sync() logs a warning and does nothing; the rest
-- of the lifecycle still works, it just waits on a manual sync to see games go FINAL.

-- ------------------------------------------------------------------
-- 1. weeks.status gains UPCOMING
-- ------------------------------------------------------------------

alter table public.weeks drop constraint weeks_status_check;
alter table public.weeks add constraint weeks_status_check
  check (status = any (array['UPCOMING'::text, 'OPEN'::text, 'CLOSED'::text]));

comment on column public.weeks.status is
  'UPCOMING: not yet opened for picks. OPEN: the current week (at most one per season, by convention not constraint). CLOSED: finished and scored via close_week.';

comment on column public.weeks.opens_at is
  'Earliest moment advance_season() may open this week -- 06:00 America/Chicago the day after the prior pool week''s last kickoff. Opening also requires no other week in the season to be OPEN.';

-- Backfill for the active season: every CLOSED week numbered above the highest week
-- that has been opened or played becomes UPCOMING. Week 0 sits below week 1 and stays
-- CLOSED -- the pool never played it, and this keeps it from being "next".
update public.weeks w
set status = 'UPCOMING'
from public.seasons s
where s.id = w.season_id
  and s.is_active
  and w.status = 'CLOSED'
  and not exists (select 1 from public.picks p where p.week_id = w.id)
  and not exists (select 1 from public.weekly_scores ws where ws.week_id = w.id)
  and w.week_number > (
    select max(w2.week_number)
    from public.weeks w2
    where w2.season_id = w.season_id
      and (w2.status = 'OPEN'
           or exists (select 1 from public.picks p where p.week_id = w2.id))
  );

-- ------------------------------------------------------------------
-- 2. opens_at = the Tuesday morning after the previous week's last game
-- ------------------------------------------------------------------

with prior_last_kick as (
  select w.id,
         (select max(g.kickoff_time)
          from public.games g
          join public.weeks pw on pw.id = g.week_id
          where pw.season_id = w.season_id
            and pw.week_number = (
              select max(w3.week_number) from public.weeks w3
              where w3.season_id = w.season_id and w3.week_number < w.week_number)
         ) as last_kick
  from public.weeks w
  join public.seasons s on s.id = w.season_id
  where s.is_active and w.status = 'UPCOMING'
)
update public.weeks w
set opens_at = ((plk.last_kick at time zone 'America/Chicago')::date + 1 + time '06:00')
               at time zone 'America/Chicago'
from prior_last_kick plk
where plk.id = w.id and plk.last_kick is not null;

-- ------------------------------------------------------------------
-- 3. advance_season(): close what is finished, open what is next
-- ------------------------------------------------------------------

create or replace function public.advance_season()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_season_id int;
  v_closed    int[]  := '{}';
  v_skipped   text[] := '{}';
  v_opened    int;
  v_last_kick timestamptz;
  v_next      public.weeks%rowtype;
  v_cfb       int;
  v_nfl       int;
  r           record;
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'forbidden: advance_season is service-role only';
  end if;

  select id into v_season_id from public.seasons where is_active limit 1;
  if v_season_id is null then
    return jsonb_build_object('season', null, 'note', 'no active season');
  end if;

  -- Close. Every guard here is a reason a human would hesitate before clicking
  -- "Close week"; when one trips, the week stays OPEN and the reason is returned.
  for r in
    select w.id, w.week_number
    from public.weeks w
    where w.season_id = v_season_id and w.status = 'OPEN'
    order by w.week_number
  loop
    if not exists (select 1 from public.games g where g.week_id = r.id and g.in_pool) then
      v_skipped := v_skipped || format('week %s: no pool games', r.week_number);
      continue;
    end if;

    if exists (select 1 from public.games g
               where g.week_id = r.id and g.in_pool and g.status <> 'FINAL') then
      v_skipped := v_skipped || format('week %s: games not final', r.week_number);
      continue;
    end if;

    -- A slate can read all-FINAL a beat before the last score is really settled;
    -- give the final game four hours from kickoff before trusting it.
    select max(g.kickoff_time) into v_last_kick
    from public.games g where g.week_id = r.id and g.in_pool;
    if v_last_kick > now() - interval '4 hours' then
      v_skipped := v_skipped || format('week %s: last kickoff under 4h ago', r.week_number);
      continue;
    end if;

    -- resolve_game grades every pick on a game when it goes FINAL, so an ungraded pick
    -- on a FINAL game means something was inserted after the fact (a backfill) and has
    -- not been re-graded. close_week would bank the week short.
    if exists (select 1 from public.picks p
               join public.games g on g.id = p.game_id
               where p.week_id = r.id and g.status = 'FINAL' and p.points is null) then
      v_skipped := v_skipped || format('week %s: ungraded picks on final games', r.week_number);
      continue;
    end if;

    perform public.close_week(r.id);
    v_closed := v_closed || r.id;
  end loop;

  -- Open. Only when nothing is OPEN, and only the lowest UPCOMING week whose time has
  -- come. A week short of games for its required split (the week-13+ gap) stays
  -- UPCOMING with a reason rather than opening as unplayable.
  if not exists (select 1 from public.weeks
                 where season_id = v_season_id and status = 'OPEN') then
    select * into v_next
    from public.weeks w
    where w.season_id = v_season_id and w.status = 'UPCOMING' and w.opens_at <= now()
    order by w.week_number
    limit 1;

    if found then
      select count(*) filter (where sport = 'CFB'),
             count(*) filter (where sport = 'NFL')
      into v_cfb, v_nfl
      from public.games where week_id = v_next.id and in_pool;

      if v_cfb < coalesce(v_next.required_cfb_picks, 0)
         or v_nfl < coalesce(v_next.required_nfl_picks, 0)
         or v_cfb + v_nfl < v_next.required_picks then
        v_skipped := v_skipped || format(
          'week %s: not enough games to open (cfb %s/%s, nfl %s/%s, total %s/%s)',
          v_next.week_number, v_cfb, coalesce(v_next.required_cfb_picks, 0),
          v_nfl, coalesce(v_next.required_nfl_picks, 0), v_cfb + v_nfl, v_next.required_picks);
      else
        update public.weeks set status = 'OPEN' where id = v_next.id;
        v_opened := v_next.id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'season',  v_season_id,
    'closed',  to_jsonb(v_closed),
    'opened',  v_opened,
    'skipped', to_jsonb(v_skipped));
end;
$$;

comment on function public.advance_season() is
  'Hourly lifecycle tick for the active season: close_week() any OPEN week whose pool games are all FINAL, then open the lowest UPCOMING week whose opens_at has passed if none is OPEN. Returns what it did and why it declined.';

-- ------------------------------------------------------------------
-- 4. request_results_sync(): ask the app for scores while games are live
-- ------------------------------------------------------------------

create or replace function public.request_results_sync()
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_week_id int;
  v_secret  text;
  v_url     text;
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'forbidden: request_results_sync is service-role only';
  end if;

  -- Only an OPEN week with a game that kicked off in the last eight hours and is
  -- not yet FINAL. Outside that window there is nothing upstream could tell us.
  select w.id into v_week_id
  from public.weeks w
  join public.seasons s on s.id = w.season_id
  where s.is_active
    and w.status = 'OPEN'
    and exists (
      select 1 from public.games g
      where g.week_id = w.id
        and g.status <> 'FINAL'
        and g.kickoff_time between now() - interval '8 hours' and now())
  order by w.week_number
  limit 1;

  if v_week_id is null then
    return null;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'app_url';

  if v_secret is null or v_url is null then
    raise warning 'request_results_sync: vault secrets cron_secret and/or app_url are missing; not syncing week %', v_week_id;
    return null;
  end if;

  return net.http_post(
    url                  := rtrim(v_url, '/') || '/api/admin/sync-results',
    body                 := jsonb_build_object('weekId', v_week_id),
    headers              := jsonb_build_object(
                              'Content-Type', 'application/json',
                              'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000);
end;
$$;

comment on function public.request_results_sync() is
  'Every-15-minutes tick: POSTs {weekId} to the app''s /api/admin/sync-results (Bearer cron_secret from Vault) for the OPEN week, only while a game kicked off in the last 8h is not FINAL. Returns the pg_net request id, or null when it did nothing.';

-- ------------------------------------------------------------------
-- 5. ACLs -- same treatment as the other service-role RPCs
-- ------------------------------------------------------------------

revoke execute on function public.advance_season()       from public, anon, authenticated;
revoke execute on function public.request_results_sync() from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 6. Schedule
-- ------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create extension if not exists pg_net;

-- Both run in UTC. :05 hourly keeps the closer a beat behind the :00 sync.
select cron.schedule('advance-season',        '5 * * * *',    $$select public.advance_season()$$);
select cron.schedule('sync-open-week-results', '*/15 * * * *', $$select public.request_results_sync()$$);
