"""The seeded tree holds two unrelated authorities.

HRDA (Uttarakhand) and Ambalapuzha taluk in Alappuzha (Kerala) are ~2,000 km
apart and share no chain of command. They are siblings under a deployment
root rather than one nested inside the other.

Scoping is authorization here, so the interesting cases are all about the
boundary *between* authorities -- which is a boundary that did not exist
while the demo held a single authority, and which nothing in the original
test suite could have exercised.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from conftest import TEST_JWT_SECRET
from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import JURISDICTION_NAMES, Store
from mapencroach.domain.jurisdiction import JurisdictionTree

SECRET = TEST_JWT_SECRET

KERALA_PARCELS = {"parcel-31", "parcel-32", "parcel-33", "parcel-34", "parcel-35"}


def token_for(sub: str, role: Role, jurisdiction_id: str) -> str:
    return create_token(
        sub=sub,
        role=role,
        jurisdiction_id=jurisdiction_id,
        secret=SECRET,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def demo_client_for(store: Store, monkeypatch) -> TestClient:
    # Demo mode always signs with the dev default secret and refuses to
    # start next to a custom one, so drop the autouse test secret here.
    monkeypatch.delenv("MAPENCROACH_JWT_SECRET", raising=False)
    monkeypatch.setenv("MAPENCROACH_DEMO", "1")
    return TestClient(create_app(store))


@pytest.fixture
def store() -> Store:
    return Store.seed_demo()


@pytest.fixture
def client(store: Store) -> TestClient:
    return TestClient(create_app(store))


@pytest.fixture
def hrda_token() -> str:
    return token_for("hrda-officer", Role.CASE_OFFICER, "state")


@pytest.fixture
def kerala_token() -> str:
    return token_for("kl-officer", Role.CASE_OFFICER, "taluk-ambalapuzha")


class TestTreeRoot:
    def test_root_id_is_the_single_parentless_node(self):
        tree = JurisdictionTree([("r", None), ("a", "r"), ("b", "a")])
        assert tree.root_id == "r"
        assert tree.scope_ids(tree.root_id) == {"r", "a", "b"}

    def test_seeded_root_is_the_deployment_not_an_authority(self, store: Store):
        assert store.tree.root_id == "deployment"
        # The regression this guards: `primary_authority_id` reads like the
        # root but is not, and its scope silently excludes all of Kerala.
        assert store.primary_authority_id == "state"
        assert store.tree.scope_ids(store.primary_authority_id) < store.tree.scope_ids(
            store.tree.root_id
        )

    def test_every_seeded_jurisdiction_is_reachable_from_the_root(self, store: Store):
        reachable = store.tree.scope_ids(store.tree.root_id)
        assert {"state", "state-kl", "dist-alappuzha", "taluk-ambalapuzha"} <= reachable
        # Every parcel's jurisdiction resolves, or it would be invisible to
        # every possible caller.
        for parcel in store.parcels.values():
            assert parcel["jurisdiction_id"] in reachable


class TestAmbalapuzhaSeed:
    def test_taluk_hangs_off_kerala_not_hrda(self, store: Store):
        assert store.tree.is_within("state-kl", "taluk-ambalapuzha")
        assert not store.tree.is_within("state", "taluk-ambalapuzha")

    def test_five_parcels_all_in_the_taluk(self, store: Store):
        ids = {
            pid
            for pid, p in store.parcels.items()
            if p["jurisdiction_id"] == "taluk-ambalapuzha"
        }
        assert ids == KERALA_PARCELS

    def test_parcels_sit_inside_the_real_taluk_bbox(self, store: Store):
        """Ambalapuzha, not a copy of the Haridwar corridor nudged sideways."""
        for pid in KERALA_PARCELS:
            ring = store.parcels[pid]["geometry"]["coordinates"][0]
            lon = sum(pt[0] for pt in ring[:-1]) / 4
            lat = sum(pt[1] for pt in ring[:-1]) / 4
            assert 76.30 <= lon <= 76.45, (pid, lon)
            assert 9.30 <= lat <= 9.50, (pid, lat)

    def test_kerala_land_is_not_held_by_uttarakhand_departments(self, store: Store):
        for pid in KERALA_PARCELS:
            department = store.parcels[pid]["owning_department"]
            assert "Uttarakhand" not in department, (pid, department)
            assert "Haridwar" not in department, (pid, department)

    def test_ulpin_carries_the_issuing_state(self, store: Store):
        for pid in KERALA_PARCELS:
            assert store.parcels[pid]["ulpin"].startswith("KL")
        assert store.parcels["parcel-1"]["ulpin"].startswith("UK")

    def test_named_for_the_console(self):
        assert JURISDICTION_NAMES["taluk-ambalapuzha"] == "Ambalapuzha Taluk"
        assert JURISDICTION_NAMES["dist-alappuzha"] == "Alappuzha District"

    def test_protagonist_ids_did_not_shift(self, store: Store):
        """Kerala rows are appended, so the demo script stays true."""
        assert store.alerts["alert-1"]["parcel_id"] == "parcel-1"
        assert store.parcels["parcel-1"]["jurisdiction_id"] == "taluk-a1"
        assert store.cases["case-1"].parcel_id == "parcel-1"


class TestAuthorityIsolation:
    def test_kerala_officer_cannot_see_hrda_parcels(
        self, client: TestClient, kerala_token: str
    ):
        resp = client.get("/parcels", headers=auth_headers(kerala_token))
        assert resp.status_code == 200
        assert {f["properties"]["id"] for f in resp.json()["features"]} == KERALA_PARCELS

        assert client.get(
            "/parcels/parcel-1", headers=auth_headers(kerala_token)
        ).status_code == 404

    def test_hrda_officer_cannot_see_kerala_parcels(
        self, client: TestClient, hrda_token: str
    ):
        visible = {
            f["properties"]["id"]
            for f in client.get("/parcels", headers=auth_headers(hrda_token)).json()[
                "features"
            ]
        }
        assert visible.isdisjoint(KERALA_PARCELS)
        for pid in sorted(KERALA_PARCELS):
            assert client.get(
                f"/parcels/{pid}", headers=auth_headers(hrda_token)
            ).status_code == 404

    def test_alerts_are_scoped_to_the_authority_too(
        self, client: TestClient, kerala_token: str, hrda_token: str
    ):
        kl = client.get("/alerts", headers=auth_headers(kerala_token)).json()
        assert kl, "Ambalapuzha should have seeded alerts to triage"
        assert {a["parcel_id"] for a in kl} <= KERALA_PARCELS

        hr = client.get("/alerts", headers=auth_headers(hrda_token)).json()
        assert {a["parcel_id"] for a in hr}.isdisjoint(KERALA_PARCELS)

    def test_a_kerala_officer_cannot_tag_an_hrda_parcel(
        self, client: TestClient, store: Store
    ):
        admin = token_for("kl-admin", Role.DATA_ADMIN, "state-kl")
        resp = client.post(
            "/parcels/parcel-1/tags",
            headers=auth_headers(admin),
            json={"tag": "reaching-across-india"},
        )
        assert resp.status_code == 404
        assert store.parcels["parcel-1"]["tags"] == ["court-monitored"]


class TestCaseTransferAcrossAuthorities:
    """`POST /cases/{id}/transfer` exists for handovers within an authority.

    Adding a second authority made "any known jurisdiction" too permissive,
    and the membership check itself too *strict* -- both are covered here.
    """

    def _hrda_case(self, store: Store) -> str:
        return next(
            cid
            for cid, rec in store.cases.items()
            if store.tree.is_within("state", rec.jurisdiction_id)
        )

    def test_transfer_within_the_authority_still_works(
        self, client: TestClient, store: Store, hrda_token: str
    ):
        case_id = self._hrda_case(store)
        target = (
            "taluk-b1"
            if store.tree.is_within("dist-a", store.cases[case_id].jurisdiction_id)
            else "taluk-a1"
        )
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(hrda_token),
            json={"to_jurisdiction_id": target, "reason": "survey handover"},
        )
        assert resp.status_code == 200
        assert store.cases[case_id].jurisdiction_id == target

    def test_transfer_to_another_authority_is_refused(
        self, client: TestClient, store: Store, hrda_token: str
    ):
        case_id = self._hrda_case(store)
        before = store.cases[case_id].jurisdiction_id

        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(hrda_token),
            json={"to_jurisdiction_id": "taluk-ambalapuzha", "reason": "nope"},
        )
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert "separate authorities" in detail
        # Named so the officer can tell what was refused; raw ids like
        # "state-kl" would explain nothing.
        assert "Haridwar" in detail and "Kerala" in detail
        assert "state-kl" not in detail
        # Refused means unchanged, not "moved and then complained".
        assert store.cases[case_id].jurisdiction_id == before

    def test_refusal_does_not_claim_the_target_is_unknown(
        self, client: TestClient, store: Store, hrda_token: str
    ):
        """A false 'unknown jurisdiction' would send an officer hunting for a
        typo in an id that is perfectly real."""
        case_id = self._hrda_case(store)
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(hrda_token),
            json={"to_jurisdiction_id": "taluk-ambalapuzha", "reason": "nope"},
        )
        assert "unknown jurisdiction" not in resp.json()["detail"]

    def test_a_genuinely_unknown_jurisdiction_is_still_a_400(
        self, client: TestClient, store: Store, hrda_token: str
    ):
        case_id = self._hrda_case(store)
        resp = client.post(
            f"/cases/{case_id}/transfer",
            headers=auth_headers(hrda_token),
            json={"to_jurisdiction_id": "taluk-atlantis", "reason": "nope"},
        )
        assert resp.status_code == 400
        assert "unknown jurisdiction" in resp.json()["detail"]


class TestAuthorityOf:
    def test_resolves_nodes_to_their_authority(self, store: Store):
        assert store.authority_of("taluk-a1") == "state"
        assert store.authority_of("dist-b") == "state"
        assert store.authority_of("taluk-ambalapuzha") == "state-kl"
        assert store.authority_of("dist-alappuzha") == "state-kl"

    def test_the_deployment_root_belongs_to_no_authority(self, store: Store):
        assert store.authority_of("deployment") is None

    def test_a_single_authority_tree_is_unpartitioned(self):
        """Stores that never opt in keep the old behaviour exactly."""
        store = Store(jurisdiction_rows=[("state", None), ("dist-a", "state")])
        assert store.authority_ids == set()
        assert store.authority_of("dist-a") is None


class TestPersonas:
    def test_kerala_personas_are_offered_and_scoped(self, store: Store, monkeypatch):
        demo_client = demo_client_for(store, monkeypatch)
        personas = {p["id"]: p for p in demo_client.get("/demo/personas").json()}

        assert "co-ambalapuzha" in personas
        assert personas["co-ambalapuzha"]["jurisdiction_id"] == "taluk-ambalapuzha"
        assert personas["co-ambalapuzha"]["jurisdiction_name"] == "Ambalapuzha Taluk"
        assert personas["co-ambalapuzha"]["visible_parcels"] == len(KERALA_PARCELS)

    def test_no_persona_spans_both_authorities(self, store: Store, monkeypatch):
        """A login covering Uttarakhand and Kerala would frame the console's
        map on all of India and corresponds to no real officer."""
        demo_client = demo_client_for(store, monkeypatch)
        for persona in demo_client.get("/demo/personas").json():
            assert store.authority_of(persona["jurisdiction_id"]) is not None, persona["id"]

    def test_logging_in_as_ambalapuzha_yields_a_working_scoped_token(
        self, store: Store, monkeypatch
    ):
        demo_client = demo_client_for(store, monkeypatch)
        token = demo_client.post(
            "/demo/login", json={"persona_id": "co-ambalapuzha"}
        ).json()["token"]
        resp = demo_client.get("/parcels", headers=auth_headers(token))
        assert resp.status_code == 200
        assert {f["properties"]["id"] for f in resp.json()["features"]} == KERALA_PARCELS


class TestJurisdictionsAreAuthorityScoped:
    """`GET /jurisdictions` populates the case-transfer target picker.

    It is deliberately not scoped to the caller's own jurisdiction (a
    dist-a officer must be able to hand a case to dist-b), but once a
    second authority exists, listing the whole tree would offer targets
    that `transfer_case` can only refuse -- and would hand one government
    the internal division structure of another.
    """

    def test_hrda_officer_sees_all_of_hrda_and_none_of_kerala(
        self, client: TestClient, store: Store
    ):
        dist_a = token_for("dist-a-officer", Role.CASE_OFFICER, "dist-a")
        ids = {row["id"] for row in client.get(
            "/jurisdictions", headers=auth_headers(dist_a)
        ).json()}
        assert ids == store.tree.scope_ids("state")
        assert "taluk-b1" in ids, "cross-district handover targets must still be offered"
        assert ids.isdisjoint({"state-kl", "dist-alappuzha", "taluk-ambalapuzha"})
        assert "deployment" not in ids

    def test_kerala_officer_sees_only_kerala(
        self, client: TestClient, store: Store, kerala_token: str
    ):
        ids = {row["id"] for row in client.get(
            "/jurisdictions", headers=auth_headers(kerala_token)
        ).json()}
        assert ids == store.tree.scope_ids("state-kl")

    def test_every_offered_target_is_actually_transferable(
        self, client: TestClient, store: Store, hrda_token: str
    ):
        """The picker must not offer a target the API will refuse.

        This is the invariant the endpoint exists to preserve: the console
        builds its dropdown from exactly this list.
        """
        case_id = next(
            cid for cid, rec in store.cases.items()
            if store.tree.is_within("state", rec.jurisdiction_id)
        )
        offered = [
            row["id"] for row in client.get(
                "/jurisdictions", headers=auth_headers(hrda_token)
            ).json()
        ]
        for target in offered:
            if target == store.cases[case_id].jurisdiction_id:
                continue
            resp = client.post(
                f"/cases/{case_id}/transfer",
                headers=auth_headers(hrda_token),
                json={"to_jurisdiction_id": target, "reason": "picker check"},
            )
            assert resp.status_code == 200, (target, resp.status_code, resp.text)

    def test_parent_ids_never_dangle(self, client: TestClient, kerala_token: str):
        rows = client.get("/jurisdictions", headers=auth_headers(kerala_token)).json()
        ids = {row["id"] for row in rows}
        parents = {row["parent_id"] for row in rows} - {None}
        assert parents <= ids
        assert sum(1 for row in rows if row["parent_id"] is None) == 1


class TestAmbalapuzhaHasAWorkingCase:
    """Kerala is a working jurisdiction, not a map pin.

    A persona with alerts but structurally no cases cannot demonstrate the
    due-process rail or the policy guards -- the platform's whole argument.
    """

    def _case_id(self, client: TestClient, token: str) -> str:
        cases = client.get("/cases", headers=auth_headers(token)).json()
        assert len(cases) == 1, cases
        return cases[0]["id"]

    def test_the_taluk_officer_has_a_case_queue(
        self, client: TestClient, kerala_token: str
    ):
        cases = client.get("/cases", headers=auth_headers(kerala_token)).json()
        assert cases, "an Ambalapuzha login must have a case to work"
        assert cases[0]["parcel_id"] in KERALA_PARCELS

    def test_hrda_cannot_see_the_kerala_case(
        self, client: TestClient, hrda_token: str, kerala_token: str
    ):
        kerala_case = self._case_id(client, kerala_token)
        assert client.get(
            f"/cases/{kerala_case}", headers=auth_headers(hrda_token)
        ).status_code == 404

    def test_the_hrda_protagonist_cases_are_untouched(self, store: Store):
        assert store.cases["case-1"].case.state.value == "SHOW_CAUSE_ISSUED"
        assert store.cases["case-1"].alert_id == "alert-1"

    def test_it_carries_a_real_due_process_history(
        self, client: TestClient, kerala_token: str
    ):
        case_id = self._case_id(client, kerala_token)
        detail = client.get(f"/cases/{case_id}", headers=auth_headers(kerala_token)).json()
        assert detail["state"] == "INSPECTED"
        states = [e["to_state"] for e in detail["events"]]
        assert states == ["TRIAGED", "INSPECTION_ASSIGNED", "INSPECTED"]
        # The rail is only meaningful if the evidence is attached to it.
        assert any(
            "report-006.pdf" in str(event.get("artifacts", {}))
            for event in detail["events"]
        )

    def test_the_evidence_guard_bites_on_the_next_step(
        self, client: TestClient, kerala_token: str
    ):
        """Parked at INSPECTED precisely so this refusal is demonstrable:
        a show-cause notice cannot issue without the notice document and
        dispatch proof."""
        case_id = self._case_id(client, kerala_token)
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(kerala_token),
            json={"to_state": "SHOW_CAUSE_ISSUED"},
        )
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert "notice_document" in detail and "dispatch_proof" in detail

    def test_the_sequence_guard_bites_too(
        self, client: TestClient, kerala_token: str
    ):
        case_id = self._case_id(client, kerala_token)
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(kerala_token),
            json={"to_state": "ORDER_ISSUED"},
        )
        assert resp.status_code in (403, 409)

    def test_the_legal_step_is_reachable_with_the_paperwork(
        self, client: TestClient, kerala_token: str
    ):
        """The guard must be an evidence guard, not a dead end -- supplying
        what it asks for has to actually work."""
        case_id = self._case_id(client, kerala_token)
        resp = client.post(
            f"/cases/{case_id}/transitions",
            headers=auth_headers(kerala_token),
            json={
                "to_state": "SHOW_CAUSE_ISSUED",
                "artifacts": {
                    "notice_document": "notice-006.pdf",
                    "dispatch_proof": "dispatch-006.pdf",
                },
            },
        )
        assert resp.status_code == 201, resp.text


class TestPersonaAuthorityLabelling:
    """The console groups the persona switcher by authority, so each
    persona has to say which authority it belongs to. Deriving it
    client-side from the jurisdiction *name* would break the moment an
    authority is renamed."""

    def test_each_persona_reports_its_authority(self, store: Store, monkeypatch):
        demo_client = demo_client_for(store, monkeypatch)
        by_id = {p["id"]: p for p in demo_client.get("/demo/personas").json()}

        assert by_id["vc-hrda"]["authority_id"] == "state"
        assert by_id["vc-hrda"]["authority_name"] == JURISDICTION_NAMES["state"]
        assert by_id["co-ambalapuzha"]["authority_id"] == "state-kl"
        assert by_id["co-ambalapuzha"]["authority_name"] == "Government of Kerala"

    def test_personas_split_into_exactly_two_authorities(
        self, store: Store, monkeypatch
    ):
        demo_client = demo_client_for(store, monkeypatch)
        personas = demo_client.get("/demo/personas").json()
        authorities = {p["authority_name"] for p in personas}
        assert len(authorities) == 2, authorities
        assert None not in authorities, "every persona must sit under an authority"

    def test_a_single_authority_deployment_reports_none(self):
        """`authority_of` returns None when nothing opted into a partition,
        which is what keeps that console's switcher a flat list."""
        plain = Store(jurisdiction_rows=[("state", None), ("dist-a", "state")])
        assert plain.authority_of("dist-a") is None
