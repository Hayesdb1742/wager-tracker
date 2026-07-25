export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white border-b px-4 py-3 text-sm font-medium text-gray-500">
        Admin
      </div>
      <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
