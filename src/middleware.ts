import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Unauthenticated users can only access auth routes
  if (
    !user &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/deactivated") &&
    !pathname.startsWith("/api/")
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Someone already signed in has no business on the login page -- this is
  // where a member ends up after a stray "expired link" redirect.
  if (user && pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/picks", request.url));
  }

  // Admin-only pages require the ADMIN role in JWT app_metadata. They live in the (admin)
  // route group, so they sit at the top level rather than under /admin. /api/admin/* is
  // deliberately not listed: those routes check the role themselves, and sync-results
  // also accepts a CRON_SECRET bearer from pg_cron with no session at all.
  const ADMIN_PATHS = ["/weeks", "/pick-grid", "/results", "/members"];
  if (ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const role = user?.app_metadata?.role;
    if (role !== "ADMIN") {
      return NextResponse.redirect(new URL("/picks", request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)",
  ],
};
