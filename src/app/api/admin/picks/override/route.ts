import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateWager } from "@/lib/wagers";

// POST /api/admin/picks/override
// Body: { member_id, game_id, week_id, bet_type, selection, line, odds?, force? }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id, game_id, week_id, bet_type, selection, line, odds, force } =
    await request.json();

  const invalid = validateWager({ bet_type, selection, line, odds });
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const admin = createAdminClient();

  // Check if game is FINAL — require force to override
  const { data: game } = await admin
    .from("games")
    .select("status, home_score, away_score")
    .eq("id", game_id)
    .single();

  if (game?.status === "FINAL" && !force) {
    return NextResponse.json({ error: "game_final" }, { status: 409 });
  }

  // Look up existing pick
  const { data: existing } = await admin
    .from("picks")
    .select("id, bet_type, selection, line, odds")
    .eq("member_id", member_id)
    .eq("game_id", game_id)
    .maybeSingle();

  if (existing) {
    // Update existing pick
    const { error: updateErr } = await admin
      .from("picks")
      .update({
        bet_type,
        selection,
        line,
        odds: odds ?? null,
        overridden_by: user.id,
        overridden_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Audit log — the whole wager, since a line or price can change without the
    // selection moving at all.
    await admin.from("pick_audit_log").insert({
      pick_id: existing.id,
      previous_bet_type: existing.bet_type,
      previous_selection: existing.selection,
      previous_line: existing.line,
      previous_odds: existing.odds,
      new_bet_type: bet_type,
      new_selection: selection,
      new_line: line,
      new_odds: odds ?? null,
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
        bet_type,
        selection,
        line,
        odds: odds ?? null,
        overridden_by: user.id,
        overridden_at: new Date().toISOString(),
      });

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Re-grade if the game is already FINAL. Only this member's wager can have changed, but
  // resolve_game re-grades the whole game, which is correct and idempotent.
  if (game?.status === "FINAL" && game.home_score !== null && game.away_score !== null) {
    await admin.rpc("resolve_game", {
      p_game_id: game_id,
      p_home_score: game.home_score,
      p_away_score: game.away_score,
    });
  }

  return NextResponse.json({ success: true });
}
