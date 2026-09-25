import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { selectedTeam, opponentTeam, pickRecord, withForfeits, lockRecord, winPct } from "@/lib/wagers";

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
  lock_wins: number;
  lock_losses: number;
  lock_pushes: number;
};

type TeamTendency = {
  team: string;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  win_pct: number;
};

type ConferenceTendency = TeamTendency & {
  conference: string;
  teams: TeamTendency[];
};

const UNKNOWN_CONFERENCE = "FCS / Other";

function newTendency(team: string): TeamTendency {
  return { team, picks: 0, wins: 0, losses: 0, pushes: 0, win_pct: 0 };
}

/** Count one graded pick into a tally. Per pick, not per game -- a lock is still one opinion. */
function tally(t: TeamTendency, points: number | null) {
  t.picks += 1;
  if (points !== null && points > 0) t.wins += 1;
  else if (points !== null && points < 0) t.losses += 1;
  else t.pushes += 1;
}

function withWinPct<T extends TeamTendency>(t: T): T {
  const decided = t.wins + t.losses;
  return { ...t, win_pct: decided > 0 ? Math.round((t.wins / decided) * 100) : 0 };
}

const byPicks = (a: TeamTendency, b: TeamTendency) => b.picks - a.picks || a.team.localeCompare(b.team);

