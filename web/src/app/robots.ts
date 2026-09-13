import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";

/**
 * Serves /robots.txt.
 *
 * The operational console is disallowed on purpose. It is behind auth and
 * returns nothing useful to a crawler, but more to the point every URL
 * under it names a real parcel, alert or case id — indexing those would
 * publish the shape of a jurisdiction's caseload even though the contents
 * stay protected. The public marketing and legal pages are crawlable.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy", "/terms", "/contact"],
        disallow: [
          "/console",
          "/alerts",
          "/cases",
          "/parcels",
          "/watchlist",
          "/personas",
          "/api/",
        ],
      },
    ],
    sitemap: `${siteConfig.baseUrl}/sitemap.xml`,
  };
}
