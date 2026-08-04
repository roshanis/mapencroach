"use client";

export type H3Resolution = 9 | 10 | 11;

export interface H3GridControlProps {
  visible: boolean;
  resolution: H3Resolution;
  cellCount: number;
  warning?: string;
  onVisibleChange: (visible: boolean) => void;
  onResolutionChange: (resolution: H3Resolution) => void;
}

const RESOLUTIONS: H3Resolution[] = [9, 10, 11];

export function H3GridControl({
  visible,
  resolution,
  cellCount,
  warning,
  onVisibleChange,
  onResolutionChange,
}: H3GridControlProps) {
  return (
    <section
      data-testid="h3-grid-control"
      className="w-52 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs shadow-md backdrop-blur-sm"
    >
      <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-900">
        <input
          type="checkbox"
          checked={visible}
          onChange={(event) => onVisibleChange(event.target.checked)}
          className="h-4 w-4 accent-gov"
        />
        H3 analytical grid
      </label>

      <label className="mt-2 flex items-center justify-between gap-3 text-slate-600">
        Resolution
        <select
          aria-label="H3 resolution"
          value={resolution}
          disabled={!visible}
          onChange={(event) =>
            onResolutionChange(Number(event.target.value) as H3Resolution)
          }
          className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {RESOLUTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      {visible ? <p className="mt-2 font-medium text-slate-700">{cellCount} cells</p> : null}
      <p className="mt-1 leading-4 text-slate-500">
        Analytical context only — not a parcel boundary.
      </p>
      {warning ? (
        <p role="status" className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-amber-900">
          {warning}
        </p>
      ) : null}
    </section>
  );
}
