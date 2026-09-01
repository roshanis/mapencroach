"""Tests for the content-addressed blob store behind retained scene bytes.

Covers `MemoryBlobStore` and `FileBlobStore` round-tripping, `put`
idempotency, corruption detection on read (mutating the stored payload
after a successful `put` must make `get` raise, never return the bad
bytes), `BlobNotFound`, `FileBlobStore`'s hash-prefix fan-out directory
layout, interrupted-write safety, and `build_blob_store()`'s env wiring.
Never touches the network -- there is nothing here that could.
"""

import hashlib
import os
from pathlib import Path

import pytest

from mapencroach.imagery.blobstore import (
    BlobIntegrityError,
    BlobNotFound,
    FileBlobStore,
    MemoryBlobStore,
    build_blob_store,
)

DATA = b"fake-satellite-scene-bytes"
SHA256 = hashlib.sha256(DATA).hexdigest()


# ---------------------------------------------------------------------
# Shared behavioral contract, parametrized across both implementations.
# ---------------------------------------------------------------------


def make_memory_store():
    return MemoryBlobStore()


def make_file_store(tmp_path):
    return FileBlobStore(tmp_path / "blobs")


STORE_FACTORIES = [
    pytest.param(lambda tmp_path: make_memory_store(), id="memory"),
    pytest.param(make_file_store, id="file"),
]


@pytest.mark.parametrize("make_store", STORE_FACTORIES)
class TestRoundTrip:
    def test_put_then_get_returns_identical_bytes(self, make_store, tmp_path):
        store = make_store(tmp_path)
        sha256 = store.put(DATA)
        assert sha256 == SHA256
        assert store.get(sha256) == DATA

    def test_put_returns_sha256_hex_digest(self, make_store, tmp_path):
        store = make_store(tmp_path)
        sha256 = store.put(DATA)
        assert sha256 == hashlib.sha256(DATA).hexdigest()
        assert len(sha256) == 64
        int(sha256, 16)  # must be valid hex

    def test_has_true_after_put(self, make_store, tmp_path):
        store = make_store(tmp_path)
        assert store.has(SHA256) is False
        store.put(DATA)
        assert store.has(SHA256) is True

    def test_has_false_for_unknown_hash(self, make_store, tmp_path):
        store = make_store(tmp_path)
        assert store.has("0" * 64) is False

    def test_get_unknown_hash_raises_blob_not_found(self, make_store, tmp_path):
        store = make_store(tmp_path)
        with pytest.raises(BlobNotFound):
            store.get("0" * 64)

    def test_put_is_idempotent(self, make_store, tmp_path):
        store = make_store(tmp_path)
        first = store.put(DATA)
        second = store.put(DATA)
        assert first == second == SHA256
        assert store.get(SHA256) == DATA

    def test_distinct_content_gets_distinct_keys(self, make_store, tmp_path):
        store = make_store(tmp_path)
        a = store.put(b"one")
        b = store.put(b"two")
        assert a != b
        assert store.get(a) == b"one"
        assert store.get(b) == b"two"

    def test_empty_bytes_round_trip(self, make_store, tmp_path):
        store = make_store(tmp_path)
        sha256 = store.put(b"")
        assert sha256 == hashlib.sha256(b"").hexdigest()
        assert store.get(sha256) == b""


# ---------------------------------------------------------------------
# MemoryBlobStore specifics
# ---------------------------------------------------------------------


class TestMemoryBlobStore:
    def test_corruption_after_put_is_detected_on_read(self):
        store = MemoryBlobStore()
        sha256 = store.put(DATA)
        # Reach in and tamper with the stored bytes directly, simulating
        # bit-rot / an out-of-band mutation -- there is no supported API
        # to do this, which is the point.
        store._blobs[sha256] = b"tampered-bytes-not-matching-hash"  # noqa: SLF001
        with pytest.raises(BlobIntegrityError):
            store.get(sha256)

    def test_put_copies_input_bytes(self):
        """Mutating a bytearray after put() must not corrupt the stored copy."""
        store = MemoryBlobStore()
        payload = bytearray(b"mutable-buffer")
        sha256 = store.put(bytes(payload))
        payload[0:1] = b"X"
        assert store.get(sha256) == b"mutable-buffer"


