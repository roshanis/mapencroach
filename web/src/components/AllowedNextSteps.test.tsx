import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AllowedNextSteps } from "./AllowedNextSteps";

describe("AllowedNextSteps", () => {
  it("renders a chip per transition with underscores replaced by spaces", () => {
    render(
      <AllowedNextSteps
        transitions={[
          "RESPONSE_WINDOW",
          "DISMISSED_FALSE_POSITIVE",
          "LEGACY_REFERRED",
        ]}
      />
    );
    const section = screen.getByTestId("allowed-next-steps");
    expect(section).toHaveTextContent("RESPONSE WINDOW");
    expect(section).toHaveTextContent("DISMISSED FALSE POSITIVE");
    expect(section).toHaveTextContent("LEGACY REFERRED");
    expect(section).not.toHaveTextContent("RESPONSE_WINDOW");
  });

  it("renders the enforcement caption when transitions are present", () => {
    render(<AllowedNextSteps transitions={["RESPONSE_WINDOW"]} />);
    expect(
      screen.getByText(
        "Enforced by the case engine — any other transition is rejected with the missing evidence named."
      )
    ).toBeInTheDocument();
  });

  it("renders a closed-case caption when there are no transitions", () => {
    render(<AllowedNextSteps transitions={[]} />);
    const section = screen.getByTestId("allowed-next-steps");
    expect(section).toHaveTextContent(
      "No further transitions — this case is closed."
    );
    expect(section).not.toHaveTextContent("Enforced by the case engine");
  });
});
