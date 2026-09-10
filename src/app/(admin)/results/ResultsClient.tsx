"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Week = { id: number; week_number: number; status: string; required_picks: number; season_id: number; season_year: number };
type Game = {
  id: string; week_id: number; sport: string; home_team: string; away_team: string;
  kickoff_time: string; status: string; winner: string | null; in_pool: boolean; external_id: string;
  home_score: number | null; away_score: number | null; last_synced_at: string | null; manual_resolved: boolean;
};

// Pool weeks are calendar-aligned: pool week N holds CFB week N and NFL week
// N-1 (they share a weekend). Upstream APIs fold CFB "week 0" into week 1, so
// pool weeks 0/1 sync CFB week 1 split by a Sep 1 kickoff cutoff.
const LAST_CFB_POOL_WEEK = 12;

function scheduleSyncParams(sport: "CFB" | "NFL", week: Week) {
  const year = week.season_year;
  if (sport === "NFL") {
    const nflWeek = week.week_number - 1;
    return nflWeek >= 1 ? { year, nflWeek } : null;
  }
  if (week.week_number > LAST_CFB_POOL_WEEK) return null;
  const cutoff = `${year}-09-01`;
  if (week.week_number === 0) return { year, cfbWeek: 1, before: cutoff };
  if (week.week_number === 1) return { year, cfbWeek: 1, after: cutoff };
  return { year, cfbWeek: week.week_number };
}

interface Props {
  weeks: Week[];
  currentWeek: Week | null;
  games: Game[];
}

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-slate-700 text-slate-200 ring-1 ring-slate-600",
  LIVE: "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40",
  FINAL: "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40",
  POSTPONED: "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40",
  CANCELLED: "bg-red-500/20 text-red-300 ring-1 ring-red-500/40",
};

