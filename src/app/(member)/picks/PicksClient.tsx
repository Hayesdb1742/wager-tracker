"use client";

import { useState, useCallback, useMemo } from "react";
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
  type Selection,
} from "@/lib/wagers";

type Week = { id: number; week_number: number; required_picks: number; closes_at: string };
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

type Draft = { bet_type: BetType; selection: Selection; line: number; odds: number | null };

/** Where an earlier week's Lock of the Year went, when one has already been spent. */
type LotyUsed = { week_number: number; matchup: string | null } | null;

interface Props {
  week: Week;
  games: Game[];
  initialPickMap: Record<string, PickInfo>;
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

export function PicksClient({ week, games, initialPickMap, lotyUsed }: Props) {
  const [picks, setPicks] = useState(initialPickMap);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const submitPick = useCallback(async (gameId: string, wager: Draft) => {
    setBusy(gameId);
    setErrors((e) => { const n = { ...e }; delete n[gameId]; return n; });

    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game_id: gameId, ...wager }),
    });
    const data = await res.json();
    setBusy(null);

    if (!res.ok) {
      setErrors((e) => ({ ...e, [gameId]: data.message ?? data.error }));
      return;
    }

    setPicks((prev) => ({
      ...prev,
      [gameId]: {
        id: data.id,
        bet_type: wager.bet_type,
        selection: wager.selection,
        line: wager.line,
        odds: wager.odds,
        is_lotw: false,
        is_loty: false,
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

  const cfbGames = games.filter((g) => g.sport === "CFB");
  const nflGames = games.filter((g) => g.sport === "NFL");

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

      {pickCount < week.required_picks && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-200">
          You need {week.required_picks - pickCount} more pick{week.required_picks - pickCount !== 1 ? "s" : ""} to avoid forfeit penalties.
        </div>
      )}

      <div className="mb-4 p-3 bg-slate-800/60 border border-slate-700 rounded-lg text-xs text-slate-300 space-y-1">
        <p><span className="font-semibold text-white">Submitting locks a pick in.</span> Build the wager, then press Lock in pick — after that only the commissioner can change it.</p>
        <p>
          Once a pick is in you can raise it to a <span className="font-semibold text-amber-300">Lock of the Week</span> (×{LOCK_MULTIPLIER.LOTW}, one per week)
          {" or a "}
          <span className="font-semibold text-fuchsia-300">Lock of the Year</span> (×{LOCK_MULTIPLIER.LOTY}, one per season).
          A LOTY stands in for that week&apos;s LOTW, so spending it here uses up both.
        </p>
      </div>

      {[{ label: "NFL", list: nflGames }, { label: "College Football", list: cfbGames }].map(({ label, list }) =>
        list.length === 0 ? null : (
          <div key={label} className="mb-6">
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-2">{label}</h2>
            <div className="space-y-2">
              {list.map((game) => {
                const pick = picks[game.id] ?? null;
                return (
                  <GameCard
                    key={game.id}
                    game={game}
                    pick={pick}
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
        )
      )}
    </div>
  );
}

function GameCard({
  game, pick, kickedOff, busy, error, weekLockOnAnotherPick, lotyUsedThisSeason, onSubmit, onLock,
}: {
  game: Game;
  pick: PickInfo | null;
  kickedOff: boolean;
  busy: string | null;
  error: string | null;
  weekLockOnAnotherPick: boolean;
  lotyUsedThisSeason: boolean;
  onSubmit: (gameId: string, wager: Draft) => void;
  onLock: (gameId: string, level: LockLevel) => void;
}) {
  const isSubmitting = busy === game.id;
  const isLocking = busy === `lock-${game.id}`;

  // Most of this league's history is spreads, so that is the cheapest default.
  const [betType, setBetType] = useState<BetType>("SPREAD");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [lineText, setLineText] = useState("");
  const [oddsText, setOddsText] = useState("");
  // Spending the season's only LOTY takes two clicks. Nothing else here does.
  const [confirmLoty, setConfirmLoty] = useState(false);

  /** Switching bet type invalidates a selection that no longer belongs to it. */
  const changeBetType = (next: BetType) => {
    setBetType(next);
    if (selection && !SELECTIONS_FOR[next].includes(selection)) setSelection(null);
    if (next === "ML") setLineText("");
  };

  const draft = buildDraft(betType, selection, lineText, oddsText);
  const showScores = game.status === "FINAL";
  const level = pick ? lockLevel(pick) : "NONE";

  const lockCtx = { current: level, weekLockOnAnotherPick, lotyUsedThisSeason };
  const lotwRefusal = lockUpgradeError("LOTW", lockCtx);
  const lotyRefusal = lockUpgradeError("LOTY", lockCtx);

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
              <label className="flex-1">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-300 mb-1">
                  {betType === "TOTAL" ? "Total" : "Spread"}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={lineText}
                  onChange={(e) => setLineText(e.target.value)}
                  placeholder={betType === "TOTAL" ? "52.5" : "-3.5"}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-sm text-white tabular-nums focus:border-sky-400 focus:outline-none"
                />
              </label>
            )}
            <label className="flex-1">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-300 mb-1">Optional</span>
              <input
                type="text"
                inputMode="numeric"
                value={oddsText}
                onChange={(e) => setOddsText(e.target.value)}
                placeholder="-110"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-sm text-white tabular-nums focus:border-sky-400 focus:outline-none"
              />
            </label>
          </div>

          {/* Submit. Appears with the first selection — nothing to submit before that — and
              stays disabled, with the reason beside it, until the wager is complete. */}
          {selection && (
            <div className="flex items-center gap-3 pt-0.5">
              <button
                onClick={() => draft && onSubmit(game.id, draft)}
                disabled={!draft || isSubmitting}
                className={`px-3.5 py-2 rounded-lg text-sm font-bold transition-colors ${
                  draft && !isSubmitting
                    ? "bg-sky-500 text-slate-950 hover:bg-sky-400 shadow-md shadow-sky-500/30 cursor-pointer"
                    : "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                }`}
              >
                {isSubmitting ? "Locking in…" : "Lock in pick"}
              </button>
              <span className="text-xs">
                {draft ? (
                  <span className="text-sky-300 font-semibold">{formatWager(draft, game, true)} — final once submitted</span>
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
