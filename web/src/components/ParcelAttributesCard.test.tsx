import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParcelAttributesCard } from "./ParcelAttributesCard";
import { FIXTURE_PARCELS } from "@/lib/fixtures";

describe("ParcelAttributesCard", () => {
  it("renders survey no, ULPIN, department, land category, and boundary grade", () => {
    const parcel = FIXTURE_PARCELS[0]; // PCL-1001, waterbody, grade A
    render(<ParcelAttributesCard parcel={parcel} />);

    const card = screen.getByTestId("parcel-attributes-card");
    expect(card).toHaveTextContent(parcel.survey_no);
    expect(card).toHaveTextContent(parcel.ulpin);
    expect(card).toHaveTextContent(parcel.owning_department);
    expect(card).toHaveTextContent("Waterbody");

    const badge = screen.getByTestId("boundary-grade-badge");
    expect(badge).toHaveAttribute("data-grade", "A");
    expect(badge).toHaveTextContent("DGPS-verified");
  });

  it("renders the correct explanation for a grade C (unverified) parcel", () => {
    const parcel = FIXTURE_PARCELS.find((p) => p.boundary_grade === "C");
    expect(parcel).toBeDefined();
    render(<ParcelAttributesCard parcel={parcel!} />);
    const badge = screen.getByTestId("boundary-grade-badge");
    expect(badge).toHaveTextContent("Unverified");
  });
});
