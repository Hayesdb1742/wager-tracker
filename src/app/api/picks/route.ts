import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { game_id, picked_team } = body;

  if (!game_id || !["HOME", "AWAY"].includes(picked_team)) {
    return NextResponse.json({ error: "game_id and picked_team (HOME|AWAY) required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Server-side kickoff lock check
  const { data: game } = await admin
    .from("games")
    .select("kickoff_time, week_id, in_pool")
    .eq("id", game_id)
    .single();

  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (!game.in_pool) return NextResponse.json({ error: "Game not in pick pool" }, { status: 400 });
  if (new Date(game.kickoff_time) <= new Date()) {
    return NextResponse.json({ error: "pick_locked", message: "This game has already kicked off." }, { status: 409 });
  }

  const { data, error } = await admin
    .from("picks")
    .upsert(
      { member_id: user.id, game_id, week_id: game.week_id, picked_team },
      { onConflict: "member_id,game_id" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
