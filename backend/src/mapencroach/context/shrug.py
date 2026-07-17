"""Small, reviewable boundary for user-supplied SHRUG-compatible rows.

This module does not download or bundle Development Data Lab data. Callers must
review redistribution terms before importing official rows. Demo manifests are
explicitly illustrative and do not claim to contain SHRUG observations.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from mapencroach.domain.geography import (
    ContextObservation,
    ContextSource,
    GeographicLink,
)


@dataclass(frozen=True)
class ShrugImportManifest:
    source_id: str
    module: str
    version: str
    vintage: str
    license: str
    source_url: str
    resolution: str
    limitations: tuple[str, ...]
    redistribution_reviewed: bool
    is_demo: bool

    @classmethod
    def demo(cls, *, source_id: str, module: str, version: str) -> "ShrugImportManifest":
        return cls(
            source_id=source_id,
            module=module,
            version=version,
            vintage="Illustrative demo period",
            license="Illustrative data generated for this demo; no SHRUG data redistributed",
            source_url="https://docs.devdatalab.org/",
            resolution="Fictional SHRUG-compatible village/town unit",
            limitations=(
                "Illustrative values only; not sourced from Development Data Lab.",
                "Not a parcel measurement and not enforcement evidence.",
            ),
            redistribution_reviewed=False,
            is_demo=True,
        )

    def to_source(self) -> ContextSource:
        return ContextSource(
            id=self.source_id,
            provider="mapencroach demo" if self.is_demo else "Development Data Lab",
            dataset=self.module,
            version=self.version,
            vintage=self.vintage,
            license=self.license,
            source_url=self.source_url,
            resolution=self.resolution,
            limitations=self.limitations,
            is_demo=self.is_demo,
        )


@dataclass(frozen=True)
class ShrugObservationImport:
    parcel_id: str
    geographic_unit_id: str
    source: ContextSource
    observations: tuple[ContextObservation, ...]


def _require_review(manifest: ShrugImportManifest) -> None:
    if not manifest.is_demo and not manifest.redistribution_reviewed:
        raise ValueError("official SHRUG rows require an explicit redistribution review")


def build_shrug_geographic_link(
    *,
    row: Mapping[str, Any],
    match_method: str,
    confidence: float,
    manifest: ShrugImportManifest,
) -> GeographicLink:
    """Build a provenance-bearing context link from one SHRUG-compatible row."""
    _require_review(manifest)
    geographic_unit_id = str(row.get("shrid2", "")).strip()
    if not geographic_unit_id:
        raise ValueError("SHRUG-compatible rows must include shrid2")
    name = str(row.get("village_name") or row.get("town_name") or geographic_unit_id)
    return GeographicLink(
        scheme="SHRUG_SHRID2",
        geographic_unit_id=geographic_unit_id,
        name=name,
        level="village_or_town",
        match_method=match_method,
        confidence=confidence,
        source_id=manifest.source_id,
    )


def import_shrug_observations(
    *,
    parcel_id: str,
    geographic_unit_id: str,
    rows: Iterable[Mapping[str, Any]],
    indicator_key: str,
    label: str,
    unit: str,
    period_field: str,
    manifest: ShrugImportManifest,
) -> ShrugObservationImport:
    """Import one indicator, filtering rows to the parcel's linked SHRUG id."""
    _require_review(manifest)
    observations = tuple(
        ContextObservation(
            key=indicator_key,
            label=label,
            value=row[indicator_key],
            unit=unit,
            period=str(row[period_field]),
            trend=None,
            source_id=manifest.source_id,
        )
        for row in rows
        if str(row.get("shrid2", "")) == geographic_unit_id
        and indicator_key in row
        and period_field in row
    )
    return ShrugObservationImport(
        parcel_id=parcel_id,
        geographic_unit_id=geographic_unit_id,
        source=manifest.to_source(),
        observations=observations,
    )
