import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WeeksClient } from "./WeeksClient";
import { redirect } from "next/navigation";

export default async function WeeksPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "ADMIN") {
    redirect("/picks");
  }

  const admin = createAdminClient();

  const { data: seasons } = await admin
    .from("seasons")
    .select("id, name, year")
    .order("year", { ascending: false })
    .order("name", { ascending: true });

  // More than one season can share a year (the regular-season pool and the NFL
  // preseason are both 2026), so year alone no longer identifies a season.
  // Priority: explicit ?season= -> whichever season owns the OPEN week ->
  // current year -> newest. Without the OPEN-week step a week in a second
  // same-year season would be unreachable from this page.
  const { season: seasonParam } = await searchParams;

  const { data: openWeek } = await admin
    .from("weeks")
    .select("season_id")
    .eq("status", "OPEN")
    .order("week_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const requestedId = Number(seasonParam);
  const currentYear = new Date().getFullYear();
  const currentSeason =
    seasons?.find((s) => s.id === requestedId) ??
    seasons?.find((s) => s.id === openWeek?.season_id) ??
    seasons?.find((s) => s.year === currentYear) ??
    seasons?.[0];

  const { data: weeks } = await admin
    .from("weeks")
    .select("*")
    .eq("season_id", currentSeason?.id ?? 0)
    .order("week_number", { ascending: true });

  return (
    // Keyed by season so switching remounts the client component -- it seeds
    // its week list into useState, which would otherwise keep the old season's
    // weeks when only the props change.
    <WeeksClient
      key={currentSeason?.id ?? "none"}
      seasons={seasons ?? []}
      currentSeason={currentSeason ?? null}
      weeks={weeks ?? []}
    />
  );
}
