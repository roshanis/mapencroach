import Link from "next/link";
import { siteConfig } from "@/lib/site-config";

/**
 * Public footer: legal routes and how to reach the operator.
 *
 * Every fact here comes from `siteConfig` and is rendered as unpublished
 * when it is unset. A footer is exactly the place a reader expects to
 * find a real address, so printing a placeholder that *looks* like one
 * would be worse than printing nothing.
 */
export function SiteFooter() {
  const { organisation, postalAddress, contactEmail } = siteConfig;
  const year = 2026;

  return (
    <footer
      data-testid="site-footer"
      className="border-t border-gray-200 bg-white px-5 py-10 text-sm text-gray-600 sm:px-8"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:justify-between">
        <div className="max-w-sm">
          <p className="font-semibold text-gray-900">mapencroach</p>
          <p className="mt-2 leading-relaxed">
            Public land intelligence and case management for government
            land administration.
          </p>

          <address className="mt-4 not-italic leading-relaxed" data-testid="footer-address">
            {organisation ? (
              <span className="block font-medium text-gray-900">{organisation}</span>
            ) : null}
            {postalAddress ? (
              <span className="block whitespace-pre-line">{postalAddress}</span>
            ) : (
              <span className="block text-gray-500" data-testid="footer-address-missing">
                Registered address not published yet.
              </span>
            )}
            {contactEmail ? (
              <a
                className="mt-2 inline-block text-gov underline underline-offset-2"
                href={`mailto:${contactEmail}`}
              >
                {contactEmail}
              </a>
            ) : null}
          </address>
        </div>

        <nav aria-label="Footer" className="flex flex-col gap-2">
          <Link className="hover:text-gray-900" href="/contact">
            Contact
          </Link>
          <Link className="hover:text-gray-900" href="/privacy">
            Privacy policy
          </Link>
          <Link className="hover:text-gray-900" href="/terms">
            Terms and conditions
          </Link>
        </nav>
      </div>

      <p className="mx-auto mt-8 max-w-7xl text-xs text-gray-500">
        © {year} {organisation || "the operator of this deployment"}. Demonstration
        data shown in this application is illustrative and is not a cadastral
        record.
      </p>
    </footer>
  );
}
