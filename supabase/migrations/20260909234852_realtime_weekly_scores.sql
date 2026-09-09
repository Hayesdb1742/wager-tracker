-- The leaderboard subscribes to weekly_scores changes for the open week
-- (LeaderboardClient.tsx), but `supabase_realtime` was published with no tables
-- at all, so Postgres emitted nothing and the channel subscribed and sat silent.
-- The live-updating leaderboard has therefore never worked on any deploy.

alter publication supabase_realtime add table public.weekly_scores;

-- The subscription filters on `week_id=eq.<open week>`, which is not part of the
-- primary key (that is the surrogate `id`). Under the default replica identity a
-- DELETE only carries the key columns, so `week_id` would be absent and realtime
-- would drop the event rather than match the filter. FULL logs the whole old row.
--
-- The cost is extra WAL per write, which is irrelevant here: weekly_scores holds
-- one row per member per week (9 members x ~19 weeks) and is written only by
-- close_week and resolve_game.
alter table public.weekly_scores replica identity full;