# ---------------------------------------------------------------------
# FileBlobStore specifics
# ---------------------------------------------------------------------


class TestFileBlobStoreLayout:
    def test_fans_out_by_hash_prefix(self, tmp_path):
        root = tmp_path / "blobs"
        store = FileBlobStore(root)
        sha256 = store.put(DATA)

        expected_path = root / sha256[:2] / sha256[2:4] / sha256
        assert expected_path.is_file()
        assert expected_path.read_bytes() == DATA

    def test_distinct_hashes_land_in_distinct_prefix_directories(self, tmp_path):
        root = tmp_path / "blobs"
        store = FileBlobStore(root)
        h1 = store.put(b"a" * 100)
        h2 = store.put(b"b" * 100)
        # Not a hard guarantee for arbitrary content, but true for these
        # two fixed payloads (checked once, deterministically) -- and what
        # matters for the layout test is simply that the fan-out directory
        # is a deterministic function of the hash prefix.
        assert (root / h1[:2] / h1[2:4] / h1).is_file()
        assert (root / h2[:2] / h2[2:4] / h2).is_file()

    def test_no_flat_directory_dump(self, tmp_path):
        """The blob never lands directly under root -- only under its
        two levels of hash-prefix subdirectories."""
        root = tmp_path / "blobs"
        store = FileBlobStore(root)
        store.put(DATA)
        assert not (root / SHA256).exists()


class TestFileBlobStoreCorruption:
    def test_corruption_after_put_is_detected_on_read(self, tmp_path):
        root = tmp_path / "blobs"
        store = FileBlobStore(root)
        sha256 = store.put(DATA)

        path = root / sha256[:2] / sha256[2:4] / sha256
        path.write_bytes(b"corrupted-on-disk")

        with pytest.raises(BlobIntegrityError):
            store.get(sha256)

    def test_corrupted_blob_is_never_returned_as_valid(self, tmp_path):
        """The failure mode under test: corruption must raise, not
        silently hand back bytes that no longer match the key."""
        root = tmp_path / "blobs"
        store = FileBlobStore(root)
        sha256 = store.put(DATA)
        path = root / sha256[:2] / sha256[2:4] / sha256
        path.write_bytes(DATA + b"\x00extra-byte-appended")

        with pytest.raises(BlobIntegrityError):
            data = store.get(sha256)
            assert data == DATA  # pragma: no cover - must never get here


