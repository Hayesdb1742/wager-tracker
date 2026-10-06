import { createClient } from "@/lib/supabase/server";
import { PushToggle } from "./PushToggle";
import { FlagCard, type FlagRow } from "./FlagCard";

// Where a line-flag notification lands, and where the flags get ruled on.
//
// Reads through the caller's own session rather than the service-role client: the admin-only
// policy on pick_line_flags is what governs pick_line_flags_detail, so an ordinary member
// reaching this URL sees nothing even if the (admin) layout ever let them through.

export const dynamic = "force-dynamic";

export default async function LineFlagsPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("pick_line_flags_detail")
    .select(
      "pick_id, status, verdict, deviation, member, placed_at, sport, week_number, matchup, bet_type, selection, pick_line, market_best_line, market_worst_line, books_seen, points, reviewed_by, review_note"
    )
    // Open first, then the biggest miss: the number most worth a second look is the one
    // furthest from anything a book ever posted.
    .order("status", { ascending: true })
    .order("placed_at", { ascending: false });

  const flags = (data ?? []) as FlagRow[];
  const open = flags.filter((f) => f.status === "OPEN");
  const settled = flags.filter((f) => f.status !== "OPEN");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Line flags</h1>
        <p className="mt-1 text-sm text-slate-400">
          Picks whose line fell outside every DraftKings and FanDuel number posted for that
          game. Usually a typo — occasionally not.
        </p>
      </div>

      <PushToggle />

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          Could not load flags: {error.message}
        </p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Waiting on you ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
            Nothing open. Every line entered so far is one the books actually posted.
          </p>
        ) : (
          <ul className="space-y-3">
            {open.map((flag) => (
              <FlagCard key={flag.pick_id} flag={flag} />
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Settled ({settled.length})
          </h2>
          <ul className="space-y-3">
            {settled.map((flag) => (
              <FlagCard key={flag.pick_id} flag={flag} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
