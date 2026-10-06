import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminOrCron } from "@/lib/cron-auth";
import { flagNotification, pushConfigured, sendToAll, type FlagNotice } from "@/lib/push";

// POST /api/admin/line-flags/notify
// Body: { pick_ids: uuid[] }  -- or {} to send every flag still waiting on a notification
//
// Called by the database (request_line_flag_push, via pg_net) the moment a flag is raised,
// and by hand from an admin session to retry or to test.
//
// Auth: admin session, or `Authorization: Bearer ${CRON_SECRET}` so pg_net can call it
// without a user session -- the same contract as /api/admin/sync-odds.

export async function POST(request: NextRequest) {
  if (!(await isAdminOrCron(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!pushConfigured()) {
    // Not an error worth failing the trigger over: the flag is recorded either way, and the
    // fix is an environment variable, not a retry.
    return NextResponse.json(
      { success: false, reason: "vapid_not_configured", sent: 0 },
      { status: 200 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const requested: unknown = body?.pick_ids;

  if (requested !== undefined && !Array.isArray(requested)) {
    return NextResponse.json({ error: "pick_ids must be an array" }, { status: 400 });
  }

  const admin = createAdminClient();

  let query = admin
    .from("pick_line_flags_detail")
    .select(
      "pick_id, member, week_number, matchup, bet_type, selection, pick_line, market_best_line, market_worst_line, deviation, verdict"
    );

  if (Array.isArray(requested) && requested.length > 0) {
    query = query.in("pick_id", requested as string[]);
  } else {
    // The catch-up path: anything raised that nobody was ever told about.
    query = query.is("notified_at", null).eq("status", "OPEN");
  }

  const { data: flags, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!flags?.length) return NextResponse.json({ success: true, sent: 0, flags: 0 });

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  let result;
  try {
    result = await sendToAll(admin, flagNotification(flags as FlagNotice[], baseUrl));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "push failed" },
      { status: 500 }
    );
  }

  // Only stamp when something actually landed. A flag nobody was told about stays in the
  // catch-up queue rather than being quietly marked done.
  if (result.sent > 0) {
    await admin
      .from("pick_line_flags")
      .update({ notified_at: new Date().toISOString() })
      .in(
        "pick_id",
        (flags as { pick_id: string }[]).map((f) => f.pick_id)
      );
  }

  return NextResponse.json({ success: true, flags: flags.length, ...result });
}
