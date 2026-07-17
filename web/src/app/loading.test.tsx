import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Loading from "./loading";

describe("route loading state", () => {
  it("explains that operational data is still loading", () => {
    render(<Loading />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading operational data…"
    );
  });
});
