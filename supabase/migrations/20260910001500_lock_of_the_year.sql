-- Lock of the Year: one pick per member per season, worth triple.
--
-- The league already had a Lock of the Week (one per member per week, +/-2). A LOTY is the
-- same idea stretched over the season: a member gets exactly one, ever, per season, and it
-- grades at +/-3 (docs: "LOTW Record List (LOTY is equal to 3)").
--
-- Modelled as an upgrade of the week's lock rather than a second, parallel flag. A LOTY
-- STANDS IN PLACE OF that week's LOTW -- spend it in week 4 and you have not also got a
-- LOTW to spend in week 4 -- so is_loty always carries is_lotw with it. That keeps one
-- meaning for "this member's lock this week": every existing reader (close_week's LOTW
-- penalty, the LOTW record lists, the pick grid's star) keeps working untouched, and
-- is_loty only raises the weight.

alter table public.picks
  add column is_loty boolean not null default false;

comment on column public.picks.is_loty is
  'The season''s single Lock of the Year. Grades at +/-3 and stands in place of that week''s LOTW, so is_lotw is always true alongside it.';

alter table public.picks
  add constraint picks_loty_implies_lotw
    check (not is_loty or is_lotw);

-- One per member per season. picks has no season_id -- it reaches the season through
-- weeks -- so this cannot be a partial unique index and has to be a trigger.
create index picks_loty_idx on public.picks (member_id) where is_loty;

create or replace function public.enforce_one_loty_per_season()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_season_id int;
  v_other     int;
begin
  if not new.is_loty then
    return new;
  end if;

  -- An UPDATE that leaves an already-spent LOTY where it is (a re-grade writing points,
  -- an admin override rewriting the wager) is not a second LOTY.
  if tg_op = 'UPDATE' and old.is_loty then
    return new;
  end if;

  select season_id into v_season_id
  from public.weeks
  where id = new.week_id;

  select count(*) into v_other
  from public.picks p
  join public.weeks w on w.id = p.week_id
  where p.member_id = new.member_id
    and p.is_loty
    and w.season_id = v_season_id
    and p.id <> new.id;

  if v_other > 0 then
    raise exception 'loty_already_used: member % has already used their Lock of the Year this season', new.member_id
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.enforce_one_loty_per_season() is
  'Rejects a second Lock of the Year for the same member within one season. The API checks first and returns a readable message; this is the backstop.';

create trigger picks_one_loty_per_season
  before insert or update of is_loty on public.picks
  for each row execute function public.enforce_one_loty_per_season();

-- ------------------------------------------------------------------
-- resolve_game: weight a LOTY at 3
-- ------------------------------------------------------------------
-- Verbatim re-declaration of 20260908202846_revoke_public_rpc_execute.sql's body, with the
-- single change being the grading weights. CREATE OR REPLACE preserves the ACL, so the
-- anon/authenticated revokes applied there stay revoked.

create or replace function public.resolve_game(
  p_game_id uuid,
  p_home_score integer,
  p_away_score integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'forbidden: resolve_game is service-role only';
  end if;

  if p_home_score is null or p_away_score is null then
    raise exception 'resolve_game requires both scores (got home=%, away=%)',
      p_home_score, p_away_score;
  end if;

  if p_home_score < 0 or p_away_score < 0 then
    raise exception 'resolve_game rejects negative scores (got home=%, away=%)',
      p_home_score, p_away_score;
  end if;

  update public.games
  set status     = 'FINAL',
      home_score = p_home_score,
      away_score = p_away_score,
      winner     = case
                     when p_home_score > p_away_score then 'HOME'
                     when p_away_score > p_home_score then 'AWAY'
                     else 'PUSH'
                   end
  where id = p_game_id;

  -- Grade every wager on this game against its own line. A LOTY is checked before a LOTW
  -- because it always carries is_lotw as well.
  update public.picks p
  set points = case public.grade_pick(p.bet_type, p.selection, p.line,
                                      g.home_score, g.away_score)
    when 'WIN'  then case when p.is_loty then  3 when p.is_lotw then  2 else  1 end
    when 'LOSS' then case when p.is_loty then -3 when p.is_lotw then -2 else -1 end
    when 'PUSH' then 0
    else null
  end
  from public.games g
  where p.game_id = p_game_id
    and g.id = p_game_id;

  -- Recalculate pick_points for every member holding a wager on this game.
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

  -- And open a row for anyone who does not have one yet.
  insert into public.weekly_scores (member_id, week_id, pick_points)
  select p.member_id, p.week_id, coalesce(sum(p2.points), 0)
  from public.picks p
  join public.picks p2
    on p2.member_id = p.member_id
   and p2.week_id = p.week_id
   and p2.points is not null
  where p.game_id = p_game_id
  group by p.member_id, p.week_id
  on conflict (member_id, week_id) do nothing;
end;
$function$;
