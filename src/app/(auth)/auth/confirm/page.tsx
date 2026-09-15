import { redirect } from "next/navigation";
import { ConfirmForm } from "./ConfirmForm";

interface Props {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}

// Interstitial for one-time links. Chat apps (iMessage, WhatsApp, Slack…)
// GET a URL to build a preview card, which would burn a single-use token
// before the member ever taps it. Nothing is verified on this page -- the
// token is only consumed when the member presses Continue, which POSTs to
// /auth/callback. Previewers don't submit forms.
export default async function ConfirmPage({ searchParams }: Props) {
  const { token_hash, type, next } = await searchParams;

  if (!token_hash || !type) {
    redirect("/login?expired=1");
  }

  return (
    <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-8 text-center">
      <h1 className="text-xl font-semibold mb-2">Almost there</h1>
      <p className="text-slate-300 text-sm mb-6">
        Tap continue to sign in and set your password.
      </p>
      <ConfirmForm tokenHash={token_hash} type={type} next={next} />
      <p className="mt-4 text-xs text-slate-400">
        This link works once. If it has already been used, ask the league admin
        for a new one.
      </p>
    </div>
  );
}
