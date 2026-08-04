"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DemoMenu } from "./DemoMenu";
import { NavLinks } from "./NavLinks";
import { ViewingAsBanner } from "./ViewingAsBanner";
import { PERSONA_META_COOKIE, readCookie } from "@/lib/cookies";
import { jurisdictionLabel } from "@/lib/format";

export interface TopBarProps {
  jurisdiction?: string;
}

/**
 * Reads the active demo persona's jurisdiction from the same
 * PERSONA_META_COOKIE that ViewingAsBanner uses, so the header chip agrees
 * with the "Viewing as" banner instead of showing a generic/default label.
 */
function readActivePersonaJurisdiction(): string | undefined {
  const raw = readCookie(PERSONA_META_COOKIE);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      jurisdiction_id?: string;
      jurisdiction_name?: string;
    };
    if (parsed && typeof parsed.jurisdiction_id === "string") {
      return jurisdictionLabel(parsed.jurisdiction_id, parsed.jurisdiction_name);
    }
  } catch {
    // fall through — malformed cookie, ignore and use the prop instead
  }
  return undefined;
}

export function TopBar({ jurisdiction = "All Jurisdictions" }: TopBarProps) {
  const [personaJurisdiction, setPersonaJurisdiction] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    setPersonaJurisdiction(readActivePersonaJurisdiction());
  }, []);

  const displayJurisdiction = personaJurisdiction ?? jurisdiction;

  return (
    <>
      <header
        className={
          // `min-h-14` (not `h-14`) so the safe-area top padding can grow
          // the header on a notched/home-indicator device without
          // clipping its contents; on devices with no inset it renders
          // identically to a fixed h-14. Horizontal padding uses
          // `max(base, inset)` so the notch in landscape widens the
          // padding instead of stacking with it.
          "relative flex min-h-14 shrink-0 items-center justify-between " +
          "border-b border-gray-200 bg-gov pl-[max(0.75rem,env(safe-area-inset-left,0px))] " +
          "pr-[max(0.75rem,env(safe-area-inset-right,0px))] pt-[env(safe-area-inset-top,0px)] " +
          "text-white sm:pl-[max(1rem,env(safe-area-inset-left,0px))] " +
          "sm:pr-[max(1rem,env(safe-area-inset-right,0px))]"
        }
      >
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link
            href="/"
            aria-label="mapencroach home"
            className="flex items-center gap-2 rounded focus:outline-none focus:ring-2 focus:ring-white/70"
          >
            <span className="text-sm font-semibold tracking-wide">mapencroach</span>
            <span className="hidden text-xs text-white/70 md:inline">
              Encroachment Monitoring Console
            </span>
          </Link>
          <NavLinks />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <div
            data-testid="jurisdiction-placeholder"
            className="max-w-24 truncate rounded border border-white/30 px-2 py-1 text-xs text-white/90 sm:max-w-40 sm:px-3 lg:max-w-64"
          >
            {displayJurisdiction}
          </div>
          <DemoMenu />
        </div>
      </header>
      <ViewingAsBanner />
    </>
  );
}
