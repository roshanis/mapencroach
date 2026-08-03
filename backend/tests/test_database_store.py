"""DatabaseStore persistence semantics.

The parametrized API suite proves behavioural parity with the in-memory
store; these tests prove what only a persistent store can: state
survives process restart (a fresh store over the same engine), the
audit chain persists and still verifies, and the jurisdiction hierarchy
is deployment-configurable data rather than a hardcoded enum.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from mapencroach.audit.chain import verify_chain
from mapencroach.db import models
from mapencroach.db.store import (
    DatabaseStore,
    database_is_empty,
    init_db,
    jurisdiction_levels,
    seed_demo_database,
)
from mapencroach.domain.case_engine import CaseState, InvalidTransition


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    init_db(engine)
    seed_demo_database(engine)
    return engine


@pytest.fixture
def store(engine) -> DatabaseStore:
    return DatabaseStore(engine)


class TestRestartSurvival:
    def test_mutations_survive_a_fresh_store_instance(self, engine, store):
        store.set_boundary_grade("parcel-3", "A")
        store.add_parcel_tag("parcel-3", "survey-complete")

        reborn = DatabaseStore(engine)
        parcel = reborn.parcels["parcel-3"]
        assert parcel["boundary_grade"] == "A"
        assert "survey-complete" in parcel["tags"]

    def test_alerts_survive_restart(self, engine, store):
        alert_id = store.next_alert_id()
        store.save_alert(
            {
                "id": alert_id,
                "parcel_id": "parcel-2",
                "tier": "AMBER",
                "severity_score": 12.0,
                "area_m2": 900.0,
                "status": "OPEN",
                "detected_at": datetime(2026, 6, 1, tzinfo=UTC).isoformat(),
            }
        )
        reborn = DatabaseStore(engine)
        alert = reborn.alerts[alert_id]
        assert alert["tier"] == "AMBER"
        assert alert["detected_at"] == "2026-06-01T00:00:00+00:00"

    def test_case_transitions_survive_restart(self, engine, store):
        record, event = store.transition_case(
            "case-1",
            CaseState.RESPONSE_WINDOW,
            actor="officer-1",
            occurred_at=datetime(2026, 5, 1, tzinfo=UTC),
            artifacts={},
            note="response window opened",
        )
        assert event.to_state is CaseState.RESPONSE_WINDOW

        reborn = DatabaseStore(engine)
        case = reborn.cases["case-1"].case
        assert case.state is CaseState.RESPONSE_WINDOW
        assert case.events[-1].note == "response window opened"
        assert case.events[-1].occurred_at == datetime(2026, 5, 1, tzinfo=UTC)

    def test_audit_chain_survives_restart_and_verifies(self, engine, store):
        store.record_audit(
            actor="officer-1", action="alert.create", object_type="alert", object_id="x"
        )
        reborn = DatabaseStore(engine)
        chain = reborn.audit_chain
        assert chain[-1].payload["action"] == "alert.create"
        assert verify_chain(chain).ok

    def test_tampering_with_a_persisted_row_breaks_verification(self, engine, store):
        with Session(engine) as session:
            row = session.execute(select(models.AuditLog).limit(1)).scalar_one()
            row.payload = row.payload.replace("system", "someone-else")
            session.commit()
        assert not verify_chain(DatabaseStore(engine).audit_chain).ok


class TestCaseEngineIntegrity:
    def test_illegal_transition_persists_nothing(self, engine, store):
        before = len(store.cases["case-2"].case.events)  # CLOSED — terminal
        with pytest.raises(InvalidTransition):
            store.transition_case(
                "case-2",
                CaseState.TRIAGED,
                actor="officer-1",
                occurred_at=datetime.now(UTC),
                artifacts={"triage_note": "x"},
                note="",
            )
        assert len(DatabaseStore(engine).cases["case-2"].case.events) == before

    def test_paused_case_hydrates_with_its_return_point(self, store):
        case = store.cases["case-3"].case  # stayed by court at SHOW_CAUSE_ISSUED
        assert case.state is CaseState.STAYED_BY_COURT
        assert case.paused_state is CaseState.SHOW_CAUSE_ISSUED


class TestSeeding:
    def test_seed_matches_in_memory_demo(self, store):
        assert len(store.parcels) == 30
        assert len(store.alerts) == 10
        assert len(store.cases) == 5
        assert store.root_jurisdiction_id == "state"
        assert store.district_a_id == "dist-a"
        assert store.district_b_id == "dist-b"

    def test_database_is_empty_predicate(self):
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        init_db(engine)
        assert database_is_empty(engine)
        seed_demo_database(engine)
        assert not database_is_empty(engine)

    def test_context_snapshot_round_trips(self, store):
        context = store.context_for_parcel("parcel-1").to_dict()
        assert context["observations"], "seeded context observations must hydrate"
        assert {alias["scheme"] for alias in context["aliases"]} == {"survey_no", "ULPIN"}
        # A parcel without a snapshot still gets identifier aliases.
        bare = store.context_for_parcel("parcel-2").to_dict()
        assert bare["observations"] == []
        assert bare["aliases"]


class TestJurisdictionLevels:
    def test_default_levels_are_revenue_hierarchy(self, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_JURISDICTION_LEVELS", raising=False)
        assert jurisdiction_levels() == ["state", "district", "taluk", "village"]

    def test_development_authority_hierarchy_is_configurable(self, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_JURISDICTION_LEVELS", "authority,zone,ward")
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        init_db(engine)
        seed_demo_database(engine)
        with Session(engine) as session:
            levels = {
                row.name: row.depth
                for row in session.execute(select(models.JurisdictionLevel)).scalars()
            }
            root = session.get(models.Jurisdiction, "state")
            leaf = session.get(models.Jurisdiction, "taluk-b1")
        assert levels == {"authority": 0, "zone": 1, "ward": 2}
        assert root.level == "authority"
        assert leaf.level == "ward"
