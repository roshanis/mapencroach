"""Shared pytest fixtures.

Keeps the suite from writing scene blobs into the working tree: the
default `Store` registry retains bytes through a `FileBlobStore` rooted
at `MAPENCROACH_BLOB_ROOT` (default `data/scenes`, relative to cwd), so
any test that runs a capture flow would otherwise leave real files in
`backend/data/`. They're gitignored and harmless, but a test run should
not deposit anything in the checkout.
"""

import pytest


@pytest.fixture(autouse=True)
def _isolated_blob_root(tmp_path, monkeypatch):
    """Point every test's blob storage at its own temp directory."""
    monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "scenes"))
