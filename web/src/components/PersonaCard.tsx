import { jurisdictionLabel, roleLabel } from "@/lib/format";
import type { Persona } from "@/lib/api";

export interface PersonaCardProps {
  persona: Persona;
  totalParcels?: number;
  isActive: boolean;
  onViewAs?: (id: string) => void;
}

export function PersonaCard({
  persona,
  totalParcels,
  isActive,
  onViewAs,
}: PersonaCardProps) {
  const visible = persona.visible_parcels ?? 0;
  const total = totalParcels && totalParcels > 0 ? totalParcels : visible;
  const pct = total > 0 ? Math.min(100, (visible / total) * 100) : 0;

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-5 shadow-sm${
        isActive ? " ring-2 ring-gov" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{persona.name}</p>
          <p className="mt-1 text-xs text-gray-500">
            {jurisdictionLabel(persona.jurisdiction_id, persona.jurisdiction_name)}
          </p>
        </div>
        <span className="rounded-full bg-gov/10 px-2.5 py-0.5 text-xs text-gov ring-1 ring-inset ring-gov/30">
          {roleLabel(persona.role)}
        </span>
      </div>

      <p className="mt-3 text-sm text-gray-600">{persona.description}</p>

      {typeof persona.visible_parcels === "number" && (
        <div className="mt-4">
          <p className="text-xs text-gray-600">
            Sees <span className="font-bold">{visible}</span> of{" "}
            <span className="font-bold">{total}</span> parcels
          </p>
          <div
            data-testid="persona-visibility-bar-track"
            className="mt-1 h-1.5 w-full rounded bg-gray-200"
          >
            <div
              className="h-1.5 rounded bg-gov"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {persona.capabilities && persona.capabilities.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1">
          {persona.capabilities.map((capability) => {
            const isNegative = capability.startsWith("Cannot");
            return (
              <li
                key={capability}
                data-testid="persona-capability-row"
                className="flex items-start gap-1.5 text-xs"
              >
                <span
                  className={isNegative ? "text-gray-400" : "text-green-600"}
                >
                  {isNegative ? "✕" : "✓"}
                </span>
                <span className={isNegative ? "text-gray-400" : "text-gray-600"}>
                  {capability}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        data-testid={`persona-view-as-${persona.id}`}
        disabled={!onViewAs}
        title={
          onViewAs ? undefined : "Connect the demo backend to switch personas"
        }
        onClick={() => onViewAs?.(persona.id)}
        className="mt-4 rounded bg-gov px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        View as
      </button>
    </div>
  );
}
