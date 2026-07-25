-- Game scores + API sync metadata (sports-api-results plan, Step 1 + Step 5)
-- home_score/away_score: final scores from the sports APIs (FINAL games only)
-- last_synced_at: when a sync endpoint last touched this row
-- manual_resolved: admin manually entered the result; sync must not overwrite

alter table public.games
  add column if not exists home_score int null,
  add column if not exists away_score int null,
  add column if not exists last_synced_at timestamptz null,
  add column if not exists manual_resolved boolean not null default false;
