import { BOUNDARY_GRADE_EXPLANATIONS, type BoundaryGrade } from "@/lib/types";

export interface BoundaryGradeBadgeProps {
  grade: BoundaryGrade;
  showExplanation?: boolean;
}

const GRADE_CLASSES: Record<BoundaryGrade, string> = {
  A: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  B: "bg-blue-50 text-blue-700 ring-blue-600/20",
  C: "bg-gray-100 text-gray-700 ring-gray-500/20",
};

export function BoundaryGradeBadge({
  grade,
  showExplanation = true,
}: BoundaryGradeBadgeProps) {
  return (
    <span data-testid="boundary-grade-badge" data-grade={grade} className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${GRADE_CLASSES[grade]}`}
      >
        Grade {grade}
      </span>
      {showExplanation && (
        <span className="text-xs text-gray-500">
          {BOUNDARY_GRADE_EXPLANATIONS[grade]}
        </span>
      )}
    </span>
  );
}
