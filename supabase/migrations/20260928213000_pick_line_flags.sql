-- Flag a wager whose line no book ever posted, so the commissioners can audit it.
--
-- Members type their own line (see 20260908195803_wager_types.sql: "Lines are not sourced
-- from a provider and are not verified"). That was fine while nothing in the app knew what
-- the market was; game_lines has known since 20260915013944_game_lines.sql. This migration
-- closes the loop: every pick is compared against the spreads and totals DraftKings and
-- FanDuel actually posted for that game, and one that falls outside them is recorded in
-- pick_line_flags for an admin to look at.
--
-- Nothing here refuses a pick or tells the member anything. A line outside the market is
-- usually a typo -- a sign flipped, a half-point fat-fingered, the wrong game's number --
-- and once in a while it is not, which is exactly why a human decides. Flagging is
-- therefore wrapped in an exception handler everywhere it runs: an audit trail must never
-- be able to break a member's submission or the odds poll.
--
-- What "outside the bounds" means here
-- ------------------------------------
-- The bound is the *envelope* of every pre-kick line the two books posted for that game
-- and market over the whole week, not the line at any one moment. Lines move: across the
-- 249 games polled so far the DK/FD spread envelope is a median 1.0 and a 90th-percentile
-- 3.5 points wide. Comparing against a single snapshot would flag most of the league for
-- betting on Tuesday. Comparing against the envelope asks the only question worth asking:
-- was this number ever on the board at all?
--
-- A tolerance (default half a point) sits on top of that, because the poll samples only a
-- few times a day and can miss a number that was genuinely up. Against the 159 comparable
-- picks on record the envelope alone flags 10; with the half-point tolerance, 9; at a full
-- point, 4. Half a point keeps the obvious typos and drops the pick that was merely half a
-- point off a line we happened not to sample.
--
-- Both directions are flagged, and labelled. A line better than the market is the one that
-- matters for an audit; a line worse than the market only costs the member, but it is still
-- a number that was never posted, and in the existing data it is the more common of the two
-- (Detroit recorded at -5.5 when Detroit was a +4.5 underdog -- a sign error, ten points
-- wrong, against the member's own interest).
--
-- Moneylines are not checked. The odds poll buys spreads and totals only -- the h2h market
-- would cost another credit per sport-call against a 500/month quota -- so there is no
-- posted number to compare an ML against. Prices (picks.odds) are not checked either; that
-- is a separate judgement from the line, and a noisier one.

-- ------------------------------------------------------------------
-- 1. Who counts as a line provider
-- ------------------------------------------------------------------
-- One definition, shared by the assessor and the odds-poll trigger. Matches DISPLAY_BOOKS
-- in src/lib/odds/display.ts -- the books the picks page shows are the books a member could
-- have been reading.

create or replace function public.line_provider_books()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['draftkings', 'fanduel']::text[] $$;

comment on function public.line_provider_books() is
  'The bookmakers a member''s line is audited against. Mirrors DISPLAY_BOOKS in src/lib/odds/display.ts.';

-- ------------------------------------------------------------------
-- 2. pick_line_flags -- the alert rows
-- ------------------------------------------------------------------

create table public.pick_line_flags (
  pick_id           uuid primary key references public.picks (id) on delete cascade,
  member_id         uuid not null references public.profiles (id),
  game_id           uuid not null references public.games (id),
  week_id           int  not null references public.weeks (id),

  -- The wager as the member entered it, copied so the alert still reads correctly after an
  -- override rewrites the pick.
  bet_type          text not null check (bet_type in ('SPREAD', 'TOTAL')),
  selection         text not null check (selection in ('HOME', 'AWAY', 'OVER', 'UNDER')),
  pick_line         numeric(5,1) not null,
  pick_odds         int null,
  placed_at         timestamptz not null,

  verdict           text not null
    check (verdict in ('BETTER_THAN_MARKET', 'WORSE_THAN_MARKET')),
  deviation         numeric(5,1) not null,
  market_best_line  numeric(5,1) not null,
  market_worst_line numeric(5,1) not null,
  books_seen        text[] not null,
  market_rows       int not null,
  tolerance         numeric(4,1) not null,

  status            text not null default 'OPEN'
    check (status in ('OPEN', 'AUTO_CLEARED', 'DISMISSED', 'CONFIRMED')),
  reviewed_by       uuid null references public.profiles (id),
  reviewed_at       timestamptz null,
  review_note       text null,

  first_flagged_at  timestamptz not null default now(),
  last_checked_at   timestamptz not null default now()
);

comment on table public.pick_line_flags is
  'Picks whose line falls outside every pre-kick DraftKings/FanDuel line posted for that game and market. One row per pick; raised, kept current and auto-cleared by flag_pick_line(). Admin-readable; reviewed through review_pick_line_flag().';

comment on column public.pick_line_flags.placed_at is
  'picks.created_at -- when the member submitted. An admin override changes the line later; the detail view shows overridden_at alongside.';
comment on column public.pick_line_flags.pick_line is
  'The line as stored on the pick: from the selected side''s perspective for a spread, the total itself for a total.';
comment on column public.pick_line_flags.verdict is
  'BETTER_THAN_MARKET = the member''s number is more favourable to them than anything posted (the audit-worthy direction). WORSE_THAN_MARKET = less favourable, which still means it was never on the board.';
comment on column public.pick_line_flags.deviation is
  'Points outside the envelope, signed in the member''s favour: +4.0 = four points better than the best line posted, -10.0 = ten points worse than the worst.';
comment on column public.pick_line_flags.market_best_line is
  'The most favourable line the books posted for this side, in the same perspective as pick_line.';
comment on column public.pick_line_flags.market_worst_line is
  'The least favourable line the books posted for this side, in the same perspective as pick_line.';
comment on column public.pick_line_flags.books_seen is
  'Which providers contributed lines to the envelope. One book alone is a thinner comparison than two.';
comment on column public.pick_line_flags.market_rows is
  'How many pre-kick line rows the envelope was drawn from.';
comment on column public.pick_line_flags.tolerance is
  'The slack allowed outside the envelope when this flag was last assessed, in points.';
comment on column public.pick_line_flags.status is
  'OPEN = waiting on an admin. AUTO_CLEARED = a later poll showed the market covering this line after all (nobody dismissed it; it re-opens if it goes back outside). DISMISSED / CONFIRMED = an admin ruled, and no poll overwrites that.';
comment on column public.pick_line_flags.first_flagged_at is
  'When this pick was first found outside the market. Unchanged by later re-checks.';
comment on column public.pick_line_flags.last_checked_at is
  'When the numbers on this row were last re-assessed against the market.';

create index pick_line_flags_status_idx on public.pick_line_flags (status, first_flagged_at desc);
create index pick_line_flags_member_idx on public.pick_line_flags (member_id);
create index pick_line_flags_week_idx   on public.pick_line_flags (week_id);

alter table public.pick_line_flags enable row level security;

-- Read: admins only. This is an audit surface about members, not something the league sees.
create policy "pick_line_flags_admin_read" on public.pick_line_flags
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
  );

-- No write policy on purpose: rows are written by flag_pick_line() and reviewed through
-- review_pick_line_flag(), both SECURITY DEFINER. Nothing holding the publishable key can
-- edit or erase an alert about itself.

-- ------------------------------------------------------------------
-- 3. assess_pick_line() -- one pick against the market envelope
-- ------------------------------------------------------------------
-- Everything is restated in the member's own terms before being compared, because three
-- perspectives meet here:
--
--   game_lines.line   a spread from the HOME team's side; a total as its number
--   picks.line        a spread from the SELECTED side; a total as its number
--   "better"          a higher number for a spread and for an under, a LOWER one for an over
--
-- So each market row is mapped to the line the member would have written down, and then
-- oriented so that higher is always better for them. One comparison then covers a home
-- spread, an away spread, an over and an under.

create or replace function public.assess_pick_line(
  p_pick_id   uuid,
  p_tolerance numeric default 0.5
)
returns table (
  verdict           text,
  pick_line         numeric,
  market_best_line  numeric,
  market_worst_line numeric,
  deviation         numeric,
  books_seen        text[],
  market_rows       int,
  market_last_seen  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with pick as (
    select p.id, p.game_id, p.bet_type, p.selection, p.line,
           -- An over is the one side that wants a smaller number.
           (p.bet_type = 'TOTAL' and p.selection = 'OVER') as invert
    from public.picks p
    where p.id = p_pick_id
  ),
  market as (
    select
      l.bookmaker,
      l.captured_at,
      -- Inner case: the stored home-perspective spread seen from the side taken.
      -- Outer negation: orient it so higher is better for the member.
      case when pk.invert then -1 else 1 end
        * (case when pk.selection = 'AWAY' then -l.line else l.line end) as value
    from pick pk
    join public.games g      on g.id = pk.game_id
    join public.game_lines l on l.game_id = pk.game_id
                           and l.market  = pk.bet_type
    where l.bookmaker = any (public.line_provider_books())
      -- The same cut game_lines_latest makes: a row a book updated at or after kickoff is
      -- an in-play number, and nobody could have bet it beforehand.
      and l.book_updated_at < g.kickoff_time
  ),
  envelope as (
    select
      max(m.value)                                         as best_value,
      min(m.value)                                         as worst_value,
      array_agg(distinct m.bookmaker order by m.bookmaker) as books,
      count(*)::int                                        as rows_seen,
      max(m.captured_at)                                   as last_seen
    from market m
  )
  select
    case
      when pk.bet_type = 'ML' then 'NOT_COMPARABLE'
      when e.rows_seen = 0    then 'NO_MARKET'
      when v.pick_value > e.best_value  + p_tolerance then 'BETTER_THAN_MARKET'
      when v.pick_value < e.worst_value - p_tolerance then 'WORSE_THAN_MARKET'
      else 'WITHIN_MARKET'
    end,
    pk.line,
    case when pk.invert then -e.best_value  else e.best_value  end,
    case when pk.invert then -e.worst_value else e.worst_value end,
    case
      when e.rows_seen = 0 then null
      when v.pick_value > e.best_value  + p_tolerance then v.pick_value - e.best_value
      when v.pick_value < e.worst_value - p_tolerance then v.pick_value - e.worst_value
      else 0
    end,
    coalesce(e.books, array[]::text[]),
    e.rows_seen,
    e.last_seen
  from pick pk
  cross join envelope e
  cross join lateral (
    select (case when pk.invert then -1 else 1 end) * pk.line as pick_value
  ) v;
$$;

comment on function public.assess_pick_line(uuid, numeric) is
  'Compares one pick''s line against the envelope of pre-kick DraftKings/FanDuel lines for its game and market. Returns no rows for a pick that does not exist; verdict NOT_COMPARABLE for a moneyline (that market is not polled) and NO_MARKET when no line was ever captured. deviation is signed in the member''s favour.';

revoke execute on function public.assess_pick_line(uuid, numeric) from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 4. flag_pick_line() -- raise, refresh or auto-clear one pick's flag
-- ------------------------------------------------------------------

create or replace function public.flag_pick_line(
  p_pick_id   uuid,
  p_tolerance numeric default 0.5
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  a record;
begin
  select id, member_id, game_id, week_id, bet_type, selection, line, odds, created_at
    into p
  from public.picks
  where id = p_pick_id;

  if not found then
    return null;
  end if;

  select * into a from public.assess_pick_line(p_pick_id, p_tolerance);

  if not found then
    return null;
  end if;

  if a.verdict in ('BETTER_THAN_MARKET', 'WORSE_THAN_MARKET') then
    insert into public.pick_line_flags as f (
      pick_id, member_id, game_id, week_id,
      bet_type, selection, pick_line, pick_odds, placed_at,
      verdict, deviation, market_best_line, market_worst_line,
      books_seen, market_rows, tolerance
    )
    values (
      p.id, p.member_id, p.game_id, p.week_id,
      p.bet_type, p.selection, p.line, p.odds, p.created_at,
      a.verdict, a.deviation, a.market_best_line, a.market_worst_line,
      a.books_seen, a.market_rows, p_tolerance
    )
    on conflict (pick_id) do update set
      -- The wager itself can have been overridden since the flag was raised.
      bet_type          = excluded.bet_type,
      selection         = excluded.selection,
      pick_line         = excluded.pick_line,
      pick_odds         = excluded.pick_odds,
      verdict           = excluded.verdict,
      deviation         = excluded.deviation,
      market_best_line  = excluded.market_best_line,
      market_worst_line = excluded.market_worst_line,
      books_seen        = excluded.books_seen,
      market_rows       = excluded.market_rows,
      tolerance         = excluded.tolerance,
      last_checked_at   = now(),
      -- A flag the market had covered is outside again, so it needs a look again. An
      -- admin's own ruling is never undone by a poll.
      status            = case when f.status = 'AUTO_CLEARED' then 'OPEN' else f.status end;
  else
    -- The market caught up (or the pick was overridden onto a posted number). Keep the row
    -- and the numbers it was raised on -- that is the audit trail -- and only move an
    -- untouched OPEN flag out of the queue.
    update public.pick_line_flags as f
    set status          = case when f.status = 'OPEN' then 'AUTO_CLEARED' else f.status end,
        last_checked_at = now()
    where f.pick_id = p_pick_id;
  end if;

  return a.verdict;
end;
$$;

comment on function public.flag_pick_line(uuid, numeric) is
  'Assesses one pick and keeps its pick_line_flags row in step: raises a flag, refreshes an open one against the current envelope, or auto-clears one the market has caught up with. Returns the verdict.';

revoke execute on function public.flag_pick_line(uuid, numeric) from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 5. Triggers -- on every pick, and again whenever the market moves
-- ------------------------------------------------------------------
-- Two entry points, because the two facts arrive in either order. A pick made on Tuesday
-- for a game no poll has reached yet cannot be assessed at insert time; it is assessed the
-- moment the first line lands.
--
-- Both handlers swallow their own errors. A lost flag is a lost audit row; a raised
-- exception here would be a refused pick or a failed odds sync.

create or replace function public.picks_flag_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.flag_pick_line(new.id);
  exception when others then
    raise warning 'picks_flag_line: pick % not assessed: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.picks_flag_line() is
  'AFTER trigger on picks: assesses the wager''s line against the market. Never raises -- flagging must not be able to refuse a pick.';

revoke execute on function public.picks_flag_line() from public, anon, authenticated;

-- Covers the member route, the admin override, and a direct write under picks_own_update.
create trigger picks_flag_line_after_write
  after insert or update of bet_type, selection, line on public.picks
  for each row execute function public.picks_flag_line();

create or replace function public.game_lines_recheck_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pick uuid;
begin
  begin
    for v_pick in
      select distinct p.id
      from inserted i
      join public.picks p on p.game_id  = i.game_id
                        and p.bet_type = i.market
      where i.bookmaker = any (public.line_provider_books())
    loop
      perform public.flag_pick_line(v_pick);
    end loop;
  exception when others then
    raise warning 'game_lines_recheck_flags: re-check skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.game_lines_recheck_flags() is
  'AFTER INSERT statement trigger on game_lines: re-assesses every pick on a game whose provider lines just moved, so a flag appears once the market is known and clears if the market grows to cover it. Never raises -- flagging must not be able to fail the odds sync.';

revoke execute on function public.game_lines_recheck_flags() from public, anon, authenticated;

create trigger game_lines_recheck_flags_after_insert
  after insert on public.game_lines
  referencing new table as inserted
  for each statement execute function public.game_lines_recheck_flags();

-- ------------------------------------------------------------------
-- 6. recheck_pick_line_flags() -- sweep, for a backfill or a changed tolerance
-- ------------------------------------------------------------------

create or replace function public.recheck_pick_line_flags(
  p_week_id   int     default null,
  p_tolerance numeric default 0.5
)
returns table (picks_checked int, flags_open int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pick    uuid;
  v_checked int := 0;
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'forbidden: recheck_pick_line_flags is service-role only';
  end if;

  for v_pick in
    select p.id
    from public.picks p
    where p.bet_type <> 'ML'
      and (p_week_id is null or p.week_id = p_week_id)
    order by p.created_at
  loop
    perform public.flag_pick_line(v_pick, p_tolerance);
    v_checked := v_checked + 1;
  end loop;

  return query
    select v_checked,
           (select count(*)::int from public.pick_line_flags where status = 'OPEN');
end;
$$;

comment on function public.recheck_pick_line_flags(int, numeric) is
  'Re-assesses every non-ML pick (optionally one week) against the market envelope at the given tolerance. For backfilling after this migration, or re-running the season if the tolerance is ever retuned. Service-role only.';

revoke execute on function public.recheck_pick_line_flags(int, numeric) from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 7. review_pick_line_flag() -- how an admin rules on one
-- ------------------------------------------------------------------

create or replace function public.review_pick_line_flag(
  p_pick_id uuid,
  p_status  text,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Service role, or a privileged caller with no JWT at all (psql, the Studio editor, a
  -- migration). The ADMIN-JWT arm is deliberate but currently unreachable: EXECUTE is
  -- revoked from `authenticated` below, so an admin ruling from the app has to come through
  -- an API route on the service-role client, the way /api/admin/picks/override already does.
  -- W2/F1 in docs/database-remediation-backlog.md is precisely the mistake of letting
  -- `authenticated` reach a SECURITY DEFINER function, and one in-function role check is not
  -- worth re-opening that door for.
  if auth.role() is not null
     and auth.role() <> 'service_role'
     and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'ADMIN' then
    raise exception 'forbidden: review_pick_line_flag is admin-only';
  end if;

  if p_status not in ('OPEN', 'DISMISSED', 'CONFIRMED') then
    raise exception 'review_pick_line_flag: status must be OPEN, DISMISSED or CONFIRMED (got %)', p_status;
  end if;

  update public.pick_line_flags
  set status      = p_status,
      review_note = coalesce(p_note, review_note),
      reviewed_by = v_actor,
      reviewed_at = now()
  where pick_id = p_pick_id;

  if not found then
    raise exception 'review_pick_line_flag: no flag for pick %', p_pick_id;
  end if;
end;
$$;

comment on function public.review_pick_line_flag(uuid, text, text) is
  'An admin''s ruling on a flag: DISMISSED (a typo, or a line we simply did not sample), CONFIRMED (a line that was never on the board), or OPEN to put it back in the queue. A ruling is not overwritten by later polls. Service-role only.';

revoke execute on function public.review_pick_line_flag(uuid, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 8. pick_line_flags_detail -- the view to actually read
-- ------------------------------------------------------------------
-- The flag table stores ids; an audit needs names. security_invoker, so the admin-only
-- policy on pick_line_flags governs this view too.

create view public.pick_line_flags_detail
  with (security_invoker = true)
as
  select
    f.pick_id,
    f.status,
    f.verdict,
    f.deviation,
    pr.display_name                      as member,
    f.placed_at,
    g.sport,
    w.week_number,
    g.away_team || ' at ' || g.home_team as matchup,
    g.kickoff_time,
    f.bet_type,
    f.selection,
    f.pick_line,
    f.pick_odds,
    f.market_best_line,
    f.market_worst_line,
    f.books_seen,
    f.market_rows,
    f.tolerance,
    p.is_lotw,
    p.is_loty,
    p.points,
    ov.display_name                      as overridden_by,
    p.overridden_at,
    f.first_flagged_at,
    f.last_checked_at,
    rv.display_name                      as reviewed_by,
    f.reviewed_at,
    f.review_note
  from public.pick_line_flags f
  join public.picks    p  on p.id  = f.pick_id
  join public.profiles pr on pr.id = f.member_id
  join public.games    g  on g.id  = f.game_id
  join public.weeks    w  on w.id  = f.week_id
  left join public.profiles ov on ov.id = p.overridden_by
  left join public.profiles rv on rv.id = f.reviewed_by;

comment on view public.pick_line_flags_detail is
  'pick_line_flags with the names an audit needs: who placed it, when, on what game, what they wrote, and what the books had. Admin-only through the underlying table''s policy.';
