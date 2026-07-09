export interface AllowedNextStepsProps {
  transitions: string[];
}

export function AllowedNextSteps({ transitions }: AllowedNextStepsProps) {
  return (
    <section data-testid="allowed-next-steps" className="flex flex-col gap-3">
      {transitions.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {transitions.map((transition) => (
            <li
              key={transition}
              className="rounded px-2 py-0.5 text-xs font-medium text-gov ring-1 ring-inset ring-gov/30"
            >
              {transition.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-gray-400">
        {transitions.length > 0
          ? "Enforced by the case engine — any other transition is rejected with the missing evidence named."
          : "No further transitions — this case is closed."}
      </p>
    </section>
  );
}
