"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Season = { id: number; name: string; year: number };
type Week = {
  id: number;
  week_number: number;
  required_picks: number;
  opens_at: string;
  closes_at: string;
  status: string;
};

interface Props {
  seasons: Season[];
  currentSeason: Season | null;
  weeks: Week[];
}

export function WeeksClient({ seasons, currentSeason, weeks: initialWeeks }: Props) {
  const router = useRouter();
  const [weeks, setWeeks] = useState(initialWeeks);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    week_number: "",
    required_picks: "10",
    opens_at: "",
    closes_at: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close week state
  const [closingWeekId, setClosingWeekId] = useState<number | null>(null);
  const [unresolvedGames, setUnresolvedGames] = useState<{ id: string; home_team: string; away_team: string }[]>([]);
  const [reopenConfirmId, setReopenConfirmId] = useState<number | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!currentSeason) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/admin/weeks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        season_id: currentSeason.id,
        week_number: Number(formData.week_number),
        required_picks: Number(formData.required_picks),
        opens_at: formData.opens_at,
        closes_at: formData.closes_at,
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error);
      return;
    }

    setWeeks((prev) => [...prev, data].sort((a, b) => a.week_number - b.week_number));
    setShowForm(false);
    setFormData({ week_number: "", required_picks: "10", opens_at: "", closes_at: "" });
  }

  async function handleClose(weekId: number, force = false) {
    const res = await fetch(`/api/admin/weeks/${weekId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const data = await res.json();

    if (!res.ok && data.error === "unresolved_games") {
      setClosingWeekId(weekId);
      setUnresolvedGames(data.games);
      return;
    }

    if (!res.ok) {
      alert(data.error);
      return;
    }

    setClosingWeekId(null);
    setUnresolvedGames([]);
    setWeeks((prev) => prev.map((w) => w.id === weekId ? { ...w, status: "CLOSED" } : w));
  }

  async function handleReopen(weekId: number) {
    const res = await fetch(`/api/admin/weeks/${weekId}/reopen`, { method: "POST" });
    if (!res.ok) { alert("Failed to reopen week"); return; }
    setReopenConfirmId(null);
    setWeeks((prev) => prev.map((w) => w.id === weekId ? { ...w, status: "OPEN" } : w));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Weeks</h1>
          {currentSeason && (
            <p className="text-slate-300 text-sm mt-1">{currentSeason.name}</p>
          )}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-sky-500 text-slate-950 px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-sky-500/25 transition-colors hover:bg-sky-400 disabled:opacity-40 disabled:shadow-none"
        >
          + New Week
        </button>
      </div>

      {!currentSeason && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-4 text-sm text-amber-200 mb-6">
          No season found. Create a season in the database first.
        </div>
      )}

      {/* New week form */}
      {showForm && currentSeason && (
        <form
          onSubmit={handleCreate}
          className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl p-6 mb-6 space-y-4"
        >
          <h2 className="font-semibold text-white">New Week</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1">Week #</label>
              <input
                type="number"
                min="1"
                required
                value={formData.week_number}
                onChange={(e) => setFormData((f) => ({ ...f, week_number: e.target.value }))}
                className="w-full rounded px-3 py-2 text-sm border border-slate-600 bg-slate-800 text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1">Required picks</label>
              <input
                type="number"
                min="1"
                required
                value={formData.required_picks}
                onChange={(e) => setFormData((f) => ({ ...f, required_picks: e.target.value }))}
                className="w-full rounded px-3 py-2 text-sm border border-slate-600 bg-slate-800 text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1">Opens at</label>
              <input
                type="datetime-local"
                required
                value={formData.opens_at}
                onChange={(e) => setFormData((f) => ({ ...f, opens_at: e.target.value }))}
                className="w-full rounded px-3 py-2 text-sm border border-slate-600 bg-slate-800 text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1">Closes at</label>
              <input
                type="datetime-local"
                required
                value={formData.closes_at}
                onChange={(e) => setFormData((f) => ({ ...f, closes_at: e.target.value }))}
                className="w-full rounded px-3 py-2 text-sm border border-slate-600 bg-slate-800 text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
          </div>
          {error && <p className="text-red-400 text-sm font-medium">{error}</p>}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="bg-sky-500 text-slate-950 px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-sky-500/25 transition-colors hover:bg-sky-400 disabled:opacity-40 disabled:shadow-none"
            >
              {submitting ? "Creating…" : "Create week"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              className="text-sm font-semibold text-slate-300 transition-colors hover:text-white hover:underline"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Unresolved games warning modal */}
      {closingWeekId && unresolvedGames.length > 0 && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl shadow-black/60">
            <h2 className="font-semibold text-lg mb-2">Unresolved games</h2>
            <p className="text-sm text-slate-300 mb-3">
              The following games have no result yet. Close anyway?
            </p>
            <ul className="text-sm text-slate-200 mb-4 space-y-1">
              {unresolvedGames.map((g) => (
                <li key={g.id} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                  {g.away_team} @ {g.home_team}
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              <button
                onClick={() => handleClose(closingWeekId, true)}
                className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-red-500/25 transition-colors hover:bg-red-400"
              >
                Close anyway
              </button>
              <button
                onClick={() => { setClosingWeekId(null); setUnresolvedGames([]); }}
                className="text-sm font-semibold text-slate-300 transition-colors hover:text-white hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen confirmation modal */}
      {reopenConfirmId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl shadow-black/60">
            <h2 className="font-semibold text-lg mb-2">Reopen week?</h2>
            <p className="text-sm text-slate-300 mb-4">
              Forfeit and LOTW penalties will be reversed and recalculated when
              the week is closed again.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleReopen(reopenConfirmId)}
                className="bg-amber-400 text-slate-950 px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-amber-500/25 transition-colors hover:bg-amber-300"
              >
                Reopen week
              </button>
              <button
                onClick={() => setReopenConfirmId(null)}
                className="text-sm font-semibold text-slate-300 transition-colors hover:text-white hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Weeks table */}
      {weeks.length === 0 ? (
        <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl p-8 text-center text-slate-400 text-sm">
          No weeks yet. Create the first one above.
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 border-b border-slate-700">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-300">Week</th>
                <th className="text-left px-4 py-3 font-medium text-slate-300">Required picks</th>
                <th className="text-left px-4 py-3 font-medium text-slate-300">Opens</th>
                <th className="text-left px-4 py-3 font-medium text-slate-300">Closes</th>
                <th className="text-left px-4 py-3 font-medium text-slate-300">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {weeks.map((week) => (
                <tr key={week.id} className="hover:bg-slate-800">
                  <td className="px-4 py-3 font-semibold text-white">Week {week.week_number}</td>
                  <td className="px-4 py-3 text-slate-300">{week.required_picks}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {new Date(week.opens_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {new Date(week.closes_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        week.status === "OPEN"
                          ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                          : "bg-slate-700 text-slate-200 ring-1 ring-slate-600"
                      }`}
                    >
                      {week.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {week.status === "OPEN" ? (
                      <button
                        onClick={() => handleClose(week.id)}
                        className="text-xs text-slate-300 hover:text-red-300 border border-slate-600 bg-slate-800 rounded px-2 py-1 font-semibold transition-colors hover:bg-slate-700 hover:border-red-400"
                      >
                        Close week
                      </button>
                    ) : (
                      <button
                        onClick={() => setReopenConfirmId(week.id)}
                        className="text-xs text-slate-300 hover:text-amber-300 border border-slate-600 bg-slate-800 rounded px-2 py-1 font-semibold transition-colors hover:bg-slate-700"
                      >
                        Reopen
                      </button>
                    )}
                    <a
                      href={`/admin/results?week=${week.id}`}
                      className="ml-2 text-xs font-semibold text-sky-400 hover:text-sky-300 hover:underline"
                    >
                      Results
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
