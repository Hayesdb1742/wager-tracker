import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildActionUrl } from "@/lib/auth-links";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const email = (body.email ?? "").trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Reject if this email already has an active account
  const { data: existing } = await admin
    .from("profiles")
    .select("id, is_active")
    .in(
      "id",
      (
        await admin.auth.admin.listUsers()
      ).data.users
        .filter((u) => u.email === email)
        .map((u) => u.id)
    );

  if (existing && existing.length > 0 && existing[0].is_active) {
    return NextResponse.json(
      { error: "An active account already exists for this email." },
      { status: 409 }
    );
  }

  // Create the invite record
  const { data: invite, error: insertError } = await admin
    .from("invites")
    .insert({ email, invited_by: user.id })
    .select("token")
    .single();

  if (insertError || !invite) {
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }

  // Create the auth user (the profiles trigger fires) and mint a one-time
  // invite token. Nothing is emailed -- the admin hands the link to the
  // member directly, which is what lets the app run with no SMTP at all.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
  });

  if (linkError || !link?.properties?.hashed_token) {
    // Clean up the invite record if user creation failed
    await admin.from("invites").delete().eq("token", invite.token);
    return NextResponse.json(
      { error: linkError?.message ?? "Failed to create the invite link." },
      { status: 500 }
    );
  }

  // Mark invite as used immediately; Supabase owns the one-time token now
  await admin
    .from("invites")
    .update({ used_at: new Date().toISOString() })
    .eq("token", invite.token);

  const setupUrl = buildActionUrl(request, link.properties.hashed_token, "invite", "/onboarding");
  return NextResponse.json({ success: true, setupUrl });
}
