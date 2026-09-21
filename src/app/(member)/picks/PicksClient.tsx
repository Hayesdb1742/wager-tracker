"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import {
  BET_TYPES,
  BET_TYPE_LABELS,
  SELECTIONS_FOR,
  LOCK_MULTIPLIER,
  LOCK_SHORT,
  formatWager,
  lockLevel,
  lockUpgradeError,
  type BetType,
  type LockLevel,
  formatOdds,
  type Selection,
} from "@/lib/wagers";
import {
  BOOK_LABELS,
  DISPLAY_BOOKS,
  favouredSide,
  formatSpreadCell,
  formatTotalCell,
  spreadFill,
  totalFill,
  type BookSpread,
  type GameMarket,
  type MarketFill,
  type MarketLines,
} from "@/lib/odds/display";

type Week = {
  id: number;
  week_number: number;
  required_picks: number;
  required_nfl_picks: number | null;
  required_cfb_picks: number | null;
  closes_at: string;
};
type Game = {
  id: string; sport: string; home_team: string; away_team: string;
  kickoff_time: string; status: string; in_pool: boolean;
  home_score: number | null; away_score: number | null; winner: string | null;
};
type PickInfo = {
  id: string;
  bet_type: string;
  selection: string;
  line: number;
  odds: number | null;
  is_lotw: boolean;
  is_loty: boolean;
  overridden_by: string | null;
  overridden_at: string | null;
};

type Sport = "NFL" | "CFB";

type Draft = { bet_type: BetType; selection: Selection; line: number; odds: number | null };

/** Where an earlier week's Lock of the Year went, when one has already been spent. */
type LotyUsed = { week_number: number; matchup: string | null } | null;

interface Props {
  week: Week;
  games: Game[];
  initialPickMap: Record<string, PickInfo>;
  /** Current DK/FD lines by game id; a game with none posted is absent. */
  marketLines: MarketLines;
  lotyUsed: LotyUsed;
  memberId: string;
}

/**
 * Parse a line the member is still typing. Returns null for anything incomplete — a lone
 * "-", a trailing "3." — so a half-typed number can never be submitted.
 */
function parseLine(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (Math.round(n * 2) !== n * 2) return null;  // books deal in halves
  if (Math.abs(n) >= 1000) return null;
  return n;
}

/** `null` value means "no price given", which is allowed. `ok: false` means "still typing". */
function parseOdds(text: string): { ok: boolean; value: number | null } {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^[+-]?\d+$/.test(t)) return { ok: false, value: null };
  const n = Number(t);
  if (n > -100 && n < 100) return { ok: false, value: null };
  return { ok: true, value: n };
}

/**
 * A number field whose sign is a pair of buttons beside it. iOS's decimal and numeric
 * keypads have no minus key, so without this a phone cannot enter a favourite's spread
 * or a negative price at all. The field itself keeps the keypad.
 */
