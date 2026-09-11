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

// Lands one-time links issued by the admin (setup, reset, invite). The app
// never sends email, so there is no PKCE `code` branch here -- every link
// carries a `token_hash` produced by `auth.admin.generateLink`.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"));

  if (!token_hash || !type || !ALLOWED_TYPES.has(type)) {
    return NextResponse.redirect(`${origin}/login?expired=1`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);

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
    return NextResponse.redirect(`${origin}/login?expired=1`);
  }

  return response;
}
