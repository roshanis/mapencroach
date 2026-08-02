"""CLI entry point for running due weekly-snapshot captures on a schedule.

There is no in-process scheduler and adding a background thread to the
FastAPI app would be fragile (it would need its own crash recovery, its
own "did this already run today" bookkeeping, and would die with the web
process). Instead, `main()` here is meant to be invoked by cron or a
systemd timer -- e.g. weekly, or daily so a missed week catches up
quickly -- as the `mapencroach-capture` console script (see
`backend/pyproject.toml`). Each invocation is a single, short-lived
process: it loads state, attempts whatever weeks are due across every
watch entry, persists the results, prints a summary, and exits.

Cross-process safety -- read this before wiring up cron
----------------------------------------------------------
This module reuses `Store`'s existing `lock` / `WatchEntryRecord.in_flight`
reservation pattern for exactly the reason the HTTP handlers in
`api/app.py` do: so that *within one process*, concurrently-attempted
weeks for the same watch entry can't double-attempt each other. That is
the full extent of the safety it provides.

It is explicitly **not** safe to run this CLI concurrently with the web
app (or with another instance of this CLI) against the same state file
and expect the two to cooperate. Each invocation builds its own in-memory
`Store` from whatever is currently on disk, does its work, and writes the
*entire* resulting state back in one shot (`StatePersister.save` is a
whole-document overwrite, not a merge -- see `mapencroach.persistence`'s
module docstring). `Store.lock` and `in_flight` live in one process's
memory and are invisible to any other process; they prevent nothing
across a process boundary. If the web app's `POST
/watchlist/{id}/captures` and this CLI both run for the same alert at
close to the same moment, both may independently decide the same week is
due, both will fetch it from the provider, and whichever process's
`persist_now()`/`save()` lands last on the state file wins outright --
the other process's freshly-captured `CaptureAttempt` (and any audit
entries recorded alongside it) can be silently dropped from disk, even
though the provider fetch genuinely happened. Scene *bytes* are the one
part that stays safe under this: `FileBlobStore` is content-addressed and
each blob write is independently atomic, so a lost race here never
corrupts a blob, only the index/audit-chain rows pointing at it (and a
re-run will simply re-attempt and re-register the same week, since
`SceneRegistry.register`'s dedup-by-content-hash makes a duplicate write
harmless).

True cross-process mutual exclusion needs either a real database (row
locking / transactions) or an external lock this module does not
implement (e.g. `flock` around the cron invocation, or simply never
running the interactive capture endpoints and this CLI against the same
watch entry at overlapping times). Until this backend has a real
database behind it, the operationally safe pattern is: pick one driver of
capture runs per alert at a time (cron via this CLI, or ad hoc via the
HTTP endpoints) rather than relying on both to interleave correctly.
"""

import argparse
import os
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

from mapencroach.api.store import Store, WatchEntryRecord
from mapencroach.imagery.capture import CaptureStatus, capture_week
from mapencroach.imagery.schedule import WeekRef, due_weeks
from mapencroach.persistence import StateCorruptionError, build_store


@dataclass
class EntrySummary:
    """The outcome of one watch entry's due-week capture attempts (or, in
    `--dry-run` mode, what *would* have been attempted)."""

    alert_id: str
    weeks_attempted: int = 0
    captured: int = 0
    # Keyed by the exact `CaptureAttempt.reason` string -- stable for the
    # common "no coverage at all" case, and still informative (if more
    # fragmented) for cloud-cover/provider-error reasons that embed a
    # specific figure or message.
    gaps_by_reason: dict[str, int] = field(default_factory=dict)
    errors: int = 0
    # Set when the entry couldn't be attempted at all (e.g. its parcel no
    # longer resolves) -- distinct from a provider error on a specific
    # week, and always treated as a run failure for exit-code purposes.
    skipped_reason: str | None = None

    @property
    def failed(self) -> bool:
        return self.errors > 0 or self.skipped_reason is not None


@dataclass
class RunSummary:
    dry_run: bool
    entries: list[EntrySummary] = field(default_factory=list)

    @property
    def total_weeks_attempted(self) -> int:
        return sum(e.weeks_attempted for e in self.entries)

    @property
    def total_captured(self) -> int:
        return sum(e.captured for e in self.entries)

    @property
    def total_gaps(self) -> int:
        return sum(sum(e.gaps_by_reason.values()) for e in self.entries)

    @property
    def total_errors(self) -> int:
        return sum(e.errors for e in self.entries)

    @property
    def failed(self) -> bool:
        return any(e.failed for e in self.entries)


def _iter_watchlist(store: Store) -> Iterator[WatchEntryRecord]:
    """Watch entries in a stable (alert_id) order, so a run's summary
    output is deterministic and diffable across invocations."""
    for alert_id in sorted(store.watchlist):
        yield store.watchlist[alert_id]


