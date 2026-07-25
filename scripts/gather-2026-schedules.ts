// One-shot season bootstrap: creates the 2026 season + pool weeks 0-18 and
// pulls scheduled games from the sports APIs (CFB weeks 0-12, NFL weeks 1-17).
//
// Pool week layout (calendar-aligned — CFB week N and NFL week N-1 share a
// weekend): week 0 = CFB week 0 only, week 1 = CFB week 1 only,
// weeks 2-12 = CFB N + NFL N-1, weeks 13-18 = NFL 12-17.
//
// Upstream APIs have no "week 0" — CFB week-zero games arrive under week 1
// and are split out by kickoff date (before Sep 1).
//
// Run: npx tsx scripts/gather-2026-schedules.ts

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { fetchCfbWeek, fetchNflWeek } from "../src/lib/sports/providers";
import { upsertScheduleGames } from "../src/lib/sports/sync";

const YEAR = 2026;
// A year can hold several competitions (the regular-season pool and the NFL
// preseason test run are both 2026), so the season is keyed by year *and*
// name -- matching the UNIQUE (year, name) constraint on public.seasons.
const SEASON_NAME = `${YEAR} Season`;
const CFB_WEEK0_CUTOFF = "2026-09-01";
const LAST_CFB_WEEK = 12;
const LAST_POOL_WEEK = 18; // NFL week 17
const REQUIRED_PICKS = 5;

function loadEnv() {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function main() {
  loadEnv();
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // --- Season ---
  let { data: season } = await admin
    .from("seasons")
    .select("id, name")
    .eq("year", YEAR)
    .eq("name", SEASON_NAME)
    .maybeSingle();
  if (!season) {
    const { data, error } = await admin
      .from("seasons")
      .insert({ year: YEAR, name: SEASON_NAME })
      .select("id, name")
      .single();
    if (error) throw new Error(`season insert: ${error.message}`);
    season = data;
  }
  console.log(`Season: ${season.name} (id ${season.id})`);

  // --- Weeks 0-18, created CLOSED so the current open test week keeps
  // driving the picks page; admin opens each week when the season starts ---
  const weekIds = new Map<number, number>();
  for (let n = 0; n <= LAST_POOL_WEEK; n++) {
    const { data: existing } = await admin
      .from("weeks")
      .select("id")
      .eq("season_id", season.id)
      .eq("week_number", n)
      .maybeSingle();
    if (existing) {
      weekIds.set(n, existing.id);
      continue;
    }
    // Placeholder window; tightened from real kickoffs after games sync
    const anchor = new Date(Date.UTC(2026, 7, 29) + n * 7 * 86400_000);
    const { data, error } = await admin
      .from("weeks")
      .insert({
        season_id: season.id,
        week_number: n,
        status: "CLOSED",
        required_picks: REQUIRED_PICKS,
        opens_at: new Date(anchor.getTime() - 4 * 86400_000).toISOString(),
        closes_at: new Date(anchor.getTime() + 3 * 86400_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(`week ${n} insert: ${error.message}`);
    weekIds.set(n, data.id);
  }
  console.log(`Weeks ready: 0-${LAST_POOL_WEEK} (ids ${weekIds.get(0)}-${weekIds.get(LAST_POOL_WEEK)})`);

  // --- CFB weeks 0-12 ---
  for (let cfbWeek = 0; cfbWeek <= LAST_CFB_WEEK; cfbWeek++) {
    const upstreamWeek = Math.max(cfbWeek, 1);
    let games = await fetchCfbWeek(YEAR, upstreamWeek);
    if (cfbWeek === 0) games = games.filter((g) => g.kickoff_time < CFB_WEEK0_CUTOFF);
    if (cfbWeek === 1) games = games.filter((g) => g.kickoff_time >= CFB_WEEK0_CUTOFF);
    const result = await upsertScheduleGames(admin, weekIds.get(cfbWeek)!, "CFB", games);
    console.log(`CFB week ${cfbWeek} → pool week ${cfbWeek}: ${result.upserted} games`);
  }

  // --- NFL weeks 1-17 → pool weeks 2-18 ---
  for (let nflWeek = 1; nflWeek <= 17; nflWeek++) {
    const poolWeek = nflWeek + 1;
    const games = await fetchNflWeek(YEAR, nflWeek);
    const result = await upsertScheduleGames(admin, weekIds.get(poolWeek)!, "NFL", games);
    console.log(`NFL week ${nflWeek} → pool week ${poolWeek}: ${result.upserted} games`);
  }

  // --- Tighten week windows to actual kickoffs ---
  for (const [n, weekId] of weekIds) {
    const { data: range } = await admin
      .from("games")
      .select("kickoff_time")
      .eq("week_id", weekId)
      .order("kickoff_time");
    if (!range || range.length === 0) continue;
    const first = new Date(range[0].kickoff_time);
    const last = new Date(range[range.length - 1].kickoff_time);
    await admin
      .from("weeks")
      .update({
        opens_at: new Date(first.getTime() - 5 * 86400_000).toISOString(),
        closes_at: new Date(last.getTime() + 6 * 3600_000).toISOString(),
      })
      .eq("id", weekId);
    console.log(
      `pool week ${n}: ${range.length} games, ${first.toISOString().slice(0, 10)} → ${last.toISOString().slice(0, 10)}`
    );
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
