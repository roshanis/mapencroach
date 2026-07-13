import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ViewingAsBanner } from "./ViewingAsBanner";
import { PERSONA_META_COOKIE } from "@/lib/cookies";
import { PERSONA_COOKIE, TOKEN_COOKIE } from "@/lib/api";

function clearAllCookies() {
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0`;
  document.cookie = `${PERSONA_COOKIE}=; path=/; max-age=0`;
  document.cookie = `${PERSONA_META_COOKIE}=; path=/; max-age=0`;
}

describe("ViewingAsBanner", () => {
  afterEach(() => {
    clearAllCookies();
    vi.restoreAllMocks();
  });

  it("renders nothing when no persona cookie is present", async () => {
    const { container } = render(<ViewingAsBanner />);
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("renders with the meta cookie: name, role label, and jurisdiction", async () => {
    document.cookie = `${PERSONA_META_COOKIE}=${encodeURIComponent(
      JSON.stringify({
        name: "Enforcement Officer, Haridwar",
        role: "case_officer",
        jurisdiction_id: "dist-a",
        jurisdiction_name: "Haridwar Division",
      })
    )}; path=/`;

    render(<ViewingAsBanner />);

    await waitFor(() => {
      expect(screen.getByTestId("viewing-as-banner")).toBeInTheDocument();
    });
    expect(screen.getByTestId("viewing-as-banner")).toHaveTextContent(
      "Enforcement Officer, Haridwar"
    );
    expect(screen.getByTestId("viewing-as-banner")).toHaveTextContent(
      "Case Officer"
    );
    expect(screen.getByTestId("viewing-as-banner")).toHaveTextContent(
      "Haridwar Division"
    );
  });

  it("falls back to the plain persona-name cookie when no meta cookie is present", async () => {
    document.cookie = `${PERSONA_COOKIE}=${encodeURIComponent(
      "Deputy Collector"
    )}; path=/`;

    render(<ViewingAsBanner />);

    await waitFor(() => {
      expect(screen.getByTestId("viewing-as-banner")).toBeInTheDocument();
    });
    expect(screen.getByTestId("viewing-as-banner")).toHaveTextContent(
      "Deputy Collector"
    );
  });

  it("renders an All personas link to /personas", async () => {
    document.cookie = `${PERSONA_COOKIE}=${encodeURIComponent(
      "Deputy Collector"
    )}; path=/`;

    render(<ViewingAsBanner />);

    await waitFor(() => {
      expect(screen.getByText("All personas")).toBeInTheDocument();
    });
    expect(screen.getByText("All personas").closest("a")).toHaveAttribute(
      "href",
      "/personas"
    );
  });

  it("clears all persona/token cookies and reloads on Exit persona click", async () => {
    document.cookie = `${TOKEN_COOKIE}=tok-abc; path=/`;
    document.cookie = `${PERSONA_COOKIE}=${encodeURIComponent(
      "Deputy Collector"
    )}; path=/`;
    document.cookie = `${PERSONA_META_COOKIE}=${encodeURIComponent(
      JSON.stringify({ name: "Deputy Collector", role: "case_officer" })
    )}; path=/`;

    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    render(<ViewingAsBanner />);

    await waitFor(() => {
      expect(screen.getByTestId("exit-persona")).toBeInTheDocument();
    });

    screen.getByTestId("exit-persona").click();

    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalled();
    });

    expect(document.cookie).not.toContain(`${TOKEN_COOKIE}=tok-abc`);
    expect(document.cookie).not.toContain(PERSONA_COOKIE + "=Deputy");
    expect(document.cookie).not.toContain(PERSONA_META_COOKIE + "=%7B");
  });
});
