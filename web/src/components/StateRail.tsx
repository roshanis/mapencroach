import { STATE_DESCRIPTIONS } from "@/lib/explanations";
import {
  CASE_STATE_CHAIN,
  PAUSED_STATES,
  SPECIAL_STATE_LABELS,
  STATE_LABELS,
  type AnyCaseState,
  type CaseEvent,
  type SpecialCaseState,
} from "@/lib/types";

export interface StateRailProps {
  currentState: AnyCaseState;
  /**
   * The case's event history. When `currentState` is a paused special state
   * (SURVEY_REQUESTED/STAYED_BY_COURT), this is used to find the last
   * on-chain step reached before the pause, so the rail can show that
   * progress instead of resetting every step to not-done — matching the
   * banner's promise that "the chain resumes where it stopped".
   */
  events?: CaseEvent[];
}

function isSpecialState(state: AnyCaseState): state is SpecialCaseState {
  return state in SPECIAL_STATE_LABELS;
}

/** The most recent chain step the event history actually reached, in order —
 * i.e. the step a paused case will resume from. */
function lastChainStateReached(
  events: CaseEvent[] | undefined
): (typeof CASE_STATE_CHAIN)[number] | undefined {
  if (!events) return undefined;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const { to_state } = events[i];
    if ((CASE_STATE_CHAIN as string[]).includes(to_state)) return to_state;
  }
  return undefined;
}

export function StateRail({ currentState, events }: StateRailProps) {
  const special = isSpecialState(currentState);
  const resumeState = special ? lastChainStateReached(events) : undefined;
  const currentIndex = special
    ? resumeState
      ? CASE_STATE_CHAIN.indexOf(resumeState)
      : -1
    : CASE_STATE_CHAIN.indexOf(currentState);

  return (
    <div className="flex flex-col gap-4">
      {special && (
        <div
          data-testid="state-rail-special-banner"
          className={
            PAUSED_STATES.has(currentState)
              ? "rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              : "rounded border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700"
          }
        >
          {PAUSED_STATES.has(currentState) ? (
            <>
              This case is paused: {SPECIAL_STATE_LABELS[currentState]}. The
              chain resumes where it stopped.
            </>
          ) : (
            <>{SPECIAL_STATE_LABELS[currentState]}</>
          )}
        </div>
      )}
      <ol
        data-testid="state-rail"
        className="flex items-start gap-0 overflow-x-auto pb-2"
      >
        {CASE_STATE_CHAIN.map((state, index) => {
          const isCurrent = !special && state === currentState;
          // For a paused case there is no "current" chain step (the pause
          // target is off-chain) — everything up to and including the step
          // reached before pausing counts as done, showing the progress the
          // banner promises is preserved.
          const isDone = special
            ? index <= currentIndex
            : index < currentIndex;
          return (
            <li
              key={state}
              data-testid="state-rail-step"
              data-state={state}
              data-current={isCurrent}
              className="flex shrink-0 items-start"
            >
              <div
                className="flex w-[5.5rem] shrink-0 flex-col items-center gap-1.5 text-center"
                title={STATE_DESCRIPTIONS[state]}
              >
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
                  className={`line-clamp-2 break-words text-[11px] leading-tight ${
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
                  className={`mt-3 h-px w-6 shrink-0 ${
                    isDone ? "bg-gov/40" : "bg-gray-300"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
