-- A single year can hold more than one competition: the 2026 regular-season
-- pool and the "2026 NFL Preseason" test run share year 2026. Widen the
-- uniqueness key from year to (year, name).
--
-- NOTE: this was applied to the remote project directly via MCP on 2026-07-25;
-- this file exists so repo and remote migration history agree. Guarded so it is
-- safe to re-run against an already-migrated database.

alter table public.seasons drop constraint if exists seasons_year_key;

alter table public.seasons
  add constraint seasons_year_name_key unique (year, name);
