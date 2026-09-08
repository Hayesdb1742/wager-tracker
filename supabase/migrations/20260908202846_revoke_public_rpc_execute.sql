-- W2 / F1 (critical): the SECURITY DEFINER RPCs carried EXECUTE for anon and
-- authenticated. The publishable key ships to the browser, so anyone holding it
-- could POST /rest/v1/rpc/resolve_game with any game and any score and rewrite
-- results plus every member's weekly score. Every legitimate caller goes through
-- the service-role client:
--   api/admin/weeks/[id]/close/route.ts:38   close_week
--   api/admin/picks/override/route.ts:97     resolve_game
--   api/admin/games/[id]/route.ts:74         resolve_game
--   lib/sports/sync.ts:154                   resolve_game
-- Nothing legitimate depends on the anon/authenticated grants.

-- 2.3 + 2.2: re-declare the two callable RPCs with a service-role guard and a
-- pinned search_path. Both bodies already schema-qualify every identifier, so an
-- empty search_path is a no-op at runtime (pg_catalog stays implicitly first).
-- Bodies below are otherwise verbatim.

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
  -- Defence in depth, so a future stray grant cannot silently re-open the hole.
  -- auth.role() is null on a direct database connection (psql, migrations),
  -- which is already privileged; only an actual non-service JWT is rejected.
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
$function$;

create or replace function public.close_week(p_week_id integer)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_required_picks int;
  r record;
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'forbidden: close_week is service-role only';
  end if;

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
$function$;

-- 2.2 (cont.): the two remaining functions the linter flags. Neither is
-- SECURITY DEFINER, but a mutable search_path is still a hazard.
-- custom_access_token_hook reads public.profiles (already qualified);
-- grade_pick is pure and touches no tables.
alter function public.custom_access_token_hook(jsonb) set search_path = '';
alter function public.grade_pick(text, text, numeric, integer, integer) set search_path = '';

-- 2.1: drop the grants. CREATE OR REPLACE above preserved the existing ACLs,
-- so these revokes must come last.
revoke execute on function public.resolve_game(uuid, integer, integer) from anon, authenticated;
revoke execute on function public.close_week(integer)                  from anon, authenticated;
revoke execute on function public.handle_new_user()                    from anon, authenticated;
revoke execute on function public.rls_auto_enable()                    from anon, authenticated;
