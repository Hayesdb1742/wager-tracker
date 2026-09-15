-- Give the teams dimension a conference so analytics can roll picks up by league.
--
-- teams was created as the reconciliation target for the 2024 sheet and never
-- populated. It becomes the lookup for "which conference is this team in":
-- games only carry names, and neither upstream provider puts a conference on a
-- game row (cfbd does, ESPN does not), so the name is the join key.
--
-- Populated by scripts/seed-teams.ts, which reads cfbd /teams/fbs and ESPN's
-- NFL groups. A team the script has not seen simply has no conference and the
-- analytics page files it under "Other".

alter table public.teams
  add column conference text null,
  add column division   text null;

comment on column public.teams.conference is
  'League grouping: an FBS conference ("SEC") or AFC/NFC. Null when unknown.';
comment on column public.teams.division is
  'Sub-grouping where one exists: "AFC East"; cfbd divisions for split conferences.';

-- Names are matched exactly against games.home_team / away_team, which are
-- unique per sport, not globally -- swap the global unique for (sport, name).
alter table public.teams drop constraint teams_name_key;
alter table public.teams add constraint teams_sport_name_key unique (sport, name);
