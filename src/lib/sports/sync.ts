import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchCfbdSeason, fetchEspnDateRange } from "./providers";
import { Sport, UpstreamGame } from "./types";
import { deriveWinner } from "./winner";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ScheduleSyncResult {
  upserted: number;
  skipped_manual: number;
  total_fetched: number;
}

// Upsert upstream games into a pool week. Games an admin has manually
// resolved are never overwritten by sync.
export async function upsertScheduleGames(
  admin: AdminClient,
  weekId: number,
  sport: Sport,
  games: UpstreamGame[]
): Promise<ScheduleSyncResult> {
  if (games.length === 0) {
    return { upserted: 0, skipped_manual: 0, total_fetched: 0 };
  }

  const { data: manualRows, error: manualError } = await admin
    .from("games")
    .select("external_id")
    .eq("sport", sport)
    .eq("manual_resolved", true)
    .in("external_id", games.map((g) => g.external_id));
  if (manualError) throw new Error(manualError.message);

  const manualIds = new Set((manualRows ?? []).map((r) => r.external_id));
  const rows = games
    .filter((g) => !manualIds.has(g.external_id))
    .map((g) => ({
      week_id: weekId,
      sport: g.sport,
      home_team: g.home_team,
      away_team: g.away_team,
      kickoff_time: g.kickoff_time,
      external_id: g.external_id,
      status: g.status,
      winner:
        g.status === "FINAL" && g.home_score !== null && g.away_score !== null
          ? deriveWinner(g.home_score, g.away_score)
          : null,
      home_score: g.home_score,
      away_score: g.away_score,
      resolution_mode: "API" as const,
      last_synced_at: new Date().toISOString(),
    }));

  if (rows.length > 0) {
    const { error } = await admin
      .from("games")
      .upsert(rows, { onConflict: "sport,external_id", ignoreDuplicates: false });
    if (error) throw new Error(error.message);
  }

  return {
    upserted: rows.length,
    skipped_manual: games.length - rows.length,
    total_fetched: games.length,
  };
}

export interface ResultsSyncSummary {
  resolved: number;
  skipped_manual: number;
  status_changed: number;
  touched: number;
  errors: string[];
}

// CFB regular season runs Aug–Dec, NFL through early January — a January
// kickoff belongs to the prior season year (cfbd is queried by season year).
function seasonYear(kickoff: string): number {
  const d = new Date(kickoff);
  return d.getUTCMonth() < 6 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// Pull final scores/status for every game already in the given pool week and
// auto-resolve games the upstream reports as completed. No new games are
// inserted — that's schedule sync's job.
export async function syncResultsForWeek(
  admin: AdminClient,
  weekId: number
): Promise<ResultsSyncSummary> {
  const summary: ResultsSyncSummary = {
    resolved: 0,
    skipped_manual: 0,
    status_changed: 0,
    touched: 0,
    errors: [],
  };

  const { data: games, error } = await admin
    .from("games")
    .select("id, sport, external_id, status, manual_resolved, kickoff_time")
    .eq("week_id", weekId);
  if (error) throw new Error(error.message);
  if (!games || games.length === 0) return summary;

  // Build a lookup of upstream state, batching one fetch per source.
  const upstream = new Map<string, UpstreamGame>();
  const record = (g: UpstreamGame) => upstream.set(`${g.sport}:${g.external_id}`, g);

  const espnSports = new Set<Sport>();
  let needsCfbd = false;
  for (const g of games) {
    if (g.external_id.startsWith("espn-")) espnSports.add(g.sport as Sport);
    else needsCfbd = true;
  }

  const kickoffs = games.map((g) => new Date(g.kickoff_time).getTime());
  const start = new Date(Math.min(...kickoffs) - 24 * 3600 * 1000);
  const end = new Date(Math.max(...kickoffs) + 24 * 3600 * 1000);

  for (const sport of espnSports) {
    try {
      (await fetchEspnDateRange(sport, toYYYYMMDD(start), toYYYYMMDD(end))).forEach(record);
    } catch (err) {
      summary.errors.push(`ESPN ${sport}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (needsCfbd) {
    try {
      (await fetchCfbdSeason(seasonYear(games[0].kickoff_time))).forEach(record);
    } catch (err) {
      summary.errors.push(`cfbd: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const now = new Date().toISOString();

  for (const game of games) {
    const up = upstream.get(`${game.sport}:${game.external_id}`);
    if (!up) continue;

    if (game.manual_resolved) {
      summary.skipped_manual++;
      continue;
    }

    try {
      if (up.status === "FINAL" && up.home_score !== null && up.away_score !== null) {
        if (game.status !== "FINAL") {
          const { error: rpcError } = await admin.rpc("resolve_game", {
            p_game_id: game.id,
            p_home_score: up.home_score,
            p_away_score: up.away_score,
          });
          if (rpcError) throw new Error(rpcError.message);
          summary.resolved++;
        }
        const { error: updateError } = await admin
          .from("games")
          .update({
            home_score: up.home_score,
            away_score: up.away_score,
            resolution_mode: "API",
            last_synced_at: now,
          })
          .eq("id", game.id);
        if (updateError) throw new Error(updateError.message);
      } else if (
        (up.status === "POSTPONED" || up.status === "CANCELLED") &&
        game.status !== up.status &&
        game.status !== "FINAL"
      ) {
        if (up.status === "CANCELLED") {
          await admin.from("picks").update({ points: 0 }).eq("game_id", game.id);
        }
        const { error: updateError } = await admin
          .from("games")
          .update({ status: up.status, last_synced_at: now })
          .eq("id", game.id);
        if (updateError) throw new Error(updateError.message);
        summary.status_changed++;
      } else {
        const { error: updateError } = await admin
          .from("games")
          .update({ last_synced_at: now })
          .eq("id", game.id);
        if (updateError) throw new Error(updateError.message);
      }
      summary.touched++;
    } catch (err) {
      summary.errors.push(
        `${game.sport} ${game.external_id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return summary;
}
