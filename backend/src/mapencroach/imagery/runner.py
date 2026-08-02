"""CLI entry point for running due weekly-snapshot captures on a schedule.

There is no in-process scheduler and adding a background thread to the
FastAPI app would be fragile (it would need its own crash recovery, its
own "did this already run today" bookkeeping, and would die with the web
process). Instead, `main()` here is meant to be invoked by cron or a
systemd timer -- e.g. weekly, or daily so a missed week catches up
quickly -- as the `mapencroach-capture` console script (see
`backend/pyproject.toml`). Each invocation is a single, short-lived
process: it discovers due weeks across every watch entry, attempts them,
prints a summary, and exits.

Two modes, one recommended
---------------------------
**HTTP mode** (`--api-url`, or `MAPENCROACH_API_URL`, plus a bearer token
from `--token` or `MAPENCROACH_API_TOKEN`) drives the same HTTP API the
web app itself serves: it discovers watch entries via paginated `GET
/watchlist` and, for each, calls `POST /watchlist/{alert_id}/captures` --
the exact endpoint the web app's own "run captures now" action uses. This
is the **recommended** way to run this CLI whenever a web app instance is
serving the same state, and `main()` picks it by default the moment an
API URL is configured (see "Mode selection" below): the web app's
`Store` becomes the *only* process that ever loads state, does provider
I/O, and saves, so its existing `store.lock` / `WatchEntryRecord.
in_flight` reservation and its `persist_now()` calls are the only ones in
play for that state. There is exactly one writer, so the whole-document-
overwrite race described under "Cross-process safety" below cannot
happen between this CLI (in HTTP mode) and that web app instance.

Be precise about what that does and does not guarantee. It removes this
specific race -- the CLI clobbering a `CaptureAttempt`/audit entry the
web app wrote while the CLI was mid-run, or vice versa -- because the CLI
no longer touches the state file at all. It does **not** add any new
cross-process locking of its own (there is nothing left for this module
to lock: `POST /watchlist/{alert_id}/captures` already does its own
`store.lock`/`in_flight` reservation, which this CLI now simply relies
on, the same way a browser tab hitting that endpoint would). It does
**not** make running two instances of this CLI in HTTP mode against each
other special-cased in some new way -- they are just two ordinary API
clients, and the API's own in-process locking is what already serializes
them, same as it would two concurrent HTTP requests from anywhere else.
And it is only as safe as "there is exactly one app process holding the
in-memory `Store` that these HTTP calls land on" -- if the deployment
ever grows multiple load-balanced app instances without a shared store
behind them, the single-writer property this module relies on stops
being true no matter which mode the CLI runs in, and that is a
`Store`/`persistence` architecture problem (see that module's docstring),
not one this CLI can paper over.

**Direct mode** (no API URL configured) is `main()`'s fallback: it loads
state via `build_store()`, attempts due weeks in-process, and saves, the
same way this module always has. It stays for genuinely single-writer or
offline use -- no web app running at all, or a one-off local repair --
and prints a loud warning to stderr on every run explaining why it is
unsafe to run this way while the web app is serving; see "Cross-process
safety" below, which remains fully accurate to direct mode. Some flags
only make sense in direct mode (`--max-weeks`, `--state-path`,
`--blob-root`, `--demo`): the HTTP API has no equivalent for them --
`POST .../captures` always attempts every due week for an entry with no
partial-batch parameter, and state/blob location and demo-seeding are the
web app's concern once this CLI isn't the one touching disk. `main()`
therefore treats any of those flags combined with `--api-url` as a
configuration error and refuses to guess which one the operator meant,
rather than silently picking a mode.

Mode selection
--------------
HTTP mode is the default the moment `--api-url` (or `MAPENCROACH_API_URL`)
is set; direct mode is the default otherwise. This is a deliberate
preference for HTTP mode, not a coin flip: the entire point of this
module's HTTP support is to close a silent-data-loss path, and a default
that silently keeps the unsafe behavior unless an operator remembers an
extra flag would defeat that. Making "configure an API URL" the one
switch that matters means a deployment that *has* wired up the API
automatically gets the safe path, and a deployment that has not is
exactly the genuinely-offline/single-writer case direct mode is for.

Cross-process safety -- read this before running in direct mode
-----------------------------------------------------------------
This module reuses `Store`'s existing `lock` / `WatchEntryRecord.in_flight`
reservation pattern for exactly the reason the HTTP handlers in
`api/app.py` do: so that *within one process*, concurrently-attempted
weeks for the same watch entry can't double-attempt each other. That is
the full extent of the safety it provides.

It is explicitly **not** safe to run this CLI in direct mode concurrently
with the web app (or with another instance of this CLI in direct mode)
against the same state file and expect the two to cooperate. Each
invocation builds its own in-memory `Store` from whatever is currently on
disk, does its work, and writes the *entire* resulting state back in one
shot (`StatePersister.save` is a whole-document overwrite, not a merge --
see `mapencroach.persistence`'s module docstring). `Store.lock` and
`in_flight` live in one process's memory and are invisible to any other
process; they prevent nothing across a process boundary. If the web
app's `POST /watchlist/{id}/captures` and this CLI (in direct mode) both
run for the same alert at close to the same moment, both may
independently decide the same week is due, both will fetch it from the
provider, and whichever process's `persist_now()`/`save()` lands last on
the state file wins outright -- the other process's freshly-captured
`CaptureAttempt` (and any audit entries recorded alongside it) can be
silently dropped from disk, even though the provider fetch genuinely
happened. Scene *bytes* are the one part that stays safe under this:
`FileBlobStore` is content-addressed and each blob write is independently
atomic, so a lost race here never corrupts a blob, only the index/audit-
chain rows pointing at it (and a re-run will simply re-attempt and
re-register the same week, since `SceneRegistry.register`'s dedup-by-
content-hash makes a duplicate write harmless).

True cross-process mutual exclusion for direct mode would need either a
real database (row locking / transactions) or an external lock this
module does not implement (e.g. `flock` around the cron invocation).
HTTP mode is the alternative this module actually implements: instead of
excluding a second writer, it stops being a second writer at all. Until
this backend has a real database behind it, the operationally safe
pattern for direct mode remains what it always was: pick one driver of
capture runs per alert at a time. HTTP mode removes the need to make that
choice whenever a web app instance is already up.
"""

