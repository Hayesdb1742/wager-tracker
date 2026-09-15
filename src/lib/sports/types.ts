export type Sport = "CFB" | "NFL";

// LIVE is not tracked: in-progress upstream games stay SCHEDULED until FINAL.
export type UpstreamStatus = "SCHEDULED" | "FINAL" | "POSTPONED" | "CANCELLED";

// A game as reported by an upstream sports API, normalized to our schema's vocabulary.
export interface UpstreamGame {
  sport: Sport;
  external_id: string;
  home_team: string;
  away_team: string;
  kickoff_time: string;
  status: UpstreamStatus;
  home_score: number | null;
  away_score: number | null;
}

// A team as reported by an upstream sports API. `name` is the exact string the
// same provider writes into a game's home_team/away_team.
export interface UpstreamTeam {
  sport: Sport;
  external_id: string;
  name: string;
  abbreviation: string | null;
  conference: string | null;
  division: string | null;
}
