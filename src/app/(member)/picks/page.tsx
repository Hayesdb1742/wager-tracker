import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSeasonId } from "@/lib/seasons";
import { PicksClient } from "./PicksClient";
import { redirect } from "next/navigation";

export default async function PicksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Find the current open week within the active season
  const seasonId = await getActiveSeasonId(admin);

  const { data: week } = seasonId
    ? await admin
        .from("weeks")
        .select("*")
        .eq("season_id", seasonId)
        .eq("status", "OPEN")
        .order("week_number", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  if (!week) {
    return (
      <div className="text-center py-16">
        <h1 className="text-xl font-semibold mb-2">No active week</h1>
        <p className="text-gray-500 text-sm">Picks aren&apos;t open yet. Check back soon.</p>
      </div>
    );
  }

  // Load in-pool games for the week
  const { data: games } = await admin
    .from("games")
    .select("*")
    .eq("week_id", week.id)
    .eq("in_pool", true)
    .order("kickoff_time", { ascending: true });

  // Load this member's existing picks for the week
  const { data: existingPicks } = await admin
    .from("picks")
    .select("*")
    .eq("member_id", user.id)
    .eq("week_id", week.id);

  const pickMap: Record<string, { id: string; picked_team: string; is_lotw: boolean; overridden_by: string | null; overridden_at: string | null }> = {};
  for (const p of existingPicks ?? []) {
    pickMap[p.game_id] = { id: p.id, picked_team: p.picked_team, is_lotw: p.is_lotw, overridden_by: p.overridden_by, overridden_at: p.overridden_at };
  }

  return (
    <PicksClient
      week={week}
      games={games ?? []}
      initialPickMap={pickMap}
      memberId={user.id}
    />
  );
}
