"use client";

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
          No incomplete record is being shown. Retry when the service is available.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md bg-gov px-4 py-2 text-sm font-semibold text-white hover:bg-gov-dark focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