export function ResultsClient({ weeks, currentWeek, games: initialGames }: Props) {
  const router = useRouter();
  // Server data stays the source of truth (router.refresh() re-renders with
  // fresh props); optimistic edits are layered on top per game.
  const [overrides, setOverrides] = useState<Record<string, Partial<Game>>>({});
  const games = initialGames.map((g) => (overrides[g.id] ? { ...g, ...overrides[g.id] } : g));
  const [syncing, setSyncing] = useState<"CFB" | "NFL" | "RESULTS" | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [confirmOverride, setConfirmOverride] = useState<{ gameId: string; homeScore: number; awayScore: number } | null>(null);
  const [excludeConfirm, setExcludeConfirm] = useState<{ gameId: string; count: number } | null>(null);
  const [statusModal, setStatusModal] = useState<{ gameId: string; action: "POSTPONED" | "CANCELLED" } | null>(null);

  function updateGame(id: string, patch: Partial<Game>) {
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...patch } }));
  }

  async function handleSync(sport: "CFB" | "NFL") {
    if (!currentWeek) return;
    const params = scheduleSyncParams(sport, currentWeek);
    if (!params) return;
    setSyncing(sport);
    setSyncResult(null);
    const res = await fetch("/api/admin/sync-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekId: currentWeek.id, sport, ...params }),
    });
    const data = await res.json();
    setSyncing(null);
    setSyncResult(
      res.ok
        ? `${sport}: ${data.upserted ?? 0} games synced${data.skipped_manual ? `, ${data.skipped_manual} manual kept` : ""}`
        : `${sport} sync failed: ${data.error}`
    );
    if (res.ok) router.refresh();
  }

  async function handleSyncResults() {
    if (!currentWeek) return;
    setSyncing("RESULTS");
    setSyncResult(null);
    const res = await fetch("/api/admin/sync-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekId: currentWeek.id }),
    });
    const data = await res.json();
    setSyncing(null);
    const summary = data.results?.[currentWeek.id];
    setSyncResult(
      summary && !summary.error
        ? `Results: ${summary.resolved} resolved, ${summary.skipped_manual} manual kept, ${summary.touched} checked${summary.errors?.length ? `, ${summary.errors.length} errors` : ""}`
        : `Results sync failed: ${summary?.error ?? data.error ?? "unknown error"}`
    );
    if (res.ok) router.refresh();
  }

  // Scores, not a winner. Members hold their own spreads and totals, so the margin is
  // what grades a week -- "HOME won" is not enough.
  async function handleResult(gameId: string, homeScore: number, awayScore: number, force = false) {
    if (!force) {
      const game = games.find((g) => g.id === gameId);
      if (game?.status === "FINAL") {
        setConfirmOverride({ gameId, homeScore, awayScore });
        return;
      }
    }
    setConfirmOverride(null);
    const res = await fetch(`/api/admin/games/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ home_score: homeScore, away_score: awayScore, force }),
    });
    if (!res.ok) { alert((await res.json()).error); return; }
    updateGame(gameId, {
      status: "FINAL",
      home_score: homeScore,
      away_score: awayScore,
      winner: homeScore > awayScore ? "HOME" : awayScore > homeScore ? "AWAY" : "PUSH",
      manual_resolved: true,
    });
  }

  async function handlePoolToggle(gameId: string, inPool: boolean, force = false) {
    if (!inPool && !force) {
      const res = await fetch(`/api/admin/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ in_pool: false }),
      });
      const data = await res.json();
      if (!res.ok && data.error === "picks_exist") {
        setExcludeConfirm({ gameId, count: data.count });
        return;
      }
      if (!res.ok) { alert(data.error); return; }
      updateGame(gameId, { in_pool: false });
      return;
    }
    setExcludeConfirm(null);
    const res = await fetch(`/api/admin/games/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ in_pool: inPool, force }),
    });
    if (!res.ok) { alert((await res.json()).error); return; }
    updateGame(gameId, { in_pool: inPool });
  }

  async function handleResetToApi(gameId: string) {
    const res = await fetch(`/api/admin/games/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manual_resolved: false }),
    });
    if (!res.ok) { alert((await res.json()).error); return; }
    updateGame(gameId, { manual_resolved: false });
  }

  async function handleStatusChange(gameId: string, status: "POSTPONED" | "CANCELLED") {
    setStatusModal(null);
    const res = await fetch(`/api/admin/games/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { alert((await res.json()).error); return; }
    updateGame(gameId, { status });
  }

  const cfbGames = games.filter((g) => g.sport === "CFB");
  const nflGames = games.filter((g) => g.sport === "NFL");
  const lastSynced = games.reduce<string | null>(
    (max, g) => (g.last_synced_at && (!max || g.last_synced_at > max) ? g.last_synced_at : max),
    null
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Results</h1>
        <select
          className="rounded-lg px-3 py-2 text-sm font-medium border border-slate-600 bg-slate-800 text-white focus:border-sky-400 focus:outline-none"
          value={currentWeek?.id ?? ""}
          onChange={(e) => router.push(`/admin/results?week=${e.target.value}`)}
        >
          {weeks.map((w) => (
            <option key={w.id} value={w.id}>{w.season_year} Week {w.week_number} — {w.status}</option>
          ))}
        </select>
      </div>

      {!currentWeek && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-4 text-sm text-amber-200">
          No weeks found. Create a week in the Weeks section first.
        </div>
      )}

      {currentWeek && (
        <>
          {/* Sync controls */}
          <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl p-4 mb-6 flex items-center gap-4 flex-wrap">
            <span className="text-sm font-semibold text-white">Sync schedule:</span>
            <button
              onClick={() => handleSync("CFB")}
              disabled={syncing !== null || !scheduleSyncParams("CFB", currentWeek)}
              title={!scheduleSyncParams("CFB", currentWeek) ? "No CFB this pool week" : undefined}
              className="text-sm font-semibold border border-slate-600 bg-slate-800 text-slate-100 rounded-lg px-3 py-1.5 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-40"
            >
              {syncing === "CFB" ? "Syncing CFB…" : "Sync CFB"}
            </button>
            <button
              onClick={() => handleSync("NFL")}
              disabled={syncing !== null || !scheduleSyncParams("NFL", currentWeek)}
              title={!scheduleSyncParams("NFL", currentWeek) ? "No NFL this pool week" : undefined}
              className="text-sm font-semibold border border-slate-600 bg-slate-800 text-slate-100 rounded-lg px-3 py-1.5 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-40"
            >
              {syncing === "NFL" ? "Syncing NFL…" : "Sync NFL"}
            </button>
            <button
              onClick={handleSyncResults}
              disabled={syncing !== null || games.length === 0}
              title={games.length === 0 ? "Sync the schedule first" : undefined}
              className="text-sm font-semibold border border-sky-500/60 bg-sky-500/10 text-sky-300 rounded-lg px-3 py-1.5 transition-colors hover:bg-sky-500/25 hover:text-sky-200 disabled:opacity-40"
            >
              {syncing === "RESULTS" ? "Syncing results…" : "Sync Results"}
            </button>
            {syncResult && <span className="text-sm text-slate-300">{syncResult}</span>}
            {lastSynced && (
              <span className="text-xs text-slate-400 ml-auto">
                Last synced {new Date(lastSynced).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          {games.length === 0 && (
            <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl p-8 text-center text-slate-400 text-sm">
              No games yet. Click &ldquo;Sync CFB&rdquo; or &ldquo;Sync NFL&rdquo; to pull this week&apos;s schedule.
            </div>
          )}

          {[{ label: "NFL", list: nflGames }, { label: "CFB", list: cfbGames }].map(({ label, list }) =>
            list.length === 0 ? null : (
              <div key={label} className="mb-6">
                <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wide mb-2">{label}</h2>
                <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl divide-y divide-slate-800">
                  {list.map((game) => (
                    <GameRow
                      key={game.id}
                      game={game}
                      onResult={handleResult}
                      onPoolToggle={handlePoolToggle}
                      onStatusChange={(id, action) => setStatusModal({ gameId: id, action })}
                      onResetToApi={handleResetToApi}
                    />
                  ))}
                </div>
              </div>
            )
          )}
        </>
      )}

      {/* Confirm result correction */}
      {confirmOverride && (
        <Modal title="Correct result?" onClose={() => setConfirmOverride(null)}>
          <p className="text-sm text-slate-300 mb-4">
            This game is already FINAL. Changing the score re-grades every wager on it against each member\u2019s own line, so results may move for some members and not others.
          </p>
          <div className="flex gap-3">
            <button onClick={() => handleResult(confirmOverride.gameId, confirmOverride.homeScore, confirmOverride.awayScore, true)}
              className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-red-500/25 transition-colors hover:bg-red-400">
              Update result
            </button>
            <button onClick={() => setConfirmOverride(null)} className="text-sm font-semibold text-slate-300 transition-colors hover:text-white hover:underline">Cancel</button>
          </div>
        </Modal>
      )}

      {/* Confirm exclude with picks */}
      {excludeConfirm && (
        <Modal title="Exclude game?" onClose={() => setExcludeConfirm(null)}>
          <p className="text-sm text-slate-300 mb-4">
            {excludeConfirm.count} member{excludeConfirm.count !== 1 ? "s have" : " has"} already picked this game. Those picks will be orphaned and treated as forfeits.
          </p>
          <div className="flex gap-3">
            <button onClick={() => handlePoolToggle(excludeConfirm.gameId, false, true)}
              className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-red-500/25 transition-colors hover:bg-red-400">
              Exclude anyway
            </button>
            <button onClick={() => setExcludeConfirm(null)} className="text-sm font-semibold text-slate-300 transition-colors hover:text-white hover:underline">Cancel</button>
          </div>
        </Modal>
      )}

      {/* Status change confirmation */}
      {statusModal && (
        <Modal title={`Mark as ${statusModal.action.toLowerCase()}?`} onClose={() => setStatusModal(null)}>
          <p className="text-sm text-slate-300 mb-4">
            {statusModal.action === "POSTPONED"
              ? "Picks on this game will be unfrozen and members can edit them again."
              : "All picks on this game will receive 0 points and it will be excluded from the required pick count."}
          </p>
          <div className="flex gap-3">
            <button onClick={() => handleStatusChange(statusModal.gameId, statusModal.action)}
              className="bg-amber-400 text-slate-950 px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-amber-500/25 transition-colors hover:bg-amber-300">
              Confirm
            </button>
            <button onClick={() => setStatusModal(null)} className="text-sm font-semibold text-slate-300 transition-colors hover:text-white hover:underline">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function GameRow({ game, onResult, onPoolToggle, onStatusChange, onResetToApi }: {
  game: Game;
  onResult: (id: string, homeScore: number, awayScore: number) => void;
  onPoolToggle: (id: string, inPool: boolean) => void;
  onStatusChange: (id: string, action: "POSTPONED" | "CANCELLED") => void;
  onResetToApi: (id: string) => void;
}) {
  const locked = new Date(game.kickoff_time) <= new Date();
  const hasScore = game.home_score !== null && game.away_score !== null;

  return (
    <div className={`px-4 py-3 flex items-center gap-4 text-sm flex-wrap ${!game.in_pool ? "opacity-50" : ""}`}>
      <div className="flex-1 min-w-[200px]">
        <span className="font-semibold text-white">{game.away_team}</span>
        {hasScore && <span className="font-semibold tabular-nums ml-1.5">{game.away_score}</span>}
        <span className="text-slate-400 mx-2">@</span>
        <span className="font-semibold text-white">{game.home_team}</span>
        {hasScore && <span className="font-semibold tabular-nums ml-1.5">{game.home_score}</span>}
        <span className="text-xs text-slate-400 ml-2">
          {new Date(game.kickoff_time).toLocaleDateString()} {new Date(game.kickoff_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {locked && <span className="ml-1 text-amber-400">• Locked</span>}
        </span>
        {game.last_synced_at && (
          <span className="block text-xs text-slate-500">
            synced {new Date(game.last_synced_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[game.status] ?? "bg-slate-700 text-slate-200 ring-1 ring-slate-600"}`}>
        {game.status}{game.winner ? ` — ${game.winner}` : ""}
      </span>

      {game.manual_resolved && (
        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40">
          Manually resolved
          <button
            onClick={() => onResetToApi(game.id)}
            title="Let API results sync manage this game again"
            className="ml-1.5 underline hover:text-violet-200"
          >
            reset to API
          </button>
        </span>
      )}

      {/* Score entry */}
      {game.status !== "CANCELLED" && <ScoreEntry game={game} onResult={onResult} />}

      {/* Pool + status controls */}
      <div className="flex gap-1">
        {game.in_pool ? (
          <button onClick={() => onPoolToggle(game.id, false)}
            className="text-xs text-slate-300 hover:text-red-300 border border-slate-600 bg-slate-800 rounded px-2 py-1 font-semibold transition-colors hover:bg-slate-700">
            Exclude
          </button>
        ) : (
          <button onClick={() => onPoolToggle(game.id, true)}
            disabled={locked}
            className="text-xs text-slate-300 hover:text-sky-300 border border-slate-600 bg-slate-800 rounded px-2 py-1 font-semibold transition-colors hover:bg-slate-700 disabled:opacity-40">
            Include
          </button>
        )}
        {game.status === "SCHEDULED" && (
          <>
            <button onClick={() => onStatusChange(game.id, "POSTPONED")}
              className="text-xs text-slate-300 hover:text-amber-300 border border-slate-600 bg-slate-800 rounded px-2 py-1 font-semibold transition-colors hover:bg-slate-700">PPD</button>
            <button onClick={() => onStatusChange(game.id, "CANCELLED")}
              className="text-xs text-slate-300 hover:text-red-300 border border-slate-600 bg-slate-800 rounded px-2 py-1 font-semibold transition-colors hover:bg-slate-700">CXL</button>
          </>
        )}
        {game.status === "POSTPONED" && (
          <button onClick={() => onStatusChange(game.id, "SCHEDULED" as never)}
            className="text-xs text-slate-300 hover:text-sky-300 border border-slate-600 bg-slate-800 rounded px-2 py-1 font-semibold transition-colors hover:bg-slate-700">Reschedule</button>
        )}
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl shadow-black/60">
        <h2 className="font-bold text-lg text-white mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Two score boxes and a save. Pre-filled from whatever the API sync last recorded, so a
 * correction starts from the current number rather than from blank.
 */
function ScoreEntry({ game, onResult }: {
  game: Game;
  onResult: (id: string, homeScore: number, awayScore: number) => void;
}) {
  const [away, setAway] = useState(game.away_score !== null ? String(game.away_score) : "");
  const [home, setHome] = useState(game.home_score !== null ? String(game.home_score) : "");

  const parse = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : null);
  const a = parse(away);
  const h = parse(home);
  const ready = a !== null && h !== null;
  const changed = a !== game.away_score || h !== game.home_score;

  return (
    <div className="flex items-center gap-1">
      <input
        type="text" inputMode="numeric" value={away}
        onChange={(e) => setAway(e.target.value)}
        placeholder={game.away_team.split(" ").pop()}
        title={`${game.away_team} (away)`}
        className="w-12 px-1.5 py-1 rounded border border-slate-600 bg-slate-800 text-white text-xs tabular-nums text-center focus:border-sky-400 focus:outline-none"
      />
      <span className="text-xs text-slate-500">–</span>
      <input
        type="text" inputMode="numeric" value={home}
        onChange={(e) => setHome(e.target.value)}
        placeholder={game.home_team.split(" ").pop()}
        title={`${game.home_team} (home)`}
        className="w-12 px-1.5 py-1 rounded border border-slate-600 bg-slate-800 text-white text-xs tabular-nums text-center focus:border-sky-400 focus:outline-none"
      />
      <button
        onClick={() => ready && onResult(game.id, h, a)}
        disabled={!ready || !changed}
        className="text-xs font-semibold px-3 py-1 rounded-md border border-emerald-500/60 bg-emerald-500/15 text-emerald-300 transition-colors hover:bg-emerald-500/30 hover:text-emerald-200 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {game.status === "FINAL" ? "Correct" : "Resolve"}
      </button>
    </div>
  );
}
