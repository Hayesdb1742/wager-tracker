"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BET_TYPES, BET_TYPE_LABELS, SELECTIONS_FOR, formatWager, formatWagerShort,
  formatLine, wagerResult, GRADE_LABELS, validateWager,
  type BetType, type Selection,
} from "@/lib/wagers";

type Week = { id: number; week_number: number; status: string; required_picks: number };
type Game = { id: string; sport: string; home_team: string; away_team: string; kickoff_time: string; status: string; winner: string | null };
type Member = { id: string; display_name: string };
type PickRow = { id: string; member_id: string; game_id: string; bet_type: string; selection: string; line: number; odds: number | null; is_lotw: boolean; is_loty: boolean; points: number | null; overridden_by: string | null; overridden_at: string | null };
type AuditEntry = {
  id: string; pick_id: string;
  previous_bet_type: string; previous_selection: string; previous_line: number;
  new_bet_type: string; new_selection: string; new_line: number;
  changed_by_name: string; changed_at: string;
};

type WagerInput = { bet_type: BetType; selection: Selection; line: number; odds: number | null };

interface Props {
  weeks: Week[];
  selectedWeek: Week | null;
  games: Game[];
  members: Member[];
  pickMap: Record<string, Record<string, PickRow>>;
  auditLog: AuditEntry[];
}

