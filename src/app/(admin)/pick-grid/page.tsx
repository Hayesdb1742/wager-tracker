import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSeasonId } from "@/lib/seasons";
import { PicksAdminClient } from "./PicksAdminClient";

export default async function AdminPicksPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await searchParams;
  const admin = createAdminClient();

  // Weeks of the active season, for the selector
  const seasonId = await getActiveSeasonId(admin);

  const { data: weeks } = seasonId
    ? await admin
        .from("weeks")
        .select("id, week_number, status, required_picks")
        .eq("season_id", seasonId)
        .order("week_number", { ascending: true })
    : { data: [] };

  // Default: open week, then most recent closed
  const defaultWeek =
    weeks?.find((w) => w.status === "OPEN") ??
    [...(weeks ?? [])].reverse().find((w) => w.status === "CLOSED");

  const selectedWeekId = weekParam ? Number(weekParam) : (defaultWeek?.id ?? null);
  const selectedWeek = weeks?.find((w) => w.id === selectedWeekId) ?? defaultWeek;

  // Games for selected week
  const { data: games } = selectedWeekId
    ? await admin
        .from("games")
        .select("id, sport, home_team, away_team, kickoff_time, status, winner, in_pool")
        .eq("week_id", selectedWeekId)
        .eq("in_pool", true)
        .order("kickoff_time", { ascending: true })
    : { data: [] };

  // All active members
  const { data: members } = await admin
    .from("profiles")
    .select("id, display_name")
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  // All picks for selected week (admin bypasses RLS)
  const { data: picks } = selectedWeekId
    ? await admin
        .from("picks")
        .select("id, member_id, game_id, bet_type, selection, line, odds, is_lotw, is_loty, points, overridden_by, overridden_at")
        .eq("week_id", selectedWeekId)
    : { data: [] };

  // Audit log for selected week (join picks to get week filter)
  const pickIds = (picks ?? []).map((p) => p.id);
  const { data: auditLog } =
    pickIds.length > 0
      ? await admin
          .from("pick_audit_log")
          .select("id, pick_id, previous_bet_type, previous_selection, previous_line, new_bet_type, new_selection, new_line, changed_by, changed_at, profiles!changed_by(display_name)")
          .in("pick_id", pickIds)
          .order("changed_at", { ascending: false })
          .limit(50)
      : { data: [] };

  // Build pick lookup: member_id → game_id → pick
  type PickRow = {
    id: string;
    member_id: string;
    game_id: string;
    bet_type: string;
    selection: string;
    line: number;
    odds: number | null;
    is_lotw: boolean;
    is_loty: boolean;
    points: number | null;
    overridden_by: string | null;
    overridden_at: string | null;
  };
  const pickMap: Record<string, Record<string, PickRow>> = {};
  for (const p of picks ?? []) {
    if (!pickMap[p.member_id]) pickMap[p.member_id] = {};
    pickMap[p.member_id][p.game_id] = p;
  }

  return (
    <PicksAdminClient
      weeks={weeks ?? []}
      selectedWeek={selectedWeek ?? null}
      games={games ?? []}
      members={members ?? []}
      pickMap={pickMap}
      auditLog={(auditLog ?? []).map((a) => ({
        id: a.id,
        pick_id: a.pick_id,
        previous_bet_type: a.previous_bet_type,
        previous_selection: a.previous_selection,
        previous_line: a.previous_line,
        new_bet_type: a.new_bet_type,
        new_selection: a.new_selection,
        new_line: a.new_line,
        changed_by_name: a.profiles?.display_name ?? "Admin",
        changed_at: a.changed_at,
      }))}
    />
  );
}
