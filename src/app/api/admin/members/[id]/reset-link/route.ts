import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildActionUrl } from "@/lib/auth-links";

// Mints a one-time link that signs the member in and drops them on the
// set-password screen. This is the only password-reset path -- the app sends
// no email, so the admin passes the link along by text.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  // auth-js throws (rather than returning an error) on a malformed id
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const admin = createAdminClient();

  const { data: target, error: lookupError } = await admin.auth.admin.getUserById(id);
  if (lookupError || !target.user?.email) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: target.user.email,
  });

  if (linkError || !link?.properties?.hashed_token) {
    return NextResponse.json(
      { error: linkError?.message ?? "Failed to create the reset link." },
      { status: 500 }
    );
  }

  const resetUrl = buildActionUrl(request, link.properties.hashed_token, "recovery", "/account?setup=1");
  return NextResponse.json({ resetUrl });
}
