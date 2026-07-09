"""Hash-chained audit entries — tamper-evident, append-only.

Every mutation and evidence read links to the previous entry's hash;
altering, deleting, or reordering any past entry breaks verification
from that point on. Payloads are canonicalized (sorted keys) so hashes
are independent of dict ordering.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

GENESIS_HASH = "0" * 64


@dataclass(frozen=True)
class AuditEntry:
    payload: Mapping[str, Any]
    prev_hash: str
    row_hash: str


@dataclass(frozen=True)
class ChainVerification:
    ok: bool
    first_bad_index: int | None = None


def compute_row_hash(payload: Mapping[str, Any], prev_hash: str) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(f"{prev_hash}:{canonical}".encode()).hexdigest()


def append_entry(chain: list[AuditEntry], payload: Mapping[str, Any]) -> AuditEntry:
    prev_hash = chain[-1].row_hash if chain else GENESIS_HASH
    entry = AuditEntry(
        payload=dict(payload),
        prev_hash=prev_hash,
        row_hash=compute_row_hash(payload, prev_hash),
    )
    chain.append(entry)
    return entry


def verify_chain(entries: Sequence[AuditEntry]) -> ChainVerification:
    prev_hash = GENESIS_HASH
    for index, entry in enumerate(entries):
        if entry.prev_hash != prev_hash:
            return ChainVerification(ok=False, first_bad_index=index)
        if compute_row_hash(entry.payload, entry.prev_hash) != entry.row_hash:
            return ChainVerification(ok=False, first_bad_index=index)
        prev_hash = entry.row_hash
    return ChainVerification(ok=True)
