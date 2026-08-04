import {
  LAND_CATEGORY_COLORS,
  LAND_CATEGORY_LABELS,
  TIER_COLORS,
  type LandCategory,
} from "@/lib/types";

export interface MapLegendProps {
  categories: LandCategory[];
  h3Visible?: boolean;
}

const TIER_DOTS: { label: string; color: string }[] = [
  { label: "Red", color: TIER_COLORS.red },
  { label: "Amber", color: TIER_COLORS.amber },
  { label: "Green", color: TIER_COLORS.green },
  { label: "Legacy", color: TIER_COLORS.legacy },
];

export function MapLegend({ categories, h3Visible = false }: MapLegendProps) {
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
      {h3Visible ? (
        <div className="border-t border-gray-200 pt-2">
          <div className="flex items-start gap-2">
            <span
              aria-hidden
              className="mt-0.5 inline-block h-3 w-3 shrink-0 border-2 border-cyan-700 bg-cyan-100/60"
              style={{
                clipPath: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
              }}
            />
            <span className="leading-4 text-gray-700">
              H3 analytical cells
              <span className="block text-[10px] text-gray-500">Not parcel boundaries</span>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
