"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Sticky call to action, small screens only.
 *
 * Hidden until the page has scrolled past the hero, so it does not sit on
 * top of the CTA already visible above the fold — two competing buttons
 * for the same action is worse than one.
 *
 * `sm:hidden` keeps it off desktop, where the sticky header CTA is always
 * in view. Bottom padding respects the home-indicator inset so it is not
 * half-swallowed on an iPhone.
 */
export function StickyMobileCta({
  href = "/console",
  label = "Open command map",
}: {
  href?: string;
  label?: string;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 520);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!shown) return null;

  return (
    <div
      data-testid="sticky-mobile-cta"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur sm:hidden"
    >
      <Link
        href={href}
        className="flex min-h-12 w-full items-center justify-center rounded-md bg-gov px-5 text-sm font-semibold text-white shadow-sm hover:bg-gov-dark focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
      >
        {label}
      </Link>
    </div>
  );
}
