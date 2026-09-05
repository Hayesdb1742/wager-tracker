import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WeeksClient } from "./WeeksClient";
import { redirect } from "next/navigation";

export default async function WeeksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    redirect("/picks");
  }

  const admin = createAdminClient();

  const { data: seasons } = await admin
    .from("seasons")
    .select("id, name, year, is_active")
    .order("year", { ascending: false });

  // The flagged season, not a year match — two 2026 seasons exist (regular and
  // preseason), so year alone doesn't identify the live one.
  const currentSeason = seasons?.find((s) => s.is_active) ?? seasons?.[0];

  const { data: weeks } = await admin
    .from("weeks")
    .select("*")
    .eq("season_id", currentSeason?.id ?? 0)
    .order("week_number", { ascending: true });

  return (
    <WeeksClient
      seasons={seasons ?? []}
      currentSeason={currentSeason ?? null}
      weeks={weeks ?? []}
    />
  );
}
