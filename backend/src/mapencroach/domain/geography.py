"""Parcel identity, geographic lineage, and contextual-signal contracts.

Context records are deliberately separate from alerts and case evidence. They
can help an officer prioritize review, but cannot establish a parcel boundary,
ownership, encroachment, or any other enforcement fact.
"""

from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from typing import Any

CONTEXT_DISCLAIMER = (
    "Contextual signals support prioritization only. They are not enforcement evidence "
    "and do not establish parcel ownership, boundaries, or encroachment."
)


def _validate_confidence(confidence: float) -> None:
    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between zero and one")


def _validate_dates(valid_from: date | None, valid_to: date | None) -> None:
    if valid_from is not None and valid_to is not None and valid_to < valid_from:
        raise ValueError("valid_to cannot be earlier than valid_from")


def _date_value(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


class LineageRelation(StrEnum):
    """A relationship expressed from the current parcel to an earlier parcel."""

    SPLIT_FROM = "split_from"
    MERGED_FROM = "merged_from"
    RENUMBERED_FROM = "renumbered_from"


@dataclass(frozen=True)
class ParcelAlias:
    scheme: str
    value: str
    source: str
    valid_from: date | None
    valid_to: date | None
    match_method: str
    confidence: float

    def __post_init__(self) -> None:
        _validate_confidence(self.confidence)
        _validate_dates(self.valid_from, self.valid_to)

    def to_dict(self) -> dict[str, Any]:
        return {
            "scheme": self.scheme,
            "value": self.value,
            "source": self.source,
            "valid_from": _date_value(self.valid_from),
            "valid_to": _date_value(self.valid_to),
            "match_method": self.match_method,
            "confidence": self.confidence,
        }


@dataclass(frozen=True)
class ParcelLineageEdge:
    related_parcel_id: str
    relation: LineageRelation
    effective_on: date | None
    source: str
    confidence: float
    current_parcel_id: str

    def __post_init__(self) -> None:
        _validate_confidence(self.confidence)
        if self.related_parcel_id == self.current_parcel_id:
            raise ValueError("a parcel lineage edge cannot link a parcel to itself")

    def to_dict(self) -> dict[str, Any]:
        return {
            "related_parcel_id": self.related_parcel_id,
            "relation": self.relation.value,
            "effective_on": _date_value(self.effective_on),
            "source": self.source,
            "confidence": self.confidence,
        }


@dataclass(frozen=True)
class ContextSource:
    id: str
    provider: str
    dataset: str
    version: str
    vintage: str
    license: str
    source_url: str
    resolution: str
    limitations: tuple[str, ...]
    is_demo: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "provider": self.provider,
            "dataset": self.dataset,
            "version": self.version,
            "vintage": self.vintage,
            "license": self.license,
            "source_url": self.source_url,
            "resolution": self.resolution,
            "limitations": list(self.limitations),
            "is_demo": self.is_demo,
        }


@dataclass(frozen=True)
class GeographicLink:
    scheme: str
    geographic_unit_id: str
    name: str
    level: str
    match_method: str
    confidence: float
    source_id: str
    context_only: bool = True

    def __post_init__(self) -> None:
        _validate_confidence(self.confidence)
        if not self.context_only:
            raise ValueError("geographic links must remain context-only")

    def to_dict(self) -> dict[str, Any]:
        return {
            "scheme": self.scheme,
            "geographic_unit_id": self.geographic_unit_id,
            "name": self.name,
            "level": self.level,
            "match_method": self.match_method,
            "confidence": self.confidence,
            "source_id": self.source_id,
            "context_only": self.context_only,
        }


@dataclass(frozen=True)
class ContextObservation:
    key: str
    label: str
    value: float | str | bool
    unit: str
    period: str
    trend: str | None
    source_id: str
    context_only: bool = True

    def __post_init__(self) -> None:
        if not self.context_only:
            raise ValueError("context observations must remain context-only")

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "value": self.value,
            "unit": self.unit,
            "period": self.period,
            "trend": self.trend,
            "source_id": self.source_id,
            "context_only": self.context_only,
        }


@dataclass(frozen=True)
class ParcelContext:
    parcel_id: str
    canonical_id: str
    aliases: tuple[ParcelAlias, ...]
    lineage: tuple[ParcelLineageEdge, ...]
    geographic_links: tuple[GeographicLink, ...]
    observations: tuple[ContextObservation, ...]
    sources: tuple[ContextSource, ...]
    classification: str = "context_only"
    disclaimer: str = CONTEXT_DISCLAIMER

    def __post_init__(self) -> None:
        if self.classification != "context_only" or self.disclaimer != CONTEXT_DISCLAIMER:
            raise ValueError("parcel context must preserve the context-only boundary")
        source_ids = {source.id for source in self.sources}
        referenced_ids = {
            *(link.source_id for link in self.geographic_links),
            *(observation.source_id for observation in self.observations),
        }
        undeclared = referenced_ids - source_ids
        if undeclared:
            raise ValueError(f"context item references undeclared source: {sorted(undeclared)}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "parcel_id": self.parcel_id,
            "canonical_id": self.canonical_id,
            "aliases": [alias.to_dict() for alias in self.aliases],
            "lineage": [edge.to_dict() for edge in self.lineage],
            "geographic_links": [link.to_dict() for link in self.geographic_links],
            "observations": [observation.to_dict() for observation in self.observations],
            "sources": [source.to_dict() for source in self.sources],
            "classification": self.classification,
            "disclaimer": self.disclaimer,
        }
