-- A calendar year can host more than one competition: the 2026 regular-season
-- pool and the 2026 NFL preseason test run both live in year 2026. The old
-- UNIQUE (year) constraint allowed only one, so widen it to UNIQUE (year, name).
--
-- Callers that look a season up by year alone must now also match on name --
-- see scripts/gather-2026-schedules.ts, which would otherwise start failing
-- once a second 2026 row exists.

alter table public.seasons
  drop constraint seasons_year_key;

alter table public.seasons
  add constraint seasons_year_name_key unique (year, name);
