export default function DeactivatedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="bg-slate-900 rounded-xl shadow-xl shadow-black/40 border border-slate-700 p-8 text-center max-w-sm">
        <h1 className="text-xl font-semibold mb-2">Account deactivated</h1>
        <p className="text-slate-300 text-sm">
          Your account has been deactivated. Contact a league admin if you
          believe this is a mistake.
        </p>
      </div>
    </div>
  );
}
