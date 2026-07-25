import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { pick_id, week_id } = body;

  if (!pick_id || !week_id) {
    return NextResponse.json({ error: "pick_id and week_id required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify the pick belongs to this member and the game hasn't kicked off
  const { data: pick } = await admin
    .from("picks")
    .select("id, game_id, member_id")
    .eq("id", pick_id)
    .single();

  if (!pick || pick.member_id !== user.id) {
    return NextResponse.json({ error: "Pick not found" }, { status: 404 });
  }

  const { data: game } = await admin
    .from("games")
    .select("kickoff_time")
    .eq("id", pick.game_id)
    .single();

  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (new Date(game.kickoff_time) <= new Date()) {
    return NextResponse.json(
      { error: "lotw_locked", message: "Cannot set LOTW on a game that has already kicked off." },
      { status: 409 }
    );
  }

  // Clear previous LOTW and set new one atomically
  await admin
    .from("picks")
    .update({ is_lotw: false })
    .eq("member_id", user.id)
    .eq("week_id", week_id)
    .eq("is_lotw", true);

  const { error } = await admin
    .from("picks")
    .update({ is_lotw: true })
    .eq("id", pick_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
