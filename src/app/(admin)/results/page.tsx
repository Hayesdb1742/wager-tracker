import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ResultsClient } from "./ResultsClient";
import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<{ week?: string }>;
}

export default async function ResultsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "ADMIN") redirect("/picks");

  const { week: weekParam } = await searchParams;
  const admin = createAdminClient();

  const { data: weekRows } = await admin
    .from("weeks")
    .select("id, week_number, status, required_picks, season_id, seasons(year)")
    .order("season_id", { ascending: false })
    .order("week_number", { ascending: false });

  const weeks = (weekRows ?? []).map(({ seasons, ...w }) => ({
    ...w,
    season_year: seasons.year,
  }));

  const activeWeekId = weekParam
    ? Number(weekParam)
    : (weeks.find((w) => w.status === "OPEN") ?? weeks[0])?.id ?? null;

  const { data: games } = activeWeekId
    ? await admin
        .from("games")
        .select("*")
        .eq("week_id", activeWeekId)
        .order("kickoff_time", { ascending: true })
    : { data: [] };

  const currentWeek = weeks.find((w) => w.id === activeWeekId) ?? null;

  return (
    <ResultsClient
      weeks={weeks}
      currentWeek={currentWeek}
      games={games ?? []}
    />
  );
}
