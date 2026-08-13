"""Jurisdiction tree: state -> district -> taluk -> village.

Backs row-level scoping — every query is filtered to the caller's subtree,
so scoping bugs here are authorization bugs. Keep this exhaustively tested.

Construction validates the whole row set before anything is usable: every
non-root parent_id must resolve to a known node id, and the parent links
must form a single tree with no cycles. A dangling parent_id is rejected
rather than silently dropping that subtree out of every caller's scope.
"""

from collections.abc import Iterable


class JurisdictionTree:
    def __init__(self, rows: Iterable[tuple[str, str | None]]) -> None:
        rows = list(rows)
        ids = [node_id for node_id, _ in rows]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate jurisdiction ids")

        self._parent: dict[str, str | None] = dict(rows)
        self._children: dict[str, list[str]] = {}
        for node_id, parent_id in rows:
            if parent_id is not None:
                self._children.setdefault(parent_id, []).append(node_id)

        self._reject_dangling_parents(rows)
        self._reject_cycles()

        roots = [node_id for node_id, parent_id in rows if parent_id is None]
        if len(roots) != 1:
            raise ValueError(f"expected exactly one root jurisdiction, found {len(roots)}")
        self._root_id = roots[0]

    @property
    def root_id(self) -> str:
        """The single root, whose scope is every node in the tree.

        Callers that need "is this a jurisdiction we know about at all?"
        must ask for `scope_ids(root_id)` rather than the scope of some
        particular authority. The two coincide only while the tree holds
        exactly one authority; once it holds siblings (a second state, a
        second development authority) an authority's scope is a strict
        subset, and using it as the known-id set silently rejects every
        node outside that one branch.
        """
        return self._root_id

    def _reject_dangling_parents(self, rows: list[tuple[str, str | None]]) -> None:
        known = set(self._parent)
        for node_id, parent_id in rows:
            if parent_id is not None and parent_id not in known:
                raise ValueError(
                    f"jurisdiction {node_id!r} references unknown parent {parent_id!r}"
                )

    def _reject_cycles(self) -> None:
        for start in self._parent:
            seen = {start}
            current = self._parent[start]
            while current is not None and current in self._parent:
                if current in seen:
                    raise ValueError(f"cycle detected in jurisdiction tree at {current!r}")
                seen.add(current)
                current = self._parent[current]

    def _require(self, node_id: str) -> None:
        if node_id not in self._parent:
            raise KeyError(node_id)

    def is_within(self, ancestor_id: str, node_id: str) -> bool:
        """True if node_id is ancestor_id or lies in its subtree."""
        self._require(ancestor_id)
        self._require(node_id)
        current: str | None = node_id
        while current is not None:
            if current == ancestor_id:
                return True
            current = self._parent.get(current)
        return False

    def scope_ids(self, node_id: str) -> set[str]:
        """node_id plus every descendant — the caller's visibility scope."""
        self._require(node_id)
        scope: set[str] = set()
        stack = [node_id]
        while stack:
            current = stack.pop()
            scope.add(current)
            stack.extend(self._children.get(current, ()))
        return scope
