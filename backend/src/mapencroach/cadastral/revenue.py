"""Khasra (revenue cadastre) linkage between Bhulekh RoR extracts and parcels.

Uttarakhand's record-of-rights (RoR) data comes from Bhulekh as flat tabular
rows keyed by khasra number and village code, not as geometry. A khasra
number is administrative, not geometric: khasras get renumbered during
consolidation, villages merge or split, and the same khasra number recurs
across villages by coincidence. Treating a khasra-number match as equivalent
to a surveyed parcel identity would let a coincidental collision silently
misattribute a case to the wrong plot -- worse than no link at all. So, as
with domain.geography.ParcelAlias, every khasra match here carries its own
match_method and confidence rather than being folded into a plain identity
equality:

- ``khasra_exact_village_match`` (0.95): the khasra number matches a parcel's
  survey number *and* the RoR row's village code matches the parcel's
  jurisdiction. This is the strong case -- both the plot number and its
  containing village line up.
- ``khasra_number_only`` (0.6): the khasra number matches a survey number but
  the village code does not. This is exactly the renumbering/merger scenario:
  worth surfacing to an officer, not worth trusting as fact.
- Ambiguous matches (a khasra number matching more than one parcel at the
  same confidence tier) are never resolved by guessing. They are reported
  separately so a human can adjudicate -- in practice by moving the
  associated case into the SURVEY_REQUESTED state (see domain.case_engine)
  to request a fresh field survey rather than trusting the paper record.

DPDP Act data minimization: owner/occupant names on an RoR extract are
Restricted-class personal data. ``load_ror_csv`` computes only
``has_recorded_occupants`` and ``occupant_count`` from the ``occupant_names``
column by default and drops the names themselves before they ever reach a
``RorRecord``. Names are retained on the record only when the caller passes
``include_personal=True`` -- the same explicit-opt-in gate that
context.shrug uses for official rows, so that propagating personal data is
always a deliberate choice made by the caller, never an accident of a
default.
"""

import csv
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mapencroach.domain.geography import ParcelAlias

_REQUIRED_COLUMNS = ("khasra_no", "village_code")
_OPTIONAL_COLUMNS = ("area_sq_m", "land_class", "occupant_names")

_TRAILING_DIGITS = re.compile(r"(\d+)$")


@dataclass(frozen=True)
class RorRecord:
    khasra_no: str
    village_code: str
    area_sq_m: float | None
    land_class: str | None
    has_recorded_occupants: bool
    occupant_count: int
    source_row: int
    occupant_names: tuple[str, ...] = ()


@dataclass
class RorImportResult:
    status: str
    records: list[RorRecord]
    errors: list[str]


@dataclass
class KhasraLinkResult:
    aliases: list[tuple[str, ParcelAlias]]
    unmatched: list[RorRecord]
    ambiguous: list[RorRecord]


def _rejected(errors: list[str]) -> RorImportResult:
    return RorImportResult(status="rejected", records=[], errors=errors)


