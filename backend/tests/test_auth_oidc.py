"""OIDC (Keycloak) verification path: RS256 + JWKS, issuer/audience checks.

Uses an inline JWKS (MAPENCROACH_OIDC_JWKS) so no network or Keycloak
instance is needed — the same code path serves a real jwks_uri in
production.
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store

ISSUER = "https://keycloak.example/realms/mapencroach"
AUDIENCE = "mapencroach-api"
KID = "test-key-1"


@pytest.fixture(scope="module")
def rsa_keys() -> tuple[rsa.RSAPrivateKey, dict[str, Any]]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk.update({"kid": KID, "alg": "RS256", "use": "sig"})
    return private_key, {"keys": [jwk]}


@pytest.fixture
def oidc_env(monkeypatch, rsa_keys):
    _, jwks = rsa_keys
    monkeypatch.setenv("MAPENCROACH_OIDC_JWKS", json.dumps(jwks))
    monkeypatch.setenv("MAPENCROACH_OIDC_ISSUER", ISSUER)
    monkeypatch.setenv("MAPENCROACH_OIDC_AUDIENCE", AUDIENCE)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Store.seed_demo()))


def mint(private_key: rsa.RSAPrivateKey, claims: dict[str, Any], kid: str = KID) -> str:
    payload = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "exp": datetime.now(UTC) + timedelta(hours=1),
        **claims,
    }
    return jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": kid})


def get_parcels(client: TestClient, token: str) -> Any:
    return client.get("/parcels", headers={"Authorization": f"Bearer {token}"})


class TestOidcAccepts:
    def test_realm_access_role_is_mapped(self, oidc_env, client, rsa_keys):
        private_key, _ = rsa_keys
        token = mint(
            private_key,
            {
                "sub": "officer-42",
                "realm_access": {"roles": ["offline_access", "case_officer"]},
                "jurisdiction_id": "dist-a",
            },
        )
        assert get_parcels(client, token).status_code == 200

    def test_direct_role_claim_is_accepted(self, oidc_env, client, rsa_keys):
        private_key, _ = rsa_keys
        token = mint(
            private_key,
            {"sub": "viewer-1", "role": "viewer", "jurisdiction_id": "state"},
        )
        assert get_parcels(client, token).status_code == 200

    def test_scoping_applies_to_oidc_identities(self, oidc_env, client, rsa_keys):
        private_key, _ = rsa_keys
        token = mint(
            private_key,
            {
                "sub": "officer-42",
                "realm_access": {"roles": ["case_officer"]},
                "jurisdiction_id": "taluk-b1",
            },
        )
        body = get_parcels(client, token).json()
        jurisdictions = {f["properties"]["jurisdiction_id"] for f in body["features"]}
        assert jurisdictions == {"taluk-b1"}


class TestOidcRejects:
    def test_hs256_dev_token_is_rejected_when_oidc_is_on(self, oidc_env, client):
        dev_token = create_token(
            sub="attacker",
            role=Role.DATA_ADMIN,
            jurisdiction_id="state",
            secret="dev-secret-do-not-deploy",  # noqa: S106 - the point of the test
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        assert get_parcels(client, dev_token).status_code == 401

    def test_wrong_issuer_is_rejected(self, oidc_env, client, rsa_keys):
        private_key, _ = rsa_keys
        token = jwt.encode(
            {
                "iss": "https://evil.example/realms/other",
                "aud": AUDIENCE,
                "exp": datetime.now(UTC) + timedelta(hours=1),
                "sub": "x",
                "role": "viewer",
                "jurisdiction_id": "state",
            },
            private_key,
            algorithm="RS256",
            headers={"kid": KID},
        )
        assert get_parcels(client, token).status_code == 401

    def test_wrong_audience_is_rejected(self, oidc_env, client, rsa_keys):
        private_key, _ = rsa_keys
        token = jwt.encode(
            {
                "iss": ISSUER,
                "aud": "some-other-api",
                "exp": datetime.now(UTC) + timedelta(hours=1),
                "sub": "x",
                "role": "viewer",
                "jurisdiction_id": "state",
            },
            private_key,
            algorithm="RS256",
            headers={"kid": KID},
        )
        assert get_parcels(client, token).status_code == 401

    def test_expired_token_is_rejected(self, oidc_env, client, rsa_keys):
        private_key, _ = rsa_keys
        token = jwt.encode(
            {
                "iss": ISSUER,
                "aud": AUDIENCE,
                "exp": datetime.now(UTC) - timedelta(hours=1),
                "sub": "x",
                "role": "viewer",
                "jurisdiction_id": "state",
            },
            private_key,
            algorithm="RS256",
            headers={"kid": KID},
        )
        assert get_parcels(client, token).status_code == 401

    def test_token_signed_by_unknown_key_is_rejected(self, oidc_env, client):
        other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        token = mint(
            other_key, {"sub": "x", "role": "viewer", "jurisdiction_id": "state"}
        )
        assert get_parcels(client, token).status_code == 401

    def test_no_recognized_role_is_rejected(self, oidc_env, client, rsa_keys):
        private_key, _ = rsa_keys
        token = mint(
            private_key,
            {
                "sub": "x",
                "realm_access": {"roles": ["offline_access", "uma_authorization"]},
                "jurisdiction_id": "state",
            },
        )
        assert get_parcels(client, token).status_code == 401

    def test_two_recognized_roles_is_a_provisioning_error(self, oidc_env, client, rsa_keys):
        private_key, _ = rsa_keys
        token = mint(
            private_key,
            {
                "sub": "x",
                "realm_access": {"roles": ["case_officer", "system_admin"]},
                "jurisdiction_id": "state",
            },
        )
        assert get_parcels(client, token).status_code == 401

    def test_missing_jurisdiction_claim_is_rejected(self, oidc_env, client, rsa_keys):
        private_key, _ = rsa_keys
        token = mint(private_key, {"sub": "x", "role": "viewer"})
        assert get_parcels(client, token).status_code == 401


class TestDevModeUnchanged:
    def test_hs256_still_works_when_oidc_not_configured(self, client):
        token = create_token(
            sub="dev-user",
            role=Role.VIEWER,
            jurisdiction_id="state",
            secret="dev-secret-do-not-deploy",  # noqa: S106 - dev default
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        assert get_parcels(client, token).status_code == 200
