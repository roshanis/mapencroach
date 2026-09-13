import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";

/**
 * Serves /sitemap.xml.
 *
 * Lists only the publicly crawlable pages — the same set robots.ts
 * allows. Authenticated console routes are deliberately absent: a
 * sitemap that advertises /cases/case-1 tells the world a case exists
 * even if its contents are protected, which is the same existence leak
 * the API avoids by answering 404 instead of 403.
 *
 * `lastModified` is intentionally omitted rather than stamped with the
 * build time: a date that moves on every deploy tells a crawler the
 * content changed when it did not.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.baseUrl.replace(/\/$/, "");
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
