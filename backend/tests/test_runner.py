"""Tests for `mapencroach.imagery.runner` -- the cron-driven weekly-capture
CLI. Covers direct mode (attempting only due weeks, `--max-weeks` capping,
`--dry-run` changing nothing, summary counts, exit codes, a missing/
unresolvable parcel reported as a skipped entry) and HTTP mode (discovery
via paginated `GET /watchlist`, driving `POST /watchlist/{id}/captures`,
per-entry failure isolation, `--dry-run` making no mutating call, and
mode-selection/conflicting-flags resolution). Never touches the network:
direct-mode capture behavior is exercised with a `FakeProvider` (and the
one test that goes through `main()`'s real `build_store()` bootstrap
relies on the env-selected `DemoImageryProvider`, also network-free);
HTTP mode is exercised entirely against `httpx.MockTransport`.
"""

from datetime import UTC, date, datetime
from typing import Any

import httpx

from mapencroach.api.store import Store, WatchEntryRecord
from mapencroach.imagery.capture import CaptureAttempt, CaptureStatus, ProviderScene
from mapencroach.imagery.runner import (
    EntrySummary,
    RunSummary,
    _iter_watchlist_http,
    _ModeError,
    _resolve_mode,
    build_parser,
    main,
    render_summary,
    run,
    run_http,
)
from mapencroach.imagery.schedule import week_of
from mapencroach.persistence import StatePersister

GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[[0, 0], [0, 0.001], [0.001, 0.001], [0.001, 0], [0, 0]]],
}


class FakeProvider:
    """Deterministic, network-free `ImageryProvider`, matching the fixture
    used across the HTTP API test suites: `outcomes` maps a WeekRef key to
    "captured" (default), "none" (NO_USABLE_SCENE), or an Exception
    instance (PROVIDER_ERROR)."""

    def __init__(self, outcomes: dict[str, str | Exception] | None = None):
        self.outcomes = outcomes or {}
        self.calls: list[str] = []

    def fetch(self, *, geometry, week):
        self.calls.append(week.key)
        outcome = self.outcomes.get(week.key, "captured")
        if outcome == "none":
            return None
        if isinstance(outcome, Exception):
            raise outcome
        return ProviderScene(
            data=f"fake-scene-bytes-{week.key}".encode(),
            scene_id=f"fake-{week.key}",
            captured_at=datetime.combine(week.start, datetime.min.time(), tzinfo=UTC),
            sensor="fake-sensor",
            resolution_m=10.0,
            cloud_pct=5.0,
            source="fake",
            href=f"fake://{week.key}",
        )


def make_store(*, started_on: date, captures: list[CaptureAttempt] | None = None) -> Store:
    store = Store()
    store.parcels["parcel-1"] = {
        "id": "parcel-1",
        "jurisdiction_id": "state",
        "geometry": GEOMETRY,
    }
    store.watchlist["alert-1"] = WatchEntryRecord(
        alert_id="alert-1",
        parcel_id="parcel-1",
        started_on=started_on,
        watched_by="officer-1",
        captures=captures or [],
    )
    return store


# ---------------------------------------------------------------------
# HTTP mode test fixtures: an in-memory watch-list API driven entirely
# through httpx.MockTransport -- no real network is ever touched.
# ---------------------------------------------------------------------


def _capture_dict(
    week: str,
    status: str,
    *,
    reason: str | None = None,
    scene_id: str | None = None,
    sha256: str | None = None,
    cloud_pct: float | None = None,
) -> dict[str, Any]:
    """A `CaptureAttempt.to_dict()`-shaped dict -- exactly what `POST
    /watchlist/{id}/captures` returns for one capture result."""
    return {
        "week": week,
        "status": status,
        "attempted_at": "2026-01-05T00:00:00+00:00",
        "scene_id": scene_id,
        "sha256": sha256,
        "cloud_pct": cloud_pct,
        "reason": reason,
    }


