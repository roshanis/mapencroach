"""Tests for `mapencroach.imagery.runner` -- the cron-driven weekly-capture
CLI. Covers: attempting only due weeks, `--max-weeks` capping, `--dry-run`
changing nothing (no provider calls, no state mutation, no persistence
write), summary counts (captured / gaps by reason / errors), exit codes,
and that a missing/unresolvable parcel is reported as a skipped entry
rather than crashing the run. Never touches the network: real capture
behavior is exercised with a `FakeProvider`, and the one test that goes
through `main()`'s real `build_store()` bootstrap relies on the
env-selected `DemoImageryProvider` (also network-free) for its happy path.
"""

from datetime import UTC, date, datetime

from mapencroach.api.store import Store, WatchEntryRecord
from mapencroach.imagery.capture import CaptureAttempt, CaptureStatus, ProviderScene
from mapencroach.imagery.runner import (
    EntrySummary,
    RunSummary,
    build_parser,
    main,
    render_summary,
    run,
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
