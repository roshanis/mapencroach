import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TagEditor } from "./TagEditor";
import { addParcelTag, removeParcelTag } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  addParcelTag: vi.fn(),
  removeParcelTag: vi.fn(),
}));

describe("TagEditor", () => {
  it("renders chips from initialTags", () => {
    render(<TagEditor parcelId="PCL-1001" initialTags={["court-monitored", "flagged"]} />);

    const chips = screen.getAllByTestId("tag-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("court-monitored");
    expect(chips[1]).toHaveTextContent("flagged");
    expect(screen.getByTestId("tag-remove-court-monitored")).toBeInTheDocument();
    expect(screen.getByTestId("tag-remove-flagged")).toBeInTheDocument();
  });

  it("renders no chips when initialTags is empty", () => {
    render(<TagEditor parcelId="PCL-1001" initialTags={[]} />);
    expect(screen.queryAllByTestId("tag-chip")).toHaveLength(0);
  });

  it("adds a tag on success and clears the input", async () => {
    vi.mocked(addParcelTag).mockResolvedValue({
      ok: true,
      status: 201,
      tags: ["court-monitored", "new-tag"],
    });

    render(<TagEditor parcelId="PCL-1001" initialTags={["court-monitored"]} />);

    const input = screen.getByTestId("tag-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new-tag" } });
    fireEvent.click(screen.getByTestId("tag-add"));

    await waitFor(() => {
      expect(screen.getAllByTestId("tag-chip")).toHaveLength(2);
    });

    expect(addParcelTag).toHaveBeenCalledWith("PCL-1001", "new-tag");
    expect(screen.getByTestId("tag-input")).toHaveValue("");
  });

  it("shows the 403 detail verbatim on add failure and keeps the input intact", async () => {
    vi.mocked(addParcelTag).mockResolvedValue({
      ok: false,
      status: 403,
      detail: "viewer role cannot tag parcels",
    });

    render(<TagEditor parcelId="PCL-1001" initialTags={[]} />);

    const input = screen.getByTestId("tag-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new-tag" } });
    fireEvent.click(screen.getByTestId("tag-add"));

    await waitFor(() => {
      expect(screen.getByTestId("tag-error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("tag-error")).toHaveTextContent(
      "Refused (HTTP 403): viewer role cannot tag parcels"
    );
    expect(screen.getByTestId("tag-input")).toHaveValue("new-tag");
    expect(screen.queryAllByTestId("tag-chip")).toHaveLength(0);
  });

  it("removes a tag on success", async () => {
    vi.mocked(removeParcelTag).mockResolvedValue({
      ok: true,
      status: 200,
      tags: [],
    });

    render(<TagEditor parcelId="PCL-1001" initialTags={["court-monitored"]} />);

    fireEvent.click(screen.getByTestId("tag-remove-court-monitored"));

    await waitFor(() => {
      expect(screen.queryAllByTestId("tag-chip")).toHaveLength(0);
    });

    expect(removeParcelTag).toHaveBeenCalledWith("PCL-1001", "court-monitored");
  });

  it("shows an error on remove failure", async () => {
    vi.mocked(removeParcelTag).mockResolvedValue({
      ok: false,
      status: 404,
      detail: "tag not present",
    });

    render(<TagEditor parcelId="PCL-1001" initialTags={["court-monitored"]} />);

    fireEvent.click(screen.getByTestId("tag-remove-court-monitored"));

    await waitFor(() => {
      expect(screen.getByTestId("tag-error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("tag-error")).toHaveTextContent(
      "Refused (HTTP 404): tag not present"
    );
    // Chip remains since the removal was refused.
    expect(screen.getAllByTestId("tag-chip")).toHaveLength(1);
  });
});
