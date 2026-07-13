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
  { href: "/", label: "Map", match: (path) => path === "/" },
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
    href: "/personas",
    label: "Personas",
    match: (path) => path === "/personas" || path.startsWith("/personas/"),
  },
];

const ACTIVE_CLASSES =
  "rounded px-2.5 py-1 text-xs font-semibold bg-white/15 text-white";
const INACTIVE_CLASSES =
  "rounded px-2.5 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white";

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
        aria-expanded={open}
        className="sm:hidden rounded px-2 py-1 text-white/90 hover:bg-white/10"
        onClick={() => setOpen((prev) => !prev)}
      >
        ☰
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-14 z-20 flex flex-col border-b border-gray-200 bg-gov shadow-md">
          {NAV_ITEMS.map((item) => {
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
