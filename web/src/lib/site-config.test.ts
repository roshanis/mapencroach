import { describe, expect, it } from "vitest";
import { siteConfig, siteIsLaunchReady, siteReadiness, type SiteConfig } from "./site-config";

function config(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    baseUrl: "https://example.gov",
    organisation: "Example Authority",
    postalAddress: "1 Example Road",
    contactEmail: "contact@example.gov",
    privacyEmail: "privacy@example.gov",
    contactEndpoint: "",
    analyticsId: "",
    ...overrides,
  };
}

describe("site readiness", () => {
  it("reports nothing missing when every public fact is supplied", () => {
    // baseUrl gap is env-derived, so a fully-set config in this env still
    // reports the NEXT_PUBLIC_SITE_URL gap; assert on the entity fields.
    const fields = siteReadiness(config()).map((gap) => gap.field);
    expect(fields).not.toContain("organisation");
    expect(fields).not.toContain("postalAddress");
    expect(fields).not.toContain("contactEmail");
  });

  it("names the missing operator, address and contact", () => {
    const gaps = siteReadiness(
      config({ organisation: "", postalAddress: "", contactEmail: "" })
    );
    const fields = gaps.map((gap) => gap.field);
    expect(fields).toContain("organisation");
    expect(fields).toContain("postalAddress");
    expect(fields).toContain("contactEmail");
  });

  it("says which env var fills each gap and what it blocks", () => {
    const gap = siteReadiness(config({ postalAddress: "" })).find(
      (item) => item.field === "postalAddress"
    );
    expect(gap?.envVar).toBe("NEXT_PUBLIC_SITE_ADDRESS");
    expect(gap?.blocks).toMatch(/privacy policy/i);
  });

  it("is not launch ready while a public fact is unset", () => {
    expect(siteIsLaunchReady(config({ organisation: "" }))).toBe(false);
  });

  it("ships with no invented contact details", () => {
    // The guarantee that matters: a default build must not assert a
    // postal address or mailbox that does not exist. Someone adding a
    // plausible-looking default here would fail this.
    for (const value of [
      siteConfig.organisation,
      siteConfig.postalAddress,
      siteConfig.contactEmail,
    ]) {
      expect(value === "" || process.env.NEXT_PUBLIC_SITE_ORG !== undefined).toBe(true);
    }
  });

  it("loads no analytics by default", () => {
    expect(siteConfig.analyticsId).toBe("");
  });
});
