import type { AlertTier } from "@/lib/types";

const TIER_LABELS: Record<AlertTier, string> = {
  green: "Green",
  amber: "Amber",
  red: "Red",
  legacy: "Legacy",
};

const TIER_CLASSES: Record<AlertTier, string> = {
  green: "bg-tier-green/10 text-tier-green ring-tier-green/30",
  amber: "bg-tier-amber/10 text-tier-amber ring-tier-amber/30",
  red: "bg-tier-red/10 text-tier-red ring-tier-red/30",
  legacy: "bg-tier-legacy/10 text-tier-legacy ring-tier-legacy/30",
};

export interface TierChipProps {
  tier: AlertTier;
}

export function TierChip({ tier }: TierChipProps) {
  return (
    <span
      data-testid="tier-chip"
      data-tier={tier}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TIER_CLASSES[tier]}`}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}
