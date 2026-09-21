import type { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSeasonId } from "@/lib/seasons";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * How long after kickoff a game still counts as in play.
 *
 * There is no LIVE status: the ESPN sync leaves a game SCHEDULED until it is FINAL
 * (src/lib/sports/types.ts), so "underway" has to be read off the clock. The window is the
 * same eight hours request_results_sync() uses to decide whether there is anything left to
 * poll -- past it, a SCHEDULED game is a sync gap, not a game still being played.
 */
export const LIVE_WINDOW_MS = 8 * 60 * 60 * 1000;

export type LivePick = {
  member_id: string;
  display_name: string;
  bet_type: string;
  selection: string;
  line: number;
  odds: number | null;
  is_lotw: boolean;
  is_loty: boolean;
};

export type LiveGame = {
  id: string;
  sport: string;
  home_team: string;
  away_team: string;
  kickoff_time: string;
  picks: LivePick[];
};

export type LiveBoard = {
  week: { id: number; week_number: number } | null;
  games: LiveGame[];
  /** When the board was read, so the client can say how fresh it is. */
  as_of: string;
};

/**
 * Every in-pool game of the OPEN week that is underway right now, with every pick on it.
 *
 * Only the OPEN week can hold a live game: advance_season() refuses to close a week until
 * all of its pool games are FINAL. And only games past kickoff are listed, which is what
 * makes it safe to show everyone's picks -- picks are blind until kickoff, so nothing here
 * is a pick anyone could still act on.
 *
 * Shared by the picks page (first paint) and /api/live (the picks screen's refresh).
 */
export async function getLiveBoard(admin: AdminClient): Promise<LiveBoard> {
  const now = new Date();
  const asOf = now.toISOString();

  const seasonId = await getActiveSeasonId(admin);
  const { data: week } = seasonId
    ? await admin
        .from("weeks")
        .select("id, week_number")
        .eq("season_id", seasonId)
        .eq("status", "OPEN")
        .order("week_number", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  if (!week) return { week: null, games: [], as_of: asOf };

  const { data: games } = await admin
    .from("games")
    .select("id, sport, home_team, away_team, kickoff_time")
    .eq("week_id", week.id)
    .eq("in_pool", true)
    .eq("status", "SCHEDULED")
    .lte("kickoff_time", asOf)
    .gt("kickoff_time", new Date(now.getTime() - LIVE_WINDOW_MS).toISOString())
    .order("kickoff_time", { ascending: true });

  if (!games || games.length === 0) return { week, games: [], as_of: asOf };

  // Two FKs point picks at profiles (member_id, overridden_by), so the join names its edge.
  const { data: picks } = await admin
    .from("picks")
    .select("member_id, game_id, bet_type, selection, line, odds, is_lotw, is_loty, profiles!member_id(display_name)")
    .in("game_id", games.map((g) => g.id));

  const byGame = new Map<string, LivePick[]>();
  for (const p of picks ?? []) {
    const list = byGame.get(p.game_id) ?? [];
    list.push({
      member_id: p.member_id,
      display_name: p.profiles?.display_name ?? "Unknown",
      bet_type: p.bet_type,
      selection: p.selection,
      line: p.line,
      odds: p.odds,
      is_lotw: p.is_lotw,
      is_loty: p.is_loty,
    });
    byGame.set(p.game_id, list);
  }

  // Same sides sit together so a split slate reads at a glance; names break the tie.
  const sideOrder: Record<string, number> = { AWAY: 0, HOME: 1, OVER: 2, UNDER: 3 };
  for (const list of byGame.values()) {
    list.sort(
      (a, b) =>
        (sideOrder[a.selection] ?? 9) - (sideOrder[b.selection] ?? 9) ||
        a.display_name.localeCompare(b.display_name)
    );
  }

  return {
    week,
    games: games.map((g) => ({ ...g, picks: byGame.get(g.id) ?? [] })),
    as_of: asOf,
  };
}
