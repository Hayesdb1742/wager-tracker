import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncResultsForWeek } from "@/lib/sports/sync";

// POST /api/admin/sync-results
// Body: { weekId } or { weekIds: number[] }
//
// Pulls final scores for games already in the week(s) and auto-resolves any
// the upstream reports as completed. Manually-resolved games are skipped.
//
// Auth: admin session, or `Authorization: Bearer ${CRON_SECRET}` so pg_cron
// (via pg_net) can call it without a user session.
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.app_metadata?.role === "ADMIN";
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const weekIds: number[] = body.weekIds ?? (body.weekId ? [body.weekId] : []);

  if (weekIds.length === 0) {
    return NextResponse.json({ error: "weekId or weekIds required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const results: Record<number, unknown> = {};
  let failed = false;

  for (const weekId of weekIds) {
    try {
      const summary = await syncResultsForWeek(admin, weekId);
      results[weekId] = summary;
      if (summary.errors.length > 0) failed = true;
    } catch (err) {
      failed = true;
      results[weekId] = { error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  return NextResponse.json({ success: !failed, results }, { status: failed ? 500 : 200 });
}
