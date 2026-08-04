"""Shared pytest fixtures for the API test suite.

Keeps the suite from writing scene blobs (or evidence-state JSON) into the
working tree: the default `Store` registry retains bytes through a
`FileBlobStore` rooted at `MAPENCROACH_BLOB_ROOT` (default `data/scenes`,
relative to cwd), and `mapencroach.persistence`'s default state path is
`data/state.json`, so any test that runs a capture flow -- or that builds
a store via `create_app()`/`build_store()` with no explicit store, which
none of the existing suite does but a future test might -- would
otherwise leave real files in `backend/data/`. They're gitignored and
harmless, but a test run should not deposit anything in the checkout.

`create_app` refuses to start outside demo mode while the JWT secret is
still the well-known development default (see
`mapencroach.api.auth.validate_secret_config`) -- an operator who forgets
to set MAPENCROACH_JWT_SECRET would otherwise let anyone who has read the
public repo mint a valid data_admin token. Because of that, every test
that builds an app needs a real secret configured. This autouse fixture
supplies one for the whole suite; the handful of tests that specifically
exercise the missing-secret guard override it with monkeypatch.delenv
before calling create_app.
"""

import pytest


@pytest.fixture(autouse=True)
def _isolated_blob_root(tmp_path, monkeypatch):
    """Point every test's blob storage at its own temp directory."""
    monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "scenes"))


@pytest.fixture(autouse=True)
def _isolated_state_path(tmp_path, monkeypatch):
    """Point every test's default state-file location at its own temp
    directory, for the same reason as `_isolated_blob_root` above.
    Tests that exercise persistence explicitly still control
    `MAPENCROACH_STATE_PATH` themselves (this just sets a safe default)."""
    monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))


# Deliberately distinct from auth._DEFAULT_SECRET ("dev-secret-do-not-deploy")
# so validate_secret_config(demo_mode=False) accepts it as a real secret
# whenever this fixture is in effect.
TEST_JWT_SECRET = "pytest-harness-secret-not-for-prod"  # noqa: S105


@pytest.fixture(autouse=True)
def _default_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAPENCROACH_JWT_SECRET", TEST_JWT_SECRET)
