import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FIXTURE_ALERTS,
  FIXTURE_CASES,
  FIXTURE_PARCELS,
} from "@/lib/fixtures";
import { EvidencePacketDocument } from "./EvidencePacketDocument";

describe("EvidencePacketDocument", () => {
  it("compiles case, parcel, alert, history, and artifact provenance into one packet", () => {
    render(
      <EvidencePacketDocument
        caseRecord={FIXTURE_CASES[0]}
        parcel={FIXTURE_PARCELS[0]}
        alert={FIXTURE_ALERTS[0]}
      />
    );

    expect(screen.getByRole("heading", { name: "Evidence packet" })).toBeInTheDocument();
    expect(screen.getByText(`Case ${FIXTURE_CASES[0].id}`)).toBeInTheDocument();
    expect(screen.getByText(FIXTURE_PARCELS[0].survey_no)).toBeInTheDocument();
    expect(screen.getByText(FIXTURE_PARCELS[0].ulpin)).toBeInTheDocument();
    expect(screen.getByTestId("evidence-manifest")).toBeInTheDocument();
    expect(screen.getByTestId("event-timeline")).toBeInTheDocument();
  });

  it("shows certificate readiness without claiming signature or certification", () => {
    render(
      <EvidencePacketDocument
        caseRecord={FIXTURE_CASES[0]}
        parcel={FIXTURE_PARCELS[0]}
        alert={FIXTURE_ALERTS[0]}
      />
    );

    expect(screen.getByText(/not digitally signed or legally certified/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Certificate readiness" })).toBeInTheDocument();
    expect(screen.getByText("Manifest compiled from case events")).toBeInTheDocument();
    expect(screen.getByText("Legal officer review pending")).toBeInTheDocument();
    expect(screen.getByText("Digital signature pending")).toBeInTheDocument();
  });
});
