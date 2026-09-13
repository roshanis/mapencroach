import Link from "next/link";
import { SiteFooter } from "./SiteFooter";

/** Shared shell for the legal pages so they read as one document set. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-100 text-gray-900">
      <header className="border-b border-gray-200 bg-white px-5 py-4 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
            className="text-sm font-semibold text-gov hover:underline"
          >
            ← mapencroach
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated {updated}</p>
        <div className="mt-8 flex flex-col gap-6 text-[15px] leading-relaxed text-gray-700">
          {children}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

export function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
      {children}
    </section>
  );
}

/**
 * Renders a fact that has not been supplied yet, visibly.
 *
 * A legal page is read to establish who is accountable. A missing
 * controller address must look missing — a grey "to be confirmed" is
 * honest; an invented street is a misrepresentation to a data subject.
 */
export function Unpublished({ what }: { what: string }) {
  return (
    <span
      data-testid="unpublished-detail"
      className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-900"
    >
      [{what} not published yet]
    </span>
  );
}
