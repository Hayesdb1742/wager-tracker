import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const weekId = Number(id);
  if (isNaN(weekId)) return NextResponse.json({ error: "Invalid week id" }, { status: 400 });

  const admin = createAdminClient();

  const [scoresRes, gamesRes, picksRes] = await Promise.all([
    admin
      .from("weekly_scores")
      .select("member_id, pick_points, forfeit_penalty, lotw_penalty, total, profiles(display_name)")
      .eq("week_id", weekId)
      .order("total", { ascending: false }),
    admin
      .from("games")
      .select("id, sport, home_team, away_team, kickoff_time, status, winner, home_score, away_score")
      .eq("week_id", weekId)
      .eq("in_pool", true)
      .order("kickoff_time", { ascending: true }),
    admin
      .from("picks")
      .select("member_id, game_id, picked_team, is_lotw, points")
      .eq("week_id", weekId),
  ]);

  return NextResponse.json({
    scores: (scoresRes.data ?? []).map((s) => ({
      member_id: s.member_id,
      display_name: s.profiles?.display_name ?? "Unknown",
      pick_points: s.pick_points,
      forfeit_penalty: s.forfeit_penalty,
      lotw_penalty: s.lotw_penalty,
      total: s.total,
    })),
    games: gamesRes.data ?? [],
    picks: picksRes.data ?? [],
  });
}
