"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { readConsent, type Consent } from "./CookieNotice";
import { siteConfig } from "@/lib/site-config";

/**
 * Loads analytics only when it is both configured and consented to.
 *
 * Two gates, in this order:
 *   1. No measurement id -> nothing renders. No script, no cookie, no
 *      beacon, and the privacy policy's "no analytics at all" is true.
 *   2. Consent not given -> nothing renders. A script that loads before
 *      the user answers makes the banner decorative.
 *
 * Deliberately not wired to a specific vendor beyond the standard gtag
 * endpoint: picking an analytics provider, and accepting its data
 * processing terms, is the operator's decision, not something to be
 * settled by whatever was convenient to code.
 */
export function Analytics() {
  const [consent, setConsent] = useState<Consent>(null);

  useEffect(() => {
    setConsent(readConsent());
    const onChange = (event: Event) => {
      setConsent((event as CustomEvent<Consent>).detail ?? null);
    };
    window.addEventListener("mapencroach:consent", onChange);
    return () => window.removeEventListener("mapencroach:consent", onChange);
  }, []);

  if (!siteConfig.analyticsId) return null;
  if (consent !== "accepted") return null;

  const id = siteConfig.analyticsId;
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
        strategy="afterInteractive"
      />
      <Script id="mapencroach-analytics" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}',{anonymize_ip:true});`}
      </Script>
    </>
  );
}
