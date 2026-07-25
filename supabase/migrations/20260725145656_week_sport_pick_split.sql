-- Split a week's required pick count into its CFB and NFL components.
--
-- required_picks stays the authoritative total so existing scoring
-- (public.close_week forfeit math) and existing writers keep working.
-- The two new columns are nullable: NULL means "the per-sport split is
-- not specified for this week", which is the case for the 2024/2025
-- seasons and for the playoff weeks whose split has not been decided.

alter table public.weeks
  add column required_cfb_picks int null,
  add column required_nfl_picks int null;

comment on column public.weeks.required_cfb_picks is
  'Required college football picks for the week. NULL = split not specified; use required_picks as an untyped total.';
comment on column public.weeks.required_nfl_picks is
  'Required NFL picks for the week. NULL = split not specified; use required_picks as an untyped total.';

-- Non-negative counts (NULL passes, which is intended).
alter table public.weeks
  add constraint weeks_required_cfb_picks_nonneg check (required_cfb_picks >= 0),
  add constraint weeks_required_nfl_picks_nonneg check (required_nfl_picks >= 0);

-- When both halves of the split are given they must reconcile to the total.
-- A partially specified split is rejected so a week cannot claim, say, 5 CFB
-- picks out of a 9-pick week while leaving the NFL side undefined.
alter table public.weeks
  add constraint weeks_pick_split_matches_total check (
    (required_cfb_picks is null and required_nfl_picks is null)
    or (
      required_cfb_picks is not null
      and required_nfl_picks is not null
      and required_cfb_picks + required_nfl_picks = required_picks
    )
  );

-- ------------------------------------------------------------------
-- Backfill the 2026 season from the published schedule.
-- Pool week N = CFB week N + NFL week N-1, which is why week 1 is
-- college-only. Weeks left untouched are called out in the notes below.
-- ------------------------------------------------------------------
do $$
declare
  v_season_id int;
begin
  select id into v_season_id from public.seasons where year = 2026;
  if v_season_id is null then
    raise notice 'no 2026 season found, skipping backfill';
    return;
  end if;

  -- week 1: college only (no NFL week 0 to pair with)
  update public.weeks set required_picks = 5, required_cfb_picks = 5, required_nfl_picks = 0
    where season_id = v_season_id and week_number = 1;

  -- weeks 2-13: full 5 CFB + 4 NFL slate
  update public.weeks set required_picks = 9, required_cfb_picks = 5, required_nfl_picks = 4
    where season_id = v_season_id and week_number between 2 and 13;

  -- week 14: college slate thins out as the regular season ends
  update public.weeks set required_picks = 7, required_cfb_picks = 3, required_nfl_picks = 4
    where season_id = v_season_id and week_number = 14;

  -- week 15: total is known but the CFB/NFL split is not; leave it unspecified
  update public.weeks set required_picks = 5
    where season_id = v_season_id and week_number = 15;

  -- weeks 16-18: bowl season alongside the NFL run-in
  update public.weeks set required_picks = 7, required_cfb_picks = 3, required_nfl_picks = 4
    where season_id = v_season_id and week_number = 16;
  update public.weeks set required_picks = 8, required_cfb_picks = 4, required_nfl_picks = 4
    where season_id = v_season_id and week_number = 17;
  update public.weeks set required_picks = 8, required_cfb_picks = 4, required_nfl_picks = 4
    where season_id = v_season_id and week_number = 18;
end $$;
