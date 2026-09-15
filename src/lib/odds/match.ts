import { Sport } from "@/lib/sports/types";
import { OddsEvent } from "./the-odds-api";

// Pairing The Odds API events with rows in `games`.
//
// NFL is easy: both sides use ESPN's full names ("Baltimore Ravens"). CFB is not: cfbd
// gives us the school ("Ole Miss", "Miami (OH)") and The Odds API gives "School Mascot"
// ("Ole Miss Rebels", "Miami (OH) RedHawks"). So a CFB game matches an event when both
// of its team names are a word-prefix of the event's team names -- and when several
// games could claim an event ("Miami" and "Miami (OH)", "Texas" and "Texas Tech") the
// longest name wins. Sides may be swapped (see EventMatch) -- the same two teams within
// the window is the same game. On top of that, kickoff must land within three days of the event's
// commence_time: cfbd reports a placeholder time for TBA kickoffs, so a tight window
// would miss the Saturday games whose time is set late in the week.
//
// Names cfbd spells in a way no prefix rule can reach are listed in CFB_TEAM_ALIASES.
// Events that still match nothing are returned so the run log can surface them.

const KICKOFF_TOLERANCE_MS = 3 * 24 * 3600 * 1000;

// cfbd name -> alternative spellings to try as a prefix of the event name.
const CFB_TEAM_ALIASES: Record<string, string[]> = {
  "App State": ["Appalachian State"],
  "Florida International": ["FIU"],
  "Massachusetts": ["UMass"],
  "McNeese": ["McNeese State"],
  "Nicholls": ["Nicholls State"],
  "Sam Houston": ["Sam Houston State"],
  "SE Louisiana": ["Southeastern Louisiana"],
  "Southern Miss": ["Southern Mississippi"],
  "UAlbany": ["Albany"],
  "UL Monroe": ["Louisiana Monroe", "Louisiana-Monroe"],
  "UT Martin": ["Tennessee-Martin", "Tennessee Martin"],
};

// Lowercase, no diacritics ("San José State" -> "san jose state"), apostrophes dropped
// ("Hawai'i" -> "hawaii"), other punctuation to spaces ("Miami (OH)" -> "miami oh"),
// and "St" spelled out so "Michigan St" reads as "Michigan State".
export function normalizeTeam(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\bst\b/g, "state")
    .replace(/\s+/g, " ");
}

function isWordPrefix(prefix: string, full: string): boolean {
  return full === prefix || full.startsWith(prefix + " ");
}

export interface MatchableGame {
  id: string;
  sport: Sport;
  home_team: string;
  away_team: string;
  kickoff_time: string;
  odds_api_event_id: string | null;
}

// Every spelling of a game's team we are willing to match, normalized.
function teamForms(sport: Sport, name: string): string[] {
  const forms = [name, ...(sport === "CFB" ? CFB_TEAM_ALIASES[name] ?? [] : [])];
  return forms.map(normalizeTeam);
}

// The length of the longest form of `name` that matches `eventTeam`, or -1.
function teamMatchLength(sport: Sport, name: string, eventTeam: string): number {
  let best = -1;
  for (const form of teamForms(sport, name)) {
    const ok = sport === "NFL" ? form === eventTeam : isWordPrefix(form, eventTeam);
    if (ok && form.length > best) best = form.length;
  }
  return best;
}

// How a game's teams line up with an event's. `flipped` means the book calls our away
// team the home team -- routine for neutral-site games (London, Charlotte, bowls), where
// cfbd and the books pick the designated home side independently.
export interface EventMatch {
  game: MatchableGame;
  flipped: boolean;
}

interface Orientation {
  score: number;
  flipped: boolean;
}

// The best way to pair a game's two teams with an event's, or null when they are not the
// same two teams. Straight orientation wins a tie.
function orient(game: MatchableGame, eventHome: string, eventAway: string): Orientation | null {
  let best: Orientation | null = null;
  for (const flipped of [false, true]) {
    const home = teamMatchLength(game.sport, game.home_team, flipped ? eventAway : eventHome);
    if (home < 0) continue;
    const away = teamMatchLength(game.sport, game.away_team, flipped ? eventHome : eventAway);
    if (away < 0) continue;
    const score = home + away;
    if (!best || score > best.score) best = { score, flipped };
  }
  return best;
}

export interface MatchResult {
  // event id -> game + orientation
  matched: Map<string, EventMatch>;
  unmatched: OddsEvent[];
}

export function matchEvents(games: MatchableGame[], events: OddsEvent[]): MatchResult {
  const byEventId = new Map<string, MatchableGame>();
  for (const g of games) {
    if (g.odds_api_event_id) byEventId.set(g.odds_api_event_id, g);
  }

  const matched = new Map<string, EventMatch>();
  const unmatched: OddsEvent[] = [];
  const claimed = new Set<string>();

  for (const event of events) {
    const eventHome = normalizeTeam(event.home_team);
    const eventAway = normalizeTeam(event.away_team);

    const cached = byEventId.get(event.id);
    if (cached) {
      // Orientation is re-derived from names each poll rather than stored: it is cheap,
      // and a book can re-designate the home side of a neutral game late in the week.
      matched.set(event.id, { game: cached, flipped: orient(cached, eventHome, eventAway)?.flipped ?? false });
      claimed.add(cached.id);
      continue;
    }

    const commence = new Date(event.commence_time).getTime();

    let best: EventMatch | null = null;
    let bestScore = -1;
    for (const g of games) {
      if (g.odds_api_event_id || claimed.has(g.id)) continue;
      if (Math.abs(new Date(g.kickoff_time).getTime() - commence) > KICKOFF_TOLERANCE_MS) continue;

      const o = orient(g, eventHome, eventAway);
      if (o && o.score > bestScore) {
        best = { game: g, flipped: o.flipped };
        bestScore = o.score;
      }
    }

    if (best) {
      matched.set(event.id, best);
      claimed.add(best.game.id);
    } else {
      unmatched.push(event);
    }
  }

  return { matched, unmatched };
}
