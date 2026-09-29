"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatWager,
  formatRecord,
  wagerResult,
  lockLevel,
  pickRecord,
  lockRecord,
  withForfeits,
  addRecords,
  decidedGames,
  winPct,
  GRADE_LABELS,
  LOCK_SHORT,
  LOCK_MULTIPLIER,
  type LeagueRecord,
  type LockLevel,
} from "@/lib/wagers";

type Week = { id: number; week_number: number; status: string };

type MemberScore = {
  member_id: string;
  display_name: string;
  forfeit_penalty: number;
  lotw_penalty: number;
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
  is_loty: boolean;
  points: number | null;
};

type SeasonBaseEntry = {
  member_id: string;
  display_name: string;
  record: LeagueRecord;
  locks: LeagueRecord;
};

interface Props {
  weeks: Week[];
  defaultWeekId: number | null;
  openWeekId: number | null;
  initialScores: MemberScore[];
  initialGames: GameInfo[];
  initialPicks: PickInfo[];
  seasonBase: SeasonBaseEntry[];
}

/**
 * The row shape, shared by the header and every row so the two can never drift apart.
 *
 * Seven columns do not fit a phone -- the fixed tracks alone outrun a 390px screen and the
 * card starts scrolling sideways. Win % is the one that goes: it is the only column a
 * reader can recover from the one beside it. The narrow template therefore has six tracks
 * and the win-rate cell carries `hidden sm:block` to match.
 */
const GRID_CLASS =
  "grid items-center gap-2 sm:gap-3 " +
  "grid-cols-[1.75rem_minmax(0,1fr)_3.75rem_4.5rem_3.25rem_0.75rem] " +
  "sm:grid-cols-[2rem_minmax(0,1fr)_4.5rem_5rem_3.5rem_4rem_1rem]";