export default async function AnalyticsPage() {
  const admin = createAdminClient();

  const [profilesRes, scoresRes, picksRes, teamsRes] = await Promise.all([
    admin.from("profiles").select("id, display_name").eq("is_active", true),
    admin.from("weekly_scores").select("member_id, total, forfeit_penalty, week_id, weeks(season_id, status)"),
    admin.from("picks").select("member_id, bet_type, selection, line, is_lotw, is_loty, points, games(sport, home_team, away_team, winner, status)").not("points", "is", null),
    admin.from("teams").select("sport, name, conference, division"),
  ]);

  const profiles = profilesRes.data ?? [];
  const scores = scoresRes.data ?? [];
  const picks = picksRes.data ?? [];
  const teams = teamsRes.data ?? [];

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
      lock_wins: 0,
      lock_losses: 0,
      lock_pushes: 0,
    });
  }

  const seasonsByMember = new Map<string, Set<number>>();
  // Forfeited slots write no pick row, so the record has to pick them up here. Kept in their
  // own map rather than added to stat.losses on the spot: the picks loop below *assigns*
  // wins/losses, so anything booked now would be overwritten.
  const forfeitsByMember = new Map<string, number>();
  for (const s of scores) {
    const week = s.weeks;
    if (!week || week.status !== "CLOSED") continue;
    const stat = statsMap.get(s.member_id);
    if (!stat) continue;
    stat.all_time_total += s.total ?? 0;
    stat.weeks_played += 1;
    forfeitsByMember.set(s.member_id, (forfeitsByMember.get(s.member_id) ?? 0) + (s.forfeit_penalty ?? 0));
    if (!seasonsByMember.has(s.member_id)) seasonsByMember.set(s.member_id, new Set());
    seasonsByMember.get(s.member_id)!.add(week.season_id);
  }

  for (const [memberId, seasonSet] of seasonsByMember) {
    const stat = statsMap.get(memberId);
    if (stat) stat.seasons_played = seasonSet.size;
  }

  // All-time record, counted in games: a LOTW is two of them and a LOTY seven, so a member
  // who leaned on their locks and missed carries it in the W-L, not just in the points.
  const picksByMember = new Map<string, typeof picks>();
  for (const pick of picks) {
    const list = picksByMember.get(pick.member_id);
    if (list) list.push(pick);
    else picksByMember.set(pick.member_id, [pick]);
  }

  for (const [memberId, memberPicks] of picksByMember) {
    const stat = statsMap.get(memberId);
    if (!stat) continue;
    // total_picks stays a count of picks -- it answers "how many bets", not "how many games".
    stat.total_picks = memberPicks.length;
    const { wins, losses, pushes } = pickRecord(memberPicks);
    stat.wins = wins;
    stat.losses = losses;
    stat.pushes = pushes;

    // The lock column keeps its own scale -- LOTY at 3x a LOTW, not the 2-and-7 the league
    // record now reads in -- because a year-end prize rides on this number. See
    // LOCK_PRIZE_WEIGHT.
    const locks = lockRecord(memberPicks);
    stat.lock_wins = locks.wins;
    stat.lock_losses = locks.losses;
    stat.lock_pushes = locks.pushes;
  }

  // Fold the forfeits in over every member, not just the ones the picks loop touched -- a
  // member who sat a whole week out has a penalty and no picks to hang it off.
  for (const stat of statsMap.values()) {
    const { wins, losses, pushes } = withForfeits(stat, forfeitsByMember.get(stat.member_id));
    stat.wins = wins;
    stat.losses = losses;
    stat.pushes = pushes;
    stat.win_pct = winPct(stat);
  }

  const standings = Array.from(statsMap.values())
    .filter((s) => s.weeks_played > 0)
    .sort((a, b) => b.all_time_total - a.all_time_total || a.display_name.localeCompare(b.display_name));

  // League-wide team tendencies. Per pick, not per game -- see the member stats page: this
  // measures how often the league is right about a team, which a lock does not change.
  //
  // Two tallies from one pass: the side the league took, and the side it faded. A win in
  // the faded table means the league was right to bet against that team.
  const teamMap = new Map<string, TeamTendency>();
  const againstMap = new Map<string, TeamTendency>();
  for (const pick of picks) {
    const game = pick.games;
    if (!game || game.status !== "FINAL") continue;
    // A total is not a bet on a team, so it has no place in team tendencies.
    const teamName = selectedTeam(pick, game);
    const opponentName = opponentTeam(pick, game);
    if (!teamName || !opponentName) continue;

    // Keys carry the sport so a CFB and NFL team sharing a name cannot merge; the display
    // name is still just the team.
    const teamKey = `${game.sport}:${teamName}`;
    if (!teamMap.has(teamKey)) teamMap.set(teamKey, newTendency(teamName));
    tally(teamMap.get(teamKey)!, pick.points);

    const opponentKey = `${game.sport}:${opponentName}`;
    if (!againstMap.has(opponentKey)) againstMap.set(opponentKey, newTendency(opponentName));
    tally(againstMap.get(opponentKey)!, pick.points);
  }

  const teamTendencies = Array.from(teamMap.values()).map(withWinPct).sort(byPicks).slice(0, 20);
  const pickedAgainst = Array.from(againstMap.values()).map(withWinPct).sort(byPicks).slice(0, 20);

  // Roll the picked-for tally up by conference. The teams table is the lookup; a team it does
  // not know (an FCS opponent, a stray seed row) lands in "FCS / Other" rather than vanishing.
  // The NFL groups by division -- AFC/NFC is two buckets of sixteen, which says nothing.
  const conferenceByTeam = new Map<string, string>();
  for (const t of teams) {
    const group = t.sport === "NFL" ? t.division ?? t.conference : t.conference;
    if (group) conferenceByTeam.set(`${t.sport}:${t.name}`, group);
  }
  const conferenceMap = new Map<string, ConferenceTendency>();
  for (const [key, t] of teamMap) {
    const conference = conferenceByTeam.get(key) ?? UNKNOWN_CONFERENCE;
    if (!conferenceMap.has(conference)) {
      conferenceMap.set(conference, { ...newTendency(conference), conference, teams: [] });
    }
    const c = conferenceMap.get(conference)!;
    c.picks += t.picks;
    c.wins += t.wins;
    c.losses += t.losses;
    c.pushes += t.pushes;
    c.teams.push(t);
  }
  const conferences = Array.from(conferenceMap.values())
    .map((c) => ({ ...withWinPct(c), teams: c.teams.map(withWinPct).sort(byPicks) }))
    // The catch-all is not a conference -- it sits last however many picks it holds.
    .sort((a, b) => {
      if (a.conference === UNKNOWN_CONFERENCE) return 1;
      if (b.conference === UNKNOWN_CONFERENCE) return -1;
      return byPicks(a, b);
    });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Analytics</h1>

      {/* All-time standings */}
      <section className="mb-8">
        <h2 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-3">All-Time Standings</h2>
        {standings.length === 0 ? (
          <p className="text-sm text-slate-400">No closed weeks yet.</p>
        ) : (
          <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-max">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800 text-xs font-bold text-slate-300 uppercase tracking-wide">
                    <th className="px-4 py-2 text-left w-8">#</th>
                    <th className="px-4 py-2 text-left">Member</th>
                    <th className="px-4 py-2 text-center">Seasons</th>
                    <th className="px-4 py-2 text-center">Weeks</th>
                    <th className="px-4 py-2 text-center">W-L-P</th>
                    <th className="px-4 py-2 text-center">LOTW</th>
                    <th className="px-4 py-2 text-center">Win %</th>
                    <th className="px-4 py-2 text-right">Total Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, idx) => (
                    <tr key={s.member_id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/70">
                      <td className={`px-4 py-3 font-bold text-sm ${
                        idx === 0 ? "text-amber-400" : idx === 1 ? "text-slate-300" : idx === 2 ? "text-orange-400" : "text-slate-400"
                      }`}>{idx + 1}</td>
                      <td className="px-4 py-3">
                        <Link href={`/stats/${s.member_id}`} className="font-semibold text-white underline-offset-4 hover:text-sky-300 hover:underline transition-colors">
                          {s.display_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-300">{s.seasons_played}</td>
                      <td className="px-4 py-3 text-center text-slate-300">{s.weeks_played}</td>
                      <td className="px-4 py-3 text-center text-slate-300 tabular-nums">
                        {s.wins}–{s.losses}{s.pushes > 0 ? `–${s.pushes}` : ""}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-300 tabular-nums">
                        {s.lock_wins + s.lock_losses + s.lock_pushes === 0 ? (
                          <span className="text-slate-500">—</span>
                        ) : (
                          <>{s.lock_wins}–{s.lock_losses}{s.lock_pushes > 0 ? `–${s.lock_pushes}` : ""}</>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-medium tabular-nums ${s.win_pct >= 60 ? "text-emerald-400" : s.win_pct >= 50 ? "text-slate-100" : "text-red-400"}`}>
                          {s.win_pct}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">
                        <span className={s.all_time_total > 0 ? "text-white" : "text-red-400"}>
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

      {/* League-wide team tendencies: the sides taken, and the sides faded */}
      <div className="grid gap-8 lg:grid-cols-2 mb-8">
        <section>
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-3">Most-Picked Teams (League)</h2>
          <p className="text-xs text-slate-500 mb-3">Teams the league bets on. A win here means the team covered.</p>
          {teamTendencies.length === 0 ? (
            <p className="text-sm text-slate-400">No resolved games yet.</p>
          ) : (
            <TeamTable rows={teamTendencies} />
          )}
        </section>

        <section>
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-3">Most-Picked-Against Teams (League)</h2>
          <p className="text-xs text-slate-500 mb-3">Teams the league bets against. A win here means the fade paid.</p>
          {pickedAgainst.length === 0 ? (
            <p className="text-sm text-slate-400">No resolved games yet.</p>
          ) : (
            <TeamTable rows={pickedAgainst} />
          )}
        </section>
      </div>

      {/* Most-picked teams, rolled up by conference */}
      <section>
        <h2 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-3">Most-Picked Teams by Conference</h2>
        {conferences.length === 0 ? (
          <p className="text-sm text-slate-400">No resolved games yet.</p>
        ) : (
          <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800 text-xs font-bold text-slate-300 uppercase tracking-wide">
                  <th className="px-4 py-2 text-left">Conference</th>
                  <th className="px-4 py-2 text-center">Picks</th>
                  <th className="px-4 py-2 text-center">W-L-P</th>
                  <th className="px-4 py-2 text-center">Win %</th>
                </tr>
              </thead>
              {conferences.map((c) => (
                <tbody key={c.conference} className="border-b border-slate-800 last:border-0">
                  <tr className="bg-slate-800/40">
                    <td className="px-4 py-2.5 font-bold text-white">
                      {c.conference}
                      <span className="ml-2 text-xs font-normal text-slate-500">{c.teams.length} {c.teams.length === 1 ? "team" : "teams"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center font-semibold text-slate-200">{c.picks}</td>
                    <td className="px-4 py-2.5 text-center font-semibold text-slate-200 tabular-nums">
                      {c.wins}–{c.losses}{c.pushes > 0 ? `–${c.pushes}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <WinPct value={c.win_pct} />
                    </td>
                  </tr>
                  {c.teams.map((t) => (
                    <tr key={t.team} className="hover:bg-slate-800/70">
                      <td className="pl-8 pr-4 py-2 text-slate-300">{t.team}</td>
                      <td className="px-4 py-2 text-center text-slate-400">{t.picks}</td>
                      <td className="px-4 py-2 text-center text-slate-400 tabular-nums">
                        {t.wins}–{t.losses}{t.pushes > 0 ? `–${t.pushes}` : ""}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <WinPct value={t.win_pct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function WinPct({ value }: { value: number }) {
  return (
    <span className={`font-medium tabular-nums ${value >= 60 ? "text-emerald-400" : value >= 50 ? "text-slate-100" : "text-red-400"}`}>
      {value}%
    </span>
  );
}

function TeamTable({ rows }: { rows: TeamTendency[] }) {
  return (
    <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-800 text-xs font-bold text-slate-300 uppercase tracking-wide">
            <th className="px-4 py-2 text-left">Team</th>
            <th className="px-4 py-2 text-center">Picks</th>
            <th className="px-4 py-2 text-center">W-L-P</th>
            <th className="px-4 py-2 text-center">Win %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.team} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/70">
              <td className="px-4 py-2.5 font-semibold text-white">{t.team}</td>
              <td className="px-4 py-2.5 text-center text-slate-300">{t.picks}</td>
              <td className="px-4 py-2.5 text-center text-slate-300 tabular-nums">
                {t.wins}–{t.losses}{t.pushes > 0 ? `–${t.pushes}` : ""}
              </td>
              <td className="px-4 py-2.5 text-center">
                <WinPct value={t.win_pct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
