import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST   /api/admin/push/subscribe   Body: a serialised PushSubscription
// DELETE /api/admin/push/subscribe   Body: { endpoint }
//
// Where a browser registers for (and drops) admin alerts. Admin-only: these notifications
// carry other members' picks, so the subscription list is the same audience as the flags
// themselves.
//
// push_subscriptions has no write policy, so both paths go through the service-role client.

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const endpoint: unknown = body?.endpoint;
  const p256dh: unknown = body?.keys?.p256dh;
  const auth: unknown = body?.keys?.auth;

  if (
    typeof endpoint !== "string" ||
    typeof p256dh !== "string" ||
    typeof auth !== "string"
  ) {
    return NextResponse.json(
      { error: "endpoint and keys.p256dh / keys.auth are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // The endpoint is the primary key, so re-subscribing the same browser -- which happens
  // whenever the push service rotates it -- updates in place instead of stacking rows.
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      endpoint,
      member_id: user.id,
      p256dh,
      auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      last_error: null,
    },
    { onConflict: "endpoint" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const endpoint: unknown = body?.endpoint;

  if (typeof endpoint !== "string") {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Scoped to the caller: an admin unsubscribes their own browser, not somebody else's.
  const { error } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("member_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
