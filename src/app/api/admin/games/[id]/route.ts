import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// PATCH /api/admin/games/[id]
// Handles: pool toggle, result entry, status changes (POSTPONED, CANCELLED)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const admin = createAdminClient();

  // --- Pool toggle ---
  if ("in_pool" in body) {
    const { in_pool, force } = body;

    if (!in_pool && !force) {
      // Count picks that would be orphaned
      const { count } = await admin
        .from("picks")
        .select("*", { count: "exact", head: true })
        .eq("game_id", id);

      if (count && count > 0) {
        return NextResponse.json(
          { error: "picks_exist", count },
          { status: 409 }
        );
      }
    }

    const { error } = await admin.from("games").update({ in_pool }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // --- Result entry / correction ---
  //
  // Scores, not a winner. Members hold their own spreads and totals, so "HOME won" is not
  // enough to grade a week — resolve_game derives games.winner from these for display.
  if ("home_score" in body || "away_score" in body) {
    const { home_score, away_score, force } = body;

    const scoresValid = [home_score, away_score].every(
      (s) => Number.isInteger(s) && s >= 0
    );
    if (!scoresValid) {
      return NextResponse.json(
        { error: "home_score and away_score must both be non-negative whole numbers" },
        { status: 400 }
      );
    }

    // Check if already FINAL — warn unless force
    const { data: game } = await admin
      .from("games")
      .select("status")
      .eq("id", id)
      .single();

    if (game?.status === "FINAL" && !force) {
      return NextResponse.json({ error: "already_final" }, { status: 409 });
    }

    const { error } = await admin.rpc("resolve_game", {
      p_game_id: id,
      p_home_score: home_score,
      p_away_score: away_score,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Manual result wins over API sync until the admin resets it
    const { error: flagError } = await admin
      .from("games")
      .update({ manual_resolved: true, resolution_mode: "MANUAL" })
      .eq("id", id);
    if (flagError) return NextResponse.json({ error: flagError.message }, { status: 500 });

    return NextResponse.json({ success: true });
  }

  // --- Reset to API control (re-enables results sync for this game) ---
  if ("manual_resolved" in body && body.manual_resolved === false) {
    const { error } = await admin
      .from("games")
      .update({ manual_resolved: false, resolution_mode: "API" })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // --- Status change (POSTPONED, CANCELLED) ---
  if ("status" in body) {
    const { status, new_kickoff_time } = body;

    if (!["POSTPONED", "CANCELLED", "SCHEDULED"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    if (status === "CANCELLED") {
      await admin.from("picks").update({ points: 0 }).eq("game_id", id);
    }

    const { error } = await admin
      .from("games")
      .update(status === "SCHEDULED" && new_kickoff_time
        ? { status, kickoff_time: new_kickoff_time }
        : { status }
      )
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "No valid update provided" }, { status: 400 });
}
