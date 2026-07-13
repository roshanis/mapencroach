import { PersonaSwitcher } from "./PersonaSwitcher";

export interface TopBarProps {
  jurisdiction?: string;
}

export function TopBar({ jurisdiction = "All Jurisdictions" }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-gov px-4 text-white">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-wide">
          mapencroach
        </span>
        <span className="text-xs text-white/70">
          Encroachment Monitoring Console
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div
          data-testid="jurisdiction-placeholder"
          className="rounded border border-white/30 px-3 py-1 text-xs text-white/90"
        >
          {jurisdiction}
        </div>
        <PersonaSwitcher />
      </div>
    </header>
  );
}
