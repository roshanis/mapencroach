import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ErrorState from "./error";

describe("route error state", () => {
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
