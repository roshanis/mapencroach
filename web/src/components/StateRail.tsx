import { CASE_STATE_CHAIN, type CaseState } from "@/lib/types";

export interface StateRailProps {
  currentState: CaseState;
}

const STATE_LABELS: Record<CaseState, string> = {
  NEW: "New",
  TRIAGED: "Triaged",
  INSPECTION_ASSIGNED: "Inspection Assigned",
  INSPECTED: "Inspected",
  SHOW_CAUSE_ISSUED: "Show Cause Issued",
  RESPONSE_WINDOW: "Response Window",
  HEARING_SCHEDULED: "Hearing Scheduled",
  HEARING_HELD: "Hearing Held",
  ORDER_ISSUED: "Order Issued",
  ACTION_TAKEN: "Action Taken",
  CLOSED: "Closed",
};

export function StateRail({ currentState }: StateRailProps) {
  const currentIndex = CASE_STATE_CHAIN.indexOf(currentState);

  return (
    <ol
      data-testid="state-rail"
      className="flex flex-col gap-0 sm:flex-row sm:flex-wrap sm:items-start"
    >
      {CASE_STATE_CHAIN.map((state, index) => {
        const isCurrent = state === currentState;
        const isDone = index < currentIndex;
        return (
          <li
            key={state}
            data-testid="state-rail-step"
            data-state={state}
            data-current={isCurrent}
            className="flex items-center sm:flex-col sm:items-center sm:text-center"
          >
            <div className="flex items-center sm:flex-col">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ${
                  isCurrent
                    ? "bg-gov text-white ring-gov"
                    : isDone
                      ? "bg-gov/10 text-gov ring-gov/40"
                      : "bg-white text-gray-400 ring-gray-300"
                }`}
              >
                {index + 1}
              </span>
              <span
                className={`ml-2 whitespace-nowrap text-xs sm:ml-0 sm:mt-1 ${
                  isCurrent
                    ? "font-semibold text-gov"
                    : isDone
                      ? "text-gray-600"
                      : "text-gray-400"
                }`}
              >
                {STATE_LABELS[state]}
              </span>
            </div>
            {index < CASE_STATE_CHAIN.length - 1 && (
              <div
                aria-hidden
                className={`mx-2 h-4 w-px sm:mt-3 sm:h-px sm:w-8 ${
                  isDone ? "bg-gov/40" : "bg-gray-300"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
