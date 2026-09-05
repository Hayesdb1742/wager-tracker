-- Mark exactly one season as the live one.
--
-- Pages previously resolved "the current season" by matching seasons.year
-- against the calendar year, which stopped being unique once the preseason was
-- added (2026 Season and 2026 NFL Preseason share year 2026). Callers that only
-- looked for the highest-numbered OPEN week could therefore be served a week
-- from a stale season.

alter table public.seasons
  add column is_active boolean not null default false;

comment on column public.seasons.is_active is
  'The one season the member-facing pages read. At most one row may be true.';

-- Partial unique index: any number of inactive seasons, at most one active.
create unique index seasons_one_active_idx
  on public.seasons ((true))
  where is_active;