def run(store: Store, *, now: datetime, max_weeks: int | None, dry_run: bool) -> RunSummary:
    """Attempt every due week for every watch entry in `store`.

    `max_weeks` caps how many of an entry's due weeks (earliest first,
    same ascending order `due_weeks` returns) this single run will
    attempt -- the forward-run equivalent of the backfill endpoint's
    `max_weeks` chunking, so a watch entry that's been due for months
    doesn't turn one invocation into an unbounded burst of provider
    calls. `None` means no cap.

    `dry_run=True` computes and reports what would be attempted without
    calling the provider, mutating `store`, or persisting anything.
    """
    today = now.date()
    summary = RunSummary(dry_run=dry_run)

    for entry in _iter_watchlist(store):
        entry_summary = EntrySummary(alert_id=entry.alert_id)
        summary.entries.append(entry_summary)

        try:
            geometry = store.parcels[entry.parcel_id]["geometry"]
        except KeyError:
            entry_summary.skipped_reason = (
                f"parcel {entry.parcel_id!r} not found -- cannot resolve capture geometry"
            )
            continue

        with store.lock:
            already = {c.week for c in entry.captures} | entry.in_flight
            due: list[WeekRef] = due_weeks(entry.started_on, today, already)
            if max_weeks is not None:
                due = due[:max_weeks]
            entry_summary.weeks_attempted = len(due)
            if not due or dry_run:
                # Nothing due, or dry-run: report the count above and move
                # on without reserving anything in `in_flight` or touching
                # the provider/registry.
                continue
            entry.in_flight.update(week.key for week in due)
            provider = store.imagery_provider
            registry = store.scene_registry

        try:
            results = [
                capture_week(
                    provider,
                    registry,
                    geometry=geometry,
                    week=week,
                    attempted_at=now,
                )
                for week in due
            ]
        finally:
            with store.lock:
                entry.in_flight.difference_update(week.key for week in due)

        with store.lock:
            if store.watchlist.get(entry.alert_id) is entry:
                entry.captures.extend(results)

        for result in results:
            if result.status == CaptureStatus.CAPTURED:
                entry_summary.captured += 1
            else:
                if result.status == CaptureStatus.PROVIDER_ERROR:
                    entry_summary.errors += 1
                reason = result.reason or result.status.value
                entry_summary.gaps_by_reason[reason] = (
                    entry_summary.gaps_by_reason.get(reason, 0) + 1
                )

        store.persist_now()

    return summary


def render_summary(summary: RunSummary) -> str:
    lines: list[str] = []
    if summary.dry_run:
        header = "mapencroach-capture: DRY RUN (nothing attempted, nothing changed)"
    else:
        header = "mapencroach-capture: run complete"
    lines.append(header)
    lines.append(
        f"  entries: {len(summary.entries)}  "
        f"weeks {'that would be ' if summary.dry_run else ''}attempted: "
        f"{summary.total_weeks_attempted}  "
        f"captured: {summary.total_captured}  "
        f"gaps: {summary.total_gaps}  "
        f"errors: {summary.total_errors}"
    )
    for entry in summary.entries:
        if entry.skipped_reason is not None:
            lines.append(f"  - {entry.alert_id}: SKIPPED ({entry.skipped_reason})")
            continue
        detail = f"  - {entry.alert_id}: {entry.weeks_attempted} week(s)"
        if not summary.dry_run:
            detail += f", {entry.captured} captured"
            for reason, count in sorted(entry.gaps_by_reason.items()):
                detail += f", {count}x gap ({reason})"
        lines.append(detail)
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mapencroach-capture",
        description=(
            "Run every watch entry's due weekly-snapshot captures. Designed "
            "to be driven by cron/systemd, not clicked by a human."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be attempted for each watch entry without "
        "calling any provider or changing any state.",
    )
    parser.add_argument(
        "--max-weeks",
        type=int,
        default=None,
        metavar="N",
        help="Attempt at most N due weeks per watch entry this run (earliest "
        "due weeks first). Unset means no cap.",
    )
    parser.add_argument(
        "--demo",
        dest="demo",
        action="store_true",
        default=None,
        help="Force the demo-seeded store (same as MAPENCROACH_DEMO=1). "
        "Default: follow the MAPENCROACH_DEMO environment variable.",
    )
    parser.add_argument(
        "--state-path",
        default=None,
        metavar="PATH",
        help="Override MAPENCROACH_STATE_PATH for this run (where watchlist/"
        "scene-registry/audit state is read from and written to).",
    )
    parser.add_argument(
        "--blob-root",
        default=None,
        metavar="PATH",
        help="Override MAPENCROACH_BLOB_ROOT for this run (where retained "
        "scene bytes are read from and written to).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.state_path is not None:
        os.environ["MAPENCROACH_STATE_PATH"] = args.state_path
    if args.blob_root is not None:
        os.environ["MAPENCROACH_BLOB_ROOT"] = args.blob_root
    demo = args.demo if args.demo is not None else os.environ.get("MAPENCROACH_DEMO") == "1"

    try:
        store = build_store(demo=demo)
    except StateCorruptionError as exc:
        print(f"mapencroach-capture: FATAL: {exc}", file=sys.stderr)
        return 2

    now = datetime.now(UTC)
    try:
        summary = run(store, now=now, max_weeks=args.max_weeks, dry_run=args.dry_run)
    except Exception as exc:  # noqa: BLE001 - must report, never crash silently under cron
        print(f"mapencroach-capture: FATAL: unexpected error: {exc}", file=sys.stderr)
        return 2

    print(render_summary(summary))
    return 1 if summary.failed else 0


if __name__ == "__main__":  # pragma: no cover - exercised via console script
    sys.exit(main())
