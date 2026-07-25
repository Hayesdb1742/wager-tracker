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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 flex items-center justify-between">
          <div className="flex gap-1">
            <Link href="/picks" className="px-3 py-3 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50">
              Picks
            </Link>
            <Link href="/leaderboard" className="px-3 py-3 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50">
              Leaderboard
            </Link>
            <Link href="/analytics" className="px-3 py-3 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50">
              Analytics
            </Link>
            <Link href={`/stats/${user.id}`} className="px-3 py-3 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50">
              My Stats
            </Link>
            {isAdmin && (
              <Link href="/weeks" className="px-3 py-3 text-sm font-medium text-blue-700 hover:text-blue-900 hover:bg-blue-50">
                Admin
              </Link>
            )}
          </div>
          <div className="text-sm text-gray-500">{profile?.display_name}</div>
        </div>
      </nav>
      <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
