import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PrintPacketButton } from "./PrintPacketButton";

describe("PrintPacketButton", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the browser print flow for PDF or paper export", () => {
    const printMock = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<PrintPacketButton />);

    fireEvent.click(screen.getByRole("button", { name: "Print or save as PDF" }));

    expect(printMock).toHaveBeenCalledOnce();
  });
});
