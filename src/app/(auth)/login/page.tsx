"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const expired = searchParams.get("expired") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setLoading(false);
      // Supabase returns the same error for an unknown email and a wrong
      // password, so this message can stay generic without leaking anything.
      setError("Email or password is incorrect.");
      return;
    }

    // The browser client has already written the session cookies; refresh so
    // the server layouts pick them up.
    router.push("/picks");
    router.refresh();
  }

  return (
    <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-8">
      {expired && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-200">
          That link has expired or was already used. Ask the league admin for
          a new one.
        </div>
      )}

      <h1 className="text-xl font-semibold mb-1">Sign in</h1>
      <p className="text-slate-300 text-sm mb-6">
        Use the email and password you set up for the league.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-semibold text-slate-100 mb-1"
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            // `username` (not `email`) is what iOS Keychain and Google
            // Password Manager key on to offer a saved login.
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400"
            placeholder="you@example.com"
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/25 transition-colors hover:bg-sky-400 disabled:opacity-40 disabled:shadow-none"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-xs text-slate-400 text-center">
        Forgot your password? Ask the league admin for a reset link.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
