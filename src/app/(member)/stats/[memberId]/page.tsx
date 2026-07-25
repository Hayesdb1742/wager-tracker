import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StatsClient } from "./StatsClient";

export default async function MemberStatsPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Load target member profile
  const { data: profile } = await admin
    .from("profiles")
    .select("id, display_name")
    .eq("id", memberId)
    .single();

  if (!profile) notFound();

  // All members for head-to-head selector
  const { data: allMembers } = await admin
    .from("profiles")
    .select("id, display_name")
    .eq("is_active", true)
    .order("display_name");

  // This member's picks (resolved games only)
  const { data: picks } = await admin
    .from("picks")
    .select("id, game_id, picked_team, is_lotw, points, games(home_team, away_team, winner, status, kickoff_time, sport)")
    .eq("member_id", memberId)
    .not("points", "is", null)
    .order("games(kickoff_time)", { ascending: true });

  // This member's weekly scores
  const { data: weeklyScores } = await admin
    .from("weekly_scores")
    .select("week_id, pick_points, forfeit_penalty, lotw_penalty, total, weeks(week_number, status, season_id, seasons(name, year))")
    .eq("member_id", memberId)
    .order("week_id", { ascending: true });

  // All members' weekly scores (for head-to-head)
  const { data: allScores } = await admin
    .from("weekly_scores")
    .select("member_id, week_id, total")
    .in("week_id", (weeklyScores ?? []).map((ws) => ws.week_id));

  // ── Compute stats ──────────────────────────────────────────────────────────

  const resolvedPicks = picks ?? [];

  const wins = resolvedPicks.filter((p) => p.points !== null && (p.points as number) > 0).length;
  const losses = resolvedPicks.filter((p) => p.points !== null && (p.points as number) < 0).length;
  const pushes = resolvedPicks.filter((p) => p.points === 0).length;
  const decided = wins + losses;
  const win_pct = decided > 0 ? Math.round((wins / decided) * 100) : 0;

  const lotwPicks = resolvedPicks.filter((p) => p.is_lotw);
  const lotw_wins = lotwPicks.filter((p) => p.points !== null && (p.points as number) > 0).length;
  const lotw_losses = lotwPicks.filter((p) => p.points !== null && (p.points as number) < 0).length;
  const lotw_pushes = lotwPicks.filter((p) => p.points === 0).length;
  const lotw_decided = lotw_wins + lotw_losses;
  const lotw_win_pct = lotw_decided > 0 ? Math.round((lotw_wins / lotw_decided) * 100) : 0;

  const closedScores = (weeklyScores ?? []).filter(
    (ws) => ws.weeks?.status === "CLOSED"
  );
  const bestWeek = closedScores.length > 0 ? closedScores.reduce((best, ws) => (ws.total ?? 0) > (best.total ?? 0) ? ws : best) : null;
  const worstWeek = closedScores.length > 0 ? closedScores.reduce((worst, ws) => (ws.total ?? 0) < (worst.total ?? 0) ? ws : worst) : null;

  // Win/loss streaks from chronological picks
  let currentStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let tempWin = 0;
  let tempLoss = 0;
  for (const p of resolvedPicks) {
    if (p.points !== null && (p.points as number) > 0) {
      tempWin += 1;
      tempLoss = 0;
      longestWinStreak = Math.max(longestWinStreak, tempWin);
    } else if (p.points !== null && (p.points as number) < 0) {
      tempLoss += 1;
      tempWin = 0;
      longestLossStreak = Math.max(longestLossStreak, tempLoss);
    } else {
      tempWin = 0;
      tempLoss = 0;
    }
  }
  // Current streak (from end)
  for (let i = resolvedPicks.length - 1; i >= 0; i--) {
    const pts = resolvedPicks[i].points;
    if (pts === null || pts === 0) break;
    if (currentStreak === 0) { currentStreak = pts > 0 ? 1 : -1; }
    else if ((currentStreak > 0 && pts > 0) || (currentStreak < 0 && pts < 0)) {
      currentStreak += currentStreak > 0 ? 1 : -1;
    } else break;
  }

  // Team tendencies
  const teamMap = new Map<string, { team: string; picks: number; wins: number; losses: number; pushes: number }>();
  for (const p of resolvedPicks) {
    const game = p.games;
    if (!game) continue;
    const team = p.picked_team === "HOME" ? game.home_team : game.away_team;
    if (!teamMap.has(team)) teamMap.set(team, { team, picks: 0, wins: 0, losses: 0, pushes: 0 });
    const t = teamMap.get(team)!;
    t.picks += 1;
    if (p.points !== null && (p.points as number) > 0) t.wins += 1;
    else if (p.points !== null && (p.points as number) < 0) t.losses += 1;
    else t.pushes += 1;
  }
  const teamTendencies = Array.from(teamMap.values())
    .map((t) => ({ ...t, win_pct: t.wins + t.losses > 0 ? Math.round((t.wins / (t.wins + t.losses)) * 100) : 0 }))
    .sort((a, b) => b.picks - a.picks);

  // Season-by-season breakdown
  type SeasonGroup = { season_id: number; season_name: string; season_year: number; weeks: { week_number: number; total: number; status: string }[]; season_total: number };
  const seasonMap = new Map<number, SeasonGroup>();
  for (const ws of weeklyScores ?? []) {
    const week = ws.weeks;
    if (!week) continue;
    const sid = week.season_id;
    if (!seasonMap.has(sid)) {
      seasonMap.set(sid, {
        season_id: sid,
        season_name: week.seasons?.name ?? `Season ${sid}`,
        season_year: week.seasons?.year ?? 0,
        weeks: [],
        season_total: 0,
      });
    }
    const sg = seasonMap.get(sid)!;
    sg.weeks.push({ week_number: week.week_number, total: ws.total ?? 0, status: week.status });
    if (week.status === "CLOSED") sg.season_total += ws.total ?? 0;
  }
  const seasons = Array.from(seasonMap.values()).sort((a, b) => b.season_year - a.season_year);

  // LOTW history (most recent 10)
  const lotwHistory = resolvedPicks
    .filter((p) => p.is_lotw)
    .slice(-10)
    .reverse()
    .map((p) => {
      const game = p.games;
      const pickedTeam = p.picked_team === "HOME" ? game?.home_team : game?.away_team;
      const won = p.points !== null && (p.points as number) > 0;
      const lost = p.points !== null && (p.points as number) < 0;
      return {
        id: p.id,
        sport: game?.sport ?? "",
        matchup: game ? `${game.away_team} @ ${game.home_team}` : "",
        picked: pickedTeam ?? "",
        kickoff_time: game?.kickoff_time ?? "",
        result: won ? "W" : lost ? "L" : "P",
        points: p.points,
      };
    });

  // Head-to-head data (all members' scores for shared weeks)
  const memberScoresByWeek = new Map<string, Map<number, number>>();
  for (const s of allScores ?? []) {
    if (!memberScoresByWeek.has(s.member_id)) memberScoresByWeek.set(s.member_id, new Map());
    memberScoresByWeek.get(s.member_id)!.set(s.week_id, s.total ?? 0);
  }
  const myWeeklyMap = memberScoresByWeek.get(memberId) ?? new Map<number, number>();

  return (
    <div>
      {/* Back link */}
      <div className="mb-4">
        <Link href="/analytics" className="text-sm text-gray-400 hover:text-gray-600">← All-Time Standings</Link>
      </div>

      <h1 className="text-2xl font-bold mb-1">{profile.display_name}</h1>
      <p className="text-sm text-gray-400 mb-6">Member stats</p>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
        <StatCard label="W-L-P" value={`${wins}–${losses}${pushes > 0 ? `–${pushes}` : ""}`} />
        <StatCard label="Win %" value={`${win_pct}%`} highlight={win_pct >= 60 ? "green" : win_pct < 45 ? "red" : undefined} />
        <StatCard label="LOTW" value={`${lotw_wins}–${lotw_losses}`} sub={`${lotw_win_pct}% win rate`} />
        <StatCard
          label="Current streak"
          value={currentStreak === 0 ? "—" : `${Math.abs(currentStreak)}${currentStreak > 0 ? "W" : "L"}`}
          highlight={currentStreak > 0 ? "green" : currentStreak < 0 ? "red" : undefined}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-3">
        <StatCard label="Best week" value={bestWeek ? ((bestWeek.total ?? 0) > 0 ? `+${bestWeek.total}` : String(bestWeek.total ?? 0)) : "—"} highlight="green" />
        <StatCard label="Worst week" value={worstWeek ? ((worstWeek.total ?? 0) > 0 ? `+${worstWeek.total}` : String(worstWeek.total ?? 0)) : "—"} highlight="red" />
        <StatCard label="Longest W streak" value={`${longestWinStreak}W`} />
      </div>

      {/* Season breakdown */}
      {seasons.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Season Breakdown</h2>
          <div className="space-y-2">
            {seasons.map((sg) => (
              <div key={sg.season_id} className="bg-white border rounded-xl px-4 py-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-gray-900">{sg.season_name}</span>
                  <span className={`font-bold tabular-nums ${sg.season_total > 0 ? "text-gray-900" : "text-red-500"}`}>
                    {sg.season_total > 0 ? `+${sg.season_total}` : sg.season_total} pts
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {sg.weeks.sort((a, b) => a.week_number - b.week_number).map((w) => (
                    <div key={w.week_number} className="text-center">
                      <div className="text-xs text-gray-400">Wk {w.week_number}</div>
                      <div className={`text-sm font-medium tabular-nums ${
                        w.status !== "CLOSED" ? "text-blue-400" :
                        w.total > 0 ? "text-green-600" :
                        w.total < 0 ? "text-red-500" :
                        "text-gray-400"
                      }`}>
                        {w.status !== "CLOSED" ? "…" : w.total > 0 ? `+${w.total}` : w.total}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* LOTW history */}
      {lotwHistory.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            Recent LOTW Picks ({lotw_wins}W–{lotw_losses}L{lotw_pushes > 0 ? `–${lotw_pushes}P` : ""} · {lotw_win_pct}%)
          </h2>
          <div className="bg-white border rounded-xl overflow-hidden">
            {lotwHistory.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  h.result === "W" ? "bg-green-100 text-green-600" :
                  h.result === "L" ? "bg-red-100 text-red-500" :
                  "bg-gray-100 text-gray-400"
                }`}>{h.result}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{h.picked} (LOTW)</div>
                  <div className="text-xs text-gray-400 truncate">{h.matchup}</div>
                </div>
                <div className={`text-sm font-medium tabular-nums shrink-0 ${
                  h.result === "W" ? "text-green-600" : h.result === "L" ? "text-red-500" : "text-gray-400"
                }`}>
                  {h.points !== null && (h.points as number) > 0 ? `+${h.points}` : h.points}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Team tendencies */}
      {teamTendencies.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Team Tendencies</h2>
          <div className="bg-white border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-2 text-left">Team</th>
                  <th className="px-4 py-2 text-center">Picks</th>
                  <th className="px-4 py-2 text-center">W-L-P</th>
                  <th className="px-4 py-2 text-center">Win %</th>
                </tr>
              </thead>
              <tbody>
                {teamTendencies.slice(0, 10).map((t) => (
                  <tr key={t.team} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{t.team}</td>
                    <td className="px-4 py-2.5 text-center text-gray-600">{t.picks}</td>
                    <td className="px-4 py-2.5 text-center text-gray-600 tabular-nums">
                      {t.wins}–{t.losses}{t.pushes > 0 ? `–${t.pushes}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`font-medium ${t.win_pct >= 60 ? "text-green-600" : t.win_pct >= 50 ? "text-gray-700" : "text-red-500"}`}>
                        {t.win_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Head-to-head */}
      <StatsClient
        memberId={memberId}
        memberName={profile.display_name}
        otherMembers={(allMembers ?? []).filter((m) => m.id !== memberId)}
        myWeeklyScores={Object.fromEntries(myWeeklyMap)}
        allMemberScores={Object.fromEntries(
          Array.from(memberScoresByWeek.entries()).map(([mid, weekMap]) => [mid, Object.fromEntries(weekMap)])
        )}
      />
    </div>
  );
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: "green" | "red" }) {
  return (
    <div className="bg-white border rounded-xl px-4 py-3">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${
        highlight === "green" ? "text-green-600" :
        highlight === "red" ? "text-red-500" :
        "text-gray-900"
      }`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
