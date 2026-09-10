import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_active, display_name, role")
    .eq("id", user.id)
    .single();

  if (profile && !profile.is_active) {
    redirect("/deactivated");
  }

  const isAdmin = profile?.role === "ADMIN";

  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="bg-slate-900 border-b border-slate-700 shadow-lg shadow-black/40">
        <div className="max-w-4xl mx-auto px-4 flex items-center justify-between">
          <div className="flex gap-1">
            <Link href="/picks" className="px-3 py-3 text-sm font-medium text-slate-200 hover:text-white hover:bg-slate-800">
              Picks
            </Link>
            <Link href="/leaderboard" className="px-3 py-3 text-sm font-medium text-slate-200 hover:text-white hover:bg-slate-800">
              Leaderboard
            </Link>
            <Link href="/analytics" className="px-3 py-3 text-sm font-medium text-slate-200 hover:text-white hover:bg-slate-800">
              Analytics
            </Link>
            <Link href={`/stats/${user.id}`} className="px-3 py-3 text-sm font-medium text-slate-200 hover:text-white hover:bg-slate-800">
              My Stats
            </Link>
            {isAdmin && (
              <Link href="/weeks" className="px-3 py-3 text-sm font-medium text-sky-300 hover:text-sky-200 hover:bg-sky-500/20">
                Admin
              </Link>
            )}
          </div>
          <div className="text-sm text-slate-300">{profile?.display_name}</div>
        </div>
      </nav>
      <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
