import {
  LAND_CATEGORY_COLORS,
  LAND_CATEGORY_LABELS,
  type LandCategory,
} from "@/lib/types";
import { HOTSPOT_AMBER_COLOR, HOTSPOT_RED_COLOR } from "./map-types";

export interface MapLegendProps {
  categories: LandCategory[];
}

const TIER_DOTS: { label: string; color: string }[] = [
  { label: "Red", color: "#c4321f" },
  { label: "Amber", color: "#c98a12" },
  { label: "Green", color: "#1e8f4e" },
  { label: "Legacy", color: "#7b3fa0" },
];

const HOTSPOT_DOTS: { label: string; color: string }[] = [
  { label: "Elevated alerts", color: HOTSPOT_AMBER_COLOR },
  { label: "Red alerts present", color: HOTSPOT_RED_COLOR },
];

export function MapLegend({ categories }: MapLegendProps) {
  const distinctCategories = categories.filter(
    (category, index) => categories.indexOf(category) === index
  );

  return (
    <div
      data-testid="map-legend"
      className="flex flex-col gap-2 rounded bg-white/90 p-3 text-xs shadow"
    >
      <ul className="flex flex-col gap-1">
        {distinctCategories.map((category) => (
          <li
            key={category}
            data-testid="map-legend-category-row"
            className="flex items-center gap-2"
          >
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: LAND_CATEGORY_COLORS[category] }}
            />
            <span className="text-gray-700">
              {LAND_CATEGORY_LABELS[category]}
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-gray-200 pt-2">
        <ul className="flex flex-col gap-1">
          {TIER_DOTS.map((tier) => (
            <li key={tier.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: tier.color }}
              />
              <span className="text-gray-700">{tier.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-gray-200 pt-2">
        <p className="mb-1 font-semibold text-gray-500">Hotspot density</p>
        <ul className="flex flex-col gap-1">
          {HOTSPOT_DOTS.map((dot) => (
            <li key={dot.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: dot.color, opacity: 0.6 }}
              />
              <span className="text-gray-700">{dot.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
