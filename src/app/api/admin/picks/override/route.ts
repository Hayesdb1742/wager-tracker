import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/admin/picks/override
// Body: { member_id, game_id, week_id, picked_team, force? }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id, game_id, week_id, picked_team, force } = await request.json();

  if (!["HOME", "AWAY"].includes(picked_team)) {
    return NextResponse.json({ error: "picked_team must be HOME or AWAY" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Check if game is FINAL — require force to override
  const { data: game } = await admin
    .from("games")
    .select("status, winner")
    .eq("id", game_id)
    .single();

  if (game?.status === "FINAL" && !force) {
    return NextResponse.json({ error: "game_final" }, { status: 409 });
  }

  // Look up existing pick
  const { data: existing } = await admin
    .from("picks")
    .select("id, picked_team")
    .eq("member_id", member_id)
    .eq("game_id", game_id)
    .maybeSingle();

  if (existing) {
    // Update existing pick
    const { error: updateErr } = await admin
      .from("picks")
      .update({
        picked_team,
        overridden_by: user.id,
        overridden_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Audit log
    await admin.from("pick_audit_log").insert({
      pick_id: existing.id,
      previous_team: existing.picked_team,
      new_team: picked_team,
      changed_by: user.id,
    });
  } else {
    // Insert new pick on behalf of member
    const { error: insertErr } = await admin
      .from("picks")
      .insert({
        member_id,
        game_id,
        week_id,
        picked_team,
        overridden_by: user.id,
        overridden_at: new Date().toISOString(),
      });

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Recalculate scores if game is already FINAL
  if (game?.status === "FINAL" && game.winner) {
    await admin.rpc("resolve_game", { p_game_id: game_id, p_winner: game.winner });
  }

  return NextResponse.json({ success: true });
}
