"""Jurisdiction tree: state -> district -> taluk -> village.

Backs row-level scoping — every query is filtered to the caller's subtree,
so scoping bugs here are authorization bugs. Keep this exhaustively tested.
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

        self._reject_cycles()

        roots = [node_id for node_id, parent_id in rows if parent_id is None]
        if len(roots) != 1:
            raise ValueError(f"expected exactly one root jurisdiction, found {len(roots)}")

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
