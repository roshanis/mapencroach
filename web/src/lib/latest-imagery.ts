// GIBS browse-date windows are request candidates, not verified acquisition
// times. Blank-pixel sampling is a rendering heuristic, not parcel coverage,
// cloud classification, or proof that no observation exists.

export const LATEST_IMAGERY_LAYER = "HLS_S30_Nadir_BRDF_Adjusted_Reflectance";

/** HLS granules publish ~2-4 days after capture; start the search there. */
export const LATEST_START_OFFSET_DAYS = 4;

/**
 * How far past the start offset the search may walk. Sentinel-2 revisits
 * Haridwar periodically; exhausting this bounded search means only that no
 * nonblank preview was found among the requested dates.
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
 * first and walks one day back per blank preview until `startDate`.
 * Transport errors stop with a retry; they never imply a coverage gap.
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
 * or black (JPEG); this heuristic cannot identify the cause or verify the
 * observation date, clear-sky quality, or usable coverage over a parcel.
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
 * image is CORS-tainted). Callers may display the preview but must mark
 * its pixel quality unverified; null is not proof of a usable observation.
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
