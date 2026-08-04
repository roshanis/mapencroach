"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/console",
    label: "Command map",
    match: (path) => path === "/console",
  },
  {
    href: "/alerts",
    label: "Alerts",
    match: (path) => path === "/alerts" || path.startsWith("/alerts/"),
  },
  {
    href: "/cases",
    label: "Cases",
    match: (path) => path === "/cases" || path.startsWith("/cases/"),
  },
  {
    href: "/watchlist",
    label: "Watchlist",
    match: (path) => path === "/watchlist" || path.startsWith("/watchlist/"),
  },
];

// Rendered only in the mobile hamburger dropdown, not the desktop nav.
// TopBar's DemoMenu also links to /personas ("Who sees what →"), but that's
// tucked behind a click; this keeps a direct, always-discoverable path from
// the mobile nav too.
const MOBILE_ONLY_ITEMS: NavItem[] = [
  {
    href: "/personas",
    label: "Demo roles",
    match: (path) => path === "/personas" || path.startsWith("/personas/"),
  },
];

// `min-h-11` keeps a 44px-tall tap target (the iOS HIG floor) even though
// the visible text stays text-xs — the header has plenty of vertical room
// (h-14/56px) to absorb it without changing how the row looks.
const ACTIVE_CLASSES =
  "inline-flex min-h-11 items-center rounded px-2.5 text-xs font-semibold bg-white/15 text-white";
const INACTIVE_CLASSES =
  "inline-flex min-h-11 items-center rounded px-2.5 text-xs text-white/70 hover:bg-white/10 hover:text-white";

export function NavLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <>
      <nav className="hidden sm:flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname ?? "");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? ACTIVE_CLASSES : INACTIVE_CLASSES}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        data-testid="nav-hamburger"
        aria-label="Toggle navigation menu"
        aria-expanded={open}
        className="flex min-h-11 min-w-11 items-center justify-center rounded px-2 text-white/90 hover:bg-white/10 sm:hidden"
        onClick={() => setOpen((prev) => !prev)}
      >
        ☰
      </button>

      {open && (
        // `top-full` (not a hardcoded top-14) so this still lines up with
        // the header's bottom edge if the header grows taller than 56px —
        // e.g. safe-area top padding on a notched device.
        <div className="absolute left-0 right-0 top-full z-20 flex flex-col border-b border-gray-200 bg-gov shadow-md">
          {[...NAV_ITEMS, ...MOBILE_ONLY_ITEMS].map((item) => {
            const active = item.match(pathname ?? "");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-3 text-sm ${
                  active ? "font-semibold text-white" : "text-white/70"
                }`}
                aria-current={active ? "page" : undefined}
                onClick={close}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
