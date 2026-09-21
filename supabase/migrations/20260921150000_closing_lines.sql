-- Anchor the closing line: stop recording in-play odds, and hide the ones already stored.
--
-- The Odds API keeps returning a game while it is being played, with live numbers, and the
-- first week of polling wrote those in (494 rows across 53 games: a +30.5 spread on a game
-- that closed at +2.5). request_odds_sync() allowed it by counting games that kicked off up
-- to six hours ago, so a "closing line" could still be captured. But every poll already sees
-- the last pre-kick line, and the app's sync now skips events that have commenced, so the
-- lookback only ever bought in-play rows.
--
-- The stored in-play rows are kept -- they are history, and deleting is a separate decision
-- -- but game_lines_latest now ignores any row a book updated at or after kickoff. Once a
-- game starts, "latest" is therefore the closing line, and the picks page and the sync's
-- own change-detection both read the view, so neither needs to know.

-- ------------------------------------------------------------------
-- 1. game_lines_latest -- last line per (game, bookmaker, market), pre-kick only
-- ------------------------------------------------------------------

create or replace view public.game_lines_latest
  with (security_invoker = true)
as
  select distinct on (l.game_id, l.bookmaker, l.market)
    l.id, l.game_id, l.bookmaker, l.market, l.line,
    l.home_price, l.away_price, l.over_price, l.under_price,
    l.book_updated_at, l.captured_at
  from public.game_lines l
  join public.games g on g.id = l.game_id
  where l.book_updated_at < g.kickoff_time
  order by l.game_id, l.bookmaker, l.market, l.captured_at desc;

comment on view public.game_lines_latest is
  'Most recent pre-kick game_lines row per (game, bookmaker, market). Rows a book updated at or after kickoff are in-play lines and are excluded, so for a started game this is the closing line.';

-- ------------------------------------------------------------------
-- 2. request_odds_sync(): only games still to kick off earn a call
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
  -- sport kicking off within the next ten days. A game already under way has nothing
  -- left to capture: the books show in-play numbers from kickoff on.
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
      and g.kickoff_time between now() and now() + interval '10 days');

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
  'Scheduled tick: POSTs {sports} to the app''s /api/admin/sync-odds (Bearer cron_secret from Vault), dropping any sport with no SCHEDULED game in the active season kicking off in [now, now+10d]. Returns the pg_net request id, or null when it did nothing.';