export function LeaderboardClient({
  weeks,
  defaultWeekId,
  openWeekId,
  initialScores,
  initialGames,
  initialPicks,
  seasonBase,
}: Props) {
  const [selectedWeekId, setSelectedWeekId] = useState(defaultWeekId);
  const [scores, setScores] = useState(initialScores);
  const [games, setGames] = useState(initialGames);
  const [picks, setPicks] = useState(initialPicks);
  // The open week's picks, held apart from the selected week's: the season column counts
  // the week in play, so it has to stay live even while a member browses week 2.
  const [openPicks, setOpenPicks] = useState(
    defaultWeekId !== null && defaultWeekId === openWeekId ? initialPicks : []
  );
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);

  const loadWeek = useCallback(async (weekId: number) => {
    const res = await fetch(`/api/leaderboard/week/${weekId}`);
    if (!res.ok) return null;
    return (await res.json()) as { scores: MemberScore[]; games: GameInfo[]; picks: PickInfo[] };
  }, []);

  const fetchWeek = useCallback(async (weekId: number) => {
    setLoadingWeek(true);
    try {
      const data = await loadWeek(weekId);
      if (!data) return;
      setScores(data.scores);
      setGames(data.games);
      setPicks(data.picks);
      if (weekId === openWeekId) setOpenPicks(data.picks);
    } finally {
      setLoadingWeek(false);
    }
  }, [loadWeek, openWeekId]);

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
        async () => {
          if (selectedWeekId === openWeekId) {
            // Refetch the full week data on any change
            fetchWeek(openWeekId);
          } else {
            // Browsing another week: the season column still counts the live one, so keep
            // its picks current without disturbing what's on screen.
            const data = await loadWeek(openWeekId);
            if (data) setOpenPicks(data.picks);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [openWeekId, selectedWeekId, fetchWeek, loadWeek]);

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

  // The week's record, counted in games rather than picks: the lock is worth two of them,
  // the LOTY seven. Forfeited slots have no pick row, so they come from the score row and
  // count as losses. Plus the lock this member spent, for the badge.
  const resultCounts = (memberId: string, forfeitPenalty: number) => {
    const mp = picksByMember(memberId);
    const lock = mp.reduce<LockLevel>((highest, p) => {
      const level = lockLevel(p);
      return LOCK_MULTIPLIER[level] > LOCK_MULTIPLIER[highest] ? level : highest;
    }, "NONE");
    return { record: withForfeits(pickRecord(mp), forfeitPenalty), lock };
  };

  // One row per member, ranked by the season record. The season half is the settled weeks
  // the server tallied plus whatever the week in play has graded so far; the week half is
  // whichever week the selector is on, which is the open one by default.
  const rows = useMemo(() => {
    const openPicksByMember = new Map<string, PickInfo[]>();
    for (const pick of openPicks) {
      const list = openPicksByMember.get(pick.member_id);
      if (list) list.push(pick);
      else openPicksByMember.set(pick.member_id, [pick]);
    }

    return seasonBase
      .map((entry) => {
        const open = openPicksByMember.get(entry.member_id) ?? [];
        return {
          member_id: entry.member_id,
          display_name: entry.display_name,
          season: addRecords(entry.record, pickRecord(open)),
          locks: addRecords(entry.locks, lockRecord(open)),
        };
      })
      .sort((a, b) =>
        winPct(b.season) - winPct(a.season) ||
        b.season.wins - a.season.wins ||
        a.display_name.localeCompare(b.display_name)
      );
  }, [seasonBase, openPicks]);

  const anyRecord = rows.some((r) => decidedGames(r.season) > 0 || r.season.pushes > 0);

  return (
    <div>
      {/* Header + week selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <div className="flex items-center gap-3">
          <select
            value={selectedWeekId ?? ""}
            onChange={(e) => handleWeekChange(Number(e.target.value))}
            className="text-sm font-medium border border-slate-600 rounded-lg px-3 py-1.5 bg-slate-800 text-white hover:border-slate-500 focus:border-sky-400 focus:outline-none"
          >
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                Week {w.week_number}
                {w.status === "OPEN" ? " (current)" : ""}
              </option>
            ))}
          </select>
          {selectedWeek?.status === "OPEN" && (
            <span className="text-xs text-emerald-400 font-semibold">
              Live — updates in real time
            </span>
          )}
          {loadingWeek && <span className="text-xs text-slate-400">Loading…</span>}
        </div>
      </div>

      {rows.length === 0 || !anyRecord ? (
        <div className="text-center py-16 text-slate-400 text-sm">
          No results yet — records appear as games grade.
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-lg shadow-black/30">
          {/* Table header */}
          <div className={`${GRID_CLASS} text-xs font-bold text-slate-300 uppercase tracking-wide px-4 py-2.5 bg-slate-800 border-b border-slate-700`}>
            <div>#</div>
            <div>Member</div>
            <div className="text-center">
              {selectedWeek ? `Wk ${selectedWeek.week_number}` : "Week"}
            </div>
            <div className="text-center">Season</div>
            <div className="hidden sm:block text-center">Win %</div>
            <div className="text-center">LOTW</div>
            <div />
          </div>

          {rows.map((row, idx) => {
            const score = scores.find((s) => s.member_id === row.member_id);
            const { record: weekRecord, lock } = resultCounts(
              row.member_id,
              score?.forfeit_penalty ?? 0
            );
            const weekPlayed = decidedGames(weekRecord) > 0 || weekRecord.pushes > 0;
            const seasonPlayed = decidedGames(row.season) > 0 || row.season.pushes > 0;
            const seasonDecided = decidedGames(row.season) > 0;
            const seasonPct = winPct(row.season);
            const locksPlayed = decidedGames(row.locks) > 0 || row.locks.pushes > 0;
            const isExpanded = expandedMember === row.member_id;
            const memberPicks = picksByMember(row.member_id);
            // Only the games this member actually bet on, and only once they've kicked
            // off. Listing a picked game before kickoff would reveal *which* games a
            // member bet on even with the side hidden, so unstarted games stay out.
            const now = new Date();
            const pickedGames = games.filter(
              (g) =>
                memberPicks.some((p) => p.game_id === g.id) &&
                (new Date(g.kickoff_time) <= now || g.status === "FINAL" || g.status === "CANCELLED")
            );

            return (
              <div key={row.member_id} className="border-b border-slate-800 last:border-0">
                {/* Standings row */}
                <button
                  className="w-full text-left transition-colors hover:bg-slate-800/70"
                  onClick={() => setExpandedMember(isExpanded ? null : row.member_id)}
                >
                  <div className={`${GRID_CLASS} px-4 py-3`}>
                    {/* Rank */}
                    <div className={`w-7 h-7 -ml-0.5 sm:ml-0 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      idx === 0 ? "bg-amber-400 text-slate-950 shadow-md shadow-amber-500/30" :
                      idx === 1 ? "bg-slate-300 text-slate-900" :
                      idx === 2 ? "bg-amber-700 text-amber-50" :
                      "bg-slate-800 text-slate-300 ring-1 ring-slate-600"
                    }`}>
                      {idx + 1}
                    </div>

                    {/* Name + lock badge */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-white truncate">{row.display_name}</span>
                      {lock !== "NONE" && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                          lock === "LOTY"
                            ? "bg-fuchsia-500/20 text-fuchsia-300 ring-1 ring-fuchsia-500/40"
                            : "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                        }`}>
                          {LOCK_SHORT[lock]}
                        </span>
                      )}
                    </div>

                    {/* This week's record */}
                    <div className={`text-center text-sm font-semibold tabular-nums ${
                      !weekPlayed ? "text-slate-600" :
                      weekRecord.wins > weekRecord.losses ? "text-emerald-400" :
                      weekRecord.wins < weekRecord.losses ? "text-red-400" :
                      "text-slate-300"
                    }`}>
                      {weekPlayed ? formatRecord(weekRecord) : "–"}
                    </div>

                    {/* Season record */}
                    <div className={`text-center text-base font-bold tabular-nums ${
                      seasonPlayed ? "text-white" : "text-slate-600"
                    }`}>
                      {seasonPlayed ? formatRecord(row.season) : "–"}
                    </div>

                    {/* Season win rate, over decided games */}
                    <div className={`hidden sm:block text-center text-sm font-medium tabular-nums ${
                      !seasonDecided ? "text-slate-600" :
                      seasonPct >= 60 ? "text-emerald-400" :
                      seasonPct >= 50 ? "text-slate-100" :
                      "text-red-400"
                    }`}>
                      {seasonDecided ? `${seasonPct}%` : "–"}
                    </div>

                    {/* Lock record, on the prize scale: a LOTW counts one, a LOTY three. */}
                    <div className={`text-center text-sm font-semibold tabular-nums ${
                      !locksPlayed ? "text-slate-600" :
                      row.locks.wins > row.locks.losses ? "text-amber-300" :
                      row.locks.wins < row.locks.losses ? "text-red-400" :
                      "text-slate-300"
                    }`}>
                      {locksPlayed ? formatRecord(row.locks) : "–"}
                    </div>

                    <div className="text-slate-500 text-xs text-right">{isExpanded ? "▲" : "▼"}</div>
                  </div>
                </button>

                {/* Expanded: per-game results for the selected week */}
                {isExpanded && (
                  <div className="border-t border-slate-800 px-4 py-3 bg-slate-950/60 space-y-2">
                    {pickedGames.length === 0 && (
                      <p className="text-xs text-slate-400">No picks have kicked off yet.</p>
                    )}
                    {pickedGames.map((game) => {
                      const pick = memberPicks.find((p) => p.game_id === game.id);
                      const locked = new Date(game.kickoff_time) <= now;
                      // Picks are blind until kickoff. Everything below reads from
                      // `revealed`, never from `pick` — reading `pick` directly is what
                      // used to leak the picked side before the game started.
                      const revealed = locked ? pick : undefined;
                      const grade = revealed ? wagerResult(revealed.points, game.status) : null;
                      // In progress: kicked off but not yet graded. Status can lag the
                      // clock, so a past-kickoff SCHEDULED game counts as live too.
                      const isLive = grade === "PENDING" && game.status !== "POSTPONED";
                      // Only the states the W/L/P circle cannot say on its own get a word.
                      const note =
                        !revealed ? (locked ? null : "open") :
                        isLive ? null :
                        grade === "PENDING" ? "postponed" :
                        grade === "VOID" ? "void" :
                        null;

                      return (
                        <div key={game.id} className="flex items-center gap-2 text-sm">
                          {/* Result indicator */}
                          {isLive ? (
                            <div className="h-5 px-1.5 rounded-full flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide shrink-0 bg-red-500/15 text-red-300 ring-1 ring-red-500/40">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                              Live
                            </div>
                          ) : (
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                              grade === "WIN" ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40" :
                              grade === "LOSS" ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/40" :
                              grade === "PENDING" ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40" :
                              grade === "PUSH" || grade === "VOID" ? "bg-slate-700 text-slate-200" :
                              "bg-slate-800 text-slate-500 ring-1 ring-slate-700"
                            }`}>
                              {grade === null ? "·" : grade === "PENDING" ? "?" : GRADE_LABELS[grade]}
                            </div>
                          )}

                          {/* Matchup */}
                          <div className="flex-1 min-w-0">
                            <span className="text-slate-300">{game.sport}</span>
                            {" · "}
                            <span className="text-slate-300">
                              {game.away_team}
                              {game.status === "FINAL" && game.away_score !== null && (
                                <span className="tabular-nums"> {game.away_score}</span>
                              )}
                            </span>
                            <span className="text-slate-500"> @ </span>
                            <span className="text-slate-300">
                              {game.home_team}
                              {game.status === "FINAL" && game.home_score !== null && (
                                <span className="tabular-nums"> {game.home_score}</span>
                              )}
                            </span>
                            {revealed && (
                              <span className="ml-1.5 font-bold text-white">
                                {formatWager(revealed, game, true)}
                              </span>
                            )}
                            {revealed?.is_lotw && (
                              <span className={`ml-1.5 text-xs font-semibold ${revealed.is_loty ? "text-fuchsia-300" : "text-amber-400"}`}>
                                {LOCK_SHORT[lockLevel(revealed)]}
                              </span>
                            )}
                          </div>

                          {note && (
                            <div className="text-xs font-medium text-slate-500 shrink-0">{note}</div>
                          )}
                        </div>
                      );
                    })}

                    {/* A slot left unpicked is a game lost, so it is already in the record
                        above — this says where those losses came from. */}
                    {(score?.forfeit_penalty ?? 0) < 0 && (
                      <div className="pt-1 border-t border-slate-800 text-xs font-medium text-red-400">
                        {Math.abs(score!.forfeit_penalty)} slot
                        {Math.abs(score!.forfeit_penalty) === 1 ? "" : "s"} unpicked — counted as
                        {Math.abs(score!.forfeit_penalty) === 1 ? " a loss" : " losses"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openWeekId && selectedWeekId === openWeekId && (
        <p className="text-xs text-slate-500 mt-3">
          Season record includes this week&apos;s graded games.
        </p>
      )}
    </div>
  );
}
