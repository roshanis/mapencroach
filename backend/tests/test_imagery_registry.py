import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest

from mapencroach.imagery.blobstore import BlobNotFound, MemoryBlobStore
from mapencroach.imagery.registry import (
    DuplicateScene,
    SceneNotRetained,
    SceneRecord,
    SceneRegistry,
)


def make_registry() -> SceneRegistry:
    return SceneRegistry()


def register_scene(
    registry: SceneRegistry,
    *,
    data: bytes = b"fake-satellite-bytes",
    scene_id: str = "scene-1",
    captured_at: datetime | None = None,
    sensor: str = "sentinel-2",
    resolution_m: float = 10.0,
    cloud_pct: float = 5.0,
    source: str = "copernicus",
    href: str = "https://example.com/scene-1.tif",
    media_type: str | None = None,
) -> SceneRecord:
    captured_at = captured_at or datetime(2026, 1, 1, tzinfo=UTC)
    kwargs = {}
    if media_type is not None:
        kwargs["media_type"] = media_type
    return registry.register(
        data,
        scene_id=scene_id,
        captured_at=captured_at,
        sensor=sensor,
        resolution_m=resolution_m,
        cloud_pct=cloud_pct,
        source=source,
        href=href,
        **kwargs,
    )


class TestRegisterHashing:
    def test_sha256_is_deterministic(self):
        registry = make_registry()
        record = register_scene(registry, data=b"hello-world", scene_id="a")
        # same bytes, different registry -> same hash
        other_registry = make_registry()
        other_record = register_scene(other_registry, data=b"hello-world", scene_id="b")
        assert record.sha256 == other_record.sha256

    def test_sha256_matches_known_vector(self):
        import hashlib

        registry = make_registry()
        data = b"known-vector-bytes"
        record = register_scene(registry, data=data, scene_id="known")
        assert record.sha256 == hashlib.sha256(data).hexdigest()

    def test_different_bytes_produce_different_hash(self):
        registry = make_registry()
        r1 = register_scene(registry, data=b"aaa", scene_id="s1")
        r2 = register_scene(registry, data=b"bbb", scene_id="s2")
        assert r1.sha256 != r2.sha256


class TestDedup:
    def test_duplicate_sha256_is_rejected(self):
        registry = make_registry()
        register_scene(registry, data=b"identical-bytes", scene_id="s1")
        with pytest.raises(DuplicateScene):
            register_scene(registry, data=b"identical-bytes", scene_id="s2")

    def test_duplicate_scene_id_is_rejected_even_with_different_bytes(self):
        registry = make_registry()
        register_scene(registry, data=b"bytes-one", scene_id="dup-id")
        with pytest.raises(DuplicateScene):
            register_scene(registry, data=b"bytes-two", scene_id="dup-id")

    def test_distinct_scenes_both_register(self):
        registry = make_registry()
        r1 = register_scene(registry, data=b"one", scene_id="s1")
        r2 = register_scene(registry, data=b"two", scene_id="s2")
        assert registry.get("s1") == r1
        assert registry.get("s2") == r2


class TestLookup:
    def test_get_returns_registered_record(self):
        registry = make_registry()
        record = register_scene(registry, scene_id="s1")
        assert registry.get("s1") is record

    def test_get_unknown_scene_raises_keyerror(self):
        registry = make_registry()
        with pytest.raises(KeyError):
            registry.get("nope")

    def test_by_hash_returns_registered_record(self):
        registry = make_registry()
        record = register_scene(registry, data=b"lookup-by-hash", scene_id="s1")
        assert registry.by_hash(record.sha256) is record

    def test_by_hash_unknown_raises_keyerror(self):
        registry = make_registry()
        with pytest.raises(KeyError):
            registry.by_hash("0" * 64)


class TestVerify:
    def test_verify_true_for_unmodified_data(self):
        registry = make_registry()
        data = b"integrity-check-bytes"
        register_scene(registry, data=data, scene_id="s1")
        assert registry.verify("s1", data) is True

    def test_verify_false_for_tampered_data(self):
        registry = make_registry()
        register_scene(registry, data=b"original-bytes", scene_id="s1")
        assert registry.verify("s1", b"tampered-bytes") is False

    def test_verify_unknown_scene_raises_keyerror(self):
        registry = make_registry()
        with pytest.raises(KeyError):
            registry.verify("nope", b"anything")


