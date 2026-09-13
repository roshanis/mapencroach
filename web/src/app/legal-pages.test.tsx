import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PrivacyPolicyPage from "./privacy/page";
import TermsPage from "./terms/page";
import ContactPage from "./contact/page";
import robots from "./robots";
import sitemap from "./sitemap";
import { siteConfig } from "@/lib/site-config";

describe("legal pages", () => {
  it("marks unpublished operator details instead of inventing them", () => {
    // With no operator configured (the default build), the page must show
    // the gap. A fabricated controller address on a privacy policy is a
    // misrepresentation to the person relying on it, not a placeholder.
    render(<PrivacyPolicyPage />);
    expect(screen.getAllByTestId("unpublished-detail").length).toBeGreaterThan(0);
  });

  it("states plainly that no analytics is loaded when none is configured", () => {
    expect(siteConfig.analyticsId).toBe("");
    render(<PrivacyPolicyPage />);
    expect(
      screen.getByText(/no analytics and no third-party/i)
    ).toBeTruthy();
  });

  it("names the actual cookies the app sets", () => {
    render(<PrivacyPolicyPage />);
    for (const name of [
      "mapencroach_token",
      "mapencroach_persona",
      "mapencroach_persona_meta",
    ]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("terms restate the limits the software actually enforces", () => {
    render(<TermsPage />);
    expect(screen.getByText(/not a finding of encroachment/i)).toBeTruthy();
    // Appears in both the terms body and the footer disclaimer.
    expect(screen.getAllByText(/not a cadastral record/i).length).toBeGreaterThan(0);
  });

  it("contact page offers no form when there is nowhere to send it", () => {
    expect(siteConfig.contactEndpoint).toBe("");
    render(<ContactPage />);
    expect(screen.getByTestId("contact-no-form")).toBeTruthy();
    expect(screen.queryByTestId("contact-form")).toBeNull();
  });
});

describe("crawler directives", () => {
  it("keeps record-bearing routes out of robots.txt", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = rule.disallow as string[];
    // Console URLs name real parcels, alerts and cases; indexing them
    // would publish a jurisdiction's caseload shape.
    for (const path of ["/console", "/cases", "/parcels", "/alerts"]) {
      expect(disallow).toContain(path);
    }
  });

  it("lists only public pages in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.some((u) => u.endsWith("/privacy"))).toBe(true);
    for (const secret of ["/console", "/cases", "/parcels", "/watchlist"]) {
      expect(urls.some((u) => u.includes(secret))).toBe(false);
    }
  });

  it("points the sitemap at the configured origin", () => {
    expect(robots().sitemap).toBe(`${siteConfig.baseUrl}/sitemap.xml`);
  });
});
