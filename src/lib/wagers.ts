// Wagers: the shared vocabulary for reading, writing and rendering a pick.
//
// A pick is a bet type, a selection, a line and an optional price. The line is stored from
// the perspective of the selected side -- a team taken as a 3.5-point underdog is +3.5, as a
// favourite -3.5 -- which is what lets one comparison grade all three bet types. ML is a
// spread of zero.
//
// Before this existed, `picked_team === "HOME" ? home_team : away_team` was reimplemented
// inline in seven files. A wager is more than a team name, so it lives here now.

export type BetType = "ML" | "SPREAD" | "TOTAL";
export type Selection = "HOME" | "AWAY" | "OVER" | "UNDER";

export const BET_TYPES: readonly BetType[] = ["ML", "SPREAD", "TOTAL"] as const;

export const BET_TYPE_LABELS: Record<BetType, string> = {
  ML: "Moneyline",
  SPREAD: "Spread",
  TOTAL: "Total",
};

/** The sides a given bet type may be taken on. */
export const SELECTIONS_FOR: Record<BetType, readonly Selection[]> = {
  ML: ["AWAY", "HOME"],
  SPREAD: ["AWAY", "HOME"],
  TOTAL: ["OVER", "UNDER"],
};

export type Wager = {
  bet_type: string;
  selection: string;
  line: number;
  odds?: number | null;
};

export type Matchup = {
  home_team: string;
  away_team: string;
};

// ---------------------------------------------------------------- formatting

/** "Michigan at Ohio State" -- the one matchup string, replacing six inline variants. */
export function formatMatchup(game: Matchup): string {
  return `${game.away_team} at ${game.home_team}`;
}

/** A spread as a bettor writes it: "-7", "+3.5", "PK" for a pick'em. */
export function formatLine(line: number): string {
  if (line === 0) return "PK";
  return line > 0 ? `+${line}` : String(line);
}

/** American odds as a bettor writes them: "-110", "+140". */
export function formatOdds(odds: number | null | undefined): string | null {
  if (odds === null || odds === undefined) return null;
  return odds > 0 ? `+${odds}` : String(odds);
}

/** The team on the selected side, or null for a total (which has no side). */
export function selectedTeam(wager: Wager, game: Matchup): string | null {
  if (wager.selection === "HOME") return game.home_team;
  if (wager.selection === "AWAY") return game.away_team;
  return null;
}

/**
 * The wager as the member would say it out loud:
 *   "Michigan -3.5"   "Texas ML"   "Over 52.5"
 * Pass `withOdds` to append the price when one was recorded.
 */
export function formatWager(wager: Wager, game: Matchup, withOdds = false): string {
  let text: string;

  if (wager.bet_type === "TOTAL") {
    const side = wager.selection === "OVER" ? "Over" : "Under";
    text = `${side} ${wager.line}`;
  } else {
    const team = selectedTeam(wager, game) ?? wager.selection;
    text = wager.bet_type === "ML" ? `${team} ML` : `${team} ${formatLine(wager.line)}`;
  }

  const price = withOdds ? formatOdds(wager.odds) : null;
  return price ? `${text} (${price})` : text;
}

/** A compact form for dense grids: "MICH -3.5", "O 52.5". */
export function formatWagerShort(wager: Wager, game: Matchup): string {
  if (wager.bet_type === "TOTAL") {
    return `${wager.selection === "OVER" ? "O" : "U"} ${wager.line}`;
  }
  const team = selectedTeam(wager, game) ?? wager.selection;
  const abbr = team.slice(0, 4).toUpperCase();
  return wager.bet_type === "ML" ? `${abbr} ML` : `${abbr} ${formatLine(wager.line)}`;
}

// ---------------------------------------------------------------- results

export type WagerGrade = "WIN" | "LOSS" | "PUSH" | "VOID" | "PENDING";

/**
 * Decode `picks.points` into a result.
 *
 * `points = 0` is ambiguous on its own: it is written both for a genuine push and for a
 * cancelled game. Pass the game status to tell them apart -- six read sites previously
 * counted every cancelled game as a push.
 */
export function wagerResult(points: number | null, gameStatus?: string): WagerGrade {
  if (gameStatus === "CANCELLED") return "VOID";
  if (points === null) return "PENDING";
  if (points > 0) return "WIN";
  if (points < 0) return "LOSS";
  return "PUSH";
}

export const GRADE_LABELS: Record<WagerGrade, string> = {
  WIN: "W",
  LOSS: "L",
  PUSH: "P",
  VOID: "—",
  PENDING: "",
};

// ---------------------------------------------------------------- validation

/**
 * Mirrors the CHECK constraints in 20260908195803_wager_types.sql so a bad wager is refused
 * with a readable message instead of a Postgres constraint violation. Shared by the member
 * pick route and the admin override route -- the old `["HOME","AWAY"].includes(...)` literal
 * was duplicated across both.
 *
 * Returns an error message, or null when the wager is valid.
 */
export function validateWager(input: {
  bet_type?: unknown;
  selection?: unknown;
  line?: unknown;
  odds?: unknown;
}): string | null {
  const { bet_type, selection, line, odds } = input;

  if (typeof bet_type !== "string" || !BET_TYPES.includes(bet_type as BetType)) {
    return "bet_type must be ML, SPREAD, or TOTAL";
  }

  const allowed = SELECTIONS_FOR[bet_type as BetType];
  if (typeof selection !== "string" || !allowed.includes(selection as Selection)) {
    return `selection for ${bet_type} must be ${allowed.join(" or ")}`;
  }

  if (typeof line !== "number" || !Number.isFinite(line)) {
    return "line must be a number";
  }
  // numeric(5,1): one decimal place, and books deal in halves.
  if (Math.round(line * 2) !== line * 2) {
    return "line must be a whole or half number";
  }
  if (Math.abs(line) >= 1000) {
    return "line is out of range";
  }
  if (bet_type === "ML" && line !== 0) {
    return "a moneyline has no line";
  }
  if (bet_type === "TOTAL" && line <= 0) {
    return "a total must be greater than 0";
  }

  if (odds !== null && odds !== undefined) {
    if (typeof odds !== "number" || !Number.isInteger(odds)) {
      return "odds must be a whole number in American format";
    }
    if (odds > -100 && odds < 100) {
      return "odds must be -100 or shorter, or +100 or longer";
    }
  }

  return null;
}
