import {
  PAUSED_STATES,
  SPECIAL_STATE_LABELS,
  STATE_LABELS,
  TERMINAL_STATES,
  type AnyCaseState,
  type SpecialCaseState,
} from "@/lib/types";

export interface CaseStateChipProps {
  state: AnyCaseState;
}

type Family = "active" | "paused" | "terminal";

function isSpecialState(state: AnyCaseState): state is SpecialCaseState {
  return state in SPECIAL_STATE_LABELS;
}

function familyOf(state: AnyCaseState): Family {
  if (PAUSED_STATES.has(state)) return "paused";
  if (TERMINAL_STATES.has(state)) return "terminal";
  return "active";
}

const FAMILY_CLASSES: Record<Family, string> = {
  active: "bg-gov/10 text-gov ring-gov/30",
  paused: "bg-amber-50 text-amber-800 ring-amber-600/30",
  terminal: "bg-gray-100 text-gray-600 ring-gray-400/30",
};

const PAUSED_TITLE =
  "The forward chain is frozen; it resumes exactly where it stopped.";

export function CaseStateChip({ state }: CaseStateChipProps) {
  const family = familyOf(state);
  const label = isSpecialState(state) ? SPECIAL_STATE_LABELS[state] : STATE_LABELS[state];

  return (
    <span
      data-testid="case-state-chip"
      data-family={family}
      title={family === "paused" ? PAUSED_TITLE : undefined}
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${FAMILY_CLASSES[family]}`}
    >
      {label}
    </span>
  );
}
