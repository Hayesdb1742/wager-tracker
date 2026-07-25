// DEV ONLY — remove before deploying to production
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

  // Skip the Supabase-hosted verification page entirely — redirect straight to our callback
  const callbackUrl = new URL("/auth/callback", request.url);
  callbackUrl.searchParams.set("token_hash", token_hash);
  callbackUrl.searchParams.set("type", "magiclink");

  return NextResponse.redirect(callbackUrl);
}
