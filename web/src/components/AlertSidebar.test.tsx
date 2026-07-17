import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AlertSidebar } from "./AlertSidebar";
import { FIXTURE_ALERTS } from "@/lib/fixtures";

describe("AlertSidebar", () => {
  it("shows only unresolved alerts under an accurate heading", () => {
    render(<AlertSidebar alerts={FIXTURE_ALERTS} />);

    expect(screen.getByText("Unresolved alerts")).toBeInTheDocument();
    expect(screen.getByText("4 need attention")).toBeInTheDocument();
    expect(screen.queryByText("PCL-1006")).not.toBeInTheDocument();
  });

  it("selects an alert without navigating away from the map", () => {
    const onSelect = vi.fn();
    render(<AlertSidebar alerts={FIXTURE_ALERTS} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /PCL-1001/i }));

    expect(onSelect).toHaveBeenCalledWith(FIXTURE_ALERTS[0]);
  });

  it("renders a useful empty state when no unresolved alerts remain", () => {
    render(
      <AlertSidebar
        alerts={FIXTURE_ALERTS.map((alert) => ({
          ...alert,
          status: "closed" as const,
        }))}
      />
    );

    expect(screen.getByText("No unresolved alerts in this jurisdiction.")).toBeInTheDocument();
  });
});
