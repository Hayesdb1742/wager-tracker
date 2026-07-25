import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { force } = body;

  const admin = createAdminClient();

  // Check for unresolved games unless force=true
  if (!force) {
    const { data: unresolved } = await admin
      .from("games")
      .select("id, home_team, away_team")
      .eq("week_id", Number(id))
      .in("status", ["SCHEDULED", "LIVE"]);

    if (unresolved && unresolved.length > 0) {
      return NextResponse.json(
        { error: "unresolved_games", games: unresolved },
        { status: 409 }
      );
    }
  }

  const { error } = await admin.rpc("close_week", { p_week_id: Number(id) });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
