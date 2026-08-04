import { describe, expect, it, vi } from "vitest";
import { createAlertMarkerElement } from "./map-markers";

describe("createAlertMarkerElement", () => {
  const baseAlert = { id: "ALT-5001", tier: "red" as const, severity_score: 91.6 };

  it("returns a plain wrapper div containing the marker button", () => {
    const { wrapper, button } = createAlertMarkerElement({
      alert: baseAlert,
      parcelLabel: "SN-101",
    });

    expect(wrapper.tagName).toBe("DIV");
    expect(button.tagName).toBe("BUTTON");
    expect(wrapper.contains(button)).toBe(true);
  });

  it("labels the button with the alert id, tier word, rounded severity, and parcel", () => {
    const { button } = createAlertMarkerElement({
      alert: baseAlert,
      parcelLabel: "SN-101",
    });

    const ariaLabel = button.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("ALT-5001");
    expect(ariaLabel).toContain("Red");
    expect(ariaLabel).toContain("92"); // Math.round(91.6)
    expect(ariaLabel).toContain("SN-101");
  });

  it("shows the rounded severity score as the button's visible text", () => {
    const { button } = createAlertMarkerElement({
      alert: { ...baseAlert, severity_score: 59.5 },
      parcelLabel: "SN-101",
    });

    expect(button.textContent).toBe("60");
  });

  it("adds a pulse class to the wrapper only for red-tier alerts", () => {
    const red = createAlertMarkerElement({
      alert: { ...baseAlert, tier: "red" },
      parcelLabel: "SN-101",
    });
    expect(red.wrapper.classList.contains("alert-marker-pulse")).toBe(true);

    for (const tier of ["amber", "green", "legacy"] as const) {
      const marker = createAlertMarkerElement({
        alert: { ...baseAlert, tier, id: `ALT-${tier}` },
        parcelLabel: "SN-101",
      });
      expect(marker.wrapper.classList.contains("alert-marker-pulse")).toBe(
        false
      );
    }
  });

  it("setSelected scales and rings the button only, never the wrapper's transform", () => {
    const { wrapper, button, setSelected } = createAlertMarkerElement({
      alert: baseAlert,
      parcelLabel: "SN-101",
      selected: false,
    });

    expect(wrapper.style.transform).toBe("");
    const unselectedShadow = button.style.boxShadow;

    setSelected(true);
    expect(button.style.transform).toContain("scale(1.35)");
    expect(button.style.boxShadow).not.toBe(unselectedShadow);
    expect(wrapper.style.transform).toBe("");

    setSelected(false);
    expect(button.style.transform).toBe("scale(1)");
    expect(wrapper.style.transform).toBe("");
  });

  it("initializes selected styling up front when selected is passed true", () => {
    const { button } = createAlertMarkerElement({
      alert: baseAlert,
      parcelLabel: "SN-101",
      selected: true,
    });

    expect(button.style.transform).toContain("scale(1.35)");
  });

  it("invokes onClick with the alert id when the button is clicked", () => {
    const onClick = vi.fn();
    const { button } = createAlertMarkerElement({
      alert: baseAlert,
      parcelLabel: "SN-101",
      onClick,
    });

    button.click();
    expect(onClick).toHaveBeenCalledWith("ALT-5001");
  });

  it("never sets onClick as a handler on the wrapper", () => {
    const onClick = vi.fn();
    const { wrapper } = createAlertMarkerElement({
      alert: baseAlert,
      parcelLabel: "SN-101",
      onClick,
    });

    wrapper.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
