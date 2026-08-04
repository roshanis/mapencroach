import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { H3GridControl } from "./H3GridControl";

describe("H3GridControl", () => {
  it("keeps the analytical grid off by default and explains its trust boundary", () => {
    render(
      <H3GridControl
        visible={false}
        resolution={11}
        cellCount={24}
        onVisibleChange={vi.fn()}
        onResolutionChange={vi.fn()}
      />
    );

    expect(screen.getByRole("checkbox", { name: "H3 analytical grid" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "H3 resolution" })).toBeDisabled();
    expect(screen.getByText("Analytical context only — not a parcel boundary.")).toBeInTheDocument();
  });

  it("enables the overlay and changes among the supported resolutions", () => {
    const onVisibleChange = vi.fn();
    const onResolutionChange = vi.fn();
    const { rerender } = render(
      <H3GridControl
        visible={false}
        resolution={11}
        cellCount={24}
        onVisibleChange={onVisibleChange}
        onResolutionChange={onResolutionChange}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "H3 analytical grid" }));
    expect(onVisibleChange).toHaveBeenCalledWith(true);

    rerender(
      <H3GridControl
        visible
        resolution={11}
        cellCount={24}
        onVisibleChange={onVisibleChange}
        onResolutionChange={onResolutionChange}
      />
    );

    const resolution = screen.getByRole("combobox", { name: "H3 resolution" });
    expect(resolution).toBeEnabled();
    expect(screen.getByText("24 cells")).toBeInTheDocument();
    fireEvent.change(resolution, { target: { value: "10" } });
    expect(onResolutionChange).toHaveBeenCalledWith(10);
    expect(
      Array.from((resolution as HTMLSelectElement).options).map((option) => option.value)
    ).toEqual(["9", "10", "11"]);
  });

  it("surfaces a safe generation warning without hiding the control", () => {
    render(
      <H3GridControl
        visible
        resolution={11}
        cellCount={0}
        warning="Grid exceeds the safe display limit. Choose a lower resolution."
        onVisibleChange={vi.fn()}
        onResolutionChange={vi.fn()}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("safe display limit");
    expect(screen.getByRole("checkbox", { name: "H3 analytical grid" })).toBeChecked();
  });
});
