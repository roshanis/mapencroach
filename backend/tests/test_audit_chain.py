import dataclasses

from mapencroach.audit.chain import GENESIS_HASH, append_entry, compute_row_hash, verify_chain


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
