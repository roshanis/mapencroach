"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "mapencroach.intro.dismissed";

const BULLETS = [
  "Every colored shape is a government land parcel — the color is its land category (legend, bottom left).",
  "Dots are encroachment alerts from satellite change detection: Red = act now, Amber = investigate, Green = minor, Purple = legacy occupation.",
  "Click an alert in the left list to fly to it; click a dot to open the parcel's full record.",
  "The strip up top is the live summary: parcels monitored, open alerts, red alerts, cases in due process.",
  "You only see parcels in your jurisdiction — try switching persona (top right).",
];

export function MapIntroPanel() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === "1");
    setReady(true);
  }, []);

  if (!ready) return null;

  if (dismissed) {
    return (
      <button
        type="button"
        data-testid="map-intro-reopen"
        onClick={() => {
          localStorage.removeItem(STORAGE_KEY);
          setDismissed(false);
        }}
        className="absolute right-3 top-3 z-10 rounded-full bg-white/90 px-3 py-1.5 text-xs text-gray-600 shadow hover:text-gov"
      >
        ? What am I looking at?
      </button>
    );
  }

  return (
    <div
      data-testid="map-intro-panel"
      className="absolute right-3 top-3 z-10 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-gray-200 bg-white/95 p-4 shadow-md"
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
          localStorage.setItem(STORAGE_KEY, "1");
          setDismissed(true);
        }}
        className="mt-3 rounded bg-gov px-3 py-1.5 text-xs font-medium text-white"
      >
        Got it
      </button>
    </div>
  );
}
