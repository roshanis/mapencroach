"""JSON snapshots for operational records; no files or application state are mutated here."""

from copy import deepcopy
from datetime import datetime
from types import MappingProxyType
from typing import Any

from mapencroach.api.store import CaseRecord, Store
from mapencroach.domain.case_engine import Case, CaseEvent, CaseState


def snapshot(store: Store) -> dict[str, Any]:
    cases = []
    for record in store.cases.values():
        case = record.case
        cases.append(
            {
                "id": case.case_id,
                "alert_id": record.alert_id,
                "parcel_id": record.parcel_id,
                "jurisdiction_id": record.jurisdiction_id,
                "state": case.state.value,
                "paused_state": case.paused_state.value if case.paused_state else None,
                "events": [
                    {
                        "from_state": e.from_state.value,
                        "to_state": e.to_state.value,
                        "actor": e.actor,
                        "artifacts": dict(e.artifacts),
                        "note": e.note,
                        "occurred_at": e.occurred_at.isoformat(),
                    }
                    for e in case.events
                ],
            }
        )
    return {
        "parcels": deepcopy(store.parcels),
        "alerts": deepcopy(store.alerts),
        "cases": cases,
        "jurisdiction_rows": list(store.jurisdiction_rows),
        "authority_ids": sorted(store.authority_ids),
        "primary_authority_id": store.primary_authority_id,
        "district_a_id": store.district_a_id,
        "district_b_id": store.district_b_id,
        "next_alert_seq": store._next_alert_seq,
        "next_case_seq": store._next_case_seq,
    }


def decode(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate before hydration, so a malformed record cannot partly replace a store."""
    if not isinstance(raw, dict):
        raise ValueError("operational state must be an object")
    for name in ("parcels", "alerts"):
        if not isinstance(raw[name], dict):
            raise ValueError(f"{name} must be an object")
        for key, record in raw[name].items():
            if not isinstance(record, dict) or record.get("id") != key:
                raise ValueError(f"invalid {name} record")
    cases = {}
    for row in raw["cases"]:
        events = [
            CaseEvent(
                from_state=CaseState(e["from_state"]),
                to_state=CaseState(e["to_state"]),
                actor=e["actor"],
                artifacts=MappingProxyType(dict(e["artifacts"])),
                note=e["note"],
                occurred_at=datetime.fromisoformat(e["occurred_at"]),
            )
            for e in row["events"]
        ]
        if any(e.occurred_at.tzinfo is None or e.occurred_at.utcoffset() is None for e in events):
            raise ValueError("case event time must include a timezone")
        if any(a.to_state != b.from_state for a, b in zip(events, events[1:], strict=False)):
            raise ValueError("case event chain is not contiguous")
        if events and events[-1].to_state.value != row["state"]:
            raise ValueError("case state disagrees with its latest event")
        case = Case(
            row["id"],
            CaseState(row["state"]),
            events,
            CaseState(row["paused_state"]) if row["paused_state"] else None,
        )
        if (
            row["id"] in cases
            or row["parcel_id"] not in raw["parcels"]
            or row["alert_id"] not in raw["alerts"]
        ):
            raise ValueError("invalid case references or duplicate case")
        cases[row["id"]] = CaseRecord(
            case=case,
            alert_id=row["alert_id"],
            parcel_id=row["parcel_id"],
            jurisdiction_id=row["jurisdiction_id"],
        )
    # Constructing the tree also validates parent/root relationships.
    from mapencroach.domain.jurisdiction import JurisdictionTree

    rows = [tuple(row) for row in raw["jurisdiction_rows"]]
    tree = JurisdictionTree(rows) if rows else None
    authorities = set(raw["authority_ids"])
    known = tree.scope_ids(tree.root_id) if tree else set()
    if not authorities <= known:
        raise ValueError("unknown authority")
    for parcel in raw["parcels"].values():
        if parcel.get("jurisdiction_id") not in known:
            raise ValueError("parcel has an unknown jurisdiction")
    for alert in raw["alerts"].values():
        if alert.get("parcel_id") not in raw["parcels"]:
            raise ValueError("alert has an unknown parcel")
    for record in cases.values():
        if record.jurisdiction_id not in known:
            raise ValueError("case has an unknown jurisdiction")
        if raw["alerts"][record.alert_id]["parcel_id"] != record.parcel_id:
            raise ValueError("case and originating alert refer to different parcels")
    for name in ("next_alert_seq", "next_case_seq"):
        if not isinstance(raw[name], int) or raw[name] < 0:
            raise ValueError("invalid ID counter")
    for collection, prefix, counter in (
        (raw["alerts"], "alert-", "next_alert_seq"),
        (cases, "case-", "next_case_seq"),
    ):
        largest = max(
            (
                int(key[len(prefix) :])
                for key in collection
                if key.startswith(prefix) and key[len(prefix) :].isdigit()
            ),
            default=0,
        )
        if raw[counter] < largest:
            raise ValueError("ID counter would reuse an existing record")
    return {
        **raw,
        "cases": cases,
        "jurisdiction_rows": rows,
        "tree": tree,
        "authority_ids": authorities,
    }


def restore(store: Store, data: dict[str, Any]) -> None:
    store.parcels = data["parcels"]
    store.alerts = data["alerts"]
    store.cases = data["cases"]
    store.jurisdiction_rows = data["jurisdiction_rows"]
    store._tree = data["tree"]
    store.authority_ids = data["authority_ids"]
    store.primary_authority_id = data["primary_authority_id"]
    store.district_a_id = data["district_a_id"]
    store.district_b_id = data["district_b_id"]
    store._next_alert_seq = data["next_alert_seq"]
    store._next_case_seq = data["next_case_seq"]
