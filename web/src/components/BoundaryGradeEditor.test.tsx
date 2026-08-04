import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { updateBoundaryGrade } from "@/lib/api";
import { PERSONA_META_COOKIE } from "@/lib/cookies";
import { BoundaryGradeEditor } from "./BoundaryGradeEditor";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/api", () => ({
  updateBoundaryGrade: vi.fn(),
}));

function setRole(role: string) {
  document.cookie = `${PERSONA_META_COOKIE}=${encodeURIComponent(
    JSON.stringify({ name: "Demo officer", role })
  )}; path=/`;
}

describe("BoundaryGradeEditor", () => {
  afterEach(() => {
    document.cookie = `${PERSONA_META_COOKIE}=; path=/; max-age=0`;
    refreshMock.mockReset();
    vi.resetAllMocks();
  });

  it("does not expose the control to a case officer", async () => {
    setRole("case_officer");
    const { container } = render(
      <BoundaryGradeEditor parcelId="parcel-1" initialGrade="C" />
    );

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows an auditable grade update form to survey officers", async () => {
    setRole("survey_officer");
    render(<BoundaryGradeEditor parcelId="parcel-1" initialGrade="C" />);

    expect(
      await screen.findByRole("heading", { name: "Record boundary verification" })
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "New boundary grade" })).toHaveValue("C");
    expect(screen.getByRole("textbox", { name: "Survey reference" })).toBeInTheDocument();
  });

  it("requires both a changed grade and survey reference before submission", async () => {
    setRole("survey_officer");
    render(<BoundaryGradeEditor parcelId="parcel-1" initialGrade="C" />);

    const submit = await screen.findByRole("button", { name: "Record boundary grade" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "New boundary grade" }), {
      target: { value: "A" },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Survey reference" }), {
      target: { value: "SR-2026-104" },
    });
    expect(submit).toBeEnabled();
  });

  it("records a successful update and refreshes the parcel record", async () => {
    setRole("survey_officer");
    vi.mocked(updateBoundaryGrade).mockResolvedValue({
      ok: true,
      status: 200,
      grade: "A",
    });
    render(<BoundaryGradeEditor parcelId="parcel-1" initialGrade="C" />);

    fireEvent.change(await screen.findByRole("combobox", { name: "New boundary grade" }), {
      target: { value: "A" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Survey reference" }), {
      target: { value: "SR-2026-104" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record boundary grade" }));

    expect(updateBoundaryGrade).toHaveBeenCalledWith("parcel-1", "A", "SR-2026-104");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Boundary grade A recorded with survey reference SR-2026-104."
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces the backend refusal without changing the displayed grade", async () => {
    setRole("data_admin");
    vi.mocked(updateBoundaryGrade).mockResolvedValue({
      ok: false,
      status: 403,
      detail: "role cannot update boundary grade",
    });
    render(<BoundaryGradeEditor parcelId="parcel-1" initialGrade="C" />);

    fireEvent.change(await screen.findByRole("combobox", { name: "New boundary grade" }), {
      target: { value: "B" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Survey reference" }), {
      target: { value: "SR-2026-105" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record boundary grade" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Refused (HTTP 403): role cannot update boundary grade"
    );
    expect(screen.getByRole("combobox", { name: "New boundary grade" })).toHaveValue("B");
  });
});
