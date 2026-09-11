"use client";

import { useState } from "react";

type Member = {
  id: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

// A freshly minted one-time link, shown to the admin to copy and send on.
type IssuedLink = { label: string; url: string };

function LinkCard({ link, onDismiss }: { link: IssuedLink; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable (non-HTTPS, permissions); the input is
      // selectable so the admin can still copy by hand.
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
      <p className="text-sm font-medium text-emerald-300 mb-2">{link.label}</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={link.url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
        <button
          type="button"
          onClick={copy}
          className="bg-sky-500 text-slate-950 px-3 py-2 rounded-lg text-xs font-semibold transition-colors hover:bg-sky-400"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-slate-300 border border-slate-600 bg-slate-800 rounded-lg px-3 py-2 font-semibold transition-colors hover:bg-slate-700"
        >
          Done
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Send this to them however you like — it&apos;s one-time and expires in 24 hours.
      </p>
    </div>
  );
}

export function MembersClient({ members: initial }: { members: Member[] }) {
  const [members, setMembers] = useState(initial);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<IssuedLink | null>(null);
  const [resetLink, setResetLink] = useState<IssuedLink | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteLink(null);

    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const data = await res.json();
    setInviting(false);

    if (!res.ok) {
      setInviteError(data.error);
      return;
    }

    setInviteLink({ label: `Setup link for ${inviteEmail}`, url: data.setupUrl });
    setInviteEmail("");
  }

  async function handleResetLink(m: Member) {
    setResettingId(m.id);
    setResetLink(null);
    const res = await fetch(`/api/admin/members/${m.id}/reset-link`, { method: "POST" });
    const data = await res.json();
    setResettingId(null);
    if (!res.ok) { alert(data.error ?? "Failed to create reset link"); return; }
    setResetLink({ label: `Password reset link for ${m.display_name}`, url: data.resetUrl });
  }

  async function handleDeactivate(id: string) {
    if (!confirm("Deactivate this member? Their session will be revoked.")) return;
    const res = await fetch(`/api/admin/members/${id}/deactivate`, { method: "POST" });
    if (!res.ok) { alert("Failed to deactivate"); return; }
    setMembers((m) => m.map((p) => p.id === id ? { ...p, is_active: false } : p));
  }

  async function handleReactivate(id: string) {
    const res = await fetch(`/api/admin/members/${id}/reactivate`, { method: "POST" });
    if (!res.ok) { alert("Failed to reactivate"); return; }
    setMembers((m) => m.map((p) => p.id === id ? { ...p, is_active: true } : p));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Members</h1>

      {/* Invite form */}
      <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl p-6 mb-6">
        <h2 className="font-semibold text-white mb-1">Invite new member</h2>
        <p className="text-sm text-slate-400 mb-4">
          Creates their account and gives you a one-time setup link to send them. No email is sent.
        </p>
        <form onSubmit={handleInvite} className="flex gap-3">
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="email@example.com"
            className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <button
            type="submit"
            disabled={inviting}
            className="bg-sky-500 text-slate-950 px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-sky-500/25 transition-colors hover:bg-sky-400 disabled:opacity-40 disabled:shadow-none"
          >
            {inviting ? "Creating…" : "Create setup link"}
          </button>
        </form>
        {inviteError && <p className="mt-2 text-red-400 text-sm font-medium">{inviteError}</p>}
        {inviteLink && <LinkCard link={inviteLink} onDismiss={() => setInviteLink(null)} />}
      </div>

      {/* Members table */}
      {resetLink && (
        <div className="mb-6">
          <LinkCard link={resetLink} onDismiss={() => setResetLink(null)} />
        </div>
      )}
      <div className="bg-slate-900 border border-slate-700 shadow-lg shadow-black/30 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 border-b border-slate-700">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-slate-200">Name</th>
              <th className="text-left px-4 py-3 font-medium text-slate-300">Role</th>
              <th className="text-left px-4 py-3 font-medium text-slate-300">Status</th>
              <th className="text-left px-4 py-3 font-medium text-slate-300">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {members.map((m) => (
              <tr key={m.id} className="hover:bg-slate-800">
                <td className="px-4 py-3 font-semibold text-white">{m.display_name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      m.role === "ADMIN"
                        ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40"
                        : "bg-slate-700 text-slate-200 ring-1 ring-slate-600"
                    }`}
                  >
                    {m.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      m.is_active
                        ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                        : "bg-red-500/20 text-red-300 ring-1 ring-red-500/40"
                    }`}
                  >
                    {m.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {new Date(m.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  {m.is_active && (
                    <button
                      onClick={() => handleResetLink(m)}
                      disabled={resettingId === m.id}
                      className="text-xs text-slate-300 hover:text-sky-300 border border-slate-600 bg-slate-800 rounded px-2 py-1 font-semibold transition-colors hover:bg-slate-700 hover:border-sky-400 disabled:opacity-40"
                    >
                      {resettingId === m.id ? "…" : "Reset link"}
                    </button>
                  )}
                  {m.is_active ? (
                    <button
                      onClick={() => handleDeactivate(m.id)}
                      className="text-xs text-slate-300 hover:text-red-300 border border-slate-600 bg-slate-800 rounded px-2 py-1 font-semibold transition-colors hover:bg-slate-700 hover:border-red-400"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => handleReactivate(m.id)}
                      className="text-xs text-slate-300 hover:text-emerald-300 border border-slate-600 bg-slate-800 rounded px-2 py-1 font-semibold transition-colors hover:bg-slate-700"
                    >
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
