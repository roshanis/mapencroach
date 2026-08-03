"""Object storage for scene artifacts: local directory now, S3/MinIO in production.

The pilot's evidence rule doesn't care where bytes live — hashes are
computed before storage either way — but production needs MinIO with
object-lock (WORM) rather than a server's disk. This module keeps the
pipeline agnostic: a store puts bytes under a key and returns a URI.
boto3 is imported lazily so the S3 backend is an optional extra
(mapencroach[s3]); the local backend has no dependencies and is what
tests exercise.
"""

import os
from pathlib import Path
from typing import Protocol


class ObjectStore(Protocol):
    def put_file(self, source: Path, key: str) -> str:
        """Store the file under `key`; returns the canonical URI."""
        ...

    def put_bytes(self, data: bytes, key: str) -> str: ...


class LocalObjectStore:
    """Filesystem-backed store (dev/pilot single-server deployments)."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _target(self, key: str) -> Path:
        target = (self.root / key).resolve()
        if not target.is_relative_to(self.root.resolve()):
            raise ValueError(f"object key escapes the store root: {key!r}")
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    def put_file(self, source: Path, key: str) -> str:
        target = self._target(key)
        target.write_bytes(Path(source).read_bytes())
        return target.as_uri()

    def put_bytes(self, data: bytes, key: str) -> str:
        target = self._target(key)
        target.write_bytes(data)
        return target.as_uri()


class S3ObjectStore:
    """S3/MinIO-backed store. Requires the mapencroach[s3] extra (boto3).

    Endpoint/credentials come from the standard AWS environment
    variables (AWS_S3_ENDPOINT via endpoint_url for MinIO). Object-lock
    (WORM) is bucket configuration, not client code — enable it on the
    evidence bucket at provisioning time.
    """

    def __init__(self, bucket: str, prefix: str = "", client=None) -> None:
        if client is None:
            try:
                import boto3
            except ImportError as exc:  # pragma: no cover - depends on extras
                raise RuntimeError(
                    "S3 object storage requires boto3: pip install 'mapencroach[s3]'"
                ) from exc
            endpoint = os.environ.get("AWS_S3_ENDPOINT")
            client = boto3.client("s3", endpoint_url=endpoint) if endpoint else boto3.client("s3")
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self._client = client

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{key}" if self.prefix else key

    def put_file(self, source: Path, key: str) -> str:
        full_key = self._key(key)
        self._client.upload_file(str(source), self.bucket, full_key)
        return f"s3://{self.bucket}/{full_key}"

    def put_bytes(self, data: bytes, key: str) -> str:
        full_key = self._key(key)
        self._client.put_object(Bucket=self.bucket, Key=full_key, Body=data)
        return f"s3://{self.bucket}/{full_key}"


def object_store_from_env() -> ObjectStore | None:
    """Build a store from MAPENCROACH_OBJECT_STORE_URL.

    "s3://bucket[/prefix]" selects S3/MinIO; any other non-empty value
    is a local directory path. Unset means no object store (the
    pipeline keeps artifacts in its output directory).
    """
    url = os.environ.get("MAPENCROACH_OBJECT_STORE_URL", "").strip()
    if not url:
        return None
    if url.startswith("s3://"):
        bucket, _, prefix = url.removeprefix("s3://").partition("/")
        if not bucket:
            raise ValueError(f"invalid object store URL: {url!r}")
        return S3ObjectStore(bucket, prefix)
    return LocalObjectStore(url)
