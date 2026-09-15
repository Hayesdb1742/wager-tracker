-- Line history from The Odds API: game_lines, a run log, and the cron that fills them.
--
-- Members enter their own line on every pick (picks.line / picks.odds), and until now nothing
-- in the app knew what the market actually was. This migration adds a history of spreads and
-- totals per game and per bookmaker, written by a poll of The Odds API (the-odds-api.com) and
-- keyed to games.id so a pick can later be compared with the line at any moment of the week.
--
-- Two budget facts shape everything here. The Odds API's free tier is 500 credits a month, a
-- call costs (markets x regions) credits per sport whatever the number of events returned, and
-- a call that returns no events is free. So: spreads and totals only (2 credits per sport-call,
-- no moneyline), a fixed schedule that lands around 340 credits a month, and a guard in
-- request_odds_sync() that skips any sport with no upcoming game so the off-season and a
-- finished slate cost nothing.
--
-- Storage follows the same instinct: a row is written only when a book's line or price has
-- changed since the last stored row (the app compares against game_lines_latest), so a quiet
-- market produces no rows at all.
--
-- The HTTP call reuses the same two Vault secrets as request_results_sync() and, like it, does
-- nothing but warn until they exist:
--
--   select vault.create_secret('<CRON_SECRET from .env.local>', 'cron_secret');
--   select vault.create_secret('https://wager-tracker.vercel.app', 'app_url');

-- ------------------------------------------------------------------
-- 1. games.odds_api_event_id -- cache of the event <-> game match
-- ------------------------------------------------------------------

alter table public.games add column odds_api_event_id text null;

create unique index games_odds_api_event_id_key
  on public.games (sport, odds_api_event_id)
  where odds_api_event_id is not null;

comment on column public.games.odds_api_event_id is
  'The Odds API event id this game was matched to (by team names + kickoff). Set on first match; later polls join by it.';

-- ------------------------------------------------------------------
-- 2. game_lines -- one row per (game, bookmaker, market) change
-- ------------------------------------------------------------------

create table public.game_lines (
  id               bigint generated always as identity primary key,
  game_id          uuid not null references public.games (id) on delete cascade,
  bookmaker        text not null,
  market           text not null,
  line             numeric(5,1) not null,
  home_price       int null,
  away_price       int null,
  over_price       int null,
  under_price      int null,
  book_updated_at  timestamptz not null,
  captured_at      timestamptz not null default now(),

  constraint game_lines_market_check
    check (market in ('SPREAD', 'TOTAL')),

  -- A spread carries a price per side; a total carries a price per direction. Never both.
  constraint game_lines_prices_match_market check (
    (market = 'SPREAD'
      and home_price is not null and away_price is not null
      and over_price is null and under_price is null)
    or
    (market = 'TOTAL'
      and over_price is not null and under_price is not null
      and home_price is null and away_price is null)
  ),

  constraint game_lines_total_positive
    check (market <> 'TOTAL' or line > 0)
);

comment on table public.game_lines is
  'Spread and total history per game and bookmaker from The Odds API. A row is written only when the line or a price changed since the previous row for the same (game, bookmaker, market).';
comment on column public.game_lines.bookmaker is
  'The Odds API bookmaker key, e.g. draftkings, fanduel, betmgm.';
comment on column public.game_lines.market is
  'SPREAD or TOTAL -- the same vocabulary as picks.bet_type.';
comment on column public.game_lines.line is
  'SPREAD: the home team''s handicap (negative = home favoured). TOTAL: the over/under number.';
comment on column public.game_lines.book_updated_at is
  'The bookmaker''s own last-update timestamp for this market, as reported by the API.';
comment on column public.game_lines.captured_at is
  'When our poll observed this line.';

create index game_lines_game_market_book_idx
  on public.game_lines (game_id, market, bookmaker, captured_at desc);

alter table public.game_lines enable row level security;

create policy "game_lines_read_authenticated" on public.game_lines
  for select using (auth.role() = 'authenticated');

-- No write policy: only the service role (the sync route) inserts.

-- The current line per (game, bookmaker, market). The sync compares each fetched line against
-- this to decide whether anything changed; the UI can use it for "the line right now".
create view public.game_lines_latest
  with (security_invoker = true)
as
  select distinct on (game_id, bookmaker, market)
    id, game_id, bookmaker, market, line,
    home_price, away_price, over_price, under_price,
    book_updated_at, captured_at
  from public.game_lines
  order by game_id, bookmaker, market, captured_at desc;

comment on view public.game_lines_latest is
  'Most recent game_lines row per (game, bookmaker, market).';

-- ------------------------------------------------------------------
-- 3. odds_poll_runs -- one row per sport per poll, for credits and matching
-- ------------------------------------------------------------------

