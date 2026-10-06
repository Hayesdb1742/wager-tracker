"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatLine } from "@/lib/wagers";

export type FlagRow = {
  pick_id: string;
  status: string;
  verdict: string;
  deviation: number;
  member: string;
  placed_at: string;
  sport: string;
  week_number: number;
  matchup: string;
  bet_type: string;
  selection: string;
  pick_line: number;
  market_best_line: number;
  market_worst_line: number;
  books_seen: string[];
  points: number | null;
  reviewed_by: string | null;
  review_note: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-amber-400/10 text-amber-300 border-amber-400/30",
  CONFIRMED: "bg-rose-400/10 text-rose-300 border-rose-400/30",
  DISMISSED: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  AUTO_CLEARED: "bg-slate-500/10 text-slate-400 border-slate-500/30",
};

/** "+9.5 to +10.5", or one number when both books sat on the same line. */
function marketRange(best: number, worst: number): string {
  if (best === worst) return formatLine(Number(best));
  const [lo, hi] = [Number(worst), Number(best)].sort((a, b) => a - b);
  return `${formatLine(lo)} to ${formatLine(hi)}`;
}

function wagerText(flag: FlagRow): string {
  const [away, home] = flag.matchup.split(" at ");
  if (flag.bet_type === "TOTAL") {
    return `${flag.selection === "OVER" ? "Over" : "Under"} ${flag.pick_line}`;
  }
  const team = flag.selection === "HOME" ? home : away;
  return `${team} ${formatLine(Number(flag.pick_line))}`;
}

export function FlagCard({ flag }: { flag: FlagRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deviation = Number(flag.deviation);
  const better = flag.verdict === "BETTER_THAN_MARKET";

  async function rule(status: "DISMISSED" | "CONFIRMED" | "OPEN") {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/line-flags/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pick_id: flag.pick_id, status }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save that.");
      return;
    }
    startTransition(() => router.refresh());
  }

  const disabled = busy || pending;

  return (
    <li className="rounded-lg border border-slate-700 bg-slate-900 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold text-slate-100">{flag.member}</span>
          <span className="text-sm text-slate-400">
            {flag.sport} · week {flag.week_number}
          </span>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
            STATUS_STYLES[flag.status] ?? STATUS_STYLES.DISMISSED
          }`}
        >
          {flag.status.replace("_", " ").toLowerCase()}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-400">{flag.matchup}</p>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">They wrote</div>
          <div className="text-sm font-semibold text-slate-100">{wagerText(flag)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Books had</div>
          <div className="text-sm text-slate-200">
            {marketRange(Number(flag.market_best_line), Number(flag.market_worst_line))}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Off by</div>
          <div
            className={`text-sm font-semibold ${better ? "text-rose-300" : "text-slate-300"}`}
          >
            {Math.abs(deviation)} pts {better ? "better" : "worse"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Graded</div>
          <div className="text-sm text-slate-200">
            {flag.points === null
              ? "pending"
              : flag.points > 0
                ? "win"
                : flag.points < 0
                  ? "loss"
                  : "push"}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
        <p className="text-xs text-slate-500">
          placed {new Date(flag.placed_at).toLocaleString()} · {flag.books_seen.join(" + ")}
          {flag.reviewed_by && ` · ruled by ${flag.reviewed_by}`}
        </p>

        <div className="flex gap-2">
          {flag.status === "OPEN" ? (
            <>
              <button
                onClick={() => rule("DISMISSED")}
                disabled={disabled}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                onClick={() => rule("CONFIRMED")}
                disabled={disabled}
                className="rounded-md bg-rose-500/90 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-rose-400 disabled:opacity-50"
              >
                Confirm
              </button>
            </>
          ) : (
            <button
              onClick={() => rule("OPEN")}
              disabled={disabled}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Reopen
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </li>
  );
}