class FakeWatchlistAPI:
    """In-memory stand-in for the watch-list HTTP API (`GET /watchlist`,
    `POST /watchlist/{id}/captures`), driven through `httpx.MockTransport`.

    `entries` maps alert_id -> {"due_weeks": [...], "captures_response":
    X} where X is one of:
      - list[dict]: the capture results the endpoint returns (HTTP 201).
      - int: an HTTP status code to fail the capture request with.
      - Exception: raised by the transport itself (e.g. a connection
        error), never reaching an HTTP response at all.

    Records every `GET /watchlist` request (for pagination assertions)
    and every alert_id a capture request was actually made for (to prove
    per-entry failure isolation, and that `--dry-run` makes none).
    """

    def __init__(self, entries: dict[str, dict[str, Any]], *, required_token: str | None = None):
        self.entries = entries
        self.required_token = required_token
        self.capture_calls: list[str] = []
        self.list_requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.required_token is not None:
            auth = request.headers.get("authorization", "")
            if auth != f"Bearer {self.required_token}":
                return httpx.Response(401, json={"detail": "invalid or missing token"})

        if request.method == "GET" and request.url.path == "/watchlist":
            self.list_requests.append(request)
            return self._list_response(request)

        if (
            request.method == "POST"
            and request.url.path.startswith("/watchlist/")
            and request.url.path.endswith("/captures")
        ):
            alert_id = request.url.path.removeprefix("/watchlist/").removesuffix("/captures")
            self.capture_calls.append(alert_id)
            return self._captures_response(alert_id)

        return httpx.Response(404, json={"detail": "not found"})  # pragma: no cover - unused path

    def _list_response(self, request: httpx.Request) -> httpx.Response:
        limit = int(request.url.params.get("limit", "200"))
        offset = int(request.url.params.get("offset", "0"))
        alert_ids = sorted(self.entries)
        page_ids = alert_ids[offset : offset + limit]
        body = [
            {
                "alert_id": alert_id,
                "parcel_id": f"parcel-{alert_id}",
                "started_on": "2026-01-05",
                "cadence": "weekly",
                "watched_by": "officer-1",
                "captures": [],
                "due_weeks": self.entries[alert_id]["due_weeks"],
            }
            for alert_id in page_ids
        ]
        return httpx.Response(200, json=body, headers={"X-Total-Count": str(len(alert_ids))})

    def _captures_response(self, alert_id: str) -> httpx.Response:
        outcome = self.entries[alert_id]["captures_response"]
        if isinstance(outcome, Exception):
            raise outcome
        if isinstance(outcome, int):
            return httpx.Response(outcome, json={"detail": "server error"})
        return httpx.Response(201, json=outcome)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def client(
        self, *, token: str = "tok", base_url: str = "https://api.test"  # noqa: S107 - fixture
    ) -> httpx.Client:
        return httpx.Client(
            base_url=base_url,
            transport=self.transport(),
            headers={"Authorization": f"Bearer {token}"},
        )


# ---------------------------------------------------------------------
# run(): only due weeks are attempted
# ---------------------------------------------------------------------


class TestRunAttemptsOnlyDueWeeks:
    def test_attempts_every_week_from_start_through_today(self):
        started_on = date(2026, 1, 5)  # Monday, 2026-W02
        now = datetime(2026, 1, 19, tzinfo=UTC)  # Monday, 2026-W04 -> 3 weeks due
        store = make_store(started_on=started_on)
        provider = FakeProvider()
        store.imagery_provider = provider

        summary = run(store, now=now, max_weeks=None, dry_run=False)

        assert summary.entries[0].weeks_attempted == 3
        assert provider.calls == ["2026-W02", "2026-W03", "2026-W04"]
        assert [c.week for c in store.watchlist["alert-1"].captures] == [
            "2026-W02",
            "2026-W03",
            "2026-W04",
        ]

    def test_already_captured_weeks_are_not_re_attempted(self):
        started_on = date(2026, 1, 5)
        now = datetime(2026, 1, 19, tzinfo=UTC)
        existing = CaptureAttempt(
            week="2026-W02",
            status=CaptureStatus.CAPTURED,
            attempted_at=now,
            scene_id="already-here",
            sha256="a" * 64,
            cloud_pct=1.0,
        )
        store = make_store(started_on=started_on, captures=[existing])
        provider = FakeProvider()
        store.imagery_provider = provider

        summary = run(store, now=now, max_weeks=None, dry_run=False)

        assert provider.calls == ["2026-W03", "2026-W04"]
        assert summary.entries[0].weeks_attempted == 2
        # The pre-existing capture is untouched, not re-attempted/replaced.
        assert store.watchlist["alert-1"].captures[0] is existing

    def test_nothing_due_yields_zero_attempted_and_no_provider_calls(self):
        started_on = date(2026, 1, 5)
        now = date(2026, 1, 5)
        store = make_store(started_on=started_on)
        provider = FakeProvider()
        store.imagery_provider = provider

        first_now = datetime.combine(now, datetime.min.time(), tzinfo=UTC)
        summary = run(store, now=first_now, max_weeks=None, dry_run=False)
        # Re-run immediately: the single due week from the first run is
        # already captured, so a second run has nothing left to do.
        summary_2 = run(store, now=first_now, max_weeks=None, dry_run=False)

        assert summary.entries[0].weeks_attempted == 1
        assert summary_2.entries[0].weeks_attempted == 0
        assert provider.calls == [week_of(now).key]

    def test_multiple_entries_processed_in_alert_id_order(self):
        store = Store()
        store.parcels["parcel-1"] = {
            "id": "parcel-1",
            "jurisdiction_id": "state",
            "geometry": GEOMETRY,
        }
        store.parcels["parcel-2"] = {
            "id": "parcel-2",
            "jurisdiction_id": "state",
            "geometry": GEOMETRY,
        }
        now = datetime(2026, 1, 5, tzinfo=UTC)
        store.watchlist["alert-2"] = WatchEntryRecord(
            alert_id="alert-2", parcel_id="parcel-2", started_on=date(2026, 1, 5), watched_by="o"
        )
        store.watchlist["alert-1"] = WatchEntryRecord(
            alert_id="alert-1", parcel_id="parcel-1", started_on=date(2026, 1, 5), watched_by="o"
        )
        store.imagery_provider = FakeProvider()

        summary = run(store, now=now, max_weeks=None, dry_run=False)

        assert [e.alert_id for e in summary.entries] == ["alert-1", "alert-2"]


