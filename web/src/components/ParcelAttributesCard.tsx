import { BoundaryGradeBadge } from "./BoundaryGradeBadge";
import type { Parcel } from "@/lib/types";
import { jurisdictionLabel } from "@/lib/format";

export interface ParcelAttributesCardProps {
  parcel: Parcel;
}

const LAND_CATEGORY_LABELS: Record<Parcel["land_category"], string> = {
  waterbody: "Waterbody",
  forest: "Forest",
  revenue: "Revenue Land",
  municipal: "Municipal",
  agricultural: "Agricultural",
  grazing: "Grazing (Gauchar)",
  irrigation: "Irrigation",
  housing: "Housing",
  industrial: "Industrial",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="text-sm font-medium text-gray-900">{value}</dd>
    </div>
  );
}

export function ParcelAttributesCard({ parcel }: ParcelAttributesCardProps) {
  return (
    <section
      data-testid="parcel-attributes-card"
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
    >
      <h2 className="mb-4 text-base font-semibold text-gray-900">
        Parcel Attributes
      </h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Parcel ID" value={parcel.id} />
        <Field label="Survey No." value={parcel.survey_no} />
        <Field label="ULPIN" value={parcel.ulpin} />
        <Field label="Owning Department" value={parcel.owning_department} />
        <Field
          label="Land Category"
          value={LAND_CATEGORY_LABELS[parcel.land_category]}
        />
        <Field
          label="Jurisdiction"
          value={jurisdictionLabel(parcel.jurisdiction_id, parcel.jurisdiction_name)}
        />
      </dl>
      <div className="mt-4 border-t border-gray-100 pt-4">
        <dt className="mb-1 text-xs uppercase tracking-wide text-gray-500">
          Boundary Grade
        </dt>
        <BoundaryGradeBadge grade={parcel.boundary_grade} />
      </div>
    </section>
  );
}
