import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSeasonId } from "@/lib/seasons";
import { LeaderboardClient } from "./LeaderboardClient";

export default async function LeaderboardPage() {
  const admin = createAdminClient();

  // Weeks of the active season, for the week dropdown
  const seasonId = await getActiveSeasonId(admin);

  const { data: weeks } = seasonId
    ? await admin
        .from("weeks")
        .select("id, week_number, status, season_id")
        .eq("season_id", seasonId)
        .order("week_number", { ascending: true })
    : { data: [] };

  // Default to the open week; fall back to most recently closed
  const openWeek = weeks?.find((w) => w.status === "OPEN");
  const defaultWeek = openWeek ?? [...(weeks ?? [])].reverse().find((w) => w.status === "CLOSED");

  // Weekly leaderboard data for the default week
  const { data: scores } = defaultWeek
    ? await admin
        .from("weekly_scores")
        .select("member_id, pick_points, forfeit_penalty, lotw_penalty, total, profiles(display_name)")
        .eq("week_id", defaultWeek.id)
        .order("total", { ascending: false })
    : { data: [] };

  // Games for the default week
  const { data: games } = defaultWeek
    ? await admin
        .from("games")
        .select("id, sport, home_team, away_team, kickoff_time, status, winner, home_score, away_score")
        .eq("week_id", defaultWeek.id)
        .eq("in_pool", true)
        .order("kickoff_time", { ascending: true })
    : { data: [] };

  // Picks visible for the default week (post-kickoff or own picks — admin bypasses RLS)
  const { data: picks } = defaultWeek
    ? await admin
        .from("picks")
        .select("member_id, game_id, bet_type, selection, line, odds, is_lotw, points")
        .eq("week_id", defaultWeek.id)
    : { data: [] };

  // Season standings: sum totals across all CLOSED weeks
  const closedWeekIds = (weeks ?? []).filter((w) => w.status === "CLOSED").map((w) => w.id);
  const { data: allClosedScores } = closedWeekIds.length > 0
    ? await admin
        .from("weekly_scores")
        .select("member_id, week_id, total, profiles(display_name)")
        .in("week_id", closedWeekIds)
    : { data: [] };

  // Aggregate season standings
  type SeasonEntry = { member_id: string; display_name: string; season_total: number; weeks: Record<number, number> };
  const seasonMap = new Map<string, SeasonEntry>();

  for (const row of allClosedScores ?? []) {
    const name = row.profiles?.display_name ?? "Unknown";
    if (!seasonMap.has(row.member_id)) {
      seasonMap.set(row.member_id, { member_id: row.member_id, display_name: name, season_total: 0, weeks: {} });
    }
    const entry = seasonMap.get(row.member_id)!;
    entry.season_total += row.total ?? 0;
    entry.weeks[row.week_id] = row.total ?? 0;
  }

  const seasonStandings = Array.from(seasonMap.values()).sort((a, b) =>
    b.season_total - a.season_total || a.display_name.localeCompare(b.display_name)
  );

  return (
    <LeaderboardClient
      weeks={weeks ?? []}
      defaultWeekId={defaultWeek?.id ?? null}
      openWeekId={openWeek?.id ?? null}
      initialScores={(scores ?? []).map((s) => ({
        member_id: s.member_id,
        display_name: s.profiles?.display_name ?? "Unknown",
        pick_points: s.pick_points,
        forfeit_penalty: s.forfeit_penalty,
        lotw_penalty: s.lotw_penalty,
        total: s.total ?? 0,
      }))}
      initialGames={games ?? []}
      initialPicks={(picks ?? []).map((p) => ({
        member_id: p.member_id,
        game_id: p.game_id,
        bet_type: p.bet_type,
        selection: p.selection,
        line: p.line,
        odds: p.odds,
        is_lotw: p.is_lotw,
        points: p.points,
      }))}
      seasonStandings={seasonStandings}
      closedWeekIds={closedWeekIds}
    />
  );
}
