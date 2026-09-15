import type { createAdminClient } from "@/lib/supabase/admin";
import { Sport } from "@/lib/sports/types";
import { getActiveSeasonId } from "@/lib/seasons";
import { fetchOdds, OddsEvent } from "./the-odds-api";
import { matchEvents, EventMatch, MatchableGame } from "./match";

type AdminClient = ReturnType<typeof createAdminClient>;

// Games earlier than this have kicked off and their lines are closed; later than this
// no book has posted a line yet. Slightly wider than request_odds_sync()'s guard so a
// game the guard counted is always a candidate here.
const LOOKBACK_MS = 6 * 3600 * 1000;
const LOOKAHEAD_MS = 14 * 24 * 3600 * 1000;

type LineRow = {
  game_id: string;
  bookmaker: string;
  market: "SPREAD" | "TOTAL";
  line: number;
  home_price: number | null;
  away_price: number | null;
  over_price: number | null;
  under_price: number | null;
  book_updated_at: string;
  captured_at: string;
};

export interface OddsSyncSummary {
  events_returned: number;
  matched: number;
  unmatched: number;
  rows_inserted: number;
  credits_last: number | null;
  credits_remaining: number | null;
}

// One event's bookmakers flattened into candidate rows. A book is skipped for a market
// when its outcomes are incomplete -- a spread with one side, a total with no point.
// `line` is always from the perspective of *our* home team, so when the book has the
// sides flipped (neutral-site games) the spread comes from the event's away outcome.
function eventToRows(event: OddsEvent, match: EventMatch, capturedAt: string): LineRow[] {
  const rows: LineRow[] = [];
  const gameId = match.game.id;
  const ourHome = match.flipped ? event.away_team : event.home_team;
  const ourAway = match.flipped ? event.home_team : event.away_team;

  for (const book of event.bookmakers) {
    for (const market of book.markets) {
      if (market.key === "spreads") {
        const home = market.outcomes.find((o) => o.name === ourHome);
        const away = market.outcomes.find((o) => o.name === ourAway);
        if (home?.point === undefined || away === undefined) continue;
        rows.push({
          game_id: gameId,
          bookmaker: book.key,
          market: "SPREAD",
          line: home.point,
          home_price: home.price,
          away_price: away.price,
          over_price: null,
          under_price: null,
          book_updated_at: market.last_update,
          captured_at: capturedAt,
        });
      } else if (market.key === "totals") {
        const over = market.outcomes.find((o) => o.name === "Over");
        const under = market.outcomes.find((o) => o.name === "Under");
        if (over?.point === undefined || under === undefined) continue;
        rows.push({
          game_id: gameId,
          bookmaker: book.key,
          market: "TOTAL",
          line: over.point,
          home_price: null,
          away_price: null,
          over_price: over.price,
          under_price: under.price,
          book_updated_at: market.last_update,
          captured_at: capturedAt,
        });
      }
    }
  }

  return rows;
}

function lineKey(r: { game_id: string; bookmaker: string; market: string }): string {
  return `${r.game_id}:${r.bookmaker}:${r.market}`;
}

function sameLine(a: LineRow, b: LineRow): boolean {
  return (
    Number(a.line) === Number(b.line) &&
    a.home_price === b.home_price &&
    a.away_price === b.away_price &&
    a.over_price === b.over_price &&
    a.under_price === b.under_price
  );
}

