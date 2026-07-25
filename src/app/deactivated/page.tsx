export default function DeactivatedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-sm border p-8 text-center max-w-sm">
        <h1 className="text-xl font-semibold mb-2">Account deactivated</h1>
        <p className="text-gray-500 text-sm">
          Your account has been deactivated. Contact a league admin if you
          believe this is a mistake.
        </p>
      </div>
    </div>
  );
}
