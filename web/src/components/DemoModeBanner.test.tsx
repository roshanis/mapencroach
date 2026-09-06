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

  it("disables sample mutation controls but keeps their explanation readable", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    render(<DemoActionBoundary><button>Save case</button></DemoActionBoundary>);
    expect(screen.getByRole("button", { name: "Save case" })).toBeDisabled();
    expect(screen.getByText(/action preview.*read.only/i)).toBeVisible();
  });

  it("does not disable actions when the interactive service is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "/api/backend");
    render(<DemoActionBoundary><button>Save case</button></DemoActionBoundary>);
    expect(screen.getByRole("button", { name: "Save case" })).toBeEnabled();
  });
});
