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
            <p className="text-gray-500 text-sm mt-1">{currentSeason.name}</p>
          )}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + New Week
        </button>
      </div>

      {!currentSeason && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-6">
          No season found. Create a season in the database first.
        </div>
      )}

      {/* New week form */}
      {showForm && currentSeason && (
        <form
          onSubmit={handleCreate}
          className="bg-white border rounded-xl p-6 mb-6 space-y-4"
        >
          <h2 className="font-semibold text-gray-800">New Week</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Week #</label>
              <input
                type="number"
                min="1"
                required
                value={formData.week_number}
                onChange={(e) => setFormData((f) => ({ ...f, week_number: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Required picks</label>
              <input
                type="number"
                min="1"
                required
                value={formData.required_picks}
                onChange={(e) => setFormData((f) => ({ ...f, required_picks: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Opens at</label>
              <input
                type="datetime-local"
                required
                value={formData.opens_at}
                onChange={(e) => setFormData((f) => ({ ...f, opens_at: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Closes at</label>
              <input
                type="datetime-local"
                required
                value={formData.closes_at}
                onChange={(e) => setFormData((f) => ({ ...f, closes_at: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create week"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              className="text-gray-600 text-sm hover:underline"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Unresolved games warning modal */}
      {closingWeekId && unresolvedGames.length > 0 && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h2 className="font-semibold text-lg mb-2">Unresolved games</h2>
            <p className="text-sm text-gray-600 mb-3">
              The following games have no result yet. Close anyway?
            </p>
            <ul className="text-sm text-gray-700 mb-4 space-y-1">
              {unresolvedGames.map((g) => (
                <li key={g.id} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                  {g.away_team} @ {g.home_team}
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              <button
                onClick={() => handleClose(closingWeekId, true)}
                className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
              >
                Close anyway
              </button>
              <button
                onClick={() => { setClosingWeekId(null); setUnresolvedGames([]); }}
                className="text-gray-600 text-sm hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen confirmation modal */}
      {reopenConfirmId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h2 className="font-semibold text-lg mb-2">Reopen week?</h2>
            <p className="text-sm text-gray-600 mb-4">
              Forfeit and LOTW penalties will be reversed and recalculated when
              the week is closed again.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleReopen(reopenConfirmId)}
                className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700"
              >
                Reopen week
              </button>
              <button
                onClick={() => setReopenConfirmId(null)}
                className="text-gray-600 text-sm hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Weeks table */}
      {weeks.length === 0 ? (
        <div className="bg-white border rounded-xl p-8 text-center text-gray-400 text-sm">
          No weeks yet. Create the first one above.
        </div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Week</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Required picks</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Opens</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Closes</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {weeks.map((week) => (
                <tr key={week.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">Week {week.week_number}</td>
                  <td className="px-4 py-3 text-gray-600">{week.required_picks}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(week.opens_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(week.closes_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        week.status === "OPEN"
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {week.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {week.status === "OPEN" ? (
                      <button
                        onClick={() => handleClose(week.id)}
                        className="text-xs text-gray-600 hover:text-red-600 border rounded px-2 py-1 hover:border-red-300"
                      >
                        Close week
                      </button>
                    ) : (
                      <button
                        onClick={() => setReopenConfirmId(week.id)}
                        className="text-xs text-gray-600 hover:text-amber-600 border rounded px-2 py-1"
                      >
                        Reopen
                      </button>
                    )}
                    <a
                      href={`/admin/results?week=${week.id}`}
                      className="ml-2 text-xs text-blue-600 hover:underline"
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
