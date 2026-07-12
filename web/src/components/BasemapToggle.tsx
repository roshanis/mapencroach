export type BasemapMode = "satellite" | "streets";

export interface BasemapToggleProps {
  mode: BasemapMode;
  onChange: (mode: BasemapMode) => void;
}

const ACTIVE_CLASSES = "bg-gov text-white";
const INACTIVE_CLASSES = "text-gray-600 hover:bg-gray-100";

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
        className={`rounded px-2 py-1 font-medium ${
          mode === "satellite" ? ACTIVE_CLASSES : INACTIVE_CLASSES
        }`}
      >
        Satellite
      </button>
      <button
        type="button"
        data-testid="basemap-streets"
        onClick={() => onChange("streets")}
        className={`rounded px-2 py-1 font-medium ${
          mode === "streets" ? ACTIVE_CLASSES : INACTIVE_CLASSES
        }`}
      >
        Streets
      </button>
    </div>
  );
}
