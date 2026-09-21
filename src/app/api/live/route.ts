import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLiveBoard } from "@/lib/live";

// The picks screen's refresh endpoint for games in play. Any signed-in member may read
// it: everything it returns is a pick on a game already underway, which the leaderboard
// shows too.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const board = await getLiveBoard(createAdminClient());
  return NextResponse.json(board);
}
