-- A pick becomes a wager: a bet type, a selection, a line, and an optional price.
--
-- The league bets moneylines, spreads and over/under totals -- 430 spreads, 89 totals and
-- 26 moneylines across the 648 rows of 2024 history -- but the app modelled only a bare
-- HOME/AWAY team choice scored straight up. See openspec/changes/wager-types/.
--
-- Members enter their own line, because the league bets across different books at different
-- times. Two members may hold different numbers on the same game and be graded differently
-- from the same final score. Lines are not sourced from a provider and are not verified.
--
-- Done now because picks, pick_audit_log and weekly_scores hold zero rows all-time. Every
-- column below is an ADD COLUMN today and a data migration once real wagers land.

-- ------------------------------------------------------------------
-- picks
-- ------------------------------------------------------------------

-- 'selection' because it is no longer always a team: a total selects OVER or UNDER.
alter table public.picks
  rename column picked_team to selection;

alter table public.picks
  drop constraint picks_picked_team_check;

-- No defaults, deliberately. Postgres only permits NOT NULL without a default on an empty
-- table, and the absence is the point: a caller that omits the bet type fails loudly rather
-- than silently recording a moneyline the member never placed. It also forces the API route
-- and the pick UI to ship in the same push as this migration.
alter table public.picks
  add column bet_type text not null,
  add column line     numeric(5,1) not null,
  add column odds     int null;

comment on column public.picks.selection is
  'HOME|AWAY for ML and SPREAD; OVER|UNDER for TOTAL.';
comment on column public.picks.bet_type is
  'ML = straight up (line is always 0), SPREAD = against the spread, TOTAL = over/under.';
comment on column public.picks.line is
  'Member-entered, stored from the perspective of the selected side: a team taken as a 3.5-point underdog is +3.5, as a 3.5-point favourite is -3.5. For TOTAL, the points number itself.';
comment on column public.picks.odds is
  'American odds as entered by the member. NULL = no price recorded. A future rule will reject anything shorter than -120; this migration only rejects impossible prices.';

