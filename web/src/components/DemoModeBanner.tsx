"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getPersonas } from "@/lib/api";

function isReadOnlySample(): boolean {
  return !process.env.NEXT_PUBLIC_API_URL;
}

/** Identify the sample experience without claiming a non-demo service is synthetic. */
export function DemoModeBanner() {
  const readOnly = isReadOnlySample();
  const [interactiveDemo, setInteractiveDemo] = useState(false);
  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    void getPersonas().then((personas) => {
      if (!cancelled) setInteractiveDemo(personas.length > 0);
    });
    return () => { cancelled = true; };
  }, [readOnly]);

  if (!readOnly && !interactiveDemo) return null;
  return (
    <div role="note" data-testid="demo-mode-banner" className="shrink-0 border-b border-blue-200 bg-blue-50 px-4 py-2 text-xs leading-5 text-blue-950 print:hidden">
      {readOnly ? (
        <><strong>Sample workspace · Read only.</strong> Explore illustrative records and draft previews. Changes aren&apos;t saved.</>
      ) : (
        <><strong>Shared demo · Sample case records.</strong> Case and tag changes may reset when the demo restarts. Screening imagery is context, not proof.</>
      )}
    </div>
  );
}

/** Keep workflow previews visible while preventing guaranteed-to-fail sample writes. */
export function DemoActionBoundary({ children }: { children: ReactNode }) {
  if (!isReadOnlySample()) return <>{children}</>;
  return (
    <fieldset disabled className="min-w-0">
      <legend className="mb-2 text-xs font-medium text-slate-700">Action preview · Read only in this sample</legend>
      {children}
    </fieldset>
  );
}
