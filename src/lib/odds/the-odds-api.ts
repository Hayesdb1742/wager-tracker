import { Sport } from "@/lib/sports/types";

// The Odds API v4 (the-odds-api.com). One call per sport returns every upcoming
// event that has odds posted, for every bookmaker in the requested region.
//
// Credits: a call costs (markets x regions) credits regardless of how many events
// come back, and a call that returns no events is free. We ask for spreads and
// totals in the us region -- 2 credits per sport-call. Adding a market here adds
// a credit to every scheduled poll; see the schedule in the game_lines migration.

const FETCH_TIMEOUT_MS = 30_000;
const REGIONS = "us";
const MARKETS = "spreads,totals";

const SPORT_KEY: Record<Sport, string> = {
  CFB: "americanfootball_ncaaf",
  NFL: "americanfootball_nfl",
};

export interface OddsOutcome {
  name: string; // team name for spreads, "Over" / "Under" for totals
  price: number; // American odds
  point?: number; // handicap or total
}

export interface OddsMarket {
  key: "spreads" | "totals" | string;
  last_update: string;
  outcomes: OddsOutcome[];
}

export interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}

export interface OddsEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

export interface OddsCredits {
  last: number | null; // cost of this call
  used: number | null; // since the quota reset
  remaining: number | null;
}

export interface OddsResponse {
  events: OddsEvent[];
  credits: OddsCredits;
}

function headerInt(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function fetchOdds(sport: Sport): Promise<OddsResponse> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("ODDS_API_KEY not configured");

  const params = new URLSearchParams({
    apiKey,
    regions: REGIONS,
    markets: MARKETS,
    oddsFormat: "american",
    dateFormat: "iso",
  });
  const url = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY[sport]}/odds?${params}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    // The body carries the reason (bad key, quota exhausted, unknown sport); keep it short.
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`The Odds API error: ${res.status} ${detail}`);
  }

  return {
    events: (await res.json()) as OddsEvent[],
    credits: {
      last: headerInt(res, "x-requests-last"),
      used: headerInt(res, "x-requests-used"),
      remaining: headerInt(res, "x-requests-remaining"),
    },
  };
}
