export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm"
      >
        <div className="mx-auto h-8 w-8 animate-pulse rounded-full bg-gov/20" />
        <p className="mt-4 text-sm font-medium text-slate-700">
          Loading operational data…
        </p>
        <p className="mt-1 text-xs text-slate-500">
          The page will appear when the latest records are ready.
        </p>
      </div>
    </main>
  );
}
