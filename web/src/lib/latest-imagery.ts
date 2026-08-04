// Support for the imagery timeline's "Latest" scene: NASA GIBS serves the
// Harmonized Landsat Sentinel-2 (HLS S30) layer at 30 m within a few days of
// capture, but a given date only has a tile over a given parcel when a
// satellite actually passed — a missing date comes back as a valid, fully
// transparent/blank image rather than an HTTP error. So the timeline starts a
// few days back (publication latency) and steps one day further into the past
// per blank or failed load until it finds a real pass or gives up.

export const LATEST_IMAGERY_LAYER = "HLS_S30_Nadir_BRDF_Adjusted_Reflectance";

/** HLS granules publish ~2-4 days after capture; start the search there. */
export const LATEST_START_OFFSET_DAYS = 4;

/**
 * How far past the start offset the search may walk. Sentinel-2 revisits
 * Haridwar every ~5 days, so ~3 revisit cycles of lookback means an exhausted
 * search is a genuine coverage/cloud gap, not bad luck.
 */
export const LATEST_MAX_OFFSET_DAYS = 20;

export function isoDateDaysAgo(daysAgo: number, now: Date = new Date()): string {
  const then = new Date(now.getTime() - daysAgo * 86_400_000);
  return then.toISOString().slice(0, 10);
}

/**
 * True when a sampled RGBA buffer is effectively empty: almost no pixels that
 * are both opaque and non-black. GIBS renders "no data" as transparent (PNG)
 * or black (JPEG), so either signature means no pass on that date.
 */
export function isMostlyBlank(
  rgba: Uint8ClampedArray,
  minUsableFraction = 0.02
): boolean {
  const pixelCount = rgba.length / 4;
  if (pixelCount === 0) return true;
  let usable = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    if (a > 16 && r + g + b > 24) usable += 1;
  }
  return usable / pixelCount < minUsableFraction;
}

/**
 * Samples a loaded image at low resolution and reports whether it is blank.
 * Returns null when the pixels cannot be read (canvas unsupported, or the
 * image is CORS-tainted) — callers should then accept the image as-is rather
 * than discard a scene they cannot verify.
 */
export function sampleImageBlankness(image: HTMLImageElement): boolean | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    return isMostlyBlank(data);
  } catch {
    return null;
  }
}
