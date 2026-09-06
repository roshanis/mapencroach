"""Content-addressed storage for the bytes behind a registered scene.

`SceneRegistry.register` sha256-hashes every scene the moment it is
ingested; that hash is only worth anything as an evidence anchor if the
bytes it describes are still retrievable later, and if a payload that
somehow corrupted on disk can never quietly pass as valid. This module is
where that guarantee actually lives: the sha256 IS the storage key, so
storage cannot disagree with the registry about which bytes are which,
and both `put` and `get` recompute the hash against the key rather than
trusting whatever is on disk (or in memory).

Two implementations ship here:

- `MemoryBlobStore` -- ephemeral, for tests and the demo. Nothing survives
  a process restart, which is fine for a store that never claims
  durability in the first place.
- `FileBlobStore` -- durable, local-filesystem storage. Blobs are fanned
  out by hash prefix (`<root>/<ab>/<cd>/<sha256>`) so a large evidence
  archive never dumps tens of thousands of files into one directory, and
  every write lands via write-then-rename so a crash mid-write can never
  leave a corrupt (but readable) blob at its final, addressable path.

`build_blob_store()` selects `FileBlobStore` rooted at
`MAPENCROACH_BLOB_ROOT` (default `./data/scenes`, already covered by the
repo's `data/` gitignore entry) -- the same env-driven-with-a-safe-default
pattern `providers.build_provider()` uses.
"""

import contextlib
import hashlib
import os
import tempfile
from pathlib import Path
from typing import Protocol


class BlobNotFound(Exception):
    """Raised by `BlobStore.get` when no blob is stored under that hash."""


class BlobIntegrityError(Exception):
    """Raised when bytes read back from storage do not hash to their key.

    This is the whole point of hashing on ingest: a payload that silently
    corrupted at rest (bit rot, a bad disk, a truncated write that somehow
    still reached its final path) must never be handed back to a caller
    as though it were still the bytes that were registered. Raising here
    is what makes that impossible.
    """


class BlobStore(Protocol):
    def put(self, data: bytes) -> str:
        """Store `data`, returning its sha256 hex digest. Idempotent:
        storing the same bytes twice is a no-op the second time and
        returns the same digest."""
        ...

    def get(self, sha256: str) -> bytes:
        """Return the bytes stored under `sha256`.

        Raises `BlobNotFound` if nothing is stored under that key, or
        `BlobIntegrityError` if what's stored no longer hashes to it.
        """
        ...

    def has(self, sha256: str) -> bool:
        """Whether a blob is stored under `sha256`, without reading it."""
        ...


class MemoryBlobStore:
    """In-process, non-durable `BlobStore`. Tests and ephemeral demos only."""

    def __init__(self) -> None:
        self._blobs: dict[str, bytes] = {}

    def put(self, data: bytes) -> str:
        sha256 = hashlib.sha256(data).hexdigest()
        self._blobs[sha256] = bytes(data)
        return sha256

    def get(self, sha256: str) -> bytes:
        try:
            data = self._blobs[sha256]
        except KeyError:
            raise BlobNotFound(sha256) from None
        actual = hashlib.sha256(data).hexdigest()
        if actual != sha256:
            raise BlobIntegrityError(
                f"blob {sha256!r} is corrupt: recomputed hash is {actual!r}"
            )
        return data

    def has(self, sha256: str) -> bool:
        return sha256 in self._blobs


class FileBlobStore:
    """Durable, local-filesystem `BlobStore`.

    Blobs live at `<root>/<sha256[:2]>/<sha256[2:4]>/<sha256>` -- fanning
    out by hash prefix keeps any one directory from accumulating tens of
    thousands of entries as the evidence archive grows, and since the
    fan-out key is a deterministic function of the content hash there's
    nothing extra to track to find a blob again.

    Every write goes to a temp file in the same target directory first,
    is fsync'd, is verified by re-hashing what actually landed on disk,
    and only then is atomically renamed into its final, addressable path
    via `os.replace`. A crash or exception at any point before that
    rename leaves at most an orphaned temp file -- the final path never
    exists until the bytes at that path are confirmed correct, so `get`
    can never observe a partially-written or corrupted blob as valid.
    """

    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)

    def _path_for(self, sha256: str) -> Path:
        return self._root / sha256[:2] / sha256[2:4] / sha256

    def put(self, data: bytes) -> str:
        sha256 = hashlib.sha256(data).hexdigest()
        final_path = self._path_for(sha256)
        if final_path.exists():
            # Idempotent -- but only once we have checked that what is on
            # disk really is this content. Returning success on the bare
            # existence of the path would report bytes stored that we
            # never stored: if the on-disk copy has since been corrupted
            # (bit rot, a truncated write from an earlier crash, or
            # tampering), the caller is holding the ONLY good copy and we
            # would throw it away while telling them it was safe. Read-side
            # verification would still refuse to serve the corrupt blob, so
            # nothing wrong is ever handed out as evidence -- but the
            # evidence itself would be permanently lost at the one moment
            # it could have been repaired.
            #
            # Costs a read of the existing blob on every repeat put. That is
            # the same trade this class already makes on write and on read,
            # and puts are rare (one per capture) while the bytes are
            # court evidence.
            existing = final_path.read_bytes()
            if hashlib.sha256(existing).hexdigest() == sha256:
                return sha256
            # Falls through and rewrites, repairing the blob from the
            # genuine bytes we were just handed.

        final_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            dir=final_path.parent, prefix=f".{sha256}.", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())

            # Verify on write: recompute the hash of what actually landed
            # on disk -- not just the `data` we were handed in memory --
            # before it ever becomes visible under its content address.
            written = Path(tmp_name).read_bytes()
            actual = hashlib.sha256(written).hexdigest()
            if actual != sha256:
                raise BlobIntegrityError(
                    f"write verification failed for blob {sha256!r}: "
                    f"bytes on disk hash to {actual!r}"
                )

            os.replace(tmp_name, final_path)
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(tmp_name)
            raise
        return sha256

    def get(self, sha256: str) -> bytes:
        path = self._path_for(sha256)
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            raise BlobNotFound(sha256) from None
        actual = hashlib.sha256(data).hexdigest()
        if actual != sha256:
            raise BlobIntegrityError(
                f"blob {sha256!r} is corrupt: recomputed hash is {actual!r}"
            )
        return data

    def has(self, sha256: str) -> bool:
        return self._path_for(sha256).exists()


_DEFAULT_BLOB_ROOT = "data/scenes"


def build_blob_store() -> BlobStore:
    """Choose a `BlobStore` from the environment.

    `MAPENCROACH_BLOB_ROOT` sets the root directory for a `FileBlobStore`;
    unset, it defaults to `./data/scenes` (relative to the process's
    working directory), which the repo's top-level `.gitignore` already
    excludes via its `data/` entry. There is no env-driven switch to
    `MemoryBlobStore` -- that class exists for tests to opt into directly,
    not for production configuration, since its contents never survive a
    restart.
    """
    root = os.environ.get("MAPENCROACH_BLOB_ROOT", _DEFAULT_BLOB_ROOT)
    return FileBlobStore(root)
