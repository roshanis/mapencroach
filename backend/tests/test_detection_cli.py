"""Detection CLI: the cron-able entry point around ingest_scene/run_detection.

Each test invokes main() in-process against a file-backed SQLite database
(a real file, not ":memory:", because the CLI opens a fresh engine per
invocation the way a cron job would) and reads stdout/stderr via capsys —
this exercises exactly what a scheduler would see.
"""

import json

import pytest
import rasterio
from sqlalchemy import create_engine

from mapencroach.db.store import init_db, seed_demo_database
from mapencroach.detection.cli import main
from test_detection import CHANGE_BLOCK, write_scene


def _distinct_scene(path, *, built_block=None, marker):
    """write_scene() plus a unique tag so repeated built_block content still
    hashes uniquely — real deliveries never collide byte-for-byte, but the
    synthetic fixture otherwise would.
    """
    write_scene(path, built_block=built_block)
    with rasterio.open(path, "r+") as dataset:
        dataset.update_tags(cli_test_marker=marker)
    return path


@pytest.fixture
def db_url(tmp_path) -> str:
    url = f"sqlite:///{tmp_path}/db.sqlite"
    engine = create_engine(url)
    init_db(engine)
    seed_demo_database(engine)
    engine.dispose()
    return url


class TestIngest:
    def test_happy_path_prints_scene_json_without_sidecar_raw(self, db_url, tmp_path, capsys):
        tif = write_scene(tmp_path / "base.tif")
        exit_code = main(
            [
                "ingest",
                "--db-url",
                db_url,
                "--scene-id",
                "base-2026-01",
                "--tif",
                str(tif),
                "--captured-at",
                "2026-01-05T00:00:00+00:00",
                "--sensor",
                "Cartosat-3 MX",
                "--resolution-m",
                "5.0",
                "--cloud-pct",
                "1.0",
                "--source",
                "cli-test",
                "--output-dir",
                str(tmp_path / "cogs"),
            ]
        )
        assert exit_code == 0
        out = capsys.readouterr().out
        stored = json.loads(out)
        assert stored["scene_id"] == "base-2026-01"
        assert stored["source"] == "cli-test"
        assert "sidecar_raw" not in stored

        engine = create_engine(db_url)
        from mapencroach.db.store import DatabaseStore

        assert DatabaseStore(engine).scenes["base-2026-01"]["sensor"] == "Cartosat-3 MX"

    def test_duplicate_scene_id_exits_1_with_stderr_message(self, db_url, tmp_path, capsys):
        tif = write_scene(tmp_path / "base.tif")
        args = [
            "ingest",
            "--db-url",
            db_url,
            "--scene-id",
            "base-2026-01",
            "--tif",
            str(tif),
            "--captured-at",
            "2026-01-05T00:00:00+00:00",
            "--sensor",
            "Cartosat-3 MX",
            "--resolution-m",
            "5.0",
            "--cloud-pct",
            "1.0",
            "--source",
            "cli-test",
            "--output-dir",
            str(tmp_path / "cogs"),
        ]
        assert main(args) == 0
        capsys.readouterr()

        exit_code = main(args)
        assert exit_code == 1
        captured = capsys.readouterr()
        assert captured.out == ""
        assert "already registered" in captured.err


def _ingest(db_url, tmp_path, capsys, scene_id, tif_path, captured_at):
    exit_code = main(
        [
            "ingest",
            "--db-url",
            db_url,
            "--scene-id",
            scene_id,
            "--tif",
            str(tif_path),
            "--captured-at",
            captured_at,
            "--sensor",
            "Cartosat-3 MX",
            "--resolution-m",
            "5.0",
            "--cloud-pct",
            "1.0",
            "--source",
            "cli-test",
            "--output-dir",
            str(tif_path.parent / "cogs"),
        ]
    )
    assert exit_code == 0
    stored = json.loads(capsys.readouterr().out)
    return stored


class TestRun:
    def test_two_runs_produce_a_shadow_alert_on_the_second(self, db_url, tmp_path, capsys):
        _ingest(
            db_url, tmp_path, capsys, "base-2026-01", write_scene(tmp_path / "base.tif"),
            "2026-01-05T00:00:00+00:00",
        )
        _ingest(
            db_url, tmp_path, capsys, "cur-2026-06",
            _distinct_scene(tmp_path / "cur1.tif", built_block=CHANGE_BLOCK, marker="cur1"),
            "2026-06-05T00:00:00+00:00",
        )
        _ingest(
            db_url, tmp_path, capsys, "cur-2026-07",
            _distinct_scene(tmp_path / "cur2.tif", built_block=CHANGE_BLOCK, marker="cur2"),
            "2026-07-05T00:00:00+00:00",
        )

        first = main(
            [
                "run",
                "--db-url",
                db_url,
                "--baseline",
                "base-2026-01",
                "--current",
                "cur-2026-06",
                "--aoi",
                "taluk-a1",
            ]
        )
        assert first == 0
        summary_1 = json.loads(capsys.readouterr().out)
        assert summary_1["candidates"] == 1
        assert summary_1["alerts_created"] == []

        second = main(
            [
                "run",
                "--db-url",
                db_url,
                "--baseline",
                "base-2026-01",
                "--current",
                "cur-2026-07",
                "--aoi",
                "taluk-a1",
            ]
        )
        assert second == 0
        summary_2 = json.loads(capsys.readouterr().out)
        assert len(summary_2["alerts_created"]) == 1

        from mapencroach.db.store import DatabaseStore

        engine = create_engine(db_url)
        store = DatabaseStore(engine)
        alert = store.alerts[summary_2["alerts_created"][0]]
        assert alert["shadow"] is True  # shadow mode is the default

    def test_live_flag_creates_visible_alert(self, db_url, tmp_path, capsys):
        _ingest(
            db_url, tmp_path, capsys, "base-2026-01", write_scene(tmp_path / "base.tif"),
            "2026-01-05T00:00:00+00:00",
        )
        _ingest(
            db_url, tmp_path, capsys, "cur-2026-06",
            _distinct_scene(tmp_path / "cur1.tif", built_block=CHANGE_BLOCK, marker="cur1"),
            "2026-06-05T00:00:00+00:00",
        )
        _ingest(
            db_url, tmp_path, capsys, "cur-2026-07",
            _distinct_scene(tmp_path / "cur2.tif", built_block=CHANGE_BLOCK, marker="cur2"),
            "2026-07-05T00:00:00+00:00",
        )
        main(
            [
                "run",
                "--db-url",
                db_url,
                "--baseline",
                "base-2026-01",
                "--current",
                "cur-2026-06",
                "--aoi",
                "taluk-a1",
            ]
        )
        capsys.readouterr()

        exit_code = main(
            [
                "run",
                "--db-url",
                db_url,
                "--baseline",
                "base-2026-01",
                "--current",
                "cur-2026-07",
                "--aoi",
                "taluk-a1",
                "--live",
            ]
        )
        assert exit_code == 0
        summary = json.loads(capsys.readouterr().out)

        from mapencroach.db.store import DatabaseStore

        engine = create_engine(db_url)
        store = DatabaseStore(engine)
        alert = store.alerts[summary["alerts_created"][0]]
        assert alert["shadow"] is False

    def test_unknown_scene_exits_1_with_stderr_message(self, db_url, capsys):
        exit_code = main(
            [
                "run",
                "--db-url",
                db_url,
                "--baseline",
                "no-such-scene",
                "--current",
                "also-missing",
                "--aoi",
                "taluk-a1",
            ]
        )
        assert exit_code == 1
        captured = capsys.readouterr()
        assert captured.out == ""
        assert "not registered" in captured.err
