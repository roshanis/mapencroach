"use client";

import { useId } from "react";

export interface AvailabilityItem { id: string; label: string; status: string }

/** Compact navigation with explicit text states and a native list alternative. */
export function ImageryAvailabilityTimeline({ items, selectedIds, onSelect, label }: {
  items: AvailabilityItem[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  label: string;
}) {
  const prefix = useId();
  return (
    <div role="group" aria-label={label} className="mt-4 min-w-0">
      <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-700">
        Choose {label.toLowerCase()}
        <select aria-label={`Choose ${label.toLowerCase()}`} value={selectedIds[0] ?? ""}
          disabled={items.length === 0} onChange={event => onSelect(event.target.value)}
          className="min-h-11 max-w-full rounded border border-gray-300 bg-white px-3">
          {!selectedIds[0] && <option value="">Select a date</option>}
          {items.map(item => <option key={item.id} value={item.id}>{item.label} — {item.status}</option>)}
        </select>
      </label>
      <ul className="mt-2 flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-2">
        {items.map((item, index) => (
          <li key={item.id} className="min-w-0">
            <button type="button" aria-pressed={selectedIds.includes(item.id)} aria-describedby={`${prefix}-${index}`}
              onClick={() => onSelect(item.id)} className={`min-h-11 rounded border px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gov ${selectedIds.includes(item.id) ? "border-gov bg-gov text-white" : "border-gray-300 bg-white text-gray-800"}`}>
              {item.label}
            </button>
            <p id={`${prefix}-${index}`} className="mt-1 max-w-36 text-[11px] leading-4 text-gray-600">{item.status}</p>
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-gray-600">No dates in this range.</li>}
      </ul>
    </div>
  );
}
