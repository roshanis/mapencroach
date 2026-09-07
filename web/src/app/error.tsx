"use client";

import Link from "next/link";

export default function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div
        role="alert"
        data-error-reference={error.digest}
        className="w-full max-w-md rounded-lg border border-red-200 bg-white p-6 text-center shadow-sm"
      >
        <h1 className="text-lg font-semibold text-slate-950">
          This page could not be loaded
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Your demo session may have expired, or the service may be unavailable.
          Retry, or choose a persona to start a fresh session.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md bg-gov px-4 py-2 text-sm font-semibold text-white hover:bg-gov-dark focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
        >
          Try again
        </button>
        <div className="mt-4 flex flex-col gap-3 text-sm">
          <Link href="/personas" className="text-gov underline">Choose a demo persona</Link>
          <Link href="/console" className="text-gov underline">Return to command map</Link>
        </div>
      </div>
    </main>
  );
}
