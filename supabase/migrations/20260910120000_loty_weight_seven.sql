-- Lock of the Year: seven, not three -- and locks now count as games, not just points.
--
-- Two rulings from the league, one number.
--
-- 1. A lock's weight is its WEIGHT IN GAMES, not only in points. A member who went 2-3 on
--    the week with the LOTW among the losses is 2-4, because the lock is two games. Records
--    are what the league reads; the point total is a side effect of them. That half lives in
--    the app (src/lib/wagers.ts: LOCK_MULTIPLIER, pickRecord) because nothing in the schema
--    stores a record -- it is counted from picks.points at read time.
--
-- 2. A LOTY is worth seven, up from the three 20260910001500_lock_of_the_year.sql shipped
--    with. Lose it and the week reads 2-9. That half is here, so points and record stay the
--    same number: |points| IS the number of games the pick counted for.
--
-- No LOTY had been spent when this was written (0 rows with is_loty), so the re-grade below
-- is a no-op guard rather than a data fix -- but it is written to be correct either way, and
-- to leave weekly_scores consistent if one had been.

comment on column public.picks.is_loty is
  'The season''s single Lock of the Year. Grades at +/-7 -- seven points and seven games -- and stands in place of that week''s LOTW, so is_lotw is always true alongside it.';

-- ------------------------------------------------------------------
-- resolve_game: weight a LOTY at 7
-- ------------------------------------------------------------------
-- Verbatim re-declaration of 20260910001500_lock_of_the_year.sql's body, with the single
-- change being the LOTY grading weight. CREATE OR REPLACE preserves the ACL, so the
-- anon/authenticated revokes stay revoked.

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
    when 'WIN'  then case when p.is_loty then  7 when p.is_lotw then  2 else  1 end
    when 'LOSS' then case when p.is_loty then -7 when p.is_lotw then -2 else -1 end
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

-- ------------------------------------------------------------------
-- Re-grade any LOTY already graded at the old +/-3
-- ------------------------------------------------------------------

update public.picks
set points = case when points > 0 then 7 else -7 end
where is_loty
  and points is not null
  and points <> 0;

-- Any member whose LOTY just moved needs their pick_points re-summed. Restricted to weeks
-- holding a LOTY so this touches nothing else.
update public.weekly_scores ws
set pick_points = (
  select coalesce(sum(p.points), 0)
  from public.picks p
  where p.member_id = ws.member_id
    and p.week_id = ws.week_id
    and p.points is not null
)
where exists (
  select 1
  from public.picks p
  where p.member_id = ws.member_id
    and p.week_id = ws.week_id
    and p.is_loty
);
