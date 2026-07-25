import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

type AllTimeStat = {
  member_id: string;
  display_name: string;
  all_time_total: number;
  seasons_played: number;
  weeks_played: number;
  total_picks: number;
  wins: number;
  losses: number;
  pushes: number;
  win_pct: number;
};

type TeamTendency = {
  team: string;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  win_pct: number;
};

export default async function AnalyticsPage() {
  const admin = createAdminClient();

  const [profilesRes, scoresRes, picksRes, seasonsRes] = await Promise.all([
    admin.from("profiles").select("id, display_name").eq("is_active", true),
    admin.from("weekly_scores").select("member_id, total, week_id, weeks(season_id, status)"),
    admin.from("picks").select("member_id, picked_team, is_lotw, points, games(home_team, away_team, winner, status)").not("points", "is", null),
    admin.from("seasons").select("id, name, year").order("year", { ascending: false }),
  ]);

  const profiles = profilesRes.data ?? [];
  const scores = scoresRes.data ?? [];
  const picks = picksRes.data ?? [];

  // Build all-time standings
  const statsMap = new Map<string, AllTimeStat>();
  for (const p of profiles) {
    statsMap.set(p.id, {
      member_id: p.id,
      display_name: p.display_name,
      all_time_total: 0,
      seasons_played: 0,
      weeks_played: 0,
      total_picks: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      win_pct: 0,
    });
  }

  const seasonsByMember = new Map<string, Set<number>>();
  for (const s of scores) {
    const week = s.weeks;
    if (!week || week.status !== "CLOSED") continue;
    const stat = statsMap.get(s.member_id);
    if (!stat) continue;
    stat.all_time_total += s.total ?? 0;
    stat.weeks_played += 1;
    if (!seasonsByMember.has(s.member_id)) seasonsByMember.set(s.member_id, new Set());
    seasonsByMember.get(s.member_id)!.add(week.season_id);
  }

  for (const [memberId, seasonSet] of seasonsByMember) {
    const stat = statsMap.get(memberId);
    if (stat) stat.seasons_played = seasonSet.size;
  }

  for (const pick of picks) {
    const stat = statsMap.get(pick.member_id);
    if (!stat) continue;
    stat.total_picks += 1;
    if (pick.points !== null) {
      if (pick.points > 0) stat.wins += 1;
      else if (pick.points < 0) stat.losses += 1;
      else stat.pushes += 1;
    }
  }

  for (const stat of statsMap.values()) {
    const decided = stat.wins + stat.losses;
    stat.win_pct = decided > 0 ? Math.round((stat.wins / decided) * 100) : 0;
  }

  const standings = Array.from(statsMap.values())
    .filter((s) => s.weeks_played > 0)
    .sort((a, b) => b.all_time_total - a.all_time_total || a.display_name.localeCompare(b.display_name));

  // League-wide team tendencies
  const teamMap = new Map<string, TeamTendency>();
  for (const pick of picks) {
    const game = pick.games;
    if (!game || game.status !== "FINAL") continue;
    const teamName = pick.picked_team === "HOME" ? game.home_team : game.away_team;
    if (!teamMap.has(teamName)) {
      teamMap.set(teamName, { team: teamName, picks: 0, wins: 0, losses: 0, pushes: 0, win_pct: 0 });
    }
    const t = teamMap.get(teamName)!;
    t.picks += 1;
    if (pick.points !== null && pick.points > 0) t.wins += 1;
    else if (pick.points !== null && pick.points < 0) t.losses += 1;
    else t.pushes += 1;
  }

  const teamTendencies = Array.from(teamMap.values())
    .map((t) => {
      const decided = t.wins + t.losses;
      return { ...t, win_pct: decided > 0 ? Math.round((t.wins / decided) * 100) : 0 };
    })
    .sort((a, b) => b.picks - a.picks)
    .slice(0, 20);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Analytics</h1>

      {/* All-time standings */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">All-Time Standings</h2>
        {standings.length === 0 ? (
          <p className="text-sm text-gray-400">No closed weeks yet.</p>
        ) : (
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-max">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-2 text-left w-8">#</th>
                    <th className="px-4 py-2 text-left">Member</th>
                    <th className="px-4 py-2 text-center">Seasons</th>
                    <th className="px-4 py-2 text-center">Weeks</th>
                    <th className="px-4 py-2 text-center">W-L-P</th>
                    <th className="px-4 py-2 text-center">Win %</th>
                    <th className="px-4 py-2 text-right">Total Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, idx) => (
                    <tr key={s.member_id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className={`px-4 py-3 font-bold text-sm ${
                        idx === 0 ? "text-amber-500" : idx === 1 ? "text-gray-400" : idx === 2 ? "text-amber-700" : "text-gray-300"
                      }`}>{idx + 1}</td>
                      <td className="px-4 py-3">
                        <Link href={`/stats/${s.member_id}`} className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">
                          {s.display_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">{s.seasons_played}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{s.weeks_played}</td>
                      <td className="px-4 py-3 text-center text-gray-600 tabular-nums">
                        {s.wins}–{s.losses}{s.pushes > 0 ? `–${s.pushes}` : ""}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-medium tabular-nums ${s.win_pct >= 60 ? "text-green-600" : s.win_pct >= 50 ? "text-gray-700" : "text-red-500"}`}>
                          {s.win_pct}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">
                        <span className={s.all_time_total > 0 ? "text-gray-900" : "text-red-500"}>
                          {s.all_time_total > 0 ? `+${s.all_time_total}` : s.all_time_total}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* League-wide team tendencies */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Most-Picked Teams (League)</h2>
        {teamTendencies.length === 0 ? (
          <p className="text-sm text-gray-400">No resolved games yet.</p>
        ) : (
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
                {teamTendencies.map((t) => (
                  <tr key={t.team} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{t.team}</td>
                    <td className="px-4 py-2.5 text-center text-gray-600">{t.picks}</td>
                    <td className="px-4 py-2.5 text-center text-gray-600 tabular-nums">
                      {t.wins}–{t.losses}{t.pushes > 0 ? `–${t.pushes}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`font-medium tabular-nums ${t.win_pct >= 60 ? "text-green-600" : t.win_pct >= 50 ? "text-gray-700" : "text-red-500"}`}>
                        {t.win_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
