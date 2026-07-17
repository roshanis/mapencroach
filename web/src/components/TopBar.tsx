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
      <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-gov px-3 text-white sm:px-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-wide">
              mapencroach
            </span>
            <span className="hidden text-xs text-white/70 md:inline">
              Encroachment Monitoring Console
            </span>
          </div>
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
            className="hidden rounded border border-white/25 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white sm:inline-flex"
          >
            Demo roles
          </Link>
        </div>
      </header>
      <ViewingAsBanner />
    </>
  );
}
