import { formatLine, formatOdds, type Selection } from "@/lib/wagers";

// The market as the picks page shows it: the current DraftKings and FanDuel spread and
// total per game, read from game_lines_latest and shaped for a card. Pure on purpose --
// this file is imported by the server page and the client component alike, so it must
// not touch a Supabase client.

export const DISPLAY_BOOKS = ["draftkings", "fanduel"] as const;
export type DisplayBook = (typeof DISPLAY_BOOKS)[number];

export const BOOK_LABELS: Record<DisplayBook, string> = { draftkings: "DK", fanduel: "FD" };

/** `line` is the home team's handicap (negative = home favoured), as game_lines stores it. */
export type BookSpread = { line: number; home_price: number | null; away_price: number | null };
export type BookTotal = { line: number; over_price: number | null; under_price: number | null };
export type BookLines = { spread: BookSpread | null; total: BookTotal | null; updated_at: string | null };

/** One game's lines, keyed by book. A book with nothing posted is simply absent. */
export type GameMarket = Partial<Record<DisplayBook, BookLines>>;
/** Keyed by games.id. A game with no DK/FD rows is absent. */
export type MarketLines = Record<string, GameMarket>;

/** The columns the page selects from game_lines_latest, nullable exactly as the view types them. */
export type LatestLineRow = {
  game_id: string | null;
  bookmaker: string | null;
  market: string | null;
  line: number | null;
  home_price: number | null;
  away_price: number | null;
  over_price: number | null;
  under_price: number | null;
  book_updated_at: string | null;
};

export function isDisplayBook(book: string | null | undefined): book is DisplayBook {
  return (DISPLAY_BOOKS as readonly string[]).includes(book ?? "");
}

function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

export function shapeMarketLines(rows: readonly LatestLineRow[]): MarketLines {
  const out: MarketLines = {};

  for (const row of rows) {
    if (row.game_id === null || row.line === null || !isDisplayBook(row.bookmaker)) continue;
    if (row.market !== "SPREAD" && row.market !== "TOTAL") continue;

    const game = (out[row.game_id] ??= {});
    const book = (game[row.bookmaker] ??= { spread: null, total: null, updated_at: null });
    const line = Number(row.line);

    if (row.market === "SPREAD") {
      book.spread = { line, home_price: row.home_price, away_price: row.away_price };
    } else {
      book.total = { line, over_price: row.over_price, under_price: row.under_price };
    }
    book.updated_at = later(book.updated_at, row.book_updated_at);
  }

  return out;
}

/** The wager a book is offering on one side. Same shape as the picks form's draft. */
export type MarketFill = {
  bet_type: "SPREAD" | "TOTAL";
  selection: Selection;
  line: number;
  odds: number | null;
};

export function spreadFill(spread: BookSpread, side: "HOME" | "AWAY"): MarketFill {
  if (side === "HOME") {
    return { bet_type: "SPREAD", selection: "HOME", line: spread.line, odds: spread.home_price };
  }
  // `-0` would print as "0" anyway, but keep the value itself clean.
  const line = spread.line === 0 ? 0 : -spread.line;
  return { bet_type: "SPREAD", selection: "AWAY", line, odds: spread.away_price };
}

export function totalFill(total: BookTotal, side: "OVER" | "UNDER"): MarketFill {
  return {
    bet_type: "TOTAL",
    selection: side,
    line: total.line,
    odds: side === "OVER" ? total.over_price : total.under_price,
  };
}

/** The side the book favours; home on a pick'em. */
export function favouredSide(spread: BookSpread): "HOME" | "AWAY" {
  return spread.line > 0 ? "AWAY" : "HOME";
}

/** Home-perspective spread with its price: "-3.5 (-110)", "PK (-105)", or "-3.5" with no price. */
export function formatSpreadCell(spread: BookSpread): string {
  const price = formatOdds(spread.home_price);
  const text = formatLine(spread.line);
  return price ? `${text} (${price})` : text;
}

/** The total with both prices: "52.5 (o-110 / u-112)", or "52.5" when neither is known. */
export function formatTotalCell(total: BookTotal): string {
  const over = formatOdds(total.over_price);
  const under = formatOdds(total.under_price);
  if (over && under) return `${total.line} (o${over} / u${under})`;
  return String(total.line);
}