# ---------------------------------------------------------------------
# --max-weeks
# ---------------------------------------------------------------------


class TestMaxWeeksCaps:
    def test_caps_attempts_per_entry_to_earliest_due_weeks(self):
        started_on = date(2026, 1, 5)  # 2026-W02
        now = datetime(2026, 1, 26, tzinfo=UTC)  # 2026-W05 -> 4 weeks due
        store = make_store(started_on=started_on)
        provider = FakeProvider()
        store.imagery_provider = provider

        summary = run(store, now=now, max_weeks=2, dry_run=False)

        assert summary.entries[0].weeks_attempted == 2
        assert provider.calls == ["2026-W02", "2026-W03"]

    def test_none_means_no_cap(self):
        started_on = date(2026, 1, 5)
        now = datetime(2026, 1, 26, tzinfo=UTC)
        store = make_store(started_on=started_on)
        store.imagery_provider = FakeProvider()

        summary = run(store, now=now, max_weeks=None, dry_run=False)

        assert summary.entries[0].weeks_attempted == 4


# ---------------------------------------------------------------------
# --dry-run changes nothing
# ---------------------------------------------------------------------


class TestDryRunChangesNothing:
    def test_dry_run_does_not_call_the_provider(self):
        started_on = date(2026, 1, 5)
        now = datetime(2026, 1, 19, tzinfo=UTC)
        store = make_store(started_on=started_on)
        provider = FakeProvider()
        store.imagery_provider = provider

        summary = run(store, now=now, max_weeks=None, dry_run=True)

        assert provider.calls == []
        assert summary.entries[0].weeks_attempted == 3  # still reported
        assert summary.entries[0].captured == 0

    def test_dry_run_does_not_mutate_captures(self):
        started_on = date(2026, 1, 5)
        now = datetime(2026, 1, 19, tzinfo=UTC)
        store = make_store(started_on=started_on)
        store.imagery_provider = FakeProvider()

        run(store, now=now, max_weeks=None, dry_run=True)

        assert store.watchlist["alert-1"].captures == []

    def test_dry_run_does_not_write_state_file(self, tmp_path):
        started_on = date(2026, 1, 5)
        now = datetime(2026, 1, 19, tzinfo=UTC)
        store = make_store(started_on=started_on)
        store.imagery_provider = FakeProvider()
        store.state_persister = StatePersister(tmp_path / "state.json")

        run(store, now=now, max_weeks=None, dry_run=True)

        assert not (tmp_path / "state.json").exists()

    def test_dry_run_render_mentions_dry_run(self):
        started_on = date(2026, 1, 5)
        now = datetime(2026, 1, 19, tzinfo=UTC)
        store = make_store(started_on=started_on)
        store.imagery_provider = FakeProvider()

        summary = run(store, now=now, max_weeks=None, dry_run=True)
        text = render_summary(summary)

        assert "DRY RUN" in text
        assert "nothing" in text.lower()


# ---------------------------------------------------------------------
# Summary counts: captured / gaps by reason / errors
# ---------------------------------------------------------------------


class TestSummaryCounts:
    def test_captured_no_usable_scene_and_provider_error_are_counted(self):
        started_on = date(2026, 1, 5)  # 2026-W02
        now = datetime(2026, 2, 2, tzinfo=UTC)  # 2026-W06 -> weeks W02..W06 (5 weeks)
        store = make_store(started_on=started_on)
        boom = RuntimeError("upstream is on fire")
        provider = FakeProvider(
            outcomes={
                "2026-W03": "none",
                "2026-W04": "none",
                "2026-W05": boom,
            }
        )
        store.imagery_provider = provider

        summary = run(store, now=now, max_weeks=None, dry_run=False)
        entry = summary.entries[0]

        assert entry.weeks_attempted == 5
        assert entry.captured == 2  # W02, W06
        assert entry.errors == 1
        assert sum(entry.gaps_by_reason.values()) == 3  # 2x no-scene + 1x provider-error
        assert "no scene available for this week and footprint" in entry.gaps_by_reason
        assert entry.gaps_by_reason["no scene available for this week and footprint"] == 2
        assert any("upstream is on fire" in reason for reason in entry.gaps_by_reason)

    def test_run_summary_totals_aggregate_across_entries(self):
        store = Store()
        store.parcels["parcel-1"] = {
            "id": "parcel-1",
            "jurisdiction_id": "state",
            "geometry": GEOMETRY,
        }
        store.parcels["parcel-2"] = {
            "id": "parcel-2",
            "jurisdiction_id": "state",
            "geometry": GEOMETRY,
        }
        now = datetime(2026, 1, 5, tzinfo=UTC)
        store.watchlist["alert-1"] = WatchEntryRecord(
            alert_id="alert-1", parcel_id="parcel-1", started_on=date(2026, 1, 5), watched_by="o"
        )
        store.watchlist["alert-2"] = WatchEntryRecord(
            alert_id="alert-2", parcel_id="parcel-2", started_on=date(2026, 1, 5), watched_by="o"
        )
        store.imagery_provider = FakeProvider(outcomes={"2026-W02": "none"})

        # alert-1 and alert-2 both hit week 2026-W02 -> both a gap.
        summary = run(store, now=now, max_weeks=None, dry_run=False)

        assert summary.total_weeks_attempted == 2
        assert summary.total_captured == 0
        assert summary.total_gaps == 2
        assert summary.total_errors == 0
        assert summary.failed is False

    def test_provider_error_marks_the_run_as_failed(self):
        started_on = date(2026, 1, 5)
        now = datetime(2026, 1, 5, tzinfo=UTC)
        store = make_store(started_on=started_on)
        store.imagery_provider = FakeProvider(outcomes={"2026-W02": RuntimeError("boom")})

        summary = run(store, now=now, max_weeks=None, dry_run=False)

        assert summary.failed is True

    def test_missing_parcel_is_reported_as_skipped_and_counts_as_failed(self):
        store = Store()  # no parcels seeded at all
        store.watchlist["alert-1"] = WatchEntryRecord(
            alert_id="alert-1",
            parcel_id="parcel-does-not-exist",
            started_on=date(2026, 1, 5),
            watched_by="officer-1",
        )
        store.imagery_provider = FakeProvider()

        summary = run(store, now=datetime(2026, 1, 5, tzinfo=UTC), max_weeks=None, dry_run=False)

        entry = summary.entries[0]
        assert entry.skipped_reason is not None
        assert "parcel-does-not-exist" in entry.skipped_reason
        assert entry.weeks_attempted == 0
        assert summary.failed is True


