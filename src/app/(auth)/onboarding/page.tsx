"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;

const inputClass =
  "w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400";

// New members land here from an admin-issued invite link with a session but
// no password yet, so this screen collects both the display name and the
// password they will sign in with from now on.
export default function OnboardingPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;

    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      setLoading(false);
      setError(passwordError.message);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name })
      .eq("id", user.id);

    setLoading(false);

    if (error) {
      setError("Something went wrong saving your name. Please try again.");
      return;
    }

    router.push("/picks");
  }

  return (
    <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-8">
      <h1 className="text-xl font-semibold mb-1">Welcome to the league</h1>
      <p className="text-slate-300 text-sm mb-6">
        Choose a display name — this is how you&apos;ll appear on the
        leaderboard — and a password for signing in.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="displayName"
            className="block text-sm font-semibold text-slate-100 mb-1"
          >
            Display name
          </label>
          <input
            id="displayName"
            type="text"
            required
            maxLength={32}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
            placeholder="e.g. Hayes"
            autoFocus
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-semibold text-slate-100 mb-1"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label
            htmlFor="confirm"
            className="block text-sm font-semibold text-slate-100 mb-1"
          >
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading || !displayName.trim()}
          className="w-full rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/25 transition-colors hover:bg-sky-400 disabled:opacity-40 disabled:shadow-none"
        >
          {loading ? "Saving…" : "Get started"}
        </button>
      </form>
    </div>
  );
}