alter table public.picks
  add constraint picks_bet_type_check
    check (bet_type in ('ML', 'SPREAD', 'TOTAL')),

  add constraint picks_selection_check
    check (selection in ('HOME', 'AWAY', 'OVER', 'UNDER')),

  -- A total cannot be taken on a team, and a spread cannot be taken on the over.
  add constraint picks_selection_matches_bet_type check (
    (bet_type in ('ML', 'SPREAD') and selection in ('HOME', 'AWAY'))
    or
    (bet_type = 'TOTAL' and selection in ('OVER', 'UNDER'))
  ),

  -- A moneyline is by definition a spread of zero; that is what makes one comparison grade
  -- all three bet types.
  add constraint picks_ml_line_zero
    check (bet_type <> 'ML' or line = 0),

  -- A spread may legitimately be 0 (a pick'em). A total may not.
  add constraint picks_total_line_positive
    check (bet_type <> 'TOTAL' or line > 0),

  -- No book prices a bet between -100 and +100. Deliberately permissive otherwise: the
  -- -120 rule is a later change.
  add constraint picks_odds_range
    check (odds is null or odds <= -100 or odds >= 100);

-- Grading now fans out per game, and the leaderboard reads per week. Neither had an index
-- (W5 in docs/database-remediation-backlog.md).
create index picks_game_id_idx on public.picks (game_id);
create index picks_week_id_idx on public.picks (week_id);

-- ------------------------------------------------------------------
-- pick_audit_log
-- ------------------------------------------------------------------
-- Its HOME/AWAY checks would reject every total, and a wager's line and price can change
-- without the selection moving at all -- an override from -3 to -7 is invisible in the old
-- shape.

alter table public.pick_audit_log
  rename column previous_team to previous_selection;
alter table public.pick_audit_log
  rename column new_team to new_selection;

alter table public.pick_audit_log
  drop constraint pick_audit_log_previous_team_check,
  drop constraint pick_audit_log_new_team_check;

alter table public.pick_audit_log
  add column previous_bet_type text not null,
  add column previous_line     numeric(5,1) not null,
  add column previous_odds     int null,
  add column new_bet_type      text not null,
  add column new_line          numeric(5,1) not null,
  add column new_odds          int null;

alter table public.pick_audit_log
  add constraint pick_audit_log_previous_selection_check
    check (previous_selection in ('HOME', 'AWAY', 'OVER', 'UNDER')),
  add constraint pick_audit_log_new_selection_check
    check (new_selection in ('HOME', 'AWAY', 'OVER', 'UNDER')),
  add constraint pick_audit_log_previous_bet_type_check
    check (previous_bet_type in ('ML', 'SPREAD', 'TOTAL')),
  add constraint pick_audit_log_new_bet_type_check
    check (new_bet_type in ('ML', 'SPREAD', 'TOTAL'));

-- ------------------------------------------------------------------
-- grade_pick
-- ------------------------------------------------------------------
-- The whole scoring model in one function. Because the line is stored from the selected
-- side's perspective, ML and SPREAD share a single comparison and ML needs no branch of its
-- own -- it is simply a spread of zero.
--
-- Returns NULL when either score is missing, so an unresolved game leaves picks.points NULL.

create or replace function public.grade_pick(
  p_bet_type   text,
  p_selection  text,
  p_line       numeric,
  p_home_score int,
  p_away_score int
)
returns text  -- 'WIN' | 'LOSS' | 'PUSH' | NULL
language sql
immutable
as $$
  select case
    when p_home_score is null or p_away_score is null then null

    when p_bet_type = 'TOTAL' then
      case
        when (p_home_score + p_away_score) > p_line
          then case when p_selection = 'OVER'  then 'WIN' else 'LOSS' end
        when (p_home_score + p_away_score) < p_line
          then case when p_selection = 'UNDER' then 'WIN' else 'LOSS' end
        else 'PUSH'
      end

    else
      -- ML and SPREAD: the selected side's score plus its line against the other side.
      case
        when (case when p_selection = 'HOME' then p_home_score else p_away_score end) + p_line
           > (case when p_selection = 'HOME' then p_away_score else p_home_score end)
          then 'WIN'
        when (case when p_selection = 'HOME' then p_home_score else p_away_score end) + p_line
           < (case when p_selection = 'HOME' then p_away_score else p_home_score end)
          then 'LOSS'
        else 'PUSH'
      end
  end;
$$;

comment on function public.grade_pick(text, text, numeric, int, int) is
  'Grades one wager against a final score as WIN/LOSS/PUSH, using the line stored on the pick. NULL if the game has no score yet.';

-- ------------------------------------------------------------------
-- resolve_game
-- ------------------------------------------------------------------
-- Now score-driven. A spread or a total cannot be graded from "HOME won", so the winner
-- alone is no longer sufficient input. games.winner is still derived and stored, but only
-- for display.
--
-- The signature changes, so the old function must be dropped rather than replaced. Its
-- grants go with it and are restored verbatim at the bottom -- resolve_game is SECURITY
-- DEFINER and executable by anon (F1). That is accepted risk, out of scope here, and must
-- not silently change in either direction.

drop function if exists public.resolve_game(uuid, text);

create or replace function public.resolve_game(
  p_game_id    uuid,
  p_home_score int,
  p_away_score int
)
returns void
language plpgsql
security definer
as $$
begin
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

  -- Grade every wager on this game against its own line.
  update public.picks p
  set points = case public.grade_pick(p.bet_type, p.selection, p.line,
                                      g.home_score, g.away_score)
    when 'WIN'  then case when p.is_lotw then  2 else  1 end
    when 'LOSS' then case when p.is_lotw then -2 else -1 end
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
$$;

comment on function public.resolve_game(uuid, int, int) is
  'Records a final score, derives games.winner for display, and grades every wager on the game against its own line.';

-- Restore the grants the dropped function held. PUBLIC receives EXECUTE by default on
-- creation; the three roles below were explicit and are re-granted to match exactly.
grant execute on function public.resolve_game(uuid, int, int) to anon;
grant execute on function public.resolve_game(uuid, int, int) to authenticated;
grant execute on function public.resolve_game(uuid, int, int) to service_role;
