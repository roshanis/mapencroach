/**
 * Single source of truth for the public-facing facts about this
 * deployment: who runs it, how to reach them, where it is served from.
 *
 * WHY THIS FILE EXISTS, AND WHY THE DEFAULTS ARE EMPTY
 *
 * The legal pages, the footer, the sitemap and the Open Graph tags all
 * need to state real things about a real organisation. Inventing a
 * plausible postal address or support mailbox would put a false claim on
 * a page whose entire purpose is to be relied upon — and on a privacy
 * policy, a fabricated controller address is not a placeholder, it is a
 * misrepresentation to a data subject.
 *
 * So every field below defaults to empty, and every consumer is written
 * to degrade honestly: a page that has no address says the address is
 * not published yet rather than printing a fake one. Fill these in (or
 * set the matching env vars) and the whole site becomes accurate at
 * once. `siteReadiness()` reports what is still missing.
 *
 * NEXT_PUBLIC_* values are inlined into the client bundle at build time.
 * Everything here is intended to be public, which is why none of it is a
 * secret — do not add credentials to this file.
 */

function env(name: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : "";
}

export interface SiteConfig {
  /** Absolute origin, used for canonical URLs, sitemap and OG tags. */
  baseUrl: string;
  /** Legal entity operating this deployment. */
  organisation: string;
  /** Postal address of that entity. Empty until a real one is supplied. */
  postalAddress: string;
  /** Monitored mailbox for general contact. */
  contactEmail: string;
  /** Mailbox for privacy/data-protection requests. */
  privacyEmail: string;
  /**
   * Endpoint the contact form posts to. Empty means there is no form:
   * the contact page shows the mailbox instead of a form that would
   * silently drop what people write into it.
   */
  contactEndpoint: string;
  /**
   * Analytics measurement id. Empty means no analytics is loaded at all
   * — no script, no cookie, no beacon. See `components/Analytics.tsx`.
   */
  analyticsId: string;
}

export const siteConfig: SiteConfig = {
  baseUrl: env("NEXT_PUBLIC_SITE_URL") || "http://localhost:3000",
  organisation: env("NEXT_PUBLIC_SITE_ORG"),
  postalAddress: env("NEXT_PUBLIC_SITE_ADDRESS"),
  contactEmail: env("NEXT_PUBLIC_CONTACT_EMAIL"),
  privacyEmail: env("NEXT_PUBLIC_PRIVACY_EMAIL") || env("NEXT_PUBLIC_CONTACT_EMAIL"),
  contactEndpoint: env("NEXT_PUBLIC_CONTACT_ENDPOINT"),
  analyticsId: env("NEXT_PUBLIC_ANALYTICS_ID"),
};

/** A field that is still unset, and what depends on it. */
export interface ReadinessGap {
  field: keyof SiteConfig;
  envVar: string;
  blocks: string;
}

/**
 * What is not yet fillable in. Used by the legal pages to say plainly
 * that a detail is unpublished, and available to a launch check so the
 * gaps are visible rather than discovered by a reader.
 */
export function siteReadiness(config: SiteConfig = siteConfig): ReadinessGap[] {
  const gaps: ReadinessGap[] = [];
  if (!config.organisation) {
    gaps.push({
      field: "organisation",
      envVar: "NEXT_PUBLIC_SITE_ORG",
      blocks: "the operator named in the privacy policy, terms and footer",
    });
  }
  if (!config.postalAddress) {
    gaps.push({
      field: "postalAddress",
      envVar: "NEXT_PUBLIC_SITE_ADDRESS",
      blocks: "the contact address required on the privacy policy and terms",
    });
  }
  if (!config.contactEmail) {
    gaps.push({
      field: "contactEmail",
      envVar: "NEXT_PUBLIC_CONTACT_EMAIL",
      blocks: "the contact route shown on the contact page and footer",
    });
  }
  if (!env("NEXT_PUBLIC_SITE_URL")) {
    gaps.push({
      field: "baseUrl",
      envVar: "NEXT_PUBLIC_SITE_URL",
      blocks: "canonical URLs, sitemap entries and Open Graph image URLs",
    });
  }
  return gaps;
}

/** True when every fact the public pages assert is actually supplied. */
export function siteIsLaunchReady(config: SiteConfig = siteConfig): boolean {
  return siteReadiness(config).length === 0;
}
