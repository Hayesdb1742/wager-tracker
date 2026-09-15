import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_TYPES: ReadonlySet<string> = new Set<EmailOtpType>([
  "recovery",
  "invite",
  "magiclink",
  "email",
]);

// Only ever redirect within this origin. A `next` like `//evil.com` would be
// treated as protocol-relative by the browser, so reject anything that isn't a
// plain absolute path.
function safeNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/picks";
}

// A bare GET never consumes the token: link previewers in chat apps fetch
// URLs, and that was burning one-time links before members tapped them.
// Bounce to the confirm page, whose Continue button POSTs back here.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const confirm = new URL("/auth/confirm", origin);
  searchParams.forEach((value, key) => confirm.searchParams.set(key, value));
  return NextResponse.redirect(confirm);
}

// Lands one-time links issued by the admin (setup, reset, invite). The app
// never sends email, so there is no PKCE `code` branch here -- every link
// carries a `token_hash` produced by `auth.admin.generateLink`.
export async function POST(request: NextRequest) {
  const { origin } = request.nextUrl;
  const form = await request.formData();
  const token_hash = form.get("token_hash");
  const type = form.get("type");
  const next = safeNext(typeof form.get("next") === "string" ? (form.get("next") as string) : null);

  if (
    typeof token_hash !== "string" ||
    typeof type !== "string" ||
    !ALLOWED_TYPES.has(type)
  ) {
    return NextResponse.redirect(`${origin}/login?expired=1`, 303);
  }

  // 303 so the browser follows a POST with a GET
  const response = NextResponse.redirect(`${origin}${next}`, 303);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({
    token_hash,
    type: type as EmailOtpType,
  });

  if (error) {
    // A double-tap on Continue sends two POSTs; the first one wins and sets
    // the session, the second sees a consumed token. If this browser already
    // holds a session for someone, send them on rather than to "expired".
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      return NextResponse.redirect(`${origin}${next}`, 303);
    }
    return NextResponse.redirect(`${origin}/login?expired=1`, 303);
  }

  return response;
}
