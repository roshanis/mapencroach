import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoModeBanner, DemoActionBoundary } from "./DemoModeBanner";

describe("sample workspace clarity", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("identifies read-only samples before a visitor tries to save", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    render(<DemoModeBanner />);
    expect(screen.getByRole("note")).toHaveTextContent(/sample workspace.*read.only/i);
    expect(screen.getByRole("note")).toHaveTextContent(/changes.*saved/i);
  });

  it("keeps sample controls explorable so mutation components can gate only submit", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    render(<DemoActionBoundary><button>Save case</button></DemoActionBoundary>);
    expect(screen.getByRole("button", { name: "Save case" })).toBeEnabled();
  });

  it("does not alter actions when the interactive service is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "/api/backend");
    render(<DemoActionBoundary><button>Save case</button></DemoActionBoundary>);
    expect(screen.getByRole("button", { name: "Save case" })).toBeEnabled();
  });
});
