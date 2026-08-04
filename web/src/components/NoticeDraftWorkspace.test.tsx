import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_PARCELS,
} from "@/lib/fixtures";
import { NoticeDraftWorkspace } from "./NoticeDraftWorkspace";

function renderWorkspace(boundaryGrade: "A" | "B" | "C" = "A") {
  return render(
    <NoticeDraftWorkspace
      caseRecord={FIXTURE_CASES[0]}
      parcel={{ ...FIXTURE_PARCELS[0], boundary_grade: boundaryGrade }}
      alert={FIXTURE_ALERTS[0]}
    />
  );
}

function completeRequiredFields() {
  fireEvent.change(screen.getByRole("textbox", { name: "Addressee or occupant" }), {
    target: { value: "Occupant at the recorded site" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Service address" }), {
    target: { value: "Survey 44/2, Haridwar" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Approved legal authority or provision" }), {
    target: { value: "Approved provision supplied by legal cell" },
  });
  fireEvent.change(screen.getByLabelText("Response deadline"), {
    target: { value: "2026-08-15" },
  });
}

describe("NoticeDraftWorkspace", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the legal-template boundary and prefilled parcel facts", () => {
    renderWorkspace();

    expect(screen.getByRole("heading", { name: "Prepare notice draft" })).toBeInTheDocument();
    expect(screen.getByText(/training draft only.*no approved legal template/i)).toBeInTheDocument();
    expect(
      (screen.getByRole("textbox", { name: "Observed facts" }) as HTMLTextAreaElement).value
    ).toContain(FIXTURE_PARCELS[0].survey_no);
  });

  it("blocks notice drafting when the parcel boundary is Grade C", () => {
    renderWorkspace("C");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Grade C boundary blocks notice drafting"
    );
    expect(screen.getByRole("button", { name: "Generate training draft" })).toBeDisabled();
  });

  it("requires an addressee, address, legal authority, and response deadline", () => {
    renderWorkspace();
    const generate = screen.getByRole("button", { name: "Generate training draft" });
    expect(generate).toBeDisabled();

    completeRequiredFields();

    expect(generate).toBeEnabled();
  });

  it("generates a visibly non-serviceable draft from the reviewed fields", () => {
    renderWorkspace();
    completeRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Generate training draft" }));

    const preview = screen.getByTestId("notice-draft-preview");
    expect(preview).toHaveTextContent("DRAFT — NOT FOR SERVICE");
    expect(preview).toHaveTextContent(FIXTURE_CASES[0].id);
    expect(preview).toHaveTextContent("Approved provision supplied by legal cell");
    expect(preview).toHaveTextContent("does not establish encroachment");
    expect(screen.getByRole("button", { name: "Copy training draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print training draft" })).toBeInTheDocument();
  });

  it("copies the generated draft and confirms completion", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderWorkspace();
    completeRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Generate training draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy training draft" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("Training draft copied");
  });
});
