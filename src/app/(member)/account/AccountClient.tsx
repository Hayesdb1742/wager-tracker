"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;

const inputClass =
  "w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400";

// `setup` is true when the member arrived via an admin-issued setup/reset
// link: the copy changes to a welcome and we send them on to picks afterwards.
export function AccountClient({ email, setup }: { email: string; setup: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setPassword("");
    setConfirm("");

    if (setup) {
      router.push("/picks");
      router.refresh();
      return;
    }
    setSaved(true);
  }

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="max-w-md space-y-6">
      <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-8">
        <h1 className="text-xl font-semibold mb-1">
          {setup ? "Welcome — set your password" : "Change password"}
        </h1>
        <p className="text-slate-300 text-sm mb-6">
          {setup
            ? "Pick a password to finish signing in. Your phone will offer to save it so next time is one tap."
            : "Choose a new password for signing in."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Hidden so password managers file the new password under the right account */}
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />

          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-slate-100 mb-1">
              New password
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
              autoFocus={setup}
            />
          </div>

          <div>
            <label htmlFor="confirm" className="block text-sm font-semibold text-slate-100 mb-1">
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
          {saved && <p className="text-emerald-400 text-sm">Password updated.</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/25 transition-colors hover:bg-sky-400 disabled:opacity-40 disabled:shadow-none"
          >
            {saving ? "Saving…" : setup ? "Save and continue" : "Update password"}
          </button>
        </form>
      </div>

      {!setup && (
        <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-100">Signed in as</div>
            <div className="text-sm text-slate-300">{email}</div>
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="text-sm text-slate-300 hover:text-red-300 border border-slate-600 bg-slate-800 rounded-lg px-3 py-2 font-semibold transition-colors hover:bg-slate-700 hover:border-red-400 disabled:opacity-40"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
