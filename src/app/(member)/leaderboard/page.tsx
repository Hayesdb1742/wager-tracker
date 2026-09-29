import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSeasonId } from "@/lib/seasons";
import { pickRecord, lockRecord, withForfeits, type LeagueRecord } from "@/lib/wagers";
import { LeaderboardClient } from "./LeaderboardClient";

type SeasonPick = {
  member_id: string;
  week_id: number;
  is_lotw: boolean | null;
  is_loty: boolean | null;
  points: number | null;
};

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
        .select("member_id, forfeit_penalty, lotw_penalty, profiles(display_name)")
        .eq("week_id", defaultWeek.id)
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
        .select("member_id, game_id, bet_type, selection, line, odds, is_lotw, is_loty, points")
        .eq("week_id", defaultWeek.id)
    : { data: [] };

  // Season record: every graded pick of the season, plus the forfeited slots that wrote no
  // pick row. The open week is deliberately left out of the base — the client folds it back
  // in from the week data it already holds, so a game resolving mid-week moves the season
  // column live, the same way it moves the week column.
  const weekIds = (weeks ?? []).map((w) => w.id);

  // Paged, because a full season outruns PostgREST's 1000-row ceiling: nine members times
  // ten picks times eighteen weeks is past it by midseason, and the cap truncates silently
  // -- the standings would simply start losing games off the back of the year.
  async function allSeasonPicks() {
    if (weekIds.length === 0) return [];
    const page = 1000;
    const rows: SeasonPick[] = [];
    for (let from = 0; ; from += page) {
      const { data } = await admin
        .from("picks")
        .select("member_id, week_id, is_lotw, is_loty, points")
        .in("week_id", weekIds)
        .not("points", "is", null)
        .order("member_id", { ascending: true })
        .range(from, from + page - 1);
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < page) break;
    }
    return rows;
  }

  const [seasonPicks, seasonScoresRes, profilesRes] = await Promise.all([
    allSeasonPicks(),
    weekIds.length > 0
      ? admin
          .from("weekly_scores")
          .select("member_id, forfeit_penalty")
          .in("week_id", weekIds)
      : Promise.resolve({ data: [] }),
    admin.from("profiles").select("id, display_name, is_active"),
  ]);

  const seasonScores = seasonScoresRes.data ?? [];
  const profiles = profilesRes.data ?? [];

  // Group the settled weeks' picks by member, then tally. close_week is what writes
  // forfeit_penalty, so the open week's is always 0 — summing every week double-counts
  // nothing.
  const settledPicksByMember = new Map<string, SeasonPick[]>();
  for (const pick of seasonPicks) {
    if (openWeek && pick.week_id === openWeek.id) continue;
    const list = settledPicksByMember.get(pick.member_id);
    if (list) list.push(pick);
    else settledPicksByMember.set(pick.member_id, [pick]);
  }

  const forfeitsByMember = new Map<string, number>();
  for (const score of seasonScores) {
    forfeitsByMember.set(
      score.member_id,
      (forfeitsByMember.get(score.member_id) ?? 0) + (score.forfeit_penalty ?? 0)
    );
  }

  // Everyone active gets a row even before their first pick grades, so the board is the
  // league roster rather than "whoever the scoring job has touched". A member who has since
  // gone inactive still shows while they have a record on the season.
  const seasonBase = profiles
    .filter((p) => p.is_active || settledPicksByMember.has(p.id) || forfeitsByMember.has(p.id))
    .map((p) => {
      const settled = settledPicksByMember.get(p.id) ?? [];
      return {
        member_id: p.id,
        display_name: p.display_name,
        record: withForfeits(
          pickRecord(settled),
          forfeitsByMember.get(p.id) ?? 0
        ) satisfies LeagueRecord,
        // The lock column runs on LOCK_PRIZE_WEIGHT, not the 2-and-7 the league record
        // reads in -- a LOTY counts three there. Forfeits stay out of it: an unpicked slot
        // is a game lost, never a lock spent.
        locks: lockRecord(settled) satisfies LeagueRecord,
      };
    });

  return (
    <LeaderboardClient
      weeks={weeks ?? []}
      defaultWeekId={defaultWeek?.id ?? null}
      openWeekId={openWeek?.id ?? null}
      initialScores={(scores ?? []).map((s) => ({
        member_id: s.member_id,
        display_name: s.profiles?.display_name ?? "Unknown",
        forfeit_penalty: s.forfeit_penalty,
        lotw_penalty: s.lotw_penalty,
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
        is_loty: p.is_loty,
        points: p.points,
      }))}
      seasonBase={seasonBase}
    />
  );
}
