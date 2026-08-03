"""Integration paths that only run against real infrastructure semantics.

Two things the unit suite cannot see: the JWKS-over-HTTP fetch path in
auth (exercised here against a local throwaway HTTP server) and the
PostGIS branch of the geometry type (exercised only when
MAPENCROACH_TEST_DB_URL points at a real PostGIS database — run this
on first deployment:

    MAPENCROACH_TEST_DB_URL=postgresql+psycopg://user:pw@host/db \\
        .venv/bin/pytest tests/test_integration_paths.py -v

with `pip install '.[postgres]'` and `CREATE EXTENSION postgis;` done).
"""

import json
import os
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.store import Store

KID = "net-key-1"


@pytest.fixture(scope="module")
def rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def jwks_server(rsa_key):
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(rsa_key.public_key()))
    jwk.update({"kid": KID, "alg": "RS256", "use": "sig"})
    document = json.dumps({"keys": [jwk]}).encode()

    class JwksHandler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - http.server API
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(document)

        def log_message(self, *args):  # silence request logging in test output
            pass

    server = HTTPServer(("127.0.0.1", 0), JwksHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/jwks"
    server.shutdown()
    thread.join(timeout=5)


class TestJwksOverHttp:
    """The production path: keys fetched from Keycloak's jwks_uri."""

    def test_token_verifies_against_fetched_jwks(self, jwks_server, rsa_key, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_OIDC_JWKS_URL", jwks_server)
        monkeypatch.delenv("MAPENCROACH_OIDC_JWKS", raising=False)
        monkeypatch.delenv("MAPENCROACH_OIDC_ISSUER", raising=False)
        monkeypatch.delenv("MAPENCROACH_OIDC_AUDIENCE", raising=False)

        token = jwt.encode(
            {
                "sub": "net-user",
                "role": "viewer",
                "jurisdiction_id": "state",
                "exp": datetime.now(UTC) + timedelta(hours=1),
            },
            rsa_key,
            algorithm="RS256",
            headers={"kid": KID},
        )
        client = TestClient(create_app(Store.seed_demo()))
        resp = client.get("/parcels", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200

    def test_key_not_in_fetched_jwks_is_rejected(self, jwks_server, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_OIDC_JWKS_URL", jwks_server)
        monkeypatch.delenv("MAPENCROACH_OIDC_JWKS", raising=False)
        other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        token = jwt.encode(
            {
                "sub": "x",
                "role": "viewer",
                "jurisdiction_id": "state",
                "exp": datetime.now(UTC) + timedelta(hours=1),
            },
            other,
            algorithm="RS256",
            headers={"kid": "unknown-kid"},
        )
        client = TestClient(create_app(Store.seed_demo()))
        resp = client.get("/parcels", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401


REAL_DB = os.environ.get("MAPENCROACH_TEST_DB_URL")


@pytest.mark.skipif(
    not REAL_DB, reason="set MAPENCROACH_TEST_DB_URL to run against real PostGIS"
)
class TestRealPostgis:
    """Smoke the PostGIS-only code paths on first deployment."""

    @pytest.fixture
    def store(self):
        from sqlalchemy import create_engine

        from mapencroach.db import models
        from mapencroach.db.store import (
            DatabaseStore,
            database_is_empty,
            init_db,
            seed_demo_database,
        )

        engine = create_engine(REAL_DB)
        models.Base.metadata.drop_all(engine)
        init_db(engine)
        assert database_is_empty(engine)
        seed_demo_database(engine)
        yield DatabaseStore(engine)
        models.Base.metadata.drop_all(engine)

    def test_geometry_round_trips_through_postgis(self, store):
        parcel = store.parcels["parcel-1"]
        geometry = parcel["geometry"]
        # PostGIS promotes to MultiPolygon; the coordinates must survive.
        assert geometry["type"] in ("Polygon", "MultiPolygon")
        coords = (
            geometry["coordinates"][0]
            if geometry["type"] == "Polygon"
            else geometry["coordinates"][0][0]
        )
        lons = [pt[0] for pt in coords]
        assert min(lons) == pytest.approx(78.1445, abs=1e-6)

    def test_mutations_and_audit_survive(self, store):
        from mapencroach.audit.chain import verify_chain

        store.set_boundary_grade("parcel-3", "A")
        store.add_parcel_tag("parcel-3", "postgis-smoke")
        assert store.parcels["parcel-3"]["boundary_grade"] == "A"
        store.record_audit(
            actor="smoke", action="test", object_type="parcel", object_id="parcel-3"
        )
        assert verify_chain(store.audit_chain).ok

    def test_case_transition_persists(self, store):
        from mapencroach.domain.case_engine import CaseState

        record, _event = store.transition_case(
            "case-1",
            CaseState.RESPONSE_WINDOW,
            actor="smoke",
            occurred_at=datetime.now(UTC),
            artifacts={},
            note="postgis smoke",
        )
        assert store.cases["case-1"].case.state is CaseState.RESPONSE_WINDOW