// Poll The Odds API for one sport and record every line that changed since the last
// poll. Always writes an odds_poll_runs row, including when the poll fails.
export async function syncOddsForSport(admin: AdminClient, sport: Sport): Promise<OddsSyncSummary> {
  const capturedAt = new Date().toISOString();
  const summary: OddsSyncSummary = {
    events_returned: 0,
    matched: 0,
    unmatched: 0,
    rows_inserted: 0,
    credits_last: null,
    credits_remaining: null,
  };
  let unmatchedLog: Pick<OddsEvent, "id" | "home_team" | "away_team" | "commence_time">[] = [];
  let creditsUsed: number | null = null;

  try {
    const seasonId = await getActiveSeasonId(admin);
    if (seasonId === null) throw new Error("no active season");

    const { data: weeks, error: weeksError } = await admin
      .from("weeks")
      .select("id")
      .eq("season_id", seasonId);
    if (weeksError) throw new Error(weeksError.message);

    const now = Date.now();
    const { data: games, error: gamesError } = await admin
      .from("games")
      .select("id, sport, home_team, away_team, kickoff_time, odds_api_event_id")
      .in("week_id", (weeks ?? []).map((w) => w.id))
      .eq("sport", sport)
      .eq("status", "SCHEDULED")
      .gte("kickoff_time", new Date(now - LOOKBACK_MS).toISOString())
      .lte("kickoff_time", new Date(now + LOOKAHEAD_MS).toISOString());
    if (gamesError) throw new Error(gamesError.message);

    const candidates: MatchableGame[] = (games ?? []).map((g) => ({
      id: g.id,
      sport: g.sport as Sport,
      home_team: g.home_team,
      away_team: g.away_team,
      kickoff_time: g.kickoff_time,
      odds_api_event_id: g.odds_api_event_id,
    }));

    const { events, credits } = await fetchOdds(sport);
    summary.events_returned = events.length;
    summary.credits_last = credits.last;
    summary.credits_remaining = credits.remaining;
    creditsUsed = credits.used;

    const { matched, unmatched } = matchEvents(candidates, events);
    summary.matched = matched.size;
    summary.unmatched = unmatched.length;
    unmatchedLog = unmatched.map((e) => ({
      id: e.id,
      home_team: e.home_team,
      away_team: e.away_team,
      commence_time: e.commence_time,
    }));

    // Remember new matches so the next poll joins by id.
    for (const [eventId, { game }] of matched) {
      if (game.odds_api_event_id === eventId) continue;
      const { error } = await admin
        .from("games")
        .update({ odds_api_event_id: eventId })
        .eq("id", game.id);
      if (error) throw new Error(error.message);
    }

    const candidateRows: LineRow[] = [];
    for (const event of events) {
      const match = matched.get(event.id);
      if (match) candidateRows.push(...eventToRows(event, match, capturedAt));
    }

    // Only lines that differ from the latest stored row are worth a new row.
    const gameIds = [...new Set(candidateRows.map((r) => r.game_id))];
    const latest = new Map<string, LineRow>();
    if (gameIds.length > 0) {
      const { data: latestRows, error: latestError } = await admin
        .from("game_lines_latest")
        .select("*")
        .in("game_id", gameIds);
      if (latestError) throw new Error(latestError.message);
      // View columns type as nullable; the underlying table guarantees them.
      for (const r of latestRows ?? []) {
        const row = r as LineRow;
        latest.set(lineKey(row), row);
      }
    }

    const rows = candidateRows.filter((r) => {
      const prev = latest.get(lineKey(r));
      return !prev || !sameLine(prev, r);
    });

    if (rows.length > 0) {
      const { error } = await admin.from("game_lines").insert(rows);
      if (error) throw new Error(error.message);
    }
    summary.rows_inserted = rows.length;

    await logRun(admin, sport, capturedAt, summary, unmatchedLog, creditsUsed, null);
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logRun(admin, sport, capturedAt, summary, unmatchedLog, creditsUsed, message);
    throw err;
  }
}

async function logRun(
  admin: AdminClient,
  sport: Sport,
  ranAt: string,
  summary: OddsSyncSummary,
  unmatched: Pick<OddsEvent, "id" | "home_team" | "away_team" | "commence_time">[],
  creditsUsed: number | null,
  error: string | null
): Promise<void> {
  const { error: logError } = await admin.from("odds_poll_runs").insert({
    ran_at: ranAt,
    sport,
    events_returned: summary.events_returned,
    matched: summary.matched,
    rows_inserted: summary.rows_inserted,
    unmatched,
    credits_last: summary.credits_last,
    credits_used: creditsUsed,
    credits_remaining: summary.credits_remaining,
    error,
  });
  // A failed audit write must not mask the poll's own outcome.
  if (logError) console.error(`odds_poll_runs insert failed (${sport}): ${logError.message}`);
}
