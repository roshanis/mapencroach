export type BasemapMode = "satellite" | "streets";

export interface BasemapToggleProps {
  mode: BasemapMode;
  onChange: (mode: BasemapMode) => void;
}

const ACTIVE_CLASSES = "bg-gov text-white";
const INACTIVE_CLASSES = "text-gray-600 hover:bg-gray-100";
// 44px is the iOS HIG tap-target floor; the text stays text-xs, only the
// button's hit area grows.
const BUTTON_CLASSES = "flex min-h-11 items-center rounded px-3 font-medium";

export function BasemapToggle({ mode, onChange }: BasemapToggleProps) {
  return (
    <div
      data-testid="basemap-toggle"
      className="flex gap-1 rounded bg-white/90 p-1 text-xs shadow"
    >
      <button
        type="button"
        data-testid="basemap-satellite"
        onClick={() => onChange("satellite")}
        className={`${BUTTON_CLASSES} ${
          mode === "satellite" ? ACTIVE_CLASSES : INACTIVE_CLASSES
        }`}
      >
        Satellite
      </button>
      <button
        type="button"
        data-testid="basemap-streets"
        onClick={() => onChange("streets")}
        className={`${BUTTON_CLASSES} ${
          mode === "streets" ? ACTIVE_CLASSES : INACTIVE_CLASSES
        }`}
      >
        Streets
      </button>
    </div>
  );
}
