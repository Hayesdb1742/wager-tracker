import { Sport, UpstreamGame, UpstreamStatus } from "./types";

// CFB: cfbd (api.collegefootballdata.com) when CFBD_API_KEY is set, otherwise
// ESPN's unofficial college-football scoreboard (no key required).
// NFL: ESPN's unofficial scoreboard.
//
// external_id convention: cfbd game ids are stored as-is; ESPN-sourced games
// are prefixed `espn-`. Results sync uses the prefix to route each game back
// to the provider it came from.
//
// Week numbering: neither provider has a "week 0" — both fold the late-August
// week-zero slate into week 1. Callers that need week 0 separated should
// filter the week-1 result by kickoff date.

const FETCH_TIMEOUT_MS = 30_000;

type JsonRecord = Record<string, unknown>;

function pick<T>(obj: JsonRecord, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key] as T;
  }
  return undefined;
}

// ---------------------------------------------------------------- cfbd

async function fetchCfbd(path: string): Promise<JsonRecord[]> {
  const apiKey = process.env.CFBD_API_KEY;
  if (!apiKey) throw new Error("CFBD_API_KEY not configured");

  const res = await fetch(`https://api.collegefootballdata.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`cfbd API error: ${res.status}`);
  return res.json();
}

function mapCfbdGame(g: JsonRecord): UpstreamGame {
  const completed = pick<boolean>(g, "completed") === true;
  const homeScore = pick<number>(g, "homePoints", "home_points") ?? null;
  const awayScore = pick<number>(g, "awayPoints", "away_points") ?? null;

  return {
    sport: "CFB",
    external_id: String(g.id),
    home_team: pick<string>(g, "homeTeam", "home_team") ?? "Unknown",
    away_team: pick<string>(g, "awayTeam", "away_team") ?? "Unknown",
    kickoff_time: pick<string>(g, "startDate", "start_date") ?? "",
    status: completed ? "FINAL" : "SCHEDULED",
    home_score: completed ? homeScore : null,
    away_score: completed ? awayScore : null,
  };
}

async function fetchCfbdWeek(year: number, week: number): Promise<UpstreamGame[]> {
  // `classification` is the current param name; `division` kept for older API versions.
  const games = await fetchCfbd(
    `/games?year=${year}&week=${week}&seasonType=regular&classification=fbs&division=fbs`
  );
  return games.map(mapCfbdGame);
}

export async function fetchCfbdSeason(year: number): Promise<UpstreamGame[]> {
  const games = await fetchCfbd(
    `/games?year=${year}&seasonType=regular&classification=fbs&division=fbs`
  );
  return games.map(mapCfbdGame);
}

// ---------------------------------------------------------------- ESPN

const ESPN_PATH: Record<Sport, string> = {
  CFB: "college-football",
  NFL: "nfl",
};

function mapEspnStatus(statusType: JsonRecord | undefined): UpstreamStatus {
  if (statusType?.completed === true) return "FINAL";
  switch (statusType?.name) {
    case "STATUS_POSTPONED":
      return "POSTPONED";
    case "STATUS_CANCELED":
      return "CANCELLED";
    default:
      // Scheduled or in-progress — we don't track LIVE state.
      return "SCHEDULED";
  }
}

function mapEspnEvent(sport: Sport, event: JsonRecord): UpstreamGame {
  const competition = (event.competitions as JsonRecord[] | undefined)?.[0] ?? {};
  const competitors = (competition.competitors as JsonRecord[] | undefined) ?? [];
  const home = competitors.find((c) => c.homeAway === "home") ?? {};
  const away = competitors.find((c) => c.homeAway === "away") ?? {};
  const homeTeam = (home.team ?? {}) as JsonRecord;
  const awayTeam = (away.team ?? {}) as JsonRecord;
  const status = mapEspnStatus((competition.status as JsonRecord | undefined)?.type as JsonRecord);

  const score = (c: JsonRecord) =>
    c.score !== undefined && c.score !== null ? Number(c.score) : null;

  return {
    sport,
    external_id: `espn-${event.id}`,
    home_team: (homeTeam.displayName ?? homeTeam.name ?? "Unknown") as string,
    away_team: (awayTeam.displayName ?? awayTeam.name ?? "Unknown") as string,
    kickoff_time: (competition.date ?? event.date) as string,
    status,
    home_score: status === "FINAL" ? score(home) : null,
    away_score: status === "FINAL" ? score(away) : null,
  };
}

async function fetchEspnScoreboard(sport: Sport, query: string): Promise<UpstreamGame[]> {
  // groups=80 restricts college football to FBS.
  const groups = sport === "CFB" ? "&groups=80&limit=400" : "";
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/${ESPN_PATH[sport]}/scoreboard?${query}${groups}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ESPN API error: ${res.status}`);
  const data = await res.json();
  return ((data.events ?? []) as JsonRecord[]).map((e) => mapEspnEvent(sport, e));
}

function fetchEspnWeek(sport: Sport, year: number, week: number): Promise<UpstreamGame[]> {
  return fetchEspnScoreboard(sport, `dates=${year}&seasontype=2&week=${week}`);
}

// Date range form: YYYYMMDD-YYYYMMDD. Used by results sync so callers don't
// need to reverse-map pool weeks to upstream week numbers.
export function fetchEspnDateRange(
  sport: Sport,
  start: string,
  end: string
): Promise<UpstreamGame[]> {
  return fetchEspnScoreboard(sport, `dates=${start}-${end}`);
}

// ---------------------------------------------------------------- public API

export function fetchCfbWeek(year: number, week: number): Promise<UpstreamGame[]> {
  return process.env.CFBD_API_KEY
    ? fetchCfbdWeek(year, week)
    : fetchEspnWeek("CFB", year, week);
}

export function fetchNflWeek(year: number, week: number): Promise<UpstreamGame[]> {
  return fetchEspnWeek("NFL", year, week);
}
