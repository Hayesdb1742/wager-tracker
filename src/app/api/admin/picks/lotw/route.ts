import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/admin/picks/lotw
// Body: { member_id, pick_id, week_id }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id, pick_id, week_id } = await request.json();
  const admin = createAdminClient();

  // Reject if week is CLOSED
  const { data: week } = await admin
    .from("weeks")
    .select("status")
    .eq("id", week_id)
    .single();

  if (week?.status === "CLOSED") {
    return NextResponse.json({ error: "week_closed" }, { status: 409 });
  }

  // Atomically clear previous LOTW and set new one
  await admin
    .from("picks")
    .update({ is_lotw: false })
    .eq("member_id", member_id)
    .eq("week_id", week_id)
    .eq("is_lotw", true);

  const { error } = await admin
    .from("picks")
    .update({ is_lotw: true })
    .eq("id", pick_id)
    .eq("member_id", member_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
