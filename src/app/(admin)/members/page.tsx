import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MembersClient } from "./MembersClient";
import { redirect } from "next/navigation";

export default async function MembersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    redirect("/picks");
  }

  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name, role, is_active, created_at")
    .order("created_at", { ascending: true });

  return <MembersClient members={profiles ?? []} />;
}