import argparse
import os
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from mapencroach.api.store import Store, WatchEntryRecord
from mapencroach.imagery.capture import CaptureStatus, capture_week
from mapencroach.imagery.schedule import WeekRef, due_weeks
from mapencroach.persistence import StateCorruptionError, build_store

# Generous timeout: `POST /watchlist/{id}/captures` may do real provider
# I/O synchronously (see api/app.py) and a capture run legitimately takes
# minutes, not seconds.
_HTTP_TIMEOUT_SECONDS = 120.0

# `GET /watchlist` page size for HTTP-mode discovery. Kept well under the
# API's own `_MAX_PAGE_SIZE` (1000); not user-configurable -- pagination
# here is an implementation detail of "discover every entry", not a knob
# an operator should need to tune.
_WATCHLIST_PAGE_SIZE = 200


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
    # longer resolves, or -- in HTTP mode -- the capture request itself
    # failed) -- distinct from a provider error on a specific week, and
    # always treated as a run failure for exit-code purposes.
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


# ---------------------------------------------------------------------
# Direct mode: in-process, single-writer capture (see module docstring
# for why this is not safe to run alongside the web app).
# ---------------------------------------------------------------------


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


# ---------------------------------------------------------------------
# HTTP mode: drive the existing API so the web app stays the only writer.
# ---------------------------------------------------------------------


def _iter_watchlist_http(
    client: httpx.Client, *, page_size: int = _WATCHLIST_PAGE_SIZE
) -> list[dict[str, Any]]:
    """Every watch-entry JSON dict (the `WatchEntry` shape `GET
    /watchlist`/`GET /watchlist/{id}` render) discovered by walking
    `GET /watchlist`'s `limit`/`offset` pagination until exhausted --
    never assumes the whole watchlist fits on one page -- then sorted by
    `alert_id` so a run's summary output is deterministic, matching
    `_iter_watchlist`'s in-process counterpart.

    Lets `httpx.HTTPError` propagate: a failure discovering the watchlist
    at all means there is nothing to iterate, which is a fatal, whole-run
    condition (see `main()`), not a per-entry one.
    """
    entries: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = client.get("/watchlist", params={"limit": page_size, "offset": offset})
        response.raise_for_status()
        page = response.json()
        entries.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return sorted(entries, key=lambda entry: entry["alert_id"])


