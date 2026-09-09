"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatWager, wagerResult, GRADE_LABELS } from "@/lib/wagers";

type Week = { id: number; week_number: number; status: string };

type MemberScore = {
  member_id: string;
  display_name: string;
  pick_points: number;
  forfeit_penalty: number;
  lotw_penalty: number;
  total: number;
};

type GameInfo = {
  id: string;
  sport: string;
  home_team: string;
  away_team: string;
  kickoff_time: string;
  status: string;
  winner: string | null;
  home_score: number | null;
  away_score: number | null;
};

type PickInfo = {
  member_id: string;
  game_id: string;
  bet_type: string;
  selection: string;
  line: number;
  odds: number | null;
  is_lotw: boolean;
  points: number | null;
};

type SeasonEntry = {
  member_id: string;
  display_name: string;
  season_total: number;
  weeks: Record<number, number>;
};

interface Props {
  weeks: Week[];
  defaultWeekId: number | null;
  openWeekId: number | null;
  initialScores: MemberScore[];
  initialGames: GameInfo[];
  initialPicks: PickInfo[];
  seasonStandings: SeasonEntry[];
  closedWeekIds: number[];
}

export function LeaderboardClient({
  weeks,
  defaultWeekId,
  openWeekId,
  initialScores,
  initialGames,
  initialPicks,
  seasonStandings,
  closedWeekIds,
}: Props) {
  const [tab, setTab] = useState<"weekly" | "season">("weekly");
  const [selectedWeekId, setSelectedWeekId] = useState(defaultWeekId);
  const [scores, setScores] = useState(initialScores);
  const [games, setGames] = useState(initialGames);
  const [picks, setPicks] = useState(initialPicks);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);

  const fetchWeek = useCallback(async (weekId: number) => {
    setLoadingWeek(true);
    try {
      const res = await fetch(`/api/leaderboard/week/${weekId}`);
      if (!res.ok) return;
      const data = await res.json();
      setScores(data.scores);
      setGames(data.games);
      setPicks(data.picks);
    } finally {
      setLoadingWeek(false);
    }
  }, []);

  // Realtime: update scores live when resolve_game fires (open week only).
  // selectedWeekId must stay in the dependency list -- without it the handler
  // keeps the value from the render that opened the channel, which is always
  // the open week (page.tsx defaults to it), so the guard below reads true
  // forever and a member browsing a past week gets their view replaced by the
  // open week's data.
  useEffect(() => {
    if (!openWeekId) return;

    const supabase = createClient();
    const channel = supabase
      .channel("leaderboard-scores")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "weekly_scores", filter: `week_id=eq.${openWeekId}` },
        () => {
          // Refetch the full week data on any change
          if (selectedWeekId === openWeekId) fetchWeek(openWeekId);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [openWeekId, selectedWeekId, fetchWeek]);

  const handleWeekChange = useCallback(async (weekId: number) => {
    setSelectedWeekId(weekId);
    setExpandedMember(null);
    if (weekId === defaultWeekId) {
      setScores(initialScores);
      setGames(initialGames);
      setPicks(initialPicks);
    } else {
      await fetchWeek(weekId);
    }
  }, [defaultWeekId, fetchWeek, initialScores, initialGames, initialPicks]);

  const selectedWeek = weeks.find((w) => w.id === selectedWeekId);

  // Per-member pick results for the weekly detail view
  const picksByMember = (memberId: string) =>
    picks.filter((p) => p.member_id === memberId);

  const gamesById = Object.fromEntries(games.map((g) => [g.id, g]));

  // Wins/losses/pushes from picks
  const resultCounts = (memberId: string) => {
    const mp = picksByMember(memberId);
    const wins = mp.filter((p) => p.points !== null && p.points > 0).length;
    const losses = mp.filter((p) => p.points !== null && p.points < 0).length;
    const pushes = mp.filter((p) => p.points === 0).length;
    const hasLotw = mp.some((p) => p.is_lotw);
    return { wins, losses, pushes, hasLotw };
  };

  const rankedScores = [...scores].sort(
    (a, b) => b.total - a.total || a.display_name.localeCompare(b.display_name)
  );

  return (
    <div>
      {/* Header + tabs */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(["weekly", "season"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                tab === t ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "weekly" && (
        <>
          {/* Week selector */}
          <div className="flex items-center gap-3 mb-4">
            <select
              value={selectedWeekId ?? ""}
              onChange={(e) => handleWeekChange(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
            >
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  Week {w.week_number}
                  {w.status === "OPEN" ? " (current)" : ""}
                </option>
              ))}
            </select>
            {selectedWeek?.status === "OPEN" && (
              <span className="text-xs text-green-600 font-medium">
                Live — updates in real time
              </span>
            )}
            {loadingWeek && <span className="text-xs text-gray-400">Loading…</span>}
          </div>

          {rankedScores.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              No scores yet for this week.
            </div>
          ) : (
            <div className="space-y-2">
              {rankedScores.map((member, idx) => {
                const { wins, losses, pushes, hasLotw } = resultCounts(member.member_id);
                const isExpanded = expandedMember === member.member_id;
                const memberPicks = picksByMember(member.member_id);

                return (
                  <div key={member.member_id} className="bg-white border rounded-xl overflow-hidden">
                    {/* Score row */}
                    <button
                      className="w-full text-left"
                      onClick={() => setExpandedMember(isExpanded ? null : member.member_id)}
                    >
                      <div className="flex items-center gap-3 px-4 py-3">
                        {/* Rank */}
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          idx === 0 ? "bg-amber-400 text-white" :
                          idx === 1 ? "bg-gray-300 text-gray-700" :
                          idx === 2 ? "bg-amber-700 text-white" :
                          "bg-gray-100 text-gray-500"
                        }`}>
                          {idx + 1}
                        </div>

                        {/* Name + badges */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900 truncate">{member.display_name}</span>
                            {hasLotw && (
                              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium shrink-0">
                                LOTW
                              </span>
                            )}
                          </div>
                          {(wins > 0 || losses > 0 || pushes > 0) && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              {wins}W–{losses}L{pushes > 0 ? `–${pushes}P` : ""}
                            </div>
                          )}
                        </div>

                        {/* Score breakdown + total */}
                        <div className="text-right shrink-0">
                          <div className="text-xl font-bold tabular-nums text-gray-900">
                            {member.total > 0 ? `+${member.total}` : member.total}
                          </div>
                          {(member.forfeit_penalty < 0 || member.lotw_penalty < 0) && (
                            <div className="text-xs text-red-500 tabular-nums">
                              {member.forfeit_penalty < 0 && `${member.forfeit_penalty} forfeit`}
                              {member.forfeit_penalty < 0 && member.lotw_penalty < 0 && " · "}
                              {member.lotw_penalty < 0 && `${member.lotw_penalty} LOTW`}
                            </div>
                          )}
                        </div>

                        <div className="text-gray-300 text-xs ml-1">{isExpanded ? "▲" : "▼"}</div>
                      </div>
                    </button>

                    {/* Expanded: per-game results */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-2">
                        {games.length === 0 && (
                          <p className="text-xs text-gray-400">No games for this week.</p>
                        )}
                        {games.map((game) => {
                          const pick = memberPicks.find((p) => p.game_id === game.id);
                          const locked = new Date(game.kickoff_time) <= new Date();
                          // Picks are blind until kickoff. Everything below reads from
                          // `revealed`, never from `pick` — reading `pick` directly is what
                          // used to leak the picked side before the game started.
                          const revealed = locked ? pick : undefined;
                          const grade = revealed ? wagerResult(revealed.points, game.status) : null;

                          return (
                            <div key={game.id} className="flex items-center gap-2 text-sm">
                              {/* Result indicator */}
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                grade === "WIN" ? "bg-green-100 text-green-600" :
                                grade === "LOSS" ? "bg-red-100 text-red-500" :
                                grade === "PENDING" ? "bg-blue-100 text-blue-400" :
                                grade === "PUSH" || grade === "VOID" ? "bg-gray-100 text-gray-500" :
                                "bg-gray-100 text-gray-300"
                              }`}>
                                {grade === null ? "·" : grade === "PENDING" ? "?" : GRADE_LABELS[grade]}
                              </div>

                              {/* Matchup */}
                              <div className="flex-1 min-w-0">
                                <span className="text-gray-500">{game.sport}</span>
                                {" · "}
                                <span className="text-gray-500">
                                  {game.away_team}
                                  {game.status === "FINAL" && game.away_score !== null && (
                                    <span className="tabular-nums"> {game.away_score}</span>
                                  )}
                                </span>
                                <span className="text-gray-300"> @ </span>
                                <span className="text-gray-500">
                                  {game.home_team}
                                  {game.status === "FINAL" && game.home_score !== null && (
                                    <span className="tabular-nums"> {game.home_score}</span>
                                  )}
                                </span>
                                {revealed && (
                                  <span className="ml-1.5 font-semibold text-gray-900">
                                    {formatWager(revealed, game, true)}
                                  </span>
                                )}
                                {revealed?.is_lotw && (
                                  <span className="ml-1.5 text-xs text-amber-600 font-medium">LOTW</span>
                                )}
                              </div>

                              {/* Points */}
                              <div className={`text-xs font-medium tabular-nums shrink-0 ${
                                !revealed ? "text-gray-300" :
                                grade === "PENDING" ? "text-blue-400" :
                                grade === "WIN" ? "text-green-600" :
                                grade === "LOSS" ? "text-red-500" :
                                "text-gray-400"
                              }`}>
                                {!revealed ? (locked ? "–" : "open") :
                                  grade === "PENDING" ? "live" :
                                  grade === "VOID" ? "void" :
                                  revealed.points === null ? "live" :
                                  revealed.points > 0 ? `+${revealed.points}` :
                                  revealed.points === 0 ? "±0" :
                                  `${revealed.points}`}
                              </div>
                            </div>
                          );
                        })}

                        {/* Penalty detail */}
                        {(member.forfeit_penalty < 0 || member.lotw_penalty < 0) && (
                          <div className="pt-1 border-t border-gray-200 text-xs text-red-500 space-y-0.5">
                            {member.forfeit_penalty < 0 && (
                              <div>Forfeit penalty: {member.forfeit_penalty} pts</div>
                            )}
                            {member.lotw_penalty < 0 && (
                              <div>No LOTW penalty: {member.lotw_penalty} pt</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "season" && (
        <div>
          {closedWeekIds.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              No closed weeks yet — season standings appear after the first week closes.
            </div>
          ) : (
            <>
              {openWeekId && (
                <p className="text-xs text-gray-400 mb-3">
                  Week {weeks.find((w) => w.id === openWeekId)?.week_number} (in progress) not included.
                </p>
              )}
              <div className="bg-white border rounded-xl overflow-hidden">
                {/* Table header */}
                <div className="grid text-xs font-medium text-gray-400 uppercase tracking-wide px-4 py-2 border-b border-gray-100"
                  style={{ gridTemplateColumns: `2rem 1fr ${closedWeekIds.map(() => "3rem").join(" ")} 4rem` }}>
                  <div>#</div>
                  <div>Member</div>
                  {closedWeekIds.map((wid) => (
                    <div key={wid} className="text-center">
                      W{weeks.find((w) => w.id === wid)?.week_number}
                    </div>
                  ))}
                  <div className="text-right">Total</div>
                </div>

                {/* Rows */}
                {seasonStandings.map((entry, idx) => (
                  <div
                    key={entry.member_id}
                    className="grid items-center px-4 py-2.5 border-b border-gray-50 last:border-0"
                    style={{ gridTemplateColumns: `2rem 1fr ${closedWeekIds.map(() => "3rem").join(" ")} 4rem` }}
                  >
                    <div className={`text-sm font-bold ${
                      idx === 0 ? "text-amber-500" :
                      idx === 1 ? "text-gray-400" :
                      idx === 2 ? "text-amber-700" :
                      "text-gray-300"
                    }`}>
                      {idx + 1}
                    </div>
                    <div className="font-medium text-gray-900 text-sm truncate">{entry.display_name}</div>
                    {closedWeekIds.map((wid) => {
                      const wTotal = entry.weeks[wid] ?? null;
                      return (
                        <div key={wid} className={`text-center text-sm tabular-nums ${
                          wTotal === null ? "text-gray-200" :
                          wTotal > 0 ? "text-green-600" :
                          wTotal < 0 ? "text-red-500" :
                          "text-gray-400"
                        }`}>
                          {wTotal === null ? "–" : wTotal > 0 ? `+${wTotal}` : wTotal}
                        </div>
                      );
                    })}
                    <div className={`text-right font-bold text-sm tabular-nums ${
                      entry.season_total > 0 ? "text-gray-900" :
                      entry.season_total < 0 ? "text-red-500" :
                      "text-gray-400"
                    }`}>
                      {entry.season_total > 0 ? `+${entry.season_total}` : entry.season_total}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
