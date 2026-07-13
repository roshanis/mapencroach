import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersonaCard } from "./PersonaCard";
import type { Persona } from "@/lib/api";

const PERSONA: Persona = {
  id: "eo-haridwar",
  name: "Enforcement Officer, Haridwar",
  role: "case_officer",
  jurisdiction_id: "dist-a",
  jurisdiction_name: "Haridwar Division",
  description: "Drives cases through due process.",
  visible_parcels: 15,
  capabilities: [
    "Move cases through due process",
    "Cannot upgrade boundary grades",
  ],
};

describe("PersonaCard", () => {
  it("renders the persona name and a Title Case role chip with underscores replaced", () => {
    render(<PersonaCard persona={PERSONA} isActive={false} />);
    expect(screen.getByText("Enforcement Officer, Haridwar")).toBeInTheDocument();
    expect(screen.getByText("Case Officer")).toBeInTheDocument();
  });

  it("renders the jurisdiction line via jurisdictionLabel", () => {
    render(<PersonaCard persona={PERSONA} isActive={false} />);
    expect(screen.getByText(/Haridwar Division/)).toBeInTheDocument();
  });

  it("shows the visibility row with bold N of M and a mini bar sized to N/M", () => {
    render(<PersonaCard persona={PERSONA} totalParcels={30} isActive={false} />);
    expect(screen.getByText(/Sees/)).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    const track = screen.getByTestId("persona-visibility-bar-track");
    const fill = track.querySelector("div");
    expect(fill).toHaveStyle({ width: "50%" });
  });

  it("shows capability rows with checkmarks for affirmative lines and X for Cannot lines", () => {
    render(<PersonaCard persona={PERSONA} isActive={false} />);
    expect(screen.getByText("Move cases through due process")).toBeInTheDocument();
    expect(screen.getByText("Cannot upgrade boundary grades")).toBeInTheDocument();
    const rows = screen.getAllByTestId("persona-capability-row");
    expect(rows[0]).toHaveTextContent("✓");
    expect(rows[1]).toHaveTextContent("✕");
  });

  it("applies the active ring class when isActive is true", () => {
    const { container } = render(<PersonaCard persona={PERSONA} isActive={true} />);
    const card = container.firstElementChild;
    expect(card).toHaveClass("ring-2");
    expect(card).toHaveClass("ring-gov");
  });

  it("does not apply the active ring class when isActive is false", () => {
    const { container } = render(<PersonaCard persona={PERSONA} isActive={false} />);
    const card = container.firstElementChild;
    expect(card).not.toHaveClass("ring-2");
  });

  it("renders a disabled View as button with a helpful title when onViewAs is undefined", () => {
    render(<PersonaCard persona={PERSONA} isActive={false} />);
    const button = screen.getByTestId(`persona-view-as-${PERSONA.id}`);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "Connect the demo backend to switch personas"
    );
  });

  it("enables the View as button and calls onViewAs with the persona id when clicked", () => {
    const onViewAs = vi.fn();
    render(
      <PersonaCard persona={PERSONA} isActive={false} onViewAs={onViewAs} />
    );
    const button = screen.getByTestId(`persona-view-as-${PERSONA.id}`);
    expect(button).not.toBeDisabled();
    button.click();
    expect(onViewAs).toHaveBeenCalledWith(PERSONA.id);
  });
});
