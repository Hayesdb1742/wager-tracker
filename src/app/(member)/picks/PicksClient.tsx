"use client";

import { useState, useCallback } from "react";

type Week = { id: number; week_number: number; required_picks: number; closes_at: string };
type Game = {
  id: string; sport: string; home_team: string; away_team: string;
  kickoff_time: string; status: string; in_pool: boolean;
  home_score: number | null; away_score: number | null; winner: string | null;
};
type PickInfo = { id: string; picked_team: string; is_lotw: boolean; overridden_by: string | null; overridden_at: string | null };

interface Props {
  week: Week;
  games: Game[];
  initialPickMap: Record<string, PickInfo>;
  memberId: string;
}

export function PicksClient({ week, games, initialPickMap }: Props) {
  const [picks, setPicks] = useState(initialPickMap);
  const [saving, setSaving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isLocked = (game: Game) => new Date(game.kickoff_time) <= new Date();
  const pickCount = Object.keys(picks).length;
  const lotwPick = Object.values(picks).find((p) => p.is_lotw);

  const savePick = useCallback(async (gameId: string, pickedTeam: string) => {
    setSaving(gameId);
    setErrors((e) => { const n = { ...e }; delete n[gameId]; return n; });

    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game_id: gameId, picked_team: pickedTeam }),
    });
    const data = await res.json();
    setSaving(null);

    if (!res.ok) {
      setErrors((e) => ({ ...e, [gameId]: data.message ?? data.error }));
      return;
    }

    setPicks((prev) => ({
      ...prev,
      [gameId]: { id: data.id, picked_team: pickedTeam, is_lotw: prev[gameId]?.is_lotw ?? false, overridden_by: null, overridden_at: null },
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
          <p className="text-sm text-gray-500 mt-0.5">
            Closes {new Date(week.closes_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
          </p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold tabular-nums ${pickCount >= week.required_picks ? "text-green-600" : "text-gray-800"}`}>
            {pickCount} / {week.required_picks}
          </div>
          <div className="text-xs text-gray-400">picks made</div>
          <div className={`text-xs mt-1 ${lotwPick ? "text-green-600" : "text-amber-600"}`}>
            {lotwPick ? "🔒 LOTW set" : "⚠ No LOTW"}
          </div>
        </div>
      </div>

      {pickCount < week.required_picks && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          You need {week.required_picks - pickCount} more pick{week.required_picks - pickCount !== 1 ? "s" : ""} to avoid forfeit penalties.
        </div>
      )}

      {[{ label: "NFL", list: nflGames }, { label: "College Football", list: cfbGames }].map(({ label, list }) =>
        list.length === 0 ? null : (
          <div key={label} className="mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">{label}</h2>
            <div className="space-y-2">
              {list.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  pick={picks[game.id] ?? null}
                  locked={isLocked(game)}
                  saving={saving}
                  error={errors[game.id] ?? errors[`lotw-${game.id}`] ?? null}
                  onPick={savePick}
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

function GameCard({ game, pick, locked, saving, error, onPick, onLotw }: {
  game: Game;
  pick: PickInfo | null;
  locked: boolean;
  saving: string | null;
  error: string | null;
  onPick: (gameId: string, team: string) => void;
  onLotw: (gameId: string) => void;
}) {
  const isSaving = saving === game.id;
  const isLotwSaving = saving === `lotw-${game.id}`;

  return (
    <div className={`bg-white border rounded-xl p-4 transition-opacity ${locked ? "opacity-75" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-gray-400">
          {new Date(game.kickoff_time).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
          {" · "}
          {new Date(game.kickoff_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        {locked && (
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
            game.status === "FINAL" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}>
            {game.status === "FINAL" ? "Final" : "Locked"}
          </span>
        )}
        {!locked && pick && (
          <button
            onClick={() => onLotw(game.id)}
            disabled={isLotwSaving || locked}
            className={`text-xs px-2 py-0.5 rounded font-medium border transition-colors ${
              pick.is_lotw
                ? "bg-amber-500 text-white border-amber-500"
                : "text-amber-600 border-amber-300 hover:bg-amber-50"
            }`}
          >
            {isLotwSaving ? "…" : pick.is_lotw ? "🔒 LOTW" : "Set as LOTW"}
          </button>
        )}
        {!locked && pick && pick.is_lotw && (
          <span className="ml-2 text-xs text-amber-600">Lock of the Week</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["AWAY", "HOME"] as const).map((side) => {
          const team = side === "HOME" ? game.home_team : game.away_team;
          const score = side === "HOME" ? game.home_score : game.away_score;
          const showScore = game.status === "FINAL" && score !== null;
          const won = game.status === "FINAL" && game.winner === side;
          const selected = pick?.picked_team === side;
          return (
            <button
              key={side}
              onClick={() => !locked && onPick(game.id, side)}
              disabled={locked || isSaving}
              className={`py-3 px-4 rounded-lg border-2 text-sm font-medium text-left transition-all ${
                selected
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : locked
                  ? "border-gray-100 bg-gray-50 text-gray-400 cursor-default"
                  : "border-gray-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer"
              }`}
            >
              <div className="text-xs text-gray-400 mb-0.5">{side === "HOME" ? "Home" : "Away"}</div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{team}</span>
                {showScore && (
                  <span className={`tabular-nums font-semibold shrink-0 ${won ? "text-green-600" : "text-gray-400"}`}>
                    {score}
                  </span>
                )}
              </div>
              {selected && <div className="text-xs text-blue-500 mt-0.5">✓ Your pick</div>}
              {selected && pick?.overridden_by && (
                <div className="text-xs text-orange-500 mt-0.5">
                  Modified by admin{pick.overridden_at ? ` · ${new Date(pick.overridden_at).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {isSaving && <p className="mt-2 text-xs text-gray-400">Saving…</p>}
    </div>
  );
}
