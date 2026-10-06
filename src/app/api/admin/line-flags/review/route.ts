import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/admin/line-flags/review
// Body: { pick_id, status: "OPEN" | "DISMISSED" | "CONFIRMED", note? }
//
// An admin's ruling on a flag. review_pick_line_flag() is service-role only (W2/F1: nothing
// SECURITY DEFINER is reachable by `authenticated`), so the role check happens here and the
// RPC is called on the service-role client -- the same shape as /api/admin/picks/override.

const STATUSES = ["OPEN", "DISMISSED", "CONFIRMED"] as const;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { pick_id, status, note } = await request.json().catch(() => ({}));

  if (typeof pick_id !== "string") {
    return NextResponse.json({ error: "pick_id required" }, { status: 400 });
  }
  if (!STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be ${STATUSES.join(", ")}` },
      { status: 400 }
    );
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    return NextResponse.json({ error: "note must be a string" }, { status: 400 });
  }

  const admin = createAdminClient();

  // The RPC stamps reviewed_by from auth.uid(), which is null on the service-role client --
  // so the reviewer is written here instead, from the session that actually ruled.
  const { error } = await admin.rpc("review_pick_line_flag", {
    p_pick_id: pick_id,
    p_status: status,
    p_note: note ?? undefined,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: stampError } = await admin
    .from("pick_line_flags")
    .update({ reviewed_by: user.id })
    .eq("pick_id", pick_id);

  if (stampError) return NextResponse.json({ error: stampError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
