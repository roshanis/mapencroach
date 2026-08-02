"""Shared pytest fixtures.

Keeps the suite from writing scene blobs (or evidence-state JSON) into the
working tree: the default `Store` registry retains bytes through a
`FileBlobStore` rooted at `MAPENCROACH_BLOB_ROOT` (default `data/scenes`,
relative to cwd), and `mapencroach.persistence`'s default state path is
`data/state.json`, so any test that runs a capture flow -- or that builds
a store via `create_app()`/`build_store()` with no explicit store, which
none of the existing suite does but a future test might -- would
otherwise leave real files in `backend/data/`. They're gitignored and
harmless, but a test run should not deposit anything in the checkout.
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