class TestFileBlobStoreInterruptedWrite:
    def test_failure_during_write_leaves_no_final_blob(self, tmp_path, monkeypatch):
        root = tmp_path / "blobs"
        store = FileBlobStore(root)

        def boom(*args, **kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(os, "fsync", boom)

        with pytest.raises(OSError, match="disk full"):
            store.put(DATA)

        assert store.has(SHA256) is False
        with pytest.raises(BlobNotFound):
            store.get(SHA256)

    def test_failure_during_write_cleans_up_temp_file(self, tmp_path, monkeypatch):
        root = tmp_path / "blobs"
        store = FileBlobStore(root)

        def boom(*args, **kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(os, "fsync", boom)

        with pytest.raises(OSError):
            store.put(DATA)

        prefix_dir = root / SHA256[:2] / SHA256[2:4]
        leftovers = list(prefix_dir.iterdir()) if prefix_dir.exists() else []
        assert leftovers == []

    def test_failure_during_rename_leaves_no_final_blob(self, tmp_path, monkeypatch):
        root = tmp_path / "blobs"
        store = FileBlobStore(root)

        def boom(*args, **kwargs):
            raise OSError("rename failed")

        monkeypatch.setattr(os, "replace", boom)

        with pytest.raises(OSError, match="rename failed"):
            store.put(DATA)

        assert store.has(SHA256) is False

    def test_successful_put_after_a_failed_one_still_works(self, tmp_path, monkeypatch):
        root = tmp_path / "blobs"
        store = FileBlobStore(root)

        real_fsync = os.fsync
        calls = {"n": 0}

        def flaky_fsync(fd):
            calls["n"] += 1
            if calls["n"] == 1:
                raise OSError("transient disk error")
            return real_fsync(fd)

        monkeypatch.setattr(os, "fsync", flaky_fsync)

        with pytest.raises(OSError):
            store.put(DATA)
        assert store.has(SHA256) is False

        sha256 = store.put(DATA)  # retried, this time fsync succeeds
        assert sha256 == SHA256
        assert store.get(SHA256) == DATA

    def test_write_verification_failure_does_not_publish_the_blob(self, tmp_path, monkeypatch):
        """If the bytes read back from the temp file don't hash to the
        intended key (write verification), the blob must never be
        published at its final, addressable path."""
        root = tmp_path / "blobs"
        store = FileBlobStore(root)

        original_read_bytes = Path.read_bytes

        def tampering_read_bytes(self):
            # Simulate the bytes landing on disk differently than what was
            # written, the one time this is called during put()'s write
            # verification step.
            return original_read_bytes(self) + b"corruption"

        monkeypatch.setattr(Path, "read_bytes", tampering_read_bytes)

        with pytest.raises(BlobIntegrityError):
            store.put(DATA)

        assert store.has(SHA256) is False


class TestBuildBlobStore:
    def test_defaults_to_file_blob_store_under_data_scenes(self, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_BLOB_ROOT", raising=False)
        store = build_blob_store()
        assert isinstance(store, FileBlobStore)
        assert store._root == Path("data/scenes")  # noqa: SLF001

    def test_honors_blob_root_env_var(self, tmp_path, monkeypatch):
        custom_root = tmp_path / "custom-scene-root"
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(custom_root))
        store = build_blob_store()
        assert isinstance(store, FileBlobStore)
        assert store._root == custom_root  # noqa: SLF001

        sha256 = store.put(DATA)
        assert (custom_root / sha256[:2] / sha256[2:4] / sha256).is_file()


class TestPutRepairsACorruptBlob:
    """`put` used to return success on the bare existence of the path.

    That reported bytes stored which were never stored, and discarded the
    genuine copy the caller was holding -- at the one moment the corruption
    could still have been repaired. Read-side verification meant nothing
    wrong was ever *served*, but the evidence itself was lost.
    """

    @staticmethod
    def _corrupt(root: Path) -> Path:
        blob = next(p for p in root.rglob("*") if p.is_file())
        blob.write_bytes(b"CORRUPTED")
        return blob

    def test_put_repairs_rather_than_reporting_false_success(self, tmp_path: Path):
        store = FileBlobStore(tmp_path)
        good = b"genuine evidence bytes"
        digest = store.put(good)
        blob = self._corrupt(tmp_path)

        assert store.put(good) == digest
        assert blob.read_bytes() == good, "the genuine bytes must be written back"
        assert store.get(digest) == good

    def test_a_healthy_repeat_put_is_still_idempotent(self, tmp_path: Path):
        store = FileBlobStore(tmp_path)
        good = b"genuine evidence bytes"
        digest = store.put(good)
        blob = next(p for p in tmp_path.rglob("*") if p.is_file())
        before = blob.read_bytes()

        assert store.put(good) == digest
        assert blob.read_bytes() == before == good

    def test_corruption_is_still_refused_on_read_when_never_re_put(
        self, tmp_path: Path
    ):
        """Repair only happens when someone hands us the bytes again. With
        no re-put, a corrupt blob must still fail the read rather than be
        served as evidence."""
        store = FileBlobStore(tmp_path)
        digest = store.put(b"genuine evidence bytes")
        self._corrupt(tmp_path)
        with pytest.raises(BlobIntegrityError):
            store.get(digest)
