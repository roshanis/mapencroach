"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getPersonas } from "@/lib/api";

function isReadOnlySample(): boolean {
  return !process.env.NEXT_PUBLIC_API_URL;
}

const DemoReadOnlyContext = createContext(false);

export function DemoModeProvider({ children }: { children: ReactNode }) {
  return (
    <DemoReadOnlyContext.Provider value={isReadOnlySample()}>
      {children}
    </DemoReadOnlyContext.Provider>
  );
}

export function useDemoReadOnly(): boolean {
  return useContext(DemoReadOnlyContext);
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
        <><strong>Shared demo · Sample case records.</strong> Changes are shared with other demo users. Screening imagery is context, not proof.</>
      )}
    </div>
  );
}

/** Keep workflow previews visible while preventing guaranteed-to-fail sample writes. */
export function DemoActionBoundary({ children }: { children: ReactNode }) {
  // Keep this compatibility wrapper around existing page composition, but do
  // not use a disabled fieldset: it prevents officers from selecting evidence,
  // comparing options, and reading the preview. Mutation controls consume the
  // read-only context themselves.
  return <>{children}</>;
}
