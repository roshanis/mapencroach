"""Shared pytest fixtures for the API test suite.

`create_app` refuses to start outside demo mode while the JWT secret is
still the well-known development default (see
`mapencroach.api.auth.using_default_secret`) -- an operator who forgets
to set MAPENCROACH_JWT_SECRET would otherwise let anyone who has read the
public repo mint a valid data_admin token. Because of that, every test
that builds an app needs a real secret configured. This autouse fixture
supplies one for the whole suite; the handful of tests that specifically
exercise the missing-secret guard override it with monkeypatch.delenv
before calling create_app.
"""

import pytest

# Deliberately distinct from auth._DEFAULT_SECRET ("dev-secret-do-not-deploy")
# so using_default_secret() is False whenever this fixture is in effect.
TEST_JWT_SECRET = "pytest-harness-secret-not-for-prod"  # noqa: S105


@pytest.fixture(autouse=True)
def _default_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAPENCROACH_JWT_SECRET", TEST_JWT_SECRET)
