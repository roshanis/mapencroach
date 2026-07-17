import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "./not-found";

describe("not-found state", () => {
  it("explains that the record is unavailable and offers safe routes back", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: "Record not found" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to alert queue" })).toHaveAttribute(
      "href",
      "/alerts"
    );
    expect(screen.getByRole("link", { name: "Open command map" })).toHaveAttribute(
      "href",
      "/"
    );
  });
});
