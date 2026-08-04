"""Hash-chained audit entries -- tamper-evident, append-only.

Every entry links to the previous entry's row_hash, so editing, reordering,
or deleting an entry from the *interior* of the chain breaks verification
from that point on. Payloads are canonicalized before hashing into an
injective constructor-tagged encoding: keys are sorted (so hashing is
independent of dict ordering), every node carries its category tag, and
non-JSON-native values carry their type name -- so, e.g., a `datetime`,
the string it renders as, and a hand-crafted dict imitating the encoder's
own tag wrapper all canonicalize to different bytes.

Internal verification alone cannot see a dropped *tail*: any prefix of a
valid chain re-verifies as a valid (shorter) chain, so an actor with
delete access can remove the most recently appended rows -- exactly the
ones that would show what they just did -- and `verify_chain(entries)`
would still report `ok=True`. Callers that need to catch this must record
the chain's head hash and length somewhere the chain itself cannot rewrite
(see `current_head`) and pass them as `expected_head` / `expected_length`
to `verify_chain`.

This module has no secret key and no external anchor. The guarantee it
provides is that entries can't be silently *edited in place* without
detection, not that the log can't be regenerated: a writer able to rewrite
every row after a tampered entry can recompute the whole suffix and
produce an internally consistent chain with a different head. Verification
only catches that if the true head was pinned externally (see
`expected_head`) before the tampering happened.
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


def _canonicalize(value: Any) -> Any:
    """Recursively convert `value` into a JSON-safe, injective encoding.

    Every node is wrapped in a constructor tag -- ["map", ...], ["list",
    ...], ["val", <scalar>], or ["obj", <type name>, <str form>] -- so no
    plain payload value can imitate the encoding of a differently-typed
    one: a genuine dict or list shaped like a tag wrapper is itself
    wrapped in its own constructor first, and therefore never collides
    with the node it mimics. Map entries are emitted as explicitly sorted
    [key, value] pairs, keeping hashes independent of dict ordering.

    Two deliberate equivalences, both matching what JSON itself can
    express: tuples normalize to their list form (JSON has one sequence
    type, so a payload that round-trips through JSON storage must
    re-verify against the same hash), and any non-JSON-native leaf is
    reduced to its type name plus `str()` form under the "obj" tag (which
    still keeps, e.g., a `datetime` distinct from the plain string it
    renders as).

    Dict keys must be strings -- a non-string key raises TypeError naming
    the offending key, rather than surfacing as an opaque failure from
    `json.dumps` when it tries to compare mismatched key types mid-write.
    """
    if isinstance(value, Mapping):
        for key in value:
            if not isinstance(key, str):
                raise TypeError(
                    f"audit payload keys must be strings, got {key!r} "
                    f"({type(key).__name__})"
                )
        return ["map", [[key, _canonicalize(value[key])] for key in sorted(value)]]
    if isinstance(value, (list, tuple)):
        return ["list", [_canonicalize(item) for item in value]]
    if value is None or isinstance(value, (str, int, float, bool)):
        return ["val", value]
    return ["obj", type(value).__name__, str(value)]


def compute_row_hash(payload: Mapping[str, Any], prev_hash: str) -> str:
    canonical = json.dumps(_canonicalize(payload), sort_keys=True, separators=(",", ":"))
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


def _canonicalize_legacy(value: Any) -> Any:
    """The retired version-1 canonicalization, kept only so state files
    written before the constructor-tagged encoding can be verified during
    migration (see `mapencroach.persistence`). Not injective -- a
    hand-crafted {"__type__": ...} dict imitates a typed value, which is
    why it was replaced -- but a chain written under it can only be
    checked under it.
    """
    if isinstance(value, Mapping):
        canonical = {}
        for key, sub in value.items():
            if not isinstance(key, str):
                raise TypeError(
                    f"audit payload keys must be strings, got {key!r} "
                    f"({type(key).__name__})"
                )
            canonical[key] = _canonicalize_legacy(sub)
        return canonical
    if isinstance(value, (list, tuple)):
        return [_canonicalize_legacy(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return {"__type__": type(value).__name__, "value": str(value)}


def compute_row_hash_legacy(payload: Mapping[str, Any], prev_hash: str) -> str:
    """Row hash under the retired version-1 canonicalization. Used only to
    verify pre-migration state files; new hashes always come from
    `compute_row_hash`."""
    canonical = json.dumps(
        _canonicalize_legacy(payload), sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(f"{prev_hash}:{canonical}".encode()).hexdigest()


def verify_legacy_chain(entries: Sequence[AuditEntry]) -> ChainVerification:
    """`verify_chain` for chains hashed under the version-1 encoding.

    No head/length anchors: this exists solely for one-time migration of a
    persisted version-1 state file, where the file itself is the only
    anchor available.
    """
    prev_hash = GENESIS_HASH
    for index, entry in enumerate(entries):
        if entry.prev_hash != prev_hash:
            return ChainVerification(ok=False, first_bad_index=index)
        if compute_row_hash_legacy(entry.payload, entry.prev_hash) != entry.row_hash:
            return ChainVerification(ok=False, first_bad_index=index)
        prev_hash = entry.row_hash
    return ChainVerification(ok=True)


def rehash_chain(entries: Sequence[AuditEntry]) -> list[AuditEntry]:
    """Rebuild a chain's links and hashes under the current encoding,
    preserving payload content and order.

    Migration helper: verify the chain with `verify_legacy_chain` FIRST --
    rehashing takes the payloads on faith, so rehashing an unverified
    chain would launder tampering into a freshly consistent chain. The
    head hash changes; any externally recorded anchor (see `current_head`)
    must be re-captured after migration.
    """
    migrated: list[AuditEntry] = []
    for entry in entries:
        append_entry(migrated, entry.payload)
    return migrated


def current_head(entries: Sequence[AuditEntry]) -> str:
    """Return the chain's current anchor: the last entry's row_hash, or
    GENESIS_HASH if `entries` is empty.

    Callers that want tail-truncation detection should record this value
    (with `len(entries)`) somewhere the chain itself can't rewrite -- a
    separate log, a config row, an external attestation -- and pass it
    back in as `expected_head` / `expected_length` on a later
    `verify_chain` call.
    """
    return entries[-1].row_hash if entries else GENESIS_HASH


def verify_chain(
    entries: Sequence[AuditEntry],
    *,
    expected_head: str | None = None,
    expected_length: int | None = None,
) -> ChainVerification:
    """Verify internal chain consistency.

    With no keyword arguments this only checks that `entries` is
    internally well-formed -- each entry links to the previous one and its
    hash matches its payload. That check cannot detect a truncated tail:
    a prefix of a valid chain is itself internally well-formed. Pass
    `expected_head` and/or `expected_length` (captured earlier via
    `current_head` / `len`) to also require that `entries` is the *whole*
    chain, not a dropped-tail prefix of it.
    """
    prev_hash = GENESIS_HASH
    for index, entry in enumerate(entries):
        if entry.prev_hash != prev_hash:
            return ChainVerification(ok=False, first_bad_index=index)
        if compute_row_hash(entry.payload, entry.prev_hash) != entry.row_hash:
            return ChainVerification(ok=False, first_bad_index=index)
        prev_hash = entry.row_hash

    if expected_length is not None and len(entries) != expected_length:
        return ChainVerification(ok=False, first_bad_index=min(len(entries), expected_length))
    if expected_head is not None and prev_hash != expected_head:
        return ChainVerification(ok=False, first_bad_index=len(entries))

    return ChainVerification(ok=True)
