import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          404
        </p>
        <h1 className="mt-2 text-xl font-semibold text-slate-950">
          Record not found
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          This record may be outside your jurisdiction, no longer available, or the link may be incorrect.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/alerts"
            className="rounded-md bg-gov px-4 py-2 text-sm font-semibold text-white hover:bg-gov-dark focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
          >
            Return to alert queue
          </Link>
          <Link
            href="/console"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
          >
            Open command map
          </Link>
        </div>
      </div>
    </main>
  );
}