def run_http(client: httpx.Client, *, dry_run: bool) -> RunSummary:
    """HTTP-mode counterpart of `run()`: discover every watch entry via
    paginated `GET /watchlist` and, for each, drive `POST
    /watchlist/{alert_id}/captures` -- the same endpoint the web app's UI
    uses -- instead of touching `Store`/the provider directly. See the
    module docstring for exactly what this does and does not guarantee.

    `dry_run=True` reports each entry's already-computed `due_weeks` (as
    returned by `GET /watchlist`) without calling the capture endpoint at
    all -- no mutating request is made in this mode.

    A failure calling the capture endpoint for one entry is recorded as
    that entry's `skipped_reason` (mirroring direct mode's "parcel not
    found" skip) and the run continues with the next entry -- one bad
    alert must not abort the whole run. A failure discovering the
    watchlist itself is not caught here; it propagates as a whole-run
    fatal error (see `main()`).
    """
    summary = RunSummary(dry_run=dry_run)

    for entry in _iter_watchlist_http(client):
        alert_id = entry["alert_id"]
        entry_summary = EntrySummary(alert_id=alert_id)
        summary.entries.append(entry_summary)

        if dry_run:
            entry_summary.weeks_attempted = len(entry.get("due_weeks", []))
            continue

        try:
            response = client.post(f"/watchlist/{alert_id}/captures")
            response.raise_for_status()
            results = response.json()
        except httpx.HTTPError as exc:
            entry_summary.skipped_reason = (
                f"POST /watchlist/{alert_id}/captures failed: {exc}"
            )
            continue

        entry_summary.weeks_attempted = len(results)
        for result in results:
            result_status = result.get("status")
            if result_status == CaptureStatus.CAPTURED.value:
                entry_summary.captured += 1
            else:
                if result_status == CaptureStatus.PROVIDER_ERROR.value:
                    entry_summary.errors += 1
                reason = result.get("reason") or result_status or "unknown"
                entry_summary.gaps_by_reason[reason] = (
                    entry_summary.gaps_by_reason.get(reason, 0) + 1
                )

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
            "to be driven by cron/systemd, not clicked by a human. Prefer "
            "HTTP mode (--api-url) whenever a web app instance is serving "
            "the same state -- see the module docstring for why."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be attempted for each watch entry without "
        "calling any provider or changing any state. Works in both modes: "
        "in HTTP mode, no capture endpoint is called either.",
    )
    parser.add_argument(
        "--api-url",
        default=None,
        metavar="URL",
        help="Run in HTTP mode: discover watch entries and run captures "
        "through the web app's own API at this base URL, instead of "
        "reading/writing state directly. Recommended whenever a web app "
        "instance is serving the same state (see the module docstring). "
        "Falls back to MAPENCROACH_API_URL if unset; HTTP mode is used "
        "whenever either is set. Cannot be combined with --max-weeks, "
        "--state-path, --blob-root, or --demo -- those are direct-mode-"
        "only flags with no HTTP-API equivalent.",
    )
    parser.add_argument(
        "--token",
        default=None,
        metavar="TOKEN",
        help="Bearer token to authenticate to --api-url. Falls back to "
        "MAPENCROACH_API_TOKEN if unset. Required whenever HTTP mode is "
        "selected.",
    )
    parser.add_argument(
        "--max-weeks",
        type=int,
        default=None,
        metavar="N",
        help="Direct mode only. Attempt at most N due weeks per watch "
        "entry this run (earliest due weeks first). Unset means no cap.",
    )
    parser.add_argument(
        "--demo",
        dest="demo",
        action="store_true",
        default=None,
        help="Direct mode only. Force the demo-seeded store (same as "
        "MAPENCROACH_DEMO=1). Default: follow the MAPENCROACH_DEMO "
        "environment variable.",
    )
    parser.add_argument(
        "--state-path",
        default=None,
        metavar="PATH",
        help="Direct mode only. Override MAPENCROACH_STATE_PATH for this "
        "run (where watchlist/scene-registry/audit state is read from and "
        "written to).",
    )
    parser.add_argument(
        "--blob-root",
        default=None,
        metavar="PATH",
        help="Direct mode only. Override MAPENCROACH_BLOB_ROOT for this "
        "run (where retained scene bytes are read from and written to).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=None,
        metavar="SECONDS",
        help="HTTP mode only. Per-request timeout in seconds (default "
        f"{_HTTP_TIMEOUT_SECONDS:g}). A first run with many weeks to catch "
        "up can legitimately exceed the default against a real imagery "
        "provider. Note a client timeout does not stop the server: the "
        "captures may still complete and be recorded, so this run reports "
        "a failure for work that actually succeeded. Re-running is safe -- "
        "capture attempts are idempotent per week.",
    )
    return parser


class _ModeError(Exception):
    """Raised by `_resolve_mode` for a configuration error in mode
    selection itself -- conflicting flags, or HTTP mode missing a token.
    Always fatal: caught by `main()` and reported before anything (a
    provider call, a state-file read, an HTTP request) runs."""


# (dest attribute, flag spelling) for flags that only apply to direct
# mode -- see `_resolve_mode` and the module docstring's "Mode selection"
# section for why combining any of these with an API URL is an explicit
# error rather than a silent choice.
_DIRECT_ONLY_FLAGS: tuple[tuple[str, str], ...] = (
    ("max_weeks", "--max-weeks"),
    ("state_path", "--state-path"),
    ("blob_root", "--blob-root"),
    ("demo", "--demo"),
)