class TestStacItemShape:
    def test_stac_item_has_minimal_required_fields(self):
        registry = make_registry()
        captured_at = datetime(2026, 3, 15, 6, 30, tzinfo=UTC)
        record = register_scene(
            registry,
            scene_id="stac-scene",
            captured_at=captured_at,
            sensor="landsat-9",
            resolution_m=15.0,
            cloud_pct=12.5,
            href="https://example.com/stac-scene.tif",
        )
        stac = record.stac_item
        assert stac["id"] == "stac-scene"
        assert stac["properties"]["datetime"] == captured_at.isoformat()
        assert stac["properties"]["eo:cloud_cover"] == 12.5
        assert stac["properties"]["gsd"] == 15.0
        assert stac["assets"]["data"]["href"] == "https://example.com/stac-scene.tif"

    def test_record_is_frozen(self):
        registry = make_registry()
        record = register_scene(registry, scene_id="frozen-check")
        with pytest.raises(Exception):  # noqa: B017 - dataclass frozen error type
            record.scene_id = "changed"

    def test_stac_item_cannot_be_mutated_through_the_returned_record(self):
        registry = make_registry()
        record = register_scene(registry, scene_id="immutable-check")
        with pytest.raises(TypeError):
            record.stac_item["id"] = "TAMPERED"

    def test_stac_item_nested_dicts_cannot_be_mutated_either(self):
        registry = make_registry()
        record = register_scene(registry, scene_id="nested-immutable-check")
        with pytest.raises(TypeError):
            record.stac_item["properties"]["eo:cloud_cover"] = 0.0
        with pytest.raises(TypeError):
            record.stac_item["assets"]["data"]["href"] = "https://tampered.example/"

    def test_registered_stac_item_is_unchanged_after_a_mutation_attempt(self):
        registry = make_registry()
        record = register_scene(registry, scene_id="unchanged-check")
        try:
            record.stac_item["id"] = "TAMPERED"
        except TypeError:
            pass
        assert registry.get("unchanged-check").stac_item["id"] == "unchanged-check"


class TestMediaType:
    def test_defaults_to_image_png(self):
        registry = make_registry()
        record = register_scene(registry, scene_id="default-media-type")
        assert record.media_type == "image/png"

    def test_explicit_media_type_is_honored(self):
        registry = make_registry()
        record = register_scene(registry, scene_id="tiff-scene", media_type="image/tiff")
        assert record.media_type == "image/tiff"


class TestRetentionWithoutBlobStore:
    """`SceneRegistry(blob_store=None)` -- the default -- must behave
    exactly as it did before blob storage existed."""

    def test_default_construction_has_no_blob_store(self):
        registry = SceneRegistry()
        assert registry.blob_store is None

    def test_register_reports_not_retained(self):
        registry = make_registry()
        record = register_scene(registry, scene_id="unretained")
        assert record.retained is False

    def test_load_raises_scene_not_retained(self):
        registry = make_registry()
        register_scene(registry, scene_id="unretained")
        with pytest.raises(SceneNotRetained):
            registry.load("unretained")

    def test_load_unknown_scene_raises_keyerror_not_scene_not_retained(self):
        registry = make_registry()
        with pytest.raises(KeyError):
            registry.load("nope")

    def test_existing_callers_are_unaffected(self):
        """The exact call shape every pre-existing test in this file (and
        capture.py) uses must keep working unchanged."""
        registry = SceneRegistry()
        record = register_scene(registry, data=b"legacy-call-shape", scene_id="legacy")
        assert record.sha256 == register_scene(
            SceneRegistry(), data=b"legacy-call-shape", scene_id="other"
        ).sha256
        assert record.retained is False


