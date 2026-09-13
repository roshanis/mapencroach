import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CookieNotice, CONSENT_KEY, readConsent } from "./CookieNotice";
import { Analytics } from "./Analytics";
import { siteConfig } from "@/lib/site-config";

describe("cookie notice", () => {
  beforeEach(() => {
    localStorage.clear();
    siteConfig.analyticsId = "";
  });
  afterEach(() => {
    siteConfig.analyticsId = "";
    vi.unstubAllGlobals();
  });

  it("shows nothing when there is nothing optional to consent to", async () => {
    // The session cookies are strictly necessary, so no honest banner can
    // ask about them. A banner here would be consent theatre.
    render(<CookieNotice />);
    expect(screen.queryByTestId("cookie-notice")).toBeNull();
  });

  it("asks only when analytics is actually configured", async () => {
    siteConfig.analyticsId = "G-TEST";
    render(<CookieNotice />);
    expect(await screen.findByTestId("cookie-notice")).toBeTruthy();
  });

  it("remembers a decline and does not ask again", async () => {
    siteConfig.analyticsId = "G-TEST";
    const { unmount } = render(<CookieNotice />);
    fireEvent.click(await screen.findByTestId("cookie-decline"));
    expect(readConsent()).toBe("declined");
    unmount();

    render(<CookieNotice />);
    expect(screen.queryByTestId("cookie-notice")).toBeNull();
  });

  it("survives storage being blocked without claiming consent", () => {
    siteConfig.analyticsId = "G-TEST";
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    // Unreadable storage must read as "not yet answered", never as accepted.
    expect(readConsent()).toBeNull();
  });
});

describe("analytics gating", () => {
  beforeEach(() => {
    localStorage.clear();
    siteConfig.analyticsId = "";
  });
  afterEach(() => {
    siteConfig.analyticsId = "";
  });

  it("loads nothing with no id configured, whatever consent says", () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    const { container } = render(<Analytics />);
    expect(container.innerHTML).toBe("");
  });

  it("loads nothing before consent is given", () => {
    siteConfig.analyticsId = "G-TEST";
    const { container } = render(<Analytics />);
    expect(container.innerHTML).toBe("");
  });

  it("loads nothing after an explicit decline", () => {
    siteConfig.analyticsId = "G-TEST";
    localStorage.setItem(CONSENT_KEY, "declined");
    const { container } = render(<Analytics />);
    expect(container.innerHTML).toBe("");
  });
});
