"""CLI entry point for the monthly detection run, cron-able without Prefect.

Two subcommands mirror the two building blocks already in this package:
`ingest` registers a delivered scene through the hash-first COG pipeline
(imagery/pipeline.py), and `run` screens an AOI's parcels between a
baseline and current scene (detection/run.py). Both write through the
database-backed store only — this is a production entry point, so it
never seeds demo data itself.

Typical monthly cron entry, once the month's scene has already been
ingested (03:00 UTC on the 1st):

    0 3 1 * * /opt/mapencroach/.venv/bin/python -m mapencroach.detection.cli run \\
        --db-url postgresql://mapencroach@localhost/mapencroach \\
        --baseline base-2026-06 --current cur-2026-07 --aoi taluk-a1 \\
        >> /var/log/mapencroach/detection.log 2>&1

Shadow mode is the default here for the same reason it is the default in
detection/run.py: a screening model's precision on real AOIs is unknown
until measured against real alerts, and every alert an officer sees
spends trust that is expensive to earn back. Cron therefore raises shadow
AMBER alerts by default; --live is an explicit, reviewed opt-in once a
run's precision has been calibrated against confirmed outcomes.
"""

import argparse
import dataclasses
import json
import sys
from datetime import datetime

from mapencroach.db.store import create_database_store
from mapencroach.detection.run import run_detection
from mapencroach.imagery.pipeline import ingest_scene, register_scene


def _cmd_ingest(args: argparse.Namespace) -> int:
    store = create_database_store(args.db_url)
    try:
        ingested = ingest_scene(
            args.tif,
            scene_id=args.scene_id,
            captured_at=datetime.fromisoformat(args.captured_at),
            sensor=args.sensor,
            resolution_m=args.resolution_m,
            cloud_pct=args.cloud_pct,
            source=args.source,
            output_dir=args.output_dir,
            sidecar_path=args.sidecar,
        )
        stored = register_scene(store, ingested, actor="cli")
    except ValueError as exc:
        print(f"ingest failed: {exc}", file=sys.stderr)
        return 1
    # sidecar_raw is the verbatim delivered metadata text/XML and can be
    # arbitrarily large; it is already durable in the store, stdout just
    # needs the identifying fields a cron log should carry.
    visible = {key: value for key, value in stored.items() if key != "sidecar_raw"}
    print(json.dumps(visible, default=str))
    return 0


def _cmd_run(args: argparse.Namespace) -> int:
    store = create_database_store(args.db_url)
    try:
        summary = run_detection(
            store,
            baseline_scene_id=args.baseline,
            current_scene_id=args.current,
            aoi_jurisdiction_id=args.aoi,
            live=args.live,
            persistence_required=args.persistence,
            actor="cli",
        )
    except (KeyError, ValueError) as exc:
        print(f"detection run failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(dataclasses.asdict(summary), default=str))
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m mapencroach.detection.cli",
        description="Scene ingestion and detection-run entry points for cron scheduling.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest = subparsers.add_parser("ingest", help="hash, convert to COG, and register a scene")
    ingest.add_argument("--db-url", required=True)
    ingest.add_argument("--scene-id", required=True)
    ingest.add_argument("--tif", required=True)
    ingest.add_argument("--captured-at", required=True, help="ISO 8601 datetime")
    ingest.add_argument("--sensor", required=True)
    ingest.add_argument("--resolution-m", required=True, type=float)
    ingest.add_argument("--cloud-pct", required=True, type=float)
    ingest.add_argument("--source", required=True)
    ingest.add_argument("--output-dir", required=True)
    ingest.add_argument("--sidecar", default=None, help="optional sidecar metadata file")
    ingest.set_defaults(func=_cmd_ingest)

    run = subparsers.add_parser("run", help="screen an AOI between a baseline and current scene")
    run.add_argument("--db-url", required=True)
    run.add_argument(
        "--baseline",
        default=None,
        help="baseline scene id (default: the AOI's declared baseline, hash-verified)",
    )
    run.add_argument("--current", required=True, help="current scene id")
    run.add_argument("--aoi", required=True, help="AOI jurisdiction id")
    run.add_argument(
        "--live",
        action="store_true",
        help="expose created alerts to officers immediately (default: shadow)",
    )
    run.add_argument("--persistence", type=int, default=2, help="observations required to alert")
    run.set_defaults(func=_cmd_run)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
