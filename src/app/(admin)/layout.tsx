export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950">
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-3 text-sm font-semibold tracking-wide text-slate-200 shadow-lg shadow-black/40">
        Admin
      </div>
      <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
