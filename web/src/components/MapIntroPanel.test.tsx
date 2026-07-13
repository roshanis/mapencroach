import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapIntroPanel } from "./MapIntroPanel";

const STORAGE_KEY = "mapencroach.intro.dismissed";

// Node's experimental global `localStorage` getter (added in Node >=22, the
// "--localstorage-file" warning) shadows jsdom's own window.localStorage in
// this vitest/jsdom setup, making the bare `localStorage`/`window.localStorage`
// global resolve to `undefined` instead of a working Storage. Install a small
// in-memory polyfill scoped to this test file only (no shared config touched)
// so the component under test — which uses the standard localStorage API —
// can be exercised.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

beforeAll(() => {
  if (typeof localStorage === "undefined" || localStorage === null) {
    Object.defineProperty(window, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
    });
  }
});

describe("MapIntroPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows the panel on first render with no reopen pill", async () => {
    render(<MapIntroPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("map-intro-panel")).toBeInTheDocument();
    });

    expect(screen.getByText("What am I looking at?")).toBeInTheDocument();
    expect(screen.queryByTestId("map-intro-reopen")).not.toBeInTheDocument();
  });

  it("dismisses to a pill and sets localStorage when Got it is clicked", async () => {
    render(<MapIntroPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("map-intro-panel")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("map-intro-dismiss"));

    await waitFor(() => {
      expect(screen.queryByTestId("map-intro-panel")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("map-intro-reopen")).toBeInTheDocument();
    expect(screen.getByText(/What am I looking at\?/)).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("reopens the panel and clears localStorage when the pill is clicked", async () => {
    render(<MapIntroPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("map-intro-panel")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("map-intro-dismiss"));

    await waitFor(() => {
      expect(screen.getByTestId("map-intro-reopen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("map-intro-reopen"));

    await waitFor(() => {
      expect(screen.getByTestId("map-intro-panel")).toBeInTheDocument();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("shows the pill immediately when localStorage already has the dismissed key", async () => {
    localStorage.setItem(STORAGE_KEY, "1");

    render(<MapIntroPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("map-intro-reopen")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("map-intro-panel")).not.toBeInTheDocument();
  });
});
