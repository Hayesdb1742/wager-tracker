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

/** The team on the other side -- the one the wager is against -- or null for a total. */
export function opponentTeam(wager: Wager, game: Matchup): string | null {
  if (wager.selection === "HOME") return game.away_team;
  if (wager.selection === "AWAY") return game.home_team;
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

// ---------------------------------------------------------------- locks

/**
 * The lock a pick carries, and the weight it grades at.
 *
 * A LOTY stands in place of that week's LOTW, so a pick holding one carries `is_lotw` too
 * (picks_loty_implies_lotw) -- read the level with `lockLevel`, never `is_lotw` alone, or a
 * LOTY reads as a plain LOTW.
 */
export type LockLevel = "NONE" | "LOTW" | "LOTY";

export const LOCK_LABELS: Record<LockLevel, string> = {
  NONE: "",
  LOTW: "Lock of the Week",
  LOTY: "Lock of the Year",
};

export const LOCK_SHORT: Record<LockLevel, string> = { NONE: "", LOTW: "LOTW", LOTY: "LOTY" };

/**
 * What a lock is worth -- in points AND in games.
 *
 * The league voted on the second half of that: a lock does not just swing the points, it
 * swings the record. A lost LOTW is two losses, not one, so 2-3 on the week with the lock
 * down reads 2-4; a lost LOTY reads 2-9. One number drives both, so the record can never
 * drift from the score. Matches the grading weights in resolve_game.
 */
export const LOCK_MULTIPLIER: Record<LockLevel, number> = { NONE: 1, LOTW: 2, LOTY: 7 };

export function lockLevel(pick: { is_lotw?: boolean | null; is_loty?: boolean | null }): LockLevel {
  if (pick.is_loty) return "LOTY";
  if (pick.is_lotw) return "LOTW";
  return "NONE";
}

/**
 * Whether a submitted pick may be raised to `level`. Returns a message the member can read,
 * or null when the upgrade is allowed.
 *
 * A lock is an upgrade, never a move: NONE -> LOTW -> LOTY, one way, and only onto a pick
 * that is already in. LOTW needs the week's lock unspent. LOTY needs the season's LOTY
 * unspent plus either the week's lock unspent or this very pick already holding it -- the
 * LOTY takes the LOTW's place rather than sitting beside it.
 *
 * Shared because /api/picks/lock enforces this and the pick screen has to grey out the same
 * buttons for the same reasons.
 */
export function lockUpgradeError(
  level: LockLevel,
  ctx: { current: LockLevel; weekLockOnAnotherPick: boolean; lotyUsedThisSeason: boolean }
): string | null {
  if (level === "NONE") return "A lock cannot be taken back off a pick.";

  if (LOCK_MULTIPLIER[level] <= LOCK_MULTIPLIER[ctx.current]) {
    return ctx.current === level
      ? `This pick is already your ${LOCK_LABELS[level]}.`
      : `This pick is already your ${LOCK_LABELS[ctx.current]}, which outranks a ${LOCK_SHORT[level]}.`;
  }

  if (ctx.weekLockOnAnotherPick) {
    return "You have already locked another game this week.";
  }

  if (level === "LOTY" && ctx.lotyUsedThisSeason) {
    return "You have already used your Lock of the Year this season.";
  }

  return null;
}

// ---------------------------------------------------------------- records

/**
 * A won-lost-pushed record, counted in games rather than in picks.
 *
 * The distinction only matters because of locks. The league's ruling is that the W-L
 * record, not the point total, is how a week reads -- so a lock has to show up in it. A
 * pick counts for `LOCK_MULTIPLIER[level]` games on whichever side it landed: a plain pick
 * is one, a LOTW two, a LOTY seven. Two wins and three losses with the LOTW among the
 * losses is 2-4; with the LOTY among them, 2-9.
 *
 * A push is a no-action, so it stays one row however it was locked -- there is nothing to
 * double when nothing was won or lost.
 */
export type LeagueRecord = { wins: number; losses: number; pushes: number };

export type ScoredPick = {
  points: number | null;
  is_lotw?: boolean | null;
  is_loty?: boolean | null;
};

/**
 * Tally picks into a record. Ungraded picks (`points` null) sit out.
 *
 * Every record on the site runs through here. Four screens used to each write their own
 * `.filter((p) => p.points > 0).length`, which is exactly the shape that cannot represent a
 * lock -- one pick, one game, no weight.
 */
export function pickRecord(picks: readonly ScoredPick[]): LeagueRecord {
  const record: LeagueRecord = { wins: 0, losses: 0, pushes: 0 };

  for (const pick of picks) {
    if (pick.points === null || pick.points === undefined) continue;
    const games = LOCK_MULTIPLIER[lockLevel(pick)];
    if (pick.points > 0) record.wins += games;
    else if (pick.points < 0) record.losses += games;
    else record.pushes += 1;
  }

  return record;
}

/**
 * Fold a week's forfeit penalty into a record as losses.
 *
 * A forfeited slot writes no pick row, so `pickRecord` cannot see it -- it only ever reads
 * the picks a member actually made. But the league counts a slot left unpicked as a game
 * lost, not merely a point docked, so the badge has to add it back from `weekly_scores`.
 *
 * `forfeit_penalty` is stored non-positive at -1 per unfilled slot, and a slot is one game
 * on the same scale `pickRecord` counts in. The LOTW penalty is deliberately *not* folded
 * in: that one is for failing to designate a lock, not for skipping a game.
 */
export function withForfeits(record: LeagueRecord, forfeitPenalty: number | null | undefined): LeagueRecord {
  const forfeits = Math.abs(forfeitPenalty ?? 0);
  return forfeits > 0 ? { ...record, losses: record.losses + forfeits } : record;
}

/** Decided games -- the denominator for a win rate. Pushes are not decided. */
export function decidedGames(record: LeagueRecord): number {
  return record.wins + record.losses;
}

/** Win rate over decided games, as a whole percent. 0 when nothing is decided. */
export function winPct(record: LeagueRecord): number {
  const decided = decidedGames(record);
  return decided > 0 ? Math.round((record.wins / decided) * 100) : 0;
}

/** "2–4", or "2–4–1" when there are pushes to show. */
export function formatRecord(record: LeagueRecord): string {
  const base = `${record.wins}–${record.losses}`;
  return record.pushes > 0 ? `${base}–${record.pushes}` : base;
}

/**
 * The lock record's own scale -- NOT LOCK_MULTIPLIER, on purpose.
 *
 * This one is a season-long prize: the league hands something out at the end of the year
 * for it, and they weight a LOTY at 3x a LOTW for that purpose. It is deliberately not the
 * 2-and-7 the league record reads in, because it is not measuring the same thing -- it asks
 * how a member did on the locks they spent, on a scale the prize was agreed in.
 *
 * If someone later "fixes" this to LOCK_MULTIPLIER, the prize changes. Don't.
 */
export const LOCK_PRIZE_WEIGHT: Record<LockLevel, number> = { NONE: 0, LOTW: 1, LOTY: 3 };

/**
 * Tally only the picks that carried a lock, on the prize scale above. Unlike `pickRecord`,
 * a push is weighted too, so all three numbers stay on one scale.
 *
 * Shared so the all-time standings column and the member's own Locks card cannot disagree
 * about a number a prize rides on.
 */
export function lockRecord(picks: readonly ScoredPick[]): LeagueRecord {
  const record: LeagueRecord = { wins: 0, losses: 0, pushes: 0 };

  for (const pick of picks) {
    if (pick.points === null || pick.points === undefined) continue;
    const weight = LOCK_PRIZE_WEIGHT[lockLevel(pick)];
    if (weight === 0) continue;
    if (pick.points > 0) record.wins += weight;
    else if (pick.points < 0) record.losses += weight;
    else record.pushes += weight;
  }

  return record;
}