function SignedInput({
  label, value, onChange, placeholder, inputMode,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  inputMode: "decimal" | "numeric";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const digits = value.trim().replace(/^[+-]/, "");
  const negative = value.trim().startsWith("-");
  const positive = digits !== "" && !negative;

  // The next digits belong after the sign, so the field takes focus with the caret at the
  // end -- a tap on the field itself could land the caret in front of the sign instead.
  const setSign = (sign: "-" | "+") => {
    onChange(sign + digits);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  };

  return (
    <div className="flex rounded-lg border border-slate-600 bg-slate-800 focus-within:border-sky-400 overflow-hidden">
      {([["-", "−", negative], ["+", "+", positive]] as const).map(([sign, glyph, active]) => (
        <button
          key={sign}
          type="button"
          onClick={() => setSign(sign)}
          // Keep focus (and the keyboard) on the field rather than moving it to the button.
          onPointerDown={(e) => e.preventDefault()}
          aria-pressed={active}
          aria-label={sign === "-" ? "Minus" : "Plus"}
          className={`w-8 text-sm font-bold border-r border-slate-600 transition-colors ${
            active
              ? "bg-sky-500/25 text-sky-100"
              : "text-slate-400 hover:bg-slate-700 hover:text-white cursor-pointer"
          }`}
        >
          {glyph}
        </button>
      ))}
      <input
        ref={inputRef}
        type="text"
        inputMode={inputMode}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 flex-1 px-2.5 py-1.5 bg-transparent text-sm text-white tabular-nums focus:outline-none"
      />
    </div>
  );
}

/** A complete, valid wager, or null while the member is still composing one. */
function buildDraft(
  betType: BetType,
  selection: Selection | null,
  lineText: string,
  oddsText: string
): Draft | null {
  if (!selection) return null;
  if (!SELECTIONS_FOR[betType].includes(selection)) return null;

  const odds = parseOdds(oddsText);
  if (!odds.ok) return null;

  if (betType === "ML") {
    return { bet_type: betType, selection, line: 0, odds: odds.value };
  }

  const line = parseLine(lineText);
  if (line === null) return null;
  if (betType === "TOTAL" && line <= 0) return null;

  return { bet_type: betType, selection, line, odds: odds.value };
}

export function PicksClient({ week, games, initialPickMap, marketLines, lotyUsed }: Props) {
  const [picks, setPicks] = useState(initialPickMap);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const cfbGames = games.filter((g) => g.sport === "CFB");
  const nflGames = games.filter((g) => g.sport === "NFL");
  // One sport on screen at a time; CFB used to sit under every NFL game, a long scroll away.
  const [sport, setSport] = useState<Sport>(nflGames.length > 0 ? "NFL" : "CFB");

  const isKickedOff = (game: Game) => new Date(game.kickoff_time) <= new Date();
  const pickCount = Object.keys(picks).length;

  // The week's lock, and whether the season's single LOTY is still in hand. A LOTY spent in
  // an earlier week arrives on props; one spent in this week is in `picks`.
  const weekLock = useMemo(() => {
    for (const [gameId, pick] of Object.entries(picks)) {
      if (pick.is_lotw) return { gameId, pick, level: lockLevel(pick) };
    }
    return null;
  }, [picks]);

  const lotySpentHere = weekLock?.level === "LOTY";
  const lotySpent = lotySpentHere || lotyUsed !== null;

  // The lock rides along with the wager: a member who wants this to be their LOTW says so
  // when they submit, rather than finding the upgrade buttons afterwards.
  const submitPick = useCallback(async (gameId: string, wager: Draft, lock: LockLevel) => {
    setBusy(gameId);
    setErrors((e) => { const n = { ...e }; delete n[gameId]; return n; });

    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game_id: gameId, ...wager, lock }),
    });
    const data = await res.json();
    setBusy(null);

    if (!res.ok) {
      setErrors((e) => ({ ...e, [gameId]: data.message ?? data.error }));
      return;
    }

    // A LOTY stands in place of the week's LOTW, so both flags move together.
    setPicks((prev) => ({
      ...prev,
      [gameId]: {
        id: data.id,
        bet_type: wager.bet_type,
        selection: wager.selection,
        line: wager.line,
        odds: wager.odds,
        is_lotw: lock !== "NONE",
        is_loty: lock === "LOTY",
        overridden_by: null,
        overridden_at: null,
      },
    }));
  }, []);

  const setLock = useCallback(async (gameId: string, level: LockLevel) => {
    const pick = picks[gameId];
    if (!pick) return;

    const key = `lock-${gameId}`;
    setBusy(key);
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });

    const res = await fetch("/api/picks/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pick_id: pick.id, level }),
    });
    const data = await res.json();
    setBusy(null);

    if (!res.ok) {
      setErrors((e) => ({ ...e, [key]: data.message ?? data.error }));
      return;
    }

    // A LOTY stands in place of the week's LOTW, so both flags move together.
    setPicks((prev) => ({
      ...prev,
      [gameId]: { ...prev[gameId], is_lotw: true, is_loty: level === "LOTY" },
    }));
  }, [picks]);

  const sportPickCount = (list: Game[]) => list.filter((g) => picks[g.id]).length;
  // Weeks seeded before the per-sport split existed carry null there; show nothing rather than 0.
  const sportTabs: { key: Sport; label: string; list: Game[]; required: number | null }[] = [
    { key: "NFL", label: "NFL", list: nflGames, required: week.required_nfl_picks },
    { key: "CFB", label: "CFB", list: cfbGames, required: week.required_cfb_picks },
  ];
  const shown = sportTabs.find((t) => t.key === sport)?.list ?? [];

  const weekLockGame = weekLock ? games.find((g) => g.id === weekLock.gameId) : undefined;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Week {week.week_number} Picks</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Closes {new Date(week.closes_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
          </p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold tabular-nums ${pickCount >= week.required_picks ? "text-emerald-400" : "text-white"}`}>
            {pickCount} / {week.required_picks}
          </div>
          <div className="text-xs font-medium text-slate-400">picks locked in</div>
          <div className={`text-xs font-semibold mt-1 ${weekLock ? "text-emerald-400" : "text-amber-400"}`}>
            {weekLock && weekLockGame
              ? `${weekLock.level === "LOTY" ? "👑" : "🔒"} ${LOCK_SHORT[weekLock.level]} · ${formatWager(weekLock.pick, weekLockGame)}`
              : "⚠ No LOTW yet"}
          </div>
          <div
            className={`text-xs font-semibold mt-0.5 ${lotySpent ? "text-slate-400" : "text-fuchsia-300"}`}
            title={lotyUsed?.matchup ?? undefined}
          >
            {lotySpent
              ? lotySpentHere
                ? "LOTY spent this week"
                : `LOTY spent · week ${lotyUsed?.week_number}`
              : "👑 LOTY available"}
          </div>
        </div>
      </div>

      {/* Sport toggle. Hidden when the week only has one sport to show. */}
      {nflGames.length > 0 && cfbGames.length > 0 && (
        <div
          role="radiogroup"
          aria-label="Sport"
          className="flex rounded-lg border border-slate-700 bg-slate-800/70 p-0.5 mb-4"
        >
          {sportTabs.map(({ key, label, list, required }) => {
            const active = sport === key;
            const made = sportPickCount(list);
            const done = required !== null && made >= required;
            return (
              <button
                key={key}
                role="radio"
                aria-checked={active}
                onClick={() => setSport(key)}
                className={`flex-1 text-sm px-3 py-2 rounded-md font-semibold transition-colors ${
                  active
                    ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/30"
                    : "text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
                }`}
              >
                {label}
                {required !== null && (
                  <span className={`ml-1.5 text-xs tabular-nums ${
                    active ? "text-slate-800" : done ? "text-emerald-400" : "text-slate-500"
                  }`}>
                    {made}/{required}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {pickCount < week.required_picks && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-200">
          You need {week.required_picks - pickCount} more pick{week.required_picks - pickCount !== 1 ? "s" : ""} to avoid forfeit penalties.
        </div>
      )}

      <div className="mb-4 p-3 bg-slate-800/60 border border-slate-700 rounded-lg text-xs text-slate-300 space-y-1">
        <p><span className="font-semibold text-white">Submitting locks a pick in.</span> Build the wager, then press Lock in pick — after that only the commissioner can change it.</p>
        <p>
          Pick <span className="font-semibold text-amber-300">LOTW</span> (×{LOCK_MULTIPLIER.LOTW}, one per week)
          {" or "}
          <span className="font-semibold text-fuchsia-300">LOTY</span> (×{LOCK_MULTIPLIER.LOTY}, one per season) under Lock before you submit,
          or raise a pick that&apos;s already in. A LOTY stands in for that week&apos;s LOTW, so spending it here uses up both.
        </p>
      </div>

      <div className="space-y-2">
        {shown.map((game) => {
          const pick = picks[game.id] ?? null;
          return (
            <GameCard
              key={game.id}
              game={game}
              pick={pick}
              market={marketLines[game.id]}
              kickedOff={isKickedOff(game)}
              busy={busy}
              error={errors[game.id] ?? errors[`lock-${game.id}`] ?? null}
              weekLockOnAnotherPick={weekLock !== null && weekLock.gameId !== game.id}
              lotyUsedThisSeason={lotySpent}
              onSubmit={submitPick}
              onLock={setLock}
            />
          );
        })}
      </div>
    </div>
  );
}

function GameCard({
  game, pick, market, kickedOff, busy, error, weekLockOnAnotherPick, lotyUsedThisSeason, onSubmit, onLock,
}: {
  game: Game;
  pick: PickInfo | null;
  market: GameMarket | undefined;
  kickedOff: boolean;
  busy: string | null;
  error: string | null;
  weekLockOnAnotherPick: boolean;
  lotyUsedThisSeason: boolean;
  onSubmit: (gameId: string, wager: Draft, lock: LockLevel) => void;
  onLock: (gameId: string, level: LockLevel) => void;
}) {
  const isSubmitting = busy === game.id;
  const isLocking = busy === `lock-${game.id}`;

  // Most of this league's history is spreads, so that is the cheapest default.
  const [betType, setBetType] = useState<BetType>("SPREAD");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [lineText, setLineText] = useState("");
  const [oddsText, setOddsText] = useState("");
  // The lock the member wants this pick to carry when it goes in.
  const [draftLock, setDraftLock] = useState<LockLevel>("NONE");
  // Spending the season's only LOTY takes two clicks. Nothing else here does.
  const [confirmLoty, setConfirmLoty] = useState(false);

  /** Switching bet type invalidates a selection that no longer belongs to it. */
  const changeBetType = (next: BetType) => {
    setBetType(next);
    if (selection && !SELECTIONS_FOR[next].includes(selection)) setSelection(null);
    if (next === "ML") setLineText("");
  };

  /** Take a book's number as the starting point; every field stays editable. */
  const fillFromMarket = (fill: MarketFill) => {
    setBetType(fill.bet_type);
    setSelection(fill.selection);
    setLineText(String(fill.line));
    setOddsText(formatOdds(fill.odds) ?? "");
  };

  const draft = buildDraft(betType, selection, lineText, oddsText);
  const showScores = game.status === "FINAL";
  const level = pick ? lockLevel(pick) : "NONE";

  const lockCtx = { current: level, weekLockOnAnotherPick, lotyUsedThisSeason };
  const lotwRefusal = lockUpgradeError("LOTW", lockCtx);
  const lotyRefusal = lockUpgradeError("LOTY", lockCtx);

  // A lock chosen in the form can stop being available while the member is still typing --
  // they lock another card, say -- so the draft's lock is only what the rules still allow.
  const chosenLock: LockLevel =
    draftLock === "LOTW" && lotwRefusal ? "NONE"
    : draftLock === "LOTY" && lotyRefusal ? "NONE"
    : draftLock;
  const lockOptions: { level: LockLevel; label: string; refusal: string | null }[] = [
    { level: "NONE", label: "No lock", refusal: null },
    { level: "LOTW", label: `LOTW ×${LOCK_MULTIPLIER.LOTW}`, refusal: lotwRefusal },
    { level: "LOTY", label: `LOTY ×${LOCK_MULTIPLIER.LOTY}`, refusal: lotyRefusal },
  ];
  const submitLabel =
    chosenLock === "LOTY" ? "Lock in as LOTY"
    : chosenLock === "LOTW" ? "Lock in as LOTW"
    : "Lock in pick";

  return (
    <div className={`bg-slate-900 border rounded-xl p-4 shadow-lg shadow-black/30 transition-opacity ${
      kickedOff ? "border-slate-700 opacity-60"
      : level === "LOTY" ? "border-fuchsia-500/70"
      : level === "LOTW" ? "border-amber-500/60"
      : "border-slate-700"
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-slate-400">
          {new Date(game.kickoff_time).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
          {" · "}
          {new Date(game.kickoff_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        {kickedOff ? (
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
            game.status === "FINAL"
              ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
              : "bg-slate-800 text-slate-300 ring-1 ring-slate-600"
          }`}>
            {game.status === "FINAL" ? "Final" : "Locked"}
          </span>
        ) : pick ? (
          <span className="text-xs px-2 py-0.5 rounded font-medium bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40">
            Locked in
          </span>
        ) : null}
      </div>

      {/* Matchup line, with scores once the game is final */}
      <div className="flex items-baseline justify-between gap-2 mb-3 text-sm">
        <span className="truncate">
          <span className="font-medium text-white">{game.away_team}</span>
          <span className="text-slate-500"> at </span>
          <span className="font-medium text-white">{game.home_team}</span>
        </span>
        {showScores && game.away_score !== null && game.home_score !== null && (
          <span className="tabular-nums font-semibold text-slate-200 shrink-0">
            {game.away_score}–{game.home_score}
          </span>
        )}
      </div>

      {/* The market, in every state: while composing it is a tap target, afterwards a reference. */}
      <MarketStrip
        game={game}
        market={market}
        selection={selection}
        onFill={!pick && !kickedOff ? fillFromMarket : undefined}
      />

      {pick ? (
        // Submitted. The wager itself is settled; only its lock can still be raised.
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-semibold text-white">{formatWager(pick, game, true)}</span>
            {level !== "NONE" && (
              <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                level === "LOTY"
                  ? "bg-fuchsia-400 text-slate-950"
                  : "bg-amber-400 text-slate-950"
              }`}>
                {level === "LOTY" ? "👑" : "🔒"} {LOCK_SHORT[level]} ×{LOCK_MULTIPLIER[level]}
              </span>
            )}
          </div>

          {!kickedOff && level !== "LOTY" && (
            <div className="flex items-center gap-2 flex-wrap">
              {level === "NONE" && (
                <button
                  onClick={() => onLock(game.id, "LOTW")}
                  disabled={isLocking || lotwRefusal !== null}
                  title={lotwRefusal ?? undefined}
                  className={`text-xs px-2.5 py-1 rounded-md font-semibold border transition-colors ${
                    lotwRefusal
                      ? "text-slate-500 bg-slate-800/60 border-slate-700 cursor-not-allowed"
                      : "text-amber-300 bg-amber-500/10 border-amber-500/60 hover:bg-amber-500/25 hover:text-amber-200 cursor-pointer"
                  }`}
                >
                  {isLocking ? "…" : `Make LOTW ×${LOCK_MULTIPLIER.LOTW}`}
                </button>
              )}

              {confirmLoty ? (
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-fuchsia-200 font-medium">Spend your only LOTY here?</span>
                  <button
                    onClick={() => { setConfirmLoty(false); onLock(game.id, "LOTY"); }}
                    disabled={isLocking}
                    className="px-2.5 py-1 rounded-md font-bold bg-fuchsia-400 text-slate-950 hover:bg-fuchsia-300 cursor-pointer"
                  >
                    {isLocking ? "…" : "Yes, lock it"}
                  </button>
                  <button
                    onClick={() => setConfirmLoty(false)}
                    className="px-2 py-1 rounded-md font-semibold text-slate-300 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmLoty(true)}
                  disabled={isLocking || lotyRefusal !== null}
                  title={lotyRefusal ?? undefined}
                  className={`text-xs px-2.5 py-1 rounded-md font-semibold border transition-colors ${
                    lotyRefusal
                      ? "text-slate-500 bg-slate-800/60 border-slate-700 cursor-not-allowed"
                      : "text-fuchsia-200 bg-fuchsia-500/10 border-fuchsia-500/60 hover:bg-fuchsia-500/25 cursor-pointer"
                  }`}
                >
                  {level === "LOTW" ? `Upgrade to LOTY ×${LOCK_MULTIPLIER.LOTY}` : `Make LOTY ×${LOCK_MULTIPLIER.LOTY}`}
                </button>
              )}

              {/* Why a button is dead, said once rather than only in a tooltip. */}
              {lotwRefusal && lotyRefusal && (
                <span className="text-xs text-slate-400">{level === "NONE" ? lotwRefusal : lotyRefusal}</span>
              )}
            </div>
          )}

          {pick.overridden_by && (
            <p className="text-xs text-orange-400">
              Modified by admin{pick.overridden_at ? ` · ${new Date(pick.overridden_at).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
            </p>
          )}
        </div>
      ) : kickedOff ? (
        <div className="text-sm text-slate-400">No pick</div>
      ) : (
        <div className="space-y-2">
          {/* Bet type */}
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800/70 p-0.5">
            {BET_TYPES.map((bt) => (
              <button
                key={bt}
                onClick={() => changeBetType(bt)}
                className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-colors ${
                  betType === bt
                    ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/30"
                    : "text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                {BET_TYPE_LABELS[bt]}
              </button>
            ))}
          </div>

          {/* Selection */}
          <div className="grid grid-cols-2 gap-2">
            {SELECTIONS_FOR[betType].map((side) => {
              const label =
                side === "HOME" ? game.home_team
                : side === "AWAY" ? game.away_team
                : side === "OVER" ? "Over"
                : "Under";
              const selected = selection === side;
              return (
                <button
                  key={side}
                  onClick={() => setSelection(side)}
                  disabled={isSubmitting}
                  className={`py-2.5 px-3 rounded-lg border-2 text-sm font-semibold text-left transition-all truncate ${
                    selected
                      ? "border-sky-400 bg-sky-500/25 text-sky-100 shadow-lg shadow-sky-500/20"
                      : "border-slate-700 bg-slate-800 text-slate-100 hover:border-sky-400 hover:bg-sky-500/15 hover:text-white cursor-pointer"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Line + price */}
          <div className="flex gap-2">
            {betType !== "ML" && (
              <div className="flex-1 min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-300 mb-1">
                  {betType === "TOTAL" ? "Total" : "Spread"}
                </span>
                {betType === "TOTAL" ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Total"
                    value={lineText}
                    onChange={(e) => setLineText(e.target.value)}
                    placeholder="52.5"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-sm text-white tabular-nums focus:border-sky-400 focus:outline-none"
                  />
                ) : (
                  <SignedInput label="Spread" inputMode="decimal" value={lineText} onChange={setLineText} placeholder="3.5" />
                )}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-300 mb-1">Optional</span>
              <SignedInput label="Price" inputMode="numeric" value={oddsText} onChange={setOddsText} placeholder="110" />
            </div>
          </div>

          {/* Lock. Chosen alongside the wager so the LOTW goes in with the pick, not as a
              second step afterwards. Options the rules refuse stay visible but dead, with
              the reason as their tooltip and, once, in text. */}
          {selection && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Lock</span>
              <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800/70 p-0.5">
                {lockOptions.map(({ level: opt, label, refusal }) => {
                  const active = chosenLock === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => { setDraftLock(opt); setConfirmLoty(false); }}
                      disabled={isSubmitting || refusal !== null}
                      title={refusal ?? undefined}
                      className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-colors ${
                        refusal
                          ? "text-slate-500 cursor-not-allowed"
                          : active && opt === "LOTY"
                          ? "bg-fuchsia-400 text-slate-950 shadow-md shadow-fuchsia-500/30"
                          : active && opt === "LOTW"
                          ? "bg-amber-400 text-slate-950 shadow-md shadow-amber-500/30"
                          : active
                          ? "bg-slate-600 text-white"
                          : "text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
                      }`}
                    >
                      {opt === "LOTY" ? "👑 " : opt === "LOTW" ? "🔒 " : ""}{label}
                    </button>
                  );
                })}
              </div>
              {lotwRefusal && lotyRefusal && (
                <span className="text-xs text-slate-400">{lotwRefusal}</span>
              )}
            </div>
          )}

          {/* Submit. Appears with the first selection — nothing to submit before that — and
              stays disabled, with the reason beside it, until the wager is complete. A LOTY
              asks once more before it goes, the same as raising one afterwards does. */}
          {selection && confirmLoty && draft && (
            <div className="flex items-center gap-2 flex-wrap text-xs pt-0.5">
              <span className="text-fuchsia-200 font-medium">Spend your only LOTY on {formatWager(draft, game, true)}?</span>
              <button
                onClick={() => { setConfirmLoty(false); onSubmit(game.id, draft, "LOTY"); }}
                disabled={isSubmitting}
                className="px-2.5 py-1 rounded-md font-bold bg-fuchsia-400 text-slate-950 hover:bg-fuchsia-300 cursor-pointer"
              >
                {isSubmitting ? "Locking in…" : "Yes, lock it in"}
              </button>
              <button
                onClick={() => setConfirmLoty(false)}
                className="px-2 py-1 rounded-md font-semibold text-slate-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
          {selection && !confirmLoty && (
            <div className="flex items-center gap-3 pt-0.5">
              <button
                onClick={() => {
                  if (!draft) return;
                  if (chosenLock === "LOTY") setConfirmLoty(true);
                  else onSubmit(game.id, draft, chosenLock);
                }}
                disabled={!draft || isSubmitting}
                className={`px-3.5 py-2 rounded-lg text-sm font-bold transition-colors ${
                  !draft || isSubmitting
                    ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                    : chosenLock === "LOTY"
                    ? "bg-fuchsia-400 text-slate-950 hover:bg-fuchsia-300 shadow-md shadow-fuchsia-500/30 cursor-pointer"
                    : chosenLock === "LOTW"
                    ? "bg-amber-400 text-slate-950 hover:bg-amber-300 shadow-md shadow-amber-500/30 cursor-pointer"
                    : "bg-sky-500 text-slate-950 hover:bg-sky-400 shadow-md shadow-sky-500/30 cursor-pointer"
                }`}
              >
                {isSubmitting ? "Locking in…" : submitLabel}
              </button>
              <span className="text-xs">
                {draft ? (
                  <span className="text-sky-300 font-semibold">
                    {formatWager(draft, game, true)}
                    {chosenLock !== "NONE" && ` · ${LOCK_SHORT[chosenLock]} ×${LOCK_MULTIPLIER[chosenLock]}`}
                    {" — final once submitted"}
                  </span>
                ) : (
                  <span className="text-slate-400">
                    {betType === "TOTAL"
                      ? "Enter the total"
                      : betType === "SPREAD"
                      ? "Enter the spread"
                      : "Check the price"}
                  </span>
                )}
              </span>
            </div>
          )}

          {!selection && (
            <p className="text-xs text-slate-400">Pick a side to submit this game.</p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs font-medium text-red-400">{error}</p>}
    </div>
  );
}

/**
 * DK and FD's current spread and total. The spread reads from the home team's side, said
 * once in the header rather than on every row. With `onFill` each cell is a button that
 * loads that book's number into the form; without it the strip is plain text.
 */
function MarketStrip({ game, market, selection, onFill }: {
  game: Game;
  market: GameMarket | undefined;
  selection: Selection | null;
  onFill?: (fill: MarketFill) => void;
}) {
  const books = DISPLAY_BOOKS.filter((b) => market?.[b]);
  if (books.length === 0) {
    return onFill ? <p className="text-xs text-slate-500 mb-3">No lines posted yet.</p> : null;
  }

  // A tapped spread goes to the side already chosen, else to the favourite; a tapped
  // total to Under only when Under is already chosen.
  const spreadSide = (spread: BookSpread) =>
    selection === "HOME" || selection === "AWAY" ? selection : favouredSide(spread);
  const totalSide = selection === "UNDER" ? "UNDER" : "OVER";

  const cols = "grid grid-cols-[2rem_1fr_1fr] gap-x-2";

  // The freshest of the books' own timestamps, shown once for the whole strip.
  const updatedAt = books
    .map((b) => market?.[b]?.updated_at ?? null)
    .filter((t): t is string => t !== null)
    .sort()
    .at(-1);

  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 px-2.5 py-1.5 mb-3 text-xs">
      <div className={`${cols} text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5`}>
        <span>Book</span>
        <span className="truncate">{game.home_team}</span>
        <span>Total</span>
      </div>
      {DISPLAY_BOOKS.map((book) => {
        const lines = market?.[book];
        const spread = lines?.spread ?? null;
        const total = lines?.total ?? null;
        return (
          <div key={book} className={`${cols} items-center tabular-nums`}>
            <span className="font-semibold text-slate-300">{BOOK_LABELS[book]}</span>
            {spread ? (
              <MarketCell
                text={formatSpreadCell(spread)}
                onClick={onFill && (() => onFill(spreadFill(spread, spreadSide(spread))))}
              />
            ) : (
              <span className="text-slate-600">—</span>
            )}
            {total ? (
              <MarketCell
                text={formatTotalCell(total)}
                onClick={onFill && (() => onFill(totalFill(total, totalSide)))}
              />
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </div>
        );
      })}
      {updatedAt && (
        <div className="text-right text-[10px] text-slate-500 mt-0.5">
          Updated {formatUpdatedAt(updatedAt)}
        </div>
      )}
    </div>
  );
}

/** "Sat 9:41 AM" -- the day matters once a line is a few days old. */
function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { weekday: "short" })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function MarketCell({ text, onClick }: { text: string; onClick?: () => void }) {
  if (!onClick) return <span className="text-slate-200">{text}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Use this line"
      className="text-left text-slate-200 hover:text-sky-300 cursor-pointer transition-colors"
    >
      {text}
    </button>
  );
}
