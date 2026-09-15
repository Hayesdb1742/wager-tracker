import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminOrCron } from "@/lib/cron-auth";
import { syncOddsForSport } from "@/lib/odds/sync";
import { Sport } from "@/lib/sports/types";

// POST /api/admin/sync-odds
// Body: { sports?: ("CFB" | "NFL")[] }  -- default both
//
// Polls The Odds API for each sport and records every spread/total that changed
// since the last poll in game_lines, keyed to games.id. Each sport-call spends
// 2 credits of a 500/month quota, so the schedule lives in pg_cron
// (request_odds_sync) and this route is only hit by hand for a one-off refresh.
//
// Auth: admin session, or `Authorization: Bearer ${CRON_SECRET}` so pg_cron
// (via pg_net) can call it without a user session.
const ALL_SPORTS: Sport[] = ["CFB", "NFL"];

export async function POST(request: NextRequest) {
  if (!(await isAdminOrCron(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const requested: unknown = body.sports ?? ALL_SPORTS;
  if (
    !Array.isArray(requested) ||
    requested.length === 0 ||
    !requested.every((s) => ALL_SPORTS.includes(s as Sport))
  ) {
    return NextResponse.json({ error: "sports must be a non-empty array of CFB | NFL" }, { status: 400 });
  }
  const sports = [...new Set(requested as Sport[])];

  const admin = createAdminClient();
  const results: Partial<Record<Sport, unknown>> = {};
  let failed = false;

  for (const sport of sports) {
    try {
      results[sport] = await syncOddsForSport(admin, sport);
    } catch (err) {
      failed = true;
      results[sport] = { error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  return NextResponse.json({ success: !failed, results }, { status: failed ? 500 : 200 });
}
