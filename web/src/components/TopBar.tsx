import Link from "next/link";
import { NavLinks } from "./NavLinks";
import { PersonaSwitcher } from "./PersonaSwitcher";
import { ViewingAsBanner } from "./ViewingAsBanner";

export interface TopBarProps {
  jurisdiction?: string;
}

export function TopBar({ jurisdiction = "All Jurisdictions" }: TopBarProps) {
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
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            data-testid="jurisdiction-placeholder"
            className="hidden max-w-64 truncate rounded border border-white/30 px-3 py-1 text-xs text-white/90 lg:block"
          >
            {jurisdiction}
          </div>
          <PersonaSwitcher />
          <Link
            href="/personas"
            className="hidden min-h-11 items-center rounded border border-white/25 px-2.5 text-xs text-white/80 hover:bg-white/10 hover:text-white sm:inline-flex"
          >
            Demo roles
          </Link>
        </div>
      </header>
      <ViewingAsBanner />
    </>
  );
}
