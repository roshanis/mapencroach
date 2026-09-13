"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { siteConfig } from "@/lib/site-config";

export const CONSENT_KEY = "mapencroach_analytics_consent";

export type Consent = "accepted" | "declined" | null;

/** Reads stored consent. Storage can throw when site data is blocked. */
export function readConsent(): Consent {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "accepted" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

function writeConsent(value: Exclude<Consent, null>) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // A browser that blocks storage cannot remember the choice. Treating
    // that as "accepted" would be the wrong default, so nothing is loaded
    // and the notice simply reappears next visit.
  }
}

/**
 * Cookie notice — shown only when there is actually something to consent to.
 *
 * The session cookies this application sets are strictly necessary to
 * deliver a service the user asked for (they carry the sign-in and the
 * jurisdiction scope), so they are not consentable and no banner can
 * honestly ask about them. Showing a consent dialog for cookies that
 * will be set regardless is consent theatre: it teaches people that the
 * button does nothing.
 *
 * So: with no analytics id configured, this renders nothing at all, and
 * nothing is loaded. With one configured, it asks a real question whose
 * answer actually gates the script — see `Analytics`.
 */
export function CookieNotice() {
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(readConsent());
    setReady(true);
  }, []);

  // Nothing optional is loaded on this deployment, so there is nothing to ask.
  if (!siteConfig.analyticsId) return null;
  if (!ready || consent !== null) return null;

  function choose(value: Exclude<Consent, null>) {
    writeConsent(value);
    setConsent(value);
    // Let Analytics react without a reload.
    window.dispatchEvent(new CustomEvent("mapencroach:consent", { detail: value }));
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie choices"
      data-testid="cookie-notice"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-gray-300 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-4 shadow-lg sm:px-6"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-gray-700">
          We use a few cookies that are necessary to keep you signed in. May we
          also load analytics to see which pages are used?{" "}
          <Link className="text-gov underline underline-offset-2" href="/privacy">
            Privacy policy
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            data-testid="cookie-decline"
            onClick={() => choose("declined")}
            className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            No thanks
          </button>
          <button
            type="button"
            data-testid="cookie-accept"
            onClick={() => choose("accepted")}
            className="min-h-11 rounded-md bg-gov px-4 text-sm font-semibold text-white hover:bg-gov-dark"
          >
            Allow analytics
          </button>
        </div>
      </div>
    </div>
  );
}
