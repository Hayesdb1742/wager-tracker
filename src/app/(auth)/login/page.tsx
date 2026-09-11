"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Suspense } from "react";

function LoginForm() {
  const searchParams = useSearchParams();
  const expired = searchParams.get("expired") === "1";

  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // This is a private league. Without this, Supabase signs up any address
        // that is typed in, which turns this form into open registration.
        shouldCreateUser: false,
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    });

    setLoading(false);

    // With shouldCreateUser off, an unregistered address comes back as
    // `otp_disabled`. Swallow that so the outcome looks identical either way --
    // surfacing it would turn this form into an email enumeration oracle and
    // contradict the deliberately vague message shown below.
    const isUnregistered =
      error?.code === "otp_disabled" ||
      /signups not allowed/i.test(error?.message ?? "");

    if (error && !isUnregistered) {
      setError(error.message);
      return;
    }

    // Always show the same message regardless of whether the email exists
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-8 text-center">
        <h1 className="text-xl font-semibold mb-2">Check your email</h1>
        <p className="text-slate-300 text-sm">
          If that address is registered, a sign-in link is on its way. It
          expires in 1 hour.
        </p>
        <button
          onClick={() => setSubmitted(false)}
          className="mt-6 text-sm font-semibold text-sky-400 hover:text-sky-300 hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-8">
      {expired && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-200">
          That sign-in link has expired. Enter your email and we&apos;ll send a
          new one.
        </div>
      )}

      <h1 className="text-xl font-semibold mb-1">Sign in</h1>
      <p className="text-slate-300 text-sm mb-6">
        We&apos;ll send a magic link to your email.
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
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400"
            placeholder="you@example.com"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/25 transition-colors hover:bg-sky-400 disabled:opacity-40 disabled:shadow-none"
        >
          {loading ? "Sending…" : "Send magic link"}
        </button>
      </form>
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
