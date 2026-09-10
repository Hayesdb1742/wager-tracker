"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  BET_TYPES,
  BET_TYPE_LABELS,
  SELECTIONS_FOR,
  formatWager,
  type BetType,
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
  overridden_by: string | null;
  overridden_at: string | null;
};

type Draft = { bet_type: BetType; selection: Selection; line: number; odds: number | null };

interface Props {
  week: Week;
  games: Game[];
  initialPickMap: Record<string, PickInfo>;
  memberId: string;
}

/** Identity of a wager, so a save only fires when something actually changed. */
function signature(w: { bet_type: string; selection: string; line: number; odds: number | null }) {
  return `${w.bet_type}|${w.selection}|${w.line}|${w.odds ?? ""}`;
}

/**
 * Parse a line the member is still typing. Returns null for anything incomplete — a lone
 * "-", a trailing "3." — so a half-typed number is never persisted.
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

export function PicksClient({ week, games, initialPickMap }: Props) {
  const [picks, setPicks] = useState(initialPickMap);
  const [saving, setSaving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isLocked = (game: Game) => new Date(game.kickoff_time) <= new Date();
  const pickCount = Object.keys(picks).length;
  const lotwPick = Object.values(picks).find((p) => p.is_lotw);

  const savePick = useCallback(async (gameId: string, wager: Draft) => {
    setSaving(gameId);
    setErrors((e) => { const n = { ...e }; delete n[gameId]; return n; });

    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game_id: gameId, ...wager }),
    });
    const data = await res.json();
    setSaving(null);

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
        is_lotw: prev[gameId]?.is_lotw ?? false,
        overridden_by: null,
        overridden_at: null,
      },
    }));
  }, []);

  const saveLotw = useCallback(async (gameId: string) => {
    const pick = picks[gameId];
    if (!pick) return;

    setSaving(`lotw-${gameId}`);
    const res = await fetch("/api/picks/lotw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pick_id: pick.id, week_id: week.id }),
    });
    const data = await res.json();
    setSaving(null);

    if (!res.ok) {
      setErrors((e) => ({ ...e, [`lotw-${gameId}`]: data.message ?? data.error }));
      return;
    }

    setPicks((prev) => {
      const next = { ...prev };
      for (const gid of Object.keys(next)) next[gid] = { ...next[gid], is_lotw: false };
      next[gameId] = { ...next[gameId], is_lotw: true };
      return next;
    });
  }, [picks, week.id]);

  const cfbGames = games.filter((g) => g.sport === "CFB");
  const nflGames = games.filter((g) => g.sport === "NFL");

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
          <div className="text-xs font-medium text-slate-400">picks made</div>
          <div className={`text-xs font-semibold mt-1 ${lotwPick ? "text-emerald-400" : "text-amber-400"}`}>
            {lotwPick ? "🔒 LOTW set" : "⚠ No LOTW"}
          </div>
        </div>
      </div>

      {pickCount < week.required_picks && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-200">
          You need {week.required_picks - pickCount} more pick{week.required_picks - pickCount !== 1 ? "s" : ""} to avoid forfeit penalties.
        </div>
      )}

      {[{ label: "NFL", list: nflGames }, { label: "College Football", list: cfbGames }].map(({ label, list }) =>
        list.length === 0 ? null : (
          <div key={label} className="mb-6">
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-2">{label}</h2>
            <div className="space-y-2">
              {list.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  pick={picks[game.id] ?? null}
                  locked={isLocked(game)}
                  saving={saving}
                  error={errors[game.id] ?? errors[`lotw-${game.id}`] ?? null}
                  onSave={savePick}
                  onLotw={saveLotw}
                />
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function GameCard({ game, pick, locked, saving, error, onSave, onLotw }: {
  game: Game;
  pick: PickInfo | null;
  locked: boolean;
  saving: string | null;
  error: string | null;
  onSave: (gameId: string, wager: Draft) => void;
  onLotw: (gameId: string) => void;
}) {
  const isSaving = saving === game.id;
  const isLotwSaving = saving === `lotw-${game.id}`;

  // Most of this league's history is spreads, so that is the cheapest default.
  const [betType, setBetType] = useState<BetType>((pick?.bet_type as BetType) ?? "SPREAD");
  const [selection, setSelection] = useState<Selection | null>(
    (pick?.selection as Selection) ?? null
  );
  const [lineText, setLineText] = useState(
    pick && pick.bet_type !== "ML" ? String(pick.line) : ""
  );
  const [oddsText, setOddsText] = useState(pick?.odds != null ? String(pick.odds) : "");

  const savedSig = useRef<string | null>(pick ? signature(pick) : null);

  // Persist once the wager is complete and valid, debounced — never mid-keystroke.
  useEffect(() => {
    if (locked) return;
    const draft = buildDraft(betType, selection, lineText, oddsText);
    if (!draft) return;

    const sig = signature(draft);
    if (sig === savedSig.current) return;

    const timer = setTimeout(() => {
      savedSig.current = sig;
      onSave(game.id, draft);
    }, 600);
    return () => clearTimeout(timer);
  }, [betType, selection, lineText, oddsText, locked, game.id, onSave]);

  /** Switching bet type invalidates a selection that no longer belongs to it. */
  const changeBetType = (next: BetType) => {
    setBetType(next);
    if (selection && !SELECTIONS_FOR[next].includes(selection)) setSelection(null);
    if (next === "ML") setLineText("");
  };

  const draft = buildDraft(betType, selection, lineText, oddsText);
  const showScores = game.status === "FINAL";

  return (
    <div className={`bg-slate-900 border border-slate-700 rounded-xl p-4 shadow-lg shadow-black/30 transition-opacity ${locked ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-slate-400">
          {new Date(game.kickoff_time).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
          {" · "}
          {new Date(game.kickoff_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        {locked && (
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
            game.status === "FINAL"
              ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
              : "bg-slate-800 text-slate-300 ring-1 ring-slate-600"
          }`}>
            {game.status === "FINAL" ? "Final" : "Locked"}
          </span>
        )}
        {!locked && pick && (
          <button
            onClick={() => onLotw(game.id)}
            disabled={isLotwSaving || locked}
            className={`text-xs px-2.5 py-1 rounded-md font-semibold border transition-colors ${
              pick.is_lotw
                ? "bg-amber-400 text-slate-950 border-amber-400 shadow-md shadow-amber-500/30"
                : "text-amber-300 bg-amber-500/10 border-amber-500/60 hover:bg-amber-500/25 hover:text-amber-200"
            }`}
          >
            {isLotwSaving ? "…" : pick.is_lotw ? "🔒 LOTW" : "Set as LOTW"}
          </button>
        )}
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

      {locked ? (
        <div className="text-sm">
          {pick ? (
            <span className="font-semibold text-white">
              {formatWager(pick, game, true)}
              {pick.is_lotw && <span className="ml-1.5 text-xs font-semibold text-amber-400">LOTW</span>}
            </span>
          ) : (
            <span className="text-slate-400">No pick</span>
          )}
        </div>
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
                  disabled={isSaving}
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

          {/* What will be saved */}
          <div className="text-xs">
            {draft ? (
              <span className="font-semibold text-sky-300">✓ {formatWager(draft, game, true)}</span>
            ) : (
              <span className="text-slate-400">
                {!selection
                  ? "Pick a side"
                  : betType === "TOTAL"
                  ? "Enter the total"
                  : betType === "SPREAD"
                  ? "Enter the spread"
                  : "Check the price"}
              </span>
            )}
            {pick?.overridden_by && (
              <span className="ml-2 text-orange-400">
                Modified by admin{pick.overridden_at ? ` · ${new Date(pick.overridden_at).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
              </span>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-medium text-red-400">{error}</p>}
      {isSaving && <p className="mt-2 text-xs text-slate-400">Saving…</p>}
    </div>
  );
}
