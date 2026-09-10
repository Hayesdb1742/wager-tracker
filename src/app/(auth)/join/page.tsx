import { createAdminClient } from "@/lib/supabase/admin";

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function JoinPage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    return <InviteError message="No invite token found. Ask your admin for a new invite link." />;
  }

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("invites")
    .select("email, expires_at, used_at")
    .eq("token", token)
    .single();

  if (!invite) {
    return <InviteError message="This invite link is invalid. Ask your admin for a new one." />;
  }

  if (new Date(invite.expires_at) < new Date()) {
    return <InviteError message="This invite link has expired (links are valid for 72 hours). Ask your admin to send a new one." />;
  }

  if (invite.used_at) {
    // Check if the email has an account — if so, direct them to log in
    const { data: users } = await admin.auth.admin.listUsers();
    const exists = users.users.some((u) => u.email === invite.email);
    if (exists) {
      return (
        <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-8 text-center">
          <h1 className="text-xl font-semibold mb-2">Account already exists</h1>
          <p className="text-slate-300 text-sm mb-4">
            An account for <strong>{invite.email}</strong> is already set up.
          </p>
          <a href="/login" className="text-sm font-semibold text-sky-400 hover:text-sky-300 hover:underline">
            Sign in instead
          </a>
        </div>
      );
    }
    return <InviteError message="This invite link has already been used." />;
  }

  // Valid invite — show confirmation of who is being invited
  return (
    <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-8 text-center">
      <h1 className="text-xl font-semibold mb-2">You&apos;re invited!</h1>
      <p className="text-slate-300 text-sm mb-4">
        An invite was sent to <strong>{invite.email}</strong>. Check your inbox
        for a sign-in link to complete setup.
      </p>
      <p className="text-xs text-slate-400">
        Didn&apos;t get the email? Ask your admin to re-invite you.
      </p>
    </div>
  );
}

function InviteError({ message }: { message: string }) {
  return (
    <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-8 text-center">
      <h1 className="text-xl font-semibold mb-2 text-red-400">Invite invalid</h1>
      <p className="text-slate-300 text-sm">{message}</p>
    </div>
  );
}
