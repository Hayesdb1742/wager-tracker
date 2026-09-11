// DEV ONLY — signs in any existing user without a password so an admin session
// can be bootstrapped locally (`make login EMAIL=...`). Refuses to run in
// production; the real sign-in path is email + password.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildActionUrl } from "@/lib/auth-links";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const email = request.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "?email= required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const token_hash = data.properties?.hashed_token;
  if (!token_hash) {
    return NextResponse.json({ error: "No hashed_token in response" }, { status: 500 });
  }

  return NextResponse.redirect(buildActionUrl(request, token_hash, "magiclink", "/picks"));
}
