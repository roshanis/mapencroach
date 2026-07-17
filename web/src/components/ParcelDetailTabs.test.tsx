import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ParcelDetailTabs } from "./ParcelDetailTabs";

describe("ParcelDetailTabs", () => {
  it("starts on Overview and exposes accessible tab relationships", () => {
    render(
      <ParcelDetailTabs
        overview={<p>Overview content</p>}
        context={<p>Context content</p>}
      />
    );

    const overview = screen.getByRole("tab", { name: "Overview" });
    const context = screen.getByRole("tab", { name: "Context" });
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(context).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Overview content")).toBeVisible();
    expect(screen.getByText("Context content")).not.toBeVisible();
  });

  it("activates Context by click and keyboard", () => {
    render(
      <ParcelDetailTabs
        overview={<p>Overview content</p>}
        context={<p>Context content</p>}
      />
    );

    const overview = screen.getByRole("tab", { name: "Overview" });
    const context = screen.getByRole("tab", { name: "Context" });
    fireEvent.click(context);
    expect(context).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Context content")).toBeVisible();

    fireEvent.keyDown(context, { key: "ArrowLeft" });
    expect(overview).toHaveFocus();
    expect(overview).toHaveAttribute("aria-selected", "true");
  });
});
