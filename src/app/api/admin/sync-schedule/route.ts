import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCfbWeek, fetchNflWeek } from "@/lib/sports/providers";
import { upsertScheduleGames } from "@/lib/sports/sync";

// POST /api/admin/sync-schedule
// Body: { weekId, sport, cfbWeek?, nflWeek?, year?, before?, after? }
//
// `before`/`after` (ISO timestamps) filter fetched games by kickoff. Needed
// because upstream APIs fold CFB "week 0" into week 1 — syncing pool week 0
// uses { cfbWeek: 1, before: <sep 1> } and pool week 1 uses { after: <sep 1> }.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { weekId, sport, cfbWeek, nflWeek, year, before, after } = body;

  if (!weekId || !sport) {
    return NextResponse.json({ error: "weekId and sport required" }, { status: 400 });
  }
  if (sport !== "CFB" && sport !== "NFL") {
    return NextResponse.json({ error: "sport must be CFB or NFL" }, { status: 400 });
  }

  const syncYear = year ?? new Date().getFullYear();

  try {
    let games =
      sport === "CFB"
        ? await fetchCfbWeek(syncYear, cfbWeek ?? 1)
        : await fetchNflWeek(syncYear, nflWeek ?? 1);

    if (before) games = games.filter((g) => g.kickoff_time < before);
    if (after) games = games.filter((g) => g.kickoff_time >= after);

    if (games.length === 0) {
      return NextResponse.json({ success: true, sport, upserted: 0, message: "No games found from API" });
    }

    const admin = createAdminClient();
    const result = await upsertScheduleGames(admin, weekId, sport, games);

    return NextResponse.json({ success: true, sport, ...result });
  } catch (err) {
    return NextResponse.json(
      { success: false, sport, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
