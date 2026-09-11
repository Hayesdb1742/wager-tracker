import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

// Builds the URL for a one-time link minted by `auth.admin.generateLink`.
// It points at our own /auth/callback, which verifies the token_hash and
// writes the session -- the Supabase-hosted verify page is never involved, so
// the link works on any origin (prod, preview, localhost) and in any browser.
export function buildActionUrl(
  request: NextRequest,
  hashedToken: string,
  type: EmailOtpType,
  next: string
): string {
  const url = new URL("/auth/callback", request.nextUrl.origin);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", type);
  url.searchParams.set("next", next);
  return url.toString();
}
