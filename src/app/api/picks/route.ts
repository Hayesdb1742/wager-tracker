import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateWager } from "@/lib/wagers";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { game_id, bet_type, selection, line, odds } = body;

  if (!game_id) {
    return NextResponse.json({ error: "game_id required" }, { status: 400 });
  }

  // Mirrors the CHECK constraints so a bad wager fails readably rather than as a
  // constraint violation. `line` has no default in the schema: an ML must send 0.
  const invalid = validateWager({ bet_type, selection, line, odds });
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
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

  // Submitting is final: a pick is locked in the moment it lands. It used to upsert, which
  // let a member keep editing a saved wager right up to kickoff -- the league wants the
  // number a member committed to, not the one they held when the whistle blew. Only
  // /api/picks/lock may touch a submitted pick afterwards, and only to raise its lock;
  // fixing a genuine mistake is a commissioner job through /api/admin/picks/override.
  const { data: existing } = await admin
    .from("picks")
    .select("id")
    .eq("member_id", user.id)
    .eq("game_id", game_id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        error: "pick_already_submitted",
        message: "This pick is locked in. Ask the commissioner if it needs changing.",
      },
      { status: 409 }
    );
  }

  const { data, error } = await admin
    .from("picks")
    .insert({
      member_id: user.id,
      game_id,
      week_id: game.week_id,
      bet_type,
      selection,
      line,
      odds: odds ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
