"use client";

import { useState } from "react";

interface Props {
  memberId: string;
  memberName: string;
  otherMembers: { id: string; display_name: string }[];
  myWeeklyScores: Record<number, number>;
  allMemberScores: Record<string, Record<number, number>>;
}

export function StatsClient({ memberId, memberName, otherMembers, myWeeklyScores, allMemberScores }: Props) {
  const [opponentId, setOpponentId] = useState<string>("");

  const opponent = otherMembers.find((m) => m.id === opponentId);
  const opponentScores = opponentId ? allMemberScores[opponentId] ?? {} : {};

  // Shared weeks: weeks where both members have a score
  const sharedWeekIds = Object.keys(myWeeklyScores)
    .map(Number)
    .filter((wid) => opponentScores[wid] !== undefined);

  let h2hWins = 0, h2hLosses = 0, h2hTies = 0, h2hDiff = 0;
  const h2hWeeks: { week_id: number; my_total: number; opp_total: number; result: "W" | "L" | "T" }[] = [];

  for (const wid of sharedWeekIds) {
    const mine = myWeeklyScores[wid];
    const theirs = opponentScores[wid];
    h2hDiff += mine - theirs;
    const result: "W" | "L" | "T" = mine > theirs ? "W" : mine < theirs ? "L" : "T";
    if (result === "W") h2hWins++;
    else if (result === "L") h2hLosses++;
    else h2hTies++;
    h2hWeeks.push({ week_id: wid, my_total: mine, opp_total: theirs, result });
  }

  if (otherMembers.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Head-to-Head</h2>
      <div className="bg-white border rounded-xl p-4">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-500">{memberName} vs.</span>
          <select
            value={opponentId}
            onChange={(e) => setOpponentId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white flex-1 max-w-[200px]"
          >
            <option value="">Select member…</option>
            {otherMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        </div>

        {!opponent ? (
          <p className="text-sm text-gray-400">Select a member to compare records.</p>
        ) : sharedWeekIds.length === 0 ? (
          <p className="text-sm text-gray-400">No shared weeks found.</p>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{h2hWins}</div>
                <div className="text-xs text-gray-400">Wins</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-400">{h2hTies}</div>
                <div className="text-xs text-gray-400">Ties</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-500">{h2hLosses}</div>
                <div className="text-xs text-gray-400">Losses</div>
              </div>
            </div>
            <div className={`text-center text-sm font-medium mb-4 ${h2hDiff > 0 ? "text-green-600" : h2hDiff < 0 ? "text-red-500" : "text-gray-400"}`}>
              Point differential: {h2hDiff > 0 ? `+${h2hDiff}` : h2hDiff}
            </div>

            {/* Week-by-week */}
            <div className="space-y-1">
              {h2hWeeks.sort((a, b) => a.week_id - b.week_id).map((w) => (
                <div key={w.week_id} className="flex items-center gap-2 text-sm">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    w.result === "W" ? "bg-green-100 text-green-600" :
                    w.result === "L" ? "bg-red-100 text-red-500" :
                    "bg-gray-100 text-gray-400"
                  }`}>{w.result}</div>
                  <span className="text-gray-400 w-14 shrink-0">Week {w.week_id}</span>
                  <span className={`font-medium tabular-nums ${w.my_total > 0 ? "text-gray-900" : "text-red-500"}`}>
                    {w.my_total > 0 ? `+${w.my_total}` : w.my_total}
                  </span>
                  <span className="text-gray-300">vs</span>
                  <span className={`tabular-nums ${w.opp_total > 0 ? "text-gray-600" : "text-red-400"}`}>
                    {w.opp_total > 0 ? `+${w.opp_total}` : w.opp_total}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
