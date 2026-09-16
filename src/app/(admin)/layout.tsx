import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AdminNav } from "./AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Every page under (admin) is admin-only. The pages check again themselves, but the
  // layout is the one place a new admin page can't forget.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "ADMIN") redirect("/picks");

  return (
    <div className="min-h-screen bg-slate-950">
      <AdminNav />
      <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
