"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function OnboardingPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
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
    <div className="bg-white rounded-xl shadow-sm border p-8">
      <h1 className="text-xl font-semibold mb-1">Welcome to the league</h1>
      <p className="text-gray-500 text-sm mb-6">
        Choose a display name — this is how you&apos;ll appear on the
        leaderboard.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="displayName"
            className="block text-sm font-medium text-gray-700 mb-1"
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
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Hayes"
            autoFocus
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading || !displayName.trim()}
          className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Saving…" : "Get started"}
        </button>
      </form>
    </div>
  );
}
