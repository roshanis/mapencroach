import dataclasses
from datetime import UTC, datetime

import pytest

from mapencroach.audit.chain import (
    GENESIS_HASH,
    append_entry,
    compute_row_hash,
    current_head,
    verify_chain,
)


def build_chain(payloads):
    chain = []
    for p in payloads:
        append_entry(chain, p)
    return chain


class TestComputeRowHash:
    def test_is_deterministic(self):
        payload = {"actor": "tahsildar-1", "action": "case.transition", "object": "case-9"}
        assert compute_row_hash(payload, GENESIS_HASH) == compute_row_hash(payload, GENESIS_HASH)

    def test_key_order_does_not_matter(self):
        a = {"actor": "x", "action": "y"}
        b = {"action": "y", "actor": "x"}
        assert compute_row_hash(a, GENESIS_HASH) == compute_row_hash(b, GENESIS_HASH)

    def test_different_payload_changes_hash(self):
        base = {"actor": "x", "action": "alert.dismiss"}
        tampered = {"actor": "x", "action": "alert.confirm"}
        assert compute_row_hash(base, GENESIS_HASH) != compute_row_hash(tampered, GENESIS_HASH)

    def test_different_prev_hash_changes_hash(self):
        payload = {"actor": "x"}
        assert compute_row_hash(payload, GENESIS_HASH) != compute_row_hash(payload, "a" * 64)

    def test_typed_value_and_its_string_rendering_hash_differently(self):
        # Canonicalization must be injective: a datetime payload and a
        # payload where that same field has already been stringified must
        # not collide, or one could be silently swapped for the other
        # without breaking verification.
        typed = compute_row_hash({"t": datetime(2026, 1, 1, tzinfo=UTC)}, GENESIS_HASH)
        stringified = compute_row_hash({"t": str(datetime(2026, 1, 1, tzinfo=UTC))}, GENESIS_HASH)
        assert typed != stringified

    def test_non_string_keys_raise_a_clear_error_instead_of_crashing(self):
        with pytest.raises(TypeError, match="must be strings"):
            compute_row_hash({1: "a", "b": "c"}, GENESIS_HASH)

    def test_non_string_keys_in_nested_payload_are_also_rejected(self):
        with pytest.raises(TypeError, match="must be strings"):
            compute_row_hash({"outer": {2: "nested"}}, GENESIS_HASH)

    def test_list_values_are_canonicalized_recursively(self):
        matching = compute_row_hash({"tags": ["a", "b"]}, GENESIS_HASH)
        same_again = compute_row_hash({"tags": ["a", "b"]}, GENESIS_HASH)
        different = compute_row_hash({"tags": ["a", "c"]}, GENESIS_HASH)
        assert matching == same_again
        assert matching != different


class TestVerifyChain:
    def test_empty_chain_verifies(self):
        assert verify_chain([]).ok

    def test_well_formed_chain_verifies(self):
        chain = build_chain([{"n": i} for i in range(5)])
        result = verify_chain(chain)
        assert result.ok
        assert result.first_bad_index is None

    def test_first_entry_links_to_genesis(self):
        chain = build_chain([{"n": 0}])
        assert chain[0].prev_hash == GENESIS_HASH

    def test_tampered_payload_is_detected_at_index(self):
        chain = build_chain([{"n": i} for i in range(5)])
        chain[2] = dataclasses.replace(chain[2], payload={"n": 999})
        result = verify_chain(chain)
        assert not result.ok
        assert result.first_bad_index == 2

    def test_reordered_entries_are_detected(self):
        chain = build_chain([{"n": i} for i in range(3)])
        result = verify_chain([chain[0], chain[2], chain[1]])
        assert not result.ok
        assert result.first_bad_index == 1

    def test_deleted_middle_entry_is_detected(self):
        chain = build_chain([{"n": i} for i in range(3)])
        result = verify_chain([chain[0], chain[2]])
        assert not result.ok
        assert result.first_bad_index == 1

    def test_tail_truncation_is_invisible_without_an_expected_anchor(self):
        # This documents the limitation described in the module docstring:
        # a prefix of a valid chain is itself a valid chain, so plain
        # verify_chain(entries) cannot see that rows were dropped off the
        # end -- exactly the rows that would show what a tamperer just did.
        chain = build_chain([{"n": i} for i in range(5)])
        truncated = chain[:3]
        assert verify_chain(truncated).ok

    def test_tail_truncation_is_detected_with_expected_head(self):
        chain = build_chain([{"n": i} for i in range(5)])
        head = current_head(chain)
        truncated = chain[:3]
        result = verify_chain(truncated, expected_head=head)
        assert not result.ok
        assert result.first_bad_index == 3

    def test_tail_truncation_is_detected_with_expected_length(self):
        chain = build_chain([{"n": i} for i in range(5)])
        truncated = chain[:3]
        result = verify_chain(truncated, expected_length=len(chain))
        assert not result.ok
        assert result.first_bad_index == 3

    def test_full_chain_passes_expected_head_and_length(self):
        chain = build_chain([{"n": i} for i in range(5)])
        result = verify_chain(chain, expected_head=current_head(chain), expected_length=5)
        assert result.ok

    def test_empty_chain_head_is_genesis(self):
        assert current_head([]) == GENESIS_HASH

    def test_forked_chain_with_a_different_second_entry_fails_expected_head(self):
        # Same first entry, two different possible second entries appended
        # on top of it -- a fork. Internal verification alone can't tell
        # which branch (if either) is the "real" one; pinning the expected
        # head catches a caller being handed the wrong branch.
        chain = build_chain([{"n": 0}])
        branch_a = list(chain)
        append_entry(branch_a, {"n": "a"})
        branch_b = list(chain)
        append_entry(branch_b, {"n": "b"})

        assert verify_chain(branch_a).ok
        assert verify_chain(branch_b).ok
        assert current_head(branch_a) != current_head(branch_b)

        result = verify_chain(branch_b, expected_head=current_head(branch_a))
        assert not result.ok
