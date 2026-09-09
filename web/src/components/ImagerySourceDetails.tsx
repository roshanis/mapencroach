import { LATEST_IMAGERY_LAYER } from "@/lib/latest-imagery";
import { BROWSE_STATUS_LABELS, type ImageryObservation } from "@/lib/imagery-view";

function utcTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Time unavailable" : parsed.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export function ImagerySourceDetails({ observation, title = "Source details" }: {
  observation: ImageryObservation;
  title?: string;
}) {
  let rows: [string, string][];
  if (observation.kind === "browse") {
    const { window, result } = observation;
    rows = [
      ["Source", "NASA GIBS · Harmonized Landsat Sentinel-2 (HLS S30)"],
      ["Product", LATEST_IMAGERY_LAYER],
      ["Requested window", `${window.startDate} to ${window.endDate}`],
      ["Requested browse date", result.requestedDate],
      ["Observation time", "Exact acquisition time unverified; the service may select a nearest available date."],
      ["Preview", BROWSE_STATUS_LABELS[result.status]],
      ["Nominal source resolution", "30 m; display pixels do not add ground detail"],
      ["Parcel quality", "Cloud cover and usable coverage over this parcel are unverified."],
      ["Retention", "External browse preview; not registered or retained as a case scene"],
    ];
  } else {
    const { attempt } = observation;
    const details = attempt.scene_details;
    rows = [
      ["Capture week", attempt.week], ["Attempted at", utcTime(attempt.attempted_at)],
      ["Scene ID", attempt.scene_id ?? "Not recorded"], ["Recorded SHA-256", attempt.sha256 ?? "Not recorded"],
    ];
    if (details?.metadata_status === "available") {
      const radar = /sentinel[- ]?1|\bsar\b/i.test(details.sensor);
      rows.push(
        ["Observation time (provider reported)", utcTime(details.captured_at)],
        ["Sensor", details.sensor], ["Source", details.source],
        ["Nominal source resolution", `${details.resolution_m} m; clip sampling/alignment unverified`],
        ["Cloud metadata", radar ? "Not applicable to SAR; radar quality is not assessed here"
          : details.cloud_pct == null ? "Unknown" : `${details.cloud_pct}% reported for the scene; parcel quality unverified`],
        ["Retention", details.retained ? "Bytes recorded as retained; retrieval and integrity checked separately" : "Bytes were not retained"],
      );
      if (details.synthetic || /demo|synthetic|fixture/i.test(details.source)) rows.push(["Data type", "Synthetic demonstration metadata"]);
    } else {
      rows.push(["Scene metadata", details?.metadata_status === "hash_mismatch"
        ? "Integrity mismatch — capture and scene hashes disagree; image withheld"
        : "Unavailable — observation time, source, and retention are not verified"]);
    }
    rows.push(["Attribution / license", "Not recorded in capture metadata; confirm with the source before reuse"]);
  }
  return (
    <details className="mt-3 min-w-0 rounded-md border border-gray-200 bg-white p-3" data-testid="imagery-source-details">
      <summary className="min-h-8 cursor-pointer text-sm font-semibold text-gov focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gov">{title}</summary>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        {rows.map(([name,value]) => <div key={name} className="min-w-0"><dt className="font-semibold text-gray-700">{name}</dt><dd className="mt-1 break-words text-gray-600 [overflow-wrap:anywhere]">{value}</dd></div>)}
      </dl>
      <p className="mt-3 text-xs text-amber-900">Screening context; source records and field verification remain necessary.</p>
    </details>
  );
}
