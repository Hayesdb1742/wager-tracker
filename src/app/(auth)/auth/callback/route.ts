import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as "magiclink" | "email" | "recovery" | null;
  const error = searchParams.get("error");

  if (error || (!code && !token_hash)) {
    return NextResponse.redirect(`${origin}/login?expired=1`);
  }

  const response = NextResponse.redirect(`${origin}/picks`);

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

  let exchangeError: { message: string } | null = null;

  if (code) {
    // PKCE flow — browser-initiated signInWithOtp
    ({ error: exchangeError } = await supabase.auth.exchangeCodeForSession(code));
  } else if (token_hash && type) {
    // OTP verification — admin-generated or implicit flow links
    ({ error: exchangeError } = await supabase.auth.verifyOtp({ token_hash, type }));
  }

  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?expired=1`);
  }

  return response;
}