def load_ror_csv(path: str | Path, *, include_personal: bool = False) -> RorImportResult:
    """Load a Bhulekh RoR extract, dropping personal data unless opted in.

    Structural errors (missing required columns, empty khasra_no or
    village_code, a khasra_no duplicated within the same village, or a
    negative area) are all collected and reject the whole batch, mirroring
    cadastral.ingestion.load_parcels.
    """
    path = Path(path)
    if not path.exists():
        return _rejected([f"file not found: {path}"])

    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))

    if not rows:
        return _rejected(["file is empty"])

    header, data_rows = rows[0], rows[1:]
    header_index = {name.strip().lower(): i for i, name in enumerate(header)}

    missing = [c for c in _REQUIRED_COLUMNS if c not in header_index]
    if missing:
        return _rejected([f"missing required column: '{c}'" for c in missing])

    def cell(row: list[str], column: str) -> str:
        idx = header_index.get(column)
        if idx is None or idx >= len(row):
            return ""
        return row[idx].strip()

    errors: list[str] = []
    records: list[RorRecord] = []
    seen: dict[tuple[str, str], int] = {}

    for offset, row in enumerate(data_rows, start=2):
        khasra_no = cell(row, "khasra_no")
        village_code = cell(row, "village_code")

        if not khasra_no:
            errors.append(f"row {offset}: khasra_no is empty")
            continue
        if not village_code:
            errors.append(f"row {offset}: village_code is empty")
            continue

        key = (village_code, khasra_no)
        if key in seen:
            errors.append(
                f"row {offset}: duplicate khasra_no '{khasra_no}' in village "
                f"'{village_code}' (first seen at row {seen[key]})"
            )
        else:
            seen[key] = offset

        area_sq_m: float | None = None
        area_raw = cell(row, "area_sq_m") if "area_sq_m" in header_index else ""
        if area_raw:
            try:
                area_sq_m = float(area_raw)
            except ValueError:
                errors.append(f"row {offset}: area_sq_m '{area_raw}' is not a number")
            else:
                if area_sq_m < 0:
                    errors.append(f"row {offset}: area_sq_m cannot be negative ({area_sq_m})")

        land_class = cell(row, "land_class") or None if "land_class" in header_index else None

        occupant_raw = cell(row, "occupant_names") if "occupant_names" in header_index else ""
        names = tuple(n.strip() for n in occupant_raw.split(";") if n.strip())

        records.append(
            RorRecord(
                khasra_no=khasra_no,
                village_code=village_code,
                area_sq_m=area_sq_m,
                land_class=land_class,
                has_recorded_occupants=bool(names),
                occupant_count=len(names),
                source_row=offset,
                occupant_names=names if include_personal else (),
            )
        )

    if errors:
        return _rejected(errors)

    return RorImportResult(status="accepted", records=records, errors=[])


def _numeric_part(survey_no: str) -> str:
    match = _TRAILING_DIGITS.search(survey_no)
    return match.group(1) if match else survey_no


def link_khasra(
    records: Iterable[RorRecord],
    parcels: Iterable[Mapping[str, Any]],
    *,
    source: str,
) -> KhasraLinkResult:
    """Match RoR khasra rows to parcels by survey number and village.

    ``parcels`` is an iterable of dicts shaped like api.store.parcels
    values, with at least "id", "survey_no", and "jurisdiction_id" keys.
    A khasra_no is compared against both the parcel's full survey_no
    (e.g. "SN-101") and its trailing numeric part ("101").
    """
    parcel_list = list(parcels)
    aliases: list[tuple[str, ParcelAlias]] = []
    unmatched: list[RorRecord] = []
    ambiguous: list[RorRecord] = []

    for record in records:
        exact_matches = []
        number_only_matches = []
        for parcel in parcel_list:
            survey_no = str(parcel.get("survey_no", ""))
            if record.khasra_no != survey_no and record.khasra_no != _numeric_part(survey_no):
                continue
            if record.village_code == parcel.get("jurisdiction_id"):
                exact_matches.append(parcel)
            else:
                number_only_matches.append(parcel)

        if len(exact_matches) > 1:
            ambiguous.append(record)
            continue

        if exact_matches:
            parcel = exact_matches[0]
            aliases.append(
                (
                    parcel["id"],
                    ParcelAlias(
                        scheme="khasra",
                        value=record.khasra_no,
                        source=source,
                        valid_from=None,
                        valid_to=None,
                        match_method="khasra_exact_village_match",
                        confidence=0.95,
                    ),
                )
            )
            continue

        if len(number_only_matches) > 1:
            ambiguous.append(record)
            continue

        if number_only_matches:
            parcel = number_only_matches[0]
            aliases.append(
                (
                    parcel["id"],
                    ParcelAlias(
                        scheme="khasra",
                        value=record.khasra_no,
                        source=source,
                        valid_from=None,
                        valid_to=None,
                        match_method="khasra_number_only",
                        confidence=0.6,
                    ),
                )
            )
            continue

        unmatched.append(record)

    return KhasraLinkResult(aliases=aliases, unmatched=unmatched, ambiguous=ambiguous)