class TestRetentionWithBlobStore:
    def test_register_writes_through_and_reports_retained(self):
        blob_store = MemoryBlobStore()
        registry = SceneRegistry(blob_store=blob_store)
        record = register_scene(registry, data=b"retained-bytes", scene_id="retained-1")

        assert record.retained is True
        assert blob_store.has(record.sha256)
        assert blob_store.get(record.sha256) == b"retained-bytes"

    def test_load_returns_the_registered_bytes(self):
        blob_store = MemoryBlobStore()
        registry = SceneRegistry(blob_store=blob_store)
        register_scene(registry, data=b"loadable-bytes", scene_id="loadable")

        assert registry.load("loadable") == b"loadable-bytes"

    def test_load_matches_verify(self):
        blob_store = MemoryBlobStore()
        registry = SceneRegistry(blob_store=blob_store)
        register_scene(registry, data=b"consistency-check", scene_id="consistent")

        data = registry.load("consistent")
        assert registry.verify("consistent", data) is True

    def test_dedup_by_hash_still_rejects_with_retention_on(self):
        blob_store = MemoryBlobStore()
        registry = SceneRegistry(blob_store=blob_store)
        register_scene(registry, data=b"dup-bytes", scene_id="s1")
        with pytest.raises(DuplicateScene):
            register_scene(registry, data=b"dup-bytes", scene_id="s2")

    def test_dedup_by_scene_id_still_rejects_with_retention_on(self):
        blob_store = MemoryBlobStore()
        registry = SceneRegistry(blob_store=blob_store)
        register_scene(registry, data=b"bytes-a", scene_id="dup-id")
        with pytest.raises(DuplicateScene):
            register_scene(registry, data=b"bytes-b", scene_id="dup-id")

    def test_registering_identical_bytes_under_a_rejected_duplicate_does_not_double_store(self):
        """A DuplicateScene doesn't write a second copy -- put() would be
        idempotent anyway, but register() should never even attempt it
        since it raises before touching the blob store."""
        blob_store = MemoryBlobStore()
        registry = SceneRegistry(blob_store=blob_store)
        register_scene(registry, data=b"once-only", scene_id="s1")
        with pytest.raises(DuplicateScene):
            register_scene(registry, data=b"once-only", scene_id="s2")
        assert registry.load("s1") == b"once-only"

    def test_load_propagates_blob_not_found_if_storage_lost_the_bytes(self):
        """Defensive: if the underlying store somehow no longer has bytes
        for a hash the registry believes are retained (e.g. an external
        deletion), `load` must surface that rather than hide it."""
        blob_store = MemoryBlobStore()
        registry = SceneRegistry(blob_store=blob_store)
        record = register_scene(registry, data=b"will-vanish", scene_id="vanishing")
        del blob_store._blobs[record.sha256]  # noqa: SLF001 - simulating storage-layer data loss

        with pytest.raises(BlobNotFound):
            registry.load("vanishing")


class TestRegistryStateIsNotInjectable:
    def test_lookup_dicts_are_not_constructor_arguments(self):
        with pytest.raises(TypeError):
            SceneRegistry(_by_id={"fake": object()})  # type: ignore[call-arg]

    def test_lookup_dicts_are_not_in_repr(self):
        registry = make_registry()
        register_scene(registry, scene_id="repr-check")
        rendered = repr(registry)
        assert "_by_id" not in rendered
        assert "_by_hash" not in rendered


class TestConcurrency:
    """register()'s dedup check and the two dict writes are not atomic.
    Dormant today (no endpoint wires this in yet), but it is the
    evidentiary anchor for imagery, so concurrent registrations must never
    let two threads both "win" a duplicate scene_id, and every successful
    registration must leave _by_id/_by_hash consistent with each other.

    The race window (hash the bytes, *then* check-and-insert) is narrow
    enough that CPython's GIL scheduling can hide it under default
    settings even with a dozen threads. Shrinking the GIL switch interval
    for the duration of this test makes it reliably exercise the race
    instead of passing by luck -- verified empirically: without this, the
    unfixed code passed most runs and only occasionally leaked a
    duplicate; with it, the unfixed code fails every run.
    """

    @pytest.fixture(autouse=True)
    def _aggressive_gil_switching(self):
        original = sys.getswitchinterval()
        sys.setswitchinterval(1e-6)
        try:
            yield
        finally:
            sys.setswitchinterval(original)

    def test_concurrent_registration_dedupes_distinct_and_duplicate_ids(self):
        registry = make_registry()
        n_threads = 12
        n_distinct = 5
        barrier = threading.Barrier(n_threads)
        results_lock = threading.Lock()
        successes: list[str] = []
        duplicate_errors = 0

        def worker(thread_idx: int) -> None:
            nonlocal duplicate_errors
            scene_id = f"scene-{thread_idx % n_distinct}"
            data = f"bytes-for-{scene_id}".encode()
            barrier.wait()
            try:
                register_scene(registry, data=data, scene_id=scene_id)
            except DuplicateScene:
                with results_lock:
                    duplicate_errors += 1
            else:
                with results_lock:
                    successes.append(scene_id)

        with ThreadPoolExecutor(max_workers=n_threads) as pool:
            futures = [pool.submit(worker, i) for i in range(n_threads)]
            for f in futures:
                f.result()

        # Exactly one success per distinct scene_id; every other attempt
        # (targeting an id someone else already won) raised DuplicateScene.
        assert sorted(successes) == sorted({f"scene-{i}" for i in range(n_distinct)})
        assert duplicate_errors == n_threads - n_distinct

        assert len(registry._by_id) == n_distinct
        assert len(registry._by_hash) == n_distinct
        for record in registry._by_id.values():
            assert registry._by_hash[record.sha256] is record