create table public.odds_poll_runs (
  id                bigint generated always as identity primary key,
  ran_at            timestamptz not null default now(),
  sport             text not null check (sport in ('CFB', 'NFL')),
  events_returned   int not null default 0,
  matched           int not null default 0,
  rows_inserted     int not null default 0,
  unmatched         jsonb not null default '[]'::jsonb,
  credits_last      int null,
  credits_used      int null,
  credits_remaining int null,
  error             text null
);

comment on table public.odds_poll_runs is
  'Audit of each The Odds API poll: how many events came back, how many matched a game, how many line rows were written, and the credit counters from the response headers. unmatched lists events no game matched, for tuning the team-name aliases.';

alter table public.odds_poll_runs enable row level security;

create policy "odds_poll_runs_admin_read" on public.odds_poll_runs
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
  );

-- ------------------------------------------------------------------
-- 4. request_odds_sync(): ask the app to poll, but only for sports with games coming up
-- ------------------------------------------------------------------

create or replace function public.request_odds_sync(p_sports text[])
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_sports text[];
  v_secret text;
  v_url    text;
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'forbidden: request_odds_sync is service-role only';
  end if;

  -- A sport earns a call only while the active season has a not-yet-final game of that
  -- sport kicking off within the next ten days (or that kicked off in the last six hours,
  -- so a closing line still gets captured). Anything else would spend credits on nothing.
  select array_agg(s order by s) into v_sports
  from unnest(p_sports) as s
  where exists (
    select 1
    from public.games g
    join public.weeks w on w.id = g.week_id
    join public.seasons se on se.id = w.season_id
    where se.is_active
      and g.sport = s
      and g.status = 'SCHEDULED'
      and g.kickoff_time between now() - interval '6 hours' and now() + interval '10 days');

  if v_sports is null or array_length(v_sports, 1) = 0 then
    return null;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'app_url';

  if v_secret is null or v_url is null then
    raise warning 'request_odds_sync: vault secrets cron_secret and/or app_url are missing; not polling %', v_sports;
    return null;
  end if;

  return net.http_post(
    url                  := rtrim(v_url, '/') || '/api/admin/sync-odds',
    body                 := jsonb_build_object('sports', to_jsonb(v_sports)),
    headers              := jsonb_build_object(
                              'Content-Type', 'application/json',
                              'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000);
end;
$$;

comment on function public.request_odds_sync(text[]) is
  'Scheduled tick: POSTs {sports} to the app''s /api/admin/sync-odds (Bearer cron_secret from Vault), dropping any sport with no SCHEDULED game in the active season kicking off in [now-6h, now+10d]. Returns the pg_net request id, or null when it did nothing.';

revoke execute on function public.request_odds_sync(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 5. Schedule -- about 78 credits a week, ~340 a month against a 500 quota
-- ------------------------------------------------------------------
--
-- pg_cron runs in UTC. The times below are written for CDT (UTC-5); after the November DST
-- change every job fires an hour earlier on the clock in Chicago, which is harmless. Each
-- sport-call is 2 credits (spreads + totals, us region).
--
--   Tue-Thu   08:00 13:00 18:00 CT                     both sports   12/day
--   Fri, Mon  08:00 18:00 CT                           both sports    8/day
--   Sat       07:00 10:00 12:30 14:00 17:00 19:00 CT   CFB           12
--             08:00 18:00 CT                           NFL            4
--   Sun       07:00 10:00 11:30 14:30 18:30 CT         NFL           10

select cron.schedule('odds-midweek',      '0 13,18,23 * * 2-4',  $$select public.request_odds_sync('{CFB,NFL}')$$);
select cron.schedule('odds-fri-mon',      '0 13,23 * * 1,5',     $$select public.request_odds_sync('{CFB,NFL}')$$);
select cron.schedule('odds-sat-cfb',      '0 12,15,19,22 * * 6', $$select public.request_odds_sync('{CFB}')$$);
select cron.schedule('odds-sat-cfb-1230', '30 17 * * 6',         $$select public.request_odds_sync('{CFB}')$$);
select cron.schedule('odds-sat-cfb-1900', '0 0 * * 0',           $$select public.request_odds_sync('{CFB}')$$); -- Sat 19:00 CDT is Sun 00:00 UTC
select cron.schedule('odds-sat-nfl',      '0 13,23 * * 6',       $$select public.request_odds_sync('{NFL}')$$);
select cron.schedule('odds-sun-nfl',      '0 12,15 * * 0',       $$select public.request_odds_sync('{NFL}')$$);
select cron.schedule('odds-sun-nfl-30',   '30 16,19,23 * * 0',   $$select public.request_odds_sync('{NFL}')$$);
