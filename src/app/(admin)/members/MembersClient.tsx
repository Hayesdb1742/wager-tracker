"use client";

import { useState } from "react";

type Member = {
  id: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

export function MembersClient({ members: initial }: { members: Member[] }) {
  const [members, setMembers] = useState(initial);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);

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

    setInviteSuccess(`Invite sent to ${inviteEmail}`);
    setInviteEmail("");
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
      <div className="bg-white border rounded-xl p-6 mb-6">
        <h2 className="font-semibold text-gray-800 mb-4">Invite new member</h2>
        <form onSubmit={handleInvite} className="flex gap-3">
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="email@example.com"
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={inviting}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </form>
        {inviteError && <p className="mt-2 text-red-600 text-sm">{inviteError}</p>}
        {inviteSuccess && <p className="mt-2 text-green-600 text-sm">{inviteSuccess}</p>}
      </div>

      {/* Members table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {members.map((m) => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{m.display_name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      m.role === "ADMIN"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {m.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      m.is_active
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-600"
                    }`}
                  >
                    {m.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(m.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {m.is_active ? (
                    <button
                      onClick={() => handleDeactivate(m.id)}
                      className="text-xs text-gray-500 hover:text-red-600 border rounded px-2 py-1 hover:border-red-300"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => handleReactivate(m.id)}
                      className="text-xs text-gray-500 hover:text-green-600 border rounded px-2 py-1"
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