export function PicksAdminClient({ weeks, selectedWeek, games, members, pickMap: initialPickMap, auditLog }: Props) {
  const router = useRouter();
  const [pickMap, setPickMap] = useState(initialPickMap);
  const [activeCell, setActiveCell] = useState<{ memberId: string; gameId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFinal, setPendingFinal] = useState<{ memberId: string; gameId: string; wager: WagerInput } | null>(null);
  const [tab, setTab] = useState<"grid" | "audit">("grid");

  const isLocked = (game: Game) => new Date(game.kickoff_time) <= new Date();

  // Override composer state. Re-seeded whenever the admin opens a different cell.
  const [ovBetType, setOvBetType] = useState<BetType>("SPREAD");
  const [ovSelection, setOvSelection] = useState<Selection | null>(null);
  const [ovLine, setOvLine] = useState("");
  const [ovOdds, setOvOdds] = useState("");

  const openCell = (memberId: string, gameId: string) => {
    const existing = pickMap[memberId]?.[gameId];
    setOvBetType((existing?.bet_type as BetType) ?? "SPREAD");
    setOvSelection((existing?.selection as Selection) ?? null);
    setOvLine(existing && existing.bet_type !== "ML" ? String(existing.line) : "");
    setOvOdds(existing?.odds != null ? String(existing.odds) : "");
    setActiveCell({ memberId, gameId });
  };

  /** The composed override, or null while it is incomplete or invalid. */
  const buildOverride = (): WagerInput | null => {
    if (!ovSelection) return null;
    const line = ovBetType === "ML" ? 0 : Number(ovLine.trim());
    if (ovBetType !== "ML" && (ovLine.trim() === "" || !Number.isFinite(line))) return null;
    const odds = ovOdds.trim() === "" ? null : Number(ovOdds.trim());
    if (odds !== null && !Number.isFinite(odds)) return null;
    const wager = { bet_type: ovBetType, selection: ovSelection, line, odds };
    return validateWager(wager) === null ? wager : null;
  };

  const handleWeekChange = (weekId: string) => {
    router.push(`/admin/picks?week=${weekId}`);
  };

  const activePick = activeCell ? pickMap[activeCell.memberId]?.[activeCell.gameId] : null;
  const activeGame = activeCell ? games.find((g) => g.id === activeCell.gameId) : null;
  const activeMember = activeCell ? members.find((m) => m.id === activeCell.memberId) : null;

  const doOverride = useCallback(async (memberId: string, gameId: string, wager: WagerInput, force = false) => {
    setSaving(true);
    setError(null);

    const res = await fetch("/api/admin/picks/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        member_id: memberId,
        game_id: gameId,
        week_id: selectedWeek?.id,
        ...wager,
        force,
      }),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      if (data.error === "game_final") {
        setPendingFinal({ memberId, gameId, wager });
        return;
      }
      setError(data.error ?? "Override failed");
      return;
    }

    // Optimistically update local pick map
    setPickMap((prev) => {
      const next = { ...prev };
      if (!next[memberId]) next[memberId] = {};
      const existing = next[memberId][gameId];
      next[memberId] = {
        ...next[memberId],
        [gameId]: {
          id: existing?.id ?? "optimistic",
          member_id: memberId,
          game_id: gameId,
          bet_type: wager.bet_type,
          selection: wager.selection,
          line: wager.line,
          odds: wager.odds,
          is_lotw: existing?.is_lotw ?? false,
          is_loty: existing?.is_loty ?? false,
          points: existing?.points ?? null,
          overridden_by: "admin",
          overridden_at: new Date().toISOString(),
        },
      };
      return next;
    });
    setActiveCell(null);
    router.refresh();
  }, [selectedWeek, router]);

  const doLotwAssign = useCallback(async (memberId: string, pickId: string) => {
    if (!selectedWeek) return;
    setSaving(true);
    setError(null);

    const res = await fetch("/api/admin/picks/lotw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: memberId, pick_id: pickId, week_id: selectedWeek.id }),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      if (data.error === "week_closed") {
        setError("Week is closed — LOTW cannot be changed.");
      } else {
        setError(data.error ?? "LOTW assignment failed");
      }
      return;
    }

    // Optimistically update LOTW state
    setPickMap((prev) => {
      const next = { ...prev };
      // Clear previous LOTW for this member
      if (next[memberId]) {
        for (const gid of Object.keys(next[memberId])) {
          next[memberId] = { ...next[memberId], [gid]: { ...next[memberId][gid], is_lotw: false, is_loty: false } };
        }
        // Set new LOTW — find the pick by ID
        for (const gid of Object.keys(next[memberId])) {
          if (next[memberId][gid].id === pickId) {
            next[memberId] = { ...next[memberId], [gid]: { ...next[memberId][gid], is_lotw: true } };
          }
        }
      }
      return next;
    });
    setActiveCell(null);
    router.refresh();
  }, [selectedWeek, router]);

  const memberPickCount = (memberId: string) =>
    Object.keys(pickMap[memberId] ?? {}).length;

  const memberHasLotw = (memberId: string) =>
    Object.values(pickMap[memberId] ?? {}).some((p) => p.is_lotw);

  // Colour and label both come from the wager's own grade now -- comparing a picked team
  // to games.winner would be wrong for anyone holding a spread or a total.
  const pickResultColor = (pick: PickRow | undefined, game: Game) => {
    if (!pick) return "text-slate-500";
    const grade = wagerResult(pick.points, game.status);
    if (grade === "WIN") return "text-emerald-400";
    if (grade === "LOSS") return "text-red-400";
    if (grade === "PUSH" || grade === "VOID") return "text-slate-400";
    return "text-slate-100";
  };

  const pickLabel = (pick: PickRow | undefined, game: Game) => {
    if (!pick) return "—";
    // ★★ is a LOTY: the week's lock at triple weight, spent once a season.
    const lotw = pick.is_loty ? " ★★" : pick.is_lotw ? " ★" : "";
    const override = pick.overridden_by ? " ●" : "";
    const grade = wagerResult(pick.points, game.status);
    const suffix = grade === "PENDING" ? "" : ` ${GRADE_LABELS[grade]}`;
    return `${formatWagerShort(pick, game)}${lotw}${override}${suffix}`;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold">Pick Grid</h1>
        <select
          value={selectedWeek?.id ?? ""}
          onChange={(e) => handleWeekChange(e.target.value)}
          className="text-sm font-medium border border-slate-600 rounded-lg px-3 py-1.5 bg-slate-800 text-white hover:border-slate-500 focus:border-sky-400 focus:outline-none"
        >
          {weeks.map((w) => (
            <option key={w.id} value={w.id}>
              Week {w.week_number} ({w.status})
            </option>
          ))}
        </select>
      </div>

      {!selectedWeek ? (
        <p className="text-slate-400 text-sm">No week selected.</p>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1 mb-5 w-fit">
            {(["grid", "audit"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors capitalize ${
                  tab === t
                    ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/30"
                    : "text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                {t === "grid" ? "Pick Grid" : "Audit Log"}
              </button>
            ))}
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-sm text-red-300 flex justify-between">
              {error}
              <button onClick={() => setError(null)} className="text-red-300 ml-2 font-bold hover:text-white">✕</button>
            </div>
          )}

          {/* FINAL override confirmation */}
          {pendingFinal && (
            <div className="mb-4 p-4 bg-amber-500/10 border border-amber-500/60 rounded-xl">
              <p className="text-sm font-semibold text-amber-100 mb-3">
                This game is already FINAL. Overriding will trigger score recalculation for all members. Continue?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { doOverride(pendingFinal.memberId, pendingFinal.gameId, pendingFinal.wager, true); setPendingFinal(null); }}
                  className="px-3 py-1.5 bg-amber-400 text-slate-950 rounded-lg text-sm font-semibold shadow-lg shadow-amber-500/25 transition-colors hover:bg-amber-300"
                >
                  Yes, override and recalculate
                </button>
                <button onClick={() => setPendingFinal(null)} className="px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700 hover:text-white">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {tab === "grid" && (
            <>
              {/* Summary strip */}
              <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl mb-4 overflow-hidden">
                <div className="grid text-xs font-bold text-slate-300 uppercase tracking-wide px-4 py-2.5 bg-slate-800 border-b border-slate-700"
                  style={{ gridTemplateColumns: "1fr 5rem 5rem 5rem" }}>
                  <div>Member</div>
                  <div className="text-center">Picks</div>
                  <div className="text-center">LOTW</div>
                  <div className="text-center">Locked</div>
                </div>
                {members.map((member) => {
                  const count = memberPickCount(member.id);
                  const hasLotw = memberHasLotw(member.id);
                  const lockedCount = games.filter((g) => isLocked(g) && pickMap[member.id]?.[g.id]).length;
                  const atRisk = count < selectedWeek.required_picks;
                  return (
                    <div
                      key={member.id}
                      className={`grid items-center px-4 py-2.5 border-b border-slate-800 last:border-0 ${atRisk ? "bg-red-500/10" : ""}`}
                      style={{ gridTemplateColumns: "1fr 5rem 5rem 5rem" }}
                    >
                      <span className="font-semibold text-sm text-white">{member.display_name}</span>
                      <span className={`text-center text-sm font-medium ${atRisk ? "text-red-400" : "text-slate-100"}`}>
                        {count}/{selectedWeek.required_picks}
                      </span>
                      <span className={`text-center text-sm ${hasLotw ? "text-emerald-400" : "text-amber-400"}`}>
                        {hasLotw ? "✓" : "✗"}
                      </span>
                      <span className="text-center text-sm font-medium text-slate-300">{lockedCount}</span>
                    </div>
                  );
                })}
              </div>

              {/* Full pick grid */}
              <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse min-w-max">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="sticky left-0 bg-slate-800 text-left px-4 py-2.5 font-bold uppercase tracking-wide text-slate-300 text-xs min-w-[120px] z-10">
                          Member
                        </th>
                        {games.map((game) => (
                          <th key={game.id} className="bg-slate-800 px-2 py-2.5 font-semibold text-slate-200 text-xs text-center min-w-[80px]">
                            <div>{game.away_team.slice(0, 5)}</div>
                            <div className="text-slate-500">@</div>
                            <div>{game.home_team.slice(0, 5)}</div>
                            {game.status === "FINAL" && game.winner && (
                              <div className={`mt-0.5 text-xs font-semibold ${game.winner === "HOME" ? "text-sky-400" : "text-violet-400"}`}>
                                {game.winner === "HOME" ? game.home_team.slice(0, 3) : game.away_team.slice(0, 3)} W
                              </div>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800">
                          <td className="sticky left-0 bg-slate-900 hover:bg-slate-800 px-4 py-2 font-semibold text-white text-sm z-10">
                            {member.display_name}
                          </td>
                          {games.map((game) => {
                            const pick = pickMap[member.id]?.[game.id];
                            const isActive = activeCell?.memberId === member.id && activeCell?.gameId === game.id;
                            return (
                              <td key={game.id} className="px-1 py-1 text-center">
                                <button
                                  onClick={() => isActive ? setActiveCell(null) : openCell(member.id, game.id)}
                                  title={pick ? `${formatWager(pick, game, true)}${pick.is_loty ? " (LOTY)" : pick.is_lotw ? " (LOTW)" : ""}${pick.overridden_by ? " (overridden)" : ""}` : "No pick"}
                                  className={`w-full px-1 py-1.5 rounded text-xs font-semibold transition-colors ${
                                    isActive
                                      ? "bg-sky-500/25 ring-2 ring-sky-400"
                                      : "hover:bg-slate-700"
                                  } ${pickResultColor(pick, game)}`}
                                >
                                  {pickLabel(pick, game)}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Legend */}
              <p className="text-xs text-slate-400 mt-2">
                ★ = LOTW · ★★ = LOTY (×3) · ● = Admin override · Click any cell to override or assign LOTW
              </p>

              {/* Active cell action panel */}
              {activeCell && activeMember && activeGame && (
                <div className="mt-4 p-4 bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-white">
                        {activeMember.display_name} — {activeGame.away_team} @ {activeGame.home_team}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {activeGame.sport} · {new Date(activeGame.kickoff_time).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                        {activeGame.status === "FINAL" && ` · FINAL (${activeGame.winner} wins)`}
                      </p>
                      {activePick?.overridden_at && (
                        <p className="text-xs text-orange-400 mt-0.5">
                          Previously overridden {new Date(activePick.overridden_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <button onClick={() => setActiveCell(null)} className="text-slate-400 font-bold hover:text-white">✕</button>
                  </div>

                  {activePick && (
                    <p className="text-sm text-slate-300 mb-3">
                      Current: <span className="font-bold text-white">{formatWager(activePick, activeGame, true)}</span>
                    </p>
                  )}

                  {/* Override composer -- the admin records the wager the member actually
                      placed, so it needs the same three bet types the member has. */}
                  <div className="flex flex-wrap items-end gap-2 mb-3">
                    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800/70 p-0.5">
                      {BET_TYPES.map((bt) => (
                        <button
                          key={bt}
                          onClick={() => {
                            setOvBetType(bt);
                            if (ovSelection && !SELECTIONS_FOR[bt].includes(ovSelection)) setOvSelection(null);
                            if (bt === "ML") setOvLine("");
                          }}
                          className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-colors ${
                            ovBetType === bt
                              ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/30"
                              : "text-slate-300 hover:bg-slate-700 hover:text-white"
                          }`}
                        >
                          {BET_TYPE_LABELS[bt]}
                        </button>
                      ))}
                    </div>

                    {SELECTIONS_FOR[ovBetType].map((side) => {
                      const label =
                        side === "HOME" ? activeGame.home_team
                        : side === "AWAY" ? activeGame.away_team
                        : side === "OVER" ? "Over" : "Under";
                      return (
                        <button
                          key={side}
                          onClick={() => setOvSelection(side)}
                          disabled={saving}
                          className={`px-3 py-1.5 rounded-lg border-2 text-sm font-semibold transition-colors ${
                            ovSelection === side
                              ? "border-sky-400 bg-sky-500/25 text-sky-100 shadow-lg shadow-sky-500/20"
                              : "border-slate-700 bg-slate-800 text-slate-100 hover:border-sky-400 hover:bg-sky-500/15 hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}

                    {ovBetType !== "ML" && (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={ovLine}
                        onChange={(e) => setOvLine(e.target.value)}
                        placeholder={ovBetType === "TOTAL" ? "52.5" : "-3.5"}
                        className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-white text-sm tabular-nums focus:border-sky-400 focus:outline-none"
                      />
                    )}
                    <input
                      type="text"
                      inputMode="numeric"
                      value={ovOdds}
                      onChange={(e) => setOvOdds(e.target.value)}
                      placeholder="-110"
                      className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-white text-sm tabular-nums focus:border-sky-400 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        const wager = buildOverride();
                        if (!wager) { setError("Complete the wager first"); return; }
                        setError(null);
                        doOverride(activeCell.memberId, activeCell.gameId, wager);
                      }}
                      disabled={saving || !buildOverride()}
                      className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 text-sm font-semibold shadow-lg shadow-sky-500/25 transition-colors hover:bg-sky-400 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                      Save override
                    </button>

                    {activePick && selectedWeek.status !== "CLOSED" && (
                      <button
                        onClick={() => doLotwAssign(activeCell.memberId, activePick.id)}
                        disabled={saving}
                        className={`px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-colors ${
                          activePick.is_lotw
                            ? "border-amber-400 bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/25"
                            : "border-amber-500/60 bg-amber-500/10 text-amber-300 hover:border-amber-400 hover:bg-amber-500/25 hover:text-amber-200"
                        }`}
                      >
                        {activePick.is_lotw ? "★ LOTW (set)" : "☆ Set LOTW"}
                      </button>
                    )}

                    {selectedWeek.status === "CLOSED" && (
                      <span className="text-xs text-slate-400 self-center">Week closed — LOTW locked</span>
                    )}
                  </div>
                  {saving && <p className="text-xs text-slate-400 mt-2">Saving…</p>}
                </div>
              )}
            </>
          )}

          {tab === "audit" && (
            <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl overflow-hidden">
              {auditLog.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No overrides recorded for this week.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-800 text-xs font-bold text-slate-300 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left">When</th>
                      <th className="px-4 py-2 text-left">Admin</th>
                      <th className="px-4 py-2 text-left">Changed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry) => (
                      <tr key={entry.id} className="border-b border-slate-800 last:border-0">
                        <td className="px-4 py-2.5 text-slate-300">
                          {new Date(entry.changed_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-white">{entry.changed_by_name}</td>
                        <td className="px-4 py-2.5 text-slate-300">
                          <span className="font-medium text-red-400">
                            {entry.previous_bet_type === "TOTAL"
                              ? `${entry.previous_selection === "OVER" ? "O" : "U"} ${entry.previous_line}`
                              : `${entry.previous_selection} ${entry.previous_bet_type === "ML" ? "ML" : formatLine(entry.previous_line)}`}
                          </span>
                          {" → "}
                          <span className="font-medium text-emerald-400">
                            {entry.new_bet_type === "TOTAL"
                              ? `${entry.new_selection === "OVER" ? "O" : "U"} ${entry.new_line}`
                              : `${entry.new_selection} ${entry.new_bet_type === "ML" ? "ML" : formatLine(entry.new_line)}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