def _resolve_mode(args: argparse.Namespace) -> tuple[str, str | None, str | None]:
    """Decide HTTP vs. direct mode and validate the flags for whichever
    mode wins. Returns `(mode, api_url, token)`; `api_url`/`token` are
    only meaningful when `mode == "http"`.

    HTTP mode is chosen whenever an API URL is configured (`--api-url` or
    `MAPENCROACH_API_URL`) -- see the module docstring's "Mode selection"
    for why that is the deliberately-chosen default. Raises `_ModeError`
    (never guesses) if any direct-mode-only flag is combined with an API
    URL, or if HTTP mode is selected but no bearer token is configured.
    """
    api_url = args.api_url or os.environ.get("MAPENCROACH_API_URL")
    if not api_url:
        # Symmetry with the direct-only check below: --timeout tunes the
        # HTTP client that direct mode never builds, so accepting it here
        # would silently ignore it. Refuse instead of guessing, the same
        # way a direct-only flag under --api-url is refused.
        if args.timeout is not None:
            raise _ModeError(
                "--timeout only applies to HTTP mode (it sets the API "
                "request timeout) and direct mode makes no HTTP requests -- "
                "pass --api-url/MAPENCROACH_API_URL, or drop --timeout."
            )
        return "direct", None, None

    conflicting = [flag for name, flag in _DIRECT_ONLY_FLAGS if getattr(args, name) is not None]
    if conflicting:
        raise _ModeError(
            f"{', '.join(conflicting)} only apply to direct mode and have no "
            "HTTP-API equivalent (POST .../captures always attempts every "
            "due week; state/blob location and demo-seeding are the web "
            "app's concern once this CLI isn't the one touching disk) -- "
            "cannot combine with --api-url/MAPENCROACH_API_URL. Drop one or "
            "the other."
        )

    token = args.token or os.environ.get("MAPENCROACH_API_TOKEN")
    if not token:
        raise _ModeError(
            "--api-url requires a bearer token -- pass --token or set "
            "MAPENCROACH_API_TOKEN."
        )

    return "http", api_url, token


def _warn_direct_mode_unsafe() -> None:
    print(
        "mapencroach-capture: WARNING: running in direct mode. This "
        "process loads the state file, does provider I/O in-process, and "
        "overwrites the *entire* state file on save. If the web app (or "
        "another writer) touches the same state file while this run is in "
        "progress, whichever process saves last wins outright -- the "
        "other's freshly-captured CaptureAttempt and audit entries can be "
        "silently dropped, even though the capture genuinely happened. "
        "Prefer --api-url (or MAPENCROACH_API_URL) so the web app stays "
        "the only writer; see this module's docstring for the full "
        "explanation.",
        file=sys.stderr,
    )


def _run_http_mode(
    *,
    api_url: str,
    token: str,
    dry_run: bool,
    timeout: float = _HTTP_TIMEOUT_SECONDS,
    transport: httpx.BaseTransport | None = None,
) -> RunSummary | int:
    """Run HTTP mode end to end. Returns the `RunSummary` on success, or
    an `int` exit code directly if a fatal (whole-run) error occurred
    before/while discovering the watchlist -- distinct from a per-entry
    failure, which `run_http` already folds into the returned summary.

    `transport` is a test-only hook (default `None` -> httpx's normal
    real-network transport): passing an `httpx.MockTransport` lets tests
    exercise this function, including the `httpx.Client` construction
    itself, without ever touching the network. The real console script
    never passes it.
    """
    try:
        with httpx.Client(
            base_url=api_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
            transport=transport,
        ) as client:
            return run_http(client, dry_run=dry_run)
    except httpx.HTTPError as exc:
        print(f"mapencroach-capture: FATAL: could not reach the API: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - must report, never crash silently under cron
        print(f"mapencroach-capture: FATAL: unexpected error: {exc}", file=sys.stderr)
        return 2


def main(argv: list[str] | None = None, *, transport: httpx.BaseTransport | None = None) -> int:
    """Parse `argv` and run. `transport` is a test-only hook forwarded to
    `_run_http_mode` (see its docstring) -- the real console script never
    passes it, so HTTP mode always uses httpx's real transport in
    production."""
    args = build_parser().parse_args(argv)

    try:
        mode, api_url, token = _resolve_mode(args)
    except _ModeError as exc:
        print(f"mapencroach-capture: FATAL: {exc}", file=sys.stderr)
        return 2

    if mode == "http":
        # `_resolve_mode` only ever returns "http" with both set.
        if api_url is None or token is None:  # pragma: no cover - unreachable
            raise AssertionError("internal error: HTTP mode selected without an api_url/token")
        outcome = _run_http_mode(
            api_url=api_url,
            token=token,
            dry_run=args.dry_run,
            timeout=args.timeout if args.timeout is not None else _HTTP_TIMEOUT_SECONDS,
            transport=transport,
        )
        if isinstance(outcome, int):
            return outcome
        summary = outcome
        print(render_summary(summary))
        return 1 if summary.failed else 0

    _warn_direct_mode_unsafe()

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
