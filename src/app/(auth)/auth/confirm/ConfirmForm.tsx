"use client";

import { useState } from "react";

// Plain HTML form POST (no fetch) so the session cookies land on a normal
// navigation. The only client-side job is to stop a second tap on a slow
// connection from sending a second POST with an already-consumed token.
export function ConfirmForm({
  tokenHash,
  type,
  next,
}: {
  tokenHash: string;
  type: string;
  next?: string;
}) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <form method="POST" action="/auth/callback" onSubmit={() => setSubmitting(true)}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {next && <input type="hidden" name="next" value={next} />}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/25 transition-colors hover:bg-sky-400 disabled:opacity-40 disabled:shadow-none"
      >
        {submitting ? "Signing in…" : "Continue"}
      </button>
    </form>
  );
}
