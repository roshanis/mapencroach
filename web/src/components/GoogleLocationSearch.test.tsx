import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GoogleLocationSearch from "./GoogleLocationSearch";

const loader = vi.hoisted(() => ({ loadGooglePlacesLibrary: vi.fn() }));
vi.mock("./googleMapsLoader", () => loader);

type FakeAutocomplete = HTMLElement & { emitSelect: (prediction: unknown) => void; emitError: () => void };

function setupAutocomplete() {
  let autocomplete: FakeAutocomplete | undefined;
  const PlaceAutocompleteElement = vi.fn(function () {
    autocomplete = document.createElement("div") as unknown as FakeAutocomplete;
    autocomplete.emitSelect = (placePrediction) => {
      const event = Object.assign(new Event("gmp-select"), { placePrediction });
      autocomplete?.dispatchEvent(event);
    };
    autocomplete.emitError = () => autocomplete?.dispatchEvent(new Event("gmp-error"));
    return autocomplete;
  });
  loader.loadGooglePlacesLibrary.mockResolvedValue({ PlaceAutocompleteElement });
  return { PlaceAutocompleteElement, getAutocomplete: () => autocomplete };
}

afterEach(() => vi.clearAllMocks());

describe("GoogleLocationSearch", () => {
  it("does not steal focus from an existing control on initial mount", () => {
    const existing = document.createElement("button");
    existing.textContent = "Existing control";
    document.body.appendChild(existing);
    existing.focus();
    setupAutocomplete();
    render(<GoogleLocationSearch apiKey="places-key" onLocationSelect={vi.fn()} />);
    expect(existing).toHaveFocus();
    existing.remove();
  });

  it("lazy loads Places and returns a validated location", async () => {
    const { PlaceAutocompleteElement, getAutocomplete } = setupAutocomplete();
    const onLocationSelect = vi.fn();
    render(<GoogleLocationSearch apiKey="places-key" onLocationSelect={onLocationSelect} />);
    expect(loader.loadGooglePlacesLibrary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Search location" }));
    await waitFor(() => expect(PlaceAutocompleteElement).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Search location")).toBeTruthy();
    const fetchFields = vi.fn().mockResolvedValue(undefined);
    getAutocomplete()?.emitSelect({ toPlace: () => ({ fetchFields, location: { lat: () => 29.92, lng: () => 78.03 } }) });
    await waitFor(() => expect(onLocationSelect).toHaveBeenCalledWith({ lat: 29.92, lng: 78.03 }));
    expect(fetchFields).toHaveBeenCalledWith({ fields: ["location"] });
  });

  it("keeps failures inside search and permits retry", async () => {
    const first = setupAutocomplete();
    loader.loadGooglePlacesLibrary.mockRejectedValueOnce(new Error("quota"));
    const onLocationSelect = vi.fn();
    render(<GoogleLocationSearch apiKey="places-key" onLocationSelect={onLocationSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Search location" }));
    await screen.findByText("Location search unavailable. Try again.");
    const second = setupAutocomplete();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(second.PlaceAutocompleteElement).toHaveBeenCalledOnce());
    expect(first.PlaceAutocompleteElement).not.toHaveBeenCalled();
    expect(onLocationSelect).not.toHaveBeenCalled();
  });

  it("rejects non-finite or out-of-range coordinates", async () => {
    const { getAutocomplete } = setupAutocomplete();
    const onLocationSelect = vi.fn();
    render(<GoogleLocationSearch apiKey="places-key" onLocationSelect={onLocationSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Search location" }));
    await waitFor(() => expect(getAutocomplete()).toBeTruthy());
    const fetchFields = vi.fn().mockResolvedValue(undefined);
    getAutocomplete()?.emitSelect({ toPlace: () => ({ fetchFields, location: { lat: () => Number.NaN, lng: () => 181 } }) });
    await screen.findByText("Location search unavailable. Try again.");
    expect(onLocationSelect).not.toHaveBeenCalled();
  });

  it("clears the element and ignores a stale selection after collapse", async () => {
    const { getAutocomplete } = setupAutocomplete();
    const onLocationSelect = vi.fn();
    render(<GoogleLocationSearch apiKey="places-key" onLocationSelect={onLocationSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Search location" }));
    await waitFor(() => expect(getAutocomplete()).toBeTruthy());
    const fetchFields = vi.fn().mockResolvedValue(undefined);
    getAutocomplete()?.emitSelect({ toPlace: () => ({ fetchFields, location: { lat: () => 1, lng: () => 2 } }) });
    fireEvent.click(screen.getByRole("button", { name: "Close location search" }));
    expect(screen.queryByLabelText("Search location")).toBeNull();
    await waitFor(() => expect(onLocationSelect).not.toHaveBeenCalled());
  });

  it.each(["resolve", "reject"])("ignores an older selection that %ss after the newer selection", async (outcome) => {
    const { getAutocomplete } = setupAutocomplete();
    const onLocationSelect = vi.fn();
    render(<GoogleLocationSearch apiKey="places-key" onLocationSelect={onLocationSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Search location" }));
    await waitFor(() => expect(getAutocomplete()).toBeTruthy());
    let rejectA!: (error: Error) => void;
    let resolveA!: () => void;
    const fetchA = vi.fn(() => new Promise<void>((resolve, reject) => { resolveA = resolve; rejectA = reject; }));
    let resolveB!: () => void;
    const fetchB = vi.fn(() => new Promise<void>((resolve) => { resolveB = resolve; }));
    getAutocomplete()?.emitSelect({ toPlace: () => ({ fetchFields: fetchA, location: { lat: () => 1, lng: () => 2 } }) });
    getAutocomplete()?.emitSelect({ toPlace: () => ({ fetchFields: fetchB, location: { lat: () => 3, lng: () => 4 } }) });
    resolveB();
    await waitFor(() => expect(onLocationSelect).toHaveBeenCalledWith({ lat: 3, lng: 4 }));
    await act(async () => {
      if (outcome === "resolve") resolveA();
      else rejectA(new Error("stale"));
    });
    expect(onLocationSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not mount a late Places library after search closes", async () => {
    const {PlaceAutocompleteElement} = setupAutocomplete();
    let resolveLibrary!: (library: {PlaceAutocompleteElement: typeof PlaceAutocompleteElement}) => void;
    loader.loadGooglePlacesLibrary.mockImplementationOnce(() => new Promise(resolve => {resolveLibrary = resolve;}));
    render(<GoogleLocationSearch apiKey="places-key" onLocationSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name:"Search location"}));
    fireEvent.click(screen.getByRole("button", {name:"Close location search"}));
    await act(async () => {resolveLibrary({PlaceAutocompleteElement});});
    expect(PlaceAutocompleteElement).not.toHaveBeenCalled();
    expect(screen.queryByTestId("google-location-search")).not.toBeInTheDocument();
  });

  it("ignores pending location results after unmount", async () => {
    const {getAutocomplete} = setupAutocomplete();
    const onLocationSelect = vi.fn();
    const {unmount} = render(<GoogleLocationSearch apiKey="places-key" onLocationSelect={onLocationSelect} />);
    fireEvent.click(screen.getByRole("button", {name:"Search location"}));
    await waitFor(() => expect(getAutocomplete()).toBeTruthy());
    let resolveFields!: () => void;
    const fetchFields = () => new Promise<void>(resolve => {resolveFields = resolve;});
    act(() => getAutocomplete()?.emitSelect({toPlace: () => ({fetchFields,location:{lat:()=>1,lng:()=>2}})}));
    unmount();
    await act(async () => {resolveFields();});
    expect(onLocationSelect).not.toHaveBeenCalled();
  });

  it("shows a provider error for retry and recovers focus after close", async () => {
    const { getAutocomplete } = setupAutocomplete();
    render(<GoogleLocationSearch apiKey="places-key" onLocationSelect={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Search location" });
    fireEvent.click(trigger);
    await waitFor(() => expect(getAutocomplete()).toBeTruthy());
    getAutocomplete()?.emitError();
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close location search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Search location" })).toHaveFocus());
  });
});