# ---------------------------------------------------------------------
# Persistence integration: run() persists via store.persist_now()
# ---------------------------------------------------------------------


class TestRunPersists:
    def test_real_run_persists_captures_to_the_configured_state_file(self, tmp_path):
        started_on = date(2026, 1, 5)
        now = datetime(2026, 1, 5, tzinfo=UTC)
        store = make_store(started_on=started_on)
        store.imagery_provider = FakeProvider()
        store.state_persister = StatePersister(tmp_path / "state.json")

        run(store, now=now, max_weeks=None, dry_run=False)

        persister = StatePersister(tmp_path / "state.json")
        loaded = persister.load()
        assert loaded is not None
        assert [c.week for c in loaded.watchlist["alert-1"].captures] == ["2026-W02"]

    def test_no_due_weeks_does_not_write_a_state_file(self, tmp_path):
        started_on = date(2026, 1, 5)
        now = datetime(2026, 1, 5, tzinfo=UTC)
        store = make_store(
            started_on=started_on,
            captures=[
                CaptureAttempt(
                    week=week_of(started_on).key,
                    status=CaptureStatus.NO_USABLE_SCENE,
                    attempted_at=now,
                    reason="already attempted",
                )
            ],
        )
        store.imagery_provider = FakeProvider()
        store.state_persister = StatePersister(tmp_path / "state.json")

        run(store, now=now, max_weeks=None, dry_run=False)

        assert not (tmp_path / "state.json").exists()


# ---------------------------------------------------------------------
# render_summary
# ---------------------------------------------------------------------


class TestRenderSummary:
    def test_skipped_entry_is_visible_in_output(self):
        summary = RunSummary(
            dry_run=False,
            entries=[EntrySummary(alert_id="alert-1", skipped_reason="parcel not found")],
        )
        text = render_summary(summary)
        assert "SKIPPED" in text
        assert "parcel not found" in text

    def test_real_run_output_mentions_run_complete(self):
        entry = EntrySummary(alert_id="alert-1", weeks_attempted=1, captured=1)
        summary = RunSummary(dry_run=False, entries=[entry])
        text = render_summary(summary)
        assert "run complete" in text


# ---------------------------------------------------------------------
# CLI: argument parsing
# ---------------------------------------------------------------------


class TestArgumentParsing:
    def test_defaults(self):
        args = build_parser().parse_args([])
        assert args.dry_run is False
        assert args.max_weeks is None
        assert args.demo is None
        assert args.state_path is None
        assert args.blob_root is None

    def test_flags_parsed(self):
        args = build_parser().parse_args(
            [
                "--dry-run",
                "--max-weeks",
                "3",
                "--demo",
                "--state-path",
                "/x/state.json",
                "--blob-root",
                "/x/blobs",
            ]
        )
        assert args.dry_run is True
        assert args.max_weeks == 3
        assert args.demo is True
        assert args.state_path == "/x/state.json"
        assert args.blob_root == "/x/blobs"


# ---------------------------------------------------------------------
# main(): exit codes
# ---------------------------------------------------------------------


