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

export function isoDayBefore(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`);
  return new Date(day.getTime() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * A timeline scene backed by a date window: the component requests `endDate`
 * first and walks one day back per blank/failed load until `startDate`, at
 * which point the scene reports a coverage gap.
 */
export interface SceneWindow {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Monthly snapshot scenes for the current (UTC) year — one per completed
 * month, newest last — followed by a Latest scene that trails today by the
 * HLS publication latency. In January there are no completed months yet and
 * only Latest is returned.
 */
export function monthlyScenes(now: Date = new Date()): SceneWindow[] {
  const year = now.getUTCFullYear();
  const scenes: SceneWindow[] = [];
  for (let month = 0; month < now.getUTCMonth(); month += 1) {
    const monthNumber = String(month + 1).padStart(2, "0");
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    scenes.push({
      id: `${year}-${monthNumber}`,
      label: MONTH_LABELS[month],
      startDate: `${year}-${monthNumber}-01`,
      endDate: `${year}-${monthNumber}-${String(lastDay).padStart(2, "0")}`,
    });
  }
  scenes.push({
    id: "latest",
    label: "Latest",
    startDate: isoDateDaysAgo(LATEST_MAX_OFFSET_DAYS, now),
    endDate: isoDateDaysAgo(LATEST_START_OFFSET_DAYS, now),
  });
  return scenes;
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
