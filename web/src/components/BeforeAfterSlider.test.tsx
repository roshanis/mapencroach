import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BeforeAfterSlider } from "./BeforeAfterSlider";
import type { Scene } from "@/lib/types";

const BEFORE_SCENE: Scene = {
  scene_id: "scene-before",
  sha256: "a".repeat(64),
  cog_sha256: "b".repeat(64),
  captured_at: "2022-01-15T00:00:00Z",
  sensor: "Sentinel-2",
  resolution_m: 10,
  cloud_pct: 2,
  source: "aws-earth-search",
  href: "https://example.test/scene-before.tif",
  stac_item: { bbox: [77.0, 29.8, 77.1, 29.9], properties: {} },
  sidecar_sha256: "c".repeat(64),
};

const AFTER_SCENE: Scene = {
  ...BEFORE_SCENE,
  scene_id: "scene-after",
  captured_at: "2024-06-20T00:00:00Z",
  cloud_pct: 8,
};

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = ORIGINAL_ENV;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BeforeAfterSlider", () => {
  it("shows a placeholder when fewer than two scenes are supplied", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    render(<BeforeAfterSlider beforeScene={BEFORE_SCENE} />);

    expect(screen.getByTestId("before-after-placeholder")).toBeInTheDocument();
    expect(
      screen.getByText(/needs at least two registered scenes/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("before-after-slider")).not.toBeInTheDocument();
  });

  it("shows a placeholder when no imagery backend is configured, even with two scenes", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BeforeAfterSlider beforeScene={BEFORE_SCENE} afterScene={AFTER_SCENE} />
    );

    expect(screen.getByTestId("before-after-placeholder")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches both tiles as authenticated blobs and renders them", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      blob: async () => new Blob(["fake-png-bytes"], { type: "image/png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BeforeAfterSlider
        beforeScene={BEFORE_SCENE}
        afterScene={AFTER_SCENE}
        apiBase="https://api.example.test"
        token="tok-1"
      />
    );

    expect(screen.getByTestId("before-after-slider")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByAltText(/Before: 2022-01-15/)).toBeInTheDocument();
      expect(screen.getByAltText(/After: 2024-06-20/)).toBeInTheDocument();
    });

    // Both tile requests are authenticated and scoped to their own scene id.
    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls.some((url) => url.includes("/tiles/scene-before/"))).toBe(true);
    expect(urls.some((url) => url.includes("/tiles/scene-after/"))).toBe(true);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toEqual({ headers: { Authorization: "Bearer tok-1" } });
    }
  });

  it("shows per-tile error messaging when a tile request fails (e.g. unconfigured tile backend)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      blob: async () => new Blob([]),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BeforeAfterSlider
        beforeScene={BEFORE_SCENE}
        afterScene={AFTER_SCENE}
        apiBase="https://api.example.test"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Before tile unavailable")).toBeInTheDocument();
      expect(screen.getByText("After tile unavailable")).toBeInTheDocument();
    });
  });

  it("moves the divider when the range input changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      blob: async () => new Blob(["fake-png-bytes"], { type: "image/png" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BeforeAfterSlider
        beforeScene={BEFORE_SCENE}
        afterScene={AFTER_SCENE}
        apiBase="https://api.example.test"
      />
    );

    const slider = screen.getByRole("slider", {
      name: "Before/after comparison position",
    });
    expect(slider).toHaveValue("50");

    await waitFor(() => {
      expect(screen.getByAltText(/Before:/)).toBeInTheDocument();
    });

    fireEvent.change(slider, { target: { value: "80" } });

    expect(slider).toHaveValue("80");
  });
});
