import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ErrorState from "./error";

describe("route error state", () => {
  it("offers a way to recover the session and leave the failed page", () => {
    render(<ErrorState error={new Error("unauthorized")} reset={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Choose a demo persona" })).toHaveAttribute("href", "/personas");
    expect(screen.getByRole("link", { name: "Return to command map" })).toHaveAttribute("href", "/console");
  });
  it("explains the failure and lets the user retry", () => {
    const reset = vi.fn();

    render(<ErrorState error={new Error("offline")} reset={reset} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This page could not be loaded"
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
