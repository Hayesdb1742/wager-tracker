import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lockLevel, lockUpgradeError, type LockLevel } from "@/lib/wagers";
import { memberLockContext } from "@/lib/locks";

// POST /api/picks/lock
// Body: { pick_id, level: "LOTW" | "LOTY" }
//
// Raises the lock on one of the member's own submitted picks. Replaces /api/picks/lotw,
// which moved the week's LOTW from game to game on request: a lock is now an upgrade of a
// pick that is already in, never a move off another game. The rules live in
// lockUpgradeError, so the pick screen greys out the same buttons for the same reasons.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { pick_id } = body;
  const level = body.level as LockLevel;

  if (!pick_id || (level !== "LOTW" && level !== "LOTY")) {
    return NextResponse.json({ error: "pick_id and level (LOTW|LOTY) required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: pick } = await admin
    .from("picks")
    .select("id, game_id, week_id, member_id, is_lotw, is_loty")
    .eq("id", pick_id)
    .maybeSingle();

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
      { error: "lock_locked", message: "That game has already kicked off." },
      { status: 409 }
    );
  }

  const { data: week } = await admin
    .from("weeks")
    .select("season_id, status")
    .eq("id", pick.week_id)
    .single();

  if (!week) return NextResponse.json({ error: "Week not found" }, { status: 404 });
  if (week.status !== "OPEN") {
    return NextResponse.json(
      { error: "week_closed", message: "This week is no longer open." },
      { status: 409 }
    );
  }

  const spent = await memberLockContext(admin, {
    memberId: user.id,
    weekId: pick.week_id,
    seasonId: week.season_id,
    excludePickId: pick.id,
  });

  const refusal = lockUpgradeError(level, { current: lockLevel(pick), ...spent });

  if (refusal) {
    return NextResponse.json({ error: "lock_unavailable", message: refusal }, { status: 409 });
  }

  // is_lotw goes true at both levels: a LOTY stands in place of the week's LOTW
  // (picks_loty_implies_lotw).
  const { error } = await admin
    .from("picks")
    .update({ is_lotw: true, is_loty: level === "LOTY" })
    .eq("id", pick.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, level });
}