class TestMainExitCodes:
    def test_success_with_no_watch_entries_exits_zero(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "blobs"))
        monkeypatch.setenv("MAPENCROACH_DEMO", "0")

        code = main([])

        assert code == 0

    def test_dry_run_exits_zero(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "blobs"))

        code = main(["--dry-run"])

        assert code == 0
        out = capsys.readouterr().out
        assert "DRY RUN" in out

    def test_corrupt_state_file_exits_two(self, tmp_path, monkeypatch, capsys):
        state_path = tmp_path / "state.json"
        state_path.write_text("not json at all")
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(state_path))
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "blobs"))

        code = main([])

        assert code == 2
        err = capsys.readouterr().err
        assert "FATAL" in err

    def test_provider_error_exits_one(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "blobs"))

        import mapencroach.imagery.runner as runner_module

        def fake_build_store(*, demo: bool) -> Store:
            store = make_store(started_on=date(2026, 1, 5))
            store.imagery_provider = FakeProvider(outcomes={"2026-W02": RuntimeError("boom")})
            store.clock = lambda: datetime(2026, 1, 5, tzinfo=UTC)
            return store

        monkeypatch.setattr(runner_module, "build_store", fake_build_store)

        code = main([])

        assert code == 1
        out = capsys.readouterr().out
        assert "errors: 1" in out

    def test_state_path_and_blob_root_flags_set_environment(self, tmp_path, monkeypatch):
        state_path = tmp_path / "custom" / "state.json"
        blob_root = tmp_path / "custom" / "blobs"
        monkeypatch.delenv("MAPENCROACH_STATE_PATH", raising=False)
        monkeypatch.delenv("MAPENCROACH_BLOB_ROOT", raising=False)

        code = main(["--state-path", str(state_path), "--blob-root", str(blob_root)])

        assert code == 0
        import os

        assert os.environ["MAPENCROACH_STATE_PATH"] == str(state_path)
        assert os.environ["MAPENCROACH_BLOB_ROOT"] == str(blob_root)

    def test_unexpected_exception_during_run_exits_two(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "blobs"))

        import mapencroach.imagery.runner as runner_module

        def boom(*args, **kwargs):
            raise RuntimeError("totally unexpected")

        monkeypatch.setattr(runner_module, "run", boom)

        code = main([])

        assert code == 2
        err = capsys.readouterr().err
        assert "unexpected error" in err

    def test_direct_mode_warns_loudly_on_stderr(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "blobs"))

        code = main([])

        assert code == 0
        err = capsys.readouterr().err
        assert "WARNING" in err
        assert "direct mode" in err
        # Names the last-writer-wins consequence, not just "this is risky".
        assert "wins" in err
        assert "silently dropped" in err

    def test_dry_run_direct_mode_still_warns(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv("MAPENCROACH_STATE_PATH", str(tmp_path / "state.json"))
        monkeypatch.setenv("MAPENCROACH_BLOB_ROOT", str(tmp_path / "blobs"))

        code = main(["--dry-run"])

        assert code == 0
        err = capsys.readouterr().err
        assert "WARNING" in err


# ---------------------------------------------------------------------
# HTTP mode: run_http() -- happy path, aggregation, ordering
# ---------------------------------------------------------------------


class TestRunHttpAggregatesAcrossEntries:
    def test_happy_path_multiple_entries_captured_gaps_errors(self):
        api = FakeWatchlistAPI(
            {
                "alert-2": {
                    "due_weeks": ["2026-W02"],
                    "captures_response": [
                        _capture_dict(
                            "2026-W02", "captured", scene_id="s-2", sha256="a" * 64, cloud_pct=1.0
                        )
                    ],
                },
                "alert-1": {
                    "due_weeks": ["2026-W02", "2026-W03"],
                    "captures_response": [
                        _capture_dict(
                            "2026-W02", "captured", scene_id="s-1", sha256="b" * 64, cloud_pct=2.0
                        ),
                        _capture_dict(
                            "2026-W03",
                            "no_usable_scene",
                            reason="no scene available for this week and footprint",
                        ),
                    ],
                },
            }
        )

        with api.client() as client:
            summary = run_http(client, dry_run=False)

        # Sorted by alert_id, same determinism as direct mode's _iter_watchlist.
        assert [e.alert_id for e in summary.entries] == ["alert-1", "alert-2"]
        assert summary.total_weeks_attempted == 3
        assert summary.total_captured == 2
        assert summary.total_gaps == 1
        assert summary.total_errors == 0
        assert summary.failed is False
        assert api.capture_calls == ["alert-1", "alert-2"]

    def test_provider_error_status_counted_as_error_and_gap(self):
        api = FakeWatchlistAPI(
            {
                "alert-1": {
                    "due_weeks": ["2026-W02"],
                    "captures_response": [
                        _capture_dict(
                            "2026-W02",
                            "provider_error",
                            reason="provider error: upstream is on fire",
                        )
                    ],
                }
            }
        )
        with api.client() as client:
            summary = run_http(client, dry_run=False)

        entry = summary.entries[0]
        assert entry.errors == 1
        assert sum(entry.gaps_by_reason.values()) == 1
        assert any("upstream is on fire" in reason for reason in entry.gaps_by_reason)
        assert summary.failed is True

    def test_no_watch_entries_yields_empty_summary(self):
        api = FakeWatchlistAPI({})

        with api.client() as client:
            summary = run_http(client, dry_run=False)

        assert summary.entries == []
        assert summary.failed is False

    def test_nothing_due_makes_no_capture_request(self):
        api = FakeWatchlistAPI({"alert-1": {"due_weeks": [], "captures_response": []}})

        with api.client() as client:
            summary = run_http(client, dry_run=False)

        assert api.capture_calls == ["alert-1"]  # endpoint is still called...
        assert summary.entries[0].weeks_attempted == 0  # ...it just has nothing to do


# ---------------------------------------------------------------------
# HTTP mode: --dry-run makes no mutating call
# ---------------------------------------------------------------------


class TestRunHttpDryRunMakesNoMutatingCall:
    def test_dry_run_calls_no_capture_endpoint(self):
        api = FakeWatchlistAPI(
            {
                "alert-1": {
                    "due_weeks": ["2026-W02", "2026-W03"],
                    "captures_response": [_capture_dict("2026-W02", "captured")],
                },
                "alert-2": {
                    "due_weeks": ["2026-W02"],
                    "captures_response": [_capture_dict("2026-W02", "captured")],
                },
            }
        )

        with api.client() as client:
            summary = run_http(client, dry_run=True)

        assert api.capture_calls == []
        assert [e.weeks_attempted for e in summary.entries] == [2, 1]
        assert summary.total_captured == 0
        assert "DRY RUN" in render_summary(summary)

    def test_dry_run_reports_due_weeks_from_the_listing(self):
        api = FakeWatchlistAPI(
            {
                "alert-1": {
                    "due_weeks": ["2026-W02", "2026-W03", "2026-W04"],
                    "captures_response": [],
                }
            }
        )

        with api.client() as client:
            summary = run_http(client, dry_run=True)

        assert summary.entries[0].weeks_attempted == 3
        assert summary.entries[0].captured == 0
        assert summary.entries[0].skipped_reason is None


# ---------------------------------------------------------------------
# HTTP mode: GET /watchlist pagination
# ---------------------------------------------------------------------


class TestIterWatchlistHttpPagination:
    def test_walks_every_page_until_exhausted(self):
        api = FakeWatchlistAPI(
            {f"alert-{i}": {"due_weeks": [], "captures_response": []} for i in range(5)}
        )

        with api.client() as client:
            entries = _iter_watchlist_http(client, page_size=2)

        assert [e["alert_id"] for e in entries] == sorted(f"alert-{i}" for i in range(5))
        # 5 entries at page size 2: offsets 0, 2, 4 (lengths 2, 2, 1) -- the
        # short final page (1 < 2) is what ends the loop.
        assert len(api.list_requests) == 3
        offsets = [int(r.url.params["offset"]) for r in api.list_requests]
        assert offsets == [0, 2, 4]

    def test_single_page_makes_exactly_one_request(self):
        api = FakeWatchlistAPI({"alert-1": {"due_weeks": [], "captures_response": []}})

        with api.client() as client:
            entries = _iter_watchlist_http(client, page_size=200)

        assert len(entries) == 1
        assert len(api.list_requests) == 1

    def test_empty_watchlist_makes_exactly_one_request(self):
        api = FakeWatchlistAPI({})

        with api.client() as client:
            entries = _iter_watchlist_http(client, page_size=200)

        assert entries == []
        assert len(api.list_requests) == 1

    def test_total_exactly_divisible_by_page_size_makes_one_trailing_empty_request(self):
        api = FakeWatchlistAPI(
            {f"alert-{i}": {"due_weeks": [], "captures_response": []} for i in range(4)}
        )

        with api.client() as client:
            entries = _iter_watchlist_http(client, page_size=2)

        assert len(entries) == 4
        # offsets 0, 2 (both full pages of 2) then 4 (empty, ends the loop).
        assert len(api.list_requests) == 3


# ---------------------------------------------------------------------
# HTTP mode: per-entry HTTP failures don't abort the run
# ---------------------------------------------------------------------


class TestRunHttpPerEntryFailureIsolation:
    def test_one_failing_alert_does_not_abort_the_run(self):
        api = FakeWatchlistAPI(
            {
                "alert-1": {
                    "due_weeks": ["2026-W02"],
                    "captures_response": [_capture_dict("2026-W02", "captured")],
                },
                "alert-2": {"due_weeks": ["2026-W02"], "captures_response": 500},
                "alert-3": {
                    "due_weeks": ["2026-W02"],
                    "captures_response": [_capture_dict("2026-W02", "captured")],
                },
            }
        )

        with api.client() as client:
            summary = run_http(client, dry_run=False)

        # All three were attempted -- alert-2 failing didn't stop the loop.
        assert api.capture_calls == ["alert-1", "alert-2", "alert-3"]
        by_id = {e.alert_id: e for e in summary.entries}
        assert by_id["alert-1"].captured == 1
        assert by_id["alert-1"].skipped_reason is None
        assert by_id["alert-2"].skipped_reason is not None
        assert "alert-2" in by_id["alert-2"].skipped_reason
        assert by_id["alert-2"].weeks_attempted == 0
        assert by_id["alert-3"].captured == 1
        # The one bad alert still marks the whole run failed for exit-code
        # purposes, same as an unresolvable parcel does in direct mode.
        assert summary.failed is True

    def test_connection_error_for_one_alert_is_isolated_from_the_rest(self):
        api = FakeWatchlistAPI(
            {
                "alert-1": {
                    "due_weeks": ["2026-W02"],
                    "captures_response": [_capture_dict("2026-W02", "captured")],
                },
                "alert-2": {
                    "due_weeks": ["2026-W02"],
                    "captures_response": httpx.ConnectError("connection refused"),
                },
            }
        )

        with api.client() as client:
            summary = run_http(client, dry_run=False)

        by_id = {e.alert_id: e for e in summary.entries}
        assert by_id["alert-1"].captured == 1
        assert by_id["alert-2"].skipped_reason is not None
        assert "connection refused" in by_id["alert-2"].skipped_reason
        assert summary.failed is True


# ---------------------------------------------------------------------
# HTTP mode: authentication
# ---------------------------------------------------------------------


class TestRunHttpAuthentication:
    def test_missing_or_wrong_token_surfaces_as_a_fatal_discovery_error(self):
        real_token = "the-real-token"  # noqa: S105 - test fixture, not a real credential
        api = FakeWatchlistAPI(
            {"alert-1": {"due_weeks": [], "captures_response": []}}, required_token=real_token
        )
        wrong_token = "wrong-token"  # noqa: S105 - test fixture, not a real credential

        with api.client(token=wrong_token) as client:
            try:
                run_http(client, dry_run=False)
            except httpx.HTTPStatusError as exc:
                assert exc.response.status_code == 401
            else:  # pragma: no cover - defensive
                raise AssertionError("expected an httpx.HTTPStatusError")


# ---------------------------------------------------------------------
# _resolve_mode(): mode selection, including the conflicting-flags case
# ---------------------------------------------------------------------


class TestResolveMode:
    def test_no_api_url_selects_direct_mode(self):
        args = build_parser().parse_args([])
        mode, api_url, token = _resolve_mode(args)
        assert mode == "direct"
        assert api_url is None
        assert token is None

    def test_api_url_flag_selects_http_mode(self):
        args = build_parser().parse_args(
            ["--api-url", "https://api.test", "--token", "tok-123"]
        )
        mode, api_url, token = _resolve_mode(args)
        assert mode == "http"
        assert api_url == "https://api.test"
        assert token == "tok-123"  # noqa: S105 - test fixture, not a real credential

    def test_api_url_env_var_selects_http_mode(self, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_API_URL", "https://api.test")
        monkeypatch.setenv("MAPENCROACH_API_TOKEN", "tok-from-env")
        args = build_parser().parse_args([])

        mode, api_url, token = _resolve_mode(args)

        assert mode == "http"
        assert api_url == "https://api.test"
        assert token == "tok-from-env"  # noqa: S105 - test fixture, not a real credential

    def test_cli_token_overrides_env_token(self, monkeypatch):
        monkeypatch.setenv("MAPENCROACH_API_TOKEN", "tok-from-env")
        args = build_parser().parse_args(
            ["--api-url", "https://api.test", "--token", "tok-from-flag"]
        )

        _, _, token = _resolve_mode(args)

        assert token == "tok-from-flag"  # noqa: S105 - test fixture, not a real credential

    def test_http_mode_without_a_token_raises(self, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_API_TOKEN", raising=False)
        args = build_parser().parse_args(["--api-url", "https://api.test"])

        try:
            _resolve_mode(args)
        except _ModeError as exc:
            assert "token" in str(exc)
        else:
            raise AssertionError("expected _ModeError")

    def test_max_weeks_with_api_url_is_a_conflict(self):
        args = build_parser().parse_args(
            ["--api-url", "https://api.test", "--token", "tok", "--max-weeks", "3"]
        )

        try:
            _resolve_mode(args)
        except _ModeError as exc:
            assert "--max-weeks" in str(exc)
            assert "--api-url" in str(exc)
        else:
            raise AssertionError("expected _ModeError")

    def test_timeout_without_an_api_url_is_a_conflict(self, monkeypatch):
        """--timeout tunes the HTTP client direct mode never builds.

        Accepting it silently would let an operator believe they had
        bounded a run that has no HTTP request to bound.
        """
        monkeypatch.delenv("MAPENCROACH_API_URL", raising=False)
        args = build_parser().parse_args(["--timeout", "600"])

        try:
            _resolve_mode(args)
        except _ModeError as exc:
            assert "--timeout" in str(exc)
        else:
            raise AssertionError("expected _ModeError")

    def test_timeout_is_accepted_in_http_mode(self):
        args = build_parser().parse_args(
            ["--api-url", "https://api.test", "--token", "tok", "--timeout", "600"]
        )

        mode, _, _ = _resolve_mode(args)

        assert mode == "http"
        assert args.timeout == 600.0

    def test_direct_mode_without_timeout_still_resolves(self, monkeypatch):
        monkeypatch.delenv("MAPENCROACH_API_URL", raising=False)
        args = build_parser().parse_args([])

        mode, api_url, token = _resolve_mode(args)

        assert (mode, api_url, token) == ("direct", None, None)

    def test_state_path_with_api_url_is_a_conflict(self):
        args = build_parser().parse_args(
            ["--api-url", "https://api.test", "--token", "tok", "--state-path", "/x/state.json"]
        )

        try:
            _resolve_mode(args)
        except _ModeError as exc:
            assert "--state-path" in str(exc)
        else:
            raise AssertionError("expected _ModeError")

    def test_blob_root_with_api_url_is_a_conflict(self):
        args = build_parser().parse_args(
            ["--api-url", "https://api.test", "--token", "tok", "--blob-root", "/x/blobs"]
        )

        try:
            _resolve_mode(args)
        except _ModeError as exc:
            assert "--blob-root" in str(exc)
        else:
            raise AssertionError("expected _ModeError")

    def test_demo_with_api_url_is_a_conflict(self):
        args = build_parser().parse_args(
            ["--api-url", "https://api.test", "--token", "tok", "--demo"]
        )

        try:
            _resolve_mode(args)
        except _ModeError as exc:
            assert "--demo" in str(exc)
        else:
            raise AssertionError("expected _ModeError")

    def test_multiple_conflicting_flags_are_all_named(self):
        args = build_parser().parse_args(
            [
                "--api-url",
                "https://api.test",
                "--token",
                "tok",
                "--max-weeks",
                "2",
                "--demo",
            ]
        )

        try:
            _resolve_mode(args)
        except _ModeError as exc:
            message = str(exc)
            assert "--max-weeks" in message
            assert "--demo" in message
        else:
            raise AssertionError("expected _ModeError")

    def test_dry_run_alone_is_not_a_direct_only_flag(self):
        # --dry-run applies to both modes, so it must not trip the
        # direct-mode-only conflict check.
        args = build_parser().parse_args(
            ["--api-url", "https://api.test", "--token", "tok", "--dry-run"]
        )

        mode, api_url, token = _resolve_mode(args)

        assert mode == "http"


# ---------------------------------------------------------------------
# build_parser(): new flags
# ---------------------------------------------------------------------


class TestArgumentParsingHttpFlags:
    def test_defaults(self):
        args = build_parser().parse_args([])
        assert args.api_url is None
        assert args.token is None

    def test_flags_parsed(self):
        args = build_parser().parse_args(
            ["--api-url", "https://api.test", "--token", "secret-tok"]
        )
        assert args.api_url == "https://api.test"
        assert args.token == "secret-tok"  # noqa: S105 - test fixture, not a real credential


# ---------------------------------------------------------------------
# main(): HTTP mode end to end, through a mocked transport
# ---------------------------------------------------------------------


class TestMainHttpMode:
    def _args(self, *extra: str) -> list[str]:
        return ["--api-url", "https://api.test", "--token", "tok", *extra]

    def test_unexpected_non_http_exception_is_fatal_and_exits_two(self, monkeypatch, capsys):
        import mapencroach.imagery.runner as runner_module

        def boom(*args, **kwargs):
            raise RuntimeError("totally unexpected")

        monkeypatch.setattr(runner_module, "run_http", boom)

        code = main(self._args())

        assert code == 2
        err = capsys.readouterr().err
        assert "FATAL" in err
        assert "unexpected error" in err

    def test_success_exits_zero(self, capsys):
        api = FakeWatchlistAPI(
            {
                "alert-1": {
                    "due_weeks": ["2026-W02"],
                    "captures_response": [_capture_dict("2026-W02", "captured")],
                }
            }
        )

        code = main(self._args(), transport=api.transport())

        assert code == 0
        out = capsys.readouterr().out
        assert "captured: 1" in out

    def test_entry_failure_exits_one(self, capsys):
        api = FakeWatchlistAPI(
            {"alert-1": {"due_weeks": ["2026-W02"], "captures_response": 500}}
        )

        code = main(self._args(), transport=api.transport())

        assert code == 1
        out = capsys.readouterr().out
        assert "SKIPPED" in out

    def test_dry_run_exits_zero_and_makes_no_capture_call(self, capsys):
        api = FakeWatchlistAPI(
            {
                "alert-1": {
                    "due_weeks": ["2026-W02"],
                    "captures_response": [_capture_dict("2026-W02", "captured")],
                }
            }
        )

        code = main(self._args("--dry-run"), transport=api.transport())

        assert code == 0
        assert api.capture_calls == []
        out = capsys.readouterr().out
        assert "DRY RUN" in out

    def test_discovery_failure_is_fatal_and_exits_two(self, capsys):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        code = main(self._args(), transport=httpx.MockTransport(handler))

        assert code == 2
        err = capsys.readouterr().err
        assert "FATAL" in err

    def test_no_direct_mode_warning_is_printed_in_http_mode(self, capsys):
        api = FakeWatchlistAPI({})

        code = main(self._args(), transport=api.transport())

        assert code == 0
        err = capsys.readouterr().err
        assert "WARNING" not in err

    def test_missing_token_is_fatal_and_exits_two(self, monkeypatch, capsys):
        monkeypatch.delenv("MAPENCROACH_API_TOKEN", raising=False)

        code = main(["--api-url", "https://api.test"])

        assert code == 2
        err = capsys.readouterr().err
        assert "FATAL" in err
        assert "token" in err

    def test_conflicting_flags_are_fatal_and_exit_two_before_any_request(self, capsys):
        api = FakeWatchlistAPI({"alert-1": {"due_weeks": [], "captures_response": []}})

        code = main(
            self._args("--max-weeks", "2"),
            transport=api.transport(),
        )

        assert code == 2
        err = capsys.readouterr().err
        assert "FATAL" in err
        assert "--max-weeks" in err
        # Never even got as far as building a client / issuing a request.
        assert api.list_requests == []
