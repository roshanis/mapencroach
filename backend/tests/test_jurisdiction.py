import pytest

from mapencroach.domain.jurisdiction import JurisdictionTree

# (id, parent_id): state -> two districts -> taluks
ROWS = [
    ("state", None),
    ("dist-a", "state"),
    ("dist-b", "state"),
    ("taluk-a1", "dist-a"),
    ("taluk-a2", "dist-a"),
    ("village-a1x", "taluk-a1"),
]


@pytest.fixture
def tree() -> JurisdictionTree:
    return JurisdictionTree(ROWS)


class TestIsWithin:
    def test_descendant_is_within_ancestor(self, tree):
        assert tree.is_within("dist-a", "village-a1x")

    def test_node_is_within_itself(self, tree):
        assert tree.is_within("taluk-a1", "taluk-a1")

    def test_sibling_branch_is_not_within(self, tree):
        assert not tree.is_within("dist-b", "taluk-a1")

    def test_ancestor_is_not_within_descendant(self, tree):
        assert not tree.is_within("taluk-a1", "dist-a")

    def test_unknown_node_raises(self, tree):
        with pytest.raises(KeyError):
            tree.is_within("dist-a", "nope")


class TestScopeIds:
    def test_scope_includes_self_and_all_descendants(self, tree):
        assert tree.scope_ids("dist-a") == {"dist-a", "taluk-a1", "taluk-a2", "village-a1x"}

    def test_leaf_scope_is_only_itself(self, tree):
        assert tree.scope_ids("village-a1x") == {"village-a1x"}

    def test_root_scope_is_everything(self, tree):
        assert tree.scope_ids("state") == {r[0] for r in ROWS}


class TestValidation:
    def test_cycle_is_rejected(self):
        with pytest.raises(ValueError, match="cycle"):
            JurisdictionTree([("a", "b"), ("b", "a")])

    def test_multiple_roots_are_rejected(self):
        with pytest.raises(ValueError, match="root"):
            JurisdictionTree([("a", None), ("b", None)])

    def test_missing_root_is_rejected(self):
        # Single-node case: "ghost" is both a dangling parent reference and
        # the reason there is zero valid roots. The dangling-parent check
        # now catches this explicitly and more specifically -- see
        # test_dangling_parent_is_rejected and
        # test_dangling_parent_with_a_valid_root_elsewhere_is_rejected below
        # -- before the generic root-count check would otherwise run.
        with pytest.raises(ValueError, match="unknown parent"):
            JurisdictionTree([("a", "ghost")])

    def test_dangling_parent_with_a_valid_root_elsewhere_is_rejected(self):
        # A single legitimate root exists (so the old code's only check --
        # "is there exactly one root?" -- passed), but "village" points at
        # a parent that was never declared, silently orphaning it (and
        # anything scoped under it) from every caller's visibility scope.
        with pytest.raises(ValueError, match="village.*ghost-typo"):
            JurisdictionTree([("state", None), ("dist", "state"), ("village", "ghost-typo")])

    def test_duplicate_ids_are_rejected(self):
        with pytest.raises(ValueError, match="duplicate"):
            JurisdictionTree([("a", None), ("b", "a"), ("b", "a")])

    def test_empty_tree_is_rejected(self):
        with pytest.raises(ValueError, match="root"):
            JurisdictionTree([])

    def test_dangling_parent_is_rejected(self):
        with pytest.raises(ValueError, match="orphan") as exc_info:
            JurisdictionTree(
                [
                    ("state", None),
                    ("dist-a", "state"),
                    ("orphan", "no-such-parent"),
                ]
            )
        assert "no-such-parent" in str(exc_info.value)

    def test_valid_multi_level_tree_still_constructs(self):
        tree = JurisdictionTree(ROWS)
        assert tree.scope_ids("state") == {r[0] for r in ROWS}
