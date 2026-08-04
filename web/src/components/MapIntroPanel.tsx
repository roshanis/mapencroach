"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "mapencroach.intro.dismissed";
const SEEN_KEY = "mapencroach.intro.seen";

// localStorage can throw (not just return null) where storage is blocked —
// Safari private browsing, a sandboxed iframe without allow-storage-access,
// some embedded webviews. An uncaught SecurityError here bubbles past this
// component to app/error.tsx and replaces the whole console with an error
// page over a purely cosmetic "have you seen this before?" panel.
function readStorageFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeStorageFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Storage is blocked — this render still behaves correctly, it just
    // won't be remembered across reloads.
  }
}

function persistDismissed(dismissed: boolean) {
  try {
    if (dismissed) {
      localStorage.setItem(STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage is blocked — the dismiss/reopen toggle still works for this
    // render, it just won't be remembered across reloads.
  }
}

const BULLETS = [
  "Every colored shape is a government land parcel — the color is its land category (legend, bottom left).",
  "Dots are encroachment alerts from satellite change detection: Red = act now, Amber = investigate, Green = minor, Purple = legacy occupation.",
  "Click an alert in the work queue or on the map to select it, then open the parcel record from its action card.",
  "The strip up top is the live summary: parcels monitored, alerts needing triage, urgent alerts, and cases in due process.",
  "You only see parcels in your jurisdiction — try switching persona (top right).",
];

export function MapIntroPanel() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const alreadyDismissed = readStorageFlag(STORAGE_KEY);
    const alreadySeen = readStorageFlag(SEEN_KEY);
    // Start collapsed if the user has ever dismissed the panel, or has ever
    // simply seen it before (a prior session) — only a truly first-ever
    // view shows it expanded.
    setDismissed(alreadyDismissed || alreadySeen);
    if (!alreadyDismissed && !alreadySeen) {
      writeStorageFlag(SEEN_KEY);
    }
    setReady(true);
  }, []);

  if (!ready) return null;

  if (dismissed) {
    return (
      <button
        type="button"
        data-testid="map-intro-reopen"
        onClick={() => {
          persistDismissed(false);
          setDismissed(false);
        }}
        className="absolute right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[max(0.75rem,env(safe-area-inset-top,0px))] z-10 flex min-h-11 items-center rounded-full bg-white/90 px-3 text-xs text-gray-600 shadow hover:text-gov lg:top-24 2xl:top-[max(0.75rem,env(safe-area-inset-top,0px))]"
      >
        ? What am I looking at?
      </button>
    );
  }

  return (
    <div
      data-testid="map-intro-panel"
      className="absolute right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[max(0.75rem,env(safe-area-inset-top,0px))] z-10 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-gray-200 bg-white/95 p-4 shadow-md lg:top-24 2xl:top-[max(0.75rem,env(safe-area-inset-top,0px))]"
    >
      <p className="text-sm font-semibold text-gray-900">
        What am I looking at?
      </p>
      <ul className="mt-2 flex flex-col gap-1.5 text-xs text-gray-600">
        {BULLETS.map((bullet, i) => (
          <li key={i}>{bullet}</li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="map-intro-dismiss"
        onClick={() => {
          persistDismissed(true);
          setDismissed(true);
        }}
        className="mt-3 flex min-h-11 items-center rounded bg-gov px-3 text-xs font-medium text-white"
      >
        Got it
      </button>
    </div>
  );
}
